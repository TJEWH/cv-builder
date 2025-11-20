<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { saveLocal, getBackupMode, setBackupMode } from '../composables/useStorage';

const props = defineProps({
  state: { type: Object, required: true },
  // accept either a ref/computed (Object) or a plain string
  langRef: { type: [Object, String], required: true },
  onSave: { type: Function, default: () => {} }
});

// Normalize language prop: support both ref-like objects (with .value) and plain strings
const langRef = computed({
  get: () => (typeof props.langRef === 'object' && props.langRef !== null && 'value' in props.langRef) ? props.langRef.value : props.langRef,
  set: (v) => { if (typeof props.langRef === 'object' && props.langRef !== null && 'value' in props.langRef) props.langRef.value = v; }
});

const L = computed(()=> langRef.value === 'de'
    ? {
      config: 'Konfiguration',
      saveAs: 'Speichern als',
      newNamePH: 'Titel neue Konfiguration',
      overwrite: 'Speichern',
      load: 'Laden',
      remove: 'Löschen',
      confirmDel: 'Diese Konfiguration wirklich löschen?',
      empty: '— keine Konfigurationen —'
    }
    : {
      config: 'Configuration',
      saveAs: 'Save as',
      newNamePH: 'New config title',
      overwrite: 'Save',
      load: 'Load',
      remove: 'Delete',
      confirmDel: 'Really delete this configuration?',
      empty: '— no configurations —'
    }
);

/* ===== Storage Mode Toggle (Browser ↔ Projekt) ===== */
const useProjectFile = ref(getBackupMode() === 'file');
watch(useProjectFile, (v) => {
  setBackupMode(v ? 'file' : 'browser');
  refreshConfigs(currentId.value);
});
const backupMsg = ref('');

/* ===== Konfigurations-Management ===== */
const configs = ref([]);               // [{id,name,mtime}]
const currentId = ref('');             // aktive Auswahl im Dropdown
const newName = ref('');               // Eingabefeld „Speichern als"

const localIndexKey = 'CV_CONF_INDEX';
const localDataKey = (id)=> `CV_CONF_DATA:${id}`;

function slug(s){
  return String(s||'')
      .trim().toLowerCase()
      .replace(/[\s_]+/g,'-')
      .replace(/[^a-z0-9-]/g,'')
      .replace(/-+/g,'-')
      .replace(/^-+|-+$/g,'') || 'cv-backup';
}

