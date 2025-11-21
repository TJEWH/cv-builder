<script setup>
import { computed } from 'vue';
import { makeT } from '../i18n/dict.js';
import SkillCategory from './skills/SkillCategory.vue';

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
  // Add custom sections - if they're in orderMain, placement says body, or no placement set (default to body)
  if(Array.isArray(props.state.customSections)) {
    props.state.customSections.forEach(cs => {
      const isInMain = base.includes(cs.id);
      const isInSide = sideKeys.has(cs.id);
      const placementIsSidebar = placement[cs.id] === 'sidebar';

      // Add to main if: in orderMain, explicitly set to body, or no placement and not in sidebar
      if(isInMain || placement[cs.id] === 'body' || (!placementIsSidebar && !isInSide)) {
        if(!base.includes(cs.id)) {
          base.push(cs.id);
        }
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
  // Add custom sections - only if explicitly in orderSide or placement is sidebar
  if(Array.isArray(props.state.customSections)) {
    props.state.customSections.forEach(cs => {
      const isInSide = base.includes(cs.id);
      const placementIsSidebar = placement[cs.id] === 'sidebar';

      // Only add to sidebar if explicitly set
      if(isInSide || placementIsSidebar) {
        if(!base.includes(cs.id)) {
          base.push(cs.id);
        }
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

// Get header size for section (h2, h3, h4, or null to hide)
const getSectionHeaderSize = (key) => {
  return props.state.sectionHeaderSizes?.[key] || 'h2';
};

// Check if section header should be hidden
const isSectionHeaderHidden = (key) => {
  return props.state.sectionHeaderSizes?.[key] === 'null';
};

// Get display name for section (with custom names if set)
const getSectionDisplayName = (key) => {
  // Check if there's a custom name set
  if(props.state.sectionNames && props.state.sectionNames[key]) { return props.state.sectionNames[key]; }

  // For custom sections, use their name property
  const customSection = getCustomSection(key);
  if(customSection) { return customSection.name; }

  // Otherwise use default translated name
  const names = {
    about: t('aboutTitle'),
    education: t('educationTitle'),
    jobs: t('expJobTitle'),
    addExp: t('expPersonalTitle'),
    projects: t('projectsTitle'),
    skills: t('skillsTitle'),
    languages: t('languagesTitle'),
    hobbies: t('hobbiesTitle'),
    certs: t('certsTitle')
  };
  return names[key] || key;
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
</script>

<template>
  <div class="page" role="document">
    <header class="header">
      <div class="title">
        <h1 class="name">{{ state.contact.name || '-' }}</h1>
        <p class="role">{{ state.contact.role }}</p>
      </div>
      <address class="contact">
        <div v-if="state.contact.location">
          {{ state.contact.location }}
          <font-awesome-icon :icon="['fas', 'location-dot']" class="contact-icon" />
        </div>
        <div v-if="state.contact.email">
          <a :href="'mailto:'+state.contact.email">{{ state.contact.email }}</a>
          <font-awesome-icon :icon="['fas', 'envelope']" class="contact-icon" />
        </div>
        <div v-if="state.contact.phone">
          {{ state.contact.phone }}
          <font-awesome-icon :icon="['fas', 'phone']" class="contact-icon" />
        </div>
        <div v-if="state.contact.website">
          <a :href="state.contact.website">{{ state.contact.website.replace(/^https?:\/\//,'') }}</a>
          <font-awesome-icon :icon="['fas', 'globe']" class="contact-icon" />
        </div>
        <div v-if="state.contact.linkedin">
          <a :href="state.contact.linkedin">{{ state.contact.linkedin.replace(/^https?:\/\//,'') }}</a>
          <font-awesome-icon :icon="['fab', 'linkedin']" class="contact-icon" />
        </div>
      </address>
    </header>

    <section class="content">
      <!-- Main -->
      <div id="cv_main">
        <section v-for="key in blocksMain" :key="key" class="section cv-block"
                 :class="{ 'is-hidden': isHiddenFor(key) }">

          <!-- ABOUT -->
          <template v-if="key==='about'">
            <component :is="getSectionHeaderSize('about')" v-if="!isSectionHeaderHidden('about')">
              {{ getSectionDisplayName('about') }}
            </component>
            <p>{{ state.about.text }}</p>
          </template>

          <!-- EXPERIENCE -->
          <template v-else-if="key==='jobs'">
            <component :is="getSectionHeaderSize('jobs')" v-if="!isSectionHeaderHidden('jobs')">
              {{ getSectionDisplayName('jobs') }}
            </component>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.jobs" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.company }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
                <ul v-if="Array.isArray(it.bullets) && it.bullets.length">
                  <li v-for="(b,bi) in it.bullets" :key="bi">{{ b }}</li>
                </ul>
              </article>
            </div>
          </template>

          <template v-else-if="key==='addExp'">
            <component :is="getSectionHeaderSize('addExp')" v-if="!isSectionHeaderHidden('addExp')">
              {{ getSectionDisplayName('addExp') }}
            </component>
            <div id="cv_add_exp" :class="`addexp-cols-${state.design?.addExpColumns || '2'}`" style="display:grid;grid-template-columns:repeat(var(--addexp-columns),minmax(0,1fr));gap:4mm">
              <article class="item addexp-card" v-for="(it,idx) in (Array.isArray(state.experience?.addExp)?state.experience.addExp:[])" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.sub }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- EDUCATION -->
          <template v-else-if="key==='education'">
            <component :is="getSectionHeaderSize('education')" v-if="!isSectionHeaderHidden('education')">
              {{ getSectionDisplayName('education') }}
            </component>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.sub }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- PROJECTS -->
          <template v-else-if="key==='projects'">
            <component :is="getSectionHeaderSize('projects')" v-if="!isSectionHeaderHidden('projects')">
              {{ getSectionDisplayName('projects') }}
            </component>
            <div>
              <article class="item" v-for="(it, idx) in state.experience.projects" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
                <p v-if="it.desc">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <!-- CUSTOM SECTIONS (dynamisch) -->
          <template v-else-if="getCustomSection(key)">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">
              {{ getSectionDisplayName(key) }}
            </component>
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
            <component :is="getSectionHeaderSize('skills')" v-if="!isSectionHeaderHidden('skills')">
              {{ getSectionDisplayName('skills') }}
            </component>
            <SkillCategory
              v-for="(grp,i) in state.skills"
              :key="i"
              :title="grp.title"
              :items="grp.items || []"
              :levelType="grp.levelType"
              :sidebarColor="state.design?.sidebarbg || '#ffffff'"
            />
          </template>

          <!-- LANGUAGES (wenn im Main) -->
          <template v-else-if="key==='languages'">
            <component :is="getSectionHeaderSize('languages')" v-if="!isSectionHeaderHidden('languages')">
              {{ getSectionDisplayName('languages') }}
            </component>
            <div class="language-items">
              <div class="language-item" v-for="(l,i) in state.languages" :key="i">
                <span class="language-name">{{ l.name }}</span>
                <span class="language-level">{{ l.level }}</span>
              </div>
            </div>
          </template>

          <!-- CERTS (wenn im Main) -->
          <template v-else-if="key==='certs'">
            <component :is="getSectionHeaderSize('certs')" v-if="!isSectionHeaderHidden('certs')">
              {{ getSectionDisplayName('certs') }}
            </component>
            <ul class="lang-list">
              <li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li>
            </ul>
          </template>

          <!-- HOBBIES (wenn im Main) -->
          <template v-else-if="key==='hobbies'">
            <component :is="getSectionHeaderSize('hobbies')" v-if="!isSectionHeaderHidden('hobbies')">
              {{ getSectionDisplayName('hobbies') }}
            </component>
            <ul class="lang-list">
              <li v-for="(h,i) in state.hobbies" :key="i">
                <strong>{{ h.name }}</strong>
                <span v-if="h.details"> - {{ h.details }}</span>
              </li>
            </ul>
          </template>

        </section>
      </div>

      <aside class="sidebar" id="cv_side">
        <section v-for="key in blocksSide" :key="key" class="section cv-block" :class="{'is-hidden': isHiddenFor(key) }">

          <template v-if="key==='about'">
            <component :is="getSectionHeaderSize('about')" v-if="!isSectionHeaderHidden('about')">
              {{ getSectionDisplayName('about') }}
            </component>
            <p>{{ state.about.text }}</p>
          </template>

          <template v-else-if="key==='jobs'">
            <component :is="getSectionHeaderSize('jobs')" v-if="!isSectionHeaderHidden('jobs')">
              {{ getSectionDisplayName('jobs') }}
            </component>
            <div class="timeline" id="cv_exp_job">
              <article class="item" v-for="(it,idx) in state.experience.jobs" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.company }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='addExp'">
            <component :is="getSectionHeaderSize('addExp')" v-if="!isSectionHeaderHidden('addExp')">
              {{ getSectionDisplayName('addExp') }}
            </component>
            <div>
              <article class="item" v-for="(it,idx) in (Array.isArray(state.experience?.addExp)?state.experience.addExp:[])" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.sub }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
                <p v-if="it.desc" style="font-size:0.9em">{{ it.desc }}</p>
              </article>
            </div>
          </template>

          <template v-else-if="key==='education'">
            <component :is="getSectionHeaderSize('education')" v-if="!isSectionHeaderHidden('education')">
              {{ getSectionDisplayName('education') }}
            </component>
            <div>
              <article class="item" v-for="(it, idx) in state.education" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-sub">{{ it.sub }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
              </article>
            </div>
          </template>

          <template v-else-if="key==='projects'">
            <component :is="getSectionHeaderSize('projects')" v-if="!isSectionHeaderHidden('projects')">
              {{ getSectionDisplayName('projects') }}
            </component>
            <div>
              <article class="item" v-for="(it, idx) in state.experience.projects" :key="idx">
                <div class="item-title">{{ it.title }}</div>
                <div class="item-meta">{{ formatMeta(it) }}</div>
              </article>
            </div>
          </template>

          <!-- CUSTOM SECTIONS (dynamisch) -->
          <template v-else-if="getCustomSection(key)">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">
              {{ getSectionDisplayName(key) }}
            </component>
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
            <component :is="getSectionHeaderSize('skills')" v-if="!isSectionHeaderHidden('skills')">
              {{ getSectionDisplayName('skills') }}
            </component>
            <SkillCategory
              v-for="(grp,i) in state.skills"
              :key="i"
              :title="grp.title"
              :items="grp.items || []"
              :levelType="grp.levelType"
              :sidebarColor="state.design?.sidebarbg || '#ffffff'"
            />
          </template>

          <!-- LANGUAGES (CEFR text) -->
          <template v-else-if="key==='languages'">
            <component :is="getSectionHeaderSize('languages')" v-if="!isSectionHeaderHidden('languages')">
              {{ getSectionDisplayName('languages') }}
            </component>
            <div class="language-items">
              <div class="language-item" v-for="(l,i) in state.languages" :key="i">
                <span class="language-name">{{ l.name }}</span>
                <span class="language-level">{{ l.level }}</span>
              </div>
            </div>
          </template>

          <!-- CERTS -->
          <template v-else-if="key==='certs'">
            <component :is="getSectionHeaderSize('certs')" v-if="!isSectionHeaderHidden('certs')">
              {{ getSectionDisplayName('certs') }}
            </component>
            <ul class="lang-list">
              <li v-for="(c,i) in state.certs" :key="i">{{ [c.name,c.year].filter(Boolean).join(', ') }}</li>
            </ul>
          </template>

          <!-- HOBBIES -->
          <template v-else-if="key==='hobbies'">
            <component :is="getSectionHeaderSize('hobbies')" v-if="!isSectionHeaderHidden('hobbies')">
              {{ getSectionDisplayName('hobbies') }}
            </component>
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

.language-items {
  display: grid;
  gap: 4px;
  margin: 4px 0;
}

.language-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  gap: 8px;
}

.language-name {
  flex: 1;
  font-size: 9.5pt;
}

.language-level {
  font-size: 8.5pt;
  opacity: 0.8;
  white-space: nowrap;
  font-weight: 700;
}
</style>