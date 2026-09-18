<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvItem, ItemField } from '../types';
import { computed, ref } from 'vue';
import Draggable from 'vuedraggable';
import { makeT } from '../i18n/dict.ts';
import { createContentId } from '../composables/contentLayout.ts';
import MarkdownTextarea from './MarkdownTextarea.vue';
import ConfirmDeletionDialog from './ConfirmDeletionDialog.vue';

const props = defineProps({
  title: String,
  sectionKey: String,
  lang: { type: String, default: 'de' },
  modelValue: { type: Array as PropType<CvItem[]>, required: true },
  schema: { type: Array as PropType<ItemField[]>, required: true },
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
  versionMode: { type: Boolean, default: false },
});

const emit = defineEmits([
  'update:modelValue', 'toggle-section', 'toggle-complete', 'toggle-collapse',
  'toggle-keep-together',
  'start-edit-title', 'finish-edit-title', 'cancel-edit-title', 'update-editing-value', 'header-size-change',
]);

const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);
const root = ref<HTMLElement | null>(null);
const pendingDeleteIndex = ref<number | null>(null);
const items = computed({
  get: () => Array.isArray(props.modelValue) ? props.modelValue : [],
  set: (value) => emit('update:modelValue', value),
});
const inlineFields = computed(() => props.schema.filter((field) => field.type !== 'textarea'));
const textareaFields = computed(() => props.schema.filter((field) => field.type === 'textarea'));
const headerSizeOptions = computed(() => [
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: langRef.value === 'de' ? 'Kein Titel' : 'No Title', value: 'null' },
]);

const isHeaderControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, input, select, textarea, a, [contenteditable="true"], .p-select');
const onHeaderClick = (event: MouseEvent) => {
  if (!isHeaderControl(event.target)) emit('toggle-collapse');
};

const add = () => {
  const entry: CvItem = { id: createContentId(props.sectionKey || 'entry'), hidden: false };
  props.schema.forEach((field) => {
    if (field.type === 'number') Reflect.set(entry, field.key, 0);
    else if (field.type === 'select' && field.options?.length) {
      const defaultOption = field.options[0];
      Reflect.set(entry, field.key, field.optionValue && typeof defaultOption === 'object' ? defaultOption[field.optionValue] : defaultOption);
    }
    else Reflect.set(entry, field.key, '');
  });
  items.value = [...items.value, entry];
  requestAnimationFrame(() => root.value?.querySelector('.item-row:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
};

const removeAt = (index: number) => {
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index);
};
const requestRemoveAt = (index: number) => { pendingDeleteIndex.value = index; };
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

      <template v-if="editableTitle && !versionMode">
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
      <h3 v-else :class="{ 'section-name-label': versionMode, 'section-name-label--static': versionMode }">{{ title }}</h3>

      <slot v-if="versionMode" name="section-version" />
      <div v-else class="section-head__actions">
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

    <div class="section-content">
      <div class="section-content__inner">
        <Draggable v-model="items" item-key="id" handle=".entry-drag-handle" :animation="150" class="items" ghost-class="sortable-ghost" chosen-class="sortable-chosen">
          <template #item="{ element: item, index }">
            <div class="item-row" :class="{ 'item-row--hidden': item.hidden }">
              <div class="item-row__actions">
                <button class="mini entry-drag-handle" type="button" :aria-label="langRef === 'de' ? 'Eintrag verschieben' : 'Move entry'" :title="langRef === 'de' ? 'Eintrag verschieben' : 'Move entry'"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></button>
                <button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" @click="item.hidden = !item.hidden"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button>
                <button type="button" class="mini btn--danger" :aria-label="t('remove')" :title="t('remove')" @click="requestRemoveAt(index)"><font-awesome-icon :icon="['fas', 'trash']" /></button>
              </div>
              <div class="item-row__content">
                <div v-if="inlineFields.length" :class="['row', schema.length === 2 ? 'row-2' : '', schema.length === 3 ? 'row-3' : '', schema.length === 4 ? 'row-4' : '']">
                  <label v-for="field in inlineFields" :key="field.key">
                    {{ field.label }}
                    <InputText v-if="field.type === 'text'" v-model="item[field.key]" :placeholder="field.placeholder || ''" fluid />
                    <InputNumber v-else-if="field.type === 'number'" v-model="item[field.key]" :placeholder="field.placeholder || ''" :use-grouping="false" fluid />
                    <Select v-else-if="field.type === 'select'" v-model="item[field.key]" :options="field.options" :option-label="field.optionLabel" :option-value="field.optionValue" fluid />
                  </label>
                </div>
                <label v-for="field in textareaFields" :key="field.key">
                  {{ field.label }}
                  <MarkdownTextarea v-model="item[field.key]" :placeholder="field.placeholder || ''" :aria-label="field.label" :help="t('markdownTextareaHelp')" />
                </label>
              </div>
            </div>
          </template>
        </Draggable>
        <button v-if="addLabel" type="button" class="add-item-row" @click="add"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ addLabel }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sortable-chosen { outline: 1px solid #10b981; }
</style>
