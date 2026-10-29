-- AF-11 rollback acceptance. Synthetic task-tool attestations, no task calls.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();initial_setup_id uuid:=gen_random_uuid();
  rollback_a uuid:=gen_random_uuid();rollback_b uuid:=gen_random_uuid();rollback_c uuid:=gen_random_uuid();legacy_setup uuid:=gen_random_uuid();
  new_setup uuid:=gen_random_uuid();opportunity uuid:=gen_random_uuid();application uuid:=gen_random_uuid();project text:='rrrrrrrrrrrrrrrrrrrr';
  cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
  request jsonb;again jsonb;handoff jsonb;response jsonb;ack jsonb;original_binding jsonb;after_binding jsonb;
  original_template jsonb;original_application jsonb;original_opportunity jsonb;original_review jsonb;original_release jsonb;
  config_revision bigint;release_revision bigint;protocol text;blocked boolean;run_count bigint;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search)
    values(search_a,owner_a,'Synthetic rollback','{"topicsAndMethods":"Acoustics; BCI"}',cadence,
      '{"version":1,"active":true,"editor":{"legacySearchArchive":"PRIVATE_ARCHIVE_CANARY"},"systemPrompt":"PRIVATE_SYSTEM_CANARY","userPrompt":"PRIVATE_USER_PROMPT_CANARY","recurringPrompt":"UNSAFE_PRIVATE_RECOVERY_CANARY"}');
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  update public.opportunity_search_adaptive_release set project_ref=project,enabled=true where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization(search_a,project,true,0);
  perform public.request_adaptive_search_migration(search_a,project,0,initial_setup_id);
  execute 'reset role';
  -- Existing task identity, followed by a real AF-09 validation path using a
  -- synthetic receipt. No SQL helper invokes a scheduler or fabricates a run.
  insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
    values(search_a,owner_a,'synthetic-bound-task',cadence,1,protocol,'legacy-v1');
  handoff:=private.read_adaptive_search_setup(search_a,initial_setup_id,project);
  assert handoff->'compatible'='true'::jsonb,'Synthetic adaptive setup unavailable';
  ack:=handoff#>'{acknowledgement,payload_template}';
  response:=private.ack_adaptive_search_setup(search_a,initial_setup_id,ack);
  assert response->'acknowledged'='true'::jsonb,'Synthetic adaptive task acknowledgement failed';
  insert into public.opportunities(id,opportunity_key,title,contacts)
    values(opportunity,'af11-rollback-'||opportunity,'Synthetic opportunity',
      '[{"entity_id":"rollback-contact","name":"PRIVATE_CONTACT_CANARY","email":"private@example.invalid","roles":["contact"]}]');
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values(owner_a,opportunity,'interested','PRIVATE_COMMENT_CANARY');
  execute 'set local role authenticated';perform public.create_job_application(application,opportunity);execute 'reset role';
  select to_jsonb(t) into original_template from public.opportunity_search_templates t where id=search_a;
  select to_jsonb(a) into original_application from public.applications a where id=application;
  select to_jsonb(o) into original_opportunity from public.opportunities o where id=opportunity;
  select to_jsonb(r) into original_review from public.opportunity_reviews r where user_id=owner_a and opportunity_id=opportunity;
  select to_jsonb(b) into original_binding from public.opportunity_search_schedule_bindings b where search_id=search_a;
  insert into public.opportunity_search_query_revisions(id,user_id,search_id,template_revision,protocol_version,queries)
    values(gen_random_uuid(),owner_a,search_a,1,protocol,'[{"query":"synthetic protected core","sources":["example.invalid"]}]');
  select revision into config_revision from public.opportunity_search_runner_config where search_id=search_a;
  run_count:=(select count(*) from public.opportunity_search_runs where user_id=owner_a);
  execute 'set local role authenticated';
  response:=public.request_adaptive_search_migration(search_a,project,config_revision,gen_random_uuid());
  blocked:=false;begin perform public.request_adaptive_search_rollback(search_a,project,(response->>'revision')::bigint,0,rollback_a);
    exception when serialization_failure then blocked:=true;end;
  assert blocked,'Rollback silently replaced an unresolved pending adaptive setup';
  -- No handoff/task operation was made in this synthetic branch. Explicitly
  -- cancel that intent under its original identity, preserving confirmed mode.
  update public.opportunity_search_runner_config set migration_requested=false where user_id=owner_a and search_id=search_a;
  select revision into config_revision from public.opportunity_search_runner_config where search_id=search_a;
  request:=public.request_adaptive_search_rollback(search_a,project,config_revision,0,rollback_a);
  again:=public.request_adaptive_search_rollback(search_a,project,config_revision,0,rollback_a);
  assert request=again and request->>'desired_mode'='legacy' and request->>'task_restoration'='pending_task_tool_receipt'
    and request->'task_changed'='false'::jsonb,'Owner rollback request is not exact/idempotent intent';
  assert(select mode='adaptive' from public.opportunity_search_runner_config where search_id=search_a)
    and original_binding=(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=search_a),
    'Owner request falsely changed confirmed task mode/binding';
  assert(select enabled from public.opportunity_search_adaptive_release where singleton),'One owner request disabled every project user';
  blocked:=false;begin perform public.request_adaptive_search_rollback(search_a,project,config_revision,0,rollback_a,true);
    exception when serialization_failure then blocked:=true;end;
  assert blocked,'Changed fallback consent reused a request identity';
  blocked:=false;begin perform public.request_adaptive_search_rollback(search_a,project,config_revision,0,gen_random_uuid());
    exception when serialization_failure then blocked:=true;end;
  assert blocked,'Stale rollback CAS overwrote newer intent';
  assert not has_function_privilege(current_user,'private.read_adaptive_search_rollback(uuid,uuid,text)','EXECUTE')
    and not has_function_privilege(current_user,'private.disable_adaptive_search_release(text,bigint)','EXECUTE')
    and not has_function_privilege(current_user,'private.ack_adaptive_search_setup_internal(uuid,uuid,jsonb)','EXECUTE'),
    'Rollback granted private execution to browser';
  blocked:=false;begin update public.opportunity_search_rollback_requests set accept_reviewed_fallback=true where search_id=search_a;
    exception when insufficient_privilege or check_violation then blocked:=true;end;
  assert blocked,'Owner mutated an immutable rollback receipt';
  execute 'reset role';
  select r.release_revision into release_revision from public.opportunity_search_adaptive_release r where r.singleton;
  response:=private.disable_adaptive_search_release(project,release_revision);
  again:=private.disable_adaptive_search_release(project,release_revision);
  assert response=again and response->'adaptive_database_disabled'='true'::jsonb and response->>'task_restoration'='not_performed'
    and response->'task_changed'='false'::jsonb,'Technical release stop claimed a task operation or is not retry-safe';
  assert original_binding=(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=search_a),
    'Release stop changed task binding';
  response:=private.begin_adaptive_opportunity_search(search_a,gen_random_uuid());
  assert response->'compatible'='false'::jsonb,'Disabled release still accepts adaptive startup';
  response:=private.read_adaptive_search_rollback(search_a,rollback_a,project);
  assert response#>>'{error,code}'='fallback_acceptance_required' and not(response?'recurringPrompt'),
    'Unacknowledged legacy fallback bypassed explicit owner acceptance';
  assert not exists(select 1 from private.opportunity_search_setup_operations where setup_id=rollback_a),
    'Rejected rollback preparation left a setup operation';
  execute 'set local role authenticated';
  request:=public.request_adaptive_search_rollback(search_a,project,(request->>'runner_revision')::bigint,1,rollback_b,true);
  execute 'reset role';
  response:=private.read_adaptive_search_rollback(search_a,rollback_a,project);
  assert response#>>'{error,code}'='rollback_stale','Superseded owner intent produced a rollback handoff';
  perform set_config('request.jwt.claims','{}',true);
  assert auth.uid() is null,'Management rollback fixture still has an owner JWT';
  handoff:=private.read_adaptive_search_rollback(search_a,rollback_b,project);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  assert handoff->'compatible'='true'::jsonb and handoff->>'mode'='legacy' and handoff#>>'{target,task_id}'='synthetic-bound-task'
    and handoff#>>'{rollback,prompt_origin}'='reviewed_legacy_fallback' and handoff#>>'{rollback,prompt_version}'='legacy-dynamic-v1'
    and handoff#>'{rollback,previous_task_tool_acknowledgement}'='false'::jsonb and handoff#>'{rollback,unattended_execution_verified}'='false'::jsonb
    and handoff#>'{rollback,adaptive_database_disabled}'='true'::jsonb,'Release-off handoff or fallback provenance is misleading';
  assert handoff::text!~'PRIVATE_|private@example.invalid|"contacts"[[:space:]]*:|systemPrompt|legacySearchArchive'
    and position('private.begin_opportunity_search(' in handoff->>'recurringPrompt')>0
    and handoff#>>'{acknowledgement,helper}'='private.ack_adaptive_search_rollback(uuid,uuid,jsonb)',
    'Rollback returned editor/private data or the wrong technical acknowledgement';
  assert handoff=private.read_adaptive_search_rollback(search_a,rollback_b,project),'Same rollback ID did not reuse exact handoff';
  assert(select mode='adaptive' from public.opportunity_search_runner_config where search_id=search_a)
    and original_binding=(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=search_a),
    'Preparing handoff claimed task restoration';
  response:=private.read_adaptive_search_setup(search_a,gen_random_uuid(),project);
  assert response#>>'{error,code}'='setup_in_progress','Rollback claim allowed a competing technical handoff';
  ack:=handoff#>'{acknowledgement,payload_template}';
  response:=private.ack_adaptive_search_setup(search_a,rollback_b,ack);
  assert response->'acknowledged' is distinct from 'true'::jsonb,'Old setup endpoint partially acknowledged a rollback';
  response:=private.ack_adaptive_search_rollback(search_a,rollback_b,jsonb_set(ack,'{task_tool_receipt,success}','false'));
  assert response#>>'{error,code}'='task_tool_not_confirmed','Failed task operation was accepted as restoration';
  response:=private.ack_adaptive_search_rollback(search_a,rollback_b,jsonb_set(ack,'{task_id}','"some-other-task"'));
  assert response#>>'{error,code}'='binding_changed','Rollback switched to a different task';
  assert original_binding=(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=search_a)
    and exists(select 1 from public.opportunity_search_setup_claims where search_id=search_a and setup_id=rollback_b),
    'Uncertain/failed task update changed binding or silently released its claim';
  response:=private.ack_adaptive_search_rollback(search_a,rollback_b,ack);
  assert response->'acknowledged'='true'::jsonb and response->'historical'='false'::jsonb
    and response->>'task_restoration'='acknowledged_at_receipt' and response->'unattended_execution_verified'='false'::jsonb,
    'Real matching task-tool attestation did not confirm rollback';
  assert(select mode='legacy' and not migration_requested from public.opportunity_search_runner_config where search_id=search_a)
    and(select task_id='synthetic-bound-task' and runner_capability='legacy-v1' and confirmed_setup_id=rollback_b
      from public.opportunity_search_schedule_bindings where search_id=search_a),'Acknowledgement did not update the same confirmed task';
  assert not exists(select 1 from public.opportunity_search_setup_claims where search_id=search_a),'Successful acknowledgement left an unresolved claim';
  assert response->>'technical_publication'='legacy_prompt_restored'
    and(select meta_search->>'recurringPrompt'=handoff->>'recurringPrompt' and meta_search->>'systemPrompt'=handoff->>'recurringPrompt'
      from public.opportunity_search_templates where id=search_a)
    and exists(select 1 from public.opportunity_search_query_revisions q join public.opportunity_search_templates t on t.id=q.search_id
      where q.user_id=owner_a and q.search_id=search_a and q.template_revision=t.revision
        and q.queries='[{"query":"synthetic protected core","sources":["example.invalid"]}]'::jsonb),
    'Rollback left an adaptive saved prompt or lost the unchanged core/manual query bytes';
  again:=private.ack_adaptive_search_rollback(search_a,rollback_b,ack);
  assert again->'acknowledged'='true'::jsonb and again->'historical'='true'::jsonb and again->>'current_task_state'='not_rechecked',
    'Terminal rollback retry falsely claimed current scheduler state';
  response:=private.ack_adaptive_search_rollback(search_a,rollback_b,jsonb_set(ack,'{explicit_selection_confirmed}','true'));
  assert response#>>'{error,code}'='ack_payload_mismatch','Changed acknowledgement body reused a terminal receipt';
  assert original_template-array['meta_search','revision','updated_at']=(select to_jsonb(t)-array['meta_search','revision','updated_at'] from public.opportunity_search_templates t where id=search_a)
    and original_template#>'{meta_search,editor}'=(select meta_search->'editor' from public.opportunity_search_templates where id=search_a)
    and original_template#>'{meta_search,userPrompt}'=(select meta_search->'userPrompt' from public.opportunity_search_templates where id=search_a)
    and original_application=(select to_jsonb(a) from public.applications a where id=application)
    and original_opportunity=(select to_jsonb(o) from public.opportunities o where id=opportunity)
    and original_review=(select to_jsonb(r) from public.opportunity_reviews r where user_id=owner_a and opportunity_id=opportunity)
    and run_count=(select count(*) from public.opportunity_search_runs where user_id=owner_a),
    'Feature rollback changed base intent/editor archives, research, private outcomes/applications, or fabricated a run';

  -- A separately acknowledged known dynamic legacy setup is eligible as an
  -- archive. Establish it through the actual unchanged AF-09 legacy path.
  begin
    update public.opportunity_search_templates set meta_search=jsonb_set(meta_search,'{recurringPrompt}',to_jsonb(private.adaptive_search_recurring_prompt(search_a,project))),
      revision=revision+1 where id=search_a;
    response:=private.read_adaptive_search_setup(search_a,legacy_setup,project);
    assert response#>>'{error,code}'='setup_conversion_required'
      and not exists(select 1 from private.opportunity_search_setup_operations where setup_id=legacy_setup),
      'Legacy-v1 setup advertised an adaptive prompt or retained a rejected operation';
    raise no_data_found using message='Restore isolated invalid technical publication';
  exception when no_data_found then null;end;
  handoff:=private.read_adaptive_search_setup(search_a,legacy_setup,project);
  assert handoff->'compatible'='true'::jsonb and handoff->>'mode'='legacy','Legacy staged caller no longer works after rollback';
  response:=private.ack_adaptive_search_setup(search_a,legacy_setup,handoff#>'{acknowledgement,payload_template}');
  assert response->'acknowledged'='true'::jsonb,'Normal legacy acknowledgement wrapper regressed';
  update public.opportunity_search_adaptive_release set enabled=true where singleton;
  select revision into config_revision from public.opportunity_search_runner_config where search_id=search_a;
  execute 'set local role authenticated';perform public.request_adaptive_search_migration(search_a,project,config_revision,new_setup);execute 'reset role';
  handoff:=private.read_adaptive_search_setup(search_a,new_setup,project);
  response:=private.ack_adaptive_search_setup(search_a,new_setup,handoff#>'{acknowledgement,payload_template}');
  assert response->'acknowledged'='true'::jsonb,'New staged caller cannot re-enable an explicitly requested adaptive task';
  select to_jsonb(b) into after_binding from public.opportunity_search_schedule_bindings b where search_id=search_a;
  response:=private.ack_adaptive_search_rollback(search_a,rollback_b,ack);
  assert response->'historical'='true'::jsonb and after_binding=(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=search_a)
    and(select mode='adaptive' from public.opportunity_search_runner_config where search_id=search_a),
    'Old rollback retry overwrote a newer acknowledged task mode';
  select revision into config_revision from public.opportunity_search_runner_config where search_id=search_a;
  execute 'set local role authenticated';
  request:=public.request_adaptive_search_rollback(search_a,project,config_revision,2,rollback_c,false);
  execute 'reset role';
  handoff:=private.read_adaptive_search_rollback(search_a,rollback_c,project);
  assert handoff->'compatible'='true'::jsonb and handoff#>>'{rollback,prompt_origin}'='acknowledged_legacy'
    and handoff#>'{rollback,previous_task_tool_acknowledgement}'='true'::jsonb
    and handoff#>'{rollback,unattended_execution_verified}'='false'::jsonb,'Known acknowledged legacy archive was lost or overstated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  blocked:=false;begin perform public.request_adaptive_search_rollback(search_a,project,0,0,gen_random_uuid(),true);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Another owner requested a rollback';execute 'reset role';
  response:=private.read_adaptive_search_rollback(search_a,rollback_c,'ssssssssssssssssssss');
  assert response#>>'{error,code}'='scope_unavailable','Wrong project read rollback handoff';
end $$;

-- A valid recovery archive close to the installed 3-MiB bound must never be
-- truncated or prevent acknowledging a real task result. Explicit owner
-- publication is a separate recoverable next step, including lost responses.
do $$
declare owner_id uuid:=gen_random_uuid();search_id_value uuid:=gen_random_uuid();setup_id_value uuid:=gen_random_uuid();
  rollback_id_value uuid:=gen_random_uuid();legacy_setup_value uuid:=gen_random_uuid();project_ref_value text:='rrrrrrrrrrrrrrrrrrrr';
  cadence_value jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
  large_meta jsonb;republished_meta jsonb;short_prompt text;handoff_value jsonb;ack_value jsonb;result_value jsonb;request_value jsonb;
  template_revision_value integer;runner_revision_value bigint;protocol_value text;
begin
  large_meta:=jsonb_build_object('version',1,'active',true,'editor',jsonb_build_object('legacySearchArchive',''),
    'systemPrompt','Old safe technical instructions.','userPrompt','Shared acoustic research.','recurringPrompt','Old safe recurring instructions.');
  large_meta:=jsonb_set(large_meta,'{editor,legacySearchArchive}',to_jsonb('PRIVATE_LARGE_ARCHIVE_CANARY'||
    repeat('x',2999000-octet_length(large_meta::text)-char_length('PRIVATE_LARGE_ARCHIVE_CANARY'))));
  assert octet_length(large_meta::text)=2999000,'Near-limit fixture does not match the installed metadata byte bound';
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search)
    values(search_id_value,owner_id,'Synthetic near-limit archive','{"topicsAndMethods":"Acoustic sensing"}',cadence_value,large_meta);
  update public.opportunity_search_adaptive_release set enabled=true,project_ref=project_ref_value where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization(search_id_value,project_ref_value,true,0);
  perform public.request_adaptive_search_migration(search_id_value,project_ref_value,0,setup_id_value);
  execute 'reset role';
  select s.active_protocol_version into protocol_value from private.opportunity_search_settings s where s.singleton;
  insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
    values(search_id_value,owner_id,'synthetic-large-archive-task',cadence_value,1,protocol_value,'legacy-v1');
  handoff_value:=private.read_adaptive_search_setup(search_id_value,setup_id_value,project_ref_value);
  result_value:=private.ack_adaptive_search_setup(search_id_value,setup_id_value,handoff_value#>'{acknowledgement,payload_template}');
  assert result_value->'acknowledged'='true'::jsonb,'Large archive fixture did not establish an actual synthetic task acknowledgement';
  select c.revision into runner_revision_value from public.opportunity_search_runner_config c where c.search_id=search_id_value;
  execute 'set local role authenticated';
  request_value:=public.request_adaptive_search_rollback(search_id_value,project_ref_value,runner_revision_value,0,rollback_id_value,true);
  execute 'reset role';
  handoff_value:=private.read_adaptive_search_rollback(search_id_value,rollback_id_value,project_ref_value);
  assert handoff_value->'compatible'='true'::jsonb and octet_length(handoff_value::text)<65536
    and handoff_value::text not like '%PRIVATE_LARGE_ARCHIVE_CANARY%','Bounded rollback handoff loaded recovery archive contents';
  assert octet_length(jsonb_set(jsonb_set(large_meta,'{systemPrompt}',handoff_value->'recurringPrompt'),
    '{recurringPrompt}',handoff_value->'recurringPrompt')::text)>3000000,'Near-limit fixture would not overflow technical republish';
  ack_value:=handoff_value#>'{acknowledgement,payload_template}';
  result_value:=private.ack_adaptive_search_rollback(search_id_value,rollback_id_value,ack_value);
  assert result_value->'acknowledged'='true'::jsonb and result_value->'requires_owner_republish'='true'::jsonb
    and result_value->>'technical_publication'='requires_owner_republish','Oversized optional publication aborted actual task acknowledgement';
  assert(select t.meta_search=large_meta and t.revision=1 from public.opportunity_search_templates t where t.id=search_id_value)
    and(select c.mode='legacy' from public.opportunity_search_runner_config c where c.search_id=search_id_value)
    and(select b.runner_capability='legacy-v1' and b.confirmed_setup_id=rollback_id_value from public.opportunity_search_schedule_bindings b where b.search_id=search_id_value),
    'Bounded publication truncated the archive or lost the actual restored task confirmation';
  result_value:=private.ack_adaptive_search_rollback(search_id_value,rollback_id_value,ack_value);
  assert result_value->'historical'='true'::jsonb and result_value->'requires_owner_republish'='true'::jsonb,
    'Lost first response hid pending owner publication';
  result_value:=private.read_adaptive_search_setup(search_id_value,legacy_setup_value,project_ref_value);
  assert result_value#>>'{error,code}'='setup_conversion_required'
    and not exists(select 1 from private.opportunity_search_setup_operations o where o.setup_id=legacy_setup_value),
    'Normal setup used old technical prose before explicit owner republish';
  short_prompt:='Run the saved search in Supabase project '||project_ref_value||' with SELECT private.begin_opportunity_search('''||search_id_value::text||
    '''::uuid, ''<fresh-run-uuid>''::uuid). Require bootstrap_version=1 and compatible=true; follow current criteria, protocol_text and result_schema. Never change tasks.';
  republished_meta:=jsonb_set(jsonb_set(large_meta,'{systemPrompt}',to_jsonb(short_prompt)),'{recurringPrompt}',to_jsonb(short_prompt));
  assert octet_length(republished_meta::text)<=3000000 and republished_meta->'editor'=large_meta->'editor','Explicit short republish would alter the archive';
  execute 'set local role authenticated';
  perform public.save_opportunity_meta_search(search_id_value,1,'Synthetic near-limit archive','{"topicsAndMethods":"Acoustic sensing"}',cadence_value,republished_meta);
  execute 'reset role';
  handoff_value:=private.read_adaptive_search_setup(search_id_value,legacy_setup_value,project_ref_value);
  assert handoff_value->'compatible'='true'::jsonb and handoff_value->>'mode'='legacy' and handoff_value->>'recurringPrompt'=short_prompt,
    'Explicit owner publication did not recover normal legacy setup';
  assert(select t.revision=2 and t.meta_search->'editor'=large_meta->'editor' from public.opportunity_search_templates t where t.id=search_id_value),
    'Explicit owner republish did not preserve full editor/recovery data';
  result_value:=private.ack_adaptive_search_rollback(search_id_value,rollback_id_value,ack_value);
  assert result_value->'historical'='true'::jsonb and result_value->'requires_owner_republish'='false'::jsonb,
    'Historical retry did not reflect current recovered publication';
end $$;
rollback;
