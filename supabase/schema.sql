-- Apply as one migration to the configured Supabase project.
-- Existing opportunities are a shared, authenticated, read-only research catalogue.
-- This additive setup preserves its rows, metadata and opportunity_history.
begin;

-- On a fresh project this creates the same catalogue shape used by the app.
-- On an existing project no columns or research records are replaced.
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_key text not null unique,
  record_type text not null default 'opportunity',
  title text not null,
  institution text,
  unit text,
  city text,
  country text,
  position_type text,
  availability text,
  deadline date,
  official_url text,
  source_url text,
  cv_track text,
  verification_level text not null default 'historical_context',
  data jsonb not null default '{}',
  source_context text,
  vacancy_id text,
  topics text[] not null default '{}',
  supervisors jsonb not null default '[]',
  supervisor_reputation jsonb not null default '{}',
  contacts jsonb not null default '[]',
  duration_months integer check (duration_months > 0),
  duration_details text,
  salary jsonb not null default '{}',
  research_career_potential jsonb not null default '{}',
  rd_career_potential jsonb not null default '{}',
  hardware_software_balance jsonb not null default '{}',
  personal_fit jsonb not null default '{}',
  special_features text[] not null default '{}',
  requirements jsonb not null default '[]',
  required_documents jsonb not null default '[]',
  particularly_suitable boolean,
  particularly_suitable_reason text,
  deadline_time_local time,
  deadline_timezone text,
  deadline_original_text text,
  application_url text,
  start_date date,
  historical_match_status text not null default 'unresolved'
    check (historical_match_status in ('matched', 'probable', 'unresolved')),
  last_checked_at timestamptz,
  sources jsonb not null default '[]',
  open_questions text[] not null default '{}',
  metadata_schema_version integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cv_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  research_track text,
  is_base_variant boolean not null default false,
  content_json jsonb not null,
  config_json jsonb not null,
  cv_version integer not null default 7 check (cv_version > 0),
  revision integer not null default 1 check (revision > 0),
  parent_variant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, name),
  foreign key (user_id, parent_variant_id)
    references public.cv_variants(user_id, id) on delete no action deferrable initially deferred,
  constraint cv_variants_json_objects check (
    jsonb_typeof(content_json) = 'object' and jsonb_typeof(config_json) = 'object'
    and octet_length(content_json::text) <= 5242880
    and octet_length(config_json::text) <= 5242880
  ),
  -- Defense in depth: only allow the builder's fixed sample contact or blanks.
  -- The client must still remove private sections/items and redact free text.
  constraint cv_variants_anonymous_contact check (coalesce(
    jsonb_typeof(content_json -> 'contact') = 'object'
    and ((content_json -> 'contact') - array['name','location','role','email','phone','website','linkedin','github']) = '{}'::jsonb
    and content_json #>> '{contact,name}' in ('', 'Alex Muster')
    and content_json #>> '{contact,location}' in ('', 'Neustadt')
    and content_json #>> '{contact,role}' in ('', 'Software Engineer')
    and content_json #>> '{contact,email}' in ('', 'muster-ex@mp.le')
    and content_json #>> '{contact,phone}' in ('', '+49 123 456789')
    and content_json #>> '{contact,website}' in ('', 'https://alexmuster.dev')
    and content_json #>> '{contact,linkedin}' in ('', 'https://link.com/in/alexmuster')
    and content_json #>> '{contact,github}' in ('', 'https://git.com/musterlex'), false
  )),
  constraint cv_variants_known_json_fields check (
    (content_json - array['contact','about','education','experience','languages','hobbies','customSections','sidebarSections','sectionNames']) = '{}'::jsonb
    and (config_json - array['lang','design','disabled','completedSections','keepTogetherSections','anonymization','sectionHeaderSizes','bodyOrder','sidebarOrder','hiddenItems']) = '{}'::jsonb
  )
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  cv_variant_id uuid not null,
  contact_email text not null check (
    char_length(contact_email) between 3 and 254
    and contact_email = btrim(contact_email)
    and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  status text not null default 'shortlist'
    check (status in ('shortlist','contacted','submitted','interview','offer','rejected','withdrawn')),
  notes text,
  contacted_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, opportunity_id),
  -- NO ACTION deferred keeps snapshots required while allowing account cascades.
  foreign key (user_id, cv_variant_id)
    references public.cv_variants(user_id, id) on delete no action deferrable initially deferred
);

