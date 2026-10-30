-- Canonical payload 6: describe the opportunity's distinguishing features once.
-- Existing research text and frozen application facts are preserved; no research
-- is refreshed and no personal review or checklist completion is rewritten.
begin;
select pg_advisory_xact_lock(hashtextextended('opportunity-search-catalogue-v1',0));
lock table public.opportunity_search_runs,public.opportunities,public.applications in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.opportunity_search_runs where status='running') then
    raise exception 'Finish active opportunity searches before changing the payload contract.';
  end if;
  if (select active_protocol_version from private.opportunity_search_settings where singleton)<>'opportunity-search-v1-canonical-5' then
    raise exception 'Expected the canonical v5 installation.';
  end if;
end $$;

create table private.opportunity_description_archive (
  kind text not null check(kind in('opportunity','application_context','effective_state')),
  id uuid not null,
  before_payload jsonb not null,
  after_payload jsonb,
  primary key(kind,id)
);
alter table private.opportunity_description_archive enable row level security;
revoke all on private.opportunity_description_archive from public,anon,authenticated,service_role;
insert into private.opportunity_description_archive(kind,id,before_payload)
  select 'opportunity',id,to_jsonb(o) from public.opportunities o
  union all select 'application_context',id,context_json from public.applications
  union all select 'effective_state',opportunity_id,fields from private.opportunity_search_merge_state;

create temp table opportunity_description_invariants on commit drop as
select
  (select count(*) from public.opportunities) opportunity_count,
  (select md5(coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]')::text) from public.opportunity_reviews r) reviews,
  (select md5(coalesce(jsonb_agg(to_jsonb(a)-'context_json' order by id),'[]')::text) from public.applications a) applications;

create function pg_temp.opportunity_description(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare description text:=btrim(coalesce(p->>'research_summary','')); point text; normalized text;
  points text[]:='{}'; seen text[]:='{}'; result jsonb:=p-array['particularly_suitable','particularly_suitable_reason','special_features'];
begin
  if p?'special_features' and jsonb_typeof(p->'special_features') not in('array','null') then
    raise exception 'Inspect the non-array special_features before migration.';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(nullif(p->'special_features','null'),'[]')) x where jsonb_typeof(x)<>'string') then
    raise exception 'Inspect non-text special features before migration.';
  end if;
  for point in
    select value from (
      select 0 ordinal,btrim(p->>'particularly_suitable_reason') value
      union all select ordinality::integer,btrim(value) from jsonb_array_elements_text(coalesce(nullif(p->'special_features','null'),'[]')) with ordinality
    ) facts where coalesce(value,'')<>'' order by ordinal
  loop
    normalized:=lower(regexp_replace(point,'\s+',' ','g'));
    if normalized=any(seen) or position(normalized in lower(regexp_replace(description,'\s+',' ','g')))>0 then continue; end if;
    seen:=array_append(seen,normalized); points:=array_append(points,'- '||point);
  end loop;
  if cardinality(points)>0 then
    if description ~* E'(^|\n)Unique selling points:?\\s*\n' then
      description:=description||E'\n'||array_to_string(points,E'\n');
    else description:=concat_ws(E'\n\n',nullif(description,''),'Unique selling points'||E'\n'||array_to_string(points,E'\n')); end if;
  end if;
  if p?'research_summary' or description<>'' then result:=result||jsonb_build_object('research_summary',nullif(description,'')); end if;
  if result->'metadata_schema_version'='5' then result:=jsonb_set(result,'{metadata_schema_version}','6'); end if;
  return result;
end $$;

-- Evidence observations refer to the new description, not retired field names.
create function pg_temp.opportunity_description_sources(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(item->'supports')='array' then
    jsonb_set(item,'{supports}',(select coalesce(jsonb_agg(field order by field),'[]') from (
      select distinct case when split_part(ltrim(value,'/'),'/',1) in('particularly_suitable','particularly_suitable_reason','special_features')
        then 'research_summary' else value end field from jsonb_array_elements_text(item->'supports')
    ) fields)) else item end order by ordinal),'[]')
  from jsonb_array_elements(coalesce(v,'[]')) with ordinality e(item,ordinal)
$$;

