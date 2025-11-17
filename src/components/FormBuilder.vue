<script setup>
import { computed, reactive, nextTick, ref, watch } from 'vue';
import SectionList from './SectionList.vue';
import SoftSkills from './SoftSkills.vue';
import DesignPanel from './DesignPanel.vue';
import {
  saveLocal, writeBackup, loadBackupIntoLocal,
  getBackupMode, setBackupMode
} from '../composables/useStorage';
import { makeT } from '../i18n/dict.js';

const props = defineProps({
  state: { type: Object, required: true },
  onSave: { type: Function, default: () => {} }
});

const langRef = computed({
  get: () => props.state.lang || 'de',
  set: v => props.state.lang = v
});
const t = makeT(langRef);

/* ===== Hide / Collapse handling ===== */
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

/* ===== Storage Mode Toggle (Browser ↔ Projekt) ===== */
const useProjectFile = ref(getBackupMode() === 'file');
watch(useProjectFile, (v) => setBackupMode(v ? 'file' : 'browser'));
const backupMsg = ref('');

const refsOptions = computed(()=>{
  const opts = [];
  const add = (id,label)=> opts.push({id,label});
  props.state.experience.job.forEach((r,i)=> add('exp-job:'+i,  [r.title,r.company].filter(Boolean).join(' – ') || `Entry ${i+1}`));
  props.state.experience.personal.forEach((r,i)=> add('exp-personal:'+i, [r.title,r.sub].filter(Boolean).join(' – ') || `Entry ${i+1}`));
  props.state.education.forEach((r,i)=> add('education:'+i,   [r.title,r.sub].filter(Boolean).join(' – ') || `Entry ${i+1}`));
  props.state.projects.forEach((r,i)=> add('projects:'+i,     r.title || `Entry ${i+1}`));
  props.state.custom.forEach((r,i)=> add('custom:'+i,         r.title || `Entry ${i+1}`));
  return opts;
});

/* ===== Export / Import ===== */
const doExport = async () => {
  const snapshot = JSON.parse(JSON.stringify(props.state));
  saveLocal(snapshot);
  const res = await writeBackup(snapshot);
  if (res?.ok) {
    backupMsg.value =
        res.where === 'server' ? t('savedProjectDevSrv') :
            res.where === 'file'   ? t('savedProjectFsApi') :
                res.where === 'opfs'   ? t('savedBrowserOPFS') : t('savedBrowserLs');
  } else {
    backupMsg.value = t('saveError')
  }
};

const doImport = async () => {
  const r = await loadBackupIntoLocal();
  if (r.ok && r.data) {
    Object.assign(props.state, { ...props.state, ...r.data });
    props.onSave?.();
    backupMsg.value = t('backupBrowser');
  } else {
    backupMsg.value = t('backupNotFound');
  }
};

