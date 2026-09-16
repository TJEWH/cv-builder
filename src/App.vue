<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { debounce, loadLocal, saveLocal } from './composables/useStorage';
import { useCvDesign } from './composables/useCvDesign';
import { usePdfExport } from './composables/usePdfExport';
import FormBuilder from './components/FormBuilder.vue';
import CvPreview from './components/CvPreview.vue';
import PdfPreview from './components/PdfPreview.vue';
import PdfPagination from './components/PdfPagination.vue';
import BackupManager from './components/BackupManager.vue';
import DesignPanel from './components/DesignPanel.vue';
import ExportOptionsPanel from './components/ExportOptionsPanel.vue';
import AnonymizationPanel from './components/AnonymizationPanel.vue';
import { makeT } from './i18n/dict';
import { normalizeContentState } from './composables/contentLayout';
import { createAnonymizedState } from './composables/anonymization';
import {
  DEFAULT_EXPORT_OPTIONS,
  formatPdfBytes,
  normalizeExportOptions,
} from './composables/pdfImageEncoding';
import {
  createPdfSizeLayerInfo,
  estimatePdfSizeFromLayerCache,
  loadPdfSizeEstimateCache,
  needsPdfSizeGroundTruth,
  recordPdfSizeMeasurement,
  savePdfSizeEstimateCache,
} from './composables/pdfSizeEstimateCache';

const state = reactive({
  version: 7,
  disabled: [],
  completedSections: [],
  lang: 'de',
  design: {
    h1: '22pt', h2: '12pt', h3: '10pt', bullets: '10.5pt',
    ink: '#111827', graphicOpacity: 100, dateOpacity: 100,
    fontBody: 'Inter', fontHead: 'Inter', hstyle: 'clean', radius: '10px',
    badgeMode: 'solid', badgeBorderWidth: '1px', badgeBorderRadius: '6px',
    itemBorderWidth: '1px',
    sectionSpacing: '6mm', sectionSpacingBody: '6mm', sectionSpacingSidebar: '6mm',
    sidebarWidth: '0.7fr', sidebarAlign: 'right', sidebarFillMode: 'start', headerLayoutStyle: 'separator', sidebarLayoutStyle: 'separator', contactLayout: 'side', separatorWidth: '1px',
    pageMarginTop: '0mm', pageMarginRight: '0mm', pageMarginBottom: '0mm', pageMarginLeft: '0mm', pageMarginHorizontalLinked: true,
    headerPaddingVertical: '12mm', headerPaddingHorizontal: '12mm',
    contentPaddingVertical: '12mm', contentPaddingHorizontal: '12mm',
    headerContentPaddingVerticalLinked: true, headerContentPaddingHorizontalLinked: true,
    bodySidebarSpacing: '10mm',
  },
  exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
  anonymization: { excludedSections: [], excludedItems: [] },
  contact: { name: '', location: '', role: '', email: '', phone: '', website: '', linkedin: '', github: '' },
  about: { text: '' },
  education: [],
  experience: { jobs: [] },
  languages: [],
  hobbies: [{ name: 'Musik' }],
  customSections: [],
  sidebarSections: [],
  sectionNames: {},
  sectionHeaderSizes: {},
  softSkills: [
    { label: 'Anpassungsfähigkeit', desc: '', refs: [] },
    { label: 'Kritisches Denken', desc: '', refs: [] },
    { label: 'Kreative Problemlösung', desc: '', refs: [] },
  ],
  bodyOrder: ['about', 'education', 'jobs'],
  sidebarOrder: ['languages', 'hobbies'],
});

const lang = computed({
  get: () => state.lang ?? 'de',
  set: (value) => { state.lang = value; },
});
const previewMode = ref(false);
const fullPreviewView = ref('pdf');
const previewPlacement = ref('side');
const previewPages = ref([]);
const previewPage = ref(1);
const isPreviewRendering = ref(true);
const fullPreviewPages = ref([]);
const isFullPreviewRendering = ref(false);
const pdfRenderSource = ref(null);
const anonymizedPreviewPages = ref([]);
const anonymizedPreviewPage = ref(1);
const isAnonymizedPreviewRendering = ref(false);
const anonymizedPdfRenderSource = ref(null);
const fullPreviewVariant = ref('normal');
const t = makeT(lang);

