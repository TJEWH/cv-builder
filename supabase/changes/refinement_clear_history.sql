-- Owner-requested history removal. Apply after refinement_annotations.sql.
-- Documents, assigned CV snapshots, setup and approval hashes remain unchanged.
begin;

create or replace function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  -- A custom setting alone grants no authority. Only the postgres-owned RPC can
  -- delete directly, and its scope must match both the signed-in owner and row.
  if tg_op='DELETE' and current_user='postgres' and auth.uid()=old.user_id
    and current_setting('cv_builder.clearing_refinement_history',true)=old.user_id::text||':'||old.application_id::text then
    return old;
  end if;
  raise exception 'Refinement history is immutable; create a new round or clear history.' using errcode='23514';
end;
$$;

create function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'An application and current refinement revision are required.' using errcode='22023';
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
  update public.application_refinement_state set current_request_id=null,revision=revision+1
    where user_id=actor and application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  -- Reviews without a request (including approval history) must also be removed.
  delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
  -- Request deletion cascades to its proposals. Restore the transaction-local
  -- scope on success; an exception rolls back both deletions and the setting.
  delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

-- Only this narrow authenticated endpoint can enter the private implementation.
-- The elevated role is necessary because ordinary table DELETE remains revoked.
create function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language sql security definer set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision);
$$;
alter function public.clear_refinement_history(uuid,integer) owner to postgres;
revoke all on function private.clear_refinement_history(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.clear_refinement_history(uuid,integer) to postgres;
revoke all on function public.clear_refinement_history(uuid,integer) from public,anon,service_role;
grant execute on function public.clear_refinement_history(uuid,integer) to authenticated;
revoke all on function public.refinement_guard_immutable() from public,anon,authenticated,service_role;

create or replace function private.save_refinement_proposal(request_id uuid,proposal_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.application_refinement_proposals; request public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if request_id is null or proposal_id is null then raise exception 'Request and proposal identifiers are required.' using errcode='22023'; end if;
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  -- Match request/review publication and history clearing. Check again after the
  -- lock so a proposal waiting for a completed clear cannot revive old history.
  perform pg_advisory_xact_lock(hashtextextended(request.user_id::text||request.application_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(proposal_id::text,0));
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  select * into result from public.application_refinement_proposals p where p.id=proposal_id;
  if found then
    if result.request_id=request_id and result.proposal_json=payload then return to_jsonb(result); end if;
    raise exception 'Proposal ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
    values(proposal_id,request.application_id,request.user_id,request_id,payload) returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

commit;
