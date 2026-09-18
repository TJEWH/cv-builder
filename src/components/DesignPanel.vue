<script setup lang="ts">
import type { PropType } from 'vue';
import type { CustomFont, CvDesign, FontSource, KeysOfType, SelectOption } from '../types';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { DEFAULT_DESIGN, designValue, designNumber } from '../defaults';
import { makeT } from '../i18n/dict';
import { BODY_FONTS, HEADING_FONTS, FontImportError, fontOptions, importWebFont, storeCustomFont } from '../composables/webFonts';
type StringDesignKey = KeysOfType<CvDesign, string>;
interface FavoriteLink { linkKey: 'pageMarginVerticalLinked' | 'pageMarginHorizontalLinked' | 'headerBottomSpacingLinked'; primaryKey: StringDesignKey; secondaryKey: StringDesignKey }
type FavoriteOption = {
  label: string; options?: SelectOption[];
  min?: number; max?: number; step?: number; suffix?: string;
} & (
  | { type: 'select' | 'color'; key: StringDesignKey; unit?: never; link?: never }
  | ({ type: 'range'; min: number; max: number; step: number } & (
    | { key: StringDesignKey; unit: 'mm' | 'px' | 'pt' | 'fr'; link?: FavoriteLink }
    | { key: KeysOfType<CvDesign, number>; unit?: never; link?: never }
  ))
);
type FavoriteRow = { type: 'single'; option: FavoriteOption } | { type: 'linked'; key: string; label: string; link: FavoriteLink; options: [FavoriteOption, FavoriteOption] };

const props = defineProps({
  modelValue: { type: Object as PropType<CvDesign>, required: true },
  lang: { type: String, required: true },
});
const emit = defineEmits<{ 'update:modelValue': [design: CvDesign] }>();

const design = computed({
  get: () => new Proxy(props.modelValue, {
    get: (target, key) => key in DEFAULT_DESIGN ? designValue(target, key as keyof CvDesign) : Reflect.get(target, key),
  }) as Required<CvDesign>,
  set: (value) => emit('update:modelValue', value),
});
const langRef = computed(() => props.lang);
const t = makeT(langRef);

