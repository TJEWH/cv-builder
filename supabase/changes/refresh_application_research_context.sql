-- Allow an explicit, owner-authorized refresh without accepting client research.
begin;

create or replace function public.job_workspace_capture_application_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  capture_requested boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
       or new.opportunity_id is distinct from old.opportunity_id then
      raise exception 'Application identity is immutable.' using errcode = '23514';
    end if;
    capture_requested := new.context_json is distinct from old.context_json
      or new.context_captured_at is distinct from old.context_captured_at;
  end if;
  if capture_requested then
    -- Treat any requested context change as a refresh from the source. Neither
    -- RPC nor direct REST clients can inject arbitrary research or capture dates.
    select to_jsonb(opportunity) into new.context_json
      from public.opportunities as opportunity where opportunity.id = new.opportunity_id;
    if not found then
      raise exception 'The opportunity is not available to this user.' using errcode = '42501';
    end if;
    new.context_captured_at = now();
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_capture_application_context() from public, anon, authenticated;

create function public.refresh_job_application_context(p_application_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  refreshed_id uuid;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before refreshing application research.' using errcode = '42501';
  end if;
  -- BEFORE UPDATE replaces this sentinel with authoritative source data before
  -- the NOT NULL constraint is checked. Other application fields are unchanged.
  update public.applications set context_json = null
    where id = p_application_id and user_id = actor
    returning id into refreshed_id;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  return refreshed_id;
end;
$$;
revoke all on function public.refresh_job_application_context(uuid) from public, anon;
grant execute on function public.refresh_job_application_context(uuid) to authenticated;
comment on column public.applications.context_json is 'Opportunity research captured by the server on create or explicit refresh; client-supplied research is always replaced with the authoritative same opportunity.';
comment on column public.applications.context_captured_at is 'Server time of the latest explicit research capture; normal application edits leave it unchanged.';

commit;
