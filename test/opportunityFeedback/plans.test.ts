import assert from 'node:assert/strict';
import { test } from 'node:test';
import { file, reset, sql } from './db';

test('AF-04 installs on the pinned real v1 bootstrap without rewriting legacy queries or its strict writer', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql']) sql(file(`../../supabase/${path}`));
  const owner = '74000000-0000-4000-8000-000000000001';
  const search = '74000000-0000-4000-8000-000000000002';
  const run = '74000000-0000-4000-8000-000000000003';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}','Synthetic legacy search','{"topicsAndMethods":"Synthetic robotics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"Europe/Tirane","runImmediately":false}');
    select private.begin_opportunity_search('${search}','${run}');
    select private.save_opportunity_search_queries('${run}','[{"query":"funded robotics PhD","sources":["EXAMPLE.invalid","https://example.invalid/Jobs?jobId=123"]}]');`);
  const original = sql('select jsonb_agg(to_jsonb(q) order by id) from public.opportunity_search_query_revisions q;');
  const writer = sql("select pg_get_functiondef('private.save_opportunity_search_queries(uuid,jsonb)'::regprocedure);");
  sql(file('../../supabase/opportunity_search_plans.sql'));
  assert.equal(sql('select jsonb_agg(to_jsonb(q) order by id) from public.opportunity_search_query_revisions q;'), original);
  assert.equal(sql("select pg_get_functiondef('private.save_opportunity_search_queries(uuid,jsonb)'::regprocedure);"), writer);
  assert.throws(() => sql(`select private.save_opportunity_search_queries('${run}',
    '[{"query":"funded robotics PhD","role":"core"}]');`), /query text and optional|generated query/i,
  'The old strict writer must still reject adaptive-only fields');
  assert.equal(sql("select active_protocol_version from private.opportunity_search_settings;"), 'opportunity-search-v1-canonical-5');
});

test('AF-04 synthetic registry, coverage, reuse, plan versions and owner isolation', () => {
  sql(file('../../supabase/tests/opportunity_search_plans.sql'));
});
