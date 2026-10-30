import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, watch, type Component } from 'vue';
import type { OpportunityInterestReason, OpportunityReview } from '../src/cloudTypes';
import { normalizeOpportunity } from '../src/composables/useJobWorkspace';
import { mergeOpportunityEvaluation } from '../src/composables/opportunityEvaluation';
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
  ratingDraft: string; summaryDraft: string; summaryIncluded: boolean; summaryEligible: boolean; summaryExcerpt: string; summaryError: string;
  summaryLength: number; flushSummary(): Promise<boolean>;
  actionError: string; reasonCategories: OpportunityInterestReason['category'][]; reasonPolarity: OpportunityInterestReason['polarity']; reasonTarget: string;
  ratingSliderValue: number; ratingValueText: string; ratingPending: boolean; draftRating(event: Event): void;
  outcome: { interest_score: number | null; interest_origin: string }; reasons: OpportunityInterestReason[];
  saveRating(): Promise<boolean>; clearRating(): Promise<boolean>; addReason(): Promise<void>; removeReason(index: number): Promise<boolean>;
  flush(): Promise<boolean>; savePatch(patch: Patch): Promise<boolean>; toggleStructuredSharing(): Promise<boolean>; retry(): Promise<boolean> | undefined;
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
    evaluationText: mergeOpportunityEvaluation(review.comment, review.search_feedback_summary), evaluationStatus: 'saved', evaluationError: '',
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
    flushPrivateComment: async () => {
      calls.push({ name: 'flush-comment' });
      const owner = props.ownerId, id = props.opportunity.id, value = props.evaluationText;
      if (handlers.privateComment && !await handlers.privateComment()) {
        props.evaluationStatus = 'error'; props.evaluationError = 'Parent evaluation was not saved. Draft retained.'; return false;
      }
      if (props.ownerId !== owner || props.opportunity.id !== id) return false;
      if (value !== mergeOpportunityEvaluation(props.review.comment, props.review.search_feedback_summary)) {
        calls.push({ name: 'evaluation', id, value });
        const summary = Array.from(value).slice(0, 600).join('');
        props.review = { ...props.review, comment: value, search_feedback_summary: summary,
          search_feedback_revision: (props.review.search_feedback_revision ?? 0) + 1,
          search_feedback_summary_hash: `summary:${summary}`, search_feedback_source_hash: `source:${value}`, search_feedback_approved_at: null };
      }
      props.evaluationStatus = props.evaluationText === value ? 'saved' : 'unsaved'; props.evaluationError = '';
      return true;
    },
  });
  const stop = watch(() => [props.ownerId, props.opportunity.id, props.review.user_id, props.review.opportunity_id, props.review.comment, props.review.search_feedback_summary] as const,
    (next, prior) => {
      const priorText = prior && prior[0] === prior[2] && prior[1] === prior[3] ? mergeOpportunityEvaluation(prior[4], prior[5]) : '';
      if (next[0] !== prior?.[0] || next[1] !== prior?.[1] || props.evaluationText === priorText) {
        props.evaluationText = next[0] === next[2] && next[1] === next[3] ? mergeOpportunityEvaluation(next[4], next[5]) : '';
        props.evaluationStatus = 'saved'; props.evaluationError = '';
      }
    }, { flush: 'sync' });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props,
    'onUpdate:evaluationText': (value: string) => { props.evaluationText = value; props.evaluationStatus = 'unsaved'; },
    ref: (value: unknown) => { mounted = value; } }) });
  app.mount({});
  t.after(() => { stop(); app.unmount(); previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'); });
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, calls, handlers, values };
}

test('opening unified evaluation preserves existing text without saving or approving search feedback', async t => {
  const { props, setup, calls } = fixture(t);
  assert.equal(setup.summaryDraft, props.review.comment);
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
  setup.reasonCategories = ['method']; setup.reasonPolarity = 'negative'; setup.reasonTarget = '  Simulation only  ';
  await setup.addReason(); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'method', polarity: 'negative', target: 'Simulation only' }]);
  setup.reasonCategories = ['funding']; setup.reasonPolarity = 'negative'; setup.reasonTarget = 'Unused target';
  await setup.addReason(); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'funding', polarity: 'negative' }, { category: 'method', polarity: 'negative', target: 'Simulation only' }]);
  await setup.removeReason(1); await settle();
  assert.deepEqual(setup.reasons, [{ category: 'funding', polarity: 'negative' }]);
  assert.doesNotMatch(JSON.stringify(calls), /Private Synthetic|private@example|Ignore prior rules/);
});

