<script setup>
import { computed, reactive, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import SectionList from './SectionList.vue';
import { makeT } from '../i18n/dict.js';
import sectionIcons from '../i18n/sectionIcons.js';

const props = defineProps({
  state: { type: Object, required: true },
  onSave: { type: Function, default: null },
  movementMode: { type: String, default: 'drag' } // 'drag' or 'buttons'
});

const langRef = computed({
  get: () => props.state.lang || 'de',
  set: v => props.state.lang = v
});
const t = makeT(langRef);

// collapsed state for sections (controls whether section-group is collapsed in the builder)
const collapsed = reactive({ header:false, about:false, soft:false });

// ensure state.disabled exists
if(!Array.isArray(props.state.disabled)) props.state.disabled = [];

const isHidden = (key) => Array.isArray(props.state.disabled) && props.state.disabled.includes(key);
const toggleDisabled = (key) => {
  if(!Array.isArray(props.state.disabled)) props.state.disabled = [];
  const idx = props.state.disabled.indexOf(key);
  if(idx === -1) props.state.disabled.push(key); else props.state.disabled.splice(idx,1);
  try{ props.onSave?.(); }catch(e){}
};

const addCustom = () => {
  if(!Array.isArray(props.state.customSections)) props.state.customSections = [];
  const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  props.state.customSections.push({
    id,
    name: langRef.value === 'de' ? 'Neue Section' : 'New Section',
    entries: []
  });
  // Add to orderMain
  ensureOrderArrays();
  props.state.orderMain.push(id);
  try { props.onSave?.(); } catch(e) {}
};

const deleteCustomSection = (id) => {
  if(!Array.isArray(props.state.customSections)) return;
  const idx = props.state.customSections.findIndex(s => s.id === id);
  if(idx !== -1) {
    props.state.customSections.splice(idx, 1);
    // Remove from order arrays
    ensureOrderArrays();
    props.state.orderMain = props.state.orderMain.filter(k => k !== id);
    props.state.orderSide = props.state.orderSide.filter(k => k !== id);
    // Remove from disabled
    if(Array.isArray(props.state.disabled)) {
      props.state.disabled = props.state.disabled.filter(k => k !== id);
    }
    try { props.onSave?.(); } catch(e) {}
  }
};

const getCustomSection = (id) => {
  if(!Array.isArray(props.state.customSections)) return null;
  return props.state.customSections.find(s => s.id === id);
};

// helper to get icon name for a section
const getIcon = (key) => {
  // Check if it's a custom section
  const customSection = getCustomSection(key);
  if(customSection) return 'folder-open';
  return sectionIcons[key] || 'folder-open';
};

/* ===== Section placement & ordering helpers ===== */
if(!props.state.sectionPlacement) props.state.sectionPlacement = {};

const previewKeyFor = (key) => {
  if(!key) return key;
  const s = String(key);
  if(s.startsWith('addExp')) return 'addExp';
  if(s.startsWith('jobs')) return 'jobs';
  if(s.startsWith('projects')) return 'projects';
  return key;
};

// Helper to ensure order arrays exist and are valid
const ensureOrderArrays = () => {
  if(!Array.isArray(props.state.orderMain)) props.state.orderMain = [];
  if(!Array.isArray(props.state.orderSide)) props.state.orderSide = [];
};

// Helper to sanitize and maintain exclusivity between arrays (skills can be in both)
const sanitizeOrderArrays = () => {
  ensureOrderArrays();
  props.state.orderMain = Array.from(new Set(props.state.orderMain.filter(Boolean)));
  props.state.orderSide = Array.from(new Set(props.state.orderSide.filter(Boolean)));
  // Ensure exclusivity except for 'skills'
  props.state.orderSide = props.state.orderSide.filter(x => x === 'skills' || !props.state.orderMain.includes(x));
  props.state.orderMain = props.state.orderMain.filter(x => x === 'skills' || !props.state.orderSide.includes(x));
};

const currentArea = (key) => {
  const pKey = previewKeyFor(key);
  if(props.state.sectionPlacement?.[pKey]) return props.state.sectionPlacement[pKey];
  // Derive from order arrays
  ensureOrderArrays();
  if(props.state.orderMain.includes(pKey)) return 'body';
  if(props.state.orderSide.includes(pKey)) return 'sidebar';
  return 'body';
};

const setArea = (key, area) => {
  const pKey = previewKeyFor(key);
  ensureOrderArrays();

  // Remove from both arrays
  props.state.orderMain = props.state.orderMain.filter(x => x !== pKey);
  props.state.orderSide = props.state.orderSide.filter(x => x !== pKey);

  // Add to target array
  if(area === 'body') {
    props.state.orderMain.push(pKey);
  } else if(area === 'sidebar') {
    props.state.orderSide.push(pKey);
  }

  sanitizeOrderArrays();
  props.state.sectionPlacement = { ...(props.state.sectionPlacement || {}), [pKey]: area };

  try { props.onSave?.(); } catch(e) { console.warn('onSave failed', e); }
};

// Generic move function to reduce duplication
const moveSection = (key, direction) => {
  const pKey = previewKeyFor(key);
  const area = currentArea(key);
  const arrName = area === 'body' ? 'orderMain' : 'orderSide';
  ensureOrderArrays();

  const arr = props.state[arrName];
  let idx = arr.indexOf(pKey);

  // Add to array if not present
  if(idx === -1) {
    arr[direction === 'up' ? 'push' : 'unshift'](pKey);
    idx = arr.indexOf(pKey);
  }

  // Swap elements if possible
  const canMove = direction === 'up' ? idx > 0 : idx < arr.length - 1;
  if(canMove) {
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    sanitizeOrderArrays();
    console.debug(`[FormBuilder] move${direction === 'up' ? 'Up' : 'Down'}`, {
      key, pKey, area, orderMain: props.state.orderMain, orderSide: props.state.orderSide
    });
    try { props.onSave?.(); } catch(e) { console.warn('onSave failed', e); }
  }
};

const moveUp = (key) => moveSection(key, 'up');
const moveDown = (key) => moveSection(key, 'down');

/* ===== Drag & Drop functionality ===== */
const dragState = reactive({
  draggedKey: null,
  draggedArea: null,
  dropTargetKey: null,
  isDragging: false,
  dropZoneArea: null, // 'body' or 'sidebar' when hovering over a drop zone
  insertPosition: null // index where item would be inserted
});

const onDragStart = (key, event) => {
  const pKey = previewKeyFor(key);
  dragState.draggedKey = pKey;
  dragState.draggedArea = currentArea(key);
  dragState.isDragging = true;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', pKey);
  // Add slight delay to allow CSS to apply
  setTimeout(() => {
    event.target.classList.add('dragging');
  }, 0);
};

const onDragEnd = (event) => {
  event.target.classList.remove('dragging');
  dragState.draggedKey = null;
  dragState.draggedArea = null;
  dragState.isDragging = false;
  dragState.dropZoneArea = null;
  dragState.insertPosition = null;
};

const onDropZoneOver = (area, position, event) => {
  if(!dragState.draggedKey) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  dragState.dropZoneArea = area;
  dragState.insertPosition = position;
};

const onDropZoneDrop = (area, position, event) => {
  event.preventDefault();
  event.stopPropagation();

  const draggedKey = dragState.draggedKey;
  if(!draggedKey) return;

  ensureOrderArrays();
  const sourceArea = dragState.draggedArea;
  const sourceArrName = sourceArea === 'body' ? 'orderMain' : 'orderSide';
  const targetArrName = area === 'body' ? 'orderMain' : 'orderSide';

  // Remove from source array
  props.state[sourceArrName] = props.state[sourceArrName].filter(x => x !== draggedKey);

  // Insert at target position
  const targetArr = props.state[targetArrName];
  targetArr.splice(position, 0, draggedKey);

  sanitizeOrderArrays();

  // Update sectionPlacement
  props.state.sectionPlacement = { ...(props.state.sectionPlacement || {}), [draggedKey]: area };

  console.debug('[FormBuilder] drag&drop to overlay', {
    draggedKey, area, position,
    orderMain: props.state.orderMain, orderSide: props.state.orderSide
  });
  try { props.onSave?.(); } catch(e) { console.warn('onSave failed', e); }

  // Close overlay after successful drop
  closeDragOverlay();
};

// Manual close function for overlay
const closeDragOverlay = () => {
  dragState.draggedKey = null;
  dragState.draggedArea = null;
  dragState.isDragging = false;
  dragState.dropZoneArea = null;
  dragState.insertPosition = null;
};

// ESC key handler
const handleEscKey = (event) => {
  if (event.key === 'Escape' && dragState.isDragging) {
    closeDragOverlay();
  }
};

// Register/unregister ESC key handler
onMounted(() => {
  document.addEventListener('keydown', handleEscKey);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscKey);
});

