-- Pure validator checks; no stored user data is read or written.
begin;
do $$
declare
  request_id uuid:=gen_random_uuid(); pair jsonb; invalid jsonb; other jsonb; operations jsonb;
  source_text text:='Built reserach tools in 2023 with {{PRIVATE_1}}. See https://example.org/report.';
  corrected text:='Built research tools in 2023 with {{PRIVATE_1}}. See https://example.org/report.';
  request_value jsonb; fix jsonb;
begin
  for pair in select value from jsonb_array_elements('[
    ["Built reserach tools.","Built research tools."],
    ["Studied teh results.","Studied the results."],
    ["Gained experiance.","Gained experience."],
    ["Ran succesfull experiments.","Ran successful experiments."],
    ["Used succesfully tested tools.","Used successfully tested tools."],
    ["Documented Reserach.","Documented Research."],
    ["Präzise Messugnen.","Präzise Messungen."],
    ["😀 Studied reserach.\n\tBuilt tools.","😀 Studied research.\n\tBuilt tools."]
  ]'::jsonb) loop
    perform public.refinement_validate_typo_fix(pair->>0,pair->>1,request_id);
  end loop;
  request_value:=jsonb_build_object('cvStructure',jsonb_build_object(
    'ranges',jsonb_build_array(jsonb_build_object('id','range-1','fieldId','field-1','bulletId','bullet-1','text',source_text)),
    'bullets',jsonb_build_array(jsonb_build_object('id','bullet-1','fieldId','field-1','entryId','entry-1','text',source_text)),
    'entries',jsonb_build_array(jsonb_build_object('id','entry-1','bulletIds',jsonb_build_array('bullet-1','bullet-2')))));
  fix:=jsonb_build_object('id','change-1','type','fix_typos','targetId','range-1','text',corrected,'explanation','Correct the spelling of research.');
  operations:=jsonb_build_object('cvOperations',jsonb_build_array(fix),'cvComments','[]'::jsonb);
  perform public.refinement_validate_cv_operations(operations,request_value,request_id);
  perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations}',jsonb_build_array(fix,
    jsonb_build_object('id','change-2','type','reorder_bullets','targetId','entry-1','order',jsonb_build_array('bullet-2','bullet-1'),'explanation','Prioritize existing evidence.'))),request_value,request_id);
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    to_jsonb(source_text),to_jsonb(''::text),to_jsonb(replace(corrected,'tools','advanced tools')),to_jsonb(replace(corrected,'tools ','')),
    to_jsonb(replace(corrected,'Built','Designed')),to_jsonb(replace(corrected,'research tools','tools research')),
    to_jsonb(replace(corrected,'2023','2024')),to_jsonb(replace(corrected,' ','  ')),to_jsonb(replace(corrected,'tools',E'tools\n')),
    to_jsonb(replace(corrected,'tools','**tools**')),to_jsonb(replace(corrected,'report.','report!')),
    to_jsonb(replace(corrected,'https://example.org/report','https://example.org/reports')),
    to_jsonb(replace(corrected,'{{PRIVATE_1}}','{{PRIVATE_2}}')),to_jsonb(replace(corrected,'{{PRIVATE_1}}','a laboratory')),
    to_jsonb(replace(corrected,'research',repeat('a',65)))
  )) loop
    begin
      perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations,0,text}',invalid),request_value,request_id);
      raise exception 'FAIL: invalid typo correction accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(fix,'{targetId}','"range-999"'),jsonb_set(fix,'{targetId}','"field-1"'),fix||'{"extra":true}',fix-'text'
  )) loop
    begin
      perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations}',jsonb_build_array(invalid)),request_value,request_id);
      raise exception 'FAIL: invalid typo operation shape/target accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  for other in select value from jsonb_array_elements(jsonb_build_array(
    fix||'{"id":"change-2"}',
    jsonb_build_object('id','change-2','type','shorten_text','targetId','range-1','text',replace(source_text,'reserach ',''),'explanation','Shorten evidence.'),
    jsonb_build_object('id','change-2','type','omit_bullet','targetId','bullet-1','explanation','Omit evidence.')
  )) loop
    for invalid in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_array(fix,other),jsonb_build_array(other,fix))) loop
      begin
        perform public.refinement_validate_cv_operations(jsonb_set(operations,'{cvOperations}',invalid),request_value,request_id);
        raise exception 'FAIL: conflicting typo operations accepted';
      exception when invalid_parameter_value then null; end;
    end loop;
  end loop;
  execute 'set local role authenticated';
  perform public.refinement_validate_typo_fix(source_text,corrected,request_id);
  execute 'set local role anon';
  begin perform public.refinement_validate_typo_fix(source_text,corrected,request_id); raise exception 'FAIL: anon validator access'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform public.refinement_close_spelling('teh','the',1); raise exception 'FAIL: service validator access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
rollback;
select 'PASS: bounded typo fixes, Unicode, private placeholders, numbers, links, formatting, operation conflicts and helper permissions.' as result;
