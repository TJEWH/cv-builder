<script setup lang="ts">
import { designNumber, resolveDesign } from './defaults';
import type { CvState, CvDesign, SavedConfiguration, SaveStatus } from './types';
import type { PreviewPage, RenderOptions } from './pdfTypes';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { debounce, loadLocal, saveLocal } from './composables/useStorage';
import { useCvDesign } from './composables/useCvDesign';
import { usePdfExport } from './composables/usePdfExport';
import { createPreviewRenderSlot } from './composables/pdfRenderTask.ts';
import FormBuilder from './components/FormBuilder.vue';
import CvPreview from './components/CvPreview.vue';
import PdfPreview from './components/PdfPreview.vue';
import PdfPagination from './components/PdfPagination.vue';
import BackupManager from './components/BackupManager.vue';
import DesignPanel from './components/DesignPanel.vue';
import AnonymizationPanel from './components/AnonymizationPanel.vue';
import { makeT } from './i18n/dict';
import { createNormalizedContentState, normalizeContentState } from './composables/contentLayout';
import { createEmptyDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID, isBuiltinDocument } from './composables/builtinConfigurations';
import { readCvState } from './composables/cvStateValidation';
import { createAnonymizedState } from './composables/anonymization';

const state = reactive<CvState>(createEmptyDocument());

const lang = computed({
  get: () => state.lang,
  set: (value) => { state.lang = value; },
});
const previewMode = ref(false);
const fullPreviewView = ref('pdf');
const previewPlacement = ref('side');
const previewPages = ref<PreviewPage[]>([]);
const previewPage = ref(1);
const isPreviewRendering = ref(true);
const pdfRenderSource = ref<HTMLElement | null>(null);
const anonymizedPreviewPages = ref<PreviewPage[]>([]);
const anonymizedPreviewPage = ref(1);
const isAnonymizedPreviewRendering = ref(false);
const anonymizedPdfRenderSource = ref<HTMLElement | null>(null);
const fullPreviewVariant = ref('normal');
const t = makeT(lang);
const activeBuilderGroup = ref('content');
const savedConfigurations = ref<SavedConfiguration[]>([]);
const selectedConfigurationId = ref('');
const isEmptyDocument = computed(() => selectedConfigurationId.value === EMPTY_DOCUMENT_ID);
const selectableConfigurations = computed(() => savedConfigurations.value.filter(({ id }) => !isBuiltinDocument(id)));
watch(isEmptyDocument, (empty) => {
  if (empty) activeBuilderGroup.value = 'versions';
}, { flush: 'sync' });
const saveStatus = ref<SaveStatus>('saved');
const backupManager = ref<InstanceType<typeof BackupManager> | null>(null);
const formBuilder = ref<InstanceType<typeof FormBuilder> | null>(null);
const sectionSaveStatus = ref<SaveStatus>('saved');
const combinedSaveStatus = computed(() => {
  const statuses = [saveStatus.value, sectionSaveStatus.value];
  return statuses.includes('error') ? 'error' : statuses.includes('saving') ? 'saving' : 'saved';
});
const readSectionVersion = (id: string) => backupManager.value?.readConfigData(id);
const saveSectionVersion = (id: string, data: CvState) => backupManager.value?.saveVersion(id, data) ?? false;
function prepareConfigurationChange() {
  flushStateSave();
  return formBuilder.value?.resetSectionVersions() !== false && saveStatus.value !== 'error';
}
const builderGroups = computed(() => [
  { key: 'versions', label: t('versions'), icon: 'layer-group' },
  { key: 'content', label: t('content'), icon: 'table-cells-large' },
  { key: 'design', label: t('design'), icon: 'palette' },
  { key: 'privacy', label: t('privacy'), icon: 'user-secret' },
]);
const saveStatusLabel = computed(() => t({
  saving: 'saving',
  saved: 'saved',
  error: 'saveFailed',
}[combinedSaveStatus.value] || 'saved'));
const saveStatusIcon = computed(() => (
  combinedSaveStatus.value === 'saving' ? 'spinner' : combinedSaveStatus.value === 'error' ? 'xmark' : 'check'
));

function persistState() {
  try {
    const versionSaveResult = backupManager.value?.saveCurrent?.();
    const saved = typeof versionSaveResult === 'boolean'
      ? versionSaveResult
      : saveLocal(state);
    saveStatus.value = saved ? 'saved' : 'error';
  } catch (error) {
    console.warn('Failed to save CV state', error);
    saveStatus.value = 'error';
  }
}

