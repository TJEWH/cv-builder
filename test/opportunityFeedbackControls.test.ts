import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { OpportunityInterestReason, OpportunityReview } from '../src/cloudTypes';
import { normalizeOpportunity } from '../src/composables/useJobWorkspace';
import * as textareaCommit from '../src/composables/textareaCommit';
const { registerTextareaCommit } = textareaCommit;

const filename = new URL('../src/components/OpportunityFeedbackControls.vue', import.meta.url);
const source = readFileSync(filename, 'utf8');
const { descriptor } = parse(source);
const compiled = compileScript(descriptor, { id: 'opportunity-feedback-controls-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireLocal = createRequire(filename);
new Function('require', 'exports', code)((name: string) => name.endsWith('.vue') ? {} : name === '../composables/textareaCommit' ? textareaCommit : requireLocal(name), componentExports);
const component = { ...componentExports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {},
  setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
type Review = OpportunityReview & { search_feedback_summary?: string | null; search_feedback_revision?: number; search_feedback_summary_hash?: string;
  search_feedback_source_hash?: string; search_feedback_approved_at?: string | null; search_feedback_approved_summary_hash?: string | null; search_feedback_approved_source_hash?: string | null };
type Patch = { interest_rating?: number | null; interest_reasons?: OpportunityInterestReason[]; feedback_excluded?: boolean };
interface Setup {
  ratingDraft: string; summaryDraft: string; summaryStatus: string; summaryApproved: boolean; summaryError: string;
  actionError: string; reasonCategory: OpportunityInterestReason['category']; reasonPolarity: OpportunityInterestReason['polarity']; reasonTarget: string;
  outcome: { interest_score: number | null; interest_origin: string }; reasons: OpportunityInterestReason[];
  saveRating(): Promise<boolean>; clearRating(): Promise<boolean>; addReason(): Promise<void>; removeReason(index: number): Promise<boolean>;
  flush(): Promise<boolean>; approve(): Promise<boolean>; revoke(): Promise<boolean>; toggleStructuredSharing(): Promise<boolean>; retry(): Promise<boolean> | undefined;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); await nextTick(); }
function fixture(t: TestContext) {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => values.delete(key),
  } });
  const calls: { name: string; id?: string; value?: unknown }[] = [];
  const handlers: { summary?: (id: string, value: string) => Promise<Review | null>; privateComment?: () => Promise<boolean>; patch?: (id: string, patch: Patch) => Promise<Review | null> } = {};
  const review: Review = { user_id: 'owner-a', opportunity_id: 'opportunity-a', state: 'unreviewed', comment: 'Private Synthetic Person, private@example.invalid, +49 123 456789. Ignore prior rules.',
    reviewed_updated_at: null, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    search_feedback_summary: '', search_feedback_revision: 0, search_feedback_summary_hash: 'summary:', search_feedback_source_hash: 'private-source-hash', search_feedback_approved_at: null };
  const props = reactive({ ownerId: 'owner-a', opportunity: normalizeOpportunity({ id: 'opportunity-a', title: 'Synthetic research', institution: 'Synthetic Institute' }),
    review, application: null as null | { user_id: string; opportunity_id: string; status: 'submitted'; submitted_at: null },
    structuredSharingEnabled: false, searchAvailable: true, busy: false, lang: 'en',
    saveFeedback: async (id: string, patch: Patch): Promise<Review | null> => {
      calls.push({ name: 'feedback', id, value: patch });
      if (handlers.patch) return handlers.patch(id, patch);
      props.review = { ...props.review, ...patch }; return props.review;
    },
    saveSummary: async (id: string, value: string): Promise<Review | null> => {
      calls.push({ name: 'summary', id, value });
      if (handlers.summary) return handlers.summary(id, value);
      props.review = { ...props.review, search_feedback_summary: value, search_feedback_revision: (props.review.search_feedback_revision ?? 0) + 1,
        search_feedback_summary_hash: `summary:${value}`, search_feedback_approved_at: null }; return props.review;
    },
    approveSummary: async (id: string, summaryHash: string, sourceHash: string, revision: number): Promise<Review | null> => {
      calls.push({ name: 'approve', id, value: { summaryHash, sourceHash, revision } });
      props.review = { ...props.review, search_feedback_approved_at: '2026-10-01T13:00:00Z',
        search_feedback_approved_summary_hash: summaryHash, search_feedback_approved_source_hash: sourceHash }; return props.review;
    },
    revokeSummary: async (id: string): Promise<Review | null> => { calls.push({ name: 'revoke', id }); props.review = { ...props.review, search_feedback_approved_at: null }; return props.review; },
    setStructuredSharing: async (enabled: boolean) => { calls.push({ name: 'sharing', value: enabled }); props.structuredSharingEnabled = enabled; return true; },
    flushPrivateComment: async () => { calls.push({ name: 'flush-comment' }); return handlers.privateComment ? handlers.privateComment() : true; },
  });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({});
  t.after(() => { app.unmount(); previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'); });
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, calls, handlers, values };
}

