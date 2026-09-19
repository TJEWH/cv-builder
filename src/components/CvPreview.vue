<script setup lang="ts">
import { DEFAULT_SECTION_HEADER_SIZE, designValue } from '../defaults';
import type { PropType } from 'vue';
import type { CvState, CvItem, CustomSection, CustomBodyField, ItemState } from '../types';
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';
import { makeT } from '../i18n/dict.ts';
import SkillItem from './skills/SkillItem.vue';
import MarkdownContent from './MarkdownContent.vue';
import CvBodyItem from './CvBodyItem.vue';
import { hasMarkdownText } from '../composables/markdownText.ts';
import { safeEmailUrl, safeWebUrl } from '../composables/safeUrl';
import { updateTimelineRails } from '../composables/timelineLayout.ts';

const props = defineProps({
  state: { type: Object as PropType<CvState>, required: true },
  exportSource: { type: Boolean, default: false },
  anonymized: { type: Boolean, default: false },
});
const langRef = computed(() => props.state.lang);
const t = makeT(langRef);
const bodyKeys = computed(() => props.state.bodyOrder);
const sidebarKeys = computed(() => props.state.sidebarOrder);
const isDisabled = (key: string) => Array.isArray(props.state.disabled) && props.state.disabled.includes(key);
const isKeptTogether = (key: string) => Array.isArray(props.state.keepTogetherSections) && props.state.keepTogetherSections.includes(key);
const visibleItems = (items: CvItem[]) => Array.isArray(items) ? items.filter((item) => item && !item.hidden) : [];
const hasVisibleItems = (items: CvItem[]) => visibleItems(items).length > 0;
const getBodySection = (id: string) => props.state.customSections?.find((section) => section.id === id);
const getSidebarSection = (id: string) => props.state.sidebarSections?.find((section) => section.id === id);
const bodyRows = computed(() => bodyKeys.value.map((key) => {
  const section = getBodySection(key);
  return { key, section, entries: section ? visibleItems(section.entries) : [] };
}));
const sidebarRows = computed(() => sidebarKeys.value.map((key) => ({ key, section: getSidebarSection(key) })));
const getSectionHeaderSize = (key: string) => props.state.sectionHeaderSizes?.[key] ?? DEFAULT_SECTION_HEADER_SIZE;
const isSectionHeaderHidden = (key: string) => props.state.sectionHeaderSizes?.[key] === 'null';
const getSectionDisplayName = (key: string) => getBodySection(key)?.name || props.state.sectionNames?.[key] || ({
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}[key] || key);
const isHiddenFor = (key: string) => {
  if (isDisabled(key)) return true;
  if (key === 'about') return !hasMarkdownText(props.state.about?.text);
  if (key === 'education') return !hasVisibleItems(props.state.education);
  if (key === 'jobs') return !hasVisibleItems(props.state.experience?.jobs);
  if (key === 'languages') return !hasVisibleItems(props.state.languages);
  if (key === 'hobbies') return !hasVisibleItems(props.state.hobbies);
  const bodySection = getBodySection(key);
  if (bodySection) return bodySection.entryMode === 'textarea'
    ? !hasMarkdownText(bodySection.text)
    : !hasVisibleItems(bodySection.entries);
  const sidebarSection = getSidebarSection(key);
  if (sidebarSection) return !hasVisibleItems(sidebarSection.items);
  return false;
};
const hasVisibleSidebarContent = computed(() => sidebarKeys.value.some((key: string) => !isHiddenFor(key)));
const stateLabel = (state?: ItemState) => (({
  planned: t('planned'),
  ongoing: t('ongoing'),
  complete: t('complete'),
} as Partial<Record<string, string>>)[state || ''] || '');
const formatMeta = ({ start, end, place, state }: CvItem) => {
  const values = [];
  const range = [start, end].filter(Boolean).join(t('rangeSep'));
  if (range) values.push(range);
  if (place) values.push(place);
  if (stateLabel(state)) values.push(stateLabel(state));
  return values.join(t('dotSep'));
};
const customFieldEnabled = (section: CustomSection, field: CustomBodyField) => section.fields?.includes(field) ?? true;
const formatCustomMeta = (section: CustomSection, entry: CvItem) => {
  const values = [];
  const range = [
    customFieldEnabled(section, 'start') ? entry.start : '',
    customFieldEnabled(section, 'end') ? entry.end : '',
  ].filter(Boolean).join(t('rangeSep'));
  if (range) values.push(range);
  if (customFieldEnabled(section, 'place') && entry.place) values.push(entry.place);
  if (customFieldEnabled(section, 'state') && stateLabel(entry.state)) values.push(stateLabel(entry.state));
  return values.join(t('dotSep'));
};
const hasCustomInstitution = (section: CustomSection, entry: CvItem) => (
  customFieldEnabled(section, 'institution') && Boolean(String(entry.institution || '').trim())
);

