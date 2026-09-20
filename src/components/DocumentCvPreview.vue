<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CvState } from '../types';
import { designNumber, resolveDesign } from '../defaults';
import { useDocumentPdfPreview } from '../composables/useDocumentPdfPreview';
import { createAnonymizedState } from '../composables/anonymization';
import CvPreview from './CvPreview.vue';
import InlineDocumentPreview from './InlineDocumentPreview.vue';
import FullDocumentPreview from './FullDocumentPreview.vue';

const props = withDefaults(defineProps<{ state: CvState; active?: boolean; privacy?: boolean }>(), { active: true, privacy: false });
const source = ref<HTMLElement | null>(null);
const privacySource = ref<HTMLElement | null>(null);
const privacyState = computed(() => createAnonymizedState(props.state));
const expanded = ref(false);
const mode = ref('normal');
const activePrivacy = computed(() => expanded.value ? mode.value === 'anonymized' : props.privacy);
const modes = computed(() => [
  { value: 'normal', label: props.state.lang === 'de' ? 'Normales PDF' : 'Normal PDF' },
  { value: 'anonymized', label: props.state.lang === 'de' ? 'Anonymisiertes PDF' : 'Privacy PDF' },
  { value: 'html', label: props.state.lang === 'de' ? 'HTML-Ansicht' : 'Raw HTML' },
]);
const options = computed(() => {
  const design = resolveDesign(props.state.design);
  const margin = ['pageMarginTop', 'pageMarginLeft', 'pageMarginBottom', 'pageMarginRight'].map((key) => Math.min(30, Math.max(0, designNumber(design, key as keyof typeof design))));
  return { margin, continuationTopPadding: designNumber(design, 'headerBottomMargin'), sidebarFillMode: design.sidebarFillMode, sidebarHeightMode: design.sidebarHeightMode };
});
async function element(privacy = activePrivacy.value) {
  await nextTick();
  const value = (privacy ? privacySource.value : source.value)?.querySelector<HTMLElement>('.page');
  if (!value) throw new Error('The application CV is unavailable.');
  return value;
}
const { pages, page, busy, downloading, error, getPdfBlob: renderPdfBlob, download: downloadPdf } = useDocumentPdfPreview({
  source: () => element(), options: () => options.value,
  signature: () => [props.state, activePrivacy.value], active: () => props.active,
});
// Never leave a private page visible beneath a newly selected privacy mode.
watch(activePrivacy, () => { pages.value = []; page.value = 1; });
watch(() => props.active, (active) => { if (!active) expanded.value = false; });
function open() { mode.value = props.privacy ? 'anonymized' : 'normal'; expanded.value = true; }
async function getPdfBlob() { return renderPdfBlob(() => element(false)); }
async function download() { await downloadPdf(activePrivacy.value ? 'anonymized-application-cv' : 'application-cv'); }
defineExpose({ getPdfBlob, download, open });
</script>

<template>
  <div class="document-preview">
    <InlineDocumentPreview :pages="pages" v-model:page="page" :is-updating="busy" :lang="state.lang" :downloading="downloading" :title="state.lang === 'de' ? 'Bewerbungs-CV' : 'Application CV'" @open="open" @download="download">
      <template #header><slot /><p v-if="error" class="document-preview__error" role="alert">{{ error }}</p></template>
    </InlineDocumentPreview>
    <FullDocumentPreview v-model="expanded" v-model:mode="mode" v-model:page="page" :pages="pages" :is-updating="busy" :lang="state.lang" :modes="modes" :downloading="downloading" :error="error" :title="state.lang === 'de' ? 'Bewerbungs-CV' : 'Application CV'" @download="download">
      <template #html><CvPreview :state="state" /></template>
    </FullDocumentPreview>
    <div ref="source" class="document-preview__source" aria-hidden="true"><CvPreview :state="state" export-source /></div>
    <div ref="privacySource" class="document-preview__source" aria-hidden="true"><CvPreview :state="privacyState" export-source anonymized /></div>
  </div>
</template>

<style scoped>
.document-preview{min-width:0;min-height:0;height:100%;overflow:hidden}
.document-preview__error{margin:0;color:#fecaca;font-size:12px;overflow-wrap:anywhere}
.document-preview__source{position:fixed;left:-20000px;top:0;width:210mm;pointer-events:none}
@media(max-width:760px),(max-width:1180px) and (max-height:600px){.document-preview{height:auto;flex:0 0 auto}}
</style>