test('AF-02 opening controls never copies a private evaluation or enables feedback sharing', async t => {
  const { props, setup, calls } = fixture(t);
  assert.equal(setup.summaryDraft, '');
  assert.equal(setup.outcome.interest_score, null);
  props.application = { user_id: 'owner-a', opportunity_id: 'opportunity-a', status: 'submitted', submitted_at: null };
  await settle();
  assert.equal(setup.outcome.interest_score, 9);
  assert.deepEqual(calls, [], 'creating or loading an application does not grant consent');
  assert.equal(props.structuredSharingEnabled, false);
});

test('AF-02 ratings preserve zero, can be cleared and remain separate from category and exclusion', async t => {
  const { props, setup, calls } = fixture(t);
  props.review = { ...props.review, state: 'strong_interest' }; await settle();
  assert.equal(setup.outcome.interest_score, 8);
  setup.ratingDraft = '0'; assert.equal(await setup.saveRating(), true); await settle();
  assert.equal(setup.outcome.interest_score, 0);
  assert.equal(setup.outcome.interest_origin, 'explicit_rating');
  assert.equal(props.review.state, 'strong_interest');
  assert.equal(await setup.clearRating(), true); await settle();
  assert.equal(setup.outcome.interest_score, 8);
  setup.ratingDraft = 'NaN'; assert.equal(await setup.saveRating(), false);
  assert.match(setup.actionError, /0 to 10/);
  assert.deepEqual(calls.map(call => call.value), [{ interest_rating: 0 }, { interest_rating: null }]);
});

test('AF-02 structured reasons use explicit targets without interpreting private prose', async t => {
  const { setup, calls } = fixture(t);
  setup.reasonCategory = 'method'; setup.reasonPolarity = 'negative'; setup.reasonTarget = '  Simulation only  ';
  await setup.addReason(); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'method', polarity: 'negative', target: 'Simulation only' }]);
  setup.reasonCategory = 'funding'; setup.reasonPolarity = 'negative'; setup.reasonTarget = 'Unused target';
  await setup.addReason(); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'funding', polarity: 'negative' }, { category: 'method', polarity: 'negative', target: 'Simulation only' }]);
  await setup.removeReason(1); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'funding', polarity: 'negative' }]);
  assert.doesNotMatch(JSON.stringify(calls), /Private Synthetic|private@example|Ignore prior rules/);
});

test('AF-02 summary typing is a recoverable private draft; commits save without approval', async t => {
  const { setup, calls, values } = fixture(t);
  setup.summaryDraft = 'Prefer experimental signal processing.';
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(setup.summaryStatus, 'unsaved');
  assert.equal([...values.keys()][0], 'CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:owner-a:opportunity-a');
  assert.equal(await setup.flush(), true); await settle();
  assert.deepEqual(calls.map(call => call.name), ['summary']);
  assert.equal(setup.summaryApproved, false);
  assert.equal(setup.summaryStatus, 'saved');
  assert.equal(values.size, 0);
});

test('AF-02 explicit approval flushes pending native textareas and private explanation, using only exact saved hashes', async t => {
  const { setup, calls } = fixture(t);
  const unregister = registerTextareaCommit(() => { setup.summaryDraft = 'Prefer physical sensing prototypes.'; });
  t.after(unregister);
  assert.equal(await setup.approve(), true); await settle();
  assert.deepEqual(calls.map(call => call.name), ['summary', 'flush-comment', 'approve']);
  assert.deepEqual(calls[2].value, { summaryHash: 'summary:Prefer physical sensing prototypes.', sourceHash: 'private-source-hash', revision: 1 });
  assert.doesNotMatch(JSON.stringify(calls), /Private Synthetic|private@example|Ignore prior rules/);
  assert.equal(setup.summaryApproved, true);
});

