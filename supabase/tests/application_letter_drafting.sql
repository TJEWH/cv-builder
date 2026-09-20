-- Run the complete file as postgres. An exception fails the test; all fixtures roll back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app_a uuid := gen_random_uuid(); app_b uuid := gen_random_uuid();
  second_opportunity uuid := gen_random_uuid(); second_app uuid := gen_random_uuid();
  cv_a uuid := gen_random_uuid(); cv_b uuid := gen_random_uuid(); context_a uuid := gen_random_uuid();
  context_b uuid := gen_random_uuid(); draft_a uuid := gen_random_uuid(); draft_b uuid := gen_random_uuid();
  result jsonb; original jsonb; saved_source jsonb; count_before integer;
  template jsonb := '{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional"}';
  content jsonb := '{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Alex Muster researches !!private research!!."},"experience":{"jobs":[{"id":"job-1","title":"Software Engineer","place":"Neustadt"}]}}';
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title, requirements)
    values (opportunity, 'drafting-test-' || opportunity::text, 'Original research role', '["Robotics"]'),
           (second_opportunity, 'drafting-test-' || second_opportunity::text, 'Other role', '[]');
  select to_jsonb(o) into saved_source from public.opportunities o where id = opportunity;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a, opportunity);
  begin
    perform public.publish_application_drafting_context(context_a, app_a, template, 'en');
    raise exception 'FAIL: published without CV';
  exception when invalid_parameter_value then null; end;
  perform public.assign_job_application_cv(app_a, cv_a, 'Drafting fixture CV', content,
    '{"design":{"fontBody":"Inter","fontHead":"Private name","ink":"#123456","customFonts":[{"name":"Private font"}],"pageMarginTop":"12mm"}}', 7,
    '{"notes":"Private notes must remain out of context","contact_email":"employer@example.org"}');
  result := public.publish_application_drafting_context(context_a, app_a, template, 'en', 'Mention !!secret!!. Sign as Alex Muster.', 450);
  original := result;
  if result #>> '{context_json,opportunity,title}' <> 'Original research role'
    or result->>'cv_variant_id' <> cv_a::text
    or result #>> '{context_json,cv,content,contact,name}' <> '{{APPLICANT_NAME}}'
    or result #>> '{context_json,cv,content,about,text}' <> '{{APPLICANT_NAME}} researches {{CONFIDENTIAL}}.'
    or result #>> '{context_json,cv,content,experience,jobs,0,title}' <> 'Software Engineer'
    or result #>> '{context_json,cv,content,experience,jobs,0,place}' <> 'Neustadt'
    or result #>> '{context_json,instructions}' <> 'Mention {{CONFIDENTIAL}}. Sign as {{APPLICANT_NAME}}.'
    or result #> '{context_json,cv,theme}' <> '{"fontBody":"Inter","ink":"#123456","pageMarginTop":"12mm"}'::jsonb
    or result::text like '%Private%' or result::text like '%Alex Muster%' then
    raise exception 'FAIL: authoritative capture or privacy projection';
  end if;
  if public.read_application_drafting_context(context_a) <> original then raise exception 'FAIL: read API changed captured context'; end if;
  if public.publish_application_drafting_context(context_a, app_a, template, 'en', 'Mention !!secret!!. Sign as Alex Muster.', 450) <> original then
    raise exception 'FAIL: context retry changed data';
  end if;
  begin
    perform public.publish_application_drafting_context(context_a, app_a, template, 'de');
    raise exception 'FAIL: changed-input retry accepted';
  exception when unique_violation then null; end;
  begin
    perform public.publish_application_drafting_context(gen_random_uuid(), app_a, template || '{"private":"identity"}', 'en');
    raise exception 'FAIL: unknown template fields';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_application_drafting_context(gen_random_uuid(), app_a, template, 'en', '', 0);
    raise exception 'FAIL: invalid word bound';
  exception when invalid_parameter_value then null; end;
  begin
    update public.drafting_contexts set context_json = '{}' where id = context_a;
    raise exception 'FAIL: authenticated context update';
  exception when insufficient_privilege then null; end;
  result := public.save_application_letter_draft(draft_a, app_a, context_a, 'Draft signed {{APPLICANT_NAME}}.');
  if public.save_application_letter_draft(draft_a, app_a, context_a, 'Draft signed {{APPLICANT_NAME}}.') <> result then
    raise exception 'FAIL: draft retry duplicated or changed data';
  end if;
  begin
    perform public.save_application_letter_draft(draft_a, app_a, context_a, 'Changed draft');
    raise exception 'FAIL: overwrote draft with repeated ID';
  exception when unique_violation then null; end;
  perform public.save_application_letter_draft(draft_b, app_a, context_a, 'Second draft.');
  if (select count(*) from public.motivation_letter_drafts where application_id = app_a) <> 2 then raise exception 'FAIL: draft append history'; end if;
  begin
    update public.motivation_letter_drafts set body = 'Overwrite' where id = draft_a;
    raise exception 'FAIL: authenticated draft update';
  exception when insufficient_privilege then null; end;
  perform public.create_job_application(second_app, second_opportunity);
  begin
    perform public.save_application_letter_draft(gen_random_uuid(), second_app, context_a, 'Wrong application');
    raise exception 'FAIL: same-owner cross-application context';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.motivation_letter_drafts(user_id, application_id, context_id, body)
      values(user_a, second_app, context_a, 'Forged direct insert');
    raise exception 'FAIL: direct cross-application context';
  exception when foreign_key_violation then null; end;
  -- Later source and assignment changes cannot rewrite the old captured bundle.
  execute 'reset role';
  update public.opportunities set title = 'Later role' where id = opportunity;
  begin
    update public.drafting_contexts set context_json = '{}' where id = context_a;
    raise exception 'FAIL: privileged context update';
  exception when check_violation then null; end;
  begin
    update public.motivation_letter_drafts set body = 'Overwrite' where id = draft_a;
    raise exception 'FAIL: privileged draft update';
  exception when check_violation then null; end;
  execute 'set local role authenticated';
  perform public.refresh_job_application_context(app_a);
  perform public.assign_job_application_cv(app_a, cv_b, 'Drafting fixture newer CV', content, '{}', 7, '{}');
  if public.read_application_drafting_context(context_a) <> original then raise exception 'FAIL: existing context changed after refresh/assignment'; end if;
  result := public.publish_application_drafting_context(gen_random_uuid(), app_a, template, 'en');
  if result #>> '{context_json,opportunity,title}' <> 'Later role' or result->>'cv_variant_id' <> cv_b::text then
    raise exception 'FAIL: new context failed to capture current assignment';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists(select 1 from public.drafting_contexts where id = context_a) or exists(select 1 from public.motivation_letter_drafts where id = draft_a) then
    raise exception 'FAIL: another user reads private drafting history';
  end if;
  begin
    perform public.read_application_drafting_context(context_a);
    raise exception 'FAIL: read RPC crosses account';
  exception when insufficient_privilege then null; end;
  begin
    perform public.publish_application_drafting_context(gen_random_uuid(), app_a, template, 'en');
    raise exception 'FAIL: publish RPC crosses account';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_application_letter_draft(gen_random_uuid(), app_a, context_a, 'Cross-account');
    raise exception 'FAIL: write RPC crosses account';
  exception when insufficient_privilege then null; end;
  perform public.create_job_application(app_b, opportunity);
  begin
    insert into public.motivation_letter_drafts(user_id, application_id, context_id, body)
      values(user_b, app_b, context_a, 'Cross-account direct insert');
    raise exception 'FAIL: direct write crosses account';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.motivation_letter_drafts(user_id, application_id, context_id, body)
      values(user_a, app_a, context_a, 'Owner spoof');
    raise exception 'FAIL: owner spoof';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  if exists(select 1 from public.drafting_contexts where id = context_a) then raise exception 'FAIL: anonymous user reads context'; end if;
  begin
    perform public.read_application_drafting_context(context_a);
    raise exception 'FAIL: anonymous RPC';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.save_application_letter_draft(gen_random_uuid(), app_a, context_a, 'Anonymous');
    raise exception 'FAIL: signed-out RPC';
  exception when insufficient_privilege then null; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  -- A direct insert cannot forge the source CV, opportunity, or timestamp.
  insert into public.drafting_contexts(id, user_id, application_id, cv_variant_id, created_at, context_json)
    values (context_b, user_a, app_a, cv_a, '2001-01-01', jsonb_build_object('template',template,'language','en','instructions','','maxWords',500,'opportunity','forged','cv','forged'));
  result := public.read_application_drafting_context(context_b);
  if result->>'cv_variant_id' <> cv_b::text or result #>> '{context_json,opportunity,title}' <> 'Later role'
    or (result->>'created_at')::timestamptz = '2001-01-01'::timestamptz then raise exception 'FAIL: forged direct context accepted'; end if;
  select count(*) into count_before from public.cv_variants where user_id = user_a;
  perform public.remove_job_application(app_a);
  if exists(select 1 from public.drafting_contexts where application_id = app_a)
    or exists(select 1 from public.motivation_letter_drafts where application_id = app_a) then raise exception 'FAIL: application deletion cascade'; end if;
  if (select count(*) from public.cv_variants where user_id = user_a) <> count_before then raise exception 'FAIL: context cascade deleted CVs'; end if;
  execute 'reset role';
  -- Only the intentional fixture title edit changed the catalogue; context writes did not.
  if (select to_jsonb(o) - 'title' - 'updated_at' from public.opportunities o where id = opportunity) <> saved_source - 'title' - 'updated_at' then
    raise exception 'FAIL: drafting changed shared research';
  end if;
  delete from auth.users where id in (user_a, user_b);
end;
$$;
rollback;
select 'PASS: immutable authoritative drafting context, placeholder privacy, bounded inputs, idempotency, append-only drafts, application/account isolation, anonymous denial and cascade cleanup. All fixtures rolled back.' as result;
