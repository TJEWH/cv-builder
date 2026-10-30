import { opportunityFixture } from '../fixtures/opportunity';
/** Synthetic, memory-only AF-02 browser fixture. No Auth, database or external network calls. */
import { computed, createApp, defineComponent, h, ref } from 'vue';
import OpportunityFeedbackControls from '../../src/components/OpportunityFeedbackControls.vue';
import OpportunityDispositionControls from '../../src/components/OpportunityDispositionControls.vue';
import type { OpportunityDispositionPatch, OpportunityFeedbackPatch, OpportunityReview } from '../../src/cloudTypes';
import { normalizeOpportunity } from '../../src/composables/useJobWorkspace';
import { normalizeOpportunityInterestReasons, parseOpportunityInterestRating } from '../../src/composables/opportunityFeedback';
import { opportunityFeedbackTextHash, opportunityFeedbackTextIsSafe } from '../../src/composables/opportunityFeedbackPrivacy';
import { mergeOpportunityEvaluation } from '../../src/composables/opportunityEvaluation';
import { useApplicationNotesAutosave } from '../../src/composables/useApplicationNotesAutosave';
import { normalizeOpportunityDispositionPatch } from '../../src/composables/opportunityDisposition';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Synthetic feedback is available only on the development server.');

const owner = '90000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000001';
const now = '2026-10-29T12:00:00Z';
const oversizedLegacy = new URLSearchParams(location.search).has('oversizedLegacy');
const privateExplanation = oversizedLegacy ? 'E'.repeat(5000) : 'Prefer hands-on acoustic prototypes.';
const previousSummary = oversizedLegacy ? 'F'.repeat(600) : 'Consider adjacent research involving robotics.';
const initialHashes = await Promise.all([opportunityFeedbackTextHash(previousSummary), opportunityFeedbackTextHash(privateExplanation)]);

