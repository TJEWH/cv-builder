<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvState, SavedConfiguration, LegacyCvState, CvItem, CustomSection, SidebarSection, ContentArea, CustomBodyField, ItemField } from '../types';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Draggable from 'vuedraggable';
import SectionList from './SectionList.vue';
import MarkdownTextarea from './MarkdownTextarea.vue';
import ConfirmDeletionDialog from './ConfirmDeletionDialog.vue';
import SectionVersionSelect from './SectionVersionSelect.vue';
import { useSectionVersions } from '../composables/useSectionVersions.ts';
import { makeT } from '../i18n/dict.ts';
import { createContentId, moveSectionInOrder, normalizeContentState } from '../composables/contentLayout.ts';

const props = defineProps({
  state: { type: Object as PropType<CvState>, required: true },
  configurations: { type: Array as PropType<SavedConfiguration[]>, default: () => [] },
  selectedId: { type: String, default: '' },
  readVersion: { type: Function as PropType<(id: string) => LegacyCvState | null | undefined>, required: true },
  saveVersion: { type: Function as PropType<(id: string, data: CvState) => boolean>, required: true },
});
const emit = defineEmits(['section-save-status']);

normalizeContentState(props.state);

const langRef = computed(() => props.state.lang || 'de');
const t = makeT(langRef);
const fieldConfigSectionId = ref<string | null>(null);
const activeContentTab = ref('body');
const reorderMode = ref(false);
const sectionVersions = useSectionVersions({
  state: () => props.state,
  selectedId: () => props.selectedId,
  configurations: () => props.configurations,
  readVersion: (id) => props.readVersion(id),
  saveVersion: (id, data) => props.saveVersion(id, data),
  onStatus: (status) => emit('section-save-status', status),
});
const versionMode = sectionVersions.enabled;
const sectionState = sectionVersions.sectionState;
// Route the editor's field bindings independently for each section. The app's
// actual state (and therefore its preview) remains the selected whole version.
const state = computed(() => ({
  contact: sectionState('header').contact,
  about: sectionState('about').about,
  experience: sectionState('jobs').experience,
  get education() { return sectionState('education').education; },
  set education(value) { sectionState('education').education = value; },
  get languages() { return sectionState('languages').languages; },
  set languages(value) { sectionState('languages').languages = value; },
  get hobbies() { return sectionState('hobbies').hobbies; },
  set hobbies(value) { sectionState('hobbies').hobbies = value; },
  get bodyOrder() { return versionMode.value ? sectionVersions.order('body') : props.state.bodyOrder; },
  set bodyOrder(value) { props.state.bodyOrder = value; },
  get sidebarOrder() { return versionMode.value ? sectionVersions.order('sidebar') : props.state.sidebarOrder; },
  set sidebarOrder(value) { props.state.sidebarOrder = value; },
  sectionHeaderSizes: props.state.sectionHeaderSizes,
}));
const versionSelectProps = (key: string) => ({
  modelValue: sectionVersions.versionId(key),
  options: sectionVersions.options(key),
  label: `${t('sectionVersion')}: ${getSectionDisplayName(key)}`,
  draftLabel: t('currentDraft'),
});
const selectSectionVersion = (key: string, id: string) => {
  pendingDeletion.value = null;
  sectionVersions.select(key, id);
};
const toggleVersionMode = () => {
  if (editingSection.id) finishEditSectionName(editingSection.id);
  closeFieldConfig();
  pendingDeletion.value = null;
  reorderMode.value = false;
  versionMode.value = !versionMode.value;
};
defineExpose({ flushSectionSaves: sectionVersions.flush, resetSectionVersions: sectionVersions.reset });
const collapsed = reactive<Record<string, boolean>>({
  about: true,
  education: true,
  jobs: true,
  languages: true,
  hobbies: true,
});
const customCollapsed = reactive<Record<string, boolean>>({});
const editingSection = reactive<{ id: string | null; value: string }>({ id: null, value: '' });
const pendingDeletion = ref<{ message: string; remove(): void } | null>(null);

const builtInNames = computed<Record<string, string>>(() => ({
  header: t('headerTitle'),
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}));
const headerSizeOptions = computed(() => [
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: langRef.value === 'de' ? 'Kein Titel' : 'No Title', value: 'null' },
]);
const levelTypeOptions = computed(() => [
  { label: langRef.value === 'de' ? 'Kein Level (Badges)' : 'No level (badges)', value: null },
  { label: langRef.value === 'de' ? 'Erfahrung (1–10)' : 'Experience (1–10)', value: 'experience' },
  { label: langRef.value === 'de' ? 'Jahre' : 'Years', value: 'years' },
]);

