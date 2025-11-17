<script setup>
import { computed, ref } from 'vue';
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

// Order (drag & drop)
const blocksMain = ref(props.state.orderMain || ['about','experience','education','projects','custom']);
const blocksSide = ref(props.state.orderSide || ['skills','languages','certs','hobbies']);

const drag = { src:null, list:null };
const onDragStart = (list, idx, e)=>{ drag.src=idx; drag.list=list; e.dataTransfer.effectAllowed='move'; };
const onDrop = (list, idx)=>{
  if(drag.list!==list || drag.src===null) return;
  const a = list.value;
  const [it] = a.splice(drag.src,1);
  a.splice(idx,0,it);
  drag.src=null; drag.list=null;
  if(list===blocksMain) props.state.orderMain=[...a];
  if(list===blocksSide) props.state.orderSide=[...a];
};

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
</script>

<template>
  <div class="page" role="document">
    <header class="header">
      <div class="title">
        <h1 class="name">{{ state.header.name || '—' }}</h1>
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
        <section v-for="(key, i) in blocksMain" :key="key" class="section cv-block"
                 draggable="true"
                 @dragstart="onDragStart(blocksMain, i, $event)"
                 @dragover.prevent
                 @drop="onDrop(blocksMain, i, $event)"
                 :class="{'is-hidden':
                   (key==='about'     && (isDisabled('about') || !hasText(state.about.text))) ||
                   (key==='experience'&& (!showExperience)) ||
                   (key==='education' && (isDisabled('education') || !hasAny(state.education))) ||
                   (key==='projects'  && (isDisabled('projects')  || !hasAny(state.projects))) ||
                   (key==='custom'    && (!hasAny(state.custom)))
                 }">
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
                  <div class="item-title" v-html="`${it.title||''} – <span class='item-sub'>${it.company||''}</span>`"></div>
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
                  <div class="item-title" v-html="`${it.title||''} – <span class='item-sub'>${it.sub||''}</span>`"></div>
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
                  <div class="item-title" v-html="`${it.title||''} – <span class='item-sub'>${it.sub||''}</span>`"></div>
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
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="sidebar" id="cv_side" :style="{background:'var(--sidebar-bg)', padding:'6mm', borderRadius:'10px'}">
        <section v-for="(key, i) in blocksSide" :key="key" class="section cv-block"
                 draggable="true"
                 @dragstart="onDragStart(blocksSide, i, $event)"
                 @dragover.prevent
                 @drop="onDrop(blocksSide, i, $event)"
                 :class="{'is-hidden':
                   (key==='skills'    && (isDisabled('skills'))) ||
                   (key==='languages' && (isDisabled('languages') || !Array.isArray(state.languages) || !state.languages.length)) ||
                   (key==='certs'     && (isDisabled('certs')     || !Array.isArray(state.certs)     || !state.certs.length)) ||
                   (key==='hobbies'   && (isDisabled('hobbies')   || !Array.isArray(state.hobbies)   || !state.hobbies.length))
                 }">
          <!-- SKILLS -->
          <template v-if="key==='skills'">
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
                <span>— {{ l.level }}</span>
              </li>
            </ul>
          </template>

          <!-- CERTS -->
          <template v-else-if="key==='certs'">
            <h2>{{ t('certsTitle') }}</h2>
            <ul><li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li></ul>
          </template>

          <!-- HOBBIES --><template v-else-if="key==='hobbies'">
          <h2>{{ t('hobbiesTitle') }}</h2>
          <ul class="lang-list">
            <li v-for="(h,i) in state.hobbies" :key="i">
              <strong>{{ h.name }}</strong>
              <span v-if="h.details"> — {{ h.details }}</span>
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
