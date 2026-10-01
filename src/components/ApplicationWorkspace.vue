<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import { supabaseConfiguration } from '../lib/supabase';
import type { CvState, SavedConfiguration } from '../types';
import type { ApplicationLetter, LetterTemplate } from '../letterTypes';
import type { LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementScope, RefinementState } from '../refinementTypes';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv, type ApplicationCvRecord } from '../composables/applicationCv';
import { createCloudCvSnapshot } from '../composables/cloudCvPrivacy';
import { rootVariantId } from '../composables/careerVariants';
import { addIncomingDraft, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizeLetter, letterContextVersion, letterFromEditableText, openLetterRevision, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import { applyRefinementProposal, buildRefinementPrompt, createRefinementRepository, prepareRefinement, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText } from '../composables/applicationRefinement';
import { buildOpportunityGroups, checklistKeys } from '../composables/opportunityContext';
import FormBuilder from './FormBuilder.vue';
import DocumentCvPreview from './DocumentCvPreview.vue';
import MotivationLetterPreview from './MotivationLetterPreview.vue';
import MotivationLetterEditor from './MotivationLetterEditor.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import OpportunityContext from './OpportunityContext.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import { buildShortRefinementInstruction } from '../composables/applicationReference';
import { resolveRefinementSettings, serializeRefinementDraft, sameRefinementInputs } from '../composables/refinementSources';
import RefinementSourceOverview from './RefinementSourceOverview.vue';

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
const localRequests = ref<Record<string, LocalRefinementRequest>>({});
const parentProposalId = ref<string | null>(null);
const cloudState = ref<RefinementState | null>(null);
const requests = ref<RefinementRequestRow[]>([]);
const proposals = ref<RefinementProposalRow[]>([]);
const reviews = ref<RefinementReviewRow[]>([]);
const selectedProposalId = ref('');
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
const legacyOpen = ref(false);
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
const baselineSignature = computed(() => refinementSignature([record.value?.state, letterText.value, setup.value, letter.value?.instructions || '', props.application.context_json]));
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
const currentPublishedRequest = computed(() => requests.value.find(item => item.id === cloudState.value?.current_request_id) || null);
const publishedSource = computed(() => currentPublishedRequest.value || requests.value[0] || null);
const publishedLocal = computed(() => publishedSource.value ? localRequests.value[publishedSource.value.id] || null : null);
const sourcePreparation = computed(() => {
  if (!record.value || !letter.value || missingLetterTemplate.value) return { local: null, error: '' };
  try {
    const local = prepareRefinement({ applicationId: props.application.id, state: record.value.state, variantId: record.value.variantId || record.value.baseId, setup: setup.value, letterText: letterText.value, instructions: letter.value.instructions, opportunity: props.application.context_json, scope: feedbackScope.value, feedback: feedbackHistory(), parentProposalId: parentProposalId.value, baselineSignature: baselineSignature.value });
    local.source = { cv: { name: record.value.baseName, variantId: record.value.variantId || record.value.baseId, baseRevision: record.value.baseRevision, hasApplicationEdits: cvDifferences(record.value.baseState, record.value.state).length > 0 }, letter: { updatedAt: letter.value.updatedAt, version: refinementSignature(letterText.value) }, contextCapturedAt: props.application.context_captured_at };
    return { local, error: '' };
  } catch (cause) { return { local: null, error: cause instanceof Error ? cause.message : String(cause) }; }
});
const preparedSource = computed(() => sourcePreparation.value.local);
const sourceError = computed(() => sourcePreparation.value.error);
const publicationStatus = computed<'unpublished' | 'current' | 'outdated' | 'unverifiable'>(() => {
  if (!publishedSource.value) return 'unpublished';
  if (!currentPublishedRequest.value) return 'outdated';
  const local = localRequests.value[currentPublishedRequest.value.id];
  if (!local || !record.value || !letter.value) return 'unverifiable';
  return preparedSource.value && sameRefinementInputs(local, preparedSource.value) ? 'current' : 'outdated';
});
const proposalChanges = computed(() => (selectedProposal.value?.proposal_json.cvEdits || []).map(edit => {
  const field = selectedRequest.value?.request_json.cv.fields.find(item => item.id === edit.fieldId);
  return { label: field?.label || edit.fieldId, before: field?.text || '', after: edit.text };
}));
const requirementContext = computed(() => Object.fromEntries(Object.entries(props.application.context_json).filter(([key]) => ['requirements', 'required_documents', 'application_documents', 'documents', 'submission_documents', 'eligibility'].includes(key))));
const uncheckedRequirements = computed(() => buildOpportunityGroups(props.application.context_json, props.lang).filter(group => ['requirements', 'documents'].includes(group.id)).flatMap(group => checklistKeys(group.items)).filter(key => !props.application.completed_checklist_keys?.includes(key)).length);
const allowedScope = computed<RefinementScope>(() => cvApproved.value ? 'letter' : letterApproved.value ? 'cv' : 'both');
watch(allowedScope, scope => { if (cvApproved.value && feedbackScope.value !== 'letter' || letterApproved.value && feedbackScope.value !== 'cv') feedbackScope.value = scope; }, { immediate: true });
watch(tab, value => { try { sessionStorage.setItem(navigationKey, value); } catch { /* Navigation remains available. */ } });

function persist() {
  if (localReadError) { saveError.value = localReadError; return; }
  try {
    if (record.value) saveApplicationCv(record.value);
    if (letter.value) letterRepository.save(letter.value);
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, approvals: approvals.value, requests: localRequests.value, parentProposalId: parentProposalId.value, scope: feedbackScope.value }));
    saveError.value = '';
  } catch (cause) { saveError.value = text('Local save failed: ', 'Lokales Speichern fehlgeschlagen: ') + String(cause); }
}
watch([record, letter, approvals, localRequests, parentProposalId], persist, { deep: true, flush: 'sync' });
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
    cloudState.value = state; requests.value = nextRequests; proposals.value = nextProposals; reviews.value = nextReviews;
    // Recover only an absent letter. Existing empty drafts and unreadable local records
    // are intentional/local data, never permission to replace them with cloud content.
    if (!letter.value && !saveError.value && state) {
      const ctx = letterContextVersion(props.application, record.value?.state || null, state.setup_json.template, state.setup_json.language, '', state.setup_json.maxWords);
      const restored = createApplicationLetter(props.userId, props.application.id, state.setup_json.template, ctx, state.setup_json.language);
      const source = nextRequests.find(item => item.id === state.current_request_id) || nextRequests[0];
      restored.maxWords = state.setup_json.maxWords;
      if (source) {
        restored.working = letterFromEditableText(source.request_json.letter.text);
        restored.instructions = source.request_json.cv.instructions;
      }
      letter.value = restored;
    }
    if (state && initialSignature === baselineSignature.value) approvals.value = clone(state.approvals_json);
    if (!scopeWasChosen && currentPublishedRequest.value) {
      const scope = currentPublishedRequest.value.request_json.scope;
      if ((!cvApproved.value || scope === 'letter') && (!letterApproved.value || scope === 'cv')) feedbackScope.value = scope;
    }
    cloudLoaded.value = true;
    if (!selectedProposalId.value) selectedProposalId.value = nextProposals[0]?.id || '';
  })();
  try { await loadingCloud; }
  finally { loadingCloud = null; refreshing.value = false; }
}
async function checkProposals() { await run(async () => { await refreshCloud(); notice.value = proposals.value.length ? text('Proposals loaded. Review one before applying it.', 'Vorschläge geladen. Vor dem Übernehmen prüfen.') : text('No proposal yet. Run the copied prompt in ChatGPT, then check again.', 'Noch kein Vorschlag. Kopierten Prompt in ChatGPT ausführen und erneut prüfen.'); }); }
function refreshOnFocus() { if (!busy.value && props.active !== false) void refreshCloud().catch(report); }
watch(() => props.active, active => { if (active) refreshOnFocus(); });
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
  return reviews.value.filter(item => item.kind === 'feedback').map(item => ({ id: item.id, text: String(item.payload.text), scope: item.payload.scope as RefinementScope, createdAt: item.created_at }));
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
async function createRound(scope: RefinementScope) {
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
    promptForRequest(current); await copyPrompt();
    notice.value += text(' Existing published request reused.', ' Bestehende Veröffentlichung wiederverwendet.');
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
  promptForRequest(saved); await copyPrompt();
}
async function initialPrompt() { await run(async () => { await createRound(feedbackScope.value); }); }
function useProposal() {
  if (!record.value || !letter.value || !selectedProposal.value) throw new Error('Select a proposal and restore its local CV first.');
  const row = selectedProposal.value;
  if (cloudState.value?.current_request_id !== row.request_id) throw new Error(text('This proposal belongs to a superseded round. Review the proposal for the current round or create a new round.', 'Dieser Vorschlag gehört zu einer überholten Runde. Den Vorschlag der aktuellen Runde prüfen oder eine neue Runde erstellen.'));
  const local = localRequests.value[row.request_id];
  if (!local) throw new Error(text('This device is missing the original private snapshot. Restore your documents if needed, then create a new round.', 'Der ursprüngliche private Snapshot fehlt auf diesem Gerät. Dokumente bei Bedarf wiederherstellen und eine neue Runde erstellen.'));
  if (cvApproved.value && row.proposal_json.cvEdits.length || letterApproved.value && row.proposal_json.letterText !== local.request.letter.text) throw new Error('Reopen the approved document before applying changes.');
  const preserveApprovedLetter = letterApproved.value;
  const result = applyRefinementProposal(local, row.proposal_json, record.value.state, baselineSignature.value);
  if (local.request.scope !== 'letter') record.value.state = result.state;
  if (local.request.scope !== 'cv' && !preserveApprovedLetter) {
    const incoming = addIncomingDraft(letter.value, letterFromEditableText(result.letterText), context.value, { cloudDraftId: row.id, cloudContextId: row.request_id });
    const revision = incoming.revisions.find(item => item.cloudDraftId === row.id)!;
    letter.value = openLetterRevision(incoming, revision.id);
  }
  parentProposalId.value = row.id; persist();
  notice.value = text('Proposal opened as working documents. Edit or approve each document.', 'Vorschlag als Arbeitsfassung geöffnet. Jedes Dokument bearbeiten oder freigeben.');
}
function openProposal() { try { error.value = ''; useProposal(); } catch (cause) { report(cause); } }
async function requestImprovement() {
  await run(async () => {
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
    if (!record.value || !letter.value) throw new Error('Select both templates first.');
    if (!reopen && kind === 'letter' && (!letterText.value.trim() || unresolved.value.length)) throw new Error(text('Write a letter and resolve its placeholders first.', 'Zuerst einen Brief schreiben und Platzhalter auflösen.'));
    await saveSetup();
    const revision = kind === 'cv' ? cvRevision.value : letterRevision.value;
    await repository.saveReview(props.application.id, cloudState.value?.current_request_id || null, (reopen ? 'reopen_' : 'approve_') + kind as RefinementReviewRow['kind'], { ...(reopen ? {} : { revision }), expectedRevision: cloudState.value!.revision });
    cloudState.value = await repository.loadState(props.application.id);
    if (disposed) return;
    approvals.value = clone(cloudState.value!.approvals_json);
    if (!reopen && kind === 'letter' && letterRevision.value === revision) letter.value = finalizeLetter(letter.value, context.value, record.value.state.contact);
    persist();
  });
}
function reopenLocalLetterRevision(id: string) { if (letter.value) { letter.value = openLetterRevision(letter.value, id); approvals.value.letter = null; } }
async function getCvPdf() {
  if (!cvApproved.value || !preview.value) throw new Error(text('Approve the CV before export.', 'Den CV vor dem Export freigeben.'));
  const revision = cvRevision.value; const blob = await preview.value.getPdfBlob();
  if (disposed || revision !== cvRevision.value || !cvApproved.value) throw new Error('The CV changed during export. Preview again.');
  return blob;
}
async function getLetterPdf() {
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
  downloadBlob(new Blob([JSON.stringify({ kind: 'application-refinement-backup', version: 1, record: record.value, letter: letter.value, requests: localRequests.value, parentProposalId: parentProposalId.value }, null, 2)], { type: 'application/json' }), 'application-' + props.application.id + '.json');
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
    localReadError = '';
    record.value = restored;
    if (checkedLetter) letter.value = checkedLetter;
    // Returned proposals remain cloud history; restored work starts with a fresh request.
    approvals.value = { cv: null, letter: null }; localRequests.value = {}; parentProposalId.value = null; persist();
    notice.value = text('Application restored. Review and save preparation before continuing.', 'Bewerbung wiederhergestellt. Vorbereitung prüfen und speichern.');
  });
}
function legacyChanged(event: { record: ApplicationLetter | null }) { if (event.record) letter.value = clone(event.record); }
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
        <div class="stage-heading"><div><h2>{{ text('Prepare your application', 'Bewerbung vorbereiten') }}</h2><p>{{ text('Choose templates and attach supporting documents. Each application keeps its own copies.', 'Vorlagen auswählen und zusätzliche Dokumente anhängen. Jede Bewerbung behält eigene Kopien.') }}</p></div><button class="primary" type="button" @click="tab = 'refinement'">{{ text('Continue to refinement', 'Weiter zur Überarbeitung') }} →</button></div>
        <div class="preparation-grid">
          <section class="workflow-card"><h3>1. {{ text('CV template', 'CV-Vorlage') }}</h3>
            <label>{{ text('Career variant', 'Karrierevariante') }}<select v-model="pendingBaseId" :disabled="busy" @change="pendingSubId = ''"><option value="">{{ text('Choose a variant…', 'Variante wählen…') }}</option><option v-for="variant in roots" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <label v-if="pendingBaseId">{{ text('Subvariant', 'Untervariante') }}<select v-model="pendingSubId" :disabled="busy"><option value="">{{ text('Original variant', 'Originalvariante') }}</option><option v-for="variant in subvariants" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <button type="button" :disabled="!pendingBaseId || busy" @click="assignBase">{{ text('Use CV template', 'CV-Vorlage verwenden') }}</button>
            <p v-if="record">{{ record.baseName }} · {{ published ? text('Snapshot saved', 'Snapshot gespeichert') : text('Local copy — save to Supabase', 'Lokale Kopie — in Supabase speichern') }}</p>
            <p v-else>{{ text('Create a named variant in CV Studio if the library is empty.', 'Bei leerer Bibliothek zuerst eine benannte Variante im CV-Studio erstellen.') }}</p>
            <details v-if="privacySnapshot"><summary>{{ text('Anonymized snapshot', 'Anonymisierter Snapshot') }}</summary><pre>{{ JSON.stringify(privacySnapshot, null, 2) }}</pre></details>
          </section>
          <section class="workflow-card"><h3>2. {{ text('Letter template', 'Briefvorlage') }}</h3>
            <label>{{ text('Template', 'Vorlage') }}<select v-model="pendingTemplateId" :disabled="busy"><option value="">{{ text('Choose a template…', 'Vorlage wählen…') }}</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }} · {{ text('revision', 'Revision') }} {{ template.revision }}</option></select></label>
            <button type="button" :disabled="busy || !pendingTemplateId" @click="useLetterTemplate">{{ text('Use letter template', 'Briefvorlage verwenden') }}</button>
            <p v-if="missingLetterTemplate" class="message">{{ text('The original letter template is unavailable. Choose a template above to continue; your existing letter is preserved.', 'Die ursprüngliche Briefvorlage ist nicht verfügbar. Zum Fortfahren oben eine Vorlage auswählen; der bestehende Brief bleibt erhalten.') }}</p>
            <template v-if="letter"><p v-if="!missingLetterTemplate">{{ selectedTemplate.name }} · {{ text('Frozen revision', 'Gespeicherte Revision') }} {{ selectedTemplate.revision }}</p><div class="field-row"><label>{{ text('Language', 'Sprache') }}<select v-model="letter.language" :disabled="busy"><option value="en">English</option><option value="de">Deutsch</option></select></label><label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="letter.maxWords" type="number" min="50" max="2000" :disabled="busy" /></label></div><label>{{ text('Application writing instructions', 'Schreibhinweise für diese Bewerbung') }}<textarea v-model="letter.instructions" rows="3" maxlength="20000" :disabled="busy" /></label><details v-if="!missingLetterTemplate"><summary>{{ text('Template guidance', 'Vorlagenhinweise') }}</summary><p class="pre-wrap">{{ selectedTemplate.structure }}</p><p>{{ selectedTemplate.tone }}</p><p v-if="selectedTemplate.exampleText" class="pre-wrap">{{ selectedTemplate.exampleText }}</p></details></template>
          </section>
        </div>
        <div class="action-row"><button type="button" :disabled="busy || !record || !letter" @click="savePreparation">{{ busy ? text('Saving…', 'Speichern…') : text('Save preparation to Supabase', 'Vorbereitung in Supabase speichern') }}</button><button type="button" @click="downloadBackup">{{ text('Back up application', 'Bewerbung sichern') }}</button><button type="button" :disabled="busy" @click="backupInput?.click()">{{ text('Restore application', 'Bewerbung wiederherstellen') }}</button><input ref="backupInput" hidden type="file" accept=".json,application/json" @change="importBackup" /></div>
        <details class="workflow-card"><summary>{{ text('Tender context & requirements', 'Ausschreibung & Anforderungen') }}</summary><slot name="preparation"><OpportunityContext :context="application.context_json" :lang="lang" /></slot></details>
        <h3 class="attachments-heading">3. {{ text('Supporting documents', 'Zusätzliche Dokumente') }}</h3>
      </section>
      <section v-show="tab === 'refinement'" class="refinement-stage">
        <div class="refinement-controls">
          <div class="stage-heading"><div><h2>{{ text('Refine CV & letter', 'CV & Brief überarbeiten') }}</h2><p>{{ text('One proposal, with separate approval for each document.', 'Ein Vorschlag mit separater Freigabe für jedes Dokument.') }}</p></div><button class="primary" type="button" @click="tab = 'review'">{{ text('Review PDF', 'PDF prüfen') }} →</button></div>
          <p v-if="!record || !letter" class="message">{{ text('Select both templates in Preparation to begin. Existing proposals remain available below.', 'Zum Start beide Vorlagen in Vorbereitung auswählen. Bestehende Vorschläge bleiben unten verfügbar.') }}</p>
          <label>{{ text('Refinement scope', 'Umfang der Überarbeitung') }}<select v-model="feedbackScope" :disabled="busy || (cvApproved && letterApproved)"><option v-if="!cvApproved && !letterApproved" value="both">{{ text('CV and motivation letter', 'CV und Motivationsschreiben') }}</option><option v-if="!cvApproved" value="cv">CV</option><option v-if="!letterApproved" value="letter">{{ text('Motivation letter', 'Motivationsschreiben') }}</option></select></label>
          <RefinementSourceOverview :application="application" :record="record" :letter="letter" :lang="lang" :settings="effectiveSettings" :prepared="preparedSource" :source-error="sourceError" :published="publishedSource" :published-local="publishedLocal" :is-current-request="!!currentPublishedRequest" :status="publicationStatus" />
          <div class="action-row"><button class="primary" type="button" :disabled="busy || !preparedSource || !!saveError || (cvApproved && letterApproved)" @click="initialPrompt">{{ publicationStatus === 'current' ? text('Copy published prompt', 'Veröffentlichten Prompt kopieren') : text('Publish sources & copy prompt', 'Quellen veröffentlichen & Prompt kopieren') }}</button><button type="button" :disabled="busy || refreshing" @click="checkProposals">{{ refreshing ? text('Checking…', 'Prüfen…') : text('Check for proposal', 'Vorschlag abrufen') }}</button></div>
          <p class="hint">{{ text('Paste the prompt into ChatGPT with your Supabase MCP connection, then return here. Saving context does not start ChatGPT.', 'Den Prompt in ChatGPT mit der Supabase-MCP-Verbindung einfügen und hierher zurückkehren. Das Speichern startet ChatGPT nicht.') }}</p>
          <div class="workflow-card short-instruction"><button type="button" :disabled="cvApproved && letterApproved" @click="copyShortInstruction">{{ text('Copy short ChatGPT instruction', 'Kurze ChatGPT-Anweisung kopieren') }}</button><p class="hint">{{ text('Use this with your configured phd-workflow conversation after publishing the current round. Copying this reference does not save documents or start refinement.', 'Nach dem Veröffentlichen der aktuellen Runde in der eingerichteten phd-workflow-Unterhaltung verwenden. Das Kopieren dieser Referenz speichert keine Dokumente und startet keine Überarbeitung.') }}</p><p role="status" aria-live="polite" aria-atomic="true">{{ shortInstructionNotice || shortInstructionError }}</p><input :value="shortInstruction" readonly :aria-label="text('Short ChatGPT instruction', 'Kurze ChatGPT-Anweisung')" @focus="($event.target as HTMLInputElement).select()" /></div>
          <details v-if="prompt" open class="workflow-card"><summary>{{ text('Prompt ready to copy', 'Prompt zum Kopieren bereit') }}</summary><textarea :value="prompt" readonly rows="7" :aria-label="text('Refinement prompt', 'Überarbeitungs-Prompt')" /><button type="button" @click="copyPrompt">{{ text('Copy prompt', 'Prompt kopieren') }}</button></details>
          <section v-if="proposals.length" class="workflow-card proposal-card"><h3>{{ text('Proposal history', 'Vorschlagsverlauf') }}</h3><label>{{ text('Proposal', 'Vorschlag') }}<select v-model="selectedProposalId"><option v-for="(proposal, index) in proposals" :key="proposal.id" :value="proposal.id">{{ proposals.length - index }} · {{ new Date(proposal.created_at).toLocaleString() }}</option></select></label>
            <template v-if="selectedProposal"><p class="hint">{{ text('Proposal preview', 'Vorschau des Vorschlags') }} · {{ new Date(selectedProposal.created_at).toLocaleString() }}<br />{{ text('Based on request', 'Basiert auf Anfrage') }} {{ selectedProposal.request_id }}<br />{{ text('The published source stays unchanged when you view or open this proposal.', 'Die veröffentlichte Quelle bleibt beim Ansehen oder Öffnen dieses Vorschlags unverändert.') }}</p><p class="pre-wrap">{{ selectedProposal.proposal_json.summary }}</p><details><summary>{{ text('CV changes', 'CV-Änderungen') }} ({{ proposalChanges.length }})</summary><p v-if="!proposalChanges.length">{{ text('CV wording unchanged.', 'CV-Wortlaut unverändert.') }}</p><article v-for="(change, index) in proposalChanges" :key="index" class="cv-change"><strong>{{ change.label }}</strong><del>{{ change.before }}</del><ins>{{ change.after }}</ins></article></details><details><summary>{{ text('Proposed letter', 'Vorgeschlagener Brief') }}</summary><p class="pre-wrap">{{ selectedProposal.proposal_json.letterText }}</p></details><button type="button" :disabled="busy || !record || !letter || parentProposalId === selectedProposal.id" @click="openProposal">{{ parentProposalId === selectedProposal.id ? text('Opened as working documents', 'Als Arbeitsfassung geöffnet') : text('Use proposal for editing', 'Vorschlag zum Bearbeiten verwenden') }}</button></template>
          </section>
          <section v-if="record && letter" class="workflow-card"><h3>{{ text('Request improvements', 'Verbesserungen anfordern') }}</h3><p class="hint">{{ text('Feedback uses your current working documents. Open a proposal for editing first if you want to refine that proposal.', 'Feedback bezieht sich auf die aktuellen Arbeitsfassungen. Einen Vorschlag zuerst zum Bearbeiten öffnen, um ihn weiter zu überarbeiten.') }}</p><label>{{ text('Required improvements', 'Gewünschte Verbesserungen') }}<textarea v-model="feedback" rows="3" maxlength="20000" :disabled="busy || (cvApproved && letterApproved)" /></label><button type="button" :disabled="busy || !feedback.trim() || (cvApproved && letterApproved)" @click="requestImprovement">{{ text('Save feedback & copy improvement prompt', 'Feedback speichern & Verbesserungsprompt kopieren') }}</button><details v-if="feedbackHistory().length"><summary>{{ text('Accumulated feedback', 'Gesammeltes Feedback') }} ({{ feedbackHistory().length }})</summary><p v-for="item in feedbackHistory()" :key="item.id" class="pre-wrap">{{ item.scope }} · {{ item.text }}</p></details></section>
          <div class="document-switch"><button type="button" :aria-pressed="pane === 'cv'" @click="pane = 'cv'">CV · {{ cvApproved ? '✓' : text('Edit / approve', 'Bearbeiten / freigeben') }}</button><button type="button" :aria-pressed="pane === 'letter'" @click="pane = 'letter'">{{ text('Letter', 'Brief') }} · {{ letterApproved ? '✓' : text('Edit / approve', 'Bearbeiten / freigeben') }}</button></div>
          <section v-if="record" v-show="pane === 'cv'" class="working-document"><div class="action-row"><button class="primary" type="button" :disabled="busy || !letter || !!saveError" @click="approve('cv', cvApproved)">{{ cvApproved ? text('Reopen CV', 'CV wieder öffnen') : text('Approve CV', 'CV freigeben') }}</button><span>{{ text('Application copy — template stays unchanged', 'Bewerbungskopie — Vorlage bleibt unverändert') }}</span></div><fieldset :disabled="cvApproved || busy"><FormBuilder :state="record.state" :read-version="() => null" :save-version="() => false" /></fieldset></section>
          <section v-if="letter" v-show="pane === 'letter'" class="working-document"><label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<textarea :value="letterText" rows="18" :disabled="letterApproved || busy" @input="updateLetter(($event.target as HTMLTextAreaElement).value)" /></label><p :class="{ warning: words > setup.maxWords }">{{ words }} / {{ setup.maxWords }} {{ text('target words (complete letter)', 'Zielwörter (vollständiger Brief)') }}</p><p v-if="words > setup.maxWords" class="warning">{{ text('Over the target. Review the tender limit; approval and export remain available.', 'Über der Zielwortzahl. Vorgabe prüfen; Freigabe und Export bleiben möglich.') }}</p><p v-if="unresolved.length" class="warning">{{ text('Resolve placeholders:', 'Platzhalter auflösen:') }} {{ unresolved.join(', ') }}</p><button class="primary" type="button" :disabled="busy || !record || !letterText.trim() || !!saveError || unresolved.length > 0" @click="approve('letter', letterApproved)">{{ letterApproved ? text('Reopen letter', 'Brief wieder öffnen') : text('Approve letter', 'Brief freigeben') }}</button><details v-if="letter.revisions.length"><summary>{{ text('Letter revision history', 'Brief-Revisionsverlauf') }}</summary><div v-for="revision in [...letter.revisions].reverse()" :key="revision.id" class="action-row"><span>{{ revision.kind }} · {{ new Date(revision.createdAt).toLocaleString() }}</span><button type="button" :disabled="busy || letterApproved" @click="reopenLocalLetterRevision(revision.id)">{{ text('Open revision', 'Revision öffnen') }}</button></div></details></section>
          <details v-if="requests.length"><summary>{{ text('Published rounds', 'Veröffentlichte Runden') }} ({{ requests.length }})</summary><p v-for="request in requests" :key="request.id">{{ new Date(request.created_at).toLocaleString() }} · {{ request.request_json.scope }} · {{ request.request_json.feedback.length }} {{ text('feedback entries', 'Feedbackeinträge') }}</p></details>
        </div>
        <div class="refinement-preview"><DocumentCvPreview v-if="record" v-show="pane === 'cv'" ref="preview" :state="record.state" :active="tab === 'refinement' && pane === 'cv'" /><MotivationLetterPreview v-if="letter" v-show="pane === 'letter'" ref="letterPreview" :cv-state="record?.state || null" :content="letter.working" :lang="letter.language" :active="tab === 'refinement' && pane === 'letter'" :download-disabled="!letterApproved" :downloading="busy" @download="downloadLetter" /></div>
      </section>
      <section v-show="tab === 'review'" class="review-heading"><div class="stage-heading"><div><h2>{{ text('Review the complete application', 'Vollständige Bewerbung prüfen') }}</h2><p>{{ text('Preview exactly what you will download and submit.', 'Genau die Unterlagen prüfen, die heruntergeladen und eingereicht werden.') }}</p></div><button type="button" @click="tab = 'tracking'">{{ text('Track submission', 'Einreichung verfolgen') }} →</button></div><p v-if="!cvApproved || !letterApproved" class="warning">{{ text('Approve both documents in Refinement before exporting the application.', 'Vor dem Bewerbungsexport beide Dokumente in Überarbeitung freigeben.') }}</p><p v-if="words > setup.maxWords" class="warning">{{ words }} / {{ setup.maxWords }} {{ text('target words — review the tender limit.', 'Zielwörter — Vorgabe prüfen.') }}</p><p v-if="uncheckedRequirements" class="warning">{{ uncheckedRequirements }} {{ text('requirements/checklist items still unchecked. Verify completeness before submission.', 'Anforderungen/Checklistenpunkte noch offen. Vor der Einreichung Vollständigkeit prüfen.') }}</p><details><summary>{{ text('Document requirements', 'Dokumentanforderungen') }}</summary><OpportunityContext :context="requirementContext" :lang="lang" /></details></section>
      <section v-show="tab === 'tracking'" class="tracking-stage"><h2>{{ text('Application tracking', 'Bewerbungsverlauf') }}</h2><p>{{ text('Submit through the institution’s portal or email, then update your status and dates here.', 'Über das Portal oder per E-Mail einreichen und anschließend Status und Daten hier aktualisieren.') }}</p><slot name="tracking"><slot name="overview" /></slot><details @toggle="legacyOpen = ($event.target as HTMLDetailsElement).open"><summary>{{ text('Legacy letter drafts and backups', 'Frühere Briefentwürfe und Backups') }}</summary><MotivationLetterEditor v-if="legacyOpen" :application="application" :cv-state="record?.state || null" :client="client" :user-id="userId" :lang="lang" @change="legacyChanged" /></details></section>
      <ApplicationDocuments v-show="tab !== 'refinement'" :mode="tab === 'preparation' ? 'prepare' : tab === 'tracking' ? 'tracking' : 'review'" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state || null" :cv-ready="cvApproved" :export-ready="cvApproved && letterApproved" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterApproved" :letter-revision="letterRevision" @readiness="documentReadiness = $event" />
    </div>
  </section>