comment on column public.applications.contact_email is 'Employer contact email for follow-up; not the applicant email.';
comment on table public.cv_variants is 'Private, immutable privacy-filtered CV snapshots. Complete CVs stay in local browser storage.';

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  draft_type text not null check (draft_type in ('motivation_letter','cv_suggestions','contact_email')),
  content text,
  structured_content jsonb check (structured_content is null or jsonb_typeof(structured_content) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, application_id)
    references public.applications(user_id, id) on delete cascade
);

-- Leading user_id serves ownership policies and each tenant-scoped foreign key.
create index cv_variants_parent_idx on public.cv_variants(user_id, parent_variant_id);
create index cv_variants_recent_idx on public.cv_variants(user_id, created_at desc);
create index applications_opportunity_idx on public.applications(opportunity_id);
create index applications_cv_variant_idx on public.applications(user_id, cv_variant_id);
create index applications_recent_idx on public.applications(user_id, updated_at desc);
create index drafts_application_idx on public.drafts(user_id, application_id);

create function public.job_workspace_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.job_workspace_touch_updated_at() from public, anon, authenticated;

create function public.job_workspace_guard_cv_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.content_json is distinct from old.content_json
     or new.config_json is distinct from old.config_json
     or new.cv_version is distinct from old.cv_version
     or new.revision is distinct from old.revision then
    raise exception 'Saved CV snapshots are immutable; create a new snapshot.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_guard_cv_snapshot() from public, anon, authenticated;

create trigger cv_variants_preserve_snapshot before update on public.cv_variants
  for each row execute function public.job_workspace_guard_cv_snapshot();
create trigger cv_variants_updated_at before update on public.cv_variants
  for each row execute function public.job_workspace_touch_updated_at();
create trigger applications_updated_at before update on public.applications
  for each row execute function public.job_workspace_touch_updated_at();
create trigger drafts_updated_at before update on public.drafts
  for each row execute function public.job_workspace_touch_updated_at();

alter table public.opportunities enable row level security;
alter table public.cv_variants enable row level security;
alter table public.applications enable row level security;
alter table public.drafts enable row level security;

revoke all on public.opportunities, public.cv_variants, public.applications, public.drafts from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.opportunities to authenticated;
grant select, insert, update, delete on public.cv_variants, public.applications, public.drafts to authenticated;
grant select, insert, update, delete on public.opportunities, public.cv_variants, public.applications, public.drafts to service_role;

-- Existing research history is backend-only. RLS does not replace least-privilege
-- grants (for example, TRUNCATE is not subject to row policies).
do $$
declare history_sequence text;
begin
  if to_regclass('public.opportunity_history') is not null then
    alter table public.opportunity_history enable row level security;
    revoke all on public.opportunity_history from public, anon, authenticated;
    history_sequence := pg_get_serial_sequence('public.opportunity_history', 'id');
    if history_sequence is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', history_sequence::regclass);
    end if;
  end if;
end;
$$;

create policy "Signed-in users can review the shared catalogue" on public.opportunities
  for select to authenticated
  using ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

create policy "Read own CV snapshots" on public.cv_variants for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own CV snapshots" on public.cv_variants for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own CV metadata" on public.cv_variants for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own unused CV snapshots" on public.cv_variants for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Read own applications" on public.applications for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own applications" on public.applications for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own applications" on public.applications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own applications" on public.applications for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Read own drafts" on public.drafts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own drafts" on public.drafts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own drafts" on public.drafts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own drafts" on public.drafts for delete to authenticated using ((select auth.uid()) = user_id);

