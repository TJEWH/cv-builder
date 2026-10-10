import assert from 'node:assert/strict';
import test from 'node:test';
import type { Application } from '../src/cloudTypes';
import { applicationStage, applicationStatusHistory, applicationTrackingStarted, normalizeApplication } from '../src/composables/applicationTracking';
import { createSyntheticRefinementWorkspace } from './refinementFixture';

test('status history preserves repeated states in server order and never guesses missing transition dates', () => {
  const { props } = createSyntheticRefinementWorkspace();
  const application = { ...props.application, status: 'contacted' as const,
    contacted_at: '2026-09-30T10:00:00Z', submitted_at: '2026-10-01T08:00:00Z',
    status_history: [
      { status: 'ready' as const, changedAt: null },
      { status: 'contacted' as const, changedAt: '2026-10-01T09:00:00Z' },
      { status: 'submitted' as const, changedAt: '2026-10-01T10:00:00Z' },
      { status: 'contacted' as const, changedAt: '2026-10-02T08:00:00Z' },
    ] };
  assert.deepEqual(applicationStatusHistory(application), application.status_history);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: undefined }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [] }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status: 'interview' }).at(-1), { status: 'interview', changedAt: null });
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [{ status: 'ready', changedAt: 'invalid' }] }), [{ status: 'contacted', changedAt: null }]);
});

test('saved tab is restored independently from an explicit tracking status', () => {
  const { props } = createSyntheticRefinementWorkspace();
  for (const workflow_stage of ['preparation', 'refinement', 'review', 'tracking'] as const) {
    const application = { ...props.application, status: 'submitted' as const, workflow_stage, tracking_started: true };
    assert.equal(applicationStage(application), workflow_stage);
    assert.equal(applicationTrackingStarted(application), true);
  }
  assert.equal(applicationTrackingStarted({ ...props.application, status: 'ready', tracking_started: true }), true);
  assert.equal(applicationTrackingStarted({ ...props.application, status: 'ready', tracking_started: false }), false);
});

test('legacy rows normalize Shortlist and history without inventing saved workflow fields or dates', () => {
  const { props } = createSyntheticRefinementWorkspace();
  const legacy = { ...props.application, status: 'shortlist', status_history: [{ status: 'shortlist', changedAt: null }],
    workflow_stage: undefined, tracking_started: undefined } as unknown as Application;
  const normalized = normalizeApplication(legacy);
  assert.equal(normalized.status, 'ready');
  assert.deepEqual(applicationStatusHistory(legacy), [{ status: 'ready', changedAt: null }]);
  assert.equal(applicationStage(normalized), 'tracking');
  assert.equal(applicationTrackingStarted(normalized), false);
  assert.equal(normalized.workflow_stage, undefined);
  assert.equal(normalized.tracking_started, undefined);
  assert.equal(applicationTrackingStarted({ ...normalized, status: 'contacted' }), true);
  assert.equal(applicationStage({ ...normalized, status: 'preparation' }), 'preparation');
  assert.equal(applicationStage({ ...normalized, status: 'refinement' }), 'refinement');
  assert.equal(applicationStage({ ...normalized, status: 'attachments' }), 'review');
});
