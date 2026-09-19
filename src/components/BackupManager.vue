<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvState, CvJsonKind, SavedConfiguration } from '../types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { makeT } from '../i18n/dict';
import { STORAGE_KEY } from '../composables/useStorage';
import { builtinConfigurations, createEmptyDocument, createSampleDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID } from '../composables/builtinConfigurations';
import { createNormalizedContentState } from '../composables/contentLayout';
import {
  MAX_CV_JSON_FILE_BYTES,
  createCvContentJson, createCvConfigJson,
  parseCvContentJson, parseCvConfigJson, applyCvContent, applyCvConfig,
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
  'toggle-language': [];
}>();

const langRef = computed(() => props.lang);
const t = makeT(langRef);

const configs = ref<SavedConfiguration[]>([]);
const newName = ref('');
const backupMsg = ref('');
const contentFileInput = ref<HTMLInputElement | null>(null);
const configFileInput = ref<HTMLInputElement | null>(null);
const isImporting = ref(false);
const bypassPrivacyProxy = ref(false);
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

function exportJson(kind: CvJsonKind) {
  try {
    const backup = kind === 'content'
      ? createCvContentJson(props.state, { bypassPrivacy: bypassPrivacyProxy.value })
      : createCvConfigJson(props.state);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const version = Number.isFinite(Number(props.state?.version)) ? `-v${props.state.version}` : '';
    link.href = url;
    const name = configs.value.find((config) => config.id === currentId.value)?.name || 'cv-backup';
    link.download = `${slug(name)}-${kind}${version}.json`;
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

function chooseJsonFile(kind: CvJsonKind) {
  (kind === 'content' ? contentFileInput : configFileInput).value?.click();
}

async function importJson(event: Event, kind: CvJsonKind) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || isImporting.value) return;

  if (file.size > MAX_CV_JSON_FILE_BYTES) {
    backupMsg.value = 'versionFileTooLarge';
    return;
  }

  const targetId = currentId.value;
  const bypassPrivacy = bypassPrivacyProxy.value;
  isImporting.value = true;
  try {
    const text = await file.text();
    // Validate the entire selected format before changing state or selection.
    const imported = kind === 'content'
      ? { kind: 'content' as const, data: parseCvContentJson(text) }
      : { kind: 'config' as const, data: parseCvConfigJson(text) };
    if (currentId.value !== targetId) {
      backupMsg.value = 'versionImportTargetChanged';
      return;
    }
    const confirmation = kind === 'config' ? 'versionConfirmImportConfig'
      : bypassPrivacy ? 'versionConfirmImportContentBypass' : 'versionConfirmImportContent';
    if (!confirm(t(confirmation))) return;
    if (!props.beforeLoad()) return;
    const data = imported.kind === 'content'
      ? applyCvContent(snapshotState(), imported.data, { bypassPrivacy })
      : applyCvConfig(snapshotState(), imported.data);
    // The empty template is immutable. Imports there become an editable draft;
    // named versions keep their identity and autosave the replaced portion.
    if (isEmptyDocument.value && !setCurrentId('')) {
      backupMsg.value = 'versionSaveFailed';
      emit('save-result', false);
      return;
    }
    props.onLoad(data);
    props.onSave();
    backupMsg.value = kind === 'content' ? 'versionContentImported' : 'versionConfigImported';
  } catch (error) {
    console.warn('Failed to import JSON configuration', error);
    backupMsg.value = kind === 'content' ? 'versionInvalidContentFile' : 'versionInvalidConfigFile';
  } finally {
    isImporting.value = false;
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
watch(() => props.selectedId, () => { bypassPrivacyProxy.value = false; });
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

      <div class="backup-manager__language">
        <span>{{ t('language') }}</span>
        <button class="backup-manager__language-toggle" type="button" :class="{ 'is-on': lang === 'en' }" :aria-label="t('language')" :aria-pressed="lang === 'en'" @click="emit('toggle-language')">
          <span class="backup-manager__language-track"><span>DE</span><span>EN</span><span class="backup-manager__language-thumb"></span></span>
        </button>
      </div>

      <div class="backup-manager__json-group">
        <h3>{{ t('versionContentJson') }}</h3>
        <p class="backup-manager__hint">{{ t('versionContentJsonHelp') }}</p>
        <div class="backup-manager__file-actions">
          <input ref="contentFileInput" class="backup-manager__file-input" type="file" accept="application/json,.json" @change="importJson($event, 'content')" />
          <button type="button" class="btn" @click="exportJson('content')">{{ t('versionExportContent') }}</button>
          <button type="button" class="btn" :disabled="isImporting" @click="chooseJsonFile('content')">{{ t('versionImportContent') }}</button>
        </div>
        <label class="backup-manager__privacy-option">
          <input v-model="bypassPrivacyProxy" type="checkbox" :disabled="isImporting" aria-describedby="content-json-privacy-help content-json-text-limit" />
          <span>{{ t('versionBypassPrivacy') }}</span>
        </label>
        <p id="content-json-privacy-help" class="backup-manager__hint">{{ t(bypassPrivacyProxy ? 'versionBypassPrivacyHelp' : 'versionRespectPrivacyHelp') }}</p>
        <p v-if="!bypassPrivacyProxy" id="content-json-text-limit" class="backup-manager__hint">{{ t('versionInlinePrivacyLimit') }}</p>
      </div>
      <div class="backup-manager__json-group">
        <h3>{{ t('versionConfigJson') }}</h3>
        <p class="backup-manager__hint">{{ t('versionConfigJsonHelp') }}</p>
        <div class="backup-manager__file-actions">
          <input ref="configFileInput" class="backup-manager__file-input" type="file" accept="application/json,.json" @change="importJson($event, 'config')" />
          <button type="button" class="btn" @click="exportJson('config')">{{ t('versionExportConfig') }}</button>
          <button type="button" class="btn" :disabled="isImporting" @click="chooseJsonFile('config')">{{ t('versionImportConfig') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.group-panel__scroll-body { display: grid; align-content: start; gap: 10px; min-height: 0; }
.backup-manager__actions, .backup-manager__save-as, .backup-manager__file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.backup-manager__actions select { flex: 1 1 220px; width: auto; }
.backup-manager__save-as input { flex: 1 1 220px; width: auto; }
.backup-manager__file-input { display: none; }
.backup-manager__json-group { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid #ffffff26; }
.backup-manager__json-group h3 { margin: 0; font-size: 14px; color: #9be8c7; letter-spacing: .4px; }
.backup-manager__hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
.backup-manager__privacy-option { display: flex; align-items: center; gap: 8px; color: #d1fae5; font-size: 13px; cursor: pointer; }
.backup-manager__privacy-option input { width: 16px; height: 16px; margin: 0; accent-color: #27f3a2; }
.backup-manager .btn:disabled { border-color: #3b5350; background: #182e2b; color: #8ba39d; opacity: .55; cursor: not-allowed; filter: none; }
.backup-manager__language { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #9be8c7; font-size: 13px; }
.backup-manager__language-toggle { border: 0; padding: 0; background: transparent; cursor: pointer; }
.backup-manager__language-track { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 72px; height: 30px; border: 1px solid #134e4a; border-radius: 999px; background: #06141f; color: #cbd5e1; font-size: 10px; }
.backup-manager__language-track > span:not(.backup-manager__language-thumb) { z-index: 1; display: grid; place-items: center; }
.backup-manager__language-thumb { position: absolute; inset: 2px calc(50% + 1px) 2px 2px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 999px; background: rgba(255, 255, 255, .12); transition: inset .2s ease; }
.backup-manager__language-toggle.is-on .backup-manager__language-thumb { inset: 2px 2px 2px calc(50% + 1px); }
.backup-manager__language-toggle.is-on .backup-manager__language-track { border-color: rgba(16, 185, 129, .45); background: rgba(16, 185, 129, .15); }
.backup-manager__language-toggle:focus-visible { outline: 2px solid #9be8c7; outline-offset: 2px; border-radius: 999px; }
</style>
