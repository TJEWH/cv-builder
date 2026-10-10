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
    check (state in ('unreviewed', 'interested', 'strong_interest', 'not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);
comment on column public.opportunity_reviews.state is
  'Private explicit user preference. strong_interest can seed new searches across prior searches, fit scores and deadlines.';
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
  if p_state is not null and p_state not in ('unreviewed', 'interested', 'strong_interest', 'not_interested') then
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

-- Immutable application letter drafting contexts and returned draft history.


create table public.drafting_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  cv_variant_id uuid not null,
  context_json jsonb not null check (jsonb_typeof(context_json) = 'object' and octet_length(context_json::text) <= 10485760),
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id) references public.applications(user_id, id) on delete cascade,
  foreign key (user_id, cv_variant_id) references public.cv_variants(user_id, id) on delete no action deferrable initially deferred
);

create table public.motivation_letter_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  context_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 100000),
  created_at timestamptz not null default now(),
  foreign key (user_id, application_id, context_id)
    references public.drafting_contexts(user_id, application_id, id) on delete cascade
);

comment on table public.drafting_contexts is 'Immutable owner-only drafting bundles. Opportunity and assigned privacy CV are captured by the server; applicant identity uses explicit placeholders.';
comment on table public.motivation_letter_drafts is 'Append-only draft source text tied to its exact context. Local edited/final letters are never overwritten by generated drafts.';

create index drafting_contexts_recent_idx on public.drafting_contexts(user_id, application_id, created_at desc);
create index drafting_contexts_cv_idx on public.drafting_contexts(user_id, cv_variant_id);
create index motivation_letter_drafts_context_idx on public.motivation_letter_drafts(user_id, application_id, context_id);
create index motivation_letter_drafts_recent_idx on public.motivation_letter_drafts(user_id, application_id, created_at desc);

alter table public.drafting_contexts enable row level security;
alter table public.motivation_letter_drafts enable row level security;
revoke all on public.drafting_contexts, public.motivation_letter_drafts from public, anon, authenticated;
grant select, insert on public.drafting_contexts, public.motivation_letter_drafts to authenticated;
grant select, insert, update, delete on public.drafting_contexts, public.motivation_letter_drafts to service_role;

create policy "Read own prepared contexts" on public.drafting_contexts for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Insert own prepared contexts" on public.drafting_contexts for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Read own returned letter drafts" on public.motivation_letter_drafts for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Insert own returned letter drafts" on public.motivation_letter_drafts for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));

-- Defense in depth for inline confidentiality markers and the previous fictional
-- sample identity. Free prose still requires the browser privacy projection.
create function public.job_drafting_redact_samples(value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare result jsonb; item record; plain text;
begin
  case jsonb_typeof(value)
    when 'object' then
      result := '{}';
      for item in select key, val from jsonb_each(value) as e(key, val) loop
        result := result || jsonb_build_object(item.key, public.job_drafting_redact_samples(item.val));
      end loop;
    when 'array' then
      select coalesce(jsonb_agg(public.job_drafting_redact_samples(e.val) order by e.ordinality), '[]'::jsonb)
        into result from jsonb_array_elements(value) with ordinality as e(val, ordinality);
    when 'string' then
      plain := value #>> '{}';
      -- Remove the whole Markdown link if either label or destination is confidential.
      plain := regexp_replace(plain, '\[[^]]*!![^]]*\]\([^)]*\)|\[[^]]*\]\([^)]*!![^)]*\)', '{{CONFIDENTIAL}}', 'g');
      plain := regexp_replace(plain, '!!.*?!!', '{{CONFIDENTIAL}}', 'g');
      for item in select * from (values
        ('https://link[.]com/in/alexmuster', '{{APPLICANT_LINKEDIN}}'),
        ('https://git[.]com/musterlex', '{{APPLICANT_GITHUB}}'),
        ('https://alexmuster[.]dev', '{{APPLICANT_WEBSITE}}'),
        ('muster-ex@mp[.]le', '{{APPLICANT_EMAIL}}'),
        ('[+]49 123 456789', '{{APPLICANT_PHONE}}'),
        ('Alex Muster', '{{APPLICANT_NAME}}')
      ) as replacements(pattern, placeholder) loop
        plain := regexp_replace(plain, item.pattern, item.placeholder, 'gi');
      end loop;
      result := to_jsonb(plain);
    else result := value;
  end case;
  return result;
end;
$$;
revoke all on function public.job_drafting_redact_samples(jsonb) from public, anon;
grant execute on function public.job_drafting_redact_samples(jsonb) to authenticated;

create function public.job_drafting_capture_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid(); app public.applications; cv public.cv_variants;
  template jsonb := new.context_json->'template';
  language_value text := new.context_json->>'language'; instructions_value text := new.context_json->>'instructions';
  max_words integer; content jsonb; placeholders jsonb; theme jsonb := '{}'; item record;
begin
  if actor is null or actor <> new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A signed-in owner is required.' using errcode = '42501';
  end if;
  if template is null or jsonb_typeof(template) <> 'object'
     or template - array['id','name','revision','structure','tone'] <> '{}'::jsonb
     or not (template ?& array['id','name','revision','structure','tone'])
     or jsonb_typeof(template->'revision') <> 'number'
     or coalesce(template->>'revision', '') !~ '^[1-9][0-9]{0,8}$'
     or exists (select 1 from jsonb_each(template - 'revision') as e where jsonb_typeof(e.value) <> 'string')
     or char_length(btrim(template->>'id')) not between 1 and 200
     or char_length(btrim(template->>'name')) not between 1 and 200
     or char_length(btrim(template->>'structure')) not between 1 and 20000
     or char_length(btrim(template->>'tone')) not between 1 and 1000
     or language_value is null or char_length(btrim(language_value)) not between 2 and 20
     or instructions_value is null or char_length(instructions_value) > 20000
     or jsonb_typeof(new.context_json->'language') <> 'string'
     or jsonb_typeof(new.context_json->'instructions') <> 'string'
     or coalesce(new.context_json->>'maxWords', '') !~ '^[0-9]{2,4}$' then
    raise exception 'Invalid drafting template or instructions.' using errcode = '22023';
  end if;
  max_words := (new.context_json->>'maxWords')::integer;
  if max_words not between 50 and 5000 then raise exception 'Word limit must be between 50 and 5000.' using errcode = '22023'; end if;
  select * into app from public.applications where id = new.application_id and user_id = actor for share;
  if not found then raise exception 'Application unavailable.' using errcode = '42501'; end if;
  if app.cv_variant_id is null then raise exception 'Assign an anonymized CV before publishing drafting context.' using errcode = '22023'; end if;
  select * into cv from public.cv_variants where id = app.cv_variant_id and user_id = actor;
  if not found then raise exception 'Assigned CV unavailable.' using errcode = '42501'; end if;
  placeholders := '{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}'::jsonb;
  content := public.job_drafting_redact_samples(cv.content_json) || jsonb_build_object('contact', placeholders);
  -- Styling is selected from the assigned privacy CV; custom font metadata and arbitrary strings cannot enter context.
  for item in select key, value from jsonb_each(coalesce(cv.config_json->'design', '{}'::jsonb)) loop
    if item.key in ('fontBody','fontHead') and item.value #>> '{}' = any(array['','Inter','Source Sans 3','IBM Plex Sans','Noto Sans','Work Sans','Nunito Sans','Rubik','Merriweather Sans','Hind','Browallia New','Century Gothic','Montserrat','Poppins','Raleway','Space Grotesk'])
      or item.key = 'ink' and item.value #>> '{}' ~ '^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$'
      or item.key in ('h1','h2','h3','pageMarginTop','pageMarginRight','pageMarginBottom','pageMarginLeft','headerPaddingBottom','headerBottomMargin','bodySidebarSpacing','sectionSpacingBody','itemSpacing')
        and item.value #>> '{}' ~ '^([0-9]{1,3}([.][0-9]{1,3})?)(mm|px|pt|fr)$'
      or item.key in ('contactLayout') and item.value #>> '{}' = any(array['side','below','sidebar','footer'])
      or item.key in ('headerLayoutStyle') and item.value #>> '{}' = any(array['boxed','separator']) then
      theme := theme || jsonb_build_object(item.key, item.value);
    end if;
  end loop;
  new.cv_variant_id := cv.id;
  new.created_at := now();
  new.context_json := jsonb_build_object(
    'schemaVersion', 1, 'opportunity', app.context_json, 'opportunityCapturedAt', app.context_captured_at,
    'cv', jsonb_build_object('snapshotId', cv.id, 'revision', cv.revision, 'content', content, 'theme', theme),
    'template', public.job_drafting_redact_samples(template), 'language', btrim(language_value),
    'instructions', public.job_drafting_redact_samples(to_jsonb(btrim(instructions_value))),
    'maxWords', max_words, 'identityPlaceholders', placeholders
  );
  return new;
end;
$$;

create function public.job_drafting_guard_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Published context and returned drafts are immutable; create a new revision.' using errcode = '23514';
end;
$$;

create function public.job_drafting_capture_draft()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or new.user_id <> auth.uid() or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A signed-in owner is required.' using errcode = '42501';
  end if;
  new.body := public.job_drafting_redact_samples(to_jsonb(btrim(new.body))) #>> '{}';
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.job_drafting_capture_context(), public.job_drafting_guard_immutable(), public.job_drafting_capture_draft() from public, anon, authenticated;
create trigger drafting_contexts_capture before insert on public.drafting_contexts
  for each row execute function public.job_drafting_capture_context();
create trigger drafting_contexts_immutable before update on public.drafting_contexts
  for each row execute function public.job_drafting_guard_immutable();
create trigger motivation_letter_drafts_capture before insert on public.motivation_letter_drafts
  for each row execute function public.job_drafting_capture_draft();
create trigger motivation_letter_drafts_immutable before update on public.motivation_letter_drafts
  for each row execute function public.job_drafting_guard_immutable();

create function public.publish_application_drafting_context(
  p_context_id uuid, p_application_id uuid, p_template jsonb,
  p_language text, p_instructions text default '', p_max_words integer default 500
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.drafting_contexts; result public.drafting_contexts;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before publishing context.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_context_id::text, 0));
  select * into existing from public.drafting_contexts where id = p_context_id and user_id = actor;
  if found then
    if existing.application_id = p_application_id
      and existing.context_json->'template' = public.job_drafting_redact_samples(p_template)
      and existing.context_json->>'language' = btrim(p_language)
      and existing.context_json->'instructions' = public.job_drafting_redact_samples(to_jsonb(btrim(p_instructions)))
      and existing.context_json->>'maxWords' = p_max_words::text then return to_jsonb(existing); end if;
    raise exception 'Context ID already exists with different input.' using errcode = '23505';
  end if;
  insert into public.drafting_contexts(id, user_id, application_id, context_json)
    values (p_context_id, actor, p_application_id, jsonb_build_object('template', p_template, 'language', p_language, 'instructions', p_instructions, 'maxWords', p_max_words))
    returning * into result;
  return to_jsonb(result);
