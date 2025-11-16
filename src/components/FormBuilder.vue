<script setup>
import {computed, reactive, nextTick, ref, watch} from 'vue';
import SectionList from './SectionList.vue';
import SoftSkills from './SoftSkills.vue';
import DesignPanel from './DesignPanel.vue';
import {
  saveLocal, writeBackup, loadBackupIntoLocal,
  getBackupMode, setBackupMode
} from '../composables/useStorage';

const props = defineProps({
  state: { type: Object, required: true },
  onSave: { type: Function, default: () => {} }
});

const disabled = computed({
  get: ()=> props.state.disabled,
  set: v => props.state.disabled = v
});
const isHidden = (k)=> disabled.value.includes(k);
const toggleDisabled = (key)=>{
  const s = new Set(disabled.value);
  s.has(key) ? s.delete(key) : s.add(key);
  disabled.value = [...s];
};

const collapsed = reactive({ header:false, about:false, skills:false, hobbies:false, soft:false });

// Toggle: Speicherort (Browser ↔ Projekt)
const useProjectFile = ref(getBackupMode() === 'file')
watch(useProjectFile, (v) => setBackupMode(v ? 'file' : 'browser'))

const backupMsg = ref('')

const refsOptions = computed(()=>{
  const opts = [];
  const add = (id,label)=> opts.push({id,label});
  props.state.experience.job.forEach((r,i)=> add('exp-job:'+i,  [r.title,r.company].filter(Boolean).join(' – ') || `Eintrag ${i+1}`));
  props.state.experience.personal.forEach((r,i)=> add('exp-personal:'+i, [r.title,r.sub].filter(Boolean).join(' – ') || `Eintrag ${i+1}`));
  props.state.education.forEach((r,i)=> add('education:'+i,   [r.title,r.sub].filter(Boolean).join(' – ') || `Eintrag ${i+1}`));
  props.state.projects.forEach((r,i)=> add('projects:'+i,     r.title || `Eintrag ${i+1}`));
  props.state.custom.forEach((r,i)=> add('custom:'+i,         r.title || `Eintrag ${i+1}`));
  return opts;
});

// JSON Export => Backup je nach Modus
const doExport = async () => {
  const snapshot = JSON.parse(JSON.stringify(props.state))
  saveLocal(snapshot)
  const res = await writeBackup(snapshot) // nutzt den gesetzten Modus intern
  if (res?.ok) {
    backupMsg.value =
        res.where === 'server' ? 'Gespeichert im Projekt (Dev-Server).' :
            res.where === 'file'   ? 'Gespeichert in Projektdatei (FS-API).' :
                res.where === 'opfs'   ? 'Gespeichert im Browser-OPFS.' :
                    'Gespeichert in LocalStorage.'
  } else {
    backupMsg.value = 'Backup fehlgeschlagen.'
  }
}

const doImport = async () => {
  const r = await loadBackupIntoLocal() // nutzt den gesetzten Modus intern
  if (r.ok && r.data) {
    Object.assign(props.state, { ...props.state, ...r.data })
    props.onSave?.()
    backupMsg.value = 'Backup geladen.'
  } else {
    backupMsg.value = 'Kein Backup gefunden.'
  }
}

// Neue Custom-Sektion unten anhängen (damit sie direkt sichtbar ist)
const addCustom = async () => {
  props.state.custom.push({ title:'', place:'', start:'', end:'', bullets:'' })
  await nextTick()
  document.querySelector('[data-section="custom"] .item-row:last-of-type')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Tastatursteuerung für Toggle
const onToggleKey = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    useProjectFile.value = !useProjectFile.value
  }
}
</script>

