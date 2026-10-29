-- Per-search breadth, independently versioned from feedback consent and evidence.
-- Install after the complete AF-11 release. No data backfill, task edits or grants
-- to private helpers; existing opportunity/application records remain untouched.
begin;

alter table public.opportunity_search_adaptive_settings
  add column search_breadth_percent integer not null default 20
    check(search_breadth_percent between 0 and 100 and search_breadth_percent%5=0),
  add column breadth_revision bigint not null default 0 check(breadth_revision>=0);

-- Pure public instructions only; the no-argument v1 policy remains historical.
create function public.opportunity_search_adaptation_policy(p_search_breadth_percent integer) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare guidance text;
begin
  if p_search_breadth_percent is null or p_search_breadth_percent not between 0 and 100 or p_search_breadth_percent%5<>0 then
    raise exception 'Search breadth must be 0 to 100 percent in steps of 5' using errcode='22023';end if;
  guidance:=case when p_search_breadth_percent=0 then 'Do not generate exploration queries. Preserve the shared profile, protected core/manual queries and all hard criteria.'
    when p_search_breadth_percent<=20 then 'Explore underrepresented named interests, alternative terminology and new official sources. Research directions are alternatives, not cumulative requirements. Preserve the shared profile and all hard criteria; interests do not establish qualifications.'
    when p_search_breadth_percent<=50 then 'Explore interdisciplinary combinations and plausible adjacent research directions, different role titles and new official sources. Keep a clear connection to the shared research profile. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.'
    else 'Prioritize plausible adjacent fields, unusual research combinations and role titles, and unfamiliar institutions or official sources. Each exploration query must connect clearly to at least one shared research interest or method. Research directions are alternatives. Preserve all hard criteria; interests do not establish qualifications.' end;
  return jsonb_build_object('policy_version','adaptive-query-v2','minimum_observations',3,'positive_interest_threshold',6,
    'exploration_ratio',p_search_breadth_percent::numeric/100,'minimum_exploration_queries',case when p_search_breadth_percent=0 then 0 else 1 end,
    'maximum_queries',30,'exploration_guidance',guidance);
end;
$$;
revoke all on function public.opportunity_search_adaptation_policy(integer) from public,anon,service_role;
grant execute on function public.opportunity_search_adaptation_policy(integer) to authenticated;

create function public.job_workspace_breadth_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then new.breadth_revision:=case when new.search_breadth_percent=20 then 0 else 1 end;
  else
    new.breadth_revision:=old.breadth_revision+case when new.search_breadth_percent is distinct from old.search_breadth_percent then 1 else 0 end;
    if new.search_breadth_percent is distinct from old.search_breadth_percent then new.query_plan_dirty:=true;end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_breadth_settings() from public,anon,authenticated,service_role;
create trigger opportunity_breadth_settings before insert or update on public.opportunity_search_adaptive_settings
  for each row execute function public.job_workspace_breadth_settings();

