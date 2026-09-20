-- Apply once to an existing workspace. Existing application ownership policies cover checklist data.
begin;
alter table public.applications add column completed_checklist_keys text[] not null default '{}'
  constraint applications_checklist_bounds check (
    coalesce(array_ndims(completed_checklist_keys), 1) = 1
    and cardinality(completed_checklist_keys) <= 500
    and array_position(completed_checklist_keys, null) is null
    and octet_length(completed_checklist_keys::text) <= 262144
  );
comment on column public.applications.completed_checklist_keys is
  'Private preparation progress keyed by requirement/document content, independent of captured research and CV snapshots.';

create function public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if p_item_key is null or char_length(p_item_key) not between 1 and 16000 or p_completed is null
    or not (p_item_key like 'requirements:%' or p_item_key like 'documents:%') then
    raise exception 'Invalid checklist item' using errcode = '22023';
  end if;
  -- Atomic per-item updates preserve checks made by another tab or device.
  update public.applications set completed_checklist_keys = case
    when not p_completed then array_remove(completed_checklist_keys, p_item_key)
    when p_item_key = any(completed_checklist_keys) then completed_checklist_keys
    else array_append(completed_checklist_keys, p_item_key) end
    where id = p_application_id and user_id = actor returning * into saved;
  if not found then raise exception 'Application unavailable' using errcode = '42501'; end if;
  return to_jsonb(saved);
end;
$$;

create function public.remove_job_application(p_application_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  removed_opportunity uuid;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  delete from public.applications where id = p_application_id and user_id = actor
    returning opportunity_id into removed_opportunity;
  -- Bring it back to the default opportunity review list, preserving other interest choices and receipts.
  update public.opportunity_reviews set state = 'unreviewed'
    where user_id = actor and opportunity_id = removed_opportunity and state = 'not_interested';
  -- A lost response can safely be retried. No data is returned about another user's application.
  return p_application_id;
end;
$$;

revoke all on function public.set_job_application_checklist_item(uuid, text, boolean) from public, anon;
revoke all on function public.remove_job_application(uuid) from public, anon;
grant execute on function public.set_job_application_checklist_item(uuid, text, boolean) to authenticated;
grant execute on function public.remove_job_application(uuid) to authenticated;
commit;