const page = ref<HTMLElement | null>(null);
let timelineObserver: ResizeObserver | undefined;
let timelineFrame = 0;
const observedTimelineElements = new Set<Element>();
const needsLiveTimelines = () => !props.exportSource && designValue(props.state.design, 'showTimeline');
const refreshTimelines = () => {
  if (!needsLiveTimelines() || timelineFrame) return;
  timelineFrame = requestAnimationFrame(() => {
    timelineFrame = 0;
    if (needsLiveTimelines()) updateTimelineRails(page.value);
  });
};
const observeTimelines = () => {
  if (!needsLiveTimelines() || !page.value) {
    timelineObserver?.disconnect();
    observedTimelineElements.clear();
    cancelAnimationFrame(timelineFrame);
    timelineFrame = 0;
    return;
  }
  timelineObserver ??= new ResizeObserver(refreshTimelines);
  const elements = new Set<Element>([page.value, ...page.value.querySelectorAll('.timeline > .item')]);
  for (const element of observedTimelineElements) {
    if (!elements.has(element)) {
      timelineObserver.unobserve(element);
      observedTimelineElements.delete(element);
    }
  }
  for (const element of elements) {
    if (!observedTimelineElements.has(element)) {
      timelineObserver.observe(element);
      observedTimelineElements.add(element);
    }
  }
  refreshTimelines();
};
// Hidden export sources get their rails once, on the private paginated snapshot.
// Observing them here doubles layout work on every edit and serves no visible UI.
onMounted(observeTimelines);
onUpdated(observeTimelines);
watch(() => props.state.design, observeTimelines, { deep: true, flush: 'post' });
onBeforeUnmount(() => {
  timelineObserver?.disconnect();
  cancelAnimationFrame(timelineFrame);
});
</script>

