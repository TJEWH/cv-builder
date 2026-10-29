-- AF-01: additive owner-scoped feedback. No catalogue/application backfill.
-- Prerequisites: schema.sql and the existing search run/receipt + v4 audit tables.
-- Install only after review; this file does not install any adaptive runner/API.
begin;

alter table public.opportunity_reviews
  add column interest_rating numeric check (interest_rating between 0 and 10),
  add column interest_reasons jsonb not null default '[]'::jsonb,
  add column feedback_excluded boolean not null default false,
  add column feedback_revision bigint not null default 0 check (feedback_revision >= 0),
  add column feedback_updated_at timestamptz,
  add column prediction_baseline jsonb;

comment on column public.opportunity_reviews.interest_rating is
  'Optional explicit user interest, 0–10 including zero; distinct from shared AI fit.';
comment on column public.opportunity_reviews.feedback_updated_at is
  'Time of the last actual state/rating/reason/exclusion change. Unknown for legacy feedback; views/comments do not advance it.';
comment on column public.opportunity_reviews.prediction_baseline is
  'Frozen proven original structured prediction. Never populated from the current catalogue. Management-only, exact historical receipt/audit proof required.';

-- Strict timestamp parsing keeps unknown dates unknown, including malformed history.
create function private.opportunity_feedback_time(p_value text) returns timestamptz
language plpgsql immutable security invoker set search_path = '' as $$
declare parsed timestamptz;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' then return null; end if;
  parsed := p_value::timestamptz;
  if not isfinite(parsed) then return null; end if;
  return parsed;
exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then return null;
end;
$$;

