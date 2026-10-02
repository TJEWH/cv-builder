import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationStatusHistory } from '../src/composables/applicationTracking';
import { createSyntheticRefinementWorkspace } from './refinementFixture';

test('status history preserves repeated states in server order and never guesses missing transition dates', () => {
  const { props } = createSyntheticRefinementWorkspace();
  const application = { ...props.application, status: 'contacted' as const,
    contacted_at: '2026-09-30T10:00:00Z', submitted_at: '2026-10-01T08:00:00Z',
    status_history: [
      { status: 'shortlist' as const, changedAt: null },
      { status: 'contacted' as const, changedAt: '2026-10-01T09:00:00Z' },
      { status: 'submitted' as const, changedAt: '2026-10-01T10:00:00Z' },
      { status: 'contacted' as const, changedAt: '2026-10-02T08:00:00Z' },
    ] };
  assert.deepEqual(applicationStatusHistory(application), application.status_history);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: undefined }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [] }), [{ status: 'contacted', changedAt: null }]);
  assert.deepEqual(applicationStatusHistory({ ...application, status: 'interview' }).at(-1), { status: 'interview', changedAt: null });
  assert.deepEqual(applicationStatusHistory({ ...application, status_history: [{ status: 'shortlist', changedAt: 'invalid' }] }), [{ status: 'contacted', changedAt: null }]);
});
