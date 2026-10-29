-- AF-02. Additive, owner-scoped drafts, explicit approval and structured consent.
-- Prerequisites: schema.sql, opportunity_feedback_signals.sql, existing search templates.
-- No production backfill, search packet compilation or task operation occurs here.
begin;

-- Existing installations have a global id PK but not necessarily this owner
-- key. Add only the ownership constraint needed by the new composite FK.
do $$ begin
  if not exists(select 1 from pg_constraint c where c.conrelid='public.opportunity_search_templates'::regclass
    and c.contype in ('p','u') and c.conkey=array[
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='user_id'),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='id')]::smallint[]) then
    alter table public.opportunity_search_templates add constraint opportunity_search_templates_owner_id_unique unique(user_id,id);
  end if;
end $$;

alter table public.opportunity_reviews
  add column search_feedback_summary text check (char_length(search_feedback_summary) <= 600),
  add column search_feedback_revision bigint not null default 0 check (search_feedback_revision >= 0),
  add column search_feedback_summary_hash text not null default encode(sha256(''::bytea),'hex'),
  add column search_feedback_source_hash text not null default encode(sha256(''::bytea),'hex'),
  add column search_feedback_approved_at timestamptz,
  add column search_feedback_approved_summary_hash text,
  add column search_feedback_approved_source_hash text;

-- A distinct write to this relation records explicit approval. Ordinary review,
-- comment and textarea draft writes cannot manufacture an approval record.
create table public.opportunity_feedback_summary_approvals (
  user_id uuid not null,
  opportunity_id uuid not null,
  summary_revision bigint not null,
  summary_hash text not null,
  source_hash text not null,
  approved_at timestamptz not null default clock_timestamp(),
  primary key (user_id,opportunity_id),
  foreign key (user_id,opportunity_id) references public.opportunity_reviews(user_id,opportunity_id) on delete cascade
);
alter table public.opportunity_feedback_summary_approvals enable row level security;
revoke all on public.opportunity_feedback_summary_approvals from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.opportunity_feedback_summary_approvals to authenticated;
-- Preserve existing service-role review writes: the invoker review trigger must
-- be able to inspect approval proof. This grants no approval mutation or API.
grant select on public.opportunity_feedback_summary_approvals to service_role;
create policy "Owner summary approvals" on public.opportunity_feedback_summary_approvals for all to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create table public.opportunity_search_adaptive_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  search_id uuid not null,
  structured_feedback_enabled boolean not null default false,
  consent_revision bigint not null default 0 check (consent_revision >= 0),
  consent_updated_at timestamptz,
  primary key (user_id,search_id),
  foreign key (user_id,search_id) references public.opportunity_search_templates(user_id,id) on delete cascade
);
alter table public.opportunity_search_adaptive_settings enable row level security;
revoke all on public.opportunity_search_adaptive_settings from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.opportunity_search_adaptive_settings to authenticated;
create policy "Owner adaptive settings" on public.opportunity_search_adaptive_settings for all to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

-- Pure defense in depth, not a complete anonymizer. No private records are read.
create function public.opportunity_feedback_safe_text(p_text text,p_max_length integer default 600) returns boolean
language sql immutable security invoker set search_path='' as $$
  select coalesce(p_max_length between 1 and 12000 and char_length(p_text) between 1 and p_max_length
    and btrim(p_text)<>''
    and p_text !~ ('['||chr(1)||'-'||chr(8)||chr(11)||chr(12)||chr(14)||'-'||chr(31)||chr(127)||']')
    and p_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    and p_text !~* '(mailto|tel):'
    and p_text !~ '[+]?[0-9][0-9 ()/.-]{5,}[0-9]'
    and p_text !~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    and p_text !~ '(eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})'
    and p_text !~* '(ignore[[:space:]]+((all|any)[[:space:]]+)?(previous|prior|system)|execute_sql|(drop|alter)[[:space:]]+(table|role|schema)|service_role)'
    -- Public URLs have their own typed/sanitized fields, never free-text approval.
    and p_text !~* '(https?://|//[a-z0-9])',false);
$$;
revoke all on function public.opportunity_feedback_safe_text(text,integer) from public,anon,service_role;
grant execute on function public.opportunity_feedback_safe_text(text,integer) to authenticated;

