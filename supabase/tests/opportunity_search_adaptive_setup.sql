-- AF-09 synthetic setup lifecycle. No external task/scheduler operation occurs.
begin;
create function pg_temp.setup_ack_payload(p_handoff jsonb,p_task text,p_operation text default 'update',p_selected boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('schema_version',1,'operation',p_operation,'task_id',p_task,'schedule',p_handoff->'schedule',
    'recurring_prompt_hash',p_handoff->'recurring_prompt_hash','task_tool_receipt',jsonb_build_object('success',true,'task_id',p_task,'schedule',p_handoff->'schedule','operation',p_operation),
    'explicit_selection_confirmed',p_selected,'approved_superseded_task_ids','[]'::jsonb,'disabled_task_ids','[]'::jsonb)
$$;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();legacy_search uuid:=gen_random_uuid();archive_search uuid:=gen_random_uuid();
  unbound_search uuid:=gen_random_uuid();legacy_claim_search uuid:=gen_random_uuid();setup_a uuid:=gen_random_uuid();setup_b uuid:=gen_random_uuid();stale_setup uuid:=gen_random_uuid();
  legacy_setup uuid:=gen_random_uuid();scope_setup uuid:=gen_random_uuid();second_setup uuid:=gen_random_uuid();target uuid:=gen_random_uuid();old_legacy_run uuid:=gen_random_uuid();
  legacy_claim_run uuid:=gen_random_uuid();rival_legacy_run uuid:=gen_random_uuid();
  project text:='cccccccccccccccccccc';schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
  changed_schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:30","timezone":"UTC","runImmediately":false}';
  protocol text;state jsonb;result jsonb;again jsonb;handoff jsonb;payload jsonb;prior_meta jsonb;static_prompt text;legacy_prompt text;bound_task text:='task ''Ä'' original 01';
  before_runs integer;before_opportunities integer;before_revision integer;before_acknowledgements integer;blocked boolean;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values
    (search_a,owner_a,'Synthetic setup','{"topicsAndMethods":"BCI; Acoustics"}',schedule,
      '{"version":1,"active":true,"editor":{"id":"shared","name":"Shared","legacySearchArchive":"RECOVERY_PRIVATE_CANARY"},"systemPrompt":"SYSTEM_PRIVATE_CANARY execute_sql DROP TABLE","userPrompt":"USER_PRIVATE_CANARY","recurringPrompt":"Legacy current shared research"}'),
    (legacy_search,owner_a,'Synthetic legacy setup','{"topicsAndMethods":"BCI"}',schedule,null),
    (archive_search,owner_a,'Synthetic retired setup','{"topicsAndMethods":"BCI"}',schedule,
      '{"version":1,"active":true,"editor":{"profiles":[{"professionalContext":"ARCHIVE_PRIVATE_CANARY"}]},"systemPrompt":"old","userPrompt":"old","recurringPrompt":"old archived profile"}'),
    (unbound_search,owner_a,'Synthetic unbound setup','{"topicsAndMethods":"BCI"}',schedule,null),
    (legacy_claim_search,owner_a,'Synthetic uncertain legacy setup','{"topicsAndMethods":"BCI"}',schedule,null);
  legacy_prompt:='Run the saved CV Harness shared search in Supabase project '||project||'; exact search UUID '||legacy_search||'. Use SELECT private.begin_opportunity_search('''||legacy_search||'''::uuid, ''<fresh-run-uuid>''::uuid) through execute_sql. Do not create or change tasks during daily research.';
  update public.opportunity_search_templates set meta_search=jsonb_build_object('version',1,'active',true,'editor',jsonb_build_object(
    'id','shared','name','Shared','researchInterests','BCI','legacySearchArchive','LEGACY_RECOVERY_PRIVATE_CANARY'),
    'systemPrompt','PRIVATE_SYSTEM_ARCHIVE','userPrompt','PRIVATE_USER_ARCHIVE','recurringPrompt',legacy_prompt),revision=revision+1 where id=legacy_search;
  update public.opportunity_search_templates set meta_search=jsonb_build_object('version',1,'active',true,'editor','{"id":"shared","name":"Shared"}'::jsonb,
    'systemPrompt','legacy','userPrompt','shared','recurringPrompt','Run this saved shared research without changing tasks.'),revision=revision+1 where id=unbound_search;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version)
    values(search_a,owner_a,bound_task,schedule,1,protocol);
  -- Genuine legacy claim prerequisites; neither fixture records web execution
  -- or creates an external task. Existing uncertainty must remain visible.
  perform private.begin_opportunity_search(legacy_claim_search,legacy_claim_run);
  perform private.save_opportunity_search_queries(legacy_claim_run,'[{"query":"synthetic historical legacy claim prerequisite"}]');
  perform private.complete_opportunity_search(legacy_claim_run,'{"status":"complete","notes":"Synthetic legacy claim prerequisite; no web checks recorded","unresolvedCount":0}');
  perform private.claim_opportunity_search_schedule(legacy_claim_search,legacy_claim_run);
  result:=private.read_adaptive_search_setup(legacy_claim_search,gen_random_uuid(),project);
  assert result#>>'{error,code}'='setup_in_progress' and exists(select 1 from private.opportunity_search_schedule_claims c where c.search_id=legacy_claim_search),
    'An uncertain old legacy create claim permitted another create-capable handoff';
  perform private.begin_opportunity_search(legacy_search,rival_legacy_run);
  perform private.save_opportunity_search_queries(rival_legacy_run,'[{"query":"synthetic old protocol claim race"}]');
  perform private.complete_opportunity_search(rival_legacy_run,'{"status":"complete","notes":"Synthetic legacy claim race prerequisite; no web checks recorded","unresolvedCount":0}');
  select count(*) into before_runs from public.opportunity_search_runs;select count(*) into before_opportunities from public.opportunities;
  result:=private.read_adaptive_search_setup(legacy_search,legacy_setup,project);
  assert result->'compatible'='true'::jsonb and result->>'mode'='legacy' and result->>'recurringPrompt'=legacy_prompt,'Valid modern legacy handoff failed';
  assert result::text!~'PRIVATE_CANARY|PRIVATE_SYSTEM_ARCHIVE|PRIVATE_USER_ARCHIVE|legacySearchArchive|systemPrompt|userPrompt|"editor"','Legacy setup exposed recovery/private archives';
  again:=private.read_adaptive_search_setup(legacy_search,legacy_setup,project);assert again=result,'Legacy setup read changed on exact retry';
  blocked:=false;begin perform private.claim_opportunity_search_schedule(legacy_search,rival_legacy_run);exception when object_not_in_prerequisite_state then blocked:=true;end;
  assert blocked and not exists(select 1 from private.opportunity_search_schedule_claims c where c.search_id=legacy_search)
    and exists(select 1 from public.opportunity_search_setup_claims c where c.search_id=legacy_search and c.setup_id=legacy_setup),
    'An outstanding AF09 claim permitted a legacy helper to authorize a second create';
  result:=private.read_adaptive_search_setup(archive_search,gen_random_uuid(),project);
  assert result#>>'{error,code}'='setup_conversion_required' and result::text!~'ARCHIVE_PRIVATE_CANARY','Retired editor profile leaked into legacy handoff';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  state:=public.read_adaptive_search_readiness(search_a,project);
  assert state->>'mode'='legacy' and state->'migration_requested'='false'::jsonb and state->'setup_id'='null'::jsonb,'Installation automatically migrated a task';
  blocked:=false;begin perform public.request_adaptive_search_migration(search_a,project,0,setup_a);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Owner requested adaptive setup without full enabled release';execute 'reset role';
  update public.opportunity_search_adaptive_release set enabled=true,project_ref=project where singleton;
  execute 'set local role authenticated';
  state:=public.read_adaptive_search_readiness(search_a,project);assert state->>'readiness_code'='owner_not_authorized','Release implied owner consent';
  perform public.set_opportunity_search_runner_authorization(legacy_search,project,true,0);
  state:=public.read_adaptive_search_readiness(legacy_search,project);
  assert(state->>'setup_id')::uuid=legacy_setup and state->>'mode'='legacy' and state->'migration_requested'='false'::jsonb,
    'Protected pending legacy setup metadata was missing or implied adaptive migration';
  blocked:=false;begin perform public.request_adaptive_search_migration(legacy_search,project,0,gen_random_uuid());exception when serialization_failure then blocked:=true;end;
  assert blocked and not exists(select 1 from public.opportunity_search_runner_config c where c.search_id=legacy_search),
    'A new adaptive request stranded an outstanding legacy handoff';
  blocked:=false;begin perform public.request_adaptive_search_migration(legacy_search,project,0,legacy_setup);exception when serialization_failure then blocked:=true;end;
  assert blocked,'An outstanding legacy handoff changed mode under its existing identity';
  assert has_table_privilege(current_user,'public.opportunity_search_setup_claims','SELECT')
    and not has_table_privilege(current_user,'public.opportunity_search_setup_claims','INSERT')
    and not has_table_privilege(current_user,'public.opportunity_search_setup_claims','UPDATE')
    and not has_table_privilege(current_user,'public.opportunity_search_setup_claims','DELETE'),'Outstanding setup metadata was not owner-read-only';
  perform public.set_opportunity_search_runner_authorization(search_a,project,true,0);
  select revision,meta_search into before_revision,prior_meta from public.opportunity_search_templates where id=search_a;
  state:=public.request_adaptive_search_migration(search_a,project,0,setup_a);
  assert state->'ready'='true'::jsonb and state->'migration_requested'='true'::jsonb and state->>'mode'='legacy','A request claimed successful task migration';
  assert state=public.request_adaptive_search_migration(search_a,project,0,setup_a),'Lost request response was not idempotent';
  blocked:=false;begin perform public.request_adaptive_search_migration(search_a,project,1,gen_random_uuid());exception when serialization_failure then blocked:=true;end;
  assert blocked and(public.read_adaptive_search_readiness(search_a,project)->>'setup_id')::uuid=setup_a,
    'A later migration request replaced the outstanding setup identity';
  assert(select revision from public.opportunity_search_templates where id=search_a)=before_revision
    and(select meta_search from public.opportunity_search_templates where id=search_a)=prior_meta,'Technical request rewrote base/editor version1';
  assert not has_table_privilege(current_user,'public.opportunity_search_schedule_bindings','INSERT')
    and not has_table_privilege(current_user,'public.opportunity_search_schedule_bindings','UPDATE'),'Browser gained legacy task-binding writes';
  assert not has_function_privilege(current_user,'private.read_adaptive_search_setup(uuid,uuid,text)','EXECUTE')
    and not has_function_privilege(current_user,'private.ack_adaptive_search_setup(uuid,uuid,jsonb)','EXECUTE'),'Browser gained management setup helpers';execute 'reset role';

  handoff:=private.read_adaptive_search_setup(search_a,setup_a,project);
  assert handoff->'compatible'='true'::jsonb and handoff->>'mode'='adaptive' and handoff#>>'{target,task_id}'=bound_task,'Bound task identity was not exact';
  static_prompt:=private.adaptive_search_recurring_prompt(search_a,project);
  assert handoff->>'recurringPrompt'=static_prompt and handoff::text!~'PRIVATE_CANARY|systemPrompt|userPrompt|"editor"','Adaptive handoff used untrusted saved text';
  assert handoff#>'{lifecycle,disable_before_ack}'='false'::jsonb and handoff#>'{lifecycle,broad_purpose_matching}'='false'::jsonb,'Handoff enabled broad/premature disabling';
  assert(select count(*) from public.opportunity_search_runs)=before_runs and(select count(*) from public.opportunities)=before_opportunities,'Setup created fake research history/results';
  -- Ordinary criteria/review/source/preference changes retain exact static task
  -- identity and recurring text. They do not authorize a new scheduler action.
  update public.opportunity_search_templates set criteria='{"topicsAndMethods":"Robotics; Acoustic interfaces"}',revision=revision+1 where id=search_a;
  insert into public.opportunities(id,opportunity_key,title) values(target,'af09-feedback-'||target,'Synthetic reviewed research');
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values(owner_a,target,'strong_interest','PRIVATE_FEEDBACK_CANARY');
  execute 'set local role authenticated';
  perform public.save_opportunity_search_source(search_a,gen_random_uuid(),'{"listing_url":"https://example.invalid/Jobs","enabled":true}');
  perform public.save_opportunity_feedback(target,'{"interest_rating":2}');execute 'reset role';
  again:=private.read_adaptive_search_setup(search_a,setup_a,project);
  assert again=handoff and private.adaptive_search_recurring_prompt(search_a,project)=static_prompt,'Feedback/base/source change rewrote static task text';
  -- A genuine old legacy API fixture at this same base revision must not be
  -- able to rewrite the acknowledged adaptive binding later.
  perform private.begin_opportunity_search(search_a,old_legacy_run);
  perform private.save_opportunity_search_queries(old_legacy_run,'[{"query":"synthetic historical legacy query"}]');
  perform private.complete_opportunity_search(old_legacy_run,'{"status":"complete","notes":"Historical legacy prerequisite fixture; no web checks recorded","unresolvedCount":0}');
  select count(*) into before_runs from public.opportunity_search_runs;
  payload:=pg_temp.setup_ack_payload(handoff,bound_task);
  result:=private.ack_adaptive_search_setup(search_a,setup_a,jsonb_set(payload,'{task_tool_receipt,success}','false'));
  assert result#>>'{error,code}'='task_tool_not_confirmed','Failed task-tool operation claimed success';
  result:=private.ack_adaptive_search_setup(search_a,setup_a,jsonb_set(jsonb_set(payload,'{operation}','null'),'{task_tool_receipt,operation}','null'));
  assert result#>>'{error,code}'='invalid_setup','Null operation bypassed the closed enum';
  result:=private.ack_adaptive_search_setup(search_a,setup_a,jsonb_set(payload,'{task_id}','"unrelated task"'));
  assert result?'error','A bound setup switched to an unrelated task';
  result:=private.ack_adaptive_search_setup(search_a,setup_a,payload);
  assert result->'acknowledged'='true'::jsonb and result->>'task_id'=bound_task and result->>'superseded_disable_status'='not_performed','Actual task attestation was not acknowledged safely';
  again:=private.ack_adaptive_search_setup(search_a,setup_a,payload);assert again=result,'Lost acknowledgement response changed or duplicated binding';
  select count(*) into before_acknowledgements from private.opportunity_search_setup_acknowledgements;
  update private.opportunity_search_setup_acknowledgements a set result=a.result||'{"contacts":{"email":"ACK_CACHE_PRIVATE_CANARY"}}'::jsonb where a.setup_id=setup_a;
  again:=private.ack_adaptive_search_setup(search_a,setup_a,payload);assert again=result and again::text!~'ACK_CACHE_PRIVATE_CANARY','Tampered acknowledgement cache escaped fixed projection';
  assert(select count(*) from private.opportunity_search_setup_acknowledgements)=before_acknowledgements,'Ack retry inserted another operation';
  result:=private.ack_adaptive_search_setup(search_a,setup_a,payload||'{"approved_superseded_task_ids":["explicit old task"]}');
  assert result#>>'{error,code}'='ack_payload_mismatch','Changed ack payload reused setup identity';
  execute 'set local role authenticated';state:=public.read_adaptive_search_readiness(search_a,project);execute 'reset role';
  assert state->>'mode'='adaptive' and state->'migration_requested'='false'::jsonb and state->'setup_id'='null'::jsonb,'Acknowledged mode/pending nonce lifecycle was incorrect';
  assert(select confirmed_run_id is null and confirmed_setup_id=setup_a from public.opportunity_search_schedule_bindings where search_id=search_a),'Ack fabricated a completed run';
  blocked:=false;begin perform private.confirm_opportunity_search_schedule(search_a,old_legacy_run,bound_task,schedule);exception when object_not_in_prerequisite_state then blocked:=true;end;
  assert blocked and(select confirmed_run_id is null and confirmed_setup_id=setup_a and runner_capability='adaptive-batch-v1' from public.opportunity_search_schedule_bindings where search_id=search_a),
    'An old completed legacy run rewrote an adaptive task binding';

  handoff:=private.read_adaptive_search_setup(search_a,stale_setup,project);payload:=pg_temp.setup_ack_payload(handoff,bound_task);
  update public.opportunity_search_templates set schedule=changed_schedule,revision=revision+1 where id=search_a;
  result:=private.ack_adaptive_search_setup(search_a,stale_setup,payload);assert result#>>'{error,code}'='setup_stale','Stale cadence was falsely confirmed';
  assert(select b.schedule from public.opportunity_search_schedule_bindings b where b.search_id=search_a)=schedule,'Failed cadence ack overwrote working task binding';
  handoff:=private.read_adaptive_search_setup(search_a,setup_b,project);assert handoff->'compatible'='true'::jsonb and handoff->'schedule'=changed_schedule,'Confirmed adaptive mode could not prepare a fresh cadence setup';
  payload:=pg_temp.setup_ack_payload(handoff,bound_task);result:=private.ack_adaptive_search_setup(search_a,setup_b,payload);assert result->'acknowledged'='true'::jsonb,'Fresh cadence setup failed';

  -- An unbound search needs explicit target/create approval. A second stale
  -- unbound handoff cannot create another task after the first becomes bound.
  handoff:=private.read_adaptive_search_setup(unbound_search,scope_setup,project);
  again:=private.read_adaptive_search_setup(unbound_search,second_setup,project);
  assert again#>>'{error,code}'='setup_in_progress' and not exists(select 1 from private.opportunity_search_setup_operations o where o.setup_id=second_setup),
    'Two distinct setup UUIDs both authorized unbound task creation';
  assert handoff#>>'{target,kind}'='selection_required','Unbound setup guessed a task by purpose';
  payload:=pg_temp.setup_ack_payload(handoff,'new selected task','create',false);
  result:=private.ack_adaptive_search_setup(unbound_search,scope_setup,payload);assert result#>>'{error,code}'='selection_required','Unbound setup created without explicit selection';
  assert exists(select 1 from public.opportunity_search_setup_claims c where c.search_id=unbound_search and c.setup_id=scope_setup),
    'Uncertain/failed external setup result automatically released its claim';
  payload:=jsonb_set(payload,'{explicit_selection_confirmed}','true');
  result:=private.ack_adaptive_search_setup(unbound_search,scope_setup,payload);assert result->'acknowledged'='true'::jsonb,'Explicit unbound creation receipt failed';
  assert not exists(select 1 from public.opportunity_search_setup_claims c where c.search_id=unbound_search)
    and exists(select 1 from public.opportunity_search_setup_claims c where c.search_id=legacy_search and c.setup_id=legacy_setup),
    'Successful acknowledgement cleared a different operation claim or retained its own';
  result:=private.read_adaptive_search_setup(unbound_search,second_setup,project);
  assert result->'compatible'='true'::jsonb and result#>>'{target,kind}'='bound' and result#>>'{target,task_id}'='new selected task',
    'After reconciliation, a new setup still offered a second create instead of the exact bound task';
  assert(select count(*) from public.opportunity_search_runs)=before_runs and(select count(*) from public.opportunities)=before_opportunities+1,'Setup/ack wrote research results or fake runs';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  blocked:=false;begin perform public.read_adaptive_search_readiness(search_a,project);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Other owner read technical setup state';
  assert not exists(select 1 from public.opportunity_search_setup_claims c where c.user_id=owner_a),'Other owner read outstanding setup metadata';
  execute 'reset role';
end;
$$;
rollback;
