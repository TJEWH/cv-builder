<script setup>
import { computed, ref } from 'vue';
import Draggable from 'vuedraggable';
import { makeT } from '../i18n/dict.js';
import { createContentId } from '../composables/contentLayout.js';
import MarkdownTextarea from './MarkdownTextarea.vue';
import ConfirmDeletionDialog from './ConfirmDeletionDialog.vue';

const props = defineProps({
  title: String,
  sectionKey: String,
  lang: { type: String, default: 'de' },
  modelValue: { type: Array, required: true },
  schema: { type: Array, required: true },
  addLabel: { type: String, default: 'Hinzufügen' },
  toggleable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  completed: { type: Boolean, default: false },
  showKeepTogether: { type: Boolean, default: false },
  keepTogether: { type: Boolean, default: false },
  isCollapsed: { type: Boolean, default: false },
  editableTitle: { type: Boolean, default: false },
  isEditingTitle: { type: Boolean, default: false },
  editingTitleValue: { type: String, default: '' },
  titlePlaceholder: { type: String, default: '' },
  headerSize: { type: String, default: 'h2' },
});

const emit = defineEmits([
  'update:modelValue', 'toggle-section', 'toggle-complete', 'toggle-collapse',
  'toggle-keep-together',
  'start-edit-title', 'finish-edit-title', 'cancel-edit-title', 'update-editing-value', 'header-size-change',
]);

const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);
const root = ref(null);
const pendingDeleteIndex = ref(null);
const items = computed({
  get: () => Array.isArray(props.modelValue) ? props.modelValue : [],
  set: (value) => emit('update:modelValue', value),
});
const headerSizeOptions = computed(() => [
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: langRef.value === 'de' ? 'Kein Titel' : 'No Title', value: 'null' },
]);

const isHeaderControl = (target) => target?.closest?.('button, input, select, textarea, a, [contenteditable="true"], .p-select');
const onHeaderClick = (event) => {
  if (!isHeaderControl(event.target)) emit('toggle-collapse');
};

