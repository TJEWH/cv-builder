<script setup>
import { computed, reactive, ref } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  modelValue: { type: Object, required: true },
  lang: { type: String, default: 'en' },
});
const emit = defineEmits(['update:modelValue']);

const design = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const langRef = computed(() => props.lang || 'en');
const t = makeT(langRef);

const bodyFonts = ['Browallia New', 'Century Gothic', 'Inter', 'Source Sans 3', 'IBM Plex Sans', 'Work Sans', 'Nunito Sans', 'Rubik', 'Merriweather Sans', 'Hind'];
const headFonts = ['Browallia New', 'Century Gothic', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Space Grotesk'];
const hStyles = ['clean', 'underline', 'leftbar', 'pill'];
const favoritesMode = ref(false);
const favoriteLinks = {
  pageMarginVertical: { linkKey: 'pageMarginVerticalLinked', primaryKey: 'pageMarginTop', secondaryKey: 'pageMarginBottom' },
  pageMarginHorizontal: { linkKey: 'pageMarginHorizontalLinked', primaryKey: 'pageMarginRight', secondaryKey: 'pageMarginLeft' },
  headerBottomSpacing: { linkKey: 'headerBottomSpacingLinked', primaryKey: 'headerPaddingBottom', secondaryKey: 'headerBottomMargin' },
};
const favoriteOptions = [
  { key: 'contactLayout', label: 'Contact Layout', type: 'select', options: [{ value: 'side', label: 'Right column' }, { value: 'below', label: 'Below title (one row)' }] },
  { key: 'separatorWidth', label: 'Separator Width', type: 'range', min: 0.5, max: 5, step: 0.5, unit: 'px', fallback: 1 },
  { key: 'hstyle', label: 'Heading Style', type: 'select', options: hStyles.map((value) => ({ value, label: value })) },
  { key: 'headerLayoutStyle', label: 'Header Style', type: 'select', options: [{ value: 'boxed', label: 'Boxed' }, { value: 'separator', label: 'Separator' }] },
  { key: 'pageMarginTop', label: 'Page Margin Top', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginBottom', label: 'Page Margin Bottom', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginRight', label: 'Page Margin Right', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.pageMarginHorizontal },
  { key: 'pageMarginLeft', label: 'Page Margin Left', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.pageMarginHorizontal },
  { key: 'headerPaddingBottom', label: 'Header Bottom Padding', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.headerBottomSpacing },
  { key: 'headerBottomMargin', label: 'Header Bottom Margin', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 12, link: favoriteLinks.headerBottomSpacing },
  { key: 'sidebarWidth', label: 'Sidebar Width', type: 'range', min: 0.1, max: 3, step: 0.1, unit: 'fr', fallback: 0.7 },
  { key: 'sidebarAlign', label: 'Sidebar Position', type: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
  { key: 'sidebarLayoutStyle', label: 'Sidebar Style', type: 'select', options: [{ value: 'boxed', label: 'Boxed' }, { value: 'separator', label: 'Separator' }] },
  { key: 'sidebarFillMode', label: 'Sidebar Start', type: 'select', options: [{ value: 'start', label: 'Fill from start' }, { value: 'last-page', label: 'Fill from last PDF page' }, { value: 'after-cover', label: 'Skip cover page' }] },
  { key: 'sectionSpacingBody', label: 'Body Section Spacing', type: 'range', min: 2, max: 20, step: 1, unit: 'mm', fallback: 6 },
  { key: 'sectionSpacingSidebar', label: 'Sidebar Section Spacing', type: 'range', min: 2, max: 20, step: 1, unit: 'mm', fallback: 6 },
  { key: 'itemSpacing', label: 'Section Item Spacing', type: 'range', min: 0, max: 12, step: 0.5, unit: 'mm', fallback: 3.5 },
  { key: 'bodySidebarSpacing', label: 'Body / Sidebar Spacing', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', fallback: 10 },
  { key: 'h1', label: 'H1 Font Size', type: 'range', min: 18, max: 30, step: 1, unit: 'pt', fallback: 22 },
  { key: 'h2', label: 'H2 Font Size', type: 'range', min: 10, max: 20, step: 1, unit: 'pt', fallback: 12 },
  { key: 'h3', label: 'H3 Font Size', type: 'range', min: 8, max: 16, step: 1, unit: 'pt', fallback: 10 },
  { key: 'bullets', label: 'Bullet Font Size', type: 'range', min: 8, max: 14, step: 0.5, unit: 'pt', fallback: 10.5 },
  { key: 'fontBody', label: 'Body Font', type: 'select', options: [{ value: '', label: '(System)' }, ...bodyFonts.map((value) => ({ value, label: value }))] },
  { key: 'fontHead', label: 'Headings Font', type: 'select', options: [{ value: '', label: '(Body font)' }, ...headFonts.map((value) => ({ value, label: value }))] },
  { key: 'ink', label: 'Font Color', type: 'color' },
  { key: 'graphicOpacity', label: 'Graphic Opacity', type: 'range', min: 0, max: 100, step: 1, suffix: '%', fallback: 100 },
  { key: 'dateOpacity', label: 'Date Opacity', type: 'range', min: 0, max: 100, step: 1, suffix: '%', fallback: 100 },
  { key: 'badgeMode', label: 'Badge Mode', type: 'select', options: [{ value: 'solid', label: 'Solid' }, { value: 'border', label: 'Border' }] },
  { key: 'badgeBorderRadius', label: 'Badge Border Radius', type: 'range', min: 0, max: 20, step: 1, unit: 'px', fallback: 6 },
];
const favoriteKeys = computed(() => (Array.isArray(design.value.favoriteControls) ? design.value.favoriteControls : []));
const selectedFavoriteOptions = computed(() => favoriteOptions.filter((option) => favoriteKeys.value.includes(option.key)));
const isFavorite = (key) => favoriteKeys.value.includes(key);
const favoriteOptionByKey = new Map(favoriteOptions.map((option) => [option.key, option]));
const favoriteSectionLabels = {
  layout: 'Layout',
  header: 'Header',
  sidebar: 'Sidebar Layout',
  spacing: 'Spacing',
  typography: 'Typography',
  colors: 'Colors',
  badges: 'Badges & Items',
};
const favoriteSectionOrder = ['layout', 'header', 'sidebar', 'spacing', 'typography', 'colors', 'badges'];
function favoriteSection(option) {
  if (['hstyle', 'pageMarginTop', 'pageMarginBottom', 'pageMarginRight', 'pageMarginLeft'].includes(option.key)) return 'layout';
  if (['contactLayout', 'headerLayoutStyle', 'headerPaddingBottom', 'headerBottomMargin'].includes(option.key)) return 'header';
  if (['sidebarWidth', 'sidebarAlign', 'sidebarLayoutStyle', 'sidebarFillMode'].includes(option.key)) return 'sidebar';
  if (['separatorWidth', 'sectionSpacingBody', 'sectionSpacingSidebar', 'itemSpacing', 'bodySidebarSpacing'].includes(option.key)) return 'spacing';
  if (['h1', 'h2', 'h3', 'bullets', 'fontBody', 'fontHead'].includes(option.key)) return 'typography';
  if (['ink', 'graphicOpacity', 'dateOpacity'].includes(option.key)) return 'colors';
  return 'badges';
}
function favoritePairLabel(linkKey) {
  return {
    pageMarginVerticalLinked: 'Vertical Page Margins',
    pageMarginHorizontalLinked: 'Horizontal Page Margins',
    headerBottomSpacingLinked: 'Header Bottom Spacing',
  }[linkKey] || 'Linked controls';
}
function favoriteShortLabel(option) {
  return {
    pageMarginTop: 'Top', pageMarginBottom: 'Bottom',
    pageMarginRight: 'Right', pageMarginLeft: 'Left',
    headerPaddingBottom: 'Padding', headerBottomMargin: 'Margin',
  }[option.key] || option.label;
}
const favoriteRows = computed(() => {
  const rows = new Map();
  const handledLinks = new Set();
  const add = (section, entry) => {
    if (!rows.has(section)) rows.set(section, []);
    rows.get(section).push(entry);
  };

  selectedFavoriteOptions.value.forEach((option) => {
    const section = favoriteSection(option);
    const hasFavoritePair = option.link && isFavorite(option.link.primaryKey) && isFavorite(option.link.secondaryKey);
    if (!hasFavoritePair || handledLinks.has(option.link.linkKey)) {
      if (!option.link || !isFavorite(option.link.primaryKey) || option.key === option.link.primaryKey) add(section, { type: 'single', option });
      return;
    }

    const primary = favoriteOptionByKey.get(option.link.primaryKey);
    const secondary = favoriteOptionByKey.get(option.link.secondaryKey);
    handledLinks.add(option.link.linkKey);
    add(section, {
      type: 'linked',
      key: option.link.linkKey,
      label: favoritePairLabel(option.link.linkKey),
      link: option.link,
      options: [primary, secondary],
    });
  });

  return favoriteSectionOrder.filter((key) => rows.has(key)).map((key) => ({ key, label: favoriteSectionLabels[key], entries: rows.get(key) }));
});
function setFavorite(key, enabled) {
  const next = new Set(favoriteKeys.value);
  if (enabled) next.add(key);
  else next.delete(key);
  design.value.favoriteControls = favoriteOptions.filter((option) => next.has(option.key)).map((option) => option.key);
}
function favoriteValue(option) {
  const value = design.value[option.key];
  if (option.type !== 'range') return value ?? '';
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : option.fallback;
}
function favoriteValueLabel(option) {
  const value = favoriteValue(option);
  return option.type === 'range' ? `${value}${option.unit || option.suffix || ''}` : value;
}
function setFavoriteValue(option, value) {
  if (option.type !== 'range') {
    design.value[option.key] = value;
    return;
  }

  const nextValue = option.unit ? `${value}${option.unit}` : Number(value);
  design.value[option.key] = nextValue;
  if (option.link && isLinked(option.link.linkKey)) {
    const pairedKey = option.link.primaryKey === option.key ? option.link.secondaryKey : option.link.primaryKey;
    design.value[pairedKey] = nextValue;
  }
}
function toggleFavoriteLink(link) {
  const { linkKey, primaryKey, secondaryKey } = link;
  setLinked(linkKey, primaryKey, secondaryKey, !isLinked(linkKey));
}
const sections = reactive({
  typography: true,
  colors: true,
  spacing: true,
  badges: true,
  sidebar: true,
  layout: true,
  header: true,
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
      <h2>{{ t('design') }}</h2>
    </div>

    <div class="design-panel__scroll-body">
      <section class="design-favorites">
      <div class="design-favorites__header">
        <span><font-awesome-icon :icon="['fas', 'heart']" aria-hidden="true" /> Favorites</span>
        <button class="mini design-favorites__toggle" type="button" :class="{ 'is-active': favoritesMode }" :aria-pressed="favoritesMode" @click="favoritesMode = !favoritesMode">
          <font-awesome-icon :icon="['fas', favoritesMode ? 'check' : 'sliders']" aria-hidden="true" />
          {{ favoritesMode ? 'Done' : 'Customize' }}
        </button>
      </div>

      <div v-if="favoritesMode" class="design-favorites__picker" aria-label="Choose favorite controls">
        <label v-for="option in favoriteOptions" :key="option.key">
          <input type="checkbox" :checked="isFavorite(option.key)" @change="setFavorite(option.key, $event.target.checked)">
          {{ option.label }}
        </label>
      </div>

      <div v-if="favoriteRows.length" class="design-favorites__rows">
        <section v-for="row in favoriteRows" :key="row.key" class="design-favorites__row">
          <h4>{{ row.label }}</h4>
          <div class="design-favorites__controls">
            <template v-for="entry in row.entries" :key="entry.type === 'linked' ? entry.key : entry.option.key">
              <div v-if="entry.type === 'linked'" class="design-favorites__control design-favorites__control--linked">
                <div class="design-favorites__paired-controls">
                  <div class="design-favorites__linked-slider">
                    <div class="design-favorites__linked-slider-heading">
                      <span>{{ isLinked(entry.link.linkKey) ? entry.label : favoriteShortLabel(entry.options[0]) }}: {{ favoriteValueLabel(entry.options[0]) }}</span>
                      <button class="mini link-toggle" type="button" :aria-label="isLinked(entry.link.linkKey) ? `Unlink ${entry.label.toLowerCase()}` : `Link ${entry.label.toLowerCase()}`" :aria-pressed="isLinked(entry.link.linkKey)" @click="toggleFavoriteLink(entry.link)"><font-awesome-icon :icon="['fas', isLinked(entry.link.linkKey) ? 'link' : 'link-slash']" /></button>
                    </div>
                    <input type="range" :aria-label="isLinked(entry.link.linkKey) ? entry.label : entry.options[0].label" :min="entry.options[0].min" :max="entry.options[0].max" :step="entry.options[0].step" :value="favoriteValue(entry.options[0])" @input="setFavoriteValue(entry.options[0], $event.target.value)">
                  </div>
                  <label v-if="!isLinked(entry.link.linkKey)">
                    <span>{{ favoriteShortLabel(entry.options[1]) }}: {{ favoriteValueLabel(entry.options[1]) }}</span>
                    <input type="range" :aria-label="entry.options[1].label" :min="entry.options[1].min" :max="entry.options[1].max" :step="entry.options[1].step" :value="favoriteValue(entry.options[1])" @input="setFavoriteValue(entry.options[1], $event.target.value)">
                  </label>
                </div>
              </div>
              <div v-else class="design-favorites__control">
                <div class="design-favorites__control-label"><span>{{ entry.option.label }}<template v-if="entry.option.type === 'range'">: {{ favoriteValueLabel(entry.option) }}</template></span></div>
                <input v-if="entry.option.type === 'range'" type="range" :aria-label="entry.option.label" :min="entry.option.min" :max="entry.option.max" :step="entry.option.step" :value="favoriteValue(entry.option)" @input="setFavoriteValue(entry.option, $event.target.value)">
                <input v-else-if="entry.option.type === 'color'" type="color" :aria-label="entry.option.label" :value="favoriteValue(entry.option) || '#111827'" @input="setFavoriteValue(entry.option, $event.target.value)">
                <select v-else :aria-label="entry.option.label" :value="favoriteValue(entry.option)" @change="setFavoriteValue(entry.option, $event.target.value)">
                  <option v-for="choice in entry.option.options" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
              </div>
            </template>
          </div>
        </section>
      </div>
      <p v-else class="design-favorites__empty">Choose controls to keep your most-used design settings here.</p>
      </section>

      <div class="editor-panel__body">
      <section class="editor-subsection" :class="{ collapsed: sections.layout }" @click="onSubsectionClick('layout', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'table-cells-large']" class="section-icon" aria-hidden="true" /><h4>Layout</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>Heading-Style<select v-model="design.hstyle"><option v-for="style in hStyles" :key="style" :value="style">{{ style }}</option></select></label><span /></div>
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
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.header }" @click="onSubsectionClick('header', $event)">
        <div class="section-head"><font-awesome-icon :icon="['fas', 'table-cells-large']" class="section-icon" aria-hidden="true" /><h4>Header</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>Contact Layout<select v-model="design.contactLayout"><option value="side">Right column</option><option value="below">Below title (one row)</option></select></label><label>Header Style<select v-model="design.headerLayoutStyle"><option value="boxed">Boxed</option><option value="separator">Separator</option></select></label></div>
          <div class="layout-control-group subsection-row">
            <h5>Header Bottom Spacing</h5>
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
        <div class="editor-subsection__body grid-3"><label>Separator Width: {{ pixels(design.separatorWidth) }}px<input type="range" min="0.5" max="5" step="0.5" :value="pixels(design.separatorWidth)" @input="design.separatorWidth = $event.target.value + 'px'"></label><label>Body Section Spacing: {{ design.sectionSpacingBody || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody || design.sectionSpacing)" @input="design.sectionSpacingBody = $event.target.value + 'mm'"></label><label>Sidebar Section Spacing: {{ design.sectionSpacingSidebar || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar || design.sectionSpacing)" @input="design.sectionSpacingSidebar = $event.target.value + 'mm'"></label></div>
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
    </div>
  </section>
</template>

<style scoped>
.design-favorites { display: grid; gap: 10px; margin: 0 10px 10px; padding: 12px; border: 1px solid #1c6255; border-radius: 8px; background: rgba(6, 20, 31, .52); }
.design-favorites__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #d1fae5; font-size: 10pt; font-weight: 700; }
.design-favorites__header span { display: inline-flex; align-items: center; gap: 7px; }
.design-favorites__header .svg-inline--fa { color: #fb7185; }
.design-favorites__toggle { display: inline-flex; align-items: center; gap: 6px; }
.design-favorites__toggle.is-active { border-color: #27f3a2; background: rgba(16, 185, 129, .16); color: #d1fae5; }
.design-favorites__picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 7px 12px; padding-top: 10px; border-top: 1px solid #134e4a; }
.design-favorites__picker label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
.design-favorites__picker input { width: 16px; height: 16px; accent-color: #27f3a2; }
.design-favorites__rows { display: grid; gap: 12px; }
.design-favorites__row { display: grid; gap: 7px; padding-top: 10px; border-top: 1px solid #134e4a; }
.design-favorites__row h4 { margin: 0; color: var(--muted); font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; }
.design-favorites__controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.design-favorites__control { display: grid; gap: 4px; }
.design-favorites__control--linked { grid-column: span 2; }
.design-favorites__control-label { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: #78d1b8; font-size: 10pt; }
.design-favorites__control-label .link-toggle { flex: 0 0 auto; }
.design-favorites__paired-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.design-favorites__linked-slider { display: grid; gap: 4px; }
.design-favorites__linked-slider-heading { display: flex; align-items: center; gap: 6px; color: #78d1b8; font-size: 10pt; }
.design-favorites__paired-controls label { display: grid; gap: 4px; color: #78d1b8; font-size: 10pt; }
.design-favorites__empty { margin: 0; color: var(--muted); font-size: 12px; }
.editor-subsection h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.editor-subsection > .section-head > .section-icon { width: 34px; color: var(--muted); text-align: center; }
.subsection-row { margin-top: 8px; }
.linked-control__heading { display: flex; align-items: center; gap: 6px; color: #78d1b8; font-size: 10pt; }
.layout-control-group h5 { margin: 0 0 6px; color: var(--muted); font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; }
.link-toggle { width: 28px; min-width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.link-toggle[aria-pressed="true"] { border-color: #27f3a2; color: #9be8c7; }
.linked-control { display: grid; gap: 4px; }
.spacing-hint { margin: 6px 0 0; color: var(--muted); font-size: 9pt; }
@media (max-width: 640px) { .design-favorites { margin-inline: 0; } .design-favorites__picker, .design-favorites__controls, .design-favorites__paired-controls { grid-template-columns: 1fr; } .design-favorites__control--linked { grid-column: auto; } }
</style>
