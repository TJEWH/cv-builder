-- Read-only production verification: synthetic JSON only, no catalogue submissions.
do $check$
declare p jsonb; a jsonb; b jsonb; c jsonb; s jsonb; old_evidence jsonb; result jsonb;
begin
 if (select active_protocol_version from private.opportunity_search_settings where singleton)<>'opportunity-search-v1-canonical-5' then raise exception 'Canonical protocol is not active'; end if;
 if exists(select 1 from public.opportunities o where metadata_schema_version<>5 or not private.opportunity_payload_storage_valid(to_jsonb(o))) then raise exception 'Noncanonical catalogue rows'; end if;
 if to_regprocedure('private.opportunity_search_normalize_record(jsonb)') is not null or to_regprocedure('private.opportunity_search_merge_value(jsonb,jsonb)') is not null or to_regprocedure('private.opportunity_merge_input_schema_v3()') is not null then raise exception 'Compatibility functions remain installed'; end if;
 if private.opportunity_storage_schema()->>'additionalProperties'<>'false' or private.opportunity_search_result_schema()->>'x-canonical-version'<>'5' then raise exception 'Incorrect result schema'; end if;
 if exists(select 1 from private.opportunity_payload_archive a join public.opportunities o on o.id=a.opportunity_id where a.release='canonical-opportunity-v5' and (to_jsonb(o)->'created_at'<>a.before_snapshot->'created_at' or to_jsonb(o)->'updated_at'<>a.before_snapshot->'updated_at')) then raise exception 'Migration changed catalogue timestamps'; end if;
 if private.opportunity_context_checksum()<>(select dependent_context_checksum from private.opportunity_payload_releases where release='canonical-opportunity-v5') then raise exception 'Dependent context checksum changed'; end if;
 s:='[{"url":"https://example.invalid/jobs/smoke","kind":"official","checked_at":"2000-01-01T09:00:00Z","precision":"instant","supports":["title","city","contacts","opportunity_key"]}]';
 p:=jsonb_build_object('opportunity_key','canonical-readonly-smoke','title','Research','city','Espoo','last_checked_at','2000-01-01T09:00:00Z','sources',s,'contacts','[{"name":"Person","roles":["Scientific contact"]}]'::jsonb);
 a:=private.opportunity_merge_plan(null,p,null);
 if a#>>'{value,city}'<>'Espoo' or a#>>'{value,contacts,0,entity_id}' is null then raise exception 'Canonical values or stable IDs missing'; end if;
 old_evidence:=a#>'{state,/city}';
 b:=private.opportunity_merge_plan(a->'value',p||'{"city":"Helsinki"}',a->'state');
 if b#>>'{value,city}'<>'Espoo' or b#>'{state,/city}' is distinct from old_evidence then raise exception 'Rejected field advanced effective evidence'; end if;
 c:=private.opportunity_merge_plan(a->'value',p||'{"city":"Helsinki","merge_control":{"corrections":[{"path":"/city","expected":"Espoo","reason":"Same official notice interpreted correctly."}]}}',a->'state');
 if c#>>'{value,city}'<>'Helsinki' then raise exception 'Same-evidence correction rejected'; end if;
 if jsonb_array_length(private.opportunity_canonical_set('/source_urls','["https://EXAMPLE.invalid/Job","https://example.invalid/Job","https://example.invalid/job"]'))<>2 then raise exception 'Case-sensitive URL path lost'; end if;
 begin
   perform private.validate_opportunity_search_result(p||'{"requirements":{"required":["MSc"]}}');
   raise exception 'Legacy grouped checklist accepted';
 exception when sqlstate '22023' then null;
 end;
end $check$;
