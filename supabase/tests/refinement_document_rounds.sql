-- Independent active rounds, scoped contracts and ownership. All fixtures roll back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); app uuid:=gen_random_uuid(); opp uuid:=gen_random_uuid();
  cv_id uuid:=gen_random_uuid(); letter_id uuid:=gen_random_uuid(); next_cv uuid:=gen_random_uuid();
  cv_proposal uuid:=gen_random_uuid(); letter_proposal uuid:=gen_random_uuid();
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Evidence and fit","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z"},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Research evidence."}}';
  request jsonb; cv_request jsonb; proposal jsonb; result jsonb; feedback jsonb; rev integer;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunities(id,opportunity_key,title) values(opp,'document-rounds-'||opp,'Document rounds');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app,opp);
  perform public.assign_job_application_cv(app,gen_random_uuid(),'Synthetic CV',content,'{}',7,'{}');
  perform public.save_refinement_state(app,setup,'{"cv":null,"letter":null}',0);
  request:=jsonb_build_object('schemaVersion',2,'requestId',cv_id,'applicationId',app,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',cv_id,'fields','[]'::jsonb,'opportunity','{}'::jsonb,'instructions',''),
    'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[]}'::jsonb,
    'letter',setup||'{"text":"Original letter."}','scope','cv','feedback','[]'::jsonb,'parentProposalId',null);
  perform public.publish_refinement_request(request); cv_request:=request;
  request:=jsonb_set(request||jsonb_build_object('requestId',letter_id,'scope','letter'),'{cv,requestId}',to_jsonb(letter_id));
  perform public.publish_refinement_request(request);
  if (select current_cv_request_id<>cv_id or current_letter_request_id<>letter_id or current_request_id is not null from public.application_refinement_state where application_id=app) then raise exception 'FAIL: publication superseded the other document'; end if;
  if public.resolve_application_reference(app::text,'cv')->>'current_request_id'<>cv_id::text
    or public.resolve_application_reference(app::text,'letter')->>'current_request_id'<>letter_id::text then raise exception 'FAIL: scoped owner resolution'; end if;
  begin perform public.resolve_application_reference(app::text); raise exception 'FAIL: ambiguous resolution'; exception when invalid_parameter_value then null; end;
  begin perform public.publish_refinement_request(request||'{"scope":"both"}'); raise exception 'FAIL: combined request'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app,null,'feedback','{"scope":"both","text":"Shared"}',gen_random_uuid()); raise exception 'FAIL: combined feedback'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app,cv_id,'feedback','{"scope":"letter","text":"Wrong source"}',gen_random_uuid()); raise exception 'FAIL: feedback crossed scope'; exception when invalid_parameter_value then null; end;
  perform public.publish_refinement_protocol(cv_id,'v1:'||repeat('a',64),'CV protocol remains publishable while the letter request is current.');
  perform public.publish_refinement_protocol(letter_id,'v1:'||repeat('b',64),'Letter protocol remains independently publishable.');
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  if private.resolve_application_reference(app::text,'cv')->>'current_request_id'<>cv_id::text then raise exception 'FAIL: management resolution'; end if;
  -- Verified acquisition returns the entire original row, including all captured context.
  if private.read_current_refinement_request(app,cv_id,'cv') is distinct from private.read_refinement_request(cv_id)
    or private.read_current_refinement_request(app,letter_id,'letter') is distinct from private.read_refinement_request(letter_id) then
    raise exception 'FAIL: verified read changed published context';
  end if;
  begin perform private.read_current_refinement_request(gen_random_uuid(),cv_id,'cv'); raise exception 'FAIL: wrong application'; exception when serialization_failure then null; end;
  begin perform private.read_current_refinement_request(app,gen_random_uuid(),'cv'); raise exception 'FAIL: missing request'; exception when serialization_failure then null; end;
  begin perform private.read_current_refinement_request(app,cv_id,'letter'); raise exception 'FAIL: wrong scope'; exception when serialization_failure then null; end;
  begin perform private.read_current_refinement_request(app,cv_id,'both'); raise exception 'FAIL: combined read'; exception when invalid_parameter_value then null; end;
  begin perform private.read_current_refinement_request(app,cv_id,null); raise exception 'FAIL: missing scope'; exception when invalid_parameter_value then null; end;
  begin perform private.read_current_refinement_request(null,cv_id,'cv'); raise exception 'FAIL: missing application'; exception when invalid_parameter_value then null; end;
  if has_function_privilege('anon','private.read_current_refinement_request(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','private.read_current_refinement_request(uuid,uuid,text)','execute')
    or has_function_privilege('service_role','private.read_current_refinement_request(uuid,uuid,text)','execute') then
    raise exception 'FAIL: verified read widened role access';
  end if;
  execute 'set local role authenticated';
  begin perform private.read_current_refinement_request(app,cv_id,'cv'); raise exception 'FAIL: browser read management snapshot'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  proposal:=jsonb_build_object('schemaVersion',2,'requestId',letter_id,'summary','Letter draft. Evidence and fit.','cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,'letterText','Improved letter.',
    'annotations','[{"id":"annotation-1","type":"question","document":"letter","location":null,"text":"What research interests matter?"}]'::jsonb);
  perform private.save_refinement_proposal(letter_id,letter_proposal,proposal);
  proposal:=proposal||jsonb_build_object('requestId',cv_id,'letterText','Original letter.','annotations','[]'::jsonb);
  perform private.save_refinement_proposal(cv_id,cv_proposal,proposal);
  begin perform private.save_refinement_proposal(cv_id,gen_random_uuid(),proposal||'{"annotations":[{"id":"annotation-1","type":"question","document":"letter","location":null,"text":"Wrong document"}]}'); raise exception 'FAIL: cross-document question'; exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.save_refinement_review(app,cv_id,'feedback','{"scope":"cv","text":"Prioritize research"}',gen_random_uuid());
  perform public.save_refinement_review(app,letter_id,'feedback','{"scope":"letter","text":"Use direct language"}',gen_random_uuid());
  select jsonb_agg(jsonb_build_object('id',r.id,'text',r.payload->'text','scope',r.payload->'scope','createdAt',r.created_at) order by r.created_at,r.id)
    into feedback from public.application_refinement_reviews r where r.application_id=app and r.kind='feedback' and r.payload->>'scope'='cv';
  cv_request:=jsonb_set(cv_request||jsonb_build_object('requestId',next_cv,'feedback',feedback),'{cv,requestId}',to_jsonb(next_cv));
  begin perform public.publish_refinement_request(cv_request||jsonb_build_object('parentProposalId',letter_proposal)); raise exception 'FAIL: cross-document lineage'; exception when invalid_parameter_value then null; end;
  perform public.publish_refinement_request(cv_request||jsonb_build_object('parentProposalId',cv_proposal));
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  begin perform private.read_current_refinement_request(app,cv_id,'cv'); raise exception 'FAIL: superseded read'; exception when serialization_failure then null; end;
  begin perform private.save_refinement_proposal(cv_id,gen_random_uuid(),proposal); raise exception 'FAIL: request superseded between read and save'; exception when serialization_failure then null; end;
  if private.read_current_refinement_request(app,letter_id,'letter')->>'id'<>letter_id::text then raise exception 'FAIL: CV iteration invalidated letter read'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  if (select current_letter_request_id from public.application_refinement_state where application_id=app)<>letter_id then raise exception 'FAIL: CV iteration replaced letter'; end if;
  select revision into rev from public.application_refinement_state where application_id=app;
  begin perform public.save_refinement_review(app,cv_id,'approve_cv',jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',rev),gen_random_uuid()); raise exception 'FAIL: superseded CV approval'; exception when serialization_failure then null; end;
  perform public.save_refinement_review(app,letter_id,'approve_letter',jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',rev),gen_random_uuid());
  select revision into rev from public.application_refinement_state where application_id=app;
  result:=public.clear_refinement_history(app,rev,'cv');
  if result->>'current_cv_request_id' is not null or result->>'current_letter_request_id'<>letter_id::text
    or result#>>'{approvals_json,letter}'<>'v1:'||repeat('a',64) then raise exception 'FAIL: scoped clear changed letter state'; end if;
  if not exists(select 1 from public.application_refinement_proposals where id=letter_proposal)
    or not exists(select 1 from public.application_refinement_reviews where application_id=app and payload->>'scope'='letter') then raise exception 'FAIL: scoped clear lost letter history'; end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  begin perform private.read_current_refinement_request(app,next_cv,'cv'); raise exception 'FAIL: cleared read'; exception when serialization_failure then null; end;
  if private.read_current_refinement_request(app,letter_id,'letter')->>'id'<>letter_id::text then raise exception 'FAIL: scoped clear invalidated letter read'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  begin perform public.resolve_application_reference(app::text,'letter'); raise exception 'FAIL: another owner resolved private request'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.application_refinement_state where application_id=app) then raise exception 'FAIL: another owner saw pointers'; end if;
  execute 'reset role';
end;
$$;
rollback;
