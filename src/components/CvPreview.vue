<script setup>
import { computed, watch } from 'vue';
import { makeT } from '../i18n/dict.js';

const props = defineProps({ state: { type: Object, required: true } });
const langRef = computed({ get: ()=> props.state.lang || 'de', set: v => (props.state.lang = v) });
const t = makeT(langRef);

const isDisabled = (k) => props.state.disabled.includes(k);
const hasAny = (arr)=> Array.isArray(arr) && arr.length>0;
const hasText = (s)=> !!(s && String(s).trim());

// Order gets extracted from formbuilder
const defaultMain = ['about','education','jobs','addExp','projects'];
const defaultSide = ['skills','languages','hobbies','certs'];

const blocksMain = computed(()=>{
  const base = Array.isArray(props.state.orderMain) && props.state.orderMain.length ? props.state.orderMain.slice() : defaultMain.slice();
  const placement = props.state.sectionPlacement || {};
  Object.keys(placement).forEach(k=>{ if(placement[k]==='body' && !base.includes(k)) base.push(k); });
  const sideKeys = new Set(Array.isArray(props.state.orderSide) ? props.state.orderSide : []);
  Object.keys(placement).forEach(k=>{ if(placement[k]==='sidebar') sideKeys.add(k); if(placement[k]==='body') sideKeys.delete(k); });
  // allow skills in both areas
  // Add custom sections that are in orderMain or have body placement
  if(Array.isArray(props.state.customSections)) {
    props.state.customSections.forEach(cs => {
      if(base.includes(cs.id) || placement[cs.id] === 'body') {
        if(!base.includes(cs.id)) base.push(cs.id);
      }
    });
  }
  return Array.from(new Set(base.filter(k => (k==='skills') ? true : !sideKeys.has(k))));
});

const blocksSide = computed(()=>{
  const base = Array.isArray(props.state.orderSide) && props.state.orderSide.length ? props.state.orderSide.slice() : defaultSide.slice();
  const placement = props.state.sectionPlacement || {};
  Object.keys(placement).forEach(k=>{ if(placement[k]==='sidebar' && !base.includes(k)) base.push(k); });
  const mainKeys = new Set(Array.isArray(props.state.orderMain) ? props.state.orderMain : []);
  Object.keys(placement).forEach(k=>{ if(placement[k]==='body') mainKeys.add(k); if(placement[k]==='sidebar') mainKeys.delete(k); });
  // Add custom sections that are in orderSide or have sidebar placement
  if(Array.isArray(props.state.customSections)) {
    props.state.customSections.forEach(cs => {
      if(base.includes(cs.id) || placement[cs.id] === 'sidebar') {
        if(!base.includes(cs.id)) base.push(cs.id);
      }
    });
  }
  return Array.from(new Set(base.filter(k => (k==='skills') ? true : !mainKeys.has(k))));
});

const showJobs = computed(()=> {
  const a = props.state.experience || {};
  return (!isDisabled('jobs') && hasAny(a.jobs));
});
const showAddExp = computed(()=> {
  const a = props.state.experience || {};
  return (!isDisabled('addExp') && hasAny(a.addExp));
});
const showProjects = computed(()=> {
  const a = props.state.experience || {};
  return (!isDisabled('projects') && hasAny(a.projects));
});

function formatMeta({ start, end, place }){
  const segs = [];
  const range = [start, end].filter(Boolean).join(t('rangeSep'));
  if(range) segs.push(range);
  if(place) segs.push(place);
  return segs.join(t('dotSep'));
}

// Helper to get custom section by id
const getCustomSection = (id) => {
  if(!Array.isArray(props.state.customSections)) return null;
  return props.state.customSections.find(cs => cs.id === id);
};

// Centralized visibility check used by template
const isHiddenFor = (key) => {
  if(key==='about')           return isDisabled('about') || !hasText(props.state.about?.text);
  if(key==='education')       return isDisabled('education') || !hasAny(props.state.education);
  if(key==='jobs')            return !showJobs.value;
  if(key==='addExp')          return !showAddExp.value;
  if(key==='projects')        return !showProjects.value;
  if(key==='skills')          return isDisabled('skills') || !hasAny(props.state.skills);
  if(key==='languages')       return isDisabled('languages') || !hasAny(props.state.languages);
  if(key==='certs')           return isDisabled('certs') || !hasAny(props.state.certs);
  if(key==='hobbies')         return isDisabled('hobbies') || !hasAny(props.state.hobbies);
  // Check if it's a custom section
  const customSection = getCustomSection(key);
  if(customSection) return isDisabled(key) || !hasAny(customSection.entries);
  return false;
};

