-- Run as postgres; every fixture is rolled back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app_a uuid := gen_random_uuid(); app_b uuid := gen_random_uuid();
  cv_a uuid := gen_random_uuid(); draft_a uuid := gen_random_uuid();
  saved_context jsonb; saved_source jsonb; got jsonb;
  content jsonb := '{"contact":{"name":"Alex Muster","location":"","role":"","email":"muster-ex@mp.le","phone":"","website":"","linkedin":"","github":""}}';
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title, requirements, required_documents)
    values (opportunity, 'checklist-test-' || opportunity::text, 'Checklist test', '["Degree"]', '["CV","Letter"]');
  select to_jsonb(o) into saved_source from public.opportunities o where id = opportunity;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a, opportunity);
  perform public.assign_job_application_cv(app_a, cv_a, 'Checklist test snapshot', content, '{}', 7, '{"notes":"Keep these notes"}');
  insert into public.drafts(id, user_id, application_id, draft_type, content)
    values (draft_a, user_a, app_a, 'motivation_letter', 'Test draft');
  insert into public.opportunity_reviews(user_id, opportunity_id, state) values(user_a, opportunity, 'not_interested');
  select context_json into saved_context from public.applications where id = app_a;
  if (select completed_checklist_keys from public.applications where id = app_a) <> '{}'::text[] then raise exception 'FAIL: nonempty checklist default'; end if;
  perform public.set_job_application_checklist_item(app_a, 'requirements:degree', true);
  perform public.set_job_application_checklist_item(app_a, 'documents:cv', true);
  got := public.set_job_application_checklist_item(app_a, 'documents:cv', true);
  if got -> 'completed_checklist_keys' <> '["requirements:degree","documents:cv"]'::jsonb
    or got -> 'context_json' <> saved_context or got ->> 'cv_variant_id' <> cv_a::text or got ->> 'notes' <> 'Keep these notes' then
    raise exception 'FAIL: checklist lost another item, duplicated an item or changed application data';
  end if;
  perform public.refresh_job_application_context(app_a);
  got := public.set_job_application_checklist_item(app_a, 'requirements:degree', false);
  if got -> 'completed_checklist_keys' <> '["documents:cv"]'::jsonb then raise exception 'FAIL: refresh/uncheck lost unrelated progress'; end if;
  begin
    perform public.set_job_application_checklist_item(app_a, 'invalid-key', true);
    raise exception 'FAIL: invalid checklist key';
  exception when invalid_parameter_value then null; end;
  begin
    update public.applications set completed_checklist_keys = array_fill('documents:cv'::text, array[501]) where id = app_a;
    raise exception 'FAIL: checklist bound bypass';
  exception when check_violation then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists(select 1 from public.applications where id = app_a) then raise exception 'FAIL: another account can read progress'; end if;
  begin
    perform public.set_job_application_checklist_item(app_a, 'documents:cv', false);
    raise exception 'FAIL: cross-account checklist write';
  exception when insufficient_privilege then null; end;
  perform public.remove_job_application(app_a);
  perform public.create_job_application(app_b, opportunity);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin
    perform public.set_job_application_checklist_item(app_b, 'documents:cv', true);
    raise exception 'FAIL: anonymous checklist write';
  exception when insufficient_privilege then null; end;
  begin
    perform public.remove_job_application(app_b);
    raise exception 'FAIL: anonymous removal';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.set_job_application_checklist_item(app_a, 'documents:cv', true);
    raise exception 'FAIL: signed-out checklist write';
  exception when insufficient_privilege then null; end;
  begin
    perform public.remove_job_application(app_a);
    raise exception 'FAIL: signed-out removal';
  exception when insufficient_privilege then null; end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if not exists(select 1 from public.applications where id = app_a and completed_checklist_keys = array['documents:cv']) then
    raise exception 'FAIL: another account changed/deleted this application';
  end if;
  perform public.remove_job_application(app_a);
  perform public.remove_job_application(app_a);
  if exists(select 1 from public.applications where id = app_a) or exists(select 1 from public.drafts where id = draft_a) then
    raise exception 'FAIL: removal or draft cascade';
  end if;
  if not exists(select 1 from public.cv_variants where id = cv_a) then raise exception 'FAIL: removal deleted CV snapshot'; end if;
  if not exists(select 1 from public.opportunity_reviews where opportunity_id = opportunity and state = 'unreviewed') then
    raise exception 'FAIL: opportunity not returned to default review list';
  end if;
  if (select to_jsonb(o) from public.opportunities o where id = opportunity) <> saved_source then raise exception 'FAIL: shared opportunity changed'; end if;
  perform public.create_job_application(app_a, opportunity);
  if not exists(select 1 from public.applications where id = app_a and completed_checklist_keys = '{}'::text[]) then
    raise exception 'FAIL: cannot recreate removed application';
  end if;
  execute 'reset role';
  if not exists(select 1 from public.applications where id = app_b) then raise exception 'FAIL: another account application removed'; end if;
end;
$$;
rollback;
select 'PASS: private checklist persistence, per-item/idempotent updates, refresh preservation, bounds, account isolation, anonymous denial, removal retries, draft cascade, retained CVs, unchanged opportunities and recreation. All fixtures rolled back.' as result;
