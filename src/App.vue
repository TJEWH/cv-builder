<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
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
  recordPdfSizeMeasurement,
  savePdfSizeEstimateCache,
} from './composables/pdfSizeEstimateCache';

const state = reactive({
  version: 7,
  disabled: [],
  completedSections: [],
  keepTogetherSections: [],
  lang: 'en',
  design: {
    h1: '22pt', h2: '12pt', h3: '10pt', bullets: '10.5pt',
    ink: '#111827', graphicOpacity: 100, dateOpacity: 100,
    fontBody: 'Inter', fontHead: 'Inter', hstyle: 'clean',
    badgeMode: 'solid', badgeBorderWidth: '1px', badgeBorderRadius: '6px',
    sectionSpacing: '6mm', sectionSpacingBody: '6mm', sectionSpacingSidebar: '6mm', itemSpacing: '3.5mm',
    sidebarWidth: '0.7fr', sidebarAlign: 'right', sidebarFillMode: 'start', headerLayoutStyle: 'separator', sidebarLayoutStyle: 'separator', contactLayout: 'side', separatorWidth: '1px',
    pageMarginTop: '12mm', pageMarginRight: '12mm', pageMarginBottom: '12mm', pageMarginLeft: '12mm',
    pageMarginHorizontalLinked: true, pageMarginVerticalLinked: true,
    headerPaddingBottom: '12mm', headerBottomMargin: '12mm', headerBottomSpacingLinked: true,
    bodySidebarSpacing: '10mm',
    favoriteControls: [],
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
  bodyOrder: ['about', 'education', 'jobs'],
  sidebarOrder: ['languages', 'hobbies'],
});
const stateKeys = Object.keys(state);
const initialState = JSON.parse(JSON.stringify(state));
const createInitialState = () => JSON.parse(JSON.stringify(initialState));

const lang = computed({
  get: () => state.lang ?? 'en',
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
const activeBuilderGroup = ref('content');
const savedConfigurations = ref([]);
const selectedConfigurationId = ref('');
const saveStatus = ref('saved');
const backupManager = ref(null);
const builderTopbar = ref(null);
const builderTopbarHeight = ref(0);
const builderGroups = computed(() => [
  { key: 'versions', label: t('versions'), icon: 'layer-group' },
  { key: 'content', label: t('content'), icon: 'table-cells-large' },
  { key: 'design', label: t('design'), icon: 'palette' },
  { key: 'export', label: t('export'), icon: 'file-pdf' },
  { key: 'privacy', label: t('privacy'), icon: 'user-secret' },
]);
const saveStatusLabel = computed(() => t({
  saving: 'saving',
  saved: 'saved',
  error: 'saveFailed',
}[saveStatus.value] || 'saved'));
const saveStatusIcon = computed(() => (
  saveStatus.value === 'saving' ? 'spinner' : saveStatus.value === 'error' ? 'xmark' : 'check'
));

function persistState() {
  try {
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const versionSaveResult = backupManager.value?.saveCurrent?.();
    const saved = typeof versionSaveResult === 'boolean'
      ? versionSaveResult
      : saveLocal(stateSnapshot);
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

function selectConfiguration(event) {
  const nextId = event.target.value;
  if (nextId === selectedConfigurationId.value) return;
  if (!backupManager.value?.selectConfiguration(nextId)) event.target.value = selectedConfigurationId.value;
}

function handleConfigurationSaveResult(saved) {
  saveStatus.value = saved ? 'saved' : 'error';
}

function toggleLanguage() {
  lang.value = lang.value === 'de' ? 'en' : 'de';
}

watch(state, scheduleStateSave, { deep: true });
useCvDesign(() => state.design);

function designMillimeters(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function addDesignMillimeters(...values) {
  return `${values.reduce((total, value) => total + designMillimeters(value), 0)}mm`;
}

function hasOwnDesignProperty(design, key) {
  return Object.prototype.hasOwnProperty.call(design, key);
}

function migrateLegacySpacing(design) {
  const legacySpacingKeys = [
    'headerPaddingTop',
    'headerPaddingVertical',
    'headerPaddingHorizontal',
    'contentPaddingVertical',
    'contentPaddingHorizontal',
    'headerContentPaddingVerticalLinked',
    'headerContentPaddingHorizontalLinked',
  ];
  if (!legacySpacingKeys.some((key) => hasOwnDesignProperty(design, key))) return;

  const legacyHeaderVertical = design.headerPaddingVertical;
  const headerTop = design.headerPaddingTop ?? legacyHeaderVertical ?? '12mm';
  const headerBottom = design.headerPaddingBottom ?? legacyHeaderVertical ?? '12mm';
  const contentVertical = design.contentPaddingVertical ?? '12mm';
  const contentHorizontal = design.contentPaddingHorizontal ?? design.headerPaddingHorizontal ?? '12mm';

  // Page margins now own the outer whitespace. This preserves the effective
  // inset of older layouts before removing their separate horizontal controls.
  design.pageMarginTop = addDesignMillimeters(design.pageMarginTop, headerTop);
  design.pageMarginBottom = addDesignMillimeters(design.pageMarginBottom, contentVertical);
  design.pageMarginRight = addDesignMillimeters(design.pageMarginRight, contentHorizontal);
  design.pageMarginLeft = addDesignMillimeters(design.pageMarginLeft, contentHorizontal);
  design.headerPaddingBottom = headerBottom;
  design.headerBottomMargin ??= contentVertical;
}

function ensureDesignLayoutDefaults() {
  state.design ||= {};
  const legacyLayoutStyle = state.design.layoutStyle === 'separator' ? 'separator' : 'boxed';
  migrateLegacySpacing(state.design);
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
    pageMarginTop: '12mm',
    pageMarginRight: '12mm',
    pageMarginBottom: '12mm',
    pageMarginLeft: '12mm',
    headerPaddingBottom: '12mm',
    headerBottomMargin: '12mm',
    itemSpacing: '3.5mm',
    bodySidebarSpacing: '10mm',
    badgeMode: 'solid',
    badgeBorderWidth: '1px',
    favoriteControls: [],
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
  if (!['clean', 'underline', 'leftbar', 'pill'].includes(state.design.hstyle)) {
    state.design.hstyle = 'clean';
  }
  [
    ['pageMarginHorizontalLinked', 'pageMarginRight', 'pageMarginLeft'],
    ['pageMarginVerticalLinked', 'pageMarginTop', 'pageMarginBottom'],
    ['headerBottomSpacingLinked', 'headerPaddingBottom', 'headerBottomMargin'],
  ].forEach(([linkKey, primaryKey, secondaryKey]) => {
    if (typeof state.design[linkKey] !== 'boolean') {
      state.design[linkKey] = state.design[primaryKey] === state.design[secondaryKey];
    }
  });

  ['accent', 'bg', 'headerbg', 'sidebarbg', 'subtitle', 'graphic', 'dateColor', 'invertBadge', 'enableBoxShadow', 'layoutStyle', 'addExpColumns', 'bulletStyle', 'radius', 'itemBorderWidth', 'headerRadius', 'headerPadYmm', 'headerPaddingTop', 'headerPaddingVertical', 'headerPaddingHorizontal', 'contentPaddingVertical', 'contentPaddingHorizontal', 'headerContentPaddingVerticalLinked', 'headerContentPaddingHorizontalLinked'].forEach((key) => {
    delete state.design[key];
  });
}

function isStateRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeIn(data) {
  if (!isStateRecord(data)) return;

  const defaults = createInitialState();
  const nextState = createInitialState();
  stateKeys.forEach((key) => {
    if (Object.hasOwn(data, key)) nextState[key] = data[key];
  });
  ['disabled', 'completedSections', 'keepTogetherSections', 'education', 'languages', 'hobbies', 'customSections', 'sidebarSections', 'bodyOrder', 'sidebarOrder'].forEach((key) => {
    if (!Array.isArray(nextState[key])) nextState[key] = defaults[key];
  });
  ['design', 'exportOptions', 'anonymization', 'contact', 'about', 'experience', 'sectionNames', 'sectionHeaderSizes'].forEach((key) => {
    if (!isStateRecord(nextState[key])) nextState[key] = defaults[key];
  });
  nextState.design = { ...defaults.design, ...nextState.design };
  nextState.exportOptions = { ...defaults.exportOptions, ...nextState.exportOptions };
  nextState.anonymization = { ...defaults.anonymization, ...nextState.anonymization };
  nextState.contact = { ...defaults.contact, ...nextState.contact };
  nextState.about = { ...defaults.about, ...nextState.about };
  nextState.experience = { ...defaults.experience, ...nextState.experience };
  if (typeof nextState.lang !== 'string') nextState.lang = 'en';

  Object.keys(state).forEach((key) => {
    if (!stateKeys.includes(key)) delete state[key];
  });
  Object.assign(state, nextState);
  state.version = 7;
  ensureDesignLayoutDefaults();
  state.exportOptions = normalizeExportOptions(state.exportOptions);
  state.completedSections = Array.isArray(state.completedSections) ? [...new Set(state.completedSections)] : [];
  state.contact ||= {};
  if (state.contact.github == null) state.contact.github = '';
  state.experience ||= { jobs: [] };
  if (!Array.isArray(state.experience.jobs)) state.experience.jobs = [];
  normalizeContentState(state);
}

normalizeContentState(state);

let builderTopbarResizeObserver = null;
function syncBuilderTopbarHeight() {
  builderTopbarHeight.value = Math.ceil(builderTopbar.value?.getBoundingClientRect().height || 0);
}

onMounted(() => {
  syncBuilderTopbarHeight();
  if (typeof ResizeObserver === 'undefined' || !builderTopbar.value) return;
  builderTopbarResizeObserver = new ResizeObserver(syncBuilderTopbarHeight);
  builderTopbarResizeObserver.observe(builderTopbar.value);
});

onBeforeUnmount(() => builderTopbarResizeObserver?.disconnect());

onMounted(async () => {
  try {
    const cached = backupManager.value?.restoreActiveConfig?.() || loadLocal();
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
let fullPreviewSourceVersion = 0;
let fullPreviewRenderVersion = 0;
let renderedFullPreviewSourceVersion = -1;
let anonymizedSourceVersion = 0;
let anonymizedPreviewRenderVersion = 0;
let renderedAnonymizedSourceVersion = -1;
let isSliderPreviewUpdateDeferred = false;
let sliderPreviewUpdatePending = false;
let sliderSaveUpdatePending = false;

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
    continuationTopPadding: exportMarginMillimeters(state.design?.headerBottomMargin || '12mm'),
    sidebarFillMode: state.design?.sidebarFillMode,
    ...options,
  };
}

function getInlinePdfPreviewRenderOptions({ detailed = false } = {}) {
  return getPdfRenderOptions({ html2canvas: { scale: detailed ? 1 : 0.2 } });
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

function hasPendingBuilderInput() {
  return navigator.scheduling?.isInputPending?.({ includeContinuous: true }) ?? false;
}

function waitForPreviewIdle(maxWait = 400) {
  return new Promise((resolve) => {
    const deadline = performance.now() + maxWait;
    const schedule = () => {
      const run = () => {
        // Some browsers may continue reporting pending input after focus has
        // already left the builder. Do not let that status starve the inline
        // preview forever; the fast pass should always get a chance to paint.
        if (hasPendingBuilderInput() && performance.now() < deadline) {
          schedule();
          return;
        }
        resolve();
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: Math.max(1, deadline - performance.now()) });
      } else {
        window.setTimeout(run, Math.min(50, Math.max(0, deadline - performance.now())));
      }
    };

    schedule();
  });
}

async function refreshPdfPreview(version) {
  try {
    await nextTick();
    await document.fonts?.ready;
    await waitForPreviewIdle();
    if (version !== previewRenderVersion) return;

    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const { pages: fastPages } = await renderPreview(cvElement, getInlinePdfPreviewRenderOptions());
    if (version !== previewRenderVersion) return;

    previewPages.value = fastPages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(fastPages.length, 1));

    // Let the low-resolution page reach the screen before beginning the more
    // expensive inline refinement pass, and only run it once the builder is
    // idle again.
    await waitForPreviewPaint();
    await waitForPreviewIdle();
    if (version !== previewRenderVersion) return;

    const { pages } = await renderPreview(cvElement, getInlinePdfPreviewRenderOptions({ detailed: true }));
    if (version !== previewRenderVersion) return;

    previewPages.value = pages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(pages.length, 1));
    updateApproximatePdfSizeEstimate();

    // Keep the inline path strictly preview-only. An automatic exact-size
    // calibration uses the full export renderer and can monopolize the main
    // thread on long CVs; users can still request it explicitly.
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

function invalidateAnonymizedPdfPreview({ defer = false } = {}) {
  anonymizedSourceVersion += 1;
  anonymizedPreviewPages.value = [];
  anonymizedPreviewPage.value = 1;
  renderedAnonymizedSourceVersion = -1;
  if (!defer && fullPreviewVariant.value === 'anonymized') requestAnonymizedPdfPreview();
}

const previewState = computed(() => ({
  disabled: state.disabled,
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
  keepTogetherSections: state.keepTogetherSections,
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

function isRangeInput(element) {
  return element?.matches?.('input[type="range"]') ?? false;
}

function onPreviewSliderPointerDown(event) {
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
  saveDebounced.flush?.();
}

onMounted(() => window.addEventListener('pagehide', flushStateSave));
onBeforeUnmount(() => window.removeEventListener('pagehide', flushStateSave));

function onPreviewInputBlur(event) {
  if (isTextEntryInput(event.target)) requestPdfPreview();
}

watch(previewState, () => {
  pdfContentRevision += 1;
  if (estimatedPdfBytes.value != null) {
    isPdfEstimateStale.value = true;
  }
  if (isSliderPreviewUpdateDeferred) {
    sliderPreviewUpdatePending = true;
    invalidatePdfPreview();
    isPreviewRendering.value = false;
    return;
  }
  if (isTextEntryInput(document.activeElement)) {
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
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode }" @focusout="onPreviewInputBlur" @pointerdown.capture="onPreviewSliderPointerDown" @pointerup.capture="commitDeferredSliderPreview" @pointercancel.capture="commitDeferredSliderPreview">
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

    <section v-else class="builder-shell">
      <header ref="builderTopbar" class="builder-topbar">
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
            @click="activeBuilderGroup = group.key"
          >
            <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
            <span>{{ group.label }}</span>
          </button>
        </nav>

        <div class="builder-topbar__utilities">
          <label class="builder-topbar__configuration">
            <font-awesome-icon :icon="['fas', 'layer-group']" aria-hidden="true" />
            <select :value="selectedConfigurationId" :aria-label="t('versions')" @change="selectConfiguration">
              <option value="">{{ t('currentDraft') }}</option>
              <option v-for="configuration in savedConfigurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option>
            </select>
          </label>
          <button class="builder-topbar__language-toggle" type="button" :class="{ 'is-on': lang === 'en' }" :aria-label="t('language')" @click="toggleLanguage">
            <span class="builder-topbar__language-track"><span>DE</span><span>EN</span><span class="builder-topbar__language-thumb"></span></span>
          </button>
          <output class="builder-topbar__save-status" :class="`is-${saveStatus}`" aria-live="polite">
            <font-awesome-icon :icon="['fas', saveStatusIcon]" :spin="saveStatus === 'saving'" />
            {{ saveStatusLabel }}
          </output>
        </div>
      </header>

      <section class="builder-layout" :class="`builder-layout--${previewPlacement}`" :style="{ '--builder-topbar-height': `${builderTopbarHeight}px` }">
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
              @update:selected-id="selectedConfigurationId = $event"
              @configs-change="savedConfigurations = $event"
              @save-result="handleConfigurationSaveResult"
            />
          </Transition>
          <Transition name="builder-group">
            <FormBuilder v-show="activeBuilderGroup === 'content'" id="builder-group-content" class="builder-group-panel" :state="state" :on-save="scheduleStateSave" />
          </Transition>
          <Transition name="builder-group">
            <DesignPanel
              v-show="activeBuilderGroup === 'design'"
              id="builder-group-design"
              class="builder-group-panel"
              v-model="state.design"
              :lang="lang"
            />
          </Transition>
          <Transition name="builder-group">
            <ExportOptionsPanel
              v-show="activeBuilderGroup === 'export'"
              id="builder-group-export"
              class="builder-group-panel"
              v-model="state.exportOptions"
              :estimate-size="estimatedPdfSize"
              :estimate-accuracy="pdfEstimateAccuracy"
              :is-exact-estimating="isExactPdfEstimating"
              :is-estimate-stale="isPdfEstimateStale"
              :estimate-error="pdfEstimateError"
              :lang="lang"
              @exact-estimate="calculateExactPdfSizeEstimate"
            />
          </Transition>
          <Transition name="builder-group">
            <AnonymizationPanel
              v-show="activeBuilderGroup === 'privacy'"
              id="builder-group-privacy"
              class="builder-group-panel"
              :state="state"
              :is-exporting="isAnonymizedExporting"
              :lang="lang"
              @export="handleAnonymizedExportPdf"
            />
          </Transition>
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

.builder-shell {
  display: grid;
  gap: 14px;
  max-width: 1540px;
  margin: 0 auto;
}

.builder-topbar {
  position: sticky;
  z-index: 20;
  top: 12px;
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
  grid-template-columns: repeat(5, minmax(76px, 1fr));
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
  align-items: start;
  gap: 20px;
  margin: 0;
  max-width: none;
}

.builder-layout__controls {
  display: grid;
  gap: 0;
  min-width: 0;
}

.builder-group-panel { min-width: 0; }
.builder-group-enter-active, .builder-group-leave-active { transition: opacity .22s ease; }
.builder-group-enter-from, .builder-group-leave-to { opacity: 0; }

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
  top: calc(var(--builder-topbar-height, 0px) + 24px);
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
  max-height: min(calc(100vh - var(--builder-topbar-height, 0px) - 116px), 520px);
  overflow: auto;
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

@media (max-width: 1180px) {
  .cv-builder-app {
    padding-right: 24px;
  }

  .builder-topbar { grid-template-columns: 1fr; }
  .builder-topbar__utilities { justify-content: space-between; }

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

  .builder-topbar { top: 6px; padding: 8px; }
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
