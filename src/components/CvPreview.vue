<script setup>
import { computed } from 'vue';
import { makeT } from '../i18n/dict.js';
import SkillItem from './skills/SkillItem.vue';
import MarkdownContent from './MarkdownContent.vue';
import { hasMarkdownText } from '../composables/markdownText.js';

const props = defineProps({
  state: { type: Object, required: true },
  exportSource: { type: Boolean, default: false },
  anonymized: { type: Boolean, default: false },
});
const langRef = computed(() => props.state.lang || 'de');
const t = makeT(langRef);
const bodyKeys = computed(() => Array.isArray(props.state.bodyOrder) ? props.state.bodyOrder : ['about', 'education', 'jobs']);
const sidebarKeys = computed(() => Array.isArray(props.state.sidebarOrder) ? props.state.sidebarOrder : ['languages', 'hobbies']);
const isDisabled = (key) => Array.isArray(props.state.disabled) && props.state.disabled.includes(key);
const visibleItems = (items) => Array.isArray(items) ? items.filter((item) => item && !item.hidden) : [];
const hasVisibleItems = (items) => visibleItems(items).length > 0;
const getBodySection = (id) => props.state.customSections?.find((section) => section.id === id);
const getSidebarSection = (id) => props.state.sidebarSections?.find((section) => section.id === id);
const getSectionHeaderSize = (key) => props.state.sectionHeaderSizes?.[key] || 'h2';
const isSectionHeaderHidden = (key) => props.state.sectionHeaderSizes?.[key] === 'null';
const getSectionDisplayName = (key) => getBodySection(key)?.name || props.state.sectionNames?.[key] || ({
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}[key] || key);
const isHiddenFor = (key) => {
  if (isDisabled(key)) return true;
  if (key === 'about') return !hasMarkdownText(props.state.about?.text);
  if (key === 'education') return !hasVisibleItems(props.state.education);
  if (key === 'jobs') return !hasVisibleItems(props.state.experience?.jobs);
  if (key === 'languages') return !hasVisibleItems(props.state.languages);
  if (key === 'hobbies') return !hasVisibleItems(props.state.hobbies);
  if (getBodySection(key)) return !hasVisibleItems(getBodySection(key).entries);
  if (getSidebarSection(key)) return !hasVisibleItems(getSidebarSection(key).items);
  return false;
};
const hasVisibleSidebarContent = computed(() => sidebarKeys.value.some((key) => !isHiddenFor(key)));
const formatMeta = ({ start, end, place }) => {
  const values = [];
  const range = [start, end].filter(Boolean).join(t('rangeSep'));
  if (range) values.push(range);
  if (place) values.push(place);
  return values.join(t('dotSep'));
};
const customFieldEnabled = (section, field) => section.fields?.includes(field) ?? true;
const formatCustomMeta = (section, entry) => {
  const values = [];
  const range = [
    customFieldEnabled(section, 'start') ? entry.start : '',
    customFieldEnabled(section, 'end') ? entry.end : '',
  ].filter(Boolean).join(t('rangeSep'));
  if (range) values.push(range);
  if (customFieldEnabled(section, 'place') && entry.place) values.push(entry.place);
  return values.join(t('dotSep'));
};
const hasCustomInstitution = (section, entry) => (
  customFieldEnabled(section, 'institution') && Boolean(String(entry.institution || '').trim())
);
</script>