const saveDebounced = debounce(() => saveLocal(JSON.parse(JSON.stringify(state))), 250);
watch(state, saveDebounced, { deep: true });
useCvDesign(() => state.design);

function ensureDesignLayoutDefaults() {
  state.design ||= {};
  const legacyLayoutStyle = state.design.layoutStyle === 'separator' ? 'separator' : 'boxed';
  const defaults = {
    ink: '#111827',
    graphicOpacity: 100,
    dateOpacity: 100,
    hstyle: 'clean',
    sidebarFillMode: 'start',
    headerLayoutStyle: legacyLayoutStyle,
    sidebarLayoutStyle: legacyLayoutStyle,
    contactLayout: 'side',
    separatorWidth: '1px',
    pageMarginTop: '0mm',
    pageMarginRight: '0mm',
    pageMarginBottom: '0mm',
    pageMarginLeft: '0mm',
    headerPaddingVertical: '12mm',
    headerPaddingHorizontal: '12mm',
    contentPaddingVertical: '12mm',
    contentPaddingHorizontal: '12mm',
    bodySidebarSpacing: '10mm',
    badgeMode: 'solid',
    badgeBorderWidth: '1px',
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (state.design[key] == null) state.design[key] = value;
  });
  if (!['start', 'last-page', 'after-cover'].includes(state.design.sidebarFillMode)) {
    state.design.sidebarFillMode = 'start';
  }
  if (!['solid', 'border'].includes(state.design.badgeMode)) {
    state.design.badgeMode = 'solid';
  }
  [
    ['pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft'],
    ['headerContentPaddingVerticalLinked', 'headerPaddingVertical', 'contentPaddingVertical'],
    ['headerContentPaddingHorizontalLinked', 'headerPaddingHorizontal', 'contentPaddingHorizontal'],
  ].forEach(([linkKey, primaryKey, secondaryKey]) => {
    if (typeof state.design[linkKey] !== 'boolean') {
      state.design[linkKey] = state.design[primaryKey] === state.design[secondaryKey];
    }
  });

  ['accent', 'bg', 'headerbg', 'sidebarbg', 'subtitle', 'graphic', 'dateColor', 'invertBadge', 'enableBoxShadow', 'layoutStyle', 'addExpColumns', 'bulletStyle'].forEach((key) => {
    delete state.design[key];
  });
}

function mergeIn(data) {
  if (!data) return;

  Object.assign(state, data);
  state.version = 7;
  ensureDesignLayoutDefaults();
  state.exportOptions = normalizeExportOptions(state.exportOptions);
  state.completedSections = Array.isArray(state.completedSections) ? [...new Set(state.completedSections)] : [];
  state.contact ||= {};
  if (state.contact.github == null) state.contact.github = '';
  state.experience ||= { jobs: [] };
  state.experience.jobs ||= [];
  normalizeContentState(state);
}

normalizeContentState(state);

onMounted(async () => {
  try {
    const cached = loadLocal();
    if (cached) {
      mergeIn(cached);
      return;
    }

    const response = await fetch(`${import.meta.env.BASE_URL}cv-defaults.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load defaults: ${response.status}`);
    mergeIn(await response.json());
  } catch (error) {
    console.warn('Failed to load default CV data', error);
  } finally {
    requestPdfPreview();
  }
});

const { estimatePdfSize, exportToPdf, renderPdf, renderPreview } = usePdfExport();
const isExporting = ref(false);
const isAnonymizedExporting = ref(false);
const estimatedPdfBytes = ref(null);
const pdfEstimateAccuracy = ref('');
const isExactPdfEstimating = ref(false);
const isPdfEstimateStale = ref(false);
const pdfEstimateError = ref('');
const pdfSizeEstimateCache = ref(loadPdfSizeEstimateCache());
let previewRenderVersion = 0;
let pdfEstimateRequest = 0;
let pdfContentRevision = 0;
let initialPdfCalibrationChecked = false;
let fullPreviewSourceVersion = 0;
let fullPreviewRenderVersion = 0;
let renderedFullPreviewSourceVersion = -1;
let anonymizedSourceVersion = 0;
let anonymizedPreviewRenderVersion = 0;
let renderedAnonymizedSourceVersion = -1;

function exportMarginMillimeters(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(30, Math.max(0, parsed)) : 0;
}