const isHidden = (key: string) => sectionState(key).disabled.includes(key);
const isComplete = (key: string) => sectionState(key).completedSections.includes(key);
const isKeptTogether = (key: string) => sectionState(key).keepTogetherSections.includes(key);
const toggleKeepTogether = (key: string) => {
  if (isKeptTogether(key)) props.state.keepTogetherSections = props.state.keepTogetherSections.filter((item) => item !== key);
  else props.state.keepTogetherSections.push(key);
};
const contentTabSectionKeys = (tab: string) => {
  if (tab === 'header') return ['header'];
  return tab === 'body' ? props.state.bodyOrder : props.state.sidebarOrder;
};
const isContentTabComplete = (tab: string) => {
  const keys = contentTabSectionKeys(tab);
  return keys.length > 0 && keys.every(isComplete);
};
const toggleComplete = (key: string) => {
  const index = props.state.completedSections.indexOf(key);
  if (index === -1) props.state.completedSections.push(key);
  else props.state.completedSections.splice(index, 1);
};
const moveSection = (orderName: 'bodyOrder' | 'sidebarOrder', key: string, direction: number, event: Event) => {
  if (!reorderMode.value) return;
  const handle = event.currentTarget as HTMLElement;
  props.state[orderName] = moveSectionInOrder(props.state[orderName], key, direction);
  nextTick(() => handle.focus());
};
const toggleDisabled = (key: string) => {
  const target = sectionState(key);
  const index = target.disabled.indexOf(key);
  if (index === -1) target.disabled.push(key);
  else target.disabled.splice(index, 1);
};
const getBodySection = (id: string | null) => sectionState(id || '').customSections.find((section) => section.id === id);
const getSidebarSection = (id: string | null) => sectionState(id || '').sidebarSections.find((section) => section.id === id);
const getCustomSection = (id: string) => getBodySection(id) || getSidebarSection(id);
const activeFieldConfigSection = computed(() => getBodySection(fieldConfigSectionId.value));
const getSectionDisplayName = (key: string) => getCustomSection(key)?.name || sectionState(key).sectionNames[key] || builtInNames.value[key] || key;
const getDefaultName = (key: string) => builtInNames.value[key] || (langRef.value === 'de' ? 'Neue Sektion' : 'New Section');
const isCollapsed = (key: string) => reorderMode.value || (Object.hasOwn(collapsed, key) ? collapsed[key] : customCollapsed[key] ?? true);
const toggleCollapsed = (key: string) => {
  if (reorderMode.value) return;
  if (Object.hasOwn(collapsed, key)) collapsed[key] = !collapsed[key];
  else customCollapsed[key] = !isCollapsed(key);
};
const isHeaderControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, input, select, textarea, a, [contenteditable="true"], .p-select');
const onHeaderClick = (key: string, event: MouseEvent) => {
  if (!isHeaderControl(event.target)) toggleCollapsed(key);
};

const startEditSectionName = (key: string) => {
  if (reorderMode.value || versionMode.value) return;
  const custom = getCustomSection(key);
  editingSection.id = key;
  editingSection.value = custom?.name || props.state.sectionNames[key] || '';
};
const finishEditSectionName = (key: string) => {
  if (editingSection.id !== key) return;
  const value = editingSection.value.trim();
  const custom = getCustomSection(key);
  if (custom) {
    if (value) custom.name = value;
  } else if (value && value !== getDefaultName(key)) {
    props.state.sectionNames = { ...props.state.sectionNames, [key]: value };
  } else {
    delete props.state.sectionNames[key];
  }
  editingSection.id = null;
  editingSection.value = '';
};
const cancelEditSectionName = () => { editingSection.id = null; editingSection.value = ''; };
const toggleReorderMode = () => {
  versionMode.value = false;
  if (editingSection.id) finishEditSectionName(editingSection.id);
  closeFieldConfig();
  reorderMode.value = !reorderMode.value;
};
const selectContentTab = (tab: string) => {
  activeContentTab.value = tab;
  // Header/contact fields are not part of either sortable section column.
  if (tab === 'header') reorderMode.value = false;
};
const editableTitleProps = (key: string) => ({
  editableTitle: true,
  isEditingTitle: editingSection.id === key,
  editingTitleValue: editingSection.value,
  titlePlaceholder: getDefaultName(key),
});
watch(() => editingSection.id, (key) => {
  if (!key) return;
  nextTick(() => document.querySelector<HTMLInputElement>('.section-name-input')?.focus());
});

