-- Record status transitions on the existing owner-protected application row.
begin;

alter table public.applications add column status_history jsonb not null default '[]'::jsonb;

-- Old transition times were not recorded. Do not invent them from updated_at,
-- contacted_at or submitted_at, and do not change existing application timestamps.
alter table public.applications disable trigger applications_updated_at;
update public.applications
set status_history = jsonb_build_array(jsonb_build_object('status', status, 'changedAt', null));
alter table public.applications enable trigger applications_updated_at;
alter table public.applications add constraint applications_status_history_array
  check (jsonb_typeof(status_history) = 'array' and jsonb_array_length(status_history) > 0);

create function public.job_workspace_record_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(jsonb_build_object('status', new.status, 'changedAt', clock_timestamp()));
  else
    -- Clients may update the status, but cannot forge, remove or replace history.
    new.status_history := old.status_history;
    if new.status is distinct from old.status then
      new.status_history := old.status_history || jsonb_build_array(jsonb_build_object('status', new.status, 'changedAt', clock_timestamp()));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_record_status() from public, anon, authenticated;
create trigger applications_status_history before insert or update on public.applications
  for each row execute function public.job_workspace_record_status();
comment on column public.applications.status_history is 'Server-maintained ordered status transitions. A null changedAt marks an existing status whose transition time was never recorded. Owner RLS is inherited from applications.';

commit;
