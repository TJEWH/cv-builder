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
