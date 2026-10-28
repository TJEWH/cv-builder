CREATE OR REPLACE FUNCTION public.opportunity_search_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare protocol private.opportunity_search_protocols; schema_ready boolean;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
    raise exception 'A non-anonymous signed-in owner is required.' using errcode='42501';
  end if;
  select p.* into protocol from private.opportunity_search_protocols p
    join private.opportunity_search_settings s on s.active_protocol_version=p.version;
  select bool_and(pg_catalog.to_regprocedure(signature) is not null) into schema_ready from unnest(array[
    'private.begin_opportunity_search(uuid,uuid)','private.refresh_opportunity_search_protocol(uuid)',
    'private.save_opportunity_search_queries(uuid,jsonb)','private.inspect_opportunity_search_result(uuid,jsonb)',
    'private.submit_opportunity_search_result(uuid,uuid,jsonb)',
    'private.verify_opportunity_search_result(uuid,uuid)','private.complete_opportunity_search(uuid,jsonb)',
    'private.read_opportunity_search_run(uuid)','private.claim_opportunity_search_schedule(uuid,uuid)',
    'private.confirm_opportunity_search_schedule(uuid,uuid,text,jsonb)',
    'private.opportunity_search_normalize_record(jsonb)','private.opportunity_search_schema_valid(jsonb,jsonb)'
  ]) signature;
  return jsonb_build_object('ready',schema_ready and protocol.version is not null and protocol.contract_version=1
      and protocol.result_schema=private.opportunity_search_result_schema()
      and coalesce(protocol.result_schema#>'{properties,personal_fit,required}' @> '["scale_min","scale_max"]'::jsonb,false),'bootstrap_version',1,
    'protocol_version',protocol.version,'protocol_hash',protocol.protocol_hash,
    'reason',case when not schema_ready then 'Install the complete opportunity search SQL upgrade.'
      when protocol.version is null then 'Install the opportunity search protocol release.'
      when protocol.result_schema is distinct from private.opportunity_search_result_schema() then 'Install the matching opportunity normalization protocol release.'
      when protocol.contract_version<>1 then 'This frontend requires opportunity search bootstrap version 1.'
      when not coalesce(protocol.result_schema#>'{properties,personal_fit,required}' @> '["scale_min","scale_max"]'::jsonb,false) then 'Install the opportunity scoring protocol release.' else null end);
end;
$function$
;