const add = () => {
  const entry = { id: createContentId(props.sectionKey || 'entry'), hidden: false };
  props.schema.forEach((field) => {
    if (field.type === 'number') entry[field.key] = 0;
    else if (field.type === 'select' && field.options?.length) entry[field.key] = field.options[0];
    else entry[field.key] = '';
  });
  items.value = [...items.value, entry];
  requestAnimationFrame(() => root.value?.querySelector('.item-row:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
};

const removeAt = (index) => {
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index);
};
const requestRemoveAt = (index) => { pendingDeleteIndex.value = index; };
const confirmRemoveAt = () => {
  if (pendingDeleteIndex.value !== null) removeAt(pendingDeleteIndex.value);
  pendingDeleteIndex.value = null;
};

</script>

<template>
  <section ref="root" class="section-group" :data-section="sectionKey" :class="{ disabled, completed, collapsed: isCollapsed }">
    <ConfirmDeletionDialog
      :visible="pendingDeleteIndex !== null"
      :title="t('confirmDeletion')"
      :message="t('confirmDeleteItem')"
      :cancel-label="t('cancel')"
      :confirm-label="t('delete')"
      @cancel="pendingDeleteIndex = null"
      @confirm="confirmRemoveAt"
    />
    <div class="section-head" @click="onHeaderClick">
      <button
        v-if="toggleable"
        class="mini visibility-toggle"
        :class="[disabled ? 'btn--success' : 'btn--danger']"
        type="button"
        :aria-label="disabled ? t('show') : t('hide')"
        :title="disabled ? t('show') : t('hide')"
        @click.stop="emit('toggle-section')"
      >
        <font-awesome-icon :icon="['fas', disabled ? 'eye-slash' : 'eye']" />
      </button>

      <template v-if="editableTitle">
        <h3 v-if="!isEditingTitle" class="section-name-label" @click.stop="emit('start-edit-title')">
          {{ title }}
        </h3>
        <InputText
          v-else
          :model-value="editingTitleValue"
          class="section-name-input"
          :placeholder="titlePlaceholder"
          @update:model-value="emit('update-editing-value', $event)"
          @click.stop
          @blur="emit('finish-edit-title')"
          @keyup.enter="emit('finish-edit-title')"
          @keyup.esc="emit('cancel-edit-title')"
        />
      </template>
      <h3 v-else>{{ title }}</h3>

      <div class="section-head__actions">
        <button v-if="showKeepTogether" class="section-header-control section-break-toggle" :class="{ 'section-break-toggle--active': keepTogether }" type="button" :aria-pressed="keepTogether" :aria-label="keepTogether ? t('allowPageBreaks') : t('preventPageBreaks')" :title="keepTogether ? t('allowPageBreaks') : t('preventPageBreaks')" @click.stop="emit('toggle-keep-together')"><font-awesome-icon :icon="['fas', keepTogether ? 'lock' : 'lock-open']" /></button>
        <Select
          :model-value="headerSize"
          :options="headerSizeOptions"
          option-label="label"
          option-value="value"
          class="header-size-select"
          @update:model-value="emit('header-size-change', $event)"
        />
        <label class="section-complete-toggle" :title="t('markComplete')" @click.stop>
          <input type="checkbox" :checked="completed" :aria-label="t('markComplete')" @change="emit('toggle-complete')" />
        </label>
      </div>
    </div>

    <Draggable v-model="items" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost" chosen-class="sortable-chosen">
      <template #item="{ element: item, index }">
        <div class="item-row" :class="{ 'item-row--hidden': item.hidden }">
          <div class="item-row__actions">
            <button class="mini entry-drag-handle" type="button" :aria-label="langRef === 'de' ? 'Eintrag verschieben' : 'Move entry'" :title="langRef === 'de' ? 'Eintrag verschieben' : 'Move entry'"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button>
            <button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" @click="item.hidden = !item.hidden"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button>
            <button type="button" class="mini btn--danger" :aria-label="t('remove')" :title="t('remove')" @click="requestRemoveAt(index)"><font-awesome-icon :icon="['fas', 'trash']" /></button>
          </div>
          <div class="item-row__content">
            <div v-if="schema.some((field) => field.type !== 'textarea')" :class="['row', schema.length === 2 ? 'row-2' : '', schema.length === 3 ? 'row-3' : '', schema.length === 4 ? 'row-4' : '']">
              <label v-for="field in schema.filter((entry) => entry.type !== 'textarea')" :key="field.key">
                {{ field.label }}
                <InputText v-if="field.type === 'text'" v-model="item[field.key]" :placeholder="field.placeholder || ''" fluid />
                <InputNumber v-else-if="field.type === 'number'" v-model="item[field.key]" :placeholder="field.placeholder || ''" :use-grouping="false" fluid />
                <Select v-else-if="field.type === 'select'" v-model="item[field.key]" :options="field.options" fluid />
              </label>
            </div>
            <label v-for="field in schema.filter((entry) => entry.type === 'textarea')" :key="field.key">
              {{ field.label }}
              <MarkdownTextarea v-model="item[field.key]" :placeholder="field.placeholder || ''" :aria-label="field.label" :help="t('markdownTextareaHelp')" />
            </label>
          </div>
        </div>
      </template>
    </Draggable>
    <button v-if="addLabel" type="button" class="add-item-row" @click="add"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ addLabel }}</button>
  </section>
</template>

<style scoped>
.section-head__actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.section-header-control { display: inline-flex; align-items: center; justify-content: center; min-width: 38px; min-height: 38px; padding: 8px; border: 1px solid #0b3740; border-radius: 8px; background: #06141f; color: #e2ffe9; cursor: pointer; font: inherit; }
.section-header-control:hover { border-color: #10b981; background: #0a1c26; }
.section-break-toggle--active { border-color: #10b981; background: rgba(16, 185, 129, .16); color: #86efac; }
.section-complete-toggle { display: inline-flex; align-items: center; cursor: pointer; }
.section-complete-toggle input { width: 16px; height: 16px; accent-color: #86efac; cursor: pointer; }
.item-row__actions { display: flex; flex-direction: column; align-items: center; gap: 6px; align-self: center; }
.entry-drag-handle { cursor: grab; }
.entry-drag-handle:active { cursor: grabbing; }
.sortable-ghost { opacity: .4; }
.sortable-chosen { outline: 1px solid #10b981; }
.section-name-label { color: #9be8c7; padding: 4px 8px; font-size: 1rem; font-weight: 600; margin: 0; cursor: pointer; border-radius: 4px; border: 1px solid transparent; }
.section-name-label:hover { background: rgba(16, 185, 129, .1); border-color: #134e4a; }
.section-name-input { width: 30%; min-width: 200px; }
.add-item-row { display: flex; align-items: center; justify-content: center; gap: 8px; width: calc(100% - 32px); min-height: 42px; margin-top: 8px; padding: 10px 12px; border: 1px dashed #2a6a60; border-radius: 6px; background: transparent; color: #9be8c7; cursor: pointer; font: inherit; }
.add-item-row:hover, .add-item-row:focus-visible { border-color: #27f3a2; background: rgba(16, 185, 129, .1); }
.add-item-row:focus-visible { outline: 2px solid #9be8c7; outline-offset: -3px; }
</style>
