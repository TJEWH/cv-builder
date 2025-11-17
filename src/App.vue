<script setup>
import { reactive, watch, onMounted, ref, onBeforeUnmount } from 'vue';
import { debounce, loadLocal, saveLocal, readBackup } from './composables/useStorage';
import FormBuilder from './components/FormBuilder.vue';
import FloatingPreview from './components/FloatingPreview.vue';

const state = reactive({
  version: 1,
  disabled: [],
  design: {
    h1:'22pt', h2:'12pt', h3:'10pt', bullets:'10.5pt',
    ink:'#111827', accent:'#0f66d0', bg:'#ffffff', headerbg:'#ffffff', sidebarbg:'#ffffff',
    fontBody:'Inter', fontHead:'Inter', hstyle:'clean', radius:'10px', headerRadius:'12px', headerPadYmm:12, lang:'de'
  },
  header: { name:'', location:'', role:'', email:'', phone:'', website:'', linkedin:'' },
  about: { text:'' },
  experience: { job:[], personal:[] },
  education: [],
  projects: [],
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
  orderSide: ['skills','languages','certs','hobbies']
});

const status = ref('lädt…');
let bc;
const saveDebounced = debounce(()=>{
  const data = JSON.parse(JSON.stringify(state));
  saveLocal(data);
  status.value='Gespeichert';
  try{ bc?.postMessage({ type:'update', data }); }catch{}
},250);
watch(state, ()=>{ status.value='Bearbeitung…'; saveDebounced(); },{deep:true});

onMounted(async ()=>{
  try { bc = new BroadcastChannel('cv-sync'); } catch {}

  const cached = loadLocal();
  if (cached){
    Object.assign(state, { ...state, ...cached });
    status.value='Letzte Session geladen';
  } else {
    const mode = getBackupMode();
    const backup = await readBackup(mode);
    if (backup){
      Object.assign(state, { ...state, ...backup });
      saveLocal(state);
      status.value = (mode==='file' && !fsApiAvailable()) ? 'Backup (Browser) geladen (Datei-Modus nicht verfügbar)' :
          (mode==='file' ? 'Backup-Datei geladen' : 'Backup (Browser) geladen');
    } else {
      try{
        const res = await fetch('/cv-defaults.json',{cache:'no-store'});
        Object.assign(state, { ...state, ...(await res.json()) });
        status.value='Defaults geladen';
      }catch{
        status.value='Defaults fehlgeschlagen – leere Vorlage';
      }
    }
  }
});
onBeforeUnmount(()=>{ try{ bc?.close(); }catch{} });

const openPreviewTab = () => window.open('/preview.html', '_blank', 'noopener');

const showPreview = ref(true);
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="note">{{ status }}</span>
      <button class="btn btn--primary" type="button" @click="openPreviewTab">Als PDF exportieren</button>
      <button class="btn" :class="[showPreview?'btn--danger':'btn--success']" type="button" @click="showPreview=!showPreview">
        {{ showPreview ? 'Preview ausblenden' : 'Preview anzeigen' }}
      </button>
    </div>

    <div class="workbench">
      <FormBuilder :state="state" :onSave="saveDebounced" />
    </div>

    <FloatingPreview v-if="showPreview" url="/preview.html?embed=1" :initialScale="0.35" />
  </div>
</template>
