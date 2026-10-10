<script setup lang="ts">
import type { PropType } from 'vue';
import { FIELD_PRIVACY_TYPES, type CvState, type CvItem, type FieldPrivacyType } from '../types';
import { computed } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  state: { type: Object as PropType<CvState>, required: true },
  lang: { type: String, required: true },
});

const langRef = computed(() => props.lang);
const t = makeT(langRef);

const builtInNames = computed(() => ({
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}));

function entryLabel(item: CvItem, fallback: string) {
  return item.title || item.name || item.company || item.sub || fallback;
}

function itemRows(items: CvItem[], fallback: string) {
  return (items || []).map((item, index) => ({
    id: item.id,
    label: entryLabel(item, `${fallback} ${index + 1}`),
  }));
}

const bodySections = computed(() => (props.state.bodyOrder || []).map((key) => {
  if (key === 'about') return { key, name: builtInNames.value.about, items: [] };
  if (key === 'education') return { key, name: builtInNames.value.education, items: itemRows(props.state.education, builtInNames.value.education) };
  if (key === 'jobs') return { key, name: builtInNames.value.jobs, items: itemRows(props.state.experience?.jobs, builtInNames.value.jobs) };
  const section = (props.state.customSections || []).find((candidate) => candidate.id === key);
  return section ? { key, name: section.name, items: itemRows(section.entries, section.name) } : null;
}).filter((section) => section !== null));

const sidebarSections = computed(() => (props.state.sidebarOrder || []).map((key) => {
  if (key === 'languages') return { key, name: builtInNames.value.languages, items: itemRows(props.state.languages, builtInNames.value.languages) };
  if (key === 'hobbies') return { key, name: builtInNames.value.hobbies, items: itemRows(props.state.hobbies, builtInNames.value.hobbies) };
  const section = (props.state.sidebarSections || []).find((candidate) => candidate.id === key);
  return section ? { key, name: section.name, items: itemRows(section.items, section.name) } : null;
}).filter((section) => section !== null));

type ExclusionKey = 'excludedSections' | 'excludedItems';

const proxyFieldLabels: Record<FieldPrivacyType, string> = {
  company: 'company', institution: 'institution', place: 'place', dates: 'privacyDates',
};

function setFieldProxy(field: FieldPrivacyType, enabled: boolean) {
  const fields = new Set(props.state.anonymization.proxyFields || []);
  if (enabled) fields.add(field);
  else fields.delete(field);
  props.state.anonymization = { ...props.state.anonymization, proxyFields: FIELD_PRIVACY_TYPES.filter((key) => fields.has(key)) };
}

function excluded(key: ExclusionKey, id: string) {
  return Array.isArray(props.state.anonymization?.[key]) && props.state.anonymization[key].includes(id);
}

function setExcluded(key: ExclusionKey, id: string, shouldExclude: boolean) {
  const values = new Set(props.state.anonymization?.[key] || []);
  if (shouldExclude) values.add(id);
  else values.delete(id);
  props.state.anonymization = { ...props.state.anonymization, [key]: [...values] };
}
</script>

