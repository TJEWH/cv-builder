import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOpportunityEvaluation, readLegacyOpportunityFeedbackDraft, clearLegacyOpportunityFeedbackDraft } from '../src/composables/opportunityEvaluation';

test('unified evaluations preserve either missing source and empty values', () => {
  assert.equal(mergeOpportunityEvaluation(), '');
  assert.equal(mergeOpportunityEvaluation(null, undefined), '');
  assert.equal(mergeOpportunityEvaluation('', ''), '');
  assert.equal(mergeOpportunityEvaluation('Existing evaluation', null), 'Existing evaluation');
  assert.equal(mergeOpportunityEvaluation(undefined, 'Existing feedback'), 'Existing feedback');
  assert.equal(mergeOpportunityEvaluation('', 'Existing feedback'), 'Existing feedback');
  assert.equal(mergeOpportunityEvaluation('Existing evaluation', ''), 'Existing evaluation');
});

test('unified evaluations retain both distinct texts in evaluation-first order', () => {
  const comment = 'Existing personal evaluation.', summary = 'Prefer practical acoustic research.';
  assert.equal(mergeOpportunityEvaluation(comment, summary), `${comment}\n\n${summary}`);
});

test('unified evaluations do not duplicate equal or already contained text', () => {
  assert.equal(mergeOpportunityEvaluation('Exact shared text', 'Exact shared text'), 'Exact shared text');
  const containing = 'First paragraph.\n\nShared feedback.\n\nLast paragraph.';
  assert.equal(mergeOpportunityEvaluation(containing, 'Shared feedback.'), containing);
  assert.equal(mergeOpportunityEvaluation('Shared feedback.', containing), containing);
  const once = mergeOpportunityEvaluation('Private assessment.', 'Public research preferences.');
  assert.equal(mergeOpportunityEvaluation(once, 'Public research preferences.'), once);
});

test('unified evaluations preserve whitespace, casing and line endings exactly', () => {
  const comment = '  Evaluation\r\nwith trailing spaces  ', summary = '\tfeedback\n';
  assert.equal(mergeOpportunityEvaluation(comment, summary), `${comment}\n\n${summary}`);
  assert.equal(mergeOpportunityEvaluation('Acoustics', 'acoustics'), 'Acoustics\n\nacoustics');
  assert.equal(mergeOpportunityEvaluation('  ', '\t'), '  \n\n\t');
  assert.equal(mergeOpportunityEvaluation('\n', null), '\n');
});

test('unified evaluations never truncate the combined legacy storage limits', () => {
  const comment = 'a'.repeat(5000), summary = 'b'.repeat(600);
  const merged = mergeOpportunityEvaluation(comment, summary);
  assert.equal(merged, `${comment}\n\n${summary}`);
  assert.equal(merged.length, 5602);
  assert.equal(mergeOpportunityEvaluation(merged, summary), merged);
});

test('unified evaluations preserve non-BMP characters and Unicode byte sequences', () => {
  const comment = '🧪 PhD 音響 e\u0301\r\n', summary = '🦻 BCI é\n';
  const expected = `${comment}\n\n${summary}`;
  assert.equal(mergeOpportunityEvaluation(comment, summary), expected);
  assert.deepEqual(new TextEncoder().encode(mergeOpportunityEvaluation(comment, summary)), new TextEncoder().encode(expected));
  assert.equal(mergeOpportunityEvaluation('🧪 Research', '🧪'), '🧪 Research');
});

function recoveryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
}
const recoveryKey = (owner: string, id: string) => `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:${encodeURIComponent(owner)}:${encodeURIComponent(id)}`;

test('legacy feedback recovery reads exact bounded Unicode drafts scoped by owner and opportunity', () => {
  const storage = recoveryStorage(), owner = 'owner:one/🧪', id = 'opportunity:two/🦻', value = `  ${'🧪'.repeat(596)}\r\n`;
  storage.values.set(recoveryKey(owner, id), JSON.stringify({ value }));
  assert.equal(Array.from(value).length, 600);
  assert.equal(readLegacyOpportunityFeedbackDraft(owner, id, storage), value);
  assert.equal(readLegacyOpportunityFeedbackDraft('another-owner', id, storage), undefined);
  assert.equal(readLegacyOpportunityFeedbackDraft(owner, 'another-opportunity', storage), undefined);
  assert.equal(storage.values.size, 1, 'reading recovery never saves or clears it');
});

test('legacy feedback recovery rejects malformed or oversized entries without truncating or deleting them', () => {
  const storage = recoveryStorage(), key = recoveryKey('owner', 'opportunity');
  for (const raw of ['not JSON', '{}', 'null', JSON.stringify({ value: 42 }), JSON.stringify({ value: '🧪'.repeat(601) })]) {
    storage.values.set(key, raw);
    assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', storage), undefined);
    assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', undefined, storage), false);
    assert.equal(storage.values.get(key), raw);
  }
  storage.values.set(key, JSON.stringify({ value: '' }));
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', storage), '');
});

test('legacy feedback recovery clears only the successfully incorporated exact draft version', () => {
  const storage = recoveryStorage(), key = recoveryKey('owner', 'opportunity');
  storage.values.set(key, JSON.stringify({ value: 'Original draft' }));
  assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', 'Different draft', storage), false);
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', storage), 'Original draft');
  storage.values.set(key, JSON.stringify({ value: 'Newer draft from another tab' }));
  assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', 'Original draft', storage), false);
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', storage), 'Newer draft from another tab');
  assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', 'Newer draft from another tab', storage), true);
  assert.equal(storage.values.has(key), false);
});

test('legacy feedback recovery tolerates unavailable storage and safely defaults to browser localStorage', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  const storage = recoveryStorage(), key = recoveryKey('owner', 'opportunity');
  storage.values.set(key, JSON.stringify({ value: 'Recovered in the browser' }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity'), 'Recovered in the browser');
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', null), undefined);
  assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', 'Recovered in the browser'), true);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage denied'); } });
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity'), undefined);
  assert.equal(clearLegacyOpportunityFeedbackDraft('owner', 'opportunity', 'anything'), false);
  assert.equal(readLegacyOpportunityFeedbackDraft('owner', 'opportunity', { getItem() { throw new Error('Read denied'); }, removeItem() {} }), undefined);
});
