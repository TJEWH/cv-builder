<script setup>
import { computed, ref } from 'vue';
import { makeT } from '../i18n/dict.js';
import sectionIcons from '../i18n/sectionIcons.js';

const props = defineProps({
  title: String,
  sectionKey: String,
  lang: { type: String, default: 'de' },
  modelValue: { type: Array, required: true },
  schema: { type: Array, required: true }, // [{label,key,type,placeholder,options?}]
  addLabel: { type: String, default: 'Hinzufügen' },
  toggleable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  draggable: { type: Boolean, default: false },
  isDragging: { type: Boolean, default: false },
  // Props für editierbare Namen
  editableTitle: { type: Boolean, default: false },
  isEditingTitle: { type: Boolean, default: false },
  editingTitleValue: { type: String, default: '' },
  titlePlaceholder: { type: String, default: '' },
  headerSize: { type: String, default: 'h2' }
});

const langRef = computed({
  get: () => props.lang || 'de'
})
const t = makeT(langRef);

// declare emits so Vue doesn't warn when we $emit('toggle-section')
const emit = defineEmits(['update:modelValue','toggle-section','dragstart','dragend','start-edit-title','finish-edit-title','cancel-edit-title','update-editing-value','header-size-change']);

const items = defineModel({ default: [] });

const root = ref(null);
const toggleCollapse = () => { root.value?.classList.toggle('collapsed'); };

const add = () => {
  const o = {};
  props.schema.forEach(f => {
    if (f.type === 'number') {
      o[f.key] = 0;
    } else if (f.type === 'select' && f.options && f.options.length > 0) {
      o[f.key] = f.options[0];
    } else {
      o[f.key] = '';
    }
  });
  items.value.push(o);

  requestAnimationFrame(()=>{
    const el = root.value?.querySelector('.item-row:last-of-type');
    el?.scrollIntoView({ behavior:'smooth', block:'center' });
  });
};
const removeAt = (i) => items.value.splice(i,1);

// compute icon name for this section (fallback to 'folder-open')
const iconName = computed(()=> sectionIcons[props.sectionKey] || 'folder-open');

// Track if drag should be prevented based on mousedown target
const shouldPreventDrag = ref(false);

// Check mousedown target to determine if drag should be allowed
const onMouseDown = (event) => {
  const target = event.target;
  const tagName = target.tagName;

  // Prevent drag if mousedown is on interactive elements
  // This allows text selection in inputs/textareas and normal interaction with other controls
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON') {
    shouldPreventDrag.value = true;
    // Don't stop propagation - allow normal interaction (text selection, button clicks, etc.)
  } else {
    shouldPreventDrag.value = false;
  }
};

// Prevent drag when interacting with input/textarea
const onDragStart = (event) => {
  if (shouldPreventDrag.value) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  emit('dragstart', event);
};

// Reset shouldPreventDrag on mouseup to ensure clean state
const onMouseUp = () => {
  shouldPreventDrag.value = false;
};
</script>

<template>
  <section
    ref="root"
    class="section-group"
    :data-section="sectionKey"
    :class="{disabled, dragging: isDragging}"
    :draggable="draggable && !shouldPreventDrag"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
    @dragstart="onDragStart"
    @dragend="emit('dragend', $event)"
  >
    <div class="section-head">
      <button class="caret mini" type="button" @click="toggleCollapse">
        <font-awesome-icon v-if="iconName" :icon="['fas', iconName]" class="section-icon" aria-hidden="true" />
      </button>

      <!-- Editable Title if prop is set -->
      <template v-if="editableTitle">
        <h3
          v-if="!isEditingTitle"
          class="section-name-label"
          @click="emit('start-edit-title')"
          :title="langRef === 'de' ? 'Klicken zum Umbenennen' : 'Click to rename'"
        >
          {{ title }}
        </h3>
        <input
          v-else
          type="text"
          :value="editingTitleValue"
          @input="emit('update-editing-value', $event.target.value)"
          class="section-name-input"
          :placeholder="titlePlaceholder"
          @blur="emit('finish-edit-title')"
          @keyup.enter="emit('finish-edit-title')"
          @keyup.esc="emit('cancel-edit-title')"
        />
      </template>

      <!-- Normal Title -->
      <h3 v-else>{{ title }}</h3>

      <div style="margin-left:auto;display:flex;gap:6px">
        <select :value="headerSize" @change="emit('header-size-change', $event.target.value)" class="header-size-select">
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="null">{{ langRef === 'de' ? 'Kein Titel' : 'No Title' }}</option>
        </select>
        <slot name="controls"></slot>
        <button v-if="addLabel" type="button" class="mini btn--success" @click="add">{{ addLabel }}</button>
        <button v-if="toggleable" class="mini" :class="[disabled?'btn--success':'btn--danger']" type="button" @click="$emit('toggle-section')">
          {{ disabled ? t('show') : t('hide') }}
        </button>
      </div>
    </div>

    <div class="items">
      <div class="item-row" v-for="(item, i) in items" :key="i">
        <div v-if="schema.some(s=>s.type!=='textarea')" :class="['row', schema.length===2?'row-2':'', schema.length===3?'row-3':'', schema.length===4?'row-4':'']">
          <label v-for="f in schema.filter(s=>s.type!=='textarea')" :key="f.key">
            {{ f.label }}
            <template v-if="f.type==='text'">
              <input type="text" v-model="item[f.key]" :placeholder="f.placeholder||''"/>
            </template>
            <template v-else-if="f.type==='number'">
              <input type="number" v-model.number="item[f.key]" :placeholder="f.placeholder||''"/>
            </template>
            <template v-else-if="f.type==='select'">
              <select v-model="item[f.key]">
                <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </template>
          </label>
        </div>
        <label v-for="f in schema.filter(s=>s.type==='textarea')" :key="f.key">
          {{ f.label }}<textarea v-model="item[f.key]" :placeholder="f.placeholder||''"></textarea>
        </label>
        <div><button type="button" class="mini btn--danger" @click="removeAt(i)">{{t('remove')}}</button></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-icon {
  margin-right: 8px;
  color: var(--muted);
}

/* ensure the icon is centered inside the toggle button */
.caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 26px;
  padding: 0;
}

.caret .section-icon {
  margin: 0;
}

.section-name-label {
  color: #9be8c7;
  padding: 4px 8px;
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  user-select: none;
}

.section-name-label:hover {
  background: rgba(16, 185, 129, 0.1);
  border-color: #134e4a;
}

.section-name-input {
  background: transparent;
  border: 1px solid #134e4a;
  color: #9be8c7;
  padding: 4px 8px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 4px;
  min-width: 200px;
  transition: all 0.2s ease;
  width: 30%;
}

.section-name-input:hover {
  border-color: #10b981;
}

.section-name-input:focus {
  outline: none;
  border-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.1);
}

.header-size-select {
  padding: 4px 8px;
  border: 1px solid #134e4a;
  background: #061017;
  color: #9be8c7;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 20%;
  min-width: 100px;
}

.header-size-select:hover {
  border-color: #10b981;
}

.header-size-select:focus {
  outline: none;
  border-color: #10b981;
}
</style>
