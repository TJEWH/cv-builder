<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { debounce, loadLocal, saveLocal } from './composables/useStorage';
import { useCvDesign } from './composables/useCvDesign';
import { usePdfExport } from './composables/usePdfExport';
import FormBuilder from './components/FormBuilder.vue';
import CvPreview from './components/CvPreview.vue';
import BackupManager from './components/BackupManager.vue';
import DesignPanel from './components/DesignPanel.vue';
import { makeT } from './i18n/dict';

const state = reactive({
  version: 1,
  disabled: [],
  lang: 'de',
  design: {
    h1: '22pt', h2: '12pt', h3: '10pt', bullets: '10.5pt', bulletStyle: 'disc',
    ink: '#111827', accent: '#0f66d0', bg: '#ffffff', headerbg: '#CE9048', sidebarbg: '#CE9048',
    fontBody: 'Inter', fontHead: 'Inter', hstyle: 'clean', radius: '10px',
    subtitle: '#0a9c91', graphic: '#4f46e5', dateColor: '#6b7280',
    badgeBorderWidth: '1px', badgeBorderRadius: '6px', invertBadge: false, enableBoxShadow: false,
    itemBorderWidth: '1px',
    sectionSpacing: '6mm', sectionSpacingBody: '6mm', sectionSpacingSidebar: '6mm',
    sidebarWidth: '0.7fr', sidebarAlign: 'right', sidebarStyle: 'default', addExpColumns: '2',
  },
  contact: { name: '', location: '', role: '', email: '', phone: '', website: '', linkedin: '' },
  about: { text: '' },
  education: [],
  experience: { jobs: [], addExp: [], projects: [] },
  skills: [
    { title: 'Programmiersprachen', levelType: null, items: [{ name: 'Python', levelValue: 0 }, { name: 'TypeScript', levelValue: 0 }, { name: 'Go', levelValue: 0 }] },
    { title: 'Frameworks', levelType: null, items: [{ name: 'React', levelValue: 0 }, { name: 'Docker', levelValue: 0 }, { name: 'Kubernetes', levelValue: 0 }] },
  ],
  languages: [],
  certs: [],
  hobbies: [{ name: 'Musik', details: '' }],
  customSections: [],
  sectionNames: {},
  sectionHeaderSizes: {},
  softSkills: [
    { label: 'Anpassungsfähigkeit', desc: '', refs: [] },
    { label: 'Kritisches Denken', desc: '', refs: [] },
    { label: 'Kreative Problemlösung', desc: '', refs: [] },
  ],
  orderMain: ['about', 'education', 'jobs', 'addExp', 'projects'],
  orderSide: ['skills', 'languages', 'hobbies', 'certs'],
});

const lang = computed({
  get: () => state.lang ?? 'de',
  set: (value) => { state.lang = value; },
});
const previewMode = ref(false);
const sectionMovementMode = ref('drag');
const t = makeT(lang);

const inlinePreviewViewport = ref(null);
const inlinePreviewSize = ref({ width: 333, height: 472, scale: 0.42 });
const previewPageSize = { width: 794, height: 1123 };
let inlinePreviewObserver;
let inlinePreviewPageObserver;

function resizeInlinePreview() {
  const viewport = inlinePreviewViewport.value;
  if (!viewport) return;

  const padding = 16;
  const page = viewport.querySelector('.page');
  const scale = Math.max(0.1, (viewport.clientWidth - padding) / previewPageSize.width);
  const contentHeight = Math.max(page?.scrollHeight || 0, previewPageSize.height);
  inlinePreviewSize.value = {
    scale,
    width: Math.floor(previewPageSize.width * scale),
    height: Math.ceil(contentHeight * scale),
  };
}

function bindInlinePreviewViewport(element) {
  inlinePreviewObserver?.disconnect();
  inlinePreviewPageObserver?.disconnect();
  inlinePreviewViewport.value = element;
  if (!element) return;
  inlinePreviewObserver = new ResizeObserver(resizeInlinePreview);
  inlinePreviewObserver.observe(element);
  nextTick(() => {
    if (inlinePreviewViewport.value !== element) return;
    const page = element.querySelector('.page');
    if (page) {
      inlinePreviewPageObserver = new ResizeObserver(resizeInlinePreview);
      inlinePreviewPageObserver.observe(page);
    }
    resizeInlinePreview();
  });
}

onBeforeUnmount(() => {
  inlinePreviewObserver?.disconnect();
  inlinePreviewPageObserver?.disconnect();
});

const saveDebounced = debounce(() => saveLocal(JSON.parse(JSON.stringify(state))), 250);
watch(state, saveDebounced, { deep: true });
useCvDesign(() => state.design);

