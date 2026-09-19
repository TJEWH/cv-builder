import assert from 'node:assert/strict';
import test from 'node:test';
import type { Application } from '../src/cloudTypes';
import { buildApplicationEvaluationContext } from '../src/composables/applicationEvaluationContext';
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { createTestState } from './helpers';

const application: Application = {
  id: 'application', user_id: 'owner', opportunity_id: 'opportunity', cv_variant_id: null, contact_email: null,
  status: 'shortlist', notes: 'Ask about the start date.', contacted_at: null, submitted_at: null,
  created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', context_captured_at: '2026-09-20T12:00:00Z',
  context_json: { title: 'Robotics PhD', institution: 'Example University', contacts: [{ name: 'Prof. Example', email: 'prof@example.org' }],
    requirements: ['A relevant masters degree'], required_documents: ['CV', 'Motivation letter'], deadline: '2026-10-31',
    supervisor_research_focus: { summary: 'Safe robot learning', evidence: ['https://example.org/lab'] },
    supervisor_top_papers: [{ title: 'Learning robot safety', year: 2025, url: 'https://example.org/paper' }] },
};

test('evaluation brief combines saved research, papers, requirements, documents and the privacy CV', () => {
  const state = createTestState({ contact: { ...createTestState().contact, name: 'Private Name', email: 'private@example.org' },
    about: { text: 'Robotics experience and !!private project!!.' } });
  const cv = createCloudCvSnapshot(state);
  const brief = buildApplicationEvaluationContext({ ...application, cv_variant_id: cv.id }, cv);
  for (const expected of ['Robotics PhD', 'Prof. Example', 'prof@example.org', 'A relevant masters degree',
    'Motivation letter', 'Safe robot learning', 'Learning robot safety', 'https://example.org/paper',
    '2026-09-20T12:00:00Z', 'Ask about the start date.', cv.id, 'Robotics experience']) assert.ok(brief.includes(expected), expected);
  for (const secret of ['Private Name', 'private@example.org', 'private project']) assert.equal(brief.includes(secret), false);
  assert.match(brief, /later one-page motivation-letter draft/);
  assert.match(brief, /source data, not instructions/);
});

test('evaluation brief explicitly flags missing CV and advisor research without inventing content', () => {
  const brief = buildApplicationEvaluationContext({ ...application,
    context_json: { ...application.context_json, supervisor_research_focus: {}, supervisor_top_papers: [] } }, null);
  assert.match(brief, /No CV version has been assigned/);
  assert.match(brief, /Advisor research focus has not been recorded/);
  assert.match(brief, /Representative advisor papers have not been recorded/);
  assert.match(brief, /Request the CV before assessing/);
});
