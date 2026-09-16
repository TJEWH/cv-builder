<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Draggable from 'vuedraggable';
import SectionList from './SectionList.vue';
import MarkdownTextarea from './MarkdownTextarea.vue';
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
const collapsed = reactive({
  header: true,
  about: true,
  education: true,
  jobs: true,
  languages: true,
  hobbies: true,
});
const customCollapsed = reactive({});
const editingSection = reactive({ id: null, value: '' });

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
const toggleComplete = (key) => {
  const index = props.state.completedSections.indexOf(key);
  if (index === -1) props.state.completedSections.push(key);
  else props.state.completedSections.splice(index, 1);
  props.onSave?.();
};
const groupHiddenSections = (orderName) => {
  const order = props.state[orderName] || [];
  props.state[orderName] = [
    ...order.filter((key) => !isHidden(key)),
    ...order.filter((key) => isHidden(key)),
  ];
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
const allContentCollapsed = computed(() => [
  ...Object.entries(collapsed).filter(([key]) => key !== 'header'),
  ...(props.state.customSections || []).map((section) => [section.id, customCollapsed[section.id]]),
  ...(props.state.sidebarSections || []).map((section) => [section.id, customCollapsed[section.id]]),
].every(([, value]) => value));

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
  else customCollapsed[key] = !customCollapsed[key];
};
const toggleAllContent = () => {
  const next = !allContentCollapsed.value;
  Object.keys(collapsed).filter((key) => key !== 'header').forEach((key) => { collapsed[key] = next; });
  [...props.state.customSections, ...props.state.sidebarSections].forEach((section) => { customCollapsed[section.id] = next; });
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
    fields: ['title', 'institution', 'place', 'start', 'end', 'desc'],
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
  delete customCollapsed[section.id];
  props.onSave?.();
};
const addBodyEntry = (section) => section.entries.push({ id: createContentId('entry'), hidden: false, title: '', place: '', start: '', end: '', desc: '' });
const removeBodyEntry = (section, index) => section.entries.splice(index, 1);
const addSidebarItem = (section) => section.items.push({ id: createContentId('skill'), hidden: false, name: '', levelValue: 0 });
const removeSidebarItem = (section, index) => section.items.splice(index, 1);
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
      <div class="section-head editor-panel__header">
        <font-awesome-icon :icon="['fas', 'list']" class="section-icon" aria-hidden="true" />
        <h3>{{ t('content') }}</h3>
        <button class="mini panel-bulk-toggle" type="button" @click="toggleAllContent">
          <font-awesome-icon :icon="['fas', allContentCollapsed ? 'angles-down' : 'angles-up']" />
          {{ allContentCollapsed ? t('expandAll') : t('collapseAll') }}
        </button>
      </div>

      <section class="section-group" data-section="header" :class="{ completed: isComplete('header'), collapsed: collapsed.header }">
        <div class="section-head" @click="onHeaderClick('header', $event)">
          <h3>{{ t('headerTitle') }}</h3>
          <div class="section-head__actions"><label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete('header')" :aria-label="t('markComplete')" @change="toggleComplete('header')" /></label></div>
        </div>
        <div class="grid-2"><label>{{ t('name') }}<InputText v-model="state.contact.name" placeholder="Alex Muster" fluid /></label><label>{{ t('location') }}<InputText v-model="state.contact.location" placeholder="Neustadt" fluid /></label></div>
        <div class="grid-2"><label>{{ t('role') }}<InputText v-model="state.contact.role" placeholder="Software Engineer" fluid /></label><span /></div>
        <div class="grid-2"><label>{{ t('email') }}<InputText v-model="state.contact.email" type="email" placeholder="muster-ex@mp.le" fluid /></label><label>{{ t('phone') }}<InputText v-model="state.contact.phone" type="tel" placeholder="+49 123 456789" fluid /></label></div>
        <div class="grid-3"><label>{{ t('website') }}<InputText v-model="state.contact.website" type="url" placeholder="https://alexmuster.dev" fluid /></label><label>{{ t('linkedin') }}<InputText v-model="state.contact.linkedin" type="url" placeholder="https://linkedin.com/in/alexmuster" fluid /></label><label>{{ t('github') }}<InputText v-model="state.contact.github" type="url" placeholder="https://github.com/alexmuster" fluid /></label></div>
      </section>

      <div class="content-columns">
        <section class="content-column">
          <h3 class="content-column__title">{{ t('body') }}<span class="content-column__actions"><button class="mini" type="button" :aria-label="t('reorder')" :title="t('reorder')" @click="reorderDialogOpen = true"><font-awesome-icon :icon="['fas', 'grip-vertical']" /> {{ t('reorder') }}</button><button class="mini" type="button" :aria-label="t('groupHidden')" :title="t('groupHidden')" @click="groupHiddenSections('bodyOrder')"><font-awesome-icon :icon="['fas', 'eye-slash']" /> {{ t('groupHidden') }}</button></span></h3>
          <template v-for="key in state.bodyOrder" :key="key">
            <section v-if="key === 'about'" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" :placeholder="getDefaultName(key)" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <label class="about-editor">{{ t('aboutTextLabel') }}<MarkdownTextarea v-model="state.about.text" placeholder="Me in a nutshell..." :help="t('markdownTextareaHelp')" :rows="4" /></label>
            </section>

            <SectionList
              v-else-if="key === 'education'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="education" v-model="state.education" :schema="educationSchema" :add-label="t('add')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <SectionList
              v-else-if="key === 'jobs'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="jobs" v-model="state.experience.jobs" :schema="jobsSchema" :add-label="t('add')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <section v-else-if="getBodySection(key)" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <button class="mini" type="button" @click.stop="openFieldConfig(getBodySection(key))">{{ t('fields') }}</button>
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <Draggable v-model="getBodySection(key).entries" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                <template #item="{ element: entry, index }">
                  <div class="item-row" :class="{ 'item-row--hidden': entry.hidden }">
                    <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="entry.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="entry.hidden ? t('show') : t('hide')" :title="entry.hidden ? t('show') : t('hide')" @click="toggleItemHidden(entry)"><font-awesome-icon :icon="['fas', entry.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="removeBodyEntry(getBodySection(key), index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                    <div class="item-row__content">
                      <div v-if="enabledCustomBodyTextFields(getBodySection(key)).length" class="custom-body-entry__fields" :style="{ '--custom-body-field-count': enabledCustomBodyTextFields(getBodySection(key)).length }">
                        <label v-for="field in enabledCustomBodyTextFields(getBodySection(key))" :key="field.key">{{ field.label }}<InputText v-model="entry[field.key]" :placeholder="field.placeholder" fluid /></label>
                      </div>
                      <label v-if="isCustomBodyFieldEnabled(getBodySection(key), 'desc')">{{ t('desc') }}<MarkdownTextarea v-model="entry.desc" :placeholder="customBodyFieldOptions.find((field) => field.key === 'desc').placeholder" :help="t('markdownTextareaHelp')" /></label>
                    </div>
                  </div>
                </template>
              </Draggable>
              <div class="custom-section__footer">
                <button type="button" class="add-button mini btn--success" @click="addBodyEntry(getBodySection(key))">{{ t('add') }}</button>
                <button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="deleteCustomSection(getBodySection(key), 'body')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
              </div>
            </section>
          </template>
          <div class="add-button-wrapper"><button type="button" class="btn btn--success" @click="addBodySection">{{ t('newSection') }}</button></div>
        </section>

        <section class="content-column">
          <h3 class="content-column__title">{{ t('sidebar') }}<span class="content-column__actions"><button class="mini" type="button" :aria-label="t('reorder')" :title="t('reorder')" @click="reorderDialogOpen = true"><font-awesome-icon :icon="['fas', 'grip-vertical']" /> {{ t('reorder') }}</button><button class="mini" type="button" :aria-label="t('groupHidden')" :title="t('groupHidden')" @click="groupHiddenSections('sidebarOrder')"><font-awesome-icon :icon="['fas', 'eye-slash']" /> {{ t('groupHidden') }}</button></span></h3>
          <template v-for="key in state.sidebarOrder" :key="key">
            <SectionList
              v-if="key === 'languages'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="languages" v-model="state.languages" :schema="languagesSchema" :add-label="t('add')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <SectionList
              v-else-if="key === 'hobbies'"
              class="content-section"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="hobbies" v-model="state.hobbies" :schema="hobbiesSchema" :add-label="t('add')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] || 'h2'" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            />
            <section v-else-if="getSidebarSection(key)" class="section-group content-section" :class="{ disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key) }">
              <div class="section-head" @click="onHeaderClick(key, $event)">
                <button class="mini visibility-toggle" :class="isHidden(key) ? 'btn--success' : 'btn--danger'" type="button" @click.stop="toggleDisabled(key)"><font-awesome-icon :icon="['fas', isHidden(key) ? 'eye-slash' : 'eye']" /></button>
                <h3 v-if="editingSection.id !== key" class="section-name-label" @click.stop="startEditSectionName(key)">{{ getSectionDisplayName(key) }}</h3>
                <InputText v-else v-model="editingSection.value" class="section-name-input" @click.stop @blur="finishEditSectionName(key)" @keyup.enter="finishEditSectionName(key)" @keyup.esc="cancelEditSectionName" />
                <div class="section-head__actions">
                  <Select v-model="getSidebarSection(key).levelType" :options="levelTypeOptions" option-label="label" option-value="value" :aria-label="t('levelType')" :title="t('levelType')" />
                  <Select v-model="state.sectionHeaderSizes[key]" :options="headerSizeOptions" option-label="label" option-value="value" class="header-size-select" />
                  <label class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete(key)" :aria-label="t('markComplete')" @change="toggleComplete(key)" /></label>
                </div>
              </div>
              <Draggable v-model="getSidebarSection(key).items" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost">
                <template #item="{ element: item, index }">
                  <div class="item-row sidebar-skill-row" :class="{ 'item-row--hidden': item.hidden }">
                    <div class="item-row__actions"><button class="mini entry-drag-handle" type="button"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button><button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" @click="toggleItemHidden(item)"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button><button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="removeSidebarItem(getSidebarSection(key), index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                    <div class="item-row__content sidebar-skill-row__content">
                      <label>{{ t('skillName') }}<InputText v-model="item.name" :placeholder="langRef === 'de' ? 'z. B. Python' : 'e.g. Python'" fluid /></label>
                      <label v-if="getSidebarSection(key).levelType">{{ t('levelValue') }}<InputNumber v-model="item.levelValue" :min="getSidebarSection(key).levelType === 'experience' ? 1 : 0" :max="getSidebarSection(key).levelType === 'experience' ? 10 : 99" :use-grouping="false" fluid /></label>
                    </div>
                  </div>
                </template>
              </Draggable>
              <div class="custom-section__footer">
                <button type="button" class="add-button mini btn--success" @click="addSidebarItem(getSidebarSection(key))">{{ t('addSkill') }}</button>
                <button class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="deleteCustomSection(getSidebarSection(key), 'sidebar')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
              </div>
            </section>
          </template>
          <div class="add-button-wrapper"><button type="button" class="btn btn--success" @click="addSidebarSection">{{ t('newSidebarSection') }}</button></div>
        </section>
      </div>
    </section>
  </form>
</template>

<style scoped>
.content-columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.content-column { display: grid; gap: 0; min-width: 0; }
.content-column__title { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; color: #9be8c7; border-bottom: 1px solid #134e4a; }
.content-column__actions { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.section-head__actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.item-row__actions { display: flex; flex-direction: column; align-items: center; gap: 6px; align-self: center; }
.section-name-label { color: #9be8c7; padding: 4px 8px; font-size: 1rem; font-weight: 600; margin: 0; cursor: pointer; user-select: none; border-radius: 4px; border: 1px solid transparent; }
.section-name-label:hover { background: rgba(16, 185, 129, .1); border-color: #134e4a; }
.section-name-input { min-width: 200px; width: 30%; }
.entry-drag-handle { cursor: grab; }
.entry-drag-handle:active { cursor: grabbing; }
.sortable-ghost { opacity: .4; }
.sidebar-section-settings { padding: 0 12px; }
.sidebar-section-settings label { display: grid; gap: 4px; max-width: 220px; }
.section-group.collapsed .sidebar-section-settings { display: none; }
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
