-- Tracking is a navigation tab, not an automatic Ready status assignment.
-- Existing application rows and their history are deliberately left untouched.
begin;

create or replace function public.job_workspace_track_stage()
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
  elsif new.workflow_stage <> 'tracking' then
    -- Tracking only displays and edits history; opening it never selects Ready.
    new.status := case new.workflow_stage
      when 'preparation' then 'preparation' when 'refinement' then 'refinement'
      when 'review' then 'attachments' end;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_track_stage() from public, anon, authenticated, service_role;

comment on column public.applications.workflow_stage is 'Last active application tab. Before explicit tracking, Preparation, Refinement and Attachments set their matching status; Tracking preserves the current status.';

commit;