end;
$$;

-- Narrow read endpoint for a connected agent using the user's authenticated JWT.
create function public.read_application_drafting_context(p_context_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result public.drafting_contexts; actor uuid := auth.uid();
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before reading context.' using errcode = '42501'; end if;
  select * into result from public.drafting_contexts where id = p_context_id and user_id = actor;
  if not found then raise exception 'Drafting context unavailable.' using errcode = '42501'; end if;
  return to_jsonb(result);
end;
$$;

create function public.save_application_letter_draft(p_draft_id uuid, p_application_id uuid, p_context_id uuid, p_body text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.motivation_letter_drafts; result public.motivation_letter_drafts;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before returning a draft.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_draft_id::text, 0));
  select * into existing from public.motivation_letter_drafts where id = p_draft_id and user_id = actor;
  if found then
    if existing.application_id = p_application_id and existing.context_id = p_context_id
      and existing.body = public.job_drafting_redact_samples(to_jsonb(btrim(p_body))) #>> '{}' then return to_jsonb(existing); end if;
    raise exception 'Draft ID already exists with different input.' using errcode = '23505';
  end if;
  if not exists (select 1 from public.drafting_contexts where id = p_context_id and application_id = p_application_id and user_id = actor) then
    raise exception 'Drafting context unavailable for this application.' using errcode = '42501';
  end if;
  insert into public.motivation_letter_drafts(id, user_id, application_id, context_id, body)
    values (p_draft_id, actor, p_application_id, p_context_id, p_body) returning * into result;
  return to_jsonb(result);
end;
$$;

revoke all on function public.publish_application_drafting_context(uuid, uuid, jsonb, text, text, integer),
  public.read_application_drafting_context(uuid), public.save_application_letter_draft(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.publish_application_drafting_context(uuid, uuid, jsonb, text, text, integer),
  public.read_application_drafting_context(uuid), public.save_application_letter_draft(uuid, uuid, uuid, text) to authenticated;

-- Public wording CV adjustment requests and returned edits.
create table public.cv_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid,
  request_json jsonb not null check (jsonb_typeof(request_json) = 'object' and octet_length(request_json::text) <= 1048576),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, application_id) references public.applications(user_id, id) on delete cascade
);
create table public.cv_adjustment_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object' and octet_length(response_json::text) <= 1048576),
  created_at timestamptz not null default now(),
  foreign key (user_id, request_id) references public.cv_adjustment_requests(user_id, id) on delete cascade
);
comment on table public.cv_adjustment_requests is 'Immutable owner-only public wording snapshots. Full CVs, private tokens, local variant IDs, paths and reconstruction maps are never uploaded by the app.';
comment on table public.cv_adjustment_responses is 'Append-only public wording edits validated against the exact request. Reconstruction and adoption as a subvariant require local review.';
create index cv_adjustment_requests_recent_idx on public.cv_adjustment_requests(user_id, created_at desc);
create index cv_adjustment_requests_application_idx on public.cv_adjustment_requests(user_id, application_id, created_at desc);
create index cv_adjustment_responses_request_idx on public.cv_adjustment_responses(user_id, request_id, created_at desc);

alter table public.cv_adjustment_requests enable row level security;
alter table public.cv_adjustment_responses enable row level security;
revoke all on public.cv_adjustment_requests, public.cv_adjustment_responses from public, anon, authenticated;
grant select, insert on public.cv_adjustment_requests, public.cv_adjustment_responses to authenticated;
grant select, insert, update, delete on public.cv_adjustment_requests, public.cv_adjustment_responses to service_role;
create policy "Read own CV adjustment requests" on public.cv_adjustment_requests for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Insert own CV adjustment requests" on public.cv_adjustment_requests for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Read own CV adjustment responses" on public.cv_adjustment_responses for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy "Insert own CV adjustment responses" on public.cv_adjustment_responses for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));

