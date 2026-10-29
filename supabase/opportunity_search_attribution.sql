-- AF-05: actual execution and immutable owner-specific assessment attribution.
-- Requires AF-01–04 plus the existing canonical v5 receipt/audit contract.
-- No canonical records, historical imports, tasks or notifications are changed.
begin;

do $$ begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.opportunity_search_runs'::regclass and c.contype in('p','u') and c.conkey=array[
    (select attnum from pg_attribute where attrelid=c.conrelid and attname='user_id'),
    (select attnum from pg_attribute where attrelid=c.conrelid and attname='search_id'),
    (select attnum from pg_attribute where attrelid=c.conrelid and attname='id')]::smallint[]) then
    alter table public.opportunity_search_runs add constraint opportunity_search_run_owner_search unique(user_id,search_id,id);
  end if;
end $$;
alter table public.opportunity_search_runs
  add column execution_expectations jsonb,
  add column execution_report_status text not null default 'unreported' check(execution_report_status in('unreported','complete','partial','failed')),
  add column execution_backlog jsonb not null default '[]' check(jsonb_typeof(execution_backlog)='array' and jsonb_array_length(execution_backlog)<=64),
  add column execution_backlog_omitted integer not null default 0 check(execution_backlog_omitted>=0),
  add column execution_report_overflow boolean not null default false;

create table public.opportunity_search_executions (
  run_id uuid not null,
  check_id uuid not null,
  user_id uuid not null,
  search_id uuid not null,
  kind text not null check(kind in('query','source')),
  query_id uuid,
  text_hash text check(text_hash is null or text_hash~'^[0-9a-f]{64}$'),
  source_registry_id uuid,
  attempted_at timestamptz not null check(isfinite(attempted_at)),
  status text not null check(status in('complete','blocked','failed','partial','paginated','dynamic')),
  results_count integer check(results_count>=0),
  failure_reason text check(failure_reason in('access_denied','network_error','pagination_limit','dynamic_content','budget_exhausted','unknown')),
  payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(run_id,check_id),
  foreign key(user_id,search_id,run_id) references public.opportunity_search_runs(user_id,search_id,id) on delete cascade,
  check(kind='query' and query_id is not null and text_hash is not null or kind='source' and source_registry_id is not null and query_id is null and text_hash is null),
  check(status<>'complete' or results_count is not null)
);
create index opportunity_execution_owner_search on public.opportunity_search_executions(user_id,search_id);

create table public.opportunity_search_execution_receipts (
  run_id uuid not null,
  report_id uuid not null,
  user_id uuid not null,
  search_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  primary key(run_id,report_id),
  foreign key(user_id,search_id,run_id) references public.opportunity_search_runs(user_id,search_id,id) on delete cascade
);
create index opportunity_execution_receipt_owner on public.opportunity_search_execution_receipts(user_id,search_id);

create table public.opportunity_search_discoveries (
  discovery_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid not null,
  run_id uuid not null,
  item_id uuid not null,
  -- Audit identity intentionally has no live-catalogue FK: approved canonical
  -- rollback/deletion must not be blocked by an attribution record.
  opportunity_id uuid not null,
  query_plan_id uuid,
  base_revision integer not null,
  feedback_revision bigint not null,
  preference_revision bigint not null,
  protocol_version text not null,
  primary_discovery boolean not null,
  execution_refs uuid[] not null default '{}',
  primary_check_id uuid,
  discovered_at timestamptz check(discovered_at is null or isfinite(discovered_at)),
  encountered_at timestamptz check(encountered_at is null or isfinite(encountered_at)),
  recorded_at timestamptz not null default clock_timestamp(),
  original_assessment jsonb,
  assessment_score numeric generated always as ((original_assessment->>'score')::numeric) stored,
  assessment_scale_min numeric generated always as ((original_assessment->>'scale_min')::numeric) stored,
  assessment_scale_max numeric generated always as ((original_assessment->>'scale_max')::numeric) stored,
  assessment_recorded_at timestamptz,
  assessment_verified_at timestamptz,
  assessment_version text,
  assessment_evidence jsonb not null default '[]',
  verified_at timestamptz,
  institution text,
  topics text[] not null default '{}',
  recommendation_eligible boolean,
  recommendation_generated boolean not null default false,
  recommendation_policy_violation boolean not null default false,
  updated_only boolean not null default false,
  delivery_status text not null default 'unknown' check(delivery_status='unknown'),
  deadline_quality jsonb not null,
  payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
  unique(run_id,item_id),
  foreign key(user_id,search_id,run_id) references public.opportunity_search_runs(user_id,search_id,id) on delete cascade,
  foreign key(run_id,item_id) references public.opportunity_search_receipts(run_id,item_id) on delete cascade,
  check(original_assessment is null or jsonb_typeof(original_assessment)='object' and original_assessment?&array['score','scale_min','scale_max']
    and jsonb_typeof(original_assessment->'score') in('number','null') and original_assessment->'scale_min'='0'::jsonb and original_assessment->'scale_max'='10'::jsonb
    and ((original_assessment->>'score')::numeric between 0 and 10 or original_assessment->'score'='null'::jsonb))
);
create unique index opportunity_primary_discovery on public.opportunity_search_discoveries(user_id,opportunity_id) where primary_discovery;
create index opportunity_discovery_owner_search on public.opportunity_search_discoveries(user_id,search_id);
create index opportunity_discovery_assessment_candidates on public.opportunity_search_discoveries(user_id,opportunity_id,assessment_recorded_at desc) where assessment_verified_at is not null;

