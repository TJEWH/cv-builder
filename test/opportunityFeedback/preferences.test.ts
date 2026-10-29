import { test } from 'node:test';
import assert from 'node:assert/strict';
import { file, reset, sql } from './db';
import { compileAdaptiveFeedbackSnapshot } from '../../src/composables/adaptiveFeedbackSnapshots';
import { buildAdaptiveSearchPlanningContext, LEGACY_ADAPTIVE_SEARCH_POLICY } from '../../src/composables/adaptiveSearchPlanner';
import { SEARCH_CRITERIA_KEYS, type SearchCriteria } from '../../src/searchTypes';
import type { SafeOpportunityFeedbackExample } from '../../src/composables/opportunityFeedbackPrivacy';

test('AF-06 approved preferences and planning evidence are versioned and owner scoped', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql',
    'opportunity_search_attribution.sql', 'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql',
    'opportunity_search_preferences.sql', 'opportunity_search_adaptation_sources.sql']) sql(file(`../../supabase/${path}`));
  sql(file('../../supabase/tests/opportunity_search_preferences.sql'));
});

test('AF-06 useful source learning requires active consent and effective canonical evidence', () => {
  sql(file('../../supabase/tests/opportunity_search_adaptation_sources.sql'));
});

test('AF-06 SQL and UI expose the same named initial policy conventions', () => {
  assert.deepEqual(JSON.parse(sql('select public.opportunity_search_adaptation_policy();')), LEGACY_ADAPTIVE_SEARCH_POLICY);
});

test('AF-06 SQL and TypeScript priorities agree on targeted, sparse, conflicting and paused evidence', async () => {
  const user = '87000000-0000-4000-8000-000000000001', search = '87000000-0000-4000-8000-000000000002';
  const criteria = Object.fromEntries(SEARCH_CRITERIA_KEYS.map(key => [key, key === 'topicsAndMethods' ? 'Robotics; BCI' : ''])) as SearchCriteria;
  function example(index: number, score: number, reasons: SafeOpportunityFeedbackExample['reasons'] = []): SafeOpportunityFeedbackExample {
    return { opportunity_id: `87000000-0000-4000-8000-${(100 + index).toString().padStart(12, '0')}`, topics: ['Robotics'],
      metric_version: 'opportunity-interest-v1', interest_score: score, interest_origin: 'explicit_rating', review_state: 'unreviewed',
      feedback_revision: 1, feedback_updated_at: '2026-10-28T12:00:00Z', confirmed_submission: false, submission_at: null,
      baseline_status: 'unavailable', interest_gap: null, reasons };
  }
  const topicNegative = { category: 'topic', polarity: 'negative', target: 'Robotics' } as const;
  const topicPositive = { category: 'topic', polarity: 'positive', target: 'Robotics' } as const;
  const cases = [
    { label: 'timing and location cannot lend support to one topic-negative reason', examples: [example(1, 2, [topicNegative]),
      example(2, 2, [{ category: 'timing', polarity: 'negative' }]), example(3, 2, [{ category: 'location', polarity: 'negative' }])] },
    { label: 'three matching topic negatives', examples: [1, 2, 3].map(index => example(index, 2, [topicNegative])) },
    { label: 'hardware reasons do not penalize topics', examples: [1, 2, 3].map(index => example(index, 2, [{ category: 'hardware', polarity: 'negative' }])) },
    { label: 'positive whole topic cohort', examples: [1, 2, 3].map(index => example(index, 8)) },
    { label: 'sparse positive cohort', examples: [1, 2].map(index => example(index, 8)) },
    { label: 'opposite targeted reasons', examples: [example(1, 2, [topicNegative]), example(2, 8, [topicPositive]), example(3, 8, [topicPositive])] },
    { label: 'untargeted positive topic tags', examples: [1, 2, 3].map(index => example(index, 8, [{ category: 'topic', polarity: 'positive' }])) },
    { label: 'untargeted contradictory method tags', examples: [1, 2, 3].map(index => example(index, 8,
      [{ category: 'method', polarity: 'positive' }, { category: 'method', polarity: 'negative' }])) },
    { label: 'paused adaptation', examples: [1, 2, 3].map(index => example(index, 8)), paused: true },
    { label: 'revoked structured consent', examples: [1, 2, 3].map(index => example(index, 8)), consent: false },
    { label: 'pinned direct sources remain separate from query slots', examples: [], sources: [
      { registry_id: '87000000-0000-4000-8000-000000000301', mandatory: false, pinned: true },
      { registry_id: '87000000-0000-4000-8000-000000000302', mandatory: true, pinned: false },
    ] },
  ];
  for (const fixture of cases) {
    const consent = fixture.consent !== false, paused = fixture.paused === true;
    const packet = await compileAdaptiveFeedbackSnapshot({ user_id: user, search_id: search, structured_feedback_enabled: consent,
      consent_revision: 1, feedback_revision: 1, examples: fixture.examples });
    const encode = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    const saved = JSON.parse(sql(`begin;
      insert into auth.users(id) values('${user}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
        values('${search}','${user}','Synthetic planner parity',${encode(criteria)},
          '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
      insert into public.opportunity_search_adaptive_settings(user_id,search_id,adaptation_enabled,adaptation_paused,structured_feedback_enabled)
        values('${user}','${search}',true,${paused},${consent});
      ${(fixture.sources ?? []).map(source => `insert into public.opportunity_search_sources(registry_id,user_id,search_id,listing_url,enabled,pinned,mandatory)
        values('${source.registry_id}','${user}','${search}','https://example.invalid/Jobs/${source.registry_id}',true,${source.pinned},${source.mandatory});`).join('\n')}
      select private.opportunity_search_planning_context('${user}','${search}',${encode(packet)});
      rollback;`));
    const browser = buildAdaptiveSearchPlanningContext({ user_id: user, search_id: search, base_criteria: criteria,
      basis: saved.basis, feedback: packet, approved_rules: [], core_queries: [], due_sources: fixture.sources ?? [],
      adaptation_enabled: true, adaptation_paused: paused, structured_feedback_enabled: consent, policy: LEGACY_ADAPTIVE_SEARCH_POLICY });
    for (const key of ['policy', 'enabled', 'paused', 'consent_enabled', 'preference_revision', 'approved_rules',
      'approved_preferences', 'priorities', 'allocation', 'blocked_core_queries', 'refresh_required', 'basis'] as const) {
      assert.deepEqual(saved[key], browser[key], `${fixture.label}: ${key}`);
    }
  }
});
