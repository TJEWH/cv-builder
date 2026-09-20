<script setup lang="ts">
import { computed } from 'vue';
import type { PreviewPage } from '../pdfTypes';
import { makeT } from '../i18n/dict';
import PdfPreview from './PdfPreview.vue';
import PdfPagination from './PdfPagination.vue';

const props = withDefaults(defineProps<{
  pages: PreviewPage[]; page: number; isUpdating?: boolean; lang: string;
  downloading?: boolean; downloadDisabled?: boolean; title?: string;
}>(), { isUpdating: false, downloading: false, downloadDisabled: false, title: '' });
const emit = defineEmits<{ 'update:page': [value: number]; open: []; download: [] }>();
const t = makeT(computed(() => props.lang));
</script>

<template>
  <aside class="document-inline-preview" :aria-label="title || t('liveCvPreview')">
    <div class="document-inline-preview__header">
      <slot name="header" />
      <div class="document-inline-preview__actions">
        <button class="btn" type="button" @click="emit('open')">{{ t('openPreview') }}</button>
        <button class="btn btn--primary" type="button" :disabled="downloading || downloadDisabled" @click="emit('download')">
          <font-awesome-icon v-if="downloading" :icon="['fas', 'spinner']" spin />
          {{ t(downloading ? 'exportingPdf' : 'downloadPdf') }}
        </button>
      </div>
    </div>
    <div class="document-inline-preview__viewport">
      <PdfPreview :pages="pages" :page="page" :is-updating="isUpdating" :lang="lang" gesture-navigation @update:page="emit('update:page', $event)" />
      <PdfPagination class="document-inline-preview__pagination" :pages="pages" :page="page" :lang="lang" @update:page="emit('update:page', $event)" />
    </div>
  </aside>
</template>

<style scoped>
.document-inline-preview{display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px;min-width:0;min-height:0;height:100%;overflow:hidden;background:transparent}
.document-inline-preview__header{display:grid;gap:10px;min-width:0}
.document-inline-preview__actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:min(100%,794px);justify-self:center}
.document-inline-preview__actions .btn{width:100%;min-width:0;display:flex;align-items:center;justify-content:center;gap:6px}
.document-inline-preview__viewport{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.document-inline-preview :deep(.pdf-preview){width:min(100%,794px);margin:0 auto}
.document-inline-preview :deep(.pdf-preview__stage){display:block;min-height:0;overflow:visible;border-radius:0;background:transparent}
.document-inline-preview :deep(.pdf-preview__page){width:100%;height:auto;max-width:794px;box-shadow:none}
.document-inline-preview__pagination{min-width:0;width:min(100%,794px);margin:10px auto 0}
@media(max-width:760px),(max-width:1180px) and (max-height:600px){.document-inline-preview{height:auto;display:block}.document-inline-preview__viewport{display:none}}
</style>
