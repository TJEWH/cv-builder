-- Deploy before the self-contained, two-call refinement client. No history is rewritten.
create function private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text)
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
revoke all on function private.read_current_refinement_request(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.read_current_refinement_request(uuid,uuid,text) to postgres;
comment on function private.read_current_refinement_request(uuid,uuid,text) is
  'Read-only exact current document snapshot, including the unchanged request and captured CV/opportunity context. Management connection only.';
notify pgrst, 'reload schema';
