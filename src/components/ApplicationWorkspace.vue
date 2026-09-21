<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import type { CvState, SavedConfiguration } from '../types';
import type { ApplicationCvRecord } from '../composables/applicationCv';
import { cloneCv, createApplicationCv, cvDifferences, isApplicationCvPublished, loadApplicationCv, saveApplicationCv } from '../composables/applicationCv';
import { createCloudCvSnapshot } from '../composables/cloudCvPrivacy';
import { rootVariantId } from '../composables/careerVariants';
import CvAdjustmentWorkflow from './CvAdjustmentWorkflow.vue';
import DocumentCvPreview from './DocumentCvPreview.vue';
import MotivationLetterEditor from './MotivationLetterEditor.vue';
import ApplicationDocuments from './ApplicationDocuments.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';

const props = defineProps<{
  application: Application; client: SupabaseClient | null; userId: string; lang: string;
  configurations: SavedConfiguration[]; readVersion: (id: string) => CvState | null;
  publishCv: (state: CvState) => Promise<Application | null>;
  createSubvariant?: (sourceId: string, name: string, state: CvState) => string | null;
}>();
const emit = defineEmits<{ close: []; 'edit-variant': [id: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const navigationKey = `CV_APPLICATION_TAB:${props.userId}:${props.application.id}`;
const tabs = ['overview', 'cv', 'letter', 'documents'] as const;
type Tab = typeof tabs[number];
const tab = ref<Tab>('overview');
try { const cached = sessionStorage.getItem(navigationKey); if (tabs.includes(cached as Tab)) tab.value = cached as Tab; } catch { /* Navigation can work without storage. */ }
watch(tab, (value) => { try { sessionStorage.setItem(navigationKey, value); } catch { /* Optional preference. */ } });
const record = ref<ApplicationCvRecord | null>(null);
const privacyPreview = ref(false);
const error = ref('');
const saveError = ref('');
const notice = ref('');
const pendingBaseId = ref('');
const pendingSubId = ref('');
const preview = ref<InstanceType<typeof DocumentCvPreview> | null>(null);
const letter = ref<InstanceType<typeof MotivationLetterEditor> | null>(null);
const letterReady = ref(false);
const letterRevision = ref('');
const documentReadiness = ref({ included: 0, missing: 0 });
const publishing = ref(false);
const newVariantName = ref('');

const backupInput = ref<HTMLInputElement | null>(null);
const urls = new Set<string>();
let lastSaved = '';
let disposed = false;
try { record.value = loadApplicationCv(props.userId, props.application.id); lastSaved = JSON.stringify(record.value?.state ?? null); }
catch (e) { saveError.value = e instanceof Error ? e.message : String(e); }

function persist() {
  if (!record.value) return;
  try { saveApplicationCv(record.value); saveError.value = ''; }
  catch (e) { saveError.value = text('Local save failed. Your changes are still open: ', 'Lokales Speichern fehlgeschlagen. Änderungen bleiben geöffnet: ') + String(e); }
}
watch(() => record.value?.state, (state) => {
  const serialized = JSON.stringify(state ?? null);
  if (!record.value || serialized === lastSaved) return;
  record.value.revision++;
  record.value.updatedAt = new Date().toISOString();
  persist();
  if (!saveError.value) lastSaved = serialized;
}, { deep: true, flush: 'sync' });
const published = computed(() => Boolean(record.value && isApplicationCvPublished(record.value, props.application.cv_variant_id)));
const privacySnapshot = computed(() => record.value ? createCloudCvSnapshot(record.value.state) : null);
const roots = computed(() => props.configurations.filter(item => !item.parentId));
const subvariants = computed(() => props.configurations.filter(item => item.parentId === pendingBaseId.value));
const assignedVariant = computed(() => props.configurations.find(item => item.id === record.value?.variantId));
const missingVariant = computed(() => Boolean(record.value?.variantId && !assignedVariant.value));
const legacyAdjustments = computed(() => Boolean(record.value && !record.value.variantId && cvDifferences(record.value.baseState, record.value.state).length));

function syncSelection() {
  if (!record.value) return;
  pendingBaseId.value = rootVariantId(record.value.variantId || record.value.baseId, props.configurations);
  pendingSubId.value = record.value.variantId && record.value.variantId !== pendingBaseId.value ? record.value.variantId : '';
}
function syncAssignedVariant() {
  const target = record.value;
  if (!target) return;
  // Preserve tailored legacy copies until the user saves them as a subvariant.
  if (!target.variantId && !target.detached && !cvDifferences(target.baseState, target.state).length && props.configurations.some(item => item.id === target.baseId)) {
    target.variantId = target.baseId; persist();
  }
  if (!target.variantId) return;
  const variant = props.configurations.find(item => item.id === target.variantId);
  const current = variant && props.readVersion(variant.id);
  if (current && cvDifferences(target.state, current).length) target.state = cloneCv(current);
}
watch(() => props.configurations, () => {
  try { syncAssignedVariant(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}, { deep: true, immediate: true });
watch([() => record.value?.variantId, () => record.value?.baseId, () => assignedVariant.value?.parentId], syncSelection, { immediate: true });
function selectBase() { pendingSubId.value = ''; }
function assignVariant(id: string) {
  const variant = props.configurations.find(item => item.id === id);
  const state = variant && props.readVersion(id);
  if (!variant || !state) throw new Error(text('Choose an available career variant.', 'Wähle eine verfügbare Karrierevariante.'));
  const rootId = rootVariantId(id, props.configurations);
  const root = props.configurations.find(item => item.id === rootId)!;
  const rootState = props.readVersion(rootId);
  if (!rootState) throw new Error('The original career variant is unavailable.');
  const next = createApplicationCv(props.userId, props.application.id, rootId, root.name, rootState);
  next.variantId = id; next.state = cloneCv(state);
  saveApplicationCv(next);
  lastSaved = JSON.stringify(next.state); record.value = next;
  error.value = ''; saveError.value = ''; syncSelection();
}
function assignBase() {
  try { assignVariant(pendingSubId.value || pendingBaseId.value); notice.value = text('CV selected. Edit this variant in CV Studio.', 'CV ausgewählt. Bearbeite diese Variante im CV-Studio.'); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
function createTailoredVariant(state = record.value?.state, open = true) {
  if (!record.value || !state) return null;
  const sourceId = record.value.variantId || record.value.baseId;
  const name = newVariantName.value.trim() || String(props.application.context_json.title || text('Application', 'Bewerbung'));
  const id = props.createSubvariant?.(sourceId, name, cloneCv(state));
  if (!id) throw new Error(text('The subvariant could not be saved. Choose an existing parent in CV Studio first.', 'Die Untervariante konnte nicht gespeichert werden. Wähle zuerst eine vorhandene Basis im CV-Studio.'));
  // The parent callback updates the library synchronously, while props arrive next tick.
  const target = { ...record.value, variantId: id, state: cloneCv(state), detached: false };
  saveApplicationCv(target); record.value = target; syncSelection();
  newVariantName.value = '';
  if (open) emit('edit-variant', id);
  return id;
}
function editSubvariant() {
  try { createTailoredVariant(); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
function acceptAdjustedCv(state: CvState) {
  try {
    if (!record.value || !cvDifferences(record.value.state, state).length) { notice.value = text('No changes: the selected variant is still used.', 'Keine Änderungen: Die ausgewählte Variante wird weiter verwendet.'); return; }
    createTailoredVariant(state, false);
    notice.value = text('Adjustments saved as a subvariant. Review and edit it in CV Studio.', 'Anpassungen als Untervariante gespeichert. Prüfe und bearbeite sie im CV-Studio.');
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
async function publishCurrentCv() {
  if (!record.value || publishing.value) return null;
  persist();
  if (saveError.value) throw new Error(saveError.value);
  publishing.value = true; error.value = '';
  const target = record.value;
  const state = cloneCv(target.state);
  try {
    const result = await props.publishCv(state);
    if (disposed || record.value !== target) throw new Error('The application CV changed while publishing. Review the current copy and publish again.');
    if (!result) throw new Error(text('Could not publish the anonymized CV.', 'Der anonymisierte CV konnte nicht veröffentlicht werden.'));
    record.value.publishedState = state; record.value.publishedSnapshotId = result.cv_variant_id; persist();
    notice.value = text('Anonymized CV published. Full CV remains on this device.', 'Anonymisierter CV veröffentlicht. Vollständiger CV bleibt auf diesem Gerät.');
    return result;
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); throw e; }
  finally { publishing.value = false; }
}
async function publishFromButton() { try { await publishCurrentCv(); } catch { /* Inline error remains visible. */ } }
async function getCvPdf() {
  if (!record.value || !preview.value) throw new Error('The full CV is unavailable on this device.');
  persist(); if (saveError.value) throw new Error(saveError.value);
  const signature = JSON.stringify(record.value.state);
  const blob = await preview.value.getPdfBlob();
  if (disposed || signature !== JSON.stringify(record.value?.state)) throw new Error('The CV changed during export. Build the package again.');
  return blob;
}
async function getLetterPdf() {
  if (!letter.value) throw new Error('The motivation letter is unavailable.');
  return letter.value.getPdfBlob();
}
function downloadBackup() {
  if (!record.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'application-cv-backup', record: record.value }, null, 2)], { type: 'application/json' }));
  urls.add(url); const a = document.createElement('a'); a.href = url; a.download = `application-cv-${props.application.id}.json`; a.click();
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('This backup is too large.');
    const target = record.value;
    const previousState = JSON.stringify(target);
    const data = JSON.parse(await file.text());
    if (disposed || target !== record.value || previousState !== JSON.stringify(record.value)) throw new Error('The application changed while reading the backup. Restore it again when editing is complete.');
    if (data.kind !== 'application-cv-backup' || !data.record) throw new Error('Choose an application CV backup.');
    const raw = JSON.stringify({ ...data.record, userId: props.userId, applicationId: props.application.id });
    const parsed = loadApplicationCv(props.userId, props.application.id, { getItem: () => raw, setItem() {}, removeItem() {} });
    if (!parsed) throw new Error('The backup is empty.');
    // Imported content must be reviewed before being published in this application.
    parsed.publishedSnapshotId = null; parsed.publishedState = null;
    // A restored backup is kept intact until explicitly adopted into the variant library.
    delete parsed.variantId; parsed.detached = true;
    saveApplicationCv(parsed); lastSaved = JSON.stringify(parsed.state); record.value = parsed;
    saveError.value = ''; error.value = ''; notice.value = text('Application CV restored.', 'Bewerbungs-CV wiederhergestellt.');
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
}
onBeforeUnmount(() => { disposed = true; for (const url of urls) URL.revokeObjectURL(url); });
</script>

<template>
  <section class="application-workspace">
    <WorkspaceDetailHeader :title="String(application.context_json.title || text('Application', 'Bewerbung'))" :subtitle="String(application.context_json.institution || application.context_json.university || '')" :back-label="text('All applications', 'Alle Bewerbungen')" :status="application.status" @back="emit('close')">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      <template v-if="$slots['secondary-actions']" #secondary-actions><slot name="secondary-actions" /></template>
      <template #metadata><div class="application-workspace__readiness"><span>{{ record ? text('CV on this device', 'CV auf diesem Gerät') : text('Local CV missing', 'Lokaler CV fehlt') }}</span><span>{{ letterReady ? text('Letter finalized', 'Schreiben finalisiert') : text('Letter in preparation', 'Schreiben in Vorbereitung') }}</span><span>{{ documentReadiness.missing ? text(`${documentReadiness.missing} package item(s) missing`, `${documentReadiness.missing} Dokument(e) fehlen`) : text(`${documentReadiness.included} package items ready`, `${documentReadiness.included} Dokumente bereit`) }}</span></div></template>
    </WorkspaceDetailHeader>
    <nav class="workspace-subtabs" aria-label="Application sections"><button v-for="item in tabs" :key="item" class="btn" :class="{ 'is-active': tab === item }" :aria-pressed="tab === item" type="button" @click="tab = item">{{ ({overview: text('Overview', 'Übersicht'), cv: 'CV', letter: text('Motivation letter', 'Motivationsschreiben'), documents: text('Documents', 'Dokumente')})[item] }}<span v-if="item === 'documents'" class="workspace-subtabs__export-label">{{ text(' & export', ' & Export') }}</span></button></nav>
    <p v-if="saveError" class="workspace-error" role="alert">{{ saveError }} <button class="btn" @click="persist">{{ text('Retry save', 'Erneut speichern') }}</button></p>
    <p v-if="error" class="workspace-error" role="alert">{{ error }}</p><p v-if="notice" class="workspace-notice" role="status">{{ notice }}</p>
    <div v-show="tab === 'overview'" class="application-overview"><slot name="overview" /></div>
    <div v-show="tab === 'cv'" class="application-cv-layout">
      <section class="application-cv-editor">
        <div class="application-cv-picker">
          <h2>{{ text('Selected CV', 'Ausgewählter CV') }}</h2>
          <p>{{ text('Use a career variant as it is, or choose a subvariant for this application. All CV editing takes place in CV Studio.', 'Verwende eine Karrierevariante unverändert oder wähle eine Untervariante für diese Bewerbung. Alle CV-Änderungen erfolgen im CV-Studio.') }}</p>
          <div class="variant-selectors">
            <label>{{ text('Career variant', 'Karrierevariante') }}<select v-model="pendingBaseId" @change="selectBase"><option value="">{{ text('Choose a variant…', 'Variante wählen…') }}</option><option v-for="variant in roots" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
            <label v-if="pendingBaseId">{{ text('Subvariant', 'Untervariante') }}<select v-model="pendingSubId"><option value="">{{ text('Original variant', 'Originalvariante') }}</option><option v-for="variant in subvariants" :key="variant.id" :value="variant.id">{{ variant.name }}</option></select></label>
          </div>
          <button class="btn" type="button" :disabled="!pendingBaseId || (pendingSubId || pendingBaseId) === record?.variantId" @click="assignBase">{{ text('Use selected CV', 'Ausgewählten CV verwenden') }}</button>
          <p v-if="!roots.length">{{ text('Create a named career variant in CV Studio first.', 'Erstelle zuerst eine benannte Karrierevariante im CV-Studio.') }}</p>
          <template v-if="record">
            <p><strong>{{ assignedVariant?.name || record.baseName }}</strong> · {{ published ? text('Shared CV is up to date', 'Geteilter CV ist aktuell') : text('Privacy snapshot needs publishing', 'Datenschutz-Snapshot muss veröffentlicht werden') }}</p>
            <p v-if="legacyAdjustments">{{ text('Your previous application adjustments are preserved. Save them as a subvariant to continue editing in CV Studio.', 'Deine bisherigen Bewerbungsanpassungen bleiben erhalten. Speichere sie als Untervariante für die weitere Bearbeitung im CV-Studio.') }}</p>
            <p v-if="missingVariant" role="status">{{ text('The linked variant is missing. The last saved CV is preserved below; select an available variant or restore your backup.', 'Die verknüpfte Variante fehlt. Der zuletzt gespeicherte CV bleibt erhalten; wähle eine vorhandene Variante oder stelle ein Backup wieder her.') }}</p>
            <button v-if="assignedVariant" class="btn" type="button" @click="emit('edit-variant', assignedVariant.id)">{{ text('Edit in CV Studio', 'Im CV-Studio bearbeiten') }}</button>
            <div class="variant-copy"><label>{{ text('New subvariant name', 'Name der neuen Untervariante') }}<input v-model="newVariantName" :placeholder="String(application.context_json.title || '')" /></label><button class="btn" type="button" :disabled="!createSubvariant || missingVariant" @click="editSubvariant">{{ text('Create subvariant & edit', 'Untervariante erstellen & bearbeiten') }}</button></div>
            <p>{{ text('A subvariant belongs directly to one career variant. Copies of subvariants stay at the same level.', 'Eine Untervariante gehört direkt zu einer Karrierevariante. Kopien von Untervarianten bleiben auf derselben Ebene.') }}</p>
            <label class="privacy-toggle"><input v-model="privacyPreview" type="checkbox" />{{ text('Privacy preview', 'Datenschutz-Vorschau') }}</label>
            <details><summary>{{ text('Review privacy snapshot', 'Datenschutz-Snapshot prüfen') }}</summary><pre class="privacy-json">{{ JSON.stringify(privacySnapshot, null, 2) }}</pre></details>
            <button class="btn" type="button" :disabled="publishing || !!saveError" @click="publishFromButton">{{ publishing ? text('Publishing…', 'Veröffentlicht…') : text('Publish anonymized CV', 'Anonymisierten CV veröffentlichen') }}</button>
          </template>
        </div>
        <CvAdjustmentWorkflow v-if="record && assignedVariant" :key="assignedVariant.id" :state="record.state" :variant-id="assignedVariant.id" :application-id="application.id" :opportunity="application.context_json" :client="client" :user-id="userId" :lang="lang" @apply="acceptAdjustedCv" />
        <div class="local-backup-actions"><button v-if="record" class="btn" type="button" @click="downloadBackup">{{ text('Back up full application CV', 'Vollständigen Bewerbungs-CV sichern') }}</button><button class="btn" type="button" @click="backupInput?.click()">{{ text('Restore application CV', 'Bewerbungs-CV wiederherstellen') }}</button><input ref="backupInput" hidden type="file" accept=".json,application/json" @change="importBackup" /></div>
      </section>
      <DocumentCvPreview v-if="record" ref="preview" :state="record.state" :active="tab === 'cv'" :privacy="privacyPreview" class="application-cv-preview" />
      <aside v-else class="application-cv-empty"><p>{{ text('Assign a career variant to preview this application’s CV.', 'Weise eine Karrierevariante zu, um den Bewerbungs-CV anzusehen.') }}</p></aside>
    </div>
    <MotivationLetterEditor :active="tab === 'letter'" v-show="tab === 'letter'" ref="letter" :application="application" :cv-state="record?.state ?? null" :client="client" :user-id="userId" :lang="lang" :publish-cv="publishCurrentCv" @change="letterReady = $event.ready; letterRevision = JSON.stringify($event.record)" />
    <ApplicationDocuments v-show="tab === 'documents'" :application-id="application.id" :user-id="userId" :lang="lang" :cv-state="record?.state ?? null" :get-cv-pdf="getCvPdf" :get-letter-pdf="getLetterPdf" :letter-ready="letterReady" :letter-revision="letterRevision" @readiness="documentReadiness = $event" />
  </section>
</template>

<style scoped>
.application-workspace { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; padding:0; background:transparent; color:#d1fae5; }
.application-workspace__readiness { display:flex; flex-wrap:wrap; gap:8px 18px; font-size:12px; color:#a6c1b9; }
.application-workspace :deep(.workspace-detail-header) { background:transparent; }
.workspace-subtabs { flex-shrink:0; display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.workspace-subtabs .is-active { background:#185b4c; border-color:#67c8a6; color:#effff6; }
.application-overview { flex:1 1 auto; min-height:0; overflow:auto; overscroll-behavior:contain; }
.application-overview :deep(.opportunity-context__group) { padding:12px 0; border:0; border-radius:0; background:transparent; }
.application-overview :deep(.opportunity-context__field--fit) { padding:0; border:0; border-radius:0; background:transparent; }
.application-cv-layout { display:grid; flex:1 1 auto; min-height:0; grid-template-columns:minmax(0,1fr) 360px; gap:20px; overflow:hidden; }
.application-cv-editor { min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; padding-right:4px; }
.application-cv-preview { min-width:0; min-height:0; }
.application-cv-empty { color:#a6c1b9; }
.application-cv-picker { display:grid; gap:12px; margin-bottom:24px; }
.application-cv-picker h2 { font-size:18px; color:inherit; margin:0; }
.application-cv-picker p { font-size:13px; margin:0; line-height:1.6; color:#adc8be; }
.application-cv-picker label, .variant-copy label { display:grid; gap:6px; font-size:13px; }
.application-cv-picker > .btn { justify-self:start; }
.variant-selectors { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.variant-copy label { flex:1; min-width:150px; }
.application-cv-picker .privacy-toggle { display:flex; align-items:center; gap:8px; }
.privacy-toggle input { width:auto; }
.workspace-error { color:#fecaca; font-size:13px; }
.workspace-notice { color:#b5e3cb; font-size:13px; }
.privacy-json { max-height:320px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:11px; }
summary { cursor:pointer; font-size:13px; }
.local-backup-actions, .variant-copy { display:flex; flex-wrap:wrap; align-items:end; gap:8px; margin-top:12px; }
@media(max-width:1180px) { .application-cv-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) minmax(240px,42%); } }
@media(max-width:760px), (max-width:1180px) and (max-height:600px) {
  .application-cv-layout { grid-template-rows:minmax(0,1fr) auto; gap:10px; }
  .application-workspace__readiness { gap:6px 12px; }
  .workspace-subtabs { gap:6px; margin:8px 0; }
  .workspace-subtabs .btn { padding:8px; font-size:12px; }
  .application-cv-editor { padding-right:0; }
}
@media(max-width:480px) { .variant-selectors { grid-template-columns:minmax(0,1fr); } }
@media(max-width:760px) {
  .application-workspace { --mobile-application-tabs-height:48px; padding-bottom:var(--mobile-application-tabs-height); }
  .workspace-subtabs { position:fixed; inset-inline:0; bottom:var(--mobile-tabs-height,76px); z-index:36; height:var(--mobile-application-tabs-height); margin:0; padding:4px 8px; flex-wrap:nowrap; align-items:stretch; overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain; scrollbar-width:none; background:#06141f; border-top:1px solid #24504e; }
  .workspace-subtabs::-webkit-scrollbar { display:none; }
  .workspace-subtabs__export-label { display:none; }
  .workspace-subtabs .btn { flex:0 0 auto; white-space:nowrap; font-size:14px; }
  .application-overview, .application-cv-editor { padding-inline:8px; }
  .application-overview :deep(.opportunity-context__group + .opportunity-context__group) { border-top:1px solid #24504e; }
  .application-workspace :deep(.letter-editor-controls), .application-workspace :deep(.documents-controls) { padding-inline:8px; }
  .application-workspace__readiness { font-size:12px; gap:4px 8px; }
  .application-cv-picker p, .workspace-error, .workspace-notice { font-size:16px; }
  .application-cv-picker label, .variant-copy label { font-size:14px; }
  .application-workspace :deep(.letter-editor-controls p), .application-workspace :deep(.documents-controls p), .application-workspace :deep(.cv-adjustment-workflow p), .application-overview :deep(p) { font-size:16px; }
  .application-workspace :deep(.letter-editor-controls label), .application-workspace :deep(.documents-controls label), .application-workspace :deep(.cv-adjustment-workflow label), .application-overview :deep(label) { font-size:14px; }
  .application-cv-editor :deep(summary), .application-workspace :deep(.letter-editor-controls summary), .application-workspace :deep(.documents-controls summary) { font-size:16px; }
  .application-cv-editor :deep(details), .application-workspace :deep(.letter-editor-controls details) { padding-block:12px; border-top:1px solid #24504e; }
}
</style>