-- No discovery-attribution relation exists until AF-05. An asserted JSON flag is
-- not provenance: require an exact owner + opportunity + verified receipt +
-- non-rolled-back audit snapshot, with a structured 0–10 prediction predating feedback.
create function private.opportunity_feedback_baseline_matches(
  p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamptz
) returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare reference text[]; recorded timestamptz; assessment jsonb;
begin
  if p_baseline is null or jsonb_typeof(p_baseline) is distinct from 'object'
    or p_baseline - array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'] <> '{}'::jsonb
    or not (p_baseline ?& array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'])
    or jsonb_typeof(p_baseline->'source_kind') is distinct from 'string'
    or jsonb_typeof(p_baseline->'user_id') is distinct from 'string'
    or jsonb_typeof(p_baseline->'opportunity_id') is distinct from 'string'
    or jsonb_typeof(p_baseline->'source_ref') is distinct from 'string'
    or jsonb_typeof(p_baseline->'predicted_at') is distinct from 'string'
    or p_baseline->>'source_kind' is distinct from 'historical_snapshot'
    or p_baseline->>'user_id' is distinct from p_user_id::text
    or p_baseline->>'opportunity_id' is distinct from p_opportunity_id::text
    or jsonb_typeof(p_baseline->'score') <> 'number'
    or p_baseline->'scale_min' is distinct from '0'::jsonb or p_baseline->'scale_max' is distinct from '10'::jsonb
    or not ((p_baseline->>'score')::numeric between 0 and 10)
    or p_feedback_at is null then return false; end if;
  reference := regexp_match(p_baseline->>'source_ref', '^opportunity-search-receipt:([0-9a-f-]{36}):([0-9a-f-]{36})$');
  if reference is null then return false; end if;
  select a.recorded_at, a.after_snapshot->'personal_fit' into recorded, assessment
  from public.opportunity_search_receipts r
  join public.opportunity_search_runs run on run.id = r.run_id and run.user_id = r.user_id
  join private.opportunity_search_merge_audit a on a.run_id = r.run_id and a.item_id = r.item_id
    and a.opportunity_id = r.opportunity_id
  where r.run_id = reference[1]::uuid and r.item_id = reference[2]::uuid
    and r.user_id = p_user_id and r.opportunity_id = p_opportunity_id
    and r.verified_at is not null and a.rolled_back_at is null;
  return coalesce(recorded <= p_feedback_at
    and recorded = private.opportunity_feedback_time(p_baseline->>'predicted_at')
    and jsonb_typeof(assessment) = 'object'
    and jsonb_typeof(assessment->'score') = 'number'
    and assessment->'scale_min' = '0'::jsonb and assessment->'scale_max' = '10'::jsonb
    and assessment->'score' = p_baseline->'score', false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create function public.job_workspace_feedback_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare reason jsonb; normalized jsonb := '[]'::jsonb; target text; changed boolean; baseline_changed boolean;
begin
  if tg_op = 'UPDATE' and (new.user_id, new.opportunity_id) is distinct from (old.user_id, old.opportunity_id) then
    raise exception 'Opportunity review identity is immutable' using errcode = '23514';
  end if;
  if jsonb_typeof(new.interest_reasons) is distinct from 'array' or jsonb_array_length(new.interest_reasons) > 16 then
    raise exception 'Interest reasons must be an array of at most 16 tags' using errcode = '23514';
  end if;
  for reason in select value from jsonb_array_elements(new.interest_reasons) loop
    if jsonb_typeof(reason) <> 'object'
      or reason - array['category','polarity','target'] <> '{}'::jsonb
      or not (reason ?& array['category','polarity'])
      or jsonb_typeof(reason->'category') <> 'string' or jsonb_typeof(reason->'polarity') <> 'string'
      or reason->>'category' not in ('topic','method','hardware','location','funding','timing','other')
      or reason->>'polarity' not in ('positive','negative') then
      raise exception 'Invalid structured interest reason' using errcode = '23514';
    end if;
    if reason ? 'target' then
      target := btrim(reason->>'target');
      if reason->>'category' not in ('topic','method') or jsonb_typeof(reason->'target') <> 'string'
        or target = '' or char_length(target) > 120
        or reason->>'target' ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']') then
        raise exception 'Only topic/method reasons may have an explicit target (1–120 characters)' using errcode = '23514';
      end if;
      reason := jsonb_set(reason, '{target}', to_jsonb(target));
    end if;
    normalized := normalized || jsonb_build_array(reason);
  end loop;
  select coalesce(jsonb_agg(value order by value->>'category' collate "C", value->>'polarity' collate "C",
    coalesce(value->>'target','') collate "C"), '[]'::jsonb) into new.interest_reasons
    from (select distinct value from jsonb_array_elements(normalized)) reasons;

  if tg_op = 'INSERT' then
    changed := new.state <> 'unreviewed' or new.interest_rating is not null
      or new.interest_reasons <> '[]'::jsonb or new.feedback_excluded;
    new.feedback_revision := case when changed then 1 else 0 end;
    new.feedback_updated_at := case when changed then clock_timestamp() else null end;
    baseline_changed := new.prediction_baseline is not null;
  else
    changed := (new.state, new.interest_rating, new.interest_reasons, new.feedback_excluded)
      is distinct from (old.state, old.interest_rating, old.interest_reasons, old.feedback_excluded);
    new.feedback_revision := old.feedback_revision + case when changed then 1 else 0 end;
    new.feedback_updated_at := case when changed then clock_timestamp() else old.feedback_updated_at end;
    baseline_changed := new.prediction_baseline is distinct from old.prediction_baseline;
  end if;
  if baseline_changed then
    if current_user <> 'postgres' then
      raise exception 'Prediction baselines require established management-verified provenance' using errcode = '42501';
    end if;
    if not changed then
      raise exception 'A prediction baseline is frozen for its feedback revision' using errcode = '23514';
    end if;
    if new.prediction_baseline is not null and not private.opportunity_feedback_baseline_matches(
      new.prediction_baseline, new.user_id, new.opportunity_id,
      new.feedback_updated_at
    ) then
      raise exception 'Original prediction provenance unavailable or inconsistent' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunity_reviews_feedback_revision before insert or update on public.opportunity_reviews
  for each row execute function public.job_workspace_feedback_revision();

-- Internal reference implementation: exactly one current result per owner/item.
-- It is deliberately not granted as a runner/API until the later privacy tickets.
-- No comments, documents, contact data or captured application context are returned.
create function private.opportunity_interest_metric(p_user_id uuid, p_opportunity_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare review record; application record; score numeric; origin text := 'none';
  submitted boolean := false; submitted_time timestamptz; baseline jsonb; gap numeric; outcome_at timestamptz;
begin
  if p_user_id is null or p_opportunity_id is null then
    raise exception 'Feedback requires an owner and opportunity' using errcode = '22023';
  end if;
  select state, interest_rating, feedback_excluded, feedback_revision, feedback_updated_at, prediction_baseline
    into review from public.opportunity_reviews where user_id = p_user_id and opportunity_id = p_opportunity_id;
  select status, submitted_at, status_history into application from public.applications
    where user_id = p_user_id and opportunity_id = p_opportunity_id;
  if found then
    submitted := coalesce(isfinite(application.submitted_at), false) or application.status = 'submitted'
      or exists(select 1 from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted');
    select min(value) into submitted_time from (
      select application.submitted_at as value where isfinite(application.submitted_at)
      union all select private.opportunity_feedback_time(e->>'changedAt')
      from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted'
    ) times;
  end if;
  if coalesce(review.feedback_excluded, false) then origin := 'excluded';
  elsif review.interest_rating is not null then score := review.interest_rating; origin := 'explicit_rating';
  elsif review.state in ('strong_interest','interested','not_interested') then
    score := case review.state when 'strong_interest' then 8 when 'interested' then 6 else 2 end; origin := 'categorical_review';
  elsif submitted then score := 9; origin := 'confirmed_submission'; end if;
  baseline := review.prediction_baseline;
  outcome_at := case when origin = 'confirmed_submission' then submitted_time else review.feedback_updated_at end;
  if score is null or outcome_at is null or not private.opportunity_feedback_baseline_matches(
    baseline, p_user_id, p_opportunity_id, outcome_at
  ) then baseline := null; end if;
  if score is not null and baseline is not null then gap := score - (baseline->>'score')::numeric; end if;
  return jsonb_build_object('metric_version','opportunity-interest-v1', 'user_id',p_user_id, 'opportunity_id',p_opportunity_id,
    'interest_score',score, 'interest_origin',origin, 'confirmed_submission',submitted, 'submission_at',submitted_time,
    'feedback_revision',coalesce(review.feedback_revision,0), 'feedback_updated_at',review.feedback_updated_at,
    'interest_gap',gap, 'baseline_status',case when baseline is null then 'unavailable' else 'available' end);
end;
$$;

-- Existing review table/RPC grants and owner RLS remain unchanged. Triggers do
-- not require callers to receive EXECUTE on their implementation functions.
revoke all on function public.job_workspace_feedback_revision() from public, anon, authenticated, service_role;
revoke all on function private.opportunity_feedback_time(text) from public, anon, authenticated, service_role;
revoke all on function private.opportunity_feedback_baseline_matches(jsonb, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.opportunity_interest_metric(uuid, uuid) from public, anon, authenticated, service_role;

commit;
