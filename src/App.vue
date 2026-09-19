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
import SupabaseAuth from './components/SupabaseAuth.vue';
import JobWorkspace from './components/JobWorkspace.vue';
import { useSupabaseAuth } from './composables/useSupabaseAuth';

const state = reactive<CvState>(createEmptyDocument());
const { user: cloudUser, client: supabaseClient } = useSupabaseAuth();

const lang = computed({
  get: () => state.lang,
  set: (value) => { state.lang = value; },
});
const previewMode = ref(false);
const fullPreviewView = ref('pdf');
const mobileViewport = window.matchMedia('(max-width: 760px)');
const isMobile = ref(mobileViewport.matches);
const showPdfFullPreview = computed(() => isMobile.value || fullPreviewView.value === 'pdf');
function syncMobileViewport() {
  isMobile.value = mobileViewport.matches;
}
onMounted(() => mobileViewport.addEventListener('change', syncMobileViewport));
onBeforeUnmount(() => mobileViewport.removeEventListener('change', syncMobileViewport));
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
const isCloudTab = computed(() => Boolean(cloudUser.value) && ['opportunities', 'applications'].includes(activeBuilderGroup.value));
const cloudTab = computed(() => activeBuilderGroup.value === 'applications' ? 'applications' : 'opportunities');
watch(cloudUser, (user) => {
  if (!user && ['opportunities', 'applications'].includes(activeBuilderGroup.value)) activeBuilderGroup.value = 'versions';
});
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
  ...(cloudUser.value ? [
    { key: 'opportunities', label: lang.value === 'de' ? 'Stellenangebote' : 'Opportunities', icon: 'briefcase' },
    { key: 'applications', label: lang.value === 'de' ? 'Bewerbungen' : 'Applications', icon: 'envelope' },
  ] : []),
]);
function groupDisabled(key: string) {
  return isEmptyDocument.value && ['content', 'design', 'privacy'].includes(key);
}
function readCloudVersion(id: string): CvState | null {
  flushStateSave();
  if (formBuilder.value?.flushSectionSaves() === false || saveStatus.value === 'error') return null;
  if (id === selectedConfigurationId.value) return JSON.parse(JSON.stringify(state));
  return backupManager.value?.readConfigData(id) || null;
}
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
const fullPreviewMode = computed({
  get: () => fullPreviewView.value === 'html' ? 'html' : fullPreviewVariant.value,
  set: (mode: string) => {
    fullPreviewView.value = mode === 'html' ? 'html' : 'pdf';
    fullPreviewVariant.value = mode === 'anonymized' ? 'anonymized' : 'normal';
    if (mode === 'anonymized') requestAnonymizedPdfPreview();
  },
});
const isActiveFullPreviewExporting = computed(() => isAnonymizedFullPreview.value ? isAnonymizedExporting.value : isExporting.value);
const activeFullPreviewDownloadLabel = computed(() => isAnonymizedFullPreview.value
  ? t(isAnonymizedExporting.value ? 'exportingAnonymizedPdf' : 'downloadAnonymizedPdf')
  : t(isExporting.value ? 'exportingPdf' : 'downloadPdf'));

function exportActiveFullPreview() {
  return isAnonymizedFullPreview.value ? handleAnonymizedExportPdf() : handleExportPdf();
}

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
  fullPreviewMode.value = isAnonymizedFullPreview.value ? 'normal' : 'anonymized';
}

function openFullPreview() {
  flushStateSave();
  if (formBuilder.value?.flushSectionSaves() === false) return;
  previewMode.value = true;
  if (isAnonymizedFullPreview.value) requestAnonymizedPdfPreview();
}

