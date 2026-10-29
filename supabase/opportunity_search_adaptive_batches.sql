-- AF-08 intake. Compose canonical v5; never return its broad receipts/snapshots.
-- Requires AF-01–07. Full capabilities are activated only after finalization.
begin;

alter table private.opportunity_search_adaptive_contexts add column expected_shared_plan_id uuid,add column plan_pointer_captured boolean not null default false,add column expected_source_fingerprint text;
create function private.adaptive_source_basis(p_user_id uuid,p_search_id uuid) returns text
language sql stable security invoker set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('sources',(select coalesce(jsonb_agg(jsonb_build_array(registry_id,source_revision) order by registry_id),'[]')
    from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id),'settings',(select jsonb_build_array(source_reuse_revision,adaptation_revision,consent_revision)
    from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id))::text,'UTF8')),'hex')
$$;
revoke all on function private.adaptive_source_basis(uuid,uuid) from public,anon,authenticated,service_role;
create function private.capture_adaptive_plan_pointer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  select query_plan_id into new.expected_shared_plan_id from public.opportunity_search_adaptive_settings where user_id=new.user_id and search_id=new.search_id;
  new.plan_pointer_captured:=true;
  new.expected_source_fingerprint:=private.adaptive_source_basis(new.user_id,new.search_id);
  return new;
end;
$$;
revoke all on function private.capture_adaptive_plan_pointer() from public,anon,authenticated,service_role;
create trigger adaptive_context_plan_pointer before insert on private.opportunity_search_adaptive_contexts for each row execute function private.capture_adaptive_plan_pointer();

create table private.opportunity_search_adaptive_batches (
  run_id uuid not null references public.opportunity_search_runs(id) on delete cascade,
  batch_id uuid not null,
  user_id uuid not null,
  search_id uuid not null,
  ordinal integer not null check(ordinal between 1 and 32),
  payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
  plan_id uuid not null,
  plan_hash text not null,
  item_ids uuid[] not null check(cardinality(item_ids)<=10),
  query_versions jsonb not null,
  execution_status text not null,
  recorded_checks integer not null,
  retained_backlog integer not null,
  omitted_backlog integer not null,
  execution_incomplete boolean not null,
  suggestions jsonb not null default '[]',
  manifest_hash text,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(run_id,batch_id),unique(run_id,ordinal)
);
create table private.opportunity_search_adaptive_items (
  run_id uuid not null,
  item_id uuid not null,
  batch_id uuid not null,
  payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
  opportunity_id uuid,
  outcome text not null check(outcome in('saved','unresolved')),
  canonical_outcome text check(canonical_outcome in('new','updated','unchanged')),
  conflict_code text check(conflict_code in('identity_conflict','insufficient_evidence','correction_deferred','scope_changed')),
  accepted_roots jsonb not null default '{}',
  deferred_fields text[] not null default '{}',
  discovery_id uuid,
  reusable_listing_url text,
  reusable_registry_id uuid,
  retention_deferred boolean not null default false,
  primary key(run_id,item_id),
  foreign key(run_id,batch_id) references private.opportunity_search_adaptive_batches(run_id,batch_id) on delete cascade
);
do $$declare relation text;begin
  foreach relation in array array['opportunity_search_adaptive_batches','opportunity_search_adaptive_items'] loop
    execute format('alter table private.%I enable row level security',relation);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;

