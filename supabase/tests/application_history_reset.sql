-- Run as postgres. Synthetic data and privileged legacy fixtures roll back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid(); app uuid := gen_random_uuid();
  before_row jsonb; saved public.applications; previous_history jsonb; current_entry jsonb;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity, 'history-reset-' || opportunity::text, 'Synthetic history reset');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  perform public.create_job_application(app, opportunity);
  perform public.set_job_application_stage(app, 'refinement');
  perform public.set_job_application_stage(app, 'tracking');
  update public.applications set status = 'contacted', notes = 'Retain these notes',
    contacted_at = '2026-10-01T12:00:00Z', submitted_at = '2026-10-02T12:00:00Z' where id = app;
  update public.applications set status = 'submitted' where id = app;
  perform public.set_job_application_checklist_item(app, 'documents:cv', true);
  select to_jsonb(a), status_history, status_history -> -1 into before_row, previous_history, current_entry
    from public.applications a where id = app;
  if jsonb_array_length(previous_history) < 4 then raise exception 'FAIL: fixture history too short'; end if;
  saved := public.reset_job_application_history(app);
  if saved.status_history <> jsonb_build_array(current_entry)
    or (to_jsonb(saved) - array['status_history','updated_at']) <> (before_row - array['status_history','updated_at']) then
    raise exception 'FAIL: reset changed current state, timestamps or unrelated fields';
  end if;
  if coalesce(current_setting('cv_builder.resetting_application_history', true), '') <> '' then
    raise exception 'FAIL: reset scope leaked';
  end if;
  before_row := to_jsonb(saved);
  saved := public.reset_job_application_history(app);
  if to_jsonb(saved) <> before_row then raise exception 'FAIL: repeated reset not idempotent'; end if;

  -- Normal clients cannot bypass the trigger even by forging the helper scope.
  perform set_config('cv_builder.resetting_application_history', user_a::text || ':' || app::text, true);
  update public.applications set status_history = '[{"status":"offer","changedAt":null}]' where id = app;
  if (select status_history from public.applications where id = app) <> jsonb_build_array(current_entry) then
    raise exception 'FAIL: direct history forgery accepted';
  end if;
  perform set_config('cv_builder.resetting_application_history', '', true);
  update public.applications set status = 'interview' where id = app;
  if not exists (select 1 from public.applications where id = app and jsonb_array_length(status_history) = 2
    and status_history -> 0 = current_entry and status_history -> 1 ->> 'status' = 'interview') then
    raise exception 'FAIL: tracking did not resume after reset';
  end if;
  select status_history into previous_history from public.applications where id = app;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  begin perform public.reset_job_application_history(app); raise exception 'FAIL: foreign reset accepted';
  exception when insufficient_privilege then null; end;
  begin perform private.reset_job_application_history(app); raise exception 'FAIL: private foreign reset accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin perform public.reset_job_application_history(app); raise exception 'FAIL: anonymous account reset accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '{}', true);
  begin perform public.reset_job_application_history(app); raise exception 'FAIL: unauthenticated reset accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  begin perform public.reset_job_application_history(null); raise exception 'FAIL: missing ID accepted';
  exception when invalid_parameter_value then null; end;
  if (select status_history from public.applications where id = app) <> previous_history then
    raise exception 'FAIL: rejected reset changed history';
  end if;

  -- Legacy unknown or malformed transition times stay unknown, never reset-time.
  execute 'reset role';
  alter table public.applications disable trigger applications_status_history;
  update public.applications set status_history = '[{"status":"ready","changedAt":"2026-01-01T00:00:00Z"},{"status":"interview","changedAt":null}]' where id = app;
  alter table public.applications enable trigger applications_status_history;
  execute 'set local role authenticated';
  saved := public.reset_job_application_history(app);
  if saved.status_history <> '[{"status":"interview","changedAt":null}]'::jsonb then
    raise exception 'FAIL: unknown time invented during reset';
  end if;
  execute 'reset role';
  alter table public.applications disable trigger applications_status_history;
  update public.applications set status_history = '[{"status":"interview","changedAt":"not-a-date"}]' where id = app;
  alter table public.applications enable trigger applications_status_history;
  execute 'set local role authenticated';
  saved := public.reset_job_application_history(app);
  if saved.status_history <> '[{"status":"interview","changedAt":null}]'::jsonb then
    raise exception 'FAIL: malformed time not normalized';
  end if;
  execute 'reset role';
  alter table public.applications disable trigger applications_status_history;
  update public.applications set status_history = '[{"status":"submitted","changedAt":"2026-01-01T00:00:00Z"}]' where id = app;
  alter table public.applications enable trigger applications_status_history;
  execute 'set local role authenticated';
  saved := public.reset_job_application_history(app);
  if saved.status_history <> '[{"status":"interview","changedAt":null}]'::jsonb then
    raise exception 'FAIL: mismatched history changed current state or invented a time';
  end if;
  execute 'reset role';
  if has_function_privilege('anon', 'public.reset_job_application_history(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.reset_job_application_history(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'private.reset_job_application_history(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.reset_job_application_history(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.reset_job_application_history(uuid)', 'EXECUTE')
    or (select prosecdef from pg_proc where oid = 'public.reset_job_application_history(uuid)'::regprocedure)
    or not (select prosecdef from pg_proc where oid = 'private.reset_job_application_history(uuid)'::regprocedure) then
    raise exception 'FAIL: reset privilege boundary changed';
  end if;
end;
$$;
rollback;