const saveDebounced = debounce(persistState, 250);
function scheduleStateSave() {
  if (isSliderPreviewUpdateDeferred) {
    sliderSaveUpdatePending = true;
    saveStatus.value = 'saving';
    return;
  }
  saveStatus.value = 'saving';
  saveDebounced();
}

function selectConfiguration(event: Event) {
  const target = event.target as HTMLSelectElement;
  const nextId = target.value;
  if (nextId === selectedConfigurationId.value) return;
  if (!backupManager.value?.selectConfiguration(nextId)) target.value = selectedConfigurationId.value;
}

function handleConfigurationSaveResult(saved: boolean) {
  saveStatus.value = saved ? 'saved' : 'error';
}

function toggleLanguage() {
  lang.value = lang.value === 'de' ? 'en' : 'de';
}

watch(state, scheduleStateSave, { deep: true });
useCvDesign(() => state.design);

function mergeIn(data: unknown) {
  const nextState = createNormalizedContentState(readCvState(data));
  nextState.design = resolveDesign(nextState.design);
  for (const key of Object.keys(state)) if (!Object.hasOwn(nextState, key)) Reflect.deleteProperty(state, key);
  Object.assign(state, nextState);
}

normalizeContentState(state);

onMounted(async () => {
  try {
    const cached = backupManager.value?.restoreActiveConfig?.() || loadLocal();
    if (cached) {
      mergeIn(cached);
      return;
    }

    const sample = backupManager.value?.readConfigData(SAMPLE_DOCUMENT_ID);
    if (sample) {
      selectedConfigurationId.value = SAMPLE_DOCUMENT_ID;
      mergeIn(sample);
    }
  } catch (error) {
    console.warn('Failed to load default CV data', error);
  } finally {
    requestPdfPreview();
  }
});

const { exportToPdf, renderPreview, revokeDownloads } = usePdfExport();
const inlineRenderSlot = createPreviewRenderSlot();
const anonymizedRenderSlot = createPreviewRenderSlot();
const exportRenderSlot = createPreviewRenderSlot();
const anonymizedExportRenderSlot = createPreviewRenderSlot();
const isExporting = ref(false);
const isAnonymizedExporting = ref(false);
const pdfExportError = ref('');
let previewRenderVersion = 0;
let anonymizedSourceVersion = 0;
let anonymizedPreviewRenderVersion = 0;
let renderedAnonymizedSourceVersion = -1;
let isSliderPreviewUpdateDeferred = false;
let sliderPreviewUpdatePending = false;
let sliderSaveUpdatePending = false;
let textPreviewUpdatePending = false;

function exportMarginMillimeters(design: CvDesign, key: keyof CvDesign) {
  return Math.min(30, Math.max(0, designNumber(design, key)));
}

function getPdfMargins(input: CvDesign = {}) {
  const design = resolveDesign(input);
  return [
    exportMarginMillimeters(design, 'pageMarginTop'),
    exportMarginMillimeters(design, 'pageMarginLeft'),
    exportMarginMillimeters(design, 'pageMarginBottom'),
    exportMarginMillimeters(design, 'pageMarginRight'),
  ];
}

function getPdfRenderOptions(options: RenderOptions = {}) {
  const design = resolveDesign(state.design);
  return {
    margin: getPdfMargins(design),
    continuationTopPadding: exportMarginMillimeters(design, 'headerBottomMargin'),
    sidebarFillMode: design.sidebarFillMode,
    sidebarHeightMode: design.sidebarHeightMode,
    ...options,
  };
}

function getPdfSourceElement() {
  return pdfRenderSource.value?.querySelector<HTMLElement>('.page') || null;
}

function getAnonymizedPdfSourceElement() {
  return anonymizedPdfRenderSource.value?.querySelector<HTMLElement>('.page') || null;
}

const anonymizedState = computed(() => createAnonymizedState(state));

async function refreshPdfPreview(version: number) {
  if (version !== previewRenderVersion) return;
  const signal = inlineRenderSlot.start();
  try {
    await nextTick();
    if (version !== previewRenderVersion) return;

    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const { pages } = await renderPreview(cvElement, getPdfRenderOptions({ signal }));
    if (version !== previewRenderVersion) return;

    previewPages.value = pages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(pages.length, 1));
  } catch (error) {
    if (!signal.aborted && version === previewRenderVersion) console.error('PDF preview failed:', error);
  } finally {
    if (version === previewRenderVersion) isPreviewRendering.value = false;
  }
}

