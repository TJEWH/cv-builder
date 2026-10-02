<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import { supabaseConfiguration } from '../lib/supabase';
import type { CvState, SavedConfiguration } from '../types';
import type { MotivationLetterDraft } from '../draftingTypes';
import type { ApplicationLetter, LetterTemplate } from '../letterTypes';
import type { ApprovedPrivacyContexts, PrivacyContextType, AnnotationStatus, AnnotationReference, LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementScope, RefinementState } from '../refinementTypes';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv, type ApplicationCvRecord } from '../composables/applicationCv';
import { createCloudCvSnapshot } from '../composables/cloudCvPrivacy';
import { rootVariantId, subvariantParent } from '../composables/careerVariants';
import { addIncomingDraft, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizeLetter, letterContextVersion, letterFromEditableText, openLetterRevision, parseIncomingLetter, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import { applyRefinementProposal, buildRefinementPrompt, createRefinementRepository, describeCvOperation, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText } from '../composables/applicationRefinement';
import { opensInTracking } from '../composables/applicationTracking';
import { buildOpportunityGroups, checklistKeys } from '../composables/opportunityContext';
import FormBuilder from './FormBuilder.vue';
import DocumentCvPreview from './DocumentCvPreview.vue';
import MotivationLetterPreview from './MotivationLetterPreview.vue';
import MotivationLetterEditor from './MotivationLetterEditor.vue';
import CvAdjustmentWorkflow from './CvAdjustmentWorkflow.vue';
import RefinementHistory from './RefinementHistory.vue';
import LegacyRefinementHistory from './LegacyRefinementHistory.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import OpportunityContext from './OpportunityContext.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import { buildShortRefinementInstruction } from '../composables/applicationReference';
import { resolveRefinementSettings, serializeRefinementDraft, sameRefinementInputs } from '../composables/refinementSources';
import PrivacyTextPreview from './PrivacyTextPreview.vue';
import { privacyContextTargets, preparePrivacyLegend } from '../composables/refinementPrivacy';
import RefinementSourceOverview from './RefinementSourceOverview.vue';
import RefinementChangeReview from './RefinementChangeReview.vue';
import RefinementAnnotations from './RefinementAnnotations.vue';
import RefinementPreviewStatus from './RefinementPreviewStatus.vue';
import { annotationViews, annotationReferenceChanged, annotationFeedback } from '../composables/refinementAnnotations';

const props = defineProps<{
  projectId?: string; active?: boolean;
  application: Application; client: SupabaseClient | null; userId: string; lang: string;
  configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null;
  publishCv: (state: CvState) => Promise<Application | null>;
  createSubvariant?: (sourceId: string, name: string, state: CvState) => string | null;
}>();
const emit = defineEmits<{ close: []; 'edit-variant': [id: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const storageKey = 'CV_REFINEMENT:1:' + encodeURIComponent(props.userId) + ':' + props.application.id;
const navigationKey = 'CV_APPLICATION_TAB:' + props.userId + ':' + props.application.id;
const stages = ['preparation', 'refinement', 'review', 'tracking'] as const;
type Stage = typeof stages[number];
const tab = ref<Stage>('preparation');
const pane = ref<'cv' | 'letter'>('cv');
const record = ref<ApplicationCvRecord | null>(null);
const letter = ref<ApplicationLetter | null>(null);
const templates = ref<LetterTemplate[]>([]);
const pendingBaseId = ref('');
const pendingSubId = ref('');
const pendingTemplateId = ref('research');
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
const manualProposalText = ref('');
const selectedProposalId = ref('');
// Review selections are transient: neither previewing nor toggling writes working documents.
const selectedChangeIds = ref<string[]>([]);
const includeProposedLetter = ref(true);
const reviewActive = ref(false);
const reviewComparison = ref<'original' | 'proposed'>('proposed');
const feedback = ref('');
const feedbackScope = ref<RefinementScope>('both');
let scopeWasChosen = false;
const shortInstruction = computed(() => buildShortRefinementInstruction(props.application, feedbackScope.value));
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
const manualLetterText = ref('');
const proposalInput = ref<HTMLInputElement | null>(null);
const letterBackupInput = ref<HTMLInputElement | null>(null);
let proposalFileSequence = 0;
watch(manualProposalText, () => { proposalFileSequence++; }, { flush: 'sync' });
const preview = ref<InstanceType<typeof DocumentCvPreview> | null>(null);
const letterPreview = ref<InstanceType<typeof MotivationLetterPreview> | null>(null);
const backupInput = ref<HTMLInputElement | null>(null);
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
  pendingTemplateId.value = letter.value
    ? templates.value.find(item => item.id === letter.value?.templateId)?.id || ''
    : templates.value[0]?.id || '';
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
    if (['cv', 'letter', 'both'].includes(value.scope)) { feedbackScope.value = value.scope; scopeWasChosen = true; }
  }
  const previous = sessionStorage.getItem(navigationKey);
  const mapped = ({ overview: 'preparation', cv: 'refinement', letter: 'refinement', documents: 'review' } as Record<string, Stage>)[previous || ''] || previous;
  if (stages.includes(mapped as Stage)) tab.value = mapped as Stage;
  if (previous === 'letter') pane.value = 'letter';
} catch (cause) {
  localReadError = text('Saved application data could not be read. Restore an application backup before saving: ', 'Gespeicherte Bewerbungsdaten konnten nicht gelesen werden. Vor dem Speichern eine Bewerbungssicherung wiederherstellen: ') + String(cause);
  saveError.value = localReadError;
}
const roots = computed(() => props.configurations.filter(item => !item.parentId));
watch(() => props.application.status, status => {
  if (opensInTracking(status)) tab.value = 'tracking';
}, { immediate: true });
const subvariants = computed(() => props.configurations.filter(item => item.parentId === pendingBaseId.value));
if (record.value) {
  pendingBaseId.value = rootVariantId(record.value.variantId || record.value.baseId, props.configurations);
  pendingSubId.value = record.value.variantId !== pendingBaseId.value ? record.value.variantId || '' : '';
}
const selectedTemplate = computed(() => letter.value?.templateSnapshot || templates.value.find(item => item.id === letter.value?.templateId) || DEFAULT_LETTER_TEMPLATES[0]!);
const missingLetterTemplate = computed(() => !!letter.value && !letter.value.templateSnapshot);
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
const privacySnapshot = computed(() => record.value ? createCloudCvSnapshot(record.value.state) : null);
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
function approvePrivacyContext(sourceKey: string, type: PrivacyContextType, description: string) {
  error.value = '';
  try {
    const local = preparedSource.value;
    if (!local || !record.value || !privacyContextTargets(local.cv, refinementSignature).some(target => target.sourceKey === sourceKey)) throw new Error('The masked source changed. Review its privacy preview again.');
    const next = { ...privacyContexts.value, [sourceKey]: { type, description: description.trim() } };
    preparePrivacyLegend(local.cv, next, refinementSignature, value => sanitizeRefinementText(value, record.value!.state));
    privacyContexts.value = next;
  } catch (cause) { report(cause); }
}
function removePrivacyContext(sourceKey: string) {
  const next = { ...privacyContexts.value }; delete next[sourceKey]; privacyContexts.value = next;
}
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
  pane.value = selectedRequest.value?.request_json.scope === 'letter' ? 'letter' : 'cv';
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
    included: reviews.value.some(row => row.kind === 'feedback' && (row.payload.annotation as AnnotationReference | undefined)?.proposalId === view.proposalId && (row.payload.annotation as AnnotationReference).annotationId === a.id && (row.payload.annotation as AnnotationReference).reviewId === view.reviewId),
  };
}));
// Leaving review returns to saved documents; returning must not reopen a dismissed proposal.
watch(tab, value => { if (value !== 'refinement') reviewActive.value = false; });
const requirementContext = computed(() => Object.fromEntries(Object.entries(props.application.context_json).filter(([key]) => ['requirements', 'required_documents', 'application_documents', 'documents', 'submission_documents', 'eligibility'].includes(key))));
const uncheckedRequirements = computed(() => buildOpportunityGroups(props.application.context_json, props.lang).filter(group => ['requirements', 'documents'].includes(group.id)).flatMap(group => checklistKeys(group.items)).filter(key => !props.application.completed_checklist_keys?.includes(key)).length);
const allowedScope = computed<RefinementScope>(() => cvApproved.value ? 'letter' : letterApproved.value ? 'cv' : 'both');
watch(allowedScope, scope => { if (cvApproved.value && feedbackScope.value !== 'letter' || letterApproved.value && feedbackScope.value !== 'cv') feedbackScope.value = scope; }, { immediate: true });
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
    cloudState.value = state; requests.value = nextRequests; proposals.value = combinedProposals; reviews.value = [...nextReviews, ...importedReviews.value];
    if (state && initialSignature === baselineSignature.value) approvals.value = clone(state.approvals_json);
    if (!scopeWasChosen && currentPublishedRequest.value) {
      const scope = currentPublishedRequest.value.request_json.scope;
      if ((!cvApproved.value || scope === 'letter') && (!letterApproved.value || scope === 'cv')) feedbackScope.value = scope;
    }
    cloudLoaded.value = true;
    if (!selectedProposalId.value || !combinedProposals.some(item => item.id === selectedProposalId.value)) selectedProposalId.value = combinedProposals.find(item => item.request_id === state?.current_request_id)?.id || '';
  })();
  try { await loadingCloud; }
  finally { loadingCloud = null; refreshing.value = false; }
}
function enterRefinement(scope: RefinementScope = 'both') {
  if (busy.value) return;
  feedbackScope.value = cvApproved.value ? 'letter' : letterApproved.value ? 'cv' : scope;
  pane.value = feedbackScope.value === 'letter' ? 'letter' : 'cv';
  tab.value = 'refinement';
}
function selectReviewProposal(id: string) {
  if (busy.value || !proposals.value.some(row => row.id === id)) return;
  proposalFileSequence++;
  tab.value = 'refinement'; selectedProposalId.value = id; openProposal();
}
async function importProposalFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || busy.value) return;
  const sequence = ++proposalFileSequence, source = currentPublishedRequest.value?.id;
  try {
    if (file.size > 2 * 1048576) throw new Error('The refinement proposal is too large.');
    const raw = await file.text();
    if (disposed || sequence !== proposalFileSequence || source !== currentPublishedRequest.value?.id) return;
    manualProposalText.value = raw; importProposal();
  } catch (cause) { if (!disposed && sequence === proposalFileSequence) report(cause); }
}
async function checkProposals() { tab.value = 'refinement'; await run(async () => { await refreshCloud(); notice.value = proposals.value.length ? text('Proposals loaded. Review one before applying it.', 'Vorschläge geladen. Vor dem Übernehmen prüfen.') : text('No proposal yet. Run the copied prompt in ChatGPT, then check again.', 'Noch kein Vorschlag. Kopierten Prompt in ChatGPT ausführen und erneut prüfen.'); }); }
function importProposal() {
  if (busy.value) return;
  proposalFileSequence++;
  try {
    error.value = '';
    if (manualProposalText.value.length > 2 * 1048576) throw new Error('The refinement proposal is too large.');
    const raw = JSON.parse(manualProposalText.value);
    const payload = raw?.proposal_json || raw;
    const request = requests.value.find(item => item.id === payload?.requestId);
    if (!request || request.application_id !== props.application.id || request.user_id !== props.userId) throw new Error('Import a proposal for a published request belonging to this application.');
    if (raw?.proposal_json && (raw.application_id !== props.application.id || raw.user_id !== props.userId || raw.request_id !== request.id)) throw new Error('The imported proposal references do not match this application and request.');
    const proposal = parseRefinementProposal(payload, request.request_json);
    let row = proposals.value.find(item => refinementSignature(item.proposal_json) === refinementSignature(proposal));
    if (!row) {
      row = { id: crypto.randomUUID(), application_id: props.application.id, user_id: props.userId, request_id: request.id, proposal_json: proposal, created_at: new Date().toISOString() };
      importedProposals.value.unshift(row); proposals.value.unshift(row); persist();
    }
    tab.value = 'refinement'; selectedProposalId.value = row.id;
    openProposal(); manualProposalText.value = '';
  } catch (cause) { report(cause); }
}
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
  if (missingLetterTemplate.value) throw new Error(text('The original letter template is unavailable. Choose a template in Preparation and click “Use letter template”. Your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. In Vorbereitung eine Vorlage auswählen und „Briefvorlage verwenden“ anklicken. Der bestehende Brief bleibt erhalten.'));
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
async function savePreparation() { await run(async () => { await saveSetup(); notice.value = text('Preparation saved to Supabase. Your private documents stay on this device.', 'Vorbereitung in Supabase gespeichert. Private Dokumente bleiben auf diesem Gerät.'); }); }
function assignBase() {
  const id = pendingSubId.value || pendingBaseId.value;
  const variant = props.configurations.find(item => item.id === id); const state = variant && props.readVersion(id);
  if (!variant || !state) return;
  record.value = createApplicationCv(props.userId, props.application.id, id, variant.name, state);
  record.value.variantId = id; record.value.detached = true;
  approvals.value = { cv: null, letter: null }; persist();
  void run(async () => { await publishCurrentCv(); if (letter.value) await saveSetup(); notice.value = text('Independent CV snapshot saved for this application.', 'Unabhängiger CV-Snapshot für diese Bewerbung gespeichert.'); });
}
async function useLetterTemplate() {
  const template = templates.value.find(item => item.id === pendingTemplateId.value);
  if (!template) return;
  if (letter.value) letter.value = selectApplicationLetterTemplate(letter.value, template);
  else letter.value = createApplicationLetter(props.userId, props.application.id, template, context.value, template.language);
  approvals.value.letter = null; persist();
  if (record.value) await savePreparation();
}
function updateLetter(value: string) { if (letter.value) letter.value = editLetter(letter.value, letterFromEditableText(value)); }
function feedbackHistory(): RefinementFeedback[] {
  return reviews.value.filter(item => item.kind === 'feedback').map(item => ({ id: item.id, text: String(item.payload.text), scope: item.payload.scope as RefinementScope, createdAt: item.created_at, ...(item.payload.annotation ? { annotation: clone(item.payload.annotation) as AnnotationReference } : {}) }));
}
async function saveAnnotation(id: string, status: AnnotationStatus, response: string, previousReviewId: string | null): Promise<boolean> {
  let saved = false;
  await run(async () => {
    const view = proposalAnnotations.value.find(item => item.annotation.id === id);
    if (!view || !record.value) throw new Error('Restore the local CV before saving an anonymized response.');
    const safeResponse = response.trim() ? sanitizeRefinementText(response.trim(), record.value.state) : null;
    const row = await repository.saveReview(props.application.id, view.requestId, 'annotation', { proposalId: view.proposalId, annotationId: id, status, response: safeResponse, previousReviewId });
    if (disposed) return;
    if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
    saved = true; notice.value = text('Annotation saved. Both documents are unchanged.', 'Anmerkung gespeichert. Beide Dokumente bleiben unverändert.');
  });
  return saved;
}
async function includeAnnotationFeedback(id: string) {
  await run(async () => {
    const view = proposalAnnotations.value.find(item => item.annotation.id === id);
    if (!view || !record.value || view.included || view.status !== 'open' && !view.response) return;
    const safeText = sanitizeRefinementText(annotationFeedback(view), record.value.state);
    const row = await repository.saveReview(props.application.id, view.requestId, 'feedback', { text: safeText, scope: view.annotation.document,
      annotation: { proposalId: view.proposalId, annotationId: id, reviewId: view.reviewId } });
    if (disposed) return;
    if (!reviews.value.some(item => item.id === row.id)) reviews.value.push(row);
    notice.value = text('Annotation included in accumulated feedback. Publish the next round when ready.', 'Anmerkung zum gesammelten Feedback hinzugefügt. Die nächste Runde kann nun veröffentlicht werden.');
  });
}
async function copyPrompt() {
  try { await navigator.clipboard.writeText(prompt.value); notice.value = text('Prompt copied. Paste it into your connected ChatGPT conversation.', 'Prompt kopiert. In die verbundene ChatGPT-Unterhaltung einfügen.'); }
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
function promptForRequest(request: RefinementRequestRow) {
  const projectId = props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0]! : '');
  if (!projectId) throw new Error('The Supabase project configuration is unavailable.');
  prompt.value = buildRefinementPrompt(request.request_json, projectId);
}
async function createRound(scope: RefinementScope, copy: 'prompt' | 'task' = 'prompt') {
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
    promptForRequest(current); await (copy === 'task' ? copyShortInstruction() : copyPrompt());
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
  promptForRequest(saved); await (copy === 'task' ? copyShortInstruction() : copyPrompt());
}
async function initialPrompt() { await run(async () => { await createRound(feedbackScope.value); }); }
async function initialTask() { await run(async () => { await createRound(feedbackScope.value, 'task'); }); }
function checkedProposalResult() {
  if (!record.value || !letter.value || !selectedProposal.value) throw new Error('Select a proposal and restore its local source documents first.');
  if (saveError.value) throw new Error(saveError.value);
  const row = selectedProposal.value;
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
    error.value = ''; reviewComparison.value = 'proposed'; reviewActive.value = true;
    if (temporaryReview.value.error) throw new Error(temporaryReview.value.error);
    notice.value = text('Temporary review only. Saved documents and approvals remain unchanged until you accept the selection.', 'Nur temporäre Prüfung. Gespeicherte Dokumente und Freigaben bleiben bis zur Übernahme unverändert.');
  } catch (cause) { report(cause); }
}
function toggleProposedChange(id: string, included: boolean) {
  if (busy.value || cvApproved.value || proposalAlreadyApplied.value) return;
  if (!proposalChanges.value.some(change => change.id === id)) return;
  selectedChangeIds.value = included ? [...new Set([...selectedChangeIds.value, id])] : selectedChangeIds.value.filter(value => value !== id);
  reviewComparison.value = 'proposed'; reviewActive.value = true; pane.value = 'cv';
}
function toggleProposedLetter(included: boolean) {
  if (busy.value || letterApproved.value || proposalAlreadyApplied.value) return;
  includeProposedLetter.value = included; reviewComparison.value = 'proposed'; reviewActive.value = true; pane.value = 'letter';
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
    reviews.value = await repository.listReviews(props.application.id);
    feedback.value = ''; pendingReview = null;
    await createRound(feedbackScope.value);
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
  });
}
function reopenLocalLetterRevision(id: string) {
  try {
    if (!letter.value || busy.value) return;
    error.value = '';
    if (reviewActive.value || letterApproved.value || letter.value.finalRevisionId) throw new Error('Close the proposal and reopen the finalized letter before restoring a working draft.');
    letter.value = openLetterRevision(letter.value, id); approvals.value.letter = null;
    pane.value = 'letter'; tab.value = 'refinement';
  } catch (cause) { report(cause); }
}
function keepIncomingLetter(draft?: MotivationLetterDraft) {
  try {
    if (!letter.value || busy.value) return;
    error.value = '';
    if (draft && (draft.application_id !== props.application.id || draft.user_id !== props.userId)) throw new Error('The draft belongs to another application or account.');
    const content = parseIncomingLetter(draft ? draft.body : manualLetterText.value);
    // Historical context is never inferred from today's settings. The draft is only archived here.
    const sourceContext = draft ? letter.value.publishedContexts[draft.context_id] || { content: 'unknown', theme: 'unknown' } : { content: 'unknown', theme: 'unknown' };
    letter.value = addIncomingDraft(letter.value, content, sourceContext, draft ? { cloudDraftId: draft.id, cloudContextId: draft.context_id } : {});
    manualLetterText.value = ''; historyOpen.value = true;
    notice.value = text('Incoming draft saved in local history. Working and finalized text are unchanged.', 'Eingehender Entwurf im lokalen Verlauf gespeichert. Arbeitsfassung und finalisierter Text sind unverändert.');
  } catch (cause) { report(cause); }
}
function exportHistory(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
function exportRequest(id: string) { const row = requests.value.find(row => row.id === id); if (row) exportHistory(row.request_json, 'refinement-request-' + id + '.json'); }
function exportProposal(id: string) { const row = proposals.value.find(row => row.id === id); if (row) exportHistory(row.proposal_json, 'refinement-proposal-' + id + '.json'); }
async function importLetterBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file) return;
  await run(async () => {
    if (reviewActive.value || letterApproved.value || letter.value?.finalRevisionId) throw new Error('Close the proposal and reopen the finalized letter before restoring a backup.');
    if (file.size > 30 * 1048576) throw new Error('The letter backup is too large.');
    const signature = baselineSignature.value, raw = await file.text();
    if (disposed || signature !== baselineSignature.value || reviewActive.value || letterApproved.value || letter.value?.finalRevisionId) throw new Error('Documents changed while reading the backup. Try again.');
    const restored = createLetterRepository({ getItem: () => null, setItem() {} }, props.userId).importLetter(raw, props.application.id);
    letter.value = restored; approvals.value.letter = null; persist();
  });
}
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
async function downloadLetter() { await run(async () => downloadBlob(await getLetterPdf(), 'motivation-letter.pdf')); }
function downloadBackup() {
  persist();
  downloadBlob(new Blob([JSON.stringify({ kind: 'application-refinement-backup', version: 1, privacyContexts: privacyContexts.value, record: record.value, letter: letter.value, requests: localRequests.value, parentProposalId: parentProposalId.value, importedProposals: importedProposals.value, importedReviews: importedReviews.value }, null, 2)], { type: 'application/json' }), 'application-' + props.application.id + '.json');
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  await run(async () => {
    if (file.size > 30 * 1024 * 1024) throw new Error('Application backup is too large.');
    const signature = baselineSignature.value; const data = JSON.parse(await file.text());
    if (disposed || signature !== baselineSignature.value) throw new Error('Documents changed while reading the backup. Try again.');
    if (!['application-cv-backup', 'application-refinement-backup'].includes(data.kind) || !data.record) throw new Error('Choose an application backup.');
    const raw = JSON.stringify({ ...data.record, userId: props.userId, applicationId: props.application.id });
    const restored = loadApplicationCv(props.userId, props.application.id, { getItem: () => raw, setItem() {}, removeItem() {} });
    if (!restored) throw new Error('The backup is empty.');
    restored.detached = true; restored.publishedSnapshotId = null; restored.publishedState = null;
    const checkedLetter = data.letter ? createLetterRepository({ getItem: () => null, setItem() {} }, props.userId).importLetter(JSON.stringify({ ...data.letter, userId: props.userId, applicationId: props.application.id }), props.application.id) : localReadError ? letterRepository.load(props.application.id) : null;
    // Preserve exact private request snapshots only when restoring their own application.
    const restoredRequests: Record<string, LocalRefinementRequest> = {};
    let incompleteSources = 0;
    if (data.record.applicationId === props.application.id && data.requests && typeof data.requests === 'object' && !Array.isArray(data.requests)) {
      for (const [id, value] of Object.entries(data.requests)) {
        const local = value as LocalRefinementRequest;
        if (!local?.request || local.request.requestId !== id || local.request.applicationId !== props.application.id) throw new Error('A backup request belongs to another application.');
        const validationProposal = parseRefinementProposal({ schemaVersion: local.request.schemaVersion, requestId: id, summary: 'Validate restored source', letterText: local.request.scope === 'cv' ? local.request.letter.text : local.request.letter.text || 'Source validation',
          ...(local.request.schemaVersion === 2 ? { cvOperations: [], cvComments: [] } : { cvEdits: [] }) }, local.request);
        if (!local.cv || typeof local.cv !== 'object') { incompleteSources++; continue; }
        try { reconstructRefinementProposal(local, validationProposal, [], props.application.id); }
        catch { incompleteSources++; } // Older backups still restore documents; incomplete proposals remain blocked.
        restoredRequests[id] = clone(local);
      }
    }
    const restoredProposals: RefinementProposalRow[] = (data.importedProposals || []).map((row: RefinementProposalRow) => {
      const source = restoredRequests[row.request_id];
      if (!source || row.application_id !== props.application.id || row.user_id !== props.userId) throw new Error('An imported proposal in the backup has no matching local request.');
      return { ...clone(row), proposal_json: parseRefinementProposal(row.proposal_json, source.request) };
    });
    localReadError = '';
    committingSelection = true;
    try {
      record.value = restored;
      if (checkedLetter) letter.value = checkedLetter;
      approvals.value = { cv: null, letter: null }; localRequests.value = restoredRequests;
      privacyContexts.value = data.record.applicationId === props.application.id ? data.privacyContexts || {} : {};
      importedProposals.value = restoredProposals; importedReviews.value = [];
      parentProposalId.value = null; reviewActive.value = false;
    } finally { committingSelection = false; }
    persist();
    notice.value = text('Application restored. Review and save preparation before continuing.', 'Bewerbung wiederhergestellt. Vorbereitung prüfen und speichern.');
    if (incompleteSources) notice.value += text(' Some older proposal sources are incomplete; restore their original mappings or publish a new round.', ' Einige ältere Vorschlagsquellen sind unvollständig; ursprüngliche Zuordnungen wiederherstellen oder eine neue Runde veröffentlichen.');
  });
}
</script>

