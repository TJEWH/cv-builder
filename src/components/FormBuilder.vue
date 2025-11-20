<script setup>
import { computed, reactive, nextTick } from 'vue';
import SectionList from './SectionList.vue';
import SoftSkills from './SoftSkills.vue';
import DesignPanel from './DesignPanel.vue';
import { makeT } from '../i18n/dict.js';
import sectionIcons from '../i18n/sectionIcons.js';

const props = defineProps({
  state: { type: Object, required: true },
  onSave: { type: Function, default: null }
});

const langRef = computed({
  get: () => props.state.lang || 'de',
  set: v => props.state.lang = v
});
const t = makeT(langRef);

const refsOptions = computed(()=>{
  const opts = [];
  const add = (id,label)=> opts.push({id,label});
  props.state.experience.jobs.forEach((r,i)=> add('jobs:'+i,            [r.title,r.company].filter(Boolean).join('  ') || `Entry ${i+1}`));
  props.state.experience.addExp.forEach((r,i)=> add('addExp:'+i,        [r.title,r.sub].filter(Boolean).join('  ') || `Entry ${i+1}`));
  props.state.experience.projects.forEach((r,i)=> add('projects:'+i,    r.title || `Entry ${i+1}`));
  props.state.education.forEach((r,i)=> add('education:'+i,             [r.title,r.sub].filter(Boolean).join('  ') || `Entry ${i+1}`));
  props.state.custom.forEach((r,i)=> add('custom:'+i,                   r.title || `Entry ${i+1}`));
  return opts;
});

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
const collapsed = reactive({ contact:false, about:false, skills:false, hobbies:false, soft:false });

