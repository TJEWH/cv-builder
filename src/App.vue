<script setup>
import { computed, reactive, watch, onMounted, ref, onBeforeUnmount } from 'vue';
import { debounce, loadLocal, saveLocal, readBackup, fsApiAvailable, getBackupMode } from './composables/useStorage';
import FormBuilder from './components/FormBuilder.vue';
import FloatingPreview from './components/FloatingPreview.vue';
import { makeT } from './i18n/dict';
import ToolBar from "./components/ToolBar.vue";
import BackupManager from "./components/BackupManager.vue";

const state = reactive({
  version: 1,
  disabled: [],
  lang: 'de',
  design: {
    h1:'22pt', h2:'12pt', h3:'10pt', bullets:'10.5pt',
    ink:'#111827', accent:'#0f66d0', bg:'#ffffff', headerbg:'#CE9048', sidebarbg:'#CE9048',
    fontBody:'Inter', fontHead:'Inter', hstyle:'clean', radius:'10px',
  },
  contact: { name:'', location:'', role:'', email:'', phone:'', website:'', linkedin:'' },
  about: { text:'' },
  experience: { job:[], projects: [], personal:[] },
  education: [],
  skills: [
    { title: 'Programmiersprachen',     tags: 'Python, TypeScript, Go' },
    { title: 'Frameworks',              tags: 'React, Docker, Kubernetes' },
    { title: 'Methoden',                tags: '' },
  ],
  languages: [],
  certs: [],
  hobbies: [
    { name: 'Musik', details: '' }
  ],
  custom: [],
  softskills: [
    {label:'Analytisches Denken', desc:'', refs:[]},
    {label:'Anpassungsfähigkeit', desc:'', refs:[]},
    {label:'Kritisches Denken', desc:'', refs:[]},
    {label:'Kreative Problemlösung', desc:'', refs:[]},
    {label:'Kommunikationsstärke', desc:'', refs:[]},
    {label:'Emotionale Intelligenz', desc:'', refs:[]},
    {label:'Teamfähigkeit', desc:'', refs:[]},
    {label:'Digitale Kompetenz', desc:'', refs:[]},
    {label:'Entrepreneurship', desc:'', refs:[]}
  ],
  orderMain: ['about','experience','education','projects','custom'],
  orderSide: ['skills','languages','certs','hobbies'],
  includePersonalExp: false,
  includeProjects: false,
});

const lang = computed({
  get: ()=> state.lang ?? 'de',
  set: v  => { state.lang = v; }
});
const t = makeT(lang);

const status = ref(t('loading'));
let bc;

/* Saving (debounced) */
const saveDebounced = debounce(()=>{
  const data = JSON.parse(JSON.stringify(state));
  saveLocal(data);
  status.value=t('saved');
  try{ bc?.postMessage({ type:'update', data }); }catch{}
},250);
watch(state, ()=>{ status.value=t('editing'); saveDebounced(); },{deep:true});

onMounted(async ()=>{
  try { bc = new BroadcastChannel('cv-sync'); } catch {}

  const cached = loadLocal();
  if (cached){
    Object.assign(state, { ...state, ...cached });
    status.value=t('loadedLast');
  } else {
    const mode = getBackupMode();
    const backup = await readBackup(mode);
    if (backup){
      Object.assign(state, { ...state, ...backup });
      saveLocal(state);
      status.value = (mode==='file' && !fsApiAvailable()) ? t('backupBrowserFallback') :
          (mode==='file' ? t('backupProject') : t('backupBrowser'));
    } else {
      try{
        const res = await fetch('/cv-defaults.json',{cache:'no-store'});
        Object.assign(state, { ...state, ...(await res.json()) });
        status.value=t('defaultLoaded');
      }catch{
        status.value=t('defaultFailed');
      }
    }
  }
});
onBeforeUnmount(()=>{ try{ bc?.close(); }catch{} });

const showPreview = ref(true);
</script>

<template>
  <ToolBar v-model:showPreview="showPreview" v-model:lang="lang"/>
  <FloatingPreview v-if="showPreview" url="/preview.html?embed=1" :initialScale="0.25" />

  <BackupManager :state="state" :langRef="lang" :onSave="saveDebounced" />
  <FormBuilder :state="state" :onSave="saveDebounced" />
</template>
