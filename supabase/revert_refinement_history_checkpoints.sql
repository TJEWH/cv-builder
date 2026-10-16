-- Roll back only the 20261016101949 refinement history checkpoints upgrade.
-- Apply once to an existing installation. Fresh installations already use schema.sql.
-- The deployed feature has no committed restores or superseded rounds. Abort if that changes.
-- Request/proposal/review payloads and current document pointers are preserved byte-for-byte.
set local lock_timeout='5s';
set local statement_timeout='45s';
lock table public.application_refinement_state, public.application_refinement_requests,
  public.application_refinement_reviews, public.application_refinement_proposals,
  public.application_refinement_history_events in access exclusive mode;

do $rollback_preflight$
begin
  if exists(select 1 from public.application_refinement_history_events where action<>'checkpoint')
    or exists(select 1 from public.application_refinement_requests where history_epoch<>0)
    or exists(select 1 from public.application_refinement_reviews where history_epoch<>0)
    or exists(select 1 from public.application_refinement_state where
      coalesce((history_json#>>'{cv,epoch}')::integer,0)<>0 or coalesce((history_json#>>'{letter,epoch}')::integer,0)<>0
      or coalesce(jsonb_array_length(history_json#>'{cv,superseded}'),0)>0
      or coalesce(jsonb_array_length(history_json#>'{letter,superseded}'),0)>0)
  then raise exception 'History was changed since rollback preparation; preserve and reconcile it before rollback.'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_review_active(jsonb,uuid,integer)')) is distinct from '1cc301a2c58482718fe06c88a4e73855' then raise exception 'Unexpected deployed definition: public.refinement_review_active(jsonb,uuid,integer)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_capture_state()')) is distinct from '5b2414f9f59c8492e62bec2c8f358f2f' then raise exception 'Unexpected deployed definition: public.refinement_capture_state()'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_capture_request()')) is distinct from '3fd07fb51c2b568820cc755df9df16eb' then raise exception 'Unexpected deployed definition: public.refinement_capture_request()'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_capture_review()')) is distinct from '8a39d44d97757c0ad9cfce4976d8c73f' then raise exception 'Unexpected deployed definition: public.refinement_capture_review()'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_capture_proposal()')) is distinct from '73779d4c0eb78ae18ba4b835ac2bd9aa' then raise exception 'Unexpected deployed definition: public.refinement_capture_proposal()'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refinement_capture_history_event()')) is distinct from 'a327624561dbb686227e259e6440d8e2' then raise exception 'Unexpected deployed definition: public.refinement_capture_history_event()'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.save_refinement_history_step(uuid,text,text,uuid,text,integer,uuid,jsonb)')) is distinct from 'f2e32745fca7073750c77391d779c2ce' then raise exception 'Unexpected deployed definition: public.save_refinement_history_step(uuid,text,text,uuid,text,integer,uuid,jsonb)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.clear_refinement_history(uuid,integer,text)')) is distinct from '53c848124e5e55716076a19a980488b0' then raise exception 'Unexpected deployed definition: public.clear_refinement_history(uuid,integer,text)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.publish_refinement_protocol(uuid,text,text)')) is distinct from 'c6fff17a8f95a03cb6c42732605ea6e8' then raise exception 'Unexpected deployed definition: public.publish_refinement_protocol(uuid,text,text)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.read_current_refinement_request(uuid,uuid,text)')) is distinct from 'b38f535f25428c2c9cc5fa77495205a7' then raise exception 'Unexpected deployed definition: private.read_current_refinement_request(uuid,uuid,text)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.clear_refinement_history(uuid,integer,text)')) is distinct from '6bad25ff72a1deacf6f2ee95d34bc3c2' then raise exception 'Unexpected deployed definition: private.clear_refinement_history(uuid,integer,text)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.publish_refinement_request(jsonb,integer)')) is distinct from 'e567673911ae574e485ede7ef1acc733' then raise exception 'Unexpected deployed definition: public.publish_refinement_request(jsonb,integer)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.save_refinement_review(uuid,uuid,text,jsonb,uuid,integer)')) is distinct from '273b41fb025d26b91d9e1b3fd3bc20aa' then raise exception 'Unexpected deployed definition: public.save_refinement_review(uuid,uuid,text,jsonb,uuid,integer)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.publish_refinement_request(jsonb)')) is distinct from '2fe8ba5ac9c6cca98fdae3e016cc45ca' then raise exception 'Unexpected deployed definition: public.publish_refinement_request(jsonb)'; end if;
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.save_refinement_review(uuid,uuid,text,jsonb,uuid)')) is distinct from 'efe57216e43056cefedba3558262d1c4' then raise exception 'Unexpected deployed definition: public.save_refinement_review(uuid,uuid,text,jsonb,uuid)'; end if;
end;
$rollback_preflight$;

