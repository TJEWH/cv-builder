-- AF-04: reusable sources and versioned extensions of immutable v1 query rows.
-- Requires the reviewed v1 bootstrap query revision table and AF-01–03 helpers.
-- Does not modify the v1 writer, legacy query arrays, tasks or canonical records.
begin;

-- Public pure URL validation has the same bounded policy as the private runner
-- projector; no runtime grants are added to the private projection functions.
create function public.opportunity_search_url_decoded(p_text text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare current_text text:=p_text; next_text text; bytes bytea; piece text; index integer; pass integer;
begin
  if p_text is null or char_length(p_text)>8192 then return null; end if;
  for pass in 1..3 loop
    if position('%' in current_text)=0 then return current_text; end if;
    bytes:=''::bytea; index:=1;
    while index<=char_length(current_text) loop
      piece:=substr(current_text,index,1);
      if piece='%' then
        piece:=substr(current_text,index+1,2);
        if piece !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
        bytes:=bytes||decode(piece,'hex'); index:=index+3;
      else
        bytes:=bytes||convert_to(piece,'UTF8'); index:=index+1;
      end if;
    end loop;
    next_text:=convert_from(bytes,'UTF8');
    if next_text=current_text then return current_text; end if;
    current_text:=next_text;
  end loop;
  if current_text ~ '%[0-9A-Fa-f]{2}' then return null; end if;
  return current_text;
exception when character_not_in_repertoire or untranslatable_character or invalid_parameter_value then return null;
end;
$$;

create function public.opportunity_search_source_url(p_url text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare parts text[]; authority text[]; scheme text; host text; port integer; path text; query text;
  plain text; component text; pair text; key text; value text;
  private_key text:='(access[[:space:]_-]*token|refresh[[:space:]_-]*token|token|key|api[[:space:]_-]*key|auth(entication|orization)?|password|passwd|pwd|secret|session([[:space:]_-]*id)?|jwt|code|email([[:space:]_-]*address)?|e[[:space:]_-]*mail|phone([[:space:]_-]*number)?|mobile|tel|telephone|address|street|name|first[[:space:]_-]*name|last[[:space:]_-]*name|full[[:space:]_-]*name|user([[:space:]_-]*id|[[:space:]_-]*name)?|candidate([[:space:]_-]*id)?|applicant([[:space:]_-]*id)?|person([[:space:]_-]*id)?|contact([[:space:]_-]*id)?)';
begin
  if p_url is null or char_length(p_url)>2048 or p_url ~ '[[:cntrl:][:space:]]' or position(chr(92) in p_url)>0 then return null; end if;
  parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)([?][^#]*)?(#.*)?$','i');
  if parts is null then return null; end if;
  scheme:=lower(parts[1]);
  authority:=regexp_match(parts[2],'^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]+)?$');
  if authority is null then return null; end if;
  host:=lower(authority[1]);
  if position('.' in host)=0 or host !~ '[.][A-Za-z][A-Za-z0-9-]*$' or host ~ '^[0-9.]+$' or host ~ '[.][.]'
    or host ~ '(^|[.])-|-[.]' or host ~ '[.](localhost|local)$' then return null; end if;
  if authority[3] is not null then
    port:=substr(authority[3],2)::integer;
    if port<0 or port>65535 then return null; end if;
  end if;
  path:=coalesce(nullif(parts[3],''),'/'); query:=coalesce(parts[4],'');
  plain:=public.opportunity_search_url_decoded(p_url);
  if plain is null or plain ~ '[[:cntrl:]]' or position(chr(92) in plain)>0
    or plain ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    or plain ~* '(mailto|tel):'
    or plain ~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    or plain ~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)'
    or plain ~* '/(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|authorize|password|reset-password|session)(/|$)'
    or regexp_replace(plain,'[[:space:]_+-]+','','g') ~* ('[?&#]'||private_key||'=')
    or plain ~* 'https?://[^[:space:]/]+@' then return null; end if;
  foreach pair in array string_to_array(substr(query,2),'&') loop
    key:=public.opportunity_search_url_decoded(replace(split_part(pair,'=',1),'+',' '));
    value:=public.opportunity_search_url_decoded(replace(substr(pair,position('=' in pair)+1),'+',' '));
    if key is null or value is null or regexp_replace(key,'[[:space:]_+-]+','','g') ~* ('^'||private_key||'$') then return null; end if;
  end loop;
  component:=public.opportunity_search_url_decoded(coalesce(parts[5],''));
  if component is null then return null; end if;
  return scheme||'://'||host||case when port is not null and not (scheme='http' and port=80 or scheme='https' and port=443)
    then ':'||port::text else '' end||path||query||coalesce(parts[5],'');
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;
revoke all on function public.opportunity_search_url_decoded(text),public.opportunity_search_source_url(text) from public,anon,service_role;
grant execute on function public.opportunity_search_url_decoded(text),public.opportunity_search_source_url(text) to authenticated;

create function public.opportunity_search_public_text(p_text text,p_limit integer) returns boolean
language sql immutable security invoker set search_path='' as $$
  select public.opportunity_feedback_safe_text(p_text,p_limit) and p_text ~ '[^[:space:]]'
    and p_text !~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)';
$$;
revoke all on function public.opportunity_search_public_text(text,integer) from public,anon,service_role;
grant execute on function public.opportunity_search_public_text(text,integer) to authenticated;

do $$ begin
  if to_regclass('public.opportunity_search_query_revisions') is null then
    raise exception 'Install the reviewed opportunity-search v1 bootstrap before AF-04.' using errcode='55000';
  end if;
end $$;

create table public.opportunity_search_sources (
  registry_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid not null,
  listing_url text,
  vacancy_url text,
  kind text not null default 'other' check(kind in ('university','lab','program','job_board','other')),
  institution text,
  topics text[] not null default '{}',
  priority integer not null default 50 check(priority between 0 and 100),
  enabled boolean not null default false,
  pinned boolean not null default false,
  mandatory boolean not null default false,
  check_interval_hours integer not null default 168 check(check_interval_hours between 24 and 720),
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  status text not null default 'pending_identification' check(status in ('pending_identification','ready','checked','blocked','incomplete')),
  owner_disabled boolean not null default false,
  provenance text not null default 'candidate' check(provenance in ('explicit','evidenced_listing','candidate')),
  listing_verified_at timestamptz,
  source_revision bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(user_id,search_id,registry_id),
  foreign key(user_id,search_id) references public.opportunity_search_templates(user_id,id) on delete cascade
);
create unique index opportunity_search_sources_listing on public.opportunity_search_sources(user_id,search_id,listing_url) where listing_url is not null;
alter table public.opportunity_search_sources enable row level security;
revoke all on public.opportunity_search_sources from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.opportunity_search_sources to authenticated;
create policy "Owner reusable sources" on public.opportunity_search_sources for all to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

alter table public.opportunity_search_adaptive_settings
  add column successful_source_reuse_enabled boolean not null default false,
  add column reuse_check_interval_hours integer not null default 168 check(reuse_check_interval_hours between 24 and 720),
  add column source_reuse_revision bigint not null default 0,
  add column query_plan_id uuid,
  add column query_plan_revision bigint not null default 0,
  add column query_plan_dirty boolean not null default true;

create function public.job_workspace_source_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare topic text; changed boolean;
begin
  if tg_op='UPDATE' and (new.registry_id,new.user_id,new.search_id,new.created_at) is distinct from (old.registry_id,old.user_id,old.search_id,old.created_at) then
    raise exception 'Source identity is immutable' using errcode='23514'; end if;
  if new.listing_url is not null then
    new.listing_url:=public.opportunity_search_source_url(new.listing_url);
    if new.listing_url is null then raise exception 'Use a public listing URL without contact details or credentials' using errcode='22023'; end if;
  end if;
  if new.vacancy_url is not null then
    new.vacancy_url:=public.opportunity_search_source_url(new.vacancy_url);
    if new.vacancy_url is null then raise exception 'Use a public vacancy reference URL' using errcode='22023'; end if;
  end if;
  if new.institution is not null and not public.opportunity_search_public_text(new.institution,200) then
    raise exception 'Institution must be bounded public text' using errcode='22023'; end if;
  if array_ndims(new.topics)>1 or cardinality(new.topics)>16 or array_position(new.topics,null) is not null then
    raise exception 'Use at most 16 public topic labels' using errcode='22023'; end if;
  foreach topic in array new.topics loop
    if not public.opportunity_search_public_text(topic,120) then raise exception 'Use bounded public topic labels' using errcode='22023'; end if;
  end loop;
  select coalesce(array_agg(t order by t collate "C"),'{}') into new.topics from (select distinct t from unnest(new.topics) t) topics;
  if current_user<>'postgres' then
    if tg_op='INSERT' then
      new.last_attempted_at:=null;new.last_successful_at:=null;new.listing_verified_at:=null;
      new.provenance:=case when new.listing_url is null then 'candidate' else 'explicit' end;
      new.owner_disabled:=new.owner_disabled or (new.listing_url is not null and not new.enabled);
      new.status:=case when new.listing_url is null then 'pending_identification' else 'ready' end;
    else
      new.last_attempted_at:=old.last_attempted_at;new.last_successful_at:=old.last_successful_at;new.listing_verified_at:=old.listing_verified_at;
      new.provenance:=old.provenance;new.status:=old.status;
      if new.enabled is distinct from old.enabled then new.owner_disabled:=not new.enabled;
      else new.owner_disabled:=old.owner_disabled or new.owner_disabled; end if;
      if new.owner_disabled then new.enabled:=false; end if;
      if new.listing_url is distinct from old.listing_url then
        new.last_attempted_at:=null;new.last_successful_at:=null;new.listing_verified_at:=null;
        new.provenance:=case when new.listing_url is null then 'candidate' else 'explicit' end;
        new.status:=case when new.listing_url is null then 'pending_identification' else 'ready' end;
      end if;
    end if;
  elsif tg_op='UPDATE' and old.owner_disabled then
    new.owner_disabled:=true;new.enabled:=false;
  end if;
  if current_user='postgres' and tg_op='UPDATE' and new.listing_url is not distinct from old.listing_url then
    new.last_attempted_at:=greatest(new.last_attempted_at,old.last_attempted_at);
    new.last_successful_at:=greatest(new.last_successful_at,old.last_successful_at);
  end if;
  if new.listing_url is null then
    new.enabled:=false;new.mandatory:=false;new.status:='pending_identification';new.listing_verified_at:=null;
  end if;
  if new.owner_disabled then new.enabled:=false; end if;
  if new.last_attempted_at is not null and not isfinite(new.last_attempted_at)
    or new.last_successful_at is not null and not isfinite(new.last_successful_at)
    or new.listing_verified_at is not null and not isfinite(new.listing_verified_at) then
    raise exception 'Unknown source times must stay null' using errcode='22023'; end if;
  if tg_op='INSERT' then new.source_revision:=1;
  else
    changed:=(to_jsonb(new)-array['source_revision','updated_at']) is distinct from (to_jsonb(old)-array['source_revision','updated_at']);
    new.source_revision:=old.source_revision+case when changed then 1 else 0 end;
  end if;
  new.updated_at:=case when tg_op='UPDATE' and new.source_revision=old.source_revision then old.updated_at else clock_timestamp() end;
  return new;
end;
$$;
revoke all on function public.job_workspace_source_guard() from public,anon,authenticated,service_role;
create trigger opportunity_search_sources_guard before insert or update on public.opportunity_search_sources
  for each row execute function public.job_workspace_source_guard();

-- A sidecar is required by the v1 UNIQUE(search,base,protocol) contract. It is
-- anchored to that exact immutable row, not a second independent query system.
do $$ begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.opportunity_search_query_revisions'::regclass
    and c.contype in ('p','u') and c.conkey=array[
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='user_id'),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='search_id'),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='id')]::smallint[]) then
    alter table public.opportunity_search_query_revisions add constraint opportunity_search_query_revision_owner_id unique(user_id,search_id,id);
  end if;
