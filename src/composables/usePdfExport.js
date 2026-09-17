import html2pdf from 'html2pdf.js/src/index.js';
import { jsPDF } from 'jspdf';
import { createPdfRenderTask } from './pdfRenderTask.js';
import {
  createPdfPageSlices,
  createPdfPageGeometry,
  resolveLastPageSidebarPlacement,
} from './pdfPageGeometry.js';
import {
  capturePdfOverlay,
  drawPdfOverlay,
  rasterizePdfOverlay,
} from './pdfTextOverlay.js';
import {
  encodePdfPageImage,
  imageMimeType,
  normalizeExportOptions,
} from './pdfImageEncoding.js';
import { createPdfCanvasRecording } from './pdfCanvasRecording.js';
import { capturePdfLinks } from './pdfVectorLinks.js';

// html2canvas rounds source dimensions to device pixels. Keeping the deferred
// sidebar a couple of CSS pixels inside its final page prevents that rounding
// from becoming a tiny, otherwise empty continuation page.
const PDF_LAYOUT_END_BUFFER = 2;

function normaliseMargins(margin) {
  if (Array.isArray(margin)) {
    if (margin.length === 4) return margin.map((value) => Number(value) || 0);
    if (margin.length === 2) return [Number(margin[0]) || 0, Number(margin[1]) || 0, Number(margin[0]) || 0, Number(margin[1]) || 0];
  }

  const value = Number(margin) || 0;
  return [value, value, value, value];
}

function mergePdfOptions(options = {}) {
  const defaultOptions = {
    margin: 0,
    // Each exporter owns its annotations; html2pdf's link scan is unused.
    enableLinks: false,
    image: { format: 'jpeg', quality: 100 },
    html2canvas: {
      scale: 3,
      useCORS: true,
      letterRendering: true,
      scrollY: 0,
      scrollX: 0,
      imageTimeout: 0,
      logging: false,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true,
    },
  };

  return {
    ...defaultOptions,
    ...options,
    image: normalizeExportOptions({ ...defaultOptions.image, ...(options.image || {}) }),
    html2canvas: { ...defaultOptions.html2canvas, ...(options.html2canvas || {}) },
    jsPDF: { ...defaultOptions.jsPDF, ...(options.jsPDF || {}) },
  };
}

function previewScaleFor(width) {
  return Math.min(1, 1400 / width);
}

function createSourcePageGeometry(element, options, pdf) {
  const sourceBounds = element.getBoundingClientRect();
  const [marginTop, marginLeft, marginBottom, marginRight] = normaliseMargins(options.margin);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginLeft - marginRight;
  const firstPageHeight = pageHeight - marginTop - marginBottom;
  const continuationPadding = Math.min(
    Math.max(Number(options.continuationTopPadding) || 0, 0),
    Math.max(0, firstPageHeight - 1),
  );

  if (!sourceBounds.width || contentWidth <= 0 || firstPageHeight <= 0) return null;

  return createPdfPageGeometry({
    sourcePixelsPerMillimeter: sourceBounds.width / contentWidth,
    firstPageHeight,
    continuationTopPadding: continuationPadding,
  });
}

function resetSidebarPlacement(sidebar) {
  sidebar.style.display = '';
  sidebar.style.marginTop = '';
  sidebar.style.minHeight = '';
  sidebar.style.height = '';
  sidebar.style.removeProperty('--sidebar-deferred-start');
  sidebar.style.removeProperty('--sidebar-deferred-min-height');
  sidebar.removeAttribute('data-pdf-deferred');
}

function resetSidebarPagePlacement(element, sidebar) {
  element.querySelector?.('.content')?.style.removeProperty('padding-bottom');
  resetSidebarPlacement(sidebar);
}

function sidebarSourceBounds(element, sidebar) {
  const sourceBounds = element.getBoundingClientRect();
  const sidebarBounds = sidebar.getBoundingClientRect();
  return {
    top: sidebarBounds.top - sourceBounds.top,
    bottom: sidebarBounds.bottom - sourceBounds.top,
    height: sidebarBounds.height,
  };
}

