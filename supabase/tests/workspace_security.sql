-- Run as the SQL editor / postgres role after schema.sql.
-- All fixtures, including temporary auth users, are rolled back.
-- An exception fails the test. The final SELECT appears only after every check passes.
begin;
set constraints all immediate;

do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  opportunity_a uuid := gen_random_uuid();
  opportunity_b uuid := gen_random_uuid();
  cv_a uuid := gen_random_uuid();
  cv_b uuid := gen_random_uuid();
  app_a uuid := gen_random_uuid();
  app_b uuid := gen_random_uuid();
  draft_a uuid := gen_random_uuid();
  replacement_cv uuid := gen_random_uuid();
  failed_cv uuid := gen_random_uuid();
  got uuid;
  affected integer;
  before_catalogue bigint;
  content jsonb := '{"contact":{"name":"Alex Muster","location":"","role":"","email":"muster-ex@mp.le","phone":"","website":"","linkedin":"","github":""},"about":{"text":"A public summary."},"education":[],"experience":{"jobs":[]},"languages":[],"hobbies":[],"customSections":[],"sidebarSections":[],"sectionNames":{}}';
  config jsonb := '{"lang":"en","design":{},"disabled":[],"completedSections":[],"keepTogetherSections":[],"anonymization":{"excludedSections":[],"excludedItems":[]},"sectionHeaderSizes":{},"bodyOrder":[],"sidebarOrder":[],"hiddenItems":[]}';
