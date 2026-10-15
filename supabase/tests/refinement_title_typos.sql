-- Pure validator checks; no stored user data is read or written.
begin;
do $$
declare
  request_id uuid:=gen_random_uuid(); fields jsonb; structure jsonb; legacy jsonb; invalid jsonb;
  request_value jsonb; operation jsonb; operations jsonb; bullet_structure jsonb;
begin
  fields:='[{"id":"field-1","text":"Reserach Assistant"}]'::jsonb;
  structure:='{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[{"id":"range-1","fieldId":"field-1","bulletId":null,"text":"Reserach Assistant","label":"Role","typoOnly":true}],"unsupported":[]}'::jsonb;
  perform public.refinement_validate_cv_structure(structure,fields);
  request_value:=jsonb_build_object('cvStructure',structure,'cv',jsonb_build_object('fields',fields));
  operation:='{"id":"change-1","type":"fix_typos","targetId":"range-1","text":"Research Assistant","explanation":"Correct the spelling of research."}'::jsonb;
  operations:=jsonb_build_object('cvOperations',jsonb_build_array(operation),'cvComments','[]'::jsonb);
  perform public.refinement_validate_cv_operations(operations,request_value,request_id);

  -- Titles cannot gain the extractive shortening permission of ordinary prose.
  begin
    perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations}',jsonb_build_array(
      operation||'{"type":"shorten_text","text":"Assistant"}')),request_value,request_id);
    raise exception 'FAIL: title shortening was accepted';
  exception when invalid_parameter_value then null; end;

  -- Historical requests without the optional capability keep their behavior.
  legacy:=structure#-'{ranges,0,typoOnly}';
  perform public.refinement_validate_cv_structure(legacy,fields);
  perform public.refinement_validate_cv_operations(operations,jsonb_set(request_value,'{cvStructure}',legacy),request_id);
  perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations}',jsonb_build_array(
    operation||'{"type":"shorten_text","text":"Assistant"}')),jsonb_set(request_value,'{cvStructure}',legacy),request_id);

  -- The marker is optional, but if present it must be exactly true.
  for invalid in select value from jsonb_array_elements('[false,null,"true",1,{},[]]'::jsonb) loop
    begin
      perform public.refinement_validate_cv_structure(jsonb_set(structure,'{ranges,0,typoOnly}',invalid),fields);
      raise exception 'FAIL: invalid typo-only capability accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(structure,'{ranges,0,extra}','true'),
    jsonb_set(structure,'{ranges,0,fieldId}','"field-999"'),
    jsonb_set(structure,'{ranges,0,text}','"Assistant"'),
    jsonb_set(structure,'{areas,0,typoOnly}','true'),
    jsonb_set(structure,'{unsupported}','[{"fieldId":"field-1","reason":"Unavailable"}]')
  )) loop
    begin
      perform public.refinement_validate_cv_structure(invalid,fields);
      raise exception 'FAIL: invalid title topology accepted';
    exception when invalid_parameter_value then null; end;
  end loop;

  -- A valid bullet range remains an ordinary range; it cannot use the title marker.
  bullet_structure:=structure||'{"areas":[{"id":"body","sectionIds":["section-1"]},{"id":"sidebar","sectionIds":[]}],"sections":[{"id":"section-1","label":"Experience","area":"body","entryIds":["entry-1"]}],"entries":[{"id":"entry-1","sectionId":"section-1","label":"Entry","bulletIds":["bullet-1"]}],"bullets":[{"id":"bullet-1","entryId":"entry-1","fieldId":"field-1","text":"Reserach Assistant"}]}'::jsonb;
  bullet_structure:=jsonb_set(bullet_structure,'{ranges,0,bulletId}','"bullet-1"');
  perform public.refinement_validate_cv_structure(bullet_structure#-'{ranges,0,typoOnly}',fields);
  begin
    perform public.refinement_validate_cv_structure(bullet_structure,fields);
    raise exception 'FAIL: typo-only bullet range accepted';
  exception when invalid_parameter_value then null; end;

  -- The same spelling protections apply to titles, including frozen placeholders.
  fields:=jsonb_set(fields,'{0,text}','"Reserach Assistant at {{PRIVATE_1}}"');
  structure:=jsonb_set(structure,'{ranges,0,text}',fields#>'{0,text}');
  perform public.refinement_validate_cv_structure(structure,fields);
  request_value:=jsonb_build_object('cvStructure',structure,'cv',jsonb_build_object('fields',fields));
  operations:=jsonb_set(operations,'{cvOperations,0,text}','"Research Assistant at {{PRIVATE_1}}"');
  perform public.refinement_validate_cv_operations(operations,request_value,request_id);
  for invalid in select value from jsonb_array_elements('["Research Assistant at {{PRIVATE_2}}","Research Assistant at a university","Research Associate at {{PRIVATE_1}}","Research  Assistant at {{PRIVATE_1}}"]'::jsonb) loop
    begin
      perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations,0,text}',invalid),request_value,request_id);
      raise exception 'FAIL: title content rewrite accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;

  execute 'set local role authenticated';
  perform public.refinement_validate_cv_structure(structure,fields);
  perform public.refinement_validate_cv_operations(operations,request_value,request_id);
  execute 'set local role anon';
  begin perform public.refinement_validate_cv_structure(structure,fields); raise exception 'FAIL: anonymous topology validator access'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform public.refinement_validate_cv_operations(operations,request_value,request_id); raise exception 'FAIL: service operation validator access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
rollback;
select 'PASS: spelling-only title ranges, legacy range compatibility, strict capability markers, protected text and validator permissions.' as result;
