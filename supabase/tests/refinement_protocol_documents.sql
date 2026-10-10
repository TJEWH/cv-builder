-- Synthetic fixtures only; all data is rolled back. Run as postgres after the protocol migration.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
  opportunity_id uuid:=gen_random_uuid(); app_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  protocol_id text:='v1:'||repeat('a',64); saved jsonb; request jsonb; revision integer;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z"},"language":"en","maxWords":400}';
  before_app jsonb; before_request jsonb;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
          (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values(opportunity_id,'protocol-test-'||opportunity_id::text,'Protocol fixture');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_id,opportunity_id);
  perform public.assign_job_application_cv(app_id,gen_random_uuid(),'Protocol CV',
    '{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Robotics research."}}','{}',7,'{}');
  perform public.save_refinement_state(app_id,setup,'{"cv":null,"letter":null}',0);
  request:=jsonb_build_object('schemaVersion',2,'requestId',request_id,'applicationId',app_id,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',request_id,
      'fields',jsonb_build_array(jsonb_build_object('id','field-1','label','Profile','text','Robotics research.')),
      'opportunity','{}'::jsonb,'instructions','Preserve evidence.'),
    'letter',setup||'{"text":""}','scope','cv','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[{"fieldId":"field-1","reason":"Keep source evidence unchanged."}]}'::jsonb);
  perform public.publish_refinement_request(request);
  select to_jsonb(a) into before_app from public.applications a where id=app_id;
  select to_jsonb(r) into before_request from public.application_refinement_requests r where id=request_id;
  saved:=public.publish_refinement_protocol(request_id,protocol_id,'Synthetic complete protocol.');
  if saved->>'application_id'<>app_id::text or saved->>'user_id'<>owner_a::text
    or saved->>'protocol_text'<>'Synthetic complete protocol.' then raise exception 'FAIL: receipt'; end if;
  if public.publish_refinement_protocol(request_id,protocol_id,'Synthetic complete protocol.')<>saved then raise exception 'FAIL: retry'; end if;
  begin perform public.publish_refinement_protocol(request_id,protocol_id,'Changed protocol'); raise exception 'FAIL: mutated protocol'; exception when invalid_parameter_value then null; end;
  begin perform public.publish_refinement_protocol(request_id,'invalid','Protocol'); raise exception 'FAIL: invalid id'; exception when invalid_parameter_value then null; end;
  begin perform public.publish_refinement_protocol(request_id,protocol_id,repeat('x',100001)); raise exception 'FAIL: size limit'; exception when invalid_parameter_value then null; end;
  begin perform private.read_refinement_protocol(request_id,protocol_id); raise exception 'FAIL: browser management access'; exception when insufficient_privilege then null; end;
  begin update public.application_refinement_protocols set protocol_text='Changed'; raise exception 'FAIL: browser update'; exception when insufficient_privilege then null; end;
  begin delete from public.application_refinement_protocols; raise exception 'FAIL: browser delete'; exception when insufficient_privilege then null; end;
  if (select to_jsonb(a) from public.applications a where id=app_id)<>before_app
    or (select to_jsonb(r) from public.application_refinement_requests r where id=request_id)<>before_request then raise exception 'FAIL: source changed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  if exists(select 1 from public.application_refinement_protocols) then raise exception 'FAIL: cross-owner read'; end if;
  begin perform public.publish_refinement_protocol(request_id,protocol_id,'Other owner'); raise exception 'FAIL: cross-owner publish'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  if exists(select 1 from public.application_refinement_protocols) then raise exception 'FAIL: anonymous read'; end if;
  begin perform public.publish_refinement_protocol(request_id,protocol_id,'Anonymous'); raise exception 'FAIL: anonymous publish'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if private.read_refinement_protocol(request_id,protocol_id)<>saved then raise exception 'FAIL: management receipt'; end if;
  begin perform private.read_refinement_protocol(request_id,'v1:'||repeat('b',64)); raise exception 'FAIL: missing protocol'; exception when no_data_found then null; end;
  begin update public.application_refinement_protocols p set protocol_text='Privileged mutation' where p.request_id=(saved->>'request_id')::uuid; raise exception 'FAIL: privileged update'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  select s.revision into revision from public.application_refinement_state s where application_id=app_id;
  perform public.clear_refinement_history(app_id,revision);
  if exists(select 1 from public.application_refinement_protocols) then raise exception 'FAIL: history cascade'; end if;
  if not exists(select 1 from public.applications where id=app_id) then raise exception 'FAIL: application deleted'; end if;
  begin perform public.publish_refinement_protocol(request_id,protocol_id,'Deleted request'); raise exception 'FAIL: cleared request'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
rollback;
