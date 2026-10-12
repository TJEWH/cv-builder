-- Run as postgres after schema.sql or opportunity_search.sql. Synthetic fixtures roll back.
begin;
do $$
declare owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); search_a uuid:=gen_random_uuid(); search_b uuid:=gen_random_uuid();
  run_a uuid:=gen_random_uuid(); run_b uuid:=gen_random_uuid(); run_c uuid:=gen_random_uuid(); run_d uuid:=gen_random_uuid(); item_a uuid:=gen_random_uuid(); item_b uuid:=gen_random_uuid();
  saved public.opportunity_search_templates; schedule jsonb:='{"frequency":"weekly","intervalHours":1,"weekdays":[1],"time":"09:00","timezone":"Europe/Berlin","runImmediately":true}';
  criteria jsonb:='{"opportunityTypes":"Funded PhD","topicsAndMethods":"Audio research"}';
  protocol_a text:='test-search-'||gen_random_uuid()::text; protocol_b text:='test-search-'||gen_random_uuid()::text;
  payload jsonb; changed jsonb; receipt jsonb; result jsonb; original jsonb; opportunity uuid; second_opportunity uuid:=gen_random_uuid();
  baseline_count integer; field text;
begin
  select count(*) into baseline_count from public.opportunities;
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
    (owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
    (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
    values(protocol_a,1,'test-a','Synthetic instructions',private.opportunity_search_result_schema()),(protocol_b,1,'test-b','Changed synthetic instructions',private.opportunity_search_result_schema());
  insert into private.opportunity_search_settings(singleton,active_protocol_version) values(true,protocol_a)
    on conflict(singleton) do update set active_protocol_version=excluded.active_protocol_version;
  begin update private.opportunity_search_protocols set protocol_text='changed' where version=protocol_a;
    raise exception 'FAIL: protocol mutation allowed'; exception when check_violation then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  if not (public.opportunity_search_readiness()->>'ready')::boolean then raise exception 'FAIL: installed protocol not ready'; end if;
  saved:=public.save_opportunity_search_template(search_a,0,'Audio research',criteria,schedule);
  if saved.user_id<>owner_a or saved.revision<>1 then raise exception 'FAIL: wrong initial owner/revision'; end if;
  if public.save_opportunity_search_template(search_a,0,'Audio research',criteria,schedule)<>saved then raise exception 'FAIL: save retry not idempotent'; end if;
  saved:=public.save_opportunity_search_template(search_a,1,'Audio research updated',criteria,schedule);
  if saved.revision<>2 then raise exception 'FAIL: save did not increment revision'; end if;
  begin perform public.save_opportunity_search_template(search_a,1,'Stale change',criteria,schedule);
    raise exception 'FAIL: stale save accepted'; exception when serialization_failure then null; end;
  begin perform public.save_opportunity_search_template(gen_random_uuid(),0,'No criteria','{}',schedule);
    raise exception 'FAIL: empty criteria accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_opportunity_search_template(gen_random_uuid(),0,'Wrong timezone',criteria,jsonb_set(schedule,'{timezone}','"Atlantis/Ocean"'));
    raise exception 'FAIL: invalid timezone accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_opportunity_search_template(gen_random_uuid(),0,'Missing weekdays',criteria,jsonb_set(schedule,'{weekdays}','[]'));
    raise exception 'FAIL: empty weekly days accepted'; exception when invalid_parameter_value then null; end;
  begin update public.opportunity_search_templates set revision=20 where id=search_a;
    raise exception 'FAIL: direct revision bypass accepted'; exception when serialization_failure then null; end;
  begin perform private.begin_opportunity_search(search_a,run_a);
    raise exception 'FAIL: browser could begin administrative run'; exception when insufficient_privilege then null; end;
  begin perform private.claim_opportunity_search_schedule(search_a,run_a);
    raise exception 'FAIL: browser could claim schedule creation'; exception when insufficient_privilege then null; end;
  begin insert into public.opportunities(opportunity_key,title) values('forged','Browser catalogue write');
    raise exception 'FAIL: browser could write catalogue'; exception when insufficient_privilege then null; end;

  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.opportunity_search_templates where id=search_a) then raise exception 'FAIL: template owner leak'; end if;
  begin perform public.save_opportunity_search_template(search_a,2,'Cross owner',criteria,schedule);
    raise exception 'FAIL: cross owner save accepted'; exception when serialization_failure then null; end;
  perform public.save_opportunity_search_template(search_b,0,'Second owner',criteria,schedule);
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.opportunity_search_templates where id=search_a) then raise exception 'FAIL: anonymous user can read templates'; end if;
  begin perform public.opportunity_search_readiness(); raise exception 'FAIL: anonymous readiness allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);

  result:=private.begin_opportunity_search(search_a,run_a);
  if result#>>'{run,protocol_version}'<>protocol_a or result#>>'{run,template_revision}'<>'2' or result->>'query_stale'<>'true' then
    raise exception 'FAIL: bootstrap does not pin definition and protocol'; end if;
  original:=result;
  if private.begin_opportunity_search(search_a,run_a)<>original then raise exception 'FAIL: begin retry changed pinned run'; end if;
  begin perform private.begin_opportunity_search(search_b,run_a); raise exception 'FAIL: run ID reused across search'; exception when unique_violation then null; end;
  begin perform private.confirm_opportunity_search_schedule(search_a,run_a,'test-task-'||search_a::text,schedule);
    raise exception 'FAIL: task confirmed before verification run'; exception when check_violation then null; end;
  begin perform private.claim_opportunity_search_schedule(search_a,run_a);
    raise exception 'FAIL: task creation claimed before verification run'; exception when check_violation then null; end;
  result:=private.save_opportunity_search_queries(run_a,'[{"query":"funded audio PhD","sources":["official institution listings"]}]');
  if private.save_opportunity_search_queries(run_a,'[{"query":"funded audio PhD","sources":["official institution listings"]}]')<>result then
    raise exception 'FAIL: saved queries not idempotent'; end if;
  begin perform private.save_opportunity_search_queries(run_a,'[{"query":"changed query"}]');
    raise exception 'FAIL: immutable query revision overwritten'; exception when serialization_failure then null; end;

  payload:=jsonb_build_object('opportunity_key','search-test-'||item_a::text,'title','Audio researcher ''quoted''; DROP TABLE nothing;',
    'institution','Synthetic Institute','vacancy_id','PhD-101','official_url','https://example.invalid/jobs/audio-101?utm_source=chat',
    'research_summary','Build audio research prototypes. Evaluate systems with real hardware.',
    'availability','open','topics',jsonb_build_array('Audio','ML'),'last_checked_at',clock_timestamp(),
    'personal_fit',jsonb_build_object('score',8.2,'scale_min',0,'scale_max',10,'summary','Strong methods fit; eligibility still to verify.'),
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/jobs/audio-101','kind','official',
      'checked_at',clock_timestamp(),'supports',jsonb_build_array('title','research_summary','availability','topics','institution','vacancy_id'))));
  receipt:=private.submit_opportunity_search_result(run_a,item_a,payload); opportunity:=(receipt->>'opportunity_id')::uuid;
  if receipt->>'outcome'<>'new' or receipt->>'verified'<>'false' then raise exception 'FAIL: new receipt state'; end if;
  if private.submit_opportunity_search_result(run_a,item_a,payload)<>receipt then raise exception 'FAIL: save retry not identical'; end if;
  begin perform private.submit_opportunity_search_result(run_a,item_a,payload||'{"title":"Other"}');
    raise exception 'FAIL: same item overwrote different evidence'; exception when unique_violation then null; end;
  begin perform private.complete_opportunity_search(run_a,'{}'); raise exception 'FAIL: unverified run marked complete'; exception when check_violation then null; end;
  receipt:=private.verify_opportunity_search_result(run_a,item_a);
  if receipt->>'verified'<>'true' or receipt->>'changed_since_save'<>'false' then raise exception 'FAIL: separate verification failed'; end if;

  -- A different scheduled search finds the same URL with another key and noisy URL.
  perform private.begin_opportunity_search(search_b,run_b);
  perform private.save_opportunity_search_queries(run_b,'[{"query":"industrial audio PhD"}]');
  changed:=payload||jsonb_build_object('opportunity_key','other-search-'||item_b::text,'official_url','http://EXAMPLE.invalid/jobs/audio-101/#section',
    'research_summary','Short weak description','topics','[]'::jsonb,
    'sources',jsonb_build_array(jsonb_build_object('url','https://aggregator.invalid/posting/101','kind','discovery','checked_at',clock_timestamp(),
      'supports',jsonb_build_array('research_summary'))));
  receipt:=private.submit_opportunity_search_result(run_b,item_b,changed);
  if (receipt->>'opportunity_id')::uuid<>opportunity or receipt->>'outcome'<>'updated' then raise exception 'FAIL: cross-search deduplication failed'; end if;
  if receipt#>>'{snapshot,research_summary}'<>payload->>'research_summary' or receipt#>'{snapshot,topics}'<>payload->'topics'
    or receipt#>'{snapshot,personal_fit}'<>payload->'personal_fit' then raise exception 'FAIL: weak or empty evidence replaced richer facts'; end if;
  if not (receipt->'conflicts')?'research_summary' then raise exception 'FAIL: conflict omitted'; end if;
  perform private.verify_opportunity_search_result(run_b,item_b);
  if (select count(*) from public.opportunities)<>baseline_count+1 then raise exception 'FAIL: duplicate inserted'; end if;

  -- Separate active searches pin their definition. Newly published protocols only move
  -- an active run through the single explicit refresh; existing receipts remain valid.
  update private.opportunity_search_settings set active_protocol_version=protocol_b where singleton;
  result:=private.begin_opportunity_search(search_a,run_a);
  if result#>>'{run,protocol_version}'<>protocol_a then raise exception 'FAIL: in-flight protocol changed implicitly'; end if;
  result:=private.refresh_opportunity_search_protocol(run_a);
  if result#>>'{run,protocol_version}'<>protocol_b or result#>>'{run,recovery_count}'<>'1' or result->>'query_stale'<>'true' then
    raise exception 'FAIL: refresh did not pin new protocol/query revision'; end if;
  begin perform private.refresh_opportunity_search_protocol(run_a); raise exception 'FAIL: second refresh allowed'; exception when invalid_parameter_value then null; end;
  perform private.save_opportunity_search_queries(run_a,'[{"query":"updated protocol audio PhD"}]');
  result:=private.complete_opportunity_search(run_a,'{"notes":"Verified one opportunity."}');
  if result#>>'{summary,new}'<>'1' or result#>>'{summary,verified}'<>'1' or result->>'status'<>'complete' then
    raise exception 'FAIL: server completion counts'; end if;
  if private.complete_opportunity_search(run_a,'{"notes":"Verified one opportunity."}')<>result then raise exception 'FAIL: completion retry changed receipt'; end if;
  if private.read_opportunity_search_run(run_a)->'run'<>result then raise exception 'FAIL: completion receipt cannot be read separately'; end if;
  original:=private.claim_opportunity_search_schedule(search_a,run_a);
  if original->>'claimed'<>'true' or original->>'claim_run_id'<>run_a::text then raise exception 'FAIL: completed run did not acquire creation claim'; end if;
  if private.claim_opportunity_search_schedule(search_a,run_a)<>original then raise exception 'FAIL: creation claim retry changed identity'; end if;
  perform private.confirm_opportunity_search_schedule(search_a,run_a,'test-task-'||search_a::text,schedule);
  if exists(select 1 from private.opportunity_search_schedule_claims where search_id=search_a) then raise exception 'FAIL: confirmed binding left a pending creation claim'; end if;
  result:=private.claim_opportunity_search_schedule(search_a,run_a);
  if result->>'claimed'<>'false' or result#>>'{schedule_binding,task_id}'<>'test-task-'||search_a::text then
    raise exception 'FAIL: an already bound search could create another task'; end if;
  begin perform private.confirm_opportunity_search_schedule(search_a,run_a,'different-task',schedule);
    raise exception 'FAIL: duplicate schedule identity accepted'; exception when unique_violation then null; end;

  -- Successful zero-result verification still persists a separately readable receipt.
  result:=private.begin_opportunity_search(search_a,run_c);
  if result->>'query_stale'<>'false' then raise exception 'FAIL: saved compatible queries not reused'; end if;
  result:=private.complete_opportunity_search(run_c,'{"notes":"No current strong matches."}');
  if result#>>'{summary,new}'<>'0' or result#>>'{summary,verified}'<>'0' then raise exception 'FAIL: zero-result receipt missing'; end if;
  if private.read_opportunity_search_run(run_c)#>>'{run,status}'<>'complete' then raise exception 'FAIL: zero-result verification missing'; end if;

  -- An incompatible active release consumes the recovery attempt without switching
  -- the pinned protocol or permitting a retry loop.
  perform private.begin_opportunity_search(search_a,run_d);
  insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
    values(protocol_b||'-incompatible',2,'test-incompatible','Future transport','{}');
  update private.opportunity_search_settings set active_protocol_version=protocol_b||'-incompatible' where singleton;
  result:=private.refresh_opportunity_search_protocol(run_d);
  if result->>'compatible'<>'false' or (select recovery_count from public.opportunity_search_runs where id=run_d)<>1 then
    raise exception 'FAIL: incompatible recovery did not consume its attempt'; end if;
  begin perform private.refresh_opportunity_search_protocol(run_d); raise exception 'FAIL: incompatible recovery repeated'; exception when invalid_parameter_value then null; end;
  result:=private.complete_opportunity_search(run_d,'{"status":"failed","notes":"Installed release requires a new bootstrap."}');
  if result->>'status'<>'failed' then raise exception 'FAIL: actionable failure not recorded'; end if;
  update private.opportunity_search_settings set active_protocol_version=protocol_b where singleton;

  -- Ambiguity is surfaced rather than destructively choosing a record.
  insert into public.opportunities(id,opportunity_key,title,official_url) values(second_opportunity,'second-test-'||second_opportunity::text,'Ambiguous existing row','https://example.invalid/jobs/second');
  changed:=payload||jsonb_build_object('official_url','https://example.invalid/jobs/second');
  begin perform private.submit_opportunity_search_result(run_b,gen_random_uuid(),changed);
    raise exception 'FAIL: ambiguous key and URL merged'; exception when unique_violation then null; end;
  begin perform private.submit_opportunity_search_result(run_b,gen_random_uuid(),jsonb_set(payload,'{personal_fit,score}','11'));
    raise exception 'FAIL: score above ten accepted'; exception when invalid_parameter_value then null; end;
  begin perform private.submit_opportunity_search_result(run_b,gen_random_uuid(),payload||'{"cv_track":"forbidden"}');
    raise exception 'FAIL: legacy protocol field accepted'; exception when invalid_parameter_value then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.opportunity_search_runs where id=run_b) or exists(select 1 from public.opportunity_search_receipts where run_id=run_b) then
    raise exception 'FAIL: other owner research runs leaked'; end if;
  if not exists(select 1 from public.opportunity_search_schedule_bindings where search_id=search_a) then raise exception 'FAIL: owner cannot read schedule'; end if;
  begin update public.opportunity_search_runs set status='complete' where id=run_a;
    raise exception 'FAIL: owner could forge run status'; exception when insufficient_privilege then null; end;
  begin update public.opportunity_search_schedule_bindings set task_id='forged' where search_id=search_a;
    raise exception 'FAIL: owner could forge schedule confirmation'; exception when insufficient_privilege then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);

  if private.opportunity_search_normalize_url('https://EXAMPLE.invalid/jobs/101/?b=2&utm_source=x&a=1#top')
    <>private.opportunity_search_normalize_url('http://example.invalid/jobs/101?a=1&b=2') then raise exception 'FAIL: URL normalization mismatch'; end if;
  if private.opportunity_search_normalize_url('https://example.invalid/jobs') is not null then raise exception 'FAIL: generic listing used as vacancy ID'; end if;
  if has_function_privilege('authenticated','private.submit_opportunity_search_result(uuid,uuid,jsonb)','execute')
    or has_function_privilege('service_role','private.begin_opportunity_search(uuid,uuid)','execute')
    or has_function_privilege('service_role','private.claim_opportunity_search_schedule(uuid,uuid)','execute') then raise exception 'FAIL: management RPC grants too broad'; end if;
  raise notice 'PASS: opportunity search templates, ownership, protocols, queries, merges, receipts and schedule lifecycle';
