<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Draggable from 'vuedraggable';
import SectionList from './SectionList.vue';
import MarkdownTextarea from './MarkdownTextarea.vue';
import ConfirmDeletionDialog from './ConfirmDeletionDialog.vue';
import { makeT } from '../i18n/dict.js';
import sectionIcons from '../i18n/sectionIcons.js';
import { createContentId, normalizeContentState, reorderVisibleSectionOrder } from '../composables/contentLayout.js';

const props = defineProps({
  state: { type: Object, required: true },
  onSave: { type: Function, default: null },
});

normalizeContentState(props.state);

const langRef = computed(() => props.state.lang || 'de');
const t = makeT(langRef);
const reorderDialogOpen = ref(false);
const fieldConfigSectionId = ref(null);
const activeContentTab = ref('header');
const collapsed = reactive({
  about: true,
  education: true,
  jobs: true,
  languages: true,
  hobbies: true,
});
const customCollapsed = reactive({});
const editingSection = reactive({ id: null, value: '' });
const pendingDeletion = ref(null);

const builtInNames = computed(() => ({
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

const isHidden = (key) => props.state.disabled.includes(key);
const isComplete = (key) => props.state.completedSections.includes(key);
const isKeptTogether = (key) => props.state.keepTogetherSections.includes(key);
const toggleKeepTogether = (key) => {
  if (isKeptTogether(key)) props.state.keepTogetherSections = props.state.keepTogetherSections.filter((item) => item !== key);
  else props.state.keepTogetherSections.push(key);
  props.onSave?.();
};
const contentTabSectionKeys = (tab) => {
  if (tab === 'header') return ['header'];
  return tab === 'body' ? props.state.bodyOrder : props.state.sidebarOrder;
};
const isContentTabComplete = (tab) => {
  const keys = contentTabSectionKeys(tab);
  return keys.length > 0 && keys.every(isComplete);
};
const toggleComplete = (key) => {
  const index = props.state.completedSections.indexOf(key);
  if (index === -1) props.state.completedSections.push(key);
  else props.state.completedSections.splice(index, 1);
  props.onSave?.();
};
const updateVisibleOrder = (orderName, rows) => {
  props.state[orderName] = reorderVisibleSectionOrder(
    props.state[orderName],
    props.state.disabled,
    rows.map((row) => row.key),
  );
  props.onSave?.();
};
const bodyOrderRows = computed(() => props.state.bodyOrder.filter((key) => !isHidden(key)).map((key) => ({ key })));
const sidebarOrderRows = computed(() => props.state.sidebarOrder.filter((key) => !isHidden(key)).map((key) => ({ key })));
const toggleDisabled = (key) => {
  const index = props.state.disabled.indexOf(key);
  if (index === -1) props.state.disabled.push(key);
  else props.state.disabled.splice(index, 1);
  props.onSave?.();
};
const getBodySection = (id) => props.state.customSections.find((section) => section.id === id);
const getSidebarSection = (id) => props.state.sidebarSections.find((section) => section.id === id);
const getCustomSection = (id) => getBodySection(id) || getSidebarSection(id);
const activeFieldConfigSection = computed(() => getBodySection(fieldConfigSectionId.value));
const getSectionDisplayName = (key) => getCustomSection(key)?.name || props.state.sectionNames[key] || builtInNames.value[key] || key;
const getDefaultName = (key) => builtInNames.value[key] || (langRef.value === 'de' ? 'Neue Sektion' : 'New Section');
const getIcon = (key) => getCustomSection(key) ? 'folder-open' : (sectionIcons[key] || 'folder-open');
const isCollapsed = (key) => Object.hasOwn(collapsed, key) ? collapsed[key] : customCollapsed[key] ?? true;
const toggleCollapsed = (key) => {
  if (Object.hasOwn(collapsed, key)) collapsed[key] = !collapsed[key];
  else customCollapsed[key] = !isCollapsed(key);
};
const isHeaderControl = (target) => target?.closest?.('button, input, select, textarea, a, [contenteditable="true"], .p-select');
const onHeaderClick = (key, event) => {
  if (!isHeaderControl(event.target)) toggleCollapsed(key);
};

const startEditSectionName = (key) => {
  const custom = getCustomSection(key);
  editingSection.id = key;
  editingSection.value = custom?.name || props.state.sectionNames[key] || '';
};
const finishEditSectionName = (key) => {
  if (editingSection.id !== key) return;
  const value = editingSection.value.trim();
  const custom = getCustomSection(key);
  if (custom) {
    if (value) custom.name = value;
  } else if (value && value !== getDefaultName(key)) {
    props.state.sectionNames = { ...props.state.sectionNames, [key]: value };
  } else {
    const { [key]: removed, ...sectionNames } = props.state.sectionNames;
    props.state.sectionNames = sectionNames;
  }
  editingSection.id = null;
  editingSection.value = '';
  props.onSave?.();
};
const cancelEditSectionName = () => { editingSection.id = null; editingSection.value = ''; };
const editableTitleProps = (key) => ({
  editableTitle: true,
  isEditingTitle: editingSection.id === key,
  editingTitleValue: editingSection.value,
  titlePlaceholder: getDefaultName(key),
});
watch(() => editingSection.id, (key) => {
  if (!key) return;
  nextTick(() => document.querySelector('.section-name-input')?.focus());
});

const addBodySection = () => {
  const section = {
    id: createContentId('body'),
    name: langRef.value === 'de' ? 'Neue Sektion' : 'New Section',
    fields: ['title', 'institution', 'place', 'start', 'end', 'tools', 'desc'],
    entries: [],
  };
  props.state.customSections.push(section);
  props.state.bodyOrder.push(section.id);
  props.state.sectionHeaderSizes[section.id] = 'h2';
  customCollapsed[section.id] = true;
  props.onSave?.();
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
  props.onSave?.();
};
const deleteCustomSection = (section, area) => {
  const sections = area === 'body' ? props.state.customSections : props.state.sidebarSections;
  const orderName = area === 'body' ? 'bodyOrder' : 'sidebarOrder';
  const index = sections.findIndex((item) => item.id === section.id);
  if (index !== -1) sections.splice(index, 1);
  props.state[orderName] = props.state[orderName].filter((key) => key !== section.id);
  props.state.disabled = props.state.disabled.filter((key) => key !== section.id);
  props.state.completedSections = props.state.completedSections.filter((key) => key !== section.id);
  props.state.keepTogetherSections = props.state.keepTogetherSections.filter((key) => key !== section.id);
  delete customCollapsed[section.id];
  props.onSave?.();
};
const addBodyEntry = (section) => section.entries.push({ id: createContentId('entry'), hidden: false, title: '', institution: '', place: '', start: '', end: '', tools: '', desc: '' });
const removeBodyEntry = (section, index) => section.entries.splice(index, 1);
const addSidebarItem = (section) => section.items.push({ id: createContentId('skill'), hidden: false, name: '', levelValue: 0 });
const removeSidebarItem = (section, index) => section.items.splice(index, 1);
const requestDeletion = (message, remove) => { pendingDeletion.value = { message, remove }; };
const requestSectionDeletion = (section, area) => requestDeletion(t('confirmDeleteSection'), () => deleteCustomSection(section, area));
const requestBodyEntryDeletion = (section, index) => requestDeletion(t('confirmDeleteItem'), () => removeBodyEntry(section, index));
const requestSidebarItemDeletion = (section, index) => requestDeletion(t('confirmDeleteItem'), () => removeSidebarItem(section, index));
const confirmDeletion = () => {
  pendingDeletion.value?.remove();
  pendingDeletion.value = null;
};
const cancelDeletion = () => { pendingDeletion.value = null; };
const toggleItemHidden = (item) => { item.hidden = !item.hidden; };
const closeReorderDialog = () => { reorderDialogOpen.value = false; };
const closeFieldConfig = () => { fieldConfigSectionId.value = null; };
const openFieldConfig = (section) => { fieldConfigSectionId.value = section.id; };
const customBodyFieldOptions = computed(() => [
  { key: 'title', label: t('title'), type: 'text', placeholder: t('customSectionPH') },
  { key: 'institution', label: t('institution'), type: 'text', placeholder: 'Organisation' },
  { key: 'place', label: t('place'), type: 'text', placeholder: 'Berlin' },
  { key: 'start', label: t('start'), type: 'text', placeholder: '04.2024' },
  { key: 'end', label: t('end'), type: 'text', placeholder: t('current') },
  { key: 'tools', label: t('tools'), type: 'text', placeholder: 'Vue, TypeScript, Figma' },
  { key: 'desc', label: t('desc'), type: 'textarea', placeholder: '' },
]);
const enabledCustomBodyFields = (section) => customBodyFieldOptions.value.filter((field) => section.fields.includes(field.key));
const enabledCustomBodyTextFields = (section) => enabledCustomBodyFields(section).filter((field) => field.type === 'text');
const isCustomBodyFieldEnabled = (section, key) => section.fields.includes(key);
const setCustomBodyFieldEnabled = (section, key, enabled) => {
  const selected = new Set(section.fields);
  if (enabled) selected.add(key);
  else selected.delete(key);
  section.fields = customBodyFieldOptions.value.map((field) => field.key).filter((field) => selected.has(field));
  props.onSave?.();
};
const onKeydown = (event) => {
  if (event.key !== 'Escape') return;
  closeReorderDialog();
  closeFieldConfig();
};
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

const educationSchema = computed(() => [
  { label: t('degreeTitle'), key: 'title', type: 'text', placeholder: 'M.Sc. Informatik' },
  { label: t('institution'), key: 'sub', type: 'text', placeholder: 'TU München' },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Hamburg' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '2017' },
  { label: t('end'), key: 'end', type: 'text', placeholder: '2020' },
  { label: t('thesis'), key: 'thesis', type: 'textarea', placeholder: langRef.value === 'de' ? 'Thema und Details der Abschlussarbeit' : 'Thesis topic and details' },
  { label: t('modulesCourses'), key: 'coursesText', type: 'textarea', placeholder: langRef.value === 'de' ? '- Modul — Kurzbeschreibung' : '- Module — short description' },
]);
const jobsSchema = computed(() => [
  { label: t('position'), key: 'title', type: 'text', placeholder: 'Senior Software Engineer' },
  { label: t('company'), key: 'company', type: 'text', placeholder: 'Acme GmbH' },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Berlin' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '05.2021' },
  { label: t('end'), key: 'end', type: 'text', placeholder: t('current') },
  { label: t('tools'), key: 'tools', type: 'text', placeholder: 'Vue, TypeScript, Figma' },
  { label: t('bulletsLabel'), key: 'bullets', type: 'textarea', placeholder: t('tasksPH') },
]);
const languagesSchema = computed(() => [
  { label: t('languageName'), key: 'name', type: 'text', placeholder: t('german') },
  { label: t('level'), key: 'level', type: 'select', options: [langRef.value === 'de' ? 'Muttersprache' : 'Native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'] },
]);
const hobbiesSchema = computed(() => [{ label: 'Hobby', key: 'name', type: 'text', placeholder: 'Music Production' }]);
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
    <div v-if="reorderDialogOpen" class="reorder-dialog-backdrop" @click.self="closeReorderDialog">
      <section class="reorder-dialog" role="dialog" aria-modal="true" :aria-label="langRef === 'de' ? 'Sektionen sortieren' : 'Reorder sections'">
        <header class="reorder-dialog__header">
          <h3>{{ t('reorderSections') }}</h3>
          <button class="mini btn--danger" type="button" @click="closeReorderDialog"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
        </header>
        <p>{{ t('reorderSectionsHelp') }}</p>
        <div class="reorder-dialog__columns">
          <section class="reorder-dialog__column">
            <h4>{{ t('body') }}</h4>
            <Draggable :model-value="bodyOrderRows" item-key="key" :animation="150" ghost-class="sortable-ghost" @update:modelValue="updateVisibleOrder('bodyOrder', $event)">
              <template #item="{ element }">
                <div class="reorder-dialog__row"><span><font-awesome-icon :icon="['fas', getIcon(element.key)]" /> {{ getSectionDisplayName(element.key) }}</span><font-awesome-icon class="popup-drag-icon" :icon="['fas', 'grip-vertical']" aria-hidden="true" /></div>
              </template>
            </Draggable>
          </section>
          <section class="reorder-dialog__column">
            <h4>{{ t('sidebar') }}</h4>
            <Draggable :model-value="sidebarOrderRows" item-key="key" :animation="150" ghost-class="sortable-ghost" @update:modelValue="updateVisibleOrder('sidebarOrder', $event)">
              <template #item="{ element }">
                <div class="reorder-dialog__row"><span><font-awesome-icon :icon="['fas', getIcon(element.key)]" /> {{ getSectionDisplayName(element.key) }}</span><font-awesome-icon class="popup-drag-icon" :icon="['fas', 'grip-vertical']" aria-hidden="true" /></div>
              </template>
            </Draggable>
          </section>
        </div>
      </section>
    </div>

    <div v-if="activeFieldConfigSection" class="field-config-backdrop" @click.self="closeFieldConfig">
      <section class="field-config-dialog" role="dialog" aria-modal="true" :aria-label="t('fieldConfiguration')">
        <header class="field-config-dialog__header">
          <h3>{{ t('fieldConfiguration') }}</h3>
          <button class="mini btn--danger" type="button" :aria-label="t('close')" :title="t('close')" @click="closeFieldConfig"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
        </header>
        <p>{{ t('fieldConfigurationHelp') }}</p>
        <div class="field-config-options">
          <label v-for="field in customBodyFieldOptions" :key="field.key" class="field-config-option">
            <input type="checkbox" :checked="isCustomBodyFieldEnabled(activeFieldConfigSection, field.key)" @change="setCustomBodyFieldEnabled(activeFieldConfigSection, field.key, $event.target.checked)" />
            {{ field.label }}
          </label>
        </div>
      </section>
    </div>

    <section class="body section-group editor-panel content-panel">
      <div class="section-head editor-panel__header editor-panel__header--centered">
        <h3>{{ t('content') }}</h3>
        <button class="mini panel-header-action" type="button" :aria-label="t('reorder')" :title="t('reorder')" @click="reorderDialogOpen = true">
          <font-awesome-icon :icon="['fas', 'grip-vertical']" />
          {{ t('reorder') }}
        </button>
      </div>

      <div class="content-tabs" role="tablist" :aria-label="t('content')">
        <button id="content-tab-header" class="content-tab" :class="{ active: activeContentTab === 'header' }" type="button" role="tab" :aria-selected="activeContentTab === 'header'" aria-controls="content-panel-header" @click="activeContentTab = 'header'"><span>{{ t('header') }}</span><font-awesome-icon v-if="isContentTabComplete('header')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button id="content-tab-body" class="content-tab" :class="{ active: activeContentTab === 'body' }" type="button" role="tab" :aria-selected="activeContentTab === 'body'" aria-controls="content-panel-body" @click="activeContentTab = 'body'"><span>{{ t('body') }}</span><font-awesome-icon v-if="isContentTabComplete('body')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button id="content-tab-sidebar" class="content-tab" :class="{ active: activeContentTab === 'sidebar' }" type="button" role="tab" :aria-selected="activeContentTab === 'sidebar'" aria-controls="content-panel-sidebar" @click="activeContentTab = 'sidebar'"><span>{{ t('sidebar') }}</span><font-awesome-icon v-if="isContentTabComplete('sidebar')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
      </div>

      <section v-show="activeContentTab === 'header'" id="content-panel-header" class="section-group content-section content-tab-panel" role="tabpanel" aria-labelledby="content-tab-header" :class="{ disabled: isHidden('header'), completed: isComplete('header') }">
        <div class="section-head">
          <button class="mini visibility-toggle" :class="isHidden('header') ? 'btn--success' : 'btn--danger'" type="button" :aria-label="isHidden('header') ? t('show') : t('hide')" :title="isHidden('header') ? t('show') : t('hide')" @click.stop="toggleDisabled('header')"><font-awesome-icon :icon="['fas', isHidden('header') ? 'eye-slash' : 'eye']" /></button>
          <h3 class="section-name-label section-name-label--static">{{ t('headerTitle') }}</h3>
          <div class="section-head__actions"><label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete('header')" :aria-label="t('markComplete')" @change="toggleComplete('header')" /></label></div>
        </div>
        <div class="grid-2"><label>{{ t('name') }}<InputText v-model="state.contact.name" placeholder="Alex Muster" fluid /></label><label>{{ t('location') }}<InputText v-model="state.contact.location" placeholder="Neustadt" fluid /></label></div>
        <div class="grid-2"><label>{{ t('role') }}<InputText v-model="state.contact.role" placeholder="Software Engineer" fluid /></label><span /></div>
        <div class="grid-2"><label>{{ t('email') }}<InputText v-model="state.contact.email" type="email" placeholder="muster-ex@mp.le" fluid /></label><label>{{ t('phone') }}<InputText v-model="state.contact.phone" type="tel" placeholder="+49 123 456789" fluid /></label></div>
        <div class="grid-3"><label>{{ t('website') }}<InputText v-model="state.contact.website" type="url" placeholder="https://alexmuster.dev" fluid /></label><label>{{ t('linkedin') }}<InputText v-model="state.contact.linkedin" type="url" placeholder="https://linkedin.com/in/alexmuster" fluid /></label><label>{{ t('github') }}<InputText v-model="state.contact.github" type="url" placeholder="https://github.com/alexmuster" fluid /></label></div>
      </section>

      <section v-show="activeContentTab === 'body'" id="content-panel-body" class="content-tab-panel content-column" role="tabpanel" aria-labelledby="content-tab-body">
          <template v-for="key in state.bodyOrder" :key="key">
            <section v-if="key === 'about'" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" :placeholder="getDefaultName(key)" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <button class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': isKeptTogether(key) }" type="button" :aria-pressed="isKeptTogether(key)" :aria-label="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" :title="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="toggleKeepTogether(key)"><font-awesome-icon :icon="['fas', isKeptTogether(key) ? 'lock' : 'lock-open']" /></button>
                  <Select :model-value="state.sectionHeaderSizes[key] || 'h2'" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" @update:model-value="state.sectionHeaderSizes[key] = $event" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <label class="about-editor">{{ t('aboutTextLabel') }}<MarkdownTextarea v-model="state.about.text" placeholder="Me in a nutshell..." :help="t('markdownTextareaHelp')" :rows="4" /></label>
            </section>

            <SectionList
              v-else-if="key === 'education'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="education" v-model="state.education" :schema="educationSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <SectionList
              v-else-if="key === 'jobs'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="jobs" v-model="state.experience.jobs" :schema="jobsSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <section v-else-if="getBodySection(key)" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(getBodySection(key), 'body')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                  <button class="section-header-control" type="button" @click.stop="openFieldConfig(getBodySection(key))">{{ t('fields') }}</button>
                  <button class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': isKeptTogether(key) }" type="button" :aria-pressed="isKeptTogether(key)" :aria-label="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" :title="isKeptTogether(key) ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="toggleKeepTogether(key)"><font-awesome-icon :icon="['fas', isKeptTogether(key) ? 'lock' : 'lock-open']" /></button>
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <Draggable v-model="getBodySection(key).entries" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                <template #item="{ element: entry, index }">
                  <div class="item-row" :class="{ 'item-row--hidden': entry.hidden }">
                    <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="entry.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="entry.hidden ? t('show') : t('hide')" :title="entry.hidden ? t('show') : t('hide')" @click="toggleItemHidden(entry)"><font-awesome-icon :icon="['fas', entry.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestBodyEntryDeletion(getBodySection(key), index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                    <div class="item-row__content">
                      <div v-if="enabledCustomBodyTextFields(getBodySection(key)).length" class="custom-body-entry__fields" :style="{ '--custom-body-field-count': enabledCustomBodyTextFields(getBodySection(key)).length }">
                        <label v-for="field in enabledCustomBodyTextFields(getBodySection(key))" :key="field.key">{{ field.label }}<InputText v-model="entry[field.key]" :placeholder="field.placeholder" fluid /></label>
                      </div>
                      <label v-if="isCustomBodyFieldEnabled(getBodySection(key), 'desc')">{{ t('desc') }}<MarkdownTextarea v-model="entry.desc" :placeholder="customBodyFieldOptions.find((field) => field.key === 'desc').placeholder" :help="t('markdownTextareaHelp')" /></label>
                    </div>
                  </div>
                </template>
              </Draggable>
              <button type="button" class="add-item-row" @click="addBodyEntry(getBodySection(key))"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
            </section>
          </template>
          <button type="button" class="add-section-row" @click="addBodySection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
      </section>

      <section v-show="activeContentTab === 'sidebar'" id="content-panel-sidebar" class="content-tab-panel content-column" role="tabpanel" aria-labelledby="content-tab-sidebar">
          <template v-for="key in state.sidebarOrder" :key="key">
            <SectionList
              v-if="key === 'languages'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="languages" v-model="state.languages" :schema="languagesSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <SectionList
              v-else-if="key === 'hobbies'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="hobbies" v-model="state.hobbies" :schema="hobbiesSchema" :add-label="t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <section v-else-if="getSidebarSection(key)" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(getSidebarSection(key), 'sidebar')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                  <Select v-model="getSidebarSection(key).levelType" :options="levelTypeOptions" option-label="label" option-value="value" :aria-label="t('levelType')" :title="t('levelType')" />
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <Draggable v-model="getSidebarSection(key).items" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                <template #item="{ element: item, index }">
                  <div class="item-row sidebar-skill-row" :class="{ 'item-row--hidden': item.hidden }">
                    <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" @click="toggleItemHidden(item)"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestSidebarItemDeletion(getSidebarSection(key), index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                    <div class="item-row__content sidebar-skill-row__content">
                      <label>{{ t('skillName') }}<InputText v-model="item.name" :placeholder="langRef === 'de' ? 'z. B. Python' : 'e.g. Python'" fluid /></label>
                      <label v-if="getSidebarSection(key).levelType">{{ t('levelValue') }}<InputNumber v-model="item.levelValue" :min="getSidebarSection(key).levelType === 'experience' ? 1 : 0" :max="getSidebarSection(key).levelType === 'experience' ? 10 : 99" :use-grouping="false" fluid /></label>
                    </div>
                  </div>
                </template>
              </Draggable>
              <button type="button" class="add-item-row" @click="addSidebarItem(getSidebarSection(key))"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
            </section>
          </template>
          <button type="button" class="add-section-row" @click="addSidebarSection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
      </section>
    </section>
  </form>
</template>

<style scoped>
.content-column { display: grid; gap: 0; min-width: 0; }
.content-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.content-tab { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-weight: 600; }
.content-tab:hover, .content-tab:focus-visible { background: rgba(16, 185, 129, .1); color: #d1fae5; }
.content-tab.active { border-bottom-color: #27f3a2; color: #9be8c7; }
.content-tab:focus-visible { outline: 2px solid #9be8c7; outline-offset: -3px; }
.content-tab__complete { color: #86efac; }
.content-tab-panel { min-width: 0; }
.add-section-row { width: 100%; min-height: 54px; padding: 8px; border: 0; border-top: 1px dashed #2a6a60; border-bottom: 1px dashed #2a6a60; }
.about-editor { display: grid; gap: 4px; }
.sidebar-skill-row__content { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: end; }
.custom-body-entry__fields { display: grid; grid-template-columns: repeat(var(--custom-body-field-count), minmax(0, 1fr)); gap: 8px; }
.reorder-dialog-backdrop { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 20px; background: rgba(0, 0, 0, .7); backdrop-filter: blur(3px); }
.reorder-dialog { width: min(760px, 100%); max-height: min(80vh, 720px); overflow: auto; padding: 20px; border: 1px solid #10b981; border-radius: 12px; background: #0c131a; box-shadow: 0 24px 80px rgba(0, 0, 0, .5); }
.reorder-dialog__header { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid #134e4a; }
.reorder-dialog__header h3 { margin: 0 0 12px; }
.reorder-dialog__columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.reorder-dialog__column { min-height: 80px; padding: 12px; border: 1px solid #134e4a; border-radius: 8px; }
.reorder-dialog__column h4 { margin: 0 0 10px; color: #9be8c7; }
.reorder-dialog__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, .1); border-radius: 6px; background: rgba(255, 255, 255, .04); cursor: grab; }
.reorder-dialog__row:active { cursor: grabbing; }
.reorder-dialog__row span { display: flex; align-items: center; gap: 8px; min-width: 0; }
.popup-drag-icon { color: var(--muted); pointer-events: none; }
.field-config-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; background: rgba(0, 0, 0, .7); backdrop-filter: blur(3px); }
.field-config-dialog { width: min(420px, 100%); padding: 20px; border: 1px solid #10b981; border-radius: 12px; background: #0c131a; box-shadow: 0 24px 80px rgba(0, 0, 0, .5); }
.field-config-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #134e4a; }
.field-config-dialog__header h3 { margin: 0 0 12px; }
.field-config-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; }
.field-config-option { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; color: #d1fae5; cursor: pointer; white-space: nowrap; }
.field-config-option input { accent-color: #10b981; }
@media (max-width: 840px) { .reorder-dialog__columns { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .sidebar-skill-row__content, .custom-body-entry__fields { grid-template-columns: 1fr; } }
</style>