<template>
  <div class="page" :class="{ 'pdf-export-source': exportSource }" role="document">
    <header class="header">
      <div class="title"><h1 class="name">{{ state.contact.name || '-' }}</h1><p class="role">{{ state.contact.role }}</p></div>
      <address class="contact">
        <div v-if="state.contact.location">{{ state.contact.location }}<font-awesome-icon :icon="['fas', 'location-dot']" class="contact-icon" /></div>
        <div v-if="state.contact.email"><a :href="`mailto:${state.contact.email}`">{{ state.contact.email }}</a><font-awesome-icon :icon="['fas', 'envelope']" class="contact-icon" /></div>
        <div v-if="state.contact.phone">{{ state.contact.phone }}<font-awesome-icon :icon="['fas', 'phone']" class="contact-icon" /></div>
        <div v-if="state.contact.website"><a :href="state.contact.website">{{ state.contact.website.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fas', 'globe']" class="contact-icon" /></div>
        <div v-if="state.contact.linkedin"><a :href="state.contact.linkedin">{{ state.contact.linkedin.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'linkedin']" class="contact-icon" /></div>
        <div v-if="state.contact.github"><a :href="state.contact.github">{{ state.contact.github.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'github']" class="contact-icon" /></div>
      </address>
    </header>

    <section class="content">
      <aside v-if="hasVisibleSidebarContent" class="sidebar" id="cv_side">
        <div class="sidebar-content">
        <section v-for="key in sidebarKeys" :key="key" class="section cv-block" :class="{ 'is-hidden': isHiddenFor(key) }">
          <template v-if="key === 'languages'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <div class="language-items"><div v-for="language in visibleItems(state.languages)" :key="language.id" class="language-item"><span class="language-name">{{ language.name }}</span><span class="language-level">{{ language.level }}</span></div></div>
          </template>
          <template v-else-if="key === 'hobbies'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <ul class="lang-list"><li v-for="hobby in visibleItems(state.hobbies)" :key="hobby.id">{{ hobby.name }}</li></ul>
          </template>
          <template v-else-if="getSidebarSection(key)">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSidebarSection(key).name }}</component>
            <div v-if="!getSidebarSection(key).levelType" class="tags"><span v-for="item in visibleItems(getSidebarSection(key).items)" :key="item.id" class="tag">{{ item.name }}</span></div>
            <div v-else class="skill-items-list"><SkillItem v-for="item in visibleItems(getSidebarSection(key).items)" :key="item.id" :name="item.name" :level-type="getSidebarSection(key).levelType" :level-value="item.levelValue || 0" :lang="langRef" /></div>
          </template>
        </section>
        </div>
      </aside>

      <div id="cv_main">
        <section v-for="key in bodyKeys" :key="key" class="section cv-block" :class="{ 'is-hidden': isHiddenFor(key) }">
          <template v-if="key === 'about'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <MarkdownContent :value="state.about.text" :anonymized="anonymized" />
          </template>
          <template v-else-if="key === 'jobs'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <div class="timeline" id="cv_exp_job"><article v-for="item in visibleItems(state.experience.jobs)" :key="item.id" class="item"><h3 class="item-title">{{ item.title }}</h3><div class="item-sub">{{ item.company }}</div><div class="item-meta">{{ formatMeta(item) }}</div><MarkdownContent :value="item.bullets" :anonymized="anonymized" /></article></div>
          </template>
          <template v-else-if="key === 'education'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <div class="timeline"><article v-for="item in visibleItems(state.education)" :key="item.id" class="item education-item"><h3 class="item-title">{{ item.title }}</h3><div class="item-sub">{{ item.sub }}</div><div class="item-meta">{{ formatMeta(item) }}</div><div v-if="hasMarkdownText(item.thesis) || hasMarkdownText(item.coursesText)" class="education-details"><div v-if="hasMarkdownText(item.thesis)" class="education-thesis"><MarkdownContent :value="item.thesis" :anonymized="anonymized" /></div><div v-if="hasMarkdownText(item.coursesText)" class="education-courses"><MarkdownContent :value="item.coursesText" :anonymized="anonymized" /></div></div></article></div>
          </template>
          <template v-else-if="getBodySection(key)">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <div><article v-for="entry in visibleItems(getBodySection(key).entries)" :key="entry.id" class="item custom-body-item" :class="{ 'custom-body-item--with-institution': hasCustomInstitution(getBodySection(key), entry) }"><h3 v-if="customFieldEnabled(getBodySection(key), 'title')" class="item-title">{{ entry.title }}</h3><div v-if="hasCustomInstitution(getBodySection(key), entry)" class="item-sub">{{ entry.institution }}</div><div v-if="formatCustomMeta(getBodySection(key), entry)" class="item-meta">{{ formatCustomMeta(getBodySection(key), entry) }}</div><MarkdownContent v-if="customFieldEnabled(getBodySection(key), 'desc')" :value="entry.desc" :anonymized="anonymized" /></article></div>
          </template>
        </section>
      </div>

    </section>
  </div>
</template>

<style scoped>
.lang-list { margin: 0; padding-left: 16px; }
.lang-list li { margin: 2px 0; }
.language-items { display: grid; gap: 4px; margin: 4px 0; }
.language-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }
.language-name { flex: 1; min-width: 0; font-size: 9.5pt; overflow-wrap: anywhere; }
.language-level { flex: 0 0 auto; font-size: 8.5pt; font-weight: 700; opacity: .8; white-space: nowrap; }
.custom-body-item { margin: 0 0 2.5mm; }
.custom-body-item:not(.custom-body-item--with-institution) .item-meta { grid-row: 1; }
</style>