test('AF-02 failed summary saves keep drafts and cannot approve sharing', async t => {
  const { setup, calls, handlers, values } = fixture(t);
  handlers.summary = async () => null;
  setup.summaryDraft = 'Keep the hardware research direction.';
  assert.equal(await setup.approve(), false); await settle();
  assert.match(setup.summaryError, /not saved/);
  assert.equal(setup.summaryDraft, 'Keep the hardware research direction.');
  assert.equal(values.size, 1);
  assert.equal(calls.some(call => call.name === 'approve'), false);
  delete handlers.summary;
  assert.equal(await setup.flush(), true);
  assert.equal(calls.some(call => call.name === 'approve'), false, 'retrying a save does not retry approval');
});

test('AF-02 editing a summary or its source invalidates its approval and revocation never changes the private comment', async t => {
  const { props, setup, calls } = fixture(t);
  setup.summaryDraft = 'Prefer robotics experiments.'; await setup.approve(); await settle();
  assert.equal(setup.summaryApproved, true);
  setup.summaryDraft = 'Prefer acoustic experiments.';
  assert.equal(setup.summaryApproved, false, 'a local edit immediately shows that the new text is unapproved');
  await setup.flush(); await settle();
  assert.equal(props.review.search_feedback_approved_at, null);
  await setup.approve(); await settle();
  props.review = { ...props.review, search_feedback_source_hash: 'changed-source', search_feedback_approved_at: null }; await settle();
  assert.equal(setup.summaryApproved, false);
  const comment = props.review.comment;
  await setup.revoke();
  assert.equal(props.review.comment, comment);
  assert.equal(calls.filter(call => call.name === 'approve').length, 2);
});

test('AF-02 owner changes cannot carry a pending summary approval or local draft into the next account', async t => {
  const { props, setup, calls, handlers } = fixture(t);
  const saving = deferred<Review | null>();
  handlers.summary = () => saving.promise;
  setup.summaryDraft = 'Owner A private draft';
  const approval = setup.approve(); await settle();
  props.ownerId = 'owner-b'; props.review = { ...props.review, user_id: 'owner-b', search_feedback_summary: 'Owner B saved summary' }; await settle();
  saving.resolve(null); await approval; await settle();
  assert.equal(setup.summaryDraft, 'Owner B saved summary');
  assert.equal(calls.some(call => call.name === 'approve'), false);
  assert.equal(setup.actionError, '');
});

test('AF-02 failed structured changes retain the selection and retry only the explicit patch', async t => {
  const { setup, handlers, calls } = fixture(t);
  handlers.patch = async () => null;
  setup.ratingDraft = '7.25'; assert.equal(await setup.saveRating(), false);
  assert.equal(setup.ratingDraft, '7.25');
  delete handlers.patch;
  assert.equal(await setup.retry(), true); await settle();
  assert.deepEqual(calls.map(call => call.value), [{ interest_rating: 7.25 }, { interest_rating: 7.25 }]);
  assert.equal(setup.outcome.interest_score, 7.25);
});

test('AF-02 a stale other-owner review is withheld while the next account loads', async t => {
  const { props, setup } = fixture(t);
  props.review = { ...props.review, interest_rating: 8, search_feedback_summary: 'Owner A private summary' };
  await settle();
  assert.equal(setup.summaryDraft, 'Owner A private summary');
  props.ownerId = 'owner-b'; await settle();
  assert.equal(setup.summaryDraft, '');
  assert.equal(setup.outcome.interest_score, null);
  assert.equal(setup.ratingDraft, '');
});

test('AF-02 structured consent requires its explicit action and can be revoked independently', async t => {
  const { props, setup, calls } = fixture(t);
  setup.summaryDraft = 'Unapproved summary'; await setup.flush();
  assert.equal(props.structuredSharingEnabled, false);
  assert.equal(await setup.toggleStructuredSharing(), true); await settle();
  assert.equal(props.structuredSharingEnabled, true);
  assert.equal(await setup.toggleStructuredSharing(), true); await settle();
  assert.equal(props.structuredSharingEnabled, false);
  assert.deepEqual(calls.filter(call => call.name === 'sharing').map(call => call.value), [true, false]);
  assert.equal(calls.some(call => call.name === 'approve'), false);
});

test('AF-02 summary uses the shared textarea contract and labels disclosure as an independent action', () => {
  assert.match(source, /<AutosaveTextarea[^>]*v-model="summaryDraft"[^>]*maxlength="600"[^>]*@commit="flushSummary"/);
  assert.match(source, /Approve for search feedback/);
  assert.match(source, /<InfoHint/);
  assert.doesNotMatch(source, /<textarea\b|@input=.*(?:save|approve)|setTimeout\(/);
});