</template>

<style scoped>
.application-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;color:#d1fae5;font-family:var(--font-ui,system-ui)}
.workspace-subtabs{display:flex;gap:6px;flex:0 0 auto;padding:12px 0;border-bottom:1px solid #24504e;margin-bottom:14px}
.workspace-subtabs button{display:flex;align-items:center;gap:8px;flex:1;text-align:left}.workspace-subtabs .is-active{background:#185b4c;border-color:#67c8a6}.stage-number{opacity:.7;font-size:12px}
.workflow-body{flex:1;min-height:0;min-width:0;overflow:auto;padding-right:6px}.workflow-body--refinement,.workflow-body--review{display:flex;flex-direction:column;overflow:hidden}
.preparation-stage,.tracking-stage{display:grid;gap:20px}.stage-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:18px}.stage-heading h2,.tracking-stage h2{font-size:21px;margin:0 0 8px}.stage-heading p,p.hint{font-size:13px;color:#a6c1b9;line-height:1.6}.stage-heading button{flex-shrink:0}
h3{font-size:16px;margin:0 0 14px}p{line-height:1.6;font-size:13px}button,input,select,textarea{font:inherit;color:inherit;border:1px solid #28534e;background:#0b1b25;border-radius:7px;padding:9px 11px;box-sizing:border-box}button{cursor:pointer;font-size:13px}button:disabled{opacity:.45;cursor:default}button:hover:enabled{background:#185b4c}.primary{background:#185b4c;border-color:#67c8a6}label{display:grid;gap:7px;font-size:12px;font-weight:600;margin-bottom:12px}input,select,textarea{width:100%;min-width:0;font-size:14px;font-weight:400}textarea{resize:vertical;line-height:1.6}select{max-width:100%}summary{cursor:pointer;font-size:13px;font-weight:600}details[open]>summary{margin-bottom:14px}pre{font-size:11px;overflow:auto;max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere}.pre-wrap{white-space:pre-wrap;overflow-wrap:anywhere}.preparation-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.workflow-card{border:1px solid #28534e;border-radius:10px;padding:18px;margin-bottom:16px;background:#091923}.workflow-card p{margin:10px 0}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.action-row span{font-size:12px;color:#a6c1b9}.message{padding:10px 14px;background:#10382c;border-radius:7px;font-size:13px;margin:0 0 12px}.message.error{background:#3a1720;color:#fecaca}.warning{color:#efcc87;background:#302b1a;padding:9px 12px;border-radius:6px;font-size:13px}.attachments-heading{margin:0}.refinement-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,42%);gap:24px;flex:1;min-height:0;overflow:hidden}.refinement-controls{overflow:auto;min-height:0;padding-right:8px}.refinement-preview{min-width:0;min-height:0;overflow:hidden}.document-switch{display:flex;gap:8px;margin:22px 0 14px}.document-switch button[aria-pressed=true]{border-color:#67c8a6;background:#185b4c}.working-document{margin-bottom:24px}.working-document fieldset{border:0;padding:0;min-width:0}.working-document :deep(.builder){height:auto;overflow:visible}.cv-change{display:grid;gap:7px;margin:16px 0;font-size:13px;white-space:pre-wrap}.cv-change del{background:#3a1720;padding:9px;text-decoration:none;color:#fecaca}.cv-change ins{background:#10382c;padding:9px;text-decoration:none;color:#a7f3d0}.review-heading{flex:0 0 auto}.review-heading .stage-heading{margin-bottom:10px}.review-heading details{max-height:25vh;overflow:auto;margin-bottom:10px}.tracking-stage :deep(.letter-workspace){height:650px}.preparation-stage :deep(.opportunity-context){overflow:visible}
@media(max-width:900px){.preparation-grid{grid-template-columns:1fr;gap:0}.refinement-stage{grid-template-columns:minmax(0,1fr) minmax(270px,38%);gap:12px}.stage-heading{flex-direction:column}}
@media(max-width:760px){.application-workspace{--mobile-application-tabs-height:48px;padding-bottom:var(--mobile-application-tabs-height)}.workspace-subtabs{position:fixed;inset-inline:0;bottom:var(--mobile-tabs-height,76px);z-index:36;height:48px;margin:0;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;background:#06141f;border-top:1px solid #24504e}.workspace-subtabs button{font-size:12px;white-space:nowrap;padding:7px;gap:4px}.stage-number{display:none}.workflow-body{padding:8px}.refinement-stage{display:flex;flex-direction:column;gap:10px}.refinement-controls{flex:1}.refinement-preview{flex:0 0 auto}.refinement-preview :deep(.inline-document-preview){min-height:0}.stage-heading{gap:10px}.stage-heading h2{font-size:20px}.workflow-card{padding:14px}.workflow-body input,.workflow-body textarea,.workflow-body select{font-size:16px}.workflow-body p{font-size:15px}.workflow-body--review{overflow:auto}.workflow-body--review :deep(.application-documents){min-height:430px;flex:1 0 auto}.review-heading details{max-height:180px}.tracking-stage{gap:12px}}
</style>