<template>
  <div ref="page" class="page" :class="{ 'pdf-export-source': exportSource }" role="document">
    <header v-if="!isDisabled('header')" class="header">
      <div class="title"><h1 class="name">{{ state.contact.name || '-' }}</h1><p class="role">{{ state.contact.role }}</p></div>
      <address class="contact">
        <div v-if="state.contact.location">{{ state.contact.location }}<font-awesome-icon :icon="['fas', 'location-dot']" class="contact-icon" /></div>
        <div v-if="state.contact.email"><a :href="safeEmailUrl(state.contact.email) || undefined">{{ state.contact.email }}</a><font-awesome-icon :icon="['fas', 'envelope']" class="contact-icon" /></div>
        <div v-if="state.contact.phone">{{ state.contact.phone }}<font-awesome-icon :icon="['fas', 'phone']" class="contact-icon" /></div>
        <div v-if="state.contact.website"><a :href="safeWebUrl(state.contact.website) || undefined" rel="noreferrer">{{ state.contact.website.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fas', 'globe']" class="contact-icon" /></div>
        <div v-if="state.contact.linkedin"><a :href="safeWebUrl(state.contact.linkedin) || undefined" rel="noreferrer">{{ state.contact.linkedin.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'linkedin']" class="contact-icon" /></div>
        <div v-if="state.contact.github"><a :href="safeWebUrl(state.contact.github) || undefined" rel="noreferrer">{{ state.contact.github.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'github']" class="contact-icon" /></div>
      </address>
    </header>

    <section class="content">
      <aside v-if="hasVisibleSidebarContent" class="sidebar" id="cv_side">
        <div class="sidebar-content">
        <section v-for="{ key, section } in sidebarRows" :key="key" class="section" :class="{ 'is-hidden': isHiddenFor(key) }">
          <template v-if="key === 'languages'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <div class="language-items"><div v-for="language in visibleItems(state.languages)" :key="language.id" class="language-item"><span class="language-name">{{ language.name }}</span><span class="language-level">{{ language.level }}</span></div></div>
          </template>
          <template v-else-if="key === 'hobbies'">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
            <ul class="lang-list"><li v-for="hobby in visibleItems(state.hobbies)" :key="hobby.id">{{ hobby.name }}</li></ul>
          </template>
          <template v-else-if="section">
            <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ section.name }}</component>
            <div v-if="!section.levelType" class="tags"><span v-for="item in visibleItems(section.items)" :key="item.id" class="tag">{{ item.name }}</span></div>
            <div v-else class="skill-items-list"><SkillItem v-for="item in visibleItems(section.items)" :key="item.id" :name="item.name || ''" :level-type="section.levelType || ''" :level-value="item.levelValue || 0" :lang="langRef" /></div>
          </template>
        </section>
        </div>
      </aside>

      <div id="cv_main">
        <section v-for="{ key, section, entries } in bodyRows" :key="key" class="section" :class="{ 'is-hidden': isHiddenFor(key), 'section--keep-together': isKeptTogether(key) }">
          <svg v-if="key === 'jobs' || key === 'education'" class="timeline-rail" aria-hidden="true"><path d="" /></svg>
          <template v-if="key === 'about'">
            <div class="section-lead">
              <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
              <MarkdownContent :value="state.about.text" :anonymized="anonymized" />
            </div>
          </template>
          <template v-else-if="key === 'jobs'">
            <div class="section-lead">
              <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
              <div class="timeline" id="cv_exp_job"><CvBodyItem v-if="visibleItems(state.experience.jobs).length" kind="jobs" :item="visibleItems(state.experience.jobs)[0]" :meta="formatMeta(visibleItems(state.experience.jobs)[0])" :anonymized="anonymized" /></div>
            </div>
            <div v-if="visibleItems(state.experience.jobs).length > 1" class="timeline timeline--continued"><CvBodyItem v-for="item in visibleItems(state.experience.jobs).slice(1)" :key="item.id" kind="jobs" :item="item" :meta="formatMeta(item)" :anonymized="anonymized" /></div>
          </template>
          <template v-else-if="key === 'education'">
            <div class="section-lead">
              <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
              <div class="timeline"><CvBodyItem v-if="visibleItems(state.education).length" kind="education" :item="visibleItems(state.education)[0]" :meta="formatMeta(visibleItems(state.education)[0])" :anonymized="anonymized" /></div>
            </div>
            <div v-if="visibleItems(state.education).length > 1" class="timeline timeline--continued"><CvBodyItem v-for="item in visibleItems(state.education).slice(1)" :key="item.id" kind="education" :item="item" :meta="formatMeta(item)" :anonymized="anonymized" /></div>
          </template>
          <template v-else-if="section">
            <div class="section-lead">
              <component :is="getSectionHeaderSize(key)" v-if="!isSectionHeaderHidden(key)">{{ getSectionDisplayName(key) }}</component>
              <MarkdownContent v-if="section.entryMode === 'textarea'" :value="section.text" :anonymized="anonymized" />
              <CvBodyItem v-else-if="entries.length" kind="custom" :item="entries[0]" :meta="formatCustomMeta(section, entries[0])" :institution="hasCustomInstitution(section, entries[0])" :show-title="customFieldEnabled(section, 'title')" :show-description="customFieldEnabled(section, 'desc')" :anonymized="anonymized" />
            </div>
            <div v-if="section.entryMode !== 'textarea' && entries.length > 1"><CvBodyItem v-for="entry in entries.slice(1)" :key="entry.id" kind="custom" :item="entry" :meta="formatCustomMeta(section, entry)" :institution="hasCustomInstitution(section, entry)" :show-title="customFieldEnabled(section, 'title')" :show-description="customFieldEnabled(section, 'desc')" :anonymized="anonymized" /></div>
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
</style>