<template>
  <section class="application-workspace">
    <WorkspaceDetailHeader :title="String(application.context_json.title || text('Application', 'Bewerbung'))" :subtitle="String(application.context_json.institution || application.context_json.university || '')" :back-label="text('All applications', 'Alle Bewerbungen')" :status="application.status" @back="emit('close')">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      <template v-if="$slots['secondary-actions']" #secondary-actions><slot name="secondary-actions" /></template>
      <template #metadata><ApplicationIdentifier :application="application" :lang="lang" /><span>{{ cvApproved ? text('CV approved', 'CV freigegeben') : text('CV in preparation', 'CV in Vorbereitung') }}</span><span>{{ letterApproved ? text('Letter approved', 'Brief freigegeben') : text('Letter in preparation', 'Brief in Vorbereitung') }}</span></template>
    </WorkspaceDetailHeader>
    <nav class="workspace-subtabs" :aria-label="text('Application stages', 'Bewerbungsphasen')">
      <button v-for="(stage, index) in stages" :key="stage" type="button" :class="{ 'is-active': tab === stage }" :aria-pressed="tab === stage" @click="tab = stage"><span class="stage-number">{{ index + 1 }}</span>{{ ({ preparation: text('Preparation', 'Vorbereitung'), refinement: text('Refinement', 'Überarbeitung'), review: text('PDF review', 'PDF-Prüfung'), tracking: text('Tracking', 'Verlauf') })[stage] }}</button>
    </nav>
    <p v-if="error" class="message error" role="alert">{{ error }}</p><p v-if="saveError" class="message error" role="alert">{{ saveError }} <button type="button" @click="persist">{{ text('Retry save', 'Erneut speichern') }}</button></p><p v-if="notice" class="message" role="status">{{ notice }}</p>
    <div class="workflow-body" :class="{ 'workflow-body--refinement': tab === 'refinement', 'workflow-body--review': tab === 'review' }">
      <section v-show="tab === 'preparation'" class="preparation-stage">
        <div class="stage-heading"><div><h2>{{ text('Prepare your application', 'Bewerbung vorbereiten') }}</h2><p>{{ text('Choose templates and attach supporting documents. Each application keeps its own copies.', 'Vorlagen auswählen und zusätzliche Dokumente anhängen. Jede Bewerbung behält eigene Kopien.') }}</p></div></div>
        <div class="preparation-grid">
          <section class="workflow-card"><h3>1. {{ text('CV template', 'CV-Vorlage') }}</h3>
            <label>{{ text('Career variant', 'Karrierevariante') }}<select v-model="pendingBaseId" :disabled="busy" @change="pendingSubId = ''"><option value="">{{ text('Choose a variant…', 'Variante wählen…') }}</option><option v-for="variant in roots" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <label v-if="pendingBaseId">{{ text('Subvariant', 'Untervariante') }}<select v-model="pendingSubId" :disabled="busy"><option value="">{{ text('Original variant', 'Originalvariante') }}</option><option v-for="variant in subvariants" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <button type="button" :disabled="!pendingBaseId || busy" @click="assignBase">{{ text('Use CV template', 'CV-Vorlage verwenden') }}</button>
            <p v-if="record">{{ record.baseName }} · {{ published ? text('Snapshot saved', 'Snapshot gespeichert') : text('Local copy — save to Supabase', 'Lokale Kopie — in Supabase speichern') }}</p>
            <p v-else>{{ text('Create a named variant in CV Studio if the library is empty.', 'Bei leerer Bibliothek zuerst eine benannte Variante im CV-Studio erstellen.') }}</p>
            <CvAdjustmentWorkflow :lang="lang" :disabled="busy" @refine="enterRefinement" />
            <details v-if="privacySnapshot"><summary>{{ text('Privacy-filtered snapshot', 'Datenschutzgefilterter Snapshot') }}</summary><pre>{{ JSON.stringify(privacySnapshot, null, 2) }}</pre></details>
          </section>
          <section class="workflow-card"><h3>2. {{ text('Letter template', 'Briefvorlage') }}</h3>
            <label>{{ text('Template', 'Vorlage') }}<select v-model="pendingTemplateId" :disabled="busy"><option value="">{{ text('Choose a template…', 'Vorlage wählen…') }}</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }} · {{ text('revision', 'Revision') }} {{ template.revision }}</option></select></label>
            <button type="button" :disabled="busy || !pendingTemplateId" @click="useLetterTemplate">{{ text('Use letter template', 'Briefvorlage verwenden') }}</button>
            <p v-if="missingLetterTemplate" class="message">{{ text('The original letter template is unavailable. Choose a template above to continue; your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. Zum Fortfahren oben eine Vorlage auswählen; der bestehende Brief bleibt erhalten.') }}</p>
            <template v-if="letter"><p v-if="!missingLetterTemplate">{{ selectedTemplate.name }} · {{ text('Frozen revision', 'Gespeicherte Revision') }} {{ selectedTemplate.revision }}</p><div class="field-row"><label>{{ text('Language', 'Sprache') }}<select v-model="letter.language" :disabled="busy"><option value="en">English</option><option value="de">Deutsch</option></select></label><label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="letter.maxWords" type="number" min="50" max="2000" :disabled="busy" /></label></div><label>{{ text('Application writing instructions', 'Schreibhinweise für diese Bewerbung') }}<textarea v-model="letter.instructions" rows="3" maxlength="20000" :disabled="busy" /></label><details v-if="!missingLetterTemplate"><summary>{{ text('Template guidance', 'Vorlagenhinweise') }}</summary><p class="pre-wrap">{{ selectedTemplate.structure }}</p><p>{{ selectedTemplate.tone }}</p><p v-if="selectedTemplate.exampleText" class="pre-wrap">{{ selectedTemplate.exampleText }}</p></details></template>
            <MotivationLetterEditor :lang="lang" :disabled="busy" @refine="enterRefinement" />
          </section>
        </div>
        <div class="action-row"><button type="button" :disabled="busy || !record || !letter" @click="savePreparation">{{ busy ? text('Saving…', 'Speichern…') : text('Save preparation to Supabase', 'Vorbereitung in Supabase speichern') }}</button><button type="button" @click="downloadBackup">{{ text('Back up application', 'Bewerbung sichern') }}</button><button type="button" :disabled="busy" @click="backupInput?.click()">{{ text('Restore application', 'Bewerbung wiederherstellen') }}</button><input ref="backupInput" hidden type="file" accept=".json,application/json" @change="importBackup" /></div>
        <details class="workflow-card"><summary>{{ text('Tender context & requirements', 'Ausschreibung & Anforderungen') }}</summary><slot name="preparation"><OpportunityContext :context="application.context_json" :lang="lang" /></slot></details>
        <h3 class="attachments-heading">3. {{ text('Supporting documents', 'Zusätzliche Dokumente') }}</h3>
      </section>
      <section v-show="tab === 'refinement'" class="refinement-stage">
        <div class="refinement-controls">
          <div class="stage-heading"><div><h2>{{ text('Refine CV & letter', 'CV & Brief überarbeiten') }}</h2><p>{{ text('Prepare → Publish → Load proposal → Review → Accept', 'Vorbereiten → Veröffentlichen → Vorschlag laden → Prüfen → Übernehmen') }}</p></div></div>
          <p v-if="!record || !letter" class="message">{{ text('Select both templates in Preparation to begin. Existing proposals remain available below.', 'Zum Start beide Vorlagen in Vorbereitung auswählen. Bestehende Vorschläge bleiben unten verfügbar.') }}</p>
          <label>{{ text('Refinement scope', 'Umfang der Überarbeitung') }}<select v-model="feedbackScope" :disabled="busy || (cvApproved && letterApproved)"><option v-if="!cvApproved && !letterApproved" value="both">{{ text('CV and motivation letter', 'CV und Motivationsschreiben') }}</option><option v-if="!cvApproved" value="cv">CV</option><option v-if="!letterApproved" value="letter">{{ text('Motivation letter', 'Motivationsschreiben') }}</option></select></label>
          <details class="workflow-card"><summary>{{ text('Prepare sources & privacy', 'Quellen & Datenschutz vorbereiten') }}</summary>
          <RefinementSourceOverview :application="application" :record="record" :letter="letter" :lang="lang" :settings="effectiveSettings" :prepared="preparedSource" :source-error="sourceError" @approve-context="approvePrivacyContext" @remove-context="removePrivacyContext" />
          <button v-if="sourceError && Object.keys(privacyContexts).length" type="button" @click="privacyContexts = {}">{{ text('Clear approved context descriptions', 'Freigegebene Kontextbeschreibungen entfernen') }}</button>
          </details>
          <div class="action-row"><button class="primary" type="button" :disabled="busy || reviewActive || !preparedSource || !!saveError || (cvApproved && letterApproved)" @click="initialTask">{{ publicationStatus === 'current' ? text('Copy application & task', 'Bewerbung & Aufgabe kopieren') : text('Publish sources & copy task', 'Quellen veröffentlichen & Aufgabe kopieren') }}</button><button type="button" :disabled="busy || reviewActive || !preparedSource || !!saveError || (cvApproved && letterApproved)" @click="initialPrompt">{{ publicationStatus === 'current' ? text('Copy published prompt', 'Veröffentlichten Prompt kopieren') : text('Publish sources & copy prompt', 'Quellen veröffentlichen & Prompt kopieren') }}</button><button type="button" :disabled="busy || refreshing" @click="checkProposals">{{ refreshing ? text('Checking…', 'Prüfen…') : text('Load / refresh proposals', 'Vorschläge laden / aktualisieren') }}</button></div>
          <p class="hint">{{ text('Copy the application & task for your configured ChatGPT conversation, or the full prompt for a new conversation. Both publish the same sources for Supabase access. Copying does not start ChatGPT.', 'Bewerbung & Aufgabe für die eingerichtete ChatGPT-Unterhaltung oder den vollständigen Prompt für eine neue Unterhaltung kopieren. Beide veröffentlichen dieselben Quellen für den Supabase-Zugriff. Das Kopieren startet ChatGPT nicht.') }}</p>
          <p v-if="shortInstructionNotice || shortInstructionError" role="status" aria-live="polite">{{ shortInstructionNotice || shortInstructionError }}</p>
          <input v-if="shortInstructionNotice || shortInstructionError" :value="shortInstruction" readonly :aria-label="text('Short ChatGPT instruction', 'Kurze ChatGPT-Anweisung')" @focus="($event.target as HTMLInputElement).select()" />
          <RefinementHistory :requests="requests" :proposals="proposals" :local-requests="localRequests" :current-request-id="cloudState?.current_request_id || null" :active-id="selectedProposalId" :review-active="reviewActive" :accepted="proposalAlreadyApplied" :publication-status="publicationStatus" :open="historyOpen" :lang="lang" :busy="busy" @select="selectReviewProposal" @details="historyOpen = $event" @export-request="exportRequest" @export-proposal="exportProposal">
            <details><summary>{{ text('Connection & prompt details', 'Verbindungs- & Promptdetails') }}</summary>

          <details v-if="prompt" class="workflow-card"><summary>{{ text('Prompt ready to copy', 'Prompt zum Kopieren bereit') }}</summary><textarea :value="prompt" readonly rows="7" :aria-label="text('Refinement prompt', 'Überarbeitungs-Prompt')" /><button type="button" @click="copyPrompt">{{ text('Copy prompt', 'Prompt kopieren') }}</button></details>
            </details>
            <LegacyRefinementHistory v-if="historyOpen" :client="client" :user-id="userId" :application-id="application.id" :lang="lang" :letter="letter" :locked="busy || reviewActive || letterApproved || !!letter?.finalRevisionId" @restore="reopenLocalLetterRevision" @keep-draft="keepIncomingLetter" @download="exportHistory" />
          </RefinementHistory>
          <section v-if="selectedProposal" class="workflow-card proposal-card"><h3>{{ text('Active proposal', 'Aktiver Vorschlag') }}</h3>
            <template v-if="selectedProposal">
              <p class="hint">{{ text('Proposal preview', 'Vorschau des Vorschlags') }} · {{ new Date(selectedProposal.created_at).toLocaleString() }}<br />{{ text('The published source stays unchanged when you view this proposal.', 'Die veröffentlichte Quelle bleibt beim Ansehen dieses Vorschlags unverändert.') }}</p>
              <p class="pre-wrap">{{ selectedProposal.proposal_json.summary }}</p>
              <RefinementChangeReview :changes="proposalChanges" :selected="selectedChangeIds" :comments="proposalComments" :legacy="selectedProposal.proposal_json.schemaVersion === 1" :lang="lang" :disabled="busy || proposalAlreadyApplied" :locked="cvApproved" @toggle="toggleProposedChange" />
              <RefinementAnnotations :items="proposalAnnotations" :lang="lang" :disabled="busy || !record" :save="saveAnnotation" :include="includeAnnotationFeedback" :privacy-preview="previewOutgoingText" />
              <details><summary>{{ text('Proposed letter', 'Vorgeschlagener Brief') }}</summary><p class="pre-wrap">{{ selectedProposal.proposal_json.letterText }}</p></details>
              <label v-if="selectedRequest?.request_json.scope !== 'cv'" class="selection-checkbox"><input type="checkbox" :checked="includeProposedLetter" :disabled="busy || letterApproved || proposalAlreadyApplied" @change="toggleProposedLetter(($event.target as HTMLInputElement).checked)" />{{ text('Include proposed letter', 'Vorgeschlagenen Brief einbeziehen') }}</label>
              <p v-if="temporaryReview.error || reviewAcceptanceError" class="message error" role="alert">{{ temporaryReview.error || reviewAcceptanceError }}</p>
              <p v-if="reviewActive" role="status" class="warning">{{ proposalAlreadyApplied ? text('Accepted refinement. Close the comparison to review the saved working documents.', 'Angenommene Überarbeitung. Vergleich schließen, um die gespeicherten Arbeitsfassungen zu prüfen.') : text('Proposed refinement — not yet accepted. Close the preview to edit, approve or publish the saved working documents.', 'Vorgeschlagene Überarbeitung — noch nicht angenommen. Zum Bearbeiten, Freigeben oder Veröffentlichen der gespeicherten Arbeitsfassungen die Vorschau schließen.') }}</p>
              <p v-if="proposalDecision" class="hint">{{ text('Decision recorded', 'Entscheidung protokolliert') }} {{ new Date(proposalDecision.created_at).toLocaleString() }} · {{ text('Document approval is separate.', 'Die Dokumentfreigabe erfolgt separat.') }}</p>
              <div class="action-row"><button type="button" :disabled="busy" @click="openProposal">{{ text('Preview selected changes', 'Ausgewählte Änderungen ansehen') }}</button><button class="primary" type="button" :disabled="busy || !reviewActive || !!temporaryReview.error || !!reviewAcceptanceError || proposalAlreadyApplied" @click="acceptSelectedChanges">{{ text('Accept selection', 'Auswahl übernehmen') }}</button><button v-if="reviewActive" type="button" :disabled="busy" @click="discardReview">{{ text('Close temporary preview', 'Temporäre Vorschau schließen') }}</button></div>
            </template>
          </section>
          <details v-if="record && letter" class="workflow-card"><summary>{{ text('Request improvements', 'Verbesserungen anfordern') }}</summary><p class="hint">{{ text('Feedback uses your saved working documents. Accept the selected proposal changes first to include them in the next round.', 'Feedback bezieht sich auf die gespeicherten Arbeitsfassungen. Ausgewählte Vorschlagsänderungen zuerst übernehmen, um sie in der nächsten Runde zu verwenden.') }}</p><label>{{ text('Required improvements', 'Gewünschte Verbesserungen') }}<textarea v-model="feedback" rows="3" maxlength="20000" :disabled="busy || (cvApproved && letterApproved)" /></label><details v-if="feedback.trim()"><summary>{{ text('Outgoing feedback privacy preview', 'Datenschutzvorschau des ausgehenden Feedbacks') }}</summary><p class="hint">{{ text('Visible text will be shared. Highlighted placeholders are pseudonymized; their private originals are not shared.', 'Sichtbarer Text wird geteilt. Hervorgehobene Platzhalter sind pseudonymisiert; ihre privaten Originale werden nicht geteilt.') }}</p><PrivacyTextPreview :value="outgoingFeedback" :lang="lang" /></details><button type="button" :disabled="busy || reviewActive || !feedback.trim() || (cvApproved && letterApproved)" @click="requestImprovement">{{ text('Save feedback & copy improvement prompt', 'Feedback speichern & Verbesserungsprompt kopieren') }}</button><details v-if="feedbackHistory().length"><summary>{{ text('Accumulated feedback', 'Gesammeltes Feedback') }} ({{ feedbackHistory().length }})</summary><p v-for="item in feedbackHistory()" :key="item.id" class="pre-wrap">{{ item.scope }} · {{ item.text }}</p></details></details>
          <details class="workflow-card"><summary>{{ text('Edit / approve working documents', 'Arbeitsfassungen bearbeiten / freigeben') }}</summary>

          <section v-if="record" v-show="pane === 'cv'" class="working-document"><div class="action-row"><button class="primary" type="button" :disabled="busy || reviewActive || !letter || !!saveError" @click="approve('cv', cvApproved)">{{ cvApproved ? text('Reopen CV', 'CV wieder öffnen') : text('Approve CV', 'CV freigeben') }}</button><span>{{ text('Application copy — template stays unchanged', 'Bewerbungskopie — Vorlage bleibt unverändert') }}</span></div><fieldset :disabled="cvApproved || busy || reviewActive"><FormBuilder :state="record.state" :read-version="() => null" :save-version="() => false" /></fieldset></section>
          <section v-if="letter" v-show="pane === 'letter'" class="working-document"><label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<textarea :value="letterText" rows="18" :disabled="letterApproved || busy || reviewActive" @input="updateLetter(($event.target as HTMLTextAreaElement).value)" /></label><p :class="{ warning: words > setup.maxWords }">{{ words }} / {{ setup.maxWords }} {{ text('target words (complete letter)', 'Zielwörter (vollständiger Brief)') }}</p><p v-if="words > setup.maxWords" class="warning">{{ text('Over the target. Review the tender limit; approval and export remain available.', 'Über der Zielwortzahl. Vorgabe prüfen; Freigabe und Export bleiben möglich.') }}</p><p v-if="unresolved.length" class="warning">{{ text('Resolve placeholders:', 'Platzhalter auflösen:') }} {{ unresolved.join(', ') }}</p><button class="primary" type="button" :disabled="busy || reviewActive || !record || !letterText.trim() || !!saveError || (unresolved.length > 0 && !letter.finalRevisionId)" @click="approve('letter', letterApproved || !!letter.finalRevisionId)">{{ letterApproved || letter.finalRevisionId ? text('Reopen letter', 'Brief wieder öffnen') : text('Approve letter', 'Brief freigeben') }}</button></section>
          </details>
          <details class="workflow-card"><summary>{{ text('Import a refinement proposal', 'Überarbeitungsvorschlag importieren') }}</summary><p class="hint">{{ text('Manual alternative to loading a connected proposal.', 'Manuelle Alternative zum Laden eines verbundenen Vorschlags.') }}</p><button type="button" :disabled="busy" @click="proposalInput?.click()">{{ text('Import proposal file', 'Vorschlagsdatei importieren') }}</button><input ref="proposalInput" hidden type="file" accept=".json,application/json" @change="importProposalFile" /><label>{{ text('Proposal JSON', 'Vorschlag als JSON') }}<textarea v-model="manualProposalText" rows="6" :disabled="busy" /></label><button type="button" :disabled="busy || !manualProposalText.trim()" @click="importProposal">{{ text('Load proposed preview', 'Vorgeschlagene Vorschau laden') }}</button><p class="hint">{{ text('Use the versioned proposal JSON for a published request. Importing keeps your working documents unchanged.', 'Versioniertes Vorschlags-JSON für eine veröffentlichte Anfrage verwenden. Der Import lässt die Arbeitsfassungen unverändert.') }}</p></details>
          <details class="workflow-card"><summary>{{ text('Manual drafts & backups', 'Manuelle Entwürfe & Sicherungen') }}</summary><label>{{ text('Incoming letter text or JSON', 'Eingehender Brieftext oder JSON') }}<textarea v-model="manualLetterText" rows="4" maxlength="100000" :disabled="busy || !letter" /></label><button type="button" :disabled="busy || !letter || !manualLetterText.trim()" @click="keepIncomingLetter()">{{ text('Keep incoming draft in history', 'Eingehenden Entwurf im Verlauf behalten') }}</button><div class="action-row"><button type="button" @click="downloadBackup">{{ text('Back up application', 'Bewerbung sichern') }}</button><button type="button" :disabled="busy" @click="backupInput?.click()">{{ text('Restore application', 'Bewerbung wiederherstellen') }}</button><button v-if="letter" type="button" @click="exportHistory(letter, 'motivation-letter-' + application.id + '.json')">{{ text('Back up letter and history', 'Brief und Verlauf sichern') }}</button><button type="button" :disabled="busy || reviewActive || letterApproved || !!letter?.finalRevisionId" @click="letterBackupInput?.click()">{{ text('Restore letter backup', 'Briefsicherung wiederherstellen') }}</button><input ref="letterBackupInput" hidden type="file" accept=".json,application/json" @change="importLetterBackup" /></div></details>

        </div>
        <div class="refinement-preview">
          <div class="document-switch" :aria-label="text('Document preview', 'Dokumentvorschau')"><button type="button" :aria-pressed="pane === 'cv'" @click="pane = 'cv'">{{ text('CV preview', 'CV-Vorschau') }}</button><button type="button" :aria-pressed="pane === 'letter'" @click="pane = 'letter'">{{ text('Letter preview', 'Briefvorschau') }}</button></div>
          <div v-if="temporaryReview.error && (pane === 'cv' ? showCvReview : showLetterReview)" class="message error" role="alert"><strong>{{ text('Proposal preview unavailable', 'Vorschlagsvorschau nicht verfügbar') }}</strong><p>{{ temporaryReview.error }}</p><p>{{ proposalPreviewReference }}</p></div>
          <DocumentCvPreview v-if="previewCvState" v-show="pane === 'cv'" ref="preview" :state="previewCvState" :active="tab === 'refinement' && pane === 'cv'" :download-disabled="showReviewPreview">
            <RefinementPreviewStatus v-if="showCvReview" v-model="reviewComparison" :label="reviewPreviewLabel('cv')" :reference="proposalPreviewReference" :outdated="proposalSourceOutdated" :lang="lang" />
          </DocumentCvPreview>
          <MotivationLetterPreview v-if="previewLetterContent" v-show="pane === 'letter'" ref="letterPreview" :cv-state="previewLetterCvState" :content="previewLetterContent" :lang="previewLetterLanguage" :active="tab === 'refinement' && pane === 'letter'" :download-disabled="!letterApproved || showReviewPreview" :downloading="busy" @download="downloadLetter">
            <RefinementPreviewStatus v-if="showLetterReview" v-model="reviewComparison" :label="reviewPreviewLabel('letter')" :reference="proposalPreviewReference" :outdated="proposalSourceOutdated" :lang="lang" />
          </MotivationLetterPreview>
        </div>
      </section>
      <section v-show="tab === 'review'" class="review-heading"><div class="stage-heading"><div><h2>{{ text('Review the complete application', 'Vollständige Bewerbung prüfen') }}</h2><p>{{ text('Preview exactly what you will download and submit.', 'Genau die Unterlagen prüfen, die heruntergeladen und eingereicht werden.') }}</p></div></div><p v-if="!cvApproved || !letterApproved" class="warning">{{ text('Approve both documents in Refinement before exporting the application.', 'Vor dem Bewerbungsexport beide Dokumente in Überarbeitung freigeben.') }}</p><p v-if="words > setup.maxWords" class="warning">{{ words }} / {{ setup.maxWords }} {{ text('target words — review the tender limit.', 'Zielwörter — Vorgabe prüfen.') }}</p><p v-if="uncheckedRequirements" class="warning">{{ uncheckedRequirements }} {{ text('requirements/checklist items still unchecked. Verify completeness before submission.', 'Anforderungen/Checklistenpunkte noch offen. Vor der Einreichung Vollständigkeit prüfen.') }}</p><details><summary>{{ text('Document requirements', 'Dokumentanforderungen') }}</summary><OpportunityContext :context="requirementContext" :lang="lang" /></details></section>
      <section v-show="tab === 'tracking'" class="tracking-stage"><h2>{{ text('Application tracking', 'Bewerbungsverlauf') }}</h2><p>{{ text('Update your application status here. Each change is recorded in the history.', 'Aktualisiere hier den Bewerbungsstatus. Jede Änderung wird im Verlauf aufgezeichnet.') }}</p><slot name="tracking"><slot name="overview" /></slot></section>
      <ApplicationDocuments v-show="tab !== 'refinement'" :mode="tab === 'preparation' ? 'prepare' : tab === 'tracking' ? 'tracking' : 'review'" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state || null" :cv-ready="cvApproved" :export-ready="cvApproved && letterApproved" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterApproved" :letter-revision="letterRevision" @readiness="documentReadiness = $event" />
    </div>
  </section>