-- The new stored function contains a fixed closed schema, not a runtime adapter.
do $$ declare schema jsonb:=private.opportunity_storage_schema(); begin
  schema:=schema#-'{properties,particularly_suitable}'#-'{properties,particularly_suitable_reason}'#-'{properties,special_features}';
  schema:=jsonb_set(schema,'{x-canonical-version}','6');
  schema:=jsonb_set(schema,'{title}','"Canonical opportunity payload v6"');
  schema:=jsonb_set(schema,'{properties,research_summary,description}',to_jsonb('Describe the factual project and end with a concise Unique selling points section containing its distinguishing features and specific fit rationale. Do not repeat the description or invent applicant qualifications.'::text));
  execute format('create or replace function private.opportunity_storage_schema() returns jsonb language sql immutable set search_path='''' as %L',
    'select '||quote_literal(schema::text)||'::jsonb');
end $$;

alter table public.opportunities drop constraint opportunities_payload_v5_check;
update public.opportunities o set
  research_summary=pg_temp.opportunity_description(to_jsonb(o))->>'research_summary',
  sources=pg_temp.opportunity_description_sources(o.sources),metadata_schema_version=6;

-- Representation-only context changes must not refresh research, timestamps,
-- workflow history, privacy snapshots, feedback revisions or application codes.
create temp table opportunity_description_triggers on commit drop as
select tgname,tgenabled from pg_trigger where tgrelid='public.applications'::regclass and not tgisinternal;
alter table public.applications disable trigger user;
update public.applications set context_json=case when context_json?'sources'
  then jsonb_set(pg_temp.opportunity_description(context_json),'{sources}',pg_temp.opportunity_description_sources(context_json->'sources'))
  else pg_temp.opportunity_description(context_json) end;
do $$ declare t record; begin
  for t in select * from opportunity_description_triggers loop
    execute format('alter table public.applications %s trigger %I',case t.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,t.tgname);
  end loop;
end $$;

update private.opportunity_search_merge_state s set fields=(
  select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(s.fields)
  where split_part(ltrim(key,'/'),'/',1) not in('particularly_suitable','particularly_suitable_reason','special_features')
)||jsonb_build_object('/research_summary',jsonb_build_object(
  'value',(select to_jsonb(o.research_summary) from public.opportunities o where o.id=s.opportunity_id),
  'evidence',(select coalesce(jsonb_agg(distinct evidence),'[]') from jsonb_each(s.fields) f
    cross join lateral jsonb_array_elements(coalesce(f.value->'evidence','[]')) e(evidence)
    where split_part(ltrim(f.key,'/'),'/',1) in('research_summary','particularly_suitable_reason','special_features'))));

alter table public.opportunities drop column particularly_suitable,drop column particularly_suitable_reason,drop column special_features;
alter table public.opportunities alter column metadata_schema_version set default 6;
alter table public.opportunities add constraint opportunities_payload_v6_check
  check(metadata_schema_version=6 and private.opportunity_payload_storage_valid(to_jsonb(opportunities)));

-- Patch only reviewed current definitions and fail rather than adapting an
-- unexpected deployment. Privileges/security mode/signatures remain unchanged.
do $$ declare signature text; definition text; patched text; begin
  foreach signature in array array[
    'private.validate_opportunity_search_result(jsonb)',
    'private.opportunity_merge_plan(jsonb,jsonb,jsonb)',
    'private.submit_opportunity_search_result(uuid,uuid,jsonb)',
    'public.opportunity_search_readiness()'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    patched:=replace(replace(replace(replace(definition,
      'opportunity-search-v1-canonical-5','opportunity-search-v1-canonical-6'),'canonical v5','canonical v6'),
      'old->''metadata_schema_version''<>''5''','old->''metadata_schema_version''<>''6'''),
      'd->''x-canonical-version''=''5''','d->''x-canonical-version''=''6''');
    patched:=replace(patched,'''merge_version'',5','''merge_version'',6');
    patched:=replace(replace(patched,'schema v5','schema v6'),'opportunity v5','opportunity v6');
    if patched=definition then raise exception 'Unexpected definition for %; inspect before upgrading.',signature; end if;
    execute patched;
  end loop;
  foreach signature in array array['private.opportunity_merge_canonical(text,jsonb)','private.opportunity_merge_policy(text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    patched:=replace(replace(definition,'''special_features'',',''),'''/special_features'',','');
    if patched=definition then raise exception 'Unexpected set policy for %.',signature; end if;
    execute patched;
  end loop;
end $$;

-- Adaptive startup and the explicit rollback prompt use the same current
-- catalogue contract. These functions exist only when that release is installed.
do $$ declare signature text; procedure regprocedure; definition text; begin
  foreach signature in array array[
    'private.ack_adaptive_search_rollback(uuid,uuid,jsonb)',
    'public.opportunity_search_planning_capacity(uuid,uuid)',
    'private.begin_adaptive_opportunity_search(uuid,uuid)',
    'private.require_adaptive_setup_scope(uuid,text,boolean)',
    'private.adaptive_search_recurring_prompt(uuid,text)',
    'private.legacy_dynamic_search_rollback_prompt(uuid,text)',
    'private.read_adaptive_search_rollback(uuid,uuid,text)',
    'private.opportunity_search_adaptive_shape(text,jsonb)'
  ] loop
    procedure:=to_regprocedure(signature);
    if procedure is null then continue; end if;
    definition:=pg_get_functiondef(procedure);
    if position('opportunity-search-v1-canonical-5' in definition)=0
      and not(signature='private.adaptive_search_recurring_prompt(uuid,text)' and position('canonical v5' in definition)>0) then
      raise exception 'Unexpected adaptive contract for %.',signature;
    end if;
    definition:=replace(replace(replace(definition,
      'opportunity-search-v1-canonical-5','opportunity-search-v1-canonical-6'),'canonical v5','canonical v6'),'v5 merge contract','v6 merge contract');
    definition:=replace(definition,'protocol.result_schema->>''x-canonical-version''<>''5''','protocol.result_schema->>''x-canonical-version''<>''6''');
    definition:=replace(definition,'entry.key=''schema_version'' then 5 else 1','entry.key=''schema_version'' then 6 else 1');
    definition:=replace(definition,'''schema_version'',5,''protocol_version''','''schema_version'',6,''protocol_version''');
    execute definition;
  end loop;
end $$;

insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
select 'opportunity-search-v1-canonical-6',contract_version,
  encode(sha256(convert_to(protocol||private.opportunity_search_result_schema()::text,'UTF8')),'hex'),protocol,private.opportunity_search_result_schema()
from (
  select contract_version,replace(replace(protocol_text,'CANONICAL PAYLOAD 5','CANONICAL PAYLOAD 6'),'ONE CURRENT SCHEMA',
    E'End research_summary with a concise Unique selling points section: preserve distinguishing job features and the specific reason for fit as description prose, without duplicating the project summary or inventing qualifications. Do not submit separate suitability flags, suitability-reason fields or special-features lists.\nONE CURRENT SCHEMA') protocol
  from private.opportunity_search_protocols where version='opportunity-search-v1-canonical-5'
) current_protocol;
-- Search queries are independent of the retired descriptive fields. Publish
-- their unchanged content under the new contract; keep old run evidence pinned.
do $$ declare scope record; active_plan record; anchor_id uuid; plan_id uuid; revision bigint; fingerprint text; begin
  if to_regclass('public.opportunity_search_query_revisions') is not null then
    insert into public.opportunity_search_query_revisions(id,user_id,search_id,template_revision,protocol_version,queries)
      select gen_random_uuid(),q.user_id,q.search_id,q.template_revision,'opportunity-search-v1-canonical-6',q.queries
      from public.opportunity_search_query_revisions q where q.protocol_version='opportunity-search-v1-canonical-5'
      on conflict(search_id,template_revision,protocol_version) do nothing;
  end if;
  if to_regclass('public.opportunity_search_schedule_bindings') is not null then
    update public.opportunity_search_schedule_bindings set protocol_version='opportunity-search-v1-canonical-6'
      where protocol_version='opportunity-search-v1-canonical-5';
  end if;
  -- Carry active plans to the current protocol without changing query identities,
  -- manual flags or frozen policy/basis. Historical plan rows remain untouched.
  if to_regclass('public.opportunity_search_adaptive_settings') is not null
    and to_regclass('public.opportunity_search_query_plans') is not null then
    for scope in
      select s.user_id,s.search_id from public.opportunity_search_adaptive_settings s
      join public.opportunity_search_query_plans p on p.id=s.query_plan_id and p.user_id=s.user_id and p.search_id=s.search_id
      where p.protocol_version='opportunity-search-v1-canonical-5' order by s.user_id,s.search_id
    loop
      perform pg_advisory_xact_lock(hashtextextended(scope.user_id::text||':'||scope.search_id::text||':query-plan',0));
      select p.* into active_plan from public.opportunity_search_adaptive_settings s
        join public.opportunity_search_query_plans p on p.id=s.query_plan_id and p.user_id=s.user_id and p.search_id=s.search_id
        where s.user_id=scope.user_id and s.search_id=scope.search_id and p.protocol_version='opportunity-search-v1-canonical-5'
        for update of s;
      if not found then continue; end if;
      select current_anchor.id into anchor_id from public.opportunity_search_query_revisions previous_anchor
        join public.opportunity_search_query_revisions current_anchor on current_anchor.user_id=previous_anchor.user_id
          and current_anchor.search_id=previous_anchor.search_id and current_anchor.template_revision=previous_anchor.template_revision
          and current_anchor.protocol_version='opportunity-search-v1-canonical-6' and current_anchor.queries=previous_anchor.queries
        where previous_anchor.id=active_plan.query_revision_id and previous_anchor.user_id=scope.user_id
          and previous_anchor.search_id=scope.search_id and previous_anchor.protocol_version='opportunity-search-v1-canonical-5';
      if not found then raise exception 'Missing unchanged current query anchor for active plan %.',active_plan.id; end if;
      fingerprint:=encode(sha256(convert_to(jsonb_build_object('planning_policy',active_plan.planning_policy,'query_revision_id',anchor_id,
        'base_revision',active_plan.base_revision,'feedback_revision',active_plan.feedback_revision,'preference_revision',active_plan.preference_revision,
        'protocol_version','opportunity-search-v1-canonical-6','document',active_plan.document)::text,'UTF8')),'hex');
      select coalesce(max(p.plan_revision),0)+1 into revision from public.opportunity_search_query_plans p
        where p.user_id=scope.user_id and p.search_id=scope.search_id;
      insert into public.opportunity_search_query_plans(user_id,search_id,query_revision_id,plan_revision,base_revision,feedback_revision,
        preference_revision,protocol_version,planning_policy,document,plan_hash)
        values(scope.user_id,scope.search_id,anchor_id,revision,active_plan.base_revision,active_plan.feedback_revision,
          active_plan.preference_revision,'opportunity-search-v1-canonical-6',active_plan.planning_policy,active_plan.document,fingerprint)
        returning id into plan_id;
      update public.opportunity_search_adaptive_settings set query_plan_id=plan_id,query_plan_revision=revision,query_plan_dirty=true
        where user_id=scope.user_id and search_id=scope.search_id;
    end loop;
  end if;
end $$;
update private.opportunity_search_settings set active_protocol_version='opportunity-search-v1-canonical-6' where singleton;

update private.opportunity_description_archive a set after_payload=case a.kind
  when 'opportunity' then (select to_jsonb(o) from public.opportunities o where o.id=a.id)
  when 'application_context' then (select context_json from public.applications where id=a.id)
  else (select fields from private.opportunity_search_merge_state where opportunity_id=a.id) end;
do $$ begin
  if exists(select 1 from public.opportunities o where not private.opportunity_payload_storage_valid(to_jsonb(o))) then raise exception 'Invalid v6 catalogue payload.'; end if;
  if (select count(*) from public.opportunities)<>(select opportunity_count from opportunity_description_invariants)
    or (select md5(coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]')::text) from public.opportunity_reviews r)<>(select reviews from opportunity_description_invariants)
    or (select md5(coalesce(jsonb_agg(to_jsonb(a)-'context_json' order by id),'[]')::text) from public.applications a)<>(select applications from opportunity_description_invariants)
    then raise exception 'Description migration changed unrelated records.'; end if;
  if exists(select 1 from private.opportunity_description_archive where kind='opportunity' and
    (before_payload-array['particularly_suitable','particularly_suitable_reason','special_features','research_summary','sources','metadata_schema_version'])
      is distinct from (after_payload-array['research_summary','sources','metadata_schema_version'])) then raise exception 'Unrelated opportunity values changed.'; end if;
end $$;
notify pgrst,'reload schema';
commit;