function reserveSidebarColumnThroughItsLastPage(element, sidebar, geometry, terminalContentPadding = 0) {
  sidebar.style.minHeight = '';
  const sidebarBounds = sidebarSourceBounds(element, sidebar);
  if (!sidebarBounds.height) return 0;

  const lastSidebarPage = geometry.pageIndexForSourceY(Math.max(sidebarBounds.top, sidebarBounds.bottom - 0.01));
  const safeTerminalPadding = Math.max(0, Number(terminalContentPadding) || 0);
  const reservedHeight = Math.max(
    sidebarBounds.height,
    geometry.pageEnd(lastSidebarPage) - sidebarBounds.top - safeTerminalPadding - PDF_LAYOUT_END_BUFFER,
  );
  sidebar.style.minHeight = `${reservedHeight}px`;

  return lastSidebarPage;
}

function primaryContentSourceBottom(element) {
  const sourceTop = element.getBoundingClientRect().top;
  const primaryNodes = [
    element.querySelector?.('.header'),
    element.querySelector?.('#cv_main'),
  ].filter(Boolean);

  return primaryNodes.reduce(
    (bottom, node) => Math.max(bottom, node.getBoundingClientRect().bottom - sourceTop),
    0,
  );
}

function primaryContentLastPage(element, geometry) {
  return geometry.pageIndexForSourceY(Math.max(0, primaryContentSourceBottom(element) - 0.01));
}

function computedContentBottomPadding(content) {
  if (!content || typeof window === 'undefined') return 0;
  return Math.max(0, Number.parseFloat(window.getComputedStyle(content).paddingBottom) || 0);
}

function sidebarTopForPage(geometry, pageIndex, firstPageSidebarTop) {
  return pageIndex === 0 ? firstPageSidebarTop : geometry.pageStart(pageIndex);
}

function applyDeferredSidebarPlacement(element, sidebar, geometry, {
  startPage,
  lastPage,
  firstPageSidebarTop,
  terminalContentPadding = 0,
}) {
  resetSidebarPlacement(sidebar);
  const outerSidebarTop = sidebarSourceBounds(element, sidebar).top;
  const sidebarTop = sidebarTopForPage(geometry, startPage, firstPageSidebarTop);
  const safeTerminalPadding = Math.max(0, Number(terminalContentPadding) || 0);
  const sidebarEnd = geometry.pageEnd(lastPage) - safeTerminalPadding - PDF_LAYOUT_END_BUFFER;
  const deferredStart = Math.max(0, sidebarTop - outerSidebarTop);

  sidebar.dataset.pdfDeferred = 'true';
  sidebar.style.height = `${Math.max(0, sidebarEnd - outerSidebarTop)}px`;
  sidebar.style.setProperty('--sidebar-deferred-start', `${deferredStart}px`);
  sidebar.style.setProperty('--sidebar-deferred-min-height', `${Math.max(0, sidebarEnd - sidebarTop)}px`);
}

function positionLastPageSidebar(element, sidebar, geometry, initialFinalPage) {
  const content = element.querySelector?.('.content');
  const originalBottomPadding = computedContentBottomPadding(content);
  if (content) content.style.paddingBottom = '0px';

  resetSidebarPlacement(sidebar);
  const naturalSidebarBounds = sidebarSourceBounds(element, sidebar);
  const naturalSidebarHeight = naturalSidebarBounds.height;
  const firstPageSidebarTop = naturalSidebarBounds.top;

  sidebar.style.display = 'none';
  const measuredInitialFinalPage = primaryContentLastPage(element, geometry);
  sidebar.style.display = '';

  let measuredPrimaryBottom = primaryContentSourceBottom(element);
  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: naturalSidebarHeight,
    firstPageSidebarTop,
    initialFinalPage: Number.isInteger(initialFinalPage)
      ? Math.max(0, initialFinalPage)
      : measuredInitialFinalPage,
    measureBodyFinalPage: ({ startPage, sidebarLastPage }) => {
      applyDeferredSidebarPlacement(element, sidebar, geometry, {
        startPage,
        lastPage: sidebarLastPage,
        firstPageSidebarTop,
      });
      measuredPrimaryBottom = primaryContentSourceBottom(element);
      return geometry.pageIndexForSourceY(Math.max(0, measuredPrimaryBottom - 0.01));
    },
  });

  const positionedSidebar = sidebarSourceBounds(element, sidebar);
  const finalPageEnd = geometry.pageEnd(placement.finalPage);
  const availableBottomPadding = Math.max(
    0,
    finalPageEnd - Math.max(measuredPrimaryBottom, positionedSidebar.top + naturalSidebarHeight) - PDF_LAYOUT_END_BUFFER,
  );
  const finalBottomPadding = Math.min(originalBottomPadding, availableBottomPadding);

  if (content) content.style.paddingBottom = `${finalBottomPadding}px`;
  applyDeferredSidebarPlacement(element, sidebar, geometry, {
    startPage: placement.startPage,
    lastPage: placement.sidebarLastPage,
    firstPageSidebarTop,
    terminalContentPadding: finalBottomPadding,
  });

  return placement;
}

