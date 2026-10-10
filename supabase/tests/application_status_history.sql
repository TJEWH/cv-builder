-- Run as postgres. Synthetic users, opportunities and applications roll back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app uuid := gen_random_uuid(); cv uuid := gen_random_uuid();
  original jsonb; history jsonb; got jsonb; touched integer; first_time timestamptz;
  content jsonb := '{"contact":{"name":"Alex Muster","location":"","role":"","email":"muster-ex@mp.le","phone":"","website":"","linkedin":"","github":""}}';
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity, 'status-test-' || opportunity::text, 'Synthetic status history');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  insert into public.applications(id,user_id,opportunity_id,status_history)
    values(app,user_a,opportunity,'[{"status":"offer","changedAt":"2000-01-01T00:00:00Z"}]');
  select status_history, to_jsonb(a) into original, got from public.applications a where id=app;
  first_time := (original->0->>'changedAt')::timestamptz;
  if jsonb_array_length(original)<>1 or original->0->>'status'<>'preparation' or first_time is null
    or first_time < statement_timestamp() then raise exception 'FAIL: initial history not server recorded'; end if;
  perform public.create_job_application(app, opportunity);
  update public.applications set notes='Synthetic note',status='preparation',status_history='[]' where id=app;
  if (select status_history from public.applications where id=app)<>original then raise exception 'FAIL: unchanged status, retry or notes rewrote history'; end if;
  update public.applications set status='contacted',status_history='[{"status":"offer"}]' where id=app;
  update public.applications set status='submitted' where id=app;
  update public.applications set status='contacted' where id=app;
  select status_history into history from public.applications where id=app;
  if jsonb_array_length(history)<>4 or history->0<>original->0
    or history->1->>'status'<>'contacted' or history->2->>'status'<>'submitted' or history->3->>'status'<>'contacted'
    or (history->1->>'changedAt')::timestamptz < first_time
    or (history->2->>'changedAt')::timestamptz < (history->1->>'changedAt')::timestamptz
    or (history->3->>'changedAt')::timestamptz < (history->2->>'changedAt')::timestamptz then raise exception 'FAIL: ordered/repeated transitions lost'; end if;
  begin
    update public.applications set status='invented' where id=app;
    raise exception 'FAIL: invalid status accepted';
  exception when check_violation then null; end;
  if (select status_history from public.applications where id=app)<>history then raise exception 'FAIL: failed write appended history'; end if;
  perform public.assign_job_application_cv(app,cv,'Status fixture',content,'{}',7,'{"status":"interview"}');
  select status_history into history from public.applications where id=app;
  if jsonb_array_length(history)<>5 or history->4->>'status'<>'interview' then raise exception 'FAIL: RPC status bypassed history'; end if;
  perform public.refresh_job_application_context(app);
  perform public.set_job_application_checklist_item(app,'documents:cv',true);
  if (select status_history from public.applications where id=app)<>history then raise exception 'FAIL: unrelated RPC rewrote history'; end if;
  if exists(select 1 from public.applications a where id=app and (
    a.application_code<>got->>'application_code' or a.context_json<>got->'context_json'
    or a.created_at<>(got->>'created_at')::timestamptz or a.contacted_at is not null or a.submitted_at is not null)) then raise exception 'FAIL: status edits altered unrelated application fields'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists(select 1 from public.applications where id=app) then raise exception 'FAIL: foreign history readable'; end if;
  update public.applications set status='offer' where id=app;
  get diagnostics touched = row_count;
  if touched<>0 then raise exception 'FAIL: foreign status writable'; end if;
  execute 'reset role';
  if (select status_history from public.applications where id=app)<>history then raise exception 'FAIL: foreign change appended history'; end if;
  if has_function_privilege('anon','public.job_workspace_record_status()','EXECUTE')
    or has_function_privilege('authenticated','public.job_workspace_record_status()','EXECUTE') then raise exception 'FAIL: trigger function directly callable'; end if;
end;
$$;
rollback;