const isDragging = (key) => {
  const pKey = previewKeyFor(key);
  return dragState.draggedKey === pKey;
};

// State for editing section names (both custom and standard)
const editingSection = reactive({
  id: null,
  tempName: ''
});

// Ensure sectionNames object exists
if(!props.state.sectionNames) props.state.sectionNames = {};

// Get display name for any section (custom or standard)
const getSectionDisplayName = (key) => {
  // Check if there's a custom name set
  if(props.state.sectionNames?.[key]) { return props.state.sectionNames[key]; }

  // For custom sections, use their name property
  const customSection = getCustomSection(key);
  if(customSection) return customSection.name;

  // Otherwise use default translated name
  const names = {
    about: t('aboutTitle'),
    education: t('educationTitle'),
    jobs: t('expJobTitle'),
    addExp: t('expPersonalTitle'),
    projects: t('projectsTitle'),
    skills: t('skillsTitle'),
    languages: t('languagesTitle'),
    hobbies: t('hobbiesTitle'),
    certs: t('certsTitle')
  };
  return names[key] || key;
};

// Get default (original) name for a section
const getSectionDefaultName = (key) => {
  const customSection = getCustomSection(key);
  if(customSection) return langRef.value === 'de' ? 'Neue Section' : 'New Section';

  const names = {
    about: t('aboutTitle'),
    education: t('educationTitle'),
    jobs: t('expJobTitle'),
    addExp: t('expPersonalTitle'),
    projects: t('projectsTitle'),
    skills: t('skillsTitle'),
    languages: t('languagesTitle'),
    hobbies: t('hobbiesTitle'),
    certs: t('certsTitle')
  };
  return names[key] || key;
};

