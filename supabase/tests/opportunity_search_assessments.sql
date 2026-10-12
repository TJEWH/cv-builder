-- Synthetic scoring, inspection and evidence regressions. Never retain fixture rows.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); search_id uuid:=gen_random_uuid(); v_run_id uuid:=gen_random_uuid();
  item_id uuid; canonical uuid; second_id uuid:=gen_random_uuid(); result jsonb; original jsonb; payload jsonb; incoming jsonb;
  identity jsonb; rating jsonb; invalid jsonb; field text; score numeric; before_count integer;
  assessment jsonb:='{"score":8.2,"scale_min":0,"scale_max":10,"summary":"Current evidence supports the methods fit.","subscores":{"methods":8.25}}';
begin
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_id,owner_id,'Scale regression','{"topicsAndMethods":"Audio research"}',
      '{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":true}');
  perform private.begin_opportunity_search(search_id,v_run_id);
  perform private.save_opportunity_search_queries(v_run_id,'[{"query":"funded audio phd"}]');
  identity:=jsonb_build_object('opportunity_key','score-fixture-'||search_id::text,'institution','Scale Institute',
    'vacancy_id',search_id::text,'official_url','https://scoring.invalid/jobs/'||search_id::text);
  payload:=identity||jsonb_build_object('title','Research scoring fixture','last_checked_at',clock_timestamp(),
    'sources',jsonb_build_array(jsonb_build_object('url',identity->>'official_url','kind','official','checked_at','2026-01-01T00:00:00Z',
      'supports',jsonb_build_array('personal_fit','rd_career_potential','research_career_potential'))));
  perform private.validate_opportunity_search_result(payload); -- Omission is permitted.
  foreach field in array array['personal_fit','rd_career_potential','research_career_potential'] loop
    foreach score in array array[0,10,8.25]::numeric[] loop
      perform private.validate_opportunity_search_result(payload||jsonb_build_object(field,jsonb_set(assessment,'{score}',to_jsonb(score))));
    end loop;
    for invalid in select value from jsonb_array_elements('[null,{},"very good",4,true,[],{"score":4,"summary":"Unknown scale"}]') loop
      begin
        perform private.submit_opportunity_search_result(v_run_id,gen_random_uuid(),payload||jsonb_build_object(field,invalid));
        raise exception 'FAIL: malformed assessment accepted: %',invalid;
      exception when invalid_parameter_value then null; end;
    end loop;
    for invalid in select value from jsonb_array_elements('["8.2",true,null,-0.1,10.01,"very good"]') loop
      begin
        perform private.validate_opportunity_search_result(payload||jsonb_build_object(field,jsonb_set(assessment,'{score}',invalid)));
        raise exception 'FAIL: invalid score accepted: %',invalid;
      exception when invalid_parameter_value then null; end;
    end loop;
    for invalid in select value from jsonb_array_elements('[{"scale_min":1,"scale_max":5},{"scale_min":"0"},{"scale_max":null},{"summary":" \n\t"},{"summary":false},{"subscores":null},{"subscores":[]},{"subscores":{"methods":"8.2"}},{"subscores":{"methods":11}},{"subscores":{"methods":false}}]') loop
      begin
        perform private.validate_opportunity_search_result(payload||jsonb_build_object(field,assessment||invalid));
        raise exception 'FAIL: invalid assessment metadata accepted: %',invalid;
      exception when invalid_parameter_value then null; end;
    end loop;
  end loop;
  if exists(select 1 from public.opportunity_search_receipts where opportunity_search_receipts.run_id=v_run_id) then
    raise exception 'FAIL: invalid submissions produced receipts';
  end if;
  select count(*) into before_count from public.opportunities;
  result:=private.inspect_opportunity_search_result(v_run_id,identity);
  if result->>'match_count'<>'0' or result->'snapshot'<>'null'::jsonb then raise exception 'FAIL: empty inspection'; end if;
  if (select count(*) from public.opportunities)<>before_count then raise exception 'FAIL: inspection wrote catalogue'; end if;
  for invalid in select value from jsonb_array_elements('[null,{},[],{"title":"not identity"},{"institution":"Alone"},{"opportunity_key":4},{"opportunity_key":" "},{"official_url":"https://scoring.invalid/jobs"}]') loop
    begin perform private.inspect_opportunity_search_result(v_run_id,invalid);
      raise exception 'FAIL: invalid inspection accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin perform private.inspect_opportunity_search_result(gen_random_uuid(),identity);
    raise exception 'FAIL: unknown run inspected'; exception when invalid_parameter_value then null; end;

  -- Simulate a concurrent discovery after a no-match inspection; submit must recheck.
  original:='{"score":4,"summary":"Original historical rationale","subscores":{"legacy":5},"label":"very good"}';
  insert into public.opportunities(opportunity_key,title,institution,vacancy_id,official_url,personal_fit,rd_career_potential,research_career_potential,sources)
    values(identity->>'opportunity_key','Existing research','Scale Institute',identity->>'vacancy_id',identity->>'official_url',original,original,original,payload->'sources') returning id into canonical;
  result:=private.inspect_opportunity_search_result(v_run_id,identity);
  if result->>'match_count'<>'1' or (result->>'opportunity_id')::uuid<>canonical
    or result#>'{snapshot,personal_fit}'<>original then raise exception 'FAIL: canonical evidence not returned'; end if;
  if private.inspect_opportunity_search_result(v_run_id,identity-'opportunity_key'-'official_url')->>'opportunity_id'<>canonical::text then
    raise exception 'FAIL: scoped vacancy lookup'; end if;
  if private.inspect_opportunity_search_result(v_run_id,jsonb_build_object('source_url','http://SCORING.invalid/jobs/'||search_id::text||'/?utm_source=test#top'))->>'opportunity_id'<>canonical::text then
    raise exception 'FAIL: cross-field normalized URL lookup'; end if;
  incoming:=payload||jsonb_build_object('personal_fit',assessment,'rd_career_potential',assessment,'research_career_potential',assessment);
  -- Bounds alone cannot strengthen the same source evidence.
  item_id:=gen_random_uuid(); result:=private.submit_opportunity_search_result(v_run_id,item_id,incoming);
  if result#>'{snapshot,personal_fit}'<>original or result->'previous_assessments'<>'{}'::jsonb
    or not (result->'conflicts'?'personal_fit') then raise exception 'FAIL: scale metadata bypassed evidence checks'; end if;
  perform private.verify_opportunity_search_result(v_run_id,item_id);
  -- A later official check supports reassessment. Replace all assessment leaves together.
  incoming:=jsonb_set(incoming,'{sources,0,checked_at}',to_jsonb(clock_timestamp()));
  item_id:=gen_random_uuid(); result:=private.submit_opportunity_search_result(v_run_id,item_id,incoming);
  foreach field in array array['personal_fit','rd_career_potential','research_career_potential'] loop
    if result#>array['snapshot',field]<>assessment or result#>array['previous_assessments',field]<>original then
      raise exception 'FAIL: reassessment merged legacy leaves or lost old evidence';
    end if;
  end loop;
  if (result->>'opportunity_id')::uuid<>canonical or (select count(*) from public.opportunities)<>before_count+1 then
    raise exception 'FAIL: discovery after inspection created a duplicate'; end if;
  if private.submit_opportunity_search_result(v_run_id,item_id,incoming)<>result then raise exception 'FAIL: receipt retry drift'; end if;
  begin perform private.submit_opportunity_search_result(v_run_id,item_id,jsonb_set(incoming,'{personal_fit,score}','9'));
    raise exception 'FAIL: uncertain write changed payload'; exception when unique_violation then null; end;
  result:=private.verify_opportunity_search_result(v_run_id,item_id);
  if result->>'verified'<>'true' or result#>'{current_snapshot,personal_fit}'<>assessment then raise exception 'FAIL: separate verification lost accepted fields'; end if;

  insert into public.opportunities(id,opportunity_key,title,source_url)
    values(second_id,'score-ambiguous-'||second_id::text,'Separate role','https://scoring.invalid/jobs/'||second_id::text);
  begin perform private.inspect_opportunity_search_result(v_run_id,identity||jsonb_build_object('application_url','https://scoring.invalid/jobs/'||second_id::text));
    raise exception 'FAIL: ambiguous inspection selected a record'; exception when unique_violation then null; end;
  foreach field in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(field,'private.inspect_opportunity_search_result(uuid,jsonb)','execute') then
      raise exception 'FAIL: inspection grants too broad for %',field;
    end if;
  end loop;
  execute 'set local role authenticated';
  begin perform private.inspect_opportunity_search_result(v_run_id,identity);
    raise exception 'FAIL: browser inspection allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  raise notice 'PASS: assessment types, scales, inspection, atomic replacement, provenance and access';
end;
$$;
rollback;
