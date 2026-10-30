-- One current evaluation value. Install after opportunity_feedback_inclusion.sql.
-- Existing distinct comment/summary text is combined once, without truncation.
-- Numeric interest, consent, exclusions, captured applications and task bindings do not change.
begin;
set local lock_timeout = '5s';

do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_reviews' and column_name='search_feedback_summary')
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_reviews' and column_name='evaluation_revision') then
    raise exception 'Evaluation migration requires the preceding two-field schema and must run once' using errcode='55000';
  end if;
end $$;
lock table public.opportunity_reviews,public.opportunity_feedback_summary_approvals in share row exclusive mode;

create temporary table evaluation_migration_plan on commit drop as
select user_id,opportunity_id,search_feedback_revision as revision,
  case when comment is null and search_feedback_summary is null then null
    when position(coalesce(search_feedback_summary,'') in coalesce(comment,''))>0 then coalesce(comment,'')
    when position(coalesce(comment,'') in coalesce(search_feedback_summary,''))>0 then coalesce(search_feedback_summary,'')
    else comment||E'\n\n'||search_feedback_summary end as evaluation,
  to_jsonb(r)-array['comment','search_feedback_summary','search_feedback_revision','search_feedback_summary_hash','search_feedback_source_hash',
    'search_feedback_approved_at','search_feedback_approved_summary_hash','search_feedback_approved_source_hash'] as unchanged
from public.opportunity_reviews r;
do $$ begin
  if exists(select 1 from evaluation_migration_plan where char_length(evaluation)>12000) then
    raise exception 'An existing evaluation exceeds 12000 characters; preserve and review it before migration' using errcode='22023';
  end if;
end $$;

-- No business event occurred: preserve the original review/feedback times and revisions.
drop trigger opportunity_reviews_sharing on public.opportunity_reviews;
alter table public.opportunity_reviews disable trigger opportunity_reviews_updated_at;
alter table public.opportunity_reviews disable trigger opportunity_reviews_feedback_invalidate;
alter table public.opportunity_reviews drop constraint opportunity_reviews_comment_length;
alter table public.opportunity_reviews add constraint opportunity_reviews_comment_length check(char_length(comment)<=12000);
update public.opportunity_reviews r set comment=p.evaluation
from evaluation_migration_plan p where (r.user_id,r.opportunity_id)=(p.user_id,p.opportunity_id) and r.comment is distinct from p.evaluation;
alter table public.opportunity_reviews rename column search_feedback_revision to evaluation_revision;
alter table public.opportunity_reviews rename constraint opportunity_reviews_search_feedback_revision_check to opportunity_reviews_evaluation_revision_check;

create function public.job_workspace_evaluation_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then new.evaluation_revision:=case when new.comment is null then 0 else 1 end;
  else new.evaluation_revision:=old.evaluation_revision+case when new.comment is distinct from old.comment then 1 else 0 end;end if;
  return new;
end $$;
revoke all on function public.job_workspace_evaluation_revision() from public,anon,authenticated,service_role;
create trigger opportunity_reviews_evaluation_revision before insert or update on public.opportunity_reviews
for each row execute function public.job_workspace_evaluation_revision();