const addBodySection = () => {
  const section: CustomSection = {
    id: createContentId('body'),
    name: langRef.value === 'de' ? 'Neue Sektion' : 'New Section',
    entryMode: 'fields',
    text: '',
    fields: ['title', 'institution', 'place', 'start', 'end', 'state', 'desc'],
    entries: [],
  };
  props.state.customSections.push(section);
  props.state.bodyOrder.push(section.id);
  props.state.sectionHeaderSizes[section.id] = 'h2';
  customCollapsed[section.id] = true;
};
const addSidebarSection = () => {
  const section = {
    id: createContentId('sidebar'),
    name: langRef.value === 'de' ? 'Neue Sidebar-Sektion' : 'New Sidebar Section',
    levelType: null,
    items: [],
  };
  props.state.sidebarSections.push(section);
  props.state.sidebarOrder.push(section.id);
  props.state.sectionHeaderSizes[section.id] = 'h2';
  customCollapsed[section.id] = true;
};
const deleteCustomSection = (section: CustomSection | SidebarSection, area: ContentArea) => {
  const sections = area === 'body' ? props.state.customSections : props.state.sidebarSections;
  const orderName = area === 'body' ? 'bodyOrder' : 'sidebarOrder';
  const index = sections.findIndex((item) => item.id === section.id);
  if (index !== -1) sections.splice(index, 1);
  props.state[orderName] = props.state[orderName].filter((key: string) => key !== section.id);
  props.state.disabled = props.state.disabled.filter((key: string) => key !== section.id);
  props.state.completedSections = props.state.completedSections.filter((key: string) => key !== section.id);
  props.state.keepTogetherSections = props.state.keepTogetherSections.filter((key: string) => key !== section.id);
  delete customCollapsed[section.id];
};
const addBodyEntry = (section: CustomSection) => section.entries.push({ id: createContentId('entry'), hidden: false, title: '', institution: '', place: '', start: '', end: '', state: 'planned', desc: '' });
const removeBodyEntry = (section: CustomSection, index: number) => section.entries.splice(index, 1);
const addSidebarItem = (section: SidebarSection) => section.items.push({ id: createContentId('skill'), hidden: false, name: '', levelValue: 0 });
const removeSidebarItem = (section: SidebarSection, index: number) => section.items.splice(index, 1);
const requestDeletion = (message: string, remove: () => void) => { pendingDeletion.value = { message, remove }; };
const requestSectionDeletion = (section: CustomSection | SidebarSection, area: ContentArea) => requestDeletion(t('confirmDeleteSection'), () => deleteCustomSection(section, area));
const requestBodyEntryDeletion = (section: CustomSection, index: number) => requestDeletion(t('confirmDeleteItem'), () => removeBodyEntry(section, index));
const requestSidebarItemDeletion = (section: SidebarSection, index: number) => requestDeletion(t('confirmDeleteItem'), () => removeSidebarItem(section, index));
const confirmDeletion = () => {
  pendingDeletion.value?.remove();
  pendingDeletion.value = null;
};
const cancelDeletion = () => { pendingDeletion.value = null; };
const toggleItemHidden = (item: CvItem) => { item.hidden = !item.hidden; };
const closeFieldConfig = () => { fieldConfigSectionId.value = null; };
const openFieldConfig = (section: CustomSection) => { fieldConfigSectionId.value = section.id; };
const itemStateOptions = computed(() => [
  { label: t('planned'), value: 'planned' },
  { label: t('ongoing'), value: 'ongoing' },
  { label: t('complete'), value: 'complete' },
]);
const customBodyFieldOptions = computed<(ItemField & { key: CustomBodyField })[]>(() => [
  { key: 'title', label: t('title'), type: 'text', placeholder: t('customSectionPH') },
  { key: 'institution', label: t('institution'), type: 'text', placeholder: 'Organisation' },
  { key: 'place', label: t('place'), type: 'text', placeholder: 'Berlin' },
  { key: 'start', label: t('start'), type: 'text', placeholder: '04.2024' },
  { key: 'end', label: t('end'), type: 'text', placeholder: t('current') },
  { key: 'state', label: t('state'), type: 'select', options: itemStateOptions.value },
  { key: 'desc', label: t('desc'), type: 'textarea', placeholder: '' },
]);
const enabledCustomBodyEntryFields = (section: CustomSection) => customBodyFieldOptions.value.filter((field) => field.type !== 'textarea' && section.fields?.includes(field.key as CustomBodyField));
const isCustomBodyFieldEnabled = (section: CustomSection, key: CustomBodyField) => section.fields?.includes(key);
const usesCustomBodyTextarea = (section: CustomSection) => section.entryMode === 'textarea';
const setCustomBodyEntryMode = (section: CustomSection, mode: string) => {
  section.entryMode = mode === 'textarea' ? 'textarea' : 'fields';
};
const setCustomBodyFieldEnabled = (section: CustomSection, key: CustomBodyField, enabled: boolean) => {
  const selected = new Set(section.fields);
  if (enabled) selected.add(key);
  else selected.delete(key);
  section.fields = customBodyFieldOptions.value.map((field) => field.key as CustomBodyField).filter((field) => selected.has(field));
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  closeFieldConfig();
};
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
onMounted(() => window.addEventListener('pagehide', sectionVersions.flush));
onBeforeUnmount(() => window.removeEventListener('pagehide', sectionVersions.flush));

