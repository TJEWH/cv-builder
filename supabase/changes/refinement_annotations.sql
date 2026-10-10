-- Additive v2 annotation extension. No document content or older proposals are rewritten.
-- Apply after structured_cv_refinement.sql; all status/response/feedback stays in reviews.
create function public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; location jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then raise exception 'Invalid refinement annotations.' using errcode='22023'; end if;
  for item in select v from jsonb_array_elements(value) as x(v) loop
    if not public.refinement_exact_keys(item,array['id','type','document','location','text'])
      or jsonb_typeof(item->'id') is distinct from 'string' or coalesce(item->>'id','') !~ '^annotation-[1-9][0-9]*$' or item->>'id'=any(ids)
      or coalesce(item->>'type','') not in ('comment','todo','question') or coalesce(item->>'document','') not in ('cv','letter')
      or jsonb_typeof(item->'text') is distinct from 'string' or btrim(item->>'text')=''
      or public.refinement_utf16_length(item->>'text')>4000
      or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or item is distinct from public.job_drafting_redact_samples(item) then raise exception 'Invalid refinement annotation.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id'); location:=item->'location';
    if location='null'::jsonb then continue; end if;
    if item->>'document'='cv' then
      if not public.refinement_exact_keys(location,array['fieldId']) or jsonb_typeof(location->'fieldId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(fields) as f(v) where v->'id'=location->'fieldId') then raise exception 'Unknown CV annotation field.' using errcode='22023'; end if;
    else
      if not public.refinement_exact_keys(location,array['start','quote']) or jsonb_typeof(location->'start') is distinct from 'number'
        or coalesce(location->>'start','') !~ '^(0|[1-9][0-9]{0,5})$'
        or jsonb_typeof(location->'quote') is distinct from 'string' or btrim(location->>'quote')=''
        or public.refinement_utf16_length(location->>'quote')>2000 then raise exception 'Invalid letter annotation reference.' using errcode='22023'; end if;
      if substring(letter_text from (location->>'start')::integer+1 for char_length(location->>'quote')) is distinct from location->>'quote' then
        raise exception 'Invalid letter annotation reference.' using errcode='22023';
      end if;
    end if;
  end loop;
end;
$$;

alter table public.application_refinement_reviews drop constraint application_refinement_reviews_kind_check;
alter table public.application_refinement_reviews add constraint application_refinement_reviews_kind_check
  check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter','cv_decisions','annotation'));

revoke all on function public.refinement_validate_annotations(jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.refinement_validate_annotations(jsonb,jsonb,text) to authenticated;


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
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure']
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  if value->'schemaVersion'='2'::jsonb then perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  -- CV fields and structure already contain the user's final privacy wording.
  -- Keep identity checks on the remaining template, letter, feedback and context inputs.
  privacy_input := (value-array['cv','cvStructure']) || jsonb_build_object('cv',(value->'cv')-'fields');
  if privacy_input is distinct from public.job_drafting_redact_samples(privacy_input) then
    raise exception 'Anonymize refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
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
  if not found then raise exception 'Assign an anonymized CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    cv.content_json);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb; annotation jsonb; reference jsonb; previous public.application_refinement_reviews; has_previous boolean;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
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
    if not found then raise exception 'Annotation unavailable.' using errcode='22023'; end if;
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
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from state.current_request_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if jsonb_array_length(new.payload->'accepted')>0 and state.approvals_json->'cv'<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
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
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText'] || case when value ? 'annotations' then array['annotations'] else array[]::text[] end
      else array['schemaVersion','requestId','summary','cvEdits','letterText'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb)
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if value->'schemaVersion'='2'::jsonb then
    if value ? 'annotations' then perform public.refinement_validate_annotations(value->'annotations',request.request_json#>'{cv,fields}',value->>'letterText'); end if;
    perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  else
    perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;
