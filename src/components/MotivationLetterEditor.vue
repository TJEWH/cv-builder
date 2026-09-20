<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import type { CvState } from '../types';
import type { ApplicationLetter, LetterReadiness, LetterTemplate } from '../letterTypes';
import { addIncomingDraft, contextChanges, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter,
  finalizedLetterRevision, finalizeLetter, letterContextVersion, letterFromEditableText, letterToEditableText, openLetterRevision, parseIncomingLetter, sameLetterContextInput, saveWorkingRevision, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import { createDraftingRepository, prepareDraftingContext, sanitizeDraftingInput } from '../composables/cloudDrafting';
import MotivationLetterPreview from './MotivationLetterPreview.vue';

const props = withDefaults(defineProps<{
  application: Application; cvState: CvState | null; client: SupabaseClient | null; userId: string; lang: string;
  publishCv?: () => Promise<Application | null>; active?: boolean;
}>(), { active: true });
const emit = defineEmits<{ change: [state: LetterReadiness] }>();
const record = ref<ApplicationLetter | null>(null);
const templates = ref<LetterTemplate[]>([]);
const error = ref('');
const notice = ref('');
const saveError = ref('');
const loaded = ref(false);
const busy = ref(false);
const importText = ref('');
const preparedContext = ref('');
const publishedContextId = ref('');
const preview = ref<InstanceType<typeof MotivationLetterPreview> | null>(null);
const exporting = ref(false);
const exportError = ref('');
const editorText = ref('');
const backupInput = ref<HTMLInputElement | null>(null);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
let epoch = 0;
const repository = () => createLetterRepository(localStorage, props.userId);
const cloudRepository = computed(() => createDraftingRepository(props.client, () => props.userId));
const selectedTemplate = computed(() => templates.value.find((item) => item.id === record.value?.templateId) || templates.value[0] || DEFAULT_LETTER_TEMPLATES[0]);
const context = computed(() => letterContextVersion(props.application, props.cvState, selectedTemplate.value,
  record.value?.language || props.lang, record.value?.instructions || '', record.value?.maxWords || selectedTemplate.value.maxWords));
const changes = computed(() => record.value ? contextChanges(record.value, context.value) : { content: false, theme: false });
const unresolved = computed(() => record.value ? unresolvedLetterPlaceholders(record.value.working, props.cvState?.contact || null) : []);
const ready = computed(() => Boolean(record.value && finalizedLetterRevision(record.value) && props.cvState && !changes.value.content && !changes.value.theme && !unresolved.value.length && !saveError.value));
const words = computed(() => record.value ? Object.values(record.value.working).join(' ').trim().split(/\s+/).filter(Boolean).length : 0);
const incoming = computed(() => record.value?.revisions.filter((item) => item.kind === 'generated').toReversed() || []);
const history = computed(() => record.value?.revisions.filter((item) => item.kind !== 'generated').toReversed() || []);
const describeError = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
function reload() {
  epoch++; loaded.value = false; record.value = null; busy.value = false; error.value = ''; notice.value = ''; saveError.value = ''; preparedContext.value = ''; publishedContextId.value = ''; importText.value = '';
  try {
    templates.value = repository().listTemplates();
    record.value = repository().load(props.application.id) || createApplicationLetter(props.userId, props.application.id, selectedTemplate.value, context.value, props.lang);
    loaded.value = true;
    persist();
  } catch (cause) { error.value = describeError(cause); }
}
function persist() {
  if (!loaded.value || !record.value) return;
  try {
    // Save under the record's own identity even if the surrounding workspace changes.
    createLetterRepository(localStorage, record.value.userId).save(record.value);
    saveError.value = '';
  } catch (cause) { saveError.value = `${text('Local save failed: ', 'Lokales Speichern fehlgeschlagen: ')}${describeError(cause)}`; }
}
watch([() => props.application.id, () => props.userId], reload, { immediate: true });
watch(record, persist, { deep: true, flush: 'sync' });
watch(() => record.value?.working, (content) => { editorText.value = content ? letterToEditableText(content) : ''; }, { deep: true, immediate: true, flush: 'sync' });
watch([record, ready, unresolved], () => emit('change', { record: record.value ? JSON.parse(JSON.stringify(record.value)) : null, ready: ready.value, unresolvedPlaceholders: unresolved.value }), { deep: true, immediate: true });
function reloadTemplates() {
  try { templates.value = repository().listTemplates(); }
  catch (cause) { error.value = describeError(cause); }
}
function templatesChangedInOtherTab(event: StorageEvent) {
  if (event.storageArea === localStorage && (event.key === null || event.key === `cv.letters.v1:${encodeURIComponent(props.userId || 'local')}:templates`)) reloadTemplates();
}
onMounted(() => { window.addEventListener('cv-letter-templates-updated', reloadTemplates); window.addEventListener('storage', templatesChangedInOtherTab); });
onBeforeUnmount(() => { epoch++; window.removeEventListener('cv-letter-templates-updated', reloadTemplates); window.removeEventListener('storage', templatesChangedInOtherTab); });
function updateText(value: string) {
  if (record.value) record.value = editLetter(record.value, letterFromEditableText(value));
  // Keep the caret and in-progress whitespace stable while typing.
  editorText.value = value;
}
function selectTemplate() {
  if (!record.value) return;
  record.value.maxWords = selectedTemplate.value.maxWords;
  record.value.language = selectedTemplate.value.language;
  record.value.finalRevisionId = null;
  preparedContext.value = '';
}
function reviewContext() {
  if (!record.value) return;
  record.value.workingContext = { ...context.value };
  record.value.finalRevisionId = null;
  notice.value = text('Context reviewed. Finalize the letter when the wording and layout are ready.', 'Kontext geprüft. Finalisieren Sie den Brief, sobald Text und Layout fertig sind.');
}
function finalize() {
  if (!record.value || !props.cvState) return;
  try {
    error.value = '';
    record.value = finalizeLetter(record.value, context.value, props.cvState.contact);
    notice.value = text('Final revision saved locally and ready for the application package.', 'Endgültige Revision lokal gespeichert und bereit für die Bewerbungsmappe.');
  } catch (cause) { error.value = describeError(cause); }
}
function saveRevision() {
  if (!record.value) return;
  record.value = saveWorkingRevision(record.value);
  notice.value = text('Working revision saved.', 'Arbeitsrevision gespeichert.');
}
function openRevision(id: string) {
  if (!record.value) return;
  record.value = openLetterRevision(record.value, id);
  notice.value = text('Revision opened. Your previous working text is preserved in history.', 'Revision geöffnet. Ihr bisheriger Text bleibt im Verlauf erhalten.');
}
function importDraft() {
  if (!record.value || !importText.value.trim()) return;
  try {
    error.value = '';
    record.value = addIncomingDraft(record.value, parseIncomingLetter(importText.value), context.value);
    importText.value = '';
    notice.value = text('Draft added to incoming drafts. Open it explicitly to edit; current text is preserved.', 'Entwurf hinzugefügt. Öffnen Sie ihn zum Bearbeiten; der aktuelle Text bleibt erhalten.');
  } catch (cause) { error.value = describeError(cause); }
}
function draftingInput() {
  if (!record.value) throw new Error('Letter is unavailable.');
  return { template: selectedTemplate.value, language: record.value.language, instructions: record.value.instructions, maxWords: record.value.maxWords };
}
function prepareContext() {
  if (!props.cvState || !record.value) return;
  try {
    error.value = '';
    preparedContext.value = JSON.stringify(prepareDraftingContext({ application: props.application, cvState: props.cvState, ...draftingInput() }), null, 2);
    publishedContextId.value = '';
  } catch (cause) { error.value = describeError(cause); }
}
async function publishContext() {
  if (!props.client || !props.publishCv || !props.cvState || !record.value) return;
  const token = epoch;
  const applicationId = props.application.id;
  const cloud = cloudRepository.value;
  // Capture the version now. Concurrent edits will correctly mark a returned draft as stale.
  const version = { ...context.value };
  busy.value = true; error.value = '';
  try {
    const input = sanitizeDraftingInput(draftingInput(), props.cvState);
    const expected = prepareDraftingContext({ application: props.application, cvState: props.cvState, ...draftingInput() });
    const application = await props.publishCv();
    if (token !== epoch) return;
    if (!application) throw new Error('The application CV could not be published. Review the CV tab and retry.');
    const published = await cloud.publishContext(applicationId, input);
    if (token !== epoch || !record.value) return;
    const sourceMatches = published.cv_variant_id === application.cv_variant_id
      && sameLetterContextInput(published.context_json.opportunity, expected.opportunity)
      && sameLetterContextInput(published.context_json.cv.content, expected.cv.content)
      && sameLetterContextInput(published.context_json.cv.theme, expected.cv.theme);
    // Another tab can publish or refresh research concurrently. Unknown source
    // versions require explicit review instead of claiming the local text matches.
    record.value.publishedContexts[published.id] = sourceMatches ? version : { content: `cloud:${published.id}`, theme: '' };
    publishedContextId.value = published.id;
    preparedContext.value = JSON.stringify({ contextId: published.id, applicationId, ...published.context_json }, null, 2);
    notice.value = text('Anonymized context published. Share its ID with ChatGPT through your configured Supabase connection, or copy the context. Import the returned draft or refresh cloud drafts.', 'Anonymisierten Kontext veröffentlicht. Teilen Sie die ID über Ihre konfigurierte Supabase-Verbindung mit ChatGPT oder kopieren Sie den Kontext. Importieren Sie anschließend den Entwurf oder aktualisieren Sie die Cloud-Entwürfe.');
  } catch (cause) { if (token === epoch) error.value = `${text('Cloud publishing failed: ', 'Cloud-Veröffentlichung fehlgeschlagen: ')}${describeError(cause)}`; }
  finally { if (token === epoch) busy.value = false; }
}
async function refreshDrafts() {
  if (!props.client || !record.value) return;
  const token = epoch, applicationId = props.application.id;
  const cloud = cloudRepository.value;
  busy.value = true; error.value = '';
  try {
    const drafts = await cloud.listDrafts(applicationId);
    if (token !== epoch || !record.value) return;
    let updated = record.value;
    for (const draft of drafts) updated = addIncomingDraft(updated, parseIncomingLetter(draft.body), updated.publishedContexts[draft.context_id] || { content: `cloud:${draft.context_id}`, theme: '' }, { cloudDraftId: draft.id, cloudContextId: draft.context_id });
    record.value = updated;
    notice.value = drafts.length ? text('Cloud drafts loaded into incoming drafts. Your edits are unchanged.', 'Cloud-Entwürfe geladen. Ihre Bearbeitungen bleiben erhalten.') : text('No cloud drafts yet. Publish a context and use the configured ChatGPT Action, or import a draft below.', 'Noch keine Cloud-Entwürfe. Veröffentlichen Sie einen Kontext und verwenden Sie die konfigurierte ChatGPT-Action oder importieren Sie einen Entwurf.');
  } catch (cause) { if (token === epoch) error.value = `${text('Could not load cloud drafts: ', 'Cloud-Entwürfe konnten nicht geladen werden: ')}${describeError(cause)}`; }
  finally { if (token === epoch) busy.value = false; }
}
function download(content: string | Blob, filename: string, mime = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyContext() {
  try { await navigator.clipboard.writeText(preparedContext.value); notice.value = text('Context copied.', 'Kontext kopiert.'); }
  catch { error.value = text('Clipboard unavailable. Select the context text or download its JSON file.', 'Zwischenablage nicht verfügbar. Wählen Sie den Kontexttext aus oder laden Sie die JSON-Datei herunter.'); }
}
function exportBackup() {
  try { download(repository().exportLetter(props.application.id), `motivation-letter-${props.application.id}.json`); }
  catch (cause) { error.value = describeError(cause); }
}
async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0], token = epoch;
  if (!file) return;
  try {
    const raw = await file.text();
    if (token !== epoch) return;
    record.value = repository().importLetter(raw, props.application.id);
    notice.value = text('Local letter backup restored.', 'Lokale Briefsicherung wiederhergestellt.');
  } catch (cause) { if (token === epoch) error.value = describeError(cause); }
  finally { input.value = ''; }
}
async function getPdfBlob() {
  if (!ready.value || !preview.value) throw new Error('Finalize and review the motivation letter before exporting the application package.');
  const token = epoch;
  const version = JSON.stringify([record.value!.finalRevisionId, record.value!.working, context.value]);
  const stillFinal = () => token === epoch && ready.value && version === JSON.stringify([record.value!.finalRevisionId, record.value!.working, context.value]);
  await nextTick();
  if (!stillFinal() || !preview.value) throw new Error('The letter changed before export. Review and finalize it again.');
  const blob = await preview.value.getPdfBlob();
  if (!stillFinal()) throw new Error('The letter changed during export. Review and finalize it again.');
  return blob;
}
async function exportPdf() {
  if (exporting.value) return;
  exporting.value = true;
  try { error.value = ''; exportError.value = ''; download(await getPdfBlob(), 'motivation-letter.pdf'); }
  catch (cause) { error.value = exportError.value = describeError(cause); }
  finally { exporting.value = false; }
}
defineExpose({ getPdfBlob, getRenderElement: () => preview.value?.getRenderElement() || null });
</script>