create function public.job_workspace_feedback_sharing() returns trigger
language plpgsql security invoker set search_path='' as $$
declare proof public.opportunity_feedback_summary_approvals; changed boolean;
begin
  if tg_op='INSERT' then
    changed := new.search_feedback_summary is not null or new.comment is not null;
    new.search_feedback_revision := case when changed then 1 else 0 end;
  else
    changed := (new.search_feedback_summary,new.comment) is distinct from (old.search_feedback_summary,old.comment);
    new.search_feedback_revision := old.search_feedback_revision + case when changed then 1 else 0 end;
  end if;
  new.search_feedback_summary_hash := encode(sha256(convert_to(coalesce(new.search_feedback_summary,''),'UTF8')),'hex');
  new.search_feedback_source_hash := encode(sha256(convert_to(coalesce(new.comment,''),'UTF8')),'hex');
  select * into proof from public.opportunity_feedback_summary_approvals
    where user_id=new.user_id and opportunity_id=new.opportunity_id
      and summary_revision=new.search_feedback_revision and summary_hash=new.search_feedback_summary_hash
      and source_hash=new.search_feedback_source_hash;
  new.search_feedback_approved_at := proof.approved_at;
  new.search_feedback_approved_summary_hash := proof.summary_hash;
  new.search_feedback_approved_source_hash := proof.source_hash;
  return new;
end;
$$;
revoke all on function public.job_workspace_feedback_sharing() from public,anon,authenticated,service_role;
create trigger opportunity_reviews_sharing before insert or update on public.opportunity_reviews
  for each row execute function public.job_workspace_feedback_sharing();

create function public.job_workspace_summary_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
declare review public.opportunity_reviews;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.user_id,new.opportunity_id) is distinct from (old.user_id,old.opportunity_id) then
    raise exception 'Approval identity is immutable' using errcode='23514';
  end if;
  select * into review from public.opportunity_reviews
    where user_id=new.user_id and opportunity_id=new.opportunity_id for update;
  if not found or new.summary_revision is distinct from review.search_feedback_revision
    or new.summary_hash is distinct from review.search_feedback_summary_hash
    or new.source_hash is distinct from review.search_feedback_source_hash then
    raise exception 'Feedback changed. Save and review it before approving.' using errcode='40001';
  end if;
  if not public.opportunity_feedback_safe_text(review.search_feedback_summary,600) then
    raise exception 'Summary contains contact details, credentials or instructions; edit it before approval.' using errcode='22023';
  end if;
  new.approved_at := clock_timestamp();
  if tg_op='UPDATE' and (new.summary_revision,new.summary_hash,new.source_hash)
    is not distinct from (old.summary_revision,old.summary_hash,old.source_hash) then new.approved_at:=old.approved_at; end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_summary_approval() from public,anon,authenticated,service_role;
create trigger opportunity_summary_approval_guard before insert or update on public.opportunity_feedback_summary_approvals
  for each row execute function public.job_workspace_summary_approval();

create function public.job_workspace_summary_approval_cache() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    update public.opportunity_reviews set search_feedback_approved_at=null where user_id=old.user_id and opportunity_id=old.opportunity_id;
  else
    update public.opportunity_reviews set search_feedback_approved_at=new.approved_at where user_id=new.user_id and opportunity_id=new.opportunity_id;
  end if;
  return null;
end;
$$;
revoke all on function public.job_workspace_summary_approval_cache() from public,anon,authenticated,service_role;
create trigger opportunity_summary_approval_cache after insert or update or delete on public.opportunity_feedback_summary_approvals
  for each row execute function public.job_workspace_summary_approval_cache();

create function public.job_workspace_feedback_consent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.user_id,new.search_id) is distinct from (old.user_id,old.search_id) then
    raise exception 'Adaptive settings identity is immutable' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    new.consent_revision:=case when new.structured_feedback_enabled then 1 else 0 end;
    new.consent_updated_at:=case when new.structured_feedback_enabled then clock_timestamp() else null end;
  else
    new.consent_revision:=old.consent_revision+case when new.structured_feedback_enabled is distinct from old.structured_feedback_enabled then 1 else 0 end;
    new.consent_updated_at:=case when new.structured_feedback_enabled is distinct from old.structured_feedback_enabled then clock_timestamp() else old.consent_updated_at end;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_feedback_consent() from public,anon,authenticated,service_role;
create trigger opportunity_feedback_consent before insert or update on public.opportunity_search_adaptive_settings
  for each row execute function public.job_workspace_feedback_consent();

