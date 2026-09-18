<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvState, SavedConfiguration } from '../types';
import { computed, onMounted, ref, watch } from 'vue';
import { saveLocal } from '../composables/useStorage';
import { builtinConfigurations, createEmptyDocument, createSampleDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID } from '../composables/builtinConfigurations';
import { createNormalizedContentState } from '../composables/contentLayout';
import {
  MAX_CV_JSON_FILE_BYTES,
  createCvJsonBackup,
  parseCvJsonBackup,
  parseStoredCvState,
} from '../composables/cvJsonBackup';

const props = defineProps({
  state: { type: Object as PropType<CvState>, required: true },
  lang: { type: String, default: 'en' },
  selectedId: { type: String, default: '' },
  onSave: { type: Function as PropType<() => void>, default: () => {} },
  onLoad: { type: Function as PropType<(data: CvState) => void>, default: () => {} },
  beforeLoad: { type: Function as PropType<() => boolean>, default: () => true },
});
const emit = defineEmits<{
  'update:selectedId': [id: string];
  'configs-change': [configurations: SavedConfiguration[]];
  'save-result': [saved: boolean];
}>();

const langRef = computed(() => props.lang || 'en');
const labels = computed(() => langRef.value === 'de' ? {
  versions: 'Versionen',
  saveAs: 'Speichern als',
  newName: 'Titel neue Konfiguration',
  remove: 'Löschen',
  exportJson: 'JSON exportieren',
  importJson: 'JSON importieren',
  confirmLoad: 'Aktuelle Änderungen gehen verloren. Diese Konfiguration laden?',
  confirmImport: 'Aktuelle Änderungen gehen verloren. Diese JSON-Datei laden?',
  confirmDelete: 'Diese Konfiguration wirklich löschen?',
  noSavedVersion: 'Keine gespeicherte Version',
  saved: 'Gespeichert.',
  loaded: 'Geladen.',
  exported: 'JSON-Datei heruntergeladen.',
  imported: 'JSON-Datei geladen.',
  invalidFile: 'Die Datei ist keine unterstützte CV-JSON-Datei.',
  fileTooLarge: 'Die JSON-Datei ist zu groß.',
  missingName: 'Bitte Titel eingeben.',
  saveFailed: 'Speichern fehlgeschlagen. Bitte Speicherplatz und Browser-Einstellungen prüfen.',
  saveAsHint: 'Eine neue Konfiguration ist eine Kopie der aktuell angezeigten Inhalte und Einstellungen.',
  emptyHint: 'Gib einen neuen Konfigurationstitel ein und speichere das leere Dokument, um es zu bearbeiten.',
} : {
  versions: 'Versions',
  saveAs: 'Save as',
  newName: 'New configuration title',
  remove: 'Delete',
  exportJson: 'Export JSON',
  importJson: 'Import JSON',
  confirmLoad: 'Loading replaces your current changes. Continue?',
  confirmImport: 'Loading this JSON file replaces your current changes. Continue?',
  confirmDelete: 'Delete this configuration?',
  noSavedVersion: 'No saved version',
  saved: 'Saved.',
  loaded: 'Loaded.',
  exported: 'JSON file downloaded.',
  imported: 'JSON file loaded.',
  invalidFile: 'The file is not a supported CV JSON file.',
  fileTooLarge: 'The JSON file is too large.',
  missingName: 'Please enter a title.',
  saveFailed: 'Saving failed. Check available storage and browser settings.',
  saveAsHint: 'A new configuration is a copy of the currently displayed content and settings.',
  emptyHint: 'Enter a new configuration title and save the empty document to start editing.',
});

const configs = ref<SavedConfiguration[]>([]);
const newName = ref('');
const backupMsg = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const localIndexKey = 'CV_CONF_INDEX';
const localActiveKey = 'CV_CONF_ACTIVE_ID';
const localDataKey = (id: string) => `CV_CONF_DATA:${id}`;
const isEmptyDocument = computed(() => currentId.value === EMPTY_DOCUMENT_ID);

function readStorage(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to write ${key}`, error);
    return false;
  }
}
function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove ${key}`, error);
    return false;
  }
}

function setCurrentId(value: string) {
  const id = value || '';
  const persisted = id ? writeStorage(localActiveKey, id) : removeStorage(localActiveKey);
  if (!persisted) return false;
  emit('update:selectedId', id);
  return persisted;
}
const currentId = computed({
  get: () => props.selectedId || '',
  set: setCurrentId,
});
function slug(value: unknown) {
  return String(value || '')
    .trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'cv-backup';
}