const bodyFonts = computed(() => fontOptions(BODY_FONTS, design.value, design.value.fontBody));
const headFonts = computed(() => fontOptions(HEADING_FONTS, design.value, design.value.fontHead));
const fontSource = ref<FontSource>('bunny');
const fontName = ref('');
const isImportingFont = ref(false);
const importedFont = ref<CustomFont>();
const fontImportError = ref<FontImportError>();
let fontImportController: AbortController | undefined;
function resetFontImport() {
  fontImportController?.abort();
  fontImportController = undefined;
  isImportingFont.value = false;
  importedFont.value = undefined;
  fontImportError.value = undefined;
}
watch(() => props.modelValue, resetFontImport);
watch([fontName, fontSource], () => {
  importedFont.value = undefined;
  fontImportError.value = undefined;
});
onBeforeUnmount(resetFontImport);
async function importFont() {
  if (isImportingFont.value) return;
  resetFontImport();
  const controller = new AbortController();
  fontImportController = controller;
  const target = design.value;
  isImportingFont.value = true;
  try {
    const font = await importWebFont(fontName.value, fontSource.value, { signal: controller.signal });
    if (controller.signal.aborted || design.value !== target) return;
    target.customFonts = storeCustomFont(target.customFonts, font);
    // Preserve selections when a family is reimported with a different source.
    for (const key of ['fontBody', 'fontHead'] as const) {
      if (target[key]?.toLowerCase() === font.name.toLowerCase()) target[key] = font.name;
    }
    importedFont.value = font;
  } catch (error) {
    if (!controller.signal.aborted) fontImportError.value = error instanceof FontImportError ? error : new FontImportError('network');
  } finally {
    if (fontImportController === controller) {
      isImportingFont.value = false;
      fontImportController = undefined;
    }
  }
}
const hStyles = ['clean', 'underline', 'leftbar', 'pill'];
const favoritesMode = ref(false);
const isContentHeight = computed(() => design.value.sidebarHeightMode !== 'full-page');
const favoriteLinks: Record<string, FavoriteLink> = {
  pageMarginVertical: { linkKey: 'pageMarginVerticalLinked', primaryKey: 'pageMarginTop', secondaryKey: 'pageMarginBottom' },
  pageMarginHorizontal: { linkKey: 'pageMarginHorizontalLinked', primaryKey: 'pageMarginRight', secondaryKey: 'pageMarginLeft' },
  headerBottomSpacing: { linkKey: 'headerBottomSpacingLinked', primaryKey: 'headerPaddingBottom', secondaryKey: 'headerBottomMargin' },
};
const favoriteOptions = computed<FavoriteOption[]>(() => [
  { key: 'contactLayout', label: t('designContactLayout'), type: 'select', options: [{ value: 'side', label: t('designRightColumn') }, { value: 'below', label: t('designBelowTitleOneRow') }] },
  { key: 'separatorWidth', label: t('designSeparatorWidth'), type: 'range', min: 0.5, max: 5, step: 0.5, unit: 'px' },
  { key: 'hstyle', label: t('designHeadingStyle'), type: 'select', options: hStyles.map((value) => ({ value, label: t(`headingStyle_${value}`) })) },
  { key: 'headerLayoutStyle', label: t('designHeaderStyle'), type: 'select', options: [{ value: 'boxed', label: t('designBoxed') }, { value: 'separator', label: t('designSeparator') }] },
  { key: 'pageMarginTop', label: t('designPageMarginTop'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginBottom', label: t('designPageMarginBottom'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginRight', label: t('designPageMarginRight'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginHorizontal },
  { key: 'pageMarginLeft', label: t('designPageMarginLeft'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginHorizontal },
  { key: 'headerPaddingBottom', label: t('designHeaderBottomPadding'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.headerBottomSpacing },
  { key: 'headerBottomMargin', label: t('designHeaderBottomMargin'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.headerBottomSpacing },
  { key: 'sidebarWidth', label: t('designSidebarWidth'), type: 'range', min: 0.1, max: 3, step: 0.1, unit: 'fr' },
  { key: 'sidebarAlign', label: t('designSidebarPosition'), type: 'select', options: [{ value: 'left', label: t('designLeft') }, { value: 'right', label: t('designRight') }] },
  { key: 'sidebarLayoutStyle', label: t('designSidebarStyle'), type: 'select', options: [{ value: 'boxed', label: t('designBoxed') }, { value: 'separator', label: t('designSeparator') }] },
  { key: 'sidebarFillMode', label: t('designSidebarStart'), type: 'select', options: [{ value: 'start', label: t('designFillFromStart') }, { value: 'last-page', label: t('designFillFromLastPDFPage') }, { value: 'after-cover', label: t('designSkipCoverPage') }] },
  { key: 'sidebarHeightMode', label: t('designSidebarHeight'), type: 'select', options: [{ value: 'content', label: t('designFitContent') }, { value: 'full-page', label: t('designFullPage') }] },
  { key: 'sidebarBottomPadding', label: t('designSidebarBottomPadding'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm' },
  { key: 'sectionSpacingBody', label: t('designBodySectionSpacing'), type: 'range', min: 2, max: 20, step: 1, unit: 'mm' },
  { key: 'sectionSpacingSidebar', label: t('designSidebarSectionSpacing'), type: 'range', min: 2, max: 20, step: 1, unit: 'mm' },
  { key: 'itemSpacing', label: t('designSectionItemSpacing'), type: 'range', min: 0, max: 12, step: 0.5, unit: 'mm' },
  { key: 'bodySidebarSpacing', label: t('designBodySidebarSpacing'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm' },
  { key: 'h1', label: t('designH1FontSize'), type: 'range', min: 18, max: 30, step: 1, unit: 'pt' },
  { key: 'h2', label: t('designH2FontSize'), type: 'range', min: 10, max: 20, step: 1, unit: 'pt' },
  { key: 'h3', label: t('designH3FontSize'), type: 'range', min: 8, max: 16, step: 1, unit: 'pt' },
  { key: 'bullets', label: t('designBulletFontSize'), type: 'range', min: 8, max: 14, step: 0.5, unit: 'pt' },
  { key: 'fontBody', label: t('designBodyFont'), type: 'select', options: bodyFonts.value },
  { key: 'fontHead', label: t('designHeadingsFont'), type: 'select', options: [{ value: '', label: t('designInheritBodyFont') }, ...headFonts.value] },
  { key: 'ink', label: t('designFontColor'), type: 'color' },
  { key: 'graphicOpacity', label: t('designGraphicOpacity'), type: 'range', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'dateOpacity', label: t('designDateOpacity'), type: 'range', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'badgeMode', label: t('designBadgeMode'), type: 'select', options: [{ value: 'solid', label: t('designSolid') }, { value: 'border', label: t('designBorder') }] },
  { key: 'badgeBorderRadius', label: t('designBadgeBorderRadius'), type: 'range', min: 0, max: 20, step: 1, unit: 'px' },
]);
const favoriteKeys = computed(() => (design.value.favoriteControls));
const availableFavoriteOptions = computed(() => favoriteOptions.value.filter((option) => option.key !== 'sidebarBottomPadding' || isContentHeight.value));
const selectedFavoriteOptions = computed(() => availableFavoriteOptions.value.filter((option) => favoriteKeys.value.includes(option.key)));
const isFavorite = (key: string) => favoriteKeys.value.includes(key);
const favoriteOptionByKey = computed(() => new Map(favoriteOptions.value.map((option) => [option.key, option])));
const favoriteSectionLabels = computed<Record<string, string>>(() => ({
  layout: t('designLayout'),
  header: t('designHeader'),
  sidebar: t('designSidebarLayout'),
  spacing: t('designSpacing'),
  typography: t('designTypography'),
  colors: t('designColors'),
  badges: t('designBadgesItems'),
}));
const favoriteSectionOrder = ['layout', 'header', 'sidebar', 'spacing', 'typography', 'colors', 'badges'];
function favoriteSection(option: FavoriteOption) {
  if (['hstyle', 'pageMarginTop', 'pageMarginBottom', 'pageMarginRight', 'pageMarginLeft'].includes(option.key)) return 'layout';
  if (['contactLayout', 'headerLayoutStyle', 'headerPaddingBottom', 'headerBottomMargin'].includes(option.key)) return 'header';
  if (['sidebarWidth', 'sidebarAlign', 'sidebarLayoutStyle', 'sidebarFillMode', 'sidebarHeightMode', 'sidebarBottomPadding'].includes(option.key)) return 'sidebar';
  if (['separatorWidth', 'sectionSpacingBody', 'sectionSpacingSidebar', 'itemSpacing', 'bodySidebarSpacing'].includes(option.key)) return 'spacing';
  if (['h1', 'h2', 'h3', 'bullets', 'fontBody', 'fontHead'].includes(option.key)) return 'typography';
  if (['ink', 'graphicOpacity', 'dateOpacity'].includes(option.key)) return 'colors';
  return 'badges';
}
function favoritePairLabel(linkKey: FavoriteLink['linkKey']) {
  return {
    pageMarginVerticalLinked: t('designVerticalPageMargins'),
    pageMarginHorizontalLinked: t('designHorizontalPageMargins'),
    headerBottomSpacingLinked: t('designHeaderBottomSpacing'),
  }[linkKey];
}
function favoriteShortLabel(option: FavoriteOption) {
  return ({
    pageMarginTop: t('designTop'), pageMarginBottom: t('designBottom'),
    pageMarginRight: t('designRight'), pageMarginLeft: t('designLeft'),
    headerPaddingBottom: t('designPadding'), headerBottomMargin: t('designMargin'),
  } as Partial<Record<keyof CvDesign, string>>)[option.key] || option.label;
}
const favoriteRows = computed(() => {
  const rows = new Map<string, FavoriteRow[]>();
  const handledLinks = new Set<FavoriteLink['linkKey']>();
  const add = (section: string, entry: FavoriteRow) => {
    const entries = rows.get(section) || [];
    entries.push(entry);
    rows.set(section, entries);
  };

  selectedFavoriteOptions.value.forEach((option) => {
    const section = favoriteSection(option);
    const hasFavoritePair = option.link && isFavorite(option.link.primaryKey) && isFavorite(option.link.secondaryKey);
    if (!hasFavoritePair || !option.link) {
      add(section, { type: 'single', option });
      return;
    }
    if (handledLinks.has(option.link.linkKey)) return;

    const primary = favoriteOptionByKey.value.get(option.link.primaryKey);
    const secondary = favoriteOptionByKey.value.get(option.link.secondaryKey);
    if (!primary || !secondary) {
      add(section, { type: 'single', option });
      return;
    }
    handledLinks.add(option.link.linkKey);
    add(section, {
      type: 'linked',
      key: option.link.linkKey,
      label: favoritePairLabel(option.link.linkKey),
      link: option.link,
      options: [primary, secondary],
    });
  });

  return favoriteSectionOrder.flatMap((key) => {
    const entries = rows.get(key);
    return entries ? [{ key, label: favoriteSectionLabels.value[key], entries }] : [];
  });
});
function setFavorite(key: string, enabled: boolean) {
  const next = new Set(favoriteKeys.value);
  if (enabled) next.add(key);
  else next.delete(key);
  design.value.favoriteControls = favoriteOptions.value.filter((option) => next.has(option.key)).map((option) => option.key);
}
function favoriteValue(option: FavoriteOption) {
  const value = design.value[option.key];
  if (option.type !== 'range') return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : designNumber({}, option.key);
}
function favoriteValueLabel(option: FavoriteOption) {
  const value = favoriteValue(option);
  return option.type === 'range' ? `${value}${option.unit || option.suffix || ''}` : value;
}
function setFavoriteValue(option: FavoriteOption, value: string | number) {
  if (option.type !== 'range') {
    design.value[option.key] = String(value);
    return;
  }

  if (option.unit !== undefined) {
    const nextValue = `${value}${option.unit}`;
    design.value[option.key] = nextValue;
    if (option.link && isLinked(option.link.linkKey)) {
      const pairedKey = option.link.primaryKey === option.key ? option.link.secondaryKey : option.link.primaryKey;
      design.value[pairedKey] = nextValue;
    }
  } else {
    design.value[option.key] = Number(value);
  }
}
function toggleFavoriteLink(link: FavoriteLink) {
  const { linkKey, primaryKey, secondaryKey } = link;
  setLinked(linkKey, primaryKey, secondaryKey, !isLinked(linkKey));
}
const sections = reactive<Record<string, boolean>>({
  typography: true,
  colors: true,
  spacing: true,
  badges: true,
  sidebar: true,
  layout: true,
  header: true,
});
function toggleSection(key: string) {
  sections[key] = !sections[key];
}

function setMillimeters(key: StringDesignKey, value: unknown) {
  design.value[key] = `${Math.max(0, designNumber({ [key]: String(value) }, key))}mm`;
}

function isLinked(key: FavoriteLink['linkKey']) {
  return designValue(design.value, key);
}

function setLinked(key: FavoriteLink['linkKey'], primaryKey: StringDesignKey, secondaryKey: StringDesignKey, linked: boolean) {
  design.value[key] = linked;
  if (linked) design.value[secondaryKey] = design.value[primaryKey];
}

function setLinkedMillimeters(linkKey: FavoriteLink['linkKey'], primaryKey: StringDesignKey, secondaryKey: StringDesignKey, value: unknown) {
  const normalized = `${Math.max(0, designNumber({ [primaryKey]: String(value) }, primaryKey))}mm`;
  design.value[primaryKey] = normalized;
  if (isLinked(linkKey)) design.value[secondaryKey] = normalized;
}

function pixels(value: unknown, fallback = Number.parseFloat(DEFAULT_DESIGN.separatorWidth)) {
  const parsed = Number.parseFloat(String(value));
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
        <span><font-awesome-icon :icon="['fas', 'heart']" aria-hidden="true" /> {{ t('designFavorites') }}</span>
        <button class="mini design-favorites__toggle" type="button" :class="{ 'is-active': favoritesMode }" :aria-pressed="favoritesMode" @click="favoritesMode = !favoritesMode">
          <font-awesome-icon :icon="['fas', favoritesMode ? 'check' : 'sliders']" aria-hidden="true" />
          {{ favoritesMode ? t('designDone') : t('designCustomize') }}
        </button>
      </div>

      <div v-if="favoritesMode" class="design-favorites__picker" :aria-label="t('designChooseFavoriteControls')">
        <label v-for="option in availableFavoriteOptions" :key="option.key">
          <input type="checkbox" :checked="isFavorite(option.key)" @change="setFavorite(option.key, ($event.target as HTMLInputElement).checked)">
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
                      <button class="mini link-toggle" type="button" :aria-label="t(isLinked(entry.link.linkKey) ? 'unlinkControls' : 'linkControls').replace('{label}', entry.label)" :aria-pressed="isLinked(entry.link.linkKey)" @click="toggleFavoriteLink(entry.link)"><font-awesome-icon :icon="['fas', isLinked(entry.link.linkKey) ? 'link' : 'link-slash']" /></button>
                    </div>
                    <input type="range" :aria-label="isLinked(entry.link.linkKey) ? entry.label : entry.options[0].label" :min="entry.options[0].min" :max="entry.options[0].max" :step="entry.options[0].step" :value="favoriteValue(entry.options[0])" @input="setFavoriteValue(entry.options[0], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </div>
                  <label v-if="!isLinked(entry.link.linkKey)">
                    <span>{{ favoriteShortLabel(entry.options[1]) }}: {{ favoriteValueLabel(entry.options[1]) }}</span>
                    <input type="range" :aria-label="entry.options[1].label" :min="entry.options[1].min" :max="entry.options[1].max" :step="entry.options[1].step" :value="favoriteValue(entry.options[1])" @input="setFavoriteValue(entry.options[1], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </label>
                </div>
              </div>
              <div v-else class="design-favorites__control">
                <div class="design-favorites__control-label"><span>{{ entry.option.label }}<template v-if="entry.option.type === 'range'">: {{ favoriteValueLabel(entry.option) }}</template></span></div>
                <input v-if="entry.option.type === 'range'" type="range" :aria-label="entry.option.label" :min="entry.option.min" :max="entry.option.max" :step="entry.option.step" :value="favoriteValue(entry.option)" @input="setFavoriteValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <input v-else-if="entry.option.type === 'color'" type="color" :aria-label="entry.option.label" :value="favoriteValue(entry.option)" @input="setFavoriteValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <select v-else :aria-label="entry.option.label" :value="favoriteValue(entry.option)" @change="setFavoriteValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  <option v-for="choice in entry.option.options" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
              </div>
            </template>
          </div>
        </section>
      </div>
      <p v-else class="design-favorites__empty">{{ t('designChooseControlsToKeepYourMostUsedDesignSettingsHere') }}</p>
      </section>

      <div class="editor-panel__body">
      <section class="editor-subsection" :class="{ collapsed: sections.layout }">
        <div class="section-head editor-subsection__header" @click="toggleSection('layout')"><font-awesome-icon :icon="['fas', 'table-cells-large']" class="section-icon" aria-hidden="true" /><h4>{{ t('designLayout') }}</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>{{ t('designHeadingStyle') }}<select v-model="design.hstyle"><option v-for="style in hStyles" :key="style" :value="style">{{ t(`headingStyle_${style}`) }}</option></select></label><span /></div>
          <div class="layout-control-group subsection-row">
            <h5>{{ t('designPageMargins') }}</h5>
            <div class="grid-2">
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('pageMarginVerticalLinked') ? t('designVertical') : t('designTop') }}: {{ design.pageMarginTop }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('pageMarginVerticalLinked') ? t('designUnlinkTopAndBottomPageMargins') : t('designLinkTopAndBottomPageMargins')" :aria-pressed="isLinked('pageMarginVerticalLinked')" :title="isLinked('pageMarginVerticalLinked') ? t('designTopAndBottomMarginsLinked') : t('designTopAndBottomMarginsIndependent')" @click="setLinked('pageMarginVerticalLinked', 'pageMarginTop', 'pageMarginBottom', !isLinked('pageMarginVerticalLinked'))"><font-awesome-icon :icon="['fas', isLinked('pageMarginVerticalLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('pageMarginVerticalLinked') ? t('designVerticalPageMargin') : t('designTopPageMargin')" :value="designNumber(design, 'pageMarginTop')" @input="setLinkedMillimeters('pageMarginVerticalLinked', 'pageMarginTop', 'pageMarginBottom', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
              </div>
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('pageMarginHorizontalLinked') ? t('designHorizontal') : t('designRight') }}: {{ design.pageMarginRight }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('pageMarginHorizontalLinked') ? t('designUnlinkRightAndLeftPageMargins') : t('designLinkRightAndLeftPageMargins')" :aria-pressed="isLinked('pageMarginHorizontalLinked')" :title="isLinked('pageMarginHorizontalLinked') ? t('designRightAndLeftMarginsLinked') : t('designRightAndLeftMarginsIndependent')" @click="setLinked('pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft', !isLinked('pageMarginHorizontalLinked'))"><font-awesome-icon :icon="['fas', isLinked('pageMarginHorizontalLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('pageMarginHorizontalLinked') ? t('designHorizontalPageMargin') : t('designRightPageMargin')" :value="designNumber(design, 'pageMarginRight')" @input="setLinkedMillimeters('pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
              </div>
              <label v-if="!isLinked('pageMarginVerticalLinked')">{{ t('designBottom') }}: {{ design.pageMarginBottom }}<input type="range" min="0" max="30" step="1" :value="designNumber(design, 'pageMarginBottom')" @input="setMillimeters('pageMarginBottom', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)"></label>
              <label v-if="!isLinked('pageMarginHorizontalLinked')">{{ t('designLeft') }}: {{ design.pageMarginLeft }}<input type="range" min="0" max="30" step="1" :value="designNumber(design, 'pageMarginLeft')" @input="setMillimeters('pageMarginLeft', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)"></label>
            </div>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.header }">
        <div class="section-head editor-subsection__header" @click="toggleSection('header')"><font-awesome-icon :icon="['fas', 'table-cells-large']" class="section-icon" aria-hidden="true" /><h4>{{ t('designHeader') }}</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-2"><label>{{ t('designContactLayout') }}<select v-model="design.contactLayout"><option value="side">{{ t('designRightColumn') }}</option><option value="below">{{ t('designBelowTitleOneRow') }}</option></select></label><label>{{ t('designHeaderStyle') }}<select v-model="design.headerLayoutStyle"><option value="boxed">{{ t('designBoxed') }}</option><option value="separator">{{ t('designSeparator') }}</option></select></label></div>
          <div class="layout-control-group subsection-row">
            <h5>{{ t('designHeaderBottomSpacing') }}</h5>
            <div class="grid-2">
              <div class="linked-control">
                <div class="linked-control__heading"><span>{{ isLinked('headerBottomSpacingLinked') ? t('designHeaderBottomSpacing') : t('designHeaderBottomPadding') }}: {{ design.headerPaddingBottom }}</span><button class="mini link-toggle" type="button" :aria-label="isLinked('headerBottomSpacingLinked') ? t('designUnlinkHeaderBottomPaddingAndMargin') : t('designLinkHeaderBottomPaddingAndMargin')" :aria-pressed="isLinked('headerBottomSpacingLinked')" :title="isLinked('headerBottomSpacingLinked') ? t('designHeaderBottomPaddingAndMarginLinked') : t('designHeaderBottomPaddingAndMarginIndependent')" @click="setLinked('headerBottomSpacingLinked', 'headerPaddingBottom', 'headerBottomMargin', !isLinked('headerBottomSpacingLinked'))"><font-awesome-icon :icon="['fas', isLinked('headerBottomSpacingLinked') ? 'link' : 'link-slash']" /></button></div>
                <input type="range" min="0" max="30" step="1" :aria-label="isLinked('headerBottomSpacingLinked') ? t('designHeaderBottomSpacing') : t('designHeaderBottomPadding')" :value="designNumber(design, 'headerPaddingBottom')" @input="setLinkedMillimeters('headerBottomSpacingLinked', 'headerPaddingBottom', 'headerBottomMargin', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
              </div>
              <label v-if="!isLinked('headerBottomSpacingLinked')">{{ t('designHeaderBottomMargin') }}: {{ design.headerBottomMargin }}<input type="range" min="0" max="30" step="1" :value="designNumber(design, 'headerBottomMargin')" @input="setMillimeters('headerBottomMargin', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)"></label>
            </div>
            <p class="spacing-hint">{{ t('designWithASeparatorHeaderPaddingIsAboveTheLineAndMarginIsBelowIt') }}</p>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.sidebar }">
        <div class="section-head editor-subsection__header" @click="toggleSection('sidebar')"><font-awesome-icon :icon="['fas', 'table-columns']" class="section-icon" aria-hidden="true" /><h4>{{ t('designSidebarLayout') }}</h4></div>
        <div class="editor-subsection__body grid-3"><label>{{ t('designSidebarWidth') }}: {{ design.sidebarWidth }}<input type="range" min="0.1" max="3.0" step="0.1" :value="parseFloat(design.sidebarWidth)" @input="design.sidebarWidth = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'fr'"></label><label>{{ t('designSidebarPosition') }}<select v-model="design.sidebarAlign"><option value="left">{{ t('designLeft') }}</option><option value="right">{{ t('designRight') }}</option></select></label><label>{{ t('designSidebarStyle') }}<select v-model="design.sidebarLayoutStyle"><option value="boxed">{{ t('designBoxed') }}</option><option value="separator">{{ t('designSeparator') }}</option></select></label></div>
        <div class="editor-subsection__body grid-3 subsection-row"><label>{{ t('designSidebarStart') }}<select v-model="design.sidebarFillMode"><option value="start">{{ t('designFillFromStart') }}</option><option value="last-page">{{ t('designFillFromLastPDFPage') }}</option><option value="after-cover">{{ t('designSkipCoverPage') }}</option></select></label><label>{{ t('designSidebarHeight') }}<select v-model="design.sidebarHeightMode"><option value="content">{{ t('designFitContent') }}</option><option value="full-page">{{ t('designFullPage') }}</option></select></label><label v-if="isContentHeight">{{ t('designSidebarBottomPadding') }}: {{ design.sidebarBottomPadding }}<input type="range" min="0" max="30" step="1" :value="designNumber(design, 'sidebarBottomPadding')" @input="setMillimeters('sidebarBottomPadding', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)"></label></div>
        <p class="editor-subsection__body spacing-hint">{{ t('designFitContentLetsTheBodyUseTheFullWidthBelowTheSidebar') }}</p>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.spacing }">
        <div class="section-head editor-subsection__header" @click="toggleSection('spacing')"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" class="section-icon" aria-hidden="true" /><h4>{{ t('designSpacing') }}</h4></div>
        <div class="editor-subsection__body grid-3"><label>{{ t('designSeparatorWidth') }}: {{ pixels(design.separatorWidth) }}px<input type="range" min="0.5" max="5" step="0.5" :value="pixels(design.separatorWidth)" @input="design.separatorWidth = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'px'"></label><label>{{ t('designBodySectionSpacing') }}: {{ design.sectionSpacingBody }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody)" @input="design.sectionSpacingBody = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'mm'"></label><label>{{ t('designSidebarSectionSpacing') }}: {{ design.sectionSpacingSidebar }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar)" @input="design.sectionSpacingSidebar = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'mm'"></label></div>
        <div class="editor-subsection__body grid-3 subsection-row"><label>{{ t('designBodySidebarSpacing') }}: {{ design.bodySidebarSpacing }}<input type="range" min="0" max="30" step="1" :value="designNumber(design, 'bodySidebarSpacing')" @input="setMillimeters('bodySidebarSpacing', ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.typography }">
        <div class="section-head editor-subsection__header" @click="toggleSection('typography')"><font-awesome-icon :icon="['fas', 'font']" class="section-icon" aria-hidden="true" /><h4>{{ t('designTypography') }}</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3">
            <label>{{ t('designH1FontSize') }}: {{ design.h1 }}<input type="range" min="18" max="30" step="1" :value="parseInt(design.h1)" @input="design.h1 = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'pt'"></label>
            <label>{{ t('designH2FontSize') }}: {{ design.h2 }}<input type="range" min="10" max="20" step="1" :value="parseInt(design.h2)" @input="design.h2 = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'pt'"></label>
            <label>{{ t('designH3FontSize') }}: {{ design.h3 }}<input type="range" min="8" max="16" step="1" :value="parseInt(design.h3)" @input="design.h3 = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>{{ t('designBulletFontSize') }}: {{ design.bullets }}<input type="range" min="8" max="14" step="0.5" :value="parseFloat(design.bullets)" @input="design.bullets = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>{{ t('designBodyFont') }}<select v-model="design.fontBody"><option v-for="font in bodyFonts" :key="font.value" :value="font.value">{{ font.label }}</option></select></label>
            <label>{{ t('designHeadingsFont') }}<select v-model="design.fontHead"><option :value="''">{{ t('designInheritBodyFont') }}</option><option v-for="font in headFonts" :key="font.value" :value="font.value">{{ font.label }}</option></select></label>
          </div>
          <div class="font-import subsection-row" @click.stop>
            <label>{{ t('fontSource') }}<select v-model="fontSource" :disabled="isImportingFont"><option value="bunny">Bunny Fonts</option><option value="google">Google Fonts</option></select></label>
            <label>{{ t('customFontName') }}<input v-model="fontName" :disabled="isImportingFont" maxlength="100" placeholder="Open Sans" @keydown.enter.prevent="importFont"></label>
            <button class="mini font-import-button" type="button" :disabled="isImportingFont" @click="importFont">{{ t(isImportingFont ? 'importingFont' : 'importFont') }}</button>
          </div>
          <p class="note">{{ t('customFontHelp') }}</p>
          <p v-if="importedFont" class="font-import-success" role="status">{{ t('fontImportSuccess') }} {{ importedFont.name }} ({{ importedFont.source === 'bunny' ? 'Bunny Fonts' : 'Google Fonts' }}). {{ t('fontImportSelect') }}</p>
          <p v-if="fontImportError" class="font-import-error" role="alert">{{ t(`fontImportError_${fontImportError.code}`) }}<template v-if="fontImportError.source"> ({{ fontImportError.source === 'bunny' ? 'Bunny Fonts' : 'Google Fonts' }}<template v-if="fontImportError.status && fontImportError.status >= 400">, HTTP {{ fontImportError.status }}</template>)</template></p>
          <p v-if="fontImportError?.code === 'network' && fontImportError.source === 'google'" class="note">{{ t('googleFontErrorHelp') }}</p>
          <p class="note">{{ t('webfontHelp') }}</p>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.colors }">
        <div class="section-head editor-subsection__header" @click="toggleSection('colors')"><font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" /><h4>{{ t('designColors') }}</h4></div>
        <div class="editor-subsection__body grid-3"><label>{{ t('designFontColor') }}<input type="color" v-model="design.ink"></label><label>{{ t('designGraphicOpacity') }}: {{ design.graphicOpacity }}%<input type="range" min="0" max="100" step="1" v-model.number="design.graphicOpacity"></label><label>{{ t('designDateOpacity') }}: {{ design.dateOpacity }}%<input type="range" min="0" max="100" step="1" v-model.number="design.dateOpacity"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.badges }">
        <div class="section-head editor-subsection__header" @click="toggleSection('badges')"><font-awesome-icon :icon="['fas', 'tag']" class="section-icon" aria-hidden="true" /><h4>{{ t('designBadgesItems') }}</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3"><label>{{ t('designBadgeMode') }}<select v-model="design.badgeMode"><option value="solid">{{ t('designSolid') }}</option><option value="border">{{ t('designBorder') }}</option></select></label><label v-if="design.badgeMode === 'border'">{{ t('designBadgeBorderWidth') }}: {{ design.badgeBorderWidth }}<input type="range" min="0.5" max="4" step="0.5" :value="parseFloat(design.badgeBorderWidth)" @input="design.badgeBorderWidth = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'px'"></label><label>{{ t('designBadgeBorderRadius') }}: {{ design.badgeBorderRadius }}<input type="range" min="0" max="20" step="1" :value="parseInt(design.badgeBorderRadius)" @input="design.badgeBorderRadius = ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value + 'px'"></label></div>
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
.font-import { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.font-import-button { min-height: 34px; padding-inline: 12px; }
.font-import-success { color: #9be8c7; font-size: 12px; }
.font-import-error { color: #fda4af; font-size: 12px; }
@media (max-width: 640px) { .font-import { grid-template-columns: 1fr; } }
.linked-control__heading { display: flex; align-items: center; gap: 6px; color: #78d1b8; font-size: 10pt; }
.layout-control-group h5 { margin: 0 0 6px; color: var(--muted); font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; }
.link-toggle { width: 28px; min-width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.link-toggle[aria-pressed="true"] { border-color: #27f3a2; color: #9be8c7; }
.linked-control { display: grid; gap: 4px; }
.spacing-hint { margin: 6px 0 0; color: var(--muted); font-size: 9pt; }
@media (max-width: 640px) { .design-favorites { margin-inline: 0; } .design-favorites__picker, .design-favorites__controls, .design-favorites__paired-controls { grid-template-columns: 1fr; } .design-favorites__control--linked { grid-column: auto; } }
</style>