end $$;
create table public.opportunity_search_query_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid not null,
  query_revision_id uuid not null,
  plan_revision bigint not null check(plan_revision>0),
  base_revision integer not null check(base_revision>0),
  feedback_revision bigint not null check(feedback_revision>=0),
  preference_revision bigint not null check(preference_revision>=0),
  protocol_version text not null,
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=524288),
  plan_hash text not null check(plan_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(user_id,search_id,id),unique(user_id,search_id,plan_revision),unique(user_id,search_id,plan_hash),
  foreign key(user_id,search_id,query_revision_id) references public.opportunity_search_query_revisions(user_id,search_id,id) on delete cascade
);
alter table public.opportunity_search_query_plans enable row level security;
revoke all on public.opportunity_search_query_plans from public,anon,authenticated,service_role;
grant select on public.opportunity_search_query_plans to authenticated;
create policy "Owner query plans" on public.opportunity_search_query_plans for select to authenticated
  using(user_id=(select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
alter table public.opportunity_search_adaptive_settings add constraint opportunity_search_current_plan_owner
  foreign key(user_id,search_id,query_plan_id) references public.opportunity_search_query_plans(user_id,search_id,id) deferrable initially deferred;

create function public.job_workspace_plan_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Query plan revisions are immutable' using errcode='23514'; end;
$$;
revoke all on function public.job_workspace_plan_immutable() from public,anon,authenticated,service_role;
create trigger opportunity_search_query_plan_immutable before update on public.opportunity_search_query_plans for each row execute function public.job_workspace_plan_immutable();

create function public.job_workspace_plan_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.source_reuse_revision:=case when new.successful_source_reuse_enabled then 1 else 0 end;
    if current_user<>'postgres' then new.query_plan_id:=null;new.query_plan_revision:=0;new.query_plan_dirty:=true; end if;
  else
    new.source_reuse_revision:=old.source_reuse_revision+case when (new.successful_source_reuse_enabled,new.reuse_check_interval_hours)
      is distinct from (old.successful_source_reuse_enabled,old.reuse_check_interval_hours) then 1 else 0 end;
    if current_user<>'postgres' then
      new.query_plan_id:=old.query_plan_id;new.query_plan_revision:=old.query_plan_revision;
      new.query_plan_dirty:=old.query_plan_dirty or coalesce(new.query_plan_dirty,true);
    end if;
    if new.feedback_dirty and not old.feedback_dirty or new.feedback_revision is distinct from old.feedback_revision then new.query_plan_dirty:=true; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_plan_settings() from public,anon,authenticated,service_role;
create trigger opportunity_plan_settings before insert or update on public.opportunity_search_adaptive_settings for each row execute function public.job_workspace_plan_settings();

create function public.job_workspace_source_invalidation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid; target uuid; changed boolean:=true;
begin
  if tg_op='DELETE' then owner_id:=old.user_id;target:=old.search_id;
  else owner_id:=new.user_id;target:=new.search_id;
    if tg_op='UPDATE' then changed:=(new.listing_url,new.vacancy_url,new.kind,new.institution,new.topics,new.priority,new.enabled,new.pinned,new.mandatory,new.check_interval_hours,new.owner_disabled)
      is distinct from (old.listing_url,old.vacancy_url,old.kind,old.institution,old.topics,old.priority,old.enabled,old.pinned,old.mandatory,old.check_interval_hours,old.owner_disabled); end if;
  end if;
  if changed then update public.opportunity_search_adaptive_settings set query_plan_dirty=true where user_id=owner_id and search_id=target; end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_source_invalidation() from public,anon,authenticated,service_role;
create trigger opportunity_source_invalidation after insert or update or delete on public.opportunity_search_sources for each row execute function public.job_workspace_source_invalidation();

create function public.save_opportunity_search_source(p_search_id uuid,p_registry_id uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_sources;key text;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  if p_search_id is null or p_registry_id is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
    or p_patch-array['listing_url','vacancy_url','kind','institution','topics','priority','enabled','pinned','mandatory','check_interval_hours']<>'{}'::jsonb then
    raise exception 'Use a supported partial source update' using errcode='22023'; end if;
  perform 1 from public.opportunity_search_templates where id=p_search_id and user_id=actor;
  if not found then raise exception 'Search unavailable' using errcode='42501'; end if;
  foreach key in array array['enabled','pinned','mandatory'] loop
    if p_patch?key and jsonb_typeof(p_patch->key) is distinct from 'boolean' then raise exception 'Source flags must be boolean' using errcode='22023'; end if;
  end loop;
  foreach key in array array['listing_url','vacancy_url','institution'] loop
    if p_patch?key and jsonb_typeof(p_patch->key) not in ('string','null') then raise exception 'Source text must be string or null' using errcode='22023'; end if;
  end loop;
  if p_patch?'topics' and (jsonb_typeof(p_patch->'topics') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_patch->'topics') e where jsonb_typeof(e)<>'string')) then
    raise exception 'Topics must be a bounded string array' using errcode='22023'; end if;
  foreach key in array array['priority','check_interval_hours'] loop
    if p_patch?key and (jsonb_typeof(p_patch->key) is distinct from 'number' or (p_patch->>key)::numeric<>trunc((p_patch->>key)::numeric)) then raise exception 'Source numbers must be integers' using errcode='22023'; end if;
  end loop;
  if p_patch?'kind' and jsonb_typeof(p_patch->'kind') is distinct from 'string' then raise exception 'Source kind must be a string' using errcode='22023'; end if;
  insert into public.opportunity_search_sources(registry_id,user_id,search_id) values(p_registry_id,actor,p_search_id) on conflict(registry_id) do nothing;
  select * into saved from public.opportunity_search_sources where registry_id=p_registry_id and user_id=actor and search_id=p_search_id for update;
  if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
  update public.opportunity_search_sources set
    listing_url=case when p_patch?'listing_url' then p_patch->>'listing_url' else listing_url end,
    vacancy_url=case when p_patch?'vacancy_url' then p_patch->>'vacancy_url' else vacancy_url end,
    kind=case when p_patch?'kind' then p_patch->>'kind' else kind end,
    institution=case when p_patch?'institution' then p_patch->>'institution' else institution end,
    topics=case when p_patch?'topics' then array(select jsonb_array_elements_text(p_patch->'topics')) else topics end,
    priority=case when p_patch?'priority' then (p_patch->>'priority')::integer else priority end,
    enabled=case when p_patch?'enabled' then (p_patch->>'enabled')::boolean else enabled end,
    owner_disabled=case when p_patch?'enabled' then not(p_patch->>'enabled')::boolean else owner_disabled end,
    pinned=case when p_patch?'pinned' then (p_patch->>'pinned')::boolean else pinned end,
    mandatory=case when p_patch?'mandatory' then (p_patch->>'mandatory')::boolean else mandatory end,
    check_interval_hours=case when p_patch?'check_interval_hours' then (p_patch->>'check_interval_hours')::integer else check_interval_hours end
    where registry_id=p_registry_id and user_id=actor and search_id=p_search_id returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.set_opportunity_source_reuse(p_search_id uuid,p_enabled boolean,p_interval_hours integer default 168) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();saved public.opportunity_search_adaptive_settings;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  if p_enabled is null or p_interval_hours is null or p_interval_hours not between 24 and 720 then raise exception 'Choose explicit reuse and a bounded 24–720-hour interval' using errcode='22023'; end if;
  perform 1 from public.opportunity_search_templates where id=p_search_id and user_id=actor;
  if not found then raise exception 'Search unavailable' using errcode='42501'; end if;
  insert into public.opportunity_search_adaptive_settings(user_id,search_id,successful_source_reuse_enabled,reuse_check_interval_hours)
    values(actor,p_search_id,p_enabled,p_interval_hours) on conflict(user_id,search_id) do update set successful_source_reuse_enabled=excluded.successful_source_reuse_enabled,reuse_check_interval_hours=excluded.reuse_check_interval_hours returning * into saved;
  return jsonb_build_object('user_id',actor,'search_id',p_search_id,'successful_source_reuse_enabled',saved.successful_source_reuse_enabled,
    'reuse_check_interval_hours',saved.reuse_check_interval_hours,'source_reuse_revision',saved.source_reuse_revision);
end;
$$;
revoke all on function public.save_opportunity_search_source(uuid,uuid,jsonb),public.set_opportunity_source_reuse(uuid,boolean,integer) from public,anon,service_role;
grant execute on function public.save_opportunity_search_source(uuid,uuid,jsonb),public.set_opportunity_source_reuse(uuid,boolean,integer) to authenticated;

create function private.due_opportunity_search_sources(p_user_id uuid,p_search_id uuid,p_at timestamptz default now()) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('registry_id',registry_id,'listing_url',listing_url,'kind',kind,'institution',institution,'topics',topics,
    'priority',priority,'pinned',pinned,'mandatory',mandatory,'check_interval_hours',check_interval_hours,'last_attempted_at',last_attempted_at,
    'last_successful_at',last_successful_at,'status',status,'action','direct_check') order by mandatory desc,pinned desc,priority desc,registry_id),'[]'::jsonb)
    from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id and enabled and not owner_disabled and listing_url is not null
      and isfinite(p_at) and (greatest(last_attempted_at,last_successful_at) is null or greatest(last_attempted_at,last_successful_at)+make_interval(hours=>check_interval_hours)<=p_at);
