-- AF-06: explicit owner rules and a deterministic, bounded adaptive layer.
-- Requires AF-01–05. No base profile, application, letter or task is edited.
begin;

alter table public.opportunity_search_adaptive_settings
  add column adaptation_enabled boolean not null default false,
  add column adaptation_paused boolean not null default false,
  add column adaptation_revision bigint not null default 0 check(adaptation_revision>=0);
alter table public.opportunity_search_query_plans add column planning_policy jsonb
  check(planning_policy is null or jsonb_typeof(planning_policy)='object' and octet_length(planning_policy::text)<=1024);

create function public.opportunity_search_adaptation_policy() returns jsonb
language sql immutable security invoker set search_path='' as $$
  select '{"policy_version":"adaptive-query-v1","minimum_observations":3,"positive_interest_threshold":6,"exploration_ratio":0.2,"minimum_exploration_queries":1,"maximum_queries":30}'::jsonb
$$;
revoke all on function public.opportunity_search_adaptation_policy() from public,anon,service_role;
grant execute on function public.opportunity_search_adaptation_policy() to authenticated;

-- Suggestions never execute. A separate authenticated owner action publishes
-- the entire approved document as an immutable, independently versioned value.
create table public.opportunity_search_preference_suggestions (
  user_id uuid not null,
  search_id uuid not null,
  suggestion_id uuid not null,
  rule jsonb not null,
  rule_hash text not null,
  origin text not null check(origin in('owner','runner')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,search_id,suggestion_id),
  foreign key(user_id,search_id) references public.opportunity_search_templates(user_id,id) on delete cascade
);
create table public.opportunity_search_preference_actions (
  user_id uuid not null,
  search_id uuid not null,
  operation_id uuid not null,
  suggestion_id uuid not null,
  action text not null check(action in('approve','reject','undo')),
  expected_revision bigint not null check(expected_revision>=0),
  preference_revision bigint not null,
  approved_rules jsonb not null,
  replaced_rules jsonb not null default '[]',
  document_hash text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity,
  primary key(user_id,search_id,operation_id),
  foreign key(user_id,search_id,suggestion_id) references public.opportunity_search_preference_suggestions(user_id,search_id,suggestion_id) on delete cascade
);
create index opportunity_preference_action_revision on public.opportunity_search_preference_actions(user_id,search_id,preference_revision desc,sequence desc);
create index opportunity_preference_action_suggestion on public.opportunity_search_preference_actions(user_id,search_id,suggestion_id,sequence desc);
do $$declare relation text;begin
  foreach relation in array array['opportunity_search_preference_suggestions','opportunity_search_preference_actions'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
    execute format('grant select,insert on public.%I to authenticated',relation);
    execute format('create policy "Owner preference reads" on public.%I for select to authenticated using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>''is_anonymous'')::boolean,false))',relation);
    execute format('create policy "Explicit owner preference writes" on public.%I for insert to authenticated with check(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>''is_anonymous'')::boolean,false))',relation);
  end loop;
end $$;
grant usage on sequence public.opportunity_search_preference_actions_sequence_seq to authenticated;

-- Public invoker helpers are owner-scoped so triggers/RPCs need no definer or
-- private helper grant. They reveal no comments, application content or people.
create function public.opportunity_search_preference_document(p_user_id uuid,p_search_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare saved public.opportunity_search_preference_actions;
begin
  if current_user<>'postgres' and (auth.uid() is distinct from p_user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) then
    raise exception 'A signed-in owner is required' using errcode='42501';end if;
  if not exists(select 1 from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id) then
    raise exception 'Search unavailable' using errcode='42501';end if;
  select * into saved from public.opportunity_search_preference_actions where user_id=p_user_id and search_id=p_search_id
    order by preference_revision desc,sequence desc limit 1;
  return jsonb_build_object('preference_revision',coalesce(saved.preference_revision,0),'approved_rules',coalesce(saved.approved_rules,'[]'::jsonb),
    'approved_preferences',(select coalesce(jsonb_agg(jsonb_build_object('preference_id',r->'rule_id','category',r->'category','polarity',r->'polarity','target',r->'target') order by r->>'rule_id'),'[]'::jsonb)
      from jsonb_array_elements(coalesce(saved.approved_rules,'[]'::jsonb)) r where r->>'kind'='emphasis'
        and not exists(select 1 from jsonb_array_elements(coalesce(saved.approved_rules,'[]'::jsonb)) h where h->>'kind'='hard_exclusion' and h->>'category'=r->>'category'
          and translate(btrim(h->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(btrim(r->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))));
end;
$$;
revoke all on function public.opportunity_search_preference_document(uuid,uuid) from public,anon,service_role;
grant execute on function public.opportunity_search_preference_document(uuid,uuid) to authenticated;

create function public.opportunity_search_validate_preference_rule(p_user_id uuid,p_search_id uuid,p_rule jsonb,p_require_evidence boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ref jsonb; refs jsonb:='[]'; normalized jsonb:=p_rule; kind text:=p_rule->>'kind';target text;id uuid;
begin
  if current_user<>'postgres' and (auth.uid() is distinct from p_user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) then
    raise exception 'A signed-in owner is required' using errcode='42501';end if;
  if jsonb_typeof(p_rule) is distinct from 'object' or octet_length(p_rule::text)>8192
    or not(p_rule?&array['rule_id','kind','evidence_refs']) or jsonb_typeof(p_rule->'rule_id') is distinct from 'string'
    or p_rule->>'rule_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_rule->'kind') is distinct from 'string' or kind not in('emphasis','hard_exclusion','source_exclusion')
    or jsonb_typeof(p_rule->'evidence_refs') is distinct from 'array' or jsonb_array_length(p_rule->'evidence_refs')>16
    or p_require_evidence and jsonb_array_length(p_rule->'evidence_refs')=0 then
    raise exception 'Use a bounded typed preference rule' using errcode='22023';end if;
  normalized:=jsonb_set(normalized,'{rule_id}',to_jsonb((p_rule->>'rule_id')::uuid));
  if kind='source_exclusion' then
    if p_rule-array['rule_id','kind','source_registry_id','evidence_refs']<>'{}'::jsonb
      or jsonb_typeof(p_rule->'source_registry_id') is distinct from 'string'
      or p_rule->>'source_registry_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A source exclusion names one owned registry identity' using errcode='22023';end if;
    id:=(p_rule->>'source_registry_id')::uuid;
    if not exists(select 1 from public.opportunity_search_sources where registry_id=id and user_id=p_user_id and search_id=p_search_id) then
      raise exception 'Source unavailable' using errcode='42501';end if;
    normalized:=jsonb_set(normalized,'{source_registry_id}',to_jsonb(id));
  else
    if p_rule-array['rule_id','kind','category','polarity','target','evidence_refs']<>'{}'::jsonb
      or not(p_rule?&array['category','target']) or jsonb_typeof(p_rule->'category') is distinct from 'string'
      or p_rule->>'category' not in('topic','method','hardware','location','funding','timing','other')
      or jsonb_typeof(p_rule->'target') is distinct from 'string'
      or kind='emphasis' and (jsonb_typeof(p_rule->'polarity') is distinct from 'string' or p_rule->>'polarity' not in('positive','negative'))
      or kind='hard_exclusion' and p_rule?'polarity' then
      raise exception 'Use a structured emphasis or hard exclusion' using errcode='22023';end if;
    target:=btrim(p_rule->>'target');
    if not public.opportunity_search_public_text(target,120) then
      raise exception 'Preference target contains unsafe text' using errcode='22023';end if;
    normalized:=jsonb_set(normalized,'{target}',to_jsonb(target));
  end if;
  for ref in select value from jsonb_array_elements(p_rule->'evidence_refs') loop
    if jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Evidence references are owned opportunity identities' using errcode='22023';end if;
    id:=(ref#>>'{}')::uuid;
    if exists(select 1 from public.opportunity_reviews where user_id=p_user_id and opportunity_id=id and feedback_excluded)
      or not (exists(select 1 from public.opportunity_reviews where user_id=p_user_id and opportunity_id=id
        and (state<>'unreviewed' or interest_rating is not null or interest_reasons<>'[]'::jsonb or search_feedback_approved_at is not null))
        or exists(select 1 from public.opportunity_search_discoveries where user_id=p_user_id and search_id=p_search_id and opportunity_id=id and verified_at is not null)) then
      raise exception 'Evidence unavailable' using errcode='42501';end if;
    refs:=refs||jsonb_build_array(id);
  end loop;
  select coalesce(jsonb_agg(value order by value),'[]') into refs from(select distinct value from jsonb_array_elements(refs)) unique_refs;
  return jsonb_set(normalized,'{evidence_refs}',refs);
end;
$$;
revoke all on function public.opportunity_search_validate_preference_rule(uuid,uuid,jsonb,boolean) from public,anon,service_role;
grant execute on function public.opportunity_search_validate_preference_rule(uuid,uuid,jsonb,boolean) to authenticated;

create function public.job_workspace_preference_suggestion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Preference proposals are immutable' using errcode='23514';end if;
  if not exists(select 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id) then raise exception 'Search unavailable' using errcode='42501';end if;
  if current_user='postgres' then new.origin:='runner';
  else
    if auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501';end if;
    new.origin:='owner';
  end if;
  new.rule:=public.opportunity_search_validate_preference_rule(new.user_id,new.search_id,new.rule,new.origin='runner');
  new.rule_hash:=encode(sha256(convert_to(new.rule::text,'UTF8')),'hex');new.created_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function public.job_workspace_preference_suggestion() from public,anon,authenticated,service_role;
create trigger opportunity_preference_suggestion_guard before insert or update on public.opportunity_search_preference_suggestions for each row execute function public.job_workspace_preference_suggestion();

create function public.job_workspace_preference_action() returns trigger
language plpgsql security invoker set search_path='' as $$
declare proposal public.opportunity_search_preference_suggestions; current_doc jsonb; rules jsonb; current_revision bigint; state text; prior_rule jsonb;restore jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'Preference decisions are immutable' using errcode='23514';end if;
  -- Management research can propose, but it cannot approve its own proposal.
  if current_user<>'authenticated' or auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Preference decisions require an explicit signed-in owner action' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  current_doc:=public.opportunity_search_preference_document(new.user_id,new.search_id);current_revision:=(current_doc->>'preference_revision')::bigint;rules:=current_doc->'approved_rules';
  if new.expected_revision is distinct from current_revision then raise exception 'Approved preferences changed; refresh before deciding' using errcode='40001';end if;
  select * into proposal from public.opportunity_search_preference_suggestions where user_id=new.user_id and search_id=new.search_id and suggestion_id=new.suggestion_id;
  if not found then raise exception 'Suggestion unavailable' using errcode='42501';end if;
  select case action when 'approve' then 'approved' when 'reject' then 'rejected' else 'undone' end into state from public.opportunity_search_preference_actions
    where user_id=new.user_id and search_id=new.search_id and suggestion_id=new.suggestion_id order by sequence desc limit 1;
  state:=coalesce(state,'pending');
  select r into prior_rule from jsonb_array_elements(rules) r where r->>'rule_id'=proposal.rule->>'rule_id';
  new.replaced_rules:='[]';
  if new.action='approve' then
    perform public.opportunity_search_validate_preference_rule(new.user_id,new.search_id,proposal.rule,false);
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into new.replaced_rules from jsonb_array_elements(rules) r
      where r->>'rule_id'=proposal.rule->>'rule_id' or r->>'kind'='emphasis' and proposal.rule->>'kind'='emphasis'
        and r->>'category'=proposal.rule->>'category'
        and translate(btrim(r->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(btrim(proposal.rule->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into rules from (
      select r from jsonb_array_elements(rules) r where not exists(select 1 from jsonb_array_elements(new.replaced_rules) replaced where replaced=r)
      union all select proposal.rule) approved;
    if jsonb_array_length(rules)>32 then raise exception 'Keep at most 32 approved preference rules' using errcode='22023';end if;
  elsif new.action='reject' then
    if state='approved' then raise exception 'Undo an approved rule explicitly' using errcode='22023';end if;
  elsif new.action='undo' then
    if state<>'approved' or prior_rule is distinct from proposal.rule then raise exception 'This decision no longer owns the active rule' using errcode='40001';end if;
    select replaced_rules into restore from public.opportunity_search_preference_actions where user_id=new.user_id and search_id=new.search_id
      and suggestion_id=new.suggestion_id and action='approve' and preference_revision>expected_revision order by sequence desc limit 1;
    if not found then raise exception 'This suggestion has no effective approval to undo' using errcode='40001';end if;
    if exists(select 1 from jsonb_array_elements(rules) active cross join jsonb_array_elements(coalesce(restore,'[]')) restored
      where active->>'rule_id'<>proposal.rule->>'rule_id' and (active->>'rule_id'=restored->>'rule_id'
        or active->>'kind'='emphasis' and restored->>'kind'='emphasis' and active->>'category'=restored->>'category'
          and translate(btrim(active->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(btrim(restored->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))) then
      raise exception 'Undo conflicts with newer explicit owner intent' using errcode='40001';end if;
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into rules from (
      select r from jsonb_array_elements(rules) r where r->>'rule_id'<>proposal.rule->>'rule_id'
      union all select r from jsonb_array_elements(coalesce(restore,'[]')) r) restored;
  else raise exception 'Use approve, reject or undo' using errcode='22023';end if;
  if jsonb_array_length(rules)>32 then raise exception 'Keep at most 32 approved preference rules' using errcode='22023';end if;
  new.preference_revision:=current_revision+case when rules is distinct from current_doc->'approved_rules' then 1 else 0 end;
  new.approved_rules:=rules;new.document_hash:=encode(sha256(convert_to(rules::text,'UTF8')),'hex');new.recorded_at:=clock_timestamp();
  new.sequence:=nextval('public.opportunity_search_preference_actions_sequence_seq'::regclass);
  return new;
end;
$$;
revoke all on function public.job_workspace_preference_action() from public,anon,authenticated,service_role;
create trigger opportunity_preference_action_guard before insert or update on public.opportunity_search_preference_actions for each row execute function public.job_workspace_preference_action();

create function public.job_workspace_preference_invalidation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.preference_revision<>new.expected_revision then
    insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(new.user_id,new.search_id) on conflict do nothing;
    update public.opportunity_search_adaptive_settings set feedback_dirty=true,query_plan_dirty=true where user_id=new.user_id and search_id=new.search_id;
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_preference_invalidation() from public,anon,authenticated,service_role;
create trigger opportunity_preference_invalidate after insert on public.opportunity_search_preference_actions for each row execute function public.job_workspace_preference_invalidation();

create function public.job_workspace_adaptation_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
declare changed boolean;
begin
  -- Consent revocation must always succeed, including while adaptation is on.
  if not new.structured_feedback_enabled then new.adaptation_enabled:=false;end if;
  if tg_op='INSERT' then
    new.adaptation_revision:=case when new.adaptation_enabled or new.adaptation_paused then 1 else 0 end;
  else
    changed:=(new.adaptation_enabled,new.adaptation_paused) is distinct from (old.adaptation_enabled,old.adaptation_paused);
    new.adaptation_revision:=old.adaptation_revision+case when changed then 1 else 0 end;
    if changed then new.feedback_dirty:=true;new.query_plan_dirty:=true;end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_adaptation_settings() from public,anon,authenticated,service_role;
create trigger opportunity_adaptation_settings before insert or update on public.opportunity_search_adaptive_settings for each row execute function public.job_workspace_adaptation_settings();
create function public.job_workspace_adaptation_pause() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.adaptation_paused and not old.adaptation_paused or not new.adaptation_enabled and old.adaptation_enabled) then
    update public.opportunity_search_feedback_snapshots set packet=packet||'{"privacy_scope_changed":true}'::jsonb
      where user_id=new.user_id and search_id=new.search_id;
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_adaptation_pause() from public,anon,authenticated,service_role;
create trigger opportunity_adaptation_pause after update on public.opportunity_search_adaptive_settings for each row execute function public.job_workspace_adaptation_pause();

create function public.save_opportunity_search_adaptation(p_search_id uuid,p_enabled boolean,p_paused boolean,p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_adaptive_settings;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(select 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id) then
    raise exception 'Search unavailable' using errcode='42501';end if;
  if p_enabled is null or p_paused is null then raise exception 'Explicit enable and pause choices required' using errcode='22023';end if;
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(actor,p_search_id) on conflict do nothing;
  select * into saved from public.opportunity_search_adaptive_settings where user_id=actor and search_id=p_search_id for update;
  if saved.adaptation_revision is distinct from p_expected_revision then raise exception 'Adaptation settings changed' using errcode='40001';end if;
  if p_enabled and not saved.structured_feedback_enabled then raise exception 'Enable structured feedback consent before adaptation' using errcode='22023';end if;
  update public.opportunity_search_adaptive_settings set adaptation_enabled=p_enabled,adaptation_paused=p_paused where user_id=actor and search_id=p_search_id returning * into saved;
  return jsonb_build_object('search_id',p_search_id,'adaptation_enabled',saved.adaptation_enabled,'adaptation_paused',saved.adaptation_paused,'adaptation_revision',saved.adaptation_revision,'policy',public.opportunity_search_adaptation_policy());
end;
$$;
revoke all on function public.save_opportunity_search_adaptation(uuid,boolean,boolean,bigint) from public,anon,service_role;
grant execute on function public.save_opportunity_search_adaptation(uuid,boolean,boolean,bigint) to authenticated;

create function public.propose_opportunity_search_preference(p_search_id uuid,p_suggestion_id uuid,p_rule jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_preference_suggestions;normalized jsonb;
begin
  normalized:=public.opportunity_search_validate_preference_rule(actor,p_search_id,p_rule,false);
  if actor is null or not exists(select 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id) then raise exception 'Search unavailable' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id for update;
  select * into saved from public.opportunity_search_preference_suggestions where user_id=actor and search_id=p_search_id and suggestion_id=p_suggestion_id;
  if found then
    if saved.rule<>normalized then raise exception 'Suggestion identity already has different contents' using errcode='40001';end if;
  else
    insert into public.opportunity_search_preference_suggestions(user_id,search_id,suggestion_id,rule,rule_hash,origin)
      values(actor,p_search_id,p_suggestion_id,normalized,'','owner') returning * into saved;
  end if;
  return jsonb_build_object('suggestion_id',saved.suggestion_id,'rule',saved.rule,'origin',saved.origin,'created_at',saved.created_at);
end;
$$;
revoke all on function public.propose_opportunity_search_preference(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.propose_opportunity_search_preference(uuid,uuid,jsonb) to authenticated;

create function private.propose_opportunity_search_preference(p_user_id uuid,p_search_id uuid,p_suggestion_id uuid,p_rule jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.opportunity_search_preference_suggestions;normalized jsonb;
begin
  normalized:=public.opportunity_search_validate_preference_rule(p_user_id,p_search_id,p_rule,true);
  perform 1 from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id for update;
  select * into saved from public.opportunity_search_preference_suggestions where user_id=p_user_id and search_id=p_search_id and suggestion_id=p_suggestion_id;
  if found then
    if saved.rule<>normalized then raise exception 'Suggestion identity already has different contents' using errcode='40001';end if;
  else insert into public.opportunity_search_preference_suggestions(user_id,search_id,suggestion_id,rule,rule_hash,origin)
    values(p_user_id,p_search_id,p_suggestion_id,normalized,'','runner') returning * into saved;
  end if;
  return jsonb_build_object('suggestion_id',saved.suggestion_id,'proposed',true,'executable',false);
end;
$$;
revoke all on function private.propose_opportunity_search_preference(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.decide_opportunity_search_preference(p_search_id uuid,p_suggestion_id uuid,p_action text,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_preference_actions;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=actor and id=p_search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  select * into saved from public.opportunity_search_preference_actions where user_id=actor and search_id=p_search_id and operation_id=p_operation_id;
  if found then
    if (saved.suggestion_id,saved.action,saved.expected_revision) is distinct from (p_suggestion_id,p_action,p_expected_revision) then
      raise exception 'Decision identity already has different contents' using errcode='40001';end if;
  else
    insert into public.opportunity_search_preference_actions(user_id,search_id,operation_id,suggestion_id,action,expected_revision,preference_revision,approved_rules,document_hash)
      values(actor,p_search_id,p_operation_id,p_suggestion_id,p_action,p_expected_revision,0,'[]','') returning * into saved;
  end if;
  return jsonb_build_object('operation_id',saved.operation_id,'suggestion_id',saved.suggestion_id,'action',saved.action,'preference_revision',saved.preference_revision,
    'approved_rules',saved.approved_rules,'document_hash',saved.document_hash,'recorded_at',saved.recorded_at);
end;
$$;
revoke all on function public.decide_opportunity_search_preference(uuid,uuid,text,bigint,uuid) from public,anon,service_role;
grant execute on function public.decide_opportunity_search_preference(uuid,uuid,text,bigint,uuid) to authenticated;

create function public.read_opportunity_search_preferences(p_search_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();document jsonb;settings public.opportunity_search_adaptive_settings;suggestions jsonb;total integer;
begin
  document:=public.opportunity_search_preference_document(actor,p_search_id);
  select * into settings from public.opportunity_search_adaptive_settings where user_id=actor and search_id=p_search_id;
  select count(*) into total from public.opportunity_search_preference_suggestions where user_id=actor and search_id=p_search_id;
  select coalesce(jsonb_agg(row order by created_at desc,suggestion_id),'[]') into suggestions from (
    select s.created_at,s.suggestion_id,jsonb_build_object('suggestion_id',s.suggestion_id,'rule',s.rule,'origin',s.origin,'created_at',s.created_at,
      'state',coalesce(case a.action when 'approve' then 'approved' when 'reject' then 'rejected' when 'undo' then 'undone' end,'pending'),'decided_at',a.recorded_at) row
      from public.opportunity_search_preference_suggestions s left join lateral(select action,recorded_at from public.opportunity_search_preference_actions a
        where a.user_id=s.user_id and a.search_id=s.search_id and a.suggestion_id=s.suggestion_id order by sequence desc limit 1) a on true
      where s.user_id=actor and s.search_id=p_search_id order by s.created_at desc,s.suggestion_id limit 64) bounded;
  return document||jsonb_build_object('search_id',p_search_id,'adaptation_enabled',coalesce(settings.adaptation_enabled,false),'adaptation_paused',coalesce(settings.adaptation_paused,false),
    'adaptation_revision',coalesce(settings.adaptation_revision,0),'policy',public.opportunity_search_adaptation_policy(),'suggestions',suggestions,'omitted_suggestions',greatest(total-64,0));
end;
$$;
revoke all on function public.read_opportunity_search_preferences(uuid) from public,anon,service_role;
grant execute on function public.read_opportunity_search_preferences(uuid) to authenticated;

-- Extend the installed AF-03 compiler/AF-04 publisher in place, preserving their
-- existing algorithms, immutable histories and legacy strict query API. Check
-- each source anchor so an incompatible prerequisite fails closed.
do $$declare body text;updated text;begin
  body:=pg_get_functiondef('private.compile_opportunity_feedback_snapshot(uuid,uuid)'::regprocedure);
  if position('''preference_revision'',0,''approved_preferences'',''[]''::jsonb' in body)=0 then raise exception 'AF-03 compiler prerequisite differs';end if;
  updated:=replace(body,'fingerprint text; revision bigint;','preferences jsonb; approved jsonb; preference_version bigint; fingerprint text; revision bigint;');
  updated:=replace(updated,'if settings.structured_feedback_enabled then','if settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused then');
  updated:=replace(updated,'fingerprint:=encode(sha256(convert_to(jsonb_build_object(''metric_version''',
    'preferences:=public.opportunity_search_preference_document(p_user_id,p_search_id); preference_version:=(preferences->>''preference_revision'')::bigint; approved:=case when settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused then preferences->''approved_preferences'' else ''[]''::jsonb end; fingerprint:=encode(sha256(convert_to(jsonb_build_object(''adaptation_paused'',settings.adaptation_paused,''adaptation_revision'',settings.adaptation_revision,''metric_version''');
  updated:=replace(updated,'''preference_revision'',0,''approved_preferences'',''[]''::jsonb','''preference_revision'',preference_version,''approved_preferences'',approved');
  if updated=body or position('preferences:=public.opportunity_search_preference_document' in updated)=0 then raise exception 'AF-03 compiler extension did not apply';end if;
  execute updated;
  body:=pg_get_functiondef('public.job_workspace_snapshot_redaction()'::regprocedure);
  if position('select structured_feedback_enabled,consent_revision' in body)=0 then raise exception 'AF-03 redaction prerequisite differs';end if;
  execute replace(body,'select structured_feedback_enabled,consent_revision','select adaptation_enabled and structured_feedback_enabled and not adaptation_paused,consent_revision');
  body:=pg_get_functiondef('private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)'::regprocedure);
  if position('if p_preference_revision<>0 then' in body)=0 then raise exception 'AF-04 plan publication prerequisite differs';end if;
  updated:=replace(body,'if p_preference_revision<>0 then raise exception ''Approved preference revisions require the later preference contract'' using errcode=''40001''; end if;','');
  updated:=replace(updated,'if p_feedback_revision is distinct from settings.feedback_revision then',
    'if p_preference_revision is distinct from (public.opportunity_search_preference_document(p_user_id,p_search_id)->>''preference_revision'')::bigint then raise exception ''Approved preferences changed before plan publication'' using errcode=''40001''; end if; if p_feedback_revision is distinct from settings.feedback_revision then');
  updated:=replace(updated,'jsonb_build_object(''query_revision_id'',p_query_revision_id,''base_revision''',
    'jsonb_build_object(''planning_policy'',public.opportunity_search_adaptation_policy(),''query_revision_id'',p_query_revision_id,''base_revision''');
  updated:=replace(updated,'protocol_version,document,plan_hash)','protocol_version,planning_policy,document,plan_hash)');
  updated:=replace(updated,'p_protocol_version,p_document,fingerprint)','p_protocol_version,public.opportunity_search_adaptation_policy(),p_document,fingerprint)');
  updated:=replace(updated,'''fingerprint_encoding'',''sha256-pg-jsonb-v1'',''basis''',
    '''fingerprint_encoding'',''sha256-pg-jsonb-v1'',''planning_policy'',saved.planning_policy,''basis''');
  if updated=body or position('Approved preferences changed before plan publication' in updated)=0 then
    raise exception 'AF-04 plan extension did not apply';end if;
  execute updated;
  body:=pg_get_functiondef('private.read_opportunity_search_plan(uuid,uuid,uuid)'::regprocedure);
  updated:=replace(body,'''fingerprint_encoding'',''sha256-pg-jsonb-v1'',''basis''',
    '''fingerprint_encoding'',''sha256-pg-jsonb-v1'',''planning_policy'',saved.planning_policy,''basis''');
  if updated=body then raise exception 'AF-04 plan policy reader extension did not apply';end if;
  execute updated;
end $$;

-- Source checks are separate obligations: the 30-query envelope counts query
-- entries only. Explicit source exclusions authorize skipping a stored core
-- query without rewriting its immutable text or pretending it executed.
create function private.opportunity_search_planning_context(p_user_id uuid,p_search_id uuid,p_packet jsonb default null,p_plan_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.opportunity_search_adaptive_settings;plan public.opportunity_search_query_plans;document jsonb;packet jsonb;rules jsonb;preferences jsonb;
  priorities jsonb:='[]';groups jsonb;key_row record;generic jsonb;positive jsonb;negative jsonb;stats jsonb;rule jsonb;priority jsonb;
  adaptation_active boolean;direction text;provisional boolean;untargeted boolean;reason text;observations integer;mean_value numeric;core_count integer:=0;
  source_count integer:=0;mandatory_count integer:=0;discretionary integer;exploration integer;blocked jsonb;due jsonb;current_base integer;protocol text;basis jsonb;
  policy jsonb:=public.opportunity_search_adaptation_policy();minimum_observations integer;positive_threshold numeric;maximum_queries integer;exploration_ratio numeric;
begin
  minimum_observations:=(policy->>'minimum_observations')::integer;positive_threshold:=(policy->>'positive_interest_threshold')::numeric;
  maximum_queries:=(policy->>'maximum_queries')::integer;exploration_ratio:=(policy->>'exploration_ratio')::numeric;
  select revision into current_base from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  packet:=coalesce(p_packet,private.compile_opportunity_feedback_snapshot(p_user_id,p_search_id));
  document:=public.opportunity_search_preference_document(p_user_id,p_search_id);rules:=document->'approved_rules';preferences:=document->'approved_preferences';
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  adaptation_active:=settings.adaptation_enabled and not settings.adaptation_paused and settings.structured_feedback_enabled;
  select * into plan from public.opportunity_search_query_plans where user_id=p_user_id and search_id=p_search_id and id=coalesce(p_plan_id,settings.query_plan_id);
  if p_plan_id is not null and not found then raise exception 'Plan unavailable' using errcode='42501';end if;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  basis:=jsonb_build_object('base_revision',current_base,'feedback_revision',(packet->>'feedback_revision')::bigint,'preference_revision',(document->>'preference_revision')::bigint,'protocol_version',protocol);
  select count(*) into core_count from jsonb_array_elements(coalesce(plan.document->'queries','[]')) q where q->>'role'='core';
  select coalesce(jsonb_agg(jsonb_build_object('query_id',q->'query_id','rule_id',r->'rule_id') order by q->>'query_id',r->>'rule_id'),'[]') into blocked
    from jsonb_array_elements(coalesce(plan.document->'queries','[]')) q cross join jsonb_array_elements(rules) r
    where q->>'role'='core' and r->>'kind'='source_exclusion' and q->>'source_registry_id'=r->>'source_registry_id';
  due:=private.due_opportunity_search_sources(p_user_id,p_search_id,clock_timestamp());
  select count(*),count(*) filter(where d->'mandatory'='true'::jsonb or d->'pinned'='true'::jsonb) into source_count,mandatory_count
    from jsonb_array_elements(due) d join public.opportunity_search_sources s on s.registry_id=(d->>'registry_id')::uuid
    where not exists(select 1 from jsonb_array_elements(rules) r where r->>'kind'='source_exclusion' and r->>'source_registry_id'=d->>'registry_id')
      and (s.provenance='explicit' or s.pinned or s.mandatory or adaptation_active and settings.successful_source_reuse_enabled);
  if adaptation_active then
    groups:=coalesce(packet#>'{aggregates,groups}','[]');
    for key_row in select category,target from(select distinct g->>'kind' category,g->>'key' target from jsonb_array_elements(groups) g) keys order by category collate "C",target collate "C" loop
      if exists(select 1 from jsonb_array_elements(rules) r where r->>'kind' in('emphasis','hard_exclusion') and r->>'category'=key_row.category
        and translate(btrim(r->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=key_row.target) then continue;end if;
      select g into generic from jsonb_array_elements(groups) g where g->>'kind'=key_row.category and g->>'key'=key_row.target and not(g?'polarity');
      select g into positive from jsonb_array_elements(groups) g where g->>'kind'=key_row.category and g->>'key'=key_row.target and g->>'polarity'='positive';
      select g into negative from jsonb_array_elements(groups) g where g->>'kind'=key_row.category and g->>'key'=key_row.target and g->>'polarity'='negative';
      -- Keep the observed statistics, but never turn an untargeted reason into
      -- a fabricated topic/method target or an executable relative priority.
      untargeted:=key_row.category in('topic','method') and key_row.target=key_row.category;
      -- A broad low-scoring topic cohort cannot lend its sample count to one
      -- targeted negative reason. Each directional reason needs its own cohort.
      if negative is not null and positive is not null then
        stats:=coalesce(generic,case when (negative->>'scored')::integer>=(positive->>'scored')::integer then negative else positive end);
      else stats:=coalesce(negative,positive,generic);end if;
      observations:=coalesce((stats->>'scored')::integer,0);mean_value:=(stats->>'mean_interest')::numeric;
      provisional:=false;reason:='supported_mean';direction:='unchanged';
      if untargeted then reason:='untargeted_reason';provisional:=true;direction:='examples_only';
      elsif positive is not null and negative is not null then reason:='contradictory';provisional:=true;
      elsif observations<minimum_observations or mean_value is null then reason:='sparse';provisional:=true;direction:='examples_only';
      elsif negative is not null and mean_value>=positive_threshold or positive is not null and mean_value<positive_threshold then reason:='contradictory';provisional:=true;
      elsif mean_value>=positive_threshold then direction:='increase';
      elsif negative is not null and key_row.category<>'institution' then direction:='decrease';
      else reason:='negative_requires_reason';provisional:=true;end if;
      priorities:=priorities||jsonb_build_array(jsonb_build_object('category',key_row.category,'target',key_row.target,'observations',observations,
        'mean_interest',mean_value,'direction',direction,'provisional',provisional,'basis','feedback','reason',reason));
    end loop;
  end if;
  -- Explicit owner emphasis wins over inferred relative priorities; hard rules
  -- stay in their own typed collection and suppress conflicting soft emphasis.
  if adaptation_active then
    for rule in select r from jsonb_array_elements(preferences) r loop
      priorities:=priorities||jsonb_build_array(jsonb_build_object('category',rule->'category','target',rule->'target','observations',0,'mean_interest',null,
        'direction',case when rule->>'polarity'='positive' then 'increase' else 'decrease' end,'provisional',false,'basis','approved','reason','approved_rule'));
    end loop;
  end if;
  select coalesce(jsonb_agg(p order by case when p->>'basis'='approved' then 0 else 1 end,(p->>'mean_interest')::numeric desc nulls last,
    p->>'category' collate "C",p->>'target' collate "C"),'[]') into priorities from jsonb_array_elements(priorities) p;
  discretionary:=greatest(0,maximum_queries-core_count);exploration:=case when adaptation_active and discretionary>0 then least(discretionary,greatest((policy->>'minimum_exploration_queries')::integer,ceil(discretionary*exploration_ratio)::integer)) else 0 end;
  return jsonb_build_object('policy',policy,'enabled',adaptation_active,'paused',settings.adaptation_paused,
    'consent_enabled',settings.structured_feedback_enabled,'preference_revision',(document->>'preference_revision')::bigint,'approved_rules',rules,'approved_preferences',preferences,
    'priorities',priorities,'allocation',jsonb_build_object('maximum_queries',maximum_queries,'core_queries',core_count,'mandatory_source_checks',mandatory_count,'source_obligations',source_count,
      'discretionary',discretionary,'adaptive',case when adaptation_active then discretionary-exploration else 0 end,'exploration',exploration,'capacity_limited',discretionary=0),
    'blocked_core_queries',blocked,'refresh_required',settings.query_plan_dirty or plan.id is null or plan.planning_policy is distinct from policy or plan.base_revision<>current_base
      or plan.feedback_revision<>(packet->>'feedback_revision')::bigint or plan.preference_revision<>(document->>'preference_revision')::bigint or plan.protocol_version<>protocol,
    'basis',basis);
end;
$$;
revoke all on function private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

commit;
