import { onBeforeUnmount, ref, watch } from 'vue';
import type { PreviewPage, RenderOptions } from '../pdfTypes';
import { createPreviewRenderSlot } from './pdfRenderTask';
import { usePdfExport } from './usePdfExport';
import { usePreviewInputCommit } from './usePreviewInputCommit';

/** One cancellable render per document, shared by its inline and full-size surfaces. */
export function useDocumentPdfPreview(input: {
  source: () => Promise<HTMLElement>;
  options: () => RenderOptions;
  signature: () => unknown;
  active: () => boolean;
  identity?: () => unknown[];
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
  const inputCommit = usePreviewInputCommit(() => {
    if (input.active()) {
      busy.value = true;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    }
  });
  let identity = input.identity?.();
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
  watch([input.signature, input.active, () => input.identity?.()], (_value, previous) => {
    slot.cancel();
    clearTimeout(timer);
    // Exports may be awaiting the same DOM source. A temporary proposal switch,
    // even one immediately reverted, invalidates every export already in flight.
    for (const controller of exports) controller.abort();
    exports.clear();
    const nextIdentity = input.identity?.();
    const identityChanged = nextIdentity?.some((value, index) => value !== identity?.[index]) ?? false;
    identity = nextIdentity;
    if (input.active() && previous?.[1] && !identityChanged && inputCommit.defer()) {
      error.value = '';
      busy.value = false;
      return;
    }
    inputCommit.reset();
    // A new proposal/comparison must never retain pages from the previous source,
    // including while rendering is debounced or after the new render fails.
    pages.value = [];
    error.value = '';
    busy.value = false;
    if (input.active()) {
      busy.value = true;
      timer = setTimeout(() => void refresh(), 150);
    }
  }, { deep: true, immediate: true, flush: 'sync' });

  async function getPdfBlob(source = input.source): Promise<Blob> {
    const controller = new AbortController();
    exports.add(controller);
    try {
      const element = await source();
      controller.signal.throwIfAborted();
      const blob = await renderPdfBlob(element, { ...input.options(), signal: controller.signal });
      controller.signal.throwIfAborted();
      return blob;
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
