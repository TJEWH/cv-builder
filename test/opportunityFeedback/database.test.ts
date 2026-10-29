import assert from 'node:assert/strict';
import { test } from 'node:test';
import { file, reset, sql, sqlAsync } from './db';

const owner = '10000000-0000-4000-8000-000000000001';
const opportunity = '10000000-0000-4000-8000-000000000002';
const application = '10000000-0000-4000-8000-000000000003';
const actor = `set local role authenticated; set local request.jwt.claim.sub='${owner}';`;

test('AF-01 additive installation preserves existing catalogue, applications, reviews and access rules', () => {
  reset();
  sql(`insert into auth.users(id) values ('${owner}');
    insert into public.opportunities(id,opportunity_key,title) values ('${opportunity}','af01-legacy-fixture','Synthetic legacy opportunity');
    insert into public.opportunity_reviews(user_id,opportunity_id,state,comment,created_at,updated_at)
      values ('${owner}','${opportunity}','interested','Synthetic private comment','2020-01-01Z','2020-01-02Z');
    begin; set local request.jwt.claim.sub='${owner}';
      select public.create_job_application('${application}','${opportunity}'); commit;`);
  const catalogue = sql('select jsonb_agg(to_jsonb(o)) from public.opportunities o;');
  const applications = sql('select jsonb_agg(to_jsonb(a)) from public.applications a;');
  const reviews = sql('select jsonb_agg(to_jsonb(r)) from public.opportunity_reviews r;');
  const policies = sql(`select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where tablename='opportunity_reviews';`);
  const grants = sql("select relacl from pg_class where oid='public.opportunity_reviews'::regclass;");
  const receiptRpc = sql("select pg_get_functiondef('public.review_job_opportunity(uuid,timestamptz,text)'::regprocedure);");
  sql(file('../../supabase/opportunity_feedback_signals.sql'));
  assert.equal(sql('select jsonb_agg(to_jsonb(o)) from public.opportunities o;'), catalogue);
  assert.equal(sql('select jsonb_agg(to_jsonb(a)) from public.applications a;'), applications);
  assert.equal(sql(`select jsonb_agg(to_jsonb(r) - array['interest_rating','interest_reasons','feedback_excluded',
    'feedback_revision','feedback_updated_at','prediction_baseline']) from public.opportunity_reviews r;`), reviews);
  assert.equal(sql(`select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where tablename='opportunity_reviews';`), policies);
  assert.equal(sql("select relacl from pg_class where oid='public.opportunity_reviews'::regclass;"), grants);
  assert.equal(sql("select pg_get_functiondef('public.review_job_opportunity(uuid,timestamptz,text)'::regprocedure);"), receiptRpc);
  const outcome = JSON.parse(sql(`select private.opportunity_interest_metric('${owner}','${opportunity}');`));
  assert.equal(outcome.interest_score, 6);
  assert.equal(outcome.feedback_revision, 0);
  assert.equal(outcome.feedback_updated_at, null, 'legacy meaningful time is unknown, never copied from updated_at');
  assert.equal(outcome.interest_gap, null);
  assert.equal(outcome.baseline_status, 'unavailable');
});

test('SIG-01–08 / PRIV-07 synthetic SQL acceptance cases', () => {
  sql(file('../../supabase/tests/opportunity_feedback_signals.sql'));
});

test('concurrent owner writes serialize meaningful revisions while view receipts remain neutral', async () => {
  sql(`update public.opportunity_reviews set state='unreviewed' where user_id='${owner}' and opportunity_id='${opportunity}';`);
  const before = Number(sql(`select feedback_revision from public.opportunity_reviews where user_id='${owner}' and opportunity_id='${opportunity}';`));
  const results = await Promise.allSettled([
    sqlAsync(`begin; ${actor} update public.opportunity_reviews set interest_rating=1 where opportunity_id='${opportunity}';
      select pg_sleep(0.15); commit;`),
    sqlAsync(`begin; ${actor} update public.opportunity_reviews set interest_rating=2 where opportunity_id='${opportunity}'; commit;`),
    sqlAsync(`begin; ${actor} select public.review_job_opportunity('${opportunity}',now(),null); commit;`),
  ]);
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
  const outcome = JSON.parse(sql(`select private.opportunity_interest_metric('${owner}','${opportunity}');`));
  assert.equal(outcome.feedback_revision, before + 2);
  assert.ok([1, 2].includes(outcome.interest_score));
  assert.equal(outcome.interest_origin, 'explicit_rating');
  assert.equal(sql(`select count(*) from public.opportunity_reviews where user_id='${owner}' and opportunity_id='${opportunity}';`), '1');
});
