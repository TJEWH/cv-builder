-- Owner-controlled feedback inclusion and opportunity disposition.
-- Install after opportunity_search_breadth.sql. No catalogue backfill, task
-- operation, permission widening or institution-wide fit reward is performed.
begin;

alter table public.opportunity_reviews
  add column manually_archived boolean not null default false,
  add column technical_issue_category text check(technical_issue_category in('closed','requirements','application_problem','other')),
  add column technical_issue_note text check(char_length(technical_issue_note)<=1000);

alter table public.opportunity_search_adaptive_settings
  add column institution_sources_seeded boolean not null default false,
  add column institution_sources_omitted smallint not null default 0 check(institution_sources_omitted between 0 and 7);

-- These are private owner workflow facts, never a changed official deadline,
-- a personal-interest penalty or an inferred university-level preference.
comment on column public.opportunity_reviews.manually_archived is 'Owner-only past/current override. Does not modify catalogue availability, deadlines or interest.';
comment on column public.opportunity_reviews.technical_issue_note is 'Private technical context; never copied into research feedback or an interest score.';

-- The full evaluation remains stored privately. Only this bounded, safe excerpt
-- is eligible for feedback. Inspect the complete source before cutting it so a
-- boundary cannot hide a partial contact, credential or instruction.
create function public.opportunity_feedback_inclusion(p_comment text,p_summary text,p_revision bigint) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare evaluation text:=coalesce(p_comment,'');summary text:=coalesce(p_summary,'');source text;excerpt text;
begin
  source:=case when position(summary in evaluation)>0 then evaluation when position(evaluation in summary)>0 then summary else evaluation||E'\n\n'||summary end;
  if p_revision is null or p_revision<0 or not public.opportunity_feedback_preview_text(source,12000) then return null;end if;
  excerpt:=left(source,600);
  if not public.opportunity_feedback_preview_text(excerpt,600) then return null;end if;
  return jsonb_build_object('text',excerpt,'proof',jsonb_build_object('policy_version','included-unless-excluded-v1',
    'summary_hash',encode(sha256(convert_to(excerpt,'UTF8')),'hex'),'source_hash',encode(sha256(convert_to(source,'UTF8')),'hex'),
    'summary_revision',p_revision,'truncated',char_length(source)>600,'source_length',char_length(source)));
end;
$$;

-- Reviewed source configuration for this personal research workspace. A saved
-- listing is a place to inspect individual projects, never a fit endorsement.
create function public.opportunity_institution_source_configuration() returns jsonb
language sql immutable security invoker set search_path='' as $$
  select '[{"institution":"ETH Zurich","listing_url":"https://jobs.ethz.ch/"},
    {"institution":"Delft University of Technology","listing_url":"https://careers.tudelft.nl/"},
    {"institution":"Eindhoven University of Technology","listing_url":"https://tue.varbi.com/en/"},
    {"institution":"KTH Royal Institute of Technology","listing_url":"https://www.kth.se/lediga-jobb/"},
    {"institution":"Technical University of Denmark","listing_url":"https://www.dtu.dk/english/about/job-and-career/vacant-positions"},
    {"institution":"Aarhus University","listing_url":"https://international.au.dk/about/profile/vacant-positions"},
    {"institution":"University of Southampton","listing_url":"https://jobs.soton.ac.uk/"}]'::jsonb;
$$;
revoke all on function public.opportunity_institution_source_configuration() from public,anon,service_role;
grant execute on function public.opportunity_institution_source_configuration() to authenticated;