const educationSchema = computed<ItemField[]>(() => [
  { label: t('degreeTitle'), key: 'title', type: 'text', placeholder: 'M.Sc. Informatik' },
  { label: t('institution'), key: 'sub', type: 'text', placeholder: 'TU München' },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Hamburg' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '2017' },
  { label: t('end'), key: 'end', type: 'text', placeholder: '2020' },
  { label: t('thesis'), key: 'thesis', type: 'textarea', placeholder: langRef.value === 'de' ? 'Thema und Details der Abschlussarbeit' : 'Thesis topic and details' },
  { label: t('modulesCourses'), key: 'coursesText', type: 'textarea', placeholder: langRef.value === 'de' ? '- Modul — Kurzbeschreibung' : '- Module — short description' },
]);
const jobsSchema = computed<ItemField[]>(() => [
  { label: t('position'), key: 'title', type: 'text', placeholder: 'Senior Software Engineer' },
  { label: t('company'), key: 'company', type: 'text', placeholder: 'Acme GmbH' },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Berlin' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '05.2021' },
  { label: t('end'), key: 'end', type: 'text', placeholder: t('current') },
  { label: t('state'), key: 'state', type: 'select', options: itemStateOptions.value, optionLabel: 'label', optionValue: 'value' },
  { label: t('bulletsLabel'), key: 'bullets', type: 'textarea', placeholder: t('tasksPH') },
]);
const languagesSchema = computed<ItemField[]>(() => [
  { label: t('languageName'), key: 'name', type: 'text', placeholder: t('german') },
  { label: t('level'), key: 'level', type: 'select', options: [langRef.value === 'de' ? 'Muttersprache' : 'Native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'] },
]);
const hobbiesSchema = computed<ItemField[]>(() => [{ label: 'Hobby', key: 'name', type: 'text', placeholder: 'Music Production' }]);
</script>

