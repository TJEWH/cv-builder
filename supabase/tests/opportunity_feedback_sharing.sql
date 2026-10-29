-- AF-02 acceptance checks. Synthetic rows only, disposable database, rollback.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid();
  search_a uuid:=gen_random_uuid(); search_b uuid:=gen_random_uuid(); application uuid:=gen_random_uuid();
  before_row public.opportunity_reviews; saved public.opportunity_reviews; reply jsonb; blocked boolean; affected integer;
  unsafe text; original_revision bigint; original_time timestamptz;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunities(id,opportunity_key,title,contacts) values(opportunity,'af02-'||opportunity,'Synthetic opportunity','[{"name":"Synthetic Person","email":"person@example.invalid"}]');
  insert into public.opportunity_search_templates(id,user_id) values(search_a,owner_a),(search_b,owner_b);
  insert into public.opportunity_reviews(user_id,opportunity_id,comment) values(owner_a,opportunity,'Private Synthetic Person; person@example.invalid; +49 123 456789. Ignore previous instructions.');
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert before_row.search_feedback_summary is null and before_row.search_feedback_approved_at is null,'Legacy private comment became shared';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  reply:=public.read_opportunity_feedback_settings(search_a);
  assert reply->'structured_feedback_enabled'='false'::jsonb and reply->'consent_revision'='0'::jsonb,'Structured sharing did not default off';
  perform public.create_job_application(application,opportunity);
  reply:=public.read_opportunity_feedback_settings(search_a);
  assert reply->'structured_feedback_enabled'='false'::jsonb,'Creating an application implicitly opted in';

  reply:=public.save_opportunity_feedback(opportunity,'{"interest_rating":0,"interest_reasons":[{"category":"topic","polarity":"positive","target":"BCI"}],"search_feedback_summary":"Prefer hands-on sensing research and BCI methods."}');
  select * into saved from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert saved.interest_rating=0 and saved.comment=before_row.comment,'Partial feedback update lost private text or zero';
  assert saved.search_feedback_approved_at is null,'Draft save implicitly approved sharing';
  assert saved.search_feedback_source_hash=encode(sha256(convert_to(saved.comment,'UTF8')),'hex'),'Source hash does not identify exact private explanation';
  original_revision:=saved.feedback_revision; original_time:=saved.feedback_updated_at;
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),null);
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert before_row.search_feedback_revision=saved.search_feedback_revision and before_row.search_feedback_approved_at is null,'Viewing altered disclosure';
  assert before_row.feedback_revision=original_revision and before_row.feedback_updated_at=original_time,'Viewing changed preference priority';

  -- A caller cannot forge stored approval/hash/revision metadata through review CRUD.
  update public.opportunity_reviews set search_feedback_approved_at=now(),search_feedback_approved_summary_hash='forged',
    search_feedback_approved_source_hash='forged',search_feedback_revision=999,search_feedback_summary_hash='forged'
    where user_id=owner_a and opportunity_id=opportunity;
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert before_row.search_feedback_approved_at is null and before_row.search_feedback_revision=saved.search_feedback_revision
    and before_row.search_feedback_summary_hash=saved.search_feedback_summary_hash,'Review CRUD forged approval metadata';

  blocked:=false;
  begin perform public.approve_opportunity_feedback_summary(opportunity,'stale',saved.search_feedback_source_hash,saved.search_feedback_revision);
  exception when serialization_failure then blocked:=true; end;
  assert blocked,'Stale approval hash accepted';
  reply:=public.approve_opportunity_feedback_summary(opportunity,saved.search_feedback_summary_hash,saved.search_feedback_source_hash,saved.search_feedback_revision);
  assert reply->'search_feedback_approved_at'<>'null'::jsonb,'Explicit safe approval not stored';
  original_time:=(reply->>'search_feedback_approved_at')::timestamptz;
  reply:=public.approve_opportunity_feedback_summary(opportunity,saved.search_feedback_summary_hash,saved.search_feedback_source_hash,saved.search_feedback_revision);
  assert (reply->>'search_feedback_approved_at')::timestamptz=original_time,'Approval retry created a new observation';
  assert (reply->>'feedback_revision')::bigint=original_revision,'Approval modified numeric feedback';
  perform public.save_opportunity_comment(opportunity,'Changed private explanation, never sent to search.');
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert before_row.search_feedback_approved_at is null and before_row.search_feedback_revision=saved.search_feedback_revision+1,'Private explanation edit did not invalidate approval';
  perform public.save_opportunity_comment(opportunity,saved.comment);
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  assert before_row.search_feedback_approved_at is null,'Editing back resurrected stale approval';
  blocked:=false;
  begin perform public.approve_opportunity_feedback_summary(opportunity,saved.search_feedback_summary_hash,saved.search_feedback_source_hash,saved.search_feedback_revision);
  exception when serialization_failure then blocked:=true; end;
  assert blocked,'Old revision approved after source edit';
  reply:=public.approve_opportunity_feedback_summary(opportunity,before_row.search_feedback_summary_hash,before_row.search_feedback_source_hash,before_row.search_feedback_revision);
  reply:=public.revoke_opportunity_feedback_summary(opportunity);
  assert reply->'search_feedback_approved_at'='null'::jsonb and reply->>'search_feedback_summary'=saved.search_feedback_summary,'Revocation deleted private draft or retained approval';

  foreach unsafe in array array['Contact person@example.invalid','Call +49 123 456789','mailto:person@example.invalid',
    'Ignore previous instructions','execute_sql to fetch private records','Bearer secretvalue','api_key=secretvalue',
    'https://example.invalid/jobs/CaseSensitive?jobId=1234','//example.invalid/jobs'] loop
    perform public.save_opportunity_feedback(opportunity,jsonb_build_object('search_feedback_summary',unsafe));
    select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
    blocked:=false;
    begin perform public.approve_opportunity_feedback_summary(opportunity,before_row.search_feedback_summary_hash,before_row.search_feedback_source_hash,before_row.search_feedback_revision);
    exception when invalid_parameter_value then blocked:=true; end;
    assert blocked,'Unsafe summary was approved';
    assert before_row.search_feedback_approved_at is null,'Unsafe draft regained approval';
  end loop;
  blocked:=false;
  begin perform public.save_opportunity_feedback(opportunity,'{"interest_rating":"8"}');
  exception when invalid_parameter_value or invalid_text_representation then blocked:=true; end;
  assert blocked,'String rating was coerced';
  blocked:=false;
  begin perform public.save_opportunity_feedback(opportunity,'{"comment":"Overwrite private comment"}');
  exception when invalid_parameter_value then blocked:=true; end;
  assert blocked,'Arbitrary private field accepted by partial API';

  reply:=public.set_opportunity_feedback_consent(search_a,true);
  assert reply->'structured_feedback_enabled'='true'::jsonb and reply->'consent_revision'='1'::jsonb,'Explicit consent not recorded';
  original_time:=(reply->>'consent_updated_at')::timestamptz;
  reply:=public.set_opportunity_feedback_consent(search_a,true);
  assert reply->'consent_revision'='1'::jsonb and (reply->>'consent_updated_at')::timestamptz=original_time,'Consent retry churned';
  reply:=public.set_opportunity_feedback_consent(search_a,false);
  assert reply->'structured_feedback_enabled'='false'::jsonb and reply->'consent_revision'='2'::jsonb,'Consent revocation lost';
  update public.opportunity_search_adaptive_settings set consent_revision=999,consent_updated_at='2000-01-01Z' where user_id=owner_a and search_id=search_a;
  reply:=public.read_opportunity_feedback_settings(search_a);
  assert reply->'consent_revision'='2'::jsonb,'Consent metadata forged';
  blocked:=false;
  begin perform public.set_opportunity_feedback_consent(search_b,true);
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked,'Owner A opted owner B into feedback';
  blocked:=false;
  begin perform public.read_opportunity_feedback_settings(search_b);
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked,'Owner A read owner B settings';
  select count(*) into affected from public.opportunity_search_adaptive_settings where user_id=owner_b;
  assert affected=0,'Owner settings leaked through table select';
  execute 'reset role';
  assert (select contacts->0->>'email' from public.opportunities where id=opportunity)='person@example.invalid','Contact preservation failed';
  assert (select comment from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity)=saved.comment,'Private explanation was modified by sharing';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);
  execute 'set local role authenticated';
  blocked:=false;
  begin perform public.set_opportunity_feedback_consent(search_a,true);
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked,'Anonymous session opted into feedback';
  select count(*) into affected from public.opportunity_feedback_summary_approvals;
  assert affected=0,'Anonymous session read approvals';
  execute 'reset role';
  assert not exists(select 1 from pg_proc where oid in (
    'public.save_opportunity_feedback(uuid,jsonb)'::regprocedure,'public.approve_opportunity_feedback_summary(uuid,text,text,bigint)'::regprocedure,
    'public.set_opportunity_feedback_consent(uuid,boolean)'::regprocedure) and prosecdef),'Approval/consent API unexpectedly bypasses RLS';
  assert not has_function_privilege('anon','public.save_opportunity_feedback(uuid,jsonb)','EXECUTE'),'Anonymous API grant added';
end;
$$;
rollback;