const startEditSectionName = (sectionKeyOrSection, isCustom = false) => {
  console.log('🎬 [FormBuilder] Starting edit:', isCustom ? 'CUSTOM' : 'STANDARD', sectionKeyOrSection);
  if(isCustom) {
    // Custom section with section object
    editingSection.id = sectionKeyOrSection.id;
    editingSection.tempName = sectionKeyOrSection.name;
    console.log('   Custom section ID:', editingSection.id);
    console.log('   Initial tempName:', editingSection.tempName);
  } else {
    // Standard section with key
    editingSection.id = sectionKeyOrSection;
    editingSection.tempName = props.state.sectionNames?.[sectionKeyOrSection] || '';
    console.log('   Section key:', editingSection.id);
    console.log('   Current custom name:', props.state.sectionNames?.[sectionKeyOrSection]);
    console.log('   Initial tempName:', editingSection.tempName);
  }
};

const finishEditSectionName = (sectionKeyOrSection, isCustom = false) => {
  if(isCustom) {
    // Custom section
    if(editingSection.id === sectionKeyOrSection.id) {
      if(editingSection.tempName.trim() && editingSection.tempName !== sectionKeyOrSection.name) {
        sectionKeyOrSection.name = editingSection.tempName.trim();
        try { props.onSave?.(); } catch(e) {}
      }
      editingSection.id = null;
      editingSection.tempName = '';
    }
  } else {
    // Standard section
    if(editingSection.id === sectionKeyOrSection) {
      const trimmed = editingSection.tempName.trim();
      const defaultName = getSectionDefaultName(sectionKeyOrSection);

      console.log('🔧 [FormBuilder] Finishing edit for:', sectionKeyOrSection);
      console.log('   New name:', trimmed);
      console.log('   Default name:', defaultName);
      console.log('   Are they different?', trimmed !== defaultName);

      if(!props.state.sectionNames) {
        console.log('   Creating sectionNames object');
        props.state.sectionNames = {};
      }

      if(trimmed && trimmed !== defaultName) {
        // Set custom name - use Vue.set equivalent for reactivity
        console.log('   ✅ Setting custom name');
        props.state.sectionNames = {
          ...props.state.sectionNames,
          [sectionKeyOrSection]: trimmed
        };
        console.log('   Updated sectionNames:', JSON.stringify(props.state.sectionNames));
        try { props.onSave?.(); } catch(e) { console.error('Save failed:', e); }
      } else if(!trimmed) {
        // Empty - remove custom name
        console.log('   🗑️ Removing custom name (empty input)');
        const { [sectionKeyOrSection]: removed, ...rest } = props.state.sectionNames;
        props.state.sectionNames = rest;
        try { props.onSave?.(); } catch(e) {}
      } else {
        console.log('   ⏭️ Skipping (same as default)');
      }
      editingSection.id = null;
      editingSection.tempName = '';
    }
  }
};

const cancelEditSectionName = () => {
  editingSection.id = null;
  editingSection.tempName = '';
};

const isEditingSection = (sectionId) => editingSection.id === sectionId;

// Watch for editing state to auto-focus input
watch(() => editingSection.id, (newId) => {
  if(newId) {
    nextTick(() => {
      const input = document.querySelector('.section-name-input');
      if(input) {
        input.focus();
        input.select();
      }
    });
  }
});

// Helper function to get editable title props for SectionList
const getEditableTitleProps = (sectionKey) => {
  return {
    editableTitle: true,
    isEditingTitle: isEditingSection(sectionKey),
    editingTitleValue: editingSection.tempName,
    titlePlaceholder: getSectionDefaultName(sectionKey)
  };
};

