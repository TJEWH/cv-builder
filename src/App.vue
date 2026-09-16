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
import { makeT } from './i18n/dict';
import { normalizeContentState } from './composables/contentLayout';
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
  version: 6,
  disabled: [],
  completedSections: [],
  lang: 'de',
  design: {
    h1: '22pt', h2: '12pt', h3: '10pt', bullets: '10.5pt', bulletStyle: 'disc',
    ink: '#111827', graphicOpacity: 100, dateOpacity: 100,
    fontBody: 'Inter', fontHead: 'Inter', hstyle: 'clean', radius: '10px',
    badgeMode: 'solid', badgeBorderWidth: '1px', badgeBorderRadius: '6px',
    itemBorderWidth: '1px',
    sectionSpacing: '6mm', sectionSpacingBody: '6mm', sectionSpacingSidebar: '6mm',
    sidebarWidth: '0.7fr', sidebarAlign: 'right', sidebarFillMode: 'start', headerLayoutStyle: 'separator', sidebarLayoutStyle: 'separator', contactLayout: 'side', separatorWidth: '1px',
    pageMarginTop: '0mm', pageMarginRight: '0mm', pageMarginBottom: '0mm', pageMarginLeft: '0mm',
    headerPaddingVertical: '12mm', headerPaddingHorizontal: '12mm',
    contentPaddingVertical: '10mm', contentPaddingHorizontal: '12mm',
  },
  exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
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
const pdfRenderSource = ref(null);
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
    contentPaddingVertical: '10mm',
    contentPaddingHorizontal: '12mm',
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

  ['accent', 'bg', 'headerbg', 'sidebarbg', 'subtitle', 'graphic', 'dateColor', 'invertBadge', 'enableBoxShadow', 'layoutStyle', 'addExpColumns'].forEach((key) => {
    delete state.design[key];
  });
}

function mergeIn(data) {
  if (!data) return;

  Object.assign(state, data);
  state.version = 6;
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

const { estimatePdfSize, exportToPdf, renderPdf } = usePdfExport();
const isExporting = ref(false);
const estimatedPdfBytes = ref(null);
const pdfEstimateAccuracy = ref('');
const isExactPdfEstimating = ref(false);
const isPdfEstimateStale = ref(false);
const pdfEstimateError = ref('');
const pdfSizeEstimateCache = ref(loadPdfSizeEstimateCache());
let previewRenderVersion = 0;
let pdfEstimateRequest = 0;
let pdfContentRevision = 0;

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

function getPdfRenderOptions() {
  return {
    margin: getPdfMargins(state.design),
    continuationTopPadding: exportMarginMillimeters(state.design?.contentPaddingVertical || '10mm'),
    sidebarFillMode: state.design?.sidebarFillMode,
  };
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

async function refreshPdfPreview(version) {
  try {
    await nextTick();
    await document.fonts?.ready;
    if (version !== previewRenderVersion) return;

    const cvElement = getPdfSourceElement();
    if (!cvElement) throw new Error('CV preview element not found');
    const { pages } = await renderPdf(cvElement, getPdfRenderOptions());
    if (version !== previewRenderVersion) return;

    previewPages.value = pages;
    previewPage.value = Math.min(Math.max(previewPage.value, 1), Math.max(pages.length, 1));
    if (estimatedPdfBytes.value == null) updateApproximatePdfSizeEstimate();
  } catch (error) {
    if (version === previewRenderVersion) console.error('PDF preview failed:', error);
  } finally {
    if (version === previewRenderVersion) isPreviewRendering.value = false;
  }
}

const schedulePdfPreview = debounce(() => refreshPdfPreview(previewRenderVersion), 500);

function requestPdfPreview() {
  previewRenderVersion += 1;
  isPreviewRendering.value = true;
  schedulePdfPreview();
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

watch(previewState, () => {
  pdfContentRevision += 1;
  if (estimatedPdfBytes.value != null) {
    isPdfEstimateStale.value = true;
  }
  requestPdfPreview();
}, { deep: true, flush: 'post' });

function updateApproximatePdfSizeEstimate() {
  const estimate = estimatePdfSizeFromLayerCache(
    pdfSizeEstimateCache.value,
    createPdfSizeLayerInfo(state, previewPages.value),
    state.exportOptions,
  );
  estimatedPdfBytes.value = estimate.bytes;
  pdfEstimateAccuracy.value = estimate.source === 'cached-exact' ? 'exact' : 'approximate';
  isPdfEstimateStale.value = false;
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

async function calculateExactPdfSizeEstimate() {
  const request = ++pdfEstimateRequest;
  isExactPdfEstimating.value = true;
  pdfEstimateError.value = '';

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
    if (request === pdfEstimateRequest) {
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
  } catch (error) {
    console.error('PDF export failed:', error);
  } finally {
    isExporting.value = false;
  }
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode }">
    <div ref="pdfRenderSource" class="pdf-render-source" aria-hidden="true">
      <CvPreview :state="state" export-source />
    </div>

    <section v-if="previewMode" class="fullscreen-preview" aria-label="CV preview">
      <button class="btn fullscreen-preview__back" type="button" @click="previewMode = false">
        <font-awesome-icon :icon="['fas', 'arrow-left']" />
        {{ t('backToBuilder') }}
      </button>

      <div class="fullscreen-preview__actions">
        <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
          <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
          <font-awesome-icon v-else :icon="['fas', 'download']" />
          {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
        </button>
        <button class="btn" type="button" :aria-pressed="fullPreviewView === 'html'" @click="fullPreviewView = fullPreviewView === 'pdf' ? 'html' : 'pdf'">
          <font-awesome-icon :icon="['fas', fullPreviewView === 'pdf' ? 'code' : 'file-pdf']" />
          {{ fullPreviewView === 'pdf' ? t('showHtmlPreview') : t('showPdfPreview') }}
        </button>
      </div>

      <div class="fullscreen-preview__content">
        <PdfPreview v-if="fullPreviewView === 'pdf'" :page="previewPage" :pages="previewPages" :is-updating="isPreviewRendering" :lang="lang" />
        <div v-else class="html-preview"><CvPreview :state="state" /></div>
      </div>
      <PdfPagination v-if="fullPreviewView === 'pdf'" v-model:page="previewPage" :pages="previewPages" :lang="lang" fullscreen />
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
      </div>

      <aside class="inline-preview" aria-label="Live CV preview">
        <div class="inline-preview__header">
          <span>{{ t('livePreview') }}</span>
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
        <div class="inline-preview__viewport">
          <PdfPreview :page="previewPage" :pages="previewPages" :is-updating="isPreviewRendering" :lang="lang" />
        </div>
        <div class="preview-actions">
          <PdfPagination v-model:page="previewPage" :pages="previewPages" :lang="lang" />
          <button class="btn" type="button" @click="previewMode = true">{{ t('openPreview') }}</button>
          <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
            <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
            {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
          </button>
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
  overflow: hidden;
  border: 1px solid #2a3441;
  border-radius: 12px;
  background: #0a0f14;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .45);
}

.inline-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px dashed #113c34;
  color: #9be8c7;
  font-size: 13px;
  font-weight: 700;
}

.inline-preview__placement-toggle { flex: 0 0 auto; }

.inline-preview__viewport {
  width: 100%;
  height: min(66vh, 520px);
  min-height: 320px;
  overflow: auto;
  background: #0b0f14;
  display: grid;
  place-items: center;
  padding: 12px;
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
