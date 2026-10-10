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
