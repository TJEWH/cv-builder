-- Additive upgrade for the existing opportunity-search protocol installation.
-- Editor saves and schedule replacement reads are independent of search-run helpers.
alter table public.opportunity_search_templates add column if not exists meta_search jsonb;

create or replace function private.guard_opportunity_meta_search()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Legacy writers must not leave an obsolete complete prompt attached to new criteria.
  if tg_op = 'UPDATE' and new.meta_search is not null and new.meta_search is not distinct from old.meta_search
    and (new.name is distinct from old.name or new.criteria is distinct from old.criteria or new.schedule is distinct from old.schedule) then
    new.meta_search := null;
  end if;
  if new.meta_search is not null and (
    jsonb_typeof(new.meta_search) is distinct from 'object'
    or new.meta_search->'version' is distinct from '1'::jsonb
    or jsonb_typeof(new.meta_search->'active') is distinct from 'boolean'
    or jsonb_typeof(new.meta_search->'editor') is distinct from 'object'
    or jsonb_typeof(new.meta_search->'systemPrompt') is distinct from 'string'
    or jsonb_typeof(new.meta_search->'userPrompt') is distinct from 'string'
    or jsonb_typeof(new.meta_search->'recurringPrompt') is distinct from 'string'
    or octet_length(new.meta_search::text) > 3000000
  ) then raise exception 'Invalid complete meta-search prompt.' using errcode='22023'; end if;
  return new;
end;
$$;
revoke all on function private.guard_opportunity_meta_search() from public, anon, authenticated;
drop trigger if exists guard_opportunity_meta_search on public.opportunity_search_templates;
create trigger guard_opportunity_meta_search before insert or update on public.opportunity_search_templates
  for each row execute function private.guard_opportunity_meta_search();

create or replace function public.save_opportunity_meta_search(
  p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb
) returns public.opportunity_search_templates language plpgsql security invoker set search_path = '' as $$
declare saved public.opportunity_search_templates;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'A non-anonymous signed-in owner is required.' using errcode='42501';
  end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_meta_search is null then
    raise exception 'An exact search ID, expected revision and complete prompt are required.' using errcode='22023';
  end if;
  perform private.validate_opportunity_search_definition(p_name,p_criteria,p_schedule);
  if p_expected_revision = 0 then
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search)
      values(p_id,auth.uid(),p_name,p_criteria,p_schedule,p_meta_search)
      on conflict(id) do nothing returning * into saved;
  else
    update public.opportunity_search_templates set name=p_name,criteria=p_criteria,schedule=p_schedule,
      meta_search=p_meta_search,revision=revision+1
      where id=p_id and user_id=auth.uid() and revision=p_expected_revision returning * into saved;
  end if;
  if saved.id is null then
    -- Retrying a lost response returns the same committed revision, without a read-back request.
    select * into saved from public.opportunity_search_templates where id=p_id and user_id=auth.uid()
      and revision=p_expected_revision+1 and name=btrim(p_name) and criteria=p_criteria
      and schedule=p_schedule and meta_search=p_meta_search;
    if saved.id is null then raise exception 'Search changed elsewhere. Reload before saving.' using errcode='40001'; end if;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_opportunity_meta_search(uuid,integer,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.save_opportunity_meta_search(uuid,integer,text,jsonb,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
