-- Run the complete file as postgres. Only random synthetic fixtures are used; all roll back.
begin;
set constraints all immediate;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app_a uuid := gen_random_uuid(); app_b uuid := gen_random_uuid();
  request_a uuid := gen_random_uuid(); request_b uuid := gen_random_uuid(); response_a uuid := gen_random_uuid();
  free_request uuid := gen_random_uuid(); candidate_id uuid; request_value jsonb; response_value jsonb;
  result jsonb; original jsonb; invalid jsonb; original_opportunity jsonb; bad_text text;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text || '@example.invalid','{}','{}'),
          (owner_b,'authenticated','authenticated',owner_b::text || '@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values(opportunity,'cv-adjustment-test-' || opportunity::text,'Robotics fixture');
  select to_jsonb(o) into original_opportunity from public.opportunities o where id=opportunity;
  request_value := jsonb_build_object('schemaVersion',1,'requestId',request_a,'fields',jsonb_build_array(
    jsonb_build_object('id','field-1','label','Profile','text','Research with {{PRIVATE_1}} and {{PRIVATE_2}}.'),
    jsonb_build_object('id','field-2','label','Evidence','text','See [paper](https://example.org/paper).'),
    jsonb_build_object('id','field-3','label','Headline','text','Research engineer')),
    'opportunity',jsonb_build_object('title','Robotics fixture'),'instructions','Focus on evidence.');
  response_value := jsonb_build_object('schemaVersion',1,'requestId',request_a,'edits',jsonb_build_array(
    jsonb_build_object('fieldId','field-1','text','Robotics research with {{PRIVATE_1}} and {{PRIVATE_2}}.'),
    jsonb_build_object('fieldId','field-2','text','Research evidence: [paper](https://example.org/paper).')));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a,opportunity);
  result := public.publish_cv_adjustment_request(request_a,app_a,request_value); original := result;
  if result->'request_json' <> request_value or result->>'user_id' <> owner_a::text or result->>'application_id' <> app_a::text then raise exception 'FAIL: request changed or owner mismatch'; end if;
  if public.read_cv_adjustment_request(request_a) <> original or public.publish_cv_adjustment_request(request_a,app_a,request_value) <> original then raise exception 'FAIL: read/retry changed request'; end if;
  begin
    perform public.publish_cv_adjustment_request(request_a,app_a,jsonb_set(request_value,'{instructions}','"Different"'));
    raise exception 'FAIL: request overwrite';
  exception when unique_violation then null; end;
  result := public.save_cv_adjustment_response(response_a,request_a,response_value);
  if result->'response_json' <> response_value or public.save_cv_adjustment_response(response_a,request_a,response_value) <> result then raise exception 'FAIL: response retry changed data'; end if;
  begin
    perform public.save_cv_adjustment_response(response_a,request_a,jsonb_set(response_value,'{edits}','[]'));
    raise exception 'FAIL: response overwrite';
  exception when unique_violation then null; end;
  perform public.save_cv_adjustment_response(gen_random_uuid(),request_a,jsonb_set(response_value,'{edits}','[]'));
  if (select count(*) from public.cv_adjustment_responses where request_id=request_a) <> 2 then raise exception 'FAIL: no-op response or append history'; end if;

  -- Malformed shape, unknown fields, local reconstruction data, duplicate IDs and size limits.
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb, '[]'::jsonb, request_value - 'instructions', request_value || '{"baselineState":{}}',
    jsonb_set(request_value,'{schemaVersion}','"1"'), jsonb_set(request_value,'{opportunity}','[]'),
    jsonb_set(request_value,'{instructions}',to_jsonb(repeat('x',20001))),
    jsonb_set(request_value,'{fields,0,label}',to_jsonb(repeat('x',201))),
    jsonb_set(request_value,'{fields,0,text}',to_jsonb(repeat('x',20001))),
    jsonb_set(request_value,'{fields,0,text}',to_jsonb('bad' || chr(1))),
    jsonb_set(request_value,'{fields,0}',(request_value#>'{fields,0}') || '{"path":["about","text"]}'),
    jsonb_set(request_value,'{fields}',jsonb_build_array(request_value#>'{fields,0}',request_value#>'{fields,0}')),
    jsonb_set(request_value,'{fields}',(select jsonb_agg(jsonb_build_object('id','field-' || n,'label','','text','')) from generate_series(1,1001) n)),
    jsonb_set(request_value,'{opportunity}',jsonb_build_object('oversize',repeat('x',1048577)))
  )) loop
    candidate_id := gen_random_uuid();
    if jsonb_typeof(invalid)='object' then invalid := jsonb_set(invalid,'{requestId}',to_jsonb(candidate_id)); end if;
    begin
      perform public.publish_cv_adjustment_request(candidate_id,app_a,invalid);
      raise exception 'FAIL: invalid request accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.publish_cv_adjustment_request(gen_random_uuid(),app_a,request_value);
    raise exception 'FAIL: mismatched request ID';
  exception when invalid_parameter_value then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'[]'::jsonb,response_value - 'edits', response_value || '{"state":{}}',
    jsonb_set(response_value,'{requestId}',to_jsonb(gen_random_uuid())),
    jsonb_set(response_value,'{edits}','[{"fieldId":"field-999","text":"Unknown"}]'),
    jsonb_set(response_value,'{edits}','[{"fieldId":"field-3","text":"A"},{"fieldId":"field-3","text":"B"}]'),
    jsonb_set(response_value,'{edits}','[{"fieldId":"field-3","text":"A","path":["contact","name"]}]'),
    jsonb_set(response_value,'{edits}',jsonb_build_array(jsonb_build_object('fieldId','field-3','text',repeat('x',20001))))
  )) loop
    begin
      perform public.save_cv_adjustment_response(gen_random_uuid(),request_a,invalid);
      raise exception 'FAIL: invalid response accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  foreach bad_text in array array[
    'Removed {{PRIVATE_1}}.', 'Reordered {{PRIVATE_2}} {{PRIVATE_1}}.', 'Duplicated {{PRIVATE_1}} {{PRIVATE_1}} {{PRIVATE_2}}.',
    'New {{PRIVATE_1}} {{PRIVATE_2}} {{PRIVATE_3}}.', 'Moved {{PRIVATE_1}} {{PRIVATE_2}} {{APPLICANT_NAME}}.',
    '{{PRIVATE_1}} {{PRIVATE_2}} !!private!!', '{{PRIVATE_1}} {{PRIVATE_2}} <b>HTML</b>',
    '{{PRIVATE_1}} {{PRIVATE_2}} ![image](https://example.org/image)', '{{PRIVATE_1}} {{PRIVATE_2}} https://new.example.org',
    '{{PRIVATE_1}} [private]({{PRIVATE_2}})'
  ] loop
    begin
      perform public.save_cv_adjustment_response(gen_random_uuid(),request_a,jsonb_set(response_value,'{edits}',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',bad_text))));
      raise exception 'FAIL: private token/link/HTML mutation accepted: %',bad_text;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    insert into public.cv_adjustment_responses(user_id,request_id,response_json)
      values(owner_a,request_a,jsonb_set(response_value,'{edits}','[{"fieldId":"field-3","text":"Cross-field {{PRIVATE_1}}"}]'));
    raise exception 'FAIL: direct insert bypassed token checks';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_cv_adjustment_response(gen_random_uuid(),request_a,jsonb_set(response_value,'{edits}','[{"fieldId":"field-2","text":"Removed paper link"}]'));
    raise exception 'FAIL: removed existing link';
  exception when invalid_parameter_value then null; end;
  begin
    update public.cv_adjustment_requests set application_id=null where id=request_a;
    raise exception 'FAIL: authenticated request update';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.cv_adjustment_responses where id=response_a;
    raise exception 'FAIL: authenticated response delete';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  begin
    update public.cv_adjustment_requests set application_id=null where id=request_a;
    raise exception 'FAIL: privileged request update';
  exception when check_violation then null; end;
  begin
    update public.cv_adjustment_responses set response_json='{}' where id=response_a;
    raise exception 'FAIL: privileged response update';
  exception when check_violation then null; end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  perform public.create_job_application(app_b,opportunity);
  if exists(select 1 from public.cv_adjustment_requests where id=request_a) or exists(select 1 from public.cv_adjustment_responses where id=response_a) then raise exception 'FAIL: cross-owner visibility'; end if;
  begin perform public.read_cv_adjustment_request(request_a); raise exception 'FAIL: cross-owner read RPC'; exception when insufficient_privilege then null; end;
  begin perform public.save_cv_adjustment_response(gen_random_uuid(),request_a,response_value); raise exception 'FAIL: cross-owner response'; exception when insufficient_privilege then null; end;
  begin
    perform public.publish_cv_adjustment_request(request_b,app_a,jsonb_set(request_value,'{requestId}',to_jsonb(request_b)));
    raise exception 'FAIL: cross-owner application';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.cv_adjustment_requests(id,user_id,application_id,request_json)
      values(request_b,owner_a,app_a,jsonb_set(request_value,'{requestId}',to_jsonb(request_b)));
    raise exception 'FAIL: owner spoof';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  if exists(select 1 from public.cv_adjustment_requests where id=request_a) then raise exception 'FAIL: anonymous account reads'; end if;
  begin perform public.read_cv_adjustment_request(request_a); raise exception 'FAIL: anonymous account RPC'; exception when insufficient_privilege then null; end;
  execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
  begin perform public.read_cv_adjustment_request(request_a); raise exception 'FAIL: signed-out RPC'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.cv_adjustment_requests; raise exception 'FAIL: signed-out table'; exception when insufficient_privilege then null; end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  insert into public.cv_adjustment_requests(id,user_id,application_id,request_json,created_at)
    values(free_request,owner_a,null,jsonb_set(request_value,'{requestId}',to_jsonb(free_request)),'2001-01-01');
  result := public.read_cv_adjustment_request(free_request);
  if result->'application_id' <> 'null'::jsonb or (result->>'created_at')::timestamptz='2001-01-01'::timestamptz then raise exception 'FAIL: independent request or server timestamp'; end if;
  perform public.save_cv_adjustment_response(gen_random_uuid(),free_request,jsonb_set(response_value,'{requestId}',to_jsonb(free_request)));
  perform public.remove_job_application(app_a);
  if exists(select 1 from public.cv_adjustment_requests where id=request_a) or exists(select 1 from public.cv_adjustment_responses where request_id=request_a) then raise exception 'FAIL: application cascade'; end if;
  if not exists(select 1 from public.cv_adjustment_requests where id=free_request) then raise exception 'FAIL: application cascade deleted independent request'; end if;
  execute 'reset role';
  delete from auth.users where id=owner_a;
  if exists(select 1 from public.cv_adjustment_requests where user_id=owner_a) or exists(select 1 from public.cv_adjustment_responses where user_id=owner_a) then raise exception 'FAIL: account cascade'; end if;
  if (select to_jsonb(o) from public.opportunities o where id=opportunity) <> original_opportunity then raise exception 'FAIL: shared opportunity changed'; end if;
end;
$$;
rollback;
select 'PASS: CV adjustment privacy fields, token/link integrity, bounded input, owner RLS, idempotency, immutability, direct-write validation, anonymous denial and application/account cascades. All synthetic fixtures rolled back.' as result;
