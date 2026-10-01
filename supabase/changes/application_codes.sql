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