</template>

<style scoped>
.selection-checkbox{display:flex;align-items:center;gap:9px}.selection-checkbox input{width:18px;height:18px;accent-color:#67c8a6}.preview-review-label{font-size:12px;color:#efcc87;margin:0}.application-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;color:#d1fae5;font-family:var(--font-ui,system-ui)}
.workspace-subtabs{display:flex;gap:6px;flex:0 0 auto;padding:12px 0;border-bottom:1px solid #24504e;margin-bottom:14px}
.workspace-subtabs button{display:flex;align-items:center;gap:8px;flex:1;text-align:left}.workspace-subtabs .is-active{background:#185b4c;border-color:#67c8a6}.stage-number{opacity:.7;font-size:12px}
.workflow-body{flex:1;min-height:0;min-width:0;overflow:auto;padding-right:6px}.workflow-body--refinement,.workflow-body--review{display:flex;flex-direction:column;overflow:hidden}
.preparation-stage,.tracking-stage{display:grid;gap:20px}.stage-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:18px}.stage-heading h2,.tracking-stage h2{color:#9be8c7;font-size:21px;margin:0 0 8px}.stage-heading p,p.hint{font-size:13px;color:#a6c1b9;line-height:1.6}.stage-heading button{flex-shrink:0}
h3{font-size:16px;margin:0 0 14px}p{line-height:1.6;font-size:13px}button,input,select,textarea{font:inherit;color:inherit;border:1px solid #28534e;background:#0b1b25;border-radius:7px;padding:9px 11px;box-sizing:border-box}button{cursor:pointer;font-size:13px}button:disabled{opacity:.45;cursor:default}button:hover:enabled{background:#185b4c}.primary{background:#185b4c;border-color:#67c8a6}label{display:grid;gap:7px;font-size:12px;font-weight:600;margin-bottom:12px}input,select,textarea{width:100%;min-width:0;font-size:14px;font-weight:400}textarea{resize:vertical;line-height:1.6}select{max-width:100%}summary{cursor:pointer;font-size:13px;font-weight:600}details[open]>summary{margin-bottom:14px}pre{font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere}.pre-wrap{white-space:pre-wrap;overflow-wrap:anywhere}.preparation-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.workflow-card{border:1px solid #28534e;border-radius:10px;padding:18px;margin-bottom:16px;background:#091923}.workflow-card p{margin:10px 0}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.action-row span{font-size:12px;color:#a6c1b9}.message{padding:10px 14px;background:#10382c;border-radius:7px;font-size:13px;margin:0 0 12px}.message.error{background:#3a1720;color:#fecaca}.warning{color:#efcc87;background:#302b1a;padding:9px 12px;border-radius:6px;font-size:13px}.attachments-heading{margin:0}.refinement-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,42%);gap:24px;flex:1;min-height:0;overflow:hidden}.refinement-controls{overflow:auto;min-height:0;padding-right:8px}.refinement-preview{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:1;min-height:0}.refinement-preview>.document-switch{flex:0 0 auto;margin:0 0 10px}.document-switch{display:flex;gap:8px;margin:22px 0 14px}.document-switch button[aria-pressed=true]{border-color:#67c8a6;background:#185b4c}.working-document{margin-bottom:24px}.working-document fieldset{border:0;padding:0;min-width:0}.working-document :deep(.builder){height:auto;overflow:visible}.cv-change{display:grid;gap:7px;margin:16px 0;font-size:13px;white-space:pre-wrap}.cv-change del{background:#3a1720;padding:9px;text-decoration:none;color:#fecaca}.cv-change ins{background:#10382c;padding:9px;text-decoration:none;color:#a7f3d0}.review-heading{flex:0 0 auto}.review-heading .stage-heading{margin-bottom:10px}.review-heading details{max-height:25vh;overflow:auto;margin-bottom:10px}.tracking-stage :deep(.letter-workspace){height:650px}.preparation-stage :deep(.opportunity-context){overflow:visible}
@media(max-width:900px){.preparation-grid{grid-template-columns:1fr;gap:0}.refinement-stage{grid-template-columns:minmax(0,1fr) minmax(270px,38%);gap:12px}.stage-heading{flex-direction:column}}
@media(max-width:760px){.application-workspace{--mobile-application-tabs-height:48px;padding-bottom:var(--mobile-application-tabs-height)}.workspace-subtabs{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;height:48px;margin:0;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;background:#06141f;border-top:1px solid #24504e}.workspace-subtabs button{font-size:12px;white-space:nowrap;padding:7px;gap:4px}.stage-number{display:none}.workflow-body{padding:8px}.refinement-stage{display:flex;flex-direction:column;gap:10px}.refinement-controls{flex:1}.refinement-preview{flex:0 0 auto}.refinement-preview>.document-preview,.refinement-preview>.letter-preview{flex:0 0 auto}.refinement-preview :deep(.inline-document-preview){min-height:0}.stage-heading{gap:10px}.stage-heading h2{font-size:20px}.workflow-card{padding:14px}.workflow-body input,.workflow-body textarea,.workflow-body select{font-size:16px}.workflow-body p{font-size:15px}.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){min-height:430px;flex:1 0 auto}.review-heading details{max-height:180px}.tracking-stage{gap:12px}}
</style>
