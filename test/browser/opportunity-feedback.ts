/** Synthetic, memory-only AF-02 browser fixture. No Auth, database or external network calls. */
import { computed, createApp, defineComponent, h, ref } from 'vue';
import AutosaveTextarea from '../../src/components/AutosaveTextarea.vue';
import OpportunityFeedbackControls from '../../src/components/OpportunityFeedbackControls.vue';
import type { OpportunityFeedbackPatch, OpportunityReview } from '../../src/cloudTypes';
import { normalizeOpportunity } from '../../src/composables/useJobWorkspace';
import { normalizeOpportunityInterestReasons, parseOpportunityInterestRating } from '../../src/composables/opportunityFeedback';
import { opportunityFeedbackTextHash, opportunityFeedbackTextIsSafe } from '../../src/composables/opportunityFeedbackPrivacy';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Synthetic feedback is available only on the development server.');

const owner = '90000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000001';
const now = '2026-10-29T12:00:00Z';
const privateExplanation = 'Synthetic Person prefers experimental sensing. Private contact: person@example.invalid; +49 123 456789.';
const initialHashes = await Promise.all([opportunityFeedbackTextHash(''), opportunityFeedbackTextHash(privateExplanation)]);

createApp(defineComponent({
  setup() {
    const review = ref<OpportunityReview>({ user_id: owner, opportunity_id: id, state: 'interested', comment: privateExplanation,
      interest_rating: null, interest_reasons: [], feedback_excluded: false, feedback_revision: 1, feedback_updated_at: now,
      reviewed_updated_at: null, created_at: now, updated_at: now, search_feedback_summary: '', search_feedback_revision: 0,
      search_feedback_summary_hash: initialHashes[0], search_feedback_source_hash: initialHashes[1], search_feedback_approved_at: null });
    const privateDraft = ref(privateExplanation);
    const sharing = ref(false);
    const saves = ref(0), approvals = ref(0), revocations = ref(0), consentChanges = ref(0), structuredChanges = ref(0);
    const opportunity = normalizeOpportunity({ id, opportunity_key: 'synthetic-sensing-phd', title: 'PhD in physical sensing', institution: 'Synthetic Research Institute', topics: ['Physical sensing', 'Signal processing'] });
    const approveState = computed(() => Boolean(review.value.search_feedback_approved_at));
    const saveFeedback = async (_id: string, patch: OpportunityFeedbackPatch) => {
      const next: OpportunityFeedbackPatch = { ...patch };
      if ('interest_rating' in next) next.interest_rating = parseOpportunityInterestRating(next.interest_rating);
      if ('interest_reasons' in next) next.interest_reasons = normalizeOpportunityInterestReasons(next.interest_reasons);
      structuredChanges.value++;
      review.value = { ...review.value, ...next, feedback_revision: (review.value.feedback_revision ?? 0) + 1 };
      return review.value;
    };
    const saveSummary = async (_id: string, value: string) => {
      if (value.length > 600) return null;
      saves.value++;
      review.value = { ...review.value, search_feedback_summary: value, search_feedback_summary_hash: await opportunityFeedbackTextHash(value),
        search_feedback_revision: (review.value.search_feedback_revision ?? 0) + 1, search_feedback_approved_at: null };
      return review.value;
    };
    const flushPrivateComment = async () => {
      const snapshot = privateDraft.value;
      if (review.value.comment !== snapshot) review.value = { ...review.value, comment: snapshot,
        search_feedback_source_hash: await opportunityFeedbackTextHash(snapshot), search_feedback_approved_at: null,
        search_feedback_revision: (review.value.search_feedback_revision ?? 0) + 1 };
      return snapshot === privateDraft.value;
    };
    const approveSummary = async (_id: string, summaryHash: string, sourceHash: string, revision: number) => {
      if (summaryHash !== review.value.search_feedback_summary_hash || sourceHash !== review.value.search_feedback_source_hash
        || revision !== review.value.search_feedback_revision || !opportunityFeedbackTextIsSafe(review.value.search_feedback_summary)) return null;
      approvals.value++;
      review.value = { ...review.value, search_feedback_approved_at: now,
        search_feedback_approved_summary_hash: summaryHash, search_feedback_approved_source_hash: sourceHash };
      return review.value;
    };
    const revokeSummary = async () => { revocations.value++; review.value = { ...review.value, search_feedback_approved_at: null }; return review.value; };
    const setStructuredSharing = async (enabled: boolean) => { consentChanges.value++; sharing.value = enabled; return true; };
    return () => h('main', { class: 'feedback-fixture jobs-workspace builder-shell' }, [
      h('h1', 'Synthetic opportunity feedback'),
      h('p', 'PhD in physical sensing · Synthetic Research Institute. Development fixture; all values stay in memory.'),
      h('section', { class: 'fixture-evaluation' }, [
        h('label', { for: 'fixture-private-evaluation' }, 'Personal evaluation — private'),
        h(AutosaveTextarea, { id: 'fixture-private-evaluation', modelValue: privateDraft.value,
          'onUpdate:modelValue': (value: string) => { privateDraft.value = value; }, onCommit: flushPrivateComment, rows: 2 }),
      ]),
      h(OpportunityFeedbackControls, { ownerId: owner, opportunity, review: review.value, application: null,
        structuredSharingEnabled: sharing.value, searchAvailable: true, busy: false, lang: 'en',
        saveFeedback, saveSummary, approveSummary, revokeSummary, setStructuredSharing, flushPrivateComment }),
      h('output', { class: 'fixture-events', 'data-testid': 'fixture-events' },
        `Summary saves: ${saves.value}; approvals: ${approvals.value}; revocations: ${revocations.value}; structured changes: ${structuredChanges.value}; consent changes: ${consentChanges.value}; approved: ${approveState.value}; sharing: ${sharing.value}`),
    ]);
  },
})).mount('#app');