// Debug logging to help track why a key is/was not shown
watch([blocksMain, blocksSide, () => props.state.sectionPlacement], ([bm, bs, sp])=>{
  try{
    console.debug('[CvPreview] blocksMain=', bm, 'blocksSide=', bs, 'sectionPlacement=', sp);
    console.debug('[CvPreview] visibleMain=', bm.filter(k=>!isHiddenFor(k)), 'visibleSide=', bs.filter(k=>!isHiddenFor(k)));
  }catch(e){}
},{deep:true, immediate:true});
</script>

<template>
  <div class="page" role="document">
    <header class="header">
      <div class="title">
        <h1 class="name">{{ state.contact.name || '-' }}</h1>
        <p class="role">{{ state.contact.role }}</p>
      </div>
      <address class="contact">
        <div>{{ state.contact.location }}</div>
        <div><a :href="state.contact.email ? 'mailto:'+state.contact.email : '#'">{{ state.contact.email }}</a></div>
        <div>{{ state.contact.phone }}</div>
        <div><a :href="state.contact.website || '#'">{{ (state.contact.website||'').replace(/^https?:\/\//,'') }}</a></div>
        <div><a :href="state.contact.linkedin || '#'">{{ (state.contact.linkedin||'').replace(/^https?:\/\//,'') }}</a></div>
      </address>
    </header>

    <section class="content">
      <!-- Main -->
      <div id="cv_main">
        <section v-for="key in blocksMain" :key="key" class="section cv-block"
                 :class="{ 'is-hidden': isHiddenFor(key) }">

          <!-- ABOUT -->
          <template v-if="key==='about'">
            <h2>{{ t('aboutTitle') }}</h2>
            <p>{{ state.about.text }}</p>
          </template>

          <!-- EXPERIENCE -->
          <template v-else-if="key==='jobs'">
            <h2>{{ t('expJobTitle') }}</h2>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.jobs" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.company||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <ul v-if="Array.isArray(it.bullets) && it.bullets.length">
                  <li v-for="(b,bi) in it.bullets" :key="bi">{{ b }}</li>
                </ul>
              </article>
            </div>
          </template>

          <template v-else-if="key==='addExp'">
            <h2>{{ t('subHeaderAddXP') }}</h2>
            <div id="cv_exp_personal" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm">
              <article class="item" v-for="(it,idx) in (Array.isArray(state.experience?.addExp)?state.experience.addExp:[])" :key="idx" style="border:1px solid var(--border);border-radius:6px;padding:6px">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- EDUCATION -->
          <template v-else-if="key==='education'">
            <h2>{{ t('educationTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- PROJECTS -->
          <template v-else-if="key==='projects'">
            <h2>{{ t('projectsTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.experience.projects" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- CUSTOM SECTIONS (dynamisch) -->
          <template v-else-if="getCustomSection(key)">
            <h2>{{ getCustomSection(key).name }}</h2>
            <div>
              <article class="item" v-for="(entry, idx) in getCustomSection(key).entries" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ entry.title }}</div>
                  <div class="item-meta">{{ formatMeta(entry) }}</div>
                </div>
                <p v-if="entry.desc">{{ entry.desc }}</p>
              </article>
            </div>
          </template>

          <!-- SKILLS (wenn im Main) -->
          <template v-else-if="key==='skills'">
            <h2>{{ t('skillsTitle') }}</h2>
            <div v-for="(grp,i) in state.skills" :key="i" style="margin-top:4mm">
              <h3 class="small">{{ grp.title }}</h3>
              <div class="tags">
                <span v-for="(tg,ti) in (String(grp.tags||'').split(',').map(x=>x.trim()).filter(Boolean))" :key="ti" class="tag">{{ tg }}</span>
              </div>
            </div>
          </template>

          <!-- LANGUAGES (wenn im Main) -->
          <template v-else-if="key==='languages'">
            <h2>{{ t('languagesTitle') }}</h2>
            <ul class="lang-list">
              <li v-for="(l,i) in state.languages" :key="i">
                <strong>{{ l.name }}</strong>
                <span>- {{ l.level }}</span>
              </li>
            </ul>
          </template>

          <!-- CERTS (wenn im Main) -->
          <template v-else-if="key==='certs'">
            <h2>{{ t('certsTitle') }}</h2>
            <ul><li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li></ul>
          </template>

          <!-- HOBBIES (wenn im Main) -->
          <template v-else-if="key==='hobbies'">
            <h2>{{ t('hobbiesTitle') }}</h2>
            <ul class="lang-list">
              <li v-for="(h,i) in state.hobbies" :key="i">
                <strong>{{ h.name }}</strong>
                <span v-if="h.details"> - {{ h.details }}</span>
              </li>
            </ul>
          </template>

        </section>
      </div>

      <aside class="sidebar" id="cv_side" :style="{background:'var(--sidebar-bg)', padding:'6mm', borderRadius:'10px'}">
        <section v-for="key in blocksSide" :key="key" class="section cv-block" :class="{'is-hidden': isHiddenFor(key) }">

          <template v-if="key==='about'">
            <h2>{{ t('aboutTitle') }}</h2>
            <p>{{ state.about.text }}</p>
          </template>

          <template v-else-if="key==='jobs'">
            <h2>{{ t('expJobTitle') }}</h2>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.jobs" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.company||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='addExp'">
            <h2>{{ t('subHeaderAddXP') }}</h2>
            <div>
              <article class="item" v-for="(it,idx) in (Array.isArray(state.experience?.addExp)?state.experience.addExp:[])" :key="idx" style="margin-bottom:3mm">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <p v-if="it.desc" style="font-size:0.9em;margin-top:2px">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <template v-else-if="key==='education'">
            <h2>{{ t('educationTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='projects'">
            <h2>{{ t('projectsTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.experience.projects" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                </div>
              </article>
            </div>
          </template>

          <!-- CUSTOM SECTIONS (dynamisch) -->
          <template v-else-if="getCustomSection(key)">
            <h2>{{ getCustomSection(key).name }}</h2>
            <div>
              <article class="item" v-for="(entry, idx) in getCustomSection(key).entries" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ entry.title }}</div>
                  <div class="item-meta">{{ formatMeta(entry) }}</div>
                </div>
                <p v-if="entry.desc" style="font-size:0.9em;margin-top:2px">{{ entry.desc }}</p>
              </article>
            </div>
          </template>

          <!-- SKILLS -->
          <template v-else-if="key==='skills'">
            <h2>{{ t('skillsTitle') }}</h2>
            <div v-for="(grp,i) in state.skills" :key="i" style="margin-top:4mm">
              <h3 class="small">{{ grp.title }}</h3>
              <div class="tags">
                <span v-for="(tg,ti) in (String(grp.tags||'').split(',').map(x=>x.trim()).filter(Boolean))" :key="ti" class="tag">{{ tg }}</span>
              </div>
            </div>
          </template>

          <!-- LANGUAGES (CEFR text) -->
          <template v-else-if="key==='languages'">
            <h2>{{ t('languagesTitle') }}</h2>
            <ul class="lang-list">
              <li v-for="(l,i) in state.languages" :key="i">
                <strong>{{ l.name }}</strong>
                <span>- {{ l.level }}</span>
              </li>
            </ul>
          </template>

          <!-- CERTS -->
          <template v-else-if="key==='certs'">
            <h2>{{ t('certsTitle') }}</h2>
            <ul><li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li></ul>
          </template>

          <!-- HOBBIES -->
          <template v-else-if="key==='hobbies'">
            <h2>{{ t('hobbiesTitle') }}</h2>
            <ul class="lang-list">
              <li v-for="(h,i) in state.hobbies" :key="i">
                <strong>{{ h.name }}</strong>
                <span v-if="h.details"> - {{ h.details }}</span>
              </li>
            </ul>
          </template>

        </section>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.lang-list{
  margin:0; padding-left:16px;
}
.lang-list li{
  margin: 2px 0;
}
</style>