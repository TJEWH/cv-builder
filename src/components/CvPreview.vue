<script setup>
import { computed, watch } from 'vue';
import { makeT } from '../i18n/dict.js';

const props = defineProps({
  state: { type: Object, required: true }
});

const langRef = computed({
  get: ()=> props.state.lang || 'de',
  set: v  => (props.state.lang = v)
});
const t = makeT(langRef);

const isDisabled = (k) => props.state.disabled.includes(k);

const hasAny = (arr)=> Array.isArray(arr) && arr.length>0;
const hasText = (s)=> !!(s && String(s).trim());

// Order gets extracted from formbuilder
const defaultMain = ['about','experience','education','projects','custom'];
const defaultSide = ['skills','languages','certs','hobbies'];

const blocksMain = computed(()=>{
  // prefer explicit orderMain if provided
  const base = Array.isArray(props.state.orderMain) && props.state.orderMain.length ? props.state.orderMain.slice() : defaultMain.slice();
  // also respect explicit sectionPlacement entries (ensure any key assigned to 'body' is present)
  const placement = props.state.sectionPlacement || {};
  Object.keys(placement).forEach(k=>{
    if(placement[k]==='body' && !base.includes(k)) base.push(k);
  });
  // remove keys that are explicitly placed in sidebar or present in orderSide
  const sideKeys = new Set(Array.isArray(props.state.orderSide) ? props.state.orderSide : []);
  Object.keys(placement).forEach(k=>{ if(placement[k]==='sidebar') sideKeys.add(k); });
  // filter out sideKeys
  const filtered = base.filter(k => !sideKeys.has(k));
  return Array.from(new Set(filtered));
});

const blocksSide = computed(()=>{
  const base = Array.isArray(props.state.orderSide) && props.state.orderSide.length ? props.state.orderSide.slice() : defaultSide.slice();
  const placement = props.state.sectionPlacement || {};
  Object.keys(placement).forEach(k=>{
    if(placement[k]==='sidebar' && !base.includes(k)) base.push(k);
  });
  // remove keys that are explicitly placed in body or present in orderMain
  const mainKeys = new Set(Array.isArray(props.state.orderMain) ? props.state.orderMain : []);
  Object.keys(placement).forEach(k=>{ if(placement[k]==='body') mainKeys.add(k); });
  const filtered = base.filter(k => !mainKeys.has(k));
  return Array.from(new Set(filtered));
});

const showExperience = computed(()=>{
  const a = props.state.experience;
  return (!isDisabled('exp-job') && hasAny(a.job)) || (!isDisabled('exp-personal') && hasAny(a.personal));
});

function formatMeta({ start, end, place }){
  const segs = [];
  const range = [start, end].filter(Boolean).join(t('rangeSep'));
  if(range) segs.push(range);
  if(place) segs.push(place);
  return segs.join(t('dotSep'));
}

// Centralized visibility check used by template
const isHiddenFor = (key) => {
  if(key==='about') return isDisabled('about') || !hasText(props.state.about?.text);
  if(key==='experience') return !showExperience.value;
  if(key==='education') return isDisabled('education') || !hasAny(props.state.education);
  if(key==='projects') return isDisabled('projects') || !hasAny(props.state.projects);
  if(key==='custom') return !hasAny(props.state.custom);
  if(key==='skills') return isDisabled('skills') || !hasAny(props.state.skills);
  if(key==='languages') return isDisabled('languages') || !hasAny(props.state.languages);
  if(key==='certs') return isDisabled('certs') || !hasAny(props.state.certs);
  if(key==='hobbies') return isDisabled('hobbies') || !hasAny(props.state.hobbies);
  return false;
};

// Debug logging to help track why a key is/was not shown
watch([blocksMain, blocksSide, () => props.state.sectionPlacement], ([bm, bs, sp])=>{
  try{
    console.debug('[CvPreview] blocksMain=', bm, 'blocksSide=', bs, 'sectionPlacement=', sp);
    console.debug('[CvPreview] visibleMain=', bm.filter(k=>!isHiddenFor(k)), 'visibleSide=', bs.filter(k=>!isHiddenFor(k)));
  }catch(e){/* ignore */}
},{deep:true, immediate:true});
</script>

