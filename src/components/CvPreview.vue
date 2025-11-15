<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  state: { type: Object, required: true }
});

const isDisabled = (k) => props.state.disabled.includes(k);

const hasAny = (arr)=> Array.isArray(arr) && arr.length>0;
const hasText = (s)=> !!(s && String(s).trim());

const blocksMain = ref(props.state.orderMain || ['about','experience','education','projects','custom']);
const blocksSide = ref(props.state.orderSide || ['skills','languages','certs','hobbies']);

// DnD helpers for block arrays
const drag = { src:null, list:null };
const onDragStart = (list, idx, e)=>{ drag.src=idx; drag.list=list; e.dataTransfer.effectAllowed='move'; };
const onDrop = (list, idx)=>{
  if(drag.list!==list || drag.src===null) return;
  const a = list.value;
  const [it] = a.splice(drag.src,1);
  a.splice(idx,0,it);
  drag.src=null; drag.list=null;
  // persist into state
  if(list===blocksMain) props.state.orderMain=[...a];
  if(list===blocksSide) props.state.orderSide=[...a];
};

const showExperience = computed(()=>{
  const a = props.state.experience;
  return !isDisabled('exp-job') && hasAny(a.job) || !isDisabled('exp-personal') && hasAny(a.personal);
});
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
          <template v-if="key==='about'">
            <h2>Selbstbeschreibung</h2>
            <p>{{ state.about.text }}</p>
          </template>

          <template v-else-if="key==='experience'">
            <h2>Erfahrung</h2>
            <h3 class="small">Berufserfahrung</h3>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.job" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title} – <span class='item-sub'>${it.company||''}</span>`"></div>
                  <div class="item-meta">{{ it.meta }}</div>
                </div>
                <ul>
                  <li v-for="(b,bi) in (it.bullets||[])" :key="bi">{{ b }}</li>
                </ul>
              </article>
            </div>
            <h3 class="small">Persönliche Erfahrung & Hackathons</h3>
            <div id="cv_exp_personal" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm">
              <article class="item" v-for="(it,idx) in state.experience.personal" :key="idx" style="border:1px solid var(--border);border-radius:6px;padding:6px">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title} – <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ it.meta }}</div>
                </div>
                <p>{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <template v-else-if="key==='education'">
            <h2>Ausbildung</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-header">
                  <div class="item-title" v-html="`${it.title} – <span class='item-sub'>${it.sub||''}</span>`"></div>
                  <div class="item-meta">{{ it.meta }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <template v-else-if="key==='projects'">
            <h2>Projekte & Publikationen</h2>
            <div>
              <article class="item" v-for="(it, idx) in state.projects" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                  <div class="item-meta">{{ it.meta }}</div>
                </div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <template v-else-if="key==='custom'">
            <div id="cv_custom">
              <section class="section" v-for="(it, idx) in state.custom" :key="idx">
                <div class="item-header">
                  <div class="item-title">{{ it.title }}</div>
                  <div class="item-meta">{{ it.meta }}</div>
                </div>
                <ul>
                  <li v-for="(b, bi) in (it.bullets||[])" :key="bi">{{ b }}</li>
                </ul>
              </section>
            </div>
          </template>
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="sidebar" id="cv_side" :style="{background:'var(--sidebar-bg)', padding:'6mm', borderRadius:'6px'}">
        <section v-for="(key, i) in blocksSide" :key="key" class="section cv-block"
                 draggable="true"
                 @dragstart="onDragStart(blocksSide, i, $event)"
                 @dragover.prevent
                 @drop="onDrop(blocksSide, i, $event)"
                 :class="{'is-hidden':
                   (key==='skills'    && (!hasText(state.skills.langs?.join('')) && !hasText(state.skills.tools?.join('')) && !hasText(state.skills.methods?.join('')))) ||
                   (key==='languages' && (isDisabled('languages') || !hasAny(state.languages))) ||
                   (key==='certs'     && (isDisabled('certs')     || !hasAny(state.certs))) ||
                   (key==='hobbies'   && (!hasText(state.hobbies.music)))
                 }">
          <template v-if="key==='skills'">
            <h2>Fähigkeiten</h2>
            <div class="tags" id="cv_skill_langs">
              <span class="tag" v-for="(t,i) in (state.skills.langs||[])" :key="i">{{ t }}</span>
            </div>
            <div class="tags" style="margin-top:4mm">
              <span class="tag" v-for="(t,i) in (state.skills.tools||[]) " :key="i">{{ t }}</span>
            </div>
            <div class="tags" style="margin-top:4mm">
              <span class="tag" v-for="(t,i) in (state.skills.methods||[])" :key="i">{{ t }}</span>
            </div>
          </template>

          <template v-else-if="key==='languages'">
            <h2>Sprachen</h2>
            <div class="bars">
              <div class="bar" v-for="(l,i) in state.languages" :key="i">
                <span>{{ l.name }} ({{ Math.max(0,Math.min(100,Number(l.level)||0)) }}%)</span>
                <div class="track"><div class="fill" :style="{width: (Math.max(0,Math.min(100,Number(l.level)||0)) + '%')}"></div></div>
              </div>
            </div>
          </template>

          <template v-else-if="key==='certs'">
            <h2>Zertifikate</h2>
            <ul><li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li></ul>
          </template>

          <template v-else-if="key==='hobbies'">
            <h2>Hobbys</h2>
            <p class="small">{{ state.hobbies.music }}</p>
          </template>
        </section>
      </aside>
    </section>
  </div>
</template>