function positionSidebarAfterCover(element, sidebar, geometry) {
  const content = element.querySelector?.('.content');
  if (content) content.style.paddingBottom = '0px';

  resetSidebarPlacement(sidebar);
  const naturalSidebarBounds = sidebarSourceBounds(element, sidebar);
  const sidebarTop = sidebarTopForPage(geometry, 1, naturalSidebarBounds.top);
  const lastPage = geometry.pageIndexForSourceY(
    Math.max(sidebarTop, sidebarTop + naturalSidebarBounds.height - 0.01),
  );

  applyDeferredSidebarPlacement(element, sidebar, geometry, {
    startPage: 1,
    lastPage,
    firstPageSidebarTop: naturalSidebarBounds.top,
  });
}

function positionSidebarForPdf(element, options, pdf, initialFinalPage) {
  element.querySelector?.('.content')?.style.removeProperty('padding-bottom');
  const sidebar = element.querySelector?.('#cv_side');
  if (!sidebar) return;

  resetSidebarPagePlacement(element, sidebar);
  const geometry = createSourcePageGeometry(element, options, pdf);
  if (!geometry) return;

  const fillMode = ['last-page', 'after-cover'].includes(options.sidebarFillMode)
    ? options.sidebarFillMode
    : 'start';

  if (fillMode === 'start') {
    reserveSidebarColumnThroughItsLastPage(element, sidebar, geometry);
    return;
  }

  if (fillMode === 'after-cover') {
    positionSidebarAfterCover(element, sidebar, geometry);
    return;
  }

  return positionLastPageSidebar(element, sidebar, geometry, initialFinalPage);
}

function sourcePageSlices(canvas, pdf, options, continuationPadding) {
  return createPdfPageSlices({
    width: canvas.width,
    height: canvas.height,
    pageWidth: pdf.internal.pageSize.getWidth(),
    pageHeight: pdf.internal.pageSize.getHeight(),
    margins: normaliseMargins(options.margin),
    continuationTopPadding: continuationPadding,
  });
}

async function renderSourceCanvas(element, options, captureOverlay) {
  const task = options.renderTask;
  await task.checkpoint(true);
  let overlay = null;
  const worker = html2pdf().set(options).from(element);
  // html2pdf's pagebreak plugin runs while preparing its private source
  // clone. It may insert padding before a section with break-inside: avoid;
  // html2canvas then clones that prepared tree and invokes onclone below.
  try {
    await task.wait(worker.toContainer());
    task.check();
    const container = await worker.get('container');
    const head = element.ownerDocument.head;
    const canvasOptions = {
      ...options.html2canvas,
      renderTask: task,
      windowHeight: element.scrollHeight,
      // Only clone the CV, its ancestors and styles/fonts, not the entire
      // builder, other previews or another render's temporary DOM.
      ignoreElements: (node) => (
        options.html2canvas.ignoreElements?.(node)
        || !(node === head || head.contains(node) || node.contains(container) || container.contains(node))
      ),
      onclone: async (documentClone, clonedElement) => {
        task.check();
        await options.html2canvas.onclone?.(documentClone, clonedElement);
        // Capture in html2canvas's final clone so text coordinates match pixels.
        if (captureOverlay) overlay = captureOverlay(clonedElement);
      },
    };
    await worker.set({ html2canvas: canvasOptions });
    await task.wait(worker.toCanvas());
    task.check();
    const canvas = await worker.get('canvas');
    return { canvas, overlay };
  } finally {
    worker.prop.overlay?.remove();
  }
}

async function renderFullWidthBodyCanvas(element, options) {
  const sidebar = element.querySelector?.('#cv_side');
  if (!sidebar) return renderSourceCanvas(element, options);

  resetSidebarPagePlacement(element, sidebar);
  sidebar.style.display = 'none';

  try {
    return await renderSourceCanvas(element, options);
  } finally {
    sidebar.style.display = '';
  }
}

/**
 * Apply the exact page/sidebar placement used by the raster preview before
 * capturing the source canvas. Both download formats share this routine so
 * their graphics cannot drift from the established page placement.
 */