/* ===== Add new custom section ===== */
const addCustom = async () => {
  props.state.custom.push({ title:'', place:'', start:'', end:'', bullets:'' });
  await nextTick();
  document.querySelector('[data-section="custom"] .item-row:last-of-type')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// helper to get icon name for a section
const getIcon = (key) => sectionIcons[key] || 'folder-open';

/* ===== Section placement & ordering helpers ===== */
// Ensure sectionPlacement exists on state
if(!props.state.sectionPlacement) props.state.sectionPlacement = {};


// known sections list (keine direkte Verwendung hier, behalte als Kommentar)
// ['about','jobs','education','projects','custom','skills','languages','certs','hobbies','jobs','addExp'];

const previewKeyFor = (key) => {
  if(!key) return key;
  if(String(key).startsWith('exp-')) return 'experience';
  // other mappings could be added here if needed
  return key;
};

const currentArea = (key) => {
  const pKey = previewKeyFor(key);
  if(props.state.sectionPlacement && props.state.sectionPlacement[pKey]) return props.state.sectionPlacement[pKey];
  // derive from order arrays
  if(Array.isArray(props.state.orderMain) && props.state.orderMain.includes(pKey)) return 'body';
  if(Array.isArray(props.state.orderSide) && props.state.orderSide.includes(pKey)) return 'sidebar';
  // default to body when not present
  return 'body';
};

const setArea = (key, area)=>{
  const pKey = previewKeyFor(key);
  // ensure arrays exist
  if(!Array.isArray(props.state.orderMain)) props.state.orderMain = [];
  if(!Array.isArray(props.state.orderSide)) props.state.orderSide = [];

  // remove pKey from both arrays fully
  props.state.orderMain = props.state.orderMain.filter(x=>x!==pKey);
  props.state.orderSide = props.state.orderSide.filter(x=>x!==pKey);

  if(area==='body'){
    props.state.orderMain.push(pKey);
  }else if(area==='sidebar'){
    props.state.orderSide.push(pKey);
  }

  // sanitize arrays: unique and exclusive
  props.state.orderMain = Array.from(new Set(props.state.orderMain.filter(Boolean)));
  props.state.orderSide = Array.from(new Set(props.state.orderSide.filter(Boolean)));
  // ensure exclusivity (remove any overlap)
  props.state.orderSide = props.state.orderSide.filter(x => !props.state.orderMain.includes(x));

  // store placement keyed by preview block key
  props.state.sectionPlacement = { ...(props.state.sectionPlacement||{}), [pKey]: area };

  console.debug('[FormBuilder] setArea', { key, pKey, area, orderMain: props.state.orderMain, orderSide: props.state.orderSide, sectionPlacement: props.state.sectionPlacement });

  // trigger immediate save/publish if provided (App.vue passes saveDebounced)
  try{ props.onSave?.(); }catch(e){ console.warn('onSave failed', e); }
};

const moveInArray = (arr, from, to)=>{
  if(!Array.isArray(arr)) return arr;
  if(from<0 || from>=arr.length || to<0 || to>=arr.length) return arr;
  const copy = arr.slice();
  const [it] = copy.splice(from,1);
  copy.splice(to,0,it);
  return copy;
};

const moveUp = (key)=>{
  const pKey = previewKeyFor(key);
  const area = currentArea(key);
  const list = area==='body' ? props.state.orderMain : area==='sidebar' ? props.state.orderSide : null;
  if(!Array.isArray(list)) return;
  const idx = list.indexOf(pKey);
  if(idx>0){
    const updated = moveInArray(list, idx, idx-1);
    if(area==='body') props.state.orderMain = updated;
    else props.state.orderSide = updated;
    console.debug('[FormBuilder] moveUp', { key, pKey, area, orderMain: props.state.orderMain, orderSide: props.state.orderSide });
    try{ props.onSave?.(); }catch(e){ console.warn('onSave failed', e); }
  }
};
const moveDown = (key)=>{
  const pKey = previewKeyFor(key);
  const area = currentArea(key);
  const list = area==='body' ? props.state.orderMain : area==='sidebar' ? props.state.orderSide : null;
  if(!Array.isArray(list)) return;
  const idx = list.indexOf(pKey);
  if(idx>=0 && idx<list.length-1){
    const updated = moveInArray(list, idx, idx+1);
    if(area==='body') props.state.orderMain = updated;
    else props.state.orderSide = updated;
    console.debug('[FormBuilder] moveDown', { key, pKey, area, orderMain: props.state.orderMain, orderSide: props.state.orderSide });
    try{ props.onSave?.(); }catch(e){ console.warn('onSave failed', e); }
  }
};

const areaModel = (key) => computed({
  get: () => currentArea(key),
  set: (v) => setArea(key, v)
});

// create stable computed refs for template binding (avoid calling areaModel('x') directly in template)
const areaAbout = areaModel('about');
const areaEducation = areaModel('education');
const areaExpJob = areaModel('jobs');
const areaExpPersonal = areaModel('addExp');
const areaProjects = areaModel('projects');
const areaCustom = areaModel('custom');
const areaSkills = areaModel('skills');
const areaLanguages = areaModel('languages');
const areaHobbies = areaModel('hobbies');
const areaCerts = areaModel('certs');
</script>

<template>
  <div class="workbench">
    <form class="builder builder--cli" @submit.prevent>

      <div class="body">
        <!-- Header -->
        <section class="section-group" data-section="header" :class="{collapsed:collapsed.header}">
          <div class="section-head">
            <button class="caret mini" type="button" @click="collapsed.header=!collapsed.header">
              <font-awesome-icon :icon="['fas', getIcon('header')]" class="section-icon" aria-hidden="true" />
            </button>
            <h3>{{ t('headerTitle') }}</h3>
          </div>
          <div class="grid-2">
            <label>{{ t('name') }}<input type="text" v-model="state.contact.name" placeholder="Alex Muster"/></label>
            <label>{{ t('location') }}<input type="text" v-model="state.contact.location" placeholder="Berlin, DE"/></label>
          </div>
          <div class="grid-2">
            <label>{{ t('role') }}<input type="text" v-model="state.contact.role" placeholder="Software Engineer"/></label>
            <span></span>
          </div>
          <div class="grid-2">
            <label>{{ t('email') }}<input type="email" v-model="state.contact.email" placeholder="alex@example.com"/></label>
            <label>{{ t('phone') }}<input type="tel" v-model="state.contact.phone" placeholder="+49 123 456789"/></label>
          </div>
          <div class="grid-2">
            <label>{{ t('website') }}<input type="url" v-model="state.contact.website" placeholder="https://alexmuster.dev"/></label>
            <label>{{ t('linkedin') }}<input type="url" v-model="state.contact.linkedin" placeholder="https://linkedin.com/in/alexmuster"/></label>
          </div>
        </section>

        <!-- About -->
        <section class="section-group" data-section="about" :class="[{disabled:isHidden('about')},{collapsed:collapsed.about}]">
          <div class="section-head">
            <button class="caret mini" type="button" @click="collapsed.about=!collapsed.about">
              <font-awesome-icon :icon="['fas', getIcon('about')]" class="section-icon" aria-hidden="true" />
            </button>
            <h3>{{ t('aboutTitle') }}</h3>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
              <select v-model="areaAbout">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('about')">▲</button>
              <button class="mini" type="button" @click="moveDown('about')">▼</button>
              <button class="mini" :class="[isHidden('about')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('about')">
                {{ isHidden('about') ? t('show') : t('hide') }}
              </button>
            </div>
          </div>
          <label>{{ t('aboutTextLabel') }}<textarea v-model="state.about.text" placeholder="Me in a nutshell..."></textarea></label>
        </section>

        <!-- Education -->
        <SectionList
            :title="t('educationTitle')"
            :lang="langRef"
            sectionKey="education"
            v-model="state.education"
            :schema="[
            {label:t('degreeTitle'), key:'title', type:'text', placeholder:'M.Sc. Informatik'},
            {label:t('institution'), key:'sub', type:'text', placeholder:'TU M\u00fcnchen'},
            {label:t('place'),       key:'place', type:'text', placeholder:'Hamburg'},
            {label:t('start'),       key:'start', type:'text', placeholder:'2017'},
            {label:t('end'),         key:'end', type:'text', placeholder:'2020'},
            {label:t('focus'),       key:'desc', type:'textarea', placeholder:'AI'}
          ]"
            :addLabel="t('addEntry')"
            :disabled="isHidden('education')"
            @toggle-section="toggleDisabled('education')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaEducation">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('education')">▲</button>
              <button class="mini" type="button" @click="moveDown('education')">▼</button>
            </div>
          </template>
        </SectionList>

        <!-- Experience job -->
        <SectionList
            :title="t('expJobTitle')"
            :lang="langRef"
            sectionKey="jobs"
            v-model="state.experience.jobs"
            :schema="[
            {label:t('position'), key:'title', type:'text', placeholder:'Senior Software Engineer'},
            {label:t('company'),  key:'company', type:'text', placeholder:'Acme GmbH'},
            {label:t('place'),    key:'place', type:'text', placeholder:'Berlin'},
            {label:t('start'),    key:'start', type:'text', placeholder:'05.2021'},
            {label:t('end'),      key:'end', type:'text', placeholder: t('current')},
            {label:t('bulletsLabel'), key:'bullets', type:'textarea', placeholder:t('tasks')}
          ]"
            :addLabel="t('addEntry')"
            :disabled="isHidden('jobs')"
            @toggle-section="toggleDisabled('jobs')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaExpJob">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('jobs')">▲</button>
              <button class="mini" type="button" @click="moveDown('jobs')">▼</button>
            </div>
          </template>
        </SectionList>

        <!-- Experience personal -->
        <SectionList
            :title="t('expPersonalTitle')"
            :lang="langRef"
            sectionKey="addExp"
            v-model="state.experience.addExp"
            :schema="[
            {label:t('title'),    key:'title', type:'text', placeholder:'Hackathon XYZ'},
            {label:t('subtitle'), key:'sub', type:'text', placeholder:t('hackathonTitlePH') },
            {label:t('place'),    key:'place', type:'text', placeholder:'Hamburg'},
            {label:t('start'),    key:'start', type:'text', placeholder:'03.2024'},
            {label:t('end'),      key:'end', type:'text', placeholder:'03.2024'},
            {label:t('desc'),     key:'desc', type:'textarea', placeholder: t('hackathonPH')}
          ]"
            :addLabel="t('addEntry')"
            :disabled="isHidden('addExp')"
            @toggle-section="toggleDisabled('addExp')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaExpPersonal">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('addExp')">▲</button>
              <button class="mini" type="button" @click="moveDown('addExp')">▼</button>
            </div>
          </template>
        </SectionList>

        <!-- Projects -->
        <SectionList
            :title="t('projectsTitle')"
            :lang="langRef"
            sectionKey="projects"
            v-model="state.experience.projects"
            :schema="[
            {label:t('projectTitle'), key:'title', type:'text', placeholder:'Open Source Tool - repo/name'},
            {label:t('place'),        key:'place', type:'text', placeholder:'Remote'},
            {label:t('start'),        key:'start', type:'text', placeholder:'2025'},
            {label:t('end'),          key:'end', type:'text', placeholder:'2025'},
            {label:t('desc'),         key:'desc', type:'textarea', placeholder: 'CLI tool XY -'}
          ]"
            :addLabel="t('addEntry')"
            :disabled="isHidden('projects')"
            @toggle-section="toggleDisabled('projects')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaProjects">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('projects')">▲</button>
              <button class="mini" type="button" @click="moveDown('projects')">▼</button>
            </div>
          </template>
        </SectionList>

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
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaSkills">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('skills')">▲</button>
              <button class="mini" type="button" @click="moveDown('skills')">▼</button>
            </div>
          </template>
        </SectionList>

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
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaLanguages">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('languages')">▲</button>
              <button class="mini" type="button" @click="moveDown('languages')">▼</button>
            </div>
          </template>
        </SectionList>

        <!-- Hobbies -->
        <SectionList
            :title="t('hobbiesTitle')"
            :lang="langRef"
            sectionKey="hobbies"
            v-model="state.hobbies"
            :schema="[
              {label: 'Hobby',   key:'name',    type:'text', placeholder:'Music Production'},
              {label: 'Details', key:'details', type:'text', placeholder:'Genres, DAW, Releases \u2026'}
            ]"
            :addLabel="(langRef==='de'?'Hobby hinzufügen':'Add hobby')"
            :disabled="isHidden('hobbies')"
            @toggle-section="toggleDisabled('hobbies')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaHobbies">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('hobbies')">▲</button>
              <button class="mini" type="button" @click="moveDown('hobbies')">▼</button>
            </div>
          </template>
        </SectionList>

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
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaCerts">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('certs')">▲</button>
              <button class="mini" type="button" @click="moveDown('certs')">▼</button>
            </div>
          </template>
        </SectionList>

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
              {label:t('bulletsLabel'), key:'bullets', type:'textarea', placeholder:'Achievement 1\\nAchievement 2\\n...'}
            ]"
            :addLabel="t('addEntry')"
            :disabled="isHidden('custom')"
            @toggle-section="toggleDisabled('custom')"
            toggle-style="icon"
        >
          <template #controls>
            <div style="display:flex;align-items:center;gap:8px">
              <select v-model="areaCustom">
                <option value="body">Body</option>
                <option value="sidebar">Sidebar</option>
              </select>
              <button class="mini" type="button" @click="moveUp('custom')">▲</button>
              <button class="mini" type="button" @click="moveDown('custom')">▼</button>
            </div>
          </template>
        </SectionList>

        <div style="display:flex;justify-content:flex-end">
          <button type="button" class="btn btn--success" @click="addCustom">{{ t('newSection') }}</button>
        </div>

        <!-- DEBUG: visible state for order/placement -->
        <section class="section-group" style="margin-top:12px;padding:8px;border:1px dashed var(--border);background:rgba(0,0,0,0.02)">
          <h4 style="margin:0 0 8px 0">Debug: Reihenfolge / Platzierung</h4>
          <div style="font-size:12px;line-height:1.2;white-space:pre-wrap;">orderMain: {{ JSON.stringify(state.orderMain) }}</div>
          <div style="font-size:12px;line-height:1.2;white-space:pre-wrap;">orderSide: {{ JSON.stringify(state.orderSide) }}</div>
          <div style="font-size:12px;line-height:1.2;white-space:pre-wrap;">sectionPlacement: {{ JSON.stringify(state.sectionPlacement) }}</div>
        </section>

        <!-- Design -->
        <DesignPanel v-model="state.design" />

        <!-- Softskills temp removal
        <section class="section-group" data-section="softSkills" :class="{collapsed:collapsed.soft}">
          <div class="section-head">
            <button class="caret mini" type="button" @click="collapsed.soft=!collapsed.soft">
              <font-awesome-icon :icon="['fas', getIcon('softSkills')]" class="section-icon" aria-hidden="true" />
            </button>
            <h3>{{ t('softSkillsTitle') }}</h3>
          </div>
          <SoftSkills v-model="state.softSkills" :options="refsOptions" />
        </section>
        -->
      </div>
    </form>
  </div>
</template>

<style scoped>
.section-icon{ margin-right:8px; color:var(--muted); }
.caret{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:26px; padding:0; }
.caret .section-icon{ margin:0; }
.section-controls select{ padding:4px 6px; }
</style>