create or replace function public.save_opportunity_comment(p_opportunity_id uuid,p_comment text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_reviews;value text:=nullif(p_comment,'');
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in account is required' using errcode='42501';end if;
  if char_length(value)>12000 then raise exception 'Keep the evaluation to 12000 characters or fewer' using errcode='22023';end if;
  perform 1 from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  insert into public.opportunity_reviews(user_id,opportunity_id,comment) values(actor,p_opportunity_id,value)
  on conflict(user_id,opportunity_id) do update set comment=excluded.comment returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.save_opportunity_feedback(p_opportunity_id uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501';end if;
  if p_opportunity_id is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
    or p_patch-array['interest_rating','interest_reasons','feedback_excluded','manually_archived','technical_issue_category','technical_issue_note']<>'{}'::jsonb then
    raise exception 'Use a supported partial feedback update' using errcode='22023';end if;
  if p_patch?'interest_rating' and p_patch->'interest_rating'<>'null'::jsonb
    and(jsonb_typeof(p_patch->'interest_rating') is distinct from 'number' or not((p_patch->>'interest_rating')::numeric between 0 and 10)) then
    raise exception 'Interest rating must be a number from 0 to 10' using errcode='22023';end if;
  if p_patch?'feedback_excluded' and jsonb_typeof(p_patch->'feedback_excluded') is distinct from 'boolean' then
    raise exception 'Feedback exclusion must be boolean' using errcode='22023';end if;
  if p_patch?'manually_archived' and jsonb_typeof(p_patch->'manually_archived') is distinct from 'boolean' then
    raise exception 'Past override must be boolean' using errcode='22023';end if;
  if p_patch?'technical_issue_category' and p_patch->'technical_issue_category'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_category') is distinct from 'string' or p_patch->>'technical_issue_category' not in('closed','requirements','application_problem','other')) then
    raise exception 'Choose a supported technical issue category' using errcode='22023';end if;
  if p_patch?'technical_issue_note' and p_patch->'technical_issue_note'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_note') is distinct from 'string' or char_length(p_patch->>'technical_issue_note')>1000) then
    raise exception 'Technical notes must be at most 1000 characters' using errcode='22023';end if;
  perform 1 from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  insert into public.opportunity_reviews(user_id,opportunity_id) values(actor,p_opportunity_id) on conflict(user_id,opportunity_id) do nothing;
  update public.opportunity_reviews set
    manually_archived=case when p_patch?'manually_archived' then(p_patch->>'manually_archived')::boolean else manually_archived end,
    technical_issue_category=case when p_patch?'technical_issue_category' then p_patch->>'technical_issue_category' else technical_issue_category end,
    technical_issue_note=case when p_patch?'technical_issue_note' then nullif(p_patch->>'technical_issue_note','') else technical_issue_note end,
    interest_rating=case when p_patch?'interest_rating' then(p_patch->>'interest_rating')::numeric else interest_rating end,
    interest_reasons=case when p_patch?'interest_reasons' then p_patch->'interest_reasons' else interest_reasons end,
    feedback_excluded=case when p_patch?'feedback_excluded' then(p_patch->>'feedback_excluded')::boolean else feedback_excluded end
  where user_id=actor and opportunity_id=p_opportunity_id returning * into saved;
  return to_jsonb(saved);
end $$;

-- A derived packet excerpt is not another editable/stored evaluation field.
create function public.opportunity_feedback_inclusion(p_comment text,p_revision bigint) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare excerpt text;
begin
  if p_revision is null or p_revision<0 or not public.opportunity_feedback_preview_text(p_comment,12000) then return null;end if;
  excerpt:=left(p_comment,600);
  if not public.opportunity_feedback_preview_text(excerpt,600) then return null;end if;
  return jsonb_build_object('text',excerpt,'proof',jsonb_build_object('policy_version','included-unless-excluded-v1',
    'summary_hash',encode(sha256(convert_to(excerpt,'UTF8')),'hex'),'source_hash',encode(sha256(convert_to(p_comment,'UTF8')),'hex'),
    'summary_revision',p_revision,'truncated',char_length(p_comment)>600,'source_length',char_length(p_comment)));
end $$;
revoke all on function public.opportunity_feedback_inclusion(text,bigint) from public,anon,service_role;
grant execute on function public.opportunity_feedback_inclusion(text,bigint) to authenticated;

-- Convert installed definitions once; these temporary patch helpers never ship as runtime adapters.
create function pg_temp.evaluation_replace(signature text,before_text text,after_text text) returns void
language plpgsql set search_path='' as $$
declare body text:=pg_get_functiondef(signature::regprocedure);
begin
  if (length(body)-length(replace(body,before_text,'')))/length(before_text)<>1 then
    raise exception 'Evaluation migration prerequisite differs: %',signature using errcode='55000';end if;
  execute replace(body,before_text,after_text);
end $$;
select pg_temp.evaluation_replace('public.project_opportunity_feedback_preview(uuid,uuid)',
  E'r.search_feedback_summary,r.search_feedback_revision,r.search_feedback_summary_hash,r.search_feedback_source_hash,\n    r.search_feedback_approved_at,r.search_feedback_approved_summary_hash,r.search_feedback_approved_source_hash',
  'r.evaluation_revision');
select pg_temp.evaluation_replace('public.project_opportunity_feedback_preview(uuid,uuid)',
  'public.opportunity_feedback_inclusion(review.comment,review.search_feedback_summary,review.search_feedback_revision)',
  'public.opportunity_feedback_inclusion(review.comment,review.evaluation_revision)');
select pg_temp.evaluation_replace('public.project_opportunity_feedback_preview(uuid,uuid)',
  $old$result:=(result-'summary_approval')||jsonb_build_object$old$,$new$result:=result||jsonb_build_object$new$);

-- The old private projector no longer maintains a second disclosure/approval algorithm.
create or replace function private.project_opportunity_feedback(p_user_id uuid,p_opportunity_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select public.project_opportunity_feedback_preview(p_user_id,p_opportunity_id)
$$;

select pg_temp.evaluation_replace('public.opportunity_search_validate_preference_rule(uuid,uuid,jsonb,boolean)',
  'or search_feedback_approved_at is not null','or public.opportunity_feedback_inclusion(comment,evaluation_revision) is not null');
select pg_temp.evaluation_replace('private.validate_adaptive_proposals(jsonb,jsonb)',
  'or r.search_feedback_approved_at is not null','or public.opportunity_feedback_inclusion(r.comment,r.evaluation_revision) is not null');
select pg_temp.evaluation_replace('private.begin_adaptive_opportunity_search(uuid,uuid)',
  $old$e-array['search_feedback_summary','summary_approval','summary_inclusion']$old$,
  $new$e-array['search_feedback_summary','summary_inclusion']$new$);
select pg_temp.evaluation_replace('private.opportunity_search_adaptive_shape(text,jsonb)',
  $old$'reasons','search_feedback_summary','summary_approval','summary_inclusion'$old$,$new$'reasons','search_feedback_summary','summary_inclusion'$new$);
select pg_temp.evaluation_replace('private.opportunity_search_adaptive_shape(text,jsonb)',
  $old$    when 'summary_approval' then array['summary_hash','source_hash','summary_revision','approved_at']$old$,'');
select pg_temp.evaluation_replace('private.opportunity_search_adaptive_shape(text,jsonb)',
  $old$      when p_kind='example' and entry.key='summary_approval' then 'summary_approval'$old$,'');
select pg_temp.evaluation_replace('private.opportunity_search_adaptive_shape(text,jsonb)',
  $old$  if p_kind='example' and p_value?'summary_inclusion' and p_value?'summary_approval' then return false;end if;
  if p_kind='example' and p_value?'summary_inclusion' and char_length(p_value->>'search_feedback_summary') is distinct from least(600,(p_value#>>'{summary_inclusion,source_length}')::integer) then return false;end if;
  if p_kind='example' and p_value?'search_feedback_summary' then
    if not(p_value?'summary_inclusion' or p_value?'summary_approval') then return false;end if;
    if encode(sha256(convert_to(p_value->>'search_feedback_summary','UTF8')),'hex') is distinct from coalesce(p_value#>>'{summary_inclusion,summary_hash}',p_value#>>'{summary_approval,summary_hash}') then return false;end if;
  elsif p_kind='example' and(p_value?'summary_inclusion' or p_value?'summary_approval') then return false;end if;$old$,
  $new$  if p_kind='example' and p_value?'summary_inclusion' and char_length(p_value->>'search_feedback_summary') is distinct from least(600,(p_value#>>'{summary_inclusion,source_length}')::integer) then return false;end if;
  if p_kind='example' and p_value?'search_feedback_summary' then
    if not(p_value?'summary_inclusion') then return false;end if;
    if encode(sha256(convert_to(p_value->>'search_feedback_summary','UTF8')),'hex') is distinct from p_value#>>'{summary_inclusion,summary_hash}' then return false;end if;
  elsif p_kind='example' and p_value?'summary_inclusion' then return false;end if;$new$);

create or replace function public.job_workspace_snapshot_redaction() returns trigger
language plpgsql security invoker set search_path='' as $$
declare enabled boolean;live_consent_revision bigint;item jsonb;original jsonb;items jsonb:='[]';review record;proof jsonb;
  result jsonb:=old.packet;removed boolean:=false;changed boolean:=false;
begin
  if(new.user_id,new.search_id,new.feedback_revision,new.input_fingerprint,new.created_at)
    is distinct from(old.user_id,old.search_id,old.feedback_revision,old.input_fingerprint,old.created_at) then
    raise exception 'Feedback snapshot identity and audit metadata are immutable' using errcode='23514';end if;
  new.redact_aggregates:=old.redact_aggregates or coalesce(new.redact_aggregates,false);
  select structured_feedback_enabled,consent_revision into enabled,live_consent_revision from public.opportunity_search_adaptive_settings
    where user_id=old.user_id and search_id=old.search_id;
  if not coalesce(enabled,false) or new.redact_aggregates then
    result:=result||jsonb_build_object('examples','[]'::jsonb,'approved_preferences','[]'::jsonb,
      'aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
      'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
        'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    changed:=new.redact_aggregates or coalesce((old.packet#>>'{counts,eligible}')::bigint,0)>0
      or coalesce((old.packet->>'consent_revision')::bigint,0) is distinct from live_consent_revision;
  else
    for original in select value from jsonb_array_elements(coalesce(old.packet->'examples','[]')) loop
      -- Only the current example contract may survive a pinned-packet read.
      select coalesce(jsonb_object_agg(key,value),'{}') into item from jsonb_each(original)
      where key=any(array['opportunity_id','opportunity_key','title','institution','official_url','source_url','research_summary','topics',
        'metric_version','interest_score','interest_origin','interest_gap','baseline_status','original_prediction','feedback_revision','feedback_updated_at',
        'review_state','confirmed_submission','submission_at','reasons','search_feedback_summary','summary_inclusion','manually_archived','technical_issue_category']);
      if item is distinct from original then changed:=true;end if;
      select feedback_excluded,comment,evaluation_revision into review from public.opportunity_reviews
        where user_id=old.user_id and opportunity_id=(item->>'opportunity_id')::uuid;
      if coalesce(review.feedback_excluded,false) or(not found and
        (item->>'interest_origin' in('explicit_rating','categorical_review') or jsonb_array_length(coalesce(item->'reasons','[]'))>0 or item?'search_feedback_summary')) then
        removed:=true;changed:=true;continue;end if;
      if item?'search_feedback_summary' then
        proof:=public.opportunity_feedback_inclusion(review.comment,review.evaluation_revision);
        if proof is null or proof->'proof' is distinct from item->'summary_inclusion' or proof->>'text' is distinct from item->>'search_feedback_summary' then
          item:=item-array['search_feedback_summary','summary_inclusion'];changed:=true;end if;
      elsif item?'summary_inclusion' then item:=item-'summary_inclusion';changed:=true;end if;
      items:=items||jsonb_build_array(item);
    end loop;
    result:=jsonb_set(result,'{examples}',items);
    result:=jsonb_set(result,'{counts,approved_summaries}',to_jsonb((select count(*) from jsonb_array_elements(items) e where e?'search_feedback_summary')));
    if removed then
      result:=result||jsonb_build_object('aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
        'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
          'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    end if;
  end if;
  if changed or coalesce((old.packet->>'privacy_scope_changed')::boolean,false) or new.packet->'privacy_scope_changed'='true'::jsonb then
    result:=result||'{"privacy_scope_changed":true}'::jsonb;end if;
  new.packet:=result;return new;
end $$;

create or replace function public.job_workspace_feedback_invalidation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;target_search uuid;semantic boolean:=false;privacy boolean:=false;redact_aggregate_context boolean:=false;
begin
  if tg_table_name='opportunity_reviews' then
    if tg_op='DELETE' then
      owner_id:=old.user_id;
      semantic:=old.comment is not null or old.manually_archived or old.technical_issue_category is not null
        or old.state<>'unreviewed' or old.interest_rating is not null or old.interest_reasons<>'[]'::jsonb or old.feedback_excluded;
      privacy:=semantic;redact_aggregate_context:=semantic;
    elsif tg_op='INSERT' then
      owner_id:=new.user_id;
      semantic:=new.comment is not null or new.manually_archived or new.technical_issue_category is not null
        or new.state<>'unreviewed' or new.interest_rating is not null or new.interest_reasons<>'[]'::jsonb or new.feedback_excluded;
      privacy:=new.feedback_excluded;redact_aggregate_context:=new.feedback_excluded;
    else
      owner_id:=new.user_id;
      semantic:=(new.comment,new.manually_archived,new.technical_issue_category,new.state,new.interest_rating,new.interest_reasons,new.feedback_excluded,new.prediction_baseline)
        is distinct from(old.comment,old.manually_archived,old.technical_issue_category,old.state,old.interest_rating,old.interest_reasons,old.feedback_excluded,old.prediction_baseline);
      privacy:=new.feedback_excluded or new.comment is distinct from old.comment;
      redact_aggregate_context:=new.feedback_excluded and not old.feedback_excluded;
    end if;
  elsif tg_table_name='applications' then
    if tg_op='DELETE' then owner_id:=old.user_id;semantic:=true;
    elsif tg_op='INSERT' then owner_id:=new.user_id;
      semantic:=isfinite(new.submitted_at) or new.status='submitted' or jsonb_path_exists(new.status_history,'$[*] ? (@.status == "submitted")');
    else owner_id:=new.user_id;
      semantic:=(new.submitted_at,new.status='submitted',jsonb_path_query_array(new.status_history,'$[*] ? (@.status == "submitted")'))
        is distinct from(old.submitted_at,old.status='submitted',jsonb_path_query_array(old.status_history,'$[*] ? (@.status == "submitted")'));end if;
  elsif tg_table_name='opportunity_search_adaptive_settings' then
    owner_id:=new.user_id;target_search:=new.search_id;
    semantic:=tg_op='INSERT' or new.structured_feedback_enabled is distinct from old.structured_feedback_enabled;
    privacy:=semantic and not new.structured_feedback_enabled;
  end if;
  if semantic then update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id and(target_search is null or search_id=target_search);end if;
  if privacy then
    update public.opportunity_search_feedback_snapshots s set packet=s.packet||'{"privacy_scope_changed":true}'::jsonb,
      redact_aggregates=s.redact_aggregates or redact_aggregate_context
    where s.user_id=owner_id and(target_search is null or s.search_id=target_search)
      and exists(select 1 from public.opportunity_search_adaptive_settings parent where parent.user_id=s.user_id and parent.search_id=s.search_id);
  end if;
  return null;
end $$;

-- Remove the retired approval capability completely, including its proof cache.
drop trigger opportunity_summary_approval_guard on public.opportunity_feedback_summary_approvals;
drop trigger opportunity_summary_approval_cache on public.opportunity_feedback_summary_approvals;
drop function public.approve_opportunity_feedback_summary(uuid,text,text,bigint);
drop function public.revoke_opportunity_feedback_summary(uuid);
drop function public.job_workspace_summary_approval();
drop function public.job_workspace_summary_approval_cache();
drop function public.job_workspace_feedback_sharing();
drop table public.opportunity_feedback_summary_approvals;
drop function public.opportunity_feedback_inclusion(text,text,bigint);
alter table public.opportunity_reviews
  drop column search_feedback_summary,
  drop column search_feedback_summary_hash,
  drop column search_feedback_source_hash,
  drop column search_feedback_approved_at,
  drop column search_feedback_approved_summary_hash,
  drop column search_feedback_approved_source_hash;

do $$ begin
  if exists(select 1 from evaluation_migration_plan p full join public.opportunity_reviews r using(user_id,opportunity_id)
    where p.user_id is null or r.user_id is null or r.comment is distinct from p.evaluation or r.evaluation_revision is distinct from p.revision
      or(to_jsonb(r)-array['comment','evaluation_revision']) is distinct from p.unchanged) then
    raise exception 'Evaluation migration changed text or unrelated review data' using errcode='23514';end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and(p.prosrc~'search_feedback_(revision|summary_hash|source_hash|approved)|summary_approval'
      or p.prosrc~'(review|new|old|r)[.]search_feedback_summary')) then
    raise exception 'A runtime function still reads a retired review field' using errcode='23514';end if;
end $$;
alter table public.opportunity_reviews enable trigger opportunity_reviews_updated_at;
alter table public.opportunity_reviews enable trigger opportunity_reviews_feedback_invalidate;
-- Revalidate cached disclosures once against the current single-source proof.
update public.opportunity_search_feedback_snapshots set packet=packet;
update public.opportunity_search_adaptive_settings set feedback_dirty=true;
comment on column public.opportunity_reviews.comment is 'Complete owner evaluation. Only a safe derived first-600-character excerpt may enter feedback after search consent, unless excluded. No second editable summary is stored.';
comment on column public.opportunity_reviews.evaluation_revision is 'Server-maintained revision of the complete evaluation; independent of numeric interest and search-level consent revisions.';
notify pgrst,'reload schema';
commit;