const schedulePdfPreview = debounce((version: number) => refreshPdfPreview(version), 100);

function invalidatePdfPreview() {
  inlineRenderSlot.cancel();
  schedulePdfPreview.cancel();
  return ++previewRenderVersion;
}

function requestPdfPreview() {
  textPreviewUpdatePending = false;
  const version = invalidatePdfPreview();
  isPreviewRendering.value = true;
  schedulePdfPreview(version);
}

async function refreshAnonymizedPdfPreview(renderVersion: number, sourceVersion: number) {
  if (renderVersion !== anonymizedPreviewRenderVersion || sourceVersion !== anonymizedSourceVersion) return;
  const signal = anonymizedRenderSlot.start();
  try {
    await nextTick();
    if (renderVersion !== anonymizedPreviewRenderVersion || sourceVersion !== anonymizedSourceVersion) return;

    const cvElement = getAnonymizedPdfSourceElement();
    if (!cvElement) throw new Error('Anonymized CV preview element not found');
    const { pages } = await renderPreview(cvElement, getPdfRenderOptions({ signal }));
    if (renderVersion !== anonymizedPreviewRenderVersion || sourceVersion !== anonymizedSourceVersion) return;

    anonymizedPreviewPages.value = pages;
    anonymizedPreviewPage.value = Math.min(Math.max(anonymizedPreviewPage.value, 1), Math.max(pages.length, 1));
    renderedAnonymizedSourceVersion = sourceVersion;
  } catch (error) {
    if (!signal.aborted && renderVersion === anonymizedPreviewRenderVersion) console.error('Anonymized PDF preview failed:', error);
  } finally {
    if (renderVersion === anonymizedPreviewRenderVersion) isAnonymizedPreviewRendering.value = false;
  }
}

const scheduleAnonymizedPdfPreview = debounce((renderVersion: number, sourceVersion: number) => (
  refreshAnonymizedPdfPreview(renderVersion, sourceVersion)
), 500);

function requestAnonymizedPdfPreview() {
  if (renderedAnonymizedSourceVersion === anonymizedSourceVersion && anonymizedPreviewPages.value.length) return;
  anonymizedRenderSlot.cancel();
  const renderVersion = ++anonymizedPreviewRenderVersion;
  isAnonymizedPreviewRendering.value = true;
  scheduleAnonymizedPdfPreview(renderVersion, anonymizedSourceVersion);
}

function invalidateAnonymizedPdfPreview({ defer = false } = {}) {
  anonymizedRenderSlot.cancel();
  scheduleAnonymizedPdfPreview.cancel();
  anonymizedPreviewRenderVersion += 1;
  isAnonymizedPreviewRendering.value = false;
  anonymizedSourceVersion += 1;
  anonymizedPreviewPages.value = [];
  anonymizedPreviewPage.value = 1;
  renderedAnonymizedSourceVersion = -1;
  if (!defer && fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
}

function handleVersionDeleted() {
  saveDebounced.cancel();
  isSliderPreviewUpdateDeferred = false;
  sliderSaveUpdatePending = false;
  sliderPreviewUpdatePending = false;
  textPreviewUpdatePending = false;
  invalidatePdfPreview();
  invalidateAnonymizedPdfPreview({ defer: true });
  exportRenderSlot.cancel();
  anonymizedExportRenderSlot.cancel();
  revokeDownloads();
  previewPages.value = [];
  previewPage.value = 1;
  pdfExportError.value = '';
  previewMode.value = false;
  activeBuilderGroup.value = 'versions';
}

onBeforeUnmount(() => {
  invalidatePdfPreview();
  invalidateAnonymizedPdfPreview({ defer: true });
  exportRenderSlot.cancel();
  anonymizedExportRenderSlot.cancel();
  revokeDownloads();
});

const previewDesign = computed(() => Object.keys(state.design || {}).reduce((design, key) => {
  if (key !== 'favoriteControls') Reflect.set(design, key, Reflect.get(state.design, key));
  return design;
}, {}));

const previewState = computed(() => ({
  disabled: state.disabled,
  lang: state.lang,
  // Favorite selection changes only the builder UI, never the CV itself.
  design: previewDesign.value,
  contact: state.contact,
  about: state.about,
  education: state.education,
  experience: state.experience,
  languages: state.languages,
  hobbies: state.hobbies,
  customSections: state.customSections,
  sidebarSections: state.sidebarSections,
  sectionNames: state.sectionNames,
  sectionHeaderSizes: state.sectionHeaderSizes,
  keepTogetherSections: state.keepTogetherSections,
  bodyOrder: state.bodyOrder,
  sidebarOrder: state.sidebarOrder,
}));

const anonymizedPreviewState = computed(() => ({
  ...previewState.value,
  anonymization: state.anonymization,
}));

function isTextEntryInput(element: EventTarget | null) {
  return Boolean(element instanceof Element && element.matches([
    'textarea',
    '[contenteditable="true"]',
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="url"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="password"]',
  ].join(',')));
}

