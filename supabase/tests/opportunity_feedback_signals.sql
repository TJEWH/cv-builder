-- Run only in the isolated synthetic AF-01 database, as postgres. Nothing persists.
begin;
set constraints all immediate;
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); opportunity uuid := gen_random_uuid();
  baseline_opportunity uuid := gen_random_uuid(); application uuid; test_run uuid := gen_random_uuid(); test_item uuid := gen_random_uuid();
  next_run uuid := gen_random_uuid(); next_item uuid := gen_random_uuid(); next_prediction timestamptz;
  row_before public.opportunity_reviews; row_after public.opportunity_reviews; outcome jsonb; baseline jsonb; invalid jsonb;
  catalogue jsonb; stage text; expected numeric; value numeric; key text; count_rows integer; blocked boolean;
  predicted timestamptz := '2026-01-01T12:00:00Z'; baseline_time text := '2026-01-01T12:00:00Z';
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
    (owner_a,'authenticated','authenticated',owner_a::text || '@example.invalid','{}','{}'),
    (owner_b,'authenticated','authenticated',owner_b::text || '@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values
    (opportunity,'af01-' || opportunity::text,'Synthetic feedback'),
    (baseline_opportunity,'af01-' || baseline_opportunity::text,'Synthetic baseline');
  select to_jsonb(o) into catalogue from public.opportunities o where id = opportunity;

  -- SIG-01/07: views and private comments are not preference observations.
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score' = 'null'::jsonb and outcome->>'interest_origin' = 'none', 'unreviewed must be unknown';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),null);
  perform public.save_opportunity_comment(opportunity,'Private name@example.invalid must not be exported');
  select * into row_before from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),null);
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),'unreviewed');
  update public.opportunity_reviews set feedback_revision=999,feedback_updated_at='2000-01-01Z' where user_id=owner_a and opportunity_id=opportunity;
  select * into row_after from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert row_after.feedback_revision=0 and row_after.feedback_updated_at is null, 'view/comment/forged derived metadata churned feedback';
  assert row_after.prediction_baseline is null and row_after.comment=row_before.comment, 'view destroyed private comment';
  execute 'reset role';

  -- SIG-02/03: all actual enums and rating precedence, including explicit zero.
  foreach stage in array array['unreviewed','not_interested','interested','strong_interest'] loop
    update public.opportunity_reviews set state=stage where user_id=owner_a and opportunity_id=opportunity;
    outcome := private.opportunity_interest_metric(owner_a,opportunity);
    expected := case stage when 'not_interested' then 2 when 'interested' then 6 when 'strong_interest' then 8 else null end;
    assert (outcome->>'interest_score')::numeric is not distinct from expected, 'categorical mapping failed';
    foreach value in array array[0::numeric,7.25::numeric,10::numeric] loop
      update public.opportunity_reviews set interest_rating=value where user_id=owner_a and opportunity_id=opportunity;
      outcome := private.opportunity_interest_metric(owner_a,opportunity);
      assert (outcome->>'interest_score')::numeric=value and outcome->>'interest_origin'='explicit_rating', 'explicit rating precedence failed';
    end loop;
    update public.opportunity_reviews set interest_rating=null where user_id=owner_a and opportunity_id=opportunity;
  end loop;
  foreach value in array array[-1::numeric,11::numeric,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric] loop
    blocked := false;
    begin
      update public.opportunity_reviews set interest_rating=value where user_id=owner_a and opportunity_id=opportunity;
    exception when check_violation then blocked := true; end;
    assert blocked, 'invalid numeric rating accepted';
  end loop;
  blocked := false;
  begin execute 'update public.opportunity_reviews set interest_rating=''not-a-number''';
  exception when invalid_text_representation then blocked := true; end;
  assert blocked, 'invalid rating string accepted';

  -- Bounded reasons normalize as sets; retries, reordering and duplicate tags do not churn.
  update public.opportunity_reviews set interest_reasons='[{"category":"topic","polarity":"positive","target":"  BCI  "},{"category":"funding","polarity":"negative"}]'
    where user_id=owner_a and opportunity_id=opportunity;
  select * into row_before from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  update public.opportunity_reviews set interest_reasons='[{"category":"funding","polarity":"negative"},{"category":"topic","polarity":"positive","target":"BCI"},{"category":"topic","polarity":"positive","target":"BCI"}]'
    where user_id=owner_a and opportunity_id=opportunity;
  select * into row_after from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert row_after.interest_reasons=row_before.interest_reasons and row_after.feedback_revision=row_before.feedback_revision
    and row_after.feedback_updated_at=row_before.feedback_updated_at, 'normalized reason retry churned';
  for invalid in select e.value from jsonb_array_elements('[null,{},[{"category":"unknown","polarity":"positive"}],[{"category":"topic","polarity":"neutral"}],[{"category":"funding","polarity":"negative","target":"not a topic"}],[{"category":"topic","polarity":"positive","target":""}],[{"category":"topic","polarity":"positive","extra":"private"}],[{"category":"topic","polarity":"positive","target":"line\nbreak"}]]'::jsonb) e loop
    blocked := false;
    begin update public.opportunity_reviews set interest_reasons=invalid where user_id=owner_a and opportunity_id=opportunity;
    exception when check_violation then blocked := true; end;
    assert blocked, 'invalid structured reason accepted';
  end loop;
  blocked := false;
  begin update public.opportunity_reviews set interest_reasons=null where user_id=owner_a and opportunity_id=opportunity;
  exception when check_violation then blocked := true; end;
  assert blocked, 'SQL NULL reasons accepted';
  blocked := false;
  begin update public.opportunity_reviews set interest_reasons=jsonb_build_array(jsonb_build_object('category','topic','polarity','positive','target',repeat('x',121))) where user_id=owner_a and opportunity_id=opportunity;
  exception when check_violation then blocked := true; end;
  assert blocked, 'overlong reason target accepted';
  blocked := false;
  begin update public.opportunity_reviews set interest_reasons=(select jsonb_agg(jsonb_build_object('category','topic','polarity','positive')) from generate_series(1,17)) where user_id=owner_a and opportunity_id=opportunity;
  exception when check_violation then blocked := true; end;
  assert blocked, 'unbounded reason list accepted';

  -- SIG-04: later employer statuses, draft stages, documents/views and tracking are not submissions.
  update public.opportunity_reviews set state='unreviewed',interest_rating=null,interest_reasons='[]' where user_id=owner_a and opportunity_id=opportunity;
  foreach stage in array array['preparation','refinement','attachments','ready','contacted','interview','offer','rejected','withdrawn'] loop
    application := gen_random_uuid();
    insert into public.applications(id,user_id,opportunity_id,status,workflow_stage) values(application,owner_a,opportunity,stage,'tracking');
    outcome := private.opportunity_interest_metric(owner_a,opportunity);
    assert outcome->'interest_score'='null'::jsonb and outcome->'confirmed_submission'='false'::jsonb, 'non-submission status rewarded';
    delete from public.applications where id=application;
  end loop;

  -- SIG-05/06: genuine submission persists through rejection; explicit interest/rating wins once.
  application := gen_random_uuid();
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage) values(application,owner_a,opportunity,'submitted','tracking');
  update public.applications set status='rejected' where id=application;
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='9'::jsonb and outcome->'confirmed_submission'='true'::jsonb, 'rejection lost genuine earlier submission';
  foreach stage in array array['unreviewed','not_interested','interested','strong_interest'] loop
    update public.opportunity_reviews set state=stage where user_id=owner_a and opportunity_id=opportunity;
    expected := case stage when 'not_interested' then 2 when 'interested' then 6 when 'strong_interest' then 8 else 9 end;
    outcome := private.opportunity_interest_metric(owner_a,opportunity);
    assert (outcome->>'interest_score')::numeric=expected and outcome->'confirmed_submission'='true'::jsonb, 'explicit/submitted precedence failed';
    update public.opportunity_reviews set interest_rating=0 where user_id=owner_a and opportunity_id=opportunity;
    outcome := private.opportunity_interest_metric(owner_a,opportunity);
    assert outcome->'interest_score'='0'::jsonb, 'zero lost to submission';
    update public.opportunity_reviews set feedback_excluded=true where user_id=owner_a and opportunity_id=opportunity;
    outcome := private.opportunity_interest_metric(owner_a,opportunity);
    assert outcome->'interest_score'='null'::jsonb and outcome->>'interest_origin'='excluded' and outcome->'confirmed_submission'='true'::jsonb, 'exclusion did not suppress signal';
    update public.opportunity_reviews set feedback_excluded=false,interest_rating=null where user_id=owner_a and opportunity_id=opportunity;
  end loop;

  -- Correcting the real history uses the existing owner-checked reset API. No sticky inferred reward.
  update public.opportunity_reviews set state='unreviewed' where user_id=owner_a and opportunity_id=opportunity;
  execute 'set local role authenticated';
  perform public.reset_job_application_history(application);
  execute 'reset role';
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='null'::jsonb and outcome->'submission_at'='null'::jsonb, 'removed submission evidence still rewarded';
  update public.applications set submitted_at='2026-02-01T12:00:00Z' where id=application;
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='9'::jsonb and (outcome->>'submission_at')::timestamptz='2026-02-01T12:00:00Z', 'submitted_at not recognized';
  update public.applications set submitted_at=null where id=application;
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='null'::jsonb, 'corrected submitted_at remained rewarded';
  -- Synthetic legacy history can prove submission while its date remains unknown.
  perform set_config('cv_builder.resetting_application_history',owner_a::text || ':' || application::text,true);
  update public.applications set status_history='[{"status":"submitted","changedAt":null},{"status":"rejected","changedAt":null}]' where id=application;
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='9'::jsonb and outcome->'submission_at'='null'::jsonb, 'unknown submission date was invented or evidence ignored';
  delete from public.applications where id=application;
  outcome := private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='null'::jsonb, 'deleted application left an observation';
  select count(*) into count_rows from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert count_rows=1, 'duplicate owner/opportunity observations';
  assert not outcome ?| array['comment','notes','context_json','contacts','documents','interest_reasons'], 'private data exported by metric';
  assert (select to_jsonb(o)=catalogue from public.opportunities o where id=opportunity), 'feedback changed shared opportunity';

  -- SIG-08: only exact verified historical provenance may establish an original score.
  insert into public.opportunity_search_runs(id,user_id) values(test_run,owner_a);
  insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,verified_at)
    values(test_run,test_item,owner_a,baseline_opportunity,predicted + interval '1 second');
  insert into private.opportunity_search_merge_audit(run_id,item_id,opportunity_id,after_snapshot,recorded_at)
    values(test_run,test_item,baseline_opportunity,'{"personal_fit":{"score":7,"scale_min":0,"scale_max":10}}',predicted);
  baseline := jsonb_build_object('user_id',owner_a,'opportunity_id',baseline_opportunity,'score',7,'scale_min',0,'scale_max',10,
    'predicted_at',baseline_time,'source_kind','historical_snapshot','source_ref','opportunity-search-receipt:' || test_run::text || ':' || test_item::text);
  insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,prediction_baseline)
    values(owner_a,baseline_opportunity,'interested',8,baseline);
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='1'::jsonb and outcome->>'baseline_status'='available', 'proven historical prediction unavailable';
  select * into row_before from public.opportunity_reviews where user_id=owner_a and opportunity_id=baseline_opportunity;
  update public.opportunities set personal_fit='{"score":1,"scale_min":0,"scale_max":10,"summary":"Changed current catalogue"}' where id=baseline_opportunity;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='1'::jsonb, 'catalogue update changed original baseline';
  blocked:=false;
  begin update public.opportunity_reviews set prediction_baseline=baseline || '{"score":1}' where user_id=owner_a and opportunity_id=baseline_opportunity;
  exception when check_violation then blocked:=true; end;
  assert blocked, 'management replaced baseline without a meaningful feedback revision';
  blocked:=false;
  begin update public.opportunity_reviews set interest_rating=9,prediction_baseline=baseline || '{"score":1}' where user_id=owner_a and opportunity_id=baseline_opportunity;
  exception when check_violation then blocked:=true; end;
  assert blocked, 'management accepted counterfeit baseline during a real revision';
  select * into row_after from public.opportunity_reviews where user_id=owner_a and opportunity_id=baseline_opportunity;
  assert row_after.feedback_revision=row_before.feedback_revision and row_after.interest_rating=row_before.interest_rating,
    'rejected baseline advanced revision or partially saved feedback';
  execute 'set local role authenticated';
  perform public.review_job_opportunity(baseline_opportunity,(select updated_at from public.opportunities where id=baseline_opportunity),null);
  perform public.review_job_opportunity(baseline_opportunity,(select updated_at from public.opportunities where id=baseline_opportunity),'interested');
  perform public.save_opportunity_comment(baseline_opportunity,'Another private comment');
  select * into row_after from public.opportunity_reviews where user_id=owner_a and opportunity_id=baseline_opportunity;
  assert row_after.feedback_revision=row_before.feedback_revision and row_after.feedback_updated_at=row_before.feedback_updated_at
    and row_after.prediction_baseline=row_before.prediction_baseline, 'source-view/comment/retry replaced frozen baseline or priority';
  blocked := false;
  begin update public.opportunity_reviews set prediction_baseline=baseline || '{"score":1}' where user_id=owner_a and opportunity_id=baseline_opportunity;
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked, 'client forged baseline';
  execute 'reset role';
  foreach key in array array['user_id','opportunity_id','source_kind','source_ref','predicted_at','scale_min','scale_max','score'] loop
    invalid := jsonb_set(baseline,array[key],'null'::jsonb);
    assert not private.opportunity_feedback_baseline_matches(invalid,owner_a,baseline_opportunity,clock_timestamp()), 'JSON null baseline field accepted';
  end loop;
  assert not private.opportunity_feedback_baseline_matches(baseline || '{"score":1}',owner_a,baseline_opportunity,clock_timestamp()), 'counterfeit historical score accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_b,baseline_opportunity,clock_timestamp()), 'other owner provenance accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_a,opportunity,clock_timestamp()), 'other opportunity provenance accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_a,baseline_opportunity,predicted - interval '1 second'), 'future prediction accepted';
  assert private.opportunity_feedback_time('2026-01-01T24:00:00Z') is null
    and private.opportunity_feedback_time('2026-01-01T12:00:60Z') is null
    and private.opportunity_feedback_time('2026-01-01T12:00:00.0000001Z') is null
    and private.opportunity_feedback_time('2026-01-01T12:00:00+20:00') is null, 'invalid or lossy timestamp accepted';
  update public.opportunity_search_receipts set verified_at=null where run_id=test_run and item_id=test_item;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='null'::jsonb and outcome->>'baseline_status'='unavailable', 'unverified proof kept a gap';
  update public.opportunity_search_receipts r set verified_at=predicted + interval '1 second' where r.run_id=test_run and r.item_id=test_item;
  update private.opportunity_search_merge_audit a set rolled_back_at=clock_timestamp() where a.run_id=test_run and a.item_id=test_item;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='null'::jsonb and outcome->>'baseline_status'='unavailable', 'rolled-back proof kept a gap';
  update private.opportunity_search_merge_audit a set rolled_back_at=null where a.run_id=test_run and a.item_id=test_item;
  update public.opportunity_reviews set feedback_excluded=true where user_id=owner_a and opportunity_id=baseline_opportunity;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='null'::jsonb and outcome->>'baseline_status'='unavailable', 'excluded feedback retained an adaptive gap';
  update public.opportunity_reviews set feedback_excluded=false,state='unreviewed',interest_rating=null where user_id=owner_a and opportunity_id=baseline_opportunity;
  application:=gen_random_uuid();
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage) values(application,owner_a,baseline_opportunity,'rejected','tracking');
  perform set_config('cv_builder.resetting_application_history',owner_a::text || ':' || application::text,true);
  update public.applications set status_history='[{"status":"submitted","changedAt":null},{"status":"rejected","changedAt":null}]' where id=application;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_score'='9'::jsonb and outcome->'submission_at'='null'::jsonb
    and outcome->'interest_gap'='null'::jsonb and outcome->>'baseline_status'='unavailable', 'unknown submission time produced a gap';
  update public.applications set submitted_at='2025-01-01T12:00:00Z' where id=application;
  outcome := private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='null'::jsonb and outcome->>'baseline_status'='unavailable', 'prediction newer than submission produced a gap';
  delete from public.applications where id=application;
  -- A new explicit revision may establish a new proven prediction that postdates
  -- the previous feedback. Merely viewing could not do this.
  next_prediction:=clock_timestamp();
  insert into public.opportunity_search_runs(id,user_id) values(next_run,owner_a);
  insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,verified_at)
    values(next_run,next_item,owner_a,baseline_opportunity,next_prediction);
  insert into private.opportunity_search_merge_audit(run_id,item_id,opportunity_id,after_snapshot,recorded_at)
    values(next_run,next_item,baseline_opportunity,'{"personal_fit":{"score":6,"scale_min":0,"scale_max":10}}',next_prediction);
  baseline:=baseline || jsonb_build_object('score',6,'predicted_at',to_char(next_prediction at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'source_ref','opportunity-search-receipt:' || next_run::text || ':' || next_item::text);
  update public.opportunity_reviews set interest_rating=8,prediction_baseline=baseline where user_id=owner_a and opportunity_id=baseline_opportunity;
  outcome:=private.opportunity_interest_metric(owner_a,baseline_opportunity);
  assert outcome->'interest_gap'='2'::jsonb and outcome->>'baseline_status'='available', 'new meaningful revision rejected a timely proven baseline';

  -- PRIV-07: current owner RLS protects every newly added private field without new grants.
  insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating,interest_reasons)
    values(owner_b,baseline_opportunity,3,'[{"category":"location","polarity":"negative"}]');
  execute 'set local role authenticated';
  select count(*) into count_rows from public.opportunity_reviews where user_id=owner_b;
  assert count_rows=0, 'owner A read owner B feedback';
  update public.opportunity_reviews set interest_rating=10,interest_reasons='[]',prediction_baseline=null where user_id=owner_b;
  get diagnostics count_rows=row_count;
  assert count_rows=0, 'owner A updated owner B feedback';
  delete from public.opportunity_reviews where user_id=owner_b;
  get diagnostics count_rows=row_count;
  assert count_rows=0, 'owner A deleted owner B feedback';
  blocked:=false;
  begin insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating) values(owner_b,opportunity,10);
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked, 'owner A inserted owner B feedback';
  blocked:=false;
  begin update public.opportunity_reviews set opportunity_id=opportunity where user_id=owner_a and opportunity_id=baseline_opportunity;
  exception when check_violation then blocked:=true; end;
  assert blocked, 'review identity moved its baseline';
  assert not has_function_privilege(current_user,(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='opportunity_interest_metric'),'EXECUTE'), 'metric API grant widened';
  assert not has_function_privilege(current_user,'public.job_workspace_feedback_revision()','EXECUTE'), 'trigger implementation grant widened';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  select count(*) into count_rows from public.opportunity_reviews where user_id=owner_a;
  assert count_rows=0, 'anonymous sign-in read private feedback';
  blocked:=false;
  begin perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),'interested');
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked, 'anonymous sign-in wrote feedback';
  blocked:=false;
  begin insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating) values(owner_a,opportunity,10);
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked, 'anonymous sign-in inserted feedback directly';
  execute 'reset role';
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join unnest(array['anon','authenticated','service_role']) actor
    where (n.nspname='private' and p.proname in ('opportunity_interest_metric','opportunity_feedback_time','opportunity_feedback_baseline_matches')
      or n.nspname='public' and p.proname='job_workspace_feedback_revision')
    and (p.prosecdef or has_function_privilege(actor,p.oid,'EXECUTE'))), 'new elevated/runtime function surface';
end;
$$;
rollback;
