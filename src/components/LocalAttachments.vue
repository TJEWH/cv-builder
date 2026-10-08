<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { faCloud, faCloudArrowUp, faLaptop, faTriangleExclamation, faPen } from '@fortawesome/free-solid-svg-icons';
import PreviewDialog from './PreviewDialog.vue';
import FullDocumentPreview from './FullDocumentPreview.vue';
import type { AttachmentMetadata, LocalDocument, LocalDocumentMetadata } from '../documentTypes';
import { LocalDocumentRepository, safeDocumentFilename, type LocalDocumentStorage } from '../composables/localDocuments';
import { createAttachmentMetadataRepository } from '../composables/attachmentMetadata';
import { usePdfBlobPreview } from '../composables/usePdfBlobPreview';

const props = withDefaults(defineProps<{ userId: string; lang?: string; client?: SupabaseClient | null; active?: boolean; storage?: LocalDocumentStorage }>(), { active: true, client: null });
const emit = defineEmits<{ changed: [] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
type Entry = { id: string; name: string; description?: string; local?: LocalDocumentMetadata; shared?: AttachmentMetadata };
const localDocuments = ref<LocalDocumentMetadata[]>([]);
const sharedDocuments = ref<AttachmentMetadata[]>([]);
const entries = computed<Entry[]>(() => {
  const byId = new Map<string, Entry>(sharedDocuments.value.map((shared) => [shared.id, { ...shared, shared }]));
  for (const local of localDocuments.value) {
    const shared = byId.get(local.id)?.shared;
    // Legacy names may be original filenames; only explicit metadata or approved cloud text is shareable.
    byId.set(local.id, { ...(local.description?.trim() ? local : shared || local), local, shared });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const connected = computed(() => !!props.userId && !!props.client);
const loading = ref(false);
const loadFailed = ref(false);
const cloudFailed = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const editingId = ref('');
const formVisible = ref(false);
const name = ref('');
const description = ref('');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dirty = ref(false);
const editingEntry = computed(() => entries.value.find((entry) => entry.id === editingId.value));
const attachmentForm = ref<HTMLFormElement | null>(null);
const previewDocument = shallowRef<LocalDocument | null>(null);
const previewUrl = ref('');
const previewName = computed(() => previewDocument.value?.name || '');
const previewPage = ref(1);
const previewPdfOpen = computed(() => props.active && previewDocument.value?.mimeType === 'application/pdf');
const { pages: previewPages, loading: previewLoading, error: previewError, retry: retryPreview } = usePdfBlobPreview(
  () => previewPdfOpen.value ? previewDocument.value!.blob : null,
);
let previewGeneration = 0;
let generation = 0;
let disposed = false;
const repository = () => new LocalDocumentRepository(props.userId, props.storage);
const cloudRepository = () => { const owner = props.userId; return props.client && owner ? createAttachmentMetadataRepository(props.client, () => owner) : null; };
const current = (token: number) => token === generation && !disposed;
function message(reason: unknown) { return reason instanceof Error ? reason.message : text('The operation failed. Please retry.', 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.'); }
function clearPreview() {
  previewGeneration++;
  previewDocument.value = null;
  previewPage.value = 1;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}
function changed() { emit('changed'); window.dispatchEvent(new Event('cv-local-documents-updated')); }
function resetForm() {
  editingId.value = ''; formVisible.value = false; name.value = ''; description.value = ''; file.value = null; dirty.value = false;
  if (fileInput.value) fileInput.value.value = '';
}
function edit(entry?: Entry) {
  if (busy.value) return;
  editingId.value = entry?.id || ''; name.value = entry?.description?.trim() ? entry.name : ''; description.value = entry?.description || '';
  file.value = null; dirty.value = false; formVisible.value = true; error.value = ''; notice.value = '';
  void nextTick(() => { attachmentForm.value?.scrollIntoView({ block: 'nearest' }); attachmentForm.value?.querySelector('input')?.focus({ preventScroll: true }); });
  if (fileInput.value) fileInput.value.value = '';
}
function chooseFile(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0] || null; dirty.value = true; }
function syncState(entry: Entry) {
  if (!entry.description?.trim()) return { icon: faTriangleExclamation, label: text('Add a description to share this entry', 'Zum Teilen eine Beschreibung ergänzen'), warning: true };
  if (!connected.value) return { icon: faLaptop, label: text('Saved on this device', 'Auf diesem Gerät gespeichert') };
  if (cloudFailed.value) return { icon: faTriangleExclamation, label: text('Cloud status unavailable', 'Cloud-Status nicht verfügbar'), warning: true };
  return entry.shared?.name === entry.name && entry.shared?.description === entry.description
    ? { icon: faCloud, label: text('Name and description saved to Supabase', 'Name und Beschreibung in Supabase gespeichert') }
    : { icon: faCloudArrowUp, label: text('Metadata not yet synced — edit and save to retry', 'Metadaten noch nicht synchronisiert — bearbeiten und erneut speichern'), warning: true };
}
async function load() {
  if (busy.value || disposed) return;
  const token = ++generation;
  const repo = repository(); const cloud = cloudRepository();
  loading.value = true; loadFailed.value = false; cloudFailed.value = false; error.value = '';
  const [local, remote] = await Promise.allSettled([repo.listDocuments(), cloud ? cloud.list() : Promise.resolve([])]);
  if (!current(token)) return;
  if (local.status === 'fulfilled') localDocuments.value = local.value;
  else { loadFailed.value = true; error.value = message(local.reason); }
  if (remote.status === 'fulfilled') sharedDocuments.value = remote.value;
  else { cloudFailed.value = true; error.value = text('Local files remain available. Could not load shared names and descriptions: ', 'Lokale Dateien bleiben verfügbar. Geteilte Namen und Beschreibungen konnten nicht geladen werden: ') + message(remote.reason); }
  loading.value = false;
  // A refresh never replaces an in-progress manual edit or unsynced local metadata.
  if (formVisible.value && editingId.value && !dirty.value && editingEntry.value) {
    name.value = editingEntry.value.description?.trim() ? editingEntry.value.name : ''; description.value = editingEntry.value.description || '';
  }
}
watch(() => [props.userId, props.client], () => {
  generation++; busy.value = false; localDocuments.value = []; sharedDocuments.value = []; resetForm(); clearPreview(); notice.value = '';
  void load();
}, { immediate: true });
watch(() => props.active, (active) => { if (active) void load(); else clearPreview(); });
function refreshIfActive() { if (props.active && !busy.value) void load(); }
onMounted(() => { window.addEventListener('focus', refreshIfActive); window.addEventListener('cv-local-documents-updated', refreshIfActive); });
onBeforeUnmount(() => { disposed = true; generation++; clearPreview(); window.removeEventListener('focus', refreshIfActive); window.removeEventListener('cv-local-documents-updated', refreshIfActive); });
async function save() {
  if (busy.value || loading.value || loadFailed.value) return;
  const token = generation; const repo = repository(); const cloud = cloudRepository();
  const nextName = name.value.trim(); const nextDescription = description.value.trim(); const nextFile = file.value;
  if (!nextName || !nextDescription) { error.value = text('Enter a name and description yourself before saving.', 'Vor dem Speichern einen Namen und eine Beschreibung selbst eingeben.'); return; }
  if (!editingId.value && !nextFile) { error.value = text('Choose a local PDF or image for this attachment.', 'Ein lokales PDF oder Bild für diesen Anhang auswählen.'); return; }
  busy.value = true; error.value = ''; notice.value = '';
  let localSaved = false;
  let cloudSaved = false;
  try {
    let id = editingId.value;
    const local = localDocuments.value.find((entry) => entry.id === id);
    if (nextFile) {
      const saved = id ? await repo.putDocumentFile(id, nextFile, nextName, nextDescription) : await repo.addDocument(nextFile, nextName, nextDescription);
      id = saved.id; localSaved = true;
      if (!current(token)) return;
      // Retain the generated ID if cloud syncing fails, so retrying cannot duplicate a file.
      editingId.value = id; file.value = null; if (fileInput.value) fileInput.value.value = '';
      localDocuments.value = [saved, ...localDocuments.value.filter((entry) => entry.id !== id)];
    } else if (local) {
      const saved = await repo.updateDocumentMetadata(id, nextName, nextDescription); localSaved = true;
      if (!current(token)) return;
      localDocuments.value = localDocuments.value.map((entry) => entry.id === id ? saved : entry);
    }
    if (!current(token)) return;
    if (cloud) {
      const saved = await cloud.save({ id, name: nextName, description: nextDescription });
      if (!current(token)) return;
      cloudSaved = true;
      sharedDocuments.value = [saved, ...sharedDocuments.value.filter((entry) => entry.id !== id)]; cloudFailed.value = false;
    } else if (!localSaved) throw new Error(text('The local file is unavailable. Attach it before saving offline.', 'Die lokale Datei fehlt. Zum Offline-Speichern zuerst hinzufügen.'));
    dirty.value = false; resetForm();
    notice.value = cloud ? text('Saved. Only your name and description were shared; the file stays on this device.', 'Gespeichert. Nur der eingegebene Name und die Beschreibung wurden geteilt; die Datei bleibt auf diesem Gerät.') : text('Attachment saved in this local profile. To use it in an account, sign in and add the file, name and description to that account’s library.', 'Anhang in diesem lokalen Profil gespeichert. Zur Verwendung in einem Konto anmelden und Datei, Name und Beschreibung zu dessen Bibliothek hinzufügen.');
  } catch (reason) {
    if (current(token)) error.value = (localSaved ? text('The file and your metadata are saved locally. Cloud sync failed; save again to retry. ', 'Datei und Metadaten sind lokal gespeichert. Cloud-Synchronisierung fehlgeschlagen; zum Wiederholen erneut speichern. ') : '') + message(reason);
  } finally {
    if (current(token)) { if (localSaved || cloudSaved) changed(); busy.value = false; }
  }
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeDocumentFilename(filename); anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadDocument(document: LocalDocument) {
  const extension = document.mimeType === 'application/pdf' ? 'pdf' : document.mimeType === 'image/png' ? 'png' : 'jpg';
  const matchingExtension = new RegExp(`\\.${extension === 'jpg' ? 'jpe?g' : extension}$`, 'i');
  download(document.blob, matchingExtension.test(document.name) ? document.name : `${document.name}.${extension}`);
}
function downloadPreview() { if (previewDocument.value) downloadDocument(previewDocument.value); }
async function useFile(entry: Entry, action: 'open' | 'download') {
  const token = generation; error.value = '';
  if (action === 'open') { clearPreview(); if (!props.active) return; }
  const previewToken = previewGeneration;
  const valid = () => current(token) && (action !== 'open' || (previewToken === previewGeneration && props.active));
  try {
    const document = await repository().getDocument(entry.id);
    if (!valid()) return;
    if (!document) throw new Error(text('This file is missing on this device. Edit the attachment to add it.', 'Diese Datei fehlt auf diesem Gerät. Zum Hinzufügen den Anhang bearbeiten.'));
    if (action === 'download') downloadDocument(document);
    else {
      if (document.mimeType !== 'application/pdf') previewUrl.value = URL.createObjectURL(document.blob);
      previewDocument.value = document;
    }
  } catch (reason) { if (valid()) error.value = message(reason); }
}
async function remove(entry: Entry) {
  if (!window.confirm(text(`Delete “${entry.name}” and its shared name and description? Applications using it will show a missing attachment. Back up the file first if needed.`, `„${entry.name}“ samt geteiltem Namen und Beschreibung löschen? Bewerbungen, die diesen Anhang verwenden, zeigen dann eine fehlende Datei an. Bei Bedarf vorher sichern.`))) return;
  const token = generation; const repo = repository(); const cloud = cloudRepository(); busy.value = true; error.value = ''; notice.value = '';
  try {
    // A cloud failure must leave the local original intact for retry and backup.
    if (cloud) await cloud.remove(entry.id);
    if (!current(token)) return;
    if (entry.local) await repo.removeDocument(entry.id);
    if (!current(token)) return;
    localDocuments.value = localDocuments.value.filter(({ id }) => id !== entry.id); sharedDocuments.value = sharedDocuments.value.filter(({ id }) => id !== entry.id);
    if (editingId.value === entry.id) resetForm(); clearPreview(); changed();
    notice.value = text('Attachment deleted. Existing package references are kept so missing files remain visible.', 'Anhang gelöscht. Bestehende Zusammenstellungen zeigen die fehlende Datei weiterhin an.');
  } catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
async function exportBackup() {
  const token = generation; busy.value = true; error.value = '';
  try { const blob = await repository().exportBackup(); if (current(token)) download(blob, `application-documents-backup-${new Date().toISOString().slice(0, 10)}.json`); }
  catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement; const backup = input.files?.[0]; input.value = '';
  if (!backup || !window.confirm(text('Restore local attachments and packages? Matching local records will be replaced. Cloud metadata is not changed.', 'Lokale Anhänge und Zusammenstellungen wiederherstellen? Passende lokale Einträge werden ersetzt. Cloud-Metadaten bleiben unverändert.'))) return;
  const token = generation; const repo = repository(); busy.value = true; error.value = '';
  try {
    const result = await repo.importBackup(backup); const documents = await repo.listDocuments(); if (!current(token)) return;
    localDocuments.value = documents; clearPreview(); resetForm(); changed(); notice.value = text(`Restored ${result.documents} local attachments. Save an entry to sync its manually approved name and description.`, `${result.documents} lokale Anhänge wiederhergestellt. Einen Eintrag speichern, um seinen manuell bestätigten Namen und seine Beschreibung zu synchronisieren.`);
  } catch (reason) { if (current(token)) error.value = message(reason); }
  finally { if (current(token)) busy.value = false; }
}
</script>

<template>
  <section class="local-attachments">
    <header class="attachments-heading"><div><p>{{ text('Keep reusable documents such as transcripts and recommendation letters here, then select them in step 3 (PDF review) of an application.', 'Wiederverwendbare Dokumente wie Leistungsübersichten und Empfehlungsschreiben hier verwalten und in Schritt 3 (PDF-Prüfung) einer Bewerbung auswählen.') }}</p></div><div class="actions backup-actions"><button type="button" :disabled="busy || loading || loadFailed" @click="exportBackup">{{ text('Back up files & packages', 'Dateien & Zusammenstellungen sichern') }}</button><label class="file-button">{{ text('Restore backup', 'Backup wiederherstellen') }}<input type="file" accept="application/json,.json" :disabled="busy || loading || loadFailed" @change="importBackup" /></label></div></header>
    <p class="privacy-note">{{ text('Files stay on this device. Enter the name and description yourself: only these two fields are saved to Supabase when signed in. File contents, filenames and file properties are not uploaded.', 'Dateien bleiben auf diesem Gerät. Name und Beschreibung selbst eingeben: Nur diese beiden Felder werden nach der Anmeldung in Supabase gespeichert. Dateiinhalte, Dateinamen und Dateieigenschaften werden nicht hochgeladen.') }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <div class="attachments-scroll group-panel__scroll-body">
      <div class="library-toolbar"><span>{{ text(`${entries.length} attachment(s)`, `${entries.length} Anhang/Anhänge`) }}</span><span v-if="loading" role="status">{{ text('Loading…', 'Laden…') }}</span></div>

      <p v-if="!loading && !entries.length" class="empty">{{ text('No attachments yet. Add a local file and give it a name and description.', 'Noch keine Anhänge. Eine lokale Datei hinzufügen und Name und Beschreibung eingeben.') }}</p>
      <ul class="attachment-list">
        <li v-for="entry in entries" :key="entry.id">
          <div class="attachment-copy">
            <h3>{{ entry.name }}</h3>
            <p class="attachment-description">{{ entry.description || text('Description missing — edit this existing attachment to add your own description.', 'Beschreibung fehlt — diesen bestehenden Anhang bearbeiten und eine eigene Beschreibung ergänzen.') }}</p>
            <div class="attachment-status">
              <span role="img" :title="entry.local ? text('File available on this device', 'Datei auf diesem Gerät vorhanden') : text('File missing on this device', 'Datei fehlt auf diesem Gerät')" :aria-label="entry.local ? text('File available on this device', 'Datei auf diesem Gerät vorhanden') : text('File missing on this device', 'Datei fehlt auf diesem Gerät')" :class="{ missing: !entry.local }"><font-awesome-icon :icon="['fas', entry.local ? 'folder-open' : 'link-slash']" aria-hidden="true" /></span>
              <span role="img" :title="syncState(entry).label" :aria-label="syncState(entry).label" :class="{ missing: syncState(entry).warning }"><font-awesome-icon :icon="syncState(entry).icon" aria-hidden="true" /></span>
            </div>
          </div>
          <div class="actions attachment-actions">
            <button type="button" :disabled="busy || loading" :aria-label="text('Edit', 'Bearbeiten')" :title="text('Edit', 'Bearbeiten')" @click="edit(entry)"><font-awesome-icon :icon="faPen" aria-hidden="true" /><span>{{ text('Edit', 'Bearbeiten') }}</span></button>
            <button type="button" :disabled="busy || !entry.local" :aria-label="text('Open', 'Öffnen')" :title="text('Open', 'Öffnen')" @click="useFile(entry, 'open')"><font-awesome-icon :icon="['fas', 'folder-open']" aria-hidden="true" /><span>{{ text('Open', 'Öffnen') }}</span></button>
            <button type="button" :disabled="busy || !entry.local" :aria-label="text('Download', 'Herunterladen')" :title="text('Download', 'Herunterladen')" @click="useFile(entry, 'download')"><font-awesome-icon :icon="['fas', 'download']" aria-hidden="true" /><span>{{ text('Download', 'Herunterladen') }}</span></button>
            <button type="button" :disabled="busy || loading || loadFailed" :aria-label="text('Delete', 'Löschen')" :title="text('Delete', 'Löschen')" @click="remove(entry)"><font-awesome-icon :icon="['fas', 'trash']" aria-hidden="true" /><span>{{ text('Delete', 'Löschen') }}</span></button>
          </div>
        </li>
      </ul>
      <button class="add-attachment-row" type="button" :disabled="busy || loading || loadFailed" @click="edit()"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ text('New attachment', 'Neuer Anhang') }}</button>
      <form v-if="formVisible" ref="attachmentForm" class="attachment-form" @submit.prevent="save">
        <h3>{{ editingId ? text('Edit attachment', 'Anhang bearbeiten') : text('New attachment', 'Neuer Anhang') }}</h3>
        <label>{{ text('Attachment name', 'Name des Anhangs') }}<input v-model="name" maxlength="200" required :disabled="busy" @input="dirty = true" /></label>
        <label>{{ text('Description', 'Beschreibung') }}<textarea v-model="description" maxlength="4000" rows="4" required :disabled="busy" @input="dirty = true" /><small>{{ text('Write the context you want to share, without copying private details you want to keep local.', 'Den gewünschten Kontext eingeben und private Angaben weglassen, die lokal bleiben sollen.') }}</small></label>
        <label>{{ editingEntry?.local ? text('Replace local file (optional)', 'Lokale Datei ersetzen (optional)') : text('Local PDF or image', 'Lokales PDF oder Bild') }}<input ref="fileInput" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" :required="!editingId" :disabled="busy" @change="chooseFile" /><small>{{ text('PDF, PNG or JPEG, up to 50 MB. Choosing a file never fills the name or description.', 'PDF, PNG oder JPEG, bis 50 MB. Die Dateiauswahl füllt Name und Beschreibung nicht aus.') }}</small></label>
        <p v-if="editingEntry && !editingEntry.local && !file" class="missing">{{ text('This attachment has no file on this device. Add the original file to use it in a PDF package.', 'Für diesen Anhang fehlt die Datei auf diesem Gerät. Zum Verwenden in einer PDF-Zusammenstellung die Originaldatei hinzufügen.') }}</p>
        <div class="actions"><button class="primary" type="submit" :disabled="busy || loading || loadFailed">{{ busy ? text('Saving…', 'Speichern…') : text('Save attachment', 'Anhang speichern') }}</button><button type="button" :disabled="busy" @click="resetForm">{{ text('Cancel', 'Abbrechen') }}</button></div>
      </form>

    </div>
    <FullDocumentPreview :model-value="previewPdfOpen" v-model:page="previewPage" :pages="previewPages" :is-updating="previewLoading" :title="previewName" :lang="lang || 'en'" :error="previewError" @update:model-value="(open) => { if (!open) clearPreview(); }" @download="downloadPreview">
      <template v-if="previewError" #header><button class="btn" type="button" @click="retryPreview">{{ text('Retry preview', 'Vorschau erneut versuchen') }}</button></template>
    </FullDocumentPreview>
    <PreviewDialog :model-value="!!previewUrl" :title="previewName" :lang="lang" @update:model-value="(open) => { if (!open) clearPreview(); }"><img v-if="previewUrl" class="attachment-image" :src="previewUrl" :alt="previewName" /></PreviewDialog>
  </section>
</template>

<style scoped>
.local-attachments{display:flex;flex-direction:column;height:100%;min-height:0;color:#d1fae5;font-family:var(--font-ui,system-ui)}
.attachments-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px}.attachments-heading h2{font:700 22px/1.3 system-ui;margin:0 0 8px;color:#d1fae5;text-transform:none;letter-spacing:0}.local-attachments p{font-size:13px;line-height:1.6;color:#a6c1b9;margin:0}.attachments-heading button{flex-shrink:0}
.local-attachments .privacy-note{margin-bottom:14px;padding:10px 12px;background:#102c28;border-left:3px solid #67c8a6}.attachments-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:4px}.library-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;margin-bottom:14px}
.local-attachments :is(button,input,textarea,.file-button){font:inherit;border:1px solid #28534e;border-radius:7px;background:#0b1b25;color:#d1fae5;padding:9px 12px;box-sizing:border-box}.local-attachments button,.file-button{font-size:12px;cursor:pointer;min-height:38px}.local-attachments button:hover:not(:disabled){background:#14352e}.local-attachments button:disabled{opacity:.5;cursor:not-allowed}.local-attachments :is(button,input,textarea):focus-visible{outline:2px solid #67c8a6;outline-offset:2px}.local-attachments .primary{background:#185b4c;border-color:#67c8a6}
.attachment-form{display:grid;gap:16px;padding:18px;background:#091f25;border:1px solid #28534e;border-radius:8px;margin:0 0 20px;max-width:760px}.attachment-form h3,.attachment-copy h3{font:600 15px/1.4 system-ui;margin:0;color:#d1fae5;text-transform:none;letter-spacing:0}.attachment-form label{display:grid;gap:7px;font:600 12px/1.4 system-ui;color:#d1fae5}.attachment-form :is(input,textarea){font:400 13px/1.5 system-ui;min-width:0;width:100%}.attachment-form textarea{resize:vertical}.attachment-form small{font-weight:400;color:#a6c1b9;line-height:1.5}
.attachment-list{padding:0;margin:0;list-style:none}.attachment-list li{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 0;border-bottom:1px solid #28534e}.attachment-copy{min-width:0}.attachment-copy h3{overflow-wrap:anywhere}.local-attachments .attachment-description{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}.attachment-copy small{display:block;font-size:11px;color:#a6c1b9;line-height:1.5;margin-top:4px}.local-attachments .missing{color:#f2c6a7}.actions{display:flex;gap:7px;flex-wrap:wrap}.attachment-list .actions{flex-shrink:0;flex-wrap:nowrap}.attachment-actions button{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}.attachment-status{display:flex;gap:12px;margin-top:8px;color:#9be8c7}.attachment-status [role=img]{display:inline-flex;align-items:center;justify-content:center;min-width:20px;min-height:24px}.local-attachments .error,.local-attachments .notice{padding:10px 12px;margin-bottom:14px;border-radius:7px;background:#3a1720;color:#fecaca;white-space:pre-line}.local-attachments .notice{background:#10382c;color:#b5e3cb}.local-attachments .empty{padding:20px 0}.backup-actions{flex-shrink:0;justify-content:flex-end}.backup-actions .file-button{display:inline-flex;align-items:center;white-space:nowrap}.local-attachments .add-attachment-row{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:0 0 16px;min-height:54px;padding:8px;border:0;border-top:1px dashed #2a6a60;border-bottom:1px dashed #2a6a60;border-radius:0;background:transparent;color:#9be8c7;font:inherit}.local-attachments .add-attachment-row:hover:not(:disabled){border-color:#27f3a2;background:rgba(16,185,129,.1)}.file-button input{position:absolute;width:1px;height:1px;opacity:0}.attachment-image{display:block;width:100%;height:100%;object-fit:contain}.file-button:focus-within{outline:2px solid #67c8a6;outline-offset:2px}
@media(max-width:850px){.attachment-list li{flex-direction:column}.attachment-list .actions{max-width:none}}@media(max-width:700px){.attachment-actions button{min-width:44px}.attachment-actions button span{display:none}.backup-actions{width:100%;justify-content:flex-end}.backup-actions button,.backup-actions .file-button{font-size:11px;padding:8px}.attachments-heading{flex-direction:column;gap:10px}.attachment-form{padding:12px}.attachments-scroll{padding-right:0}}
</style>