createApp(defineComponent({
  setup() {
    const review = ref<OpportunityReview>({ user_id: owner, opportunity_id: id, state: 'interested', comment: privateExplanation,
      interest_rating: null, interest_reasons: [], feedback_excluded: false, feedback_revision: 1, feedback_updated_at: now,
      manually_archived: false, technical_issue_category: null, technical_issue_note: null,
      reviewed_updated_at: null, created_at: now, updated_at: now, search_feedback_summary: previousSummary, search_feedback_revision: 0,
      search_feedback_summary_hash: initialHashes[0], search_feedback_source_hash: initialHashes[1], search_feedback_approved_at: null });
    const sharing = ref(false);
    const language = ref('en');
    const saves = ref(0), evaluationSaves = ref(0), approvals = ref(0), revocations = ref(0), consentChanges = ref(0), structuredChanges = ref(0), dispositionChanges = ref(0);
    let failEvaluationSave = false;
    const opportunity = normalizeOpportunity(opportunityFixture({ id, opportunity_key: 'synthetic-sensing-phd', title: 'PhD in physical sensing', institution: 'Synthetic Research Institute', topics: ['Physical sensing', 'Signal processing'] }));
    const approveState = computed(() => Boolean(review.value.search_feedback_approved_at));
    const saveFeedback = async (_id: string, patch: OpportunityFeedbackPatch) => {
      const next: OpportunityFeedbackPatch = { ...patch };
      if ('interest_rating' in next) next.interest_rating = parseOpportunityInterestRating(next.interest_rating);
      if ('interest_reasons' in next) next.interest_reasons = normalizeOpportunityInterestReasons(next.interest_reasons);
      structuredChanges.value++;
      review.value = { ...review.value, ...next, feedback_revision: (review.value.feedback_revision ?? 0) + 1 };
      return review.value;
    };
    const saveDisposition = async (_id: string, patch: OpportunityDispositionPatch) => {
      dispositionChanges.value++;
      review.value = { ...review.value, ...normalizeOpportunityDispositionPatch(patch), feedback_revision: (review.value.feedback_revision ?? 0) + 1 };
      return review.value;
    };
    const saveSummary = async (_id: string, value: string) => {
      if (Array.from(value).length > 600) return null;
      saves.value++;
      review.value = { ...review.value, search_feedback_summary: value, search_feedback_summary_hash: await opportunityFeedbackTextHash(value),
        search_feedback_revision: (review.value.search_feedback_revision ?? 0) + 1, search_feedback_approved_at: null };
      return review.value;
    };
    const { notes: evaluationText, status: evaluationStatus, error: evaluationError, flush: flushPrivateComment } = useApplicationNotesAutosave({
      application: () => ({ id, notes: mergeOpportunityEvaluation(review.value.comment, review.value.search_feedback_summary) }),
      owner: () => owner, storage: null, maxLength: 5602,
      save: async (_id, snapshot) => {
        if (failEvaluationSave) { failEvaluationSave = false; return false; }
        if (Array.from(snapshot).length > 5000) return false;
        evaluationSaves.value++;
        if (review.value.comment !== snapshot) review.value = { ...review.value, comment: snapshot,
          search_feedback_source_hash: await opportunityFeedbackTextHash(snapshot), search_feedback_approved_at: null,
          search_feedback_revision: (review.value.search_feedback_revision ?? 0) + 1 };
        const summary = Array.from(snapshot).slice(0, 600).join('');
        if ((review.value.search_feedback_summary ?? '') !== summary) return Boolean(await saveSummary(id, summary));
        return true;
      },
      errorMessage: () => 'Evaluation was not saved. Your draft is kept.',
    });
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
    Object.assign(window, { opportunityFeedbackFixture: {
      snapshot: () => ({ review: JSON.parse(JSON.stringify(review.value)), evaluationText: evaluationText.value,
        evaluationStatus: evaluationStatus.value,
        saves: saves.value, evaluationSaves: evaluationSaves.value, approvals: approvals.value, revocations: revocations.value,
        structuredChanges: structuredChanges.value, dispositionChanges: dispositionChanges.value, sharing: sharing.value }),
      failNextEvaluationSave: () => { failEvaluationSave = true; },
    } });
    return () => h('main', { class: 'feedback-fixture jobs-workspace builder-shell' }, [
      h('h1', 'Synthetic opportunity feedback'),
      h('p', 'PhD in physical sensing · Synthetic Research Institute. Development fixture; all values stay in memory.'),
      h('button', { type: 'button', class: 'btn fixture-language', onClick: () => { language.value = language.value === 'en' ? 'de' : 'en'; } }, 'English / Deutsch'),
      h('details', { class: 'fixture-evaluation personal-evaluation disclosure-row', open: true }, [
        h('summary', language.value === 'de' ? 'Persönliche Einschätzung' : 'Personal Evaluation'),
        h(OpportunityFeedbackControls, { ownerId: owner, opportunity, review: review.value, application: null,
          evaluationText: evaluationText.value, 'onUpdate:evaluationText': (value: string) => { evaluationText.value = value; }, evaluationStatus: evaluationStatus.value, evaluationError: evaluationError.value,
          structuredSharingEnabled: sharing.value, searchAvailable: true, busy: false, lang: language.value,
          saveFeedback, saveSummary, approveSummary, revokeSummary, setStructuredSharing, flushPrivateComment }),
        h(OpportunityDispositionControls, { ownerId: owner, opportunityId: id, review: review.value,
          saveDisposition, busy: false, lang: language.value }),
      ]),
      h('output', { class: 'fixture-events', 'data-testid': 'fixture-events' },
        `Evaluation saves: ${evaluationSaves.value}; Summary saves: ${saves.value}; approvals: ${approvals.value}; revocations: ${revocations.value}; structured changes: ${structuredChanges.value}; disposition changes: ${dispositionChanges.value}; consent changes: ${consentChanges.value}; approved: ${approveState.value}; sharing: ${sharing.value}`),
    ]);
  },
})).mount('#app');