<template>
  <section class="letter-workspace">
    <div class="letter-editor-controls">
    <header class="letter-workspace-heading"><div><h2>{{ text('Motivation letter', 'Motivationsschreiben') }}</h2><p>{{ text('Draft, revise and finalize this application’s letter. Private edits are saved on this device.', 'Entwerfen, überarbeiten und finalisieren Sie das Schreiben. Private Änderungen werden auf diesem Gerät gespeichert.') }}</p></div><span class="letter-status" :class="{ complete: ready }">{{ ready ? text('Finalized', 'Finalisiert') : text('Working draft', 'Arbeitsentwurf') }}</span></header>
    <p v-if="error || saveError" role="alert" class="letter-alert">{{ error || saveError }}</p>
    <p v-if="notice" role="status" class="letter-notice">{{ notice }}</p>
    <p v-if="!cvState" class="letter-warning">{{ text('Assign a CV in the CV tab to prepare context, match the letter styling and export.', 'Weisen Sie im Tab Lebenslauf einen Lebenslauf zu, um Kontext, Gestaltung und Export zu verwenden.') }}</p>
    <template v-if="record">
      <div v-if="changes.content || changes.theme" class="letter-warning"><strong>{{ changes.content ? text('Context changed — review recommended.', 'Kontext geändert — Prüfung empfohlen.') : text('CV styling changed — review the letter layout.', 'Lebenslaufgestaltung geändert — Brieflayout prüfen.') }}</strong><button type="button" @click="reviewContext">{{ text('Mark context reviewed', 'Kontext als geprüft markieren') }}</button></div>
      <details class="letter-context" open>
        <summary>{{ text('Drafting context', 'Kontext für den Entwurf') }}</summary>
        <div class="letter-context-grid">
          <label>{{ text('Letter template', 'Briefvorlage') }}<select v-model="record.templateId" @change="selectTemplate"><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }} · r{{ template.revision }}</option></select></label>
          <label>{{ text('Language', 'Sprache') }}<select v-model="record.language"><option value="en">English</option><option value="de">Deutsch</option></select></label>
          <label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="record.maxWords" type="number" min="50" max="2000" /></label>
        </div>
        <label>{{ text('Application-specific drafting guidance', 'Bewerbungsspezifische Schreibhinweise') }}<textarea v-model="record.instructions" rows="2" maxlength="16000" :placeholder="text('Emphasize relevant experience, motivation, or a requirement…', 'Relevante Erfahrungen, Motivation oder Anforderungen hervorheben…')" /></label>
        <p class="letter-help">{{ text('The context includes opportunity research, the anonymized application CV, template and styling. Review the prepared context before sharing. No private letter text is uploaded automatically.', 'Der Kontext enthält Stellenrecherche, anonymisierten Bewerbungslebenslauf, Vorlage und Gestaltung. Prüfen Sie ihn vor dem Teilen. Privater Brieftext wird nicht automatisch hochgeladen.') }}</p>
        <div class="letter-actions"><button type="button" :disabled="!cvState" @click="prepareContext">{{ text('Prepare shareable context', 'Teilbaren Kontext vorbereiten') }}</button><button type="button" :disabled="busy || !client || !publishCv || !cvState" @click="publishContext">{{ busy ? text('Working…', 'Wird bearbeitet…') : text('Publish context to Supabase', 'Kontext in Supabase veröffentlichen') }}</button><button type="button" :disabled="busy || !client" @click="refreshDrafts">{{ text('Refresh cloud drafts', 'Cloud-Entwürfe aktualisieren') }}</button></div>
        <p class="letter-help">{{ text('ChatGPT needs a configured Supabase connection or authenticated Action to read published context. Publishing does not run a model. Copy context and paste a returned draft for a manual workflow.', 'ChatGPT benötigt eine konfigurierte Supabase-Verbindung oder authentifizierte Action zum Lesen des Kontexts. Veröffentlichen startet kein Modell. Für den manuellen Ablauf kopieren Sie den Kontext und fügen einen Entwurf ein.') }}</p>
        <div v-if="preparedContext" class="prepared-context"><p v-if="publishedContextId" class="letter-context-id">{{ text('Published context ID:', 'Veröffentlichte Kontext-ID:') }} <code>{{ publishedContextId }}</code><br />{{ text('Application ID:', 'Bewerbungs-ID:') }} <code>{{ application.id }}</code></p><label>{{ text('Anonymized context to share', 'Anonymisierter Kontext zum Teilen') }}<textarea :value="preparedContext" readonly rows="9" /></label><div class="letter-actions"><button type="button" @click="copyContext">{{ text('Copy context', 'Kontext kopieren') }}</button><button type="button" @click="download(preparedContext, 'letter-drafting-context.json')">{{ text('Download context', 'Kontext herunterladen') }}</button></div></div>
      </details>
        <div class="letter-writing">
          <label>{{ text('Complete letter text', 'Vollständiger Brieftext') }}<textarea :value="editorText" rows="20" @input="updateText(($event.target as HTMLTextAreaElement).value)" /></label>
          <p class="letter-help">{{ text('Edit the complete letter, including its subject, greeting and sign-off. Start a subject with “# ” to style it as a heading. The template supplies instructions for drafting these parts.', 'Bearbeiten Sie den gesamten Brief einschließlich Betreff, Anrede und Grußformel. Beginnen Sie einen Betreff mit „# “, um ihn als Überschrift zu gestalten. Die Vorlage enthält die Schreibhinweise für diese Teile.') }}</p>
          <div class="letter-word-count">{{ words }} / {{ record.maxWords }} {{ text('target words', 'Zielwörter') }} · {{ saveError ? text('Not saved', 'Nicht gespeichert') : text('Saved locally', 'Lokal gespeichert') }}</div>
          <p v-if="unresolved.length" class="letter-warning">{{ text('Unresolved placeholders:', 'Nicht ausgefüllte Platzhalter:') }} {{ unresolved.join(', ') }}</p>
          <div class="letter-actions"><button type="button" @click="saveRevision">{{ text('Save revision', 'Revision speichern') }}</button><button type="button" class="letter-primary" :disabled="!cvState || !record.working.body.trim() || unresolved.length > 0 || !!saveError" @click="finalize">{{ text('Finalize letter', 'Brief finalisieren') }}</button><button type="button" :disabled="!ready" @click="exportPdf">{{ text('Download PDF', 'PDF herunterladen') }}</button></div>
          <details class="letter-import"><summary>{{ text('Import a generated draft', 'Generierten Entwurf importieren') }}</summary><p class="letter-help">{{ text('Paste plain text or JSON with subject, salutation, body and closing. Imported drafts appear below without replacing your current letter.', 'Fügen Sie Text oder JSON mit subject, salutation, body und closing ein. Importierte Entwürfe ersetzen Ihren aktuellen Brief nicht.') }}</p><textarea v-model="importText" rows="5" :aria-label="text('Draft to import', 'Zu importierender Entwurf')" /><button type="button" :disabled="!importText.trim()" @click="importDraft">{{ text('Add incoming draft', 'Eingehenden Entwurf hinzufügen') }}</button></details>
          <details v-if="incoming.length" open class="letter-history"><summary>{{ text('Incoming drafts', 'Eingehende Entwürfe') }} ({{ incoming.length }})</summary><div v-for="revision in incoming" :key="revision.id" class="letter-history-row"><div><strong>{{ revision.content.subject || text('Generated draft', 'Generierter Entwurf') }}</strong><small>{{ new Date(revision.createdAt).toLocaleString() }} · {{ revision.cloudDraftId ? 'Supabase' : text('Imported', 'Importiert') }}</small><p>{{ revision.content.body.slice(0, 150) }}{{ revision.content.body.length > 150 ? '…' : '' }}</p></div><button type="button" @click="openRevision(revision.id)">{{ text('Open for editing', 'Zum Bearbeiten öffnen') }}</button></div></details>
          <details v-if="history.length" class="letter-history"><summary>{{ text('Revision history', 'Revisionsverlauf') }} ({{ history.length }})</summary><div v-for="revision in history" :key="revision.id" class="letter-history-row"><div><strong>{{ revision.kind === 'final' ? text('Final revision', 'Endgültige Revision') : text('Working revision', 'Arbeitsrevision') }}</strong><small>{{ new Date(revision.createdAt).toLocaleString() }}</small></div><button type="button" @click="openRevision(revision.id)">{{ text('Open revision', 'Revision öffnen') }}</button></div></details>
          <div class="letter-actions letter-backups"><button type="button" @click="exportBackup">{{ text('Back up letter and history', 'Brief und Verlauf sichern') }}</button><button type="button" @click="backupInput?.click()">{{ text('Restore backup', 'Sicherung wiederherstellen') }}</button><input ref="backupInput" hidden type="file" accept=".json,application/json" @change="restoreBackup" /></div>
        </div>
    </template>
    </div>
    <MotivationLetterPreview v-if="record" ref="preview" class="letter-live-preview" :cv-state="cvState" :content="record.working" :active="active" :lang="lang" :download-disabled="!ready" :downloading="exporting" :download-error="exportError" @download="exportPdf" />
  </section>
