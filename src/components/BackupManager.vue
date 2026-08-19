<script setup>
import { computed, onMounted, ref } from 'vue';
import { saveLocal } from '../composables/useStorage';

const props = defineProps({
  state: { type: Object, required: true },
  langRef: { type: [Object, String], required: true },
  onSave: { type: Function, default: () => {} },
});

const lang = computed(() => (
  typeof props.langRef === 'object' && props.langRef !== null && 'value' in props.langRef
    ? props.langRef.value
    : props.langRef
));
const labels = computed(() => lang.value === 'de' ? {
  saveAs: 'Speichern als',
  newName: 'Titel neue Konfiguration',
  save: 'Speichern',
  load: 'Laden',
  remove: 'Löschen',
  confirmDelete: 'Diese Konfiguration wirklich löschen?',
  empty: '— keine Konfigurationen —',
  saved: 'Gespeichert.',
  loaded: 'Geladen.',
  missingName: 'Bitte Titel eingeben.',
} : {
  saveAs: 'Save as',
  newName: 'New configuration title',
  save: 'Save',
  load: 'Load',
  remove: 'Delete',
  confirmDelete: 'Delete this configuration?',
  empty: '— no configurations —',
  saved: 'Saved.',
  loaded: 'Loaded.',
  missingName: 'Please enter a title.',
});

const configs = ref([]);
const currentId = ref('');
const newName = ref('');
const backupMsg = ref('');
const localIndexKey = 'CV_CONF_INDEX';
const localDataKey = (id) => `CV_CONF_DATA:${id}`;

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cv-backup';
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(localIndexKey) || '[]'); } catch { return []; }
}

function writeIndex(items) {
  localStorage.setItem(localIndexKey, JSON.stringify(items));
}

function refreshConfigs(preferredId = currentId.value) {
  const items = readIndex();
  configs.value = items;
  currentId.value = items.some((item) => item.id === preferredId)
    ? preferredId
    : (items[0]?.id || '');
}

function saveConfig(id, name) {
  const data = JSON.parse(JSON.stringify(props.state));
  const meta = { id, name, updatedAt: Date.now() };
  localStorage.setItem(localDataKey(id), JSON.stringify({ __meta: meta, data }));
  const items = readIndex();
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) items[index] = { id, name, mtime: meta.updatedAt };
  else items.push({ id, name, mtime: meta.updatedAt });
  writeIndex(items);
  saveLocal(data);
  refreshConfigs(id);
  backupMsg.value = labels.value.saved;
}

function saveCurrent() {
  const chosen = configs.value.find((item) => item.id === currentId.value);
  if (!chosen) return;
  saveConfig(chosen.id, chosen.name);
}

function saveAs() {
  const name = newName.value.trim();
  if (!name) {
    backupMsg.value = labels.value.missingName;
    return;
  }
  saveConfig(slug(name), name);
  newName.value = '';
}

function loadCurrent() {
  if (!currentId.value) return;
  try {
    const raw = localStorage.getItem(localDataKey(currentId.value));
    if (!raw) return;
    const stored = JSON.parse(raw);
    Object.assign(props.state, stored.data || stored);
    props.onSave();
    backupMsg.value = labels.value.loaded;
  } catch (error) {
    console.warn('Failed to load configuration', error);
  }
}

function deleteCurrent() {
  if (!currentId.value || !confirm(labels.value.confirmDelete)) return;
  localStorage.removeItem(localDataKey(currentId.value));
  writeIndex(readIndex().filter((item) => item.id !== currentId.value));
  refreshConfigs();
}

onMounted(refreshConfigs);
</script>

<template>
  <section class="section-group backup-manager">
    <div class="section-head">
      <span class="caret mini"><font-awesome-icon :icon="['fas', 'save']" class="section-icon" aria-hidden="true" /></span>
      <h3>Versioning / Backups</h3>
    </div>

    <div class="backup-manager__actions">
      <select v-model="currentId" aria-label="Saved configuration">
        <option v-if="!configs.length" value="">{{ labels.empty }}</option>
        <option v-for="config in configs" :key="config.id" :value="config.id">{{ config.name }}</option>
      </select>
      <button type="button" class="btn" @click="loadCurrent">{{ labels.load }}</button>
      <button type="button" class="btn btn--primary" @click="saveCurrent">{{ labels.save }}</button>
      <button type="button" class="btn btn--danger" @click="deleteCurrent">{{ labels.remove }}</button>
      <input v-model="newName" :placeholder="labels.newName" />
      <button type="button" class="btn btn--success" @click="saveAs">{{ labels.saveAs }}</button>
      <span v-if="backupMsg" class="note">{{ backupMsg }}</span>
    </div>
  </section>
</template>

<style scoped>
.section-icon { margin-right: 8px; color: var(--muted); }
.caret { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 26px; padding: 0; }
.caret .section-icon { margin: 0; }
.backup-manager { display: grid; gap: 8px; width: 100%; padding: 10px; border-radius: 10px; background: #113c34; }
.backup-manager__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.backup-manager__actions select,
.backup-manager__actions input { flex: 1 1 190px; width: auto; }
</style>
