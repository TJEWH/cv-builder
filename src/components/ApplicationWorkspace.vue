<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import { supabaseConfiguration } from '../lib/supabase';
import type { CvState, SavedConfiguration } from '../types';
import type { ApplicationLetter, LetterTemplate } from '../letterTypes';
import type { ApprovedPrivacyContexts, AnnotationStatus, AnnotationReference, LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementScope, RefinementState } from '../refinementTypes';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv, type ApplicationCvRecord } from '../composables/applicationCv';
import { subvariantParent } from '../composables/careerVariants';
import { addIncomingDraft, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizeLetter, letterContextVersion, letterFromEditableText, openLetterRevision, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import { applyRefinementProposal, buildRefinementPrompt, createRefinementRepository, describeCvOperation, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText } from '../composables/applicationRefinement';
import { opensInTracking } from '../composables/applicationTracking';
import { formatOpportunityDeadline } from '../composables/opportunityDeadline';
import FormBuilder from './FormBuilder.vue';
import DocumentCvPreview from './DocumentCvPreview.vue';
import MotivationLetterPreview from './MotivationLetterPreview.vue';
import RefinementHistory from './RefinementHistory.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import OpportunityContext from './OpportunityContext.vue';
import { buildShortRefinementInstruction } from '../composables/applicationReference';
import { resolveRefinementSettings, serializeRefinementDraft, sameRefinementInputs } from '../composables/refinementSources';
import PrivacyTextPreview from './PrivacyTextPreview.vue';
import RefinementChangeReview from './RefinementChangeReview.vue';
import RefinementAnnotations from './RefinementAnnotations.vue';
import RefinementPreviewStatus from './RefinementPreviewStatus.vue';
import { annotationViews, annotationReferenceChanged, annotationFeedback, validateAnnotationReview } from '../composables/refinementAnnotations';
import { useToastWatch } from '../composables/useToasts';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../composables/desktopSidebar';

const props = withDefaults(defineProps<{
  projectId?: string; active?: boolean; checklistSaving?: boolean;
  application: Application; client: SupabaseClient | null; userId: string; lang: string;
  configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null;
  publishCv: (state: CvState) => Promise<Application | null>;
  createSubvariant?: (sourceId: string, name: string, state: CvState) => string | null;
}>(), { active: true });
const emit = defineEmits<{ close: []; 'edit-variant': [id: string]; toggleChecklist: [key: string, completed: boolean] }>();
const desktopSidebar = useDesktopSidebar();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const storageKey = 'CV_REFINEMENT:1:' + encodeURIComponent(props.userId) + ':' + props.application.id;
const navigationKey = 'CV_APPLICATION_TAB:' + props.userId + ':' + props.application.id;
const stages = ['preparation', 'refinement', 'review', 'tracking'] as const;
type Stage = typeof stages[number];
const tab = ref<Stage>('preparation');
const record = ref<ApplicationCvRecord | null>(null);
const letter = ref<ApplicationLetter | null>(null);
const templates = ref<LetterTemplate[]>([]);
const approvals = ref<RefinementApprovals>({ cv: null, letter: null });
const privacyContexts = ref<ApprovedPrivacyContexts>({});
const localRequests = ref<Record<string, LocalRefinementRequest>>({});
const parentProposalId = ref<string | null>(null);
const cloudState = ref<RefinementState | null>(null);
const requests = ref<RefinementRequestRow[]>([]);
const proposals = ref<RefinementProposalRow[]>([]);
const reviews = ref<RefinementReviewRow[]>([]);
const importedProposals = ref<RefinementProposalRow[]>([]);
const importedReviews = ref<RefinementReviewRow[]>([]);
const selectedProposalId = ref('');
// Review selections are transient: neither previewing nor toggling writes working documents.
const selectedChangeIds = ref<string[]>([]);
const includeProposedLetter = ref(true);
const reviewActive = ref(false);
const reviewComparison = ref<'original' | 'proposed'>('proposed');
const feedback = ref('');
const feedbackScope = ref<RefinementScope>('cv');
const pane = computed(() => feedbackScope.value === 'letter' ? 'letter' : 'cv');
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
let pendingReview: { key: string; id: string } | null = null;
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
    localRequests.value = value.requests || {};
    privacyContexts.value = value.privacyContexts || {};
    importedProposals.value = value.importedProposals || [];
    importedReviews.value = value.importedReviews || [];
    parentProposalId.value = value.parentProposalId || null;
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
  if (stages.includes(mapped as Stage)) tab.value = mapped as Stage;
} catch (cause) {
  localReadError = text('Saved application data could not be read. Recover the local application data before saving: ', 'Gespeicherte Bewerbungsdaten konnten nicht gelesen werden. Vor dem Speichern die lokalen Bewerbungsdaten wiederherstellen: ') + String(cause);
  saveError.value = localReadError;
}
watch(() => props.application.status, status => {
  if (opensInTracking(status)) tab.value = 'tracking';
}, { immediate: true });
const selectedCvId = computed(() => record.value?.variantId || record.value?.baseId || '');
const selectedTemplate = computed(() => letter.value?.templateSnapshot || templates.value.find(item => item.id === letter.value?.templateId) || DEFAULT_LETTER_TEMPLATES[0]!);
const missingLetterTemplate = computed(() => !!letter.value && !letter.value.templateSnapshot);
const selectedTemplateId = computed(() => {
  const template = templates.value.find(item => item.id === letter.value?.templateId);
  return template && template.revision === letter.value?.templateSnapshot?.revision ? template.id : '';
});
const effectiveSettings = computed(() => resolveRefinementSettings(selectedTemplate.value, letter.value));
const setup = computed(() => effectiveSettings.value.setup);
const letterText = computed(() => serializeRefinementDraft(letter.value?.working).text);
const context = computed(() => letterContextVersion(props.application, record.value?.state || null, selectedTemplate.value, setup.value.language, letter.value?.instructions || '', setup.value.maxWords));
const baselineSignature = computed(() => refinementSignature([record.value?.state, letterText.value, setup.value, letter.value?.instructions || '', props.application.context_json, letter.value?.working]));
const cvRevision = computed(() => refinementSignature([record.value?.state, props.application.context_json]));
const letterRevision = computed(() => refinementSignature([letterText.value, setup.value, letter.value?.instructions || '', record.value?.state.design, record.value?.state.contact, props.application.context_json]));
const cvApproved = computed(() => !!record.value && approvals.value.cv === cvRevision.value && !saveError.value);
const unresolved = computed(() => letter.value ? unresolvedLetterPlaceholders(letter.value.working, record.value?.state.contact || null) : []);
const letterApproved = computed(() => !!letterText.value.trim() && approvals.value.letter === letterRevision.value && !unresolved.value.length && !saveError.value);
const words = computed(() => letterText.value.trim().split(/\s+/).filter(Boolean).length);
const published = computed(() => !!record.value && isApplicationCvPublished(record.value, props.application.cv_variant_id));
const selectedProposal = computed(() => proposals.value.find(item => item.id === selectedProposalId.value));
const selectedRequest = computed(() => requests.value.find(item => item.id === selectedProposal.value?.request_id));
const selectedLocalRequest = computed(() => selectedProposal.value ? localRequests.value[selectedProposal.value.request_id] : undefined);
const reviewScope = computed(() => selectedLocalRequest.value?.request.scope || selectedRequest.value?.request_json.scope);
const showReviewPreview = computed(() => reviewActive.value && tab.value === 'refinement');
const showCvReview = computed(() => showReviewPreview.value && reviewScope.value !== 'letter');
const showLetterReview = computed(() => showReviewPreview.value && reviewScope.value !== 'cv');
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
const outgoingFeedback = computed(() => previewOutgoingText(feedback.value));
const publicationStatus = computed<'unpublished' | 'current' | 'outdated' | 'unverifiable'>(() => {
  if (!publishedSource.value) return 'unpublished';
  if (!currentPublishedRequest.value) return 'outdated';
  const local = localRequests.value[currentPublishedRequest.value.id];
  if (!local || !record.value || !letter.value) return 'unverifiable';
  return preparedSource.value && sameRefinementInputs(local, preparedSource.value) ? 'current' : 'outdated';
});
const proposalChanges = computed(() => {
  const proposal = selectedProposal.value?.proposal_json, request = selectedRequest.value?.request_json;
  if (!proposal || !request) return [];
  const decision = [...reviews.value].reverse().find(item => item.kind === 'cv_decisions' && item.payload.proposalId === selectedProposal.value?.id);
  const status = (id: string): 'proposed' | 'accepted' | 'rejected' => (decision?.payload.accepted as string[] | undefined)?.includes(id) ? 'accepted' : (decision?.payload.rejected as string[] | undefined)?.includes(id) ? 'rejected' : 'proposed';
  if (proposal.schemaVersion === 2 && request.schemaVersion === 2) return proposal.cvOperations.map(operation => ({
    ...describeCvOperation(operation, request.cvStructure), id: operation.id, type: operation.type, explanation: operation.explanation, status: status(operation.id),
  }));
  if (proposal.schemaVersion !== 1) return [];
  return proposal.cvEdits.map(edit => {
    const field = request.cv.fields.find(item => item.id === edit.fieldId);
    return { id: edit.fieldId, type: 'legacy_text_replacement', target: field?.label || edit.fieldId, before: field?.text || '', after: edit.text,
      explanation: text('General wording replacement from a legacy proposal. Review the text and qualifications explicitly.', 'Allgemeine Textersetzung aus einem früheren Vorschlag. Wortlaut und Qualifikationen ausdrücklich prüfen.'), status: status(edit.fieldId) };
  });
});
const proposalComments = computed(() => selectedProposal.value?.proposal_json.schemaVersion === 2 ? selectedProposal.value.proposal_json.cvComments.map(comment => ({
  ...comment, target: selectedRequest.value?.request_json.cv.fields.find(field => field.id === comment.fieldId)?.label || comment.fieldId,
})) : []);
const proposalDecision = computed(() => [...reviews.value].reverse().find(item => item.kind === 'cv_decisions' && item.payload.proposalId === selectedProposal.value?.id));
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
watch(selectedProposalId, () => {
  selectedChangeIds.value = cvApproved.value ? [] : proposalChanges.value.filter(change => change.status !== 'rejected').map(change => change.id);
  includeProposedLetter.value = !letterApproved.value && selectedRequest.value?.request_json.scope !== 'cv';
  reviewComparison.value = 'proposed';
  reviewActive.value = !!selectedProposal.value;
}, { flush: 'sync' });
const temporaryReview = computed(() => {
  if (!reviewActive.value) return { result: null, error: '' };
  try {
    const row = selectedProposal.value, local = selectedLocalRequest.value, source = selectedRequest.value;
    if (!row || !local) throw new Error(text('Restore the original local snapshot to preview this proposal.', 'Ursprünglichen lokalen Snapshot wiederherstellen, um diesen Vorschlag anzusehen.'));
    if (!source || source.application_id !== props.application.id || row.application_id !== props.application.id || source.user_id !== props.userId || row.user_id !== props.userId || row.request_id !== source.id || row.proposal_json.requestId !== source.id || refinementSignature(source.request_json) !== refinementSignature(local.request)) throw new Error(text('The proposal and its source request do not match this application.', 'Vorschlag und Quellanfrage passen nicht zu dieser Bewerbung.'));
    return { result: reconstructRefinementProposal(local, row.proposal_json, selectedChangeIds.value, props.application.id), error: '' };
  }
  catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const reviewAcceptanceError = computed(() => {
  if (!reviewActive.value || proposalAlreadyApplied.value) return '';
  try { checkedProposalResult(); return ''; }
  catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
});
const previewCvState = computed(() => {
  if (!showCvReview.value) return record.value?.state || null;
  if (!temporaryReview.value.result) return null;
  return reviewComparison.value === 'original' ? selectedLocalRequest.value!.cv.baselineState : temporaryReview.value.result.state;
});
const previewLetterContent = computed(() => {
  if (!showLetterReview.value) return letter.value?.working;
  if (!temporaryReview.value.result || !selectedLocalRequest.value?.letterBaseline) return undefined;
  const original = reviewComparison.value === 'original' || !includeProposedLetter.value;
  if (original && selectedLocalRequest.value.letterBaseline.content) return selectedLocalRequest.value.letterBaseline.content;
  return letterFromEditableText(original ? selectedLocalRequest.value.letterBaseline.text : temporaryReview.value.result.letterText);
});
// A CV-only proposal must not change the letter's layout or placeholder source.
const previewLetterCvState = computed(() => {
  if (!showLetterReview.value) return record.value?.state || null;
  return reviewComparison.value === 'proposed' ? temporaryReview.value.result?.state || null : selectedLocalRequest.value?.cv.baselineState || null;
});
const previewLetterLanguage = computed(() => showLetterReview.value ? selectedLocalRequest.value?.letterBaseline?.setup.language || props.lang : letter.value?.language || props.lang);
const proposalPreviewReference = computed(() => selectedProposal.value ? selectedProposal.value.id + ' · ' + new Date(selectedProposal.value.created_at).toLocaleString() : '');
function reviewPreviewLabel(document: 'cv' | 'letter') {
  if (reviewComparison.value === 'original' || document === 'letter' && !includeProposedLetter.value) return text('Original source snapshot', 'Ursprünglicher Quellen-Snapshot');
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
// Leaving review returns to saved documents; returning must not reopen a dismissed proposal.
watch(tab, value => { if (value !== 'refinement') reviewActive.value = false; });
watch([cvApproved, letterApproved], ([cv, letter]) => {
  if (cv && !letter && feedbackScope.value !== 'letter') feedbackScope.value = 'letter';
  else if (letter && !cv && feedbackScope.value !== 'cv') feedbackScope.value = 'cv';
}, { immediate: true });
watch(tab, value => { try { sessionStorage.setItem(navigationKey, value); } catch { /* Navigation remains available. */ } });

function persist() {
  if (committingSelection) return;
  if (localReadError) { saveError.value = localReadError; return; }
  const previous = new Map<string, string | null>();
  try {
    const writes = new Map<string, string>();
    const stagedStore = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => { writes.set(key, value); }, removeItem() {} };
    if (record.value) saveApplicationCv(record.value, stagedStore);
    if (letter.value) createLetterRepository(stagedStore, props.userId).save(letter.value);
    writes.set(storageKey, JSON.stringify({ version: 1, privacyContexts: privacyContexts.value, approvals: approvals.value, requests: localRequests.value, parentProposalId: parentProposalId.value, scope: feedbackScope.value, importedProposals: importedProposals.value, importedReviews: importedReviews.value }));
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
watch([record, letter, approvals, localRequests, parentProposalId, privacyContexts], persist, { deep: true, flush: 'sync' });
watch(feedbackScope, () => { scopeWasChosen = true; persist(); }, { flush: 'sync' });
watch(cvRevision, () => { if (approvals.value.cv && approvals.value.cv !== cvRevision.value) approvals.value.cv = null; });
watch(letterRevision, () => { if (approvals.value.letter && approvals.value.letter !== letterRevision.value) approvals.value.letter = null; });
function report(cause: unknown) { error.value = cause instanceof Error ? cause.message : String(cause); }
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
    const combinedProposals = [...nextProposals, ...importedProposals.value.filter(item => !nextProposals.some(row => row.id === item.id))];
    for (const proposal of combinedProposals) {
      const source = nextRequests.find(request => request.id === proposal.request_id);
      if (!source) throw new Error('The proposal source request is unavailable. Reload refinement history.');
      if (proposal.application_id !== props.application.id || proposal.user_id !== props.userId) throw new Error('The proposal belongs to another application or account.');
      parseRefinementProposal(proposal.proposal_json, source.request_json);
    }
    cloudState.value = state; requests.value = nextRequests; proposals.value = combinedProposals; reviews.value = mergeReviews(nextReviews, importedReviews.value);
    if (state && initialSignature === baselineSignature.value) approvals.value = clone(state.approvals_json);
    if (!scopeWasChosen && currentPublishedRequest.value) {
      const scope = currentPublishedRequest.value.request_json.scope === 'letter' ? 'letter' : 'cv';
      if ((!cvApproved.value || scope === 'letter') && (!letterApproved.value || scope === 'cv')) feedbackScope.value = scope;
    }
    cloudLoaded.value = true;
    if (!selectedProposalId.value || !combinedProposals.some(item => item.id === selectedProposalId.value)) selectedProposalId.value = combinedProposals.find(item => item.request_id === state?.current_request_id)?.id || '';
  })();
  try { await loadingCloud; }
  finally { loadingCloud = null; refreshing.value = false; }
}
function selectReviewProposal(id: string) {
  if (busy.value || !proposals.value.some(row => row.id === id)) return;
  tab.value = 'refinement'; selectedProposalId.value = id; openProposal();
}
async function checkProposals() { tab.value = 'refinement'; await run(async () => { await refreshCloud(); notice.value = proposals.value.length ? text('Proposals loaded. Review one before applying it.', 'Vorschläge geladen. Vor dem Übernehmen prüfen.') : text('No proposal yet. Run the copied prompt in ChatGPT, then check again.', 'Noch kein Vorschlag. Kopierten Prompt in ChatGPT ausführen und erneut prüfen.'); }); }
function refreshOnFocus() { if (!busy.value && props.active !== false) void refreshCloud().catch(report); }
watch(() => props.active, active => { if (active) { if (opensInTracking(props.application.status)) tab.value = 'tracking'; refreshOnFocus(); } });
watch(tab, stage => { if (stage === 'refinement') refreshOnFocus(); });
function reloadTemplates() { try { templates.value = letterRepository.listTemplates(); } catch (cause) { report(cause); } }
onMounted(() => { void refreshCloud().catch(report); window.addEventListener('focus', refreshOnFocus); window.addEventListener('cv-letter-templates-updated', reloadTemplates); });
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
function mergeReviews(...groups: RefinementReviewRow[][]): RefinementReviewRow[] {
  return [...new Map(groups.flat().map(row => [row.id, row])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
function feedbackHistory(): RefinementFeedback[] {
  return mergeReviews(reviews.value).filter(item => item.kind === 'feedback').map(item => {
    const annotation = item.payload.annotation as AnnotationReference | undefined;
    // Imported proposals have no cloud identity. Their approved question/answer is
    // ordinary feedback in the protocol; its review association stays local.
    const sharedReference = annotation && !importedProposals.value.some(proposal => proposal.id === annotation.proposalId);
    return { id: item.id, text: String(item.payload.text), scope: item.payload.scope as RefinementScope, createdAt: item.created_at,
      ...(sharedReference ? { annotation: clone(annotation) } : {}) };
  });
}
function storedImportedReviews(): RefinementReviewRow[] {
  return JSON.parse(localStorage.getItem(storageKey) || '{}').importedReviews || [];
}
function persistImportedReview(row: RefinementReviewRow) {
  const previousImported = importedReviews.value, previousReviews = reviews.value;
  importedReviews.value = mergeReviews(storedImportedReviews(), importedReviews.value, [row]);
  reviews.value = mergeReviews(reviews.value, importedReviews.value);
  persist();
  if (saveError.value) {
    importedReviews.value = previousImported; reviews.value = previousReviews;
    throw new Error(saveError.value);
  }
}
async function saveAnnotation(id: string, status: AnnotationStatus, response: string, previousReviewId: string | null): Promise<boolean> {
  let saved = false;
  await run(async () => {
    const view = proposalAnnotations.value.find(item => item.annotation.id === id);
    if (!view || !record.value) throw new Error('Restore the local CV before saving an anonymized response.');
    const safeResponse = response.trim() ? sanitizeRefinementText(response.trim(), record.value.state) : null;
    const payload = { proposalId: view.proposalId, annotationId: id, status, response: safeResponse, previousReviewId };
    validateAnnotationReview(payload);
    const imported = importedProposals.value.find(proposal => proposal.id === view.proposalId);
    const latest = imported ? annotationViews(imported, storedImportedReviews()).find(item => item.annotation.id === id) : view;
    if (latest?.reviewId !== previousReviewId || view.reviewId !== previousReviewId) throw new Error('Annotation changed elsewhere; reload the saved annotation.');
    // A retry after feedback failed must reuse the saved response and its exact reference.
    if (view.status !== status || view.response !== safeResponse) {
      let row: RefinementReviewRow;
      if (imported) {
        const createdAt = new Date(Math.max(Date.now(), ...storedImportedReviews().map(item => Date.parse(item.created_at) + 1))).toISOString();
        row = { id: crypto.randomUUID(), application_id: props.application.id, user_id: props.userId, request_id: view.requestId,
          kind: 'annotation', payload, created_at: createdAt };
        persistImportedReview(row);
      } else row = await repository.saveReview(props.application.id, view.requestId, 'annotation', payload);
      if (disposed) return;
      if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
    }
    await includeAnnotationFeedback(id);
    if (disposed) return;
    saved = true;
    notice.value = status === 'resolved' && safeResponse
      ? text('Response saved and included as feedback.', 'Antwort gespeichert und als Feedback übernommen.')
      : status === 'dismissed' ? text('Comment dismissed. It will be ignored in future refinement.', 'Kommentar verworfen. Er wird bei künftigen Überarbeitungen ignoriert.')
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
  const imported = importedProposals.value.find(proposal => proposal.id === view.proposalId);
  if (imported && annotationViews(imported, storedImportedReviews()).find(item => item.annotation.id === id)?.reviewId !== view.reviewId) throw new Error('Annotation changed elsewhere; reload the saved annotation.');
  const hash = refinementSignature(['annotation-feedback', props.application.id, annotation]).slice(3, 35);
  const reviewId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
  if (reviews.value.some(row => row.id === reviewId)) return;
  // Review history is immutable. A cancellation supersedes the older answer;
  // it does not send that answer again or rewrite an already published request.
  const row = await repository.saveReview(props.application.id, view.requestId, 'feedback', {
    text: safeText, scope: view.annotation.document, ...(resolved && !imported ? { annotation } : {}),
  }, reviewId);
  if (disposed) return;
  if (imported && resolved) persistImportedReview({ ...row, payload: { ...row.payload, annotation } });
  else if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
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
async function publishSources() { await run(async () => { await createRound(feedbackScope.value); }); }
function requestToCopy() {
  if (!currentPublishedRequest.value || publicationStatus.value !== 'current') throw new Error(text('Publish the current sources before copying the task.', 'Die aktuellen Quellen vor dem Kopieren der Aufgabe veröffentlichen.'));
  return currentPublishedRequest.value;
}
async function copyTask() { await run(async () => { requestToCopy(); await copyShortInstruction(); }); }
async function connectedPrompt() { await run(async () => {
  const request = requestToCopy();
  prompt.value = buildRefinementPrompt(request.request_json, refinementProjectId(), 'connected');
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
    reviewComparison.value = 'proposed'; reviewActive.value = true;
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
  includeProposedLetter.value = included; reviewComparison.value = 'proposed'; reviewActive.value = true;
}
function discardReview() { reviewActive.value = false; notice.value = text('Temporary preview closed. Working documents are unchanged.', 'Temporäre Vorschau geschlossen. Arbeitsfassungen sind unverändert.'); }
async function acceptSelectedChanges() {
  await run(async () => {
    if (!reviewActive.value || proposalAlreadyApplied.value) throw new Error('Preview the selection before accepting it.');
    const result = checkedProposalResult();
    const row = selectedProposal.value!, local = localRequests.value[row.request_id]!;
    const signature = baselineSignature.value;
    const selected = [...selectedChangeIds.value], includeLetter = includeProposedLetter.value;
    const key = selectionKey(row, selected, includeLetter);
    // Construct and validate both documents before any local document/library write.
    if (!temporaryReview.value.result || refinementSignature(temporaryReview.value.result) !== refinementSignature(result)) throw new Error('The proposal preview changed. Review the current selection before accepting.');
    const nextRecord = clone(record.value!);
    const cvChanged = local.request.scope !== 'letter' && refinementSignature(result.state) !== refinementSignature(nextRecord.state);
    const variantName = `${local.source?.cv.name || nextRecord.baseName} · refinement ${key.slice(-16)}`;
    let variantId: string | null = null;
    if (cvChanged) {
      subvariantParent(local.cv.sourceVariantId, props.configurations);
      if (!props.createSubvariant) throw new Error('The local variant library is unavailable. Restore it before accepting CV changes.');
      nextRecord.state = cloneCv(result.state);
      nextRecord.revision++; nextRecord.updatedAt = new Date().toISOString();
    }
    let nextLetter = clone(letter.value!);
    if (local.request.scope !== 'cv' && includeLetter && !letterApproved.value) {
      const candidateContext = letterContextVersion(props.application, nextRecord.state, selectedTemplate.value, setup.value.language, nextLetter.instructions, setup.value.maxWords);
      const incoming = addIncomingDraft(nextLetter, letterFromEditableText(result.letterText), candidateContext, { cloudDraftId: row.id, cloudContextId: row.request_id });
      const revision = incoming.revisions.find(item => item.cloudDraftId === row.id)!;
      if (refinementSignature(revision.content) !== refinementSignature(letterFromEditableText(result.letterText))) throw new Error('The saved incoming letter does not match this proposal. Restore its original local history before accepting.');
      nextLetter = openLetterRevision(incoming, revision.id);
    }
    const payload = { proposalId: row.id, accepted: selected, rejected: proposalChanges.value.filter(change => !selected.includes(change.id)).map(change => change.id), revision: refinementSignature([result.state, props.application.context_json]) };
    const imported = importedProposals.value.some(item => item.id === row.id);
    const decision: RefinementReviewRow = imported
      ? { id: crypto.randomUUID(), application_id: props.application.id, user_id: props.userId, request_id: row.request_id, kind: 'cv_decisions', payload, created_at: new Date().toISOString() }
      : await repository.saveReview(props.application.id, row.request_id, 'cv_decisions', payload);
    if (disposed) return;
    if (!reviews.value.some(item => item.id === decision.id)) reviews.value.push(decision);
    if (signature !== baselineSignature.value || selectionKey(row) !== key || selectedProposal.value?.id !== row.id) throw new Error('The working documents or selection changed while saving your decision. They were preserved. Review the proposal again.');
    checkedProposalResult();
    if (cvChanged) {
      // A deterministic receipt name also recovers a complete variant if local saving was interrupted.
      const existing = props.configurations.find(item => item.name === variantName && item.parentId === subvariantParent(local.cv.sourceVariantId, props.configurations)
        && refinementSignature(props.readVersion(item.id)) === refinementSignature(result.state));
      variantId = existing?.id || props.createSubvariant!(local.cv.sourceVariantId, variantName, cloneCv(result.state));
      if (!variantId) throw new Error('The accepted CV subvariant could not be saved. Working documents were preserved.');
      nextRecord.variantId = variantId;
    }
    // The recorded decision does not grant document approval; review the saved result separately.
    const previousRecord = record.value, previousLetter = letter.value, previousParent = parentProposalId.value;
    const previousAcceptances = local.acceptances, previousImportedReviews = [...importedReviews.value];
    committingSelection = true;
    try {
      record.value = nextRecord; letter.value = nextLetter;
      local.acceptances = [...(local.acceptances || []), { key, proposalId: row.id, variantId, reviewId: decision.id, acceptedAt: new Date().toISOString() }];
      if (imported) importedReviews.value.push(decision);
      parentProposalId.value = imported ? null : row.id;
      reviewActive.value = false;
    } finally { committingSelection = false; }
    persist();
    if (saveError.value) {
      committingSelection = true;
      try {
        record.value = previousRecord; letter.value = previousLetter; parentProposalId.value = previousParent;
        local.acceptances = previousAcceptances; importedReviews.value = previousImportedReviews; reviewActive.value = true;
      } finally { committingSelection = false; }
      throw new Error(saveError.value);
    }
    notice.value = text('Selection accepted into this application. Excluded CV changes were recorded as rejected. Review and approve each document.', 'Auswahl in diese Bewerbung übernommen. Ausgeschlossene CV-Änderungen wurden als abgelehnt protokolliert. Jedes Dokument prüfen und freigeben.');
  });
}
async function requestImprovement() {
  await run(async () => {
    if (reviewActive.value) throw new Error('Accept or close the temporary review before requesting improvements.');
    if (!record.value || !feedback.value.trim()) return;
    await saveSetup();
    const safeFeedback = sanitizeRefinementText(feedback.value.trim(), record.value.state);
    const key = refinementSignature([safeFeedback, feedbackScope.value, parentProposalId.value]);
    if (pendingReview?.key !== key) pendingReview = { key, id: crypto.randomUUID() };
    await repository.saveReview(props.application.id, selectedProposal.value?.request_id || null, 'feedback', { text: safeFeedback, scope: feedbackScope.value }, pendingReview.id);
    reviews.value = mergeReviews(await repository.listReviews(props.application.id), importedReviews.value);
    feedback.value = ''; pendingReview = null;
    notice.value = text('Feedback saved. Sync Snapshot, then copy the updated task.', 'Feedback gespeichert. Sync Snapshot und die aktualisierte Aufgabe kopieren.');
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
    if (!reopen && kind === 'letter' && letterRevision.value === revision) letter.value = finalizeLetter(letter.value, context.value, record.value.state.contact);
    if (reopen && kind === 'letter') letter.value = { ...clone(letter.value), finalRevisionId: null };
    persist();
    if (!saveError.value && (reopen || (kind === 'cv' ? cvApproved.value : letterApproved.value))) notice.value = kind === 'cv'
      ? reopen ? text('CV reopened for editing.', 'CV zur Bearbeitung wieder geöffnet.') : text('CV approved.', 'CV freigegeben.')
      : reopen ? text('Letter reopened for editing.', 'Brief zur Bearbeitung wieder geöffnet.') : text('Letter approved.', 'Brief freigegeben.');
  });
}
function exportHistory(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
function exportRequest(id: string) { const row = requests.value.find(row => row.id === id); if (row) exportHistory(row.request_json, 'refinement-request-' + id + '.json'); }
function exportProposal(id: string) { const row = proposals.value.find(row => row.id === id); if (row) exportHistory(row.proposal_json, 'refinement-proposal-' + id + '.json'); }
async function getCvPdf() {
  if (showReviewPreview.value) throw new Error('Accept or close the temporary review before exporting.');
  if (!cvApproved.value || !preview.value) throw new Error(text('Approve the CV before export.', 'Den CV vor dem Export freigeben.'));
  const revision = cvRevision.value; const blob = await preview.value.getPdfBlob();
  if (disposed || revision !== cvRevision.value || !cvApproved.value) throw new Error('The CV changed during export. Preview again.');
  return blob;
}
async function getLetterPdf() {
  if (showReviewPreview.value) throw new Error('Accept or close the temporary review before exporting.');
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
    <WorkspaceDetailHeader class="application-header" :title="String(application.context_json.title || text('Application', 'Bewerbung'))" :subtitle="String(application.context_json.institution || application.context_json.university || '')" :back-label="text('All applications', 'Alle Bewerbungen')" :status="application.status" @back="emit('close')">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      <template #metadata><ApplicationIdentifier :application="application" :lang="lang" /><span>{{ text('Deadline', 'Bewerbungsfrist') }}: {{ formatOpportunityDeadline(application.context_json, lang) }}</span></template>
    </WorkspaceDetailHeader>
    <div class="workflow-body" :class="{ 'workflow-body--refinement': tab === 'refinement', 'workflow-body--review': tab === 'review' }">
      <section v-show="tab === 'preparation'" class="preparation-stage">
        <div class="preparation-grid">
          <section class="workflow-card"><h3>CV</h3>
            <label>{{ text('Saved CV', 'Gespeicherter CV') }}<select :value="selectedCvId" :disabled="busy" @change="selectCv(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ text('Choose a CV…', 'CV wählen…') }}</option><option v-if="record && !configurations.some(item => item.id === selectedCvId)" :value="selectedCvId" disabled>{{ record.baseName }} · {{ text('Saved application copy', 'Gespeicherte Bewerbungskopie') }}</option><option v-for="variant in configurations" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <p v-if="!configurations.length" class="app-hint hint">{{ text('Save a CV in CV Studio to select it here.', 'Einen CV im CV-Studio speichern, um ihn hier auszuwählen.') }}</p>
            <p class="app-hint hint">{{ text('Only an anonymized CV snapshot is stored in Supabase. Your original CV stays on this device.', 'In Supabase wird nur ein anonymisierter CV-Snapshot gespeichert. Der ursprüngliche Lebenslauf bleibt auf diesem Gerät.') }}</p>
          </section>
          <section class="workflow-card"><h3>{{ text('Letter', 'Brief') }}</h3>
            <label>{{ text('Letter template', 'Briefvorlage') }}<select :value="selectedTemplateId" :disabled="busy" @change="selectLetterTemplate(($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ letter && !missingLetterTemplate ? selectedTemplate.name + ' · ' + text('Saved revision', 'Gespeicherte Revision') + ' ' + selectedTemplate.revision : text('Choose a letter template…', 'Briefvorlage wählen…') }}</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
            <div v-if="letter" class="field-row">
              <label>{{ text('Language', 'Sprache') }}<select v-model="letter.language" :disabled="busy || reviewActive || letterApproved"><option value="en">English</option><option value="de">Deutsch</option></select></label>
              <label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="letter.maxWords" type="number" min="50" max="2000" :disabled="busy || reviewActive || letterApproved" /></label>
            </div>
            <p v-if="missingLetterTemplate" class="app-hint">{{ text('The original letter template is unavailable. Choose a template above to continue; your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. Zum Fortfahren oben eine Vorlage auswählen; der bestehende Brief bleibt erhalten.') }}</p>
          </section>
        </div>
        <details open class="disclosure-row"><summary>{{ text('Tender context & requirements', 'Ausschreibung & Anforderungen') }}</summary><slot name="preparation"><OpportunityContext :context="application.context_json" :lang="lang" :default-open-groups="['requirements', 'documents']" /></slot></details>
        <DesktopSidebarPortal v-if="$slots['preparation-actions']" area="minor" :active="active !== false && tab === 'preparation'">
          <div class="preparation-actions" :class="{ 'preparation-actions--sidebar': desktopSidebar }"><slot name="preparation-actions" /></div>
        </DesktopSidebarPortal>
      </section>
      <section v-show="tab === 'refinement'" class="refinement-stage">
        <DesktopSidebarPortal area="major" :active="active !== false && tab === 'refinement'">
        <div class="refinement-toolbar" :class="{ 'refinement-toolbar--sidebar': desktopSidebar }">
          <label>{{ text('Refinement scope', 'Umfang der Überarbeitung') }}<select v-model="feedbackScope" :disabled="busy"><option value="cv">CV</option><option value="letter">{{ text('Motivation letter', 'Motivationsschreiben') }}</option></select></label>
          <div class="action-row">
            <button class="primary" type="button" :disabled="busy || reviewActive || !preparedSource || !!saveError || publicationStatus === 'current' || (cvApproved && feedbackScope !== 'letter') || (letterApproved && feedbackScope !== 'cv')" @click="publishSources">{{ text('Sync Snapshot', 'Sync Snapshot') }}</button>
            <button type="button" :disabled="busy || publicationStatus !== 'current'" @click="copyTask">{{ text('Copy task', 'Aufgabe kopieren') }}</button>
            <button type="button" :disabled="busy || refreshing" @click="checkProposals">{{ refreshing ? text('Loading…', 'Laden…') : text('Load proposals', 'Vorschläge laden') }}</button>
            <div class="refinement-approval">
              <button v-if="pane === 'cv' && record" class="primary" type="button" :disabled="busy || reviewActive || !letter || !!saveError" @click="approve('cv', cvApproved)">{{ cvApproved ? text('Reopen CV', 'CV wieder öffnen') : text('Approve CV', 'CV freigeben') }}</button>
              <button v-if="pane === 'letter' && letter" class="primary" type="button" :disabled="busy || reviewActive || !record || !letterText.trim() || !!saveError || (unresolved.length > 0 && !letter.finalRevisionId)" @click="approve('letter', letterApproved || !!letter.finalRevisionId)">{{ letterApproved || letter.finalRevisionId ? text('Reopen letter', 'Brief wieder öffnen') : text('Approve letter', 'Brief freigeben') }}</button>
            </div>
          </div>
        </div>
        </DesktopSidebarPortal>
        <div class="refinement-controls">
          <p v-if="!record || !letter" class="app-hint">{{ text('Select both templates in Preparation to begin. Existing proposals remain available below.', 'Zum Start beide Vorlagen in Vorbereitung auswählen. Bestehende Vorschläge bleiben unten verfügbar.') }}</p>
          <p v-if="preparedSource && feedbackScope !== 'cv' && !preparedSource.request.letter.text.trim()" class="app-hint hint initial-letter-notice">{{ text('Initial letter draft: the source letter is empty. ChatGPT should create the first draft from the published CV, opportunity and template.', 'Erster Briefentwurf: Der Quellbrief ist leer. ChatGPT soll anhand des veröffentlichten CVs, der Ausschreibung und der Vorlage einen ersten Entwurf erstellen.') }}</p>
          <p v-if="sourceError" class="app-hint error" role="alert">{{ sourceError }}</p>
          <p class="app-hint hint">{{ text('Publish the sources, copy the task into ChatGPT, then load its proposals here.', 'Sync Snapshot, die Aufgabe in ChatGPT einfügen und die Vorschläge hier laden.') }}</p>
          <textarea v-if="shortInstructionNotice || shortInstructionError" :value="shortInstruction" readonly rows="5" :aria-label="text('Short ChatGPT instruction', 'Kurze ChatGPT-Anweisung')" @focus="($event.target as HTMLTextAreaElement).select()" />
          <RefinementHistory :requests="requests" :proposals="proposals" :local-requests="localRequests" :current-request-id="cloudState?.current_request_id || null" :active-id="selectedProposalId" :review-active="reviewActive" :accepted="proposalAlreadyApplied" :publication-status="publicationStatus" :open="historyOpen" :lang="lang" :busy="busy" @select="selectReviewProposal" @details="historyOpen = $event" @export-request="exportRequest" @export-proposal="exportProposal">
            <details class="disclosure-row"><summary>{{ text('Connection & prompt details', 'Verbindungs- & Promptdetails') }}</summary>
              <p class="app-hint hint">{{ text('ChatGPT needs Supabase SQL tools to read the published sources and save proposals.', 'ChatGPT benötigt Supabase-SQL-Werkzeuge, um veröffentlichte Quellen zu lesen und Vorschläge zu speichern.') }}</p>
              <button type="button" :disabled="busy || publicationStatus !== 'current'" @click="connectedPrompt">{{ text('Copy connected setup prompt', 'Einrichtungsprompt für die Verbindung kopieren') }}</button>
              <textarea v-if="prompt" :value="prompt" readonly rows="7" :aria-label="text('Refinement prompt', 'Überarbeitungs-Prompt')" />
            </details>
          </RefinementHistory>
          <section v-if="selectedProposal" class="workflow-card proposal-card"><h3>{{ text('Active proposal', 'Aktiver Vorschlag') }}</h3>
            <template v-if="selectedProposal">
              <p class="app-hint hint">{{ text('Proposal preview', 'Vorschau des Vorschlags') }} · {{ new Date(selectedProposal.created_at).toLocaleString() }}<br />{{ text('The published source stays unchanged when you view this proposal.', 'Die veröffentlichte Quelle bleibt beim Ansehen dieses Vorschlags unverändert.') }}</p>
              <p class="pre-wrap">{{ selectedProposal.proposal_json.summary }}</p>
              <RefinementChangeReview v-if="pane === 'cv'" :changes="proposalChanges" :selected="selectedChangeIds" :comments="proposalComments" :legacy="selectedProposal.proposal_json.schemaVersion === 1" :lang="lang" :disabled="busy || proposalAlreadyApplied" :locked="cvApproved" @toggle="toggleProposedChange" />
              <RefinementAnnotations :items="proposalAnnotations.filter(item => item.annotation.document === pane)" :lang="lang" :disabled="busy || !record" :save="saveAnnotation" :privacy-preview="previewOutgoingText" />
              <details v-if="pane === 'letter'" class="disclosure-row"><summary>{{ text('Proposed letter', 'Vorgeschlagener Brief') }}</summary><p class="pre-wrap">{{ selectedProposal.proposal_json.letterText }}</p></details>
              <label v-if="pane === 'letter' && selectedRequest?.request_json.scope !== 'cv'" class="selection-checkbox"><input type="checkbox" :checked="includeProposedLetter" :disabled="busy || letterApproved || proposalAlreadyApplied" @change="toggleProposedLetter(($event.target as HTMLInputElement).checked)" />{{ text('Include proposed letter', 'Vorgeschlagenen Brief einbeziehen') }}</label>
              <p v-if="temporaryReview.error || reviewAcceptanceError" class="app-hint error" role="alert">{{ temporaryReview.error || reviewAcceptanceError }}</p>
              <p v-if="reviewActive" role="status" class="app-hint warning">{{ proposalAlreadyApplied ? text('Accepted refinement. Close the comparison to review the saved working documents.', 'Angenommene Überarbeitung. Vergleich schließen, um die gespeicherten Arbeitsfassungen zu prüfen.') : text('Proposed refinement — not yet accepted. Close the preview to edit, approve or publish the saved working documents.', 'Vorgeschlagene Überarbeitung — noch nicht angenommen. Zum Bearbeiten, Freigeben oder Veröffentlichen der gespeicherten Arbeitsfassungen die Vorschau schließen.') }}</p>
              <p v-if="proposalDecision" class="app-hint hint">{{ text('Decision recorded', 'Entscheidung protokolliert') }} {{ new Date(proposalDecision.created_at).toLocaleString() }} · {{ text('Document approval is separate.', 'Die Dokumentfreigabe erfolgt separat.') }}</p>
              <div class="action-row"><button type="button" :disabled="busy" @click="openProposal">{{ text('Preview selected changes', 'Ausgewählte Änderungen ansehen') }}</button><button class="primary" type="button" :disabled="busy || !reviewActive || !!temporaryReview.error || !!reviewAcceptanceError || proposalAlreadyApplied" @click="acceptSelectedChanges">{{ text('Accept selection', 'Auswahl übernehmen') }}</button><button v-if="reviewActive" type="button" :disabled="busy" @click="discardReview">{{ text('Close temporary preview', 'Temporäre Vorschau schließen') }}</button></div>
            </template>
          </section>
          <details v-if="record && letter" class="disclosure-row"><summary>{{ text('Edit by Feedback Loop', 'Ändern durch Feedback Loop') }}</summary><p class="app-hint hint">{{ text('Feedback uses your saved working documents. Accept the selected proposal changes first to include them in the next round.', 'Feedback bezieht sich auf die gespeicherten Arbeitsfassungen. Ausgewählte Vorschlagsänderungen zuerst übernehmen, um sie in der nächsten Runde zu verwenden.') }}</p><label>{{ text('Required improvements', 'Gewünschte Verbesserungen') }}<textarea v-model="feedback" rows="3" maxlength="20000" :disabled="busy || (cvApproved && letterApproved)" /></label><details v-if="feedback.trim()" class="disclosure-row"><summary>{{ text('Outgoing feedback privacy preview', 'Datenschutzvorschau des ausgehenden Feedbacks') }}</summary><p class="app-hint hint">{{ text('Visible text will be shared. Highlighted placeholders are pseudonymized; their private originals are not shared.', 'Sichtbarer Text wird geteilt. Hervorgehobene Platzhalter sind pseudonymisiert; ihre privaten Originale werden nicht geteilt.') }}</p><PrivacyTextPreview :value="outgoingFeedback" :lang="lang" /></details><button type="button" :disabled="busy || reviewActive || !feedback.trim() || (cvApproved && letterApproved)" @click="requestImprovement">{{ text('Save feedback', 'Feedback speichern') }}</button><details v-if="feedbackHistory().length" class="disclosure-row"><summary>{{ text('Accumulated feedback', 'Gesammeltes Feedback') }} ({{ feedbackHistory().length }})</summary><p v-for="item in feedbackHistory()" :key="item.id" class="pre-wrap">{{ item.scope }} · {{ item.text }}</p></details></details>
          <details class="disclosure-row"><summary>{{ text('Edit manually', 'Manuell bearbeiten') }}</summary>

          <section v-if="record" v-show="pane === 'cv'" class="working-document"><div class="action-row"><span class="app-hint">{{ text('Application copy — template stays unchanged', 'Bewerbungskopie — Vorlage bleibt unverändert') }}</span></div><fieldset :disabled="cvApproved || busy || reviewActive"><FormBuilder :state="record.state" :read-version="() => null" :save-version="() => false" /></fieldset></section>
          <section v-if="letter" v-show="pane === 'letter'" class="working-document"><label>{{ text('Application writing instructions', 'Schreibhinweise für diese Bewerbung') }}<textarea v-model="letter.instructions" rows="3" maxlength="20000" :disabled="busy || reviewActive || letterApproved" /></label><label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<textarea :value="letterText" rows="18" :disabled="letterApproved || busy || reviewActive" @input="updateLetter(($event.target as HTMLTextAreaElement).value)" /></label><p :class="{ warning: words > setup.maxWords }">{{ words }} / {{ setup.maxWords }} {{ text('target words (complete letter)', 'Zielwörter (vollständiger Brief)') }}</p><p v-if="words > setup.maxWords" class="app-hint warning">{{ text('Over the target. Review the tender limit; approval and export remain available.', 'Über der Zielwortzahl. Vorgabe prüfen; Freigabe und Export bleiben möglich.') }}</p><p v-if="unresolved.length" class="app-hint warning">{{ text('Resolve placeholders:', 'Platzhalter auflösen:') }} {{ unresolved.join(', ') }}</p></section>
          </details>
        </div>
        <div class="refinement-preview">
          <div v-if="temporaryReview.error && (pane === 'cv' ? showCvReview : showLetterReview)" class="app-hint error" role="alert"><strong>{{ text('Proposal preview unavailable', 'Vorschlagsvorschau nicht verfügbar') }}</strong><p>{{ temporaryReview.error }}</p><p>{{ proposalPreviewReference }}</p></div>
          <DocumentCvPreview v-if="previewCvState" v-show="pane === 'cv'" ref="preview" :state="previewCvState" :active="tab === 'refinement' && feedbackScope === 'cv'" hide-actions :download-disabled="showReviewPreview">
            <RefinementPreviewStatus v-if="showCvReview" v-model="reviewComparison" :label="reviewPreviewLabel('cv')" :reference="proposalPreviewReference" :outdated="proposalSourceOutdated" :lang="lang" />
          </DocumentCvPreview>
          <MotivationLetterPreview v-if="previewLetterContent" v-show="pane === 'letter'" ref="letterPreview" :cv-state="previewLetterCvState" :content="previewLetterContent" :lang="previewLetterLanguage" :active="tab === 'refinement' && feedbackScope === 'letter'" hide-actions :download-disabled="!letterApproved || showReviewPreview">
            <RefinementPreviewStatus v-if="showLetterReview" v-model="reviewComparison" :label="reviewPreviewLabel('letter')" :reference="proposalPreviewReference" :outdated="proposalSourceOutdated" :lang="lang" />
          </MotivationLetterPreview>
        </div>
      </section>
      <ApplicationDocuments v-show="tab === 'review'" :client="client" :active="active !== false && tab === 'review'" mode="review" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state || null" :cv-ready="cvApproved" :export-ready="cvApproved && letterApproved" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterApproved" :letter-revision="letterRevision" @readiness="documentReadiness = $event">
        <OpportunityContext :context="application.context_json" :lang="lang" :only-groups="['documents']" checklist :completed-keys="application.completed_checklist_keys || []" :saving="checklistSaving" @toggle-checklist="(key, completed) => emit('toggleChecklist', key, completed)" />
      </ApplicationDocuments>
      <section v-show="tab === 'tracking'" class="tracking-stage">
        <slot name="tracking" />
      </section>
    </div>
    <DesktopSidebarPortal area="subtabs" :active="active !== false">
    <footer class="workflow-navigation" :class="{ 'workflow-navigation--sidebar': desktopSidebar }">
      <button class="workflow-back" type="button" @click="emit('close')"><span aria-hidden="true">←</span>{{ text('All applications', 'Alle Bewerbungen') }}</button>
      <nav class="workspace-subtabs" :aria-label="text('Application stages', 'Bewerbungsphasen')">
        <button v-for="(stage, index) in stages" :key="stage" type="button" :class="{ 'is-active': tab === stage }" :aria-pressed="tab === stage" @click="tab = stage"><span class="stage-number">{{ index + 1 }}</span>{{ ({ preparation: text('Preparation', 'Vorbereitung'), refinement: text('Refinement', 'Überarbeitung'), review: text('PDF review', 'PDF-Prüfung'), tracking: text('Tracking', 'Verlauf') })[stage] }}</button>
      </nav>
    </footer>
    </DesktopSidebarPortal>
  </section>
</template>

<style scoped>
.selection-checkbox{display:flex;align-items:center;gap:9px}.selection-checkbox input{width:18px;height:18px;accent-color:#67c8a6}.preview-review-label{font-size:12px;color:#efcc87;margin:0}.application-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;color:#d1fae5;font-family:var(--font-ui,system-ui)}
.workflow-navigation{display:contents}.workflow-back{display:none}
.workspace-subtabs{display:flex;gap:6px;flex:1;min-width:0}
.workspace-subtabs button{display:flex;align-items:center;gap:8px;flex:1;text-align:left}.workspace-subtabs .is-active{background:#185b4c;border-color:#67c8a6}.stage-number{opacity:.7;font-size:12px}
.workflow-body{flex:1;min-height:0;min-width:0;overflow:auto;padding:14px 0 0 0}.workflow-body--refinement,.workflow-body--review{display:flex;flex-direction:column;overflow:hidden}
.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){flex:1 0 auto;min-height:360px}
.preparation-actions{display:flex;justify-content:flex-end;padding:20px 0;border-top:1px solid #61343a}
.refinement-toolbar{position:sticky;top:0;z-index:10;min-width:0;padding-bottom:12px;border-bottom:1px solid #28534e;background:#0b0f14}
.refinement-toolbar > .action-row{margin:0}
@media(max-width:760px){.refinement-toolbar{top:-8px;margin-top:-8px;padding-top:8px;flex-shrink:0}}
@media(min-width:761px) and (max-width:1180px){.workflow-body--review :deep(.application-documents){min-height:640px}}
@media(min-width:761px){.application-workspace{margin-bottom:40px;padding:32px;}.workflow-body{padding:20px 0 0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}.application-header :deep(.workspace-detail-header__back){display:none}.workflow-navigation{position:fixed;inset-inline:0;bottom:0;z-index:30;display:flex;align-items:center;gap:20px;min-height:66px;padding:12px max(20px,calc((100vw - 1484px)/2));border-top:1px solid #24504e;background:#06141f;box-shadow:0 -6px 20px #0003}.workflow-back{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}.workspace-subtabs button{justify-content:center}.preparation-stage{padding-bottom:6px}}
.preparation-stage,.tracking-stage{display:grid;gap:20px}.stage-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:18px}.stage-heading h2,.tracking-stage h2{color:#9be8c7;font-size:21px;margin:0 0 8px}.stage-heading p,p.hint{font-size:13px;color:#a6c1b9;line-height:1.6}.stage-heading button{flex-shrink:0}
h3{font-size:16px;margin:0 0 14px}p{line-height:1.6;font-size:13px}button,input,select,textarea{font:inherit;color:inherit;border:1px solid #28534e;background:#0b1b25;border-radius:7px;padding:9px 11px;box-sizing:border-box}button{cursor:pointer;font-size:13px}button:disabled{opacity:.45;cursor:default}button:hover:enabled{background:#185b4c}.primary{background:#185b4c;border-color:#67c8a6}label{display:grid;gap:7px;font-size:12px;font-weight:600;margin-bottom:12px}input,select,textarea{width:100%;min-width:0;font-size:14px;font-weight:400}textarea{resize:vertical;line-height:1.6}select{max-width:100%}pre{font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere}.pre-wrap{white-space:pre-wrap;overflow-wrap:anywhere}.preparation-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.workflow-card{border:1px solid #28534e;border-radius:10px;padding:18px;background:#091923}.workflow-card p{margin:10px 0}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.action-row span{font-size:12px;color:#a6c1b9}.error{color:#fecaca}.warning{color:#efcc87;font-size:13px}.refinement-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,30%);gap:24px;flex:1;min-height:0;overflow:hidden}.refinement-controls{overflow:auto;min-height:0;padding-right:8px}.refinement-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:1;min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block}.working-document{margin-bottom:24px}.working-document fieldset{border:0;padding:0;min-width:0}.working-document :deep(.builder){height:auto;overflow:visible}.working-document :deep(.content-panel),.working-document :deep(.content-panel__scroll-body){height:auto;overflow:visible;overscroll-behavior:auto;flex:0 0 auto}.refinement-approval{margin-left: auto}.cv-change{display:grid;gap:7px;margin:16px 0;font-size:13px;white-space:pre-wrap}.cv-change del{background:#3a1720;padding:9px;text-decoration:none;color:#fecaca}.cv-change ins{background:#10382c;padding:9px;text-decoration:none;color:#a7f3d0}.review-heading{flex:0 0 auto}.review-heading .stage-heading{margin-bottom:10px}.review-heading details{max-height:25vh;overflow:auto;margin-bottom:10px}.preparation-stage :deep(.opportunity-context){overflow:visible}
@media(max-width:900px){.preparation-grid{grid-template-columns:1fr;gap:0}.refinement-stage{grid-template-columns:minmax(0,1fr) minmax(270px,38%);gap:12px}.stage-heading{flex-direction:column}}
@media(max-width:760px){.application-workspace{--mobile-application-tabs-height:48px;padding-bottom:var(--mobile-application-tabs-height)}.workspace-subtabs{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;height:48px;margin:0;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;background:#06141f;border-top:1px solid #24504e}.workspace-subtabs button{font-size:12px;white-space:nowrap;padding:7px;gap:4px}.stage-number{display:none}.workflow-body{padding:8px}.workflow-body--refinement{overflow:auto}.refinement-stage{display:flex;flex-direction:column;gap:10px;overflow:visible;flex:0 0 auto}.refinement-controls{flex:0 0 auto;overflow:visible}.refinement-preview{flex:0 0 auto}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:0 0 auto}.refinement-preview :deep(.document-inline-preview){min-height:0}.refinement-preview :deep(.document-inline-preview__viewport){display:block;max-height:60vh}.stage-heading{gap:10px}.stage-heading h2{font-size:20px}.workflow-card{padding:14px}.workflow-body input,.workflow-body textarea,.workflow-body select{font-size:16px}.workflow-body p{font-size:15px}.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){min-height:430px;flex:1 0 auto}.review-heading details{max-height:180px}.tracking-stage{gap:12px}}
@media(min-width:761px){.refinement-stage{grid-template-rows:auto minmax(0,1fr);row-gap:12px}.refinement-toolbar{grid-column:1;grid-row:1;margin-right:8px}.refinement-controls{grid-column:1;grid-row:2}.refinement-preview{grid-column:2;grid-row:1 / 3}}
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
.refinement-toolbar--sidebar .refinement-approval{margin:0}
</style>