$$;
revoke all on function private.due_opportunity_search_sources(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;

create function private.retain_successful_opportunity_source(p_user_id uuid,p_search_id uuid,p_opportunity_id uuid,p_listing_url text,p_registry_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.opportunity_search_adaptive_settings;metric jsonb;url text;checked timestamptz;source record;saved public.opportunity_search_sources;
begin
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  if not found or not settings.successful_source_reuse_enabled then return null; end if;
  metric:=private.opportunity_interest_metric(p_user_id,p_opportunity_id);
  if metric->>'interest_origin'='excluded' or not ((metric->>'interest_origin' in ('explicit_rating','categorical_review') and (metric->>'interest_score')::numeric>=8)
    or coalesce((metric->>'confirmed_submission')::boolean,false)) then return null; end if;
  url:=private.opportunity_feedback_safe_url(p_listing_url);
  if url is null then raise exception 'Use an evidenced public reusable listing URL' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':source:'||url,0));
  select max(private.opportunity_feedback_time(s.value->>'checked_at')) into checked from public.opportunities o cross join lateral jsonb_array_elements(o.sources) s
    where o.id=p_opportunity_id and s.value->>'kind'='official_listing' and s.value->'supports'?'title'
      and private.opportunity_feedback_safe_url(s.value->>'url')=url and private.opportunity_feedback_time(s.value->>'checked_at')<=now();
  if checked is null then return null; end if;
  if p_registry_id is not null then
    select * into saved from public.opportunity_search_sources where registry_id=p_registry_id and user_id=p_user_id and search_id=p_search_id for update;
    if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
    if saved.listing_url is not null and saved.listing_url<>url then raise exception 'The verified listing belongs to a different registry entry' using errcode='22023'; end if;
    if saved.listing_url is null and (saved.vacancy_url is null or not exists(
      select 1 from public.opportunities o cross join lateral(values('official_url',o.official_url),('source_url',o.source_url),('application_url',o.application_url)) v(field,url)
      where o.id=p_opportunity_id and o.data#>>array['url_roles',v.field]='vacancy' and private.opportunity_feedback_safe_url(v.url)=saved.vacancy_url)) then
      return null;
    end if;
  else select * into saved from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id and listing_url=url for update;
  end if;
  if saved.owner_disabled then return to_jsonb(saved); end if;
  if saved.registry_id is null then
    insert into public.opportunity_search_sources(user_id,search_id,listing_url,enabled,kind,provenance,listing_verified_at,status,check_interval_hours)
      values(p_user_id,p_search_id,url,true,'other','evidenced_listing',checked,'ready',settings.reuse_check_interval_hours) returning * into saved;
  else
    update public.opportunity_search_sources set listing_url=url,enabled=true,listing_verified_at=greatest(listing_verified_at,checked),
      status=case when status='pending_identification' then 'ready' else status end,
      provenance=case when provenance='candidate' then 'evidenced_listing' else provenance end,
      check_interval_hours=case when status='pending_identification' and not pinned and not mandatory and provenance<>'explicit' then settings.reuse_check_interval_hours else check_interval_hours end
      where registry_id=saved.registry_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function private.retain_successful_opportunity_source(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function private.validate_opportunity_search_plan(p_user_id uuid,p_search_id uuid,p_document jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare entry jsonb;hint jsonb;query_uuid uuid;source_uuid uuid;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or p_document-array['schema_version','queries']<>'{}'::jsonb
    or p_document->'schema_version' is distinct from '2'::jsonb or jsonb_typeof(p_document->'queries') is distinct from 'array'
    or jsonb_array_length(p_document->'queries') not between 1 and 30 or octet_length(p_document::text)>524288 then
    raise exception 'Use a version-2 plan with 1–30 queries' using errcode='22023'; end if;
  for entry in select e.value from jsonb_array_elements(p_document->'queries') e loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['query_id','query','text_hash','role','manual','sources','source_registry_id']<>'{}'::jsonb
      or not(entry?&array['query_id','query','text_hash','role','manual'])
      or jsonb_typeof(entry->'query_id') is distinct from 'string' or entry->>'query_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'query') is distinct from 'string' or char_length(btrim(entry->>'query')) not between 3 and 2000
      or entry->>'query' ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']')
      or jsonb_typeof(entry->'text_hash') is distinct from 'string' or entry->>'text_hash' is distinct from encode(sha256(convert_to(entry->>'query','UTF8')),'hex')
      or jsonb_typeof(entry->'role') is distinct from 'string' or entry->>'role' not in ('core','adaptive','exploration') or jsonb_typeof(entry->'manual') is distinct from 'boolean'
      or entry->'manual'='true'::jsonb and entry->>'role'<>'core' then
      raise exception 'Invalid versioned query identity, text, hash or role' using errcode='22023'; end if;
    query_uuid:=(entry->>'query_id')::uuid;
    if entry?'source_registry_id' then
      if jsonb_typeof(entry->'source_registry_id') is distinct from 'string' or entry->>'source_registry_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Use an owned source registry reference' using errcode='22023'; end if;
      source_uuid:=(entry->>'source_registry_id')::uuid;
      if not exists(select 1 from public.opportunity_search_sources where registry_id=source_uuid and user_id=p_user_id and search_id=p_search_id) then
        raise exception 'Source unavailable' using errcode='42501'; end if;
    end if;
    if entry?'sources' then
      if jsonb_typeof(entry->'sources') is distinct from 'array' or jsonb_array_length(entry->'sources')>16 then
        raise exception 'Use at most 16 public source hints' using errcode='22023'; end if;
      for hint in select e.value from jsonb_array_elements(entry->'sources') e loop
        if jsonb_typeof(hint) is distinct from 'string' or not(private.opportunity_feedback_safe_url(hint#>>'{}') is not null or
          (hint#>>'{}' ~ '^[A-Za-z0-9][A-Za-z0-9.-]*[.][A-Za-z][A-Za-z0-9-]*$' and private.opportunity_feedback_safe_url('https://'||(hint#>>'{}')||'/') is not null)) then
          raise exception 'Source hints must be public URLs or domains' using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
  if (select count(distinct (e.value->>'query_id')::uuid) from jsonb_array_elements(p_document->'queries') e)<>jsonb_array_length(p_document->'queries') then
    raise exception 'Query identities must be unique within a plan' using errcode='22023'; end if;
end;
$$;
revoke all on function private.validate_opportunity_search_plan(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.publish_opportunity_search_plan(p_user_id uuid,p_search_id uuid,p_query_revision_id uuid,p_document jsonb,
  p_base_revision integer,p_feedback_revision bigint,p_preference_revision bigint,p_protocol_version text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare anchor public.opportunity_search_query_revisions;settings public.opportunity_search_adaptive_settings;
  prior public.opportunity_search_query_plans;saved public.opportunity_search_query_plans;query jsonb;fingerprint text;next_revision bigint;current_base integer;
begin
  select revision into current_base from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id;
  if not found then raise exception 'Search unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':query-plan',0));
  select * into anchor from public.opportunity_search_query_revisions where id=p_query_revision_id and user_id=p_user_id and search_id=p_search_id;
  if not found or anchor.template_revision is distinct from p_base_revision or anchor.protocol_version is distinct from p_protocol_version then
    raise exception 'Use the exact saved v1 base/core query revision' using errcode='22023'; end if;
  if p_base_revision is distinct from current_base or p_feedback_revision is null or p_feedback_revision<0 or p_preference_revision is null or p_preference_revision<0 then
    raise exception 'Plan basis is stale or invalid' using errcode='40001'; end if;
  if p_preference_revision<>0 then raise exception 'Approved preference revisions require the later preference contract' using errcode='40001'; end if;
  if p_protocol_version is distinct from (select active_protocol_version from private.opportunity_search_settings where singleton) then
    raise exception 'The active technical protocol changed before plan publication' using errcode='40001'; end if;
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;
  if p_feedback_revision is distinct from settings.feedback_revision then raise exception 'Feedback changed before plan publication' using errcode='40001'; end if;
  if settings.structured_feedback_enabled and settings.feedback_dirty then raise exception 'Compile current authorized feedback before publishing its query plan' using errcode='40001'; end if;
  perform private.validate_opportunity_search_plan(p_user_id,p_search_id,p_document);
  -- Every legacy base query remains a core query; preserve exact strings/source
  -- hints rather than inventing provenance or silently rewriting old arrays.
  for query in select e.value from jsonb_array_elements(anchor.queries) e loop
    if not exists(select 1 from jsonb_array_elements(p_document->'queries') q where q.value->>'role'='core'
      and q.value->>'query'=query->>'query' and coalesce(q.value->'sources','[]')=coalesce(query->'sources','[]')) then
      raise exception 'The saved base/core queries must be preserved' using errcode='22023'; end if;
  end loop;
  select * into prior from public.opportunity_search_query_plans where id=settings.query_plan_id and user_id=p_user_id and search_id=p_search_id;
  if not found then
    select * into prior from public.opportunity_search_query_plans where user_id=p_user_id and search_id=p_search_id order by plan_revision desc limit 1;
  end if;
  if found then
    for query in select e.value from jsonb_array_elements(prior.document->'queries') e where e.value->>'role'='core'
      and (prior.base_revision=p_base_revision or e.value->'manual'='true'::jsonb) loop
      if not exists(select 1 from jsonb_array_elements(p_document->'queries') q where q.value=query) then
        raise exception 'Preserve existing core query identities, text and manual source hints' using errcode='22023'; end if;
    end loop;
  end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('query_revision_id',p_query_revision_id,'base_revision',p_base_revision,
    'feedback_revision',p_feedback_revision,'preference_revision',p_preference_revision,'protocol_version',p_protocol_version,'document',p_document)::text,'UTF8')),'hex');
  select * into saved from public.opportunity_search_query_plans where user_id=p_user_id and search_id=p_search_id and plan_hash=fingerprint;
  if not found then
    select coalesce(max(p.plan_revision),0)+1 into next_revision from public.opportunity_search_query_plans p where p.user_id=p_user_id and p.search_id=p_search_id;
    insert into public.opportunity_search_query_plans(user_id,search_id,query_revision_id,plan_revision,base_revision,feedback_revision,preference_revision,protocol_version,document,plan_hash)
      values(p_user_id,p_search_id,p_query_revision_id,next_revision,p_base_revision,p_feedback_revision,p_preference_revision,p_protocol_version,p_document,fingerprint) returning * into saved;
  end if;
  update public.opportunity_search_adaptive_settings set query_plan_id=saved.id,query_plan_revision=saved.plan_revision,query_plan_dirty=false where user_id=p_user_id and search_id=p_search_id;
  return jsonb_build_object('id',saved.id,'query_revision_id',saved.query_revision_id,'plan_revision',saved.plan_revision,'plan_hash',saved.plan_hash,
    'fingerprint_encoding','sha256-pg-jsonb-v1','basis',jsonb_build_object('base_revision',saved.base_revision,'feedback_revision',saved.feedback_revision,
      'preference_revision',saved.preference_revision,'protocol_version',saved.protocol_version),'document',saved.document);
end;
$$;
revoke all on function private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text) from public,anon,authenticated,service_role;

create function private.read_opportunity_search_plan(p_user_id uuid,p_search_id uuid,p_plan_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare saved public.opportunity_search_query_plans;target uuid:=p_plan_id;
begin
  if target is null then select query_plan_id into target from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id; end if;
  select * into saved from public.opportunity_search_query_plans where user_id=p_user_id and search_id=p_search_id and id=target;
  if not found then return null; end if;
  return jsonb_build_object('id',saved.id,'query_revision_id',saved.query_revision_id,'plan_revision',saved.plan_revision,'plan_hash',saved.plan_hash,
    'fingerprint_encoding','sha256-pg-jsonb-v1','basis',jsonb_build_object('base_revision',saved.base_revision,'feedback_revision',saved.feedback_revision,
      'preference_revision',saved.preference_revision,'protocol_version',saved.protocol_version),'document',saved.document);
end;
$$;
revoke all on function private.read_opportunity_search_plan(uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter table public.opportunity_search_runs add column query_plan_id uuid,
  add constraint opportunity_run_query_plan_owner foreign key(user_id,search_id,query_plan_id)
    references public.opportunity_search_query_plans(user_id,search_id,id) deferrable initially deferred;
create function public.job_workspace_query_plan_pin() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then if current_user<>'postgres' then new.query_plan_id:=null; end if;
  elsif current_user<>'postgres' or old.query_plan_id is not null then new.query_plan_id:=old.query_plan_id; end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_query_plan_pin() from public,anon,authenticated,service_role;
create trigger opportunity_query_plan_pin before insert or update on public.opportunity_search_runs for each row execute function public.job_workspace_query_plan_pin();

create function private.pin_opportunity_search_plan(p_user_id uuid,p_search_id uuid,p_run_id uuid,p_plan_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.opportunity_search_runs;
begin
  select * into run from public.opportunity_search_runs where id=p_run_id and user_id=p_user_id and search_id=p_search_id for update;
  if not found then raise exception 'Search run unavailable' using errcode='42501'; end if;
  if run.query_plan_id is not null then return private.read_opportunity_search_plan(p_user_id,p_search_id,run.query_plan_id); end if;
  if not exists(select 1 from public.opportunity_search_query_plans where id=p_plan_id and user_id=p_user_id and search_id=p_search_id
    and base_revision=run.template_revision and protocol_version=run.protocol_version
    and (run.feedback_snapshot_revision is null or feedback_revision=run.feedback_snapshot_revision)) then
    raise exception 'Plan does not belong to this run basis' using errcode='22023'; end if;
  update public.opportunity_search_runs set query_plan_id=p_plan_id where id=p_run_id;
  return private.read_opportunity_search_plan(p_user_id,p_search_id,p_plan_id);
end;
$$;
revoke all on function private.pin_opportunity_search_plan(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

comment on table public.opportunity_search_sources is 'Owner-scoped reusable listings and pending identification; registry_id is not a canonical evidence source_id or proof of historical discovery.';
comment on table public.opportunity_search_query_plans is 'Immutable v2 extensions anchored to original v1 query revisions. Legacy strict arrays/unique keys and writer remain unchanged.';
notify pgrst,'reload schema';
commit;
