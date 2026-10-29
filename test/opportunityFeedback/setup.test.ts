import { test } from 'node:test';
import assert from 'node:assert/strict';
import { file, reset, sql } from './db';
import { buildAdaptiveRecurringSearchPrompt } from '../../src/composables/adaptiveSearchTask';

test('AF-09 setup gates explicit migration, reads one safe handoff and records only setup receipts', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql',
    'opportunity_search_attribution.sql', 'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql',
    'opportunity_search_preferences.sql', 'opportunity_search_adaptation_sources.sql', 'opportunity_search_adaptive_startup.sql',
    'opportunity_search_adaptive_batches.sql', 'opportunity_search_adaptive_completion.sql', 'opportunity_search_adaptive_setup.sql']) {
    sql(file(`../../supabase/${path}`));
  }
  sql(file('../../supabase/tests/opportunity_search_adaptive_setup.sql'));
});

test('AF-09 installed and client recurring instructions are byte-identical for the same fixed scope', () => {
  const search = '11111111-1111-4111-8111-111111111111', project = 'abcdefghijklmnopqrst';
  const installed = JSON.parse(sql(`select to_jsonb(private.adaptive_search_recurring_prompt('${search}'::uuid,'${project}'::text));`));
  assert.equal(installed, buildAdaptiveRecurringSearchPrompt(search, project));
  assert.equal((installed.match(/SELECT private\./gu) || []).length, 1);
  assert(!installed.includes('private.read_adaptive_search_setup('));
  assert(!installed.includes('private.ack_adaptive_search_setup('));
});
