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
