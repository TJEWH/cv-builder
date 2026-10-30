-- Removing an application does not change the owner's opportunity evaluation.
begin;

create or replace function public.remove_job_application(p_application_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  delete from public.applications where id = p_application_id and user_id = actor;
  -- A lost response can safely be retried. No data is returned about another user's application.
  return p_application_id;
end;
$$;

revoke all on function public.remove_job_application(uuid) from public, anon;
grant execute on function public.remove_job_application(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