async function preparePositionedPdfSource(element, options, pdf, continuationPadding) {
  if (options.sidebarFillMode === 'last-page' && element.querySelector?.('#cv_side')) {
    const { canvas: fullWidthBodyCanvas } = await renderFullWidthBodyCanvas(element, options);
    const targetFinalPage = sourcePageSlices(
      fullWidthBodyCanvas,
      pdf,
      options,
      continuationPadding,
    ).length - 1;

    // The placement resolver already performs a fixed-point reflow pass.
    // Re-targeting it from a canvas page count caused a fractional trailing
    // canvas slice to advance the sidebar on every pass (3 → 4 → … → 11).
    positionSidebarForPdf(element, options, pdf, targetFinalPage);
    return;
  }

  positionSidebarForPdf(element, options, pdf);
}

async function createPagePreview(pageCanvas, dimensions, image, task) {
  const {
    pageWidth,
    pageHeight,
    contentWidth,
    contentScale,
    leftOffset,
    topOffset,
  } = dimensions;
  const scale = previewScaleFor(pageWidth * contentScale);
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = Math.max(1, Math.round(pageWidth * contentScale * scale));
  previewCanvas.height = Math.max(1, Math.round(pageHeight * contentScale * scale));
  const previewContext = previewCanvas.getContext('2d');

  if (!previewContext) throw new Error('PDF preview canvas could not be created');

  previewContext.fillStyle = '#ffffff';
  previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewContext.drawImage(
    pageCanvas,
    Math.round(leftOffset * contentScale * scale),
    Math.round(topOffset * contentScale * scale),
    Math.round(contentWidth * contentScale * scale),
    Math.round((pageCanvas.height / pageCanvas.width) * contentWidth * contentScale * scale),
  );

  // toDataURL synchronously encodes on the UI thread. Let the browser encode
  // asynchronously, retaining data URLs so existing preview lifetimes work.
  const blob = await task.wait(new Promise((resolve, reject) => {
    previewCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('PDF preview encoding failed')),
      imageMimeType(image.format), image.quality / 100);
  }));
  return task.wait(new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  }));
}

async function isUniformCanvas(pageCanvas, pageContext, task) {
  try {
    const [red, green, blue, alpha] = pageContext.getImageData(0, 0, 1, 1).data;
    const scanHeight = 64;

    for (let y = 0; y < pageCanvas.height; y += scanHeight) {
      const pause = task.checkpoint();
      if (pause) await pause;
      const rowPixels = pageContext.getImageData(
        0,
        y,
        pageCanvas.width,
        Math.min(scanHeight, pageCanvas.height - y),
      ).data;

      for (let index = 0; index < rowPixels.length; index += 4) {
        if (
          rowPixels[index] !== red
          || rowPixels[index + 1] !== green
          || rowPixels[index + 2] !== blue
          || rowPixels[index + 3] !== alpha
        ) return false;
      }
    }

    return true;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // Preserve the page if the browser disallows pixel inspection for any
    // reason (for example, a tainted canvas from a third-party image).
    return false;
  }
}

async function appendPdfPages(canvas, pdf, options, continuationPadding, {
  previewOnly = false,
  vectorOnly = false,
} = {}) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const slices = sourcePageSlices(canvas, pdf, options, continuationPadding);

  const pageCanvas = document.createElement('canvas');
  const pageContext = pageCanvas.getContext('2d');
  if (!pageContext) throw new Error('PDF canvas could not be created');

  const pages = [];
  for (const slice of slices) {
    await options.renderTask.checkpoint(true);
    const { sourceTop: sourceY, sourceBottom, contentWidth, leftOffset, topOffset } = slice;
    const sliceHeight = sourceBottom - sourceY;
    const contentScale = canvas.width / contentWidth;
    const renderedHeight = (sliceHeight * contentWidth) / canvas.width;

    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    pageContext.fillStyle = '#ffffff';
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

    const hasGraphics = !await isUniformCanvas(pageCanvas, pageContext, options.renderTask);
    if (hasGraphics) {
      if (!previewOnly && !vectorOnly) {
        const pageImage = encodePdfPageImage(pageCanvas, options.image);
        if (pages.length > 0) pdf.addPage();
        pdf.addImage(
          pageImage.data,
          pageImage.format,
          leftOffset,
          topOffset,
          contentWidth,
          renderedHeight,
        );
      }

      pages.push({
        ...slice,
        // Exports and exact-size measurements need page geometry, not preview
        // images. Avoid encoding an extra image for each exported page.
        previewData: previewOnly ? await createPagePreview(pageCanvas, {
          pageWidth,
          pageHeight,
          contentWidth,
          contentScale,
          leftOffset,
          topOffset,
        }, options.image, options.renderTask) : undefined,
      });
    }
  }

  return pages;
}