<template>
  <form class="builder builder--cli" @submit.prevent>
    <header>
      <!--<strong>CV-Formular</strong> -->
      <div class="header-actions">
        <!-- TOGGLE: Speicherort -->
        <div class="toggle-field">
          <span class="toggle-caption">Speicherort:</span>

          <button
              type="button"
              class="toggle"
              role="switch"
              :aria-checked="useProjectFile ? 'true' : 'false'"
              :class="{ 'is-on': useProjectFile }"
              @click="useProjectFile = !useProjectFile"
              @keydown="onToggleKey"
              aria-label="Speicherort umschalten"
          >
            <span class="toggle-track">
              <span class="toggle-label left">Browser</span>
              <span class="toggle-label right">Projekt</span>
              <span class="toggle-thumb"></span>
            </span>
          </button>
        </div>

        <button type="button" class="btn btn--warning" @click="doImport">Laden</button>
        <button type="button" class="btn btn--primary" @click="doExport">Speichern</button>
        <span class="note" v-if="backupMsg">{{ backupMsg }}</span>
      </div>
    </header>

    <div class="body">
      <!-- Header -->
      <section class="section-group" data-section="header" :class="{collapsed:collapsed.header}">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.header=!collapsed.header">▾</button>
          <h3>Header & Kontakt</h3>
        </div>
        <div class="grid-2">
          <label>Name<input type="text" v-model="state.header.name" placeholder="Alex Muster"/></label>
          <label>Ort<input type="text" v-model="state.header.location" placeholder="Berlin, DE"/></label>
        </div>
        <div class="grid-2">
          <label>Rolle<input type="text" v-model="state.header.role" placeholder="Software Engineer"/></label>
          <span></span>
        </div>
        <div class="grid-2">
          <label>E-Mail<input type="email" v-model="state.header.email" placeholder="alex@example.com"/></label>
          <label>Telefon<input type="tel" v-model="state.header.phone" placeholder="+49 171 2345678"/></label>
        </div>
        <div class="grid-2">
          <label>Website<input type="url" v-model="state.header.website" placeholder="https://alexmuster.dev"/></label>
          <label>LinkedIn<input type="url" v-model="state.header.linkedin" placeholder="https://linkedin.com/in/alexmuster"/></label>
        </div>
      </section>

      <!-- About -->
      <section class="section-group" data-section="about" :class="[{disabled:isHidden('about')},{collapsed:collapsed.about}]">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.about=!collapsed.about">▾</button>
          <h3>Selbstbeschreibung</h3>
          <div style="margin-left:auto">
            <button class="mini" :class="[isHidden('about')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('about')">
              {{ isHidden('about') ? 'Einblenden' : 'Ausblenden' }}
            </button>
          </div>
        </div>
        <label>Text<textarea v-model="state.about.text" placeholder="Kurzprofil in 2–4 Sätzen: Wirkung, Stärken, Tech-Stack …"></textarea></label>
      </section>

      <!-- Experience job -->
      <SectionList
          title="Berufserfahrung"
          sectionKey="exp-job"
          v-model="state.experience.job"
          :schema="[
          {label:'Position', key:'title', type:'text', placeholder:'Senior Software Engineer'},
          {label:'Unternehmen', key:'company', type:'text', placeholder:'Acme GmbH'},
          {label:'Ort', key:'place', type:'text', placeholder:'Berlin'},
          {label:'Start', key:'start', type:'text', placeholder:'2021 / 05'},
          {label:'Ende', key:'end', type:'text', placeholder:'heute'},
          {label:'Aufgaben/Erfolge (eine je Zeile)', key:'bullets', type:'textarea', placeholder:'Skalierung von X\nEinführung CI/CD\nMentoring'}
        ]"
          addLabel="Eintrag hinzufügen"
          :disabled="isHidden('exp-job')"
          @toggle-section="toggleDisabled('exp-job')"
      />

      <!-- Experience personal -->
      <SectionList
          title="Persönliche Erfahrung & Hackathons"
          sectionKey="exp-personal"
          v-model="state.experience.personal"
          :schema="[
          {label:'Titel', key:'title', type:'text', placeholder:'Hackathon XYZ'},
          {label:'Untertitel', key:'sub', type:'text', placeholder:'1. Platz – Team von 4'},
          {label:'Ort', key:'place', type:'text', placeholder:'Hamburg'},
          {label:'Start', key:'start', type:'text', placeholder:'2024 / 03'},
          {label:'Ende', key:'end', type:'text', placeholder:'2024 / 03'},
          {label:'Kurzbeschreibung', key:'desc', type:'textarea', placeholder:'Prototyp einer ML-App, 48h Sprint …'}
        ]"
          addLabel="Eintrag hinzufügen"
          :disabled="isHidden('exp-personal')"
          @toggle-section="toggleDisabled('exp-personal')"
      />

      <!-- Education -->
      <SectionList
          title="Ausbildung"
          sectionKey="education"
          v-model="state.education"
          :schema="[
          {label:'Abschluss/Titel', key:'title', type:'text', placeholder:'M.Sc. Informatik'},
          {label:'Institution', key:'sub', type:'text', placeholder:'TU München'},
          {label:'Ort', key:'place', type:'text', placeholder:'München'},
          {label:'Start', key:'start', type:'text', placeholder:'2017'},
          {label:'Ende', key:'end', type:'text', placeholder:'2020'},
          {label:'Schwerpunkte (optional)', key:'desc', type:'textarea', placeholder:'KI, Softwarearchitektur'}
        ]"
          addLabel="Eintrag hinzufügen"
          :disabled="isHidden('education')"
          @toggle-section="toggleDisabled('education')"
      />

      <!-- Projects -->
      <SectionList
          title="Projekte & Publikationen"
          sectionKey="projects"
          v-model="state.projects"
          :schema="[
          {label:'Titel/Repo', key:'title', type:'text', placeholder:'Open Source Tool – repo/name'},
          {label:'Ort', key:'place', type:'text', placeholder:'Remote'},
          {label:'Start', key:'start', type:'text', placeholder:'2025'},
          {label:'Ende', key:'end', type:'text', placeholder:'2025'},
          {label:'Kurzbeschreibung', key:'desc', type:'textarea', placeholder:'CLI-Tool zur …'}
        ]"
          addLabel="Eintrag hinzufügen"
          :disabled="isHidden('projects')"
          @toggle-section="toggleDisabled('projects')"
      />

      <!-- Skills -->
      <section class="section-group" data-section="skills" :class="[{disabled:isHidden('skills')},{collapsed:collapsed.skills}]">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.skills=!collapsed.skills">▾</button>
          <h3>Fähigkeiten</h3>
          <div style="margin-left:auto">
            <button class="mini" :class="[isHidden('skills')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('skills')">
              {{ isHidden('skills') ? 'Einblenden' : 'Ausblenden' }}
            </button>
          </div>
        </div>
        <div class="grid-3">
          <label>Programmiersprachen<input type="text" v-model="(state.skills.langsString)" placeholder="Python, TypeScript, Go"
                                           @input="state.skills.langs = (state.skills.langsString||'').split(',').map(s=>s.trim()).filter(Boolean)"/></label>
          <label>Frameworks & Tools<input type="text" v-model="(state.skills.toolsString)" placeholder="React, Docker, Kubernetes"
                                          @input="state.skills.tools = (state.skills.toolsString||'').split(',').map(s=>s.trim()).filter(Boolean)"/></label>
          <label>Methoden & Architektur<input type="text" v-model="(state.skills.methodsString)" placeholder="System Design, TDD, CI/CD"
                                              @input="state.skills.methods = (state.skills.methodsString||'').split(',').map(s=>s.trim()).filter(Boolean)"/></label>
        </div>
      </section>

      <!-- Languages: CEFR -->
      <SectionList
          title="Sprachen"
          sectionKey="languages"
          v-model="state.languages"
          :schema="[
          {label:'Sprache', key:'name', type:'text', placeholder:'Deutsch'},
          {label:'Niveau', key:'level', type:'select', options:['Muttersprache','C2','C1','B2','B1','A2','A1']}
        ]"
          addLabel="Sprache hinzufügen"
          :disabled="isHidden('languages')"
          @toggle-section="toggleDisabled('languages')"
      />

      <!-- Certs -->
      <SectionList
          title="Zertifikate"
          sectionKey="certs"
          v-model="state.certs"
          :schema="[
          {label:'Zertifikat', key:'name', type:'text', placeholder:'AWS Solutions Architect'},
          {label:'Jahr', key:'year', type:'text', placeholder:'2023'}
        ]"
          addLabel="Zertifikat hinzufügen"
          :disabled="isHidden('certs')"
          @toggle-section="toggleDisabled('certs')"
      />

      <!-- Hobbies -->
      <section class="section-group" data-section="hobbies" :class="[{disabled:isHidden('hobbies')},{collapsed:collapsed.hobbies}]">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.hobbies=!collapsed.hobbies">▾</button>
          <h3>Hobbys</h3>
          <div style="margin-left:auto">
            <button class="mini" :class="[isHidden('hobbies')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('hobbies')">
              {{ isHidden('hobbies') ? 'Einblenden' : 'Ausblenden' }}
            </button>
          </div>
        </div>
        <label>Musik produzieren – Details<input type="text" v-model="state.hobbies.music" placeholder="Genres, DAW, Releases …"/></label>
      </section>

      <!-- Design -->
      <DesignPanel v-model="state.design" />

      <!-- Custom -->
      <SectionList
          title="Eigene Sektionen"
          sectionKey="custom"
          v-model="state.custom"
          :schema="[
          {label:'Titel', key:'title', type:'text', placeholder:'Konferenzen / Ehrenamt / …'},
          {label:'Ort', key:'place', type:'text', placeholder:'Köln'},
          {label:'Start', key:'start', type:'text', placeholder:'2024 – 04'},
          {label:'Ende', key:'end', type:'text', placeholder:'heute'},
          {label:'Punkte (eine je Zeile)', key:'bullets', type:'textarea', placeholder:'Aufgabe A\nErfolg B'}
        ]"
          addLabel="Eintrag hinzufügen"
      />

      <div style="display:flex;justify-content:flex-end">
        <button type="button" class="btn btn--success" @click="addCustom">Neue Sektion</button>
      </div>

      <!-- Softskills -->
      <section class="section-group" data-section="softskills" :class="{collapsed:collapsed.soft}">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.soft=!collapsed.soft">▾</button>
          <h3>Soft Skills – Checkliste</h3>
        </div>
        <SoftSkills v-model="state.softskills" :options="refsOptions" />
      </section>
    </div>
  </form>