do $$ declare relation text;begin
  foreach relation in array array['opportunity_search_executions','opportunity_search_execution_receipts','opportunity_search_discoveries'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
    execute format('grant select on public.%I to authenticated',relation);
    execute format('create policy "Owner search attribution" on public.%I for select to authenticated using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>''is_anonymous'')::boolean,false))',relation);
  end loop;
end $$;

create function public.job_workspace_execution_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Execution audit records are immutable' using errcode='23514';end;
$$;
revoke all on function public.job_workspace_execution_immutable() from public,anon,authenticated,service_role;
create trigger opportunity_execution_immutable before update on public.opportunity_search_executions for each row execute function public.job_workspace_execution_immutable();
create trigger opportunity_execution_receipt_immutable before update on public.opportunity_search_execution_receipts for each row execute function public.job_workspace_execution_immutable();

create function public.job_workspace_discovery_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(new)-array['verified_at','assessment_verified_at','assessment_score','assessment_scale_min','assessment_scale_max'])
    is distinct from (to_jsonb(old)-array['verified_at','assessment_verified_at','assessment_score','assessment_scale_min','assessment_scale_max']) then
    raise exception 'Original discovery assessments and attribution are immutable' using errcode='23514'; end if;
  if new.verified_at is not null and not exists(select 1 from public.opportunity_search_receipts r join private.opportunity_search_merge_audit a
    on a.run_id=r.run_id and a.item_id=r.item_id where r.run_id=new.run_id and r.item_id=new.item_id and r.user_id=new.user_id
      and r.opportunity_id=new.opportunity_id and r.verified_at=new.verified_at and a.rolled_back_at is null) then
    raise exception 'Canonical verification is unavailable' using errcode='23514'; end if;
  if new.assessment_verified_at is not null and (new.original_assessment is null or new.assessment_verified_at is distinct from new.verified_at) then
    raise exception 'Assessment verification requires exact canonical proof' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_discovery_immutable() from public,anon,authenticated,service_role;
create trigger opportunity_discovery_immutable before update on public.opportunity_search_discoveries for each row execute function public.job_workspace_discovery_immutable();

create function private.invalidate_opportunity_assessment_proof() returns trigger
language plpgsql security invoker set search_path='' as $$
declare invalidate boolean:=tg_op='DELETE';
begin
  if tg_op<>'DELETE' then
    if tg_table_schema='private' then invalidate:=new.rolled_back_at is not null;
    else invalidate:=new.verified_at is null;end if;
  end if;
  if invalidate then
    update public.opportunity_search_discoveries set verified_at=null,assessment_verified_at=null where run_id=old.run_id and item_id=old.item_id;
  end if;
  return null;
end;
$$;
revoke all on function private.invalidate_opportunity_assessment_proof() from public,anon,authenticated,service_role;
create trigger opportunity_assessment_rollback after update of rolled_back_at or delete on private.opportunity_search_merge_audit
  for each row execute function private.invalidate_opportunity_assessment_proof();
create trigger opportunity_assessment_unverify after update of verified_at or delete on public.opportunity_search_receipts
  for each row execute function private.invalidate_opportunity_assessment_proof();

create function public.job_workspace_assessment_invalidate_feedback() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=old.user_id;
  elsif (new.verified_at,new.assessment_verified_at) is distinct from (old.verified_at,old.assessment_verified_at) then
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_assessment_invalidate_feedback() from public,anon,authenticated,service_role;
create trigger opportunity_assessment_invalidate_feedback after update or delete on public.opportunity_search_discoveries for each row execute function public.job_workspace_assessment_invalidate_feedback();

