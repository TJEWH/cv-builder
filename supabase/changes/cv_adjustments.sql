-- Additive upgrade after application_letter_drafting.sql. No existing rows change.
-- Only public text fields enter these immutable snapshots; reconstruction stays local.
begin;

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
