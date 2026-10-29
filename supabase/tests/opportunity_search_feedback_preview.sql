-- AF-10: synthetic owner preview/proof acceptance. Isolated database only.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  fresh_search uuid:=gen_random_uuid();run_a uuid:=gen_random_uuid();items uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  opportunity_ids uuid[]:='{}';discovery uuid;opportunity uuid;application uuid:=gen_random_uuid();payload jsonb;reply jsonb;baseline jsonb;
  preview jsonb;packet jsonb;prior jsonb;before_settings jsonb;before_application jsonb;before_catalogue jsonb;proof public.opportunity_reviews;
  before_snapshots bigint;before_runs bigint;before_authorizations bigint;before_bindings bigint;blocked boolean;fixture_index integer;
  source_time timestamptz;adaptation_revision bigint;other_ids uuid[]:='{}';base_revision integer;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_a,owner_a,'Synthetic preview','{"topicsAndMethods":"Acoustic research"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}'),
      (search_b,owner_b,'Other synthetic preview','{"topicsAndMethods":"Robotics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}'),
      (fresh_search,owner_a,'Unconfigured synthetic preview','{"topicsAndMethods":"BCI"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  select revision into base_revision from public.opportunity_search_templates where id=search_a;
  perform private.begin_opportunity_search(search_a,run_a);
  perform private.save_opportunity_search_queries(run_a,'[{"query":"synthetic acoustic research"}]');
  for fixture_index in 1..3 loop
    payload:=jsonb_build_object('opportunity_key','af10-preview-'||items[fixture_index]::text,'title','Synthetic acoustic research',
      'institution','Example Institute','topics',jsonb_build_array('Acoustics','BCI'),'last_checked_at',clock_timestamp()-interval '1 hour',
      'personal_fit',jsonb_build_object('score',8,'scale_min',0,'scale_max',10,'summary','Original synthetic assessment'),
      'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/'||items[fixture_index]::text,'kind','official',
        'checked_at',clock_timestamp()-interval '1 hour','precision','instant','supports',jsonb_build_array('title','personal_fit'))));
    reply:=private.submit_opportunity_search_result(run_a,items[fixture_index],payload);
    opportunity_ids:=array_append(opportunity_ids,(reply->>'opportunity_id')::uuid);
  end loop;
  perform private.record_opportunity_search_discovery(run_a,items[1],'{}');
  perform private.verify_opportunity_search_result(run_a,items[1]);
  perform private.verify_opportunity_search_discovery(run_a,items[1]);
  perform private.verify_opportunity_search_result(run_a,items[2]);
  select discovery_id,assessment_recorded_at into discovery,source_time from public.opportunity_search_discoveries where run_id=run_a and item_id=items[1];
  assert (select count(*)=3 from public.opportunity_feedback_prediction_proofs where user_id=owner_a),
    'Verified historical/discovery technical proofs were not maintained, or pending proof became trusted';
  -- A repeat of the initialization projection recovers only actual proof, and
  -- never uses the current catalogue score or invents a historical timestamp.
  delete from public.opportunity_feedback_prediction_proofs where run_id=run_a and item_id=items[2];
  perform private.refresh_opportunity_feedback_prediction_proofs(run_a,items[2]);
  assert exists(select 1 from public.opportunity_feedback_prediction_proofs p join private.opportunity_search_merge_audit a
    on a.run_id=p.run_id and a.item_id=p.item_id where p.run_id=run_a and p.item_id=items[2]
      and p.recorded_at=a.recorded_at and p.score=8),'Metadata initialization fabricated original proof';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  before_runs:=(select count(*) from public.opportunity_search_runs where user_id=owner_a);
  before_authorizations:=(select count(*) from public.opportunity_search_runner_authorizations where user_id=owner_a);
  before_bindings:=(select count(*) from public.opportunity_search_schedule_bindings where user_id=owner_a);
  preview:=public.preview_opportunity_search_feedback(fresh_search);
  assert preview#>'{counts,eligible}'='0'::jsonb and preview->'privacy_scope_changed'='false'::jsonb,'Unconfigured preview not valid cold start';
  assert not exists(select 1 from public.opportunity_search_adaptive_settings where search_id=fresh_search),
    'Read-only preview inserted settings';
  assert before_runs=(select count(*) from public.opportunity_search_runs where user_id=owner_a)
    and before_authorizations=(select count(*) from public.opportunity_search_runner_authorizations where user_id=owner_a)
    and before_bindings=(select count(*) from public.opportunity_search_schedule_bindings where user_id=owner_a),
    'Preview created a run, authorization or schedule binding';
  perform public.set_opportunity_feedback_consent(search_a,true);
  perform public.save_opportunity_search_adaptation(search_a,true,false,0);
  perform public.save_opportunity_feedback(opportunity_ids[1],'{"interest_rating":0,"search_feedback_summary":"Prefer practical sensing and hardware evaluation."}');
  perform public.save_opportunity_comment(opportunity_ids[1],'PRIVATE_COMMENT_CANARY person@example.invalid');
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),'interested');
  -- Save zero through the public explicit review path pins the verified
  -- discovery proof; historical legacy baselines are set separately below.
  select * into proof from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[1];
  assert proof.prediction_baseline->>'source_kind'='discovery_assessment','Preview fixture did not establish real discovery proof';
  baseline:=proof.prediction_baseline;
  assert public.opportunity_feedback_preview_baseline_matches(baseline,owner_a,opportunity_ids[1],proof.feedback_updated_at),
    'Public owner proof validator rejected real discovery provenance';
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert exists(select 1 from jsonb_array_elements(preview->'examples') e where e->>'opportunity_id'=opportunity_ids[1]::text
    and e->'interest_score'='0'::jsonb and e->'interest_gap'='-8'::jsonb and not(e?'search_feedback_summary')),
    'Zero or unapproved-summary distinction lost';
  assert preview::text!~'PRIVATE_COMMENT_CANARY|person@example.invalid','Private comment leaked into outgoing preview';
  before_settings:=(select to_jsonb(s) from public.opportunity_search_adaptive_settings s where user_id=owner_a and search_id=search_a);
  before_snapshots:=(select count(*) from public.opportunity_search_feedback_snapshots where user_id=owner_a);
  prior:=public.preview_opportunity_search_feedback(search_a);
  assert prior=preview and before_settings=(select to_jsonb(s) from public.opportunity_search_adaptive_settings s where user_id=owner_a and search_id=search_a)
    and before_snapshots=(select count(*) from public.opportunity_search_feedback_snapshots where user_id=owner_a),
    'Dirty preview wrote metadata or changed deterministic output';
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet=preview,'Dirty owner preview differs from exact persisted runner packet';
  assert private.project_opportunity_feedback(owner_a,opportunity_ids[1])=public.project_opportunity_feedback_preview(owner_a,opportunity_ids[1]),
    'Public safe projector differs from private original proof policy';

  -- Historical baselines retain their original source and actual audit time.
  select recorded_at into source_time from private.opportunity_search_merge_audit where run_id=run_a and item_id=items[2];
  baseline:=jsonb_build_object('user_id',owner_a,'opportunity_id',opportunity_ids[2],'score',8,'scale_min',0,'scale_max',10,
    'predicted_at',source_time,'source_kind','historical_snapshot','source_ref','opportunity-search-receipt:'||run_a::text||':'||items[2]::text);
  update public.opportunity_reviews set interest_rating=7,prediction_baseline=baseline where user_id=owner_a and opportunity_id=opportunity_ids[2];
  assert public.opportunity_feedback_preview_metric(owner_a,opportunity_ids[2])=private.opportunity_interest_metric(owner_a,opportunity_ids[2]),
    'Historical proof metric differs';
  update public.opportunities set personal_fit='{"score":1,"scale_min":0,"scale_max":10,"summary":"Later catalogue fit"}',
    contacts='[{"entity_id":"contact:private-canary","name":"PRIVATE_CONTACT_CANARY","email":"hidden@example.invalid","roles":["contact"]}]'
    where id=opportunity_ids[2];
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage,submitted_at,notes,context_json,context_captured_at)
    values(application,owner_a,opportunity_ids[3],'rejected','tracking',clock_timestamp(),'PRIVATE_APPLICATION_CANARY',
      '{"private":"PRIVATE_FROZEN_CONTEXT_CANARY"}',clock_timestamp());
  before_application:=(select to_jsonb(a) from public.applications a where id=application);
  before_catalogue:=(select jsonb_agg(to_jsonb(o) order by o.id) from public.opportunities o where id=any(opportunity_ids));
  execute 'set local role authenticated';
  select * into proof from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[1];
  perform public.approve_opportunity_feedback_summary(opportunity_ids[1],proof.search_feedback_summary_hash,proof.search_feedback_source_hash,proof.search_feedback_revision);
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert preview#>'{counts,approved_summaries}'='1'::jsonb and preview#>'{counts,submission_fallback}'='1'::jsonb,
    'Approved summary or actual submission fallback missing';
  assert exists(select 1 from jsonb_array_elements(preview->'examples') e where e->>'opportunity_id'=opportunity_ids[2]::text
    and e#>>'{original_prediction,source_kind}'='historical_snapshot' and e->'interest_gap'='-1'::jsonb),
    'Historical source or frozen assessment rebased to current catalogue';
  assert preview::text!~'PRIVATE_|hidden@example.invalid|person@example.invalid|context_json|contacts|status_history|"comment"',
    'Preview exposed private or whole-row fields';
  execute 'reset role';
  assert preview=private.compile_opportunity_feedback_snapshot(owner_a,search_a),'Approved/submission preview not exact runner packet';
  execute 'set local role authenticated';
  perform public.revoke_opportunity_feedback_summary(opportunity_ids[1]);
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert preview#>'{counts,approved_summaries}'='0'::jsonb and preview::text not like '%Prefer practical sensing%',
    'Revoked summary remained in next outgoing preview';
  execute 'reset role';
  assert preview=private.compile_opportunity_feedback_snapshot(owner_a,search_a),'Revoked preview differs from runner';

  -- Every actual provenance revocation must affect dirty previews immediately.
  update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where run_id=run_a and item_id=items[1];
  assert not exists(select 1 from public.opportunity_feedback_prediction_proofs where run_id=run_a and item_id=items[1]),
    'Rollback retained protected proof';
  execute 'set local role authenticated';
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert exists(select 1 from jsonb_array_elements(preview->'examples') e where e->>'opportunity_id'=opportunity_ids[1]::text
    and e->>'baseline_status'='unavailable' and e->'interest_gap'='null'::jsonb),'Rollback left a false interest gap';
  execute 'reset role';
  assert preview=private.compile_opportunity_feedback_snapshot(owner_a,search_a),'Rollback preview differs from runner';
  begin
    delete from private.opportunity_search_merge_audit where run_id=run_a and item_id=items[2];
    assert not exists(select 1 from public.opportunity_feedback_prediction_proofs where run_id=run_a and item_id=items[2]),
      'Audit deletion retained a historical proof';
    assert public.opportunity_feedback_preview_metric(owner_a,opportunity_ids[2])=private.opportunity_interest_metric(owner_a,opportunity_ids[2]),
      'Deleted audit proof differs from original private verifier';
    raise no_data_found using message='Restore the isolated audit-deletion fixture';
  exception when no_data_found then null;end;
  assert exists(select 1 from public.opportunity_feedback_prediction_proofs where run_id=run_a and item_id=items[2]),
    'Isolated audit-deletion fixture did not restore its original proof';
  delete from public.opportunity_search_receipts where run_id=run_a and item_id=items[2];
  assert not exists(select 1 from public.opportunity_feedback_prediction_proofs where run_id=run_a and item_id=items[2]),
    'Receipt deletion retained historical proof';
  assert public.opportunity_feedback_preview_metric(owner_a,opportunity_ids[2])=private.opportunity_interest_metric(owner_a,opportunity_ids[2]),
    'Deleted proof differs from original live private verifier';

  -- More than the example/group limits: aggregate first, omit explicitly, and
  -- preserve byte-exact packet selection including Unicode text.
  for fixture_index in 1..28 loop
    opportunity:=gen_random_uuid();other_ids:=array_append(other_ids,opportunity);
    insert into public.opportunities(id,opportunity_key,title,institution,topics,research_summary)
      values(opportunity,'af10-many-'||opportunity,'Synthetic research','Institute '||fixture_index,array['Topic '||fixture_index,'Acoustics'],repeat('界',300));
    insert into public.opportunity_reviews(user_id,opportunity_id,state) values(owner_a,opportunity,'interested');
  end loop;
  execute 'set local role authenticated';
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert preview#>'{counts,eligible}'='31'::jsonb and jsonb_array_length(preview->'examples')<=16
    and jsonb_array_length(preview#>'{aggregates,groups}')<=64 and octet_length(preview::text)<=65536
    and(preview#>>'{counts,omitted_limit}')::integer>0,'Whole-set counts or export limits incorrect';
  execute 'reset role';
  assert preview=private.compile_opportunity_feedback_snapshot(owner_a,search_a),'Bounded selected packet differs';
  execute 'set local role authenticated';
  select s.adaptation_revision into adaptation_revision from public.opportunity_search_adaptive_settings s where user_id=owner_a and search_id=search_a;
  perform public.save_opportunity_search_adaptation(search_a,true,true,adaptation_revision);
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert preview->'examples'='[]'::jsonb and preview#>'{counts,eligible}'='0'::jsonb,'Pause did not empty adaptive layer';
  execute 'reset role';
  assert preview=private.compile_opportunity_feedback_snapshot(owner_a,search_a),'Paused packet differs';
  execute 'set local role authenticated';
  perform public.set_opportunity_feedback_consent(search_a,false);
  preview:=public.preview_opportunity_search_feedback(search_a);
  assert preview->'examples'='[]'::jsonb,'Consent off retained adaptive examples';
  assert (select revision=base_revision from public.opportunity_search_templates where id=search_a),'Feedback preview changed base revision';
  blocked:=false;begin perform public.build_opportunity_search_feedback(owner_b,search_b);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Public builder accepted other owner scope';
  blocked:=false;begin perform public.preview_opportunity_search_feedback(search_b);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner preview accepted another search';
  blocked:=false;begin delete from public.opportunity_feedback_prediction_proofs where user_id=owner_a;exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner can forge/delete protected prediction metadata';
  assert not has_function_privilege(current_user,'private.compile_opportunity_feedback_snapshot(uuid,uuid)','EXECUTE')
    and not has_function_privilege(current_user,'private.opportunity_feedback_baseline_matches(jsonb,uuid,uuid,timestamptz)','EXECUTE')
    and not has_table_privilege(current_user,'private.opportunity_search_merge_audit','SELECT'),'Preview widened private grants';
  assert not has_table_privilege(current_user,'auth.users','SELECT'),'Browser role unexpectedly reads auth users';
  delete from public.opportunity_reviews where user_id=owner_a and opportunity_id=other_ids[1];
  assert not exists(select 1 from public.opportunity_reviews where user_id=owner_a and opportunity_id=other_ids[1]),
    'Owner review deletion needs an auth/private permission workaround';
  execute 'reset role';
  assert before_application=(select to_jsonb(a) from public.applications a where id=application)
    and before_catalogue=(select jsonb_agg(to_jsonb(o) order by o.id) from public.opportunities o where id=any(opportunity_ids)),
    'Preview changed catalogue or frozen application context';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);
  execute 'set local role authenticated';
  blocked:=false;begin perform public.preview_opportunity_search_feedback(search_a);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Anonymous authenticated user received feedback preview';
  execute 'reset role';
  execute 'set local role anon';
  assert not has_function_privilege(current_user,'public.preview_opportunity_search_feedback(uuid)','EXECUTE'),'Anon can invoke preview';
  execute 'reset role';

  -- Owner deletion must cascade proof cache without a trigger trying to
  -- reconstruct metadata after the referenced auth.users row has gone.
  perform private.record_opportunity_search_discovery(run_a,items[3],'{}');
  perform private.verify_opportunity_search_result(run_a,items[3]);
  perform private.verify_opportunity_search_discovery(run_a,items[3]);
  assert (select count(*)>=2 from public.opportunity_feedback_prediction_proofs where user_id=owner_a),
    'Owner cascade fixture has no live historical/discovery proof';
  delete from auth.users where id=owner_a;
  assert not exists(select 1 from public.opportunity_feedback_prediction_proofs where user_id=owner_a),'Owner deletion retained proof metadata';
end $$;
rollback;