function getPdfMargins(design = {}) {
  return [
    exportMarginMillimeters(design.pageMarginTop),
    exportMarginMillimeters(design.pageMarginLeft),
    exportMarginMillimeters(design.pageMarginBottom),
    exportMarginMillimeters(design.pageMarginRight),
  ];
}

function getPdfRenderOptions(options = {}) {
  return {
    margin: getPdfMargins(state.design),
    continuationTopPadding: exportMarginMillimeters(state.design?.contentPaddingVertical || '10mm'),
    sidebarFillMode: state.design?.sidebarFillMode,
    ...options,
  };
}

function getInlinePdfPreviewRenderOptions({ detailed = false } = {}) {
  return getPdfRenderOptions({ html2canvas: { scale: detailed ? 1 : 0.4 } });
}

function getHybridPdfRenderOptions() {
  const exportOptions = normalizeExportOptions(state.exportOptions);
  return {
    ...getPdfRenderOptions(),
    image: exportOptions,
  };
}

function getPdfSourceElement() {
  return pdfRenderSource.value?.querySelector('.page') || null;
}

function getAnonymizedPdfSourceElement() {
  return anonymizedPdfRenderSource.value?.querySelector('.page') || null;
}

const anonymizedState = computed(() => createAnonymizedState(state));

function waitForPreviewPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function refreshPdfPreview(version) {
  try {
    await nextTick();
    await document.fonts?.ready;
    if (version !== previewRenderVersion) return;

    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const { pages: fastPages } = await renderPreview(cvElement, getInlinePdfPreviewRenderOptions());
    if (version !== previewRenderVersion) return;

    previewPages.value = fastPages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(fastPages.length, 1));

    // Let the low-resolution page reach the screen before beginning the more
    // expensive inline refinement pass.
    await waitForPreviewPaint();
    if (version !== previewRenderVersion) return;

    const { pages } = await renderPreview(cvElement, getInlinePdfPreviewRenderOptions({ detailed: true }));
    if (version !== previewRenderVersion) return;

    previewPages.value = pages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(pages.length, 1));
    updateApproximatePdfSizeEstimate();

    // The one automatic exact render belongs exclusively to the first stable
    // preview after hydration. Normal edits and export-option changes stay on
    // the instant, preview-fingerprint estimator path.
    if (!initialPdfCalibrationChecked) {
      initialPdfCalibrationChecked = true;
      const layers = createPdfSizeLayerInfo(state, pages);
      if (needsPdfSizeGroundTruth(pdfSizeEstimateCache.value, layers, state.exportOptions)) {
        void calculateExactPdfSizeEstimate({ automatic: true });
      }
    }
  } catch (error) {
    if (version === previewRenderVersion) console.error('PDF preview failed:', error);
  } finally {
    if (version === previewRenderVersion) isPreviewRendering.value = false;
  }
}

const schedulePdfPreview = debounce((version) => refreshPdfPreview(version), 100);

async function refreshFullPdfPreview(renderVersion, sourceVersion) {
  try {
    await nextTick();
    await document.fonts?.ready;
    if (renderVersion !== fullPreviewRenderVersion || sourceVersion !== fullPreviewSourceVersion) return;

    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('Full CV preview element not found');
    const { pages } = await renderPdf(cvElement, getPdfRenderOptions());
    if (renderVersion !== fullPreviewRenderVersion || sourceVersion !== fullPreviewSourceVersion) return;

    fullPreviewPages.value = pages;
    renderedFullPreviewSourceVersion = sourceVersion;
  } catch (error) {
    if (renderVersion === fullPreviewRenderVersion) console.error('Full PDF preview failed:', error);
  } finally {
    if (renderVersion === fullPreviewRenderVersion) isFullPreviewRendering.value = false;
  }
}

const scheduleFullPdfPreview = debounce((renderVersion, sourceVersion) => (
  refreshFullPdfPreview(renderVersion, sourceVersion)
), 100);

function requestFullPdfPreview() {
  if (renderedFullPreviewSourceVersion === fullPreviewSourceVersion && fullPreviewPages.value.length) return;
  const renderVersion = ++fullPreviewRenderVersion;
  isFullPreviewRendering.value = true;
  scheduleFullPdfPreview(renderVersion, fullPreviewSourceVersion);
}

