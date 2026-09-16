<script setup>
import { computed, ref } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  state: { type: Object, required: true },
  isExporting: { type: Boolean, default: false },
  lang: { type: String, default: 'de' },
});

const emit = defineEmits(['export']);
const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);
const collapsed = ref(true);

const builtInNames = computed(() => ({
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}));

function entryLabel(item, fallback) {
  return item.title || item.name || item.company || item.sub || fallback;
}

function itemRows(items, fallback) {
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
}).filter(Boolean));

const sidebarSections = computed(() => (props.state.sidebarOrder || []).map((key) => {
  if (key === 'languages') return { key, name: builtInNames.value.languages, items: itemRows(props.state.languages, builtInNames.value.languages) };
  if (key === 'hobbies') return { key, name: builtInNames.value.hobbies, items: itemRows(props.state.hobbies, builtInNames.value.hobbies) };
  const section = (props.state.sidebarSections || []).find((candidate) => candidate.id === key);
  return section ? { key, name: section.name, items: itemRows(section.items, section.name) } : null;
}).filter(Boolean));

function excluded(key, id) {
  return Array.isArray(props.state.anonymization?.[key]) && props.state.anonymization[key].includes(id);
}

function setExcluded(key, id, shouldExclude) {
  const values = new Set(props.state.anonymization?.[key] || []);
  if (shouldExclude) values.add(id);
  else values.delete(id);
  props.state.anonymization = { ...props.state.anonymization, [key]: [...values] };
}
</script>

<template>
  <section class="section-group editor-panel anonymization-panel" :class="{ collapsed }">
    <div class="section-head editor-panel__header" @click="collapsed = !collapsed">
      <font-awesome-icon :icon="['fas', 'user-secret']" class="section-icon" aria-hidden="true" />
      <h3>{{ t('anonymization') }}</h3>
      <button class="caret mini anonymization-panel__toggle" type="button" :aria-label="collapsed ? t('expandAll') : t('collapseAll')" :title="collapsed ? t('expandAll') : t('collapseAll')" @click.stop="collapsed = !collapsed"><font-awesome-icon :icon="['fas', collapsed ? 'angles-down' : 'angles-up']" /></button>
    </div>

    <div class="editor-panel__body">
      <p class="anonymization-panel__help">{{ t('anonymizationHelp') }}</p>
      <p class="anonymization-panel__marker-help">{{ t('confidentialMarkerHelp') }}</p>

      <label class="anonymization-panel__row anonymization-panel__contact">
        <input type="checkbox" checked disabled>
        <span>{{ t('headerTitle') }}</span>
        <small>{{ t('contactAlwaysAnonymized') }}</small>
      </label>

      <div class="anonymization-panel__columns">
        <section class="anonymization-panel__column">
          <h4>{{ t('body') }}</h4>
          <div v-for="section in bodySections" :key="section.key" class="anonymization-panel__section">
            <label class="anonymization-panel__row">
              <input type="checkbox" :checked="excluded('excludedSections', section.key)" @change="setExcluded('excludedSections', section.key, $event.target.checked)">
              <span>{{ section.name }}</span>
            </label>
            <div v-if="section.items.length" class="anonymization-panel__items">
              <label v-for="item in section.items" :key="item.id" class="anonymization-panel__row anonymization-panel__item" :class="{ disabled: excluded('excludedSections', section.key) }">
                <input type="checkbox" :checked="excluded('excludedItems', item.id)" :disabled="excluded('excludedSections', section.key)" @change="setExcluded('excludedItems', item.id, $event.target.checked)">
                <span>{{ item.label }}</span>
              </label>
            </div>
          </div>
        </section>

        <section class="anonymization-panel__column">
          <h4>{{ t('sidebar') }}</h4>
          <div v-for="section in sidebarSections" :key="section.key" class="anonymization-panel__section">
            <label class="anonymization-panel__row">
              <input type="checkbox" :checked="excluded('excludedSections', section.key)" @change="setExcluded('excludedSections', section.key, $event.target.checked)">
              <span>{{ section.name }}</span>
            </label>
            <div v-if="section.items.length" class="anonymization-panel__items">
              <label v-for="item in section.items" :key="item.id" class="anonymization-panel__row anonymization-panel__item" :class="{ disabled: excluded('excludedSections', section.key) }">
                <input type="checkbox" :checked="excluded('excludedItems', item.id)" :disabled="excluded('excludedSections', section.key)" @change="setExcluded('excludedItems', item.id, $event.target.checked)">
                <span>{{ item.label }}</span>
              </label>
            </div>
          </div>
        </section>
      </div>

      <button class="btn btn--primary anonymization-panel__export" type="button" :disabled="isExporting" @click="$emit('export')">
        <font-awesome-icon :icon="['fas', isExporting ? 'spinner' : 'user-secret']" :spin="isExporting" />
        {{ isExporting ? t('exportingAnonymizedPdf') : t('downloadAnonymizedPdf') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.anonymization-panel__help, .anonymization-panel__marker-help { margin: 0; color: #cbd5e1; font-size: 12px; }
.anonymization-panel__marker-help { color: var(--muted); }
.anonymization-panel.collapsed .editor-panel__body { display: none; }
.anonymization-panel__toggle { margin-left: auto; }
.anonymization-panel__columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.anonymization-panel__column { display: grid; gap: 5px; margin-top: 12px; }
.anonymization-panel__column h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.anonymization-panel__section { display: grid; gap: 4px; }
.anonymization-panel__items { display: grid; gap: 3px; margin-left: 24px; }
.anonymization-panel__row { display: flex; align-items: center; gap: 8px; color: #d1fae5; cursor: pointer; }
.anonymization-panel__row input { width: 16px; height: 16px; accent-color: #27f3a2; cursor: pointer; }
.anonymization-panel__row small { color: var(--muted); font-size: 11px; }
.anonymization-panel__item { color: #9be8c7; font-size: 12px; }
.anonymization-panel__row.disabled { cursor: not-allowed; opacity: .55; }
.anonymization-panel__row.disabled input, .anonymization-panel__contact input { cursor: not-allowed; }
.anonymization-panel__contact { margin-top: 12px; cursor: default; }
.anonymization-panel__export { width: 100%; margin-top: 14px; }
@media (max-width: 640px) { .anonymization-panel__columns { grid-template-columns: 1fr; gap: 0; } }
</style>
