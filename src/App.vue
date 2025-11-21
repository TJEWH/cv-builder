<script setup>
import { computed, reactive, watch, onMounted, ref, onBeforeUnmount } from 'vue';
import { debounce, loadLocal, saveLocal, readBackup, fsApiAvailable, getBackupMode } from './composables/useStorage';
import { usePdfExport } from './composables/usePdfExport';
import FormBuilder from './components/FormBuilder.vue';
import FloatingPreview from './components/FloatingPreview.vue';
import { makeT } from './i18n/dict';
import ToolBar from "./components/ToolBar.vue";
import BackupManager from "./components/BackupManager.vue";
import DesignPanel from "./components/DesignPanel.vue";

const state = reactive({
  version: 1,
  disabled: [],
  lang: 'de',
  design: {
    h1:'22pt', h2:'12pt', h3:'10pt', bullets:'10.5pt', bulletStyle:'disc',
    ink:'#111827', accent:'#0f66d0', bg:'#ffffff', headerbg:'#CE9048', sidebarbg:'#CE9048',
    fontBody:'Inter', fontHead:'Inter', hstyle:'clean', radius:'10px',
    subtitle:'#0a9c91', graphic:'#4f46e5', dateColor:'#6b7280',
    badgeBorderWidth:'1px', badgeBorderRadius:'6px', invertBadge:false, enableBoxShadow:false,
    itemBorderWidth:'1px',
    sectionSpacing:'6mm', sectionSpacingBody:'6mm', sectionSpacingSidebar:'6mm',
    sidebarWidth:'0.7fr', sidebarAlign:'right', sidebarStyle:'default', addExpColumns:'2',
  },
  contact: { name:'', location:'', role:'', email:'', phone:'', website:'', linkedin:'' },
  about: { text:'' },
  education: [],
  experience: { jobs:[], addExp:[], projects:[] },
  skills: [
    {
      title: 'Programmiersprachen',
      levelType: null,
      items: [
        { name: 'Python', levelValue: 0 },
        { name: 'TypeScript', levelValue: 0 },
        { name: 'Go', levelValue: 0 }
      ]
    },
    {
      title: 'Frameworks',
      levelType: null,
      items: [
        { name: 'React', levelValue: 0 },
        { name: 'Docker', levelValue: 0 },
        { name: 'Kubernetes', levelValue: 0 }
      ]
    }
  ],
  languages: [],
  certs: [],
  hobbies: [ { name: 'Musik', details: '' } ],
  customSections: [],
  sectionNames: {}, // Alternative Namen für Sections
  sectionHeaderSizes: {}, // Header-Größen für Sections (h2, h3, h4, null)
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

const showPreview = ref(true); // Show FloatingPreview by default
const sectionMovementMode = ref('drag'); // 'drag' or 'buttons'

// Navigate to fullscreen preview
const openFullscreenPreview = () => {
  saveLocal(state);
  window.location.href = '/preview.html';
};

// PDF Export via iframe
const { exportToPdf } = usePdfExport();

const handleExportPdf = async () => {
  // Check if preview is visible
  if (!showPreview.value) {
    showPreview.value = true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Get the iframe from FloatingPreview
  const iframe = document.querySelector('.fp-iframe');
  if (!iframe || !iframe.contentWindow) {
    // Fallback: navigate to preview with export flag
    saveLocal(state);
    window.location.href = '/preview.html?export=true';
    return;
  }

  // Send message to iframe to trigger export
  iframe.contentWindow.postMessage({
    type: 'exportPdf',
    data: JSON.parse(JSON.stringify(state))
  }, '*');
};
</script>

<template>
  <ToolBar
    v-model:showPreview="showPreview"
    v-model:lang="lang"
    v-model:sectionMovementMode="sectionMovementMode"
    @exportPdf="handleExportPdf"
    @openFullscreen="openFullscreenPreview"
  />

  <FloatingPreview
    v-if="showPreview"
    url="/preview.html?embed=1"
    :initialScale="0.25"
  />

  <div class="workbench">
    <BackupManager :state="state" :langRef="lang" :onSave="saveDebounced" />
    <DesignPanel v-model="state.design" />
    <FormBuilder :state="state" :onSave="saveDebounced" :movementMode="sectionMovementMode" />
  </div>
</template>
