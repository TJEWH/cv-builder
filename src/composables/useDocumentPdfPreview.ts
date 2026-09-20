import { onBeforeUnmount, ref, watch } from 'vue';
import type { PreviewPage, RenderOptions } from '../pdfTypes';
import { createPreviewRenderSlot } from './pdfRenderTask';
import { usePdfExport } from './usePdfExport';

/** One cancellable render per document, shared by its inline and full-size surfaces. */
export function useDocumentPdfPreview(input: {
  source: () => Promise<HTMLElement>;
  options: () => RenderOptions;
  signature: () => unknown;
  active: () => boolean;
}) {
  const pages = ref<PreviewPage[]>([]);
  const page = ref(1);
  const busy = ref(false);
  const downloading = ref(false);
  const error = ref('');
  const slot = createPreviewRenderSlot();
  const exports = new Set<AbortController>();
  const { renderPreview, renderPdfBlob, exportToPdf, revokeDownloads } = usePdfExport();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    if (!input.active()) return;
    const signal = slot.start();
    busy.value = true;
    error.value = '';
    try {
      const element = await input.source();
      signal.throwIfAborted();
      const result = await renderPreview(element, { ...input.options(), signal });
      if (!signal.aborted) {
        pages.value = result.pages;
        page.value = Math.min(page.value, Math.max(1, result.pages.length));
      }
    } catch (cause) {
      if (!signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally { if (!signal.aborted) busy.value = false; }
  }
  watch([input.signature, input.active], () => {
    slot.cancel();
    clearTimeout(timer);
    busy.value = false;
    if (input.active()) {
      busy.value = true;
      timer = setTimeout(() => void refresh(), 150);
    }
  }, { deep: true, immediate: true, flush: 'post' });

  async function getPdfBlob(source = input.source): Promise<Blob> {
    const controller = new AbortController();
    exports.add(controller);
    try {
      const element = await source();
      controller.signal.throwIfAborted();
      return await renderPdfBlob(element, { ...input.options(), signal: controller.signal });
    } finally { exports.delete(controller); }
  }
  async function download(filename: string) {
    if (downloading.value) return;
    const controller = new AbortController();
    exports.add(controller);
    downloading.value = true;
    error.value = '';
    try {
      const element = await input.source();
      controller.signal.throwIfAborted();
      await exportToPdf(element, filename, { ...input.options(), signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally { exports.delete(controller); downloading.value = false; }
  }
  onBeforeUnmount(() => {
    clearTimeout(timer);
    slot.cancel();
    for (const controller of exports) controller.abort();
    exports.clear();
    revokeDownloads();
  });
  return { pages, page, busy, downloading, error, getPdfBlob, download, refresh };
}
