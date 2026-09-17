<script setup>
import { computed, onMounted, ref } from 'vue';
import { saveLocal } from '../composables/useStorage';
import {
  MAX_CV_JSON_FILE_BYTES,
  createCvJsonBackup,
  parseCvJsonBackup,
} from '../composables/cvJsonBackup';

const props = defineProps({
  state: { type: Object, required: true },
  lang: { type: String, default: 'en' },
  selectedId: { type: String, default: '' },
  onSave: { type: Function, default: () => {} },
  onLoad: { type: Function, default: () => {} },
});
const emit = defineEmits(['update:selectedId', 'configs-change', 'save-result']);

const langRef = computed(() => props.lang || 'en');
const labels = computed(() => langRef.value === 'de' ? {
  versions: 'Versionen',
  saveAs: 'Speichern als',
  newName: 'Titel neue Konfiguration',
  load: 'Laden',
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
} : {
  versions: 'Versions',
  saveAs: 'Save as',
  newName: 'New configuration title',
  load: 'Load',
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
});

const configs = ref([]);
const newName = ref('');
const backupMsg = ref('');
const fileInput = ref(null);
const localIndexKey = 'CV_CONF_INDEX';
const localActiveKey = 'CV_CONF_ACTIVE_ID';
const localDataKey = (id) => `CV_CONF_DATA:${id}`;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to write ${key}`, error);
    return false;
  }
}
function removeStorage(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove ${key}`, error);
    return false;
  }
}

function setCurrentId(value) {
  const id = value || '';
  const persisted = id ? writeStorage(localActiveKey, id) : removeStorage(localActiveKey);
  emit('update:selectedId', id);
  return persisted;
}
const currentId = computed({
  get: () => props.selectedId || '',
  set: setCurrentId,
});
function slug(value) {
  return String(value || '')
    .trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'cv-backup';
}

function readIndex() {
  try {
    const parsed = JSON.parse(readStorage(localIndexKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      : [];
  } catch {
    return [];
  }
}
function writeIndex(items) { return writeStorage(localIndexKey, JSON.stringify(items)); }
function refreshConfigs() {
  const items = readIndex();
  configs.value = items;
  if (currentId.value && !items.some((item) => item.id === currentId.value)) currentId.value = '';
  emit('configs-change', items);
}
function snapshotState() {
  return JSON.parse(JSON.stringify(props.state));
}
function readConfigData(id) {
  try {
    const raw = readStorage(localDataKey(id));
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return stored?.data || stored;
  } catch (error) {
    console.warn('Failed to read configuration', error);
    return null;
  }
}
function uniqueConfigId(name) {
  const base = slug(name);
  const taken = new Set(readIndex().map((item) => item.id));
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate) || readStorage(localDataKey(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function saveConfig(id, name, { announce = true, data = snapshotState() } = {}) {
  try {
    const meta = { id, name, updatedAt: Date.now() };
    if (!writeStorage(localDataKey(id), JSON.stringify({ __meta: meta, data }))) throw new Error('Configuration data could not be written');

    const items = readIndex();
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) items[index] = { id, name, mtime: meta.updatedAt };
    else items.push({ id, name, mtime: meta.updatedAt });
    if (!writeIndex(items)) throw new Error('Configuration index could not be written');

    const activeIdSaved = setCurrentId(id);
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
  const chosen = configs.value.find((item) => item.id === currentId.value);
  if (!chosen) return null;
  return saveConfig(chosen.id, chosen.name, { announce });
}

function saveAs() {
  const name = newName.value.trim();
  if (!name) {
    backupMsg.value = labels.value.missingName;
    return;
  }

  try {
    const data = snapshotState();
    const saved = saveConfig(uniqueConfigId(name), name, { data });
    if (saved) newName.value = '';
    emit('save-result', saved);
  } catch (error) {
    console.warn('Failed to save configuration copy', error);
    backupMsg.value = labels.value.saveFailed;
    emit('save-result', false);
  }
}

function loadConfig(id = currentId.value, { confirmLoad = true } = {}) {
  if (!id || (confirmLoad && !confirm(labels.value.confirmLoad))) return false;
  const data = readConfigData(id);
  if (!data) return false;
  try {
    // Switch the save destination before changing state so the first
    // post-load autosave cannot target the configuration we just left.
    setCurrentId(id);
    props.onLoad(data);
    props.onSave();
    backupMsg.value = labels.value.loaded;
    return true;
  } catch (error) {
    console.warn('Failed to load configuration', error);
    return false;
  }
}

function selectConfiguration(id) {
  return id ? loadConfig(id) : false;
}

function onConfigurationChange(event) {
  const nextId = event.target.value;
  if (nextId === currentId.value) return;
  if (!selectConfiguration(nextId)) event.target.value = currentId.value;
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
  if (!currentId.value || !confirm(labels.value.confirmDelete)) return;
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

async function importJson(event) {
  const input = event.target;
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
    setCurrentId('');
    props.onLoad(data);
    props.onSave();
    backupMsg.value = labels.value.imported;
  } catch (error) {
    console.warn('Failed to import JSON configuration', error);
    backupMsg.value = labels.value.invalidFile;
  }
}

defineExpose({ selectConfiguration, restoreActiveConfig, saveCurrent });
onMounted(refreshConfigs);
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
        <button type="button" class="btn" :disabled="!currentId" @click="loadConfig()">{{ labels.load }}</button>
        <button type="button" class="btn btn--danger" :disabled="!currentId" @click="deleteCurrent">{{ labels.remove }}</button>
      </div>

      <p class="backup-manager__hint">{{ labels.saveAsHint }}</p>
      <div class="backup-manager__save-as">
        <input v-model="newName" :placeholder="labels.newName" />
        <button type="button" class="btn btn--success" @click="saveAs">{{ labels.saveAs }}</button>
      </div>

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