<template>
  <form class="builder builder--cli" @submit.prevent>
    <ConfirmDeletionDialog
      :visible="Boolean(pendingDeletion)"
      :title="t('confirmDeletion')"
      :message="pendingDeletion?.message || ''"
      :cancel-label="t('cancel')"
      :confirm-label="t('delete')"
      @cancel="cancelDeletion"
      @confirm="confirmDeletion"
    />
    <Teleport to="body">
      <Transition name="field-config">
        <div v-if="activeFieldConfigSection" class="field-config-backdrop" @click.self="closeFieldConfig">
          <section class="field-config-dialog" role="dialog" aria-modal="true" aria-labelledby="field-config-title">
            <header class="field-config-dialog__header">
              <h3 id="field-config-title">{{ t('fieldConfiguration') }}</h3>
              <button class="mini btn--danger" type="button" :aria-label="t('close')" :title="t('close')" @click="closeFieldConfig"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
            </header>
            <div class="field-config-mode" role="radiogroup" :aria-label="t('fieldInputMode')">
              <label class="field-config-option"><input type="radio" name="custom-field-mode" :checked="!usesCustomBodyTextarea(activeFieldConfigSection)" @change="setCustomBodyEntryMode(activeFieldConfigSection, 'fields')" />{{ t('fieldInputModeFields') }}</label>
              <label class="field-config-option"><input type="radio" name="custom-field-mode" :checked="usesCustomBodyTextarea(activeFieldConfigSection)" @change="setCustomBodyEntryMode(activeFieldConfigSection, 'textarea')" />{{ t('fieldInputModeTextarea') }}</label>
            </div>
            <p>{{ usesCustomBodyTextarea(activeFieldConfigSection) ? t('textareaFieldHelp') : t('fieldConfigurationHelp') }}</p>
            <div v-if="!usesCustomBodyTextarea(activeFieldConfigSection)" class="field-config-options">
              <label v-for="field in customBodyFieldOptions" :key="field.key" class="field-config-option">
                <input type="checkbox" :checked="isCustomBodyFieldEnabled(activeFieldConfigSection, field.key)" @change="setCustomBodyFieldEnabled(activeFieldConfigSection, field.key, ($event.target as HTMLInputElement).checked)" />
                {{ field.label }}
              </label>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
    <section class="body section-group editor-panel content-panel" :class="{ 'is-reordering': reorderMode && activeContentTab !== 'header' }">
      <div class="section-head editor-panel__header editor-panel__header--centered">
        <h2>{{ t('content') }}</h2>
        <div class="panel-header-action content-mode-actions">
          <button class="mini content-reorder-toggle" type="button" :class="{ 'is-active': versionMode }" :aria-label="t('sectionVersions')" :title="t('sectionVersions')" :aria-pressed="versionMode" @click="toggleVersionMode"><font-awesome-icon :icon="['fas', 'layer-group']" aria-hidden="true" />{{ t('versions') }}</button>
          <button class="mini content-reorder-toggle" type="button" :class="{ 'is-active': reorderMode && activeContentTab !== 'header' }" :aria-label="t('reorderSections')" :aria-pressed="reorderMode && activeContentTab !== 'header'" :disabled="activeContentTab === 'header'" @click="toggleReorderMode"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" />{{ t('reorder') }}</button>
        </div>
      </div>

      <div class="content-tabs" role="tablist" :aria-label="t('content')">
        <button id="content-tab-header" class="content-tab" :class="{ active: activeContentTab === 'header' }" type="button" role="tab" :aria-selected="activeContentTab === 'header'" aria-controls="content-panel-header" @click="selectContentTab('header')"><span>{{ t('header') }}</span><font-awesome-icon v-if="isContentTabComplete('header')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button id="content-tab-body" class="content-tab" :class="{ active: activeContentTab === 'body' }" type="button" role="tab" :aria-selected="activeContentTab === 'body'" aria-controls="content-panel-body" @click="selectContentTab('body')"><span>{{ t('body') }}</span><font-awesome-icon v-if="isContentTabComplete('body')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button id="content-tab-sidebar" class="content-tab" :class="{ active: activeContentTab === 'sidebar' }" type="button" role="tab" :aria-selected="activeContentTab === 'sidebar'" aria-controls="content-panel-sidebar" @click="selectContentTab('sidebar')"><span>{{ t('sidebar') }}</span><font-awesome-icon v-if="isContentTabComplete('sidebar')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
      </div>

      <div class="content-panel__scroll-body">

      <section v-show="activeContentTab === 'header'" id="content-panel-header" class="section-group content-section content-tab-panel" role="tabpanel" aria-labelledby="content-tab-header" :class="{ disabled: isHidden('header'), completed: isComplete('header') }">
        <div class="section-head">
          <button class="mini visibility-toggle" :class="isHidden('header') ? 'btn--success' : 'btn--danger'" type="button" :aria-label="isHidden('header') ? t('show') : t('hide')" :title="isHidden('header') ? t('show') : t('hide')" @click.stop="toggleDisabled('header')"><font-awesome-icon :icon="['fas', isHidden('header') ? 'eye-slash' : 'eye']" /></button>
          <h3 class="section-name-label section-name-label--static">{{ t('headerTitle') }}</h3>
          <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps('header')" @update:model-value="selectSectionVersion('header', $event)" />
          <div v-else class="section-head__actions"><label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete('header')" :aria-label="t('markComplete')" @change="toggleComplete('header')" /></label></div>
        </div>
        <div class="grid-2"><label>{{ t('name') }}<InputText v-model="state.contact.name" placeholder="Alex Muster" fluid /></label><label>{{ t('location') }}<InputText v-model="state.contact.location" placeholder="Neustadt" fluid /></label></div>
        <div class="grid-2"><label>{{ t('role') }}<InputText v-model="state.contact.role" placeholder="Software Engineer" fluid /></label><span /></div>
        <div class="grid-2"><label>{{ t('email') }}<InputText v-model="state.contact.email" type="email" placeholder="muster-ex@mp.le" fluid /></label><label>{{ t('phone') }}<InputText v-model="state.contact.phone" type="tel" placeholder="+49 123 456789" fluid /></label></div>
        <div class="grid-3"><label>{{ t('website') }}<InputText v-model="state.contact.website" type="url" placeholder="https://alexmuster.dev" fluid /></label><label>{{ t('linkedin') }}<InputText v-model="state.contact.linkedin" type="url" placeholder="https://linkedin.com/in/alexmuster" fluid /></label><label>{{ t('github') }}<InputText v-model="state.contact.github" type="url" placeholder="https://github.com/alexmuster" fluid /></label></div>
      </section>

      <Draggable v-show="activeContentTab === 'body'" id="content-panel-body" v-model="state.bodyOrder" :item-key="(key: string) => key" tag="section" class="content-tab-panel content-column" role="tabpanel" aria-labelledby="content-tab-body" :disabled="!reorderMode" handle=".content-section-card" :animation="150" ghost-class="sortable-ghost">
          <template #item="{ element: key }">
            <div class="content-section-card" :data-section-key="key">
              <button v-if="reorderMode" class="section-drag-handle" type="button" :aria-label="`${t('moveSection')}: ${getSectionDisplayName(key)}`" :title="t('moveSection')" @click.stop @keydown.up.prevent.stop="moveSection('bodyOrder', key, -1, $event)" @keydown.down.prevent.stop="moveSection('bodyOrder', key, 1, $event)"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" /></button>
            <section v-if="key === 'about'" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" :class="{ 'section-name-label--static': versionMode }" @click.stop="versionMode ? toggleCollapsed(key) : startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" :placeholder="getDefaultName(key)" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" />
                <div v-else class="section-head__actions">
                  <button class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': isKeptTogether(key) }" type="button" :aria-pressed="isKeptTogether(key)" :aria-label="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" :title="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="toggleKeepTogether(key)"><font-awesome-icon :icon="['fas', isKeptTogether(key) ? 'lock' : 'lock-open']" /></button>
                  <Select :model-value="state.sectionHeaderSizes[key] || 'h2'" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" @update:model-value="state.sectionHeaderSizes[key] = $event" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <div class="section-content">
                <div class="section-content__inner">
                  <label class="about-editor">{{ t('aboutTextLabel') }}<MarkdownTextarea v-model="state.about.text" placeholder="Me in a nutshell..." :help="t('markdownTextareaHelp')" :rows="4" /></label>
                </div>
              </div>
            </section>

            <SectionList
              v-else-if="key === 'education'"
              class="content-section"
              :version-mode="versionMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="education" v-model="state.education" :schema="educationSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <SectionList
              v-else-if="key === 'jobs'"
              class="content-section"
              :version-mode="versionMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="jobs" v-model="state.experience.jobs" :schema="jobsSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <section v-else-if="getBodySection(key)!" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" :class="{ 'section-name-label--static': versionMode }" @click.stop="versionMode ? toggleCollapsed(key) : startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" />
                <div v-else class="section-head__actions">
                  <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(getBodySection(key)!, 'body')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                  <button class="section-header-control" type="button" @click.stop="openFieldConfig(getBodySection(key)!)">{{ t('fields') }}</button>
                  <button class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': isKeptTogether(key) }" type="button" :aria-pressed="isKeptTogether(key)" :aria-label="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" :title="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="toggleKeepTogether(key)"><font-awesome-icon :icon="['fas', isKeptTogether(key) ? 'lock' : 'lock-open']" /></button>
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <div class="section-content">
                <div class="section-content__inner">
                  <label v-if="usesCustomBodyTextarea(getBodySection(key)!)" class="about-editor">{{ t('textarea') }}<MarkdownTextarea v-model="getBodySection(key)!.text" :help="t('markdownTextareaHelp')" :rows="6" /></label>
                  <template v-else>
                    <Draggable v-model="getBodySection(key)!.entries" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                      <template #item="{ element: entry, index }">
                        <div class="item-row" :class="{ 'item-row--hidden': entry.hidden }">
                          <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="entry.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="entry.hidden ? t('show') : t('hide')" :title="entry.hidden ? t('show') : t('hide')" @click="toggleItemHidden(entry)"><font-awesome-icon :icon="['fas', entry.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestBodyEntryDeletion(getBodySection(key)!, index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                          <div class="item-row__content">
                            <div v-if="enabledCustomBodyEntryFields(getBodySection(key)!).length" class="custom-body-entry__fields" :style="{ '--custom-body-field-count': enabledCustomBodyEntryFields(getBodySection(key)!).length }">
                              <label v-for="field in enabledCustomBodyEntryFields(getBodySection(key)!)" :key="field.key">{{ field.label }}<InputText v-if="field.type === 'text'" v-model="entry[field.key]" :placeholder="field.placeholder" fluid /><Select v-else-if="field.type === 'select'" v-model="entry[field.key]" :options="field.options" option-label="label" option-value="value" fluid /></label>
                            </div>
                            <label v-if="isCustomBodyFieldEnabled(getBodySection(key)!, 'desc')">{{ t('desc') }}<MarkdownTextarea v-model="entry.desc" :placeholder="customBodyFieldOptions.find((field) => field.key === 'desc')?.placeholder" :help="t('markdownTextareaHelp')" /></label>
                          </div>
                        </div>
                      </template>
                    </Draggable>
                    <button type="button" class="add-item-row" @click="addBodyEntry(getBodySection(key)!)"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
                  </template>
                </div>
              </div>
            </section>
            </div>
          </template>
          <template #footer>
          <button v-if="!reorderMode && !versionMode" type="button" class="add-section-row" @click="addBodySection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
          </template>
      </Draggable>

      <Draggable v-show="activeContentTab === 'sidebar'" id="content-panel-sidebar" v-model="state.sidebarOrder" :item-key="(key: string) => key" tag="section" class="content-tab-panel content-column" role="tabpanel" aria-labelledby="content-tab-sidebar" :disabled="!reorderMode" handle=".content-section-card" :animation="150" ghost-class="sortable-ghost">
          <template #item="{ element: key }">
            <div class="content-section-card" :data-section-key="key">
              <button v-if="reorderMode" class="section-drag-handle" type="button" :aria-label="`${t('moveSection')}: ${getSectionDisplayName(key)}`" :title="t('moveSection')" @click.stop @keydown.up.prevent.stop="moveSection('sidebarOrder', key, -1, $event)" @keydown.down.prevent.stop="moveSection('sidebarOrder', key, 1, $event)"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" /></button>
            <SectionList
              v-if="key === 'languages'"
              class="content-section"
              :version-mode="versionMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="languages" v-model="state.languages" :schema="languagesSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <SectionList
              v-else-if="key === 'hobbies'"
              class="content-section"
              :version-mode="versionMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="hobbies" v-model="state.hobbies" :schema="hobbiesSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <section v-else-if="getSidebarSection(key)!" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" :class="{ 'section-name-label--static': versionMode }" @click.stop="versionMode ? toggleCollapsed(key) : startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" />
                <div v-else class="section-head__actions">
                  <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(getSidebarSection(key)!, 'sidebar')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                  <Select v-model="getSidebarSection(key)!.levelType" :options="levelTypeOptions" option-label="label" option-value="value" :aria-label="t('levelType')" :title="t('levelType')" />
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <div class="section-content">
                <div class="section-content__inner">
                  <Draggable v-model="getSidebarSection(key)!.items" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                    <template #item="{ element: item, index }">
                      <div class="item-row sidebar-skill-row" :class="{ 'item-row--hidden': item.hidden }">
                        <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" @click="toggleItemHidden(item)"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestSidebarItemDeletion(getSidebarSection(key)!, index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                        <div class="item-row__content sidebar-skill-row__content">
                          <label>{{ t('skillName') }}<InputText v-model="item.name" :placeholder="langRef === 'de' ? 'z. B. Python' : 'e.g. Python'" fluid /></label>
                          <label v-if="getSidebarSection(key)!.levelType">{{ t('levelValue') }}<InputNumber v-model="item.levelValue" :min="getSidebarSection(key)!.levelType === 'experience' ? 1 : 0" :max="getSidebarSection(key)!.levelType === 'experience' ? 10 : 99" :use-grouping="false" fluid /></label>
                        </div>
                      </div>
                    </template>
                  </Draggable>
                  <button type="button" class="add-item-row" @click="addSidebarItem(getSidebarSection(key)!)"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
                </div>
              </div>
            </section>
            </div>
          </template>
          <template #footer>
          <button v-if="!reorderMode && !versionMode" type="button" class="add-section-row" @click="addSidebarSection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
          </template>
      </Draggable>
      </div>
    </section>
  </form>
</template>

<style scoped>
.content-column { display: grid; gap: 0; min-width: 0; }
.content-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid rgba(148, 163, 184, .24); }
.content-tab { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-weight: 600; }
.content-tab:hover, .content-tab:focus-visible { background: rgba(16, 185, 129, .1); color: #d1fae5; }
.content-tab.active { border-bottom-color: #27f3a2; color: #9be8c7; }
.content-tab:focus-visible { outline: 2px solid #9be8c7; outline-offset: -3px; }
.content-tab__complete { color: #86efac; }
.content-tab-panel { min-width: 0; }
.content-panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.content-panel__scroll-body { display: grid; align-content: start; flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.content-reorder-toggle { display: inline-flex; align-items: center; gap: 6px; }
.content-mode-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.content-reorder-toggle.is-active { color: #d1fae5; background: #17664f; border-color: #34d399; }
.content-reorder-toggle:disabled { border-color: #18332e; background: #0b2520; color: #52736b; cursor: not-allowed; opacity: .65; }
.content-reorder-toggle:disabled:hover { background: #0b2520; }
.content-section-card { position: relative; min-width: 0; }
.section-drag-handle { position: absolute; top: 13px; left: 8px; z-index: 1; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; box-shadow: none; cursor: grab; touch-action: none; }
.section-drag-handle:focus-visible { outline: 2px solid #9be8c7; outline-offset: 2px; }
.is-reordering .content-section-card { cursor: grab; }
.is-reordering .content-section-card:active, .section-drag-handle:active { cursor: grabbing; }
.is-reordering .content-section-card :deep(.section-head) { padding-left: 28px; pointer-events: none; }
.is-reordering .content-section-card :deep(.section-head__actions), .is-reordering .content-section-card :deep(.visibility-toggle) { display: none; }
.add-section-row { width: 100%; min-height: 54px; padding: 8px; border: 0; border-top: 1px dashed #2a6a60; border-bottom: 1px dashed #2a6a60; }
.about-editor { display: grid; gap: 4px; }
.sidebar-skill-row__content { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: end; }
.custom-body-entry__fields { display: grid; grid-template-columns: repeat(var(--custom-body-field-count), minmax(0, 1fr)); gap: 8px; }
.field-config-backdrop { position: fixed; inset: 0; z-index: 1010; display: grid; place-items: center; padding: 16px; background: rgba(2, 6, 23, .72); }
.field-config-dialog { display: grid; gap: 10px; width: min(100%, 560px); max-height: min(100%, 560px); overflow: auto; padding: 12px; border: 1px solid #10b981; border-radius: 8px; background: #0c131a; box-shadow: 0 18px 48px rgba(0, 0, 0, .5); }
.field-config-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid #134e4a; }
.field-config-dialog__header h3 { margin: 0; color: #d1fae5; font-size: .95rem; }
.field-config-dialog p { margin: 0; color: var(--muted); }
.field-config-mode { display: flex; flex-wrap: wrap; gap: 6px 10px; }
.field-config-options { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.field-config-option { display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; color: #d1fae5; cursor: pointer; white-space: nowrap; }
.field-config-option input { accent-color: #10b981; }
.field-config-enter-active, .field-config-leave-active { transition: opacity .2s ease; }
.field-config-enter-active .field-config-dialog, .field-config-leave-active .field-config-dialog { transition: transform .2s ease; }
.field-config-enter-from, .field-config-leave-to { opacity: 0; }
.field-config-enter-from .field-config-dialog, .field-config-leave-to .field-config-dialog { transform: translateY(8px) scale(.98); }
@media (max-width: 640px) { .sidebar-skill-row__content, .custom-body-entry__fields { grid-template-columns: 1fr; } }
</style>
