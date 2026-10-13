-- Run as postgres. All fixtures and changes roll back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app uuid := gen_random_uuid(); cv uuid := gen_random_uuid();
  saved public.applications; previous_history jsonb; touched integer;
  content jsonb := '{"contact":{"name":"Alex Muster","location":"","role":"","email":"muster-ex@mp.le","phone":"","website":"","linkedin":"","github":""}}';
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity, 'stage-test-' || opportunity::text, 'Synthetic application workflow');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  perform public.create_job_application(app, opportunity);
  select * into saved from public.applications where id = app;
  if saved.status <> 'preparation' or saved.workflow_stage <> 'preparation' or saved.tracking_started
    or saved.status_history->0->>'status' <> 'preparation' then raise exception 'FAIL: new application is not in Preparation'; end if;
  update public.applications set notes = 'A tracking note does not pick a state' where id = app;
  saved := public.set_job_application_stage(app, 'refinement');
  if saved.status <> 'refinement' or saved.workflow_stage <> 'refinement' or saved.tracking_started then raise exception 'FAIL: Refinement tab was not saved'; end if;
  saved := public.set_job_application_stage(app, 'review');
  if saved.status <> 'attachments' or saved.workflow_stage <> 'review' or saved.tracking_started then raise exception 'FAIL: Attachments mapping failed'; end if;
  previous_history := saved.status_history;
  saved := public.set_job_application_stage(app, 'tracking');
  if saved.status <> 'attachments' or saved.workflow_stage <> 'tracking' or saved.tracking_started
    or saved.status_history <> previous_history then raise exception 'FAIL: Tracking tab changed status or history'; end if;
  saved := public.set_job_application_stage(app, 'tracking');
  if saved.status_history <> previous_history then raise exception 'FAIL: stage retry duplicated history'; end if;
  saved := public.set_job_application_stage(app, 'preparation');
  if saved.status <> 'preparation' or saved.tracking_started then raise exception 'FAIL: note or tab navigation locked tracking'; end if;
  -- Assigning only a CV must not start tracking even though the old RPC writes status.
  perform public.assign_job_application_cv(app, cv, 'Stage fixture', content, '{}', 7, '{}');
  if (select tracking_started from public.applications where id = app) then raise exception 'FAIL: CV assignment locked tracking'; end if;
  saved := public.set_job_application_stage(app, 'tracking');
  previous_history := saved.status_history;
  -- Ready is selected explicitly, never inferred from opening Tracking.
  update public.applications set status = 'ready', tracking_started = true where id = app;
  select * into saved from public.applications where id = app;
  if saved.status <> 'ready' or not saved.tracking_started
    or saved.status_history -> -1 ->> 'status' <> 'ready'
    or jsonb_array_length(saved.status_history) <> jsonb_array_length(previous_history) + 1 then
    raise exception 'FAIL: explicit Ready was not recorded and locked';
  end if;
  previous_history := saved.status_history;
  update public.applications set status = 'ready', tracking_started = true where id = app;
  saved := public.set_job_application_stage(app, 'refinement');
  if saved.status <> 'ready' or saved.workflow_stage <> 'refinement' or not saved.tracking_started
    or saved.status_history <> previous_history then raise exception 'FAIL: same-value Ready did not lock status'; end if;
  update public.applications set tracking_started = false, workflow_stage = 'review' where id = app;
  select * into saved from public.applications where id = app;
  if not saved.tracking_started or saved.status <> 'ready' or saved.workflow_stage <> 'review' then raise exception 'FAIL: client cleared sticky tracking'; end if;
  -- Stage and status mutations preserve explicit tracking in either serial order.
  update public.applications set status = 'submitted' where id = app;
  saved := public.set_job_application_stage(app, 'preparation');
  if saved.status <> 'submitted' or saved.workflow_stage <> 'preparation' then raise exception 'FAIL: late stage write replaced submitted status'; end if;
  saved := public.set_job_application_stage(app, 'review');
  update public.applications set status = 'contacted' where id = app;
  select * into saved from public.applications where id = app;
  if saved.status <> 'contacted' or saved.workflow_stage <> 'review' then raise exception 'FAIL: explicit tracking did not win after stage'; end if;
  previous_history := saved.status_history;
  begin
    perform public.set_job_application_stage(app, 'invented');
    raise exception 'FAIL: invalid stage accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.applications set status = 'preparation' where id = app;
    raise exception 'FAIL: workflow status accepted after tracking';
  exception when check_violation then null; end;
  if (select status_history from public.applications where id = app) <> previous_history then raise exception 'FAIL: failed stage/status changed history'; end if;
  -- Reset only within the postgres test transaction to check an unchanged Ready CV RPC.
  execute 'reset role';
  alter table public.applications disable trigger applications_stage_state;
  update public.applications set tracking_started = false, workflow_stage = 'tracking', status = 'ready' where id = app;
  alter table public.applications enable trigger applications_stage_state;
  execute 'set local role authenticated';
  perform public.assign_job_application_cv(app, cv, 'Stage fixture', content, '{}', 7, '{"status":"ready"}');
  saved := public.set_job_application_stage(app, 'review');
  if saved.status <> 'ready' or not saved.tracking_started then raise exception 'FAIL: unchanged Ready in assignment RPC did not lock'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  begin
    perform public.set_job_application_stage(app, 'tracking');
    raise exception 'FAIL: foreign application stage writable';
  exception when insufficient_privilege then null; end;
  update public.applications set tracking_started = false, workflow_stage = 'preparation' where id = app;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'FAIL: foreign stage writable directly'; end if;
  execute 'reset role';
  if has_function_privilege('anon','public.set_job_application_stage(uuid,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.set_job_application_stage(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.job_workspace_track_stage()','EXECUTE') then raise exception 'FAIL: stage function grants are incorrect'; end if;
end;
$$;
rollback;
