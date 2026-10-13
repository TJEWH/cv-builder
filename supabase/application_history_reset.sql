-- Additive upgrade for existing workspaces. No application rows change until
-- their owner explicitly calls reset_job_application_history.
begin;

create or replace function public.job_workspace_record_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(jsonb_build_object('status', new.status, 'changedAt', clock_timestamp()));
  elsif current_user = 'postgres' and auth.uid() = old.user_id
    and current_setting('cv_builder.resetting_application_history', true) = old.user_id::text || ':' || old.id::text
    and to_jsonb(new) - 'status_history' = to_jsonb(old) - 'status_history' then
    -- Only the owner-checked private reset helper can remove earlier entries.
    return new;
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

-- Reset only the status timeline; retain the current state and its recorded time.
create function private.reset_job_application_history(p_application_id uuid)
returns public.applications language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); saved public.applications; latest jsonb; retained jsonb;
  previous_scope text := current_setting('cv_builder.resetting_application_history', true);
begin
  if current_user <> 'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before resetting application history.' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'An application is required.' using errcode = '22023';
  end if;
  -- Serialize with status/stage writes, so a concurrent transition is not lost.
  select * into saved from public.applications where id = p_application_id and user_id = actor for update;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  latest := saved.status_history -> -1;
  retained := jsonb_build_object('status', saved.status, 'changedAt', null);
  if jsonb_typeof(latest) = 'object' and latest->>'status' = saved.status then
    if latest->'changedAt' = 'null'::jsonb then
      retained := jsonb_build_object('status', saved.status, 'changedAt', null);
    elsif jsonb_typeof(latest->'changedAt') = 'string' then
      begin
        if isfinite((latest->>'changedAt')::timestamptz) then
          retained := jsonb_build_object('status', saved.status, 'changedAt', latest->'changedAt');
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        -- Legacy malformed/unknown times must not become a new transition date.
        null;
      end;
    end if;
  end if;
  retained := jsonb_build_array(retained);
  if saved.status_history = retained then return saved; end if;
  perform set_config('cv_builder.resetting_application_history', actor::text || ':' || p_application_id::text, true);
  update public.applications set status_history = retained
    where id = p_application_id and user_id = actor returning * into saved;
  -- Exceptions roll back both the update and the transaction-local scope.
  perform set_config('cv_builder.resetting_application_history', coalesce(previous_scope, ''), true);
  return saved;
end;
$$;

create function public.reset_job_application_history(p_application_id uuid)
returns public.applications language sql security invoker set search_path = '' as $$
  select private.reset_job_application_history(p_application_id);
$$;
alter function private.reset_job_application_history(uuid) owner to postgres;
alter function public.reset_job_application_history(uuid) owner to postgres;
revoke all on function private.reset_job_application_history(uuid) from public, anon, authenticated, service_role;
grant execute on function private.reset_job_application_history(uuid) to authenticated, postgres;
revoke all on function public.reset_job_application_history(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_job_application_history(uuid) to authenticated;


commit;