test('unified evaluation typing belongs to the parent draft; only its explicit commit persists without approval', async t => {
  const { props, setup, calls, values } = fixture(t);
  setup.summaryDraft = 'Prefer experimental signal processing.';
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(props.evaluationStatus, 'unsaved');
  assert.equal(props.evaluationText, 'Prefer experimental signal processing.');
  assert.equal(values.size, 0, 'the child must not create a competing summary recovery store');
  assert.equal(await setup.flush(), true); await settle();
  assert.equal(calls.length, 0, 'parent evaluation flush owns persistence; structured flush must not recurse into it');
  assert.equal(await setup.flushSummary(), true); await settle();
  assert.deepEqual(calls.map(call => call.name), ['flush-comment', 'evaluation']);
  assert.equal(props.review.comment, props.evaluationText);
  assert.equal(props.review.search_feedback_summary, props.evaluationText);
  assert.equal(setup.summaryIncluded, false);
  assert.equal(props.evaluationStatus, 'saved');
  assert.equal(values.size, 0);
});

test('native textarea commits save the included-by-default draft without any approval RPC', async t => {
  const { props, setup, calls } = fixture(t);
  props.structuredSharingEnabled = true;
  const unregister = registerTextareaCommit(() => { setup.summaryDraft = 'Prefer physical sensing prototypes.'; });
  t.after(unregister);
  assert.equal(await setup.flush(), true); await settle();
  assert.equal(props.evaluationText, 'Prefer physical sensing prototypes.');
  assert.equal(calls.length, 0, 'committing the native draft does not send an approval request');
  assert.equal(await setup.flushSummary(), true); await settle();
  assert.deepEqual(calls.map(call => call.name), ['flush-comment', 'evaluation']);
  assert.equal(setup.summaryIncluded, true);
  assert.equal(props.review.search_feedback_approved_at, null);
});

test('failed evaluation saves retain the included draft and retry only its persistence', async t => {
  const { props, setup, calls, handlers } = fixture(t);
  handlers.privateComment = async () => false;
  setup.summaryDraft = 'Keep the hardware research direction.';
  await settle();
  assert.equal(await setup.flushSummary(), false); await settle();
  assert.match(setup.summaryError, /not saved/);
  assert.equal(setup.summaryDraft, 'Keep the hardware research direction.');
  assert.equal(props.evaluationText, 'Keep the hardware research direction.');
  delete handlers.privateComment;
  assert.equal(await setup.flushSummary(), true); await settle();
  assert.equal(calls.some(call => ['approve','revoke'].includes(call.name)), false);
});

test('one exclusion checkbox controls evaluation text and structured feedback without changing interest', async t => {
  const { props, setup, calls } = fixture(t);
  props.structuredSharingEnabled = true;
  setup.summaryDraft = 'Prefer acoustic prototypes.'; await settle(); await setup.flushSummary(); await settle();
  assert.equal(setup.summaryIncluded, true);
  const value = props.evaluationText, rating = props.review.interest_rating;
  assert.equal(await setup.savePatch({ feedback_excluded: true }), true); await settle();
  assert.equal(setup.summaryIncluded, false); assert.equal(setup.summaryEligible, false);
  assert.equal(props.evaluationText, value); assert.equal(props.review.interest_rating, rating);
  assert.equal(setup.outcome.interest_origin, 'excluded');
  assert.equal(await setup.savePatch({ feedback_excluded: false }), true); await settle();
  assert.equal(setup.summaryIncluded, true);
  assert.equal(calls.some(call => ['approve','revoke'].includes(call.name)), false);
});

test('different saved evaluation and feedback text remain together and included without an approval action', async t => {
  const { props, setup, calls } = fixture(t);
  props.review = { ...props.review, comment: 'Existing evaluation with its original wording.', search_feedback_summary: 'Earlier feedback direction.' };
  props.structuredSharingEnabled = true; await settle();
  assert.equal(setup.summaryDraft, 'Existing evaluation with its original wording.\n\nEarlier feedback direction.');
  assert.equal(setup.summaryIncluded, true); assert.equal(calls.length, 0);
  assert.equal(await setup.flush(), true); assert.equal(calls.length, 0);
  assert.equal(props.review.search_feedback_approved_at, null);
});