function selectBuilderGroup(group: string) {
  activeBuilderGroup.value = group;
  previewMode.value = false;
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode, 'has-content-toolbar': !previewMode && activeBuilderGroup === 'content' && !isEmptyDocument }" @focusout="onPreviewInputBlur" @pointerdown.capture="onPreviewSliderPointerDown" @pointerup.capture="commitDeferredSliderPreview" @pointercancel.capture="commitDeferredSliderPreview">
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

    <section v-if="previewMode" id="builder-group-preview" class="fullscreen-preview" :aria-label="t('liveCvPreview')">
      <button class="btn fullscreen-preview__back" type="button" @click="previewMode = false">
        <font-awesome-icon :icon="['fas', 'arrow-left']" />
        {{ t('backToBuilder') }}
      </button>

      <div v-if="isMobile" class="fullscreen-preview__actions fullscreen-preview__actions--mobile">
        <button class="btn" type="button" :aria-label="isAnonymizedFullPreview ? t('showNormalPreview') : t('showAnonymizedPreview')" :aria-pressed="isAnonymizedFullPreview" @click="toggleAnonymizedFullPreview">
          <font-awesome-icon :icon="['fas', isAnonymizedFullPreview ? 'user-secret' : 'eye']" aria-hidden="true" />
          <span>{{ isAnonymizedFullPreview ? t('privacyPreview') : t('normalPreview') }}</span>
        </button>
        <button class="btn btn--primary" type="button" :aria-label="activeFullPreviewDownloadLabel" :title="activeFullPreviewDownloadLabel" :disabled="isActiveFullPreviewExporting" @click="exportActiveFullPreview">
          <font-awesome-icon :icon="['fas', isActiveFullPreviewExporting ? 'spinner' : 'download']" :spin="isActiveFullPreviewExporting" aria-hidden="true" />
          <span>{{ isActiveFullPreviewExporting ? t('exportingPdf') : t('downloadPdf') }}</span>
        </button>
      </div>
      <div v-else class="fullscreen-preview__actions">
        <select v-model="fullPreviewMode" :aria-label="t('previewFormat')">
          <option value="normal">{{ t('normalPdf') }}</option>
          <option value="anonymized">{{ t('privacyPdf') }}</option>
          <option value="html">{{ t('rawHtml') }}</option>
        </select>
        <button class="btn btn--primary" type="button" :aria-label="activeFullPreviewDownloadLabel" :title="activeFullPreviewDownloadLabel" :disabled="isActiveFullPreviewExporting" @click="exportActiveFullPreview">
          <font-awesome-icon :icon="['fas', isActiveFullPreviewExporting ? 'spinner' : 'download']" :spin="isActiveFullPreviewExporting" aria-hidden="true" />
          {{ isActiveFullPreviewExporting ? t('exportingPdf') : t('downloadPdf') }}
        </button>
      </div>

      <div class="fullscreen-preview__content">
        <PdfPreview v-if="showPdfFullPreview" v-model:page="activeFullPreviewPage" :pages="activeFullPreviewPages" :is-updating="isActiveFullPreviewRendering" :lang="lang" gesture-navigation :pinch-zoom="isMobile" :key="fullPreviewVariant" />
        <div v-else class="html-preview"><CvPreview :state="isAnonymizedFullPreview ? anonymizedState : state" :anonymized="isAnonymizedFullPreview" /></div>
      </div>
      <PdfPagination v-if="showPdfFullPreview" v-model:page="activeFullPreviewPage" :pages="activeFullPreviewPages" :lang="lang" fullscreen />
    </section>

    <section v-show="!previewMode" class="builder-shell">
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
            :disabled="groupDisabled(group.key)"
            @click="selectBuilderGroup(group.key)"
          >
            <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
            <span>{{ group.label }}</span>
          </button>
        </nav>

        <div class="builder-topbar__utilities">
          <SupabaseAuth class="builder-topbar__auth" :lang="lang === 'de' ? 'de' : 'en'" />
          <label class="builder-topbar__configuration">
            <font-awesome-icon :icon="['fas', 'layer-group']" aria-hidden="true" />
            <select :value="isBuiltinDocument(selectedConfigurationId) ? '' : selectedConfigurationId" :aria-label="t('versions')" @change="selectConfiguration">
              <option v-if="!selectedConfigurationId || isBuiltinDocument(selectedConfigurationId)" value="" disabled>{{ t('noSavedVersion') }}</option>
              <option v-for="configuration in selectableConfigurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option>
            </select>
          </label>
          <button
            class="mini builder-topbar__placement-toggle"
            type="button"
            :aria-pressed="previewPlacement === 'below'"
            :aria-label="previewPlacement === 'side' ? t('movePreviewBelow') : t('movePreviewSide')"
            :title="previewPlacement === 'side' ? t('movePreviewBelow') : t('movePreviewSide')"
            @click="previewPlacement = previewPlacement === 'side' ? 'below' : 'side'"
          >
            <font-awesome-icon :icon="['fas', previewPlacement === 'side' ? 'arrow-down' : 'arrow-right']" />
          </button>
          <output class="builder-topbar__save-status" :class="`is-${combinedSaveStatus}`" aria-live="polite">
            <font-awesome-icon :icon="['fas', saveStatusIcon]" :spin="combinedSaveStatus === 'saving'" />
            {{ saveStatusLabel }}
          </output>
        </div>
      </header>

      <JobWorkspace
        v-if="cloudUser"
        v-show="isCloudTab"
        :key="cloudUser.id"
        :client="supabaseClient"
        :user-id="cloudUser.id"
        :tab="cloudTab"
        :lang="lang"
        :configurations="selectableConfigurations"
        :selected-id="selectedConfigurationId"
        :read-version="readCloudVersion"
        @navigate="selectBuilderGroup"
      />

      <section v-show="!isCloudTab" class="builder-layout" :class="`builder-layout--${isMobile ? 'side' : previewPlacement}`">
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
              @toggle-language="toggleLanguage"
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

        <aside v-if="!isMobile" class="inline-preview" :aria-label="t('liveCvPreview')">
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
        </div>
        </aside>
      </section>
    </section>

    <nav class="mobile-bottom-tabs" role="tablist" :aria-label="t('builderNavigation')">
      <button
        v-for="group in builderGroups"
        :key="group.key"
        class="builder-topbar__tab"
        :class="{ 'is-active': !previewMode && activeBuilderGroup === group.key }"
        type="button"
        role="tab"
        :aria-selected="!previewMode && activeBuilderGroup === group.key"
        :aria-controls="`builder-group-${group.key}`"
        :disabled="groupDisabled(group.key)"
        @click="selectBuilderGroup(group.key)"
      >
        <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
        <span>{{ group.label }}</span>
      </button>
      <button
        class="builder-topbar__tab"
        :class="{ 'is-active': previewMode }"
        type="button"
        role="tab"
        :aria-selected="previewMode"
        aria-controls="builder-group-preview"
        :disabled="isEmptyDocument"
        @click="openFullPreview"
      >
        <font-awesome-icon :icon="['fas', 'eye']" aria-hidden="true" />
        <span>{{ t('preview') }}</span>
      </button>
    </nav>
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

