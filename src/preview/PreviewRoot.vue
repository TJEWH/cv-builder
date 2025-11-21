<script setup>
import { reactive, onMounted, watch, ref, nextTick } from 'vue';
import CvPreview from '../components/CvPreview.vue';
import { STORAGE_KEY } from '../composables/useStorage';
import { usePdfExport } from '../composables/usePdfExport';

const isEmbedded = ref(false);

const state = reactive({
  version: 1, disabled: [],
  design: { h1:'22pt', h2:'12pt', h3:'10pt', bullets:'10.5pt', bulletStyle:'disc', ink:'#111827', accent:'#0f66d0', bg:'#ffffff', headerbg:'#ffffff', sidebarbg:'#ffffff',
    fontBody:'Inter', fontHead:'Inter', hstyle:'clean', radius:'10px',
    subtitle:'#0a9c91', graphic:'#4f46e5', dateColor:'#6b7280',
    badgeBorderWidth:'1px', badgeBorderRadius:'6px', invertBadge:false, enableBoxShadow:false,
    itemBorderWidth:'1px',
    sectionSpacing:'6mm', sectionSpacingBody:'6mm', sectionSpacingSidebar:'6mm',
    sidebarWidth:'0.7fr', sidebarAlign:'right', sidebarStyle:'default', addExpColumns:'2' },
  contact: { name:'', location:'', role:'', email:'', phone:'', website:'', linkedin:'' },
  about: { text:'' },
  experience: { jobs:[], addExp:[], projects:[] },
  education: [],
  skills: [],
  languages: [],
  certs: [],
  hobbies: [],
  customSections: [],
  sectionNames: {},
  sectionHeaderSizes: {},
  softSkills: [],
  orderMain: ['about','education','jobs','addExp','projects'],
  orderSide: ['skills','languages','hobbies','certs'],
});

function ensureFontLink(id, family){
  const elId = `gf-${id}`;
  let link = document.getElementById(elId);
  if(!family){ if(link) link.remove(); return; }
  const fam = family.replace(/\s+/g,'+');
  const href = `https://fonts.googleapis.com/css2?family=${fam}:wght@300;400;600;700&display=swap`;
  if(!link){ link = document.createElement('link'); link.id = elId; link.rel = 'stylesheet'; document.head.appendChild(link); }
  link.href = href;
}

function applyDesign(){
  const d = state.design || {};
  const root = document.documentElement.style;
  root.setProperty('--h1-size', d.h1||'22pt');
  root.setProperty('--h2-size', d.h2||'12pt');
  root.setProperty('--h3-size', d.h3||'10pt');
  root.setProperty('--bullet-size', d.bullets||'10.5pt');
  root.setProperty('--ink', d.ink||'#111827');
  root.setProperty('--accent', d.accent||'#0f66d0');
  root.setProperty('--bg', d.bg||'#ffffff');
  root.setProperty('--header-bg', d.headerbg||'#ffffff');
  root.setProperty('--sidebar-bg', d.sidebarbg||'#ffffff');
  root.setProperty('--radius', d.radius||'10px');
  root.setProperty('--subtitle', d.subtitle||'#0a9c91');
  root.setProperty('--graphic', d.graphic||d.accent||'#4f46e5');
  root.setProperty('--date-color', d.dateColor||'#6b7280');
  root.setProperty('--badge-border-width', d.badgeBorderWidth||'1px');
  root.setProperty('--badge-border-radius', d.badgeBorderRadius||'6px');
  root.setProperty('--item-border-width', d.itemBorderWidth||'1px');
  root.setProperty('--section-spacing', d.sectionSpacing||'6mm');
  root.setProperty('--section-spacing-body', d.sectionSpacingBody||d.sectionSpacing||'6mm');
  root.setProperty('--section-spacing-sidebar', d.sectionSpacingSidebar||d.sectionSpacing||'6mm');
  root.setProperty('--sidebar-width', d.sidebarWidth||'0.7fr');
  root.setProperty('--sidebar-align', d.sidebarAlign||'right');
  root.setProperty('--addexp-columns', d.addExpColumns||'2');
  root.setProperty('--bullet-size', d.bullets||'10.5pt');
  root.setProperty('--bullet-style', d.bulletStyle||'disc');

  // Badge invert logic
  if (d.invertBadge) {
    root.setProperty('--badge-bg', 'transparent');
    root.setProperty('--badge-color', d.graphic||d.accent||'#4f46e5');
  } else {
    root.setProperty('--badge-bg', d.graphic||d.accent||'#4f46e5');
    root.setProperty('--badge-color', '#ffffff');
  }

  // Box shadow logic
  if (d.enableBoxShadow) {
    root.setProperty('--box-shadow', '0 2px 8px rgba(0,0,0,0.1)');
  } else {
    root.setProperty('--box-shadow', 'none');
  }

  ensureFontLink('body', d.fontBody); ensureFontLink('head', d.fontHead);
  root.setProperty('--font-body', `${d.fontBody ? `'${d.fontBody}', `:''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${d.fontHead ? `'${d.fontHead}', `:''}var(--font-body)`);
  document.documentElement.setAttribute('data-hstyle', d.hstyle || 'clean');
  document.documentElement.setAttribute('data-sidebar-align', d.sidebarAlign || 'right');
  document.documentElement.setAttribute('data-sidebar-style', d.sidebarStyle || 'default');
}

