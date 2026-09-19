<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvState, SavedConfiguration } from '../types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { makeT } from '../i18n/dict';
import { STORAGE_KEY } from '../composables/useStorage';
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
  lang: { type: String, required: true },
  selectedId: { type: String, default: '' },
  onSave: { type: Function as PropType<() => void>, default: () => {} },
  onLoad: { type: Function as PropType<(data: CvState) => void>, default: () => {} },
  beforeLoad: { type: Function as PropType<() => boolean>, default: () => true },
});
const emit = defineEmits<{
  'update:selectedId': [id: string];
  'configs-change': [configurations: SavedConfiguration[]];
  'save-result': [saved: boolean];
  'version-deleted': [id: string];
}>();

const langRef = computed(() => props.lang);
const t = makeT(langRef);

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
function refreshConfigs(clearMissing = true) {
  const builtins = builtinConfigurations(props.lang);
  const items = [...builtins, ...readIndex().filter(({ id }) => !builtins.some((item) => item.id === id))];
  configs.value = items;
  if (clearMissing && currentId.value && !items.some((item) => item.id === currentId.value)) currentId.value = '';
  emit('configs-change', items);
}
function snapshotState(): CvState {
  return JSON.parse(JSON.stringify(props.state));
}
function readConfigData(id: string): CvState | null {
  if (id === EMPTY_DOCUMENT_ID) return { ...createEmptyDocument(), lang: props.lang };
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
  const taken = new Set([...builtinConfigurations(props.lang), ...readIndex()].map((item) => item.id));
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
    if (announce) backupMsg.value = 'saved';
    return true;
  } catch (error) {
    console.warn('Failed to save configuration', error);
    backupMsg.value = 'versionSaveFailed';
    return false;
  }
}

function saveCurrent({ announce = false } = {}) {
  if (currentId.value === EMPTY_DOCUMENT_ID) return true;
  // A stale tab must not recreate a version removed in another tab.
  if (currentId.value && currentId.value !== SAMPLE_DOCUMENT_ID
    && (!readIndex().some(({ id }) => id === currentId.value) || !readStorage(localDataKey(currentId.value)))) {
    clearDeletedVersion(currentId.value);
    return true;
  }
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
  return chosen !== undefined && Boolean(readStorage(localDataKey(id)))
    && saveConfig(id, chosen.name, { data, announce: false, activate: false });
}

function saveAs() {
  const name = newName.value.trim();
  if (!name) {
    backupMsg.value = 'versionMissingName';
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
    backupMsg.value = 'versionSaveFailed';
    emit('save-result', false);
  }
}