begin
  select count(*) into before_catalogue from public.opportunities;
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity_a, 'security-test-' || opportunity_a::text, 'Security test A'),
           (opportunity_b, 'security-test-' || opportunity_b::text, 'Security test B');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.opportunities) <> before_catalogue + 2 then
    raise exception 'FAIL: signed-in users cannot read the shared catalogue';
  end if;
  begin
    update public.opportunities set title = 'Unauthorized' where id = opportunity_a;
    raise exception 'FAIL: catalogue UPDATE was allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.opportunities(opportunity_key, title) values ('unauthorized', 'Unauthorized');
    raise exception 'FAIL: catalogue INSERT was allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.opportunities where id = opportunity_a;
    raise exception 'FAIL: catalogue DELETE was allowed';
  exception when insufficient_privilege then null; end;

  got := public.create_job_application(app_a, opportunity_a, cv_a, 'employer@example.org', 'Snapshot A', content, config);
  if got <> app_a then raise exception 'FAIL: create RPC did not return the application ID'; end if;
  got := public.create_job_application(app_a, opportunity_a, cv_a, 'employer@example.org', 'Snapshot A', content, config);
  if got <> app_a or (select count(*) from public.cv_variants) <> 1 then
    raise exception 'FAIL: identical create retry was not idempotent';
  end if;
  begin
    perform public.create_job_application(app_a, opportunity_a, cv_a, 'different@example.org', 'Snapshot A', content, config);
    raise exception 'FAIL: retry with changed application data was accepted';
  exception when unique_violation then null; end;
  if not exists (select 1 from public.applications where id = app_a and contact_email = 'employer@example.org' and cv_variant_id = cv_a)
     or not exists (select 1 from public.cv_variants where id = cv_a and not is_base_variant) then
    raise exception 'FAIL: own application or its CV could not be read';
  end if;
  insert into public.drafts(id, user_id, application_id, draft_type, content)
    values (draft_a, user_a, app_a, 'contact_email', 'Draft for employer');
  update public.applications set status = 'submitted', notes = 'Test note', submitted_at = now() where id = app_a;
  update public.cv_variants set research_track = 'Public research track' where id = cv_a;
  update public.drafts set content = 'Updated own draft', revision = 2 where id = draft_a;
  if not exists (select 1 from public.applications where id = app_a and status = 'submitted')
     or not exists (select 1 from public.drafts where id = draft_a and revision = 2)
     or not exists (select 1 from public.cv_variants where id = cv_a and research_track = 'Public research track') then
    raise exception 'FAIL: own UPDATE did not persist';
  end if;
  update public.applications set updated_at = '2000-01-01T00:00:00Z' where id = app_a;
  update public.cv_variants set updated_at = '2000-01-01T00:00:00Z' where id = cv_a;
  update public.drafts set updated_at = '2000-01-01T00:00:00Z' where id = draft_a;
  if not exists (select 1 from public.applications where id = app_a and updated_at = now())
     or not exists (select 1 from public.cv_variants where id = cv_a and updated_at = now())
     or not exists (select 1 from public.drafts where id = draft_a and updated_at = now()) then
    raise exception 'FAIL: updated_at triggers did not stamp server time';
  end if;
  begin
    update public.applications set user_id = user_b where id = app_a;
    raise exception 'FAIL: application ownership could be reassigned';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    update public.drafts set user_id = user_b where id = draft_a;
    raise exception 'FAIL: draft ownership could be reassigned';
  exception when insufficient_privilege then null; end;
  begin
    update public.cv_variants set user_id = user_b where id = cv_a;
    raise exception 'FAIL: CV ownership could be reassigned';
  exception when check_violation then null; end;
  begin
    update public.cv_variants set content_json = jsonb_set(content, '{about,text}', '"Changed snapshot"') where id = cv_a;
    raise exception 'FAIL: existing CV content was mutable';
  exception when check_violation then null; end;
  begin
    insert into public.cv_variants(user_id, name, content_json, config_json)
      values (user_a, 'Leaky snapshot', jsonb_set(content, '{contact,email}', '"private@example.org"'), config);
    raise exception 'FAIL: private contact data was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.cv_variants(user_id, name, content_json, config_json)
      values (user_a, 'Unknown metadata', content, config || '{"privateContact":"secret"}');
    raise exception 'FAIL: unknown config data was accepted';
  exception when check_violation then null; end;
  begin
    delete from public.cv_variants where id = cv_a;
    raise exception 'FAIL: assigned CV snapshot could be deleted';
  exception when foreign_key_violation then null; end;
  begin
    perform public.create_job_application(gen_random_uuid(), opportunity_b, failed_cv, 'invalid email', 'Failed snapshot', content, config);
    raise exception 'FAIL: invalid employer email was accepted';
  exception when check_violation then null; end;
  if exists (select 1 from public.cv_variants where id = failed_cv) then
    raise exception 'FAIL: failed creation left an orphaned snapshot';
  end if;

  -- Switch identities. Catalogue is shared; all three private tables must be empty.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists (select 1 from public.cv_variants) or exists (select 1 from public.applications) or exists (select 1 from public.drafts) then
    raise exception 'FAIL: another user can read private records';
  end if;
  update public.applications set notes = 'Unauthorized' where id = app_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user application UPDATE'; end if;
  update public.cv_variants set name = 'Unauthorized' where id = cv_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user CV UPDATE'; end if;
  update public.drafts set content = 'Unauthorized' where id = draft_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user draft UPDATE'; end if;
  delete from public.applications where id = app_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user application DELETE'; end if;
  delete from public.cv_variants where id = cv_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user CV DELETE'; end if;
  delete from public.drafts where id = draft_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user draft DELETE'; end if;
  begin
    insert into public.cv_variants(user_id, name, content_json, config_json) values (user_a, 'Spoofed owner', content, config);
    raise exception 'FAIL: CV INSERT can spoof another user';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.applications(user_id, opportunity_id, cv_variant_id, contact_email)
      values (user_a, opportunity_b, cv_a, 'employer@example.org');
    raise exception 'FAIL: application INSERT can spoof another user';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.drafts(user_id, application_id, draft_type) values (user_a, app_a, 'contact_email');
    raise exception 'FAIL: draft INSERT can spoof another user';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.applications(user_id, opportunity_id, cv_variant_id, contact_email)
      values (user_b, opportunity_a, cv_a, 'employer@example.org');
    raise exception 'FAIL: application can reference another user CV';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.drafts(user_id, application_id, draft_type) values (user_b, app_a, 'contact_email');
    raise exception 'FAIL: draft can reference another user application';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.cv_variants(user_id, name, parent_variant_id, content_json, config_json)
      values (user_b, 'Cross-tenant child', cv_a, content, config);
    raise exception 'FAIL: CV can reference another user parent';
  exception when foreign_key_violation then null; end;
  begin
    perform public.assign_job_application_cv(app_a, gen_random_uuid(), 'Cross-tenant RPC', content, config);
    raise exception 'FAIL: assignment RPC can change another user application';
  exception when insufficient_privilege then null; end;
  perform public.create_job_application(app_b, opportunity_a, cv_b, 'employer@example.org', 'Snapshot B', content, config);

  -- Return to A and verify atomic, immutable reassignment and its retry.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  begin
    perform public.assign_job_application_cv(app_a, failed_cv, 'Failed assignment', content, config, 7, '{"status":"invalid"}');
    raise exception 'FAIL: invalid assignment metadata was accepted';
  exception when check_violation then null; end;
  if exists (select 1 from public.cv_variants where id = failed_cv)
     or not exists (select 1 from public.applications where id = app_a and cv_variant_id = cv_a and status = 'submitted') then
    raise exception 'FAIL: rejected assignment was not atomic';
  end if;
  begin
    perform public.assign_job_application_cv(app_a, failed_cv, 'Forbidden change', content, config, 7, jsonb_build_object('user_id', user_b));
    raise exception 'FAIL: assignment RPC permits changing owner';
  exception when invalid_parameter_value then null; end;
  got := public.assign_job_application_cv(app_a, replacement_cv, 'Replacement A', content, config, 7, '{"status":"contacted","notes":"Saved with CV"}');
  if got <> replacement_cv then raise exception 'FAIL: assignment returned the wrong CV'; end if;
  got := public.assign_job_application_cv(app_a, replacement_cv, 'Replacement A', content, config, 7, '{"status":"contacted","notes":"Saved with CV"}');
  if got <> replacement_cv or (select count(*) from public.cv_variants) <> 2
     or not exists (select 1 from public.applications where id = app_a and cv_variant_id = replacement_cv and status = 'contacted' and notes = 'Saved with CV') then
    raise exception 'FAIL: CV reassignment retry was not idempotent';
  end if;
  got := public.refresh_job_application_context(app_a);
  if got <> app_a or (select count(*) from public.cv_variants) <> 2
     or not exists (select 1 from public.applications where id = app_a and cv_variant_id = replacement_cv
       and status = 'contacted' and notes = 'Saved with CV' and contact_email = 'employer@example.org') then
    raise exception 'FAIL: research refresh changed the assigned CV or application metadata';
  end if;
  delete from public.cv_variants where id = cv_a;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: own unused snapshot cannot be deleted'; end if;
  delete from public.drafts where id = draft_a;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: own draft cannot be deleted'; end if;
  insert into public.drafts(user_id, application_id, draft_type) values (user_a, app_a, 'motivation_letter');
  delete from public.applications where id = app_a;
  if exists (select 1 from public.drafts) then raise exception 'FAIL: application DELETE did not cascade its drafts'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  if exists (select 1 from public.opportunities) then raise exception 'FAIL: anonymous-auth user can read the catalogue'; end if;
  begin
    perform public.create_job_application(gen_random_uuid(), opportunity_b, gen_random_uuid(), 'employer@example.org', 'Anonymous account', content, config);
    raise exception 'FAIL: anonymous-auth user can create via RPC';
  exception when insufficient_privilege then null; end;

  -- No database privileges for a signed-out browser, including RPC execution.
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform 1 from public.opportunities;
    raise exception 'FAIL: anon catalogue SELECT';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.cv_variants;
    raise exception 'FAIL: anon CV SELECT';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.applications;
    raise exception 'FAIL: anon application SELECT';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.drafts;
    raise exception 'FAIL: anon draft SELECT';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_job_application(gen_random_uuid(), opportunity_b, gen_random_uuid(), 'employer@example.org', 'Anon', content, config);
    raise exception 'FAIL: anon create RPC';
  exception when insufficient_privilege then null; end;

  execute 'reset role';
  -- Account deletion must clean its application and snapshot despite required links.
  set constraints all deferred;
  delete from auth.users where id = user_b;
  set constraints all immediate;
  if exists (select 1 from public.applications where user_id = user_b)
     or exists (select 1 from public.cv_variants where user_id = user_b) then
    raise exception 'FAIL: account deletion did not cascade';
  end if;
end;
$$;

rollback;
select 'PASS: shared read-only catalogue, tenant CRUD isolation, cross-tenant FKs, private contact rejection, immutable snapshots, atomic/idempotent RPCs, anonymous denial, deletion cascades. All fixtures rolled back.' as result;
