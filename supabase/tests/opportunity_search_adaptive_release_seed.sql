-- AF-11 PRE-MIGRATION synthetic seed. Only the labelled network-disabled test
-- runner loads this file after canonical v5/autosave and before AF-01 additions.
-- Contains no captured production rows. Deliberately commits inside that fixture.
begin;
do $$
declare owner_id uuid:='11000000-0000-4000-8000-000000000001';search_id_value uuid:='11000000-0000-4000-8000-000000000002';
  run_id_value uuid:='11000000-0000-4000-8000-000000000003';item_id_value uuid:='11000000-0000-4000-8000-000000000004';
  app_id uuid:='11000000-0000-4000-8000-000000000005';cv_id uuid:='11000000-0000-4000-8000-000000000006';opp_id uuid;protocol text;
  checked text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');payload jsonb;setup jsonb;
  cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  if current_database()<>'adaptive_feedback_test' then raise exception 'Only the isolated adaptive fixture is allowed';end if;
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values(search_id_value,owner_id,'AF11 preserved legacy search',
    '{"topicsAndMethods":"Synthetic acoustic sensing","locationsAndLanguages":"Scandinavia first; Europe","fundingAndConditions":"Funded research"}',cadence,
    '{"version":1,"active":true,"editor":{"id":"shared","researchInterests":"Synthetic acoustic sensing","legacySearchArchive":"SEED_RECOVERY_PRIVATE_CANARY"},"systemPrompt":"SEED_SYSTEM_PRIVATE_CANARY","userPrompt":"SEED_USER_PRIVATE_CANARY","recurringPrompt":"Run the saved shared research without changing tasks."}');
  perform private.begin_opportunity_search(search_id_value,run_id_value);
  perform private.save_opportunity_search_queries(run_id_value,'[{"query":"synthetic acoustic sensing legacy core","sources":["https://example.invalid/Jobs?Subject=Acoustics"]}]');
  payload:=jsonb_build_object('opportunity_key','af11-preserved-canonical','title','Synthetic acoustic research','institution','Synthetic Institute','topics','["Acoustics","BCI"]'::jsonb,
    'official_url','https://example.invalid/Vacancy/LegacyCase','research_summary','Synthetic immutable public research summary.',
    'contacts','[{"name":"Synthetic Contact","email":"contact@example.invalid","roles":["contact"]}]'::jsonb,
    'supervisors','[{"name":"Synthetic Supervisor","roles":["supervisor"]}]'::jsonb,
    'requirements','[{"text":"Synthetic required experience","status":"required","stage":"recruitment","conditions":[]},{"text":"Synthetic conditional qualification","status":"conditional","stage":"doctoral_admission","conditions":["If selected"]}]'::jsonb,
    'required_documents','[{"text":"Synthetic motivation letter","status":"required","stage":"recruitment","conditions":[],"max_words":500},{"text":"Synthetic optional portfolio","status":"optional","stage":"recruitment","conditions":[]}]'::jsonb,
    'personal_fit','{"score":8.25,"scale_min":0,"scale_max":10,"summary":"Synthetic technical alignment."}'::jsonb,
    'rd_career_potential','{"score":7.5,"scale_min":0,"scale_max":10,"summary":"Synthetic industrial research potential."}'::jsonb,
    'research_career_potential','{"score":8,"scale_min":0,"scale_max":10,"summary":"Synthetic research potential."}'::jsonb,'last_checked_at',checked,
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/LegacyCase','kind','official','checked_at',checked,'precision','instant',
      'supports','["title","institution","topics","official_url","research_summary","contacts","supervisors","requirements","required_documents","personal_fit","rd_career_potential","research_career_potential"]'::jsonb)));
  perform private.submit_opportunity_search_result(run_id_value,item_id_value,payload);
  perform private.verify_opportunity_search_result(run_id_value,item_id_value);
  perform private.complete_opportunity_search(run_id_value,'{"status":"complete","unresolvedCount":0,"notes":"SEED_LEGACY_RUN_PRIVATE_CANARY"}');
  select r.opportunity_id into opp_id from public.opportunity_search_receipts r where r.run_id=run_id_value and r.item_id=item_id_value;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,confirmed_run_id,protocol_version)
    values(search_id_value,owner_id,'synthetic-existing-task',cadence,1,run_id_value,protocol);
  insert into public.cv_variants(id,user_id,name,content_json,config_json) values(cv_id,owner_id,'Synthetic preserved CV',
    '{"contact":{"name":"","location":"","role":"","email":"","phone":"","website":"","linkedin":"","github":""},"about":"SEED_CV_PRIVATE_CANARY","education":[],"experience":[],"languages":[],"hobbies":[]}', '{"lang":"en"}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.create_job_application(app_id,opp_id);
  update public.applications set cv_variant_id=cv_id,notes='SEED_APPLICATION_PRIVATE_CANARY',status='submitted' where id=app_id;
  perform public.set_job_application_checklist_item(app_id,'requirements:synthetic-required',true);
  perform public.set_job_application_checklist_item(app_id,'documents:synthetic-letter',true);
  perform public.review_job_opportunity(opp_id,(select o.updated_at from public.opportunities o where o.id=opp_id),'strong_interest');
  perform public.save_opportunity_comment(opp_id,'SEED_COMMENT_PRIVATE_CANARY');
  setup:='{"language":"en","maxWords":500,"template":{"id":"synthetic-frozen-letter","name":"Synthetic frozen letter","revision":1,"structure":"SEED_LETTER_PRIVATE_CANARY","tone":"Professional","language":"en","maxWords":500,"updatedAt":"2026-10-20T10:00:00Z","researchInterests":"Synthetic acoustic sensing"}}';
  perform public.save_refinement_state(app_id,setup,'{"cv":null,"letter":null}',0);
  insert into public.local_attachment_metadata(id,user_id,name,description) values(gen_random_uuid(),owner_id,'Synthetic letter PDF','SEED_ATTACHMENT_PRIVATE_CANARY');
  execute 'reset role';
end;
$$;
commit;