create function private.prepare_opportunity_search_execution(p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.opportunity_search_runs;plan public.opportunity_search_query_plans;expectations jsonb;
begin
  select * into run from public.opportunity_search_runs where id=p_run_id for update;
  if not found then raise exception 'Search run unavailable' using errcode='42501'; end if;
  expectations:=run.execution_expectations;
  if expectations is null then
    expectations:=jsonb_build_object('prepared_at',clock_timestamp(),'pending_queries',true,'query_plan_id',null,'queries','[]'::jsonb,
      'sources',private.due_opportunity_search_sources(run.user_id,run.search_id,clock_timestamp()),'late_prepared',false);
  end if;
  if (expectations->>'pending_queries')::boolean and run.query_plan_id is not null then
    if exists(select 1 from public.opportunity_search_executions where run_id=p_run_id and kind='query') then
      raise exception 'Query expectations cannot change after query execution' using errcode='23514'; end if;
    select * into plan from public.opportunity_search_query_plans where id=run.query_plan_id and user_id=run.user_id and search_id=run.search_id;
    if not found then raise exception 'Pinned query plan unavailable' using errcode='23514'; end if;
    expectations:=expectations||jsonb_build_object('pending_queries',false,'query_plan_id',plan.id,
      'queries',(select jsonb_agg(jsonb_build_object('query_id',q->'query_id','text_hash',q->'text_hash') order by q->>'query_id') from jsonb_array_elements(plan.document->'queries') q));
  end if;
  update public.opportunity_search_runs set execution_expectations=expectations where id=p_run_id;
  return expectations;
end;
$$;
revoke all on function private.prepare_opportunity_search_execution(uuid) from public,anon,authenticated,service_role;

create function private.record_opportunity_search_execution(p_run_id uuid,p_report_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.opportunity_search_runs;prior public.opportunity_search_execution_receipts;existing public.opportunity_search_executions;
  fingerprint text;entry jsonb;normalized jsonb;checks jsonb:='[]';backlog jsonb;item jsonb;result jsonb;expectations jsonb;
  check_uuid uuid;query_uuid uuid;registry uuid;attempt timestamptz;status text;failure text;number integer;check_count integer:=0;
  omitted integer:=0;covered boolean;terminal text;complete_requested boolean;late boolean:=false;
begin
  if p_report_id is null or p_payload is null then raise exception 'Report identity and payload required' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into prior from public.opportunity_search_execution_receipts where run_id=p_run_id and report_id=p_report_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception 'Report identity already has a different payload' using errcode='40001';end if;
    return prior.result;
  end if;
  select * into run from public.opportunity_search_runs where id=p_run_id for update;
  if not found or run.status<>'running' then raise exception 'An active search run is required' using errcode='22023';end if;
  -- Recheck after serialization, including a response lost after commit.
  select * into prior from public.opportunity_search_execution_receipts where run_id=p_run_id and report_id=p_report_id;
  if found then
    if prior.payload_hash<>fingerprint then raise exception 'Report identity already has a different payload' using errcode='40001';end if;
    return prior.result;
  end if;
  if octet_length(p_payload::text)>524288 or jsonb_typeof(p_payload->'checks')='array' and jsonb_array_length(p_payload->'checks')>128
    or jsonb_typeof(p_payload->'backlog')='array' and jsonb_array_length(p_payload->'backlog')>64 then
    update public.opportunity_search_runs set execution_report_status='partial',execution_report_overflow=true where id=p_run_id;
    result:=jsonb_build_object('run_id',p_run_id,'report_id',p_report_id,'status','incomplete','recorded_checks',0,
      'reason','report_bounds_exceeded','maximum_checks',128,'maximum_backlog',64,'maximum_bytes',524288);
    insert into public.opportunity_search_execution_receipts(run_id,report_id,user_id,search_id,payload_hash,result) values(p_run_id,p_report_id,run.user_id,run.search_id,fingerprint,result);
    return result;
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['checks','backlog','complete']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'checks') is distinct from 'array'
    or p_payload?'backlog' and jsonb_typeof(p_payload->'backlog') is distinct from 'array'
    or p_payload?'complete' and jsonb_typeof(p_payload->'complete') is distinct from 'boolean' then
    raise exception 'Use the bounded execution report contract' using errcode='22023';end if;
  complete_requested:=coalesce((p_payload->>'complete')::boolean,false);
  late:=run.execution_expectations is null;
  expectations:=private.prepare_opportunity_search_execution(p_run_id);
  if late then
    expectations:=expectations||'{"late_prepared":true}'::jsonb;
    update public.opportunity_search_runs set execution_expectations=expectations where id=p_run_id;
  end if;
  for entry in select e.value from jsonb_array_elements(p_payload->'checks') e loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['check_id','kind','query_id','text_hash','source_registry_id','attempted_at','status','results_count','failure_reason']<>'{}'::jsonb
      or not(entry?&array['check_id','kind','attempted_at','status']) or jsonb_typeof(entry->'check_id') is distinct from 'string'
      or entry->>'check_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or entry->>'kind' not in('query','source') or jsonb_typeof(entry->'kind') is distinct from 'string'
      or jsonb_typeof(entry->'status') is distinct from 'string' or entry->>'status' not in('complete','blocked','failed','partial','paginated','dynamic') then
      raise exception 'Invalid executed check' using errcode='22023';end if;
    check_uuid:=(entry->>'check_id')::uuid;status:=entry->>'status';query_uuid:=null;registry:=null;
    attempt:=private.opportunity_feedback_time(entry->>'attempted_at');
    if attempt is null or attempt>clock_timestamp()+interval '5 minutes' or attempt<run.created_at-interval '5 minutes' then
      raise exception 'Record the actual bounded run check time' using errcode='22023';end if;
    if entry?'source_registry_id' then
      if jsonb_typeof(entry->'source_registry_id') is distinct from 'string' or entry->>'source_registry_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid source check identity' using errcode='22023';end if;
      registry:=(entry->>'source_registry_id')::uuid;
      if not exists(select 1 from public.opportunity_search_sources where registry_id=registry and user_id=run.user_id and search_id=run.search_id)
        and not exists(select 1 from jsonb_array_elements(expectations->'sources') s where s->>'registry_id'=registry::text) then
        raise exception 'Source unavailable' using errcode='42501';end if;
    end if;
    if entry->>'kind'='query' then
      if (expectations->>'pending_queries')::boolean or jsonb_typeof(entry->'query_id') is distinct from 'string' or entry->>'query_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(entry->'text_hash') is distinct from 'string' then raise exception 'Pin the actual query plan before recording query execution' using errcode='22023';end if;
      query_uuid:=(entry->>'query_id')::uuid;
      if not exists(select 1 from jsonb_array_elements(expectations->'queries') q where q->>'query_id'=query_uuid::text and q->>'text_hash'=entry->>'text_hash') then
        raise exception 'Executed query does not match the pinned query version' using errcode='22023';end if;
      if registry is not null and not exists(select 1 from public.opportunity_search_query_plans p cross join lateral jsonb_array_elements(p.document->'queries') q
        where p.id=run.query_plan_id and q->>'query_id'=query_uuid::text and q->>'source_registry_id'=registry::text) then
        raise exception 'Query source target does not match its pinned plan' using errcode='22023';end if;
    elsif registry is null or entry?'query_id' or entry?'text_hash' then raise exception 'A direct source check requires only its registry identity' using errcode='22023';end if;
    number:=null;
    if entry?'results_count' and entry->'results_count'<>'null'::jsonb then
      if jsonb_typeof(entry->'results_count') is distinct from 'number' or (entry->>'results_count')::numeric<>trunc((entry->>'results_count')::numeric)
        or (entry->>'results_count')::numeric not between 0 and 1000000 then
        raise exception 'Results count must be a bounded nonnegative integer' using errcode='22023';end if;
      number:=(entry->>'results_count')::integer;
    end if;
    if status='complete' and number is null then raise exception 'A complete check requires its actual result count, including zero' using errcode='22023';end if;
    failure:=entry->>'failure_reason';
    if failure is not null and failure not in('access_denied','network_error','pagination_limit','dynamic_content','budget_exhausted','unknown') then
      raise exception 'Use a non-sensitive failure code' using errcode='22023';end if;
    normalized:=jsonb_build_object('check_id',check_uuid,'kind',entry->>'kind','query_id',query_uuid,'text_hash',entry->>'text_hash',
      'source_registry_id',registry,'attempted_at',attempt,'status',status,'results_count',number,'failure_reason',failure);
    if exists(select 1 from jsonb_array_elements(checks) e where e->>'check_id'=check_uuid::text) then
      raise exception 'A check identity occurs twice in one report' using errcode='22023';end if;
    checks:=checks||jsonb_build_array(normalized);
  end loop;
  backlog:=run.execution_backlog;
  for entry in select e.value from jsonb_array_elements(coalesce(p_payload->'backlog','[]')) e loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['candidate_id','url','reason']<>'{}'::jsonb
      or jsonb_typeof(entry->'candidate_id') is distinct from 'string' or entry->>'candidate_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'reason') is distinct from 'string' or entry->>'reason' not in('needs_verification','unreachable','identity_ambiguous','deadline_uncertain','budget_exhausted','pagination_limit','dynamic_content','unsafe_reference') then
      raise exception 'Use a bounded candidate identity and non-sensitive reason code' using errcode='22023';end if;
    item:=jsonb_build_object('candidate_id',(entry->>'candidate_id')::uuid,'reason',entry->>'reason');
    if entry?'url' then
      if private.opportunity_feedback_safe_url(entry->>'url') is not null then item:=item||jsonb_build_object('url',private.opportunity_feedback_safe_url(entry->>'url'));
      else item:=item||'{"reason":"unsafe_reference"}'::jsonb;end if;
    end if;
    if exists(select 1 from jsonb_array_elements(backlog) b where b->>'candidate_id'=item->>'candidate_id') then
      if exists(select 1 from jsonb_array_elements(backlog) b where b->>'candidate_id'=item->>'candidate_id' and b<>item) then
        raise exception 'Candidate identity already has different details' using errcode='40001';end if;
      continue;
    end if;
    if jsonb_array_length(backlog)<64 then backlog:=backlog||jsonb_build_array(item);else omitted:=omitted+1;end if;
  end loop;
  for entry in select e.value from jsonb_array_elements(checks) e loop
    fingerprint:=encode(sha256(convert_to(entry::text,'UTF8')),'hex');
    select * into existing from public.opportunity_search_executions where run_id=p_run_id and check_id=(entry->>'check_id')::uuid;
    if found then
      if existing.payload_hash<>fingerprint then raise exception 'Check identity already has a different payload' using errcode='40001';end if;
      continue;
    end if;
    insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,source_registry_id,attempted_at,status,results_count,failure_reason,payload_hash)
      values(p_run_id,(entry->>'check_id')::uuid,run.user_id,run.search_id,entry->>'kind',(entry->>'query_id')::uuid,entry->>'text_hash',
        (entry->>'source_registry_id')::uuid,(entry->>'attempted_at')::timestamptz,entry->>'status',(entry->>'results_count')::integer,entry->>'failure_reason',fingerprint);
    check_count:=check_count+1;
    if entry->>'kind'='source' then
      update public.opportunity_search_sources set last_attempted_at=(entry->>'attempted_at')::timestamptz,
        last_successful_at=case when entry->>'status'='complete' then (entry->>'attempted_at')::timestamptz else last_successful_at end,
        status=case when entry->>'status'='complete' then 'checked' when entry->>'status'='blocked' then 'blocked' else 'incomplete' end
        where registry_id=(entry->>'source_registry_id')::uuid and user_id=run.user_id and search_id=run.search_id
          and (greatest(last_attempted_at,last_successful_at) is null or greatest(last_attempted_at,last_successful_at)<=(entry->>'attempted_at')::timestamptz);
    end if;
  end loop;
  -- Resolution requires an actual separately verified canonical item receipt.
  select coalesce(jsonb_agg(b),'[]'::jsonb) into backlog from jsonb_array_elements(backlog) b where not exists(
    select 1 from public.opportunity_search_receipts r join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id
    where r.run_id=p_run_id and r.user_id=run.user_id and r.item_id=(b->>'candidate_id')::uuid
      and a.opportunity_id=r.opportunity_id and r.verified_at is not null and a.rolled_back_at is null);
  covered:=not (expectations->>'pending_queries')::boolean and not coalesce((expectations->>'late_prepared')::boolean,false)
    and not exists(select 1 from jsonb_array_elements(expectations->'queries') q where not exists(select 1 from public.opportunity_search_executions e
      where e.run_id=p_run_id and e.kind='query' and e.query_id=(q->>'query_id')::uuid and e.text_hash=q->>'text_hash' and e.status='complete'))
    and not exists(select 1 from jsonb_array_elements(expectations->'sources') s where not exists(select 1 from public.opportunity_search_executions e
      where e.run_id=p_run_id and e.kind='source' and e.source_registry_id=(s->>'registry_id')::uuid and e.status='complete'))
    and not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.status<>'complete' and not exists(
      select 1 from public.opportunity_search_executions resolved where resolved.run_id=e.run_id and resolved.kind=e.kind and resolved.status='complete'
        and resolved.attempted_at>=e.attempted_at and (e.kind='query' and resolved.query_id=e.query_id and resolved.text_hash=e.text_hash
          or e.kind='source' and resolved.source_registry_id=e.source_registry_id)));
  terminal:=case when complete_requested and covered and jsonb_array_length(backlog)=0 and omitted=0 and not run.execution_report_overflow then 'complete'
    when not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.status in('complete','partial','paginated','dynamic'))
      and exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id) then 'failed' else 'partial' end;
  update public.opportunity_search_runs set execution_report_status=terminal,execution_backlog=backlog,
    execution_backlog_omitted=execution_backlog_omitted+omitted,execution_report_overflow=execution_report_overflow or omitted>0 where id=p_run_id;
  result:=jsonb_build_object('run_id',p_run_id,'report_id',p_report_id,'status',terminal,'recorded_checks',check_count,
    'retained_backlog',jsonb_array_length(backlog),'omitted_backlog',omitted,'incomplete',terminal<>'complete');
  insert into public.opportunity_search_execution_receipts(run_id,report_id,user_id,search_id,payload_hash,result)
    values(p_run_id,p_report_id,run.user_id,run.search_id,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
  return result;
end;
$$;
revoke all on function private.record_opportunity_search_execution(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.opportunity_search_deadline_quality(p_date date,p_time time,p_zone text,p_original text,p_availability text,
  p_verified boolean,p_discovered_at timestamptz,p_checked_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare earliest timestamptz;latest timestamptz;exact timestamptz;wall timestamp;nominal timestamptz;probe timestamptz;candidate timestamptz;
  offset_value interval;hours integer;precision text:='unknown';assumption text;lead numeric;remaining numeric;eligible boolean;upper_exclusive boolean:=false;
begin
  if p_date is not null or p_original is not null or p_availability is not null then
    exact:=private.opportunity_feedback_time(p_original);
    if exact is not null and (p_date is null or substr(p_original,1,10)=p_date::text)
      and (p_time is null or (p_original::timestamp)::time=p_time) then
      earliest:=exact;latest:=exact;precision:='exact_offset';
    elsif p_date is not null and p_zone is not null and exists(select 1 from pg_timezone_names where name=p_zone) then
      wall:=p_date+coalesce(p_time,'00:00'::time);nominal:=wall at time zone 'UTC';
      foreach hours in array array[-36,0,36] loop
        probe:=nominal+make_interval(hours=>hours);
        offset_value:=(probe at time zone p_zone)-(probe at time zone 'UTC');candidate:=nominal-offset_value;
        if candidate at time zone p_zone=wall then
          earliest:=case when earliest is null then candidate else least(earliest,candidate) end;
          latest:=case when latest is null then candidate else greatest(latest,candidate) end;
        end if;
      end loop;
      if earliest is not null then
        if p_time is null then
          precision:='date_only_conservative';assumption:='start_of_local_day';
          upper_exclusive:=true;
          latest:=((p_date+1)::timestamp at time zone p_zone);
        elsif earliest<>latest then precision:='ambiguous_bound';assumption:='earliest_repeated_local_time';
        else precision:='official_local';end if;
      end if;
    elsif coalesce(p_verified,false) and p_date is null and lower(btrim(coalesce(p_availability,''))) in('rolling','open_until_filled','open-until-filled','open until filled') then
      precision:='rolling';eligible:=true;
    end if;
  end if;
  if earliest is not null then
    if p_discovered_at is not null then lead:=extract(epoch from(earliest-p_discovered_at))/3600;end if;
    if p_checked_at is not null then remaining:=extract(epoch from(earliest-p_checked_at))/3600;eligible:=remaining>=72;end if;
    if not coalesce(p_verified,false) then precision:='provisional';assumption:='unverified_deadline';eligible:=null;end if;
  end if;
  return jsonb_build_object('precision',precision,'deadline_at',earliest,'deadline_latest_at',latest,
    'official_deadline_at',case when precision in('exact_offset','official_local') then earliest else null end,
    'deadline_lower_at',earliest,'deadline_upper_at',latest,'deadline_upper_exclusive',upper_exclusive,
    'lead_time_hours',case when precision in('exact_offset','official_local') then lead else null end,
    'lead_time_lower_hours',lead,'lead_time_upper_hours',case when latest is not null and p_discovered_at is not null then extract(epoch from(latest-p_discovered_at))/3600 else null end,
    'provisional',precision in('date_only_conservative','ambiguous_bound','provisional'),'late_discovery',case when lead is null or not coalesce(p_verified,false) then null when lead>=72 then false
      when latest is not null and (extract(epoch from(latest-p_discovered_at))/3600<72
        or precision='date_only_conservative' and extract(epoch from(latest-p_discovered_at))/3600=72) then true else null end,
    'late_discovery_status',case when lead is null or not coalesce(p_verified,false) then 'unknown' when lead>=72 then 'not_late'
      when latest is not null and (extract(epoch from(latest-p_discovered_at))/3600<72
        or precision='date_only_conservative' and extract(epoch from(latest-p_discovered_at))/3600=72) then 'confirmed' else 'possible' end,
    'recommendation_remaining_hours',remaining,'recommendation_eligible',eligible,'assumption',assumption);
end;
$$;
revoke all on function private.opportunity_search_deadline_quality(date,time,text,text,text,boolean,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.record_opportunity_search_discovery(p_run_id uuid,p_item_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.opportunity_search_runs;receipt record;audit record;facts record;support record;
  existing public.opportunity_search_discoveries;saved public.opportunity_search_discoveries;plan public.opportunity_search_query_plans;
  fingerprint text;refs uuid[]:='{}';referenced_check uuid;primary_check uuid;discovered timestamptz;encountered timestamptz;event jsonb;
  primary_value boolean;assessment jsonb;evidence jsonb;institution_value text;topic_values text[];deadline jsonb;verified_deadline boolean;generated boolean;
begin
  if p_item_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768
    or p_payload-array['execution_refs','primary_check_id','discovered_at','encountered_at','recommendation_generated','updated_only']<>'{}'::jsonb then
    raise exception 'Use the bounded discovery attribution contract' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into existing from public.opportunity_search_discoveries where run_id=p_run_id and item_id=p_item_id;
  if found then
    if existing.payload_hash<>fingerprint then raise exception 'Discovery identity already has different attribution' using errcode='40001';end if;
    return jsonb_build_object('discovery_id',existing.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',existing.opportunity_id,'recorded',true,'verification_required',true,
      'recommendation_eligible',existing.recommendation_eligible,'recommendation_policy_violation',existing.recommendation_policy_violation,'delivery_status','unknown');
  end if;
  select * into run from public.opportunity_search_runs where id=p_run_id for update;
  if not found or run.status<>'running' then raise exception 'An active search run is required' using errcode='22023';end if;
  select * into existing from public.opportunity_search_discoveries where run_id=p_run_id and item_id=p_item_id;
  if found then
    if existing.payload_hash<>fingerprint then raise exception 'Discovery identity already has different attribution' using errcode='40001';end if;
    return jsonb_build_object('discovery_id',existing.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',existing.opportunity_id,'recorded',true,'verification_required',true,
      'recommendation_eligible',existing.recommendation_eligible,'recommendation_policy_violation',existing.recommendation_policy_violation,'delivery_status','unknown');
  end if;
  select r.run_id,r.item_id,r.user_id,r.opportunity_id,nullif(r.payload->'personal_fit','null'::jsonb) original_assessment,r.result->>'outcome' outcome
    into receipt from public.opportunity_search_receipts r where r.run_id=p_run_id and r.item_id=p_item_id and r.user_id=run.user_id;
  select a.run_id,a.item_id,a.opportunity_id,a.recorded_at,a.rolled_back_at into audit from private.opportunity_search_merge_audit a where a.run_id=p_run_id and a.item_id=p_item_id;
  if receipt.run_id is null or audit.run_id is null or audit.opportunity_id is distinct from receipt.opportunity_id or audit.rolled_back_at is not null then
    raise exception 'The exact persisted canonical receipt is required' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(run.user_id::text||':'||receipt.opportunity_id::text||':discovery',0));
  if p_payload?'execution_refs' then
    if jsonb_typeof(p_payload->'execution_refs') is distinct from 'array' or jsonb_array_length(p_payload->'execution_refs')>16 then
      raise exception 'Use at most 16 actual execution references' using errcode='22023';end if;
    for event in select e.value from jsonb_array_elements(p_payload->'execution_refs') e loop
      if jsonb_typeof(event) is distinct from 'string' or event#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid execution reference' using errcode='22023';end if;
      referenced_check:=(event#>>'{}')::uuid;
      if not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=referenced_check
        and e.user_id=run.user_id and e.status in('complete','partial','paginated','dynamic') and (e.results_count is null or e.results_count>0)) then
        raise exception 'Discovery path was not actually executed with relevant results' using errcode='22023';end if;
      if not(referenced_check=any(refs)) then refs:=array_append(refs,referenced_check);end if;
    end loop;
  end if;
  primary_check:=refs[1];
  if p_payload?'primary_check_id' then
    primary_check:=(p_payload->>'primary_check_id')::uuid;
    if primary_check is null or not(primary_check=any(refs)) then raise exception 'Primary attribution must name an actual referenced check' using errcode='22023';end if;
  end if;
  discovered:=private.opportunity_feedback_time(p_payload->>'discovered_at');encountered:=private.opportunity_feedback_time(p_payload->>'encountered_at');
  if p_payload?'discovered_at' and p_payload->'discovered_at'<>'null'::jsonb and discovered is null
    or p_payload?'encountered_at' and p_payload->'encountered_at'<>'null'::jsonb and encountered is null
    or discovered>clock_timestamp()+interval '5 minutes' or encountered>clock_timestamp()+interval '5 minutes'
    or discovered is not null and cardinality(refs)=0 or discovered is not null and encountered is not null and discovered>encountered
    or discovered is not null and not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=primary_check and e.attempted_at<=discovered) then
    raise exception 'Unknown discovery time stays null; actual attribution requires an executed path' using errcode='22023';end if;
  if p_payload?'recommendation_generated' and jsonb_typeof(p_payload->'recommendation_generated') is distinct from 'boolean'
    or p_payload?'updated_only' and jsonb_typeof(p_payload->'updated_only') is distinct from 'boolean' then
    raise exception 'Recommendation/update facts must be boolean' using errcode='22023';end if;
  primary_value:=discovered is not null and cardinality(refs)>0
    and not exists(select 1 from public.opportunity_search_discoveries where user_id=run.user_id and opportunity_id=receipt.opportunity_id and primary_discovery);
  assessment:=receipt.original_assessment;
  select coalesce(jsonb_agg(jsonb_build_object('url',private.opportunity_feedback_safe_url(s->>'url'),'kind',s->'kind','checked_at',s->'checked_at','precision',s->'precision')),'[]'::jsonb)
    into evidence from(select jsonb_build_object('url',s->'url','kind',s->'kind','checked_at',s->'checked_at','precision',s->'precision') s
      from public.opportunity_search_receipts r cross join lateral jsonb_array_elements(coalesce(r.payload->'sources','[]')) s
      where r.run_id=p_run_id and r.item_id=p_item_id and private.opportunity_feedback_safe_url(s->>'url') is not null order by s->>'url') sources;
  -- Freeze only explicit public facts from the exact saved version. Never read
  -- a whole before/after snapshot or mutable current catalogue assessment.
  select a.after_snapshot->>'institution' institution,
    array(select jsonb_array_elements_text(coalesce(a.after_snapshot->'topics','[]'))) topics,
    (a.after_snapshot->>'deadline')::date deadline,(a.after_snapshot->>'deadline_time_local')::time deadline_time_local,
    a.after_snapshot->>'deadline_timezone' deadline_timezone,a.after_snapshot->>'deadline_original_text' deadline_original_text,
    a.after_snapshot->>'availability' availability into facts
    from private.opportunity_search_merge_audit a where a.run_id=p_run_id and a.item_id=p_item_id;
  institution_value:=facts.institution;
  if not private.opportunity_feedback_projection_text(institution_value,200) then institution_value:=null;end if;
  select coalesce(array_agg(t order by t collate "C"),'{}') into topic_values from(select distinct t from unnest(facts.topics) t
    where private.opportunity_feedback_projection_text(t,120) order by t) topics;
  -- V5's source log includes rejected historical claims. Only the effective
  -- field binding can establish authority for the value saved in this receipt.
  select coalesce(bool_or(k='deadline'),false) deadline,
    coalesce(bool_or(k='deadline_timezone'),false) zone,
    coalesce(bool_or(k='deadline_time_local'),false) local_time,
    coalesce(bool_or(k='deadline_original_text'),false) original,
    coalesce(bool_or(k='availability'),false) availability into support
    from private.opportunity_search_merge_audit a
      cross join lateral unnest(array['deadline','deadline_timezone','deadline_time_local','deadline_original_text','availability']) k
      cross join lateral jsonb_array_elements(coalesce(a.after_state#>array['/'||k,'evidence'],'[]')) s
    where a.run_id=p_run_id and a.item_id=p_item_id
      and a.after_state#>array['/'||k,'value'] is not distinct from a.after_snapshot->k
      and s->>'kind' in('official','official_listing','institution','graduate_school')
      and private.opportunity_feedback_safe_url(s->>'url') is not null and (s->>'precision'='instant'
        and private.opportunity_feedback_time(s->>'checked_at')<=clock_timestamp()+interval '5 minutes'
        or s->>'precision'='date' and s->>'checked_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and (s->>'checked_at')::date<=(clock_timestamp()+interval '14 hours')::date);
  -- An official date alone does not verify a more precise timestamp found in
  -- another field. Use the whole original only with its own evidence, or with
  -- separately established date, local time and timezone evidence.
  if private.opportunity_feedback_time(facts.deadline_original_text) is not null
    and not (support.original or support.deadline and support.local_time and support.zone) then
    facts.deadline_original_text:=null;
  end if;
  verified_deadline:=case when private.opportunity_feedback_time(facts.deadline_original_text) is not null then true
    when facts.deadline is not null then support.deadline and support.zone else support.availability end;
  if facts.deadline_time_local is not null and not support.local_time and private.opportunity_feedback_time(facts.deadline_original_text) is null then facts.deadline_time_local:=null;end if;
  deadline:=private.opportunity_search_deadline_quality(facts.deadline,facts.deadline_time_local,facts.deadline_timezone,facts.deadline_original_text,facts.availability,verified_deadline,discovered,clock_timestamp());
  generated:=coalesce((p_payload->>'recommendation_generated')::boolean,false);
  if run.query_plan_id is not null then select * into plan from public.opportunity_search_query_plans where id=run.query_plan_id;end if;
  insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,query_plan_id,base_revision,feedback_revision,preference_revision,protocol_version,
    primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,original_assessment,assessment_recorded_at,assessment_version,assessment_evidence,
    institution,topics,recommendation_eligible,recommendation_generated,recommendation_policy_violation,updated_only,deadline_quality,payload_hash)
    values(run.user_id,run.search_id,p_run_id,p_item_id,receipt.opportunity_id,run.query_plan_id,run.template_revision,coalesce(run.feedback_snapshot_revision,0),coalesce(plan.preference_revision,0),run.protocol_version,
      primary_value,refs,primary_check,discovered,encountered,assessment,case when assessment is not null then audit.recorded_at else null end,case when assessment is not null then run.protocol_version else null end,evidence,
      institution_value,topic_values,(deadline->>'recommendation_eligible')::boolean,generated,generated and not coalesce((deadline->>'recommendation_eligible')::boolean,false),
      coalesce((p_payload->>'updated_only')::boolean,receipt.outcome<>'new'),deadline,fingerprint) returning * into saved;
  return jsonb_build_object('discovery_id',saved.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',saved.opportunity_id,'recorded',true,'verification_required',true,
    'recommendation_eligible',saved.recommendation_eligible,'recommendation_policy_violation',saved.recommendation_policy_violation,'delivery_status','unknown');
end;
$$;
revoke all on function private.record_opportunity_search_discovery(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.verify_opportunity_search_discovery(p_run_id uuid,p_item_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.opportunity_search_discoveries;receipt record;audit record;
begin
  select * into saved from public.opportunity_search_discoveries where run_id=p_run_id and item_id=p_item_id for update;
  if not found then raise exception 'Discovery attribution unavailable' using errcode='42501';end if;
  select r.verified_at,nullif(r.payload->'personal_fit','null'::jsonb) original_assessment into receipt from public.opportunity_search_receipts r
    where r.run_id=p_run_id and r.item_id=p_item_id and r.user_id=saved.user_id and r.opportunity_id=saved.opportunity_id;
  select a.run_id,a.recorded_at,a.rolled_back_at into audit from private.opportunity_search_merge_audit a where a.run_id=p_run_id and a.item_id=p_item_id and a.opportunity_id=saved.opportunity_id;
  if receipt.verified_at is null or audit.run_id is null or audit.rolled_back_at is not null
    or saved.original_assessment is distinct from receipt.original_assessment
    or saved.original_assessment is not null and saved.assessment_recorded_at is distinct from audit.recorded_at then
    update public.opportunity_search_discoveries set verified_at=null,assessment_verified_at=null where discovery_id=saved.discovery_id;
    return jsonb_build_object('discovery_id',saved.discovery_id,'verified',false,'assessment_verified',false,'reason','canonical_proof_unavailable');
  end if;
  update public.opportunity_search_discoveries set verified_at=receipt.verified_at,assessment_verified_at=case when original_assessment is not null then receipt.verified_at else null end where discovery_id=saved.discovery_id;
  return jsonb_build_object('discovery_id',saved.discovery_id,'verified',true,'assessment_verified',saved.original_assessment is not null,'verified_at',receipt.verified_at,'delivery_status','unknown');
end;
$$;
revoke all on function private.verify_opportunity_search_discovery(uuid,uuid) from public,anon,authenticated,service_role;

comment on table public.opportunity_search_executions is 'Actual declared query/source checks only; saved plans never create execution credit. Failure reasons are fixed non-sensitive codes.';
comment on table public.opportunity_search_discoveries is 'Immutable owner-specific incoming run assessments and actual attribution; historical times remain unknown and delivery is always unknown in AF-05.';
comment on column public.opportunity_search_discoveries.opportunity_id is 'Canonical audit identity without a live FK, preserving authorized canonical rollback/deletion compatibility.';
commit;
