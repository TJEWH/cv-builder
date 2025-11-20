<script setup>
import { computed, reactive, watch, onMounted, ref, onBeforeUnmount } from 'vue';
import { debounce, loadLocal, saveLocal, readBackup, fsApiAvailable, getBackupMode } from './composables/useStorage';
import FormBuilder from './components/FormBuilder.vue';
import FloatingPreview from './components/FloatingPreview.vue';
import { makeT } from './i18n/dict';
import ToolBar from "./components/ToolBar.vue";
import BackupManager from "./components/BackupManager.vue";
import DesignPanel from "./components/DesignPanel.vue";
//import SoftSkills from "./components/SoftSkills.vue";

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
  education: [],
  experience: { jobs:[], addExp:[], projects:[] },
  skills: [
    { title: 'Programmiersprachen',     tags: 'Python, TypeScript, Go' },
    { title: 'Frameworks',              tags: 'React, Docker, Kubernetes' },
  ],
  languages: [],
  certs: [],
  hobbies: [ { name: 'Musik', details: '' } ],
  customSections: [],
  sectionNames: {}, // Alternative Namen für Sections
  softSkills: [
    {label:'Anpassungsfähigkeit', desc:'', refs:[]},
    {label:'Kritisches Denken', desc:'', refs:[]},
    {label:'Kreative Problemlösung', desc:'', refs:[]},
  ],
  orderMain: ['about','education','jobs','addExp','projects'],
  orderSide: ['skills','languages','hobbies','certs'],
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
  console.log('💾 [App] Saving data to localStorage');
  console.log('   sectionNames:', data.sectionNames);
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
    // Migrate old custom array to customSections
    if(Array.isArray(cached.custom) && cached.custom.length > 0 && !Array.isArray(cached.customSections)) {
      state.customSections = [{
        id: `custom_${Date.now()}`,
        name: lang.value === 'de' ? 'Eigene Section' : 'Custom Section',
        entries: cached.custom
      }];
      // Add to orderMain if not present
      if(!state.orderMain.includes('custom')) {
        state.orderMain = state.orderMain.filter(k => k !== 'custom');
        state.orderMain.push(state.customSections[0].id);
      } else {
        const idx = state.orderMain.indexOf('custom');
        state.orderMain[idx] = state.customSections[0].id;
      }
      saveDebounced();
    }
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
const sectionMovementMode = ref('drag'); // 'drag' or 'buttons'
</script>

<template>
  <ToolBar v-model:showPreview="showPreview" v-model:lang="lang" v-model:sectionMovementMode="sectionMovementMode"/>
  <FloatingPreview v-if="showPreview" url="/preview.html?embed=1" :initialScale="0.25" />

  <div class="workbench">
    <BackupManager :state="state" :langRef="lang" :onSave="saveDebounced" />
    <DesignPanel v-model="state.design" />
    <FormBuilder :state="state" :onSave="saveDebounced" :movementMode="sectionMovementMode" />
    <!--<SoftSkills v-model="state.softSkills" :options="refsOptions" />-->
  </div>
</template>
