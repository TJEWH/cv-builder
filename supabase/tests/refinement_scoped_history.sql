-- Run after refinement_scoped_history.sql. All synthetic fixtures roll back.
begin;
do $$
declare
  actor uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid(); application uuid:=gen_random_uuid();
  ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  scopes text[]:=array['cv','letter','both']; idx integer;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z"},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Robotics research."}}';
  request jsonb; proposal jsonb; receipt jsonb; initial jsonb; revision integer;
  shared_feedback uuid:=gen_random_uuid(); shared_proposal uuid:=gen_random_uuid(); next_request uuid:=gen_random_uuid();
  feedback jsonb; saved_letter_request jsonb; saved_letter_proposal jsonb;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(actor,'authenticated','authenticated',actor::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values(opportunity,'scoped-history-'||opportunity::text,'Scope fixture');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(application,opportunity);
  perform public.assign_job_application_cv(application,gen_random_uuid(),'History CV',content,'{}',7,'{}');
  perform public.save_refinement_state(application,setup,'{"cv":null,"letter":null}',0);
  for idx in 1..3 loop
    request:=jsonb_build_object('schemaVersion',2,'requestId',ids[idx],'applicationId',application,
      'cv',jsonb_build_object('schemaVersion',1,'requestId',ids[idx],
        'fields',jsonb_build_array(jsonb_build_object('id','field-1','label','Profile','text','Robotics research.')),
        'opportunity','{}'::jsonb,'instructions','Preserve evidence.'),
      'letter',setup||'{"text":"Original letter."}','scope',scopes[idx],'feedback','[]'::jsonb,'parentProposalId',null,
      'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[{"fieldId":"field-1","reason":"Keep source evidence unchanged."}]}'::jsonb);
    if idx=3 then
      -- Seed immutable legacy records as they existed before scope separation.
      execute 'reset role';
      alter table public.application_refinement_requests disable trigger refinement_requests_capture;
      insert into public.application_refinement_requests(id,user_id,application_id,request_json,opportunity_snapshot,cv_snapshot)
        values(ids[idx],actor,application,request,'{}','{}');
      alter table public.application_refinement_requests enable trigger refinement_requests_capture;
    else perform public.publish_refinement_request(request); end if;
    execute 'reset role';
    proposal:=jsonb_build_object('schemaVersion',2,'requestId',ids[idx],'summary','Research draft.',
      'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,'letterText',case when idx=1 then 'Original letter.' else 'A complete research letter.' end,
      'annotations','[{"id":"annotation-1","type":"question","document":"cv","location":null,"text":"Which research method?"},{"id":"annotation-2","type":"question","document":"letter","location":null,"text":"Why this research?"}]'::jsonb);
    if idx<3 then proposal:=jsonb_set(proposal,'{annotations}',jsonb_build_array(proposal->'annotations'->(idx-1))); end if;
    if idx=3 then alter table public.application_refinement_proposals disable trigger refinement_proposals_capture; end if;
    perform private.save_refinement_proposal(ids[idx],case when idx=3 then shared_proposal else gen_random_uuid() end,proposal);
    if idx=3 then alter table public.application_refinement_proposals enable trigger refinement_proposals_capture; end if;
    execute 'set local role authenticated';
    if idx=1 then
      execute 'reset role'; alter table public.application_refinement_reviews disable trigger refinement_reviews_capture; execute 'set local role authenticated';
      select s.revision into revision from public.application_refinement_state s where s.application_id=application;
      perform public.save_refinement_review(application,ids[1],'approve_letter',jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',revision),gen_random_uuid());
      select s.revision into revision from public.application_refinement_state s where s.application_id=application;
      perform public.save_refinement_review(application,ids[1],'reopen_letter',jsonb_build_object('expectedRevision',revision),gen_random_uuid());
      execute 'reset role'; alter table public.application_refinement_reviews enable trigger refinement_reviews_capture; execute 'set local role authenticated';
    end if;
  end loop;
  perform public.save_refinement_review(application,null,'feedback','{"text":"Improve CV evidence.","scope":"cv"}',gen_random_uuid());
  perform public.save_refinement_review(application,null,'feedback','{"text":"Improve letter fit.","scope":"letter"}',gen_random_uuid());
  execute 'reset role'; alter table public.application_refinement_reviews disable trigger refinement_reviews_capture; execute 'set local role authenticated';
  perform public.save_refinement_review(application,ids[1],'feedback','{"text":"Letter feedback linked to an older CV round.","scope":"letter"}',gen_random_uuid());
  perform public.save_refinement_review(application,null,'feedback','{"text":"Shared research preference.","scope":"both"}',shared_feedback);
  for idx in 1..2 loop
    perform public.save_refinement_review(application,ids[3],'annotation',jsonb_build_object('proposalId',shared_proposal,
      'annotationId','annotation-'||idx::text,'status','resolved','response','Documented research evidence.','previousReviewId',null),gen_random_uuid());
  end loop;
  execute 'reset role'; alter table public.application_refinement_reviews enable trigger refinement_reviews_capture; execute 'set local role authenticated';
  select to_jsonb(s),s.revision into initial,revision from public.application_refinement_state s where application_id=application;
  select to_jsonb(r) into saved_letter_request from public.application_refinement_requests r where id=ids[2];
  select to_jsonb(p) into saved_letter_proposal from public.application_refinement_proposals p where request_id=ids[2];
  begin perform public.clear_refinement_history(application,revision,'unknown'); raise exception 'FAIL: unknown scope accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.clear_refinement_history(application,revision,null); raise exception 'FAIL: null scope accepted'; exception when invalid_parameter_value then null; end;
  begin update public.application_refinement_requests set cleared_scopes='{cv}' where id=ids[3]; raise exception 'FAIL: direct clear metadata update'; exception when insufficient_privilege then null; end;

  receipt:=public.clear_refinement_history(application,revision,'cv');
  if receipt->>'current_letter_request_id'<>ids[2]::text or receipt->>'current_cv_request_id' is not null or (receipt->>'revision')::integer<>revision+1
    or receipt->'setup_json'<>initial->'setup_json' or receipt->'approvals_json'<>initial->'approvals_json' then
    raise exception 'FAIL: scoped clear changed retained state';
  end if;
  if (select cleared_scopes from public.application_refinement_requests where id=ids[1])<>'{cv}'::text[]
    or not exists(select 1 from public.application_refinement_proposals where request_id=ids[1])
    or not exists(select 1 from public.application_refinement_reviews where request_id=ids[1] and kind='approve_letter')
    or not exists(select 1 from public.application_refinement_reviews where request_id=ids[1] and kind='feedback')
    or (select cleared_scopes from public.application_refinement_requests where id=ids[3])<>'{cv}'::text[]
    or (select cleared_scopes from public.application_refinement_reviews where id=shared_feedback)<>'{cv}'::text[]
    or exists(select 1 from public.application_refinement_reviews where application_id=application and (payload->>'scope'='cv' or payload->>'annotationId'='annotation-1')) then
    raise exception 'FAIL: CV history was not cleared independently';
  end if;
  if (select to_jsonb(r) from public.application_refinement_requests r where id=ids[2])<>saved_letter_request
    or (select to_jsonb(p) from public.application_refinement_proposals p where request_id=ids[2])<>saved_letter_proposal
    or not exists(select 1 from public.application_refinement_reviews where application_id=application and payload->>'annotationId'='annotation-2') then
    raise exception 'FAIL: CV clear changed letter history';
  end if;
  begin perform public.clear_refinement_history(application,revision,'letter'); raise exception 'FAIL: scoped clear accepted stale revision'; exception when serialization_failure then null; end;

  -- CV publication omits the CV-cleared shared reply while preserving all other
  -- saved feedback required by the existing publication contract.
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'text',r.payload->'text','scope',r.payload->'scope','createdAt',r.created_at) order by r.created_at,r.id),'[]')
    into feedback from public.application_refinement_reviews r where r.application_id=application and r.kind='feedback' and r.payload->>'scope'='cv' and not ('cv'=any(r.cleared_scopes));
  request:=jsonb_set(jsonb_set(request,'{requestId}',to_jsonb(next_request)),'{cv,requestId}',to_jsonb(next_request))
    ||jsonb_build_object('scope','cv','feedback',feedback);
  perform public.publish_refinement_request(request);
  select s.revision into revision from public.application_refinement_state s where s.application_id=application;
  receipt:=public.clear_refinement_history(application,revision,'letter');
  if receipt->>'current_cv_request_id'<>next_request::text or receipt->>'current_letter_request_id' is not null
    or (select count(*) from public.application_refinement_requests where application_id=application)<>1
    or exists(select 1 from public.application_refinement_proposals where application_id=application)
    or exists(select 1 from public.application_refinement_reviews where application_id=application) then
    raise exception 'FAIL: clearing second facet removed current CV work or retained shared history';
  end if;
  if has_function_privilege('anon','public.clear_refinement_history(uuid,integer,text)','EXECUTE')
    or has_function_privilege('service_role','public.clear_refinement_history(uuid,integer,text)','EXECUTE')
    or has_table_privilege('authenticated','public.application_refinement_requests','UPDATE')
    or has_table_privilege('authenticated','public.application_refinement_reviews','UPDATE') then
    raise exception 'FAIL: scoped history clear widened privileges';
  end if;
  execute 'reset role';
end;
$$;
rollback;
select 'PASS: independent CV/letter deletion, shared-round facets, other-scope current pointer, annotations, feedback publication and immutable metadata; fixtures rolled back.' as result;