function mergeIn(data){
  if(!data) return;
  Object.assign(state, data);
  state.experience = state.experience || { jobs:[], addExp:[], projects:[] };
  state.skills = data.skills ?? state.skills ?? [];
  // Migrate old custom array to customSections
  if(Array.isArray(data.custom) && data.custom.length > 0 && !Array.isArray(data.customSections)) {
    state.customSections = [{
      id: `custom_${Date.now()}`,
      name: 'Custom Section',
      entries: data.custom
    }];
    // Update orderMain
    if(Array.isArray(state.orderMain)) {
      const idx = state.orderMain.indexOf('custom');
      if(idx !== -1) {
        state.orderMain[idx] = state.customSections[0].id;
      } else {
        state.orderMain.push(state.customSections[0].id);
      }
    }
  }
  applyDesign();
}

function loadInitial(){
  try{
    const cached = localStorage.getItem(STORAGE_KEY);
    if(cached){ mergeIn(JSON.parse(cached)); return; }
  }catch{}
  const baseUrl = import.meta.env.BASE_URL || '/';
  fetch(`${baseUrl}cv-defaults.json`, {cache:'no-store'}).then(r=>r.json()).then(mergeIn).catch(()=>{});
}

// PDF Export
const { exportToPdf } = usePdfExport();
const cvPreviewRef = ref(null);
const isExporting = ref(false);

const handleExportPdf = async () => {
  isExporting.value = true;
  try {
    const cvElement = document.querySelector('.page');
    if (cvElement) {
      const contactName = state.contact?.name || 'CV';
      const filename = `${contactName.replace(/\s+/g, '_')}_CV`;
      await exportToPdf(cvElement, filename);
    } else {
      console.error('CV element not found');
    }
  } catch (error) {
    console.error('PDF export failed:', error);
  } finally {
    isExporting.value = false;
  }
};

const goBackToForm = () => {
  window.location.href = '/';
};

onMounted(async ()=>{
  // Check if we're in an iframe or embedded in FloatingPreview
  await nextTick();
  try {
    const params = new URLSearchParams(location.search);
    // Check if we're inside the FloatingPreview component
    const previewEl = document.getElementById('preview');
    const isInFloatingPreview = previewEl?.parentElement?.classList?.contains('fp-embedded');

    isEmbedded.value = (window.self !== window.top) || params.has('embed') || isInFloatingPreview;

    // Auto-export if export parameter is present
    if (params.has('export')) {
      setTimeout(() => {
        handleExportPdf();
      }, 1000);
    }
  } catch {
    isEmbedded.value = true;
  }

  loadInitial();
  window.addEventListener('storage', (e)=>{ if(e.key===STORAGE_KEY && e.newValue){ try{ mergeIn(JSON.parse(e.newValue)); }catch{} }});
  try{
    const bc = new BroadcastChannel('cv-sync');
    bc.onmessage = (ev)=>{
      if(ev?.data?.type==='update'){ mergeIn(ev.data.data); }
      if(ev?.data?.type==='exportPdf'){
        if(ev.data.data) mergeIn(ev.data.data);
        setTimeout(() => handleExportPdf(), 500);
      }
    };
  }catch{}

  // Listen for PDF export requests from parent window
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'exportPdf') {
      if (event.data.data) {
        mergeIn(event.data.data);
      }
      // Wait for Vue to update the DOM
      setTimeout(() => {
        handleExportPdf();
      }, 500);
    }
  });
});

watch(()=>state.design, applyDesign, {deep:true});
</script>

<template>
  <!-- Toolbar - visible in standalone mode -->
  <div v-if="!isEmbedded" class="pv-toolbar">
    <button class="pv-btn" @click="goBackToForm" title="Back to Form">
      <font-awesome-icon :icon="['fas', 'arrow-left']" />
      <span>Back to Form</span>
    </button>
    <button class="pv-btn pv-btn--primary" @click="handleExportPdf" :disabled="isExporting" title="Download PDF">
      <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
      <font-awesome-icon v-else :icon="['fas', 'download']" />
      <span>{{ isExporting ? 'Exporting...' : 'Download PDF' }}</span>
    </button>
  </div>

  <CvPreview ref="cvPreviewRef" :state="state" />
</template>

<style>

#preview {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pv-toolbar{
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #0a0f14;
  color: #9be8c7;
  border: 1px dashed #134e4a;
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 8px 20px rgba(0,0,0,.35);
  display: flex;
  gap: 8px;
}
.pv-btn{
  cursor: pointer;
  padding: 8px 14px;
  background: #061017;
  color: #9be8c7;
  border: 1px dashed #0f766e;
  border-radius: 6px;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  transition: all 0.2s ease;
  font-weight: 500;
}
.pv-btn--primary{
  background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);
  border-color: #0f766e;
  font-weight: 600;
}
.pv-btn--primary:hover:not(:disabled){
  background: linear-gradient(135deg, #14b8a6 0%, #0f766e 100%);
  box-shadow: 0 2px 8px rgba(15, 118, 110, 0.3);
  transform: translateY(-1px);
}
.pv-btn:hover:not(:disabled){
  background:#0a1c26;
  transform: translateY(-1px);
}
.pv-btn:disabled{
  opacity: 0.6;
  cursor: not-allowed;
}
@media print{ .pv-toolbar{ display:none !important } }
</style>