create function public.save_opportunity_feedback(p_opportunity_id uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.opportunity_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  if p_opportunity_id is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
    or p_patch-array['interest_rating','interest_reasons','feedback_excluded','search_feedback_summary']<>'{}'::jsonb then
    raise exception 'Use a supported partial feedback update' using errcode='22023';
  end if;
  if p_patch?'interest_rating' and p_patch->'interest_rating'<>'null'::jsonb
    and (jsonb_typeof(p_patch->'interest_rating') is distinct from 'number' or not ((p_patch->>'interest_rating')::numeric between 0 and 10)) then
    raise exception 'Interest rating must be a number from 0 to 10' using errcode='22023';
  end if;
  if p_patch?'feedback_excluded' and jsonb_typeof(p_patch->'feedback_excluded') is distinct from 'boolean' then
    raise exception 'Feedback exclusion must be boolean' using errcode='22023'; end if;
  if p_patch?'search_feedback_summary' and p_patch->'search_feedback_summary'<>'null'::jsonb
    and (jsonb_typeof(p_patch->'search_feedback_summary') is distinct from 'string' or char_length(p_patch->>'search_feedback_summary')>600) then
    raise exception 'Summary must be at most 600 characters' using errcode='22023'; end if;
  perform 1 from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'Opportunity unavailable' using errcode='42501'; end if;
  insert into public.opportunity_reviews(user_id,opportunity_id) values(actor,p_opportunity_id) on conflict(user_id,opportunity_id) do nothing;
  update public.opportunity_reviews set
    interest_rating=case when p_patch?'interest_rating' then (p_patch->>'interest_rating')::numeric else interest_rating end,
    interest_reasons=case when p_patch?'interest_reasons' then p_patch->'interest_reasons' else interest_reasons end,
    feedback_excluded=case when p_patch?'feedback_excluded' then (p_patch->>'feedback_excluded')::boolean else feedback_excluded end,
    search_feedback_summary=case when p_patch?'search_feedback_summary' then nullif(p_patch->>'search_feedback_summary','') else search_feedback_summary end
  where user_id=actor and opportunity_id=p_opportunity_id returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.approve_opportunity_feedback_summary(p_opportunity_id uuid,p_summary_hash text,p_source_hash text,p_summary_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.opportunity_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  select * into saved from public.opportunity_reviews where user_id=actor and opportunity_id=p_opportunity_id for update;
  if not found then raise exception 'Feedback unavailable' using errcode='42501'; end if;
  insert into public.opportunity_feedback_summary_approvals(user_id,opportunity_id,summary_revision,summary_hash,source_hash)
    values(actor,p_opportunity_id,p_summary_revision,p_summary_hash,p_source_hash)
    on conflict(user_id,opportunity_id) do update set summary_revision=excluded.summary_revision,summary_hash=excluded.summary_hash,source_hash=excluded.source_hash;
  select * into saved from public.opportunity_reviews where user_id=actor and opportunity_id=p_opportunity_id;
  return to_jsonb(saved);
end;
$$;

create function public.revoke_opportunity_feedback_summary(p_opportunity_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.opportunity_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  select * into saved from public.opportunity_reviews where user_id=actor and opportunity_id=p_opportunity_id for update;
  if not found then raise exception 'Feedback unavailable' using errcode='42501'; end if;
  delete from public.opportunity_feedback_summary_approvals where user_id=actor and opportunity_id=p_opportunity_id;
  select * into saved from public.opportunity_reviews where user_id=actor and opportunity_id=p_opportunity_id;
  return to_jsonb(saved);
end;
$$;

create function public.read_opportunity_feedback_settings(p_search_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; saved public.opportunity_search_adaptive_settings;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  select id into target from public.opportunity_search_templates where user_id=actor and (p_search_id is null or id=p_search_id) order by updated_at desc,id limit 1;
  if p_search_id is not null and target is null then raise exception 'Search unavailable' using errcode='42501'; end if;
  select * into saved from public.opportunity_search_adaptive_settings where user_id=actor and search_id=target;
  return jsonb_build_object('user_id',actor,'search_id',target,'structured_feedback_enabled',coalesce(saved.structured_feedback_enabled,false),
    'consent_revision',coalesce(saved.consent_revision,0),'consent_updated_at',saved.consent_updated_at);
end;
$$;

create function public.set_opportunity_feedback_consent(p_search_id uuid,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.opportunity_search_adaptive_settings;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  if p_search_id is null or p_enabled is null then raise exception 'A saved search and explicit choice are required' using errcode='22023'; end if;
  perform 1 from public.opportunity_search_templates where id=p_search_id and user_id=actor;
  if not found then raise exception 'Search unavailable' using errcode='42501'; end if;
  insert into public.opportunity_search_adaptive_settings(user_id,search_id,structured_feedback_enabled) values(actor,p_search_id,p_enabled)
    on conflict(user_id,search_id) do update set structured_feedback_enabled=excluded.structured_feedback_enabled returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.save_opportunity_feedback(uuid,jsonb),public.approve_opportunity_feedback_summary(uuid,text,text,bigint),
  public.revoke_opportunity_feedback_summary(uuid),public.read_opportunity_feedback_settings(uuid),public.set_opportunity_feedback_consent(uuid,boolean) from public,anon,service_role;
grant execute on function public.save_opportunity_feedback(uuid,jsonb),public.approve_opportunity_feedback_summary(uuid,text,text,bigint),
  public.revoke_opportunity_feedback_summary(uuid),public.read_opportunity_feedback_settings(uuid),public.set_opportunity_feedback_consent(uuid,boolean) to authenticated;

comment on column public.opportunity_reviews.search_feedback_summary is 'Separate private draft. Only its exact explicitly approved safe version may enter adaptive feedback; raw comments remain private.';
comment on table public.opportunity_feedback_summary_approvals is 'Explicit owner approval proof for an exact summary and private-source revision/hash. Contains no raw comment or summary text.';
notify pgrst,'reload schema';
commit;