end;
$$;
do $$
declare owner_id uuid:=gen_random_uuid(); search_id uuid:=gen_random_uuid(); old_run uuid:=gen_random_uuid(); new_run uuid:=gen_random_uuid(); losing_run uuid:=gen_random_uuid();
  claim_search uuid:=gen_random_uuid(); claim_run_a uuid:=gen_random_uuid(); claim_run_b uuid:=gen_random_uuid();
  release_a text:='merge-test-'||gen_random_uuid()::text; release_b text:=release_a||'-next'; payload jsonb; incoming jsonb; result jsonb;
  saved_id uuid; item_id uuid:=gen_random_uuid();
  schedule jsonb:='{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_id,owner_id,'Merge regression','{"topicsAndMethods":"Audio research"}',schedule);
  insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
    values(release_a,1,'merge-a','Merge fixture','{}'),(release_b,1,'merge-b','New merge fixture','{}');
  update private.opportunity_search_settings set active_protocol_version=release_a where singleton;
  perform private.begin_opportunity_search(search_id,old_run);
  perform private.begin_opportunity_search(search_id,losing_run);
  perform private.save_opportunity_search_queries(old_run,'[{"query":"funded audio phd"}]');
  begin
    perform private.save_opportunity_search_queries(losing_run,'[{"query":"different generated query"}]');
    raise exception 'FAIL: concurrent generation changed an immutable query revision';
  exception when serialization_failure then null; end;
  result:=private.begin_opportunity_search(search_id,losing_run);
  if result#>'{run,queries}' is distinct from '[{"query":"funded audio phd"}]'::jsonb then
    raise exception 'FAIL: bootstrap retry did not attach the winning query revision';
  end if;
  payload:=jsonb_build_object('opportunity_key','merge-fixture-'||search_id::text,'title','Funded audio research',
    'institution','Merge Institute','vacancy_id','A-100','official_url','https://merge.invalid/vacancy/100',
    'research_summary','Original description','last_checked_at',clock_timestamp(),
    'data','{"methods":{"hardware":["microphones","embedded DSP"],"evaluation":"field study"},"teaching_load":"10%"}'::jsonb,
    'sources',jsonb_build_array(jsonb_build_object('url','https://merge.invalid/vacancy/100','kind','official',
      'checked_at','2026-01-01T00:00:00Z','supports',jsonb_build_array('data','research_summary'))));
  result:=private.submit_opportunity_search_result(old_run,item_id,payload);
  saved_id:=(result->>'opportunity_id')::uuid;
  perform private.verify_opportunity_search_result(old_run,item_id);
  incoming:=payload||jsonb_build_object('last_checked_at',clock_timestamp(),
    'official_url','http://MERGE.invalid/vacancy/100/?utm_source=another-search#details',
    'sources',jsonb_build_array(jsonb_build_object('url','https://merge.invalid/vacancy/100','kind','official',
      'checked_at','2026-01-01T12:00:00Z','supports',jsonb_build_array('data','research_summary'))));
  result:=private.submit_opportunity_search_result(old_run,gen_random_uuid(),incoming);
  if result->>'outcome'<>'unchanged' or result->'conflicts'<>'[]'::jsonb then
    raise exception 'FAIL: check times, source observations or equivalent URLs became a material update';
  end if;
  -- A later unrelated check must not freeze field-specific evidence. Partial JSON
  -- refreshes preserve absent leaves, array members, and nonempty prior values.
  incoming:=payload||jsonb_build_object('research_summary','Current description',
    'data','{"methods":{"hardware":["microphones"],"evaluation":"updated field study"},"teaching_load":null}'::jsonb,
    'sources',jsonb_build_array(jsonb_build_object('url','https://merge.invalid/vacancy/100','kind','official',
      'checked_at','2026-01-03T00:00:00Z','supports',jsonb_build_array('data','research_summary'))));
  result:=private.submit_opportunity_search_result(old_run,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Current description'
    or result#>>'{snapshot,data,methods,evaluation}'<>'updated field study'
    or result#>>'{snapshot,data,teaching_load}'<>'10%'
    or not (result#>'{snapshot,data,methods,hardware}')?'embedded DSP' then
    raise exception 'FAIL: partial structured evidence lost rich fields or unrelated checks blocked a newer fact';
  end if;
  -- A source newer than an old observation but older than the latest one must not
  -- roll back the field merely because sources are append-only.
  incoming:=payload||jsonb_build_object('research_summary','Stale description',
    'sources',jsonb_build_array(jsonb_build_object('url','https://merge.invalid/vacancy/100','kind','official',
      'checked_at','2026-01-02T00:00:00Z','supports',jsonb_build_array('research_summary'))));
  result:=private.submit_opportunity_search_result(old_run,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Current description' then raise exception 'FAIL: stale observation replaced newer evidence'; end if;
  -- Imported source metadata can be incomplete without making all later writes fail.
  update public.opportunities set sources=sources||'[{"url":"https://merge.invalid/old","kind":"secondary","checked_at":"unknown","supports":["research_summary"]}]'::jsonb where id=saved_id;
  incoming:=payload||jsonb_build_object('research_summary','Newest description',
    'sources',jsonb_build_array(jsonb_build_object('url','https://merge.invalid/vacancy/100','kind','official',
      'checked_at','2026-01-04T00:00:00Z','supports',jsonb_build_array('research_summary'))));
  result:=private.submit_opportunity_search_result(old_run,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Newest description' then raise exception 'FAIL: incomplete imported sources blocked valid refresh'; end if;
  begin
    perform private.submit_opportunity_search_result(old_run,gen_random_uuid(),payload||'{"vacancy_id":"A-101"}');
    raise exception 'FAIL: shared URL silently merged distinct vacancy IDs';
  exception when unique_violation then null; end;

  -- Timing can remain identical while a protocol release changes. An old run must
  -- not roll the confirmed task instructions back to its superseded protocol.
  perform private.verify_opportunity_search_result(old_run,r.item_id) from public.opportunity_search_receipts r where r.run_id=old_run;
  perform private.complete_opportunity_search(old_run,'{"notes":"Completed evidence checks."}');
  update private.opportunity_search_settings set active_protocol_version=release_b where singleton;
  perform private.begin_opportunity_search(search_id,new_run);
  begin
    perform private.confirm_opportunity_search_schedule(search_id,new_run,'merge-task-'||search_id::text,schedule);
    raise exception 'FAIL: uncompleted setup-only run confirmed a schedule';
  exception when check_violation then null; end;
  perform private.save_opportunity_search_queries(new_run,'[{"query":"funded audio phd"}]');
  perform private.complete_opportunity_search(new_run,'{"notes":"Setup only; no research performed."}');
  perform private.confirm_opportunity_search_schedule(search_id,new_run,'merge-task-'||search_id::text,schedule);
  begin
    perform private.confirm_opportunity_search_schedule(search_id,old_run,'merge-task-'||search_id::text,schedule);
    raise exception 'FAIL: older protocol replaced newer confirmed schedule instructions';
  exception when serialization_failure then null; end;
  -- Two completed setup runs can race between task discovery and external task
  -- creation. Only one run receives permission to create. The other may reconcile
  -- and confirm a task actually found under the stable marker, but cannot create.
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(claim_search,owner_id,'Concurrent setup','{"topicsAndMethods":"Audio research"}',schedule);
  perform private.begin_opportunity_search(claim_search,claim_run_a);
  perform private.save_opportunity_search_queries(claim_run_a,'[{"query":"funded audio phd"}]');
  perform private.complete_opportunity_search(claim_run_a,'{"notes":"Setup only; no research performed."}');
  perform private.begin_opportunity_search(claim_search,claim_run_b);
  perform private.complete_opportunity_search(claim_run_b,'{"notes":"Setup only; no research performed."}');
  result:=private.claim_opportunity_search_schedule(claim_search,claim_run_a);
  if result->>'claimed'<>'true' then raise exception 'FAIL: first setup did not receive a creation claim'; end if;
  result:=private.claim_opportunity_search_schedule(claim_search,claim_run_b);
  if result->>'claimed'<>'false' or result->>'claim_run_id'<>claim_run_a::text or result->'schedule_binding'<>'null'::jsonb then
    raise exception 'FAIL: concurrent setup received a second creation claim'; end if;
  -- Claims have no TTL: uncertain external outcomes require reconciliation.
  update private.opportunity_search_schedule_claims c set claimed_at=clock_timestamp()-interval '30 days' where c.search_id=claim_search;
  result:=private.claim_opportunity_search_schedule(claim_search,claim_run_b);
  if result->>'claimed'<>'false' or result->>'claim_run_id'<>claim_run_a::text then raise exception 'FAIL: abandoned claim expired into duplicate creation permission'; end if;
  perform private.confirm_opportunity_search_schedule(claim_search,claim_run_b,'reconciled-task-'||claim_search::text,schedule);
  if exists(select 1 from private.opportunity_search_schedule_claims c where c.search_id=claim_search) then raise exception 'FAIL: reconciled task did not clear pending claim'; end if;
  result:=private.claim_opportunity_search_schedule(claim_search,claim_run_a);
  if result->>'claimed'<>'false' or result#>>'{schedule_binding,task_id}'<>'reconciled-task-'||claim_search::text then
    raise exception 'FAIL: confirmed reconciliation allowed another task'; end if;
  raise notice 'PASS: structured evidence retention, field-specific recency, historical sources and stale schedule protection';
end;
$$;
rollback;