function isRangeInput(element: EventTarget | null) {
  return element instanceof Element && element.matches('input[type="range"]');
}

function onPreviewSliderPointerDown(event: PointerEvent) {
  if (isRangeInput(event.target)) isSliderPreviewUpdateDeferred = true;
}

function commitDeferredSliderPreview() {
  if (!isSliderPreviewUpdateDeferred) return;
  const shouldRefreshPreview = sliderPreviewUpdatePending;
  const shouldSave = sliderSaveUpdatePending;
  isSliderPreviewUpdateDeferred = false;
  sliderPreviewUpdatePending = false;
  sliderSaveUpdatePending = false;

  if (shouldRefreshPreview) {
    requestPdfPreview();
    if (fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
  }
  if (shouldSave) scheduleStateSave();
}

function flushStateSave() {
  if (isSliderPreviewUpdateDeferred && sliderSaveUpdatePending) {
    isSliderPreviewUpdateDeferred = false;
    sliderSaveUpdatePending = false;
    persistState();
    return;
  }
  saveDebounced.flush();
}

onMounted(() => window.addEventListener('pagehide', flushStateSave));
onBeforeUnmount(() => window.removeEventListener('pagehide', flushStateSave));

function onPreviewInputBlur(event: FocusEvent) {
  if (textPreviewUpdatePending && isTextEntryInput(event.target)) requestPdfPreview();
}

watch(previewState, () => {
  if (isSliderPreviewUpdateDeferred) {
    sliderPreviewUpdatePending = true;
    invalidatePdfPreview();
    isPreviewRendering.value = false;
    return;
  }
  if (isTextEntryInput(document.activeElement)) {
    textPreviewUpdatePending = true;
    invalidatePdfPreview();
    isPreviewRendering.value = false;
    return;
  }
  requestPdfPreview();
}, { deep: true, flush: 'post' });

watch(anonymizedPreviewState, () => {
  if (isSliderPreviewUpdateDeferred) {
    sliderPreviewUpdatePending = true;
    invalidateAnonymizedPdfPreview({ defer: true });
    return;
  }
  invalidateAnonymizedPdfPreview();
}, { deep: true, flush: 'post' });

async function handleExportPdf() {
  const signal = exportRenderSlot.start();
  isExporting.value = true;
  pdfExportError.value = '';
  try {
    await nextTick();
    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const filename = `${(state.contact?.name || 'CV').replace(/\s+/g, '_')}_CV`;
    await exportToPdf(cvElement, filename, getPdfRenderOptions({ signal }));
  } catch (error) {
    if (!signal.aborted) pdfExportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isExporting.value = false;
  }
}

async function handleAnonymizedExportPdf() {
  const signal = anonymizedExportRenderSlot.start();
  isAnonymizedExporting.value = true;
  pdfExportError.value = '';
  try {
    await nextTick();
    const cvElement = getAnonymizedPdfSourceElement();
    if (!cvElement) throw new Error('Anonymized CV preview element not found');
    await exportToPdf(cvElement, 'anonymized-cv', getPdfRenderOptions({ signal }));
  } catch (error) {
    if (!signal.aborted) pdfExportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isAnonymizedExporting.value = false;
  }
}

const isAnonymizedFullPreview = computed(() => fullPreviewVariant.value === 'anonymized');
const activeFullPreviewPages = computed(() => (
  isAnonymizedFullPreview.value
    ? anonymizedPreviewPages.value
    : previewPages.value
));
const activeFullPreviewPage = computed({
  get: () => (isAnonymizedFullPreview.value ? anonymizedPreviewPage.value : previewPage.value),
  set: (value) => {
    if (isAnonymizedFullPreview.value) anonymizedPreviewPage.value = value;
    else previewPage.value = value;
  },
});
const isActiveFullPreviewRendering = computed(() => (
  isAnonymizedFullPreview.value ? isAnonymizedPreviewRendering.value : isPreviewRendering.value
));

function toggleAnonymizedFullPreview() {
  fullPreviewVariant.value = isAnonymizedFullPreview.value ? 'normal' : 'anonymized';
  if (fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
}

function openFullPreview() {
  flushStateSave();
  if (formBuilder.value?.flushSectionSaves() === false) return;
  previewMode.value = true;
  if (isAnonymizedFullPreview.value) requestAnonymizedPdfPreview();
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode }" @focusout="onPreviewInputBlur" @pointerdown.capture="onPreviewSliderPointerDown" @pointerup.capture="commitDeferredSliderPreview" @pointercancel.capture="commitDeferredSliderPreview">
    <div v-if="pdfExportError" class="pdf-export-error" role="alert">
      <span>{{ pdfExportError }}</span>
      <button class="mini" type="button" :aria-label="t('close')" @click="pdfExportError = ''">×</button>
    </div>
    <div ref="pdfRenderSource" class="pdf-render-source" aria-hidden="true">
      <CvPreview :state="state" export-source />
    </div>
    <div ref="anonymizedPdfRenderSource" class="pdf-render-source" aria-hidden="true">
      <CvPreview :state="anonymizedState" export-source anonymized />
    </div>

    <section v-if="previewMode" class="fullscreen-preview" aria-label="CV preview">
      <button class="btn fullscreen-preview__back" type="button" @click="previewMode = false">
        <font-awesome-icon :icon="['fas', 'arrow-left']" />
        {{ t('backToBuilder') }}
      </button>

      <div class="fullscreen-preview__actions">
        <button class="btn" type="button" :aria-pressed="fullPreviewView === 'html'" @click="fullPreviewView = fullPreviewView === 'pdf' ? 'html' : 'pdf'">
          <font-awesome-icon :icon="['fas', fullPreviewView === 'pdf' ? 'code' : 'file-pdf']" />
          {{ fullPreviewView === 'pdf' ? t('showHtmlPreview') : t('showPdfPreview') }}
        </button>
        <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
          <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
          <font-awesome-icon v-else :icon="['fas', 'download']" />
          {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
        </button>
        <span class="fullscreen-preview__actions-spacer" aria-hidden="true" />
        <button class="btn" type="button" :aria-pressed="isAnonymizedFullPreview" @click="toggleAnonymizedFullPreview">
          <font-awesome-icon :icon="['fas', 'user-secret']" />
          {{ isAnonymizedFullPreview ? t('showNormalPreview') : t('showAnonymizedPreview') }}
        </button>
        <button class="btn btn--primary" type="button" @click="handleAnonymizedExportPdf" :disabled="isAnonymizedExporting">
          <font-awesome-icon v-if="isAnonymizedExporting" :icon="['fas', 'spinner']" spin />
          <font-awesome-icon v-else :icon="['fas', 'user-secret']" />
          {{ isAnonymizedExporting ? t('exportingAnonymizedPdf') : t('downloadAnonymizedPdf') }}
        </button>
      </div>

      <div class="fullscreen-preview__content">
        <PdfPreview v-if="fullPreviewView === 'pdf'" v-model:page="activeFullPreviewPage" :pages="activeFullPreviewPages" :is-updating="isActiveFullPreviewRendering" :lang="lang" gesture-navigation />
        <div v-else class="html-preview"><CvPreview :state="isAnonymizedFullPreview ? anonymizedState : state" :anonymized="isAnonymizedFullPreview" /></div>
      </div>
      <PdfPagination v-if="fullPreviewView === 'pdf'" v-model:page="activeFullPreviewPage" :pages="activeFullPreviewPages" :lang="lang" fullscreen />
    </section>

    <section v-else class="builder-shell">
      <header class="builder-topbar">
        <nav class="builder-topbar__tabs" role="tablist" :aria-label="t('content')">
          <button
            v-for="group in builderGroups"
            :key="group.key"
            class="builder-topbar__tab"
            :class="{ 'is-active': activeBuilderGroup === group.key }"
            type="button"
            role="tab"
            :aria-selected="activeBuilderGroup === group.key"
            :aria-controls="`builder-group-${group.key}`"
            :disabled="isEmptyDocument && group.key !== 'versions'"
            @click="activeBuilderGroup = group.key"
          >
            <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
            <span>{{ group.label }}</span>
          </button>
        </nav>

        <div class="builder-topbar__utilities">
          <button class="builder-topbar__language-toggle" type="button" :class="{ 'is-on': lang === 'en' }" :aria-label="t('language')" @click="toggleLanguage">
            <span class="builder-topbar__language-track"><span>DE</span><span>EN</span><span class="builder-topbar__language-thumb"></span></span>
          </button>
          <label class="builder-topbar__configuration">
            <font-awesome-icon :icon="['fas', 'layer-group']" aria-hidden="true" />
            <select :value="isBuiltinDocument(selectedConfigurationId) ? '' : selectedConfigurationId" :aria-label="t('versions')" @change="selectConfiguration">
              <option v-if="!selectedConfigurationId || isBuiltinDocument(selectedConfigurationId)" value="" disabled>{{ t('noSavedVersion') }}</option>
              <option v-for="configuration in selectableConfigurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option>
            </select>
          </label>
          <output class="builder-topbar__save-status" :class="`is-${combinedSaveStatus}`" aria-live="polite">
            <font-awesome-icon :icon="['fas', saveStatusIcon]" :spin="combinedSaveStatus === 'saving'" />
            {{ saveStatusLabel }}
          </output>
        </div>
      </header>

      <section class="builder-layout" :class="`builder-layout--${previewPlacement}`">
        <div class="builder-layout__controls">
          <Transition name="builder-group">
            <BackupManager
              v-show="activeBuilderGroup === 'versions'"
              id="builder-group-versions"
              ref="backupManager"
              class="builder-group-panel"
              :state="state"
              :lang="lang"
              :selected-id="selectedConfigurationId"
              :on-save="scheduleStateSave"
              :on-load="mergeIn"
              :before-load="prepareConfigurationChange"
              @update:selected-id="selectedConfigurationId = $event"
              @configs-change="savedConfigurations = $event"
              @save-result="handleConfigurationSaveResult"
              @version-deleted="handleVersionDeleted"
            />
          </Transition>
          <Transition name="builder-group">
            <FormBuilder v-show="activeBuilderGroup === 'content' && !isEmptyDocument" id="builder-group-content" ref="formBuilder" class="builder-group-panel" :state="state" :configurations="selectableConfigurations" :selected-id="selectedConfigurationId" :read-version="readSectionVersion" :save-version="saveSectionVersion" @section-save-status="sectionSaveStatus = $event" />
          </Transition>
          <Transition name="builder-group">
            <DesignPanel
              v-show="activeBuilderGroup === 'design' && !isEmptyDocument"
              id="builder-group-design"
              class="builder-group-panel"
              v-model="state.design"
              :lang="lang"
            />
          </Transition>
          <Transition name="builder-group">
            <AnonymizationPanel
              v-show="activeBuilderGroup === 'privacy' && !isEmptyDocument"
              id="builder-group-privacy"
              class="builder-group-panel"
              :state="state"
              :is-exporting="isAnonymizedExporting"
              :lang="lang"
              @export="handleAnonymizedExportPdf"
            />
          </Transition>
        </div>

        <aside class="inline-preview" :aria-label="t('liveCvPreview')">
        <div class="inline-preview__actions">
          <button class="btn" type="button" @click="openFullPreview">{{ t('openPreview') }}</button>
          <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
            <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
            {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
          </button>
        </div>
        <div class="inline-preview__viewport">
          <div class="inline-preview__scroll">
            <PdfPreview v-model:page="previewPage" :pages="previewPages" :is-updating="isPreviewRendering" :lang="lang" gesture-navigation />
            <div class="inline-preview__pagination">
              <PdfPagination v-model:page="previewPage" :pages="previewPages" :lang="lang" />
            </div>
          </div>
          <button
            class="mini inline-preview__placement-toggle"
            type="button"
            :aria-pressed="previewPlacement === 'below'"
            :aria-label="previewPlacement === 'side' ? t('movePreviewBelow') : t('movePreviewSide')"
            :title="previewPlacement === 'side' ? t('movePreviewBelow') : t('movePreviewSide')"
            @click="previewPlacement = previewPlacement === 'side' ? 'below' : 'side'"
          >
            <font-awesome-icon :icon="['fas', previewPlacement === 'side' ? 'arrow-down' : 'arrow-right']" />
          </button>
        </div>
        </aside>
      </section>
    </section>
  </main>
</template>

<style>
.pdf-export-error {
  position: fixed;
  z-index: 10000;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid #a94444;
  border-radius: 8px;
  background: #311b23;
  color: #fee2e2;
  font: 14px/1.4 system-ui, sans-serif;
}
.pdf-export-error .mini { flex: 0 0 auto; margin-left: auto; }

html,
body,
#app {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.cv-builder-app {
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  padding: 24px;
  overflow: hidden;
  overscroll-behavior: none;
}

.cv-builder-app.is-preview-mode {
  overflow: auto;
}

.pdf-render-source {
  position: fixed;
  top: 0;
  left: -240mm;
  pointer-events: none;
}

.builder-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  max-width: 1540px;
  margin: 0 auto;
  overflow: hidden;
}

.builder-topbar {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  border: 1px solid #113c34;
  border-radius: 12px;
  background: rgba(6, 20, 31, .96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
  backdrop-filter: blur(12px);
}

.builder-topbar__tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(76px, 1fr));
  gap: 8px;
  min-width: 0;
}

.builder-topbar__tab {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  min-height: 66px;
  padding: 8px;
  border: 1px solid #134e4a;
  border-radius: 9px;
  background: #06141f;
  color: #9bb3ad;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  transition: border-color .2s ease, background .2s ease, color .2s ease, transform .2s ease, box-shadow .2s ease;
}

.builder-topbar__tab .svg-inline--fa { font-size: 17px; }
.builder-topbar__tab:hover,
.builder-topbar__tab:focus-visible { border-color: #2a6a60; background: #0a1c26; color: #d1fae5; }
.builder-topbar__tab:focus-visible { outline: 2px solid #9be8c7; outline-offset: 2px; }
.builder-topbar__tab.is-active { border-color: #27f3a2; background: rgba(16, 185, 129, .16); color: #d1fae5; box-shadow: inset 0 0 0 1px rgba(39, 243, 162, .18); }
.builder-topbar__tab:active { transform: translateY(1px); }
.builder-topbar__tab:disabled { opacity: .4; cursor: not-allowed; border-color: transparent; background: transparent; color: #94a3b8; box-shadow: none; transform: none; }

.builder-topbar__utilities {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.builder-topbar__configuration {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #9be8c7;
}

.builder-topbar__configuration select { width: min(190px, 22vw); min-width: 128px; }
.builder-topbar__language-toggle { border: 0; padding: 0; background: transparent; cursor: pointer; }
.builder-topbar__language-track { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 72px; height: 30px; border: 1px solid #134e4a; border-radius: 999px; background: #06141f; color: #cbd5e1; font-size: 10px; }
.builder-topbar__language-track > span:not(.builder-topbar__language-thumb) { z-index: 1; display: grid; place-items: center; }
.builder-topbar__language-thumb { position: absolute; inset: 2px calc(50% + 1px) 2px 2px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 999px; background: rgba(255, 255, 255, .12); transition: inset .2s ease; }
.builder-topbar__language-toggle.is-on .builder-topbar__language-thumb { inset: 2px 2px 2px calc(50% + 1px); }
.builder-topbar__language-toggle.is-on .builder-topbar__language-track { border-color: rgba(16, 185, 129, .45); background: rgba(16, 185, 129, .15); }
.builder-topbar__language-toggle:focus-visible { outline: 2px solid #9be8c7; outline-offset: 2px; border-radius: 999px; }
.builder-topbar__save-status { display: inline-flex; align-items: center; gap: 6px; min-width: 88px; color: #9be8c7; font-size: 11px; white-space: nowrap; }
.builder-topbar__save-status.is-saving { color: #f0cd86; }
.builder-topbar__save-status.is-error { color: #fca5a5; }

.builder-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  align-items: stretch;
  gap: 20px;
  height: 100%;
  min-height: 0;
  margin: 0;
  max-width: none;
  overflow: hidden;
}

.builder-layout__controls {
  position: relative;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  gap: 0;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  isolation: isolate;
}

.builder-layout__controls .builder-group-panel {
  display: flex;
  flex-direction: column;
  grid-area: 1 / 1;
  align-self: start;
  width: 100%;
  height: auto;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.builder-group-panel > .group-panel__scroll-body,
.builder-group-panel > .editor-panel__body,
.builder-group-panel > .design-panel__scroll-body,
.builder-group-panel .content-panel__scroll-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.builder-group-panel > .content-panel {
  flex: 1 1 auto;
  min-height: 0;
}

.builder-group-panel > .group-panel__scroll-body::-webkit-scrollbar,
.builder-group-panel > .editor-panel__body::-webkit-scrollbar,
.builder-group-panel > .design-panel__scroll-body::-webkit-scrollbar,
.builder-group-panel .content-panel__scroll-body::-webkit-scrollbar {
  display: none;
}

.builder-group-enter-active, .builder-group-leave-active { transition: opacity .22s ease; }
.builder-group-enter-active { position: relative; z-index: 1; }
.builder-group-leave-active {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  pointer-events: none;
}
.builder-group-enter-from, .builder-group-leave-to { opacity: 0; }

.builder-layout--below {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.builder-layout--below::-webkit-scrollbar { display: none; }

.builder-layout--below .builder-layout__controls {
  flex: 0 0 auto;
  height: auto;
  overflow: visible;
  grid-template-rows: auto;
}

.builder-layout--below .builder-layout__controls .builder-group-panel {
  height: auto;
  max-height: none;
  overflow: visible;
}

.builder-layout--below .builder-group-panel > .group-panel__scroll-body,
.builder-layout--below .builder-group-panel > .editor-panel__body,
.builder-layout--below .builder-group-panel > .design-panel__scroll-body,
.builder-layout--below .builder-group-panel .content-panel__scroll-body {
  overflow: visible;
}

.builder-layout--below .inline-preview {
  position: relative;
  top: auto;
  flex: 0 0 auto;
  align-self: center;
  width: min(100%, 680px);
  height: auto;
  overflow: visible;
}

.builder-layout--below .inline-preview__viewport,
.builder-layout--below .inline-preview__scroll {
  height: auto;
  overflow: visible;
}

.inline-preview {
  position: relative;
  top: auto;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.inline-preview__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: min(100%, 794px);
  justify-self: center;
}

.inline-preview__actions .btn { width: 100%; }

.inline-preview__viewport {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.inline-preview__scroll {
  display: block;
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}


.inline-preview .pdf-preview {
  width: min(100%, 794px);
  margin: 0 auto;
}

.inline-preview .pdf-preview__stage {
  display: block;
  min-height: 0;
  overflow: visible;
  border-radius: 0;
  background: transparent;
}

.inline-preview .pdf-preview__page {
  width: 100%;
  height: auto;
  max-width: 794px;
  box-shadow: none;
}

.inline-preview__placement-toggle {
  position: absolute;
  z-index: 2;
  bottom: 10px;
  left: 50%;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity .16s ease;
}

.inline-preview:hover .inline-preview__placement-toggle,
.inline-preview:focus-within .inline-preview__placement-toggle {
  opacity: 1;
  pointer-events: auto;
}

.inline-preview__pagination {
  min-width: 0;
  width: min(100%, 794px);
  margin: 10px auto 0;
  justify-self: center;
}

.fullscreen-preview {
  position: relative;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 84px 16px 32px;
}

.fullscreen-preview__content { display: grid; width: min(100%, 860px); justify-items: center; }
.html-preview { width: min(100%, 210mm); overflow: auto; background: #fff; }

.fullscreen-preview__back,
.fullscreen-preview__actions {
  position: fixed;
  z-index: 30;
  top: 20px;
}

.fullscreen-preview__back {
  left: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.fullscreen-preview__actions {
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.fullscreen-preview__actions-spacer { height: 4px; }
.fullscreen-preview__actions .btn { display: inline-flex; align-items: center; gap: 8px; }

@media (max-width: 1180px) {
  .cv-builder-app {
    padding-right: 24px;
  }

  .builder-topbar { grid-template-columns: 1fr; }
  .builder-topbar__utilities { justify-content: space-between; }

  .builder-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(260px, 42vh);
  }

  .inline-preview {
    position: relative;
    top: auto;
    width: min(100%, 520px);
    height: 100%;
    justify-self: center;
  }
}

@media (max-width: 760px) {
  .cv-builder-app {
    padding: 16px;
  }

  .builder-topbar { padding: 8px; }
  .builder-topbar__tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .builder-topbar__tab { min-height: 56px; font-size: 10px; }
  .builder-topbar__utilities { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .builder-topbar__configuration select { width: 100%; }
  .builder-topbar__save-status { grid-column: 1 / -1; justify-content: center; }

  .fullscreen-preview {
    min-height: 100dvh;
    justify-content: flex-start;
    overflow-x: auto;
    padding: 72px 12px 20px;
  }

  .fullscreen-preview__back,
  .fullscreen-preview__actions { top: 12px; }
  .fullscreen-preview__back { left: 12px; }
  .fullscreen-preview__actions { right: 12px; }
  .fullscreen-preview__back .svg-inline--fa,
  .fullscreen-preview__actions .svg-inline--fa { margin: 0; }
  .fullscreen-preview__back { font-size: 0; padding: 10px; }
  .fullscreen-preview__back .svg-inline--fa { font-size: 14px; }
  .fullscreen-preview__actions .btn { font-size: 0; padding: 10px; }
  .fullscreen-preview__actions .btn .svg-inline--fa { font-size: 14px; }

}

</style>
