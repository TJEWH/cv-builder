-- Persist the open application stage and stop deriving status after explicit tracking.
begin;

alter table public.applications
  add column workflow_stage text not null default 'preparation'
    check (workflow_stage in ('preparation','refinement','review','tracking')),
  add column tracking_started boolean not null default false;

alter table public.applications drop constraint applications_status_check;
alter table public.applications alter column status set default 'preparation';
alter table public.applications add constraint applications_status_check
  check (status in ('preparation','refinement','attachments','ready','contacted','submitted','interview','offer','rejected','withdrawn')) not valid;

-- Existing Shortlist means Ready. Preserve historical times and unrelated row
-- timestamps; any existing explicit tracking state stays locked.
alter table public.applications disable trigger applications_updated_at;
alter table public.applications disable trigger applications_status_history;
update public.applications a set
  workflow_stage = 'tracking',
  tracking_started = status <> 'shortlist',
  status = case when status = 'shortlist' then 'ready' else status end,
  status_history = (
    select coalesce(jsonb_agg(case when entry->>'status' = 'shortlist' then jsonb_set(entry, '{status}', '"ready"') else entry end order by position),
      jsonb_build_array(jsonb_build_object('status', case when a.status = 'shortlist' then 'ready' else a.status end, 'changedAt', null)))
    from jsonb_array_elements(a.status_history) with ordinality as history(entry, position)
  );
alter table public.applications enable trigger applications_status_history;
alter table public.applications enable trigger applications_updated_at;
alter table public.applications validate constraint applications_status_check;

create function public.job_workspace_track_stage()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Older clients can still submit the former Ready name.
    if new.status = 'shortlist' then new.status := 'ready'; new.workflow_stage := 'tracking'; end if;
    new.tracking_started := new.tracking_started or new.status in ('contacted','submitted','interview','offer','rejected','withdrawn');
  else
    -- Explicit status writes lock tracking; clients cannot later clear the lock.
    new.tracking_started := old.tracking_started or new.tracking_started or new.status is distinct from old.status;
  end if;
  if new.tracking_started then
    if new.status not in ('ready','contacted','submitted','interview','offer','rejected','withdrawn') then
      raise exception 'Select a valid tracking status.' using errcode = '23514';
    end if;
  else
    new.status := case new.workflow_stage
      when 'preparation' then 'preparation' when 'refinement' then 'refinement'
      when 'review' then 'attachments' when 'tracking' then 'ready' end;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_track_stage() from public, anon, authenticated, service_role;
-- Runs before applications_status_history so history records the final status.
create trigger applications_stage_state before insert or update on public.applications
  for each row execute function public.job_workspace_track_stage();

create function public.set_job_application_stage(p_application_id uuid, p_stage text)
returns public.applications language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); saved public.applications;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before changing an application stage.' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('preparation','refinement','review','tracking') then
    raise exception 'Select a valid application stage.' using errcode = '22023';
  end if;
  -- One UPDATE takes the row lock. A concurrent explicit status save wins in
  -- either order because the trigger reads the current row's sticky lock.
  update public.applications set workflow_stage = p_stage
    where id = p_application_id and user_id = actor returning * into saved;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  return saved;
end;
$$;
revoke all on function public.set_job_application_stage(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_job_application_stage(uuid, text) to authenticated;

comment on column public.applications.workflow_stage is 'Last active application tab. Before explicit tracking, its mapped state is preparation, refinement, attachments or ready.';
comment on column public.applications.tracking_started is 'Sticky after the first explicit Tracking status choice, including Ready. Stage changes continue to save but no longer change status.';
create or replace function public.assign_job_application_cv(
  p_application_id uuid, p_cv_variant_id uuid, p_cv_name text,
  p_content_json jsonb, p_config_json jsonb, p_cv_version integer default 7,
  p_changes jsonb default '{}'
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before assigning a CV.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or (p_changes - array['contact_email','status','notes','contacted_at','submitted_at']) <> '{}'::jsonb
     or exists (select 1 from jsonb_each(p_changes) as field
       where jsonb_typeof(field.value) not in ('string', 'null')) then
    raise exception 'Invalid application changes.' using errcode = '22023';
  end if;
  select * into existing from public.applications where id = p_application_id and user_id = actor for update;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  if existing.cv_variant_id = p_cv_variant_id then
    if not exists (select 1 from public.cv_variants where id = p_cv_variant_id and user_id = actor
      and name = p_cv_name and content_json = p_content_json and config_json = p_config_json and cv_version = p_cv_version)
    then raise exception 'CV snapshot ID already exists with different data.' using errcode = '23505';
    end if;
  else
    insert into public.cv_variants(id, user_id, name, content_json, config_json, cv_version, is_base_variant)
      values (p_cv_variant_id, actor, p_cv_name, p_content_json, p_config_json, p_cv_version, false);
  end if;
  -- Updating metadata also on an identical retry ensures the entire save is applied.
  update public.applications set
    cv_variant_id = p_cv_variant_id,
    contact_email = case when p_changes ? 'contact_email' then p_changes ->> 'contact_email' else contact_email end,
    status = case when p_changes ? 'status' then p_changes ->> 'status' else status end,
    tracking_started = tracking_started or p_changes ? 'status',
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end,
    contacted_at = case when p_changes ? 'contacted_at' then (p_changes ->> 'contacted_at')::timestamptz else contacted_at end,
    submitted_at = case when p_changes ? 'submitted_at' then (p_changes ->> 'submitted_at')::timestamptz else submitted_at end
  where id = p_application_id and user_id = actor;
  return p_cv_variant_id;
end;
$$;

commit;
