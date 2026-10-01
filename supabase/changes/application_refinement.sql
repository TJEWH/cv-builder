-- Additive upgrade after cv_adjustments.sql. Existing snapshots and drafting APIs are unchanged.
begin;

create schema if not exists private;

create table public.application_refinement_state (
  application_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_json jsonb not null,
  approvals_json jsonb not null default '{"cv":null,"letter":null}',
  current_request_id uuid,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_requests (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_json jsonb not null,
  opportunity_snapshot jsonb not null,
  cv_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_proposals (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  proposal_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
create table public.application_refinement_reviews (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid,
  kind text not null check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade,
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
alter table public.application_refinement_state add constraint refinement_current_request_fk
  foreign key (user_id,application_id,current_request_id) references public.application_refinement_requests(user_id,application_id,id)
  on delete no action deferrable initially deferred;
create index refinement_state_owner_idx on public.application_refinement_state(user_id,application_id,current_request_id);
create index refinement_requests_recent_idx on public.application_refinement_requests(user_id,application_id,created_at,id);
create index refinement_proposals_request_idx on public.application_refinement_proposals(user_id,application_id,request_id,created_at,id);
create index refinement_reviews_request_idx on public.application_refinement_reviews(user_id,application_id,request_id);
create index refinement_reviews_recent_idx on public.application_refinement_reviews(user_id,application_id,created_at,id);

comment on table public.application_refinement_state is 'Frozen letter setup and approval revision hashes. Full CVs and reconstruction bindings stay local.';
comment on table public.application_refinement_requests is 'Immutable anonymized refinement context; server captures assigned public CV and application research. No application notes or supporting files.';
comment on table public.application_refinement_proposals is 'Append-only validated proposals, written only by the postgres management connection. Reading a proposal never applies it locally.';
comment on table public.application_refinement_reviews is 'Append-only owner feedback and approval history. Feedback must be anonymized before sending.';

alter table public.application_refinement_state enable row level security;
alter table public.application_refinement_requests enable row level security;
alter table public.application_refinement_proposals enable row level security;
alter table public.application_refinement_reviews enable row level security;
revoke all on public.application_refinement_state, public.application_refinement_requests, public.application_refinement_proposals, public.application_refinement_reviews from public,anon,authenticated,service_role;
grant select,insert,update on public.application_refinement_state to authenticated;
grant select,insert on public.application_refinement_requests, public.application_refinement_reviews to authenticated;
grant select on public.application_refinement_proposals to authenticated;
create policy "Read own refinement state" on public.application_refinement_state for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement state" on public.application_refinement_state for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Update own refinement state" on public.application_refinement_state for update to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)) with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement requests" on public.application_refinement_requests for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement requests" on public.application_refinement_requests for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement proposals" on public.application_refinement_proposals for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement reviews" on public.application_refinement_reviews for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement reviews" on public.application_refinement_reviews for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.refinement_validate_setup(value jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare template jsonb := value->'template'; item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>200000
    or value - array['template','language','maxWords'] <> '{}'::jsonb or not(value ?& array['template','language','maxWords'])
    or jsonb_typeof(value->'language') is distinct from 'string' or char_length(value->>'language') not between 1 and 30
    or jsonb_typeof(value->'maxWords') is distinct from 'number' or coalesce(value->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (value->>'maxWords')::integer not between 50 and 2000
    or jsonb_typeof(template) is distinct from 'object'
    or template - array['id','name','revision','structure','tone','language','maxWords','updatedAt','subjectInstructions','salutationInstructions','closingInstructions','exampleText'] <> '{}'::jsonb
    or not(template ?& array['id','name','revision','structure','tone','language','maxWords','updatedAt'])
    or jsonb_typeof(template->'revision') is distinct from 'number' or coalesce(template->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(template->'maxWords') is distinct from 'number' or coalesce(template->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (template->>'maxWords')::integer not between 50 and 2000 then
    raise exception 'Invalid refinement letter template or word target.' using errcode='22023';
  end if;
  for item in select key,val from jsonb_each(template-array['revision','maxWords']) e(key,val) loop
    if jsonb_typeof(item.val) is distinct from 'string' or char_length(item.val#>>'{}')>20000
      or (item.key in ('subjectInstructions','salutationInstructions','closingInstructions') and char_length(item.val#>>'{}')>1000)
      or translate(item.val#>>'{}', E'\t\n\r','') ~ '[[:cntrl:]]' then
      raise exception 'Invalid refinement template text.' using errcode='22023';
    end if;
  end loop;
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement text before publishing.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_capture_state()
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
    if pg_trigger_depth()=1 and new.current_request_id is not null and new.current_request_id is distinct from old.current_request_id then
      raise exception 'Publish a request to advance the refinement round.' using errcode='23514';
    end if;
    if new.setup_json<>old.setup_json then
      new.current_request_id:=null;
      new.approvals_json:=jsonb_set(new.approvals_json,'{letter}','null');
    end if;
  else
    if new.approvals_json<>'{"cv":null,"letter":null}'::jsonb then raise exception 'Approve documents through a recorded review.' using errcode='23514'; end if;
    new.revision:=1;
    new.current_request_id:=null;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_state_capture before insert or update on public.application_refinement_state for each row execute function public.refinement_capture_state();

create function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  raise exception 'Refinement history is immutable; create a new round or remove the application.' using errcode='23514';
end;
$$;
create trigger refinement_requests_immutable before update or delete on public.application_refinement_requests for each row execute function public.refinement_guard_immutable();
create trigger refinement_proposals_immutable before update or delete on public.application_refinement_proposals for each row execute function public.refinement_guard_immutable();
create trigger refinement_reviews_immutable before update or delete on public.application_refinement_reviews for each row execute function public.refinement_guard_immutable();

create function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or value-array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] <> '{}'::jsonb
    or not(value ?& array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'])
    or value->'schemaVersion' is distinct from '1'::jsonb or value->>'requestId' is distinct from new.id::text
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
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
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
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
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
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_requests_capture before insert on public.application_refinement_requests for each row execute function public.refinement_capture_request();
create function public.refinement_activate_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.application_refinement_state set current_request_id=new.id, revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
  return new;
end;
$$;
create trigger refinement_requests_activate after insert on public.application_refinement_requests for each row execute function public.refinement_activate_request();

create function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='feedback' then
    if new.payload-array['text','scope']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
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
create trigger refinement_reviews_capture before insert on public.application_refinement_reviews for each row execute function public.refinement_capture_review();

create function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or value-array['schemaVersion','requestId','summary','cvEdits','letterText']<>'{}'::jsonb
    or not(value ?& array['schemaVersion','requestId','summary','cvEdits','letterText'])
    or value->'schemaVersion' is distinct from '1'::jsonb or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!!|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
  if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_proposals_capture before insert on public.application_refinement_proposals for each row execute function public.refinement_capture_proposal();

create function public.save_refinement_state(p_application_id uuid,p_setup jsonb,p_approvals jsonb,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_state;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving preparation.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into result from public.application_refinement_state where user_id=actor and application_id=p_application_id for update;
  if found then
    if result.revision is distinct from p_expected_revision then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    update public.application_refinement_state set setup_json=p_setup,approvals_json=p_approvals,revision=revision+1 where application_id=p_application_id and user_id=actor returning * into result;
  else
    if p_expected_revision is distinct from 0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    insert into public.application_refinement_state(application_id,user_id,setup_json,approvals_json) values(p_application_id,actor,p_setup,p_approvals) returning * into result;
  end if;
  return to_jsonb(result);
end;
$$;
create function public.publish_refinement_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request_id uuid; application_id uuid; result public.application_refinement_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before publishing refinement.' using errcode='42501'; end if;
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
create function public.save_refinement_review(p_application_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_id uuid)
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

create function private.read_refinement_request(request_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into result from public.application_refinement_requests where id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  return to_jsonb(result);
end;
$$;
create function private.save_refinement_proposal(request_id uuid,proposal_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.application_refinement_proposals; request public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if request_id is null or proposal_id is null then raise exception 'Request and proposal identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(proposal_id::text,0));
  select * into result from public.application_refinement_proposals p where p.id=proposal_id;
  if found then
    if result.request_id=request_id and result.proposal_json=payload then return to_jsonb(result); end if;
    raise exception 'Proposal ID already exists with different input.' using errcode='23505';
  end if;
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
    values(proposal_id,request.application_id,request.user_id,request_id,payload) returning * into result;
  return to_jsonb(result);
end;
$$;

revoke all on function public.refinement_validate_setup(jsonb) from public,anon,service_role;
grant execute on function public.refinement_validate_setup(jsonb) to authenticated;
revoke all on function public.refinement_capture_state(), public.refinement_guard_immutable(), public.refinement_capture_request(), public.refinement_activate_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;
revoke all on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) to authenticated;
revoke all on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to postgres;
grant execute on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

commit;
