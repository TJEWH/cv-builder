-- Additive upgrade for an existing workspace. Apply once as a migration.
begin;

-- Preserve independently populated research metadata and support fresh catalogues.
alter table public.opportunities
  add column if not exists supervisor_research_focus jsonb not null default '{}',
  add column if not exists supervisor_top_papers jsonb not null default '[]';

create table public.opportunity_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  state text not null default 'unreviewed'
    check (state in ('unreviewed', 'interested', 'not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);
create index opportunity_reviews_opportunity_idx on public.opportunity_reviews(opportunity_id);
create trigger opportunity_reviews_updated_at before update on public.opportunity_reviews
  for each row execute function public.job_workspace_touch_updated_at();
alter table public.opportunity_reviews enable row level security;
revoke all on public.opportunity_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.opportunity_reviews to authenticated, service_role;
create policy "Read own opportunity reviews" on public.opportunity_reviews for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Insert own opportunity reviews" on public.opportunity_reviews for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Update own opportunity reviews" on public.opportunity_reviews for update to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Delete own opportunity reviews" on public.opportunity_reviews for delete to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));

alter table public.applications
  alter column cv_variant_id drop not null,
  alter column contact_email drop not null,
  add column context_json jsonb,
  add column context_captured_at timestamptz;

-- Backfill research context only; retain all prior CV selections, emails, statuses,
-- notes, created_at and updated_at values. DDL locks keep the trigger change local
-- to this migration transaction, so concurrent client writes cannot slip past it.
alter table public.applications disable trigger applications_updated_at;
update public.applications as application
  set context_json = to_jsonb(opportunity), context_captured_at = now()
  from public.opportunities as opportunity
  where opportunity.id = application.opportunity_id;
alter table public.applications enable trigger applications_updated_at;

alter table public.applications
  alter column context_json set not null,
  alter column context_captured_at set not null,
  add constraint applications_context_object check (jsonb_typeof(context_json) = 'object');
comment on column public.applications.context_json is 'Immutable opportunity research captured by the server when this application is created, including requirements, documents, contacts and supervisor research.';
comment on column public.applications.context_captured_at is 'Server time when the opportunity context was captured; existing applications use their migration backfill time.';
comment on column public.applications.cv_variant_id is 'Optional privacy-filtered CV snapshot, assigned after the application is created.';
comment on column public.applications.contact_email is 'Optional employer email retained for legacy applications; all researched contacts are available in context_json.';

create function public.job_workspace_capture_application_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Ignore any client-supplied context: the catalogue is the authoritative source.
    select to_jsonb(opportunity) into new.context_json
      from public.opportunities as opportunity where opportunity.id = new.opportunity_id;
    if not found then
      raise exception 'The opportunity is not available to this user.' using errcode = '42501';
    end if;
    new.context_captured_at = now();
  elsif new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.context_json is distinct from old.context_json
     or new.context_captured_at is distinct from old.context_captured_at then
    raise exception 'Application identity and captured research are immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_capture_application_context() from public, anon, authenticated;
create trigger applications_capture_context before insert or update on public.applications
  for each row execute function public.job_workspace_capture_application_context();

-- Two-argument entry point for one-click creation. No CV or email is uploaded.
-- Keep the prior overload working for clients opened before this upgrade.
create function public.create_job_application(p_application_id uuid, p_opportunity_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before creating an application.' using errcode = '42501';
  end if;
  if p_application_id is null or p_opportunity_id is null then
    raise exception 'Application and opportunity IDs are required.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_opportunity_id::text, 0));
  select * into existing from public.applications where id = p_application_id and user_id = actor;
  if found then
    if existing.opportunity_id = p_opportunity_id then return existing.id; end if;
    raise exception 'Application ID already belongs to a different opportunity.' using errcode = '23505';
  end if;
  select * into existing from public.applications where opportunity_id = p_opportunity_id and user_id = actor;
  if found then return existing.id; end if;
  insert into public.applications(id, user_id, opportunity_id)
    values (p_application_id, actor, p_opportunity_id);
  return p_application_id;
end;
$$;
revoke all on function public.create_job_application(uuid, uuid) from public, anon;
grant execute on function public.create_job_application(uuid, uuid) to authenticated;

commit;
