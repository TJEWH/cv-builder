-- Additive upgrade: clear one document's refinement history without discarding
-- the other document's rounds. Legacy shared rounds survive until both are cleared.
alter table public.application_refinement_requests
  add column cleared_scopes text[] not null default '{}' check (cleared_scopes in ('{}'::text[],'{cv}'::text[],'{letter}'::text[],'{cv,letter}'::text[]));
alter table public.application_refinement_reviews
  add column cleared_scopes text[] not null default '{}' check (cleared_scopes in ('{}'::text[],'{cv}'::text[],'{letter}'::text[],'{cv,letter}'::text[]));

create or replace function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if current_user='postgres' and auth.uid()=old.user_id
    and current_setting('cv_builder.clearing_refinement_history',true)=old.user_id::text||':'||old.application_id::text then
    if tg_op='DELETE' then return old; end if;
    if tg_op='UPDATE' and tg_table_name in ('application_refinement_requests','application_refinement_reviews')
      and to_jsonb(new)-'cleared_scopes'=to_jsonb(old)-'cleared_scopes'
      and (to_jsonb(new)->'cleared_scopes') @> (to_jsonb(old)->'cleared_scopes') then return new; end if;
  end if;
  raise exception 'Refinement history is immutable; create a new round or clear history.' using errcode='23514';
end;
$$;

-- Client inserts may not pre-clear history; only the owner-checked helper below
-- can mutate this metadata after publication.
create function public.refinement_guard_initial_history_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.cleared_scopes<>'{}'::text[] then raise exception 'New refinement history cannot already be cleared.' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger refinement_requests_initial_scope before insert on public.application_refinement_requests
  for each row execute function public.refinement_guard_initial_history_scope();
create trigger refinement_reviews_initial_scope before insert on public.application_refinement_reviews
  for each row execute function public.refinement_guard_initial_history_scope();
revoke all on function public.refinement_guard_initial_history_scope() from public,anon,authenticated,service_role;

create function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
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
      or (p_scope='cv' and r.kind='cv_decisions')
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
  update public.application_refinement_state s set current_request_id=case when exists (
      select 1 from public.application_refinement_requests r where r.user_id=actor and r.application_id=p_application_id and r.id=s.current_request_id
        and not (r.request_json->>'scope'=any(r.cleared_scopes) or r.cleared_scopes=array['cv','letter'])
    ) then s.current_request_id else null end, revision=s.revision+1
    where s.user_id=actor and s.application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

create function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,p_scope);
$$;
alter function private.clear_refinement_history(uuid,integer,text) owner to postgres;
alter function public.clear_refinement_history(uuid,integer,text) owner to postgres;
revoke all on function private.clear_refinement_history(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.clear_refinement_history(uuid,integer,text) to authenticated,postgres;
revoke all on function public.clear_refinement_history(uuid,integer,text) from public,anon,service_role;
grant execute on function public.clear_refinement_history(uuid,integer,text) to authenticated;

-- Retain the explicit legacy all-history entry point for previously shipped clients.
create or replace function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,'both');
$$;

-- Retained shared feedback is omitted only for its cleared document facet.
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
    or coalesce(value->>'scope','') not in ('both','cv','letter')
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
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback'
    and (value->>'scope'='both' or not ((value->>'scope')=any(r.cleared_scopes))) order by r.created_at,r.id loop
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