/* ---- Server-API (Projekt-Modus) ---- */
async function apiList(){
  const r = await fetch('/__backup/list');
  if(!r.ok) return [];
  const j = await r.json().catch(()=>({items:[]}));
  return j.items || [];
}
async function apiSave(id, name, data){
  const r = await fetch(`/__backup/cv?id=${encodeURIComponent(id)}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ __meta:{ id, name }, data })
  });
  return r.ok ? await r.json() : { ok:false };
}
async function apiLoad(id){
  const r = await fetch(`/__backup/cv?id=${encodeURIComponent(id)}`);
  return r.ok ? await r.json() : null;
}
async function apiDelete(id){
  const r = await fetch(`/__backup/cv?id=${encodeURIComponent(id)}`, { method:'DELETE' });
  return r.ok ? await r.json() : { ok:false };
}

/* ---- Browser-API (LocalStorage) ---- */
function lsReadIndex(){
  try{ return JSON.parse(localStorage.getItem(localIndexKey) || '[]'); }catch{ return []; }
}
function lsWriteIndex(arr){
  localStorage.setItem(localIndexKey, JSON.stringify(arr));
}
function lsSave(id, name, data){
  const meta = { id, name, updatedAt: Date.now() };
  localStorage.setItem(localDataKey(id), JSON.stringify({ __meta: meta, data }));
  const idx = lsReadIndex();
  const i = idx.findIndex(x=>x.id===id);
  if(i>=0){ idx[i].name = name; idx[i].mtime = meta.updatedAt; }
  else idx.push({ id, name, mtime: meta.updatedAt });
  lsWriteIndex(idx);
  return { ok:true, id, name };
}
function lsLoad(id){
  const txt = localStorage.getItem(localDataKey(id));
  if(!txt) return null;
  try{
    const json = JSON.parse(txt);
    return json && json.data ? json.data : json;
  }catch{ return null; }
}
function lsDelete(id){
  localStorage.removeItem(localDataKey(id));
  const idx = lsReadIndex().filter(x=>x.id!==id);
  lsWriteIndex(idx);
  return { ok:true };
}

async function refreshConfigs(preferId){
  const list = useProjectFile.value ? await apiList() : lsReadIndex();
  configs.value = list;
  const wanted = preferId || currentId.value;
  if (wanted && list.some(x => x.id === wanted)) {
    currentId.value = wanted;
    } else if (list.length) {
    currentId.value = list[0].id;
    } else {
    currentId.value = '';
  }
}

async function saveCurrent(){
  const snap = JSON.parse(JSON.stringify(props.state));
  saveLocal(snap);
  if(!currentId.value){
    backupMsg.value = L.value.empty;
    return;
  }
  const chosen = configs.value.find(x=>x.id===currentId.value);
  const name = chosen?.name || currentId.value;

  const res = useProjectFile.value
      ? await apiSave(currentId.value, name, snap)
      : lsSave(currentId.value, name, snap);

  backupMsg.value = res?.ok ? (langRef==='de'?'Gespeichert.':'Saved.') : (langRef.value==='de'?'Fehler beim Speichern.':'Save failed.');
  await refreshConfigs(res?.id || currentId.value);
}

async function saveAs(){
  const name = (newName.value || '').trim();
  if(!name){ backupMsg.value = langRef==='de' ? 'Bitte Titel eingeben.' : 'Please enter a title.'; return; }
  const id = slug(name);
  const snap = JSON.parse(JSON.stringify(props.state));
  saveLocal(snap);

  const res = useProjectFile.value
      ? await apiSave(id, name, snap)
      : lsSave(id, name, snap);

  if(res?.ok){
    backupMsg.value = langRef==='de' ? 'Gespeichert.' : 'Saved.';
    newName.value = '';
    await refreshConfigs();
    currentId.value = id;
  }else{
    backupMsg.value = langRef==='de' ? 'Fehler beim Speichern.' : 'Save failed.';
  }
}

async function loadCurrent(){
  if(!currentId.value) { backupMsg.value = L.value.empty; return; }
  const data = useProjectFile.value ? await apiLoad(currentId.value) : lsLoad(currentId.value);
  if (data) {
    Object.assign(props.state, { ...props.state, ...data });
    props.onSave?.();
    backupMsg.value = langRef.value==='de' ? 'Geladen.' : 'Loaded.';
  } else {
    backupMsg.value = langRef.value==='de' ? 'Nicht gefunden.' : 'Not found.';
  }
}

async function deleteCurrent(){
  if(!currentId.value) return;
  if(!confirm(L.value.confirmDel)) return;

  const res = useProjectFile.value ? await apiDelete(currentId.value) : lsDelete(currentId.value);
  if(res?.ok){
    backupMsg.value = langRef==='de' ? 'Gelöscht.' : 'Deleted.';
    await refreshConfigs();
  }else{
    backupMsg.value = langRef==='de' ? 'Löschen fehlgeschlagen.' : 'Delete failed.';
  }
}

onMounted(refreshConfigs);
</script>

<template>
  <section class="section-group backup-manager">
    <div class="section-head">
      <button class="caret mini" type="button">
        <font-awesome-icon :icon="['fas','save']" class="section-icon" aria-hidden="true" />
      </button>
      <h3>Versioning / Backups</h3>
    </div>

    <!-- Save Location -->
    <div class="toggle-field">
      <span class="toggle-caption">{{ langRef === 'de' ? 'Speicherort' : 'Storage' }}</span>
      <button
          type="button"
          class="toggle"
          role="switch"
          :aria-checked="useProjectFile ? 'true' : 'false'"
          :class="{ 'is-on': useProjectFile }"
          @click="useProjectFile = !useProjectFile"
          aria-label="Toggle storage"
      >
        <span class="toggle-track">
          <span class="toggle-label left">Browser</span>
          <span class="toggle-label right">Project</span>
          <span class="toggle-thumb"></span>
        </span>
      </button>
    </div>

    <!-- Konfigurations-Manager -->
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
      <!--<label class="toggle-caption" style="min-width:max-content">{{ L.config }}:</label>-->
      <select v-model="currentId" style="min-width:200px">
        <option v-if="!configs.length" value="">{{ L.empty }}</option>
        <option v-for="c in configs" :key="c.id" :value="c.id">
          {{ c.name }}
        </option>
      </select>

      <button type="button" class="btn" @click="loadCurrent">{{ L.load }}</button>
      <button type="button" class="btn btn--primary" @click="saveCurrent">{{ L.overwrite }}</button>
      <button type="button" class="btn btn--danger" @click="deleteCurrent">{{ L.remove }}</button>

      <input
          v-model="newName"
          :placeholder="L.newNamePH"
          style="min-width:220px"
      />
      <button type="button" class="btn btn--success" @click="saveAs">{{ L.saveAs }}</button>

      <span class="note" v-if="backupMsg">{{ backupMsg }}</span>
    </div>
  </section>
</template>

<style scoped>
.section-icon{ margin-right:8px; color:var(--muted); }
.caret{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:26px; padding:0; }
.caret .section-icon{ margin:0; }

/* keep previous backup-manager styles */
.toggle-field{ display:flex; align-items:center; gap:8px; }
.toggle-caption{ font-size:12px; color: var(--muted); }

.toggle{
  border:0; background:transparent; padding:0; cursor:pointer; outline:none;
}
.toggle-track{
  position:relative; display:inline-flex; align-items:center; justify-content:space-around;
  width: 120px; height: 30px; border-radius:999px;
  background: #0c131a; border:1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}
.toggle-label{ font-size:11px; opacity:.75; color:#cbd5e1; z-index:1; user-select:none; }
.toggle-thumb{
  position:absolute; top:2px; left:2px;
  width: 58px; height: 24px; border-radius:999px;
  background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.12);
  transition: transform .18s ease;
}

.toggle:not(.is-on) .toggle-track{
  background: linear-gradient(180deg, rgba(99,102,241,.22), rgba(59,130,246,.14));
  border-color: rgba(59,130,246,.45);
}
.toggle.is-on .toggle-track{
  background: linear-gradient(180deg, rgba(34,197,94,.25), rgba(16,185,129,.15));
  border-color: rgba(16,185,129,.45);
}
.toggle.is-on .toggle-thumb{ transform: translateX(56px); }

.note { align-items: start }

.backup-manager {
  align-items: center;
  gap: 8px;
  padding: 10px;
  display: grid;
  background: #113c34;
  border-radius: 10px;

  select, input {
    width: 60% !important;
  }
}
</style>
