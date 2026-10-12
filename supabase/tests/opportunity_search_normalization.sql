-- Historical formats, complete validation, URL scope and lossless alignment. Always rollback.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); search_id uuid:=gen_random_uuid(); run_id uuid:=gen_random_uuid();
  row_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); item_id uuid; prefix text:=gen_random_uuid()::text;
  payload jsonb; invalid jsonb; result jsonb; original jsonb; normalized jsonb; incoming jsonb; source jsonb;
  field text; url text; applications_before text; assessments_before text; stamp timestamptz:='2026-01-03T12:00:00Z';
begin
  payload:=jsonb_build_object('opportunity_key','normalization-'||prefix,'title','Normalization fixture',
    'last_checked_at',clock_timestamp(),'sources',jsonb_build_array(jsonb_build_object('url','https://normalization.invalid/jobs/'||prefix,
      'kind','official','checked_at',stamp,'supports',jsonb_build_array('title','research_summary','data','requirements','required_documents'))));
  perform private.validate_opportunity_search_result(payload||'{"requirements":{"required":["Degree"],"preferred":[{"text":"Research experience"}]},"required_documents":{"required":["CV"],"optional":["Portfolio"],"format":"one PDF"},"data":{"teaching_load":{"status":"not_stated"},"research_methods":["DSP"]},"supervisor_research_focus":{"topics":["Audio"]},"supervisor_top_papers":{"papers":[]},"application_url":"mailto:apply@example.invalid","deadline_timezone":"UTC+03:00"}');
  perform private.validate_opportunity_search_result(jsonb_set(payload,'{sources,0,checked_at}','"2026-01-01"'));
  for invalid in select * from jsonb_array_elements('[
    {"institution":42},{"availability":false},{"title":" "},{"topics":[12]},
    {"supervisors":["PI"]},{"contacts":[true]},{"special_features":{}},{"open_questions":[42]},
    {"requirements":false},{"requirements":{"required":"Degree"}},{"required_documents":[7]},
    {"data":{"teaching_load":7}},{"data":{"teaching_load":{"status":true}}},{"data":{"research_methods":[false]}},
    {"data":{"url_roles":{"official_url":"maybe"}}},{"data":{"url_roles":{"other":"vacancy"}}},
    {"salary":"funded"},{"salary":null},{"verification_level":null},{"supervisor_reputation":[]},
    {"supervisor_research_focus":false},{"supervisor_top_papers":17},{"supervisor_top_papers":null},
    {"hardware_software_balance":"balanced"},{"particularly_suitable":"true"},
    {"application_url":"javascript:alert(1)"},{"official_url":"mailto:apply@example.invalid"},
    {"source_url":"https://bad.invalid/space here"},{"application_url":"mailto:invalid"},
    {"deadline":"2026-02-30"},{"start_date":"2026-02-30"},{"deadline_time_local":"24:00"},
    {"deadline_timezone":"EEST"},{"deadline_timezone":"UTC+14:30"},{"deadline_timezone":"not/a_zone"},
    {"last_checked_at":"2026-01-01"},{"last_checked_at":"infinity"},{"sources":[]},{"extra_column":"invalid"}
  ]') loop
    begin
      perform private.validate_opportunity_search_result(payload||invalid);
      raise exception 'FAIL: malformed payload accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  for invalid in select * from jsonb_array_elements('[{"supports":["funding"]},{"supports":["/deadline"]},{"supports":[1]},{"checked_at":"2026-02-30"},{"checked_at":"2026-01-01T24:00:00Z"},{"checked_at":"2026-01-01T09:00:00"},{"url":"https://bad.invalid/space here"},{"kind":true}]') loop
    begin
      perform private.validate_opportunity_search_result(jsonb_set(payload,'{sources,0}',(payload#>'{sources,0}')||invalid));
      raise exception 'FAIL: malformed source accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  source:='{"url":"https://normalization.invalid/legacy","type":"official_ad","checked_at":"2026-01-01","supported_fields":["/deadline","documents","funding"]}';
  normalized:=private.opportunity_search_normalize_source(source);
  if normalized->>'kind'<>'official' or normalized->>'checked_at'<>'2026-01-01' or normalized->'legacy'<>source
    or not (normalized->'supports' @> '["deadline","required_documents"]') or normalized->'unmapped_supports'<>'["funding"]'
    or private.opportunity_search_normalize_source(normalized)<>normalized then raise exception 'FAIL: source normalization is lossy or not idempotent'; end if;
  if private.opportunity_search_evidence_time(source)<>'2026-01-02T14:00:00Z'::timestamptz then raise exception 'FAIL: date precision became a fabricated midnight'; end if;

  foreach url in array array['https://www.cdtnet.eu/projects','https://www.cdtnet.eu/apply-now',
    'https://www.lfb.rwth-aachen.de/de/vakanzen','https://www.robotac.eu/open-positions',
    'https://www.southampton.ac.uk/study/postgraduate-research/apply',
    'https://student-selfservice.soton.ac.uk/BNNRPROD/bzsksrch.P_Search','mailto:apply@example.invalid'] loop
    if private.opportunity_search_normalize_url(url) is not null then raise exception 'FAIL: generic page identifies a vacancy: %',url; end if;
  end loop;
  if private.opportunity_search_normalize_url('https://host.invalid/jobs?id=F1')=private.opportunity_search_normalize_url('https://host.invalid/jobs?id=F2')
    or private.opportunity_search_normalize_url('https://host.invalid/jobs?id=F1') is null then raise exception 'FAIL: meaningful vacancy query lost'; end if;
  if private.opportunity_search_normalize_url('https://host.invalid/jobs/123/apply') is null
    or private.opportunity_search_normalize_url('https://host.invalid/apply?lang=en') is not null then
    raise exception 'FAIL: vacancy application and generic portal queries are conflated'; end if;
  insert into public.opportunities(id,opportunity_key,title,institution,vacancy_id,official_url,source_url,data)
    values(row_id,'norm-a-'||prefix,'Fellowship A','Test network',prefix||'-a','https://norm.invalid/jobs/a-'||prefix,'https://www.cdtnet.eu/projects','{}'),
      (second_id,'norm-b-'||prefix,'Fellowship B','Test network',prefix||'-b','https://norm.invalid/jobs/b-'||prefix,'https://www.cdtnet.eu/projects','{}');
  if cardinality(private.opportunity_search_matches(jsonb_build_object('opportunity_key','norm-a-'||prefix,'source_url','https://www.cdtnet.eu/projects')))<>1 then
    raise exception 'FAIL: shared project page creates ambiguity'; end if;
  update public.opportunities set source_url='https://norm.invalid/network-'||prefix,data='{"url_roles":{"source_url":"context"}}' where id in(row_id,second_id);
  insert into private.opportunity_search_identities(identity_key,opportunity_id) values('url:norm.invalid/network-'||prefix,row_id);
  if cardinality(private.opportunity_search_matches(jsonb_build_object('opportunity_key','new-'||prefix,'source_url','https://norm.invalid/network-'||prefix)))<>0 then
    raise exception 'FAIL: explicitly shared URL still matches a stale alias'; end if;

  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_id,owner_id,'Historical normalization','{"topicsAndMethods":"Research"}',
    '{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":true}');
  perform private.begin_opportunity_search(search_id,run_id);
  perform private.save_opportunity_search_queries(run_id,'[{"query":"funded research"}]');
  perform private.inspect_opportunity_search_result(run_id,jsonb_build_object('opportunity_key','norm-a-'||prefix,'data','{"url_roles":{"source_url":"context"}}'::jsonb));
  begin
    perform private.inspect_opportunity_search_result(run_id,jsonb_build_object('opportunity_key','norm-a-'||prefix,'data','{"research_methods":[]}'::jsonb));
    raise exception 'FAIL: inspection accepted non-identity data';
  exception when invalid_parameter_value then null; end;

  update public.opportunities set research_summary='Richer original evidence',personal_fit='{"score":4,"summary":"Original unverified scale","subscores":{"old":5}}',
    requirements='{"required":["Degree"],"preferred":["Research"]}',required_documents='{"required":["CV"],"format":"one PDF"}',
    deadline='2026-10-01',deadline_time_local='23:59',deadline_timezone='AoE',
    sources=jsonb_build_array(source),data='{"methods":["DSP"],"teaching":{"status":"not_stated"}}' where id=row_id;
  select to_jsonb(o) into original from public.opportunities o where id=row_id;
  normalized:=private.opportunity_search_normalize_record(original);
  if normalized->'personal_fit'<>original->'personal_fit' or normalized->'requirements'<>original->'requirements'
    or normalized->'required_documents'<>original->'required_documents' or normalized->>'deadline_timezone'<>'UTC-12:00'
    or normalized#>>'{data,deadline_timezone_original}'<>'AoE' or normalized#>'{data,research_methods}'<>'["DSP"]'
    or normalized#>'{data,methods}'<>original#>'{data,methods}' or normalized->'last_checked_at'<>original->'last_checked_at'
    or private.opportunity_search_normalize_record(normalized)<>normalized then raise exception 'FAIL: record alignment loses evidence or is not idempotent'; end if;
  if not (private.opportunity_search_normalize_record('{"sources":[],"data":{"teaching":"A","teaching_text":"B"},"deadline_time_local":"23:59"}')
    ->'open_questions') @> '["Normalization review: teaching_load aliases need reconciliation; original values are retained."]' then
    raise exception 'FAIL: ambiguous aliases were guessed'; end if;

  -- An unrelated new official page cannot silently displace incompletely mapped historical official evidence.
  incoming:=payload||jsonb_build_object('opportunity_key','norm-a-'||prefix,'research_summary','Weaker replacement');
  result:=private.submit_opportunity_search_result(run_id,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Richer original evidence' then raise exception 'FAIL: legacy official provenance lost protection'; end if;
  -- Date-only checks may be retained but cannot authorize a changed fact.
  incoming:=jsonb_set(incoming,'{sources,0}',(incoming#>'{sources,0}')||'{"url":"https://normalization.invalid/legacy","checked_at":"2026-01-04"}');
  result:=private.submit_opportunity_search_result(run_id,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Richer original evidence' then raise exception 'FAIL: imprecise date authorized replacement'; end if;
  incoming:=jsonb_set(incoming,'{sources,0,checked_at}','"2026-01-06T12:00:00Z"');
  result:=private.submit_opportunity_search_result(run_id,gen_random_uuid(),incoming);
  if result#>>'{snapshot,research_summary}'<>'Weaker replacement' then raise exception 'FAIL: same-source precise recheck was blocked'; end if;

  select md5(string_agg(to_jsonb(a)::text,'' order by id)) into applications_before from public.applications a;
  select md5(string_agg(jsonb_build_array(id,personal_fit,rd_career_potential,research_career_potential)::text,'' order by id)) into assessments_before from public.opportunities;
  perform private.align_opportunity_search_catalogue();
  if (private.align_opportunity_search_catalogue()->>'changed')::integer<>0 then raise exception 'FAIL: alignment rerun changes data'; end if;
  if applications_before is distinct from (select md5(string_agg(to_jsonb(a)::text,'' order by id)) from public.applications a)
    or assessments_before is distinct from (select md5(string_agg(jsonb_build_array(id,personal_fit,rd_career_potential,research_career_potential)::text,'' order by id)) from public.opportunities) then
    raise exception 'FAIL: alignment changed application snapshots or scores'; end if;
  if not exists(select 1 from private.opportunity_search_normalization_history where opportunity_id=row_id
    and before_snapshot->'personal_fit'=original->'personal_fit' and after_snapshot->'personal_fit'=original->'personal_fit') then
    raise exception 'FAIL: complete before/after provenance missing'; end if;
  execute 'set local role authenticated';
  begin perform private.align_opportunity_search_catalogue(); raise exception 'FAIL: browser can align catalogue'; exception when insufficient_privilege then null; end;
  begin perform 1 from private.opportunity_search_normalization_history; raise exception 'FAIL: browser can read private history'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
rollback;
