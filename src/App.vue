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
import InlineDocumentPreview from './components/InlineDocumentPreview.vue';
import FullDocumentPreview from './components/FullDocumentPreview.vue';
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
import LetterTemplates from './components/LetterTemplates.vue';
import VariantHistory from './components/VariantHistory.vue';
import { rootVariantId } from './composables/careerVariants';

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
function syncMobileViewport() {
  isMobile.value = mobileViewport.matches;
}
onMounted(() => mobileViewport.addEventListener('change', syncMobileViewport));
onBeforeUnmount(() => mobileViewport.removeEventListener('change', syncMobileViewport));
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
type Workspace = 'opportunities' | 'cv-studio' | 'applications';
const activeWorkspace = ref<Workspace>('cv-studio');
const activeBuilderGroup = ref('content');
try {
  const cached = JSON.parse(sessionStorage.getItem('CV_WORKSPACE_NAV') || '{}');
  if (['opportunities', 'cv-studio', 'applications'].includes(cached.workspace)) activeWorkspace.value = cached.workspace;
  if (['versions', 'content', 'design', 'privacy', 'templates'].includes(cached.cvTab)) activeBuilderGroup.value = cached.cvTab;
} catch { /* Navigation is available without browser storage. */ }
watch([activeWorkspace, activeBuilderGroup], () => {
  try { sessionStorage.setItem('CV_WORKSPACE_NAV', JSON.stringify({ workspace: activeWorkspace.value, cvTab: activeBuilderGroup.value })); } catch { /* Optional preference. */ }
});
const isCloudTab = computed(() => activeWorkspace.value !== 'cv-studio');
const cloudTab = computed(() => activeWorkspace.value === 'applications' ? 'applications' : 'opportunities');
const workspaceGroups = computed(() => [
  { key: 'opportunities' as const, label: lang.value === 'de' ? 'Stellenangebote' : 'Opportunities', icon: 'briefcase' },
  { key: 'cv-studio' as const, label: lang.value === 'de' ? 'CV-Studio' : 'CV Studio', icon: 'layer-group' },
  { key: 'applications' as const, label: lang.value === 'de' ? 'Bewerbungen' : 'Applications', icon: 'envelope' },
]);
function selectWorkspace(workspace: Workspace) {
  if (!prepareConfigurationChange()) return;
  activeWorkspace.value = workspace; previewMode.value = false;
}
function saveCareerVariant(name: string, data: CvState) {
  const saved = backupManager.value?.saveAsDocument(name, data) ?? false;
  if (!saved) pdfExportError.value = lang.value === 'de' ? 'Karrierevariante konnte nicht gespeichert werden.' : 'The career variant could not be saved.';
}
function createSubvariant(parentId: string, name: string, data: CvState): string | null {
  return backupManager.value?.createSubvariant(parentId, name, data) ?? null;
}
function openStudioVariant(id: string) {
  if (!backupManager.value?.selectConfiguration(id)) return;
  activeWorkspace.value = 'cv-studio'; activeBuilderGroup.value = 'content'; previewMode.value = false;
}
const savedConfigurations = ref<SavedConfiguration[]>([]);
const selectedConfigurationId = ref('');
const isEmptyDocument = computed(() => selectedConfigurationId.value === EMPTY_DOCUMENT_ID);
const selectableConfigurations = computed(() => savedConfigurations.value.filter(({ id }) => !isBuiltinDocument(id)));
const rootConfigurations = computed(() => savedConfigurations.value.filter(item => !item.parentId));
const selectedRootId = computed(() => rootVariantId(selectedConfigurationId.value, savedConfigurations.value));
const subConfigurations = computed(() => savedConfigurations.value.filter(item => item.parentId === selectedRootId.value));
watch(isEmptyDocument, (empty) => {
  if (empty) activeBuilderGroup.value = 'versions';
}, { flush: 'sync' });
const saveStatus = ref<SaveStatus>('saved');
const lastSavedAt = ref<number | null>(null);
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
  { key: 'versions', label: lang.value === 'de' ? 'Varianten' : 'Variants', icon: 'layer-group' },
  { key: 'content', label: t('content'), icon: 'table-cells-large' },
  { key: 'design', label: t('design'), icon: 'palette' },
  { key: 'privacy', label: t('privacy'), icon: 'user-secret' },
  { key: 'templates', label: lang.value === 'de' ? 'Briefvorlagen' : 'Letter templates', icon: 'envelope' },
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
const saveStatusLabel = computed(() => {
  const label = t({ saving: 'saving', saved: 'saved', error: 'saveFailed' }[combinedSaveStatus.value]);
  if (combinedSaveStatus.value !== 'saved' || lastSavedAt.value === null) return label;
  const time = new Intl.DateTimeFormat(lang.value === 'de' ? 'de-DE' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(lastSavedAt.value);
  return `${label} ${time}`;
});

function persistState() {
  try {
    const versionSaveResult = backupManager.value?.saveCurrent?.();
    const saved = typeof versionSaveResult === 'boolean'
      ? versionSaveResult
      : saveLocal(state);
    handleConfigurationSaveResult(saved);
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
  if (saved) lastSavedAt.value = Date.now();
}

function toggleLanguage() {
  lang.value = lang.value === 'de' ? 'en' : 'de';
}

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

// Mark edits immediately, including an edit followed by navigation or pagehide
// in the same event. A queued watcher could leave the status at "Saved" and
// make flushStateSave miss that last change.
watch(state, scheduleStateSave, { deep: true, flush: 'sync' });

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
  if (!isCloudTab.value && isRangeInput(event.target)) isSliderPreviewUpdateDeferred = true;
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

onMounted(() => {
  window.addEventListener('pagehide', flushStateSave);
  // A slider can be released outside the app or lose focus during a drag.
  window.addEventListener('pointerup', commitDeferredSliderPreview);
  window.addEventListener('pointercancel', commitDeferredSliderPreview);
  window.addEventListener('blur', commitDeferredSliderPreview);
});
onBeforeUnmount(() => {
  flushStateSave();
  window.removeEventListener('pagehide', flushStateSave);
  window.removeEventListener('pointerup', commitDeferredSliderPreview);
  window.removeEventListener('pointercancel', commitDeferredSliderPreview);
  window.removeEventListener('blur', commitDeferredSliderPreview);
});

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


function openFullPreview() {
  flushStateSave();
  if (formBuilder.value?.flushSectionSaves() === false) return;
  previewMode.value = true;
  if (isAnonymizedFullPreview.value) requestAnonymizedPdfPreview();
}

function selectBuilderGroup(group: string) {
  if (group === 'opportunities' || group === 'applications') { selectWorkspace(group); return; }
  activeBuilderGroup.value = group;
  previewMode.value = false;
}

</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode, 'is-cloud-workspace': isCloudTab, 'has-content-toolbar': !previewMode && !isCloudTab && activeBuilderGroup === 'content' && !isEmptyDocument }" @focusout="onPreviewInputBlur" @pointerdown.capture="onPreviewSliderPointerDown" @pointerup.capture="commitDeferredSliderPreview" @pointercancel.capture="commitDeferredSliderPreview">
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

    <FullDocumentPreview v-model="previewMode" v-model:page="activeFullPreviewPage" v-model:mode="fullPreviewMode"
      :pages="activeFullPreviewPages" :is-updating="isActiveFullPreviewRendering" :lang="lang"
      :modes="[{ value: 'normal', label: t('normalPdf') }, { value: 'anonymized', label: t('privacyPdf') }, { value: 'html', label: t('rawHtml') }]"
      :downloading="isActiveFullPreviewExporting" :download-label="activeFullPreviewDownloadLabel" :title="t('liveCvPreview')" :error="pdfExportError" @download="exportActiveFullPreview">
      <template #html><CvPreview :state="isAnonymizedFullPreview ? anonymizedState : state" :anonymized="isAnonymizedFullPreview" /></template>
    </FullDocumentPreview>

    <section v-show="!previewMode" class="builder-shell">
      <header v-if="!isMobile" class="builder-topbar">
        <nav class="builder-topbar__tabs" role="tablist" :aria-label="t('content')">
          <button
            v-for="group in workspaceGroups"
            :key="group.key"
            class="builder-topbar__tab"
            :class="{ 'is-active': activeWorkspace === group.key }"
            type="button"
            role="tab"
            :aria-selected="activeWorkspace === group.key"
            :aria-controls="`builder-group-${group.key}`"

            @click="selectWorkspace(group.key)"
          >
            <font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" />
            <span>{{ group.label }}</span>
          </button>
        </nav>

        <div class="builder-topbar__utilities">
          <SupabaseAuth class="builder-topbar__auth" :lang="lang === 'de' ? 'de' : 'en'" />
        </div>
      </header>


      <div v-show="!isCloudTab" class="cv-studio-navigation">
        <nav class="cv-studio-subtabs" aria-label="CV Studio sections">
          <button v-for="group in builderGroups" :key="group.key" class="btn" :class="{ 'is-active': activeBuilderGroup === group.key }" :aria-pressed="activeBuilderGroup === group.key" :disabled="groupDisabled(group.key)" type="button" @click="selectBuilderGroup(group.key)">{{ group.label }}</button>
        </nav>
        <div class="cv-studio-version">
          <select class="cv-studio-configuration" :value="selectedRootId" :aria-label="lang === 'de' ? 'Karrierevariante' : 'Career variant'" @change="selectConfiguration">
            <option v-if="!selectedConfigurationId" value="" disabled>{{ t('noSavedVersion') }}</option>
            <option v-for="configuration in rootConfigurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option>
          </select>
          <select v-if="subConfigurations.length" class="cv-studio-configuration" :value="selectedConfigurationId" :aria-label="lang === 'de' ? 'Untervariante' : 'Subvariant'" @change="selectConfiguration">
            <option :value="selectedRootId">{{ lang === 'de' ? 'Original' : 'Original' }}</option>
            <option v-for="configuration in subConfigurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option>
          </select>
          <button v-if="isMobile" class="btn cv-studio-open-preview" type="button" :disabled="isEmptyDocument" @click="openFullPreview">{{ t('openPreview') }}</button>
        </div>
        <output class="cv-save-announcement" aria-live="polite" aria-atomic="true">{{ saveStatusLabel }}</output>
      </div>
      <section v-if="isCloudTab && !cloudUser" class="workspace-sign-in"><h1>{{ activeWorkspace === 'opportunities' ? (lang === 'de' ? 'Stellenangebote entdecken' : 'Discover opportunities') : (lang === 'de' ? 'Bewerbungen vorbereiten' : 'Prepare applications') }}</h1><p>{{ lang === 'de' ? 'Melde dich bei Supabase an, um auf deinen Bewerbungsbereich zuzugreifen. Das CV-Studio ist auch ohne Anmeldung verfügbar.' : 'Sign in to Supabase to access your application workspace. CV Studio remains available without an account.' }}</p></section>

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
        :create-subvariant="createSubvariant"
        @navigate="selectBuilderGroup"
        @save-career-variant="saveCareerVariant"
        @edit-variant="openStudioVariant"
      />

      <section v-show="!isCloudTab" id="builder-group-cv-studio" class="builder-layout">
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
            ><template #history><VariantHistory v-if="selectedConfigurationId && !isBuiltinDocument(selectedConfigurationId)" :variant-id="selectedConfigurationId" :state="state" @restore="mergeIn" /></template></BackupManager>
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
          <LetterTemplates v-show="activeBuilderGroup === 'templates'" class="builder-group-panel studio-templates" :user-id="cloudUser?.id || 'local'" :lang="lang" />
        </div>

        <InlineDocumentPreview v-if="!isMobile" class="studio-inline-preview" v-model:page="previewPage" :pages="previewPages" :is-updating="isPreviewRendering" :lang="lang" :downloading="isExporting" :title="t('liveCvPreview')" @open="openFullPreview" @download="handleExportPdf" />
      </section>
    </section>

    <nav class="mobile-bottom-tabs" aria-label="Workspaces">
      <button v-for="group in workspaceGroups" :key="group.key" class="builder-topbar__tab" :class="{ 'is-active': activeWorkspace === group.key }" :aria-pressed="activeWorkspace === group.key" type="button" @click="selectWorkspace(group.key)"><font-awesome-icon :icon="['fas', group.icon]" aria-hidden="true" /><span>{{ group.label }}</span></button>
      <SupabaseAuth v-if="isMobile" class="mobile-bottom-auth" :lang="lang === 'de' ? 'de' : 'en'" bottom-bar />
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
  padding: 10px;
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
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  max-width: 1540px;
  margin: 0 auto;
  overflow: hidden;
}

