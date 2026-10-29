-- AF-06: automatic useful-source retention requires active, consented adaptation.
-- Requires opportunity_search_preferences.sql. No existing sources are changed.
begin;

create or replace function private.retain_successful_opportunity_source(p_user_id uuid,p_search_id uuid,p_opportunity_id uuid,p_listing_url text,p_registry_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.opportunity_search_adaptive_settings;metric jsonb;url text;checked timestamptz;source record;saved public.opportunity_search_sources;
begin
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  if not found or not settings.adaptation_enabled or settings.adaptation_paused
    or not settings.structured_feedback_enabled or not settings.successful_source_reuse_enabled then return null; end if;
  metric:=private.opportunity_interest_metric(p_user_id,p_opportunity_id);
  if metric->>'interest_origin'='excluded' or not ((metric->>'interest_origin' in ('explicit_rating','categorical_review') and (metric->>'interest_score')::numeric>=8)
    or coalesce((metric->>'confirmed_submission')::boolean,false)) then return null; end if;
  url:=private.opportunity_feedback_safe_url(p_listing_url);
  if url is null then raise exception 'Use an evidenced public reusable listing URL' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':source:'||url,0));
  -- Effective title evidence must bind the current title. The historical source
  -- log can contain rejected claims and cannot establish listing authority.
  select max(private.opportunity_feedback_time(e.value->>'checked_at')) into checked
    from private.opportunity_search_merge_state state join public.opportunities o on o.id=state.opportunity_id
    cross join lateral jsonb_array_elements(coalesce(state.fields#>array['/title','evidence'],'[]'::jsonb)) e
    where o.id=p_opportunity_id and state.fields#>array['/title','value']=to_jsonb(o.title)
      and e.value->>'kind'='official_listing' and e.value->>'precision'='instant'
      and private.opportunity_feedback_safe_url(e.value->>'url')=url
      and private.opportunity_feedback_time(e.value->>'checked_at')<=clock_timestamp();
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
      check_interval_hours=case when (status='pending_identification' or not enabled and provenance='evidenced_listing'
        and last_attempted_at is null and last_successful_at is null) and not pinned and not mandatory and provenance<>'explicit'
        then settings.reuse_check_interval_hours else check_interval_hours end
      where registry_id=saved.registry_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function private.retain_successful_opportunity_source(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

commit;