create function public.cv_adjustment_validate_request(value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare field jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','fields','opportunity','instructions'] <> '{}'::jsonb
    or not (value ?& array['schemaVersion','requestId','fields','opportunity','instructions'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'fields') is distinct from 'array'
    or jsonb_typeof(value->'opportunity') is distinct from 'object'
    or jsonb_typeof(value->'instructions') is distinct from 'string'
    or char_length(value->>'instructions') > 20000
    or translate(value->>'instructions', E'\t\n\r', '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid CV adjustment request.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'fields') > 1000 then raise exception 'Too many CV adjustment fields.' using errcode = '22023'; end if;
  for field in select jsonb_array_elements(value->'fields') loop
    if jsonb_typeof(field) is distinct from 'object' or field - array['id','label','text'] <> '{}'::jsonb
      or not (field ?& array['id','label','text'])
      or jsonb_typeof(field->'id') is distinct from 'string' or field->>'id' !~ '^field-[1-9][0-9]*$' or field->>'id' = any(ids)
      or jsonb_typeof(field->'label') is distinct from 'string' or char_length(field->>'label') > 200
      or jsonb_typeof(field->'text') is distinct from 'string' or char_length(field->>'text') > 20000
      or translate((field->>'label') || (field->>'text'), E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment field.' using errcode = '22023';
    end if;
    ids := array_append(ids, field->>'id');
  end loop;
end;
$$;

create function public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare
  edit jsonb; original text; replacement text; ids text[] := '{}';
  original_tokens text[]; replacement_tokens text[]; original_links text[]; replacement_links text[];
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','edits'] <> '{}'::jsonb or not (value ?& array['schemaVersion','requestId','edits'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'edits') is distinct from 'array' then
    raise exception 'Invalid CV adjustment response.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'edits') > 1000 then raise exception 'Too many CV adjustment edits.' using errcode = '22023'; end if;
  for edit in select jsonb_array_elements(value->'edits') loop
    if jsonb_typeof(edit) is distinct from 'object' or edit - array['fieldId','text'] <> '{}'::jsonb
      or not (edit ?& array['fieldId','text'])
      or jsonb_typeof(edit->'fieldId') is distinct from 'string' or edit->>'fieldId' !~ '^field-[1-9][0-9]*$' or edit->>'fieldId' = any(ids)
      or jsonb_typeof(edit->'text') is distinct from 'string' or char_length(edit->>'text') > 20000
      or translate(edit->>'text', E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment edit.' using errcode = '22023';
    end if;
    ids := array_append(ids, edit->>'fieldId');
    select field->>'text' into original from jsonb_array_elements(request_value->'fields') as fields(field) where field->>'id' = edit->>'fieldId';
    if not found then raise exception 'The response edits an unavailable CV field.' using errcode = '22023'; end if;
    replacement := edit->>'text';
    if replacement = original then continue; end if;
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into original_tokens
      from regexp_matches(original, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into replacement_tokens
      from regexp_matches(replacement, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    if original_tokens <> replacement_tokens
      or regexp_replace(replacement, '\{\{PRIVATE_[1-9][0-9]*\}\}', '', 'g') ~ '\{\{|\}\}'
      or position('!!' in replacement) > 0 then
      raise exception 'Private placeholders must remain in their original field, order and count.' using errcode = '22023';
    end if;
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into original_links
      from regexp_matches(original, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into replacement_links
      from regexp_matches(replacement, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    if original_links <> replacement_links or replacement ~* '!\[|</?[a-z]|\]\([^)]*\{\{' then
      raise exception 'CV adjustments cannot add links, images or HTML.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create function public.cv_adjustment_capture_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A signed-in owner is required.' using errcode = '42501';
  end if;
  perform public.cv_adjustment_validate_request(new.request_json, new.id);
  if new.application_id is not null and not exists (select 1 from public.applications where user_id = new.user_id and id = new.application_id) then
    raise exception 'Application unavailable.' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create function public.cv_adjustment_capture_response()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare request_value jsonb;
begin
  if auth.uid() is null or auth.uid() <> new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A signed-in owner is required.' using errcode = '42501';
  end if;
  select request_json into request_value from public.cv_adjustment_requests where user_id = new.user_id and id = new.request_id;
  if not found then raise exception 'CV adjustment request unavailable.' using errcode = '42501'; end if;
  perform public.cv_adjustment_validate_response(new.response_json, request_value, new.request_id);
  new.created_at := now();
  return new;
end;
$$;
create function public.cv_adjustment_guard_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Published CV adjustment requests and responses are immutable; create a new request or response.' using errcode = '23514';
end;
$$;
revoke all on function public.cv_adjustment_validate_request(jsonb,uuid), public.cv_adjustment_validate_response(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.cv_adjustment_validate_request(jsonb,uuid), public.cv_adjustment_validate_response(jsonb,jsonb,uuid) to authenticated;
revoke all on function public.cv_adjustment_capture_request(), public.cv_adjustment_capture_response(), public.cv_adjustment_guard_immutable() from public, anon, authenticated;
create trigger cv_adjustment_requests_capture before insert on public.cv_adjustment_requests for each row execute function public.cv_adjustment_capture_request();
create trigger cv_adjustment_responses_capture before insert on public.cv_adjustment_responses for each row execute function public.cv_adjustment_capture_response();
create trigger cv_adjustment_requests_immutable before update on public.cv_adjustment_requests for each row execute function public.cv_adjustment_guard_immutable();
create trigger cv_adjustment_responses_immutable before update on public.cv_adjustment_responses for each row execute function public.cv_adjustment_guard_immutable();

create function public.publish_cv_adjustment_request(p_request_id uuid, p_application_id uuid, p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.cv_adjustment_requests; result public.cv_adjustment_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before publishing a CV adjustment request.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_request_id::text, 0));
  select * into existing from public.cv_adjustment_requests where user_id = actor and id = p_request_id;
  if found then
    if existing.application_id is not distinct from p_application_id and existing.request_json = p_request then return to_jsonb(existing); end if;
    raise exception 'Request ID already exists with different input.' using errcode = '23505';
  end if;
  insert into public.cv_adjustment_requests(id,user_id,application_id,request_json) values(p_request_id,actor,p_application_id,p_request) returning * into result;
  return to_jsonb(result);
end;
$$;
create function public.read_cv_adjustment_request(p_request_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result public.cv_adjustment_requests; actor uuid := auth.uid();
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before reading a CV adjustment request.' using errcode = '42501'; end if;
  select * into result from public.cv_adjustment_requests where user_id = actor and id = p_request_id;
  if not found then raise exception 'CV adjustment request unavailable.' using errcode = '42501'; end if;
  return to_jsonb(result);
end;
$$;
create function public.save_cv_adjustment_response(p_response_id uuid, p_request_id uuid, p_response jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.cv_adjustment_responses; result public.cv_adjustment_responses;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'Sign in before returning CV adjustments.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_response_id::text, 0));
  select * into existing from public.cv_adjustment_responses where user_id = actor and id = p_response_id;
  if found then
    if existing.request_id = p_request_id and existing.response_json = p_response then return to_jsonb(existing); end if;
    raise exception 'Response ID already exists with different input.' using errcode = '23505';
  end if;
  insert into public.cv_adjustment_responses(id,user_id,request_id,response_json) values(p_response_id,actor,p_request_id,p_response) returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.publish_cv_adjustment_request(uuid,uuid,jsonb), public.read_cv_adjustment_request(uuid), public.save_cv_adjustment_response(uuid,uuid,jsonb) from public, anon;
grant execute on function public.publish_cv_adjustment_request(uuid,uuid,jsonb), public.read_cv_adjustment_request(uuid), public.save_cv_adjustment_response(uuid,uuid,jsonb) to authenticated;

commit;

-- Unified application preparation and refinement.
-- Additive upgrade after cv_adjustments.sql. Existing snapshots and drafting APIs are unchanged.
begin;

create schema if not exists private;

create table public.application_refinement_state (
  application_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_json jsonb not null,
  approvals_json jsonb not null default '{"cv":null,"letter":null}',
  current_request_id uuid,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_requests (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_json jsonb not null,
  opportunity_snapshot jsonb not null,
  cv_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_proposals (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  proposal_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
create table public.application_refinement_reviews (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid,
  kind text not null check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade,
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
alter table public.application_refinement_state add constraint refinement_current_request_fk
  foreign key (user_id,application_id,current_request_id) references public.application_refinement_requests(user_id,application_id,id)
  on delete no action deferrable initially deferred;
create index refinement_state_owner_idx on public.application_refinement_state(user_id,application_id,current_request_id);
create index refinement_requests_recent_idx on public.application_refinement_requests(user_id,application_id,created_at,id);
create index refinement_proposals_request_idx on public.application_refinement_proposals(user_id,application_id,request_id,created_at,id);
create index refinement_reviews_request_idx on public.application_refinement_reviews(user_id,application_id,request_id);
create index refinement_reviews_recent_idx on public.application_refinement_reviews(user_id,application_id,created_at,id);

comment on table public.application_refinement_state is 'Frozen letter setup and approval revision hashes. Full CVs and reconstruction bindings stay local.';
comment on table public.application_refinement_requests is 'Immutable anonymized refinement context; server captures assigned public CV and application research. No application notes or supporting files.';
comment on table public.application_refinement_proposals is 'Append-only validated proposals, written only by the postgres management connection. Reading a proposal never applies it locally.';
comment on table public.application_refinement_reviews is 'Append-only owner feedback and approval history. Feedback must be anonymized before sending.';

alter table public.application_refinement_state enable row level security;
alter table public.application_refinement_requests enable row level security;
alter table public.application_refinement_proposals enable row level security;
alter table public.application_refinement_reviews enable row level security;
revoke all on public.application_refinement_state, public.application_refinement_requests, public.application_refinement_proposals, public.application_refinement_reviews from public,anon,authenticated,service_role;
grant select,insert,update on public.application_refinement_state to authenticated;
grant select,insert on public.application_refinement_requests, public.application_refinement_reviews to authenticated;
grant select on public.application_refinement_proposals to authenticated;
create policy "Read own refinement state" on public.application_refinement_state for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement state" on public.application_refinement_state for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Update own refinement state" on public.application_refinement_state for update to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)) with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement requests" on public.application_refinement_requests for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement requests" on public.application_refinement_requests for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement proposals" on public.application_refinement_proposals for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement reviews" on public.application_refinement_reviews for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement reviews" on public.application_refinement_reviews for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.refinement_validate_setup(value jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare template jsonb := value->'template'; item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>200000
    or value - array['template','language','maxWords'] <> '{}'::jsonb or not(value ?& array['template','language','maxWords'])
    or jsonb_typeof(value->'language') is distinct from 'string' or char_length(value->>'language') not between 1 and 30
    or jsonb_typeof(value->'maxWords') is distinct from 'number' or coalesce(value->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (value->>'maxWords')::integer not between 50 and 2000
    or jsonb_typeof(template) is distinct from 'object'
    or template - array['id','name','revision','structure','tone','language','maxWords','updatedAt','subjectInstructions','salutationInstructions','closingInstructions','exampleText'] <> '{}'::jsonb
    or not(template ?& array['id','name','revision','structure','tone','language','maxWords','updatedAt'])
    or jsonb_typeof(template->'revision') is distinct from 'number' or coalesce(template->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(template->'maxWords') is distinct from 'number' or coalesce(template->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (template->>'maxWords')::integer not between 50 and 2000 then
    raise exception 'Invalid refinement letter template or word target.' using errcode='22023';
  end if;
  for item in select key,val from jsonb_each(template-array['revision','maxWords']) e(key,val) loop
    if jsonb_typeof(item.val) is distinct from 'string' or char_length(item.val#>>'{}')>20000
      or (item.key in ('subjectInstructions','salutationInstructions','closingInstructions') and char_length(item.val#>>'{}')>1000)
      or translate(item.val#>>'{}', E'\t\n\r','') ~ '[[:cntrl:]]' then
      raise exception 'Invalid refinement template text.' using errcode='22023';
    end if;
  end loop;
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement text before publishing.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_capture_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  perform public.refinement_validate_setup(new.setup_json);
  if jsonb_typeof(new.approvals_json) is distinct from 'object' or not(new.approvals_json ?& array['cv','letter'])
    or new.approvals_json-array['cv','letter'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(new.approvals_json) e where jsonb_typeof(e.value) not in ('string','null') or (jsonb_typeof(e.value)='string' and e.value#>>'{}' !~ '^v1:[a-f0-9]{64}$')) then
    raise exception 'Invalid document approvals.' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if new.application_id<>old.application_id or new.user_id<>old.user_id then raise exception 'Refinement ownership cannot change.' using errcode='23514'; end if;
    if new.revision<>old.revision+1 then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    if pg_trigger_depth()=1 and exists(select 1 from jsonb_each(new.approvals_json) e where e.value<>'null'::jsonb and e.value is distinct from old.approvals_json->e.key) then
      raise exception 'Approve documents through a recorded review.' using errcode='23514';
    end if;
    if pg_trigger_depth()=1 and new.current_request_id is not null and new.current_request_id is distinct from old.current_request_id then
      raise exception 'Publish a request to advance the refinement round.' using errcode='23514';
    end if;
    if new.setup_json<>old.setup_json then
      new.current_request_id:=null;
      new.approvals_json:=jsonb_set(new.approvals_json,'{letter}','null');
    end if;
  else
    if new.approvals_json<>'{"cv":null,"letter":null}'::jsonb then raise exception 'Approve documents through a recorded review.' using errcode='23514'; end if;
    new.revision:=1;
    new.current_request_id:=null;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_state_capture before insert or update on public.application_refinement_state for each row execute function public.refinement_capture_state();

create function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  raise exception 'Refinement history is immutable; create a new round or remove the application.' using errcode='23514';
end;
$$;
create trigger refinement_requests_immutable before update or delete on public.application_refinement_requests for each row execute function public.refinement_guard_immutable();
create trigger refinement_proposals_immutable before update or delete on public.application_refinement_proposals for each row execute function public.refinement_guard_immutable();
create trigger refinement_reviews_immutable before update or delete on public.application_refinement_reviews for each row execute function public.refinement_guard_immutable();

create function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or value-array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] <> '{}'::jsonb
    or not(value ?& array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'])
    or value->'schemaVersion' is distinct from '1'::jsonb or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign an anonymized CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_requests_capture before insert on public.application_refinement_requests for each row execute function public.refinement_capture_request();
create function public.refinement_activate_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.application_refinement_state set current_request_id=new.id, revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
  return new;
end;
$$;
create trigger refinement_requests_activate after insert on public.application_refinement_requests for each row execute function public.refinement_activate_request();

create function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='feedback' then
    if new.payload-array['text','scope']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_reviews_capture before insert on public.application_refinement_reviews for each row execute function public.refinement_capture_review();

create function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or value-array['schemaVersion','requestId','summary','cvEdits','letterText']<>'{}'::jsonb
    or not(value ?& array['schemaVersion','requestId','summary','cvEdits','letterText'])
    or value->'schemaVersion' is distinct from '1'::jsonb or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!!|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
  if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_proposals_capture before insert on public.application_refinement_proposals for each row execute function public.refinement_capture_proposal();

create function public.save_refinement_state(p_application_id uuid,p_setup jsonb,p_approvals jsonb,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_state;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving preparation.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into result from public.application_refinement_state where user_id=actor and application_id=p_application_id for update;
  if found then
    if result.revision is distinct from p_expected_revision then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    update public.application_refinement_state set setup_json=p_setup,approvals_json=p_approvals,revision=revision+1 where application_id=p_application_id and user_id=actor returning * into result;
  else
    if p_expected_revision is distinct from 0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    insert into public.application_refinement_state(application_id,user_id,setup_json,approvals_json) values(p_application_id,actor,p_setup,p_approvals) returning * into result;
  end if;
  return to_jsonb(result);
end;
$$;
create function public.publish_refinement_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request_id uuid; application_id uuid; result public.application_refinement_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before publishing refinement.' using errcode='42501'; end if;
  begin request_id:=(p_request->>'requestId')::uuid; application_id:=(p_request->>'applicationId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid refinement identifiers.' using errcode='22023'; end;
  if request_id is null or application_id is null then raise exception 'Refinement identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||application_id::text,0));
  select * into result from public.application_refinement_requests r where r.user_id=actor and r.id=request_id;
  if found then
    if result.request_json=p_request then return to_jsonb(result); end if;
    raise exception 'Request ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_requests(id,application_id,user_id,request_json,opportunity_snapshot,cv_snapshot)
    values(request_id,application_id,actor,p_request,'{}','{}') returning * into result;
  return to_jsonb(result);
end;
$$;
create function public.save_refinement_review(p_application_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving a review.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  select * into result from public.application_refinement_reviews where user_id=actor and id=p_id;
  if found then
    if result.application_id=p_application_id and result.request_id is not distinct from p_request_id and result.kind=p_kind and result.payload=p_payload then return to_jsonb(result); end if;
    raise exception 'Review ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_reviews(id,application_id,user_id,request_id,kind,payload) values(p_id,p_application_id,actor,p_request_id,p_kind,p_payload) returning * into result;
  return to_jsonb(result);
end;
$$;

create function private.read_refinement_request(request_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into result from public.application_refinement_requests where id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  return to_jsonb(result);
end;
$$;
create function private.save_refinement_proposal(request_id uuid,proposal_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.application_refinement_proposals; request public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if request_id is null or proposal_id is null then raise exception 'Request and proposal identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(proposal_id::text,0));
  select * into result from public.application_refinement_proposals p where p.id=proposal_id;
  if found then
    if result.request_id=request_id and result.proposal_json=payload then return to_jsonb(result); end if;
    raise exception 'Proposal ID already exists with different input.' using errcode='23505';
  end if;
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
    values(proposal_id,request.application_id,request.user_id,request_id,payload) returning * into result;
  return to_jsonb(result);
end;
$$;

revoke all on function public.refinement_validate_setup(jsonb) from public,anon,service_role;
grant execute on function public.refinement_validate_setup(jsonb) to authenticated;
revoke all on function public.refinement_capture_state(), public.refinement_guard_immutable(), public.refinement_capture_request(), public.refinement_activate_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;
revoke all on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) to authenticated;
revoke all on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to postgres;
grant execute on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

commit;

-- Immutable server-generated application reference codes.
-- Additive upgrade after application_refinement.sql. Codes identify existing applications;
-- they are not authorization secrets and do not replace internal UUIDs or owner RLS.
begin;

alter table public.applications add column application_code text;

-- ALTER TABLE holds the table lock through this transaction. Preserve every existing
-- application field/timestamp while assigning a unique, server-generated code once.
alter table public.applications disable trigger applications_updated_at;
do $$
declare app record; candidate text;
begin
  for app in select id from public.applications order by created_at,id loop
    loop
      candidate := 'APP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
      exit when not exists(select 1 from public.applications where application_code=candidate);
    end loop;
    update public.applications set application_code=candidate where id=app.id;
  end loop;
end;
$$;
alter table public.applications enable trigger applications_updated_at;
alter table public.applications
  alter column application_code set not null,
  add constraint applications_application_code_key unique(application_code),
  add constraint applications_application_code_format check(application_code ~ '^APP-[A-F0-9]{10}$');
comment on column public.applications.application_code is 'Immutable globally unique server-assigned application reference. Owner RLS still governs access; the UUID remains the internal key.';

create function public.job_workspace_assign_application_code()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    -- Ignore supplied values so browser clients cannot choose or reuse a code.
    new.application_code := 'APP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  elsif new.application_code is distinct from old.application_code then
    raise exception 'Application codes are immutable.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_assign_application_code() from public,anon,authenticated,service_role;
create trigger applications_application_code before insert or update on public.applications
  for each row execute function public.job_workspace_assign_application_code();

-- Preserve both supported creation contracts. Only an application-code collision
-- is retried; a conflicting UUID/opportunity/CV and all other failures still fail.
create or replace function public.create_job_application(p_application_id uuid,p_opportunity_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.applications; violated_constraint text; attempt integer;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before creating an application.' using errcode='42501';
  end if;
  if p_application_id is null or p_opportunity_id is null then
    raise exception 'Application and opportunity IDs are required.' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_opportunity_id::text,0));
  select * into existing from public.applications where id=p_application_id and user_id=actor;
  if found then
    if existing.opportunity_id=p_opportunity_id then return existing.id; end if;
    raise exception 'Application ID already belongs to a different opportunity.' using errcode='23505';
  end if;
  select * into existing from public.applications where opportunity_id=p_opportunity_id and user_id=actor;
  if found then return existing.id; end if;
  for attempt in 1..32 loop
    begin
      insert into public.applications(id,user_id,opportunity_id) values(p_application_id,actor,p_opportunity_id);
      return p_application_id;
    exception when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint is distinct from 'applications_application_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'Could not allocate an application code; retry creating the application.' using errcode='23505';
end;
$$;

create or replace function public.create_job_application(
  p_application_id uuid,p_opportunity_id uuid,p_cv_variant_id uuid,
  p_contact_email text,p_cv_name text,p_content_json jsonb,p_config_json jsonb,p_cv_version integer default 7
) returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.applications; violated_constraint text; attempt integer;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before creating an application.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||p_application_id::text,0));
  select * into existing from public.applications where id=p_application_id and user_id=actor;
  if found then
    if existing.opportunity_id=p_opportunity_id and existing.cv_variant_id=p_cv_variant_id
      and existing.contact_email=p_contact_email and exists(
        select 1 from public.cv_variants where id=p_cv_variant_id and user_id=actor
          and name=p_cv_name and content_json=p_content_json and config_json=p_config_json and cv_version=p_cv_version
      ) then return existing.id;
    end if;
    raise exception 'Application ID already exists with different data.' using errcode='23505';
  end if;
  insert into public.cv_variants(id,user_id,name,content_json,config_json,cv_version,is_base_variant)
    values(p_cv_variant_id,actor,p_cv_name,p_content_json,p_config_json,p_cv_version,false);
  for attempt in 1..32 loop
    begin
      insert into public.applications(id,user_id,opportunity_id,cv_variant_id,contact_email)
        values(p_application_id,actor,p_opportunity_id,p_cv_variant_id,p_contact_email);
      return p_application_id;
    exception when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint is distinct from 'applications_application_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'Could not allocate an application code; retry creating the application.' using errcode='23505';
end;
$$;

create function public.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before resolving an application.' using errcode='42501';
  end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'current_request_id',s.current_request_id)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.user_id=actor and (a.application_code=reference or a.id=resolved_id);
  if result is null then raise exception 'Application unavailable.' using errcode='42501'; end if;
  return result;
end;
$$;

create function private.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'current_request_id',s.current_request_id)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.application_code=reference or a.id=resolved_id;
  if result is null then raise exception 'Application unavailable.' using errcode='22023'; end if;
  return result;
end;
$$;

revoke all on function public.resolve_application_reference(text) from public,anon,service_role;
grant execute on function public.resolve_application_reference(text) to authenticated;
revoke all on function private.resolve_application_reference(text) from public,anon,authenticated,service_role;
grant execute on function private.resolve_application_reference(text) to postgres;
-- CREATE OR REPLACE retains the original creation RPC grants and ownership.

commit;


-- Structured CV refinement version 2 (changes/structured_cv_refinement.sql)
-- Additive structured CV contract. Existing version-1 requests/proposals are unchanged.
begin;

-- Match JavaScript String.length for new structured-contract size limits.
-- On UTF8 PostgreSQL, ascii(character) returns its Unicode code point.
create function public.refinement_utf16_length(value text)
returns integer language sql immutable strict security invoker set search_path='' as $$
  select coalesce(sum(case when ascii(character)>65535 then 2 else 1 end),0)::integer
    from string_to_table(value,null) as characters(character);
$$;

create function public.refinement_exact_keys(value jsonb, keys text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(value)='object' and value-keys='{}'::jsonb and value ?& keys,false);
$$;

create function public.refinement_reference_permutation(value jsonb, expected jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare actual_values text[]; expected_values text[];
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>1000
    or exists(select 1 from jsonb_array_elements(value) e where jsonb_typeof(e)<>'string') then
    raise exception 'CV order must contain a complete reference list.' using errcode='22023';
  end if;
  select coalesce(array_agg(v order by v),'{}') into actual_values from jsonb_array_elements_text(value) v;
  select coalesce(array_agg(v order by v),'{}') into expected_values from jsonb_array_elements_text(expected) v;
  if actual_values<>expected_values or cardinality(actual_values)<>(select count(distinct v) from unnest(actual_values) v) then
    raise exception 'CV order must be an exact permutation within its existing parent.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_validate_cv_structure(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  category text; item jsonb; expected jsonb; ids text[]; fields_map jsonb; sections_map jsonb; entries_map jsonb; bullets_map jsonb;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  keys text[]; id_pattern text; range_targets text[]:='{}'; unsupported_fields text[]:='{}'; range_target text;
begin
  if not public.refinement_exact_keys(value,array['schemaVersion','areas','sections','entries','bullets','ranges','unsupported'])
    or value->'schemaVersion' is distinct from '1'::jsonb then raise exception 'Invalid structured CV context.' using errcode='22023'; end if;
  foreach category in array array['areas','sections','entries','bullets','ranges','unsupported'] loop
    if jsonb_typeof(value->category) is distinct from 'array' or jsonb_array_length(value->category)>1000 then raise exception 'Invalid structured CV list.' using errcode='22023'; end if;
    if category='unsupported' then continue; end if;
    keys:=case category
      when 'areas' then array['id','sectionIds'] when 'sections' then array['id','label','area','entryIds']
      when 'entries' then array['id','sectionId','label','bulletIds'] when 'bullets' then array['id','entryId','fieldId','text']
      else array['id','fieldId','bulletId','text','label'] end;
    id_pattern:=case category when 'areas' then '^(body|sidebar)$' when 'sections' then '^section-[1-9][0-9]*$'
      when 'entries' then '^entry-[1-9][0-9]*$' when 'bullets' then '^bullet-[1-9][0-9]*$' else '^range-[1-9][0-9]*$' end;
    ids:='{}';
    for item in select jsonb_array_elements(value->category) loop
      if not public.refinement_exact_keys(item,keys) or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~ id_pattern or item->>'id'=any(ids) then raise exception 'Invalid or duplicate structured CV reference.' using errcode='22023'; end if;
      ids:=array_append(ids,item->>'id');
      if category='bullets' and item->>'text'~E'[\r\n]' then raise exception 'A CV bullet must occupy one line.' using errcode='22023'; end if;
      if category in ('sections','entries','ranges') and (jsonb_typeof(item->'label') is distinct from 'string'
        or public.refinement_utf16_length(item->>'label')>200 or btrim(item->>'label',whitespace_chars)='' or translate(item->>'label',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV label.' using errcode='22023';
      end if;
      if category in ('bullets','ranges') and (jsonb_typeof(item->'text') is distinct from 'string'
        or public.refinement_utf16_length(item->>'text')>20000 or btrim(item->>'text',whitespace_chars)='' or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV text.' using errcode='22023';
      end if;
    end loop;
  end loop;
  perform public.refinement_reference_permutation((select coalesce(jsonb_agg(e->'id'),'[]') from jsonb_array_elements(value->'areas') e),'["body","sidebar"]');
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into fields_map from jsonb_array_elements(fields) e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into sections_map from jsonb_array_elements(value->'sections') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into entries_map from jsonb_array_elements(value->'entries') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into bullets_map from jsonb_array_elements(value->'bullets') e;
  for item in select jsonb_array_elements(value->'areas') loop
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'sections') e where e->>'area'=item->>'id';
    perform public.refinement_reference_permutation(item->'sectionIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'sections') loop
    if coalesce(item->>'area','') not in ('body','sidebar') then raise exception 'Unknown CV area.' using errcode='22023'; end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'entries') e where e->'sectionId'=item->'id';
    perform public.refinement_reference_permutation(item->'entryIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'entries') loop
    if not coalesce(sections_map ? (item->>'sectionId'),false) then raise exception 'Unknown CV section.' using errcode='22023'; end if;
    if (select count(distinct e->>'fieldId') from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id')>1 then
      raise exception 'An entry can expose bullets from only one field.' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id';
    perform public.refinement_reference_permutation(item->'bulletIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'bullets') loop
    if not coalesce(entries_map ? (item->>'entryId'),false) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or position(item->>'text' in fields_map->(item->>'fieldId')->>'text')=0 then
      raise exception 'CV bullet must belong to an authorized field and entry.' using errcode='22023';
    end if;
  end loop;
  for item in select jsonb_array_elements(value->'ranges') loop
    if not coalesce(fields_map ? (item->>'fieldId'),false) or jsonb_typeof(item->'bulletId') not in ('string','null') then raise exception 'Unknown CV text range.' using errcode='22023'; end if;
    if item->'bulletId'='null'::jsonb then
      if item->'text' is distinct from fields_map->(item->>'fieldId')->'text'
        or exists(select 1 from jsonb_array_elements(value->'bullets') e where e->'fieldId'=item->'fieldId') then
        raise exception 'A prose range must match its whole non-bullet field.' using errcode='22023';
      end if;
    elsif not coalesce(bullets_map ? (item->>'bulletId'),false)
      or item->'fieldId' is distinct from bullets_map->(item->>'bulletId')->'fieldId'
      or item->'text' is distinct from bullets_map->(item->>'bulletId')->'text' then
      raise exception 'A bullet range must exactly match its authorized bullet.' using errcode='22023';
    end if;
    range_target:=(item->>'fieldId')||':'||coalesce(item->>'bulletId','');
    if range_target=any(range_targets) then raise exception 'Duplicate CV range target.' using errcode='22023'; end if;
    range_targets:=array_append(range_targets,range_target);
  end loop;
  for item in select jsonb_array_elements(value->'unsupported') loop
    if not public.refinement_exact_keys(item,array['fieldId','reason']) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or item->>'fieldId'=any(unsupported_fields) or jsonb_typeof(item->'reason') is distinct from 'string'
      or exists(select 1 from jsonb_array_elements((value->'bullets')||(value->'ranges')) e where e->'fieldId'=item->'fieldId')
      or public.refinement_utf16_length(item->>'reason')>1000 or btrim(item->>'reason',whitespace_chars)='' or translate(item->>'reason',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid unsupported CV field.' using errcode='22023';
    end if;
    unsupported_fields:=array_append(unsupported_fields,item->>'fieldId');
  end loop;
end;
$$;

create function public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  item jsonb; target jsonb; original text; replacement text; expected jsonb; structure jsonb:=request_value->'cvStructure';
  ids text[]:='{}'; targets text[]:='{}'; omitted text[]:='{}'; shortened_bullets text[]:='{}'; signature text;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  words text[]; word text; cursor_index integer; total integer; whitespace text:=E'[[:space:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+';
begin
  if jsonb_typeof(value->'cvOperations') is distinct from 'array' or jsonb_typeof(value->'cvComments') is distinct from 'array'
    or jsonb_array_length(value->'cvOperations')>1000 or jsonb_array_length(value->'cvComments')>1000 then
    raise exception 'Invalid CV operations or comments.' using errcode='22023';
  end if;
  for item in select jsonb_array_elements(value->'cvOperations') loop
    if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^change-[1-9][0-9]*$' or item->>'id'=any(ids)
      or jsonb_typeof(item->'targetId') is distinct from 'string' or jsonb_typeof(item->'explanation') is distinct from 'string'
      or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)='' or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid CV change ID, target or explanation.' using errcode='22023';
    end if;
    ids:=array_append(ids,item->>'id');
    signature:=(item->>'type')||':'||(item->>'targetId');
    if signature=any(targets) then raise exception 'Duplicate CV operation target.' using errcode='22023'; end if;
    targets:=array_append(targets,signature);
    if item->>'type' in ('reorder_sections','reorder_entries','reorder_bullets') then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','order']) then raise exception 'Invalid CV reorder operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->(case item->>'type' when 'reorder_sections' then 'areas' when 'reorder_entries' then 'sections' else 'entries' end)) e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV reorder target.' using errcode='22023'; end if;
      expected:=target->(case item->>'type' when 'reorder_sections' then 'sectionIds' when 'reorder_entries' then 'entryIds' else 'bulletIds' end);
      if jsonb_array_length(expected)=0 then raise exception 'An empty CV container cannot be reordered.' using errcode='22023'; end if;
      perform public.refinement_reference_permutation(item->'order',expected);
    elsif item->>'type'='omit_bullet' then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation'])
        or not exists(select 1 from jsonb_array_elements(structure->'bullets') e where e->'id'=item->'targetId') then raise exception 'Unknown CV omission target.' using errcode='22023'; end if;
      omitted:=array_append(omitted,item->>'targetId');
    elsif item->>'type'='shorten_text' then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','text']) or jsonb_typeof(item->'text') is distinct from 'string' then raise exception 'Invalid CV shortening operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->'ranges') e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV shortening range.' using errcode='22023'; end if;
      original:=target->>'text'; replacement:=item->>'text';
      if target->>'bulletId' is not null and replacement~E'[\r\n]' then raise exception 'A shortened bullet must occupy one line.' using errcode='22023'; end if;
      if public.refinement_utf16_length(replacement)>20000 or char_length(replacement)>=char_length(original) or regexp_replace(replacement,whitespace,'','g')='' then raise exception 'A shortened range must be nonempty and strictly shorter.' using errcode='22023'; end if;
      select coalesce(array_agg(v order by n),'{}') into words from regexp_split_to_table(original,whitespace) with ordinality as w(v,n) where v<>'';
      cursor_index:=1; total:=cardinality(words);
      for word in select v from regexp_split_to_table(replacement,whitespace) v where v<>'' loop
        while cursor_index<=total and words[cursor_index]<>word loop cursor_index:=cursor_index+1; end loop;
        if cursor_index>total then raise exception 'Shortening may only remove original words in their existing order.' using errcode='22023'; end if;
        cursor_index:=cursor_index+1;
      end loop;
      -- Normalize only the synthetic validation view so the legacy POSIX link
      -- regex sees the same whitespace boundaries as JavaScript. Keep character
      -- counts unchanged so shortening cannot trigger its unchanged-text shortcut.
      perform public.cv_adjustment_validate_response(
        jsonb_build_object('schemaVersion',1,'requestId',expected_id,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',translate(replacement,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),
        jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id','field-1','text',translate(original,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),expected_id);
      if target->>'bulletId' is not null then shortened_bullets:=array_append(shortened_bullets,target->>'bulletId'); end if;
    else raise exception 'Unsupported CV operation.' using errcode='22023'; end if;
  end loop;
  if omitted && shortened_bullets then raise exception 'A CV bullet cannot be omitted and shortened in one proposal.' using errcode='22023'; end if;
  ids:='{}';
  for item in select jsonb_array_elements(value->'cvComments') loop
    if not public.refinement_exact_keys(item,array['id','fieldId','explanation']) or jsonb_typeof(item->'id') is distinct from 'string'
      or item->>'id' !~ '^comment-[1-9][0-9]*$' or item->>'id'=any(ids)
      or not exists(select 1 from jsonb_array_elements(request_value#>'{cv,fields}') e where e->'id'=item->'fieldId')
      or jsonb_typeof(item->'explanation') is distinct from 'string' or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)=''
      or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then raise exception 'Invalid CV comment.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
end;
$$;

create function public.refinement_validate_cv_decisions(value jsonb, proposal jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare expected jsonb;
begin
  if not public.refinement_exact_keys(value,array['proposalId','accepted','rejected','revision'])
    or jsonb_typeof(value->'proposalId') is distinct from 'string'
    or jsonb_typeof(value->'revision') is distinct from 'string' or value->>'revision' !~ '^v1:[a-f0-9]{64}$'
    or jsonb_typeof(value->'accepted') is distinct from 'array' or jsonb_typeof(value->'rejected') is distinct from 'array' then
    raise exception 'Invalid CV decision payload.' using errcode='22023';
  end if;
  if proposal->'schemaVersion'='2'::jsonb then
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(proposal->'cvOperations') e;
  else
    select coalesce(jsonb_agg(e->'fieldId'),'[]') into expected from jsonb_array_elements(proposal->'cvEdits') e;
  end if;
  perform public.refinement_reference_permutation((value->'accepted')||(value->'rejected'),expected);
end;
$$;

alter table public.application_refinement_reviews drop constraint application_refinement_reviews_kind_check;
alter table public.application_refinement_reviews add constraint application_refinement_reviews_kind_check
  check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter','cv_decisions'));

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure']
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  if value->'schemaVersion'='2'::jsonb then perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign an anonymized CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='feedback' then
    if new.payload-array['text','scope']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from state.current_request_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if jsonb_array_length(new.payload->'accepted')>0 and state.approvals_json->'cv'<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText']
      else array['schemaVersion','requestId','summary','cvEdits','letterText'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb)
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!!|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if value->'schemaVersion'='2'::jsonb then
    perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  else
    perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

-- Pure validators expose no stored data. Owner request/review triggers need these
-- invoker calls; the unchanged proposal write path still requires postgres.
revoke all on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) to authenticated;
revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;

commit;


-- Shared CV/letter annotations and persistent referenced reviews.
-- Additive v2 annotation extension. No document content or older proposals are rewritten.
-- Apply after structured_cv_refinement.sql; all status/response/feedback stays in reviews.
create function public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; location jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then raise exception 'Invalid refinement annotations.' using errcode='22023'; end if;
  for item in select v from jsonb_array_elements(value) as x(v) loop
    if not public.refinement_exact_keys(item,array['id','type','document','location','text'])
      or jsonb_typeof(item->'id') is distinct from 'string' or coalesce(item->>'id','') !~ '^annotation-[1-9][0-9]*$' or item->>'id'=any(ids)
      or coalesce(item->>'type','') not in ('comment','todo','question') or coalesce(item->>'document','') not in ('cv','letter')
      or jsonb_typeof(item->'text') is distinct from 'string' or btrim(item->>'text')=''
      or public.refinement_utf16_length(item->>'text')>4000
      or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]' or item::text like '%!!%'
      or item is distinct from public.job_drafting_redact_samples(item) then raise exception 'Invalid refinement annotation.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id'); location:=item->'location';
    if location='null'::jsonb then continue; end if;
    if item->>'document'='cv' then
      if not public.refinement_exact_keys(location,array['fieldId']) or jsonb_typeof(location->'fieldId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(fields) as f(v) where v->'id'=location->'fieldId') then raise exception 'Unknown CV annotation field.' using errcode='22023'; end if;
    else
      if not public.refinement_exact_keys(location,array['start','quote']) or jsonb_typeof(location->'start') is distinct from 'number'
        or coalesce(location->>'start','') !~ '^(0|[1-9][0-9]{0,5})$'
        or jsonb_typeof(location->'quote') is distinct from 'string' or btrim(location->>'quote')=''
        or public.refinement_utf16_length(location->>'quote')>2000 then raise exception 'Invalid letter annotation reference.' using errcode='22023'; end if;
      if substring(letter_text from (location->>'start')::integer+1 for char_length(location->>'quote')) is distinct from location->>'quote' then
        raise exception 'Invalid letter annotation reference.' using errcode='22023';
      end if;
    end if;
  end loop;
end;
$$;

alter table public.application_refinement_reviews drop constraint application_refinement_reviews_kind_check;
alter table public.application_refinement_reviews add constraint application_refinement_reviews_kind_check
  check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter','cv_decisions','annotation'));

revoke all on function public.refinement_validate_annotations(jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.refinement_validate_annotations(jsonb,jsonb,text) to authenticated;


create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure']
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  if value->'schemaVersion'='2'::jsonb then perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign an anonymized CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb; annotation jsonb; reference jsonb; previous public.application_refinement_reviews; has_previous boolean;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='annotation' or (new.kind='feedback' and new.payload ? 'annotation') then
    reference:=case when new.kind='annotation' then jsonb_build_object('proposalId',new.payload->'proposalId','annotationId',new.payload->'annotationId','reviewId',new.payload->'previousReviewId') else new.payload->'annotation' end;
    if not public.refinement_exact_keys(reference,array['proposalId','annotationId','reviewId'])
      or jsonb_typeof(reference->'proposalId') is distinct from 'string' or coalesce(reference->>'proposalId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(reference->'annotationId') is distinct from 'string' or coalesce(reference->>'annotationId','') !~ '^annotation-[1-9][0-9]*$'
      or (reference->'reviewId'<>'null'::jsonb and (jsonb_typeof(reference->'reviewId') is distinct from 'string' or coalesce(reference->>'reviewId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) then
      raise exception 'Invalid annotation reference.' using errcode='22023';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p where p.user_id=new.user_id
      and p.application_id=new.application_id and p.request_id=new.request_id and p.id::text=lower(reference->>'proposalId');
    if not found then raise exception 'Annotation proposal unavailable.' using errcode='42501'; end if;
    select a into annotation from jsonb_array_elements(coalesce(proposal->'annotations','[]'::jsonb)) as x(a) where a->>'id'=reference->>'annotationId';
    if not found then raise exception 'Annotation unavailable.' using errcode='22023'; end if;
    select * into previous from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id
      and r.kind='annotation' and r.payload->>'proposalId'=reference->>'proposalId' and r.payload->>'annotationId'=reference->>'annotationId'
      order by r.created_at desc,r.id desc limit 1;
    has_previous:=found;
    if (has_previous and lower(reference->>'reviewId') is distinct from previous.id::text) or (not has_previous and reference->'reviewId'<>'null'::jsonb) then
      raise exception 'Annotation changed elsewhere; reload the saved annotation. Your documents are unchanged.' using errcode='40001';
    end if;
    if new.kind='feedback' and (new.payload->>'scope' is distinct from annotation->>'document'
      or (has_previous and previous.payload->>'status'<>'open' and previous.payload->'response'='null'::jsonb)) then
      raise exception 'Only open or answered annotations can be included in their document feedback.' using errcode='22023';
    end if;
  end if;
  if new.kind='annotation' then
    if not public.refinement_exact_keys(new.payload,array['proposalId','annotationId','status','response','previousReviewId'])
      or coalesce(new.payload->>'status','') not in ('open','resolved','ignored')
      or (new.payload->'response'<>'null'::jsonb and (jsonb_typeof(new.payload->'response') is distinct from 'string' or btrim(new.payload->>'response')='' or public.refinement_utf16_length(new.payload->>'response')>12000))
      or translate(coalesce(new.payload->>'response',''),E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized annotation review.' using errcode='22023';
    end if;
  elsif new.kind='feedback' then
    if new.payload-array['text','scope','annotation']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) or new.payload::text like '%!!%' then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from state.current_request_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if jsonb_array_length(new.payload->'accepted')>0 and state.approvals_json->'cv'<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText'] || case when value ? 'annotations' then array['annotations'] else array[]::text[] end
      else array['schemaVersion','requestId','summary','cvEdits','letterText'] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb)
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!!|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if value->'schemaVersion'='2'::jsonb then
    if value ? 'annotations' then perform public.refinement_validate_annotations(value->'annotations',request.request_json#>'{cv,fields}',value->>'letterText'); end if;
    perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  else
    perform public.cv_adjustment_validate_response(jsonb_build_object('schemaVersion',1,'requestId',new.request_id,'edits',value->'cvEdits'),request.request_json->'cv',new.request_id);
    if request.request_json->>'scope'='letter' and value->'cvEdits'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;


-- Ticket 6: explicit pseudonymization and approved context descriptions.
-- Optional user-approved context for existing public tokens; private originals and maps stay local.
-- Apply after refinement_annotations.sql. Older v1/v2 requests remain valid.
create or replace function public.refinement_validate_privacy_legend(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; seen text[]:='{}'; source_text text;
begin
  if jsonb_typeof(value) is distinct from 'array' then raise exception 'Invalid privacy legend.' using errcode='22023'; end if;
  if jsonb_array_length(value)>1000 then raise exception 'Privacy legend is too large.' using errcode='22023'; end if;
  for item in select jsonb_array_elements(value) loop
    if not public.refinement_exact_keys(item,array['fieldId','token','type','description'])
      or jsonb_typeof(item->'fieldId') is distinct from 'string'
      or jsonb_typeof(item->'token') is distinct from 'string' or item->>'token' !~ '^\{\{PRIVATE_[1-9][0-9]*\}\}$'
      or coalesce(item->>'type','') not in ('person','organization','location','link','contact','confidential','other')
      or jsonb_typeof(item->'description') is distinct from 'string'
      or coalesce(btrim(item->>'description', E' \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'),'')='' or public.refinement_utf16_length(item->>'description')>500
      or item->>'description' ~ '[[:cntrl:]]|!!|\{\{|\}\}|<|>' then
      raise exception 'Invalid approved privacy context.' using errcode='22023';
    end if;
    select field->>'text' into source_text from jsonb_array_elements(fields) field where field->>'id'=item->>'fieldId';
    if source_text is null or position(item->>'token' in source_text)=0 or item->>'token'=any(seen) then
      raise exception 'Privacy context must reference a unique token in its original field.' using errcode='22023';
    end if;
    seen:=array_append(seen,item->>'token');
  end loop;
end;
$$;
revoke all on function public.refinement_validate_privacy_legend(jsonb,jsonb) from public, anon, service_role;
grant execute on function public.refinement_validate_privacy_legend(jsonb,jsonb) to authenticated;

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,case when value->'schemaVersion'='2'::jsonb
      then array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure']
      else array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId'] end || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
    or coalesce(value->'schemaVersion','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  if value->'schemaVersion'='2'::jsonb then perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}'); end if;
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    public.job_drafting_redact_samples(cv.content_json)||'{"contact":{"name":"{{APPLICANT_NAME}}","location":"{{APPLICANT_LOCATION}}","role":"{{APPLICANT_ROLE}}","email":"{{APPLICANT_EMAIL}}","phone":"{{APPLICANT_PHONE}}","website":"{{APPLICANT_WEBSITE}}","linkedin":"{{APPLICANT_LINKEDIN}}","github":"{{APPLICANT_GITHUB}}"}}'::jsonb);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare
  edit jsonb; original text; replacement text; ids text[] := '{}';
  original_lines jsonb; replacement_lines jsonb;
  original_tokens text[]; replacement_tokens text[]; original_links text[]; replacement_links text[];
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','edits'] <> '{}'::jsonb or not (value ?& array['schemaVersion','requestId','edits'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'edits') is distinct from 'array' then
    raise exception 'Invalid CV adjustment response.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'edits') > 1000 then raise exception 'Too many CV adjustment edits.' using errcode = '22023'; end if;
  for edit in select jsonb_array_elements(value->'edits') loop
    if jsonb_typeof(edit) is distinct from 'object' or edit - array['fieldId','text'] <> '{}'::jsonb
      or not (edit ?& array['fieldId','text'])
      or jsonb_typeof(edit->'fieldId') is distinct from 'string' or edit->>'fieldId' !~ '^field-[1-9][0-9]*$' or edit->>'fieldId' = any(ids)
      or jsonb_typeof(edit->'text') is distinct from 'string' or char_length(edit->>'text') > 20000
      or translate(edit->>'text', E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment edit.' using errcode = '22023';
    end if;
    ids := array_append(ids, edit->>'fieldId');
    select field->>'text' into original from jsonb_array_elements(request_value->'fields') as fields(field) where field->>'id' = edit->>'fieldId';
    if not found then raise exception 'The response edits an unavailable CV field.' using errcode = '22023'; end if;
    replacement := edit->>'text';
    if replacement = original then continue; end if;
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into original_tokens
      from regexp_matches(original, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into replacement_tokens
      from regexp_matches(replacement, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    if original_tokens <> replacement_tokens
      or regexp_replace(replacement, '\{\{PRIVATE_[1-9][0-9]*\}\}', '', 'g') ~ '\{\{|\}\}'
      or position('!!' in replacement) > 0 then
      raise exception 'Private placeholders must remain in their original field, order and count.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into original_lines
      from regexp_split_to_table(original,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into replacement_lines
      from regexp_split_to_table(replacement,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    if original_lines<>replacement_lines then raise exception 'Private tokens must remain attached to their original bullet or content line.' using errcode='22023'; end if;
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into original_links
      from regexp_matches(original, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into replacement_links
      from regexp_matches(replacement, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    if original_links <> replacement_links or replacement ~* '!\[|</?[a-z]|\]\([^)]*\{\{' then
      raise exception 'CV adjustments cannot add links, images or HTML.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.refinement_capture_request() from public, anon, authenticated, service_role;
revoke all on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) to authenticated;


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

-- Optional letter-template research interests and contextual questions.
begin;

create or replace function public.refinement_validate_setup(value jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare template jsonb := value->'template'; item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>200000
    or value - array['template','language','maxWords'] <> '{}'::jsonb or not(value ?& array['template','language','maxWords'])
    or jsonb_typeof(value->'language') is distinct from 'string' or char_length(value->>'language') not between 1 and 30
    or jsonb_typeof(value->'maxWords') is distinct from 'number' or coalesce(value->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (value->>'maxWords')::integer not between 50 and 2000
    or jsonb_typeof(template) is distinct from 'object'
    or template - array['id','name','revision','structure','tone','language','maxWords','updatedAt','subjectInstructions','salutationInstructions','closingInstructions','exampleText','researchInterests','questionGuidance'] <> '{}'::jsonb
    or not(template ?& array['id','name','revision','structure','tone','language','maxWords','updatedAt'])
    or jsonb_typeof(template->'revision') is distinct from 'number' or coalesce(template->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(template->'maxWords') is distinct from 'number' or coalesce(template->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (template->>'maxWords')::integer not between 50 and 2000 then
    raise exception 'Invalid refinement letter template or word target.' using errcode='22023';
  end if;
  for item in select key,val from jsonb_each(template-array['revision','maxWords']) e(key,val) loop
    if jsonb_typeof(item.val) is distinct from 'string' or char_length(item.val#>>'{}')>20000
      or (item.key in ('subjectInstructions','salutationInstructions','closingInstructions') and char_length(item.val#>>'{}')>1000)
      or (item.key in ('researchInterests','questionGuidance') and public.refinement_utf16_length(item.val#>>'{}')>4000)
      or translate(item.val#>>'{}', E'\t\n\r','') ~ '[[:cntrl:]]' then
      raise exception 'Invalid refinement template text.' using errcode='22023';
    end if;
  end loop;
  if value is distinct from public.job_drafting_redact_samples(value) or value::text like '%!!%' then
    raise exception 'Anonymize refinement text before publishing.' using errcode='22023';
  end if;
end;
$$;


commit;


-- Local attachment metadata library (files remain in browser storage).
-- Reusable attachment descriptions only. File bytes and all file-derived metadata remain local.
-- Apply after structured_cv_refinement.sql (refinement_utf16_length).
begin;

create table public.local_attachment_metadata (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null,
  constraint local_attachment_name_valid check (
    public.refinement_utf16_length(name) between 1 and 200
    and name=btrim(name, E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and name !~ '[[:cntrl:]]'),
  constraint local_attachment_description_valid check (
    public.refinement_utf16_length(description) between 1 and 4000
    and description=btrim(description, E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and translate(description, E'\t\n\r', '') !~ '[[:cntrl:]]')
);
create index local_attachment_metadata_user_idx on public.local_attachment_metadata(user_id);
alter table public.local_attachment_metadata enable row level security;
revoke all on public.local_attachment_metadata from public, anon, authenticated, service_role;
grant select, insert, delete on public.local_attachment_metadata to authenticated;
grant update(name, description) on public.local_attachment_metadata to authenticated;

create policy "Read own attachment descriptions" on public.local_attachment_metadata for select to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own attachment descriptions" on public.local_attachment_metadata for insert to authenticated
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Update own attachment descriptions" on public.local_attachment_metadata for update to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Delete own attachment descriptions" on public.local_attachment_metadata for delete to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.save_local_attachment_metadata(p_id uuid, p_name text, p_description text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.local_attachment_metadata;
  whitespace_chars constant text:=E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before saving attachment descriptions.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'An attachment reference is required.' using errcode='22023'; end if;
  insert into public.local_attachment_metadata(id,user_id,name,description)
    values(p_id,actor,btrim(p_name,whitespace_chars),btrim(p_description,whitespace_chars))
    on conflict(id) do update set name=excluded.name,description=excluded.description
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.delete_local_attachment_metadata(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before removing attachment descriptions.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'An attachment reference is required.' using errcode='22023'; end if;
  delete from public.local_attachment_metadata where id=p_id and user_id=auth.uid();
end;
$$;
revoke all on function public.save_local_attachment_metadata(uuid,text,text), public.delete_local_attachment_metadata(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_local_attachment_metadata(uuid,text,text), public.delete_local_attachment_metadata(uuid)
  to authenticated;
comment on table public.local_attachment_metadata is 'Only user-entered attachment names and descriptions, with technical identity/ownership. Files, filenames, paths, MIME types, sizes, extracted text, and application selections stay in local browser storage.';

commit;

-- Owner-requested history removal. Apply after refinement_annotations.sql.
-- Documents, assigned CV snapshots, setup and approval hashes remain unchanged.
begin;

create or replace function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  -- A custom setting alone grants no authority. Only the postgres-owned RPC can
  -- delete directly, and its scope must match both the signed-in owner and row.
  if tg_op='DELETE' and current_user='postgres' and auth.uid()=old.user_id
    and current_setting('cv_builder.clearing_refinement_history',true)=old.user_id::text||':'||old.application_id::text then
    return old;
  end if;
  raise exception 'Refinement history is immutable; create a new round or clear history.' using errcode='23514';
end;
$$;

create function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'An application and current refinement revision are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then
    raise exception 'Application unavailable.' using errcode='42501';
  end if;
  select * into result from public.application_refinement_state
    where user_id=actor and application_id=p_application_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    return 'null'::jsonb;
  end if;
  if result.revision<>p_expected_revision then
    raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001';
  end if;
  update public.application_refinement_state set current_request_id=null,revision=revision+1
    where user_id=actor and application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  -- Reviews without a request (including approval history) must also be removed.
  delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
  -- Request deletion cascades to its proposals. Restore the transaction-local
  -- scope on success; an exception rolls back both deletions and the setting.
  delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

-- Only this narrow authenticated endpoint can enter the private implementation.
-- The elevated role is necessary because ordinary table DELETE remains revoked.
create function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language sql security definer set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision);
$$;
alter function public.clear_refinement_history(uuid,integer) owner to postgres;
revoke all on function private.clear_refinement_history(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.clear_refinement_history(uuid,integer) to postgres;
revoke all on function public.clear_refinement_history(uuid,integer) from public,anon,service_role;
grant execute on function public.clear_refinement_history(uuid,integer) to authenticated;
revoke all on function public.refinement_guard_immutable() from public,anon,authenticated,service_role;

create or replace function private.save_refinement_proposal(request_id uuid,proposal_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.application_refinement_proposals; request public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if request_id is null or proposal_id is null then raise exception 'Request and proposal identifiers are required.' using errcode='22023'; end if;
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  -- Match request/review publication and history clearing. Check again after the
  -- lock so a proposal waiting for a completed clear cannot revive old history.
  perform pg_advisory_xact_lock(hashtextextended(request.user_id::text||request.application_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(proposal_id::text,0));
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  select * into result from public.application_refinement_proposals p where p.id=proposal_id;
  if found then
    if result.request_id=request_id and result.proposal_json=payload then return to_jsonb(result); end if;
    raise exception 'Proposal ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
    values(proposal_id,request.application_id,request.user_id,request_id,payload) returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

commit;

-- Keep elevated execution outside the exposed API schema.
-- Apply after refinement_clear_history.sql; no history or document data changes.
begin;
alter function private.clear_refinement_history(uuid,integer) security definer;
alter function private.clear_refinement_history(uuid,integer) owner to postgres;
alter function public.clear_refinement_history(uuid,integer) security invoker;
-- USAGE permits resolving this helper; existing management helpers retain their
-- revoked EXECUTE grants and cannot be called by authenticated users.
grant usage on schema private to authenticated;
grant execute on function private.clear_refinement_history(uuid,integer) to authenticated;
commit;
-- Store the exact connected protocol before copying a task. Existing source snapshots stay immutable.
begin;
create table public.application_refinement_protocols (
  request_id uuid not null,
  protocol_id text not null check (protocol_id ~ '^v1:[0-9a-f]{64}$'),
  application_id uuid not null,
  user_id uuid not null,
  protocol_text text not null check (char_length(protocol_text) between 1 and 100000),
  created_at timestamptz not null default now(),
  primary key (request_id, protocol_id),
  foreign key (user_id, application_id, request_id)
    references public.application_refinement_requests(user_id, application_id, id) on delete cascade
);
create index application_refinement_protocols_owner_request_idx
  on public.application_refinement_protocols(user_id, application_id, request_id);
alter table public.application_refinement_protocols enable row level security;
revoke all on public.application_refinement_protocols from public, anon, authenticated, service_role;
grant select, insert on public.application_refinement_protocols to authenticated;
create policy "Read own refinement protocols" on public.application_refinement_protocols
  for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Publish own refinement protocols" on public.application_refinement_protocols
  for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function private.prevent_refinement_protocol_update()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Published refinement protocols are immutable.' using errcode='42501';
end;
$$;
revoke all on function private.prevent_refinement_protocol_update() from public, anon, authenticated, service_role;
create trigger refinement_protocol_immutable before update on public.application_refinement_protocols
  for each row execute function private.prevent_refinement_protocol_update();

create function public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); source public.application_refinement_requests;
  saved public.application_refinement_protocols;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before publishing a refinement protocol.' using errcode='42501';
  end if;
  if p_request_id is null or p_protocol_id is null or p_protocol_id !~ '^v1:[0-9a-f]{64}$'
    or p_protocol_text is null or char_length(p_protocol_text) not between 1 and 100000 then
    raise exception 'Invalid refinement protocol document.' using errcode='22023';
  end if;
  select * into source from public.application_refinement_requests where id=p_request_id and user_id=actor;
  if not found then raise exception 'Published request not found for this account.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||source.application_id::text,0));
  if not exists (select 1 from public.application_refinement_state where user_id=actor
    and application_id=source.application_id and current_request_id=p_request_id) then
    raise exception 'The current refinement request changed. Copy the task again.' using errcode='40001';
  end if;
  insert into public.application_refinement_protocols(request_id,protocol_id,application_id,user_id,protocol_text)
    values(p_request_id,p_protocol_id,source.application_id,actor,p_protocol_text)
    on conflict (request_id,protocol_id) do nothing;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if saved.protocol_text is distinct from p_protocol_text then
    raise exception 'This protocol identifier already belongs to different instructions.' using errcode='22023';
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.publish_refinement_protocol(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_refinement_protocol(uuid,text,text) to authenticated;

create function private.read_refinement_protocol(p_request_id uuid, p_protocol_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.application_refinement_protocols;
begin
  if current_user<>'postgres' then raise exception 'Use the authorized management connection.' using errcode='42501'; end if;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if not found then raise exception 'Refinement protocol not found. Copy the task again in the app.' using errcode='P0002'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function private.read_refinement_protocol(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.read_refinement_protocol(uuid,text) to postgres;
commit;

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