/**
 * Share layout and pagination between previews and both export formats.
 * Annotations and text geometry come from html2canvas's final clone.
 */
async function renderPdfSnapshot(element, options = {}, captureOverlay, { previewOnly = false } = {}) {
  const task = createPdfRenderTask(options.signal);
  try {
    await task.checkpoint(true);
    // Placement adjusts sidebar heights. Work on a private snapshot so edits,
    // cancellation and simultaneous export/preview jobs never mutate Vue's DOM.
    const sourceHost = task.own(element.parentElement.cloneNode(false));
    sourceHost.inert = true;
    sourceHost.removeAttribute('id');
    sourceHost.setAttribute('aria-hidden', 'true');
    Object.assign(sourceHost.style, { position: 'fixed', top: '0', left: '-100000px', pointerEvents: 'none' });
    const source = element.cloneNode(true);
    sourceHost.appendChild(source);
    element.ownerDocument.body.appendChild(sourceHost);
    return await renderPositionedSnapshot(source, { ...options, renderTask: task }, captureOverlay, { previewOnly });
  } finally {
    task.dispose();
  }
}

async function renderPositionedSnapshot(element, options, captureOverlay, { previewOnly }) {
  const mergedOptions = mergePdfOptions({
    ...options,
    html2canvas: {
      ...(options.html2canvas || {}),
      windowWidth: element.scrollWidth,
    },
  });
  const pdf = new jsPDF(mergedOptions.jsPDF);
  const vectorOnly = !previewOnly && mergedOptions.image.format === 'vector';
  // Preview images remain raster regardless of the download format.
  if (previewOnly && mergedOptions.image.format === 'vector') {
    mergedOptions.image = { format: 'png', quality: 100 };
  }
  await preparePositionedPdfSource(
    element,
    mergedOptions,
    pdf,
    options.continuationTopPadding,
  );
  const recording = vectorOnly ? createPdfCanvasRecording() : null;
  if (recording) mergedOptions.html2canvas.recordCanvas = recording.wrap;
  const { canvas, overlay } = await renderSourceCanvas(element, mergedOptions, vectorOnly ? capturePdfLinks : captureOverlay);
  const pages = await appendPdfPages(
    canvas,
    pdf,
    mergedOptions,
    options.continuationTopPadding,
    { previewOnly, vectorOnly },
  );
  if (vectorOnly) {
    // Keep the larger vector/font libraries off the normal preview code path.
    const { renderVectorPdf } = await import('./pdfVectorExport.js');
    const blob = await renderVectorPdf({
      recording, canvas, pages, links: overlay, fontStyleUrls: overlay.fontStyleUrls, loadedFaces: overlay.loadedFaces,
      pageWidth: pdf.internal.pageSize.getWidth(),
      pageHeight: pdf.internal.pageSize.getHeight(),
      task: options.renderTask,
    });
    return { blob, pages };
  }
  return { pdf, pages, overlay: overlay ? rasterizePdfOverlay(overlay, canvas) : null };
}

/**
 * Export PDF files and preview images from the same positioned source.
 */
export function usePdfExport() {
  const renderPreview = async (element, options = {}) => {
    if (!element) throw new Error('No element provided for PDF preview');
    return renderPdfSnapshot(element, options, undefined, { previewOnly: true });
  };

  const renderExportPdf = async (element, options = {}) => {
    if (!element) throw new Error('No element provided for PDF export');
    await document.fonts?.ready;
    // Both formats share layout and painting coordinates. Only raster PDFs
    // receive an invisible selectable overlay; vectors contain visible text.
    const result = await renderPdfSnapshot(
      element,
      options,
      capturePdfOverlay,
    );
    if (result.blob) return result.blob;
    await drawPdfOverlay(result.pdf, result.overlay, result.pages);
    return result.pdf.output('blob');
  };

  const exportToPdf = async (element, filename = 'cv', options = {}) => {
    const blob = await renderExportPdf(element, options);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${filename}.pdf`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Downloads may consume the URL after click() returns (notably Safari).
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { bytes: blob.size };
  };

  const estimatePdfSize = async (element, options = {}) => {
    const blob = await renderExportPdf(element, options);
    return { bytes: blob.size };
  };

  return {
    renderPreview,
    exportToPdf,
    estimatePdfSize,
  };
}