function invalidatePdfPreview() {
  const version = ++previewRenderVersion;
  fullPreviewSourceVersion += 1;
  fullPreviewPages.value = [];
  renderedFullPreviewSourceVersion = -1;
  return version;
}

function requestPdfPreview() {
  const version = invalidatePdfPreview();
  isPreviewRendering.value = true;
  schedulePdfPreview(version);
  if (previewMode.value && fullPreviewView.value === 'pdf' && fullPreviewVariant.value === 'normal') {
    requestFullPdfPreview();
  }
}

async function refreshAnonymizedPdfPreview(renderVersion, sourceVersion) {
  try {
    await nextTick();
    await document.fonts?.ready;
    if (renderVersion !== anonymizedPreviewRenderVersion || sourceVersion !== anonymizedSourceVersion) return;

    const cvElement = getAnonymizedPdfSourceElement();
    if (!cvElement) throw new Error('Anonymized CV preview element not found');
    const { pages } = await renderPdf(cvElement, getPdfRenderOptions());
    if (renderVersion !== anonymizedPreviewRenderVersion || sourceVersion !== anonymizedSourceVersion) return;

    anonymizedPreviewPages.value = pages;
    anonymizedPreviewPage.value = Math.min(Math.max(anonymizedPreviewPage.value, 1), Math.max(pages.length, 1));
    renderedAnonymizedSourceVersion = sourceVersion;
  } catch (error) {
    if (renderVersion === anonymizedPreviewRenderVersion) console.error('Anonymized PDF preview failed:', error);
  } finally {
    if (renderVersion === anonymizedPreviewRenderVersion) isAnonymizedPreviewRendering.value = false;
  }
}

const scheduleAnonymizedPdfPreview = debounce((renderVersion, sourceVersion) => (
  refreshAnonymizedPdfPreview(renderVersion, sourceVersion)
), 500);

function requestAnonymizedPdfPreview() {
  if (renderedAnonymizedSourceVersion === anonymizedSourceVersion && anonymizedPreviewPages.value.length) return;
  const renderVersion = ++anonymizedPreviewRenderVersion;
  isAnonymizedPreviewRendering.value = true;
  scheduleAnonymizedPdfPreview(renderVersion, anonymizedSourceVersion);
}

