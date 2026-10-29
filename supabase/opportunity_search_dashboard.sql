-- AF-10 owner dashboard and independent compare-and-set controls.
-- Install after opportunity_search_feedback_preview.sql and adaptive_setup.sql.
-- Owner invokers only; no scheduler operation, base edit, private grant or backfill.
begin;

create function public.opportunity_search_dashboard_source(p_source public.opportunity_search_sources) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('registry_id',p_source.registry_id,
    'listing_url',public.opportunity_search_source_url(p_source.listing_url),'vacancy_url',public.opportunity_search_source_url(p_source.vacancy_url),
    'kind',p_source.kind,'institution',case when public.opportunity_search_public_text(p_source.institution,200) then p_source.institution end,
    'topics',coalesce((select jsonb_agg(t order by n) from unnest(p_source.topics) with ordinality v(t,n)
      where n<=16 and public.opportunity_search_public_text(t,120)),'[]'),
    'priority',p_source.priority,'enabled',p_source.enabled,'pinned',p_source.pinned,'mandatory',p_source.mandatory,
    'check_interval_hours',p_source.check_interval_hours,'last_attempted_at',p_source.last_attempted_at,'last_successful_at',p_source.last_successful_at,
    'status',p_source.status,'owner_disabled',p_source.owner_disabled,'provenance',p_source.provenance,
    'listing_verified_at',p_source.listing_verified_at,'source_revision',p_source.source_revision)
