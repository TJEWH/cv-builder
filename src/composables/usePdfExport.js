import paintLayout from 'virtual:responsive-html2canvas';
import { createPdfRenderTask } from './pdfRenderTask.js';
import { createPdfPageSlices, createPdfPageGeometry, resolveLastPageSidebarPlacement } from './pdfPageGeometry.js';
import { createPdfCanvasRecording } from './pdfCanvasRecording.js';
import { capturePdfLinks } from './pdfVectorLinks.js';
import { renderVectorPreview } from './pdfVectorPreview.js';
import { applyPdfPageBreaks } from './pdfPageBreaks.js';
import { updateTimelineRails } from './timelineLayout.js';
import { fitDeferredSidebarToContent } from './pdfSidebarHeight.js';

// Keep the established A4 geometry and subpixel coordinate precision. This is
// a vector coordinate grid, not a bitmap resolution or image quality setting.
const PAGE_WIDTH = 595.28 * 25.4 / 72;
const PAGE_HEIGHT = 841.89 * 25.4 / 72;
const PAINT_SCALE = 3;
const PDF_LAYOUT_END_BUFFER = 2;

function normaliseMargins(margin = 0) {
  if (Array.isArray(margin)) {
    if (margin.length === 4) return margin.map((value) => Number(value) || 0);
    if (margin.length === 2) return [margin[0], margin[1], margin[0], margin[1]].map((value) => Number(value) || 0);
  }
  return Array(4).fill(Number(margin) || 0);
}

function createSourcePageGeometry(element, options) {
  const sourceBounds = element.getBoundingClientRect();
  const [marginTop, marginLeft, marginBottom, marginRight] = normaliseMargins(options.margin);
  const pageWidth = PAGE_WIDTH;
  const pageHeight = PAGE_HEIGHT;
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
  heightMode,
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
  if (heightMode !== 'full-page') fitDeferredSidebarToContent(element);
}

function positionLastPageSidebar(element, sidebar, geometry, initialFinalPage, heightMode) {
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
        heightMode,
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
    heightMode,
  });

  return placement;
}

function positionSidebarAfterCover(element, sidebar, geometry, heightMode) {
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
    heightMode,
  });
}

function positionSidebarForPdf(element, options, initialFinalPage) {
  element.querySelector?.('.content')?.style.removeProperty('padding-bottom');
  const sidebar = element.querySelector?.('#cv_side');
  if (!sidebar) return;

  resetSidebarPagePlacement(element, sidebar);
  const geometry = createSourcePageGeometry(element, options);
  if (!geometry) return;

  const fillMode = ['last-page', 'after-cover'].includes(options.sidebarFillMode)
    ? options.sidebarFillMode
    : 'start';

  if (fillMode === 'start') {
    if (options.sidebarHeightMode === 'full-page') reserveSidebarColumnThroughItsLastPage(element, sidebar, geometry);
    return;
  }

  if (fillMode === 'after-cover') {
    positionSidebarAfterCover(element, sidebar, geometry, options.sidebarHeightMode);
    return;
  }

  return positionLastPageSidebar(element, sidebar, geometry, initialFinalPage, options.sidebarHeightMode);
}

function sourcePageSlices(canvas, options, continuationPadding) {
  return createPdfPageSlices({
    width: canvas.width,
    height: canvas.height,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    margins: normaliseMargins(options.margin),
    continuationTopPadding: continuationPadding,
  });
}


async function prepareLayoutContainer(element, options) {
  const { renderTask: task } = options;
  const [, left, , right] = normaliseMargins(options.margin);
  const host = task.own(document.createElement('div'));
  host.className = 'pdf-layout-snapshot';
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
  const container = document.createElement('div');
  Object.assign(container.style, { width: (PAGE_WIDTH - left - right) + 'mm', backgroundColor: 'white' });
  container.appendChild(element.cloneNode(true));
  host.appendChild(container);
  document.body.appendChild(host);
  const [top, , bottom] = normaliseMargins(options.margin);
  const syncSidebarHeight = options.sidebarHeightMode !== 'full-page'
    ? () => fitDeferredSidebarToContent(container)
    : undefined;
  syncSidebarHeight?.();
  await applyPdfPageBreaks(container, Math.floor((PAGE_HEIGHT - top - bottom) * 96 / 25.4), task, syncSidebarHeight);
  updateTimelineRails(container);
  return { host, container };
}

async function measurePreparedSource(element, options) {
  const { host, container } = await prepareLayoutContainer(element, options);
  try {
    const bounds = container.getBoundingClientRect();
    return { width: Math.ceil(bounds.width) * PAINT_SCALE, height: Math.ceil(bounds.height) * PAINT_SCALE };
  } finally { host.remove(); }
}

async function preparePositionedSource(element, options) {
  const sidebar = element.querySelector('#cv_side');
  if (options.sidebarFillMode === 'last-page' && sidebar) {
    resetSidebarPagePlacement(element, sidebar);
    sidebar.style.display = 'none';
    let dimensions;
    try { dimensions = await measurePreparedSource(element, options); }
    finally { sidebar.style.display = ''; }
    const finalPage = sourcePageSlices(dimensions, options, options.continuationTopPadding).length - 1;
    positionSidebarForPdf(element, options, finalPage);
  } else positionSidebarForPdf(element, options);
}

async function captureVectorSnapshot(element, options, task) {
  await task.checkpoint(true);
  const sourceHost = task.own(element.parentElement.cloneNode(false));
  sourceHost.inert = true;
  sourceHost.removeAttribute('id');
  sourceHost.setAttribute('aria-hidden', 'true');
  Object.assign(sourceHost.style, { position: 'fixed', top: '0', left: '-100000px', pointerEvents: 'none' });
  const source = element.cloneNode(true);
  sourceHost.appendChild(source);
  document.body.appendChild(sourceHost);
  const renderOptions = { ...options, renderTask: task };
  await preparePositionedSource(source, renderOptions);
  const { host, container } = await prepareLayoutContainer(source, renderOptions);
  const recording = createPdfCanvasRecording();
  let links;
  try {
    const head = document.head;
    const canvas = await task.wait(paintLayout(container, {
      scale: PAINT_SCALE, useCORS: true, scrollX: 0, scrollY: 0, logging: false,
      windowWidth: source.scrollWidth, windowHeight: source.scrollHeight,
      renderTask: task, createVectorContext: recording.createContext,
      ignoreElements: (node) => !(node === head || head.contains(node) || node.contains(container) || container.contains(node)),
      onclone: (_, clone) => { task.check(); links = capturePdfLinks(clone); },
    }));
    const pages = sourcePageSlices(canvas, options, options.continuationTopPadding);
    return { recording, canvas, pages, links, fontStyleUrls: links.fontStyleUrls, loadedFaces: links.loadedFaces, pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, task };
  } finally { host.remove(); }
}

/** One vector paint capture feeds scalable SVG previews and direct PDF files. */
export function usePdfExport() {
  async function render(element, options = {}, output) {
    if (!element) throw new Error('CV preview element not found');
    const task = createPdfRenderTask(options.signal);
    try {
      await task.wait(document.fonts?.ready);
      const snapshot = await captureVectorSnapshot(element, options, task);
      return await output(snapshot);
    } finally { task.dispose(); }
  }

  const renderPreview = (element, options) => render(element, options, renderVectorPreview);
  const exportToPdf = async (element, filename = 'cv', options) => {
    const blob = await render(element, options, async (snapshot) => {
      const { renderVectorPdf } = await import('./pdfVectorExport.js');
      return renderVectorPdf(snapshot);
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename + '.pdf';
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return { renderPreview, exportToPdf };
}