function readIndex(): SavedConfiguration[] {
  try {
    const parsed = JSON.parse(readStorage(localIndexKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      : [];
  } catch {
    return [];
  }
}
function writeIndex(items: SavedConfiguration[]) { return writeStorage(localIndexKey, JSON.stringify(items)); }
function refreshConfigs() {
  const builtins = builtinConfigurations(props.lang);
  const items = [...builtins, ...readIndex().filter(({ id }) => !builtins.some((item) => item.id === id))];
  configs.value = items;
  if (currentId.value && !items.some((item) => item.id === currentId.value)) currentId.value = '';
  emit('configs-change', items);
}
function snapshotState(): CvState {
  return JSON.parse(JSON.stringify(props.state));
}
function readConfigData(id: string): CvState | null {
  if (id === EMPTY_DOCUMENT_ID) return createEmptyDocument();
  try {
    const raw = readStorage(localDataKey(id));
    if (!raw) return id === SAMPLE_DOCUMENT_ID ? createSampleDocument() : null;
    return parseStoredCvState(raw);
  } catch (error) {
    console.warn('Failed to read configuration', error);
    return id === SAMPLE_DOCUMENT_ID ? createSampleDocument() : null;
  }
}
function uniqueConfigId(name: string) {
  const base = slug(name);
  const taken = new Set([...builtinConfigurations(), ...readIndex()].map((item) => item.id));
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate) || readStorage(localDataKey(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function saveConfig(id: string, name: string, { announce = true, data = snapshotState(), activate = true } = {}) {
  if (id === EMPTY_DOCUMENT_ID) return false;
  try {
    const meta = { id, name, updatedAt: Date.now() };
    if (!writeStorage(localDataKey(id), JSON.stringify({ __meta: meta, data }))) throw new Error('Configuration data could not be written');

    const items = readIndex();
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items[index] = { id, name, mtime: meta.updatedAt };
    else items.push({ id, name, mtime: meta.updatedAt });
    if (!writeIndex(items)) throw new Error('Configuration index could not be written');

    const activeIdSaved = !activate || setCurrentId(id);
    refreshConfigs();
    if (!activeIdSaved) throw new Error('Active configuration could not be written');
    if (announce) backupMsg.value = labels.value.saved;
    return true;
  } catch (error) {
    console.warn('Failed to save configuration', error);
    backupMsg.value = labels.value.saveFailed;
    return false;
  }
}

function saveCurrent({ announce = false } = {}) {
  if (currentId.value === EMPTY_DOCUMENT_ID) return true;
  // The bundled sample needs no browser storage until somebody edits it.
  if (currentId.value === SAMPLE_DOCUMENT_ID && !readStorage(localDataKey(SAMPLE_DOCUMENT_ID))
    && JSON.stringify(props.state) === JSON.stringify(createNormalizedContentState(createSampleDocument()))) return true;
  const chosen = configs.value.find((item) => item.id === currentId.value);
  if (!chosen) return null;
  return saveConfig(chosen.id, chosen.name, { announce });
}

function saveVersion(id: string, data: CvState) {
  const chosen = [...builtinConfigurations(props.lang), ...readIndex()].find((item) => item.id === id);
  // Never recreate a version that was deleted while it was being edited.
  return chosen !== undefined && saveConfig(id, chosen.name, { data, announce: false, activate: false });
}

function saveAs() {
  const name = newName.value.trim();
  if (!name) {
    backupMsg.value = labels.value.missingName;
    return;
  }

  try {
    if (!props.beforeLoad()) return;
    const data = isEmptyDocument.value ? { ...createEmptyDocument(), lang: props.lang } : snapshotState();
    const saved = saveConfig(uniqueConfigId(name), name, { data });
    if (saved) newName.value = '';
    emit('save-result', saved);
  } catch (error) {
    console.warn('Failed to save configuration copy', error);
    backupMsg.value = labels.value.saveFailed;
    emit('save-result', false);
  }
}

function selectConfiguration(id: string) {
  if (!id || !confirm(labels.value.confirmLoad)) return false;
  if (!props.beforeLoad()) return false;
  const data = readConfigData(id);
  if (!data) return false;
  try {
    // Switch the save destination before changing state so the first
    // post-load autosave cannot target the configuration we just left.
    if (!setCurrentId(id)) {
      backupMsg.value = labels.value.saveFailed;
      emit('save-result', false);
      return false;
    }
    props.onLoad(data);
    props.onSave();
    backupMsg.value = labels.value.loaded;
    return true;
  } catch (error) {
    console.warn('Failed to load configuration', error);
    return false;
  }
}

function onConfigurationChange(event: Event) {
  const nextId = (event.target as HTMLSelectElement).value;
  if (nextId === currentId.value) return;
  if (!selectConfiguration(nextId)) (event.target as HTMLSelectElement).value = currentId.value;
}

function restoreActiveConfig() {
  const id = readStorage(localActiveKey);
  if (!id) return null;
  refreshConfigs();
  if (!configs.value.some((item) => item.id === id)) {
    setCurrentId('');
    return null;
  }
  const data = readConfigData(id);
  if (!data) {
    setCurrentId('');
    return null;
  }
  setCurrentId(id);
  return data;
}

function deleteCurrent() {
  if (!currentId.value || builtinConfigurations().some(({ id }) => id === currentId.value) || !confirm(labels.value.confirmDelete)) return;
  if (!props.beforeLoad()) return;
  try {
    // Deleting a saved version must not discard the content currently being edited.
    if (!saveLocal(snapshotState())) throw new Error('Current content could not be written');
    const nextIndex = readIndex().filter((item) => item.id !== currentId.value);
    if (!writeIndex(nextIndex)) throw new Error('Configuration index could not be written');
    if (!removeStorage(localDataKey(currentId.value))) throw new Error('Configuration data could not be removed');
    setCurrentId('');
    refreshConfigs();
    emit('save-result', true);
  } catch (error) {
    console.warn('Failed to delete configuration', error);
    backupMsg.value = labels.value.saveFailed;
    emit('save-result', false);
  }
}

function exportJson() {
  try {
    const backup = createCvJsonBackup(props.state);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const version = Number.isFinite(Number(props.state?.version)) ? `-v${props.state.version}` : '';
    link.href = url;
    link.download = `${slug(props.state?.contact?.name || 'cv')}${version}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    backupMsg.value = labels.value.exported;
  } catch (error) {
    console.warn('Failed to export JSON configuration', error);
    backupMsg.value = labels.value.invalidFile;
  }
}

function chooseJsonFile() {
  fileInput.value?.click();
}

async function importJson(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > MAX_CV_JSON_FILE_BYTES) {
    backupMsg.value = labels.value.fileTooLarge;
    return;
  }

  try {
    const data = parseCvJsonBackup(await file.text());
    if (!confirm(labels.value.confirmImport)) return;
    if (!props.beforeLoad()) return;
    setCurrentId('');
    props.onLoad(data);
    props.onSave();
    backupMsg.value = labels.value.imported;
  } catch (error) {
    console.warn('Failed to import JSON configuration', error);
    backupMsg.value = labels.value.invalidFile;
  }
}

defineExpose({ selectConfiguration, restoreActiveConfig, saveCurrent, readConfigData, saveVersion });
onMounted(refreshConfigs);
watch(() => props.lang, refreshConfigs);
</script>

<template>
  <section class="section-group backup-manager">
    <div class="section-head group-panel__header--centered">
      <h2>{{ labels.versions }}</h2>
    </div>

    <div class="group-panel__scroll-body">
      <div class="backup-manager__actions">
        <select :value="currentId" :aria-label="labels.versions" @change="onConfigurationChange">
          <option v-if="!currentId" value="" disabled>{{ labels.noSavedVersion }}</option>
          <option v-for="config in configs" :key="config.id" :value="config.id">{{ config.name }}</option>
        </select>
        <button type="button" class="btn btn--danger" :disabled="!currentId || builtinConfigurations().some(({ id }) => id === currentId)" @click="deleteCurrent">{{ labels.remove }}</button>
      </div>

      <p class="backup-manager__hint" aria-live="polite">{{ isEmptyDocument ? labels.emptyHint : labels.saveAsHint }}</p>
      <form class="backup-manager__save-as" @submit.prevent="saveAs">
        <input v-model="newName" :placeholder="labels.newName" :aria-label="labels.newName" />
        <button type="submit" class="btn btn--success" :disabled="!newName.trim()">{{ labels.saveAs }}</button>
      </form>

      <div class="backup-manager__file-actions">
        <input ref="fileInput" class="backup-manager__file-input" type="file" accept="application/json,.json" @change="importJson" />
        <button type="button" class="btn" @click="exportJson">{{ labels.exportJson }}</button>
        <button type="button" class="btn" @click="chooseJsonFile">{{ labels.importJson }}</button>
        <span v-if="backupMsg" class="note">{{ backupMsg }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.backup-manager { width: 100%; padding: 10px; border-radius: 10px; background: #113c34; }
.group-panel__scroll-body { display: grid; align-content: start; gap: 10px; min-height: 0; }
.backup-manager__actions, .backup-manager__save-as, .backup-manager__file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.backup-manager__actions select { flex: 1 1 220px; width: auto; }
.backup-manager__save-as input { flex: 1 1 220px; width: auto; }
.backup-manager__file-input { display: none; }
.backup-manager__hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
</style>