</template>

<style scoped>
.header-actions{
  display:flex; gap:8px; align-items:center; flex-wrap:wrap;
}

/* Toggle */
.toggle-field{ display:flex; align-items:center; gap:8px; }
.toggle-caption{ font-size:12px; color: var(--muted); }

.toggle{
  border:0; background:transparent; padding:0; cursor:pointer; outline:none;
}
.toggle-track{
  position:relative; display:inline-flex; align-items:center; justify-content:space-around;
  width: 120px; height: 36px; border-radius:999px;
  background: #0c131a; border:1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}
.toggle-label{ font-size:11px; opacity:.75; color:#cbd5e1; z-index:1; user-select:none; }
.toggle-thumb{
  position:absolute; top:2px; left:2px;
  width: 58px; height: 30px; border-radius:999px;
  background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.12);
  transition: transform .18s ease;
}

/* Zustände / Farben (retro CLI + Signalfarben) */
.toggle:not(.is-on) .toggle-track{
  background: linear-gradient(180deg, rgba(99,102,241,.22), rgba(59,130,246,.14));
  border-color: rgba(59,130,246,.45);
}
.toggle.is-on .toggle-track{
  background: linear-gradient(180deg, rgba(34,197,94,.25), rgba(16,185,129,.15));
  border-color: rgba(16,185,129,.45);
}
.toggle.is-on .toggle-thumb{ transform: translateX(56px); }

.note {position: absolute; left: 17%;}
</style>