// Get sorted sections for an area (excluding the dragged one)
const getSortedSections = (area) => {
  ensureOrderArrays();
  const arr = area === 'body' ? props.state.orderMain : props.state.orderSide;
  return arr.filter(key => key !== dragState.draggedKey && !isHidden(key));
};

// Get display name for a section key (for drag overlay)
const getSectionName = (key) => {
  return getSectionDisplayName(key);
};

// Computed: Check if draggable based on movementMode
const isDraggableMode = computed(() => props.movementMode === 'drag');
const isButtonMode = computed(() => props.movementMode === 'buttons');

const areaModel = (key) => computed({
  get: () => currentArea(key),
  set: (v) => setArea(key, v)
});

// create stable computed refs for template binding (avoid calling areaModel('x') directly in template)
const areaAbout = areaModel('about');
const areaEducation = areaModel('education');
const areaExpJob = areaModel('jobs');
const areaExpPersonal = areaModel('addExp');
const areaProjects = areaModel('projects');
const areaSkills = areaModel('skills');
const areaLanguages = areaModel('languages');
const areaHobbies = areaModel('hobbies');
const areaCerts = areaModel('certs');
</script>

<template>
  <form class="builder builder--cli" @submit.prevent>

    <!-- Drag & Drop Overlay -->
    <div v-if="dragState.isDragging" class="drag-overlay" @click.self="closeDragOverlay">
      <div class="drag-overlay-content">
        <div class="drag-overlay-header">
          <button class="overlay-close-btn" type="button" @click="closeDragOverlay" :title="t('aboutTitle').includes('Über') ? 'Schließen (ESC)' : 'Close (ESC)'">
            <font-awesome-icon :icon="['fas', 'xmark']" />
          </button>
          <h3>{{ t('aboutTitle').includes('Über') ? 'Sektion verschieben' : 'Move Section' }}</h3>
          <p class="drag-item-name">
            <font-awesome-icon :icon="['fas', getIcon(dragState.draggedKey)]" />
            {{ getSectionName(dragState.draggedKey) }}
          </p>
        </div>

        <div class="drag-columns">
          <!-- Body Column -->
          <div class="drag-column">
            <h4>Body</h4>
            <div class="drop-zone-list">
              <!-- Drop zone at top -->
              <div
                class="drop-zone"
                :class="{ active: dragState.dropZoneArea === 'body' && dragState.insertPosition === 0 }"
                @dragover="onDropZoneOver('body', 0, $event)"
                @drop="onDropZoneDrop('body', 0, $event)"
              >
                <div class="drop-indicator">▼ {{ t('aboutTitle').includes('Über') ? 'Hier ablegen' : 'Drop here' }}</div>
              </div>

              <!-- Existing sections with drop zones -->
              <template v-for="(key, index) in getSortedSections('body')" :key="key">
                <div class="section-item">
                  <font-awesome-icon :icon="['fas', getIcon(key)]" />
                  {{ getSectionName(key) }}
                </div>
                <div
                  class="drop-zone"
                  :class="{ active: dragState.dropZoneArea === 'body' && dragState.insertPosition === index + 1 }"
                  @dragover="onDropZoneOver('body', index + 1, $event)"
                  @drop="onDropZoneDrop('body', index + 1, $event)"
                >
                  <div class="drop-indicator">▼ {{ t('aboutTitle').includes('Über') ? 'Hier ablegen' : 'Drop here' }}</div>
                </div>
              </template>
            </div>
          </div>

          <!-- Sidebar Column -->
          <div class="drag-column">
            <h4>Sidebar</h4>
            <div class="drop-zone-list">
              <!-- Drop zone at top -->
              <div
                class="drop-zone"
                :class="{ active: dragState.dropZoneArea === 'sidebar' && dragState.insertPosition === 0 }"
                @dragover="onDropZoneOver('sidebar', 0, $event)"
                @drop="onDropZoneDrop('sidebar', 0, $event)"
              >
                <div class="drop-indicator">▼ {{ t('aboutTitle').includes('Über') ? 'Hier ablegen' : 'Drop here' }}</div>
              </div>

              <!-- Existing sections with drop zones -->
              <template v-for="(key, index) in getSortedSections('sidebar')" :key="key">
                <div class="section-item">
                  <font-awesome-icon :icon="['fas', getIcon(key)]" />
                  {{ getSectionName(key) }}
                </div>
                <div
                  class="drop-zone"
                  :class="{ active: dragState.dropZoneArea === 'sidebar' && dragState.insertPosition === index + 1 }"
                  @dragover="onDropZoneOver('sidebar', index + 1, $event)"
                  @drop="onDropZoneDrop('sidebar', index + 1, $event)"
                >
                  <div class="drop-indicator">▼ {{ t('aboutTitle').includes('Über') ? 'Hier ablegen' : 'Drop here' }}</div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="body">
      <!-- Header -->
      <section class="section-group" data-section="header" :class="{collapsed:collapsed.header}">
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.header=!collapsed.header">
            <font-awesome-icon :icon="['fas', getIcon('header')]" class="section-icon" aria-hidden="true" />
          </button>
          <h3>{{ t('headerTitle') }}</h3>
        </div>
        <div class="grid-2">
          <label>{{ t('name') }}<input type="text" v-model="state.contact.name" placeholder="Alex Muster"/></label>
          <label>{{ t('location') }}<input type="text" v-model="state.contact.location" placeholder="Berlin, DE"/></label>
        </div>
        <div class="grid-2">
          <label>{{ t('role') }}<input type="text" v-model="state.contact.role" placeholder="Software Engineer"/></label>
          <span></span>
        </div>
        <div class="grid-2">
          <label>{{ t('email') }}<input type="email" v-model="state.contact.email" placeholder="alex@example.com"/></label>
          <label>{{ t('phone') }}<input type="tel" v-model="state.contact.phone" placeholder="+49 123 456789"/></label>
        </div>
        <div class="grid-2">
          <label>{{ t('website') }}<input type="url" v-model="state.contact.website" placeholder="https://alexmuster.dev"/></label>
          <label>{{ t('linkedin') }}<input type="url" v-model="state.contact.linkedin" placeholder="https://linkedin.com/in/alexmuster"/></label>
        </div>
      </section>

      <!-- About -->
      <section
        class="section-group"
        data-section="about"
        :class="[{disabled:isHidden('about')},{collapsed:collapsed.about},{dragging:isDragging('about')}]"
        :draggable="isDraggableMode"
        @dragstart="isDraggableMode ? onDragStart('about', $event) : null"
        @dragend="isDraggableMode ? onDragEnd : null"
      >
        <div class="section-head">
          <button class="caret mini" type="button" @click="collapsed.about=!collapsed.about">
            <font-awesome-icon :icon="['fas', getIcon('about')]" class="section-icon" aria-hidden="true" />
          </button>

          <!-- Editable Label -->
          <h3
            v-if="!isEditingSection('about')"
            class="section-name-label"
            @click="startEditSectionName('about', false)"
            :title="langRef === 'de' ? 'Klicken zum Umbenennen' : 'Click to rename'"
          >
            {{ getSectionDisplayName('about') }}
          </h3>
          <input
            v-else
            type="text"
            v-model="editingSection.tempName"
            class="section-name-input"
            :placeholder="getSectionDefaultName('about')"
            @blur="finishEditSectionName('about', false)"
            @keyup.enter="finishEditSectionName('about', false)"
            @keyup.esc="cancelEditSectionName"
          />

          <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
            <select v-if="isButtonMode" v-model="areaAbout">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button v-if="isButtonMode" class="mini" type="button" @click="moveUp('about')">▲</button>
            <button v-if="isButtonMode" class="mini" type="button" @click="moveDown('about')">▼</button>
            <button class="mini" :class="[isHidden('about')?'btn--success':'btn--danger']" type="button" @click="toggleDisabled('about')">
              {{ isHidden('about') ? t('show') : t('hide') }}
            </button>
          </div>
        </div>
        <label>{{ t('aboutTextLabel') }}<textarea v-model="state.about.text" placeholder="Me in a nutshell..."></textarea></label>
      </section>

      <!-- Education -->
      <SectionList
          :title="getSectionDisplayName('education')"
          :lang="langRef"
          sectionKey="education"
          v-model="state.education"
          :schema="[
          {label:t('degreeTitle'), key:'title', type:'text', placeholder:'M.Sc. Informatik'},
          {label:t('institution'), key:'sub', type:'text', placeholder:'TU M\u00fcnchen'},
          {label:t('place'),       key:'place', type:'text', placeholder:'Hamburg'},
          {label:t('start'),       key:'start', type:'text', placeholder:'2017'},
          {label:t('end'),         key:'end', type:'text', placeholder:'2020'},
          {label:t('focus'),       key:'desc', type:'textarea', placeholder:'AI'}
        ]"
          :addLabel="t('add')"
          :disabled="isHidden('education')"
          @toggle-section="toggleDisabled('education')"
          v-bind="getEditableTitleProps('education')"
          @start-edit-title="startEditSectionName('education', false)"
          @finish-edit-title="finishEditSectionName('education', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('education')"
          @dragstart="isDraggableMode ? onDragStart('education', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaEducation">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('education')">▲</button>
            <button class="mini" type="button" @click="moveDown('education')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Experience job -->
      <SectionList
          :title="getSectionDisplayName('jobs')"
          :lang="langRef"
          sectionKey="jobs"
          v-model="state.experience.jobs"
          :schema="[
            {label:t('position'), key:'title', type:'text', placeholder:'Senior Software Engineer'},
            {label:t('company'),  key:'company', type:'text', placeholder:'Acme GmbH'},
            {label:t('place'),    key:'place', type:'text', placeholder:'Berlin'},
            {label:t('start'),    key:'start', type:'text', placeholder:'05.2021'},
            {label:t('end'),      key:'end', type:'text', placeholder: t('current')},
            {label:t('bulletsLabel'), key:'bullets', type:'textarea', placeholder:t('tasks')}
          ]"
          :addLabel="t('add')"
          :disabled="isHidden('jobs')"
          @toggle-section="toggleDisabled('jobs')"
          v-bind="getEditableTitleProps('jobs')"
          @start-edit-title="startEditSectionName('jobs', false)"
          @finish-edit-title="finishEditSectionName('jobs', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('jobs')"
          @dragstart="isDraggableMode ? onDragStart('jobs', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaExpJob">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('jobs')">▲</button>
            <button class="mini" type="button" @click="moveDown('jobs')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Experience additional -->
      <SectionList
          :title="getSectionDisplayName('addExp')"
          :lang="langRef"
          sectionKey="addExp"
          v-model="state.experience.addExp"
          :schema="[
            {label:t('title'),    key:'title', type:'text', placeholder:'Hackathon XYZ'},
            {label:t('subtitle'), key:'sub', type:'text', placeholder:t('hackathonTitlePH') },
            {label:t('place'),    key:'place', type:'text', placeholder:'Hamburg'},
            {label:t('start'),    key:'start', type:'text', placeholder:'03.2024'},
            {label:t('end'),      key:'end', type:'text', placeholder:'03.2024'},
            {label:t('desc'),     key:'desc', type:'textarea', placeholder: t('hackathonPH')}
          ]"
          :addLabel="t('add')"
          :disabled="isHidden('addExp')"
          @toggle-section="toggleDisabled('addExp')"
          v-bind="getEditableTitleProps('addExp')"
          @start-edit-title="startEditSectionName('addExp', false)"
          @finish-edit-title="finishEditSectionName('addExp', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('addExp')"
          @dragstart="isDraggableMode ? onDragStart('addExp', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaExpPersonal">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('addExp')">▲</button>
            <button class="mini" type="button" @click="moveDown('addExp')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Projects -->
      <SectionList
          :title="getSectionDisplayName('projects')"
          :lang="langRef"
          sectionKey="projects"
          v-model="state.experience.projects"
          :schema="[
            {label:t('projectTitle'), key:'title', type:'text', placeholder:'Open Source Tool - repo/name'},
            {label:t('place'),        key:'place', type:'text', placeholder:'Remote'},
            {label:t('start'),        key:'start', type:'text', placeholder:'2025'},
            {label:t('end'),          key:'end', type:'text', placeholder:'2025'},
            {label:t('desc'),         key:'desc', type:'textarea', placeholder: 'CLI tool XY -'}
          ]"
          :addLabel="t('add')"
          :disabled="isHidden('projects')"
          @toggle-section="toggleDisabled('projects')"
          v-bind="getEditableTitleProps('projects')"
          @start-edit-title="startEditSectionName('projects', false)"
          @finish-edit-title="finishEditSectionName('projects', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('projects')"
          @dragstart="isDraggableMode ? onDragStart('projects', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaProjects">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('projects')">▲</button>
            <button class="mini" type="button" @click="moveDown('projects')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Skills -->
      <SectionList
          :title="getSectionDisplayName('skills')"
          :lang="langRef"
          sectionKey="skills"
          v-model="state.skills"
          :schema="[
            {label:t('category'), key:'title', type:'text', placeholder:t('programmingLanguages')},
            {label:t('entryCSV'), key:'tags', type:'text', placeholder:'Python, TypeScript, Go'}
          ]"
          :disabled="isHidden('skills')"
          @toggle-section="toggleDisabled('skills')"
          :addLabel="t('add')"
          v-bind="getEditableTitleProps('skills')"
          @start-edit-title="startEditSectionName('skills', false)"
          @finish-edit-title="finishEditSectionName('skills', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('skills')"
          @dragstart="isDraggableMode ? onDragStart('skills', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaSkills">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('skills')">▲</button>
            <button class="mini" type="button" @click="moveDown('skills')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Languages: CEFR -->
      <SectionList
          :title="getSectionDisplayName('languages')"
          :lang="langRef"
          sectionKey="languages"
          v-model="state.languages"
          :schema="[
            {label:t('languageName'), key:'name', type:'text', placeholder:t('german')},
            {label:t('level'), key:'level', type:'select', options: [(langRef==='de'?'nativ':'native'),'C2','C1','B2','B1','A2','A1']}
          ]"
          :addLabel="t('add')"
          :disabled="isHidden('languages')"
          @toggle-section="toggleDisabled('languages')"
          v-bind="getEditableTitleProps('languages')"
          @start-edit-title="startEditSectionName('languages', false)"
          @finish-edit-title="finishEditSectionName('languages', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('languages')"
          @dragstart="isDraggableMode ? onDragStart('languages', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaLanguages">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('languages')">▲</button>
            <button class="mini" type="button" @click="moveDown('languages')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Hobbies -->
      <SectionList
          :title="getSectionDisplayName('hobbies')"
          :lang="langRef"
          sectionKey="hobbies"
          v-model="state.hobbies"
          :schema="[
            {label: 'Hobby',   key:'name',    type:'text', placeholder:'Music Production'},
            {label: 'Details', key:'details', type:'text', placeholder:'Genres, DAW, Releases \u2026'}
          ]"
          :addLabel="t('add')"
          :disabled="isHidden('hobbies')"
          @toggle-section="toggleDisabled('hobbies')"
          v-bind="getEditableTitleProps('hobbies')"
          @start-edit-title="startEditSectionName('hobbies', false)"
          @finish-edit-title="finishEditSectionName('hobbies', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('hobbies')"
          @dragstart="isDraggableMode ? onDragStart('hobbies', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaHobbies">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('hobbies')">▲</button>
            <button class="mini" type="button" @click="moveDown('hobbies')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Certs -->
      <SectionList
          :title="getSectionDisplayName('certs')"
          :lang="langRef"
          sectionKey="certs"
          v-model="state.certs"
          :schema="[
          {label:t('certificate'), key:'name', type:'text', placeholder:'AWS Solutions Architect'},
          {label:t('yearShort'),  key:'year', type:'text', placeholder:'2023'}
        ]"
          :addLabel="t('add')"
          :disabled="isHidden('certs')"
          @toggle-section="toggleDisabled('certs')"
          v-bind="getEditableTitleProps('certs')"
          @start-edit-title="startEditSectionName('certs', false)"
          @finish-edit-title="finishEditSectionName('certs', false)"
          @cancel-edit-title="cancelEditSectionName"
          @update-editing-value="editingSection.tempName = $event"
          toggle-style="icon"
          :draggable="isDraggableMode"
          :is-dragging="isDragging('certs')"
          @dragstart="isDraggableMode ? onDragStart('certs', $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
      >
        <template #controls>
          <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
            <select v-model="areaCerts">
              <option value="body">Body</option>
              <option value="sidebar">Sidebar</option>
            </select>
            <button class="mini" type="button" @click="moveUp('certs')">▲</button>
            <button class="mini" type="button" @click="moveDown('certs')">▼</button>
          </div>
        </template>
      </SectionList>

      <!-- Custom Sections (dynamisch) -->
      <template v-if="Array.isArray(state.customSections)">
        <section
          v-for="customSection in state.customSections"
          :key="customSection.id"
          class="section-group"
          :data-section="customSection.id"
          :class="{disabled: isHidden(customSection.id), dragging: isDragging(customSection.id)}"
          :draggable="isDraggableMode"
          @dragstart="isDraggableMode ? onDragStart(customSection.id, $event) : null"
          @dragend="isDraggableMode ? onDragEnd : null"
        >
          <div class="section-head">
            <button class="caret mini" type="button" @click="$event.target.closest('.section-group').classList.toggle('collapsed')">
              <font-awesome-icon :icon="['fas', 'folder-open']" class="section-icon" aria-hidden="true" />
            </button>

            <!-- Editable Label for Section Name -->
            <h3
              v-if="!isEditingSection(customSection.id)"
              class="section-name-label"
              @click="startEditSectionName(customSection, true)"
              :title="langRef === 'de' ? 'Klicken zum Umbenennen' : 'Click to rename'"
            >
              {{ customSection.name }}
            </h3>
            <input
              v-else
              type="text"
              v-model="editingSection.tempName"
              class="section-name-input"
              :placeholder="langRef === 'de' ? 'Neue Section' : 'New Section'"
              @blur="finishEditSectionName(customSection, true)"
              @keyup.enter="finishEditSectionName(customSection, true)"
              @keyup.esc="cancelEditSectionName"
            />
            <button
                class="mini btn--danger"
                type="button"
                @click="deleteCustomSection(customSection.id)"
                :title="langRef === 'de' ? 'Section löschen' : 'Delete section'"
            >
              <font-awesome-icon :icon="['fas', 'trash']" />
            </button>
            <div style="margin-left:auto;display:flex;gap:6px">
              <div v-if="isButtonMode" style="display:flex;align-items:center;gap:8px">
                <select :value="currentArea(customSection.id)" @change="setArea(customSection.id, $event.target.value)">
                  <option value="body">Body</option>
                  <option value="sidebar">Sidebar</option>
                </select>
                <button class="mini" type="button" @click="moveUp(customSection.id)">▲</button>
                <button class="mini" type="button" @click="moveDown(customSection.id)">▼</button>
              </div>
              <button type="button" class="mini btn--success" @click="customSection.entries.push({title:'', place:'', start:'', end:'', desc:''})">
                {{ t('add') }}
              </button>
              <button
                class="mini"
                :class="[isHidden(customSection.id) ? 'btn--success' : 'btn--danger']"
                type="button"
                @click="toggleDisabled(customSection.id)"
              >
                {{ isHidden(customSection.id) ? t('show') : t('hide') }}
              </button>
            </div>
          </div>

          <div class="items">
            <div class="item-row" v-for="(entry, idx) in customSection.entries" :key="idx">
              <div class="row row-3">
                <label>
                  {{ t('title') }}
                  <input type="text" v-model="entry.title" :placeholder="t('customSectionPH')" />
                </label>
                <label>
                  {{ t('place') }}
                  <input type="text" v-model="entry.place" placeholder="Berlin" />
                </label>
                <label>
                  {{ t('start') }}
                  <input type="text" v-model="entry.start" placeholder="04.2024" />
                </label>
              </div>
              <div class="row">
                <label>
                  {{ t('end') }}
                  <input type="text" v-model="entry.end" :placeholder="t('current')" />
                </label>
              </div>
              <label>
                {{ t('desc') }}
                <textarea v-model="entry.desc" :placeholder="langRef === 'de' ? 'Beschreibung...' : 'Description...'"></textarea>
              </label>
              <div>
                <button type="button" class="mini btn--danger" @click="customSection.entries.splice(idx, 1)">
                  {{ t('remove') }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </template>

      <div style="display:flex;justify-content:center;margin-top:20px">
        <button type="button" class="btn btn--success" @click="addCustom">{{ t('newSection') }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.section-icon{ margin-right:8px; color:var(--muted); }
.caret{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:26px; padding:0; }
.caret .section-icon{ margin:0; }
.section-controls select{ padding:4px 6px; }

.section-head select, .section-head .mini:not(.caret){
  height: 100%;
  padding: 4px 7px;
  border: 1px solid #134e4a;
  color: #9be8c7;
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

/* Drag & Drop styles */
.section-group[draggable="true"] {
  cursor: grab;
  transition: opacity 0.2s, transform 0.2s;
}

.section-group[draggable="true"]:active {
  cursor: grabbing;
}

.section-group.dragging {
  opacity: 0.3;
  transform: scale(0.95);
  pointer-events: none;
}

.section-group[draggable="true"]:not(.disabled):hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* Drag & Drop Overlay */
.drag-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.drag-overlay-content {
  border: 2px solid #10b981;
  border-radius: 12px;
  padding: 24px;
  max-width: 800px;
  width: 90%;
  max-height: 80vh;
  overflow: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.drag-overlay-header {
  position: relative;
  text-align: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #10b981;
}

.overlay-close-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid #ef4444;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.2s ease;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}

.overlay-close-btn:hover {
  transform: scale(1.1) rotate(90deg);
  background: linear-gradient(135deg, #b91c1c, #991b1b);
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.6);
}

.overlay-close-btn:active {
  transform: scale(0.95) rotate(90deg);
}

.drag-overlay-header h3 {
  margin: 0 0 12px 0;
  color: #10b981;
  font-size: 1.4rem;
}

.drag-item-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 1.1rem;
  color: #9be8c7;
  font-weight: 600;
  margin: 0;
}

.drag-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.drag-column {
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 8px;
  padding: 16px;
}

.drag-column h4 {
  margin: 0 0 16px 0;
  color: #10b981;
  font-size: 1.1rem;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.drop-zone-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-item {
  background: rgba(255, 255, 255, 0.05);
  padding: 12px 16px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #9be8c7;
  font-weight: 500;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.section-item svg {
  color: #10b981;
  width: 16px;
  height: 16px;
}

.drop-zone {
  height: 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  position: relative;
  margin: 2px 0;
}

.drop-zone.active {
  height: 40px;
  background: rgba(16, 185, 129, 0.2);
  border: 2px dashed #10b981;
}

.drop-indicator {
  display: none;
  text-align: center;
  color: #10b981;
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 36px;
}

.drop-zone.active .drop-indicator {
  display: block;
}

.drop-zone:hover:not(.active) {
  background: rgba(16, 185, 129, 0.1);
  height: 12px;
}

@media (max-width: 768px) {
  .drag-columns {
    grid-template-columns: 1fr;
  }

  .drag-overlay-content {
    width: 95%;
    padding: 16px;
  }
}
</style>

