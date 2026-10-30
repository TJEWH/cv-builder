-- Feedback is included by default; one owner/opportunity exclusion is the only sharing switch.
-- Install once after opportunity_evaluation.sql. Historical migrations remain immutable.
-- Adaptation, pause, source reuse and runner/task authorization remain independent and unchanged.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('opportunity-search-catalogue-v1',0));
lock table public.opportunity_search_runs,public.opportunity_search_adaptive_settings,
  public.opportunity_search_feedback_snapshots,private.opportunity_search_adaptive_contexts in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.opportunity_search_runs where status='running') then
    raise exception 'Finish active opportunity searches before changing feedback defaults' using errcode='55000';end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_search_adaptive_settings' and column_name='structured_feedback_enabled')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_reviews' and column_name='evaluation_revision') then
    raise exception 'Feedback defaults require the preceding single-evaluation contract and must run once' using errcode='55000';end if;
end $$;

create temporary table feedback_default_invariants on commit drop as select
  (select md5(coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]')::text) from public.opportunity_reviews r) reviews,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text) from public.applications a) applications,
  (select md5(coalesce(jsonb_agg(to_jsonb(s)-array['structured_feedback_enabled','consent_revision','consent_updated_at','feedback_dirty','query_plan_dirty'] order by user_id,search_id),'[]')::text) from public.opportunity_search_adaptive_settings s) settings,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by user_id,search_id),'[]')::text) from public.opportunity_search_runner_authorizations a) runners;

-- Exact prerequisite fragments make this a guarded one-time definition upgrade,
-- never a runtime adapter or a best-effort fallback for unknown installations.
create temporary table feedback_default_definitions(signature text primary key,definition text not null) on commit drop;
create function pg_temp.feedback_default_replace(p_signature text,old_text text,new_text text,expected integer) returns void
language plpgsql set search_path='' as $$
declare definition text;
begin
  select d.definition into definition from feedback_default_definitions d where d.signature=p_signature;
  if not found then definition:=pg_get_functiondef(p_signature::regprocedure);end if;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>expected then
    raise exception 'Feedback-default prerequisite differs: %',p_signature using errcode='55000';end if;
  insert into feedback_default_definitions values(p_signature,replace(definition,old_text,new_text))
    on conflict(signature) do update set definition=excluded.definition;
end $$;

select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$settings.structured_feedback_enabled:=false;settings.consent_revision:=0;$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$  if settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused then
$patch$,$patch$  -- Feedback is included by default; adaptation controls only derived planning.
$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$    ) e where e.example is not null;
  end if;