test('long evaluations preserve the complete text while showing a first-600-character excerpt', async t => {
  const { props, setup, calls } = fixture(t), evaluation = '🔬'.repeat(620);
  props.structuredSharingEnabled = true;
  setup.summaryDraft = evaluation; await settle();
  assert.equal(setup.summaryLength, 620); assert.equal(setup.summaryEligible, true);
  assert.equal(setup.summaryExcerpt, '🔬'.repeat(600));
  assert.equal(await setup.flushSummary(), true); await settle();
  assert.equal(props.review.comment, evaluation); assert.equal(props.evaluationText, evaluation);
  assert.equal(props.review.search_feedback_summary, '🔬'.repeat(600));
  assert.equal(setup.summaryDraft, evaluation); assert.equal(setup.summaryIncluded, true);
  assert.equal(calls.some(call => ['approve','revoke'].includes(call.name)), false);
  setup.summaryDraft = `${evaluation} person@example.invalid`; await settle();
  assert.equal(setup.summaryEligible, false, 'unsafe content after the excerpt boundary must withhold the whole text');
});

test('newer typing and owner changes during persistence never create an approval action', async t => {
  const { props, setup, calls, handlers } = fixture(t), saving = deferred<boolean>();
  setup.summaryDraft = 'Prefer acoustic prototypes.'; await settle();
  handlers.privateComment = () => saving.promise;
  const pending = setup.flushSummary(); await settle();
  setup.summaryDraft = 'Newer interest in BCI experiments.'; await settle();
  saving.resolve(true); await pending; await settle();
  assert.equal(props.evaluationText, 'Newer interest in BCI experiments.');
  assert.equal(props.evaluationStatus, 'unsaved');
  props.ownerId = 'owner-b'; props.review = { ...props.review, user_id: 'owner-b', comment: 'Owner B saved evaluation', search_feedback_summary: '' }; await settle();
  assert.equal(setup.summaryDraft, 'Owner B saved evaluation');
  assert.equal(calls.some(call => ['approve','revoke'].includes(call.name)), false);
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

test('interest slider has a local draft, preserves fractional saved values and commits once before navigation', async t => {
  const { props, setup, calls } = fixture(t);
  assert.equal(await setup.flush(), true);
  assert.equal(calls.length, 0, 'opening or flushing an untouched slider must not create an override');
  props.review = { ...props.review, interest_rating: 7.25 }; await settle();
  assert.equal(setup.ratingDraft, '7.25'); assert.equal(setup.ratingSliderValue, 7.25);
  assert.equal(await setup.saveRating(), true); assert.equal(calls.length, 0);
  setup.draftRating({ target: { value: '7.3' } } as unknown as Event); await settle();
  assert.equal(calls.length, 0); assert.equal(setup.ratingPending, true);
  assert.match(setup.ratingValueText, /7.3\/10.*Unsaved rating/);
  props.review = { ...props.review, interest_rating: 8 }; await settle();
  assert.equal(setup.ratingDraft, '7.3', 'a remote rating update cannot erase an uncommitted local selection');
  assert.equal(await setup.flush(), true); await settle();
  assert.deepEqual(calls.map(call => call.value), [{ interest_rating: 7.3 }]);
  assert.equal(setup.ratingPending, false);
  assert.equal(await setup.saveRating(), true); assert.equal(calls.length, 1, 'duplicate change/flush is a no-op');
});

test('interest slider coalesces pending commits and failed values block navigation without approving text', async t => {
  const { props, setup, calls, handlers } = fixture(t), pending = deferred<Review | null>();
  setup.ratingDraft = '6.4'; handlers.patch = () => pending.promise;
  const changing = setup.saveRating(); const leaving = setup.flush(); await settle();
  assert.equal(calls.length, 1);
  pending.resolve(null); assert.equal(await changing, false); assert.equal(await leaving, false);
  assert.equal(setup.ratingDraft, '6.4'); assert.equal(setup.ratingPending, true);
  assert.equal(calls.some(call => call.name === 'approve'), false);
  delete handlers.patch;
  assert.equal(await setup.retry(), true); await settle();
  assert.equal(setup.ratingPending, false); assert.equal(props.review.interest_rating, 6.4);
});

test('rating commits cannot carry a stale value or failure into another owner or opportunity', async t => {
  const { props, setup, calls, handlers } = fixture(t), pending = deferred<Review | null>();
  setup.ratingDraft = '4.2'; handlers.patch = () => pending.promise;
  const changing = setup.saveRating(); await settle();
  props.ownerId = 'owner-b'; props.opportunity = normalizeOpportunity({ id: 'opportunity-b', title: 'Other synthetic role' });
  props.review = { ...props.review, user_id: 'owner-b', opportunity_id: 'opportunity-b', interest_rating: 9.1 }; await settle();
  assert.equal(setup.ratingDraft, '9.1');
  pending.resolve(null); assert.equal(await changing, false); await settle();
  assert.equal(setup.ratingDraft, '9.1'); assert.equal(setup.actionError, '');
  assert.deepEqual(calls.map(call => call.id), ['opportunity-a']);
});

test('reason category multi-selection saves one normalized patch with targets only on topic and method', async t => {
  const { props, setup, calls } = fixture(t);
  props.review = { ...props.review, interest_reasons: [{ category: 'timing', polarity: 'positive' }] }; await settle();
  setup.reasonCategories = ['method', 'funding', 'topic', 'method']; setup.reasonPolarity = 'negative'; setup.reasonTarget = '  Physical prototypes  ';
  assert.equal(calls.length, 0, 'selecting categories remains local until Add');
  await setup.addReason(); await settle();
  assert.deepEqual(setup.reasons, [
    { category: 'funding', polarity: 'negative' }, { category: 'method', polarity: 'negative', target: 'Physical prototypes' },
    { category: 'timing', polarity: 'positive' }, { category: 'topic', polarity: 'negative', target: 'Physical prototypes' },
  ]);
  assert.equal(calls.length, 1); assert.equal(setup.reasonTarget, '');
  setup.reasonTarget = 'Physical prototypes'; await setup.addReason(); await settle();
  assert.equal(calls.length, 1, 'duplicate selections must not submit a duplicate patch');
});

test('reason category multi-selection preserves all saved reasons and pending selections at the limit', async t => {
  const { props, setup, calls } = fixture(t);
  // JSONB can return keys in a different order from newly constructed UI reasons.
  const existing: OpportunityInterestReason[] = Array.from({ length: 16 }, (_, index) => ({ target: `Direction ${index}`, polarity: 'positive', category: 'topic' }));
  props.review = { ...props.review, interest_reasons: existing }; await settle();
  setup.reasonCategories = ['topic']; setup.reasonTarget = 'Direction 0'; await setup.addReason();
  assert.equal(calls.length, 0, 'deduplication precedes the maximum-count check');
  setup.reasonCategories = ['funding', 'hardware']; setup.reasonPolarity = 'negative'; setup.reasonTarget = 'Retain this draft';
  await setup.addReason(); assert.match(setup.actionError, /16 reasons/);
  assert.deepEqual(setup.reasons, existing); assert.deepEqual(setup.reasonCategories, ['funding', 'hardware']);
  assert.equal(setup.reasonTarget, 'Retain this draft'); assert.equal(calls.length, 0);
});

test('AF-02 a stale other-owner review is withheld while the next account loads', async t => {
  const { props, setup } = fixture(t);
  props.review = { ...props.review, interest_rating: 8, search_feedback_summary: 'Owner A private summary' };
  await settle();
  assert.equal(setup.summaryDraft, `${props.review.comment}\n\nOwner A private summary`);
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

test('default feedback uses the shared textarea contract and only one opportunity-level exclusion', () => {
  assert.match(source, /<AutosaveTextarea[^>]*v-model="summaryDraft"[^>]*@commit="flushSummary"/);
  assert.doesNotMatch(source, /Approve for search feedback|Revoke sharing/);
  assert.match(source, /Exclude this opportunity from search feedback/);
  assert.match(source, /Search feedback excerpt — first 600 characters/);
  assert.doesNotMatch(source, /props\.(?:approveSummary|revokeSummary)\(/);
  assert.match(source, /<InfoHint/);
  assert.match(source, /type="range" min="0" max="10" step="0.1"/);
  assert.match(source, /v-model="reasonCategories" type="checkbox"/);
  assert.doesNotMatch(source, /<textarea\b|@input="[^"]*(?:save|approve)|setTimeout\(/);
  assert.doesNotMatch(source, /useApplicationNotesAutosave|CV_SEARCH_FEEDBACK_SUMMARY_DRAFT/);
});