function selectConfiguration(id: string) {
  if (!id) return false;
  if (!props.beforeLoad()) return false;
  const data = readConfigData(id);
  if (!data) return false;
  try {
    // Switch the save destination before changing state so the first
    // post-load autosave cannot target the configuration we just left.
    if (!setCurrentId(id)) {
      backupMsg.value = 'versionSaveFailed';
      emit('save-result', false);
      return false;
    }
    props.onLoad(data);
    props.onSave();
    backupMsg.value = 'versionLoaded';
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

function clearDeletedVersion(id: string) {
  // Update the save destination before replacing state; never leave a deleted
  // document available as an unsaved draft or a stale preview.
  emit('update:selectedId', EMPTY_DOCUMENT_ID);
  props.onLoad({ ...createEmptyDocument(), lang: props.lang });
  newName.value = '';
  backupMsg.value = '';
  emit('version-deleted', id);
  refreshConfigs(false);
}

function deleteCurrent() {
  if (!currentId.value || builtinConfigurations(props.lang).some(({ id }) => id === currentId.value) || !confirm(t('versionConfirmDelete'))) return;
  if (!props.beforeLoad()) return;
  const id = currentId.value;
  try {
    if (!removeStorage(localDataKey(id))) throw new Error('Configuration data could not be removed');
    // Legacy session snapshots have no version ownership; clear the fallback
    // instead of allowing deleted content to reappear on reload.
    const sessionRemoved = removeStorage(STORAGE_KEY);
    const indexSaved = writeIndex(readIndex().filter((item) => item.id !== id));
    const activeSaved = writeStorage(localActiveKey, EMPTY_DOCUMENT_ID);
    clearDeletedVersion(id);
    if (!sessionRemoved || !indexSaved || !activeSaved) throw new Error('Configuration cleanup failed');
    backupMsg.value = 'versionDeleted';
    emit('save-result', true);
  } catch (error) {
    console.warn('Failed to delete configuration', error);
    backupMsg.value = 'versionSaveFailed';
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
    const name = configs.value.find((config) => config.id === currentId.value)?.name || 'cv-backup';
    link.download = `${slug(name)}${version}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    backupMsg.value = 'versionExported';
  } catch (error) {
    console.warn('Failed to export JSON configuration', error);
    backupMsg.value = 'versionInvalidFile';
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
    backupMsg.value = 'versionFileTooLarge';
    return;
  }

  try {
    const data = parseCvJsonBackup(await file.text());
    if (!confirm(t('versionConfirmImport'))) return;
    if (!props.beforeLoad()) return;
    setCurrentId('');
    props.onLoad(data);
    props.onSave();
    backupMsg.value = 'versionImported';
  } catch (error) {
    console.warn('Failed to import JSON configuration', error);
    backupMsg.value = 'versionInvalidFile';
  }
}

function onStorageChange(event: StorageEvent) {
  if (event.storageArea !== localStorage) return;
  const id = currentId.value;
  if (id && !builtinConfigurations(props.lang).some((item) => item.id === id)
    && (event.key === null || event.key === localIndexKey || event.key === localDataKey(id))
    && (!readIndex().some((item) => item.id === id) || !readStorage(localDataKey(id)))) {
    clearDeletedVersion(id);
    return;
  }
  if (event.key === null || event.key === localIndexKey || event.key?.startsWith('CV_CONF_DATA:')) refreshConfigs();
}

defineExpose({ selectConfiguration, restoreActiveConfig, saveCurrent, readConfigData, saveVersion });
onMounted(() => {
  refreshConfigs();
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorageChange);
});
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('storage', onStorageChange);
});
watch(() => props.lang, () => refreshConfigs());
</script>

<template>
  <section class="section-group backup-manager">
    <div class="section-head group-panel__header--centered">
      <h2>{{ t('versions') }}</h2>
    </div>

    <div class="group-panel__scroll-body">
      <div class="backup-manager__actions">
        <select :value="currentId" :aria-label="t('versions')" @change="onConfigurationChange">
          <option v-if="!currentId" value="" disabled>{{ t('noSavedVersion') }}</option>
          <option v-for="config in configs" :key="config.id" :value="config.id">{{ config.name }}</option>
        </select>
        <button type="button" class="btn btn--danger" :disabled="!currentId || builtinConfigurations(props.lang).some(({ id }) => id === currentId)" @click="deleteCurrent">{{ t('delete') }}</button>
      </div>

      <p class="backup-manager__hint" aria-live="polite">{{ isEmptyDocument ? t('versionEmptyHint') : t('versionSaveAsHint') }}</p>
      <form class="backup-manager__save-as" @submit.prevent="saveAs">
        <input v-model="newName" :placeholder="t('versionNewName')" :aria-label="t('versionNewName')" />
        <button type="submit" class="btn btn--success" :disabled="!newName.trim()">{{ t('versionSaveAs') }}</button>
      </form>

      <div class="backup-manager__file-actions">
        <input ref="fileInput" class="backup-manager__file-input" type="file" accept="application/json,.json" @change="importJson" />
        <button type="button" class="btn" @click="exportJson">{{ t('versionExportJson') }}</button>
        <button type="button" class="btn" @click="chooseJsonFile">{{ t('versionImportJson') }}</button>
        <span v-if="backupMsg" class="note">{{ t(backupMsg) }}</span>
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