$patch$,$patch$    ) e where e.example is not null;
$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$    'consent_revision',settings.consent_revision,'structured_feedback_enabled',settings.structured_feedback_enabled,
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$'consent_revision',settings.consent_revision,$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$approved:=case when settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused then preferences->'approved_preferences' else '[]'::jsonb end;$patch$,$patch$approved:=preferences->'approved_preferences';$patch$,1);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$'adaptation_paused',settings.adaptation_paused,'adaptation_revision',settings.adaptation_revision,$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_snapshot_redaction()',$patch$declare enabled boolean;live_consent_revision bigint;$patch$,$patch$declare scope_exists boolean;$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_snapshot_redaction()',$patch$  select structured_feedback_enabled,consent_revision into enabled,live_consent_revision from public.opportunity_search_adaptive_settings
    where user_id=old.user_id and search_id=old.search_id;$patch$,$patch$  select exists(select 1 from public.opportunity_search_adaptive_settings
    where user_id=old.user_id and search_id=old.search_id) into scope_exists;$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_snapshot_redaction()',$patch$if not coalesce(enabled,false) or new.redact_aggregates then$patch$,$patch$if not scope_exists or new.redact_aggregates then$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_snapshot_redaction()',$patch$coalesce((old.packet#>>'{counts,eligible}')::bigint,0)>0
      or coalesce((old.packet->>'consent_revision')::bigint,0) is distinct from live_consent_revision;$patch$,$patch$coalesce((old.packet#>>'{counts,eligible}')::bigint,0)>0;$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_adaptation_settings()',$patch$  -- Consent revocation must always succeed, including while adaptation is on.
  if not new.structured_feedback_enabled then new.adaptation_enabled:=false;end if;
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.save_opportunity_search_adaptation(uuid,boolean,boolean,bigint)',$patch$  if p_enabled and not saved.structured_feedback_enabled then raise exception 'Enable structured feedback consent before adaptation' using errcode='22023';end if;
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_feedback_invalidation()',$patch$  elsif tg_table_name='opportunity_search_adaptive_settings' then
    owner_id:=new.user_id;target_search:=new.search_id;
    semantic:=tg_op='INSERT' or new.structured_feedback_enabled is distinct from old.structured_feedback_enabled;
    privacy:=semantic and not new.structured_feedback_enabled;
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$'structured_feedback_enabled',$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$    if new.patch?'structured_feedback_enabled' then expected_keys:=array_append(expected_keys,'consent_revision');end if;
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$      or new.patch?'structured_feedback_enabled' and(new.expected_revisions->>'consent_revision')::bigint<>s.consent_revision
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$    if not coalesce((new.patch->>'structured_feedback_enabled')::boolean,s.structured_feedback_enabled)
      and(new.patch->'adaptation_enabled'='true'::jsonb or new.patch->'adaptation_paused'='false'::jsonb) then
      raise exception 'Enable structured feedback before adaptation' using errcode='22023';end if;
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$    -- One UPDATE avoids publishing intermediate consent/adaptation combinations.$patch$,$patch$    -- One UPDATE preserves a consistent adaptation/source policy.$patch$,1);
select pg_temp.feedback_default_replace('public.job_workspace_dashboard_action()',$patch$      structured_feedback_enabled=coalesce((new.patch->>'structured_feedback_enabled')::boolean,structured_feedback_enabled),
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.opportunity_search_dashboard_settings(uuid,uuid)',$patch$'structured_feedback_enabled',coalesce(s.structured_feedback_enabled,false),
    $patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('public.opportunity_search_dashboard_settings(uuid,uuid)',$patch$'consent_revision',coalesce(s.consent_revision,0),$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.adaptive_source_basis(uuid,uuid)',$patch$source_reuse_revision,adaptation_revision,consent_revision,breadth_revision$patch$,$patch$source_reuse_revision,adaptation_revision,breadth_revision$patch$,1);
select pg_temp.feedback_default_replace('private.begin_adaptive_opportunity_search(uuid,uuid)',$patch$    bundle:=jsonb_set(bundle,'{planning,consent_enabled}',to_jsonb(coalesce(settings.structured_feedback_enabled,false)));
$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.begin_adaptive_opportunity_search(uuid,uuid)',$patch$coalesce((bundle#>>'{feedback,counts,eligible}')::integer,0)>0 or $patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.refresh_adaptive_execution_scope(uuid)',$patch$coalesce((context.bundle#>>'{feedback,counts,eligible}')::integer,0)>0 or $patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)',$patch$'consent_enabled',settings.structured_feedback_enabled,$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.pin_opportunity_feedback_snapshot(uuid,uuid,uuid)',$patch$'consent_revision',0,$patch$,$patch$$patch$,1);
select pg_temp.feedback_default_replace('private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)',$patch$if settings.structured_feedback_enabled and settings.feedback_dirty then$patch$,$patch$if settings.feedback_dirty then$patch$,1);
select pg_temp.feedback_default_replace('private.retain_successful_opportunity_source(uuid,uuid,uuid,text,uuid)',$patch$or not settings.structured_feedback_enabled or not settings.successful_source_reuse_enabled$patch$,$patch$or not settings.successful_source_reuse_enabled$patch$,1);
select pg_temp.feedback_default_replace('private.begin_adaptive_opportunity_search(uuid,uuid)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.opportunity_search_adaptive_source_context(uuid,uuid,text[],jsonb)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.opportunity_search_adaptive_sources(uuid,uuid,jsonb,jsonb)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)',$patch$settings.adaptation_enabled and not settings.adaptation_paused and settings.structured_feedback_enabled$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.refresh_adaptive_execution_scope(uuid)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.validate_adaptive_proposals(jsonb,jsonb)',$patch$settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused$patch$,$patch$settings.adaptation_enabled and not settings.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('public.read_opportunity_search_dashboard(uuid,text)',$patch$s.adaptation_enabled and s.structured_feedback_enabled and not s.adaptation_paused$patch$,$patch$s.adaptation_enabled and not s.adaptation_paused$patch$,1);
select pg_temp.feedback_default_replace('private.opportunity_search_adaptive_shape(text,jsonb)',$patch$'consent_enabled',$patch$,$patch$$patch$,2);
select pg_temp.feedback_default_replace('private.opportunity_search_adaptive_shape(text,jsonb)',$patch$'consent_revision',$patch$,$patch$$patch$,2);
select pg_temp.feedback_default_replace('public.build_opportunity_search_feedback(uuid,uuid)',$patch$opportunity-feedback-selection-v1$patch$,$patch$opportunity-feedback-selection-v2$patch$,2);
select pg_temp.feedback_default_replace('private.opportunity_search_adaptive_shape(text,jsonb)',$patch$opportunity-feedback-selection-v1$patch$,$patch$opportunity-feedback-selection-v2$patch$,1);
select pg_temp.feedback_default_replace('private.pin_opportunity_feedback_snapshot(uuid,uuid,uuid)',$patch$opportunity-feedback-selection-v1$patch$,$patch$opportunity-feedback-selection-v2$patch$,1);

do $$ declare target record;begin
  for target in select definition from feedback_default_definitions order by signature loop execute target.definition;end loop;
end $$;

-- These capabilities only existed to mutate the retired search-level sharing choice.
drop trigger opportunity_feedback_consent on public.opportunity_search_adaptive_settings;
drop trigger settings_feedback_invalidate on public.opportunity_search_adaptive_settings;
drop trigger opportunity_adaptation_pause on public.opportunity_search_adaptive_settings;
drop function public.job_workspace_feedback_consent();
drop function public.job_workspace_adaptation_pause();
drop function public.read_opportunity_feedback_settings(uuid);
drop function public.set_opportunity_feedback_consent(uuid,boolean);
alter table public.opportunity_search_adaptive_settings
  drop column structured_feedback_enabled,drop column consent_revision,drop column consent_updated_at;

-- Migrate frozen packet/cache representation once. Keep every pinned audit identity
-- and original fingerprint; new compilations use the new policy in their hash input.
alter table public.opportunity_search_feedback_snapshots disable trigger opportunity_feedback_snapshot_redaction;
update public.opportunity_search_feedback_snapshots set packet=jsonb_set(packet-'consent_revision','{selection_policy_version}','"opportunity-feedback-selection-v2"');
alter table public.opportunity_search_feedback_snapshots enable trigger opportunity_feedback_snapshot_redaction;
update private.opportunity_search_adaptive_contexts set bundle=jsonb_set(
  jsonb_set(bundle,'{feedback}',jsonb_set((bundle->'feedback')-'consent_revision','{selection_policy_version}','"opportunity-feedback-selection-v2"')),
  '{planning}',(bundle->'planning')-'consent_enabled');
update private.opportunity_search_adaptive_contexts set bundle_hash=encode(sha256(convert_to(bundle::text,'UTF8')),'hex');
update public.opportunity_search_adaptive_settings set feedback_dirty=true,query_plan_dirty=true;

do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and p.prosrc~'structured_feedback_enabled|consent_revision|consent_updated_at|consent_enabled|opportunity-feedback-selection-v1') then
    raise exception 'Retired feedback opt-in remains in a current definition' using errcode='55000';end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]')::text) from public.opportunity_reviews r)<>(select reviews from feedback_default_invariants)
    or(select md5(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text) from public.applications a)<>(select applications from feedback_default_invariants)
    or(select md5(coalesce(jsonb_agg(to_jsonb(s)-array['feedback_dirty','query_plan_dirty'] order by user_id,search_id),'[]')::text) from public.opportunity_search_adaptive_settings s)<>(select settings from feedback_default_invariants)
    or(select md5(coalesce(jsonb_agg(to_jsonb(a) order by user_id,search_id),'[]')::text) from public.opportunity_search_runner_authorizations a)<>(select runners from feedback_default_invariants) then
    raise exception 'Feedback defaults changed personal data or independent control state' using errcode='55000';end if;
end $$;
notify pgrst,'reload schema';
commit;
