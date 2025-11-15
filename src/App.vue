<script setup>
import { reactive, watch, onMounted, ref, onBeforeUnmount } from 'vue';
import { debounce, loadLocal, saveLocal } from './composables/useStorage';
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
  skills: { langs:[], tools:[], methods:[], langsString:'', toolsString:'', methodsString:'' },
  languages: [], // [{name, level:'C1'|'Muttersprache'|...}]
  certs: [],
  hobbies: { music:'' },
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
  if (cached){ Object.assign(state, { ...state, ...cached }); status.value='Letzte Session geladen'; }
  else {
    try{ const res = await fetch('/cv-defaults.json',{cache:'no-store'}); Object.assign(state, { ...state, ...(await res.json()) }); status.value='Defaults geladen'; }
    catch{ status.value='Defaults fehlgeschlagen – leere Vorlage'; }
  }
});
onBeforeUnmount(()=>{ try{ bc?.close(); }catch{} });

const floating = ref(null);
const printPDF = ()=> floating.value?.openPrint?.();

const showPreview = ref(true);
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="note">{{ status }}</span>
      <button class="btn btn--primary" type="button" @click="printPDF">Als PDF exportieren</button>
      <button class="btn" :class="[showPreview?'btn--danger':'btn--success']" type="button" @click="showPreview=!showPreview">
        {{ showPreview ? 'Preview ausblenden' : 'Preview anzeigen' }}
      </button>
    </div>

    <div class="workbench">
      <FormBuilder :state="state" :onSave="saveDebounced" />
    </div>

    <FloatingPreview v-if="showPreview" ref="floating" url="/preview.html" :initialScale="0.4" />
  </div>
</template>
