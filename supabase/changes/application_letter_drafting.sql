-- Additive upgrade; run once after application_checklists_and_removal.sql.
-- Full CVs, local document files, manual edits and final letters remain in the browser.
begin;

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

commit;