.mobile-bottom-tabs { display: none; }

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
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
}

.builder-topbar__tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(76px, 1fr);
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  padding: 6px 12px;
  border: 1px solid #113c34;
  border-radius: 9px;
  background: #06141f;
}

.builder-topbar__configuration {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: #9be8c7;
}

.builder-topbar__configuration select { width: 100%; min-width: 0; }
.builder-topbar__placement-toggle { display: grid; place-items: center; width: 32px; height: 32px; }
.builder-topbar__save-status { display: inline-flex; grid-column: 1 / -1; justify-self: center; align-items: center; gap: 6px; color: #9be8c7; font-size: 11px; white-space: nowrap; }
.builder-topbar__save-status.is-saving { color: #f0cd86; }
.builder-topbar__save-status.is-error { color: #fca5a5; }
.builder-topbar__auth { grid-column: 1 / -1; }

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

.builder-layout__controls .builder-group-panel:has(.content-mode-toolbar),
.builder-layout__controls .anonymization-panel { height: 100%; }

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

.builder-layout__controls .builder-group-panel > .content-panel {
  display: flex;
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
  flex: 0 0 100%;
}

.builder-layout--below .inline-preview {
  flex: none;
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

.fullscreen-preview__actions select { min-height: 36px; }
.fullscreen-preview__actions .btn { display: inline-flex; justify-content: center; align-items: center; gap: 8px; }

@media (max-width: 1180px) {
  .cv-builder-app {
    padding-right: 24px;
  }

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
    --mobile-tabs-height: calc(72px + env(safe-area-inset-bottom, 0px));
    --mobile-content-toolbar-height: 60px;
    --mobile-content-toolbar-space: 0px;
    padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) calc(var(--mobile-tabs-height) + var(--mobile-content-toolbar-space) + 12px) max(12px, env(safe-area-inset-left, 0px));
  }

  .cv-builder-app.has-content-toolbar { --mobile-content-toolbar-space: var(--mobile-content-toolbar-height); }
  .cv-builder-app.is-preview-mode { overflow: hidden; }
  .builder-topbar { display: block; }
  .builder-topbar__tabs { display: none; }
  .builder-topbar__utilities { display: block; padding: 6px 8px; }
  .builder-topbar__utilities > :not(.builder-topbar__auth) { display: none; }
  .builder-shell { grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  .builder-layout { grid-template-rows: minmax(0, 1fr); gap: 0; }
  .inline-preview { display: none; }

  .mobile-bottom-tabs {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(66px, 1fr);
    overflow-x: auto;
    gap: 4px;
    height: var(--mobile-tabs-height);
    padding: 8px max(8px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
    border-top: 1px solid #134e4a;
    background: #06141f;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, .2);
  }
  .mobile-bottom-tabs .builder-topbar__tab { min-width: 0; min-height: 0; padding: 4px 2px; gap: 5px; font-size: 10px; border: none; }
  .mobile-bottom-tabs .builder-topbar__tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pdf-export-error { bottom: calc(var(--mobile-tabs-height) + var(--mobile-content-toolbar-space) + 12px); }

  .fullscreen-preview {
    display: grid;
    grid-template-rows: 52px minmax(0, 1fr) 52px;
    gap: 8px;
    height: 100%;
    min-height: 0;
    min-width: 0;
    justify-content: stretch;
    overflow: hidden;
    padding: 0;
  }

  .fullscreen-preview__back { display: none; }
  .fullscreen-preview__actions--mobile { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .fullscreen-preview__actions--mobile .btn { justify-content: center; min-width: 0; min-height: 44px; padding: 6px; font-size: clamp(11px, 3vw, 13px); line-height: 1.2; }
  .fullscreen-preview__actions--mobile .btn .svg-inline--fa { flex: none; margin: 0; font-size: 16px; }
  .fullscreen-preview__content { container-type: size; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
  .fullscreen-preview .pdf-preview,
  .fullscreen-preview .pdf-preview__stage { height: 100%; min-height: 0; }
  .fullscreen-preview .pdf-preview__stage { background: transparent; }
  .fullscreen-preview .pdf-preview__page { width: min(100cqw, calc(100cqh * 210 / 297), 794px); }

}

</style>
