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
const hStyles = ['clean', 'underline', 'leftbar', 'pill'];
const sections = reactive({
  typography: true,
  colors: true,
  spacing: true,
  badges: true,
  sidebar: true,
  layout: true,
});
function toggleSection(key) {
  sections[key] = !sections[key];
}

function onSubsectionClick(key, event) {
  if (!event.target?.closest?.('button, input, select, textarea, label, a, [contenteditable="true"], .p-select')) {
    toggleSection(key);
  }
}

function millimeters(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setMillimeters(key, value) {
  design.value[key] = `${Math.max(0, Number.parseFloat(value) || 0)}mm`;
}

function isLinked(key) {
  return design.value[key] !== false;
}

function setLinked(key, primaryKey, secondaryKey, linked) {
  design.value[key] = linked;
  if (linked) design.value[secondaryKey] = design.value[primaryKey];
}

function setLinkedMillimeters(linkKey, primaryKey, secondaryKey, value) {
  const normalized = `${Math.max(0, Number.parseFloat(value) || 0)}mm`;
  design.value[primaryKey] = normalized;
  if (isLinked(linkKey)) design.value[secondaryKey] = normalized;
}

function pixels(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0.5, parsed)) : fallback;
}

</script>

<template>
  <section class="section-group editor-panel design-panel">
    <div class="section-head editor-panel__header editor-panel__header--centered">
      <h3>{{ t('design') }}</h3>
    </div>

    <div class="editor-panel__body">
      <section class="editor-subsection" :class="{ collapsed: sections.layout }" @click="onSubsectionClick('layout', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'table-cells-large']" class="section-icon" aria-hidden="true" /><h4>Layout</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>Contact Layout<select v-model="design.contactLayout"><option value="side">Right column</option><option value="below">Below title (one row)</option></select></label><label>Separator Width: {{ pixels(design.separatorWidth) }}px<input type="range" min="0.5" max="5" step="0.5" :value="pixels(design.separatorWidth)" @input="design.separatorWidth = $event.target.value + 'px'"></label></div>
          <div class="grid-2 subsection-row"><label>Heading-Style<select v-model="design.hstyle"><option v-for="style in hStyles" :key="style" :value="style">{{ style }}</option></select></label><label>Header Style<select v-model="design.headerLayoutStyle"><option value="boxed">Boxed</option><option value="separator">Separator</option></select></label></div>
          <div class="layout-control-group subsection-row">
            <h5>Page Margins</h5>
            <div class="grid-2">
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('pageMarginVerticalLinked') ? 'Vertical' : 'Top' }}: {{ design.pageMarginTop || '12mm' }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('pageMarginVerticalLinked') ? 'Unlink top and bottom page margins' : 'Link top and bottom page margins'" :aria-pressed="isLinked('pageMarginVerticalLinked')" :title="isLinked('pageMarginVerticalLinked') ? 'Top and bottom margins linked' : 'Top and bottom margins independent'" @click="setLinked('pageMarginVerticalLinked', 'pageMarginTop', 'pageMarginBottom', !isLinked('pageMarginVerticalLinked'))"><font-awesome-icon :icon="['fas', isLinked('pageMarginVerticalLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('pageMarginVerticalLinked') ? 'Vertical page margin' : 'Top page margin'" :value="millimeters(design.pageMarginTop, 12)" @input="setLinkedMillimeters('pageMarginVerticalLinked', 'pageMarginTop', 'pageMarginBottom', $event.target.value)">
              </div>
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('pageMarginHorizontalLinked') ? 'Horizontal' : 'Right' }}: {{ design.pageMarginRight || '12mm' }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('pageMarginHorizontalLinked') ? 'Unlink right and left page margins' : 'Link right and left page margins'" :aria-pressed="isLinked('pageMarginHorizontalLinked')" :title="isLinked('pageMarginHorizontalLinked') ? 'Right and left margins linked' : 'Right and left margins independent'" @click="setLinked('pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft', !isLinked('pageMarginHorizontalLinked'))"><font-awesome-icon :icon="['fas', isLinked('pageMarginHorizontalLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('pageMarginHorizontalLinked') ? 'Horizontal page margin' : 'Right page margin'" :value="millimeters(design.pageMarginRight, 12)" @input="setLinkedMillimeters('pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft', $event.target.value)">
              </div>
              <label v-if="!isLinked('pageMarginVerticalLinked')">Bottom: {{ design.pageMarginBottom || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginBottom, 12)" @input="setMillimeters('pageMarginBottom', $event.target.value)"></label>
              <label v-if="!isLinked('pageMarginHorizontalLinked')">Left: {{ design.pageMarginLeft || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.pageMarginLeft, 12)" @input="setMillimeters('pageMarginLeft', $event.target.value)"></label>
            </div>
          </div>
          <div class="layout-control-group subsection-row">
            <h5>Header Spacing</h5>
            <div class="grid-2">
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('headerBottomSpacingLinked') ? 'Header Bottom Spacing' : 'Header Bottom Padding' }}: {{ design.headerPaddingBottom || '12mm' }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('headerBottomSpacingLinked') ? 'Unlink header bottom padding and margin' : 'Link header bottom padding and margin'" :aria-pressed="isLinked('headerBottomSpacingLinked')" :title="isLinked('headerBottomSpacingLinked') ? 'Header bottom padding and margin linked' : 'Header bottom padding and margin independent'" @click="setLinked('headerBottomSpacingLinked', 'headerPaddingBottom', 'headerBottomMargin', !isLinked('headerBottomSpacingLinked'))"><font-awesome-icon :icon="['fas', isLinked('headerBottomSpacingLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('headerBottomSpacingLinked') ? 'Header bottom spacing' : 'Header bottom padding'" :value="millimeters(design.headerPaddingBottom, 12)" @input="setLinkedMillimeters('headerBottomSpacingLinked', 'headerPaddingBottom', 'headerBottomMargin', $event.target.value)">
              </div>
              <label v-if="!isLinked('headerBottomSpacingLinked')">Header Bottom Margin: {{ design.headerBottomMargin || '12mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.headerBottomMargin, 12)" @input="setMillimeters('headerBottomMargin', $event.target.value)"></label>
            </div>
            <p class="spacing-hint">With a separator header, padding is above the line and margin is below it.</p>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.sidebar }" @click="onSubsectionClick('sidebar', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'table-columns']" class="section-icon" aria-hidden="true" /><h4>Sidebar Layout</h4></div>
        <div class="editor-subsection__body grid-3"><label>Sidebar Width: {{ design.sidebarWidth }}<input type="range" min="0.1" max="3.0" step="0.1" :value="parseFloat(design.sidebarWidth)" @input="design.sidebarWidth = $event.target.value + 'fr'"></label><label>Sidebar Position<select v-model="design.sidebarAlign"><option value="left">Links</option><option value="right">Rechts</option></select></label><label>Sidebar Style<select v-model="design.sidebarLayoutStyle"><option value="boxed">Boxed</option><option value="separator">Separator</option></select></label></div>
        <div class="editor-subsection__body grid-3 subsection-row"><label>Sidebar Start<select v-model="design.sidebarFillMode"><option value="start">Fill from start</option><option value="last-page">Fill from last PDF page</option><option value="after-cover">Skip cover page</option></select></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.spacing }" @click="onSubsectionClick('spacing', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" class="section-icon" aria-hidden="true" /><h4>Spacing</h4></div>
        <div class="editor-subsection__body grid-3"><label>Body Section Spacing: {{ design.sectionSpacingBody || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody || design.sectionSpacing)" @input="design.sectionSpacingBody = $event.target.value + 'mm'"></label><label>Sidebar Section Spacing: {{ design.sectionSpacingSidebar || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar || design.sectionSpacing)" @input="design.sectionSpacingSidebar = $event.target.value + 'mm'"></label><label>Section Item Spacing: {{ design.itemSpacing || '3.5mm' }}<input type="range" min="0" max="12" step="0.5" :value="millimeters(design.itemSpacing, 3.5)" @input="setMillimeters('itemSpacing', $event.target.value)"></label></div>
        <div class="editor-subsection__body grid-3 subsection-row"><label>Body / Sidebar Spacing: {{ design.bodySidebarSpacing || '10mm' }}<input type="range" min="0" max="30" step="1" :value="millimeters(design.bodySidebarSpacing, 10)" @input="setMillimeters('bodySidebarSpacing', $event.target.value)"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.typography }" @click="onSubsectionClick('typography', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'font']" class="section-icon" aria-hidden="true" /><h4>Typography</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3">
            <label>H1 Font Size: {{ design.h1 }}<input type="range" min="18" max="30" step="1" :value="parseInt(design.h1)" @input="design.h1 = $event.target.value + 'pt'"></label>
            <label>H2 Font Size: {{ design.h2 }}<input type="range" min="10" max="20" step="1" :value="parseInt(design.h2)" @input="design.h2 = $event.target.value + 'pt'"></label>
            <label>H3 Font Size: {{ design.h3 }}<input type="range" min="8" max="16" step="1" :value="parseInt(design.h3)" @input="design.h3 = $event.target.value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Bullet Point Font Size: {{ design.bullets }}<input type="range" min="8" max="14" step="0.5" :value="parseFloat(design.bullets)" @input="design.bullets = $event.target.value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Body-Font<select v-model="design.fontBody"><option :value="''">(System)</option><option v-for="font in bodyFonts" :key="font" :value="font">{{ font }}</option></select></label>
            <label>Headings-Font<select v-model="design.fontHead"><option :value="''">(wie Body)</option><option v-for="font in headFonts" :key="font" :value="font">{{ font }}</option></select></label>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.colors }" @click="onSubsectionClick('colors', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" /><h4>Colors</h4></div>
        <div class="editor-subsection__body grid-3"><label>Font Color<input type="color" v-model="design.ink"></label><label>Graphic Opacity: {{ design.graphicOpacity ?? 100 }}%<input type="range" min="0" max="100" step="1" v-model.number="design.graphicOpacity"></label><label>Date Opacity: {{ design.dateOpacity ?? 100 }}%<input type="range" min="0" max="100" step="1" v-model.number="design.dateOpacity"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.badges }" @click="onSubsectionClick('badges', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'tag']" class="section-icon" aria-hidden="true" /><h4>Badges & Items</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3"><label>Badge Mode<select v-model="design.badgeMode"><option value="solid">Solid</option><option value="border">Border</option></select></label><label v-if="design.badgeMode === 'border'">Badge Border Width: {{ design.badgeBorderWidth || '1px' }}<input type="range" min="0.5" max="4" step="0.5" :value="parseFloat(design.badgeBorderWidth || '1')" @input="design.badgeBorderWidth = $event.target.value + 'px'"></label><label>Badge Border Radius: {{ design.badgeBorderRadius }}<input type="range" min="0" max="20" step="1" :value="parseInt(design.badgeBorderRadius)" @input="design.badgeBorderRadius = $event.target.value + 'px'"></label></div>
        </div>
      </section>

    </div>
  </section>
</template>

<style scoped>
.editor-subsection h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.editor-subsection > .section-head > .section-icon { width: 34px; color: var(--muted); text-align: center; }
.subsection-row { margin-top: 8px; }
.linked-control__heading { display: flex; align-items: center; gap: 6px; color: #78d1b8; font-size: 10pt; }
.layout-control-group h5 { margin: 0 0 6px; color: var(--muted); font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; }
.link-toggle { width: 28px; min-width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.link-toggle[aria-pressed="true"] { border-color: #27f3a2; color: #9be8c7; }
.linked-control { display: grid; gap: 4px; }
.spacing-hint { margin: 6px 0 0; color: var(--muted); font-size: 9pt; }
</style>