/* ===== Neue Custom-Sektion unten anhängen ===== */
const addCustom = async () => {
  props.state.custom.push({ title:'', place:'', start:'', end:'', bullets:'' });
  await nextTick();
  document.querySelector('[data-section="custom"] .item-row:last-of-type')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
</script>

<template>
  <form class="builder builder--cli" @submit.prevent>
    <header>
      <div class="header-actions">
        <!-- Save Location -->
        <div class="toggle-field">
          <span class="toggle-caption">{{ t('storageCaption') }}:</span>
          <button
              type="button"
              class="toggle"
              role="switch"
              :aria-checked="useProjectFile ? 'true' : 'false'"
              :class="{ 'is-on': useProjectFile }"
              @click="useProjectFile = !useProjectFile"
          >
            <span class="toggle-track">
              <span class="toggle-label left">Browser</span>
              <span class="toggle-label right">Projekt</span>
              <span class="toggle-thumb"></span>
            </span>
          </button>
        </div>

        <!-- Language -->
        <div class="toggle-field">
          <span class="toggle-caption">{{ t('languageCaption') }}:</span>
          <button
              type="button"
              class="toggle"
              role="switch"
              :aria-checked="langRef==='en' ? 'true' : 'false'"
              :class="{ 'is-on': langRef==='en' }"
              @click="langRef = (langRef==='de' ? 'en' : 'de')"
          >
            <span class="toggle-track">
              <span class="toggle-label left">DE</span>
              <span class="toggle-label right">EN</span>
              <span class="toggle-thumb"></span>
            </span>
          </button>
        </div>

        <button type="button" class="btn btn--warning" @click="doImport">{{ t('load') }}</button>
        <button type="button" class="btn btn--primary" @click="doExport">{{ t('save') }}</button>
        <span class="note" v-if="backupMsg">{{ backupMsg }}</span>
      </div>
    </header>

    <div class="body">
      <!-- Header -->
      <section class="section-group" data-section="header" :class="{collapsed:collapsed.header}">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.header=!collapsed.header">▾</button>
          <h3>{{ t('headerTitle') }}</h3>
        </div>
        <div class="grid-2">
          <label>{{ t('name') }}<input type="text" v-model="state.header.name" placeholder="Alex Muster"/></label>
          <label>{{ t('location') }}<input type="text" v-model="state.header.location" placeholder="Berlin, DE"/></label>
        </div>
        <div class="grid-2">
          <label>{{ t('role') }}<input type="text" v-model="state.header.role" placeholder="Software Engineer"/></label>
          <span></span>
        </div>
        <div class="grid-2">
          <label>{{ t('email') }}<input type="email" v-model="state.header.email" placeholder="alex@example.com"/></label>
          <label>{{ t('phone') }}<input type="tel" v-model="state.header.phone" placeholder="+49 123 456789"/></label>
        </div>
        <div class="grid-2">
          <label>{{ t('website') }}<input type="url" v-model="state.header.website" placeholder="https://alexmuster.dev"/></label>
          <label>{{ t('linkedin') }}<input type="url" v-model="state.header.linkedin" placeholder="https://linkedin.com/in/alexmuster"/></label>
        </div>
      </section>

      <!-- About -->
      <section class="section-group" data-section="about" :class="[{disabled:isHidden('about')},{collapsed:collapsed.about}]">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.about=!collapsed.about">▾</button>
          <h3>{{ t('aboutTitle') }}</h3>
          <div style="margin-left:auto">
            <button class="mini" :class="[isHidden('about')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('about')">
              {{ isHidden('about') ? t('show') : t('hide') }}
            </button>
          </div>
        </div>
        <label>{{ t('aboutTextLabel') }}<textarea v-model="state.about.text" placeholder='Me in a nutshell...'></textarea></label>
      </section>

      <!-- Experience job -->
      <SectionList
          :title="t('expJobTitle')"
          :lang="langRef"
          sectionKey="exp-job"
          v-model="state.experience.job"
          :schema="[
          {label:t('position'), key:'title', type:'text', placeholder:'Senior Software Engineer'},
          {label:t('company'),  key:'company', type:'text', placeholder:'Acme GmbH'},
          {label:t('place'),    key:'place', type:'text', placeholder:'Berlin'},
          {label:t('start'),    key:'start', type:'text', placeholder:'05.2021'},
          {label:t('end'),      key:'end', type:'text', placeholder: t('current')},
          {label:t('bulletsLabel'), key:'bullets', type:'textarea', placeholder:t('tasks')}
        ]"
          :addLabel="t('addEntry')"
          :disabled="isHidden('exp-job')"
          @toggle-section="toggleDisabled('exp-job')"
          toggle-style="icon"
      />

      <!-- Experience personal -->
      <SectionList
          :title="t('expPersonalTitle')"
          :lang="langRef"
          sectionKey="exp-personal"
          v-model="state.experience.personal"
          :schema="[
          {label:t('title'),    key:'title', type:'text', placeholder:'Hackathon XYZ'},
          {label:t('subtitle'), key:'sub', type:'text', placeholder:t('hackathonTitlePH') },
          {label:t('place'),    key:'place', type:'text', placeholder:'Hamburg'},
          {label:t('start'),    key:'start', type:'text', placeholder:'03.2024'},
          {label:t('end'),      key:'end', type:'text', placeholder:'03.2024'},
          {label:t('desc'),     key:'desc', type:'textarea', placeholder: t('hackathonPH')}
        ]"
          :addLabel="t('addEntry')"
          :disabled="isHidden('exp-personal')"
          @toggle-section="toggleDisabled('exp-personal')"
          toggle-style="icon"
      />

      <!-- Education -->
      <SectionList
          :title="t('educationTitle')"
          :lang="langRef"
          sectionKey="education"
          v-model="state.education"
          :schema="[
          {label:t('degreeTitle'), key:'title', type:'text', placeholder:'M.Sc. Informatik'},
          {label:t('institution'), key:'sub', type:'text', placeholder:'TU München'},
          {label:t('place'),       key:'place', type:'text', placeholder:'Hamburg'},
          {label:t('start'),       key:'start', type:'text', placeholder:'2017'},
          {label:t('end'),         key:'end', type:'text', placeholder:'2020'},
          {label:t('focus'),       key:'desc', type:'textarea', placeholder:'AI'}
        ]"
          :addLabel="t('addEntry')"
          :disabled="isHidden('education')"
          @toggle-section="toggleDisabled('education')"
          toggle-style="icon"
      />

      <!-- Projects -->
      <SectionList
          :title="t('projectsTitle')"
          :lang="langRef"
          sectionKey="projects"
          v-model="state.projects"
          :schema="[
          {label:t('projectTitle'), key:'title', type:'text', placeholder:'Open Source Tool – repo/name'},
          {label:t('place'),        key:'place', type:'text', placeholder:'Remote'},
          {label:t('start'),        key:'start', type:'text', placeholder:'2025'},
          {label:t('end'),          key:'end', type:'text', placeholder:'2025'},
          {label:t('desc'),         key:'desc', type:'textarea', placeholder: 'CLI tool XY …'}
        ]"
          :addLabel="t('addEntry')"
          :disabled="isHidden('projects')"
          @toggle-section="toggleDisabled('projects')"
          toggle-style="icon"
      />

      <!-- Skills -->
      <SectionList
          :title="t('skillsTitle')"
          :lang="langRef"
          sectionKey="skills"
          v-model="state.skills"
          :schema="[
            {label:t('category'), key:'title', type:'text', placeholder:t('programmingLanguages')},
            {label:t('entryCSV'), key:'tags', type:'text', placeholder:'Python, TypeScript, Go'}
          ]"
          :disabled="isHidden('skills')"
          @toggle-section="toggleDisabled('skills')"
          :addLabel="t('addSkillType')"
          toggle-style="icon"
      />

      <!-- Languages: CEFR -->
      <SectionList
          :title="t('languagesTitle')"
          :lang="langRef"
          sectionKey="languages"
          v-model="state.languages"
          :schema="[
            {label:t('languageName'), key:'name', type:'text', placeholder:t('german')},
            {label:t('level'), key:'level', type:'select', options: [(langRef==='de'?'nativ':'native'),'C2','C1','B2','B1','A2','A1']}
          ]"
          :addLabel="t('addLanguage')"
          :disabled="isHidden('languages')"
          @toggle-section="toggleDisabled('languages')"
          toggle-style="icon"
      />

      <!-- Certs -->
      <SectionList
          :title="t('certsTitle')"
          :lang="langRef"
          sectionKey="certs"
          v-model="state.certs"
          :schema="[
          {label:t('certificate'), key:'name', type:'text', placeholder:'AWS Solutions Architect'},
          {label:t('yearShort'),  key:'year', type:'text', placeholder:'2023'}
        ]"
          :addLabel="t('addCert')"
          :disabled="isHidden('certs')"
          @toggle-section="toggleDisabled('certs')"
          toggle-style="icon"
      />

      <!-- Hobbies -->
      <SectionList
          :title="t('hobbiesTitle')"
          :lang="langRef"
          sectionKey="hobbies"
          v-model="state.hobbies"
          :schema="[
            {label: 'Hobby',   key:'name',    type:'text', placeholder:'Music Production'},
            {label: 'Details', key:'details', type:'text', placeholder:'Genres, DAW, Releases …'}
          ]"
          :addLabel="(langRef==='de'?'Hobby hinzufügen':'Add hobby')"
          :disabled="isHidden('hobbies')"
          @toggle-section="toggleDisabled('hobbies')"
          toggle-style="icon"
      />

      <!-- Custom -->
      <SectionList
          :title="t('customTitle')"
          :lang="langRef"
          sectionKey="custom"
          v-model="state.custom"
          :schema="[
          {label:t('title'), key:'title', type:'text', placeholder:t('customSectionPH')},
          {label:t('place'), key:'place', type:'text', placeholder:'Berlin'},
          {label:t('start'), key:'start', type:'text', placeholder:'04.2024'},
          {label:t('end'),   key:'end', type:'text', placeholder:t('current')},
          {label:t('bulletsLabel'), key:'bullets', type:'textarea', placeholder:'Achievement 1\nAchievement 2\n…'}
        ]"
          :addLabel="t('addEntry')"
          toggle-style="icon"
      />

      <div style="display:flex;justify-content:flex-end">
        <button type="button" class="btn btn--success" @click="addCustom">{{ t('newSection') }}</button>
      </div>

      <!-- Design -->
      <DesignPanel v-model="state.design" />

      <!-- Softskills -->
      <section class="section-group" data-section="softskills" :class="{collapsed:collapsed.soft}">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.soft=!collapsed.soft">▾</button>
          <h3>{{ t('softSkillsTitle') }}</h3>
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

/* States / Colors (retro CLI) */
.toggle:not(.is-on) .toggle-track{
  background: linear-gradient(180deg, rgba(99,102,241,.22), rgba(59,130,246,.14));
  border-color: rgba(59,130,246,.45);
}
.toggle.is-on .toggle-track{
  background: linear-gradient(180deg, rgba(34,197,94,.25), rgba(16,185,129,.15));
  border-color: rgba(16,185,129,.45);
}
.toggle.is-on .toggle-thumb{ transform: translateX(56px); }

.note {align-items: start}
</style>
