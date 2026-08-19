<script setup>
import { computed, onMounted, ref } from 'vue';
import { saveLocal } from '../composables/useStorage';

const props = defineProps({
  state: { type: Object, required: true },
  lang: { type: String, default: 'de' },
  movementMode: { type: String, default: 'drag' },
  onSave: { type: Function, default: () => {} },
});
const emit = defineEmits(['update:lang', 'update:movementMode']);

const langRef = computed({
  get: () => props.lang || 'de',
  set: (value) => emit('update:lang', value),
});
const movementModeRef = computed({
  get: () => props.movementMode || 'drag',
  set: (value) => emit('update:movementMode', value),
});
const labels = computed(() => langRef.value === 'de' ? {
  saveAs: 'Speichern als',
  newName: 'Titel neue Konfiguration',
  save: 'Speichern',
  load: 'Laden',
  remove: 'Löschen',
  confirmLoad: 'Aktuelle Änderungen gehen verloren. Diese Konfiguration laden?',
  confirmDelete: 'Diese Konfiguration wirklich löschen?',
  empty: '— keine Konfigurationen —',
  saved: 'Gespeichert.',
  loaded: 'Geladen.',
  missingName: 'Bitte Titel eingeben.',
  language: 'Sprache',
  movement: 'Interaktion',
} : {
  saveAs: 'Save as',
  newName: 'New configuration title',
  save: 'Save',
  load: 'Load',
  remove: 'Delete',
  confirmLoad: 'Loading replaces your current changes. Continue?',
  confirmDelete: 'Delete this configuration?',
  empty: '— no configurations —',
  saved: 'Saved.',
  loaded: 'Loaded.',
  missingName: 'Please enter a title.',
  language: 'Language',
  movement: 'Interaction',
});

const configs = ref([]);
const currentId = ref('');
const newName = ref('');
const backupMsg = ref('');
const localIndexKey = 'CV_CONF_INDEX';
const localDataKey = (id) => `CV_CONF_DATA:${id}`;

function slug(value) {
  return String(value || '')
    .trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'cv-backup';
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(localIndexKey) || '[]'); } catch { return []; }
}
function writeIndex(items) { localStorage.setItem(localIndexKey, JSON.stringify(items)); }
function refreshConfigs(preferredId = currentId.value) {
  const items = readIndex();
  configs.value = items;
  currentId.value = items.some((item) => item.id === preferredId) ? preferredId : (items[0]?.id || '');
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
  if (chosen) saveConfig(chosen.id, chosen.name);
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
  if (!currentId.value || !confirm(labels.value.confirmLoad)) return;
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
    </div>

    <div class="backup-manager__save-as">
      <input v-model="newName" :placeholder="labels.newName" />
      <button type="button" class="btn btn--success" @click="saveAs">{{ labels.saveAs }}</button>
      <span v-if="backupMsg" class="note">{{ backupMsg }}</span>
    </div>

    <div class="backup-manager__preferences">
      <span>{{ labels.language }}</span>
      <button type="button" class="toggle" :class="{ 'is-on': langRef === 'en' }" @click="langRef = langRef === 'de' ? 'en' : 'de'">
        <span class="toggle-track"><span class="toggle-label">DE</span><span class="toggle-label">EN</span><span class="toggle-thumb"></span></span>
      </button>
      <span>{{ labels.movement }}</span>
      <button type="button" class="toggle" :class="{ 'is-on': movementModeRef === 'drag' }" @click="movementModeRef = movementModeRef === 'buttons' ? 'drag' : 'buttons'">
        <span class="toggle-track"><span class="toggle-label"><font-awesome-icon :icon="['fas', 'arrows-up-down']" /></span><span class="toggle-label"><font-awesome-icon :icon="['fas', 'hands']" /></span><span class="toggle-thumb"></span></span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.backup-manager { display: grid; gap: 10px; width: 100%; padding: 10px; border-radius: 10px; background: #113c34; }
.backup-manager__actions, .backup-manager__save-as, .backup-manager__preferences { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.backup-manager__actions select, .backup-manager__save-as input { flex: 1 1 220px; width: auto; }
.backup-manager__preferences { padding-top: 8px; border-top: 1px solid #134e4a; color: var(--muted); font-size: 12px; }
.toggle { border: 0; padding: 0; background: transparent; cursor: pointer; }
.toggle-track { position: relative; display: inline-flex; align-items: center; justify-content: space-around; width: 86px; height: 30px; border: 1px solid var(--border); border-radius: 999px; background: #0c131a; }
.toggle-label { z-index: 1; width: 50%; text-align: center; color: #cbd5e1; font-size: 10px; }
.toggle-thumb { position: absolute; top: 2px; left: 2px; width: 40px; height: 24px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; background: rgba(255,255,255,.12); transition: transform .18s ease; }
.toggle.is-on .toggle-thumb { transform: translateX(40px); }
.toggle.is-on .toggle-track { border-color: rgba(16,185,129,.45); background: rgba(16,185,129,.15); }
</style>
