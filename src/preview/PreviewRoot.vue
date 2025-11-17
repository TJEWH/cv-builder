<script setup>
import { reactive, onMounted, watch, ref } from 'vue';
import CvPreview from '../components/CvPreview.vue';
import { STORAGE_KEY } from '../composables/useStorage';

const isEmbedded = ref(false);

const state = reactive({
  version: 1, disabled: [],
  design: { h1:'22pt', h2:'12pt', h3:'10pt', bullets:'10.5pt', ink:'#111827', accent:'#0f66d0', bg:'#ffffff', headerbg:'#ffffff', sidebarbg:'#ffffff',
    fontBody:'Inter', fontHead:'Inter', hstyle:'clean', radius:'10px' },
  header: { name:'', location:'', role:'', email:'', phone:'', website:'', linkedin:'' },
  about: { text:'' },
  experience: { job:[], personal:[] },
  education: [], projects: [],
  skills: [],
  languages: [], certs: [],
  hobbies: [], custom: [], softskills: [],
  orderMain: ['about','experience','education','projects','custom'],
  orderSide: ['skills','languages','certs','hobbies']
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
  ensureFontLink('body', d.fontBody); ensureFontLink('head', d.fontHead);
  root.setProperty('--font-body', `${d.fontBody ? `'${d.fontBody}', `:''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${d.fontHead ? `'${d.fontHead}', `:''}var(--font-body)`);
  document.documentElement.setAttribute('data-hstyle', d.hstyle || 'clean');
}

function mergeIn(data){
  if(!data) return;
  Object.assign(state, data);
  state.skills = { ...state.skills, ...(data.skills||{}) };
  state.experience = {
    job: Array.isArray(data?.experience?.job) ? data.experience.job : [],
    personal: Array.isArray(data?.experience?.personal) ? data.experience.personal : []
  };
  applyDesign();
}

function loadInitial(){
  try{
    const cached = localStorage.getItem(STORAGE_KEY);
    if(cached){ mergeIn(JSON.parse(cached)); return; }
  }catch{}
  fetch('/cv-defaults.json', {cache:'no-store'}).then(r=>r.json()).then(mergeIn).catch(()=>{});
}

onMounted(()=>{
  // erkenne iframe ODER ?embed=1
  try {
    const params = new URLSearchParams(location.search);
    isEmbedded.value = (window.self !== window.top) || params.has('embed');
  } catch {
    isEmbedded.value = true;
  }

  loadInitial();
  window.addEventListener('storage', (e)=>{ if(e.key===STORAGE_KEY && e.newValue){ try{ mergeIn(JSON.parse(e.newValue)); }catch{} }});
  try{
    const bc = new BroadcastChannel('cv-sync');
    bc.onmessage = (ev)=>{
      if(ev?.data?.type==='update'){ mergeIn(ev.data.data); }
      if(ev?.data?.type==='print'){ window.print(); }
    };
  }catch{}
  if (location.hash === '#print'){ setTimeout(()=> window.print(), 200); }
});

watch(()=>state.design, applyDesign, {deep:true});

const doPrint = ()=> window.print();
</script>

<template>
  <!-- Toolbar nur außerhalb vom iframe -->
  <div v-if="!isEmbedded" class="pv-toolbar">
    <button class="pv-btn" @click="doPrint">PDF exportieren</button>
  </div>

  <CvPreview :state="state" />
</template>

<style>

#preview {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pv-toolbar{
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: #0a0f14;
  color: #9be8c7;
  border: 1px dashed #134e4a;
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 8px 20px rgba(0,0,0,.35);
}
.pv-btn{
  cursor: pointer;
  padding: 6px 10px;
  background: #061017;
  color: #9be8c7;
  border: 1px dashed #0f766e;
  border-radius: 6px;
}
.pv-btn:hover{ background:#0a1c26 }
@media print{ .pv-toolbar{ display:none !important } }
</style>
