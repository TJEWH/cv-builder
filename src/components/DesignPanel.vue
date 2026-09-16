<script setup>
import { computed, reactive } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  modelValue: { type: Object, required: true },
  lang: { type: String, default: 'de' },
});
const emit = defineEmits(['update:modelValue']);

const design = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);

const bodyFonts = ['Browallia New', 'Century Gothic', 'Inter', 'Source Sans 3', 'IBM Plex Sans', 'Work Sans', 'Nunito Sans', 'Rubik', 'Merriweather Sans', 'Hind'];
const headFonts = ['Browallia New', 'Century Gothic', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Space Grotesk'];
const hStyles = ['clean', 'underline', 'leftbar', 'pill', 'stripe'];
const sections = reactive({
  typography: true,
  colors: true,
  spacing: true,
  badges: true,
  sidebar: true,
  layout: true,
});
const allCollapsed = computed(() => Object.values(sections).every(Boolean));
const bulkLabel = computed(() => allCollapsed.value ? t('expandAll') : t('collapseAll'));

function toggleAll() {
  const next = !allCollapsed.value;
  Object.keys(sections).forEach((key) => { sections[key] = next; });
}

function toggleSection(key) {
  sections[key] = !sections[key];
}

function onSectionHeaderClick(key, event) {
  if (!event.target?.closest?.('button, input, select, textarea, a')) toggleSection(key);
}

function millimeters(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setMillimeters(key, value) {
  design.value[key] = `${Math.max(0, Number.parseFloat(value) || 0)}mm`;
}

function pixels(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0.5, parsed)) : fallback;
}

</script>