<template>
  <section class="section-group editor-panel anonymization-panel">
    <div class="editor-panel__body">
      <p class="app-hint">{{ t('anonymizationHelp') }}</p>

      <label class="anonymization-panel__row anonymization-panel__contact">
        <input type="checkbox" checked disabled>
        <span>{{ t('privacyContactAutomatic') }}</span>
      </label>

      <fieldset class="anonymization-panel__fields" aria-describedby="field-proxy-help">
        <legend>{{ t('privacyFieldProxies') }}</legend>
        <p id="field-proxy-help" class="anonymization-panel__help">{{ t('privacyFieldProxiesHelp') }}</p>
        <div class="anonymization-panel__field-options">
          <label v-for="field in FIELD_PRIVACY_TYPES" :key="field" class="anonymization-panel__row anonymization-panel__field">
            <input type="checkbox" :checked="state.anonymization.proxyFields?.includes(field) || false" @change="setFieldProxy(field, ($event.target as HTMLInputElement).checked)">
            <span>{{ t(proxyFieldLabels[field]) }}</span>
          </label>
        </div>
        <p class="anonymization-panel__help">{{ t('confidentialMarkerHelp') }}</p>
      </fieldset>

      <div class="anonymization-panel__exclusions">
        <h3>{{ t('privacyExcludeContent') }}</h3>
        <p class="anonymization-panel__help">{{ t('privacyExcludeContentHelp') }}</p>
        <div class="anonymization-panel__columns">
          <section class="anonymization-panel__column">
            <h4>{{ t('body') }}</h4>
            <div v-for="section in bodySections" :key="section.key" class="anonymization-panel__section">
              <label class="anonymization-panel__row">
                <input type="checkbox" :checked="excluded('excludedSections', section.key)" @change="setExcluded('excludedSections', section.key, ($event.target as HTMLInputElement).checked)">
                <span>{{ section.name }}</span>
              </label>
              <div v-if="section.items.length" class="anonymization-panel__items">
                <label v-for="item in section.items" :key="item.id" class="anonymization-panel__row anonymization-panel__item" :class="{ disabled: excluded('excludedSections', section.key) }">
                  <input type="checkbox" :checked="excluded('excludedItems', item.id)" :disabled="excluded('excludedSections', section.key)" @change="setExcluded('excludedItems', item.id, ($event.target as HTMLInputElement).checked)">
                  <span>{{ item.label }}</span>
                </label>
              </div>
            </div>
          </section>

          <section class="anonymization-panel__column">
            <h4>{{ t('sidebar') }}</h4>
            <div v-for="section in sidebarSections" :key="section.key" class="anonymization-panel__section">
              <label class="anonymization-panel__row">
                <input type="checkbox" :checked="excluded('excludedSections', section.key)" @change="setExcluded('excludedSections', section.key, ($event.target as HTMLInputElement).checked)">
                <span>{{ section.name }}</span>
              </label>
              <div v-if="section.items.length" class="anonymization-panel__items">
                <label v-for="item in section.items" :key="item.id" class="anonymization-panel__row anonymization-panel__item" :class="{ disabled: excluded('excludedSections', section.key) }">
                  <input type="checkbox" :checked="excluded('excludedItems', item.id)" :disabled="excluded('excludedSections', section.key)" @change="setExcluded('excludedItems', item.id, ($event.target as HTMLInputElement).checked)">
                  <span>{{ item.label }}</span>
                </label>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.anonymization-panel > .editor-panel__body { align-content: start; }
.anonymization-panel__fields { min-width: 0; margin: 24px 0 0; padding: 0; border: 0; }
.anonymization-panel__fields legend, .anonymization-panel__exclusions h3 { padding: 0; margin: 0; color: #d1fae5; font-size: 16px; font-weight: 600; }
.anonymization-panel__help { margin: 8px 0 0; color: #9be8c7; font-size: 13px; line-height: 1.55; }
.anonymization-panel__field-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; margin-top: 8px; }
.anonymization-panel__field { min-height: 40px; padding: 4px; border-radius: 4px; }
.anonymization-panel__field:hover { background: rgb(155 232 199 / 7%); }
.anonymization-panel__row:has(input:focus-visible) { outline: 2px solid #27f3a2; outline-offset: 2px; }
.anonymization-panel__exclusions { margin-top: 24px; }
.anonymization-panel__columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.anonymization-panel__column { display: grid; align-content: start; gap: 5px; margin-top: 12px; }
.anonymization-panel__column h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.anonymization-panel__section { display: grid; gap: 4px; }
.anonymization-panel__items { display: grid; gap: 3px; margin-left: 24px; }
.anonymization-panel__row { display: flex; align-items: center; gap: 8px; color: #d1fae5; cursor: pointer; }
.anonymization-panel__row input { flex-shrink: 0; width: 16px; height: 16px; accent-color: #27f3a2; cursor: pointer; }
.anonymization-panel__item { color: #9be8c7; font-size: 12px; }
.anonymization-panel__row.disabled { cursor: not-allowed; opacity: .55; }
.anonymization-panel__row.disabled input, .anonymization-panel__contact input { cursor: not-allowed; }
.anonymization-panel__contact { margin-top: 12px; cursor: default; }
@media (max-width: 640px) { .anonymization-panel__columns { grid-template-columns: 1fr; gap: 0; } }
</style>
