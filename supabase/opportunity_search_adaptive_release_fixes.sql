-- AF-11 additive release correction. No catalogue/schema conversion/backfill.
-- Submission-only interest remains valid AF-01 feedback, but does not authorize
-- approval of a preference rule without substantive review or discovery proof.
-- Exact PG17 prerequisite: review any different formatter/definition first.
begin;
do $$declare actual text;begin
  actual:=encode(sha256(convert_to(pg_get_functiondef('private.validate_adaptive_proposals(jsonb,jsonb)'::regprocedure),'UTF8')),'hex');
  if actual is distinct from '8eca1d0241ebf1e405f96829453c6fbb3165a7f4fc8f25a231570f65e5438864' then
    raise exception 'Reviewed adaptive proposal prerequisite differs' using errcode='55000';end if;
end $$;

create or replace function private.validate_adaptive_proposals(p_scope jsonb,p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
<<proposal_validator>>
declare actor uuid:=(p_scope->>'user_id')::uuid;search uuid:=(p_scope->>'search_id')::uuid;settings public.opportunity_search_adaptive_settings;
  list text;kind text;entry jsonb;proposal jsonb;refs jsonb;ref jsonb;evidence_id uuid;owned boolean;reviewed boolean;verified boolean;excluded boolean;
  status text;reason text;result jsonb:='[]';seen uuid[]:='{}';suggestion_id_value uuid;
begin
  select * into settings from public.opportunity_search_adaptive_settings where user_id=actor and search_id=search;
  foreach list in array array['preference_suggestions','source_suggestions','query_suggestions'] loop
    if not(p_payload?list) then continue;end if;
    if jsonb_typeof(p_payload->list) is distinct from 'array' or jsonb_array_length(p_payload->list)>16 then raise exception 'Bound future proposals' using errcode='22023';end if;
    kind:=case list when 'preference_suggestions' then 'preference' when 'source_suggestions' then 'source' else 'query' end;
    for entry in select value from jsonb_array_elements(p_payload->list) loop
      if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'suggestion_id') is distinct from 'string'
        or entry->>'suggestion_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid proposal identity' using errcode='22023';end if;
      suggestion_id_value:=(entry->>'suggestion_id')::uuid;
      if suggestion_id_value=any(seen) then raise exception 'Duplicate proposal identity' using errcode='22023';end if;seen:=array_append(seen,suggestion_id_value);
      if kind='preference' then
        if entry-array['suggestion_id','rule']<>'{}'::jsonb or not private.opportunity_search_adaptive_shape('rule',entry->'rule') then raise exception 'Invalid typed preference proposal' using errcode='22023';end if;
        proposal:=entry->'rule';refs:=proposal->'evidence_refs';
        if proposal->>'kind'='source_exclusion' and not exists(select 1 from public.opportunity_search_sources where registry_id=(proposal->>'source_registry_id')::uuid and user_id=actor and search_id=search) then raise exception 'Proposal scope denied' using errcode='42501';end if;
      elsif kind='source' then
        if entry-array['suggestion_id','kind','vacancy_url','evidence_refs']<>'{}'::jsonb or entry->>'kind' is distinct from 'candidate'
          or jsonb_typeof(entry->'vacancy_url') is distinct from 'string' or private.opportunity_feedback_safe_url(entry->>'vacancy_url') is null then raise exception 'Invalid source candidate proposal' using errcode='22023';end if;
        refs:=entry->'evidence_refs';proposal:=jsonb_build_object('kind','candidate','vacancy_url',private.opportunity_feedback_safe_url(entry->>'vacancy_url'));
      else
        if entry-array['suggestion_id','query','evidence_refs']<>'{}'::jsonb or jsonb_typeof(entry->'query') is distinct from 'string'
          or char_length(btrim(entry->>'query'))<3 or not private.opportunity_search_adaptive_text(entry->>'query',2000) then raise exception 'Invalid future query proposal' using errcode='22023';end if;
        refs:=entry->'evidence_refs';proposal:=jsonb_build_object('query',entry->'query');
      end if;
      if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs) not between 1 and 16 then raise exception 'Proposals need bounded owned evidence references' using errcode='22023';end if;
      status:='pending';reason:=null;
      for ref in select value from jsonb_array_elements(refs) loop
        if jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid evidence reference' using errcode='22023';end if;
        evidence_id:=(ref#>>'{}')::uuid;
        select exists(select 1 from public.opportunity_reviews r where r.user_id=actor and r.opportunity_id=evidence_id),
          exists(select 1 from public.opportunity_reviews r where r.user_id=actor and r.opportunity_id=evidence_id and r.feedback_excluded)
          into owned,excluded;
        owned:=owned or exists(select 1 from public.applications a where a.user_id=actor and a.opportunity_id=evidence_id)
          or exists(select 1 from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=search and d.opportunity_id=evidence_id)
          or exists(select 1 from public.opportunity_search_receipts r join public.opportunity_search_runs run on run.id=r.run_id where r.user_id=actor and run.search_id=search and r.opportunity_id=evidence_id);
        if not owned then raise exception 'Proposal scope denied' using errcode='42501';end if;
        -- A confirmed submission is an interest-score fallback, not substantive
        -- owner review. Match the approved-rule evidence contract exactly;
        -- missing review proof defers this inert proposal, not canonical facts.
        reviewed:=not excluded and(exists(select 1 from public.opportunity_reviews r where r.user_id=actor and r.opportunity_id=evidence_id
          and(r.state<>'unreviewed' or r.interest_rating is not null or r.interest_reasons<>'[]'::jsonb or r.search_feedback_approved_at is not null))
          or exists(select 1 from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=search
            and d.opportunity_id=evidence_id and d.verified_at is not null));
        verified:=exists(select 1 from public.opportunity_search_discoveries d where d.user_id=actor and d.search_id=search and d.opportunity_id=evidence_id and d.verified_at is not null) or reviewed;
        if excluded or kind='preference' and not reviewed then status:='deferred';reason:='needs_reviewed_evidence';
        elsif not verified and status<>'deferred' then status:='awaiting_verification';reason:='needs_verified_evidence';end if;
      end loop;
      if kind='preference' and not coalesce(settings.adaptation_enabled and settings.structured_feedback_enabled and not settings.adaptation_paused,false) then status:='deferred';reason:='adaptation_disabled';end if;
      if kind='preference' and status='pending' then proposal:=public.opportunity_search_validate_preference_rule(actor,search,proposal,true);end if;
      if exists(select 1 from public.opportunity_search_adaptive_proposals p where p.user_id=actor and p.search_id=search and p.suggestion_id=suggestion_id_value
        and(p.kind,p.proposal,p.evidence_refs) is distinct from(proposal_validator.kind,proposal_validator.proposal,array(select (r#>>'{}')::uuid from jsonb_array_elements(refs) r))) then raise exception 'Proposal identity changed' using errcode='40001';end if;
      result:=result||jsonb_build_array(jsonb_build_object('suggestion_id',suggestion_id_value,'kind',kind,'proposal',proposal,'evidence_refs',refs,'status',status,'reason',reason));
    end loop;
  end loop;
  return result;
end;
$$;
revoke all on function private.validate_adaptive_proposals(jsonb,jsonb) from public,anon,authenticated,service_role;
commit;