function mergeIn(data) {
  if (!data) return;

  Object.assign(state, data);
  state.experience ||= { jobs: [], addExp: [], projects: [] };
  state.experience.jobs ||= [];
  state.experience.addExp ||= [];
  state.experience.projects ||= [];
  state.skills ??= [];

  const hasNewCustomSections = Array.isArray(data.customSections) && data.customSections.length > 0;
  if (Array.isArray(data.custom) && data.custom.length > 0 && !hasNewCustomSections) {
    const customSection = {
      id: `custom_${Date.now()}`,
      name: lang.value === 'de' ? 'Eigene Section' : 'Custom Section',
      entries: data.custom,
    };
    state.customSections = [customSection];
    state.orderMain = (state.orderMain || []).filter((key) => key !== 'custom');
    if (!state.orderMain.includes(customSection.id)) state.orderMain.push(customSection.id);
  }
}

onMounted(async () => {
  const cached = loadLocal();
  if (cached) {
    mergeIn(cached);
    return;
  }

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}cv-defaults.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load defaults: ${response.status}`);
    mergeIn(await response.json());
  } catch (error) {
    console.warn('Failed to load default CV data', error);
  }
});

const { exportToPdf } = usePdfExport();
const isExporting = ref(false);

async function handleExportPdf() {
  isExporting.value = true;
  let exportElement;
  try {
    await nextTick();
    const cvElement = document.querySelector('.cv-preview-export .page');
    if (!cvElement) throw new Error('CV preview element not found');
    const filename = `${(state.contact?.name || 'CV').replace(/\s+/g, '_')}_CV`;
    exportElement = cvElement;
    cvElement.classList.add('pdf-export-source');
    await exportToPdf(cvElement, filename);
  } catch (error) {
    console.error('PDF export failed:', error);
  } finally {
    exportElement?.classList.remove('pdf-export-source');
    isExporting.value = false;
  }
}
</script>

<template>
  <main class="cv-builder-app" :class="{ 'is-preview-mode': previewMode }">
    <section v-if="previewMode" class="fullscreen-preview" aria-label="CV preview">
      <div class="fullscreen-preview__content">
        <div class="fullscreen-preview__page cv-preview-export">
          <CvPreview :state="state" />
        </div>
        <div class="preview-actions preview-actions--full">
          <button class="btn" type="button" @click="previewMode = false">{{ t('backToBuilder') }}</button>
          <button class="btn btn--primary" type="button" @click="handleExportPdf" :disabled="isExporting">
            <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
            {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
          </button>
        </div>
      </div>
    </section>

    <section v-else class="builder-layout">
      <div class="builder-layout__controls">
        <BackupManager
          :state="state"
          v-model:lang="lang"
          v-model:movementMode="sectionMovementMode"
          :onSave="saveDebounced"
        />
        <DesignPanel v-model="state.design" :lang="lang" />
        <FormBuilder :state="state" :onSave="saveDebounced" :movementMode="sectionMovementMode" />
      </div>

      <aside class="inline-preview" aria-label="Live CV preview">
        <div class="inline-preview__header">Live Preview</div>
        <div ref="bindInlinePreviewViewport" class="inline-preview__viewport">
          <div class="inline-preview__page cv-preview-export" :style="{ width: `${inlinePreviewSize.width}px`, height: `${inlinePreviewSize.height}px` }">
            <CvPreview :state="state" />
          </div>
        </div>
        <div class="preview-actions">
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
  padding: 9px 12px;
  border-bottom: 1px dashed #113c34;
  color: #9be8c7;
  font-size: 13px;
  font-weight: 700;
}

.inline-preview__viewport {
  width: 100%;
  height: min(66vh, 520px);
  min-height: 320px;
  overflow: auto;
  background: #0b0f14;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 8px;
}

.inline-preview__page {
  overflow: hidden;
}

.inline-preview__page > .page {
  transform: scale(v-bind('inlinePreviewSize.scale'));
  transform-origin: top left;
}

.inline-preview__page > .page.pdf-export-source {
  transform: none;
}

.fullscreen-preview {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.fullscreen-preview__content { display: grid; justify-items: center; padding-bottom: 88px; }
.fullscreen-preview__page {
  width: 210mm;
  max-width: 100%;
}

.preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
  background: #061017;
}
.preview-actions .btn { width: 100%; }
.preview-actions--full {
  position: fixed;
  z-index: 20;
  bottom: 20px;
  left: 50%;
  width: min(calc(100% - 32px), 210mm);
  transform: translateX(-50%);
  border: 1px solid #2a3441;
  border-radius: 10px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, .35);
}

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
    justify-content: flex-start;
    overflow-x: auto;
  }

  .fullscreen-preview__page {
    max-width: none;
  }
}

@media print {
  .inline-preview,
  .preview-actions {
    display: none !important;
  }
}
</style>
