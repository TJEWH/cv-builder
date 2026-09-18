<script setup lang="ts">
import type { PropType } from 'vue';
import type { CustomFont, CvDesign, FontSource } from '../types';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { DEFAULT_DESIGN, designValue } from '../defaults';
import { makeT } from '../i18n/dict';
import { BODY_FONTS, HEADING_FONTS, FontImportError, fontOptions, importWebFont, storeCustomFont } from '../composables/webFonts';
import DesignControlFields from './DesignControlFields.vue';
import { designControlRows, type DesignControl, type FavoriteLink } from '../composables/designControls';

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
const controls = computed<DesignControl[]>(() => [
  { key: 'contactLayout', section: 'header', label: t('designContactLayout'), type: 'select', options: [{ value: 'side', label: t('designRightColumn') }, { value: 'below', label: t('designBelowTitleOneRow') }] },
  { key: 'separatorWidth', section: 'spacing', label: t('designSeparatorWidth'), type: 'range', min: 0.5, max: 5, step: 0.5, unit: 'px' },
  { key: 'hstyle', section: 'layout', label: t('designHeadingStyle'), type: 'select', options: hStyles.map((value) => ({ value, label: t(`headingStyle_${value}`) })) },
  { key: 'headerLayoutStyle', section: 'header', label: t('designHeaderStyle'), type: 'select', options: [{ value: 'boxed', label: t('designBoxed') }, { value: 'separator', label: t('designSeparator') }] },
  { key: 'pageMarginTop', section: 'layout', label: t('designPageMarginTop'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginBottom', section: 'layout', label: t('designPageMarginBottom'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginVertical },
  { key: 'pageMarginRight', section: 'layout', label: t('designPageMarginRight'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginHorizontal },
  { key: 'pageMarginLeft', section: 'layout', label: t('designPageMarginLeft'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.pageMarginHorizontal },
  { key: 'headerPaddingBottom', section: 'header', label: t('designHeaderBottomPadding'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.headerBottomSpacing },
  { key: 'headerBottomMargin', section: 'header', label: t('designHeaderBottomMargin'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link: favoriteLinks.headerBottomSpacing },
  { key: 'sidebarWidth', section: 'sidebar', label: t('designSidebarWidth'), type: 'range', min: 0.1, max: 3, step: 0.1, unit: 'fr' },
  { key: 'sidebarAlign', section: 'sidebar', label: t('designSidebarPosition'), type: 'select', options: [{ value: 'left', label: t('designLeft') }, { value: 'right', label: t('designRight') }] },
  { key: 'sidebarLayoutStyle', section: 'sidebar', label: t('designSidebarStyle'), type: 'select', options: [{ value: 'boxed', label: t('designBoxed') }, { value: 'separator', label: t('designSeparator') }] },
  { key: 'sidebarFillMode', section: 'sidebar', label: t('designSidebarStart'), type: 'select', options: [{ value: 'start', label: t('designFillFromStart') }, { value: 'last-page', label: t('designFillFromLastPDFPage') }, { value: 'after-cover', label: t('designSkipCoverPage') }] },
  { key: 'sidebarHeightMode', section: 'sidebar', label: t('designSidebarHeight'), type: 'select', options: [{ value: 'content', label: t('designFitContent') }, { value: 'full-page', label: t('designFullPage') }] },
  { key: 'sidebarBottomPadding', section: 'sidebar', visible: isContentHeight.value, label: t('designSidebarBottomPadding'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm' },
  { key: 'sectionSpacingBody', section: 'spacing', label: t('designBodySectionSpacing'), type: 'range', min: 2, max: 20, step: 1, unit: 'mm' },
  { key: 'sectionSpacingSidebar', section: 'spacing', label: t('designSidebarSectionSpacing'), type: 'range', min: 2, max: 20, step: 1, unit: 'mm' },
  { key: 'itemSpacing', section: 'spacing', label: t('designSectionItemSpacing'), type: 'range', min: 0, max: 12, step: 0.5, unit: 'mm' },
  { key: 'bodySidebarSpacing', section: 'spacing', label: t('designBodySidebarSpacing'), type: 'range', min: 0, max: 30, step: 1, unit: 'mm' },
  { key: 'h1', section: 'typography', label: t('designH1FontSize'), type: 'range', min: 18, max: 30, step: 1, unit: 'pt' },
  { key: 'h2', section: 'typography', label: t('designH2FontSize'), type: 'range', min: 10, max: 20, step: 1, unit: 'pt' },
  { key: 'h3', section: 'typography', label: t('designH3FontSize'), type: 'range', min: 8, max: 16, step: 1, unit: 'pt' },
  { key: 'bullets', section: 'typography', label: t('designBulletFontSize'), type: 'range', min: 8, max: 14, step: 0.5, unit: 'pt' },
  { key: 'fontBody', section: 'typography', label: t('designBodyFont'), type: 'select', options: bodyFonts.value },
  { key: 'fontHead', section: 'typography', label: t('designHeadingsFont'), type: 'select', options: [{ value: '', label: t('designInheritBodyFont') }, ...headFonts.value] },
  { key: 'ink', section: 'colors', label: t('designFontColor'), type: 'color' },
  { key: 'graphicOpacity', section: 'colors', label: t('designGraphicOpacity'), type: 'range', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'dateOpacity', section: 'colors', label: t('designDateOpacity'), type: 'range', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'showTimeline', section: 'graphics', label: t('designShowTimeline'), type: 'toggle' },
  { key: 'badgeBorderWidth', section: 'graphics', label: t('designBadgeBorderWidth'), type: 'range', min: 0.5, max: 4, step: 0.5, unit: 'px', visible: design.value.badgeMode === 'border' },
  { key: 'badgeMode', section: 'graphics', label: t('designBadgeMode'), type: 'select', options: [{ value: 'solid', label: t('designSolid') }, { value: 'border', label: t('designBorder') }] },
  { key: 'badgeBorderRadius', section: 'graphics', label: t('designBadgeBorderRadius'), type: 'range', min: 0, max: 20, step: 1, unit: 'px' },
]);
const favoriteKeys = computed(() => (design.value.favoriteControls));
// Every control is eligible for favorites, including currently hidden controls.
const availableDesignControls = controls;
const selectedDesignControls = computed(() => controls.value.filter((option) => option.visible !== false && favoriteKeys.value.includes(option.key)));
const isFavorite = (key: string) => favoriteKeys.value.includes(key);
const designSections = computed(() => [
  { key: 'layout', label: t('designLayout'), icon: 'table-cells-large' },
  { key: 'header', label: t('designHeader'), icon: 'table-cells-large' },
  { key: 'sidebar', label: t('designSidebarLayout'), icon: 'table-columns' },
  { key: 'spacing', label: t('designSpacing'), icon: 'arrows-left-right-to-line' },
  { key: 'typography', label: t('designTypography'), icon: 'font' },
  { key: 'colors', label: t('designColors'), icon: 'palette' },
  { key: 'graphics', label: t('designGraphicElements'), icon: 'tag' },
].map((section) => ({ ...section, entries: designControlRows(controls.value.filter((option) => option.section === section.key && option.visible !== false), favoritePairLabel) })));
function favoritePairLabel(linkKey: FavoriteLink['linkKey']) {
  return {
    pageMarginVerticalLinked: t('designVerticalPageMargins'),
    pageMarginHorizontalLinked: t('designHorizontalPageMargins'),
    headerBottomSpacingLinked: t('designHeaderBottomSpacing'),
  }[linkKey];
}
const favoriteRows = computed(() => designSections.value.flatMap((section) => {
  const entries = designControlRows(selectedDesignControls.value.filter((option) => option.section === section.key), favoritePairLabel);
  return entries.length ? [{ ...section, entries }] : [];
}));
function setFavorite(key: string, enabled: boolean) {
  const next = new Set(favoriteKeys.value);
  if (enabled) next.add(key);
  else next.delete(key);
  design.value.favoriteControls = controls.value.filter((option) => next.has(option.key)).map((option) => option.key);
}
const sections = reactive<Record<string, boolean>>({
  typography: true,
  colors: true,
  spacing: true,
  graphics: true,
  sidebar: true,
  layout: true,
  header: true,
});
function toggleSection(key: string) {
  sections[key] = !sections[key];
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
        <label v-for="option in availableDesignControls" :key="option.key">
          <input type="checkbox" :checked="isFavorite(option.key)" @change="setFavorite(option.key, ($event.target as HTMLInputElement).checked)">
          {{ option.label }}
        </label>
      </div>

      <div v-if="favoriteRows.length" class="design-favorites__rows">
        <section v-for="row in favoriteRows" :key="row.key" class="design-favorites__row">
          <h4>{{ row.label }}</h4>
          <DesignControlFields :model-value="design" :entries="row.entries" :lang="lang" />
        </section>
      </div>
      <p v-else class="design-favorites__empty">{{ t('designChooseControlsToKeepYourMostUsedDesignSettingsHere') }}</p>
      </section>

      <div class="editor-panel__body">
      <section v-for="section in designSections" :key="section.key" class="editor-subsection" :class="{ collapsed: sections[section.key] }">
        <div class="section-head editor-subsection__header" @click="toggleSection(section.key)"><font-awesome-icon :icon="['fas', section.icon]" class="section-icon" aria-hidden="true" /><h4>{{ section.label }}</h4></div>
        <div class="editor-subsection__body">
          <DesignControlFields :model-value="design" :entries="section.entries" :lang="lang" />
          <p v-if="section.key === 'header'" class="spacing-hint">{{ t('designWithASeparatorHeaderPaddingIsAboveTheLineAndMarginIsBelowIt') }}</p>
          <p v-if="section.key === 'sidebar'" class="spacing-hint">{{ t('designFitContentLetsTheBodyUseTheFullWidthBelowTheSidebar') }}</p>
          <template v-if="section.key === 'typography'">
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
          </template>
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
.design-favorites__empty { margin: 0; color: var(--muted); font-size: 12px; }
.editor-subsection h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.editor-subsection > .section-head > .section-icon { width: 34px; color: var(--muted); text-align: center; }
.subsection-row { margin-top: 8px; }
.font-import { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.font-import-button { min-height: 34px; padding-inline: 12px; }
.font-import-success { color: #9be8c7; font-size: 12px; }
.font-import-error { color: #fda4af; font-size: 12px; }
@media (max-width: 640px) { .font-import { grid-template-columns: 1fr; } }
.spacing-hint { margin: 6px 0 0; color: var(--muted); font-size: 9pt; }
@media (max-width: 640px) { .design-favorites { margin-inline: 0; } .design-favorites__picker, .design-favorites__controls, .design-favorites__paired-controls { grid-template-columns: 1fr; } .design-favorites__control--linked { grid-column: auto; } }
</style>