<template>
  <section class="section-group editor-panel design-panel">
    <div class="section-head editor-panel__header">
      <font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" />
      <h3>{{ t('design') }}</h3>
      <button class="mini panel-bulk-toggle" type="button" :aria-label="bulkLabel" :title="bulkLabel" @click="toggleAll">
        <font-awesome-icon :icon="['fas', allCollapsed ? 'angles-down' : 'angles-up']" />
        {{ bulkLabel }}
      </button>
    </div>

    <div class="editor-panel__body">
      <section class="editor-subsection" :class="{ collapsed: sections.layout }">
        <div class="section-head" @click="onSectionHeaderClick('layout', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('layout')"><font-awesome-icon :icon="['fas', 'table-cells-large']" /></button><h4>Layout</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>Heading-Style<select v-model="design.hstyle"><option v-for="style in hStyles" :key="style" :value="style">{{ style }}</option></select></label><label>Header Style<select v-model="design.headerLayoutStyle"><option value="boxed">Boxed</option><option value="separator">Separator</option></select></label></div>
          <div class="grid-3 subsection-row"><label>Contact Layout<select v-model="design.contactLayout"><option value="side">Right column</option><option value="below">Below title (one row)</option></select></label><label>Separator Width: {{ pixels(design.separatorWidth) }}px<input type="range" min="0.5" max="5" step="0.5" :value="pixels(design.separatorWidth)" @input="design.separatorWidth = $event.target.value + 'px'"></label></div>
          <div class="layout-control-group subsection-row">
            <h5>Page Margins</h5>
            <div class="grid-2">
              <label>Top: {{ design.pageMarginTop || '0mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginTop, 0)" @input="setMillimeters('pageMarginTop', $event.target.value)"></label>
              <label>Right: {{ design.pageMarginRight || '0mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginRight, 0)" @input="setMillimeters('pageMarginRight', $event.target.value)"></label>
              <label>Bottom: {{ design.pageMarginBottom || '0mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginBottom, 0)" @input="setMillimeters('pageMarginBottom', $event.target.value)"></label>
              <label>Left: {{ design.pageMarginLeft || '0mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginLeft, 0)" @input="setMillimeters('pageMarginLeft', $event.target.value)"></label>
            </div>
          </div>
          <div class="layout-control-group subsection-row">
            <h5>Padding</h5>
            <div class="grid-2">
              <label>Header Vertical: {{ design.headerPaddingVertical || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.headerPaddingVertical, 12)" @input="setMillimeters('headerPaddingVertical', $event.target.value)"></label>
              <label>Header Horizontal: {{ design.headerPaddingHorizontal || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.headerPaddingHorizontal, 12)" @input="setMillimeters('headerPaddingHorizontal', $event.target.value)"></label>
              <label>Content Vertical: {{ design.contentPaddingVertical || '10mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.contentPaddingVertical, 10)" @input="setMillimeters('contentPaddingVertical', $event.target.value)"></label>
              <label>Content Horizontal: {{ design.contentPaddingHorizontal || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.contentPaddingHorizontal, 12)" @input="setMillimeters('contentPaddingHorizontal', $event.target.value)"></label>
            </div>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.sidebar }">
        <div class="section-head" @click="onSectionHeaderClick('sidebar', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('sidebar')"><font-awesome-icon :icon="['fas', 'table-columns']" /></button><h4>Sidebar Layout</h4></div>
        <div class="editor-subsection__body grid-3"><label>Sidebar Width: {{ design.sidebarWidth }}<input type="range" min="0.1" max="3.0" step="0.1" :value="parseFloat(design.sidebarWidth)" @input="design.sidebarWidth = $event.target.value + 'fr'"></label><label>Sidebar Position<select v-model="design.sidebarAlign"><option value="left">Links</option><option value="right">Rechts</option></select></label><label>Sidebar Style<select v-model="design.sidebarLayoutStyle"><option value="boxed">Boxed</option><option value="separator">Separator</option></select></label></div>
        <div class="editor-subsection__body grid-3 subsection-row"><label>Sidebar Start<select v-model="design.sidebarFillMode"><option value="start">Fill from start</option><option value="last-page">Fill from last PDF page</option><option value="after-cover">Skip cover page</option></select></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.spacing }">
        <div class="section-head" @click="onSectionHeaderClick('spacing', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('spacing')"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" /></button><h4>Spacing</h4></div>
        <div class="editor-subsection__body grid-3"><label>Body Section Spacing: {{ design.sectionSpacingBody || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody || design.sectionSpacing)" @input="design.sectionSpacingBody = $event.target.value + 'mm'"></label><label>Sidebar Section Spacing: {{ design.sectionSpacingSidebar || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar || design.sectionSpacing)" @input="design.sectionSpacingSidebar = $event.target.value + 'mm'"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.typography }">
        <div class="section-head" @click="onSectionHeaderClick('typography', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('typography')"><font-awesome-icon :icon="['fas', 'font']" /></button><h4>Typography</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3">
            <label>H1 Font Size: {{ design.h1 }}<input type="range" min="18" max="30" step="1" :value="parseInt(design.h1)" @input="design.h1 = $event.target.value + 'pt'"></label>
            <label>H2 Font Size: {{ design.h2 }}<input type="range" min="10" max="20" step="1" :value="parseInt(design.h2)" @input="design.h2 = $event.target.value + 'pt'"></label>
            <label>H3 Font Size: {{ design.h3 }}<input type="range" min="8" max="16" step="1" :value="parseInt(design.h3)" @input="design.h3 = $event.target.value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Bullet Point Font Size: {{ design.bullets }}<input type="range" min="8" max="14" step="0.5" :value="parseFloat(design.bullets)" @input="design.bullets = $event.target.value + 'pt'"></label>
            <label>Bullet Point Style<select v-model="design.bulletStyle"><option value="disc">Disc (●)</option><option value="disclosure-closed">Disclosure (▸)</option><option value="circle">Circle (○)</option><option value="square">Square (■)</option></select></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Body-Font<select v-model="design.fontBody"><option :value="''">(System)</option><option v-for="font in bodyFonts" :key="font" :value="font">{{ font }}</option></select></label>
            <label>Headings-Font<select v-model="design.fontHead"><option :value="''">(wie Body)</option><option v-for="font in headFonts" :key="font" :value="font">{{ font }}</option></select></label>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.colors }">
        <div class="section-head" @click="onSectionHeaderClick('colors', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('colors')"><font-awesome-icon :icon="['fas', 'palette']" /></button><h4>Colors</h4></div>
        <div class="editor-subsection__body grid-3"><label>Font Color<input type="color" v-model="design.ink"></label><label>Graphic Opacity: {{ design.graphicOpacity ?? 100 }}%<input type="range" min="0" max="100" step="1" v-model.number="design.graphicOpacity"></label><label>Date Opacity: {{ design.dateOpacity ?? 100 }}%<input type="range" min="0" max="100" step="1" v-model.number="design.dateOpacity"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.badges }">
        <div class="section-head" @click="onSectionHeaderClick('badges', $event)"><button class="caret mini" type="button" @click.stop="toggleSection('badges')"><font-awesome-icon :icon="['fas', 'tag']" /></button><h4>Badges & Items</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3"><label>Border Width: {{ design.badgeBorderWidth || design.itemBorderWidth || '1px' }}<input type="range" min="0" max="4" step="0.5" :value="parseFloat(design.badgeBorderWidth || design.itemBorderWidth || '1')" @input="design.badgeBorderWidth = design.itemBorderWidth = $event.target.value + 'px'"></label><label>Badge Border Radius: {{ design.badgeBorderRadius }}<input type="range" min="0" max="20" step="1" :value="parseInt(design.badgeBorderRadius)" @input="design.badgeBorderRadius = $event.target.value + 'px'"></label></div>
        </div>
      </section>

    </div>
  </section>
</template>

<style scoped>
.editor-subsection h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.subsection-row { margin-top: 8px; }
.layout-control-group h5 { margin: 0 0 6px; color: var(--muted); font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; }
</style>