$$;
create function public.opportunity_search_dashboard_settings(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.opportunity_search_adaptive_settings;document jsonb;
begin
  if auth.uid() is distinct from p_user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not exists(select 1 from public.opportunity_search_templates where id=p_search_id and user_id=p_user_id) then
    raise exception 'Search unavailable' using errcode='42501';end if;
  select * into s from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  document:=public.opportunity_search_preference_document(p_user_id,p_search_id);
  return jsonb_build_object('structured_feedback_enabled',coalesce(s.structured_feedback_enabled,false),
    'adaptation_enabled',coalesce(s.adaptation_enabled,false),'adaptation_paused',coalesce(s.adaptation_paused,false),
    'successful_source_reuse_enabled',coalesce(s.successful_source_reuse_enabled,false),'reuse_check_interval_hours',coalesce(s.reuse_check_interval_hours,168),
    'consent_revision',coalesce(s.consent_revision,0),'adaptation_revision',coalesce(s.adaptation_revision,0),
    'source_reuse_revision',coalesce(s.source_reuse_revision,0),'feedback_revision',coalesce(s.feedback_revision,0),
    'preference_revision',(document->>'preference_revision')::bigint,'query_plan_revision',coalesce(s.query_plan_revision,0),'query_plan_dirty',coalesce(s.query_plan_dirty,true));
end;
$$;
-- Query text is technical public research intent, not a free-form feedback note.
-- Validate URL spans separately; never weaken the shared feedback text boundary.
create function public.opportunity_search_dashboard_query(p_text text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare rest text:=p_text;url text;
begin
  if p_text is null or char_length(p_text) not between 1 and 2000 or p_text~'[[:cntrl:]]'
    or p_text~*'CV Harness meta-search context v1|"(contacts|supervisors|professionalContext|profiles|legacySearchArchive|systemPrompt|editor)"[[:space:]]*:' then return null;end if;
  for url in select m[1] from regexp_matches(p_text,'(https?://[^[:space:]<>"'']+)','gi') m loop
    if public.opportunity_search_source_url(url) is null then return null;end if;
    rest:=replace(rest,url,' public-source ');
  end loop;
  if not public.opportunity_search_public_text(rest,2000) then return null;end if;
  return p_text;
end;
$$;
revoke all on function public.opportunity_search_dashboard_source(public.opportunity_search_sources),public.opportunity_search_dashboard_settings(uuid,uuid),public.opportunity_search_dashboard_query(text) from public,anon,service_role;
grant execute on function public.opportunity_search_dashboard_source(public.opportunity_search_sources),public.opportunity_search_dashboard_settings(uuid,uuid),public.opportunity_search_dashboard_query(text) to authenticated;

-- Immutable owner-scoped action receipts are executable through the same guard
-- for RPC and direct INSERT. Supplied results are discarded, never trusted.
create table public.opportunity_search_dashboard_actions (
  user_id uuid not null,search_id uuid not null,action_id uuid not null,
  kind text not null check(kind in('settings','source')),registry_id uuid,
  patch jsonb not null,expected_revisions jsonb not null,result jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,search_id,action_id),
  foreign key(user_id,search_id) references public.opportunity_search_templates(user_id,id) on delete cascade,
  check(octet_length(patch::text)<=8192 and octet_length(expected_revisions::text)<=1024 and octet_length(result::text)<=32768)
);
alter table public.opportunity_search_dashboard_actions enable row level security;
revoke all on public.opportunity_search_dashboard_actions from public,anon,authenticated,service_role;
grant select,insert on public.opportunity_search_dashboard_actions to authenticated;
create policy "Owner adaptive control actions" on public.opportunity_search_dashboard_actions for all to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.job_workspace_dashboard_action() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.opportunity_search_adaptive_settings;source_row public.opportunity_search_sources;key text;expected_keys text[]:='{}';expected_source bigint;
begin
  if tg_op<>'INSERT' then raise exception 'Control receipts are immutable' using errcode='23514';end if;
  if auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Search unavailable' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  if jsonb_typeof(new.patch) is distinct from 'object' or new.patch='{}'::jsonb or octet_length(new.patch::text)>8192
    or jsonb_typeof(new.expected_revisions) is distinct from 'object' then raise exception 'Invalid control patch' using errcode='22023';end if;
  if new.kind='settings' then
    if new.registry_id is not null or new.patch-array['structured_feedback_enabled','adaptation_enabled','adaptation_paused','successful_source_reuse_enabled','reuse_check_interval_hours']<>'{}'::jsonb then
      raise exception 'Invalid settings patch' using errcode='22023';end if;
    for key in select jsonb_object_keys(new.patch) loop
      if key<>'reuse_check_interval_hours' and jsonb_typeof(new.patch->key) is distinct from 'boolean' then raise exception 'Explicit boolean settings required' using errcode='22023';end if;
    end loop;
    if new.patch?'reuse_check_interval_hours' and (jsonb_typeof(new.patch->'reuse_check_interval_hours') is distinct from 'number'
      or(new.patch->>'reuse_check_interval_hours')::numeric not between 24 and 720
      or(new.patch->>'reuse_check_interval_hours')::numeric<>trunc((new.patch->>'reuse_check_interval_hours')::numeric)) then
      raise exception 'Cadence must be 24 to 720 hours' using errcode='22023';end if;
    if new.patch?'structured_feedback_enabled' then expected_keys:=array_append(expected_keys,'consent_revision');end if;
    if new.patch?|array['adaptation_enabled','adaptation_paused'] then expected_keys:=array_append(expected_keys,'adaptation_revision');end if;
    if new.patch?|array['successful_source_reuse_enabled','reuse_check_interval_hours'] then expected_keys:=array_append(expected_keys,'source_reuse_revision');end if;
    if new.expected_revisions-expected_keys<>'{}'::jsonb or not(new.expected_revisions?&expected_keys) then raise exception 'Use only touched setting revisions' using errcode='22023';end if;
    foreach key in array expected_keys loop
      if jsonb_typeof(new.expected_revisions->key) is distinct from 'number' or new.expected_revisions->>key!~'^[0-9]{1,18}$' then
        raise exception 'Expected revisions must be nonnegative integers' using errcode='22023';end if;
    end loop;
    insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(new.user_id,new.search_id) on conflict(user_id,search_id) do nothing;
    select * into s from public.opportunity_search_adaptive_settings where user_id=new.user_id and search_id=new.search_id for update;
    if new.patch?'structured_feedback_enabled' and(new.expected_revisions->>'consent_revision')::bigint<>s.consent_revision
      or new.patch?|array['adaptation_enabled','adaptation_paused'] and(new.expected_revisions->>'adaptation_revision')::bigint<>s.adaptation_revision
      or new.patch?|array['successful_source_reuse_enabled','reuse_check_interval_hours'] and(new.expected_revisions->>'source_reuse_revision')::bigint<>s.source_reuse_revision then
      raise exception 'Settings changed; reload the current revision' using errcode='40001';end if;
    if not coalesce((new.patch->>'structured_feedback_enabled')::boolean,s.structured_feedback_enabled)
      and(new.patch->'adaptation_enabled'='true'::jsonb or new.patch->'adaptation_paused'='false'::jsonb) then
      raise exception 'Enable structured feedback before adaptation' using errcode='22023';end if;
    -- One UPDATE avoids publishing intermediate consent/adaptation combinations.
    update public.opportunity_search_adaptive_settings set
      structured_feedback_enabled=coalesce((new.patch->>'structured_feedback_enabled')::boolean,structured_feedback_enabled),
      adaptation_enabled=coalesce((new.patch->>'adaptation_enabled')::boolean,adaptation_enabled),
      adaptation_paused=coalesce((new.patch->>'adaptation_paused')::boolean,adaptation_paused),
      successful_source_reuse_enabled=coalesce((new.patch->>'successful_source_reuse_enabled')::boolean,successful_source_reuse_enabled),
      reuse_check_interval_hours=coalesce((new.patch->>'reuse_check_interval_hours')::integer,reuse_check_interval_hours)
      where user_id=new.user_id and search_id=new.search_id;
    new.result:=jsonb_build_object('dashboard_version',1,'action_id',new.action_id,'search_id',new.search_id,'kind','settings',
      'settings',public.opportunity_search_dashboard_settings(new.user_id,new.search_id));
  elsif new.kind='source' then
    if new.registry_id is null or new.expected_revisions-array['source_revision']<>'{}'::jsonb
      or jsonb_typeof(new.expected_revisions->'source_revision') is distinct from 'number'
      or new.expected_revisions->>'source_revision'!~'^[0-9]{1,18}$' then raise exception 'Expected source revision required' using errcode='22023';end if;
    expected_source:=(new.expected_revisions->>'source_revision')::bigint;
    select * into source_row from public.opportunity_search_sources where registry_id=new.registry_id and user_id=new.user_id and search_id=new.search_id for update;
    if coalesce(source_row.source_revision,0)<>expected_source then raise exception 'Source changed; reload its current revision' using errcode='40001';end if;
    perform public.save_opportunity_search_source(new.search_id,new.registry_id,new.patch);
    select * into source_row from public.opportunity_search_sources where registry_id=new.registry_id and user_id=new.user_id and search_id=new.search_id;
    new.result:=jsonb_build_object('dashboard_version',1,'action_id',new.action_id,'search_id',new.search_id,'kind','source','source',public.opportunity_search_dashboard_source(source_row));
  else raise exception 'Invalid control action' using errcode='22023';end if;
  new.created_at:=clock_timestamp();return new;
end;
$$;
revoke all on function public.job_workspace_dashboard_action() from public,anon,authenticated,service_role;
create trigger opportunity_dashboard_action_guard before insert or update on public.opportunity_search_dashboard_actions for each row execute function public.job_workspace_dashboard_action();

create function public.patch_opportunity_search_settings(p_search_id uuid,p_action_id uuid,p_patch jsonb,p_expected_revisions jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_dashboard_actions;
begin
  if actor is null or p_action_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Search unavailable' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  select * into saved from public.opportunity_search_dashboard_actions where user_id=actor and search_id=p_search_id and action_id=p_action_id;
  if found then
    if(saved.kind,saved.patch,saved.expected_revisions) is distinct from('settings',p_patch,p_expected_revisions) then raise exception 'Action identity has different contents' using errcode='40001';end if;
  else
    insert into public.opportunity_search_dashboard_actions(user_id,search_id,action_id,kind,patch,expected_revisions)
      values(actor,p_search_id,p_action_id,'settings',p_patch,p_expected_revisions) returning * into saved;
  end if;
  return saved.result;
end;
$$;
create function public.patch_opportunity_search_source(p_search_id uuid,p_registry_id uuid,p_action_id uuid,p_patch jsonb,p_expected_source_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_dashboard_actions;expected jsonb:=jsonb_build_object('source_revision',p_expected_source_revision);
begin
  if actor is null or p_action_id is null or p_registry_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Search unavailable' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  select * into saved from public.opportunity_search_dashboard_actions where user_id=actor and search_id=p_search_id and action_id=p_action_id;
  if found then
    if(saved.kind,saved.registry_id,saved.patch,saved.expected_revisions) is distinct from('source',p_registry_id,p_patch,expected) then raise exception 'Action identity has different contents' using errcode='40001';end if;
  else
    insert into public.opportunity_search_dashboard_actions(user_id,search_id,action_id,kind,registry_id,patch,expected_revisions)
      values(actor,p_search_id,p_action_id,'source',p_registry_id,p_patch,expected) returning * into saved;
  end if;
  return saved.result;
end;
$$;
revoke all on function public.patch_opportunity_search_settings(uuid,uuid,jsonb,jsonb),public.patch_opportunity_search_source(uuid,uuid,uuid,jsonb,bigint) from public,anon,service_role;
grant execute on function public.patch_opportunity_search_settings(uuid,uuid,jsonb,jsonb),public.patch_opportunity_search_source(uuid,uuid,uuid,jsonb,bigint) to authenticated;

create function public.opportunity_search_dashboard_number(p_value jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then return null;end if;
  n:=(p_value#>>'{}')::numeric;return case when abs(n)<=10000000 then n end;
end;
$$;
revoke all on function public.opportunity_search_dashboard_number(jsonb) from public,anon,service_role;
grant execute on function public.opportunity_search_dashboard_number(jsonb) to authenticated;

-- Compute the displayed source cohort directly. The separately bounded quality
-- group list must not turn an omitted group into a fabricated zero-size sample.
create function public.opportunity_search_dashboard_outcomes(p_search_id uuid,p_registry_id uuid,p_query_id uuid default null,p_text_hash text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(
    select 1 from public.opportunity_search_templates where user_id=auth.uid() and id=p_search_id) then raise exception 'Search unavailable' using errcode='42501';end if;
  if(p_registry_id is null)=(p_query_id is null) or p_query_id is not null and(p_text_hash is null or p_text_hash!~'^[0-9a-f]{64}$') then
    raise exception 'Choose one source or exact query identity' using errcode='22023';end if;
  with cohort as (
    select distinct d.opportunity_id from public.opportunity_search_discoveries d
      join public.opportunity_search_executions e on e.run_id=d.run_id and e.check_id=any(d.execution_refs)
      where d.user_id=auth.uid() and d.search_id=p_search_id and d.verified_at is not null
        and e.user_id=auth.uid() and(p_registry_id is not null and e.source_registry_id=p_registry_id
          or p_query_id is not null and e.query_id=p_query_id and e.text_hash=p_text_hash)
        and e.status in('complete','partial','paginated','dynamic') and(e.results_count is null or e.results_count>0)
  ), bits as (
    select c.opportunity_id,coalesce(r.state,'unreviewed') state,r.interest_rating,coalesce(r.feedback_excluded,false) excluded,
      coalesce(isfinite(a.submitted_at),false) or coalesce(a.status='submitted',false)
        or exists(select 1 from jsonb_array_elements(coalesce(a.status_history,'[]')) h where h->>'status'='submitted') submitted
      from cohort c left join public.opportunity_reviews r on r.opportunity_id=c.opportunity_id and r.user_id=auth.uid()
      left join public.applications a on a.opportunity_id=c.opportunity_id and a.user_id=auth.uid()
  ), scores as (
    select b.*,case when b.excluded then null when b.interest_rating is not null then b.interest_rating
      when b.state='strong_interest' then 8 when b.state='interested' then 6 when b.state='not_interested' then 2 when b.submitted then 9 end score from bits b
  ) select jsonb_build_object('sample_size',count(*),'reviewed',count(*) filter(where not excluded and(interest_rating is not null or state<>'unreviewed')),
    'with_interest',count(score),'mean_interest',round(avg(score),6),
    'explicit_high_interest',count(*) filter(where not excluded and(interest_rating is not null or state<>'unreviewed') and score>=8),
    'confirmed_submissions',count(*) filter(where not excluded and submitted)) into result from scores;
  return result;
end;
$$;
revoke all on function public.opportunity_search_dashboard_outcomes(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.opportunity_search_dashboard_outcomes(uuid,uuid,uuid,text) to authenticated;

create function public.read_opportunity_search_dashboard(p_search_id uuid,p_project_ref text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();s public.opportunity_search_adaptive_settings;grant_row public.opportunity_search_runner_authorizations;
  registry public.opportunity_search_sources;plan public.opportunity_search_query_plans;entry jsonb;rule jsonb;safe_rule jsonb;row_value jsonb;
  settings jsonb;preferences jsonb;preview jsonb;result jsonb;safe_plan jsonb;policy jsonb:=public.opportunity_search_adaptation_policy();
  sources jsonb:='[]';suggestions jsonb:='[]';proposals jsonb:='[]';queries jsonb:='[]';executions jsonb;runs jsonb;
  coverage jsonb;proposal_row record;latest record;
  source_total integer;query_total integer:=0;execution_total integer;run_total integer;proposal_total integer;suggestion_total integer;
  withheld integer:=0;safe_query text;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(
    select 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id) then raise exception 'Search unavailable' using errcode='42501';end if;
  if p_project_ref is null or p_project_ref!~'^[a-z0-9]{20}$' then raise exception 'Exact configured project required' using errcode='22023';end if;
  settings:=public.opportunity_search_dashboard_settings(actor,p_search_id);
  preferences:=public.read_opportunity_search_preferences(p_search_id);
  preview:=public.preview_opportunity_search_feedback(p_search_id);
  if octet_length(preview::text)>65536 then raise exception 'Feedback preview exceeds its bound' using errcode='54000';end if;
  select * into s from public.opportunity_search_adaptive_settings where user_id=actor and search_id=p_search_id;
  select * into grant_row from public.opportunity_search_runner_authorizations where user_id=actor and search_id=p_search_id;
  if grant_row.project_ref is not null and grant_row.project_ref<>p_project_ref then raise exception 'Exact configured project required' using errcode='22023';end if;
  select count(*) into source_total from public.opportunity_search_sources where user_id=actor and search_id=p_search_id;
  for registry in select r.registry_id,r.user_id,r.search_id,r.listing_url,r.vacancy_url,r.kind,r.institution,r.topics,r.priority,r.enabled,r.pinned,r.mandatory,
    r.check_interval_hours,r.last_attempted_at,r.last_successful_at,r.status,r.owner_disabled,r.provenance,r.listing_verified_at,r.source_revision,r.created_at,r.updated_at
    from public.opportunity_search_sources r where r.user_id=actor and r.search_id=p_search_id
    order by r.pinned desc,r.mandatory desc,r.priority desc,r.registry_id limit 64 loop
    row_value:=public.opportunity_search_dashboard_source(registry);
    withheld:=withheld+case when registry.listing_url is not null and row_value->'listing_url'='null'::jsonb then 1 else 0 end
      +case when registry.vacancy_url is not null and row_value->'vacancy_url'='null'::jsonb then 1 else 0 end
      +case when registry.institution is not null and row_value->'institution'='null'::jsonb then 1 else 0 end
      +cardinality(registry.topics)-jsonb_array_length(row_value->'topics');
    select e.status,e.failure_reason,e.attempted_at into latest from public.opportunity_search_executions e
      where e.user_id=actor and e.search_id=p_search_id and e.source_registry_id=registry.registry_id order by e.attempted_at desc,e.check_id desc limit 1;
    coverage:=jsonb_build_object('last_status',latest.status,'last_failure_reason',latest.failure_reason,'last_attempted_at',latest.attempted_at);
    sources:=sources||jsonb_build_array(row_value||jsonb_build_object('coverage',coverage,
      'outcomes',public.opportunity_search_dashboard_outcomes(p_search_id,registry.registry_id)));
  end loop;
  for entry in select value from jsonb_array_elements(preferences->'suggestions') loop
    begin safe_rule:=public.opportunity_search_validate_preference_rule(actor,p_search_id,entry->'rule',false);
    exception when invalid_parameter_value or insufficient_privilege then safe_rule:=null;end;
    if safe_rule is null then withheld:=withheld+1;continue;end if;
    suggestions:=suggestions||jsonb_build_array(jsonb_build_object('suggestion_id',entry->'suggestion_id','rule',safe_rule,
      'origin',entry->'origin','created_at',entry->'created_at','state',entry->'state','decided_at',entry->'decided_at'));
  end loop;
  -- Reconstruct approved rules as well: never pass through an arbitrary JSON
  -- document merely because an older writer stored it in a public table.
  rule:='[]';
  for entry in select value from jsonb_array_elements(preferences->'approved_rules') loop
    begin safe_rule:=public.opportunity_search_validate_preference_rule(actor,p_search_id,entry,false);
    exception when invalid_parameter_value or insufficient_privilege then safe_rule:=null;end;
    if safe_rule is null then withheld:=withheld+1;else rule:=rule||jsonb_build_array(safe_rule);end if;
  end loop;
  suggestion_total:=jsonb_array_length(preferences->'suggestions')+coalesce((preferences->>'omitted_suggestions')::integer,0);
  select count(*) into proposal_total from public.opportunity_search_adaptive_proposals where user_id=actor and search_id=p_search_id;
  for proposal_row in select p.suggestion_id,p.kind,p.status,p.reason,p.created_at,p.evidence_refs,
    case when jsonb_typeof(p.proposal->'listing_url')='string' then p.proposal->>'listing_url' end listing_url,
    case when jsonb_typeof(p.proposal->'vacancy_url')='string' then p.proposal->>'vacancy_url' end vacancy_url,
    case when jsonb_typeof(p.proposal->'query')='string' then p.proposal->>'query' end query_text from public.opportunity_search_adaptive_proposals p
    where p.user_id=actor and p.search_id=p_search_id order by p.created_at desc,p.suggestion_id limit 32 loop
    proposals:=proposals||jsonb_build_array(jsonb_build_object('suggestion_id',proposal_row.suggestion_id,'kind',proposal_row.kind,
      'state',proposal_row.status,'reason',proposal_row.reason,'created_at',proposal_row.created_at,'evidence_refs',to_jsonb(proposal_row.evidence_refs),
      'listing_url',public.opportunity_search_source_url(proposal_row.listing_url),'vacancy_url',public.opportunity_search_source_url(proposal_row.vacancy_url),'query',public.opportunity_search_dashboard_query(proposal_row.query_text)));
    if proposal_row.listing_url is not null and public.opportunity_search_source_url(proposal_row.listing_url) is null
      or proposal_row.vacancy_url is not null and public.opportunity_search_source_url(proposal_row.vacancy_url) is null
      or proposal_row.query_text is not null and public.opportunity_search_dashboard_query(proposal_row.query_text) is null then withheld:=withheld+1;end if;
  end loop;
  select * into plan from public.opportunity_search_query_plans p where p.id=s.query_plan_id and p.user_id=actor and p.search_id=p_search_id;
  if found then
    for entry in select value from jsonb_array_elements(case when jsonb_typeof(plan.document->'queries')='array' then plan.document->'queries' else '[]'::jsonb end) loop
      query_total:=query_total+1;
      if query_total>30 then continue;end if;
      if jsonb_typeof(entry) is distinct from 'object' or not(entry?&array['query_id','query','text_hash','role','manual'])
        or jsonb_typeof(entry->'query_id') is distinct from 'string' or entry->>'query_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(entry->'text_hash') is distinct from 'string' or entry->>'text_hash'!~'^[0-9a-f]{64}$'
        or jsonb_typeof(entry->'role') is distinct from 'string' or entry->>'role' not in('core','adaptive','exploration')
        or jsonb_typeof(entry->'query') is distinct from 'string' or jsonb_typeof(entry->'manual') is distinct from 'boolean'
        or entry->'manual'='true'::jsonb and entry->>'role'<>'core' then withheld:=withheld+1;continue;end if;
      safe_query:=public.opportunity_search_dashboard_query(entry->>'query');
      if entry->>'role'<>'core' and(not coalesce(s.adaptation_enabled and s.structured_feedback_enabled and not s.adaptation_paused,false)
        or plan.feedback_revision is distinct from (preview->>'feedback_revision')::bigint
        or plan.preference_revision is distinct from (preferences->>'preference_revision')::bigint) then safe_query:=null;end if;
      if safe_query is null then withheld:=withheld+1;end if;
      queries:=queries||jsonb_build_array(jsonb_build_object('query_id',entry->'query_id','query',safe_query,'text_hash',entry->'text_hash','role',entry->'role',
        'manual',entry->'manual','source_registry_id',case when entry->>'source_registry_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then entry->'source_registry_id' else 'null'::jsonb end,'withheld',safe_query is null,
        'outcomes',public.opportunity_search_dashboard_outcomes(p_search_id,null,(entry->>'query_id')::uuid,entry->>'text_hash')));
    end loop;
    safe_plan:=jsonb_build_object('id',plan.id,'revision',plan.plan_revision,'plan_hash',plan.plan_hash,'created_at',plan.created_at,
      'basis',jsonb_build_object('base_revision',plan.base_revision,'feedback_revision',plan.feedback_revision,'preference_revision',plan.preference_revision,'protocol_version',plan.protocol_version),
      'planning_policy',case when plan.planning_policy=policy then policy else null end,'queries',queries);
  end if;
  select count(*) into execution_total from public.opportunity_search_executions where user_id=actor and search_id=p_search_id;
  select coalesce(jsonb_agg(e.row order by e.attempted_at desc,e.check_id),'[]') into executions from (
    select x.attempted_at,x.check_id,jsonb_build_object('run_id',x.run_id,'check_id',x.check_id,'kind',x.kind,'query_id',x.query_id,'text_hash',x.text_hash,
      'source_registry_id',x.source_registry_id,'attempted_at',x.attempted_at,'status',x.status,'results_count',x.results_count,'failure_reason',x.failure_reason) row
      from public.opportunity_search_executions x where x.user_id=actor and x.search_id=p_search_id order by x.attempted_at desc,x.check_id limit 64) e;
  select count(*) into run_total from public.opportunity_search_runs where user_id=actor and search_id=p_search_id;
  with recent as materialized (
    select r.id,r.status,r.created_at,r.completed_at,r.template_revision,r.feedback_snapshot_revision,r.preference_snapshot_revision,r.protocol_version,
      r.query_plan_id,r.adaptive_contract_version,r.execution_report_status,r.summary->'unresolvedCount' unresolved,
      case when r.execution_report_status<>'unreported' then jsonb_array_length(r.execution_backlog) end backlog_candidates,
      case when r.execution_report_status<>'unreported' then r.execution_backlog_omitted end backlog_omitted,
      case when r.execution_report_status<>'unreported' then r.execution_report_overflow end backlog_overflow,
      case when jsonb_typeof(r.execution_expectations->'sources')='array' then r.execution_expectations->'sources' else '[]'::jsonb end required_sources
      from public.opportunity_search_runs r where r.user_id=actor and r.search_id=p_search_id order by r.created_at desc,r.id limit 10
  ), receipt_counts as (
    select r.run_id,count(*) filter(where r.result->>'outcome'='new') new_count,count(*) filter(where r.result->>'outcome'='updated') updated_count,
      count(*) filter(where r.result->>'outcome'='unchanged') unchanged_count,count(*) filter(where r.verified_at is not null) verified_count
      from public.opportunity_search_receipts r join recent x on x.id=r.run_id where r.user_id=actor group by r.run_id
  ), check_counts as (
    select e.run_id,count(*) filter(where e.status='failed') failed_checks from public.opportunity_search_executions e join recent x on x.id=e.run_id where e.user_id=actor group by e.run_id
  ), deadlines as (
    select d.run_id,count(*) filter(where d.deadline_quality->>'late_discovery_status'='confirmed') late,
      count(*) filter(where d.deadline_quality->>'late_discovery_status'='possible') possible,
      count(*) filter(where coalesce(d.deadline_quality->>'late_discovery_status','unknown')='unknown') unknown_count,
      round(avg(public.opportunity_search_dashboard_number(d.deadline_quality->'lead_time_hours')),6) exact_lead,
      round(avg(public.opportunity_search_dashboard_number(d.deadline_quality->'lead_time_lower_hours')),6) lower_lead,
      round(avg(public.opportunity_search_dashboard_number(d.deadline_quality->'lead_time_upper_hours')),6) upper_lead,
      bool_or(coalesce(d.deadline_quality->'provisional'='true'::jsonb,true) or d.deadline_quality->>'precision'='unknown') uncertain
      from public.opportunity_search_discoveries d join recent x on x.id=d.run_id where d.user_id=actor and d.verified_at is not null and d.primary_discovery group by d.run_id
  ) select coalesce(jsonb_agg(jsonb_build_object('run_id',r.id,'status',r.status,'started_at',r.created_at,'completed_at',r.completed_at,
    'basis',jsonb_build_object('base_revision',r.template_revision,'feedback_revision',r.feedback_snapshot_revision,'preference_revision',r.preference_snapshot_revision,'protocol_version',r.protocol_version),
    'query_plan_id',r.query_plan_id,'adaptive_contract_version',r.adaptive_contract_version,'execution_report_status',r.execution_report_status,
    'backlog_candidates',r.backlog_candidates,'backlog_omitted',r.backlog_omitted,'backlog_overflow',r.backlog_overflow,
    'counts',jsonb_build_object('new',coalesce(c.new_count,0),'updated',coalesce(c.updated_count,0),'unchanged',coalesce(c.unchanged_count,0),'verified',coalesce(c.verified_count,0),
      'unresolved',case when public.opportunity_search_dashboard_number(r.unresolved)>=0 and public.opportunity_search_dashboard_number(r.unresolved)=trunc(public.opportunity_search_dashboard_number(r.unresolved)) then public.opportunity_search_dashboard_number(r.unresolved) end,'failed_checks',coalesce(e.failed_checks,0),'incomplete_sources',(
        select count(*) from jsonb_array_elements(r.required_sources) src where not exists(select 1 from public.opportunity_search_executions x
          where x.user_id=actor and x.run_id=r.id and x.kind='source' and x.source_registry_id::text=src->>'registry_id' and x.status='complete'
            and not exists(select 1 from public.opportunity_search_executions later where later.run_id=x.run_id and later.source_registry_id=x.source_registry_id and later.attempted_at>x.attempted_at and later.status<>'complete')))),
    'deadline',jsonb_build_object('late_discoveries',coalesce(d.late,0),'possible_late_discoveries',coalesce(d.possible,0),'unknown',coalesce(d.unknown_count,0),
      'exact_lead_time_hours',d.exact_lead,'lower_lead_time_hours',d.lower_lead,'upper_lead_time_hours',d.upper_lead,'uncertain',coalesce(d.uncertain,true)),
    'delivery_status','unknown') order by r.created_at desc,r.id),'[]') into runs from recent r left join receipt_counts c on c.run_id=r.id left join check_counts e on e.run_id=r.id left join deadlines d on d.run_id=r.id;
  result:=jsonb_build_object('dashboard_version',1,'user_id',actor,'search_id',p_search_id,'project_ref',p_project_ref,'settings',settings,'policy',policy,
    'runner_authorization',jsonb_build_object('enabled',coalesce(grant_row.enabled,false),'authorization_revision',coalesce(grant_row.authorization_revision,0),'project_ref',grant_row.project_ref),
    'readiness',public.read_adaptive_search_readiness(p_search_id,p_project_ref),'feedback_preview',preview,
    'preferences',jsonb_build_object('revision',preferences->'preference_revision','approved_rules',rule,'suggestions',suggestions,'proposals',proposals),
    'sources',sources,'queries',jsonb_build_object('plan',safe_plan,'executions',executions),'runs',runs,
    'omitted',jsonb_build_object('sources',greatest(source_total-64,0),'preference_suggestions',greatest(suggestion_total-64,0),'proposals',greatest(proposal_total-32,0),
      'queries',greatest(query_total-30,0),'executions',greatest(execution_total-64,0),'runs',greatest(run_total-10,0),'withheld_fields',withheld),
    'bounds',jsonb_build_object('maximum_dashboard_bytes',262144,'maximum_feedback_bytes',65536,'maximum_sources',64,'maximum_queries',30,
      'maximum_executions',64,'maximum_runs',10,'maximum_suggestions',64,'maximum_proposals',32));
  if octet_length(result::text)>262144 then raise exception 'Dashboard exceeds its bounded scope' using errcode='54000';end if;
  return result;
end;
$$;
revoke all on function public.read_opportunity_search_dashboard(uuid,text) from public,anon,service_role;
grant execute on function public.read_opportunity_search_dashboard(uuid,text) to authenticated;
comment on function public.read_opportunity_search_dashboard(uuid,text) is 'Fixed owner DTO: exact outgoing feedback preview, explicit preference actions, public reusable sources, saved queries and actual history. Verification counts are persisted separate-verification observations, not delivery or a fresh canonical comparison.';
comment on table public.opportunity_search_dashboard_actions is 'Owner-only immutable control receipts. Exact retry acknowledges historical settings/source state; refresh dashboard for current state. Does not edit base criteria or task text.';
commit;