-- Resolve only an exact current base/protocol anchor, never a stale history or
-- the dashboard's bounded displayed-query slice. Unknown capacity stays null.
create function public.opportunity_search_planning_capacity(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare base integer;protocol text;plan public.opportunity_search_query_plans;anchor jsonb;core_count integer;
begin
  if auth.uid() is distinct from p_user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Search unavailable' using errcode='42501';end if;
  select revision into base from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  if protocol is distinct from 'opportunity-search-v1-canonical-5' then return null;end if;
  select p.* into plan from public.opportunity_search_query_plans p join public.opportunity_search_adaptive_settings s on s.query_plan_id=p.id
    where s.user_id=p_user_id and s.search_id=p_search_id and p.user_id=p_user_id and p.search_id=p_search_id
      and p.base_revision=base and p.protocol_version=protocol;
  if found and jsonb_typeof(plan.document->'queries')='array' then
    select count(*) into core_count from jsonb_array_elements(plan.document->'queries') q where q->>'role'='core';
  else
    select queries into anchor from public.opportunity_search_query_revisions
      where user_id=p_user_id and search_id=p_search_id and template_revision=base and protocol_version=protocol;
    if found and jsonb_typeof(anchor)='array' then core_count:=jsonb_array_length(anchor);end if;
  end if;
  if core_count is null or core_count not between 1 and 30 then return null;end if;
  return jsonb_build_object('core_queries',core_count,'discretionary',greatest(0,30-core_count));
end;
$$;
revoke all on function public.opportunity_search_planning_capacity(uuid,uuid) from public,anon,service_role;
grant execute on function public.opportunity_search_planning_capacity(uuid,uuid) to authenticated;

-- All entry points, including direct owner action INSERTs, keep the same
-- revision guard and immutable derived receipts. Source anchors fail closed.
do $upgrade$
declare patch record;body text;updated text;
begin
  for patch in select * from (values
    ('public.opportunity_search_dashboard_settings(uuid,uuid)',$from$'consent_revision',coalesce(s.consent_revision,0)$from$,$to$'search_breadth_percent',coalesce(s.search_breadth_percent,20),'breadth_revision',coalesce(s.breadth_revision,0),'consent_revision',coalesce(s.consent_revision,0)$to$),
    ('public.job_workspace_dashboard_action()',$from$new.patch-array['structured_feedback_enabled','adaptation_enabled','adaptation_paused','successful_source_reuse_enabled','reuse_check_interval_hours']$from$,$to$new.patch-array['structured_feedback_enabled','adaptation_enabled','adaptation_paused','successful_source_reuse_enabled','reuse_check_interval_hours','search_breadth_percent']$to$),
    ('public.job_workspace_dashboard_action()',$from$if key<>'reuse_check_interval_hours' and$from$,$to$if key not in('reuse_check_interval_hours','search_breadth_percent') and$to$),
    ('public.job_workspace_dashboard_action()',$from$if new.patch?'structured_feedback_enabled' then expected_keys$from$,$to$if new.patch?'search_breadth_percent' and (jsonb_typeof(new.patch->'search_breadth_percent') is distinct from 'number'
      or(new.patch->>'search_breadth_percent')::numeric not between 0 and 100
      or(new.patch->>'search_breadth_percent')::numeric<>trunc((new.patch->>'search_breadth_percent')::numeric)
      or(new.patch->>'search_breadth_percent')::numeric%5<>0) then
      raise exception 'Search breadth must be 0 to 100 percent in steps of 5' using errcode='22023';end if;
    if new.patch?'search_breadth_percent' then expected_keys:=array_append(expected_keys,'breadth_revision');end if;
    if new.patch?'structured_feedback_enabled' then expected_keys$to$),
    ('public.job_workspace_dashboard_action()',$from$if new.patch?'structured_feedback_enabled' and(new.expected_revisions$from$,$to$if new.patch?'search_breadth_percent' and(new.expected_revisions->>'breadth_revision')::bigint<>s.breadth_revision
      or new.patch?'structured_feedback_enabled' and(new.expected_revisions$to$),
    ('public.job_workspace_dashboard_action()',$from$structured_feedback_enabled=coalesce((new.patch$from$,$to$search_breadth_percent=coalesce((new.patch->>'search_breadth_percent')::integer,search_breadth_percent),
      structured_feedback_enabled=coalesce((new.patch$to$),
    ('public.save_opportunity_search_adaptation(uuid,boolean,boolean,bigint)',$from$public.opportunity_search_adaptation_policy()$from$,$to$public.opportunity_search_adaptation_policy(saved.search_breadth_percent)$to$),
    ('public.read_opportunity_search_preferences(uuid)',$from$public.opportunity_search_adaptation_policy()$from$,$to$public.opportunity_search_adaptation_policy(coalesce(settings.search_breadth_percent,20))$to$),
    ('private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)',$from$public.opportunity_search_adaptation_policy()$from$,$to$public.opportunity_search_adaptation_policy(settings.search_breadth_percent)$to$),
    ('private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)',$from$perform private.validate_opportunity_search_plan(p_user_id,p_search_id,p_document);$from$,$to$perform private.validate_opportunity_search_plan(p_user_id,p_search_id,p_document);
  if not private.adaptive_plan_policy_valid(p_document,public.opportunity_search_adaptation_policy(settings.search_breadth_percent),
    settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused) then
    raise exception 'Actual query allocation violates the current policy' using errcode='22023';end if;$to$),
    ('private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)',$from$policy jsonb:=public.opportunity_search_adaptation_policy();$from$,$to$policy jsonb:=public.opportunity_search_adaptation_policy(coalesce((select search_breadth_percent from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id),20));$to$),
    ('public.read_opportunity_search_dashboard(uuid,text)',$from$policy jsonb:=public.opportunity_search_adaptation_policy();$from$,$to$policy jsonb:=public.opportunity_search_adaptation_policy(coalesce((select search_breadth_percent from public.opportunity_search_adaptive_settings where user_id=auth.uid() and search_id=p_search_id),20));$to$),
    ('public.read_opportunity_search_dashboard(uuid,text)',$from$'project_ref',p_project_ref,'settings',settings,'policy',policy,$from$,$to$'project_ref',p_project_ref,'settings',settings,'policy',policy,'planning_capacity',public.opportunity_search_planning_capacity(actor,p_search_id),$to$),
    ('private.adaptive_source_basis(uuid,uuid)',$from$jsonb_build_array(source_reuse_revision,adaptation_revision,consent_revision)$from$,$to$jsonb_build_array(source_reuse_revision,adaptation_revision,consent_revision,breadth_revision)$to$),
    ('private.pin_adaptive_batch_plan(uuid,jsonb,text)',$from$public.opportunity_search_adaptation_policy()=policy$from$,$to$public.opportunity_search_adaptation_policy(settings.search_breadth_percent)=policy$to$),
    ('private.opportunity_search_adaptive_shape(text,jsonb)',$from$begin
  keys:=case p_kind$from$,$to$begin
  if p_kind='policy' and p_value->>'policy_version'='adaptive-query-v2' then
    if not private.opportunity_search_adaptive_number(p_value->'exploration_ratio',0,1,false,false) then return false;end if;
    if (p_value->>'exploration_ratio')::numeric*100<>trunc((p_value->>'exploration_ratio')::numeric*100) then return false;end if;
    return p_value=public.opportunity_search_adaptation_policy(((p_value->>'exploration_ratio')::numeric*100)::integer);
  end if;
  keys:=case p_kind$to$)
  ) replacements(signature,before_text,after_text) loop
    body:=pg_get_functiondef(patch.signature::regprocedure);
    if position(patch.before_text in body)=0 then raise exception 'Search breadth prerequisite differs: %',patch.signature;end if;
    updated:=replace(body,patch.before_text,patch.after_text);execute updated;
  end loop;
end;
$upgrade$;

-- Historical v1 runs retain their original policy semantics. Newly pinned
-- v2 plans require a real discretionary slice; 0% means no exploration and
-- 100% means every discretionary query is exploration. Core capacity and all
-- mandatory source obligations remain protected independently.
create or replace function private.adaptive_plan_policy_valid(p_document jsonb,p_policy jsonb,p_active boolean) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare core_count integer;noncore_count integer;exploration_count integer;ratio numeric;
begin
  if jsonb_typeof(p_document->'queries') is distinct from 'array' then return false;end if;
  select count(*) filter(where q->>'role'='core'),count(*) filter(where q->>'role'<>'core'),count(*) filter(where q->>'role'='exploration')
    into core_count,noncore_count,exploration_count from jsonb_array_elements(p_document->'queries') q;
  if p_policy->>'policy_version'='adaptive-query-v1' then
    return coalesce(core_count>0 and jsonb_array_length(p_document->'queries')<=30 and(not p_active or core_count>=(p_policy->>'maximum_queries')::integer
      or exploration_count>=greatest((p_policy->>'minimum_exploration_queries')::integer,ceil(noncore_count*(p_policy->>'exploration_ratio')::numeric)::integer)),false);
  end if;
  if p_policy->>'policy_version' is distinct from 'adaptive-query-v2' then return false;end if;
  if not private.opportunity_search_adaptive_number(p_policy->'exploration_ratio',0,1,false,false) then return false;end if;
  ratio:=(p_policy->>'exploration_ratio')::numeric;
  if ratio*100<>trunc(ratio*100) or p_policy is distinct from public.opportunity_search_adaptation_policy((ratio*100)::integer) then return false;end if;
  return core_count>0 and jsonb_array_length(p_document->'queries')<=30
    and case when not p_active then noncore_count=0
      when core_count>=(p_policy->>'maximum_queries')::integer then noncore_count=0
      else noncore_count>0 and case when ratio=0 then exploration_count=0
        else exploration_count>=ceil(noncore_count*ratio)::integer end end;
exception when others then return false;
end;
$$;
revoke all on function private.adaptive_plan_policy_valid(jsonb,jsonb,boolean) from public,anon,authenticated,service_role;

commit;