create temporary table history_rollback_data_check on commit drop as select jsonb_build_object('states',(select md5(coalesce(string_agg((to_jsonb(s)-'history_json')::text,'' order by application_id),'')) from public.application_refinement_state s),'requests',(select md5(coalesce(string_agg((to_jsonb(r)-'history_epoch')::text,'' order by id),'')) from public.application_refinement_requests r),'reviews',(select md5(coalesce(string_agg((to_jsonb(r)-'history_epoch')::text,'' order by id),'')) from public.application_refinement_reviews r),'proposals',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.application_refinement_proposals p)) as fingerprints;

create or replace function public.refinement_capture_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  perform public.refinement_validate_setup(new.setup_json);
  if jsonb_typeof(new.approvals_json) is distinct from 'object' or not(new.approvals_json ?& array['cv','letter'])
    or new.approvals_json-array['cv','letter'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(new.approvals_json) e where jsonb_typeof(e.value) not in ('string','null') or (jsonb_typeof(e.value)='string' and e.value#>>'{}' !~ '^v1:[a-f0-9]{64}$')) then
    raise exception 'Invalid document approvals.' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if new.application_id<>old.application_id or new.user_id<>old.user_id then raise exception 'Refinement ownership cannot change.' using errcode='23514'; end if;
    if new.revision<>old.revision+1 then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    if pg_trigger_depth()=1 and exists(select 1 from jsonb_each(new.approvals_json) e where e.value<>'null'::jsonb and e.value is distinct from old.approvals_json->e.key) then
      raise exception 'Approve documents through a recorded review.' using errcode='23514';
    end if;
    if new.current_request_id is not null or (pg_trigger_depth()=1 and (
      new.current_cv_request_id is not null and new.current_cv_request_id is distinct from old.current_cv_request_id
      or new.current_letter_request_id is not null and new.current_letter_request_id is distinct from old.current_letter_request_id)) then
      raise exception 'Publish a document request to advance its refinement round.' using errcode='23514';
    end if;
    if new.setup_json<>old.setup_json then
      new.current_letter_request_id:=null;
      new.approvals_json:=jsonb_set(new.approvals_json,'{letter}','null');
    end if;
  else
    if new.approvals_json<>'{"cv":null,"letter":null}'::jsonb then raise exception 'Approve documents through a recorded review.' using errcode='23514'; end if;
    new.revision:=1;
    new.current_request_id:=null; new.current_cv_request_id:=null; new.current_letter_request_id:=null;
  end if;
  if new.current_cv_request_id is not null and not exists(select 1 from public.application_refinement_requests r
      where r.id=new.current_cv_request_id and r.user_id=new.user_id and r.application_id=new.application_id and r.request_json->>'scope'='cv')
    or new.current_letter_request_id is not null and not exists(select 1 from public.application_refinement_requests r
      where r.id=new.current_letter_request_id and r.user_id=new.user_id and r.application_id=new.application_id and r.request_json->>'scope'='letter') then
    raise exception 'The current request must belong to its document.' using errcode='23514';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; privacy_input jsonb; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure'] || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}');
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  -- CV fields and structure already contain the user's final privacy wording.
  -- Keep identity checks on the remaining template, letter, feedback and context inputs.
  privacy_input := (value-array['cv','cvStructure']) || jsonb_build_object('cv',(value->'cv')-'fields');
  if privacy_input is distinct from public.job_drafting_redact_samples(privacy_input) then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if value->>'scope'='letter' and state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope'='cv' and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope'='letter' and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId'
    and exists(select 1 from public.application_refinement_requests parent where parent.id=p.request_id and parent.user_id=new.user_id
      and parent.application_id=new.application_id and parent.request_json->>'scope'=value->>'scope' and not ((value->>'scope')=any(parent.cleared_scopes)))) then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback'
    and r.payload->>'scope'=value->>'scope' and not ((value->>'scope')=any(r.cleared_scopes))
    and (r.request_id is null or exists(select 1 from public.application_refinement_requests source where source.id=r.request_id and source.request_json->>'scope'=value->>'scope')) order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    cv.content_json);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb; annotation jsonb; reference jsonb; previous public.application_refinement_reviews; has_previous boolean; request_scope text; current_id uuid;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.request_id is not null then
    select r.request_json->>'scope' into request_scope from public.application_refinement_requests r where r.id=new.request_id and r.user_id=new.user_id and r.application_id=new.application_id;
    if request_scope not in ('cv','letter') then raise exception 'Combined rounds are read-only history. Publish a separate request.' using errcode='22023'; end if;
    current_id:=case when request_scope='cv' then state.current_cv_request_id else state.current_letter_request_id end;
  end if;
  if new.kind='annotation' or (new.kind='feedback' and new.payload ? 'annotation') then
    reference:=case when new.kind='annotation' then jsonb_build_object('proposalId',new.payload->'proposalId','annotationId',new.payload->'annotationId','reviewId',new.payload->'previousReviewId') else new.payload->'annotation' end;
    if not public.refinement_exact_keys(reference,array['proposalId','annotationId','reviewId'])
      or jsonb_typeof(reference->'proposalId') is distinct from 'string' or coalesce(reference->>'proposalId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(reference->'annotationId') is distinct from 'string' or coalesce(reference->>'annotationId','') !~ '^annotation-[1-9][0-9]*$'
      or (reference->'reviewId'<>'null'::jsonb and (jsonb_typeof(reference->'reviewId') is distinct from 'string' or coalesce(reference->>'reviewId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) then
      raise exception 'Invalid annotation reference.' using errcode='22023';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p where p.user_id=new.user_id
      and p.application_id=new.application_id and p.request_id=new.request_id and p.id::text=lower(reference->>'proposalId');
    if not found then raise exception 'Annotation proposal unavailable.' using errcode='42501'; end if;
    select a into annotation from jsonb_array_elements(coalesce(proposal->'annotations','[]'::jsonb)) as x(a) where a->>'id'=reference->>'annotationId';
    if not found or annotation->>'document' is distinct from request_scope then raise exception 'Annotation unavailable for this document.' using errcode='22023'; end if;
    select * into previous from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id
      and r.kind='annotation' and r.payload->>'proposalId'=reference->>'proposalId' and r.payload->>'annotationId'=reference->>'annotationId'
      order by r.created_at desc,r.id desc limit 1;
    has_previous:=found;
    if (has_previous and lower(reference->>'reviewId') is distinct from previous.id::text) or (not has_previous and reference->'reviewId'<>'null'::jsonb) then
      raise exception 'Annotation changed elsewhere; reload the saved annotation. Your documents are unchanged.' using errcode='40001';
    end if;
    if new.kind='feedback' and (new.payload->>'scope' is distinct from annotation->>'document'
      or (has_previous and previous.payload->>'status'<>'open' and previous.payload->'response'='null'::jsonb)) then
      raise exception 'Only open or answered annotations can be included in their document feedback.' using errcode='22023';
    end if;
  end if;
  if new.kind='annotation' then
    if not public.refinement_exact_keys(new.payload,array['proposalId','annotationId','status','response','previousReviewId'])
      or coalesce(new.payload->>'status','') not in ('open','resolved','ignored')
      or (new.payload->'response'<>'null'::jsonb and (jsonb_typeof(new.payload->'response') is distinct from 'string' or btrim(new.payload->>'response')='' or public.refinement_utf16_length(new.payload->>'response')>12000))
      or translate(coalesce(new.payload->>'response',''),E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized annotation review.' using errcode='22023';
    end if;
  elsif new.kind='feedback' then
    if new.payload-array['text','scope','annotation']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter')
      or (new.request_id is not null and new.payload->>'scope' is distinct from request_scope)
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from current_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if (request_scope='cv' and jsonb_array_length(new.payload->'accepted')>0 or request_scope='letter') and state.approvals_json->request_scope<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.request_id is not null and (request_scope is distinct from target or new.request_id is distinct from current_id) then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if request.request_json->>'scope' not in ('cv','letter') then raise exception 'Combined rounds are read-only history. Publish a separate request.' using errcode='22023'; end if;
  perform 1 from public.application_refinement_state s where s.user_id=request.user_id and s.application_id=request.application_id
    and new.request_id=case when request.request_json->>'scope'='cv' then s.current_cv_request_id else s.current_letter_request_id end for share;
  if not found or (request.request_json->>'scope')=any(request.cleared_scopes) then raise exception 'This document request is stale. Copy a fresh task.' using errcode='40001'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText'] || case when value ? 'annotations' then array['annotations'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(value->'annotations')='array' then value->'annotations' else '[]'::jsonb end) a where a->>'document' is distinct from request.request_json->>'scope') then raise exception 'Questions must belong to the requested document.' using errcode='22023'; end if;
  if request.request_json->>'scope'='letter' and value->'cvComments'<>'[]'::jsonb then raise exception 'Letter requests cannot include CV comments.' using errcode='22023'; end if;
  if value ? 'annotations' then perform public.refinement_validate_annotations(value->'annotations',request.request_json#>'{cv,fields}',value->>'letterText'); end if;
  perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
  if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,p_scope);
$$;

create or replace function public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); source public.application_refinement_requests;
  saved public.application_refinement_protocols;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before publishing a refinement protocol.' using errcode='42501';
  end if;
  if p_request_id is null or p_protocol_id is null or p_protocol_id !~ '^v1:[0-9a-f]{64}$'
    or p_protocol_text is null or char_length(p_protocol_text) not between 1 and 100000 then
    raise exception 'Invalid refinement protocol document.' using errcode='22023';
  end if;
  select * into source from public.application_refinement_requests where id=p_request_id and user_id=actor;
  if not found then raise exception 'Published request not found for this account.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||source.application_id::text,0));
  if not exists (select 1 from public.application_refinement_state where user_id=actor
    and application_id=source.application_id and source.request_json->>'scope' in ('cv','letter')
    and case when source.request_json->>'scope'='cv' then current_cv_request_id else current_letter_request_id end=p_request_id) then
    raise exception 'The current refinement request changed. Copy the task again.' using errcode='40001';
  end if;
  insert into public.application_refinement_protocols(request_id,protocol_id,application_id,user_id,protocol_text)
    values(p_request_id,p_protocol_id,source.application_id,actor,p_protocol_text)
    on conflict (request_id,protocol_id) do nothing;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if saved.protocol_text is distinct from p_protocol_text then
    raise exception 'This protocol identifier already belongs to different instructions.' using errcode='22023';
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then
    raise exception 'The postgres management connection is required.' using errcode='42501';
  end if;
  if p_application_id is null or p_request_id is null or p_scope is null or p_scope not in ('cv','letter') then
    raise exception 'An exact application, request and CV or letter scope are required.' using errcode='22023';
  end if;
  -- One statement snapshot verifies ownership relationships and the document pointer.
  -- Proposal publication checks freshness again if a new round starts after this read.
  select r.* into result from public.application_refinement_requests r
    join public.applications a on a.id=r.application_id and a.user_id=r.user_id
    join public.application_refinement_state s on s.application_id=a.id and s.user_id=a.user_id
    where r.application_id=p_application_id and r.id=p_request_id
      and r.request_json->>'scope'=p_scope and not (p_scope=any(r.cleared_scopes))
      and r.id=case when p_scope='cv' then s.current_cv_request_id else s.current_letter_request_id end;
  if not found then
    raise exception 'The published request is unavailable or no longer current for this document. Copy a fresh task.' using errcode='40001';
  end if;
  return to_jsonb(result);
end;
$$;

create or replace function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
  removed integer;
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0
    or p_scope is null or p_scope not in ('cv','letter','both') then
    raise exception 'An application, refinement scope and current revision are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then
    raise exception 'Application unavailable.' using errcode='42501';
  end if;
  select * into result from public.application_refinement_state
    where user_id=actor and application_id=p_application_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    return 'null'::jsonb;
  end if;
  if result.revision<>p_expected_revision then
    raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001';
  end if;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  if p_scope='both' then
    delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
    delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  else
    update public.application_refinement_requests
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and request_json->>'scope' in ('both',p_scope)
        and not (p_scope=any(cleared_scopes));
    update public.application_refinement_reviews
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and kind='feedback' and payload->>'scope'='both'
        and not (p_scope=any(cleared_scopes));
    delete from public.application_refinement_reviews r where r.user_id=actor and r.application_id=p_application_id and (
      r.cleared_scopes=array['cv','letter']
      or r.kind in ('approve_'||p_scope,'reopen_'||p_scope)
      or (r.kind='cv_decisions' and exists(select 1 from public.application_refinement_requests source where source.id=r.request_id
        and (source.request_json->>'scope'=p_scope or source.request_json->>'scope'='both' and p_scope='cv')))
      or (r.kind='feedback' and r.payload->>'scope'=p_scope)
      or (r.kind='annotation' and exists (
        select 1 from public.application_refinement_proposals p,
          lateral jsonb_array_elements(coalesce(p.proposal_json->'annotations','[]'::jsonb)) a
        where p.user_id=actor and p.application_id=p_application_id and p.id::text=r.payload->>'proposalId'
          and a->>'id'=r.payload->>'annotationId' and a->>'document'=p_scope
      ))
    );
    -- Older clients linked reviews for either document to the global current
    -- request. Keep that immutable source while the other document needs it,
    -- along with ancestors referenced by surviving iteration lineage.
    loop
      delete from public.application_refinement_requests r where r.user_id=actor and r.application_id=p_application_id
        and (r.request_json->>'scope'=any(r.cleared_scopes) or r.cleared_scopes=array['cv','letter'])
        and not exists(select 1 from public.application_refinement_reviews v where v.user_id=actor and v.application_id=p_application_id and v.request_id=r.id)
        and not exists(select 1 from public.application_refinement_proposals p
          join public.application_refinement_requests child on child.user_id=actor and child.application_id=p_application_id
            and child.request_json->>'parentProposalId'=p.id::text
          where p.user_id=actor and p.application_id=p_application_id and p.request_id=r.id);
      get diagnostics removed=row_count;
      exit when removed=0;
    end loop;
  end if;
  -- A current request for the other document remains current. The deferred FK
  -- permits clearing a selected pointer and its request within this transaction.
  update public.application_refinement_state s set current_request_id=null,
    current_cv_request_id=case when p_scope in ('cv','both') then null else s.current_cv_request_id end,
    current_letter_request_id=case when p_scope in ('letter','both') then null else s.current_letter_request_id end,
    revision=s.revision+1
    where s.user_id=actor and s.application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

create or replace function public.publish_refinement_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request_id uuid; application_id uuid; result public.application_refinement_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before publishing refinement.' using errcode='42501'; end if;
  if coalesce(p_request->>'scope','') not in ('cv','letter') then raise exception 'Publish a separate CV or letter request.' using errcode='22023'; end if;
  begin request_id:=(p_request->>'requestId')::uuid; application_id:=(p_request->>'applicationId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid refinement identifiers.' using errcode='22023'; end;
  if request_id is null or application_id is null then raise exception 'Refinement identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||application_id::text,0));
  select * into result from public.application_refinement_requests r where r.user_id=actor and r.id=request_id;
  if found then
    if result.request_json=p_request then return to_jsonb(result); end if;
    raise exception 'Request ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_requests(id,application_id,user_id,request_json,opportunity_snapshot,cv_snapshot)
    values(request_id,application_id,actor,p_request,'{}','{}') returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.save_refinement_review(p_application_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving a review.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  select * into result from public.application_refinement_reviews where user_id=actor and id=p_id;
  if found then
    if result.application_id=p_application_id and result.request_id is not distinct from p_request_id and result.kind=p_kind and result.payload=p_payload then return to_jsonb(result); end if;
    raise exception 'Review ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_reviews(id,application_id,user_id,request_id,kind,payload) values(p_id,p_application_id,actor,p_request_id,p_kind,p_payload) returning * into result;
  return to_jsonb(result);
end;
$$;

-- Remove only the APIs, trigger, table and columns introduced by the reverted feature.
drop trigger refinement_history_event_capture on public.application_refinement_history_events;
drop function public.refinement_review_active(jsonb,uuid,integer);
drop function public.refinement_capture_history_event();
drop function public.save_refinement_history_step(uuid,text,text,uuid,text,integer,uuid,jsonb);
drop function public.publish_refinement_request(jsonb,integer);
drop function public.save_refinement_review(uuid,uuid,text,jsonb,uuid,integer);
drop table public.application_refinement_history_events;
alter table public.application_refinement_state drop column history_json;
alter table public.application_refinement_requests drop column history_epoch;
alter table public.application_refinement_reviews drop column history_epoch;

do $rollback_postflight$
begin
  if (select jsonb_build_object('states',(select md5(coalesce(string_agg((to_jsonb(s)-'history_json')::text,'' order by application_id),'')) from public.application_refinement_state s),'requests',(select md5(coalesce(string_agg((to_jsonb(r)-'history_epoch')::text,'' order by id),'')) from public.application_refinement_requests r),'reviews',(select md5(coalesce(string_agg((to_jsonb(r)-'history_epoch')::text,'' order by id),'')) from public.application_refinement_reviews r),'proposals',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.application_refinement_proposals p))) is distinct from (select fingerprints from history_rollback_data_check) then
    raise exception 'Rollback changed existing refinement records.';
  end if;
end;
$rollback_postflight$;
notify pgrst, 'reload schema';