create function private.seed_opportunity_institution_sources(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.opportunity_search_adaptive_settings;source jsonb;total integer;retained integer;requested integer:=7;
begin
  if current_user<>'postgres' or not exists(select 1 from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id) then
    raise exception 'Management source configuration requires an authorized search' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':institution-sources',0));
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;
  if not settings.institution_sources_seeded then
    select count(*) into total from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id;
    for source in select value from jsonb_array_elements(public.opportunity_institution_source_configuration()) loop
      if exists(select 1 from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id and listing_url=source->>'listing_url') then continue;end if;
      if total>=64 then continue;end if;
      insert into public.opportunity_search_sources(user_id,search_id,listing_url,kind,institution,priority,enabled,pinned,mandatory,check_interval_hours,provenance,status)
        values(p_user_id,p_search_id,source->>'listing_url','university',source->>'institution',50,true,false,false,settings.reuse_check_interval_hours,'explicit','ready')
        on conflict(user_id,search_id,listing_url) where listing_url is not null do nothing;
      if found then total:=total+1;end if;
    end loop;
  end if;
  select count(*) into retained from public.opportunity_search_sources s
    join jsonb_array_elements(public.opportunity_institution_source_configuration()) configured on configured->>'listing_url'=s.listing_url
    where s.user_id=p_user_id and s.search_id=p_search_id;
  update public.opportunity_search_adaptive_settings set institution_sources_seeded=true,institution_sources_omitted=requested-retained
    where user_id=p_user_id and search_id=p_search_id;
  return jsonb_build_object('requested',requested,'retained',retained,'omitted',requested-retained);