create table public.opportunity_search_adaptive_proposals (
  user_id uuid not null,
  search_id uuid not null,
  suggestion_id uuid not null,
  run_id uuid not null references public.opportunity_search_runs(id) on delete cascade,
  batch_id uuid not null,
  kind text not null check(kind in('preference','source','query')),
  proposal jsonb not null check(octet_length(proposal::text)<=8192),
  evidence_refs uuid[] not null check(cardinality(evidence_refs) between 1 and 16),
  status text not null check(status in('pending','awaiting_verification','deferred')),
  reason text check(reason in('needs_verified_evidence','needs_reviewed_evidence','adaptation_disabled')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,search_id,suggestion_id),
  foreign key(user_id,search_id) references public.opportunity_search_templates(user_id,id) on delete cascade,
  foreign key(run_id,batch_id) references private.opportunity_search_adaptive_batches(run_id,batch_id) on delete cascade
);
alter table public.opportunity_search_adaptive_proposals enable row level security;
revoke all on public.opportunity_search_adaptive_proposals from public,anon,authenticated,service_role;
grant select on public.opportunity_search_adaptive_proposals to authenticated;
create policy "Owner inert adaptive proposals" on public.opportunity_search_adaptive_proposals for select to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function private.require_adaptive_search_scope(p_run_id uuid,p_require_active_lease boolean default true) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare metadata record;release public.opportunity_search_adaptive_release;grant_row public.opportunity_search_runner_authorizations;context private.opportunity_search_adaptive_contexts;run public.opportunity_search_runs;
begin
  if current_user<>'postgres' then raise exception 'Adaptive authorization denied' using errcode='42501';end if;
  select r.user_id,r.search_id into metadata from public.opportunity_search_runs r where r.id=p_run_id;
  if not found then raise exception 'Adaptive scope unavailable' using errcode='42501';end if;
  select * into release from public.opportunity_search_adaptive_release where singleton for share;
  perform 1 from public.opportunity_search_templates where id=metadata.search_id for share;
  select * into grant_row from public.opportunity_search_runner_authorizations where user_id=metadata.user_id and search_id=metadata.search_id for share;
  if not release.enabled or release.project_ref is null or release.adaptive_contract_version<>1
    or release.capability_version is distinct from private.opportunity_search_adaptive_capabilities()->>'capability_version'
    or not coalesce(grant_row.enabled,false) or grant_row.project_ref is distinct from release.project_ref then
    raise exception 'Adaptive authorization denied' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(metadata.user_id::text||':'||metadata.search_id::text||':adaptive-lease',0));
  select * into run from public.opportunity_search_runs where id=p_run_id for update;
  select * into context from private.opportunity_search_adaptive_contexts where run_id=p_run_id;
  if not found or(context.user_id,context.search_id,context.project_ref,context.authorization_epoch,context.authorization_revision)
    is distinct from(metadata.user_id,metadata.search_id,release.project_ref,grant_row.authorization_epoch,grant_row.authorization_revision)
    or(context.bundle#>>'{release,release_revision}')::bigint is distinct from release.release_revision
    or context.bundle_hash is distinct from encode(sha256(convert_to(context.bundle::text,'UTF8')),'hex') then
    raise exception 'Adaptive authorization denied' using errcode='42501';end if;
  if p_require_active_lease and(run.status<>'running' or context.lease_expires_at<=clock_timestamp()) then raise exception 'Adaptive run is not active' using errcode='55000';end if;
  return jsonb_build_object('run_id',p_run_id,'user_id',metadata.user_id,'search_id',metadata.search_id,'project_ref',release.project_ref,
    'authorization_revision',grant_row.authorization_revision,'authorization_epoch',grant_row.authorization_epoch,'release_revision',release.release_revision,
    'base_revision',run.template_revision,'feedback_revision',run.feedback_snapshot_revision,'preference_revision',context.preference_revision,'protocol_version',run.protocol_version,
    'query_plan_id',run.query_plan_id,'expected_shared_plan_id',context.expected_shared_plan_id,'plan_pointer_captured',context.plan_pointer_captured,
    'status',run.status,'lease_expires_at',context.lease_expires_at,'privacy_redacted',context.privacy_redacted);
exception when insufficient_privilege then raise exception 'Adaptive authorization denied' using errcode='42501';
end;
$$;
revoke all on function private.require_adaptive_search_scope(uuid,boolean) from public,anon,authenticated,service_role;

create function private.opportunity_search_adaptive_manifest(p_run_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with batches as(select batch_id,payload_hash,plan_hash,item_ids from private.opportunity_search_adaptive_batches where run_id=p_run_id),
  data as(select coalesce(jsonb_agg(jsonb_build_object('batch_id',batch_id,'payload_hash',payload_hash,'plan_hash',plan_hash,'item_ids',to_jsonb(item_ids)) order by batch_id),'[]') body from batches)
  select jsonb_build_object('batch_ids',(select coalesce(jsonb_agg(batch_id order by batch_id),'[]') from batches),
    'item_ids',(select coalesce(jsonb_agg(item_id order by item_id),'[]') from private.opportunity_search_adaptive_items where run_id=p_run_id),
    'manifest_hash',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from data
$$;
revoke all on function private.opportunity_search_adaptive_manifest(uuid) from public,anon,authenticated,service_role;

create function private.refresh_adaptive_execution_scope(p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope jsonb;run public.opportunity_search_runs;context private.opportunity_search_adaptive_contexts;settings public.opportunity_search_adaptive_settings;
  packet jsonb;rules jsonb;document jsonb;expected jsonb;queries jsonb:='[]';sources jsonb:='[]';query_skips jsonb;source_skips jsonb;entry jsonb;skip jsonb;rule jsonb;
  ids text[];allowed text[];privacy boolean;protected_revoked boolean:=false;reason text;
begin
  scope:=private.require_adaptive_search_scope(p_run_id,false);
  select * into run from public.opportunity_search_runs where id=p_run_id;
  select * into context from private.opportunity_search_adaptive_contexts where run_id=p_run_id;
  select * into settings from public.opportunity_search_adaptive_settings where user_id=run.user_id and search_id=run.search_id;
  packet:=private.pin_opportunity_feedback_snapshot(run.user_id,run.search_id,p_run_id);
  rules:=public.opportunity_search_preference_document(run.user_id,run.search_id)->'approved_rules';
  expected:=coalesce(run.execution_expectations,private.prepare_opportunity_search_execution(p_run_id));
  if run.query_plan_id is not null then select p.document into document from public.opportunity_search_query_plans p where p.id=run.query_plan_id;end if;
  privacy:=context.privacy_redacted or coalesce((packet->>'privacy_scope_changed')::boolean,false)
    or not coalesce(settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused,false)
      and(coalesce((context.bundle#>>'{feedback,counts,eligible}')::integer,0)>0 or exists(select 1 from jsonb_array_elements(coalesce(document->'queries','[]')) q where q->>'role'<>'core'));
  if privacy then update private.opportunity_search_adaptive_contexts set privacy_redacted=true where run_id=p_run_id;end if;
  select coalesce(array_agg(distinct id),'{}') into ids from(
    select s->>'registry_id' id from jsonb_array_elements(coalesce(expected->'sources','[]')) s
    union select q->>'source_registry_id' from jsonb_array_elements(coalesce(document->'queries','[]')) q where q?'source_registry_id') referenced;
  select coalesce(array_agg(s->>'registry_id'),'{}') into allowed from jsonb_array_elements(private.opportunity_search_adaptive_source_context(run.user_id,run.search_id,ids,rules)) s;
  query_skips:=coalesce(expected->'authorized_query_skips','[]');source_skips:=coalesce(expected->'authorized_source_skips','[]');
  for entry in select value from jsonb_array_elements(coalesce(document->'queries','[]')) loop
    select s into skip from jsonb_array_elements(query_skips) s where s->>'query_id'=entry->>'query_id';
    reason:=null;rule:=null;
    if skip is not null then reason:=coalesce(skip->>'reason','approved_source_exclusion');
    elsif privacy and entry->>'role'<>'core' then reason:='privacy_scope_changed';
    elsif entry?'source_registry_id' and not(entry->>'source_registry_id'=any(allowed)) then
      select r into rule from jsonb_array_elements(rules) r where r->>'kind'='source_exclusion' and r->>'source_registry_id'=entry->>'source_registry_id' limit 1;
      reason:=case when rule is null then 'source_opt_out' else 'approved_source_exclusion' end;
      if entry->>'role'='core' then protected_revoked:=true;end if;
    end if;
    if reason is not null then
      if skip is null then query_skips:=query_skips||jsonb_build_array(jsonb_build_object('query_id',entry->'query_id','text_hash',entry->'text_hash','reason',reason)
        ||case when rule is null then '{}'::jsonb else jsonb_build_object('rule_id',rule->'rule_id') end);end if;
    else queries:=queries||jsonb_build_array(jsonb_build_object('query_id',entry->'query_id','text_hash',entry->'text_hash'));end if;
  end loop;
  for entry in select value from jsonb_array_elements(coalesce(expected->'sources','[]')) loop
    if entry->>'registry_id'=any(allowed) then sources:=sources||jsonb_build_array(entry);
    elsif not exists(select 1 from jsonb_array_elements(source_skips) s where s->>'source_registry_id'=entry->>'registry_id') then
      select r into rule from jsonb_array_elements(rules) r where r->>'kind'='source_exclusion' and r->>'source_registry_id'=entry->>'registry_id' limit 1;
      reason:=case when rule is not null then 'approved_source_exclusion' when privacy and entry->>'provenance'<>'explicit' and entry->'pinned'<>'true'::jsonb and entry->'mandatory'<>'true'::jsonb then 'privacy_scope_changed' else 'source_opt_out' end;
      source_skips:=source_skips||jsonb_build_array(jsonb_build_object('source_registry_id',entry->'registry_id','reason',reason)
        ||case when rule is null then '{}'::jsonb else jsonb_build_object('rule_id',rule->'rule_id') end);
    end if;
  end loop;
  if run.query_plan_id is not null then expected:=jsonb_set(expected,'{queries}',queries);expected:=jsonb_set(expected,'{pending_queries}','false');end if;
  expected:=expected||jsonb_build_object('sources',sources,'authorized_query_skips',query_skips,'authorized_source_skips',source_skips,
    'protected_scope_revoked',protected_revoked or coalesce((expected->>'protected_scope_revoked')::boolean,false));
  if(expected->>'protected_scope_revoked')::boolean then
    update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',summary='{"adaptive_status":"source_scope_changed","coverage":"partial"}' where id=p_run_id and status='running';
  end if;
  update public.opportunity_search_runs set execution_expectations=expected where id=p_run_id;
  return expected;
end;
$$;
revoke all on function private.refresh_adaptive_execution_scope(uuid) from public,anon,authenticated,service_role;

create function private.adaptive_batch_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='opportunity_search_adaptive_batches' then
    if old.result is null and(to_jsonb(new)-array['manifest_hash','result','suggestions']) is not distinct from(to_jsonb(old)-array['manifest_hash','result','suggestions']) then return new;end if;
  end if;
  raise exception 'Adaptive batch audit is immutable' using errcode='23514';
end;
$$;
revoke all on function private.adaptive_batch_immutable() from public,anon,authenticated,service_role;
create trigger adaptive_batches_immutable before update on private.opportunity_search_adaptive_batches for each row execute function private.adaptive_batch_immutable();
create trigger adaptive_items_immutable before update on private.opportunity_search_adaptive_items for each row execute function private.adaptive_batch_immutable();

create function private.adaptive_accepted_roots(p_run_id uuid,p_item_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(root,jsonb_build_object('accepted',accepted,'rejected',rejected,'unchanged',unchanged,'conflicting',conflicting)),'{}') from(
    select split_part(d->>'path','/',2) root,count(*) filter(where d->>'status'='accepted') accepted,count(*) filter(where d->>'status'='rejected') rejected,
      count(*) filter(where d->>'status'='unchanged') unchanged,count(*) filter(where d->>'status'='conflicting') conflicting
    from private.opportunity_search_merge_audit a cross join lateral jsonb_array_elements(a.decisions) d
    where a.run_id=p_run_id and a.item_id=p_item_id and(private.opportunity_search_result_schema()->'properties')?split_part(d->>'path','/',2)
      and split_part(d->>'path','/',2)<>'merge_control' and d->>'status' in('accepted','rejected','unchanged','conflicting') group by 1) counters
$$;
revoke all on function private.adaptive_accepted_roots(uuid,uuid) from public,anon,authenticated,service_role;

create function private.adaptive_batch_receipt(p_run_id uuid,p_batch_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare batch private.opportunity_search_adaptive_batches;items jsonb;entry record;roots jsonb:='{}';root record;counts jsonb;field text;suggestions jsonb:='[]';suggestion jsonb;
begin
  select * into batch from private.opportunity_search_adaptive_batches where run_id=p_run_id and batch_id=p_batch_id;
  if not found then return null;end if;
  items:='[]';
  for entry in select i.*,ord.ordinality from unnest(batch.item_ids) with ordinality ord(item_id,ordinality)
    join private.opportunity_search_adaptive_items i on i.run_id=p_run_id and i.item_id=ord.item_id order by ord.ordinality loop
    roots:='{}';
    for root in select key,value from jsonb_each(entry.accepted_roots) loop
      if not(private.opportunity_search_result_schema()->'properties')?root.key or root.key='merge_control' then continue;end if;
      counts:='{}';
      foreach field in array array['accepted','rejected','unchanged','conflicting'] loop
        if not private.opportunity_search_adaptive_number(root.value->field,0,9007199254740991,true,false) then raise exception 'Invalid safe receipt' using errcode='22023';end if;
        counts:=counts||jsonb_build_object(field,root.value->field);
      end loop;
      roots:=roots||jsonb_build_object(root.key,counts);
    end loop;
    items:=items||jsonb_build_array(jsonb_build_object('item_id',entry.item_id,'payload_hash',entry.payload_hash,'opportunity_id',entry.opportunity_id,
      'outcome',entry.outcome,'canonical_outcome',entry.canonical_outcome,'conflict_code',entry.conflict_code,'accepted_roots',roots,
      'deferred_fields',to_jsonb(array(select f from unnest(entry.deferred_fields) f where(private.opportunity_search_result_schema()->'properties')?f order by f)),
      'discovery_id',entry.discovery_id,'verification_required',entry.outcome='saved')||case when entry.retention_deferred then
        jsonb_build_object('source_retention',jsonb_build_object('status','deferred','reason','registry_binding_mismatch')) else '{}'::jsonb end);
  end loop;
  for suggestion in select value from jsonb_array_elements(batch.suggestions) loop
    if suggestion->>'kind' not in('preference','source','query') or suggestion->>'status' not in('pending','awaiting_verification','deferred') then raise exception 'Invalid safe receipt' using errcode='22023';end if;
    suggestions:=suggestions||jsonb_build_array(jsonb_build_object('suggestion_id',(suggestion->>'suggestion_id')::uuid,'kind',suggestion->>'kind','status',suggestion->>'status')
      ||case when suggestion->>'reason' in('needs_verified_evidence','needs_reviewed_evidence','adaptation_disabled') then jsonb_build_object('reason',suggestion->>'reason') else '{}'::jsonb end);
  end loop;
  return jsonb_build_object('adaptive_contract_version',1,'batch_schema_version',1,'run_id',p_run_id,'batch_id',p_batch_id,'payload_hash',batch.payload_hash,'plan_id',batch.plan_id,'plan_hash',batch.plan_hash,
    'query_versions',(select coalesce(jsonb_agg(jsonb_build_object('query_id',(q->>'query_id')::uuid,'text_hash',q->>'text_hash') order by q->>'query_id'),'[]') from jsonb_array_elements(batch.query_versions) q),
    'items',items,'execution',jsonb_build_object('status',batch.execution_status,'recorded_checks',batch.recorded_checks,'retained_backlog',batch.retained_backlog,'omitted_backlog',batch.omitted_backlog,'incomplete',batch.execution_incomplete),
    'suggestions',suggestions,'manifest_hash',batch.manifest_hash,'batch_count',batch.ordinal,'verification_required',true);
end;
$$;
revoke all on function private.adaptive_batch_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function private.adaptive_plan_policy_valid(p_document jsonb,p_policy jsonb,p_active boolean) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare core_count integer;noncore_count integer;exploration_count integer;
begin
  if jsonb_typeof(p_document->'queries') is distinct from 'array' then return false;end if;
  select count(*) filter(where q->>'role'='core'),count(*) filter(where q->>'role'<>'core'),count(*) filter(where q->>'role'='exploration')
    into core_count,noncore_count,exploration_count from jsonb_array_elements(p_document->'queries') q;
  return core_count>0 and jsonb_array_length(p_document->'queries')<=30 and(not p_active or core_count>=(p_policy->>'maximum_queries')::integer
    or exploration_count>=greatest((p_policy->>'minimum_exploration_queries')::integer,ceil(noncore_count*(p_policy->>'exploration_ratio')::numeric)::integer));
exception when others then return false;
end;
$$;
revoke all on function private.adaptive_plan_policy_valid(jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
do $$declare body text;updated text;begin
  body:=pg_get_functiondef('private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)'::regprocedure);
  updated:=replace(body,'''refresh_required'',settings.query_plan_dirty or plan.id is null',
    '''refresh_required'',not private.adaptive_plan_policy_valid(plan.document,policy,adaptation_active) or settings.query_plan_dirty or plan.id is null');
  if updated=body then raise exception 'AF-06 plan allocation prerequisite differs';end if;
  execute updated;
end $$;

create function private.pin_adaptive_batch_plan(p_run_id uuid,p_proposal jsonb,p_plan_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope jsonb;run public.opportunity_search_runs;context private.opportunity_search_adaptive_contexts;settings public.opportunity_search_adaptive_settings;
  saved public.opportunity_search_query_plans;anchor public.opportunity_search_query_revisions;document jsonb;pinned jsonb;query jsonb;protected jsonb;legacy jsonb;core_queries jsonb;
  fingerprint text;revision bigint;core_count integer;adaptive_count integer;exploration_count integer;active boolean;shared boolean:=false;policy jsonb;expected_pointer uuid;
begin
  scope:=private.require_adaptive_search_scope(p_run_id,true);
  select * into run from public.opportunity_search_runs where id=p_run_id;
  select * into context from private.opportunity_search_adaptive_contexts where run_id=p_run_id;
  policy:=context.bundle#>'{planning,policy}';active:=coalesce((context.bundle#>>'{planning,enabled}')::boolean,false) and not context.privacy_redacted;
  if run.query_plan_id is not null then
    select * into saved from public.opportunity_search_query_plans where id=run.query_plan_id;
    if p_proposal is null then
      if p_plan_hash is distinct from saved.plan_hash then raise exception 'Copy the pinned plan hash' using errcode='40001';end if;
      return jsonb_build_object('id',saved.id,'plan_hash',saved.plan_hash,'document',saved.document,'shared',false);
    end if;
  elsif p_proposal is null then raise exception 'The first actual query plan is required' using errcode='22023';end if;
  if jsonb_typeof(p_proposal) is distinct from 'object' or p_proposal-array['schema_version','queries']<>'{}'::jsonb
    or p_proposal->'schema_version' is distinct from '2'::jsonb or jsonb_typeof(p_proposal->'queries') is distinct from 'array' or jsonb_array_length(p_proposal->'queries') not between 1 and 30 then
    raise exception 'Use the bounded actual query plan' using errcode='22023';end if;
  document:=jsonb_build_object('schema_version',2,'queries','[]'::jsonb);
  for query in select value from jsonb_array_elements(p_proposal->'queries') loop
    if jsonb_typeof(query) is distinct from 'object' or jsonb_typeof(query->'query') is distinct from 'string'
      or query?'text_hash' and query->>'text_hash' is distinct from encode(sha256(convert_to(query->>'query','UTF8')),'hex') then raise exception 'Invalid query version' using errcode='22023';end if;
    query:=query||jsonb_build_object('text_hash',encode(sha256(convert_to(query->>'query','UTF8')),'hex'));
    document:=jsonb_set(document,'{queries}',(document->'queries')||jsonb_build_array(query));
  end loop;
  if private.opportunity_search_adaptive_queries(document,false,false) is null then raise exception 'Invalid safe actual query plan' using errcode='22023';end if;
  perform private.validate_opportunity_search_plan(run.user_id,run.search_id,document);
  if run.query_plan_id is not null then
    if document is distinct from saved.document or p_plan_hash is not null and p_plan_hash<>saved.plan_hash then raise exception 'Actual plan is already pinned' using errcode='40001';end if;
    return jsonb_build_object('id',saved.id,'plan_hash',saved.plan_hash,'document',saved.document,'shared',false);
  end if;
  for protected in select value from jsonb_array_elements(coalesce(context.bundle#>'{query_plan,document,queries}','[]')) where value->>'role'='core' loop
    if not exists(select 1 from jsonb_array_elements(document->'queries') q where q=protected) then raise exception 'Protected core queries must remain exact' using errcode='22023';end if;
  end loop;
  for query in select value from jsonb_array_elements(document->'queries') loop
    if query->'manual'='true'::jsonb and not exists(select 1 from jsonb_array_elements(coalesce(context.bundle#>'{query_plan,document,queries}','[]')) q where q=query and q->'manual'='true'::jsonb) then
      raise exception 'Generated plans cannot invent manual authorship' using errcode='22023';end if;
    if query->>'role'='core' and context.bundle->'query_plan'<>'null'::jsonb and(context.bundle#>>'{query_plan,basis,base_revision}')::integer=run.template_revision
      and not exists(select 1 from jsonb_array_elements(context.bundle#>'{query_plan,document,queries}') q where q=query) then raise exception 'Adaptation preserves core queries' using errcode='22023';end if;
    if query->>'role'='core' and context.bundle->'query_plan'='null'::jsonb and context.bundle->'legacy_core_queries'<>'null'::jsonb
      and not exists(select 1 from jsonb_array_elements(context.bundle#>'{legacy_core_queries,queries}') q where q->'query'=query->'query' and coalesce(q->'sources','[]')=coalesce(query->'sources','[]')) then
      raise exception 'Adaptation preserves legacy core queries' using errcode='22023';end if;
    if query?'source_registry_id' and not exists(select 1 from jsonb_array_elements(context.bundle->'source_context') s where s->>'registry_id'=query->>'source_registry_id')
      and not exists(select 1 from jsonb_array_elements(context.bundle#>'{planning,blocked_core_queries}') b where b->>'query_id'=query->>'query_id') then
      raise exception 'Source is outside the authorized bundle' using errcode='42501';end if;
    if not active and query->>'role'<>'core' then raise exception 'Adaptive query execution is disabled' using errcode='22023';end if;
  end loop;
  select count(*) filter(where q->>'role'='core'),count(*) filter(where q->>'role'='adaptive'),count(*) filter(where q->>'role'='exploration') into core_count,adaptive_count,exploration_count from jsonb_array_elements(document->'queries') q;
  if not private.adaptive_plan_policy_valid(document,policy,active) then
    raise exception 'Actual query allocation violates the pinned policy' using errcode='22023';end if;
  select * into anchor from public.opportunity_search_query_revisions where user_id=run.user_id and search_id=run.search_id and template_revision=run.template_revision and protocol_version=run.protocol_version;
  if not found then
    select jsonb_agg(jsonb_build_object('query',q.value->'query')||case when q.value?'sources' then jsonb_build_object('sources',q.value->'sources') else '{}'::jsonb end order by q.ordinality)
      into core_queries from jsonb_array_elements(document->'queries') with ordinality q(value,ordinality) where q.value->>'role'='core';
    perform private.save_opportunity_search_queries(p_run_id,core_queries);
    select * into anchor from public.opportunity_search_query_revisions where user_id=run.user_id and search_id=run.search_id and template_revision=run.template_revision and protocol_version=run.protocol_version;
  else perform private.save_opportunity_search_queries(p_run_id,anchor.queries);end if;
  for legacy in select value from jsonb_array_elements(anchor.queries) loop
    if not exists(select 1 from jsonb_array_elements(document->'queries') q where q->>'role'='core' and q->'query'=legacy->'query' and coalesce(q->'sources','[]')=coalesce(legacy->'sources','[]')) then
      raise exception 'Preserve the exact legacy core anchor' using errcode='40001';end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(run.user_id::text||':'||run.search_id::text||':query-plan',0));
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('planning_policy',policy,'query_revision_id',anchor.id,'base_revision',run.template_revision,
    'feedback_revision',run.feedback_snapshot_revision,'preference_revision',context.preference_revision,'protocol_version',run.protocol_version,'document',document)::text,'UTF8')),'hex');
  if p_plan_hash is not null and p_plan_hash<>fingerprint then raise exception 'Actual plan hash differs' using errcode='40001';end if;
  select * into saved from public.opportunity_search_query_plans where user_id=run.user_id and search_id=run.search_id and plan_hash=fingerprint;
  if not found then
    select coalesce(max(plan_revision),0)+1 into revision from public.opportunity_search_query_plans where user_id=run.user_id and search_id=run.search_id;
    insert into public.opportunity_search_query_plans(user_id,search_id,query_revision_id,plan_revision,base_revision,feedback_revision,preference_revision,protocol_version,planning_policy,document,plan_hash)
      values(run.user_id,run.search_id,anchor.id,revision,run.template_revision,run.feedback_snapshot_revision,context.preference_revision,run.protocol_version,policy,document,fingerprint) returning * into saved;
  end if;
  perform private.pin_opportunity_search_plan(run.user_id,run.search_id,p_run_id,saved.id);
  select * into settings from public.opportunity_search_adaptive_settings where user_id=run.user_id and search_id=run.search_id for update;
  expected_pointer:=context.expected_shared_plan_id;
  if context.plan_pointer_captured and settings.query_plan_id is not distinct from expected_pointer and context.expected_source_fingerprint=private.adaptive_source_basis(run.user_id,run.search_id)
    and settings.feedback_revision=run.feedback_snapshot_revision and not settings.feedback_dirty
    and(public.opportunity_search_preference_document(run.user_id,run.search_id)->>'preference_revision')::bigint=context.preference_revision
    and(select t.revision from public.opportunity_search_templates t where t.id=run.search_id)=run.template_revision
    and(select active_protocol_version from private.opportunity_search_settings where singleton)=run.protocol_version and public.opportunity_search_adaptation_policy()=policy then
    update public.opportunity_search_adaptive_settings set query_plan_id=saved.id,query_plan_revision=saved.plan_revision,query_plan_dirty=false where user_id=run.user_id and search_id=run.search_id;shared:=true;
  end if;
  pinned:=jsonb_build_object('id',saved.id,'revision',saved.plan_revision,'plan_hash',saved.plan_hash,'planning_policy',saved.planning_policy,'document',saved.document,
    'basis',jsonb_build_object('base_revision',saved.base_revision,'feedback_revision',saved.feedback_revision,'preference_revision',saved.preference_revision,'protocol_version',saved.protocol_version));
  context.bundle:=jsonb_set(context.bundle,'{query_plan}',pinned);context.bundle:=jsonb_set(context.bundle,'{planning,refresh_required}','false');context.bundle:=jsonb_set(context.bundle,'{refresh,cold_start}','false');context.bundle:=jsonb_set(context.bundle,'{refresh,adaptive_slice}','false');
  update private.opportunity_search_adaptive_contexts set bundle=context.bundle,bundle_hash=encode(sha256(convert_to(context.bundle::text,'UTF8')),'hex') where run_id=p_run_id;
  return jsonb_build_object('id',saved.id,'plan_hash',saved.plan_hash,'document',saved.document,'shared',shared);
end;
$$;
revoke all on function private.pin_adaptive_batch_plan(uuid,jsonb,text) from public,anon,authenticated,service_role;

create function private.normalize_adaptive_execution(p_run_id uuid,p_execution jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare document jsonb;context private.opportunity_search_adaptive_contexts;expected jsonb;checks jsonb:='[]';entry jsonb;version text;
begin
  if jsonb_typeof(p_execution) is distinct from 'object' or p_execution-array['checks','backlog','complete']<>'{}'::jsonb
    or jsonb_typeof(p_execution->'checks') is distinct from 'array' or jsonb_array_length(p_execution->'checks')>128
    or p_execution?'backlog' and(jsonb_typeof(p_execution->'backlog') is distinct from 'array' or jsonb_array_length(p_execution->'backlog')>64)
    or p_execution?'complete' and jsonb_typeof(p_execution->'complete') is distinct from 'boolean' then raise exception 'Invalid bounded execution report' using errcode='22023';end if;
  select p.document,r.execution_expectations into document,expected from public.opportunity_search_runs r join public.opportunity_search_query_plans p on p.id=r.query_plan_id where r.id=p_run_id;
  select * into context from private.opportunity_search_adaptive_contexts where run_id=p_run_id;
  for entry in select value from jsonb_array_elements(p_execution->'checks') loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['check_id','kind','query_id','text_hash','source_registry_id','attempted_at','status','results_count','failure_reason']<>'{}'::jsonb then raise exception 'Invalid executed check' using errcode='22023';end if;
    if jsonb_typeof(entry->'kind') is distinct from 'string' or entry->>'kind' not in('query','source')
      or jsonb_typeof(entry->'check_id') is distinct from 'string' or entry->>'check_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or entry?'source_registry_id' and(jsonb_typeof(entry->'source_registry_id') is distinct from 'string' or entry->>'source_registry_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or entry->>'kind'='query' and(jsonb_typeof(entry->'query_id') is distinct from 'string' or entry->>'query_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'Invalid executed check identity' using errcode='22023';end if;
    if entry->>'kind'='query' then
      select q->>'text_hash' into version from jsonb_array_elements(document->'queries') q where q->>'query_id'=entry->>'query_id';
      if version is null then raise exception 'Query is outside this actual plan' using errcode='42501';end if;
      if entry?'text_hash' and entry->>'text_hash' is distinct from version then raise exception 'Executed query version differs' using errcode='22023';end if;
      entry:=entry||jsonb_build_object('text_hash',version);
    end if;
    if entry?'source_registry_id' and not exists(select 1 from jsonb_array_elements(context.bundle->'source_context') s where s->>'registry_id'=entry->>'source_registry_id')
      and not exists(select 1 from jsonb_array_elements(coalesce(expected->'authorized_source_skips','[]')) s where s->>'source_registry_id'=entry->>'source_registry_id')
      and not exists(select 1 from jsonb_array_elements(document->'queries') q where q->>'source_registry_id'=entry->>'source_registry_id') then
      raise exception 'Source is outside this actual run' using errcode='42501';end if;
    checks:=checks||jsonb_build_array(entry);
  end loop;
  for entry in select value from jsonb_array_elements(coalesce(p_execution->'backlog','[]')) loop
    if entry?'url' and jsonb_typeof(entry->'url') is distinct from 'string' then raise exception 'Candidate URL must be text' using errcode='22023';end if;
  end loop;
  return jsonb_set(p_execution,'{checks}',checks);
end;
$$;
revoke all on function private.normalize_adaptive_execution(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.validate_adaptive_attribution(p_run_id uuid,p_attribution jsonb,p_execution jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare ref jsonb;check_id_value uuid;refs uuid[]:='{}';primary_id uuid;discovered timestamptz;encountered timestamptz;attempted timestamptz;entry jsonb;
begin
  if jsonb_typeof(p_attribution) is distinct from 'object' or p_attribution-array['execution_refs','primary_check_id','discovered_at','encountered_at','recommendation_generated','updated_only']<>'{}'::jsonb
    or p_attribution?'execution_refs' and(jsonb_typeof(p_attribution->'execution_refs') is distinct from 'array' or jsonb_array_length(p_attribution->'execution_refs')>16) then
    raise exception 'Invalid bounded discovery attribution' using errcode='22023';end if;
  for ref in select value from jsonb_array_elements(coalesce(p_attribution->'execution_refs','[]')) loop
    if jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid execution reference' using errcode='22023';end if;
    check_id_value:=(ref#>>'{}')::uuid;
    select c into entry from jsonb_array_elements(p_execution->'checks') c where c->>'check_id'=check_id_value::text;
    if entry is not null then
      if entry->>'status' not in('complete','partial','paginated','dynamic') or(entry->>'results_count')::integer=0 then raise exception 'Discovery needs an actual relevant path' using errcode='22023';end if;
    elsif not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=check_id_value and e.status in('complete','partial','paginated','dynamic') and(e.results_count is null or e.results_count>0)) then
      raise exception 'Discovery path was not actually reported' using errcode='22023';end if;
    refs:=array_append(refs,check_id_value);
  end loop;
  if p_attribution?'primary_check_id' and jsonb_typeof(p_attribution->'primary_check_id') is distinct from 'string' then raise exception 'Invalid explicit primary path' using errcode='22023';end if;
  primary_id:=coalesce((p_attribution->>'primary_check_id')::uuid,refs[1]);
  if p_attribution?'primary_check_id' and(primary_id is null or not(primary_id=any(refs))) then raise exception 'Invalid primary discovery path' using errcode='22023';end if;
  discovered:=private.opportunity_feedback_time(p_attribution->>'discovered_at');encountered:=private.opportunity_feedback_time(p_attribution->>'encountered_at');
  if p_attribution?'discovered_at' and p_attribution->'discovered_at'<>'null'::jsonb and discovered is null
    or p_attribution?'encountered_at' and p_attribution->'encountered_at'<>'null'::jsonb and encountered is null
    or discovered>clock_timestamp()+interval '5 minutes' or encountered>clock_timestamp()+interval '5 minutes'
    or discovered is not null and cardinality(refs)=0 or discovered is not null and encountered is not null and discovered>encountered then raise exception 'Invalid actual discovery time' using errcode='22023';end if;
  if discovered is not null then
    select private.opportunity_feedback_time(c->>'attempted_at') into attempted from jsonb_array_elements(p_execution->'checks') c where c->>'check_id'=primary_id::text;
    if attempted is null then select e.attempted_at into attempted from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=primary_id;end if;
    if attempted is null or attempted>discovered then raise exception 'Discovery cannot predate its actual check' using errcode='22023';end if;
  end if;
  if p_attribution?'recommendation_generated' and jsonb_typeof(p_attribution->'recommendation_generated') is distinct from 'boolean'
    or p_attribution?'updated_only' and jsonb_typeof(p_attribution->'updated_only') is distinct from 'boolean' then raise exception 'Invalid discovery flags' using errcode='22023';end if;
end;
$$;
revoke all on function private.validate_adaptive_attribution(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.adaptive_expected_safe(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb;entry record;
begin
  if octet_length(p_value::text)>262144 then return false;end if;
  if jsonb_typeof(p_value)='string' then return private.opportunity_search_adaptive_text(p_value#>>'{}',12000);
  elsif jsonb_typeof(p_value)='array' then
    for item in select value from jsonb_array_elements(p_value) loop if not private.adaptive_expected_safe(item) then return false;end if;end loop;
  elsif jsonb_typeof(p_value)='object' then
    for entry in select key,value from jsonb_each(p_value) loop
      if entry.key in('contacts','supervisors','email','phone','phones','emails') or not private.opportunity_search_adaptive_text(entry.key,12000) or not private.adaptive_expected_safe(entry.value) then return false;end if;
    end loop;
  end if;
  return true;
end;
$$;
revoke all on function private.adaptive_expected_safe(jsonb) from public,anon,authenticated,service_role;

create function private.validate_adaptive_proposals(p_scope jsonb,p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
<<proposal_validator>>
declare actor uuid:=(p_scope->>'user_id')::uuid;search uuid:=(p_scope->>'search_id')::uuid;settings public.opportunity_search_adaptive_settings;
  list text;kind text;entry jsonb;proposal jsonb;refs jsonb;ref jsonb;evidence_id uuid;owned boolean;reviewed boolean;verified boolean;excluded boolean;
  status text;reason text;result jsonb:='[]';seen uuid[]:='{}';suggestion_id_value uuid;
begin
  select * into settings from public.opportunity_search_adaptive_settings where user_id=actor and search_id=search;
  foreach list in array array['preference_suggestions','source_suggestions','query_suggestions'] loop
    if not(p_payload?list) then continue;end if;
    if jsonb_typeof(p_payload->list) is distinct from 'array' or jsonb_array_length(p_payload->list)>16 then raise exception 'Bound future proposals' using errcode='22023';end if;
    kind:=case list when 'preference_suggestions' then 'preference' when 'source_suggestions' then 'source' else 'query' end;
    for entry in select value from jsonb_array_elements(p_payload->list) loop
      if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'suggestion_id') is distinct from 'string'
        or entry->>'suggestion_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid proposal identity' using errcode='22023';end if;
      suggestion_id_value:=(entry->>'suggestion_id')::uuid;
      if suggestion_id_value=any(seen) then raise exception 'Duplicate proposal identity' using errcode='22023';end if;seen:=array_append(seen,suggestion_id_value);
      if kind='preference' then
        if entry-array['suggestion_id','rule']<>'{}'::jsonb or not private.opportunity_search_adaptive_shape('rule',entry->'rule') then raise exception 'Invalid typed preference proposal' using errcode='22023';end if;
        proposal:=entry->'rule';refs:=proposal->'evidence_refs';
        if proposal->>'kind'='source_exclusion' and not exists(select 1 from public.opportunity_search_sources where registry_id=(proposal->>'source_registry_id')::uuid and user_id=actor and search_id=search) then raise exception 'Proposal scope denied' using errcode='42501';end if;
      elsif kind='source' then
        if entry-array['suggestion_id','kind','vacancy_url','evidence_refs']<>'{}'::jsonb or entry->>'kind' is distinct from 'candidate'
          or jsonb_typeof(entry->'vacancy_url') is distinct from 'string' or private.opportunity_feedback_safe_url(entry->>'vacancy_url') is null then raise exception 'Invalid source candidate proposal' using errcode='22023';end if;
        refs:=entry->'evidence_refs';proposal:=jsonb_build_object('kind','candidate','vacancy_url',private.opportunity_feedback_safe_url(entry->>'vacancy_url'));
      else
        if entry-array['suggestion_id','query','evidence_refs']<>'{}'::jsonb or jsonb_typeof(entry->'query') is distinct from 'string'
          or char_length(btrim(entry->>'query'))<3 or not private.opportunity_search_adaptive_text(entry->>'query',2000) then raise exception 'Invalid future query proposal' using errcode='22023';end if;
        refs:=entry->'evidence_refs';proposal:=jsonb_build_object('query',entry->'query');
      end if;
      if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs) not between 1 and 16 then raise exception 'Proposals need bounded owned evidence references' using errcode='22023';end if;
      status:='pending';reason:=null;
      for ref in select value from jsonb_array_elements(refs) loop
        if jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid evidence reference' using errcode='22023';end if;
        evidence_id:=(ref#>>'{}')::uuid;
        select exists(select 1 from public.opportunity_reviews r where r.user_id=actor and r.opportunity_id=evidence_id),
          exists(select 1 from public.opportunity_reviews r where r.user_id=actor and r.opportunity_id=evidence_id and r.feedback_excluded)
          into owned,excluded;
        owned:=owned or exists(select 1 from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=search and d.opportunity_id=evidence_id)
          or exists(select 1 from public.opportunity_search_receipts r join public.opportunity_search_runs run on run.id=r.run_id where r.user_id=actor and run.search_id=search and r.opportunity_id=evidence_id);
        if not owned then raise exception 'Proposal scope denied' using errcode='42501';end if;
        reviewed:=not excluded and private.project_opportunity_feedback(actor,evidence_id) is not null;
        verified:=exists(select 1 from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=search and d.opportunity_id=evidence_id and d.verified_at is not null) or reviewed;
        if excluded or kind='preference' and not reviewed then status:='deferred';reason:='needs_reviewed_evidence';
        elsif not verified and status<>'deferred' then status:='awaiting_verification';reason:='needs_verified_evidence';end if;
      end loop;
      if kind='preference' and not coalesce(settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused,false) then status:='deferred';reason:='adaptation_disabled';end if;
      if kind='preference' and status='pending' then proposal:=public.opportunity_search_validate_preference_rule(actor,search,proposal,true);end if;
      if exists(select 1 from public.opportunity_search_adaptive_proposals p where p.user_id=actor and p.search_id=search and p.suggestion_id=suggestion_id_value
        and(p.kind,p.proposal,p.evidence_refs) is distinct from(proposal_validator.kind,proposal_validator.proposal,array(select (r#>>'{}')::uuid from jsonb_array_elements(refs) r))) then raise exception 'Proposal identity changed' using errcode='40001';end if;
      result:=result||jsonb_build_array(jsonb_build_object('suggestion_id',suggestion_id_value,'kind',kind,'proposal',proposal,'evidence_refs',refs,'status',status,'reason',reason));
    end loop;
  end loop;
  return result;
end;
$$;
revoke all on function private.validate_adaptive_proposals(jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.prevalidate_adaptive_opportunities(p_items jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare entry jsonb;opportunity jsonb;correction jsonb;ids uuid[]:='{}';id uuid;
begin
  for entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['item_id','opportunity','attribution','reusable_source']<>'{}'::jsonb
      or not(entry?&array['item_id','opportunity']) or jsonb_typeof(entry->'item_id') is distinct from 'string'
      or entry->>'item_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid batch item envelope' using errcode='22023';end if;
    id:=(entry->>'item_id')::uuid;if id=any(ids) then raise exception 'Duplicate item identity' using errcode='22023';end if;ids:=array_append(ids,id);
    opportunity:=entry->'opportunity';
    if octet_length(opportunity::text)>262144 then raise exception 'Opportunity exceeds envelope' using errcode='54000';end if;
    if opportunity?'merge_control' then
      if jsonb_typeof(opportunity->'merge_control') is distinct from 'object' or(opportunity->'merge_control')-array['corrections']<>'{}'::jsonb
        or jsonb_typeof(opportunity#>'{merge_control,corrections}') is distinct from 'array' then raise exception 'Invalid correction control' using errcode='22023';end if;
      for correction in select value from jsonb_array_elements(opportunity#>'{merge_control,corrections}') loop
        if jsonb_typeof(correction) is distinct from 'object' or correction-array['path','expected','reason']<>'{}'::jsonb
          or jsonb_typeof(correction->'path') is distinct from 'string' or jsonb_typeof(correction->'reason') is distinct from 'string' then raise exception 'Invalid correction shape' using errcode='22023';end if;
      end loop;
    end if;
    perform private.validate_opportunity_search_result(opportunity);
  end loop;
end;
$$;
revoke all on function private.prevalidate_adaptive_opportunities(jsonb) from public,anon,authenticated,service_role;

create function private.adaptive_batch_error(p_code text) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('adaptive_contract_version',1,'batch_schema_version',1,'accepted',false,'error',jsonb_build_object('code',case when p_code in(
    'authorization_revoked','scope_unavailable','inactive_run','invalid_batch','scope_oversized','idempotency_conflict','run_batch_limit') then p_code else 'invalid_batch' end,'retryable',false))
$$;
revoke all on function private.adaptive_batch_error(text) from public,anon,authenticated,service_role;

create function private.submit_adaptive_search_batch(p_run_id uuid,p_batch_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope jsonb;prior private.opportunity_search_adaptive_batches;run public.opportunity_search_runs;context private.opportunity_search_adaptive_contexts;
  plan jsonb;startup jsonb;expected jsonb;validation_expected jsonb;execution jsonb;execution_result jsonb;work jsonb:='[]';entry jsonb;item jsonb;opportunity jsonb;effective jsonb;attribution jsonb;
  correction jsonb;corrections jsonb;identity jsonb;receipt jsonb;discovery jsonb;roots jsonb;proposals jsonb;receipt_suggestions jsonb:='[]';incoming_proposal jsonb;existing_proposal public.opportunity_search_adaptive_proposals;
  payload_hash text;item_hash text;item_id_value uuid;ids uuid[]:='{}';deferred text[];code text;root text;field text;missing_expected boolean;correction_deferred boolean;
  primary_id uuid;primary_check jsonb;reported_shrunk boolean:=false;retention_deferred_value boolean;ordinal_value integer;manifest jsonb;batch_receipt_result jsonb;source_url text;source_registry uuid;
begin
  scope:=private.require_adaptive_search_scope(p_run_id,false);
  if p_batch_id is null or p_payload is null then return private.adaptive_batch_error('invalid_batch');end if;
  payload_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into prior from private.opportunity_search_adaptive_batches where run_id=p_run_id and batch_id=p_batch_id;
  if found then
    if prior.payload_hash<>payload_hash then return private.adaptive_batch_error('idempotency_conflict');end if;
    return private.adaptive_batch_receipt(p_run_id,p_batch_id);
  end if;
  if octet_length(p_payload::text)>524288 then raise exception 'Batch exceeds envelope' using errcode='54000';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['schema_version','query_plan','plan_hash','opportunities','execution','preference_suggestions','source_suggestions','query_suggestions']<>'{}'::jsonb
    or p_payload->'schema_version' is distinct from '1'::jsonb or not(p_payload?&array['opportunities','execution'])
    or jsonb_typeof(p_payload->'opportunities') is distinct from 'array' or jsonb_array_length(p_payload->'opportunities')>10
    or p_payload?'plan_hash' and(jsonb_typeof(p_payload->'plan_hash') is distinct from 'string' or p_payload->>'plan_hash'!~'^[0-9a-f]{64}$') then raise exception 'Use the closed batch contract' using errcode='22023';end if;
  select count(*)+1 into ordinal_value from private.opportunity_search_adaptive_batches where run_id=p_run_id;
  if ordinal_value>32 then return private.adaptive_batch_error('run_batch_limit');end if;
  if ordinal_value>1 and not(p_payload?'plan_hash') then raise exception 'Later batches copy their actual plan hash' using errcode='22023';end if;
  perform private.prevalidate_adaptive_opportunities(p_payload->'opportunities');
  proposals:=private.validate_adaptive_proposals(scope,p_payload);
  perform private.require_adaptive_search_scope(p_run_id,true);
  select * into run from public.opportunity_search_runs where id=p_run_id;
  startup:=private.begin_adaptive_opportunity_search(run.search_id,p_run_id);
  if startup->'compatible' is distinct from 'true'::jsonb then
    if startup#>>'{error,code}'='authorization_revoked' then raise exception 'Protected scope changed' using errcode='PZ002';end if;
    raise exception 'Adaptive startup is unavailable' using errcode='22023';end if;
  plan:=private.pin_adaptive_batch_plan(p_run_id,case when p_payload?'query_plan' then p_payload->'query_plan' else null end,p_payload->>'plan_hash');
  expected:=private.refresh_adaptive_execution_scope(p_run_id);
  if coalesce((expected->>'protected_scope_revoked')::boolean,false) then raise exception 'Protected scope changed' using errcode='PZ002';end if;
  execution:=private.normalize_adaptive_execution(p_run_id,p_payload->'execution');
  validation_expected:=expected;
  for entry in select value from jsonb_array_elements(execution->'checks') loop
    if entry->>'kind'='query' and not exists(select 1 from jsonb_array_elements(expected->'queries') q where q->>'query_id'=entry->>'query_id') then
      validation_expected:=jsonb_set(validation_expected,'{queries}',(validation_expected->'queries')||jsonb_build_array(jsonb_build_object('query_id',entry->'query_id','text_hash',entry->'text_hash')));reported_shrunk:=true;
    elsif entry->>'kind'='source' and(exists(select 1 from jsonb_array_elements(coalesce(expected->'authorized_source_skips','[]')) s where s->>'source_registry_id'=entry->>'source_registry_id')
      or exists(select 1 from jsonb_array_elements(plan#>'{document,queries}') q where q->>'source_registry_id'=entry->>'source_registry_id'
        and exists(select 1 from jsonb_array_elements(expected->'authorized_query_skips') s where s->>'query_id'=q->>'query_id'))
      or not exists(select 1 from public.opportunity_search_sources s where s.registry_id=(entry->>'source_registry_id')::uuid and s.user_id=run.user_id and s.search_id=run.search_id)) then
      validation_expected:=jsonb_set(validation_expected,'{sources}',(validation_expected->'sources')||jsonb_build_array(jsonb_build_object('registry_id',entry->'source_registry_id')));reported_shrunk:=true;
    end if;
  end loop;
  update public.opportunity_search_runs set execution_expectations=validation_expected where id=p_run_id;
  -- Reuse the exact AF-05 validator in a rolled-back subtransaction. No actual
  -- check, source metadata or catalogue write survives this validation probe.
  begin
    perform private.record_opportunity_search_execution(p_run_id,p_batch_id,execution);
    raise exception 'Validation probe complete' using errcode='PZ001';
  exception when sqlstate 'PZ001' then null;end;
  -- Prevalidate every proposed canonical record/attribution before the first
  -- catalogue write. Deferred correction inputs are never passed to v5.
  for entry in select value from jsonb_array_elements(p_payload->'opportunities') loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['item_id','opportunity','attribution','reusable_source']<>'{}'::jsonb
      or not(entry?&array['item_id','opportunity']) or jsonb_typeof(entry->'item_id') is distinct from 'string'
      or entry->>'item_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid batch item envelope' using errcode='22023';end if;
    item_id_value:=(entry->>'item_id')::uuid;
    if item_id_value=any(ids) then raise exception 'Duplicate batch item' using errcode='22023';end if;
    if exists(select 1 from private.opportunity_search_adaptive_items where run_id=p_run_id and item_id=item_id_value)
      or exists(select 1 from public.opportunity_search_receipts where run_id=p_run_id and item_id=item_id_value) then raise exception 'An item belongs to its original batch' using errcode='40001';end if;
    ids:=array_append(ids,item_id_value);opportunity:=entry->'opportunity';deferred:='{}';correction_deferred:=false;missing_expected:=false;
    if octet_length(opportunity::text)>262144 then raise exception 'Opportunity exceeds envelope' using errcode='54000';end if;
    if opportunity?'merge_control' then
      if jsonb_typeof(opportunity->'merge_control') is distinct from 'object' or(opportunity->'merge_control')-array['corrections']<>'{}'::jsonb
        or jsonb_typeof(opportunity#>'{merge_control,corrections}') is distinct from 'array' then raise exception 'Invalid correction control' using errcode='22023';end if;
      for correction in select value from jsonb_array_elements(opportunity#>'{merge_control,corrections}') loop
        if jsonb_typeof(correction) is distinct from 'object' or correction-array['path','expected','reason']<>'{}'::jsonb
          or jsonb_typeof(correction->'path') is distinct from 'string' or jsonb_typeof(correction->'reason') is distinct from 'string' then raise exception 'Invalid correction shape' using errcode='22023';end if;
        root:=split_part(correction->>'path','/',2);
        if not(correction?'expected') then missing_expected:=true;end if;
        if root not in('contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation') and(not(correction?'expected')
          or not private.adaptive_expected_safe(correction->'expected') or not private.opportunity_search_adaptive_text(correction->>'path',4000)) then correction_deferred:=true;end if;
      end loop;
    end if;
    effective:=opportunity-array['contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation'];
    foreach field in array array['contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation'] loop if opportunity?field then deferred:=array_append(deferred,field);end if;end loop;
    if opportunity?'merge_control' then
      corrections:='[]';
      for correction in select value from jsonb_array_elements(opportunity#>'{merge_control,corrections}') loop
        root:=split_part(correction->>'path','/',2);
        if root in('contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation') then
          if not(root=any(deferred)) then deferred:=array_append(deferred,root);end if;
        else corrections:=corrections||jsonb_build_array(correction);end if;
      end loop;
      effective:=effective-'merge_control';if jsonb_array_length(corrections)>0 and not correction_deferred then effective:=effective||jsonb_build_object('merge_control',jsonb_build_object('corrections',corrections));end if;
    end if;
    attribution:=coalesce(entry->'attribution','{}'::jsonb);perform private.validate_adaptive_attribution(p_run_id,attribution,execution);
    primary_id:=coalesce((attribution->>'primary_check_id')::uuid,(attribution#>>'{execution_refs,0}')::uuid);primary_check:=null;
    if primary_id is not null then
      select c into primary_check from jsonb_array_elements(execution->'checks') c where c->>'check_id'=primary_id::text;
      if primary_check is null then select jsonb_build_object('kind',e.kind,'query_id',e.query_id,'source_registry_id',e.source_registry_id) into primary_check from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=primary_id;end if;
    end if;
    code:=case when correction_deferred then 'correction_deferred' when primary_check->>'kind'='query' and exists(select 1 from jsonb_array_elements(expected->'authorized_query_skips') s where s->>'query_id'=primary_check->>'query_id')
      or primary_check->>'kind'='source' and exists(select 1 from jsonb_array_elements(coalesce(expected->'authorized_source_skips','[]')) s where s->>'source_registry_id'=primary_check->>'source_registry_id') then 'scope_changed' else null end;
    source_url:=null;source_registry:=null;retention_deferred_value:=false;
    if entry?'reusable_source' then
      if jsonb_typeof(entry->'reusable_source') is distinct from 'object' or(entry->'reusable_source')-array['listing_url','registry_id']<>'{}'::jsonb
        or jsonb_typeof(entry#>'{reusable_source,listing_url}') is distinct from 'string' or private.opportunity_feedback_safe_url(entry#>>'{reusable_source,listing_url}') is null then raise exception 'Invalid reusable source witness' using errcode='22023';end if;
      source_url:=private.opportunity_feedback_safe_url(entry#>>'{reusable_source,listing_url}');
      if(entry->'reusable_source')?'registry_id' then
        source_registry:=(entry#>>'{reusable_source,registry_id}')::uuid;
        if not exists(select 1 from public.opportunity_search_sources s where s.registry_id=source_registry and s.user_id=run.user_id and s.search_id=run.search_id) then raise exception 'Source scope denied' using errcode='42501';end if;
        if exists(select 1 from public.opportunity_search_sources s where s.registry_id=source_registry and s.listing_url is not null and s.listing_url<>source_url) then
          source_url:=null;source_registry:=null;retention_deferred_value:=true;
        end if;
      end if;
    end if;
    work:=work||jsonb_build_array(jsonb_build_object('item_id',item_id_value,'payload_hash',encode(sha256(convert_to(entry::text,'UTF8')),'hex'),'opportunity',effective,'attribution',attribution,
      'deferred_fields',to_jsonb(deferred),'conflict_code',code,'reusable_listing_url',source_url,'reusable_registry_id',source_registry,'retention_deferred',retention_deferred_value));
  end loop;
  execution_result:=private.record_opportunity_search_execution(p_run_id,p_batch_id,execution);
  if reported_shrunk then expected:=expected||'{"scope_report_incomplete":true}';end if;
  update public.opportunity_search_runs set execution_expectations=expected,execution_report_status=case when reported_shrunk then 'partial' else execution_report_status end where id=p_run_id;
  insert into private.opportunity_search_adaptive_batches(run_id,batch_id,user_id,search_id,ordinal,payload_hash,plan_id,plan_hash,item_ids,query_versions,execution_status,recorded_checks,retained_backlog,omitted_backlog,execution_incomplete)
    values(p_run_id,p_batch_id,run.user_id,run.search_id,ordinal_value,payload_hash,(plan->>'id')::uuid,plan->>'plan_hash',ids,
      (select coalesce(jsonb_agg(jsonb_build_object('query_id',q->'query_id','text_hash',q->'text_hash') order by q->>'query_id'),'[]') from jsonb_array_elements(plan#>'{document,queries}') q),
      case when reported_shrunk then 'partial' else execution_result->>'status' end,(execution_result->>'recorded_checks')::integer,(execution_result->>'retained_backlog')::integer,(execution_result->>'omitted_backlog')::integer,
      reported_shrunk or(execution_result->>'incomplete')::boolean);
  for item in select value from jsonb_array_elements(work) loop
    item_id_value:=(item->>'item_id')::uuid;code:=item->>'conflict_code';receipt:=null;discovery:=null;roots:='{}';
    if code is null then
      begin
        identity:='{}';
        foreach field in array array['opportunity_key','institution','vacancy_id','official_url','source_url','application_url'] loop
          if jsonb_typeof(item#>array['opportunity',field])='string' and btrim(item#>>array['opportunity',field])<>'' then identity:=identity||jsonb_build_object(field,item#>array['opportunity',field]);end if;
        end loop;
        if item#>'{opportunity,data,url_roles}' is not null then identity:=identity||jsonb_build_object('data',jsonb_build_object('url_roles',item#>'{opportunity,data,url_roles}'));end if;
        perform private.inspect_opportunity_search_result(p_run_id,identity);
        receipt:=private.submit_opportunity_search_result(p_run_id,item_id_value,item->'opportunity');
        discovery:=private.record_opportunity_search_discovery(p_run_id,item_id_value,item->'attribution');
        roots:=private.adaptive_accepted_roots(p_run_id,item_id_value);
      exception when unique_violation or serialization_failure then code:='identity_conflict';receipt:=null;discovery:=null;
        when check_violation then code:='insufficient_evidence';receipt:=null;discovery:=null;
      end;
    end if;
    insert into private.opportunity_search_adaptive_items(run_id,item_id,batch_id,payload_hash,opportunity_id,outcome,canonical_outcome,conflict_code,accepted_roots,deferred_fields,discovery_id,reusable_listing_url,reusable_registry_id,retention_deferred)
      values(p_run_id,item_id_value,p_batch_id,item->>'payload_hash',(receipt->>'opportunity_id')::uuid,case when code is null then 'saved' else 'unresolved' end,receipt->>'outcome',code,roots,
        array(select jsonb_array_elements_text(item->'deferred_fields')),(discovery->>'discovery_id')::uuid,item->>'reusable_listing_url',(item->>'reusable_registry_id')::uuid,(item->>'retention_deferred')::boolean);
  end loop;
  for incoming_proposal in select value from jsonb_array_elements(proposals) loop
    select * into existing_proposal from public.opportunity_search_adaptive_proposals p where p.user_id=run.user_id and p.search_id=run.search_id and p.suggestion_id=(incoming_proposal->>'suggestion_id')::uuid;
    if not found then
      insert into public.opportunity_search_adaptive_proposals(user_id,search_id,suggestion_id,run_id,batch_id,kind,proposal,evidence_refs,status,reason)
        values(run.user_id,run.search_id,(incoming_proposal->>'suggestion_id')::uuid,p_run_id,p_batch_id,incoming_proposal->>'kind',incoming_proposal->'proposal',
          array(select (r#>>'{}')::uuid from jsonb_array_elements(incoming_proposal->'evidence_refs') r),incoming_proposal->>'status',incoming_proposal->>'reason') returning * into existing_proposal;
      if incoming_proposal->>'kind'='preference' and incoming_proposal->>'status'='pending' then perform private.propose_opportunity_search_preference(run.user_id,run.search_id,(incoming_proposal->>'suggestion_id')::uuid,incoming_proposal->'proposal');end if;
    end if;
    receipt_suggestions:=receipt_suggestions||jsonb_build_array(jsonb_build_object('suggestion_id',existing_proposal.suggestion_id,'kind',existing_proposal.kind,'status',existing_proposal.status,'reason',existing_proposal.reason));
  end loop;
  manifest:=private.opportunity_search_adaptive_manifest(p_run_id);
  update private.opportunity_search_adaptive_batches set manifest_hash=manifest->>'manifest_hash',suggestions=receipt_suggestions where run_id=p_run_id and batch_id=p_batch_id;
  batch_receipt_result:=private.adaptive_batch_receipt(p_run_id,p_batch_id);
  update private.opportunity_search_adaptive_batches set result=batch_receipt_result where run_id=p_run_id and batch_id=p_batch_id;
  return batch_receipt_result;
exception when insufficient_privilege then return private.adaptive_batch_error('authorization_revoked');
  when sqlstate 'PZ002' then
    begin
      perform private.require_adaptive_search_scope(p_run_id,false);
      update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',summary='{"adaptive_status":"source_scope_changed","coverage":"partial"}' where id=p_run_id and status='running';
      return private.adaptive_batch_error('scope_unavailable');
    exception when insufficient_privilege then return private.adaptive_batch_error('authorization_revoked');end;
  when object_not_in_prerequisite_state then return private.adaptive_batch_error('inactive_run');
  when program_limit_exceeded then return private.adaptive_batch_error('scope_oversized');
  when serialization_failure then return private.adaptive_batch_error('idempotency_conflict');
  when deadlock_detected then raise;
  when others then return private.adaptive_batch_error('invalid_batch');
end;
$$;
revoke all on function private.submit_adaptive_search_batch(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

comment on table private.opportunity_search_adaptive_batches is 'Immutable safe batch manifest/receipt metadata. No raw input payload, canonical snapshot, people or nested decision paths are exported.';
comment on table public.opportunity_search_adaptive_proposals is 'Owner-readable inert future suggestions. A pending suggestion never executes a preference, source or query change.';
commit;