function invalidateAnonymizedPdfPreview() {
  anonymizedSourceVersion += 1;
  anonymizedPreviewPages.value = [];
  anonymizedPreviewPage.value = 1;
  renderedAnonymizedSourceVersion = -1;
  if (fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
}

const previewState = computed(() => ({
  disabled: state.disabled,
  completedSections: state.completedSections,
  lang: state.lang,
  design: state.design,
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
  softSkills: state.softSkills,
  bodyOrder: state.bodyOrder,
  sidebarOrder: state.sidebarOrder,
}));

const anonymizedPreviewState = computed(() => ({
  ...previewState.value,
  anonymization: state.anonymization,
}));

function isTextEntryInput(element) {
  return Boolean(element?.matches?.([
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

function onPreviewInputBlur(event) {
  if (isTextEntryInput(event.target)) requestPdfPreview();
}

watch(previewState, () => {
  pdfContentRevision += 1;
  if (estimatedPdfBytes.value != null) {
    isPdfEstimateStale.value = true;
  }
  if (isTextEntryInput(document.activeElement)) {
    invalidatePdfPreview();
    isPreviewRendering.value = false;
    return;
  }
  requestPdfPreview();
}, { deep: true, flush: 'post' });

watch(anonymizedPreviewState, invalidateAnonymizedPdfPreview, { deep: true, flush: 'post' });

function updateApproximatePdfSizeEstimate() {
  const estimate = estimatePdfSizeFromLayerCache(
    pdfSizeEstimateCache.value,
    createPdfSizeLayerInfo(state, previewPages.value),
    state.exportOptions,
  );
  estimatedPdfBytes.value = estimate.bytes;
  pdfEstimateAccuracy.value = estimate.source === 'cached-exact'
    ? 'exact'
    : ['cached-calibrated', 'similar-layer'].includes(estimate.source)
      ? 'calibrated'
      : 'heuristic';
  pdfEstimateError.value = '';
}

function cachePdfSizeMeasurement(measurement) {
  if (!measurement || !Number.isFinite(measurement.bytes)) return;
  const layers = createPdfSizeLayerInfo(state, measurement.pages || previewPages.value);
  const nextCache = recordPdfSizeMeasurement(
    pdfSizeEstimateCache.value,
    layers,
    state.exportOptions,
    measurement,
  );
  pdfSizeEstimateCache.value = nextCache;
  savePdfSizeEstimateCache(nextCache);
}

async function calculateExactPdfSizeEstimate({ automatic = false } = {}) {
  const request = ++pdfEstimateRequest;
  isExactPdfEstimating.value = true;
  if (!automatic) pdfEstimateError.value = '';

  try {
    await nextTick();
    const contentRevision = pdfContentRevision;
    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const measurement = await estimatePdfSize(cvElement, getHybridPdfRenderOptions());
    if (request !== pdfEstimateRequest || contentRevision !== pdfContentRevision) return;
    cachePdfSizeMeasurement(measurement);
    estimatedPdfBytes.value = measurement.bytes;
    pdfEstimateAccuracy.value = 'exact';
    isPdfEstimateStale.value = false;
  } catch (error) {
    // A background calibration must never replace a usable estimate with an
    // error. The manual action remains explicit about failures.
    if (!automatic && request === pdfEstimateRequest) {
      pdfEstimateError.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (request === pdfEstimateRequest) isExactPdfEstimating.value = false;
  }
}

const scheduleApproximatePdfSizeEstimate = debounce(updateApproximatePdfSizeEstimate, 120);

watch(
  () => [state.exportOptions?.format, state.exportOptions?.quality],
  () => {
    pdfEstimateRequest += 1;
    isExactPdfEstimating.value = false;
    scheduleApproximatePdfSizeEstimate();
  },
  { flush: 'post' },
);

const estimatedPdfSize = computed(() => formatPdfBytes(estimatedPdfBytes.value));

async function handleExportPdf() {
  isExporting.value = true;
  try {
    await nextTick();
    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const filename = `${(state.contact?.name || 'CV').replace(/\s+/g, '_')}_CV`;
    const measurement = await exportToPdf(cvElement, filename, getHybridPdfRenderOptions());
    cachePdfSizeMeasurement(measurement);
    if (measurement) {
      estimatedPdfBytes.value = measurement.bytes;
      pdfEstimateAccuracy.value = 'exact';
      isPdfEstimateStale.value = false;
    }
  } catch (error) {
    console.error('PDF export failed:', error);
  } finally {
    isExporting.value = false;
  }
}

async function handleAnonymizedExportPdf() {
  isAnonymizedExporting.value = true;
  try {
    await nextTick();
    const cvElement = getAnonymizedPdfSourceElement();
    if (!cvElement) throw new Error('Anonymized CV preview element not found');
    await exportToPdf(cvElement, 'anonymized-cv', getHybridPdfRenderOptions());
  } catch (error) {
    console.error('Anonymized PDF export failed:', error);
  } finally {
    isAnonymizedExporting.value = false;
  }
}

const isAnonymizedFullPreview = computed(() => fullPreviewVariant.value === 'anonymized');
const activeFullPreviewPages = computed(() => (
  isAnonymizedFullPreview.value
    ? anonymizedPreviewPages.value
    : (fullPreviewPages.value.length ? fullPreviewPages.value : previewPages.value)
));
const activeFullPreviewPage = computed({
  get: () => (isAnonymizedFullPreview.value ? anonymizedPreviewPage.value : previewPage.value),
  set: (value) => {
    if (isAnonymizedFullPreview.value) anonymizedPreviewPage.value = value;
    else previewPage.value = value;
  },
});
const isActiveFullPreviewRendering = computed(() => (
  isAnonymizedFullPreview.value ? isAnonymizedPreviewRendering.value : isFullPreviewRendering.value
));

function toggleAnonymizedFullPreview() {
  fullPreviewVariant.value = isAnonymizedFullPreview.value ? 'normal' : 'anonymized';
  if (fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
  else if (fullPreviewView.value === 'pdf') requestFullPdfPreview();
}

function openFullPreview() {
  previewMode.value = true;
  if (fullPreviewView.value === 'pdf' && fullPreviewVariant.value === 'normal') requestFullPdfPreview();
}

function toggleFullPreviewView() {
  fullPreviewView.value = fullPreviewView.value === 'pdf' ? 'html' : 'pdf';
  if (fullPreviewView.value !== 'pdf') return;
  if (isAnonymizedFullPreview.value) requestAnonymizedPdfPreview();
  else requestFullPdfPreview();
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode }" @focusout="onPreviewInputBlur">
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
        <button class="btn" type="button" :aria-pressed="fullPreviewView === 'html'" @click="toggleFullPreviewView">
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
        <PdfPreview v-if="fullPreviewView === 'pdf'" :page="activeFullPreviewPage" :pages="activeFullPreviewPages" :is-updating="isActiveFullPreviewRendering" :lang="lang" />
        <div v-else class="html-preview"><CvPreview :state="isAnonymizedFullPreview ? anonymizedState : state" :anonymized="isAnonymizedFullPreview" /></div>
      </div>
      <PdfPagination v-if="fullPreviewView === 'pdf'" v-model:page="activeFullPreviewPage" :pages="activeFullPreviewPages" :lang="lang" fullscreen />
    </section>

    <section v-else class="builder-layout" :class="`builder-layout--${previewPlacement}`">
      <div class="builder-layout__controls">
        <BackupManager
          :state="state"
          v-model:lang="lang"
          :onSave="saveDebounced"
          :onLoad="mergeIn"
        />
        <FormBuilder :state="state" :onSave="saveDebounced" />
        <DesignPanel
          v-model="state.design"
          :lang="lang"
        />
        <ExportOptionsPanel
          v-model="state.exportOptions"
          :estimate-size="estimatedPdfSize"
          :estimate-accuracy="pdfEstimateAccuracy"
          :is-exact-estimating="isExactPdfEstimating"
          :is-estimate-stale="isPdfEstimateStale"
          :estimate-error="pdfEstimateError"
          :lang="lang"
          @exact-estimate="calculateExactPdfSizeEstimate"
        />
        <AnonymizationPanel
          :state="state"
          :is-exporting="isAnonymizedExporting"
          :lang="lang"
          @export="handleAnonymizedExportPdf"
        />
      </div>

      <aside class="inline-preview" aria-label="Live CV preview">
        <div class="inline-preview__actions">
          <button class="btn" type="button" @click="openFullPreview">{{ t('openPreview') }}</button>
          <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
            <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
            {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
          </button>
        </div>
        <div class="inline-preview__viewport">
          <div class="inline-preview__scroll">
            <PdfPreview :page="previewPage" :pages="previewPages" :is-updating="isPreviewRendering" :lang="lang" />
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
        <div class="inline-preview__pagination">
          <PdfPagination v-model:page="previewPage" :pages="previewPages" :lang="lang" />
        </div>
      </aside>
    </section>
  </main>
</template>

<style>
.cv-builder-app {
  min-height: 100vh;
  padding: 24px;
}

.pdf-render-source {
  position: fixed;
  top: 0;
  left: -240mm;
  pointer-events: none;
}

.builder-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  align-items: start;
  gap: 20px;
  margin: 0 auto;
  max-width: 1540px;
}

.builder-layout__controls {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.builder-layout__controls .workbench {
  max-width: none;
  padding: 0;
}

.builder-layout--below {
  grid-template-columns: minmax(0, 1fr);
}

.builder-layout--below .inline-preview {
  position: relative;
  top: auto;
  grid-column: 1;
  width: min(100%, 860px);
  justify-self: center;
}

.inline-preview {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 10px;
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
}

.inline-preview__scroll {
  max-height: min(66vh, 520px);
  overflow: auto;
}

.inline-preview :deep(.pdf-preview) {
  width: min(100%, 794px);
  margin: 0 auto;
}

.inline-preview :deep(.pdf-preview__stage) {
  display: block;
  min-height: 0;
  overflow: visible;
  border-radius: 0;
  background: transparent;
}

.inline-preview :deep(.pdf-preview__page) {
  width: 100%;
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

.preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
  background: #061017;
}
.preview-actions .pdf-pagination { grid-column: 1 / -1; }
.preview-actions .btn { width: 100%; }
@media (max-width: 1180px) {
  .cv-builder-app {
    padding-right: 24px;
  }

  .builder-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .inline-preview {
    position: relative;
    top: auto;
    width: min(100%, 520px);
    justify-self: center;
  }
}

@media (max-width: 760px) {
  .cv-builder-app {
    padding: 16px;
  }

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
