<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCheck, faRotate, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, ApplicationStage } from '../cloudTypes';
import { supabaseConfiguration } from '../lib/supabase';
import type { CvState, SavedConfiguration } from '../types';
import type { ApplicationLetter, LetterFormatting, LetterTemplate } from '../letterTypes';
import type { ApprovedPrivacyContexts, AnnotationStatus, AnnotationReference, LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementScope, RefinementState } from '../refinementTypes';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv, type ApplicationCvRecord } from '../composables/applicationCv';
import { addIncomingDraft, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizeLetter, formatLetter, letterContextVersion, letterFromEditableText, openLetterRevision, saveWorkingRevision, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import { applyRefinementProposal, buildRefinementPrompt, createRefinementRepository, describeCvOperation, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText, validateLocalRefinementSource } from '../composables/applicationRefinement';
import { applicationStage, applicationStatusLabel, applicationTrackingStarted } from '../composables/applicationTracking';
import { formatOpportunityDeadline } from '../composables/opportunityDeadline';
import FormBuilder from './FormBuilder.vue';
import DocumentCvPreview from './DocumentCvPreview.vue';
import MotivationLetterPreview from './MotivationLetterPreview.vue';
import LetterFormattingControls from './LetterFormattingControls.vue';
import { resolveLetterFormatting } from '../composables/letterFormatting';
import { applyLetterHeader, captureLetterHeaderSource, resolveApplicationLetterState } from '../composables/letterContact';
import RefinementHistory from './RefinementHistory.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import ApplicationDeadlineCalendar from './ApplicationDeadlineCalendar.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import OpportunityContext from './OpportunityContext.vue';
import { buildShortRefinementInstruction } from '../composables/applicationReference';
import { resolveRefinementSettings, serializeRefinementDraft, sameRefinementInputs } from '../composables/refinementSources';
import RefinementAnnotations from './RefinementAnnotations.vue';
import RefinementPreviewStatus from './RefinementPreviewStatus.vue';
import RefinementComparisonToggle from './RefinementComparisonToggle.vue';
import { annotationViews, annotationReferenceChanged, annotationFeedback, validateAnnotationReview } from '../composables/refinementAnnotations';
import { useToastWatch } from '../composables/useToasts';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { refinementMatchesScope, visibleRefinementProposals } from '../composables/refinementHistory';
import { useDesktopSidebar } from '../composables/desktopSidebar';

const props = withDefaults(defineProps<{
  projectId?: string; active?: boolean; checklistSaving?: boolean;
  application: Application; client: SupabaseClient | null; userId: string; lang: string;
  configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null;
  publishCv: (state: CvState) => Promise<Application | null>;
  createVariant?: (name: string, state: CvState) => string | null;
}>(), { active: true });
const emit = defineEmits<{ close: []; 'edit-variant': [id: string]; toggleChecklist: [key: string, completed: boolean]; 'change-stage': [stage: ApplicationStage] }>();
const desktopSidebar = useDesktopSidebar();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const storageKey = 'CV_REFINEMENT:1:' + encodeURIComponent(props.userId) + ':' + props.application.id;
const navigationKey = 'CV_APPLICATION_TAB:' + props.userId + ':' + props.application.id;
const stages = ['preparation', 'refinement', 'review', 'tracking'] as const;
type Stage = typeof stages[number];
const tab = ref<Stage>(applicationStage(props.application));
const record = ref<ApplicationCvRecord | null>(null);
const letter = ref<ApplicationLetter | null>(null);
const templates = ref<LetterTemplate[]>([]);
const approvals = ref<RefinementApprovals>({ cv: null, letter: null });
const variantName = ref('');
const savedVariant = ref<{ id: string; name: string; revision: string; previousIds?: string[] } | null>(null);
const privacyContexts = ref<ApprovedPrivacyContexts>({});
const localRequests = ref<Record<string, LocalRefinementRequest>>({});
type DocumentScope = 'cv' | 'letter';
type IterationNotes = { tone: string; structure: string; content: string };
const emptyIterationNotes = (): IterationNotes => ({ tone: '', structure: '', content: '' });
const iterationNotes = ref<Record<DocumentScope, IterationNotes>>({ cv: emptyIterationNotes(), letter: emptyIterationNotes() });
const iterationFeedbackSubmission = ref<Record<DocumentScope, { id: string; text: string; requestId: string | null } | null>>({ cv: null, letter: null });
const pendingResetFeedback = ref<Record<DocumentScope, { id: string; text: string; requestId: string } | null>>({ cv: null, letter: null });
const parentProposalIds = ref<Record<DocumentScope, string | null>>({ cv: null, letter: null });
const resetRequestIds = ref<string[]>([]);
const resetRequestIdsByScope = ref<Record<DocumentScope, string[]>>({ cv: [], letter: [] });
const cloudState = ref<RefinementState | null>(null);
const requests = ref<RefinementRequestRow[]>([]);
const proposals = ref<RefinementProposalRow[]>([]);
const reviews = ref<RefinementReviewRow[]>([]);
const selectedProposalId = ref('');
// Review selections are transient: neither previewing nor toggling writes working documents.
const selectedChangeIds = ref<string[]>([]);
const includeProposedLetter = ref(true);
const reviewActive = ref(false);
const reviewComparison = ref<'original' | 'proposed'>('proposed');
const feedbackScope = ref<RefinementScope>('cv');
const pane = computed(() => feedbackScope.value === 'letter' ? 'letter' : 'cv');
const parentProposalId = computed({
  get: () => parentProposalIds.value[pane.value],
  set: (id: string | null) => {
    parentProposalIds.value[pane.value] = id;
    if (feedbackScope.value === 'both') parentProposalIds.value.letter = id;
  },
});
function isRequestReset(id: string, scope: DocumentScope = pane.value) {
  return resetRequestIds.value.includes(id) || resetRequestIdsByScope.value[scope].includes(id);
}
function matchesScope(row: RefinementRequestRow, scope: DocumentScope = pane.value) {
  return refinementMatchesScope(row.request_json.scope, scope, row.cleared_scopes);
}
let scopeWasChosen = false;
const shortInstruction = computed(() => {
  const request = requests.value.find(row => row.id === cloudState.value?.current_request_id)?.request_json;
  const projectId = refinementProjectId(false);
  return buildShortRefinementInstruction(props.application, feedbackScope.value, projectId && request?.scope === feedbackScope.value
    ? { projectId, request } : undefined);
});
const shortInstructionNotice = ref('');
const shortInstructionError = ref('');
watch(shortInstruction, () => { shortInstructionNotice.value = ''; shortInstructionError.value = ''; });
const prompt = ref('');
const busy = ref(false);
const refreshing = ref(false);
const syncing = ref(false);
const error = ref('');
const notice = ref('');
const saveError = ref('');
const cloudLoaded = ref(false);
const historyOpen = ref(false);
const preview = ref<InstanceType<typeof DocumentCvPreview> | null>(null);
const letterPreview = ref<InstanceType<typeof MotivationLetterPreview> | null>(null);
const documentReadiness = ref({ included: 0, missing: 0 });
const repository = createRefinementRepository(props.client, () => props.userId);
const letterRepository = createLetterRepository(localStorage, props.userId);
let disposed = false;
let loadingCloud: Promise<void> | null = null;
let localReadError = '';
let committingSelection = false;

try {
  record.value = loadApplicationCv(props.userId, props.application.id);
  // Library identity is provenance only. Never overwrite an existing application copy.
  if (record.value) { record.value.detached = true; saveApplicationCv(record.value); }
  templates.value = letterRepository.listTemplates();
  letter.value = letterRepository.load(props.application.id);
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    const value = JSON.parse(stored);
    if (value.version !== 1) throw new Error('Unsupported refinement backup version.');
    approvals.value = { cv: typeof value.approvals?.cv === 'string' ? value.approvals.cv : null, letter: typeof value.approvals?.letter === 'string' ? value.approvals.letter : null };
    if (typeof value.savedVariant?.id === 'string' && typeof value.savedVariant.name === 'string' && typeof value.savedVariant.revision === 'string') savedVariant.value = {
      id: value.savedVariant.id, name: value.savedVariant.name, revision: value.savedVariant.revision,
      previousIds: Array.isArray(value.savedVariant.previousIds) ? value.savedVariant.previousIds.filter((id: unknown) => typeof id === 'string') : undefined,
    };
    // Retired imports and v1 requests cannot take part in the connected v2 workflow.
    // Keep each current request's full private reconstruction snapshot intact.
    localRequests.value = Object.fromEntries(Object.entries(value.requests || {})
      .filter((entry): entry is [string, LocalRefinementRequest] => {
        const local = entry[1] as Partial<LocalRefinementRequest> | null;
        return !!local && local.request?.schemaVersion === 2;
      }));
    privacyContexts.value = value.privacyContexts || {};
    for (const scope of ['cv', 'letter'] as const) {
      const parent = value.parentProposalIds ? value.parentProposalIds[scope] : value.parentProposalId;
      parentProposalIds.value[scope] = typeof parent === 'string' ? parent : null;
      resetRequestIdsByScope.value[scope] = Array.isArray(value.resetRequestIdsByScope?.[scope]) ? value.resetRequestIdsByScope[scope].filter((id: unknown) => typeof id === 'string') : [];
      for (const field of ['tone', 'structure', 'content'] as const) {
        const draft = value.iterationNotes?.[scope]?.[field];
        if (typeof draft === 'string') iterationNotes.value[scope][field] = draft;
      }
      const submission = value.iterationFeedbackSubmission?.[scope];
      if (submission && typeof submission.id === 'string' && typeof submission.text === 'string' && (submission.requestId === null || typeof submission.requestId === 'string')) iterationFeedbackSubmission.value[scope] = submission;
      const reset = value.pendingResetFeedback?.[scope];
      if (reset && typeof reset.id === 'string' && typeof reset.text === 'string' && typeof reset.requestId === 'string') pendingResetFeedback.value[scope] = reset;
    }
    resetRequestIds.value = Array.isArray(value.resetRequestIds) ? value.resetRequestIds : [];
    if (['cv', 'letter'].includes(value.scope)) { feedbackScope.value = value.scope; scopeWasChosen = true; }
  }
  // Initialize only untouched applications; missing working copies with saved history need recovery.
  if (!letter.value && !record.value && !stored && !props.application.cv_variant_id) {
    const template = letterRepository.defaultTemplate();
    if (template) {
      const initialContext = letterContextVersion(props.application, null, template, template.language, '', template.maxWords);
      letter.value = letterRepository.save(createApplicationLetter(props.userId, props.application.id, template, initialContext, template.language));
    }
  }
  const previous = sessionStorage.getItem(navigationKey);
  const mapped = ({ overview: 'preparation', cv: 'refinement', letter: 'refinement', documents: 'review' } as Record<string, Stage>)[previous || ''] || previous;
  if (!props.application.workflow_stage && !applicationTrackingStarted(props.application) && stages.includes(mapped as Stage)) tab.value = mapped as Stage;
} catch (cause) {
  localReadError = text('Saved application data could not be read. Recover the local application data before saving: ', 'Gespeicherte Bewerbungsdaten konnten nicht gelesen werden. Vor dem Speichern die lokalen Bewerbungsdaten wiederherstellen: ') + String(cause);
  saveError.value = localReadError;
}
const selectedCvId = computed(() => record.value?.variantId || record.value?.baseId || '');
const selectedTemplate = computed(() => letter.value?.templateSnapshot || templates.value.find(item => item.id === letter.value?.templateId) || DEFAULT_LETTER_TEMPLATES[0]!);
const effectiveLetterFormatting = computed(() => resolveLetterFormatting(letter.value?.formatting, selectedTemplate.value.formatting));
const missingLetterTemplate = computed(() => !!letter.value && !letter.value.templateSnapshot);
const selectedTemplateId = computed(() => {
  const template = templates.value.find(item => item.id === letter.value?.templateId);
  return template && template.revision === letter.value?.templateSnapshot?.revision ? template.id : '';
});
const effectiveSettings = computed(() => resolveRefinementSettings(selectedTemplate.value, letter.value));
const setup = computed(() => effectiveSettings.value.setup);
const letterText = computed(() => serializeRefinementDraft(letter.value?.working).text);
const letterCvState = computed(() => {
  const cv = record.value;
  if (!cv) return null;
  const source = cv.letterHeaderSource?.sourceCvId === selectedCvId.value ? cv.letterHeaderSource : undefined;
  return resolveApplicationLetterState(cv.state, cv.baseState, source);
});
const context = computed(() => letterContextVersion(props.application, letterCvState.value, selectedTemplate.value, setup.value.language, letter.value?.instructions || '', setup.value.maxWords, letter.value?.formatting));
const baselineSignature = computed(() => refinementSignature([record.value?.state, letterText.value, setup.value, letter.value?.instructions || '', props.application.context_json, letter.value?.working]));
const cvRevision = computed(() => refinementSignature([record.value?.state, props.application.context_json]));
const letterRevision = computed(() => refinementSignature([letterText.value, setup.value, letter.value?.instructions || '', letterCvState.value?.design, letterCvState.value?.contact, letterCvState.value?.disabled.includes('header'), props.application.context_json, context.value.theme]));
const cvApproved = computed(() => !!record.value && approvals.value.cv === cvRevision.value && !saveError.value);
function suggestedVariantName() { return record.value ? `${record.value.baseName} · ${String(props.application.context_json.title || text('Approved CV', 'Freigegebener CV'))}` : ''; }
variantName.value = savedVariant.value?.name || suggestedVariantName();
const savedVariantId = computed(() => savedVariant.value?.id || '');
const approvedVariantSaved = computed(() => {
  const receipt = savedVariant.value;
  if (!receipt || receipt.revision !== cvRevision.value || receipt.name !== variantName.value.trim()) return false;
  const variant = props.configurations.find(item => item.id === savedVariantId.value);
  if (!variant || variant.name !== receipt.name) return false;
  // Library saves signal changes to the stored snapshot through their metadata.
  void variant.mtime;
  return refinementSignature(props.readVersion(variant.id)) === refinementSignature(record.value?.state);
});
const unresolved = computed(() => letter.value ? unresolvedLetterPlaceholders(letter.value.working, letterCvState.value?.contact || null) : []);
const letterApproved = computed(() => !!letterText.value.trim() && approvals.value.letter === letterRevision.value && !unresolved.value.length && !saveError.value);
const words = computed(() => letterText.value.trim().split(/\s+/).filter(Boolean).length);
const published = computed(() => !!record.value && isApplicationCvPublished(record.value, props.application.cv_variant_id));
const selectedProposal = computed(() => proposals.value.find(item => item.id === selectedProposalId.value));
const selectedRequest = computed(() => requests.value.find(item => item.id === selectedProposal.value?.request_id));
const selectedLocalRequest = computed(() => selectedProposal.value ? localRequests.value[selectedProposal.value.request_id] : undefined);
const reviewScope = computed(() => selectedLocalRequest.value?.request.scope || selectedRequest.value?.request_json.scope);
const showReviewPreview = computed(() => reviewActive.value && tab.value === 'refinement');
const showCvReview = computed(() => showReviewPreview.value && reviewScope.value !== 'letter');
const showLetterComparison = computed(() => tab.value === 'refinement' && pane.value === 'letter' && hasActiveProposal.value && reviewScope.value !== 'cv');
const showLetterReview = computed(() => (showReviewPreview.value || showLetterComparison.value) && reviewScope.value !== 'cv');
const currentPublishedRequest = computed(() => requests.value.find(item => item.id === cloudState.value?.current_request_id) || null);
const publishedSource = computed(() => currentPublishedRequest.value || requests.value[0] || null);
const sourcePreparation = computed(() => {
  if (!record.value || !letter.value || missingLetterTemplate.value) return { local: null, error: '' };
  try {
    const local = prepareRefinement({ applicationId: props.application.id, state: record.value.state, variantId: record.value.variantId || record.value.baseId, setup: setup.value, letterText: letterText.value, letterContent: letter.value.working, instructions: letter.value.instructions, opportunity: props.application.context_json, scope: feedbackScope.value, feedback: feedbackHistory(), parentProposalId: parentProposalId.value, baselineSignature: baselineSignature.value, privacyContexts: privacyContexts.value });
    local.source = { cv: { name: record.value.baseName, variantId: record.value.variantId || record.value.baseId, baseRevision: record.value.baseRevision, hasApplicationEdits: cvDifferences(record.value.baseState, record.value.state).length > 0 }, letter: { updatedAt: letter.value.updatedAt, version: refinementSignature(letterText.value) }, contextCapturedAt: props.application.context_captured_at };
    return { local, error: '' };
  } catch (cause) { return { local: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const preparedSource = computed(() => sourcePreparation.value.local);
const sourceError = computed(() => sourcePreparation.value.error);
function previewOutgoingText(value: string) {
  try { return record.value ? sanitizeRefinementText(value.trim(), record.value.state) : ''; }
  catch { return text('Privacy preview unavailable. Remove unsupported control characters before sharing.', 'Datenschutzvorschau nicht verfügbar. Nicht unterstützte Steuerzeichen vor dem Teilen entfernen.'); }
}
const publicationStatus = computed<'unpublished' | 'current' | 'outdated' | 'unverifiable'>(() => {
  if (!publishedSource.value) return 'unpublished';
  if (!currentPublishedRequest.value || !matchesScope(currentPublishedRequest.value) || isRequestReset(currentPublishedRequest.value.id)) return 'outdated';
  const local = localRequests.value[currentPublishedRequest.value.id];
  if (!local || !record.value || !letter.value) return 'unverifiable';
  return preparedSource.value && sameRefinementInputs(local, preparedSource.value) ? 'current' : 'outdated';
});
const proposalChanges = computed(() => {
  const proposal = selectedProposal.value?.proposal_json, request = selectedRequest.value?.request_json;
  if (!proposal || !request) return [];
  const decision = [...reviews.value].reverse().find(item => item.kind === 'cv_decisions' && item.payload.proposalId === selectedProposal.value?.id);
  const status = (id: string): 'proposed' | 'accepted' | 'rejected' => (decision?.payload.accepted as string[] | undefined)?.includes(id) ? 'accepted' : (decision?.payload.rejected as string[] | undefined)?.includes(id) ? 'rejected' : 'proposed';
  return proposal.cvOperations.map(operation => ({
    ...describeCvOperation(operation, request.cvStructure), id: operation.id, type: operation.type, explanation: operation.explanation, status: status(operation.id),
  }));
});
const scopedRequests = computed(() => requests.value.filter(row => matchesScope(row)));
const availableProposals = computed(() => visibleRefinementProposals(proposals.value.filter(row => !isRequestReset(row.request_id)), scopedRequests.value[0]?.id || null, selectedProposalId.value)
  .filter(row => scopedRequests.value.some(request => request.id === row.request_id)));
const originalRequest = computed(() => [...scopedRequests.value].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]);
const canResetOriginal = computed(() => !!record.value && !!letter.value && !!originalRequest.value && !!localRequests.value[originalRequest.value.id]?.letterBaseline);
function reviewMatchesScope(row: RefinementReviewRow, scope: DocumentScope = pane.value) {
  if (row.cleared_scopes?.includes(scope)) return false;
  const ownScope = row.kind === 'feedback' ? row.payload.scope : row.kind === 'annotation'
    ? proposals.value.find(proposal => proposal.id === row.payload.proposalId)?.proposal_json.annotations?.find(annotation => annotation.id === row.payload.annotationId)?.document
    : row.kind.includes('letter') ? 'letter' : 'cv';
  return ownScope === scope || ownScope === 'both';
}
const canClearHistory = computed(() => cloudLoaded.value && !!(scopedRequests.value.length || reviews.value.some(row => reviewMatchesScope(row))
  || Object.values(localRequests.value).some(local => !local.publishedAt && refinementMatchesScope(local.request.scope, pane.value))));
const scopeLocked = computed(() => pane.value === 'cv' ? cvApproved.value : letterApproved.value);
const hasActiveProposal = computed(() => !!selectedProposal.value && availableProposals.value.some(row => row.id === selectedProposalId.value));
// The refinement phase survives selection changes and waiting for a later proposal.
const showInitialRefinement = computed(() => !proposals.value.some(row => {
  return !isRequestReset(row.request_id) && scopedRequests.value.some(request => request.id === row.request_id);
}));
const iterationPending = computed(() => currentPublishedRequest.value?.request_json.scope === feedbackScope.value
  && !!currentPublishedRequest.value.request_json.parentProposalId
  && !proposals.value.some(row => row.request_id === currentPublishedRequest.value!.id));
function selectionKey(row: RefinementProposalRow, selected = selectedChangeIds.value, includeLetter = includeProposedLetter.value) {
  return refinementSignature([row.id, row.request_id, row.proposal_json, [...selected].sort(), includeLetter]);
}
const proposalAlreadyApplied = computed(() => {
  const row = selectedProposal.value;
  return !!row && !!localRequests.value[row.request_id]?.acceptances?.some(receipt => receipt.key === selectionKey(row));
});
const proposalSourceOutdated = computed(() => {
  const row = selectedProposal.value, local = selectedLocalRequest.value;
  if (!row || !local || proposalAlreadyApplied.value) return false;
  return local.baselineSignature !== baselineSignature.value || local.cv.sourceVariantId !== (record.value?.variantId || record.value?.baseId) || cloudState.value?.current_request_id !== row.request_id;
});
// The latest accepted letter remains editable while its source stays available
// for comparison. CV-only acceptances and older letter proposals do not replace it.
const selectedWorkingLetter = computed(() => {
  const latest = [...(letter.value?.revisions || [])].reverse().find(revision => revision.kind === 'generated'
    && revision.cloudDraftId && revision.cloudContextId && !isRequestReset(revision.cloudContextId, 'letter')
    && localRequests.value[revision.cloudContextId]?.acceptances?.some(receipt => receipt.proposalId === revision.cloudDraftId));
  return !!latest && latest.cloudDraftId === selectedProposal.value?.id;
});
const comparingWorkingLetter = computed(() => showLetterComparison.value && !reviewActive.value && reviewComparison.value === 'proposed' && selectedWorkingLetter.value);
watch(selectedProposalId, () => {
  selectedChangeIds.value = cvApproved.value ? [] : proposalChanges.value.filter(change => change.status !== 'rejected').map(change => change.id);
  includeProposedLetter.value = !letterApproved.value && selectedRequest.value?.request_json.scope !== 'cv';
  reviewComparison.value = 'proposed';
  reviewActive.value = !!selectedProposal.value && pane.value !== 'letter';
}, { flush: 'sync' });
const temporaryReview = computed(() => {
  if (!reviewActive.value && !showLetterComparison.value) return { result: null, error: '' };
  try {
    const row = selectedProposal.value, local = selectedLocalRequest.value, source = selectedRequest.value;
    if (!row || !local) throw new Error(text('Restore the original local snapshot to preview this proposal.', 'Ursprünglichen lokalen Snapshot wiederherstellen, um diesen Vorschlag anzusehen.'));
    if (!source || source.application_id !== props.application.id || row.application_id !== props.application.id || source.user_id !== props.userId || row.user_id !== props.userId || row.request_id !== source.id || row.proposal_json.requestId !== source.id || refinementSignature(source.request_json) !== refinementSignature(local.request)) throw new Error(text('The proposal and its source request do not match this application.', 'Vorschlag und Quellanfrage passen nicht zu dieser Bewerbung.'));
    return { result: reconstructRefinementProposal(local, row.proposal_json, selectedChangeIds.value, props.application.id), error: '' };
  }
  catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const reviewAcceptanceError = computed(() => {
  if ((!reviewActive.value && !showLetterComparison.value) || proposalAlreadyApplied.value || showLetterComparison.value && selectedWorkingLetter.value) return '';
  try { checkedProposalResult(); return ''; }
  catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
});
const documentPreviewKey = computed(() => JSON.stringify([
  props.application.id, showReviewPreview.value, showLetterComparison.value, reviewComparison.value,
  selectedProposal.value?.id, includeProposedLetter.value,
]));
const previewCvState = computed(() => {
  if (!showCvReview.value) return record.value?.state || null;
  if (!temporaryReview.value.result) return null;
  return reviewComparison.value === 'original' ? selectedLocalRequest.value!.cv.baselineState : temporaryReview.value.result.state;
});
const previewLetterContent = computed(() => {
  if (!showLetterReview.value || comparingWorkingLetter.value) return letter.value?.working;
  if (!temporaryReview.value.result || !selectedLocalRequest.value?.letterBaseline) return undefined;
  const original = reviewComparison.value === 'original' || (!showLetterComparison.value && !includeProposedLetter.value);
  if (original && selectedLocalRequest.value.letterBaseline.content) return selectedLocalRequest.value.letterBaseline.content;
  return letterFromEditableText(original ? selectedLocalRequest.value.letterBaseline.text : temporaryReview.value.result.letterText);
});
// Proposal wording keeps its historical snapshot; sender details follow the
// current application header so removed fields cannot return in comparisons.
const previewLetterCvState = computed(() => {
  if (!showLetterReview.value || comparingWorkingLetter.value) return letterCvState.value;
  const snapshot = reviewComparison.value === 'proposed' ? temporaryReview.value.result?.state : selectedLocalRequest.value?.cv.baselineState;
  if (!snapshot) return null;
  return letterCvState.value ? applyLetterHeader(snapshot, captureLetterHeaderSource(selectedCvId.value, letterCvState.value)) : snapshot;
});
const previewLetterLanguage = computed(() => showLetterReview.value && !comparingWorkingLetter.value ? selectedLocalRequest.value?.letterBaseline?.setup.language || props.lang : letter.value?.language || props.lang);
const proposalPreviewReference = computed(() => selectedProposal.value ? selectedProposal.value.id + ' · ' + new Date(selectedProposal.value.created_at).toLocaleString() : '');
function reviewPreviewLabel(document: 'cv' | 'letter') {
  if (reviewComparison.value === 'original' || document === 'letter' && !showLetterComparison.value && !includeProposedLetter.value) return text('Original source snapshot', 'Ursprünglicher Quellen-Snapshot');
  if (document === 'letter' && comparingWorkingLetter.value) return text('Current working letter', 'Aktuelle Arbeitsfassung des Briefs');
  return proposalAlreadyApplied.value ? text('Accepted refinement', 'Angenommene Überarbeitung') : text('Proposed refinement — not yet accepted', 'Vorgeschlagene Überarbeitung — noch nicht angenommen');
}
const proposalAnnotations = computed(() => annotationViews(selectedProposal.value, reviews.value).map(view => {
  const currentLetter = record.value ? sanitizeRefinementText(serializeRefinementDraft(previewLetterContent.value).text, record.value.state) : '';
  const a = view.annotation;
  return { ...view,
    target: a.document === 'letter' ? text('Motivation letter', 'Motivationsschreiben') : 'CV' + (a.location ? ' · ' + (selectedRequest.value?.request_json.cv.fields.find(field => field.id === a.location?.fieldId)?.label || a.location.fieldId) : ''),
    referenceChanged: annotationReferenceChanged(a, selectedProposal.value?.proposal_json.letterText || '', currentLetter),
    included: view.status === 'resolved' && reviews.value.some(row => row.kind === 'feedback' && (row.payload.annotation as AnnotationReference | undefined)?.proposalId === view.proposalId && (row.payload.annotation as AnnotationReference).annotationId === a.id && (row.payload.annotation as AnnotationReference).reviewId === view.reviewId),
  };
}));
const currentQuestions = computed(() => proposalAnnotations.value.filter(item => item.annotation.document === pane.value && item.annotation.type === 'question'));
// Leaving review returns to saved documents; returning must not reopen a ignored proposal.
watch(tab, value => { if (value !== 'refinement') reviewActive.value = false; });
watch([cvApproved, letterApproved], ([cv, letter]) => {
  if (committingSelection) return;
  if (cv && !letter && feedbackScope.value !== 'letter') feedbackScope.value = 'letter';
  else if (letter && !cv && feedbackScope.value !== 'cv') feedbackScope.value = 'cv';
}, { immediate: true });
watch(tab, value => {
  try { sessionStorage.setItem(navigationKey, value); } catch { /* Navigation remains available. */ }
  emit('change-stage', value);
});
function selectStage(stage: Stage) {
  if (stage === tab.value) emit('change-stage', stage);
  else tab.value = stage;
}

function persist() {
  if (committingSelection) return;
  if (localReadError) { saveError.value = localReadError; return; }
  const previous = new Map<string, string | null>();
  try {
    const writes = new Map<string, string>();
    const stagedStore = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => { writes.set(key, value); }, removeItem() {} };
    if (record.value) saveApplicationCv(record.value, stagedStore);
    if (letter.value) createLetterRepository(stagedStore, props.userId).save(letter.value);
    writes.set(storageKey, JSON.stringify({ version: 1, privacyContexts: privacyContexts.value, approvals: approvals.value, savedVariant: savedVariant.value, requests: localRequests.value, parentProposalId: parentProposalId.value, parentProposalIds: parentProposalIds.value, scope: feedbackScope.value, resetRequestIds: resetRequestIds.value, resetRequestIdsByScope: resetRequestIdsByScope.value, iterationNotes: iterationNotes.value, iterationFeedbackSubmission: iterationFeedbackSubmission.value, pendingResetFeedback: pendingResetFeedback.value }));
    for (const [key, value] of writes) {
      const saved = localStorage.getItem(key);
      if (saved === value) continue;
      previous.set(key, saved); localStorage.setItem(key, value);
    }
    saveError.value = '';
  } catch (cause) {
    for (const [key, value] of previous) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Preserve the original save error and block acceptance/export. */ }
    }
    saveError.value = text('Local save failed: ', 'Lokales Speichern fehlgeschlagen: ') + String(cause);
  }
}
watch([record, letter, approvals, localRequests, parentProposalIds, privacyContexts, iterationNotes, iterationFeedbackSubmission, pendingResetFeedback, resetRequestIdsByScope], persist, { deep: true, flush: 'sync' });
function selectScopeProposal(closePreview = true) {
  const relevant = (row: RefinementProposalRow) => !isRequestReset(row.request_id) && scopedRequests.value.some(request => request.id === row.request_id);
  if (!proposals.value.some(row => row.id === selectedProposalId.value && relevant(row))) {
    selectedProposalId.value = proposals.value.find(row => row.request_id === scopedRequests.value[0]?.id && relevant(row))?.id || '';
  }
  if (closePreview) reviewActive.value = false;
}
watch(feedbackScope, () => { scopeWasChosen = true; if (!committingSelection) selectScopeProposal(); persist(); }, { flush: 'sync' });
watch(cvRevision, () => { if (approvals.value.cv && approvals.value.cv !== cvRevision.value) approvals.value.cv = null; });
watch(letterRevision, () => { if (approvals.value.letter && approvals.value.letter !== letterRevision.value) approvals.value.letter = null; });
function refreshLetterHeader() {
  if (!record.value || localReadError) return;
  const id = selectedCvId.value;
  if (!props.configurations.some(item => item.id === id)) return;
  try {
    const source = props.readVersion(id);
    if (!source) return;
    const header = captureLetterHeaderSource(id, source);
    if (refinementSignature(header) !== refinementSignature(record.value.letterHeaderSource)) record.value.letterHeaderSource = header;
  } catch (cause) { report(cause); }
}
watch(() => [selectedCvId.value, props.configurations.find(item => item.id === selectedCvId.value)?.mtime,
  props.configurations.some(item => item.id === selectedCvId.value)], refreshLetterHeader, { immediate: true, flush: 'post' });
function report(cause: unknown) {
  error.value = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
    ? cause.message : typeof cause === 'string' ? cause : text('The operation could not be completed. Please try again.', 'Der Vorgang konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
}
async function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await operation(); } catch (cause) { if (!disposed) report(cause); }
  finally { busy.value = false; }
}
async function refreshCloud() {
  if (!props.client) return;
  if (loadingCloud) return loadingCloud;
  loadingCloud = (async () => {
    refreshing.value = true;
    const initialSignature = baselineSignature.value;
    const [state, nextRequests, nextProposals, nextReviews] = await Promise.all([
      repository.loadState(props.application.id), repository.listRequests(props.application.id), repository.listProposals(props.application.id), repository.listReviews(props.application.id),
    ]);
    if (disposed) return;
    // Validate target references before the review UI can describe or preview them.
    const requestById = new Map(nextRequests.map(row => [row.id, row]));
    const requestIds = new Set(requestById.keys());
    // Shared history can be cleared on another device. Do not resurrect its local snapshots.
    const remainingLocalRequests = Object.fromEntries(Object.entries(localRequests.value)
      .filter(([id, local]) => !local.publishedAt || requestIds.has(id))
      .map(([id, local]) => [id, requestById.has(id) && !local.publishedAt ? { ...local, publishedAt: requestById.get(id)!.created_at } : local]));
    for (const proposal of nextProposals) {
      const source = nextRequests.find(request => request.id === proposal.request_id);
      if (!source) throw new Error('The proposal source request is unavailable. Reload refinement history.');
      if (proposal.application_id !== props.application.id || proposal.user_id !== props.userId) throw new Error('The proposal belongs to another application or account.');
      parseRefinementProposal(proposal.proposal_json, source.request_json);
    }
    cloudState.value = state; requests.value = nextRequests; proposals.value = nextProposals;
    reviews.value = mergeReviews(nextReviews.filter(review => review.request_id === null || requestIds.has(review.request_id)));
    localRequests.value = remainingLocalRequests;
    resetRequestIds.value = resetRequestIds.value.filter(id => requestIds.has(id));
    for (const scope of ['cv', 'letter'] as const) {
      resetRequestIdsByScope.value[scope] = resetRequestIdsByScope.value[scope].filter(id => requestIds.has(id));
      const parent = nextProposals.find(item => item.id === parentProposalIds.value[scope]);
      if (!parent || isRequestReset(parent.request_id, scope) || !nextRequests.some(row => row.id === parent.request_id && matchesScope(row, scope))) parentProposalIds.value[scope] = null;
      const submission = iterationFeedbackSubmission.value[scope];
      if (submission?.requestId && !nextRequests.some(row => row.id === submission.requestId && matchesScope(row, scope))) iterationFeedbackSubmission.value[scope] = null;
      const reset = pendingResetFeedback.value[scope];
      if (reset && !nextRequests.some(row => row.id === reset.requestId && matchesScope(row, scope))) pendingResetFeedback.value[scope] = null;
    }
    if (selectedProposalId.value && !nextProposals.some(item => item.id === selectedProposalId.value)) reviewActive.value = false;
    if (state && initialSignature === baselineSignature.value) approvals.value = clone(state.approvals_json);
    if (!scopeWasChosen && currentPublishedRequest.value) {
      const scope = currentPublishedRequest.value.request_json.scope === 'letter' ? 'letter' : 'cv';
      if ((!cvApproved.value || scope === 'letter') && (!letterApproved.value || scope === 'cv')) feedbackScope.value = scope;
    }
    cloudLoaded.value = true;
    if (!nextProposals.some(item => item.id === selectedProposalId.value && !isRequestReset(item.request_id) && scopedRequests.value.some(row => row.id === item.request_id))) selectScopeProposal(false);
    persist();
  })();
  try { await loadingCloud; }
  finally { loadingCloud = null; refreshing.value = false; }
}
function selectReviewProposal(id: string) {
  if (busy.value || !proposals.value.some(row => row.id === id)) return;
  tab.value = 'refinement'; selectedProposalId.value = id; openProposal();
}
async function checkProposals(navigate = true) { if (navigate) tab.value = 'refinement'; await run(async () => { await refreshCloud(); notice.value = proposals.value.length ? text('Proposals loaded. Review one before applying it.', 'Vorschläge geladen. Vor dem Übernehmen prüfen.') : text('No proposal yet. Run the copied prompt in ChatGPT, then check again.', 'Noch kein Vorschlag. Kopierten Prompt in ChatGPT ausführen und erneut prüfen.'); }); }
function refreshOnFocus() { refreshLetterHeader(); if (!busy.value && !syncing.value && props.active !== false) void refreshCloud().then(async () => { if (tab.value === 'refinement') await applyCurrentProposal(); }).catch(report); }
watch(() => props.active, active => { if (active) void syncRefinement(); });
watch(tab, stage => { if (stage === 'refinement') refreshOnFocus(); });
function reloadTemplates() { try { templates.value = letterRepository.listTemplates(); } catch (cause) { report(cause); } }
onMounted(() => {
  if (!props.application.workflow_stage) emit('change-stage', tab.value);
  void syncRefinement();
  window.addEventListener('focus', refreshOnFocus);
  window.addEventListener('cv-letter-templates-updated', reloadTemplates);
});
onBeforeUnmount(() => { disposed = true; window.removeEventListener('focus', refreshOnFocus); window.removeEventListener('cv-letter-templates-updated', reloadTemplates); });

async function publishCurrentCv() {
  if (!record.value) throw new Error(text('Select a CV template first.', 'Zuerst eine CV-Vorlage auswählen.'));
  persist(); if (saveError.value) throw new Error(saveError.value);
  if (published.value) return;
  const target = record.value; const state = cloneCv(target.state);
  const result = await props.publishCv(state);
  if (disposed || target !== record.value || cvDifferences(state, target.state).length) throw new Error('The CV changed while saving. Save preparation again.');
  if (!result) throw new Error(text('The anonymized CV could not be saved. Retry saving preparation.', 'Der anonymisierte CV konnte nicht gespeichert werden. Vorbereitung erneut speichern.'));
  target.publishedState = state; target.publishedSnapshotId = result.cv_variant_id; persist();
}
async function saveSetup() {
  if (!record.value || !letter.value) throw new Error(text('Select both templates first.', 'Zuerst beide Vorlagen auswählen.'));
  if (missingLetterTemplate.value) throw new Error(text('The original letter template is unavailable. Select a template in Preparation. Your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. In Vorbereitung eine Vorlage auswählen. Der bestehende Brief bleibt erhalten.'));
  if (!cloudLoaded.value) await refreshCloud();
  const signature = baselineSignature.value;
  await publishCurrentCv();
  const safeSetup = sanitizeRefinementSetup(setup.value, record.value.state);
  const currentApprovals = { cv: cvApproved.value ? cvRevision.value : null, letter: letterApproved.value ? letterRevision.value : null };
  if (cloudState.value && refinementSignature(cloudState.value.setup_json) === refinementSignature(safeSetup) && refinementSignature(cloudState.value.approvals_json) === refinementSignature(currentApprovals)) return;
  const saved = await repository.saveState(props.application.id, safeSetup, currentApprovals, cloudState.value?.revision || 0);
  if (disposed) return;
  cloudState.value = saved;
  if (signature !== baselineSignature.value) throw new Error('Documents changed while saving. Save preparation again.');
}
async function selectCv(id: string) {
  if (busy.value) return;
  const variant = props.configurations.find(item => item.id === id); const state = variant && props.readVersion(id);
  if (!variant || !state) return;
  await run(async () => {
    record.value = createApplicationCv(props.userId, props.application.id, id, variant.name, state);
    record.value.variantId = id; record.value.detached = true;
    variantName.value = suggestedVariantName();
    approvals.value = { cv: null, letter: null }; persist();
    await publishCurrentCv(); if (letter.value) await saveSetup();
    notice.value = text('CV selected for this application.', 'CV für diese Bewerbung ausgewählt.');
  });
}
async function selectLetterTemplate(id: string) {
  if (busy.value) return;
  const template = templates.value.find(item => item.id === id);
  if (!template) return;
  await run(async () => {
    if (letter.value) letter.value = selectApplicationLetterTemplate(letter.value, template);
    else letter.value = createApplicationLetter(props.userId, props.application.id, template, context.value, template.language);
    approvals.value.letter = null; persist();
    if (record.value) await saveSetup();
    notice.value = text('Letter template selected for this application.', 'Briefvorlage für diese Bewerbung ausgewählt.');
  });
}
function updateLetter(value: string) { if (letter.value) letter.value = editLetter(letter.value, letterFromEditableText(value)); }
function updateLetterFormatting(formatting?: LetterFormatting) {
  if (!letter.value || letterApproved.value || busy.value || reviewActive.value) return;
  letter.value = formatLetter(letter.value, formatting);
}
function mergeReviews(...groups: RefinementReviewRow[][]): RefinementReviewRow[] {
  return [...new Map(groups.flat().map(row => [row.id, row])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
function feedbackHistory(): RefinementFeedback[] {
  return mergeReviews(reviews.value).filter(item => item.kind === 'feedback' && (feedbackScope.value === 'both' || !item.cleared_scopes?.includes(pane.value))).map(item => {
    const annotation = item.payload.annotation as AnnotationReference | undefined;
    return { id: item.id, text: String(item.payload.text), scope: item.payload.scope as RefinementScope, createdAt: item.created_at,
      ...(annotation ? { annotation: clone(annotation) } : {}) };
  });
}
async function saveAnnotation(id: string, status: AnnotationStatus, response: string, previousReviewId: string | null): Promise<boolean> {
  let saved = false;
  await run(async () => {
    const view = proposalAnnotations.value.find(item => item.annotation.id === id);
    if (!view || !record.value) throw new Error('Restore the local CV before saving an anonymized response.');
    const safeResponse = response.trim() ? sanitizeRefinementText(response.trim(), record.value.state) : null;
    const payload = { proposalId: view.proposalId, annotationId: id, status, response: safeResponse, previousReviewId };
    validateAnnotationReview(payload);
    if (view.reviewId !== previousReviewId) throw new Error('Annotation changed elsewhere; reload the saved annotation.');
    // A retry after feedback failed must reuse the saved response and its exact reference.
    if (view.status !== status || view.response !== safeResponse) {
      const row = await repository.saveReview(props.application.id, view.requestId, 'annotation', payload);
      if (disposed) return;
      if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
    }
    await includeAnnotationFeedback(id);
    if (disposed) return;
    saved = true;
    notice.value = status === 'resolved' && safeResponse
      ? text('Response saved and included as feedback.', 'Antwort gespeichert und als Feedback übernommen.')
      : status === 'ignored' ? text('Comment ignored. It will be ignored in future refinement.', 'Kommentar verworfen. Er wird bei künftigen Überarbeitungen ignoriert.')
      : text('Comment saved.', 'Kommentar gespeichert.');
  });
  return saved;
}
async function includeAnnotationFeedback(id: string) {
  const view = proposalAnnotations.value.find(item => item.annotation.id === id);
  if (!view || !record.value || view.included) return;
  const annotation = { proposalId: view.proposalId, annotationId: id, reviewId: view.reviewId };
  const prefix = `Annotation: ${view.proposalId}/${id}`;
  const previouslyIncluded = reviews.value.some(row => row.kind === 'feedback' &&
    ((row.payload.annotation as AnnotationReference | undefined)?.proposalId === view.proposalId && (row.payload.annotation as AnnotationReference).annotationId === id
      || String(row.payload.text).startsWith(prefix)));
  const resolved = view.status === 'resolved' && !!view.response;
  if (!resolved && !previouslyIncluded) return;
  const safeText = sanitizeRefinementText(annotationFeedback(view), record.value.state);
  const hash = refinementSignature(['annotation-feedback', props.application.id, annotation]).slice(3, 35);
  const reviewId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
  if (reviews.value.some(row => row.id === reviewId)) return;
  // Review history is immutable. A cancellation supersedes the older answer;
  // it does not send that answer again or rewrite an already published request.
  const row = await repository.saveReview(props.application.id, view.requestId, 'feedback', {
    text: safeText, scope: view.annotation.document, ...(resolved ? { annotation } : {}),
  }, reviewId);
  if (disposed) return;
  if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
}
async function copyPrompt() {
  notice.value = '';
  try { await navigator.clipboard.writeText(prompt.value); notice.value = text('Connected protocol copied. This requires Supabase execute_sql in ChatGPT.', 'Verbundenes Protokoll kopiert. Dafür muss Supabase execute_sql in ChatGPT verfügbar sein.'); }
  catch { notice.value = text('Select and copy the prompt below.', 'Den Prompt unten markieren und kopieren.'); }
}
async function copyShortInstruction() {
  shortInstructionNotice.value = ''; shortInstructionError.value = '';
  const value = shortInstruction.value;
  try {
    await navigator.clipboard.writeText(value);
    if (shortInstruction.value === value) shortInstructionNotice.value = text('ChatGPT instruction copied.', 'ChatGPT-Anweisung kopiert.');
  } catch {
    if (shortInstruction.value === value) shortInstructionError.value = text('Copy unavailable. Select and copy the instruction below.', 'Kopieren nicht verfügbar. Die Anweisung unten markieren und kopieren.');
  }
}
function refinementProjectId(required = true) {
  const projectId = props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0]! : '');
  if (required && !projectId) throw new Error('The Supabase project configuration is unavailable.');
  return projectId;
}
async function createRound(scope: RefinementScope) {
  if (reviewActive.value) throw new Error('Accept or close the temporary review before publishing working documents.');
  scopeWasChosen = true;
  await refreshCloud();
  await savePendingResetFeedback(scope);
  if (!record.value || !letter.value) throw new Error('Select CV and letter templates first.');
  if (saveError.value) throw new Error(saveError.value);
  if (cvApproved.value && scope !== 'letter' || letterApproved.value && scope !== 'cv') throw new Error(text('Reopen the approved document before requesting changes to it.', 'Das freigegebene Dokument vor weiteren Änderungen wieder öffnen.'));
  if (!preparedSource.value) throw new Error(sourceError.value || text('Select both templates in Preparation first.', 'Zuerst beide Vorlagen in Vorbereitung auswählen.'));
  // Reuse the current immutable receipt without writing state, changing timestamps,
  // or creating another request. Old receipts cannot be reactivated by retrying them.
  const current = currentPublishedRequest.value;
  if (current && publicationStatus.value === 'current') {
    return;
  }
  await saveSetup(); await refreshCloud();
  const candidate = preparedSource.value;
  if (!candidate || candidate.request.scope !== scope) throw new Error(sourceError.value || 'Sources changed while preparing. Review them and publish again.');
  // A failed publication may retry its exact UUID. Never pick an older, already
  // published request just because the user reverted to its document contents.
  const pending = Object.values(localRequests.value).find(item => !item.publishedAt && !requests.value.some(row => row.id === item.request.requestId) && sameRefinementInputs(item, candidate));
  const local = pending || candidate;
  localRequests.value = { ...localRequests.value, [local.request.requestId]: clone(local) }; persist();
  if (saveError.value) throw new Error(saveError.value);
  const saved = await repository.publishRequest(local.request);
  if (disposed) return;
  if (!requests.value.some(item => item.id === saved.id)) requests.value.unshift(saved);
  localRequests.value[saved.id]!.publishedAt = saved.created_at;
  cloudState.value = await repository.loadState(props.application.id);
  if (disposed) return;
  if (!preparedSource.value || !sameRefinementInputs(local, preparedSource.value)) throw new Error('Sources changed while publishing. Review them and publish a new round.');
  if (cloudState.value?.current_request_id !== saved.id) throw new Error('A different request is current. Check for updates before publishing again.');
  notice.value = text('Sources published. Copy the task to continue in ChatGPT.', 'Quellen veröffentlicht. Die Aufgabe kopieren, um in ChatGPT fortzufahren.');
}
async function publishSources(loadProposals = false) {
  await run(async () => {
    await createRound(feedbackScope.value);
    if (loadProposals) await refreshCloud();
  });
}
async function applyCurrentProposal(id?: string) {
  if (busy.value || disposed || !record.value || !letter.value || scopeLocked.value) return;
  const currentId = cloudState.value?.current_request_id;
  if (!currentId || isRequestReset(currentId) || !currentPublishedRequest.value || !matchesScope(currentPublishedRequest.value)) return;
  const local = localRequests.value[currentId];
  if (!local) return;
  const candidate = id ? proposals.value.find(row => row.id === id && row.request_id === currentId)
    : proposals.value.find(row => row.request_id === currentId);
  if (!candidate || requests.value.find(row => row.id === currentId)?.request_json.scope !== feedbackScope.value) return;
  if (local.acceptances?.some(receipt => receipt.proposalId === candidate.id)) return;
  // A return for an older working version must never overwrite manual corrections.
  if (local.baselineSignature !== baselineSignature.value || local.cv.sourceVariantId !== (record.value.variantId || record.value.baseId)) {
    if (!id) reviewActive.value = false;
    return;
  }
  try { reconstructRefinementProposal(local, candidate.proposal_json, undefined, props.application.id); }
  catch (cause) { report(cause); return; }
  selectedProposalId.value = candidate.id;
  selectedChangeIds.value = [];
  for (const change of proposalChanges.value) toggleProposedChange(change.id, true);
  toggleProposedLetter(feedbackScope.value !== 'cv');
  // Background sync can accept from Preparation too, where the passive letter
  // comparison is not mounted. Keep that transaction separate from its UI lock.
  reviewActive.value = true;
  try { await acceptSelectedChanges(); }
  finally { if (pane.value === 'letter') reviewActive.value = false; }
  if (!error.value) notice.value = text('Proposal loaded and applied to the working document.', 'Vorschlag geladen und in die Arbeitsfassung übernommen.');
}
async function selectActiveProposal(id: string) {
  if (busy.value) return;
  selectedProposalId.value = id;
  await applyCurrentProposal(id);
}
async function syncRefinement() {
  const stopped = () => disposed || props.active === false;
  if (stopped() || !props.client || busy.value || syncing.value) return;
  refreshLetterHeader();
  syncing.value = true;
  try {
    // Sync also runs on application load and must preserve the selected workflow stage.
    await checkProposals(false);
    if (stopped() || error.value) return;
    await applyCurrentProposal();
    if (stopped() || error.value) return;
    if (!reviewActive.value && preparedSource.value && !scopeLocked.value) {
      const current = currentPublishedRequest.value;
      const appliedCurrent = !!parentProposalId.value && proposals.value.some(row => row.id === parentProposalId.value && row.request_id === current?.id);
      if (current && isRequestReset(current.id)) await run(saveSetup);
      else if (!current || current.request_json.scope !== feedbackScope.value || publicationStatus.value !== 'current' && !appliedCurrent) await publishSources(true);
      else await run(saveSetup);
      if (stopped() || error.value) return;
      await applyCurrentProposal();
      if (stopped() || error.value) return;
    }
    notice.value = proposals.value.length || !preparedSource.value || scopeLocked.value
      ? text('Synced. Available proposals are up to date.', 'Synchronisiert. Verfügbare Vorschläge sind aktuell.')
      : text('Snapshot synced. Copy the task to create the initial draft.', 'Snapshot synchronisiert. Aufgabe kopieren, um den ersten Entwurf zu erstellen.');
  } finally { syncing.value = false; }
}
async function copyIterationTask() {
  if (busy.value || refreshing.value || scopeLocked.value) return;
  // The comparison is temporary; every iteration starts from the saved working document.
  reviewActive.value = false;
  const scope = pane.value, requestedScope = feedbackScope.value;
  const draft = clone(iterationNotes.value[scope]);
  await run(async () => {
    await refreshCloud();
    await savePendingResetFeedback(requestedScope);
    await submitIterationFeedback(scope, draft);
    await createRound(requestedScope);
    if (disposed) return;
    if (refinementSignature(iterationNotes.value[scope]) === refinementSignature(draft)) iterationNotes.value[scope] = emptyIterationNotes();
    iterationFeedbackSubmission.value[scope] = null;
    persist();
    if (saveError.value) throw new Error(saveError.value);
  });
  if (error.value) return;
  await copyTask();
}
async function savePendingResetFeedback(scope: RefinementScope) {
  for (const document of scope === 'both' ? ['cv', 'letter'] as const : [scope]) {
    const pending = pendingResetFeedback.value[document];
    if (!pending) continue;
    const saved = await repository.saveReview(props.application.id, pending.requestId, 'feedback', { text: pending.text, scope: document }, pending.id);
    if (disposed) return;
    reviews.value = mergeReviews(reviews.value, [saved]);
    if (pendingResetFeedback.value[document]?.id === pending.id) pendingResetFeedback.value[document] = null;
    persist();
    if (saveError.value) throw new Error(saveError.value);
  }
}
async function submitIterationFeedback(scope: DocumentScope, draft: IterationNotes) {
  const fields = ['tone', 'structure', 'content'] as const;
  if (fields.some(field => draft[field].length > 4000)) throw new Error(text('Keep each refinement request within 4,000 characters.', 'Jeden Überarbeitungswunsch auf 4.000 Zeichen begrenzen.'));
  const sections = fields.filter(field => draft[field].trim()).map(field => `${field[0]!.toUpperCase()}${field.slice(1)}:\n${draft[field].trim()}`);
  if (!sections.length) return;
  if (!record.value) throw new Error('Restore the local CV before sharing refinement requests.');
  const safeText = sanitizeRefinementText(sections.join('\n\n'), record.value.state);
  let submission = iterationFeedbackSubmission.value[scope];
  if (!submission || submission.text !== safeText) {
    submission = { id: crypto.randomUUID(), text: safeText, requestId: scopedRequests.value[0]?.id || null };
    iterationFeedbackSubmission.value[scope] = submission;
    persist();
    if (saveError.value) throw new Error(saveError.value);
  }
  if (reviews.value.some(row => row.id === submission!.id)) return;
  const saved = await repository.saveReview(props.application.id, submission.requestId, 'feedback', { text: submission.text, scope }, submission.id);
  if (!disposed) reviews.value = mergeReviews(reviews.value, [saved]);
}
function requestToCopy() {
  if (!currentPublishedRequest.value || publicationStatus.value !== 'current') throw new Error(text('Publish the current sources before copying the task.', 'Die aktuellen Quellen vor dem Kopieren der Aufgabe veröffentlichen.'));
  return currentPublishedRequest.value;
}
async function copyTask() { await run(async () => {
  const request = requestToCopy();
  await repository.publishProtocol(request.request_json, refinementProjectId());
  if (requestToCopy().id !== request.id) throw new Error('The current refinement request changed. Copy the task again.');
  await copyShortInstruction();
}); }
async function connectedPrompt() { await run(async () => {
  const request = requestToCopy();
  prompt.value = buildRefinementPrompt(request.request_json, refinementProjectId());
  await copyPrompt();
}); }
function checkedProposalResult() {
  if (!record.value || !letter.value || !selectedProposal.value) throw new Error('Select a proposal and restore its local source documents first.');
  if (saveError.value) throw new Error(saveError.value);
  const row = selectedProposal.value;
  if (selectedRequest.value?.request_json.scope !== feedbackScope.value) throw new Error(text('Publish a separate request for the selected document before accepting changes.', 'Vor der Übernahme eine eigene Anfrage für das ausgewählte Dokument veröffentlichen.'));
  if (cloudState.value?.current_request_id !== row.request_id) throw new Error(text('This proposal belongs to a superseded round. Review the proposal for the current round or create a new round.', 'Dieser Vorschlag gehört zu einer überholten Runde. Den Vorschlag der aktuellen Runde prüfen oder eine neue Runde erstellen.'));
  const local = localRequests.value[row.request_id];
  if (!local) throw new Error(text('This device is missing the original private snapshot. Restore your documents if needed, then create a new round.', 'Der ursprüngliche private Snapshot fehlt auf diesem Gerät. Dokumente bei Bedarf wiederherstellen und eine neue Runde erstellen.'));
  const request = selectedRequest.value;
  if (row.application_id !== props.application.id || row.user_id !== props.userId || local.request.applicationId !== props.application.id
    || row.request_id !== local.request.requestId || row.proposal_json.requestId !== row.request_id || !request
    || request.application_id !== props.application.id || request.user_id !== props.userId
    || refinementSignature(request.request_json) !== refinementSignature(local.request)) throw new Error('The proposal, request and local application references do not match. Restore the original local sources.');
  if (local.cv.sourceVariantId !== (record.value.variantId || record.value.baseId)) throw new Error('The source CV variant changed after publication. This proposal is outdated; publish a new round.');
  if (cvApproved.value && selectedChangeIds.value.length || letterApproved.value && includeProposedLetter.value && row.proposal_json.letterText !== local.request.letter.text) throw new Error('Reopen the approved document before applying changes.');
  if (local.request.scope !== 'cv' && includeProposedLetter.value && letter.value.finalRevisionId) throw new Error('Reopen the finalized letter before accepting a proposed draft. The finalized letter has been preserved.');
  return applyRefinementProposal(local, row.proposal_json, record.value.state, baselineSignature.value, selectedChangeIds.value);
}
function openProposal() {
  try {
    error.value = ''; notice.value = '';
    reviewComparison.value = 'proposed'; reviewActive.value = pane.value !== 'letter';
    if (temporaryReview.value.error) throw new Error(temporaryReview.value.error);
    notice.value = text('Temporary review only. Saved documents and approvals remain unchanged until you accept the selection.', 'Nur temporäre Prüfung. Gespeicherte Dokumente und Freigaben bleiben bis zur Übernahme unverändert.');
  } catch (cause) { report(cause); }
}
function toggleProposedChange(id: string, included: boolean) {
  if (busy.value || cvApproved.value || proposalAlreadyApplied.value) return;
  if (!proposalChanges.value.some(change => change.id === id)) return;
  selectedChangeIds.value = included ? [...new Set([...selectedChangeIds.value, id])] : selectedChangeIds.value.filter(value => value !== id);
  reviewComparison.value = 'proposed'; reviewActive.value = true;
}
function toggleProposedLetter(included: boolean) {
  if (busy.value || letterApproved.value || proposalAlreadyApplied.value) return;
  includeProposedLetter.value = included; reviewComparison.value = 'proposed'; reviewActive.value = pane.value !== 'letter';
}
function discardReview() { reviewActive.value = false; notice.value = text('Temporary preview closed. Working documents are unchanged.', 'Temporäre Vorschau geschlossen. Arbeitsfassungen sind unverändert.'); }
async function acceptSelectedChanges() {
  await run(async () => {
    if ((!reviewActive.value && !showLetterComparison.value) || proposalAlreadyApplied.value) throw new Error('Preview the selection before accepting it.');
    const result = checkedProposalResult();
    const row = selectedProposal.value!, local = localRequests.value[row.request_id]!;
    const signature = baselineSignature.value;
    const selected = [...selectedChangeIds.value], includeLetter = includeProposedLetter.value;
    const key = selectionKey(row, selected, includeLetter);
    // Construct and validate both documents before any local document write.
    if (!temporaryReview.value.result || refinementSignature(temporaryReview.value.result) !== refinementSignature(result)) throw new Error('The proposal preview changed. Review the current selection before accepting.');
    const nextRecord = clone(record.value!);
    const cvChanged = local.request.scope !== 'letter' && refinementSignature(result.state) !== refinementSignature(nextRecord.state);
    if (cvChanged) {
      nextRecord.state = cloneCv(result.state);
      nextRecord.revision++; nextRecord.updatedAt = new Date().toISOString();
    }
    let nextLetter = clone(letter.value!);
    if (local.request.scope !== 'cv' && includeLetter && !letterApproved.value) {
      const candidateContext = letterContextVersion(props.application, resolveApplicationLetterState(nextRecord.state, nextRecord.baseState, nextRecord.letterHeaderSource), selectedTemplate.value, setup.value.language, nextLetter.instructions, setup.value.maxWords, nextLetter.formatting);
      const incoming = addIncomingDraft(nextLetter, letterFromEditableText(result.letterText), candidateContext, { cloudDraftId: row.id, cloudContextId: row.request_id });
      const revision = incoming.revisions.find(item => item.cloudDraftId === row.id)!;
      if (refinementSignature(revision.content) !== refinementSignature(letterFromEditableText(result.letterText))) throw new Error('The saved incoming letter does not match this proposal. Restore its original local history before accepting.');
      nextLetter = openLetterRevision(incoming, revision.id);
    }
    const payload = { proposalId: row.id, accepted: selected, rejected: proposalChanges.value.filter(change => !selected.includes(change.id)).map(change => change.id), revision: refinementSignature([result.state, props.application.context_json]) };
    const decision = await repository.saveReview(props.application.id, row.request_id, 'cv_decisions', payload);
    if (disposed) return;
    if (!reviews.value.some(item => item.id === decision.id)) reviews.value.push(decision);
    if (signature !== baselineSignature.value || selectionKey(row) !== key || selectedProposal.value?.id !== row.id) throw new Error('The working documents or selection changed while saving your decision. They were preserved. Review the proposal again.');
    checkedProposalResult();
    // The recorded decision does not grant document approval; review the saved result separately.
    const previousRecord = record.value, previousLetter = letter.value, previousParent = parentProposalId.value;
    const previousAcceptances = local.acceptances;
    committingSelection = true;
    try {
      record.value = nextRecord; letter.value = nextLetter;
      local.acceptances = [...(local.acceptances || []), { key, proposalId: row.id, variantId: null, reviewId: decision.id, acceptedAt: new Date().toISOString() }];
      parentProposalId.value = row.id;
      reviewActive.value = false;
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) {
      committingSelection = true;
      try {
        record.value = previousRecord; letter.value = previousLetter; parentProposalId.value = previousParent;
        local.acceptances = previousAcceptances; reviewActive.value = pane.value !== 'letter';
      } finally { committingSelection = false; }
      throw new Error(saveError.value);
    }
    notice.value = text('Selection accepted into this application. Excluded CV changes were recorded as rejected. Review and approve each document.', 'Auswahl in diese Bewerbung übernommen. Ausgeschlossene CV-Änderungen wurden als abgelehnt protokolliert. Jedes Dokument prüfen und freigeben.');
  });
}
async function approve(kind: 'cv' | 'letter', reopen = false) {
  await run(async () => {
    if (reviewActive.value) throw new Error('Accept or close the temporary review before approving working documents.');
    if (!record.value || !letter.value) throw new Error('Select both templates first.');
    if (!reopen && kind === 'letter' && (!letterText.value.trim() || unresolved.value.length)) throw new Error(text('Write a letter and resolve its placeholders first.', 'Zuerst einen Brief schreiben und Platzhalter auflösen.'));
    await saveSetup();
    const revision = kind === 'cv' ? cvRevision.value : letterRevision.value;
    await repository.saveReview(props.application.id, cloudState.value?.current_request_id || null, (reopen ? 'reopen_' : 'approve_') + kind as RefinementReviewRow['kind'], { ...(reopen ? {} : { revision }), expectedRevision: cloudState.value!.revision });
    cloudState.value = await repository.loadState(props.application.id);
    if (disposed) return;
    approvals.value = clone(cloudState.value!.approvals_json);
    if (!reopen && kind === 'letter' && letterRevision.value === revision) letter.value = finalizeLetter(letter.value, context.value, letterCvState.value?.contact || null);
    if (reopen && kind === 'letter') letter.value = { ...clone(letter.value), finalRevisionId: null };
    persist();
    if (!saveError.value && (reopen || (kind === 'cv' ? cvApproved.value : letterApproved.value))) notice.value = kind === 'cv'
      ? reopen ? text('CV reopened for editing.', 'CV zur Bearbeitung wieder geöffnet.') : text('CV approved.', 'CV freigegeben.')
      : reopen ? text('Letter reopened for editing.', 'Brief zur Bearbeitung wieder geöffnet.') : text('Letter approved.', 'Brief freigegeben.');
  });
}
async function saveApprovedVariant() {
  await run(async () => {
    if (!record.value || !cvApproved.value) throw new Error(text('Approve the CV before saving it as a variant.', 'Den CV freigeben, bevor er als Variante gespeichert wird.'));
    if (reviewActive.value) throw new Error(text('Close the proposal preview before saving the approved CV.', 'Die Vorschlagsvorschau schließen, bevor der freigegebene CV gespeichert wird.'));
    const name = variantName.value.trim();
    if (!name) throw new Error(text('Enter a name for the new variant.', 'Einen Namen für die neue Variante eingeben.'));
    if (!props.createVariant) throw new Error(text('The variant library is unavailable. Reopen this application and try again.', 'Die Variantenbibliothek ist nicht verfügbar. Diese Bewerbung erneut öffnen und es noch einmal versuchen.'));
    if (approvedVariantSaved.value) { notice.value = text('This approved CV is already saved in your variant library.', 'Dieser freigegebene CV ist bereits in der Variantenbibliothek gespeichert.'); return; }
    const revision = cvRevision.value;
    const snapshot = cloneCv(record.value.state);
    const previousReceipt = savedVariant.value;
    const recovering = previousReceipt?.id === '' && previousReceipt.name === name && previousReceipt.revision === revision;
    // Record the intended name before creating anything so an interrupted final
    // receipt can recover the completed library snapshot after reopening.
    savedVariant.value = { id: '', name, revision, previousIds: recovering ? previousReceipt.previousIds : props.configurations.map(item => item.id) };
    persist();
    if (saveError.value) { savedVariant.value = previousReceipt; throw new Error(saveError.value); }
    const existing = recovering ? props.configurations.find(item => !previousReceipt.previousIds?.includes(item.id)
      && item.name === name && refinementSignature(props.readVersion(item.id)) === refinementSignature(snapshot)) : undefined;
    const id = existing?.id || props.createVariant(name, snapshot);
    if (!id) throw new Error(text('The variant could not be saved. Try again.', 'Die Variante konnte nicht gespeichert werden. Erneut versuchen.'));
    savedVariant.value = { id, name, revision };
    persist();
    if (saveError.value) throw new Error(text('The variant was saved, but its local save record could not be stored. Retry saving to complete it.', 'Die Variante wurde gespeichert, aber der lokale Speichernachweis konnte nicht gesichert werden. Zum Abschließen erneut speichern.'));
    notice.value = text(`Saved “${name}” to your variant library.`, `„${name}“ in der Variantenbibliothek gespeichert.`);
  });
}
async function resetOriginalState() {
  await run(async () => {
    const scope = pane.value;
    const row = originalRequest.value;
    const local = row && localRequests.value[row.id];
    if (!row || !local?.letterBaseline || !record.value || !letter.value) throw new Error(text('The original private snapshot is unavailable on this device.', 'Der ursprüngliche private Snapshot ist auf diesem Gerät nicht verfügbar.'));
    if (row.application_id !== props.application.id || row.user_id !== props.userId || refinementSignature(row.request_json) !== refinementSignature(local.request)) throw new Error('The original snapshot does not match this application.');
    validateLocalRefinementSource(local, props.application.id);
    const previous = { record: record.value, letter: letter.value, approvals: approvals.value, parent: parentProposalIds.value[scope], selected: selectedProposalId.value, review: reviewActive.value, resetRequests: resetRequestIdsByScope.value[scope], pendingReset: pendingResetFeedback.value[scope], iterationSubmission: iterationFeedbackSubmission.value[scope] };
    const resetFeedback = pendingResetFeedback.value[scope] || (feedbackHistory().length ? {
      id: crypto.randomUUID(), requestId: row.id,
      text: `Workflow reset: for the ${scope === 'cv' ? 'CV' : 'motivation letter'} only, ignore earlier feedback and annotation answers. Start from this document’s restored original source and use only feedback explicitly provided after this reset. Keep the other document’s guidance active.`,
    } : null);
    const nextRecord = scope === 'cv' ? { ...clone(record.value), state: cloneCv(local.cv.baselineState), variantId: local.cv.sourceVariantId, revision: record.value.revision + 1, updatedAt: new Date().toISOString() } : record.value;
    let nextLetter = letter.value;
    if (scope === 'letter') {
      nextLetter = saveWorkingRevision(letter.value);
      nextLetter.working = clone(local.letterBaseline.content || letterFromEditableText(local.letterBaseline.text));
      nextLetter.templateSnapshot = clone(local.letterBaseline.setup.template);
      nextLetter.templateId = nextLetter.templateSnapshot.id;
      nextLetter.language = local.letterBaseline.setup.language;
      nextLetter.maxWords = local.letterBaseline.setup.maxWords;
      nextLetter.finalRevisionId = null;
      nextLetter.workingContext = letterContextVersion(props.application, letterCvState.value, nextLetter.templateSnapshot, nextLetter.language, nextLetter.instructions, nextLetter.maxWords, nextLetter.formatting);
    }
    committingSelection = true;
    try {
      record.value = nextRecord; letter.value = nextLetter; approvals.value = { ...approvals.value, [scope]: null };
      parentProposalIds.value[scope] = null; selectedProposalId.value = ''; reviewActive.value = false;
      resetRequestIdsByScope.value[scope] = [...new Set([...resetRequestIdsByScope.value[scope], ...scopedRequests.value.map(request => request.id)])];
      // Commit the retry receipt with the restored documents before the cloud write.
      pendingResetFeedback.value[scope] = resetFeedback;
      iterationFeedbackSubmission.value[scope] = null;
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) {
      committingSelection = true;
      try {
        record.value = previous.record; letter.value = previous.letter; approvals.value = previous.approvals;
        parentProposalIds.value[scope] = previous.parent; selectedProposalId.value = previous.selected; reviewActive.value = previous.review;
        resetRequestIdsByScope.value[scope] = previous.resetRequests;
        pendingResetFeedback.value[scope] = previous.pendingReset;
        iterationFeedbackSubmission.value[scope] = previous.iterationSubmission;
      } finally { committingSelection = false; }
      throw new Error(saveError.value);
    }
    await savePendingResetFeedback(scope);
    await saveSetup();
    notice.value = scope === 'cv' ? text('Original CV restored. Letter and history retained.', 'Ursprünglichen CV wiederhergestellt. Brief und Verlauf bleiben erhalten.') : text('Original letter restored. CV and history retained.', 'Ursprünglichen Brief wiederhergestellt. CV und Verlauf bleiben erhalten.');
  });
}
async function clearRefinementHistory() {
  if (refreshing.value || syncing.value || !canClearHistory.value) return;
  await run(async () => {
    const scope = pane.value;
    persist();
    if (saveError.value) throw new Error(saveError.value);
    await repository.clearHistory(props.application.id, cloudState.value?.revision || 0, scope);
    if (disposed) return;
    await refreshCloud();
    committingSelection = true;
    try {
      localRequests.value = Object.fromEntries(Object.entries(localRequests.value).filter(([, local]) => local.publishedAt || !refinementMatchesScope(local.request.scope, scope)));
      parentProposalIds.value[scope] = null; selectedProposalId.value = '';
      iterationFeedbackSubmission.value[scope] = null;
      pendingResetFeedback.value[scope] = null;
      selectedChangeIds.value = []; reviewActive.value = false; reviewComparison.value = 'proposed';
      prompt.value = '';
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) throw new Error(text('Shared history was cleared, but local cleanup could not be saved. Retry saving before continuing.', 'Der geteilte Verlauf wurde gelöscht, aber die lokale Bereinigung konnte nicht gespeichert werden. Vor dem Fortfahren erneut speichern.'));
    notice.value = scope === 'cv' ? text('CV history cleared. Letter history and both documents are unchanged.', 'CV-Verlauf gelöscht. Briefverlauf und beide Dokumente bleiben unverändert.') : text('Letter history cleared. CV history and both documents are unchanged.', 'Briefverlauf gelöscht. CV-Verlauf und beide Dokumente bleiben unverändert.');
  });
}
function exportHistory(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
function exportRequest(id: string) { const row = requests.value.find(row => row.id === id); if (row) exportHistory(row.request_json, 'refinement-request-' + id + '.json'); }
function exportProposal(id: string) { const row = proposals.value.find(row => row.id === id); if (row) exportHistory(row.proposal_json, 'refinement-proposal-' + id + '.json'); }
async function getCvPdf() {
  if (showReviewPreview.value) throw new Error('Accept or close the temporary review before exporting.');
  if (showLetterComparison.value) throw new Error('Open Attachments to export the approved working documents.');
  if (!cvApproved.value || !preview.value) throw new Error(text('Approve the CV before export.', 'Den CV vor dem Export freigeben.'));
  const revision = cvRevision.value; const blob = await preview.value.getPdfBlob();
  if (disposed || revision !== cvRevision.value || !cvApproved.value) throw new Error('The CV changed during export. Preview again.');
  return blob;
}
async function getLetterPdf() {
  if (showReviewPreview.value) throw new Error('Accept or close the temporary review before exporting.');
  if (showLetterComparison.value) throw new Error('Open Attachments to export the approved working letter.');
  if (!letterApproved.value || !letterPreview.value) throw new Error(text('Approve the letter before export.', 'Den Brief vor dem Export freigeben.'));
  const revision = letterRevision.value; const blob = await letterPreview.value.getPdfBlob();
  if (disposed || revision !== letterRevision.value || !letterApproved.value) throw new Error('The letter changed during export. Preview again.');
  return blob;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => notice.value);
useToastWatch(() => saveError.value, () => ({
  tone: 'error', duration: 0,
  action: { label: text('Retry save', 'Erneut speichern'), run: () => { persist(); return !saveError.value; } },
}));
useToastWatch(() => shortInstructionNotice.value, { tone: 'success' });
useToastWatch(() => shortInstructionError.value, { tone: 'error' });
</script>

<template>
  <section class="application-workspace" :class="{ 'application-workspace--sidebar': desktopSidebar }">
    <WorkspaceDetailHeader class="application-header" :title="String(application.context_json.title || text('Application', 'Bewerbung'))" :subtitle="String(application.context_json.institution || application.context_json.university || '')" :back-label="text('All applications', 'Alle Bewerbungen')" @back="emit('close')">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      <template #metadata><ApplicationIdentifier :application="application" :lang="lang" /><span>{{ text('Deadline', 'Bewerbungsfrist') }}: {{ formatOpportunityDeadline(application.context_json, lang) }}</span><ApplicationDeadlineCalendar :application="application" :lang="lang" /><span class="application-header__state">{{ applicationStatusLabel(application.status, lang) }}</span></template>
    </WorkspaceDetailHeader>
    <div class="workflow-body" :class="{ 'workflow-body--refinement': tab === 'refinement', 'workflow-body--review': tab === 'review' }">
      <section v-show="tab === 'preparation'" class="preparation-stage">
        <DesktopSidebarPortal area="major" :active="active && tab === 'preparation'">
          <div class="preparation-selection" :class="{ 'preparation-selection--sidebar': desktopSidebar }">
            <label>{{ text('Saved CV', 'Gespeicherter CV') }}<select :value="selectedCvId" :disabled="busy" @change="selectCv(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ text('Choose a CV…', 'CV wählen…') }}</option><option v-if="record && !configurations.some(item => item.id === selectedCvId)" :value="selectedCvId" disabled>{{ record.baseName }} · {{ text('Saved application copy', 'Gespeicherte Bewerbungskopie') }}</option><option v-for="variant in configurations" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <p v-if="!configurations.length" class="app-hint hint">{{ text('Save a CV in CV Studio to select it here.', 'Einen CV im CV-Studio speichern, um ihn hier auszuwählen.') }}</p>
            <label>{{ text('Letter template', 'Briefvorlage') }}<select :value="selectedTemplateId" :disabled="busy" @change="selectLetterTemplate(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ letter && !missingLetterTemplate ? selectedTemplate.name + ' · ' + text('Saved revision', 'Gespeicherte Revision') + ' ' + selectedTemplate.revision : text('Choose a letter template…', 'Briefvorlage wählen…') }}</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
            <p v-if="missingLetterTemplate" class="app-hint">{{ text('The original letter template is unavailable. Choose a template to continue; your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. Zum Fortfahren eine Vorlage auswählen; der bestehende Brief bleibt erhalten.') }}</p>
          </div>
        </DesktopSidebarPortal>
        <DesktopSidebarPortal area="minor" :active="active && tab === 'preparation'">
          <div v-if="letter" class="preparation-settings" :class="{ 'preparation-settings--sidebar': desktopSidebar }">
            <label>{{ text('Language', 'Sprache') }}<select v-model="letter.language" :disabled="busy || reviewActive || letterApproved"><option value="en">English</option><option value="de">Deutsch</option></select></label>
            <label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="letter.maxWords" type="number" min="50" max="2000" :disabled="busy || reviewActive || letterApproved" /></label>
          </div>
        </DesktopSidebarPortal>
        <OpportunityContext :context="application.context_json" :lang="lang" :default-open-groups="['overview', 'requirements', 'documents']" />
        <DesktopSidebarPortal v-if="$slots['preparation-actions']" area="minor" :active="active && tab === 'preparation'">
          <div class="preparation-actions" :class="{ 'preparation-actions--sidebar': desktopSidebar }"><slot name="preparation-actions" /></div>
        </DesktopSidebarPortal>
      </section>
      <section v-show="tab === 'refinement'" class="refinement-stage">
        <DesktopSidebarPortal area="major" :active="active && tab === 'refinement'">
        <div class="refinement-toolbar" :class="{ 'refinement-toolbar--sidebar': desktopSidebar }">
          <label>{{ text('Refinement scope', 'Umfang der Überarbeitung') }}<select v-model="feedbackScope" :disabled="busy"><option value="cv">CV</option><option value="letter">{{ text('Motivation letter', 'Motivationsschreiben') }}</option></select></label>
          <div class="action-row">
            <button v-if="pane === 'cv' && record" class="primary refinement-icon-action" type="button" :disabled="busy || reviewActive || !letter || !!saveError" @click="approve('cv', cvApproved)"><FontAwesomeIcon :icon="cvApproved ? faRotateLeft : faCheck" aria-hidden="true" />{{ cvApproved ? text('Reopen CV', 'CV wieder öffnen') : text('Approve CV', 'CV freigeben') }}</button>
            <button v-if="pane === 'letter' && letter" class="primary refinement-icon-action" type="button" :disabled="busy || reviewActive || !record || !letterText.trim() || !!saveError || (unresolved.length > 0 && !letter.finalRevisionId)" @click="approve('letter', letterApproved || !!letter.finalRevisionId)"><FontAwesomeIcon :icon="letterApproved || letter.finalRevisionId ? faRotateLeft : faCheck" aria-hidden="true" />{{ letterApproved || letter.finalRevisionId ? text('Reopen letter', 'Brief wieder öffnen') : text('Approve letter', 'Brief freigeben') }}</button>
          </div>
          <div v-if="cvApproved && createVariant" class="approved-variant-save">
            <p class="app-hint">{{ text('Save this approved CV to your variant library for reuse.', 'Diesen freigegebenen CV zur Wiederverwendung in der Variantenbibliothek speichern.') }}</p>
            <label>{{ text('Variant name', 'Variantenname') }}<input v-model="variantName" type="text" :disabled="busy || reviewActive" /></label>
            <button type="button" :disabled="busy || reviewActive || !variantName.trim() || approvedVariantSaved" @click="saveApprovedVariant">{{ approvedVariantSaved ? text('Variant saved', 'Variante gespeichert') : text('Save as new variant', 'Als neue Variante speichern') }}</button>
          </div>
        </div>
        </DesktopSidebarPortal>
        <DesktopSidebarPortal area="minor" :active="active && tab === 'refinement'">
          <div class="proposal-preview-action" :class="{ 'proposal-preview-action--sidebar': desktopSidebar }">
            <RefinementComparisonToggle v-if="showLetterComparison" v-model="reviewComparison" :lang="lang" :disabled="busy" />
            <button v-else-if="pane === 'cv' && selectedProposal" type="button" :disabled="busy" :aria-pressed="reviewActive" @click="reviewActive ? discardReview() : openProposal()">{{ reviewActive ? text('Close preview', 'Vorschau schließen') : text('Preview proposal', 'Vorschlag ansehen') }}</button>
            <button class="refinement-icon-action" type="button" :disabled="busy || refreshing || syncing" @click="syncRefinement"><FontAwesomeIcon :icon="faRotate" aria-hidden="true" />{{ syncing ? text('Syncing…', 'Synchronisieren…') : text('Sync', 'Synchronisieren') }}</button>
          </div>
        </DesktopSidebarPortal>
        <div class="refinement-controls">
          <p v-if="!record || !letter" class="app-hint">{{ text('Select both templates in Preparation to begin. Existing proposals remain available below.', 'Zum Start beide Vorlagen in Vorbereitung auswählen. Bestehende Vorschläge bleiben unten verfügbar.') }}</p>
          <p v-if="preparedSource && feedbackScope !== 'cv' && !preparedSource.request.letter.text.trim()" class="app-hint hint initial-letter-notice">{{ text('Initial letter draft: the source letter is empty. ChatGPT should create the first draft from the published CV, opportunity and template.', 'Erster Briefentwurf: Der Quellbrief ist leer. ChatGPT soll anhand des veröffentlichten CVs, der Ausschreibung und der Vorlage einen ersten Entwurf erstellen.') }}</p>
          <p v-if="sourceError" class="app-hint error" role="alert">{{ sourceError }}</p>
            <section v-if="!showInitialRefinement" class="iteration-step current-review">
              <h3>{{ text('Current Review', 'Aktuelle Prüfung') }}</h3>
              <label v-if="availableProposals.length">{{ text('Available proposals', 'Verfügbare Vorschläge') }}<select :value="selectedProposalId" :disabled="busy" @change="selectActiveProposal(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ text('Select a proposal', 'Vorschlag auswählen') }}</option><option v-for="proposal in availableProposals" :key="proposal.id" :value="proposal.id">{{ new Date(proposal.created_at).toLocaleString() }} · {{ proposal.id }}</option></select></label>
              <div v-if="selectedProposal && hasActiveProposal" class="proposal-content">
                <RefinementAnnotations :items="currentQuestions" questions-only :lang="lang" :disabled="busy || !record" :save="saveAnnotation" :privacy-preview="previewOutgoingText" />
                <p v-if="!currentQuestions.length" class="app-hint">{{ text('No questions for this document.', 'Keine Fragen zu diesem Dokument.') }}</p>
              </div>
              <p v-if="!hasActiveProposal">{{ text('Waiting for a proposal.', 'Vorschlag ausstehend.') }}</p>
            </section>
            <section class="iteration-step refinement-task" :class="showInitialRefinement ? 'initial-refinement' : 'next-refinement'">
              <h3>{{ showInitialRefinement ? text('Initial Refinement', 'Erste Überarbeitung') : text('Next Refinement', 'Nächste Überarbeitung') }}</h3>
              <p v-if="iterationPending" role="status">{{ text('Waiting for the next draft. Sync to load it.', 'Der nächste Entwurf steht aus. Zum Laden synchronisieren.') }}</p>
              <p class="app-hint">{{ text('Optional requests for this document. Included with your answered questions when you copy the task.', 'Optionale Wünsche für dieses Dokument. Sie werden beim Kopieren der Aufgabe zusammen mit Ihren beantworteten Fragen übermittelt.') }}</p>
              <label>{{ text('Tone', 'Tonalität') }}<textarea v-model="iterationNotes[pane].tone" rows="3" maxlength="4000" :disabled="busy || scopeLocked" /></label>
              <label>{{ text('Structure', 'Struktur') }}<textarea v-model="iterationNotes[pane].structure" rows="3" maxlength="4000" :disabled="busy || scopeLocked" /></label>
              <label>{{ text('Content', 'Inhalt') }}<textarea v-model="iterationNotes[pane].content" rows="3" maxlength="4000" :disabled="busy || scopeLocked" /></label>
              <button type="button" :disabled="busy || refreshing || !preparedSource || scopeLocked" @click="copyIterationTask">{{ showInitialRefinement ? text('Copy task', 'Aufgabe kopieren') : text('Copy feedback', 'Feedback kopieren') }}</button>
            </section>
            <textarea v-if="shortInstructionError" :value="shortInstruction" readonly rows="5" :aria-label="text('Short ChatGPT instruction', 'Kurze ChatGPT-Anweisung')" @focus="($event.target as HTMLTextAreaElement).select()" />
          <details class="disclosure-row"><summary>{{ text('Edit manually', 'Manuell bearbeiten') }}</summary>

          <section v-if="record" v-show="pane === 'cv'" class="working-document"><div class="action-row"><span class="app-hint">{{ text('Application copy — template stays unchanged', 'Bewerbungskopie — Vorlage bleibt unverändert') }}</span></div><fieldset :disabled="cvApproved || busy || reviewActive"><FormBuilder :state="record.state" :read-version="() => null" :save-version="() => false" /></fieldset></section>
          <section v-if="letter" v-show="pane === 'letter'" class="working-document"><label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<textarea :value="letterText" rows="18" :disabled="letterApproved || busy || reviewActive" @input="updateLetter(($event.target as HTMLTextAreaElement).value)" /></label><p :class="{ warning: words > setup.maxWords }">{{ words }} / {{ setup.maxWords }} {{ text('target words (complete letter)', 'Zielwörter (vollständiger Brief)') }}</p><p v-if="words > setup.maxWords" class="app-hint warning">{{ text('Over the target. Review the tender limit; approval and export remain available.', 'Über der Zielwortzahl. Vorgabe prüfen; Freigabe und Export bleiben möglich.') }}</p><p v-if="unresolved.length" class="app-hint warning">{{ text('Resolve placeholders:', 'Platzhalter auflösen:') }} {{ unresolved.join(', ') }}</p><LetterFormattingControls :formatting="letter.formatting" :base-formatting="selectedTemplate.formatting" :lang="lang" :disabled="letterApproved || busy || reviewActive" @change="updateLetterFormatting" /></section>
          </details>
          <RefinementHistory :scope="pane" :requests="requests" :proposals="proposals" :local-requests="localRequests" :current-request-id="cloudState?.current_request_id || null" :active-id="selectedProposalId" :review-active="reviewActive" :accepted="proposalAlreadyApplied" :publication-status="publicationStatus" :open="historyOpen" :lang="lang" :busy="busy || refreshing || syncing" :can-reset="canResetOriginal" :can-clear="canClearHistory" @reset="resetOriginalState" @clear="clearRefinementHistory" @select="selectReviewProposal" @details="historyOpen = $event" @export-request="exportRequest" @export-proposal="exportProposal">
              <details class="disclosure-row"><summary>{{ text('Connection & prompt details', 'Verbindungs- & Promptdetails') }}</summary>
                <p class="app-hint hint">{{ text('ChatGPT needs Supabase SQL tools to read the published sources and save proposals.', 'ChatGPT benötigt Supabase-SQL-Werkzeuge, um veröffentlichte Quellen zu lesen und Vorschläge zu speichern.') }}</p>
                <button type="button" :disabled="busy || publicationStatus !== 'current'" @click="connectedPrompt">{{ text('Copy connected setup prompt', 'Einrichtungsprompt für die Verbindung kopieren') }}</button>
                <textarea v-if="prompt" :value="prompt" readonly rows="7" :aria-label="text('Refinement prompt', 'Überarbeitungs-Prompt')" />
              </details>
          </RefinementHistory>
        </div>
        <div class="refinement-preview">
          <RefinementPreviewStatus v-if="pane === 'cv' ? showCvReview : showLetterReview" v-model="reviewComparison" :hide-comparison="pane === 'letter'" :label="reviewPreviewLabel(pane)" :reference="proposalPreviewReference" :outdated="proposalSourceOutdated && !(showLetterComparison && selectedWorkingLetter)" :lang="lang" />
          <p v-if="reviewAcceptanceError" class="app-hint error" role="alert">{{ reviewAcceptanceError }}</p>
          <div v-if="temporaryReview.error && (pane === 'cv' ? showCvReview : showLetterReview)" class="app-hint error" role="alert"><strong>{{ text('Proposal preview unavailable', 'Vorschlagsvorschau nicht verfügbar') }}</strong><p>{{ temporaryReview.error }}</p><p>{{ proposalPreviewReference }}</p></div>
          <DocumentCvPreview v-if="previewCvState" v-show="pane === 'cv'" ref="preview" :preview-key="documentPreviewKey" :state="previewCvState" :active="tab === 'refinement' && feedbackScope === 'cv'" hide-actions :download-disabled="showReviewPreview" />
          <MotivationLetterPreview v-if="previewLetterContent" v-show="pane === 'letter'" ref="letterPreview" :preview-key="documentPreviewKey" :cv-state="previewLetterCvState" :content="previewLetterContent" :formatting="effectiveLetterFormatting" :lang="previewLetterLanguage" :active="tab === 'refinement' && feedbackScope === 'letter'" hide-actions :download-disabled="!letterApproved || showReviewPreview" />
        </div>
      </section>
      <ApplicationDocuments v-show="tab === 'review'" :client="client" :active="active && tab === 'review'" mode="review" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state || null" :cv-ready="cvApproved" :export-ready="cvApproved && letterApproved" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterApproved" :letter-revision="letterRevision" @readiness="documentReadiness = $event">
        <OpportunityContext :context="application.context_json" :lang="lang" :only-groups="['documents']" checklist :completed-keys="application.completed_checklist_keys || []" :saving="checklistSaving" @toggle-checklist="(key, completed) => emit('toggleChecklist', key, completed)" />
      </ApplicationDocuments>
      <section v-show="tab === 'tracking'" class="tracking-stage">
        <slot name="tracking" />
      </section>
    </div>
    <DesktopSidebarPortal area="subtabs" :active="active">
    <footer class="workflow-navigation" :class="{ 'workflow-navigation--sidebar': desktopSidebar }">
      <button class="workflow-back" type="button" @click="emit('close')"><span aria-hidden="true">←</span>{{ text('All applications', 'Alle Bewerbungen') }}</button>
      <nav class="workspace-subtabs" :aria-label="text('Application stages', 'Bewerbungsphasen')">
        <button v-for="(stage, index) in stages" :key="stage" type="button" :class="{ 'is-active': tab === stage }" :aria-pressed="tab === stage" @click="selectStage(stage)"><span class="stage-number">{{ index + 1 }}</span>{{ ({ preparation: text('Preparation', 'Vorbereitung'), refinement: text('Refinement', 'Überarbeitung'), review: text('Attachments', 'Anhänge'), tracking: text('Tracking', 'Verlauf') })[stage] }}</button>
      </nav>
    </footer>
    </DesktopSidebarPortal>
  </section>
</template>

<style scoped>
.application-header__state{margin-left:auto;align-self:flex-end;padding:5px 9px;border:1px solid #356454;border-radius:6px;color:#b9edd9;font-size:12px;white-space:nowrap}
.iteration-step{padding:16px 0;}.iteration-step:first-child{padding-top:0}.iteration-step:last-of-type{border-bottom:0}.iteration-step h3{margin-bottom:10px}.iteration-step h4{font-size:14px;margin:20px 0 10px}.proposal-summary{color:#b8d9cf;font-weight:600}.proposal-preview-action{display:flex;flex-wrap:wrap;gap:8px}.proposal-preview-action--sidebar{flex-direction:column}.proposal-preview-action--sidebar button{width:100%;text-align:left}.refinement-icon-action{display:inline-flex;align-items:center;gap:8px}.refinement-icon-action svg{width:1em;flex-shrink:0}

.selection-checkbox{display:flex;align-items:center;gap:9px;min-height:36px;cursor:pointer}.selection-checkbox input{width:18px;height:18px;accent-color:#67c8a6}.preview-review-label{font-size:12px;color:#efcc87;margin:0}.application-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;color:var(--ui-text);font-family:var(--font-ui,system-ui)}
.workflow-navigation{display:contents}.workflow-back{display:none}
.workspace-subtabs{display:flex;gap:6px;flex:1;min-width:0}
.workspace-subtabs button{display:flex;align-items:center;gap:8px;flex:1;text-align:left}.workspace-subtabs .is-active{background:var(--ui-active);border-color:var(--ui-accent-border);color:var(--ui-accent)}.stage-number{color:var(--ui-muted);font-size:12px;font-variant-numeric:tabular-nums}
.workflow-body{flex:1;min-height:0;min-width:0;overflow:auto;padding:14px 0 0 0}.workflow-body--refinement,.workflow-body--review{display:flex;flex-direction:column;overflow:hidden}
.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){flex:1 0 auto;min-height:360px}
.preparation-actions{display:flex;justify-content:flex-end;padding:20px 0;border-top:1px solid #61343a}
.refinement-toolbar{position:sticky;top:0;z-index:10;min-width:0;padding-bottom:12px;border-bottom:1px solid var(--ui-border);background:#0b0f14}
.refinement-toolbar > .action-row{margin:0}
.approved-variant-save{margin-top:16px;padding-top:16px;border-top:1px solid var(--ui-border)}.approved-variant-save p{margin:0 0 12px;max-width:65ch;color:var(--ui-muted)}.approved-variant-save button{width:100%}
@media(max-width:760px){.refinement-toolbar{top:-8px;margin-top:-8px;padding-top:8px;flex-shrink:0}}
@media(min-width:761px) and (max-width:1180px){.workflow-body--review :deep(.application-documents){min-height:640px}}
@media(min-width:761px){.application-workspace{margin-bottom:40px;padding:32px;}.workflow-body{padding:20px 0 0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}.application-header :deep(.workspace-detail-header__back){display:none}.workflow-navigation{position:fixed;inset-inline:0;bottom:0;z-index:30;display:flex;align-items:center;gap:20px;min-height:66px;padding:12px max(20px,calc((100vw - 1484px)/2));border-top:1px solid #24504e;background:var(--ui-shell);box-shadow:0 -6px 20px #0003}.workflow-back{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}.workspace-subtabs button{justify-content:center}.preparation-stage{padding-bottom:6px}}
.preparation-stage,.tracking-stage{display:grid;gap:20px}.stage-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:18px}.stage-heading h2,.tracking-stage h2{color:var(--ui-accent);font-size:21px;margin:0 0 8px}.stage-heading p,p.hint{font-size:13px;color:var(--ui-muted);line-height:1.6}.stage-heading button{flex-shrink:0}
h3{font-size:16px;margin:0 0 14px}p{line-height:1.6;font-size:13px}button,input,select,textarea{font:inherit;color:inherit;border:1px solid var(--ui-border);background:var(--ui-control);border-radius:7px;padding:9px 11px;box-sizing:border-box}button{cursor:pointer;font-size:13px}button:disabled{opacity:.45;cursor:not-allowed}button:hover:enabled{background:var(--ui-surface-hover)}.primary{background:var(--ui-active);border-color:var(--ui-accent-border);color:var(--ui-accent)}label{display:grid;gap:7px;font-size:12px;font-weight:600;margin-bottom:12px}input,select,textarea{width:100%;min-width:0;font-size:14px;font-weight:400}textarea{resize:vertical;line-height:1.6}select{max-width:100%}pre{font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere}.pre-wrap{white-space:pre-wrap;overflow-wrap:anywhere}.preparation-selection,.preparation-settings{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px}.preparation-selection label,.preparation-settings label{margin:0}.preparation-selection p{grid-column:1 / -1;margin:0}.preparation-selection--sidebar,.preparation-settings--sidebar{grid-template-columns:minmax(0,1fr)}.workflow-card{border:1px solid var(--ui-border);border-radius:10px;padding:18px;background:#091923}.workflow-card p{margin:10px 0}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.action-row span{font-size:12px;color:var(--ui-muted)}.error{color:#fecaca}.warning{color:#efcc87;font-size:13px}.refinement-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,30%);gap:24px;flex:1;min-height:0;overflow:hidden}.refinement-controls{overflow:auto;min-height:0;padding-right:8px}.refinement-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:1;min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block}.working-document{margin-bottom:24px}.working-document fieldset{border:0;padding:0;min-width:0}.working-document :deep(.builder){height:auto;overflow:visible}.working-document :deep(.content-panel),.working-document :deep(.content-panel__scroll-body){height:auto;overflow:visible;overscroll-behavior:auto;flex:0 0 auto}.cv-change{display:grid;gap:7px;margin:16px 0;font-size:13px;white-space:pre-wrap}.cv-change del{background:#3a1720;padding:9px;text-decoration:none;color:#fecaca}.cv-change ins{background:#10382c;padding:9px;text-decoration:none;color:#a7f3d0}.review-heading{flex:0 0 auto}.review-heading .stage-heading{margin-bottom:10px}.review-heading details{max-height:25vh;overflow:auto;margin-bottom:10px}.preparation-stage :deep(.opportunity-context){overflow:visible}
@media(max-width:900px){.preparation-selection{grid-template-columns:1fr}.refinement-stage{grid-template-columns:minmax(0,1fr) minmax(270px,38%);gap:12px}.stage-heading{flex-direction:column}}
@media(max-width:760px){.application-workspace{--mobile-application-tabs-height:48px;padding-bottom:var(--mobile-application-tabs-height)}.workspace-subtabs{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;height:48px;margin:0;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;background:var(--ui-shell);border-top:1px solid #24504e}.workspace-subtabs button{font-size:12px;white-space:nowrap;padding:7px;gap:4px}.stage-number{display:none}.workflow-body{padding:8px}.workflow-body--refinement{overflow:auto}.refinement-stage{display:flex;flex-direction:column;gap:10px;overflow:visible;flex:0 0 auto}.refinement-controls{flex:0 0 auto;overflow:visible}.refinement-preview{flex:0 0 auto}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:0 0 auto}.refinement-preview :deep(.document-inline-preview){min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block;max-height:60vh}.stage-heading{gap:10px}.stage-heading h2{font-size:20px}.workflow-card{padding:14px}.workflow-body input,.workflow-body textarea,.workflow-body select{font-size:16px}.workflow-body p{font-size:15px}.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){min-height:430px;flex:1 0 auto}.review-heading details{max-height:180px}.tracking-stage{gap:12px}}
@media(min-width:761px){.refinement-stage{grid-template-rows:auto auto minmax(0,1fr);row-gap:12px}.refinement-toolbar{grid-column:1;grid-row:1;margin-right:8px}.proposal-preview-action{grid-column:1;grid-row:2}.refinement-controls{grid-column:1;grid-row:3}.refinement-preview{grid-column:2;grid-row:1 / 4}}
.application-workspace--sidebar{margin-bottom:0}
.application-workspace--sidebar .refinement-stage{grid-template-rows:minmax(0,1fr)}
.application-workspace--sidebar .refinement-controls{grid-row:1}
.application-workspace--sidebar .refinement-preview{grid-row:1}
.workflow-navigation--sidebar{position:static;display:flex;flex-direction:column;align-items:stretch;gap:8px;min-height:0;padding:0;border:0;background:transparent;box-shadow:none}
.workflow-navigation--sidebar .workspace-subtabs{flex-direction:column;gap:6px}
.workflow-navigation--sidebar .workspace-subtabs button{justify-content:flex-start;width:100%}
.workflow-navigation--sidebar .workflow-back{display:flex;width:100%}
.preparation-actions--sidebar{display:flex;padding:0;border:0}
.preparation-actions--sidebar :deep(button){width:100%}
.refinement-toolbar--sidebar{position:static;padding:0;margin:0;border:0;background:transparent}
.refinement-toolbar--sidebar .action-row{display:flex;flex-direction:column;align-items:stretch;gap:8px}
.refinement-toolbar--sidebar .action-row button{width:100%;text-align:left}
</style>
