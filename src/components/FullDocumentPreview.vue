<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PreviewPage } from '../pdfTypes';
import { makeT } from '../i18n/dict';
import PdfPreview from './PdfPreview.vue';
import PdfPagination from './PdfPagination.vue';

const props = withDefaults(defineProps<{
  modelValue: boolean; pages: PreviewPage[]; page: number; isUpdating?: boolean; lang: string;
  mode?: string; modes?: { value: string; label: string }[];
  downloading?: boolean; downloadDisabled?: boolean; downloadLabel?: string; title?: string; error?: string;
}>(), { isUpdating: false, mode: 'normal', modes: () => [], downloading: false, downloadDisabled: false, downloadLabel: '', title: '', error: '' });
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'update:page': [value: number]; 'update:mode': [value: string]; download: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const mobileViewport = window.matchMedia('(max-width: 760px)');
const mobile = ref(mobileViewport.matches);
const syncViewport = () => { mobile.value = mobileViewport.matches; };
const t = makeT(computed(() => props.lang));
const showPdf = computed(() => mobile.value || props.mode !== 'html');
const mobileModes = computed(() => props.modes.filter(({ value }) => value !== 'html'));
const currentMobileMode = computed(() => mobileModes.value.find(({ value }) => value === props.mode) || mobileModes.value[0]);
function nextMode() {
  const index = mobileModes.value.findIndex(({ value }) => value === currentMobileMode.value?.value);
  const next = mobileModes.value[(index + 1) % mobileModes.value.length];
  if (next) emit('update:mode', next.value);
}
watch([() => props.modelValue, dialog], ([open, element]) => {
  if (!element) return;
  if (open && !element.open) element.showModal();
  else if (!open && element.open) element.close();
}, { flush: 'post' });
onMounted(() => mobileViewport.addEventListener('change', syncViewport));
onBeforeUnmount(() => mobileViewport.removeEventListener('change', syncViewport));
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="document-full-preview" :aria-label="title || t('liveCvPreview')" @close="emit('update:modelValue', false)">
      <template v-if="modelValue">
        <div class="document-full-preview__toolbar">
          <button class="btn document-full-preview__back" type="button" :aria-label="t('backToBuilder')" autofocus @click="emit('update:modelValue', false)">
            <font-awesome-icon :icon="['fas', 'arrow-left']" aria-hidden="true" />
            <span>{{ t('backToBuilder') }}</span>
          </button>
          <div class="document-full-preview__actions">
            <button v-if="mobile && mobileModes.length > 1" class="btn" type="button" :aria-label="t(mode === 'anonymized' ? 'showNormalPreview' : 'showAnonymizedPreview')" :aria-pressed="mode === 'anonymized'" @click="nextMode">
              <font-awesome-icon :icon="['fas', mode === 'anonymized' ? 'user-secret' : 'eye']" aria-hidden="true" />
              <span>{{ t(mode === 'anonymized' ? 'privacyPreview' : 'normalPreview') }}</span>
            </button>
            <select v-else-if="!mobile && modes.length > 1" :value="mode" :aria-label="t('previewFormat')" @change="emit('update:mode', ($event.target as HTMLSelectElement).value)">
              <option v-for="item in modes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <button class="btn btn--primary" type="button" :aria-label="downloadLabel || t(downloading ? 'exportingPdf' : 'downloadPdf')" :title="downloadLabel || undefined" :disabled="downloading || downloadDisabled" @click="emit('download')">
              <font-awesome-icon :icon="['fas', downloading ? 'spinner' : 'download']" :spin="downloading" aria-hidden="true" />
              <span>{{ t(downloading ? 'exportingPdf' : 'downloadPdf') }}</span>
            </button>
          </div>
        </div>
        <p v-if="error" class="document-full-preview__error" role="alert">{{ error }}</p>
        <div class="document-full-preview__content">
          <PdfPreview v-if="showPdf" :key="mode" :pages="pages" :page="page" :is-updating="isUpdating" :lang="lang" gesture-navigation :pinch-zoom="mobile" @update:page="emit('update:page', $event)" />
          <div v-else class="document-full-preview__html"><slot name="html" /></div>
        </div>
        <PdfPagination v-if="showPdf" class="document-full-preview__pagination" :pages="pages" :page="page" :lang="lang" fullscreen @update:page="emit('update:page', $event)" />
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.document-full-preview{position:fixed;inset:0;width:100%;height:100dvh;max-width:none;max-height:none;margin:0;padding:84px 16px 64px;border:0;border-radius:0;box-sizing:border-box;color:#d1fae5;background:#050d14;overflow:auto;overscroll-behavior:contain}
.document-full-preview[open]{display:flex;justify-content:center}
.document-full-preview::backdrop{background:#050d14}
.document-full-preview__content{width:min(100%,860px);min-width:0;margin:auto;align-self:flex-start;display:grid;justify-items:center}
.document-full-preview__html{width:min(100%,210mm);overflow:auto;background:#fff}
.document-full-preview__back,.document-full-preview__actions{position:fixed;top:20px;z-index:30}
.document-full-preview__back{left:20px;display:inline-flex;align-items:center;gap:8px}
.document-full-preview__actions{right:20px;display:flex;flex-direction:column;gap:8px;align-items:stretch}
.document-full-preview__actions select{min-height:36px;font:inherit;color:#d1fae5;background:#0b1b25;border:1px solid #28534e;border-radius:7px;padding:6px 10px}
.document-full-preview__actions .btn{display:flex;justify-content:center;align-items:center;gap:8px}
.document-full-preview__error{position:fixed;z-index:35;left:50%;bottom:64px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:10px 12px;margin:0;border:1px solid #733844;border-radius:8px;background:#3a1720;color:#fecaca;font:13px/1.4 system-ui;overflow-wrap:anywhere}
@media(max-width:760px){
  .document-full-preview{padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));overflow:hidden}
  .document-full-preview[open]{display:grid;grid-template-rows:auto minmax(0,1fr) 52px;gap:8px;justify-content:stretch}
  .document-full-preview__toolbar{display:flex;gap:8px;min-width:0}
  .document-full-preview__back{position:static;flex:0 0 44px;justify-content:center;padding:6px}
  .document-full-preview__back span{display:none}
  .document-full-preview__actions{position:static;display:flex;flex:1;flex-direction:row;gap:8px;min-width:0}
  .document-full-preview__actions .btn{flex:1;min-width:0;min-height:44px;padding:6px;font-size:clamp(11px,3vw,13px);line-height:1.2}
  .document-full-preview__actions .svg-inline--fa{flex:none;margin:0;font-size:16px}
  .document-full-preview__content{container-type:size;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;margin:0}
  .document-full-preview :deep(.pdf-preview),.document-full-preview :deep(.pdf-preview__stage){height:100%;min-height:0}
  .document-full-preview :deep(.pdf-preview__stage){background:transparent}
  .document-full-preview :deep(.pdf-preview__page){width:min(100cqw,calc(100cqh * 210 / 297),794px)}
}
</style>