-- SECURITY INVOKER preserves all ownership policies and grants in these atomic RPCs.
-- Client-generated IDs make identical retries safe after an ambiguous network error.
create function public.create_job_application(
  p_application_id uuid, p_opportunity_id uuid, p_cv_variant_id uuid,
  p_contact_email text, p_cv_name text, p_content_json jsonb, p_config_json jsonb,
  p_cv_version integer default 7
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before creating an application.' using errcode = '42501';
  end if;
  -- Serializes only calls for this user's chosen application ID.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_application_id::text, 0));
  select * into existing from public.applications where id = p_application_id and user_id = actor;
  if found then
    if existing.opportunity_id = p_opportunity_id and existing.cv_variant_id = p_cv_variant_id
       and existing.contact_email = p_contact_email and exists (
         select 1 from public.cv_variants where id = p_cv_variant_id and user_id = actor
           and name = p_cv_name and content_json = p_content_json and config_json = p_config_json and cv_version = p_cv_version
       ) then return existing.id;
    end if;
    raise exception 'Application ID already exists with different data.' using errcode = '23505';
  end if;
  insert into public.cv_variants(id, user_id, name, content_json, config_json, cv_version, is_base_variant)
    values (p_cv_variant_id, actor, p_cv_name, p_content_json, p_config_json, p_cv_version, false);
  insert into public.applications(id, user_id, opportunity_id, cv_variant_id, contact_email)
    values (p_application_id, actor, p_opportunity_id, p_cv_variant_id, p_contact_email);
  return p_application_id;
end;
$$;

create function public.assign_job_application_cv(
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
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end,
    contacted_at = case when p_changes ? 'contacted_at' then (p_changes ->> 'contacted_at')::timestamptz else contacted_at end,
    submitted_at = case when p_changes ? 'submitted_at' then (p_changes ->> 'submitted_at')::timestamptz else submitted_at end
  where id = p_application_id and user_id = actor;
  return p_cv_variant_id;
end;
$$;

revoke all on function public.create_job_application(uuid, uuid, uuid, text, text, jsonb, jsonb, integer) from public, anon;
revoke all on function public.assign_job_application_cv(uuid, uuid, text, jsonb, jsonb, integer, jsonb) from public, anon;
grant execute on function public.create_job_application(uuid, uuid, uuid, text, text, jsonb, jsonb, integer) to authenticated;
grant execute on function public.assign_job_application_cv(uuid, uuid, text, jsonb, jsonb, integer, jsonb) to authenticated;

-- Review workflow and captured application research.
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

-- Explicit authoritative research refresh.
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

-- Private source-version review receipts.
alter table public.opportunity_reviews add column reviewed_updated_at timestamptz;
comment on column public.opportunity_reviews.reviewed_updated_at is
  'Opportunity source version last reviewed by this user; independent of their interest state.';

create or replace function public.review_job_opportunity(
  p_opportunity_id uuid,
  p_observed_updated_at timestamptz,
  p_state text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  source_version timestamptz;
  receipt timestamptz;
  saved public.opportunity_reviews;
begin
  if account is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('unreviewed', 'interested', 'not_interested') then
    raise exception 'Invalid opportunity review state' using errcode = '22023';
  end if;
  select coalesce(updated_at, created_at) into source_version
    from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity unavailable' using errcode = '42501';
  end if;
  -- An old browser view must not acknowledge research that changed before this request.
  if p_observed_updated_at = source_version then receipt := source_version; end if;
  insert into public.opportunity_reviews as existing (user_id, opportunity_id, state, reviewed_updated_at)
    values (account, p_opportunity_id, coalesce(p_state, 'unreviewed'), receipt)
    on conflict (user_id, opportunity_id) do update
      set state = coalesce(p_state, existing.state),
          reviewed_updated_at = greatest(existing.reviewed_updated_at, excluded.reviewed_updated_at)
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.review_job_opportunity(uuid, timestamptz, text) from public, anon;
grant execute on function public.review_job_opportunity(uuid, timestamptz, text) to authenticated;

-- Apply once to an existing workspace. Existing application ownership policies cover checklist data.
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
