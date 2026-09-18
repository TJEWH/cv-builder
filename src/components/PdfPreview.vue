<script setup lang="ts">
import type { PropType } from 'vue';
import type { PreviewPage } from '../pdfTypes';
import { computed } from 'vue';
import { makeT } from '../i18n/dict.ts';

const props = defineProps({
  pages: { type: Array as PropType<PreviewPage[]>, default: () => [] },
  page: { type: Number, default: 1 },
  isUpdating: { type: Boolean, default: false },
  lang: { type: String, required: true },
});

const langRef = computed(() => props.lang);
const t = makeT(langRef);
const totalPages = computed(() => props.pages.length);
const currentPage = computed(() => Math.min(Math.max(props.page, 1), Math.max(totalPages.value, 1)));
const currentPageData = computed(() => props.pages[currentPage.value - 1]?.svg || '');
</script>

<template>
  <section class="pdf-preview" :aria-busy="isUpdating">
    <div class="pdf-preview__stage">
      <div
        v-if="currentPageData"
        class="pdf-preview__page"
        :aria-label="`${t('pdfPage')} ${currentPage}`"
        v-html="currentPageData"
      />
      <div v-else class="pdf-preview__empty" role="status">{{ t('previewLoading') }}</div>
      <div v-if="isUpdating" class="pdf-preview__status" role="status">
        {{ currentPageData ? t('previewUpdating') : t('previewLoading') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.pdf-preview { width: 100%; min-width: 0; }
.pdf-preview__stage { position: relative; display: grid; min-height: 220px; place-items: center; overflow: hidden; border-radius: 6px; background: #0b0f14; }
.pdf-preview__page { display: block; width: min(100%, 794px); height: auto; box-shadow: 0 5px 18px rgba(0, 0, 0, .4); }
.pdf-preview__page :deep(> svg) { display: block; width: 100%; height: auto; }
.pdf-preview__empty { color: #9be8c7; font-size: 13px; }
.pdf-preview__status { position: absolute; top: 8px; right: 8px; padding: 4px 7px; border: 1px solid #2a3441; border-radius: 6px; background: rgba(6, 16, 23, .9); color: #cbd5e1; font-size: 11px; }
</style>