<template>
  <div class="page" role="document">
    <header class="header">
      <div class="title">
        <h1 class="name">{{ state.header.name || '-' }}</h1>
        <p class="role">{{ state.header.role }}</p>
      </div>
      <address class="contact">
        <div>{{ state.header.location }}</div>
        <div><a :href="state.header.email ? 'mailto:'+state.header.email : '#'">{{ state.header.email }}</a></div>
        <div>{{ state.header.phone }}</div>
        <div><a :href="state.header.website || '#'">{{ (state.header.website||'').replace(/^https?:\/\//,'') }}</a></div>
        <div><a :href="state.header.linkedin || '#'">{{ (state.header.linkedin||'').replace(/^https?:\/\//,'') }}</a></div>
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
          <template v-else-if="key==='experience'">
            <h2>{{ t('expJobTitle') }}</h2>

            <h3 class="small">{{ t('experienceH3Job') }}</h3>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.job" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} - <span class='item-sub'>${it.company||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <ul v-if="Array.isArray(it.bullets) && it.bullets.length">
                  <li v-for="(b,bi) in it.bullets" :key="bi">{{ b }}</li>
                </ul>
              </article>
            </div>

            <h3 class="small" v-if="hasAny(state.experience.personal)">{{ t('experienceH3Personal') }}</h3>
            <div id="cv_exp_personal" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm">
              <article class="item" v-for="(it,idx) in state.experience.personal" :key="idx" style="border:1px solid var(--border);border-radius:6px;padding:6px">
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
              <article class="item" v-for="(it, idx) in state.projects" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- CUSTOM -->
          <template v-else-if="key==='custom'">
            <div id="cv_custom">
              <section class="section" v-for="(it, idx) in state.custom" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
                <ul v-if="Array.isArray(it.bullets) && it.bullets.length">
                  <li v-for="(b, bi) in it.bullets" :key="bi">{{ b }}</li>
                </ul>
              </section>
            </div>
          </template>

          <!-- SKILLS (wenn im Main) -->
          <template v-else-if="key==='skills'">
            <h2>{{ t('skillsTitle') }}</h2>
            <div v-for="(grp,i) in state.skills" :key="i" style="margin-top:4mm">
              <h3 class="small">{{ grp.title }}</h3>
              <div class="tags">
                <span
                    v-for="(tg,ti) in (String(grp.tags||'').split(',').map(x=>x.trim()).filter(Boolean))"
                    :key="ti"
                    class="tag"
                >{{ tg }}</span>
              </div>
            </div>
          </template>

          <!-- LANGUAGES (wenn im Main) -->
          <template v-else-if="key==='languages'">
            <h2>{{ t('languagesTitle') }}</h2>
            <ul class="lang-list">
              <li v-for="(l,i) in state.languages" :key="i">
                <strong>{{ l.name }}</strong>
                <span>\u2014 {{ l.level }}</span>
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
                <span v-if="h.details"> \u2014 {{ h.details }}</span>
              </li>
            </ul>
          </template>

        </section>
      </div>

      <!-- Sidebar -->
      <aside class="sidebar" id="cv_side" :style="{background:'var(--sidebar-bg)', padding:'6mm', borderRadius:'10px'}">
        <section v-for="key in blocksSide" :key="key" class="section cv-block"
                 :class="{'is-hidden':
                   (key==='skills'    && (isDisabled('skills'))) ||
                   (key==='languages' && (isDisabled('languages') || !Array.isArray(state.languages) || !state.languages.length)) ||
                   (key==='certs'     && (isDisabled('certs')     || !Array.isArray(state.certs)     || !state.certs.length)) ||
                   (key==='hobbies'   && (isDisabled('hobbies')   || !Array.isArray(state.hobbies)   || !state.hobbies.length))
                 }">

          <!-- Allow main-section keys in sidebar too -->
          <template v-if="key==='about'">
            <h2>{{ t('aboutTitle') }}</h2>
            <p>{{ state.about.text }}</p>
          </template>

          <template v-else-if="key==='experience'">
            <h2>{{ t('expJobTitle') }}</h2>
            <h3 class="small">{{ t('experienceH3Job') }}</h3>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.job" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} \u2013 <span class='item-sub'>${it.company||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='education'">
            <h2>{{ t('educationTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title||''} \u2013 <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ formatMeta(it) }}</div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='projects'">
            <h2>{{ t('projectsTitle') }}</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.projects" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='custom'">
            <h2>{{ t('customTitle') }}</h2>
            <div id="cv_custom">
              <section class="section" v-for="(it, idx) in state.custom" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                </div>
              </section>
            </div>
          </template>

          <!-- SKILLS -->
          <template v-else-if="key==='skills'">
            <h2>{{ t('skillsTitle') }}</h2>
            <div v-for="(grp,i) in state.skills" :key="i" style="margin-top:4mm">
              <h3 class="small">{{ grp.title }}</h3>
              <div class="tags">
                <span
                    v-for="(tg,ti) in (String(grp.tags||'').split(',').map(x=>x.trim()).filter(Boolean))"
                    :key="ti"
                    class="tag"
                >{{ tg }}</span>
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
