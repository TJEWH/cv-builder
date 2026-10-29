-- AF-05: real owner-scoped discovery assessments extend the historical baseline.
-- Requires opportunity_search_discoveries from the AF-05 execution migration.
-- No historical backfill or retrospective edit of an unchanged review occurs.
begin;

create or replace function private.opportunity_feedback_baseline_matches(
  p_baseline jsonb,p_user_id uuid,p_opportunity_id uuid,p_feedback_at timestamptz
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare reference text[]; recorded timestamptz; assessment jsonb;
begin
  if p_baseline is null or jsonb_typeof(p_baseline) is distinct from 'object'
    or p_baseline-array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref']<>'{}'::jsonb
    or not(p_baseline?&array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'])
    or jsonb_typeof(p_baseline->'source_kind') is distinct from 'string'
    or jsonb_typeof(p_baseline->'source_ref') is distinct from 'string'
    or jsonb_typeof(p_baseline->'predicted_at') is distinct from 'string'
    or p_baseline->>'user_id' is distinct from p_user_id::text or p_baseline->>'opportunity_id' is distinct from p_opportunity_id::text
    or jsonb_typeof(p_baseline->'score') is distinct from 'number'
    or p_baseline->'scale_min' is distinct from '0'::jsonb or p_baseline->'scale_max' is distinct from '10'::jsonb
    or not((p_baseline->>'score')::numeric between 0 and 10) or p_feedback_at is null or not isfinite(p_feedback_at) then return false; end if;
  if p_baseline->>'source_kind'='historical_snapshot' then
    reference:=regexp_match(p_baseline->>'source_ref','^opportunity-search-receipt:([0-9a-f-]{36}):([0-9a-f-]{36})$');
    if reference is null then return false; end if;
    select a.recorded_at,a.after_snapshot->'personal_fit' into recorded,assessment
      from public.opportunity_search_receipts r
      join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=r.user_id
      join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=r.opportunity_id
      where r.run_id=reference[1]::uuid and r.item_id=reference[2]::uuid
        and r.user_id=p_user_id and r.opportunity_id=p_opportunity_id and r.verified_at is not null and a.rolled_back_at is null;
  elsif p_baseline->>'source_kind'='discovery_assessment' then
    reference:=regexp_match(p_baseline->>'source_ref','^opportunity-discovery-assessment:([0-9a-f-]{36})$');
    if reference is null then return false; end if;
    select d.assessment_recorded_at,d.original_assessment into recorded,assessment
      from public.opportunity_search_discoveries d
      join public.opportunity_search_receipts r on r.run_id=d.run_id and r.item_id=d.item_id
        and r.user_id=d.user_id and r.opportunity_id=d.opportunity_id
      join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=d.user_id and run.search_id=d.search_id
        and run.protocol_version=d.assessment_version
      join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=d.opportunity_id
      where d.discovery_id=reference[1]::uuid and d.user_id=p_user_id and d.opportunity_id=p_opportunity_id
        and d.assessment_verified_at is not null and d.assessment_verified_at=r.verified_at
        and r.verified_at is not null and a.rolled_back_at is null and d.assessment_recorded_at=a.recorded_at
        and d.original_assessment=r.payload->'personal_fit'
        and d.assessment_score=(p_baseline->>'score')::numeric and d.assessment_scale_min=0 and d.assessment_scale_max=10;
  else return false;
  end if;
  return coalesce(recorded<=p_feedback_at and recorded=private.opportunity_feedback_time(p_baseline->>'predicted_at')
    and jsonb_typeof(assessment)='object' and jsonb_typeof(assessment->'score')='number'
    and assessment->'scale_min'='0'::jsonb and assessment->'scale_max'='10'::jsonb
    and assessment->'score'=p_baseline->'score',false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Management-only read-time candidate selection rechecks actual receipt/audit
-- proof. It may derive a submission fallback, never rebase explicit feedback.
create function private.opportunity_discovery_prediction_candidate(p_user_id uuid,p_opportunity_id uuid,p_before timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare candidate jsonb;
begin
  if p_before is null or not isfinite(p_before) then return null; end if;
  for candidate in select jsonb_build_object('user_id',d.user_id,'opportunity_id',d.opportunity_id,'score',d.assessment_score,
      'scale_min',0,'scale_max',10,'predicted_at',d.assessment_recorded_at,'source_kind','discovery_assessment',
      'source_ref','opportunity-discovery-assessment:'||d.discovery_id::text)
    from public.opportunity_search_discoveries d
    where d.user_id=p_user_id and d.opportunity_id=p_opportunity_id and d.assessment_verified_at is not null
      and d.assessment_recorded_at<=p_before and d.assessment_score between 0 and 10
      and d.assessment_scale_min=0 and d.assessment_scale_max=10
    order by d.assessment_recorded_at,d.discovery_id loop
    if private.opportunity_feedback_baseline_matches(candidate,p_user_id,p_opportunity_id,p_before) then return candidate; end if;
  end loop;
  return null;
end;
$$;

create or replace function public.job_workspace_feedback_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare reason jsonb; normalized jsonb := '[]'::jsonb; target text; changed boolean; baseline_changed boolean; server_pinned boolean := false; old_baseline_null boolean; observed_baseline jsonb;
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
    old_baseline_null := true;
  else
    changed := (new.state, new.interest_rating, new.interest_reasons, new.feedback_excluded)
      is distinct from (old.state, old.interest_rating, old.interest_reasons, old.feedback_excluded);
    new.feedback_revision := old.feedback_revision + case when changed then 1 else 0 end;
    new.feedback_updated_at := case when changed then clock_timestamp() else old.feedback_updated_at end;
    baseline_changed := new.prediction_baseline is distinct from old.prediction_baseline;
    old_baseline_null := old.prediction_baseline is null;
  end if;
  -- A supplied baseline is never accepted from a browser, even if it resembles
  -- a known assessment. Only this trigger can select the protected owner row.
  if baseline_changed and current_user <> 'postgres' then
    raise exception 'Prediction baselines require established management-verified provenance' using errcode = '42501';
  end if;
  if changed and old_baseline_null and new.prediction_baseline is null and not new.feedback_excluded
    and (new.interest_rating is not null or new.state <> 'unreviewed') and current_user in ('postgres','authenticated') then
    select jsonb_build_object('user_id',d.user_id,'opportunity_id',d.opportunity_id,'score',d.assessment_score,
      'scale_min',0,'scale_max',10,'predicted_at',d.assessment_recorded_at,'source_kind','discovery_assessment',
      'source_ref','opportunity-discovery-assessment:'||d.discovery_id::text) into observed_baseline
    from public.opportunity_search_discoveries d
    where d.user_id=new.user_id and d.opportunity_id=new.opportunity_id and d.assessment_verified_at is not null
      and d.assessment_recorded_at<=new.feedback_updated_at and d.assessment_verified_at<=new.feedback_updated_at
      and d.assessment_score between 0 and 10 and d.assessment_scale_min=0 and d.assessment_scale_max=10
    order by d.assessment_recorded_at,d.discovery_id limit 1;
    if observed_baseline is not null then
      new.prediction_baseline:=observed_baseline; baseline_changed:=true; server_pinned:=true;
    end if;
  end if;
  if baseline_changed then
    if current_user <> 'postgres' and not server_pinned then
      raise exception 'Prediction baselines require established management-verified provenance' using errcode = '42501';
    end if;
    if not changed then
      raise exception 'A prediction baseline is frozen for its feedback revision' using errcode = '23514';
    end if;
    -- Keep the private helper in a separate PL/pgSQL statement. PostgreSQL
    -- checks EXECUTE while planning an expression even when an AND operand
    -- would short-circuit; authenticated automatic pins must never plan it.
    if not server_pinned then
      if new.prediction_baseline is not null and not private.opportunity_feedback_baseline_matches(
        new.prediction_baseline, new.user_id, new.opportunity_id,
        new.feedback_updated_at
      ) then
        raise exception 'Original prediction provenance unavailable or inconsistent' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.opportunity_interest_metric(p_user_id uuid, p_opportunity_id uuid) returns jsonb
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
  if baseline is null and origin='confirmed_submission' and outcome_at is not null then
    baseline:=private.opportunity_discovery_prediction_candidate(p_user_id,p_opportunity_id,outcome_at);
  end if;
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

create or replace function private.project_opportunity_feedback(p_user_id uuid,p_opportunity_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare public_fact record; review record; metric jsonb; result jsonb; baseline jsonb;
  topic text; reason jsonb; value text; approved_summary text; reasons jsonb:='[]'; topics jsonb:='[]';
  withheld jsonb:=jsonb_build_object('unsafe_text',0,'unsafe_url',0,'topic_limit',0,'unsafe_reason',0,'unapproved_summary',0);
  field text; limit_length integer; counter text;
begin
  if p_user_id is null or p_opportunity_id is null then raise exception 'Feedback requires an owner and opportunity' using errcode='22023'; end if;
  select o.opportunity_key,o.title,o.institution,o.official_url,o.source_url,o.research_summary,o.topics
    into public_fact from public.opportunities o where o.id=p_opportunity_id;
  if not found then return null; end if;
  select r.state,r.interest_reasons,r.feedback_excluded,r.prediction_baseline,
    r.search_feedback_summary,r.search_feedback_revision,r.search_feedback_summary_hash,r.search_feedback_source_hash,
    r.search_feedback_approved_at,r.search_feedback_approved_summary_hash,r.search_feedback_approved_source_hash
    into review from public.opportunity_reviews r where r.user_id=p_user_id and r.opportunity_id=p_opportunity_id;
  if coalesce(review.feedback_excluded,false) then return null; end if;
  metric:=private.opportunity_interest_metric(p_user_id,p_opportunity_id);
  result:=jsonb_build_object('opportunity_id',p_opportunity_id,'topics',topics,
    'metric_version',metric->'metric_version','interest_score',metric->'interest_score','interest_origin',metric->'interest_origin',
    'interest_gap',metric->'interest_gap','baseline_status',metric->'baseline_status',
    'feedback_revision',metric->'feedback_revision','feedback_updated_at',metric->'feedback_updated_at',
    'review_state',coalesce(review.state,'unreviewed'),'confirmed_submission',metric->'confirmed_submission','submission_at',metric->'submission_at');
  if metric->>'baseline_status'='available' then
    baseline:=review.prediction_baseline;
    if baseline is null and metric->>'interest_origin'='confirmed_submission' then
      baseline:=private.opportunity_discovery_prediction_candidate(p_user_id,p_opportunity_id,private.opportunity_feedback_time(metric->>'submission_at'));
    end if;
    result:=result||jsonb_build_object('original_prediction',jsonb_build_object('user_id',p_user_id,'opportunity_id',p_opportunity_id,
      'score',baseline->'score','scale_min',0,'scale_max',10,'predicted_at',baseline->>'predicted_at',
      'source_kind',baseline->>'source_kind','source_ref',baseline->>'source_ref'));
  end if;
  foreach field in array array['opportunity_key','title','institution','research_summary'] loop
    value:=case field when 'opportunity_key' then public_fact.opportunity_key when 'title' then public_fact.title
      when 'institution' then public_fact.institution else public_fact.research_summary end;
    limit_length:=case field when 'title' then 240 when 'research_summary' then 1000 else 200 end;
    if value is not null and value<>'' then
      if private.opportunity_feedback_projection_text(value,limit_length) then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_text}',to_jsonb((withheld->>'unsafe_text')::integer+1)); end if;
    end if;
  end loop;
  foreach field in array array['official_url','source_url'] loop
    value:=case field when 'official_url' then public_fact.official_url else public_fact.source_url end;
    if value is not null and value<>'' then
      value:=private.opportunity_feedback_safe_url(value);
      if value is not null then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_url}',to_jsonb((withheld->>'unsafe_url')::integer+1)); end if;
    end if;
  end loop;
  for topic in select distinct t.label collate "C" from unnest(public_fact.topics) t(label) order by t.label collate "C" loop
    counter:=null;
    if not private.opportunity_feedback_projection_text(topic,120) then counter:='unsafe_text';
    elsif jsonb_array_length(topics)>=16 then counter:='topic_limit';
    else topics:=topics||jsonb_build_array(topic); end if;
    if counter is not null then withheld:=jsonb_set(withheld,array[counter],to_jsonb((withheld->>counter)::integer+1)); end if;
  end loop;
  if jsonb_typeof(review.interest_reasons)='array' then
    for reason in select e.value from jsonb_array_elements(review.interest_reasons) e loop
      if jsonb_array_length(reasons)>=16 or jsonb_typeof(reason)<>'object'
        or jsonb_typeof(reason->'category') is distinct from 'string' or jsonb_typeof(reason->'polarity') is distinct from 'string'
        or reason->>'category' not in ('topic','method','hardware','location','funding','timing','other')
        or reason->>'polarity' not in ('positive','negative')
        or reason ? 'target' and (reason->>'category' not in ('topic','method')
          or not private.opportunity_feedback_projection_text(reason->>'target',120)) then
        withheld:=jsonb_set(withheld,'{unsafe_reason}',to_jsonb((withheld->>'unsafe_reason')::integer+1));
      else
        reasons:=reasons||jsonb_build_array(jsonb_build_object('category',reason->>'category','polarity',reason->>'polarity')
          ||case when reason ? 'target' then jsonb_build_object('target',reason->>'target') else '{}'::jsonb end);
      end if;
    end loop;
  end if;
  if review.search_feedback_approved_at is not null
    and private.opportunity_feedback_projection_text(review.search_feedback_summary,600)
    and encode(sha256(convert_to(review.search_feedback_summary,'UTF8')),'hex')=review.search_feedback_summary_hash
    and review.search_feedback_approved_summary_hash=review.search_feedback_summary_hash
    and review.search_feedback_approved_source_hash=review.search_feedback_source_hash
    and exists(select 1 from public.opportunity_feedback_summary_approvals proof where proof.user_id=p_user_id and proof.opportunity_id=p_opportunity_id
      and proof.summary_revision=review.search_feedback_revision and proof.summary_hash=review.search_feedback_summary_hash
      and proof.source_hash=review.search_feedback_source_hash and proof.approved_at=review.search_feedback_approved_at) then
    approved_summary:=review.search_feedback_summary;
    result:=result||jsonb_build_object('search_feedback_summary',approved_summary,'summary_approval',jsonb_build_object(
      'summary_hash',review.search_feedback_summary_hash,'source_hash',review.search_feedback_source_hash,
      'summary_revision',review.search_feedback_revision,'approved_at',review.search_feedback_approved_at));
  elsif review.search_feedback_summary is not null and review.search_feedback_summary<>'' then
    withheld:=jsonb_set(withheld,'{unapproved_summary}','1'::jsonb);
  end if;
  -- Explicitly approved text and structured reasons remain useful without a
  -- numeric rating. Unknown interest stays JSON null, never an implicit zero.
  if metric->'interest_score'='null'::jsonb and jsonb_array_length(reasons)=0 and approved_summary is null then return null; end if;
  return result||jsonb_build_object('topics',topics,'reasons',reasons,'withheld_counts',withheld);
end;
$$;

comment on column public.opportunity_reviews.prediction_baseline is
  'Frozen independently proven original assessment. The server may pin protected verified discovery metadata only on a new meaningful explicit feedback revision; views and later verification never rebase unchanged feedback.';
revoke all on function private.opportunity_feedback_baseline_matches(jsonb,uuid,uuid,timestamptz),
  private.opportunity_discovery_prediction_candidate(uuid,uuid,timestamptz),
  private.opportunity_interest_metric(uuid,uuid),private.project_opportunity_feedback(uuid,uuid),
  public.job_workspace_feedback_revision() from public,anon,authenticated,service_role;
commit;