end;
$$;
revoke all on function private.seed_opportunity_institution_sources(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.opportunity_feedback_inclusion(text,text,bigint) from public,anon,service_role;
grant execute on function public.opportunity_feedback_inclusion(text,text,bigint) to authenticated;

-- A new effective policy invalidates old university-reward query slices without
-- rewriting their historical plans or already pinned runs.
create or replace function public.opportunity_search_adaptation_policy(p_search_breadth_percent integer) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare guidance text;
begin
  if p_search_breadth_percent is null or p_search_breadth_percent not between 0 and 100 or p_search_breadth_percent%5<>0 then
    raise exception 'Search breadth must be 0 to 100 percent in steps of 5' using errcode='22023';end if;
  guidance:=case when p_search_breadth_percent=0 then 'Do not generate exploration queries. Preserve the shared profile, protected core/manual queries and all hard criteria.'
    when p_search_breadth_percent<=20 then 'Explore underrepresented named interests, alternative terminology and new official sources. Research directions are alternatives, not cumulative requirements. Preserve the shared profile and all hard criteria; interests do not establish qualifications.'
    when p_search_breadth_percent<=50 then 'Explore interdisciplinary combinations and plausible adjacent research directions, different role titles and new official sources. Keep a clear connection to the shared research profile. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.'
    else 'Prioritize plausible adjacent fields, unusual research combinations and role titles, and unfamiliar institutions or official sources. Each exploration query must connect clearly to at least one shared research interest or method. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.' end;
  return jsonb_build_object('policy_version','adaptive-query-v3','minimum_observations',3,'positive_interest_threshold',6,
    'exploration_ratio',p_search_breadth_percent::numeric/100,'minimum_exploration_queries',case when p_search_breadth_percent=0 then 0 else 1 end,
    'maximum_queries',30,'exploration_guidance',guidance,'institution_policy','source-only-v1',
    'institution_guidance','Retain institution listings as reusable sources only. Screen each project independently against the shared profile, funding, requirements and deadlines. Do not add an institution-wide fit bonus or infer qualifications from university-level outcomes.');
end;
$$;

do $upgrade$
declare patch record;body text;updated text;
begin
  for patch in select * from(values
    ('public.opportunity_search_dashboard_settings(uuid,uuid)',
      $from$'search_breadth_percent',coalesce(s.search_breadth_percent,20)$from$,
      $to$'institution_sources_omitted',coalesce(s.institution_sources_omitted,0),'search_breadth_percent',coalesce(s.search_breadth_percent,20)$to$),
    ('public.save_opportunity_feedback(uuid,jsonb)',
      $from$p_patch-array['interest_rating','interest_reasons','feedback_excluded','search_feedback_summary']$from$,
      $to$p_patch-array['interest_rating','interest_reasons','feedback_excluded','search_feedback_summary','manually_archived','technical_issue_category','technical_issue_note']$to$),
    ('public.save_opportunity_feedback(uuid,jsonb)',
      $from$  perform 1 from public.opportunities where id=p_opportunity_id;$from$,
      $to$  if p_patch?'manually_archived' and jsonb_typeof(p_patch->'manually_archived') is distinct from 'boolean' then
    raise exception 'Past override must be boolean' using errcode='22023';end if;
  if p_patch?'technical_issue_category' and p_patch->'technical_issue_category'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_category') is distinct from 'string' or p_patch->>'technical_issue_category' not in('closed','requirements','application_problem','other')) then
    raise exception 'Choose a supported technical issue category' using errcode='22023';end if;
  if p_patch?'technical_issue_note' and p_patch->'technical_issue_note'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_note') is distinct from 'string' or char_length(p_patch->>'technical_issue_note')>1000) then
    raise exception 'Technical notes must be at most 1000 characters' using errcode='22023';end if;
  perform 1 from public.opportunities where id=p_opportunity_id;$to$),
    ('public.save_opportunity_feedback(uuid,jsonb)',
      $from$    interest_rating=case when p_patch?'interest_rating'$from$,
      $to$    manually_archived=case when p_patch?'manually_archived' then (p_patch->>'manually_archived')::boolean else manually_archived end,
    technical_issue_category=case when p_patch?'technical_issue_category' then p_patch->>'technical_issue_category' else technical_issue_category end,
    technical_issue_note=case when p_patch?'technical_issue_note' then nullif(p_patch->>'technical_issue_note','') else technical_issue_note end,
    interest_rating=case when p_patch?'interest_rating'$to$),
    ('private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)',
      $from$      if untargeted then reason:='untargeted_reason';$from$,
      $to$      if key_row.category='institution' then reason:='source_only';provisional:=true;direction:='examples_only';
      elsif untargeted then reason:='untargeted_reason';$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$('approved_rule','supported_mean','sparse','contradictory','negative_requires_reason','untargeted_reason')$from$,
      $to$('approved_rule','supported_mean','sparse','contradictory','negative_requires_reason','untargeted_reason','source_only')$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$if p_kind='policy' and p_value->>'policy_version'='adaptive-query-v2' then$from$,
      $to$if p_kind='policy' and p_value->>'policy_version' in('adaptive-query-v2','adaptive-query-v3') then$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$return p_value=public.opportunity_search_adaptation_policy(((p_value->>'exploration_ratio')::numeric*100)::integer);$from$,
      $to$if p_value->>'policy_version'='adaptive-query-v2' then
      return p_value=jsonb_set(public.opportunity_search_adaptation_policy(((p_value->>'exploration_ratio')::numeric*100)::integer)-array['institution_policy','institution_guidance'],'{policy_version}','"adaptive-query-v2"');
    end if;
    return p_value=public.opportunity_search_adaptation_policy(((p_value->>'exploration_ratio')::numeric*100)::integer);$to$),
    ('private.adaptive_plan_policy_valid(jsonb,jsonb,boolean)',
      $from$if p_policy->>'policy_version' is distinct from 'adaptive-query-v2' then return false;end if;$from$,
      $to$if p_policy->>'policy_version' not in('adaptive-query-v2','adaptive-query-v3') or p_policy->>'policy_version' is null then return false;end if;$to$),
    ('private.adaptive_plan_policy_valid(jsonb,jsonb,boolean)',
      $from$p_policy is distinct from public.opportunity_search_adaptation_policy((ratio*100)::integer)$from$,
      $to$p_policy is distinct from (case when p_policy->>'policy_version'='adaptive-query-v2' then
    jsonb_set(public.opportunity_search_adaptation_policy((ratio*100)::integer)-array['institution_policy','institution_guidance'],'{policy_version}','"adaptive-query-v2"')
    else public.opportunity_search_adaptation_policy((ratio*100)::integer) end)$to$),
    ('public.project_opportunity_feedback_preview(uuid,uuid)',
      $from$topic text; reason jsonb; value text; approved_summary text;$from$,
      $to$topic text; reason jsonb; value text; approved_summary text; inclusion jsonb;$to$),
    ('public.project_opportunity_feedback_preview(uuid,uuid)',
      $from$  select r.state,r.interest_reasons,r.feedback_excluded,r.prediction_baseline,$from$,
      $to$  select r.state,r.interest_reasons,r.feedback_excluded,r.prediction_baseline,r.comment,r.manually_archived,r.technical_issue_category,$to$),
    ('public.project_opportunity_feedback_preview(uuid,uuid)',
      $from$  if review.search_feedback_approved_at is not null$from$,
      $to$  if false and review.search_feedback_approved_at is not null$to$),
    ('public.project_opportunity_feedback_preview(uuid,uuid)',
      $from$  -- Explicitly approved text and structured reasons remain useful without a$from$,
      $to$  inclusion:=public.opportunity_feedback_inclusion(review.comment,review.search_feedback_summary,review.search_feedback_revision);
  if inclusion is not null then
    approved_summary:=inclusion->>'text';
    result:=(result-'summary_approval')||jsonb_build_object('search_feedback_summary',approved_summary,'summary_inclusion',inclusion->'proof');
    withheld:=jsonb_set(withheld,'{unapproved_summary}','0'::jsonb);
  end if;
  if coalesce(review.manually_archived,false) then result:=result||jsonb_build_object('manually_archived',true);end if;
  if review.technical_issue_category is not null then result:=result||jsonb_build_object('technical_issue_category',review.technical_issue_category);end if;
  -- Structured quality outcomes and feedback remain useful without a$to$),
    ('public.project_opportunity_feedback_preview(uuid,uuid)',
      $from$and approved_summary is null then return null;$from$,
      $to$and approved_summary is null and not coalesce(review.manually_archived,false) and review.technical_issue_category is null then return null;$to$),
    ('public.build_opportunity_search_feedback(uuid,uuid)',
      $from$'selection_policy_version','opportunity-feedback-selection-v1','user_id',p_user_id$from$,
      $to$'selection_policy_version','opportunity-feedback-selection-v1','text_policy_version','included-unless-excluded-v1','source_policy_version','institutions-source-only-v1','user_id',p_user_id$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$redact_aggregate_context boolean:=false;$from$,
      $to$redact_aggregate_context boolean:=false; legacy_approval_only boolean:=false;$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$semantic:=(new.state,new.interest_rating,new.interest_reasons,new.feedback_excluded,new.prediction_baseline,$from$,
      $to$semantic:=(new.comment,new.search_feedback_summary,new.manually_archived,new.technical_issue_category) is distinct from
        (old.comment,old.search_feedback_summary,old.manually_archived,old.technical_issue_category) or (new.state,new.interest_rating,new.interest_reasons,new.feedback_excluded,new.prediction_baseline,$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$privacy:=new.feedback_excluded or (old.search_feedback_approved_at is not null and$from$,
      $to$legacy_approval_only:=(new.comment,new.search_feedback_summary,new.feedback_excluded) is not distinct from (old.comment,old.search_feedback_summary,old.feedback_excluded);
      privacy:=new.feedback_excluded or (new.comment,new.search_feedback_summary) is distinct from (old.comment,old.search_feedback_summary) or (old.search_feedback_approved_at is not null and$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$set packet=s.packet||'{"privacy_scope_changed":true}'::jsonb,$from$,
      $to$set packet=case when legacy_approval_only then s.packet else s.packet||'{"privacy_scope_changed":true}'::jsonb end,$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$semantic:=old.state<>'unreviewed'$from$,
      $to$semantic:=old.comment is not null or old.search_feedback_summary is not null or old.manually_archived or old.technical_issue_category is not null or old.state<>'unreviewed'$to$),
    ('public.job_workspace_feedback_invalidation()',
      $from$semantic:=new.state<>'unreviewed'$from$,
      $to$semantic:=new.comment is not null or new.search_feedback_summary is not null or new.manually_archived or new.technical_issue_category is not null or new.state<>'unreviewed'$to$),
    ('public.job_workspace_snapshot_redaction()',
      $from$    for item in select e.value from jsonb_array_elements(coalesce(old.packet->'examples','[]'::jsonb)) e loop$from$,
      $to$    for item in select e.value from jsonb_array_elements(coalesce(old.packet->'examples','[]'::jsonb)) e loop
      -- Older redaction left harmless proof metadata after withholding its text.
      -- Normalize it during a read/retry without restoring any disclosure.
      if not(item?'search_feedback_summary') and(item?'summary_approval' or item?'summary_inclusion') then
        item:=item-array['summary_approval','summary_inclusion'];changed:=true;
      end if;$to$),
    ('public.job_workspace_snapshot_redaction()',
      $from$select feedback_excluded,search_feedback_revision,search_feedback_approved_at,$from$,
      $to$select feedback_excluded,comment,search_feedback_summary,search_feedback_revision,search_feedback_approved_at,$to$),
    ('public.job_workspace_snapshot_redaction()',
      $from$      if item?'search_feedback_summary' then$from$,
      $to$      if item?'summary_inclusion' then
        proof:=public.opportunity_feedback_inclusion(review.comment,review.search_feedback_summary,review.search_feedback_revision);
        if proof is null or proof->'proof' is distinct from item->'summary_inclusion' or proof->>'text' is distinct from item->>'search_feedback_summary' then
          item:=item-array['search_feedback_summary','summary_inclusion'];changed:=true;
        end if;
      elsif item?'search_feedback_summary' then$to$),
    ('public.job_workspace_snapshot_redaction()',
      $from$item:=item-'search_feedback_summary'; changed:=true;$from$,
      $to$item:=item-array['search_feedback_summary','summary_approval']; changed:=true;$to$),
    ('private.begin_adaptive_opportunity_search(uuid,uuid)',
      $from$e-array['search_feedback_summary','summary_approval']$from$,
      $to$e-array['search_feedback_summary','summary_approval','summary_inclusion']$to$),
    ('private.begin_adaptive_opportunity_search(uuid,uuid)',
      $from$    select t.revision,t.criteria into template$from$,
      $to$    bundle:=jsonb_build_object('source_retention',private.seed_opportunity_institution_sources(runner_authorization.user_id,p_search_id));
    select t.revision,t.criteria into template$to$),
    ('private.begin_adaptive_opportunity_search(uuid,uuid)',
      $from$      'feedback',packet,'preferences',jsonb_build_object$from$,
      $to$      'source_retention',bundle->'source_retention','feedback',packet,'preferences',jsonb_build_object$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$'capabilities','execution_contract']$from$,
      $to$'capabilities','execution_contract','source_retention']$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$    when 'source_context_item' then array['registry_id','listing_url','provenance','pinned','mandatory']$from$,
      $to$    when 'source_context_item' then array['registry_id','listing_url','provenance','pinned','mandatory']
    when 'source_retention' then array['requested','retained','omitted']$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$required:=case p_kind when 'criteria'$from$,
      $to$required:=case p_kind when 'bundle' then array_remove(keys,'source_retention') when 'criteria'$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$      when p_kind='base' and entry.key='criteria' then 'criteria'$from$,
      $to$      when p_kind='bundle' and entry.key='source_retention' then 'source_retention'
      when p_kind='base' and entry.key='criteria' then 'criteria'$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$    if p_kind='counts' or p_kind='allocation'$from$,
      $to$    if p_kind='source_retention' then
      if not private.opportunity_search_adaptive_number(entry.value,0,7,true,false) then return false;end if;
    elsif p_kind='counts' or p_kind='allocation'$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$'reasons','search_feedback_summary','summary_approval']$from$,
      $to$'reasons','search_feedback_summary','summary_approval','summary_inclusion','manually_archived','technical_issue_category']$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$    when 'summary_approval' then array['summary_hash','source_hash','summary_revision','approved_at']$from$,
      $to$    when 'summary_approval' then array['summary_hash','source_hash','summary_revision','approved_at']
    when 'summary_inclusion' then array['policy_version','summary_hash','source_hash','summary_revision','truncated','source_length']$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$      when p_kind='example' and entry.key='summary_approval' then 'summary_approval'$from$,
      $to$      when p_kind='example' and entry.key='summary_inclusion' then 'summary_inclusion'
      when p_kind='example' and entry.key='summary_approval' then 'summary_approval'$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$if entry.key='policy_version' and entry.value#>>'{}'<>'adaptive-query-v1' then return false;end if;$from$,
      $to$if entry.key='policy_version' and entry.value#>>'{}'<>(case when p_kind='summary_inclusion' then 'included-unless-excluded-v1' else 'adaptive-query-v1' end) then return false;end if;
      if entry.key='technical_issue_category' and entry.value#>>'{}' not in('closed','requirements','application_problem','other') then return false;end if;$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$'observations','summary_revision')$from$,
      $to$'observations','summary_revision','source_length')$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$'confirmed_submission','provisional')$from$,
      $to$'confirmed_submission','provisional','manually_archived','truncated')$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',
      $from$  if p_kind='example' and p_value?'search_feedback_summary' and encode(sha256(convert_to(p_value->>'search_feedback_summary','UTF8')),'hex') is distinct from p_value#>>'{summary_approval,summary_hash}' then return false;end if;$from$,
      $to$  if p_kind='summary_inclusion' and((p_value->>'source_length')::integer not between 1 and 12000
    or(p_value->>'truncated')::boolean is distinct from((p_value->>'source_length')::integer>600)) then return false;end if;
  if p_kind='source_retention' and(p_value->'requested'<>'7'::jsonb or(p_value->>'retained')::integer+(p_value->>'omitted')::integer<>7) then return false;end if;
  if p_kind='example' and p_value?'summary_inclusion' and p_value?'summary_approval' then return false;end if;
  if p_kind='example' and p_value?'summary_inclusion' and char_length(p_value->>'search_feedback_summary') is distinct from least(600,(p_value#>>'{summary_inclusion,source_length}')::integer) then return false;end if;
  if p_kind='example' and p_value?'search_feedback_summary' then
    if not(p_value?'summary_inclusion' or p_value?'summary_approval') then return false;end if;
    if encode(sha256(convert_to(p_value->>'search_feedback_summary','UTF8')),'hex') is distinct from coalesce(p_value#>>'{summary_inclusion,summary_hash}',p_value#>>'{summary_approval,summary_hash}') then return false;end if;
  elsif p_kind='example' and(p_value?'summary_inclusion' or p_value?'summary_approval') then return false;end if;$to$)
  ) replacements(signature,before_text,after_text) loop
    body:=pg_get_functiondef(patch.signature::regprocedure);
    if position(patch.before_text in body)=0 then raise exception 'Feedback inclusion prerequisite differs: %',patch.signature;end if;
    updated:=replace(body,patch.before_text,patch.after_text);execute updated;
  end loop;
end;
$upgrade$;

-- Current default sharing has no approval branch. Historical approval records
-- and pinned packet proofs stay available to their original read/redaction path.
do $$declare body text;start_at integer;end_at integer;begin
  body:=pg_get_functiondef('public.project_opportunity_feedback_preview(uuid,uuid)'::regprocedure);
  start_at:=position('  if false and review.search_feedback_approved_at is not null' in body);
  end_at:=position('  inclusion:=public.opportunity_feedback_inclusion' in body);
  if start_at=0 or end_at<=start_at then raise exception 'Default feedback projection prerequisite differs';end if;
  execute substr(body,1,start_at-1)||substr(body,end_at);
end $$;

commit;