.builder-shell > .builder-layout, .builder-shell > .jobs-workspace { flex: 1 1 auto; height: auto; }
.builder-shell > .builder-topbar, .cv-studio-navigation { flex: 0 0 auto; }
.builder-topbar, .cv-studio-navigation { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; }
.cv-studio-navigation { align-items: center; }
.cv-studio-subtabs { display: flex; flex-wrap: wrap; gap: 8px; }
.cv-studio-subtabs .is-active { border-color: #67c8a6; background: #185b4c; }
.cv-studio-version { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cv-studio-configuration { flex: 1 1 auto; width: 0; min-width: 0; }
.cv-studio-open-preview { flex: 0 0 auto; white-space: nowrap; }
.cv-save-announcement { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.workspace-sign-in { padding: 30px; border: 1px solid #24504e; border-radius: 12px; color: #cbe5da; background: #06141f; }

.builder-topbar {
  position: relative;
  z-index: 20;
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
  justify-self: end;
}

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
.builder-layout__controls .studio-templates { height: 100%; overflow: hidden; padding: 0; }

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

@media (min-width: 761px) and (max-height: 600px) {
  .builder-topbar__tab { min-height: 42px; }
  .builder-topbar__tab .svg-inline--fa { display: none; }
}

@media (max-width: 1180px) {
  .cv-builder-app {
    padding-right: 24px;
  }

  .builder-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(260px, 42vh);
  }

  .studio-inline-preview { width: min(100%, 520px); justify-self: center; }
}

@media (min-width: 761px) and (max-width: 1180px) and (max-height: 600px) {
  .builder-layout { grid-template-rows: minmax(0, 1fr) auto; }
}

@media (max-width: 760px) {
  .cv-builder-app {
    --mobile-tabs-height: calc(72px + env(safe-area-inset-bottom, 0px));
    --mobile-content-toolbar-height: 60px;
    --mobile-content-toolbar-space: 0px;
    padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) calc(var(--mobile-tabs-height) + var(--mobile-content-toolbar-space) + 12px) max(12px, env(safe-area-inset-left, 0px));
  }

  .cv-builder-app.has-content-toolbar { --mobile-content-toolbar-space: var(--mobile-content-toolbar-height); }
  .cv-builder-app.is-cloud-workspace { padding: max(8px, env(safe-area-inset-top, 0px)) max(8px, env(safe-area-inset-right, 0px)) calc(var(--mobile-tabs-height) + 8px) max(8px, env(safe-area-inset-left, 0px)); }
  .cv-builder-app.is-preview-mode { overflow: hidden; }
  .cv-studio-navigation { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .cv-studio-version { gap: 8px; }
  .cv-studio-open-preview { padding-inline: 10px; }
  .builder-shell { grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
  .builder-layout { grid-template-rows: minmax(0, 1fr); gap: 0; }

  .mobile-bottom-tabs {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
    gap: 4px;
    height: var(--mobile-tabs-height);
    padding: 8px max(8px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
    border-top: 1px solid #134e4a;
    background: #06141f;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, .2);
  }
  .mobile-bottom-tabs .builder-topbar__tab { min-width: 0; min-height: 0; padding: 4px 2px; gap: 5px; font-size: 10px; border: none; }
  .mobile-bottom-tabs .builder-topbar__tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .mobile-bottom-auth { min-width: 0; height: 100%; }
  .pdf-export-error { bottom: calc(var(--mobile-tabs-height) + var(--mobile-content-toolbar-space) + 12px); }


}

</style>
