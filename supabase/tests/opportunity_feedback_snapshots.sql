-- AF-03 synthetic acceptance checks, isolated database only; no data persists.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();other_search uuid:=gen_random_uuid();
  opportunity uuid; target uuid; unselected uuid; run_a uuid:=gen_random_uuid();run_b uuid:=gen_random_uuid();
  packet jsonb; pinned jsonb; before_packet jsonb; intermediate jsonb; after_packet jsonb; proof public.opportunity_reviews;
  original_version integer; old_revision bigint; old_hash text; n integer; affected integer; blocked boolean;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id) values(search_a,owner_a),(search_b,owner_b),(other_search,owner_a);
  select revision into original_version from public.opportunity_search_templates where id=search_a;
  insert into public.opportunity_search_runs(id,user_id,search_id) values(run_a,owner_a,search_a),(run_b,owner_b,search_b);
  packet:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert packet#>'{counts,eligible}'='0'::jsonb and packet->'examples'='[]'::jsonb,'Cold-start packet not empty';
  assert packet->'privacy_scope_changed'='false'::jsonb,'Cold start invented privacy revocation';
  before_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet=before_packet,'Identical cold start allocated another revision';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.set_opportunity_feedback_consent(search_a,true);
  execute 'reset role';
  for n in 1..30 loop
    opportunity:=gen_random_uuid();
    if n=1 then target:=opportunity; end if;
    insert into public.opportunities(id,opportunity_key,title,institution,topics,contacts,personal_fit)
      values(opportunity,'af03-'||opportunity,'Synthetic research','University '||n,array['BCI','Acoustics'],
        '[{"name":"Hidden Synthetic Person","email":"person@example.invalid"}]','{"score":9,"scale_min":0,"scale_max":10}');
    insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_reasons)
      values(owner_a,opportunity,'interested','[{"category":"method","polarity":"positive","target":"Prototyping"}]');
  end loop;
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet#>'{counts,eligible}'='30'::jsonb and packet#>'{counts,scored}'='30'::jsonb,'Whole-set aggregation used only selected examples';
  assert packet#>'{aggregates,score_sum}'='180'::jsonb and packet#>'{aggregates,mean_interest}'='6'::jsonb,'Aggregate mean incorrect';
  assert jsonb_array_length(packet->'examples')=16 and packet#>'{counts,omitted_limit}'='14'::jsonb,'Example bound incorrect';
  assert not exists(select 1 from jsonb_array_elements(packet->'examples') e where e->'interest_gap'<>'null'::jsonb),'Current catalogue invented original predictions';
  assert packet::text !~ 'person@example.invalid|Hidden Synthetic Person|context_json|comment','Packet exposed raw private fields';
  assert packet#>'{counts,baseline_available}'='0'::jsonb,'Unknown historical baseline became known';
  assert (select count(*) from jsonb_array_elements(packet#>'{aggregates,groups}') g where g->>'kind'='topic' and g->>'key'='bci' and g->'count'='30'::jsonb)=1,'Topic aggregates sampled or duplicated';
  before_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet=before_packet,'Same fingerprint did not reuse exact revision';
  pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert pinned#>'{counts,eligible}'='0'::jsonb and pinned->>'feedback_revision'<>packet->>'feedback_revision','Old run did not keep its original semantic context';

  -- Historical fingerprint reuse must not make the next new revision collide.
  update public.opportunities set title='Changed public title' where id=target;
  intermediate:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  update public.opportunities set title='Synthetic research' where id=target;
  after_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert after_packet->>'feedback_revision'=packet->>'feedback_revision','Historical fingerprint did not reuse original revision';
  update public.opportunities set title='Another public title' where id=target;
  after_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert (after_packet->>'feedback_revision')::bigint>(intermediate->>'feedback_revision')::bigint,'Revision allocator reused a published key';

  execute 'set local role authenticated';
  perform public.save_opportunity_feedback(target,'{"interest_rating":10,"search_feedback_summary":"Prefer hands-on BCI and sensing prototypes."}');
  select * into proof from public.opportunity_reviews where user_id=owner_a and opportunity_id=target;
  perform public.approve_opportunity_feedback_summary(target,proof.search_feedback_summary_hash,proof.search_feedback_source_hash,proof.search_feedback_revision);
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet#>'{aggregates,score_sum}'='184'::jsonb and packet#>'{aggregates,mean_interest}'='6.133333'::jsonb,'Null-safe exact aggregate arithmetic failed';
  insert into public.opportunity_search_runs(id,user_id,search_id) values(gen_random_uuid(),owner_a,search_a) returning id into run_a;
  pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert exists(select 1 from jsonb_array_elements(pinned->'examples') e where e->>'opportunity_id'=target::text and e?'search_feedback_summary'),'Approved summary not selected';
  old_revision:=(pinned->>'feedback_revision')::bigint;old_hash:=pinned->>'input_fingerprint';
  execute 'set local role authenticated';
  perform public.revoke_opportunity_feedback_summary(target);
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots s cross join lateral jsonb_array_elements(s.packet->'examples') e
    where s.user_id=owner_a and e->>'opportunity_id'=target::text and e?'search_feedback_summary'),'Revoked text remained in stored owner-readable snapshots';
  execute 'reset role';
  pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert (pinned->>'feedback_revision')::bigint=old_revision and pinned->'privacy_scope_changed'='true'::jsonb,'Privacy revocation replaced semantic pin or omitted changed scope';
  assert pinned#>'{aggregates,score_sum}'='184'::jsonb,'Summary revocation changed numeric pinned context';

  -- Reapproval before a fresh compile must have a new lifecycle fingerprint.
  execute 'set local role authenticated';
  perform public.approve_opportunity_feedback_summary(target,proof.search_feedback_summary_hash,proof.search_feedback_source_hash,proof.search_feedback_revision);
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet->>'input_fingerprint'<>old_hash and (packet->>'feedback_revision')::bigint>old_revision,'Reapproval reused a redacted snapshot';
  assert not exists(select 1 from jsonb_array_elements(private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a)->'examples') e where e?'search_feedback_summary'),'Reapproval restored old pinned text';
  execute 'set local role authenticated';perform public.revoke_opportunity_feedback_summary(target);execute 'reset role';
  intermediate:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  execute 'set local role authenticated';
  perform public.approve_opportunity_feedback_summary(target,proof.search_feedback_summary_hash,proof.search_feedback_source_hash,proof.search_feedback_revision);
  execute 'reset role';
  after_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert (after_packet->>'feedback_revision')::bigint>(intermediate->>'feedback_revision')::bigint,'Reapproval after a fresh compile lost new text';

  -- Excluding an unselected contributor must remove its residual aggregates too.
  select opportunity_id into unselected from public.opportunity_reviews r where user_id=owner_a
    and not exists(select 1 from jsonb_array_elements(after_packet->'examples') e where e->>'opportunity_id'=r.opportunity_id::text) limit 1;
  execute 'set local role authenticated';
  perform public.save_opportunity_feedback(unselected,'{"feedback_excluded":true}');
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and
    (s.packet->'examples'<>'[]'::jsonb or s.packet#>'{counts,eligible}'<>'0'::jsonb or s.packet#>'{aggregates,groups}'<>'[]'::jsonb)),'Excluded unselected evidence remained in cached aggregates';
  blocked:=false;
  begin insert into public.opportunity_search_feedback_snapshots(user_id,search_id,feedback_revision,input_fingerprint,packet)
    values(owner_a,search_a,999,repeat('a',64),'{}');exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner forged a compiled snapshot';
  update public.opportunity_search_feedback_snapshots set packet='{"comment":"forged private data"}' where user_id=owner_a;
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and s.packet?'comment'),'Owner replaced immutable packet content';
  update public.opportunity_search_adaptive_settings set feedback_dirty=false,feedback_revision=999,feedback_input_fingerprint='forged' where user_id=owner_a and search_id=search_a;
  assert (select feedback_dirty and feedback_revision<>999 and feedback_input_fingerprint<>'forged' from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a),'Owner forged publication metadata or cleared invalidation';
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet#>'{counts,eligible}'='29'::jsonb,'Fresh packet retained excluded item';

  -- Zero-score summary-only feedback remains eligible; unknown score is not zero.
  opportunity:=gen_random_uuid();insert into public.opportunities(id,opportunity_key,title) values(opportunity,'af03-'||opportunity,'Summary only');
  execute 'set local role authenticated';
  perform public.save_opportunity_feedback(opportunity,'{"search_feedback_summary":"Prefer research with physical sensing experiments."}');
  select * into proof from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity;
  perform public.approve_opportunity_feedback_summary(opportunity,proof.search_feedback_summary_hash,proof.search_feedback_source_hash,proof.search_feedback_revision);
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet#>'{counts,eligible}'='30'::jsonb and packet#>'{counts,scored}'='29'::jsonb,'Approved summary-only feedback dropped or counted as numeric zero';

  -- Owner isolation and consent removal redact old packets without browser work.
  packet:=private.compile_opportunity_feedback_snapshot(owner_b,search_b);
  execute 'set local role authenticated';perform public.set_opportunity_feedback_consent(other_search,true);execute 'reset role';
  before_packet:=private.compile_opportunity_feedback_snapshot(owner_a,other_search);
  execute 'set local role authenticated';
  select count(*) into affected from public.opportunity_search_feedback_snapshots where user_id=owner_b;
  assert affected=0,'Owner A read B snapshot';
  assert not has_function_privilege(current_user,'private.compile_opportunity_feedback_snapshot(uuid,uuid)','EXECUTE'),'Compiler exposed as public runner';
  perform public.set_opportunity_feedback_consent(search_a,false);
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and s.search_id=search_a and s.packet->'examples'<>'[]'::jsonb),'Consent revocation retained old text';
  assert (select s.packet=before_packet from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and s.search_id=other_search
    and s.feedback_revision=(before_packet->>'feedback_revision')::bigint),'Per-search consent changed another search snapshot';
  assert not(select feedback_dirty from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=other_search),'Per-search consent dirtied another search';
  delete from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a;
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots where user_id=owner_a and search_id=search_a),'Owner cleanup left snapshot text';
  execute 'reset role';
  pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert pinned->'privacy_scope_changed'='true'::jsonb and pinned->'examples'='[]'::jsonb,'Deleted pin silently rebuilt private context';
  execute 'set local role authenticated';perform public.set_opportunity_feedback_consent(search_a,true);execute 'reset role';
  after_packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert (after_packet->>'feedback_revision')::bigint>old_revision,'Settings recreation recycled a surviving run revision';
  pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
  assert (pinned->>'feedback_revision')::bigint=old_revision and pinned->>'input_fingerprint'=old_hash
    and pinned->'privacy_scope_changed'='true'::jsonb and pinned->'examples'='[]'::jsonb,'Settings recreation replaced old pinned context';
  assert (select revision from public.opportunity_search_templates where id=search_a)=original_version,'Feedback changed the user-authored base revision';
  assert (select count(*) from public.opportunity_search_feedback_snapshots where user_id=owner_b)=1,'Owner cleanup deleted another owner snapshot';
end;
$$;
rollback;
