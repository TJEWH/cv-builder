<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import PreviewDialog from './PreviewDialog.vue';
import type { CvState } from '../types';
import type { ApplicationPackageManifest, LocalDocumentMetadata, LocalPackageArchive, PackageCompositionResult } from '../documentTypes';
import { defaultPackageManifest, LocalDocumentRepository, newLocalId, safeDocumentFilename } from '../composables/localDocuments';
import { composeApplicationPackage, packageItemProblem } from '../composables/applicationPackage';

const props = defineProps<{
  applicationId: string;
  userId: string;
  lang: string;
  cvState: CvState | null;
  getCvPdf: () => Promise<Blob>;
  getLetterPdf: () => Promise<Blob>;
  letterReady: boolean;
  letterRevision?: string;
}>();
const emit = defineEmits<{ readiness: [value: { included: number; missing: number }] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const documents = ref<LocalDocumentMetadata[]>([]);
const archives = ref<LocalPackageArchive[]>([]);
const manifest = shallowRef<ApplicationPackageManifest>(defaultPackageManifest(props.applicationId));
const loading = ref(true);
const loadFailed = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const previewUrl = ref('');
const expanded = ref(false);
const composition = ref<PackageCompositionResult | null>(null);
const selectedLibraryId = ref('');
let generation = 0;
let previewGeneration = 0;
let disposed = false;
const repository = computed(() => new LocalDocumentRepository(props.userId));
const availableIds = computed(() => new Set(documents.value.map(({ id }) => id)));
const problems = computed(() => manifest.value.items.map((item) => ({ id: item.id, message: packageItemProblem(item, availableIds.value, !!props.cvState, props.letterReady) })).filter((problem) => problem.message));
const includedCount = computed(() => manifest.value.items.filter(({ included }) => included).length);
const libraryOptions = computed(() => documents.value.filter((document) => !manifest.value.items.some((item) => item.documentId === document.id)));
const canBuild = computed(() => !loading.value && !busy.value && !!includedCount.value && !problems.value.length);

function clearPreview() {
  expanded.value = false;
  previewGeneration++;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  composition.value = null;
}
function reportError(reason: unknown) { error.value = reason instanceof Error ? reason.message : text('The operation failed. Please retry.', 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.'); }
function itemLabel(item: ApplicationPackageManifest['items'][number]) {
  return item.kind === 'cv' ? text('Application CV', 'Bewerbungslebenslauf') : item.kind === 'letter' ? text('Motivation letter', 'Motivationsschreiben') : item.label;
}
function sizeLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

async function load() {
  const token = ++generation;
  const repo = repository.value;
  const applicationId = props.applicationId;
  loading.value = true; loadFailed.value = false; busy.value = false; error.value = ''; notice.value = ''; selectedLibraryId.value = '';
  documents.value = []; archives.value = []; manifest.value = defaultPackageManifest(applicationId); clearPreview();
  try {
    const [nextDocuments, nextManifest, nextArchives] = await Promise.all([repo.listDocuments(), repo.getManifest(applicationId), repo.listArchives(applicationId)]);
    if (token !== generation || disposed) return;
    documents.value = nextDocuments; manifest.value = nextManifest; archives.value = nextArchives;
  } catch (reason) { if (token === generation && !disposed) { loadFailed.value = true; reportError(reason); } }
  finally { if (token === generation && !disposed) loading.value = false; }
}
watch(() => [props.userId, props.applicationId], load, { immediate: true });
watch(() => [props.cvState, props.letterReady, props.letterRevision], clearPreview, { deep: true });
watch([includedCount, problems], () => emit('readiness', { included: includedCount.value, missing: problems.value.length }), { immediate: true });

async function perform(operation: (repo: LocalDocumentRepository, applicationId: string, token: number) => Promise<void>) {
  if (busy.value || loading.value || loadFailed.value) return;
  const token = generation;
  busy.value = true; error.value = ''; notice.value = '';
  try { await operation(repository.value, props.applicationId, token); }
  catch (reason) { if (token === generation && !disposed) reportError(reason); }
  finally { if (token === generation && !disposed) busy.value = false; }
}
function current(token: number) { return token === generation && !disposed; }
async function updateManifest(next: ApplicationPackageManifest) {
  await perform(async (repo, _applicationId, token) => {
    await repo.saveManifest(next);
    if (!current(token)) return;
    manifest.value = next; clearPreview();
  });
}
function toggleItem(id: string, included: boolean) {
  void updateManifest({ ...manifest.value, items: manifest.value.items.map((item) => item.id === id ? { ...item, included } : item) });
}
function moveItem(index: number, direction: number) {
  const items = manifest.value.items.slice();
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target]!, items[index]!];
  void updateManifest({ ...manifest.value, items });
}
function removeItem(id: string) { void updateManifest({ ...manifest.value, items: manifest.value.items.filter((item) => item.id !== id) }); }
function attachLibraryDocument() {
  const document = documents.value.find(({ id }) => id === selectedLibraryId.value);
  if (!document) return;
  void updateManifest({ ...manifest.value, items: [...manifest.value.items, { id: newLocalId(), kind: 'attachment', documentId: document.id, label: document.name, included: true }] });
  selectedLibraryId.value = '';
}
async function uploadDocuments(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  await perform(async (repo, applicationId, token) => {
    let nextManifest = structuredClone(manifest.value);
    let added = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        const document = await repo.addDocument(file, file.name);
        nextManifest = { ...nextManifest, items: [...nextManifest.items, { id: newLocalId(), kind: 'attachment', documentId: document.id, label: document.name, included: true }] };
        added++;
      } catch (reason) { failures.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Could not store file.'}`); }
    }
    // Files are already safely in the reusable library if saving the package fails.
    try { if (added) await repo.saveManifest(nextManifest); }
    finally {
      const [nextDocuments, storedManifest] = await Promise.all([repo.listDocuments(), repo.getManifest(applicationId)]);
      if (current(token)) {
        documents.value = nextDocuments;
        manifest.value = storedManifest;
        clearPreview();
      }
    }
    if (!current(token)) return;
    notice.value = text(`${added} file(s) saved on this device.`, `${added} Datei(en) auf diesem Gerät gespeichert.`);
    if (failures.length) error.value = failures.join('\n');
  });
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = safeDocumentFilename(filename); anchor.hidden = true;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // The browser must consume the navigation before the temporary URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function downloadOriginal(id: string) {
  await perform(async (repo, _applicationId, token) => {
    const document = await repo.getDocument(id);
    if (!document) throw new Error('This document is unavailable on this device. Restore its backup.');
    if (current(token)) downloadBlob(document.blob, document.name);
  });
}
async function deleteOriginal(document: LocalDocumentMetadata) {
  if (!window.confirm(text(`Delete “${document.name}” from this device? Applications using it will show a missing document. Download a backup first if needed.`, `„${document.name}“ von diesem Gerät löschen? Bewerbungen, die diese Datei verwenden, zeigen dann ein fehlendes Dokument an. Bei Bedarf vorher ein Backup herunterladen.`))) return;
  await perform(async (repo, _applicationId, token) => {
    await repo.removeDocument(document.id);
    if (!current(token)) return;
    documents.value = documents.value.filter(({ id }) => id !== document.id); clearPreview();
  });
}
async function buildPreview() {
  if (!canBuild.value) return;
  await perform(async (repo, _applicationId, token) => {
    clearPreview();
    const previewToken = previewGeneration;
    const result = await composeApplicationPackage(structuredClone(manifest.value), { cvReady: !!props.cvState, letterReady: props.letterReady, getCvPdf: props.getCvPdf, getLetterPdf: props.getLetterPdf, getDocument: (id) => repo.getDocument(id) });
    if (!current(token)) return;
    if (previewToken !== previewGeneration) { notice.value = text('Documents changed while creating the preview. Preview the package again to include the latest edits.', 'Die Dokumente wurden während der Vorschauerstellung geändert. Die Vorschau erneut erstellen, um die Änderungen einzuschließen.'); return; }
    composition.value = result;
    previewUrl.value = URL.createObjectURL(result.blob);
  });
}
async function deleteArchive(archive: LocalPackageArchive) {
  if (!window.confirm(text('Delete this archived PDF from this device? Download a copy or backup first if you need to keep it.', 'Dieses archivierte PDF von diesem Gerät löschen? Bei Bedarf vorher eine Kopie oder ein Backup herunterladen.'))) return;
  await perform(async (repo, _applicationId, token) => {
    await repo.removeArchive(archive.id);
    if (current(token)) archives.value = archives.value.filter(({ id }) => id !== archive.id);
  });
}
async function downloadPackage() {
  const result = composition.value;
  if (!result) return;
  await perform(async (repo, applicationId, token) => {
    const archive = await repo.archivePackage(applicationId, result.blob, result.pageCount, manifest.value.items.filter(({ included }) => included));
    if (!current(token)) return;
    archives.value.unshift(archive);
    downloadBlob(result.blob, archive.name);
    notice.value = text('Downloaded. A frozen copy is saved on this device.', 'Heruntergeladen. Eine unveränderliche Kopie ist auf diesem Gerät gespeichert.');
  });
}
async function exportBackup() {
  await perform(async (repo, _applicationId, token) => {
    const blob = await repo.exportBackup();
    if (current(token)) downloadBlob(blob, `application-documents-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  if (!window.confirm(text('Restore documents and package arrangements from this backup? Matching records will be replaced. Other files remain available.', 'Dokumente und Zusammenstellungen aus diesem Backup wiederherstellen? Übereinstimmende Einträge werden ersetzt. Andere Dateien bleiben verfügbar.'))) return;
  await perform(async (repo, applicationId, token) => {
    const restored = await repo.importBackup(file);
    const [nextDocuments, nextManifest, nextArchives] = await Promise.all([repo.listDocuments(), repo.getManifest(applicationId), repo.listArchives(applicationId)]);
    if (!current(token)) return;
    documents.value = nextDocuments; manifest.value = nextManifest; archives.value = nextArchives; clearPreview();
    notice.value = text(`Restored ${restored.documents} documents and ${restored.packages} package arrangements.`, `${restored.documents} Dokumente und ${restored.packages} Zusammenstellungen wiederhergestellt.`);
  });
}
onBeforeUnmount(() => { disposed = true; generation++; clearPreview(); });
</script>

<template>
  <section class="application-documents" :aria-label="text('Documents and export', 'Dokumente und Export')">
      <div class="documents-controls">
    <header class="documents-header">
      <div><h3>{{ text('Documents & export', 'Dokumente & Export') }}</h3><p>{{ text('Arrange the complete application package. Supporting files stay on this device.', 'Vollständige Bewerbungsunterlagen zusammenstellen. Zusätzliche Dateien bleiben auf diesem Gerät.') }}</p></div>
      <span class="local-badge">{{ text('Local files only', 'Dateien nur lokal') }}</span>
    </header>
    <p v-if="loading" role="status">{{ text('Loading local documents…', 'Lokale Dokumente werden geladen…') }}</p>
    <p v-if="error" role="alert" class="message error">{{ error }}</p>
    <p v-if="notice" role="status" class="message notice">{{ notice }}</p>
    <button v-if="loadFailed" type="button" @click="load">{{ text('Retry local storage', 'Lokalen Speicher erneut öffnen') }}</button>
        <template v-if="!loading && !loadFailed">
        <section class="document-section">
          <h4>{{ text('Package order', 'Reihenfolge') }}</h4>
          <p class="muted">{{ text('Select documents to include, then arrange their order.', 'Gewünschte Dokumente auswählen und ihre Reihenfolge festlegen.') }}</p>
          <ol class="package-items">
            <li v-for="(item, index) in manifest.items" :key="item.id" :class="{ excluded: !item.included, missing: problems.some((problem) => problem.id === item.id) }">
              <div class="package-item-main"><input :id="`package-${item.id}`" type="checkbox" :checked="item.included" :disabled="busy" @change="toggleItem(item.id, ($event.target as HTMLInputElement).checked)" /><label :for="`package-${item.id}`">{{ itemLabel(item) }}</label></div>
              <div class="item-actions"><button type="button" :disabled="busy || index === 0" :aria-label="text(`Move ${itemLabel(item)} up`, `${itemLabel(item)} nach oben`)" @click="moveItem(index, -1)">↑</button><button type="button" :disabled="busy || index === manifest.items.length - 1" :aria-label="text(`Move ${itemLabel(item)} down`, `${itemLabel(item)} nach unten`)" @click="moveItem(index, 1)">↓</button><button v-if="item.kind === 'attachment'" type="button" :disabled="busy" :aria-label="text(`Remove ${item.label} from package`, `${item.label} aus Zusammenstellung entfernen`)" @click="removeItem(item.id)">×</button></div>
              <small v-if="problems.find((problem) => problem.id === item.id)" class="item-problem">{{ problems.find((problem) => problem.id === item.id)?.message }}</small>
            </li>
          </ol>
          <p v-if="!includedCount" class="muted">{{ text('Include at least one document to create a package.', 'Mindestens ein Dokument für die Zusammenstellung auswählen.') }}</p>
          <label class="file-button" :class="{ disabled: busy }">{{ text('Add PDF or images', 'PDF oder Bilder hinzufügen') }}<input type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" multiple :disabled="busy" @change="uploadDocuments" /></label>
          <div v-if="libraryOptions.length" class="library-picker"><select v-model="selectedLibraryId" :disabled="busy" :aria-label="text('Choose an existing document', 'Vorhandenes Dokument auswählen')"><option value="">{{ text('From local document library…', 'Aus lokaler Dokumentenbibliothek…') }}</option><option v-for="document in libraryOptions" :key="document.id" :value="document.id">{{ document.name }}</option></select><button type="button" :disabled="busy || !selectedLibraryId" @click="attachLibraryDocument">{{ text('Add', 'Hinzufügen') }}</button></div>
          <div class="package-actions"><button type="button" class="primary" :disabled="!canBuild" @click="buildPreview">{{ busy ? text('Working…', 'Wird bearbeitet…') : text('Preview complete PDF', 'Gesamtes PDF ansehen') }}</button><button type="button" :disabled="busy || !composition" @click="downloadPackage">{{ text('Download & archive', 'Herunterladen & archivieren') }}</button></div>
        </section>
        <details class="document-section">
          <summary>{{ text('Local document library', 'Lokale Dokumentenbibliothek') }} ({{ documents.length }})</summary>
          <p class="muted">{{ text('Reusable across applications in this account. Files are never uploaded. Clearing browser data removes them; keep a backup.', 'In diesem Konto für weitere Bewerbungen nutzbar. Dateien werden niemals hochgeladen. Beim Löschen der Browserdaten gehen sie verloren; ein Backup aufbewahren.') }}</p>
          <ul class="library-list"><li v-for="document in documents" :key="document.id"><div><strong>{{ document.name }}</strong><small>{{ sizeLabel(document.size) }}</small></div><div class="item-actions"><button type="button" :disabled="busy" @click="downloadOriginal(document.id)">{{ text('Download', 'Laden') }}</button><button type="button" :disabled="busy" @click="deleteOriginal(document)">{{ text('Delete', 'Löschen') }}</button></div></li></ul>
          <div class="backup-actions"><button type="button" :disabled="busy" @click="exportBackup">{{ text('Back up files & packages', 'Dateien & Zusammenstellungen sichern') }}</button><label class="file-button secondary" :class="{ disabled: busy }">{{ text('Restore backup', 'Backup wiederherstellen') }}<input type="file" accept="application/json,.json" :disabled="busy" @change="importBackup" /></label></div>
          <p class="muted">{{ text('This backup includes local attachments, package order, and archived PDFs. Back up your editable CVs separately in CV Studio.', 'Dieses Backup enthält lokale Anhänge, die Reihenfolge und archivierte PDFs. Bearbeitbare Lebensläufe separat im CV-Studio sichern.') }}</p>
        </details>
        <details v-if="archives.length" class="document-section"><summary>{{ text('Frozen package archive', 'Archivierte Zusammenstellungen') }} ({{ archives.length }})</summary><p class="muted">{{ text('These PDF copies preserve exactly what you downloaded, even after later edits.', 'Diese PDF-Kopien bewahren die heruntergeladene Fassung auch nach späteren Änderungen.') }}</p><ul class="archive-list"><li v-for="archive in archives" :key="archive.id"><span>{{ new Date(archive.createdAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB') }} · {{ archive.pageCount }} {{ text('pages', 'Seiten') }}</span><div class="item-actions"><button type="button" :disabled="busy" @click="downloadBlob(archive.blob, archive.name)">{{ text('Download copy', 'Kopie laden') }}</button><button type="button" :disabled="busy" @click="deleteArchive(archive)">{{ text('Delete', 'Löschen') }}</button></div></li></ul></details>
        </template>
      </div>
      <section class="package-preview document-section" :aria-label="text('Complete PDF preview', 'Vorschau des gesamten PDFs')">
        <div class="preview-heading"><h4>{{ text('Complete package', 'Gesamte Zusammenstellung') }}</h4><span v-if="composition">{{ composition.pageCount }} {{ text('pages', 'Seiten') }}</span></div>
        <button type="button" :disabled="!previewUrl" @click="expanded = true">{{ text('Open preview', 'Vorschau öffnen') }}</button>
        <template v-if="composition && previewUrl">
          <details class="page-map-summary"><summary>{{ text('Document order', 'Dokumentreihenfolge') }}</summary><ul class="page-map"><li v-for="document in composition.documents" :key="document.itemId">{{ document.label }} <span>{{ text('p.', 'S.') }} {{ document.firstPage }}<template v-if="document.pageCount > 1">–{{ document.firstPage + document.pageCount - 1 }}</template></span></li></ul></details>
          <iframe class="package-inline-pdf" :src="previewUrl" :title="text('Complete application PDF', 'Vollständige Bewerbungsunterlagen als PDF')" />
        </template>
        <div v-else class="preview-empty"><span aria-hidden="true">▤</span><p>{{ text('Prepare the documents, then preview the assembled PDF before downloading.', 'Unterlagen vorbereiten und das zusammengesetzte PDF vor dem Herunterladen prüfen.') }}</p></div>
      </section>
    <PreviewDialog v-model="expanded" :title="text('Complete application PDF', 'Vollständige Bewerbungsunterlagen als PDF')" :lang="lang"><iframe v-if="previewUrl" class="package-full-pdf" :src="previewUrl" :title="text('Complete application PDF', 'Vollständige Bewerbungsunterlagen als PDF')" /></PreviewDialog>
  </section>
</template>

<style scoped>
.application-documents { display:grid; flex:1 1 auto; grid-template-columns:minmax(0,1fr) 360px; gap:20px; min-width:0; min-height:0; overflow:hidden; color:#d1fae5; background:transparent; padding:0; color-scheme:dark; }
.documents-header,.preview-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; }
h3,h4,p { margin:0; } h3 { color:inherit; font-size:1.2rem; } h4 { color:inherit; font-size:1rem; margin-bottom:10px; }
.documents-header p,.muted { color:#a6c1b9; font-size:.88rem; line-height:1.5; margin-top:7px; }
.local-badge { flex-shrink:0; color:#9ee6c7; font-size:.75rem; }
.documents-controls { display:flex; flex-direction:column; gap:20px; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; padding-right:4px; }
.documents-controls > * { flex-shrink:0; }
.package-preview { display:flex; flex-direction:column; min-height:0; overflow:hidden; gap:10px; }
.package-preview > :not(iframe):not(.preview-empty) { flex-shrink:0; }
.document-section { min-width:0; }
.documents-controls > details.document-section { padding-top:16px; border-top:1px solid #28534e; }
summary { font-weight:650; cursor:pointer; }
button,.file-button,select { font:inherit; font-size:.84rem; border-radius:7px; border:1px solid #28534e; padding:8px 11px; background:#06141f; color:#d1fae5; cursor:pointer; }
button:hover:not(:disabled),.file-button:hover:not(.disabled) { background:#15362f; }
button:focus-visible,.file-button:focus-within,select:focus-visible { outline:2px solid #67c8a6; outline-offset:2px; }
button:disabled,.disabled { opacity:.5; cursor:not-allowed; }
.primary,.file-button { background:#185b4c; color:#effff6; border-color:#438f76; }
.primary:hover:not(:disabled),.file-button:hover:not(.disabled) { background:#216c58; }
.file-button { display:inline-block; position:relative; overflow:hidden; }
.file-button input { position:absolute; width:1px; height:1px; opacity:0; }
.secondary { background:#06141f; color:#d1fae5; border-color:#28534e; }
.secondary:hover:not(.disabled) { background:#15362f; }
.package-items { padding:0; list-style:none; margin:12px 0; display:flex; flex-direction:column; gap:4px; }
.package-items li { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 0; border-bottom:1px solid #173b37; }
.package-item-main { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
.package-item-main label { color:inherit; overflow-wrap:anywhere; font-size:.88rem; cursor:pointer; }
input[type="checkbox"] { accent-color:#67c8a6; width:16px; height:16px; flex-shrink:0; }
.excluded .package-item-main { opacity:.5; }
.package-items .missing { border-color:#805840; }
.item-actions { display:flex; gap:4px; flex-wrap:wrap; }
.item-actions button { padding:4px 8px; min-width:36px; min-height:36px; }
.item-problem { flex-basis:100%; color:#f2c6a7; line-height:1.45; }
.package-actions,.backup-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
.library-picker { display:flex; gap:7px; margin-top:10px; } select { min-width:0; flex:1; }
.library-list,.archive-list,.page-map { list-style:none; padding:0; margin:14px 0; }
.library-list li,.archive-list li { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid #28534e; font-size:.83rem; }
.library-list strong { font-weight:550; overflow-wrap:anywhere; } .library-list small { display:block; color:#a6c1b9; margin-top:3px; }
.message { padding:10px 0; margin-bottom:16px; white-space:pre-line; font-size:.9rem; line-height:1.5; }
.error { color:#fecaca; } .notice { color:#9ee6c7; }
.preview-heading { margin-bottom:6px; } .preview-heading span { font-size:.82rem; color:#a6c1b9; white-space:nowrap; }
.package-inline-pdf { width:100%; flex:1 1 auto; min-height:0; border:0; background:#fff; color-scheme:light; }
.package-full-pdf { display:block; width:100%; height:100%; border:0; background:#fff; color-scheme:light; }
.page-map-summary { max-height:35%; overflow:auto; }
.package-preview a { font-size:.84rem; color:#9ee6c7; }
.page-map li { display:flex; justify-content:space-between; gap:15px; font-size:.82rem; padding:5px 0; } .page-map span { flex-shrink:0; color:#a6c1b9; }
.preview-empty { flex:1 1 auto; min-height:0; overflow:auto; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; max-width:300px; margin:auto; }
.preview-empty > span { font-size:46px; color:#528674; margin-bottom:16px; }
.preview-empty p { color:#a6c1b9; font-size:.9rem; line-height:1.6; }
@media(max-width:1180px) { .application-documents { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) minmax(240px,42%); } }
@media(max-width:760px), (max-width:1180px) and (max-height:600px) { .application-documents { grid-template-rows:minmax(0,1fr) auto; gap:10px; } .documents-header { flex-direction:column; gap:10px; } .library-list li { align-items:flex-start; flex-direction:column; } .package-inline-pdf,.page-map-summary,.preview-empty { display:none; } .package-preview { flex-direction:row; flex-wrap:wrap; align-items:center; justify-content:space-between; } .preview-heading { margin:0; } .preview-heading h4 { margin:0; font-size:.85rem; } }
@media(max-width:760px) {
  .documents-controls { padding-right:0; }
  .documents-header { gap:8px; margin-bottom:0; }
  .documents-header h3 { font-size:18px; }
  .archive-list li { align-items:flex-start; flex-direction:column; }
}
</style>