</template>

<style scoped>
.letter-workspace{font-family:system-ui;color:#d1fae5;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;min-width:0;min-height:0;overflow:hidden}
.letter-editor-controls{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:4px}
.letter-workspace-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}
.letter-workspace h2{font:700 22px/1.3 system-ui;text-transform:none;letter-spacing:0;color:#d1fae5;margin:0 0 7px}
.letter-workspace p{font-size:13px;color:#a6c1b9;margin:0;line-height:1.6}
.letter-status{border-radius:20px;padding:6px 12px;font-size:12px;background:#16342f;white-space:nowrap}
.letter-status.complete{background:#185b4c;color:#d1fae5}
.letter-workspace :is(.letter-alert,.letter-notice,.letter-warning){background:#3a1720;border:1px solid #733844;color:#fecaca;padding:12px 14px;border-radius:8px;margin-bottom:15px;font-size:13px}
.letter-workspace .letter-notice{background:#10382c;color:#b5e3cb;border-color:#285b42}
.letter-workspace .letter-warning{background:#352d19;border-color:#685833;color:#e9d294}
.letter-warning button{margin-left:12px;background:transparent;padding:6px 10px;font-size:12px}
.letter-workspace :is(button,input,textarea,select){font:400 13px/1.5 system-ui;color:#d1fae5;background:#0b1b25;border:1px solid #28534e;border-radius:7px;padding:9px 11px}
button{font-weight:600;cursor:pointer}
button:hover:enabled{background:#14352e}button:disabled{opacity:.45;cursor:not-allowed}
input,textarea,select{box-sizing:border-box;width:100%;min-width:0}
textarea{resize:vertical}
.letter-workspace label{display:grid;gap:6px;font:600 12px/1.5 system-ui;color:#d1fae5}
details{padding:10px 0;margin-bottom:16px}
summary{cursor:pointer;font-size:13px;font-weight:700;list-style-position:inside}
details[open]>summary{margin-bottom:14px}
.letter-context-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px;margin-bottom:14px}
.letter-workspace .letter-help{font-size:12px;margin:10px 0;color:#a6c1b9}
.letter-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.letter-workspace .letter-primary{background:#185b4c;border-color:#67c8a6;color:#effff6}
.letter-workspace .letter-primary:hover:enabled{background:#226e5c}
.prepared-context{margin-top:16px}.prepared-context textarea{font:11px/1.5 ui-monospace,monospace}.prepared-context .letter-actions{margin-top:10px}.letter-context-id{margin-bottom:12px;overflow-wrap:anywhere}
.letter-writing{display:grid;gap:14px;min-width:0}
.letter-word-count{font-size:11px;color:#a6c1b9}
.letter-live-preview{min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.letter-history,.letter-import{margin:0}
.letter-import button{margin-top:10px}
.letter-history-row{padding:12px 0;display:flex;gap:12px;align-items:start;border-top:1px solid #28534e;font-size:12px}
.letter-history-row>div{flex:1;min-width:0}.letter-history-row small{display:block;color:#a6c1b9;margin:5px 0}.letter-history-row p{font-size:12px}.letter-history-row button{flex-shrink:0;font-size:11px;padding:6px 8px}
.letter-backups button{font-size:11px;padding:6px 8px}
@media(max-width:1180px){.letter-workspace{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(240px,42%)}}
@media(max-width:760px), (max-width:1180px) and (max-height:600px){.letter-workspace{display:flex;flex-direction:column}.letter-editor-controls{flex:1;padding:0}.letter-live-preview{flex:0 0 auto;height:auto}.letter-context-grid{grid-template-columns:1fr}.letter-workspace-heading{flex-direction:column;gap:10px}.letter-warning button{margin:8px 0 0;display:block}}
@media(max-width:760px){
  .letter-editor-controls{padding:0;border:0;border-radius:0;background:transparent}
  .letter-workspace-heading{flex-direction:row;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .letter-workspace-heading>div{flex:1 1 220px}
  .letter-workspace h2{font-size:18px}
  .letter-status{padding:0;border-radius:0;background:transparent}
  .letter-status.complete{background:transparent;color:#9ee6c7}
  details{padding:10px 0;border:0;border-radius:0;background:transparent;margin-bottom:12px}
  .letter-history-row{flex-wrap:wrap;gap:8px}
  .letter-history-row>div{flex-basis:100%}
}
</style>
