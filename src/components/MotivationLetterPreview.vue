<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CvState } from '../types';
import type { LetterContent } from '../letterTypes';
import { resolveDesign } from '../defaults';
import { applyCvDesign } from '../composables/useCvDesign';
import { useDocumentPdfPreview } from '../composables/useDocumentPdfPreview';
import { resolveLetterContent, unresolvedLetterPlaceholders } from '../composables/motivationLetters';
import CvContact from './CvContact.vue';
import InlineDocumentPreview from './InlineDocumentPreview.vue';
import FullDocumentPreview from './FullDocumentPreview.vue';

const props = withDefaults(defineProps<{
  cvState: CvState | null; content: LetterContent; active?: boolean; lang?: string;
  downloadDisabled?: boolean; downloading?: boolean; downloadError?: string;
}>(), { active: true, lang: '', downloadDisabled: false, downloading: false, downloadError: '' });
const emit = defineEmits<{ download: [] }>();
const page = ref<HTMLElement | null>(null);
const expanded = ref(false);
const previewLang = computed(() => props.lang || props.cvState?.lang || 'en');
const title = computed(() => previewLang.value === 'de' ? 'Motivationsschreiben' : 'Motivation letter');
const design = computed(() => resolveDesign(props.cvState?.design));
const resolved = computed(() => resolveLetterContent(props.content, props.cvState?.contact || null));
const paragraphs = computed(() => resolved.value.body.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()));
const margin = (value: string) => Math.max(0, Math.min(30, Number.parseFloat(value) || 0));
const margins = computed(() => [margin(design.value.pageMarginTop), margin(design.value.pageMarginLeft), margin(design.value.pageMarginBottom), margin(design.value.pageMarginRight)]);
const pageStyle = computed(() => ({
  width: `${210 - margins.value[1] - margins.value[3]}mm`,
  minHeight: `${297 - margins.value[0] - margins.value[2]}mm`,
}));
function applyDesign() { if (page.value) applyCvDesign(props.cvState?.design || {}, page.value); }
watch(() => props.cvState?.design, applyDesign, { deep: true, flush: 'post' });
async function element() {
  await nextTick();
  if (!page.value) throw new Error('The motivation letter is unavailable.');
  applyDesign();
  return page.value;
}
const { pages, page: previewPage, busy, error, getPdfBlob: renderPdfBlob } = useDocumentPdfPreview({
  source: element, options: () => ({ margin: margins.value }),
  signature: () => [props.cvState, props.content], active: () => props.active,
});
watch(() => props.active, (active) => { if (!active) expanded.value = false; });
async function getPdfBlob(): Promise<Blob> {
  if (!props.cvState) throw new Error('Assign a CV before exporting the motivation letter.');
  if (!props.content.body.trim()) throw new Error('The motivation letter is empty.');
  if (unresolvedLetterPlaceholders(props.content, props.cvState.contact).length) throw new Error('Resolve the letter placeholders before exporting.');
  return renderPdfBlob();
}
defineExpose({ getPdfBlob, getRenderElement: () => page.value, open: () => { expanded.value = true; } });
</script>

<template>
  <div class="letter-preview">
    <InlineDocumentPreview :pages="pages" v-model:page="previewPage" :is-updating="busy" :lang="previewLang" :title="title" :download-disabled="downloadDisabled" :downloading="downloading" @open="expanded = true" @download="emit('download')">
      <template #header><p v-if="error" class="letter-preview__error" role="alert">{{ error }}</p></template>
    </InlineDocumentPreview>
    <FullDocumentPreview v-model="expanded" v-model:page="previewPage" :pages="pages" :is-updating="busy" :lang="previewLang" :title="title" :error="downloadError || error" :download-disabled="downloadDisabled" :downloading="downloading" @download="emit('download')" />
    <div class="letter-preview__source" aria-hidden="true">
      <article ref="page" class="motivation-letter cv-design-scope" :style="pageStyle">
        <header v-if="cvState && !cvState.disabled.includes('header')" class="letter-header">
          <div>
            <h1>{{ cvState.contact.name }}</h1>
            <p v-if="cvState.contact.role" class="letter-role">{{ cvState.contact.role }}</p>
          </div>
          <CvContact :contact="cvState.contact" />
        </header>
        <h2 v-if="resolved.subject" class="letter-subject">{{ resolved.subject }}</h2>
        <p v-if="resolved.salutation" class="letter-salutation">{{ resolved.salutation }}</p>
        <p v-for="(paragraph, index) in paragraphs" :key="index" class="letter-paragraph">{{ paragraph }}</p>
        <p v-if="resolved.closing" class="letter-closing">{{ resolved.closing }}</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.letter-preview{min-width:0;min-height:0;height:100%;overflow:hidden}
.letter-preview__source{position:fixed;left:-20000px;top:0;width:210mm;pointer-events:none}
.letter-preview__error{margin:0;color:#fecaca;font-size:12px;overflow-wrap:anywhere}
@media(max-width:760px),(max-width:1180px) and (max-height:600px){.letter-preview{height:auto;flex:0 0 auto}}
.motivation-letter{font:var(--paragraph-size)/1.55 var(--font-body);color:var(--ink);background:white;overflow-wrap:anywhere}
.letter-header{display:flex;justify-content:space-between;gap:10mm;padding:4mm 5mm;margin-bottom:8mm;border-radius:3mm;background:var(--accent-soft);break-inside:avoid}
.letter-header h1{font:800 var(--h1-size)/1.15 var(--font-head);margin:0;color:var(--ink)}
.letter-role{margin:2mm 0 0;font-size:var(--h3-size)}
.letter-header :deep(.contact){font:normal 8pt/1.5 var(--font-body);text-align:right;min-width:50mm;max-width:85mm}
.letter-header :deep(.contact>div){display:flex;justify-content:flex-end;gap:2mm;align-items:center}
.letter-header :deep(.contact-icon){width:8pt;height:8pt;flex-shrink:0}
.letter-header :deep(a){color:inherit}
.motivation-letter[data-header-layout-style="separator"] .letter-header{border-radius:0;background:white;padding:0 0 5mm;border-bottom:var(--separator-width) solid var(--graphic)}
.motivation-letter[data-contact-layout="below"] .letter-header{flex-direction:column;gap:3mm}
.motivation-letter[data-contact-layout="below"] .letter-header :deep(.contact){text-align:left;max-width:none}
.motivation-letter[data-contact-layout="below"] .letter-header :deep(.contact>div){justify-content:flex-start}
.letter-subject{font:700 var(--h2-size)/1.4 var(--font-head);text-transform:none;letter-spacing:0;margin:0 0 6mm;break-inside:avoid}
.letter-paragraph,.letter-salutation,.letter-closing{white-space:pre-wrap;margin:0 0 4mm;break-inside:avoid}
.letter-closing{margin-top:7mm}
</style>
