function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pageIndex(value) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

/**
 * Describe the source-canvas heights that map to each exported PDF page.
 */
export function createPdfPageGeometry({
  sourcePixelsPerMillimeter,
  firstPageHeight,
  continuationTopPadding = 0,
}) {
  const pixelsPerMillimeter = Math.max(0.001, finiteNumber(sourcePixelsPerMillimeter, 1));
  const firstPageMillimeters = Math.max(0.001, finiteNumber(firstPageHeight, 1));
  const safeContinuationPadding = Math.min(
    Math.max(0, finiteNumber(continuationTopPadding)),
    Math.max(0, firstPageMillimeters - 0.001),
  );
  const firstPageSourceHeight = firstPageMillimeters * pixelsPerMillimeter;
  const continuationSourceHeight = Math.max(
    0.001,
    (firstPageMillimeters - safeContinuationPadding) * pixelsPerMillimeter,
  );
  const normalizePageIndex = pageIndex;

  const pageStart = (pageIndex) => {
    const index = normalizePageIndex(pageIndex);
    return index === 0 ? 0 : firstPageSourceHeight + ((index - 1) * continuationSourceHeight);
  };

  const pageEnd = (pageIndex) => pageStart(normalizePageIndex(pageIndex) + 1);

  const pageIndexForSourceY = (sourceY) => {
    const position = Math.max(0, finiteNumber(sourceY));
    if (position < firstPageSourceHeight) return 0;
    return 1 + Math.floor((position - firstPageSourceHeight) / continuationSourceHeight);
  };

  const pageCountForSourceHeight = (sourceHeight) => {
    const height = Math.max(0, finiteNumber(sourceHeight));
    return pageIndexForSourceY(Math.max(0, height - 0.01)) + 1;
  };

  const sidebarStartPageForFinalPage = (sidebarHeight, finalPageIndex, firstPageSidebarTop = 0) => {
    const requiredHeight = Math.max(0, finiteNumber(sidebarHeight));
    const finalPage = normalizePageIndex(finalPageIndex);
    const firstPageAvailableHeight = Math.max(0, firstPageSourceHeight - Math.max(0, finiteNumber(firstPageSidebarTop)));
    let availableHeight = 0;

    for (let pageIndex = finalPage; pageIndex >= 0; pageIndex -= 1) {
      availableHeight += pageIndex === 0 ? firstPageAvailableHeight : continuationSourceHeight;
      if (availableHeight + 0.01 >= requiredHeight) return pageIndex;
    }

    return 0;
  };

  return {
    firstPageSourceHeight,
    continuationSourceHeight,
    pageStart,
    pageEnd,
    pageIndexForSourceY,
    pageCountForSourceHeight,
    sidebarStartPageForFinalPage,
  };
}

/**
 * Find the latest page where a sidebar can start while guaranteeing that it
 * occupies the final PDF page. The caller measures body reflow after each
 * candidate is applied, keeping DOM concerns outside this geometry helper.
 */
export function resolveLastPageSidebarPlacement({
  geometry,
  sidebarHeight,
  firstPageSidebarTop = 0,
  initialFinalPage = 0,
  measureBodyFinalPage = () => initialFinalPage,
}) {
  const naturalSidebarHeight = Math.max(0, finiteNumber(sidebarHeight));
  const firstSidebarTop = Math.max(0, finiteNumber(firstPageSidebarTop));
  let finalPage = pageIndex(initialFinalPage);

  // Moving the sidebar to a later page can only release body width. This
  // monotonic loop therefore converges once the target reaches the body end.
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const startPage = geometry.sidebarStartPageForFinalPage(
      naturalSidebarHeight,
      finalPage,
      firstSidebarTop,
    );
    const sidebarTop = startPage === 0 ? firstSidebarTop : geometry.pageStart(startPage);
    const sidebarLastPage = geometry.pageIndexForSourceY(
      Math.max(sidebarTop, sidebarTop + naturalSidebarHeight - 0.01),
    );
    const bodyLastPage = pageIndex(measureBodyFinalPage({
      finalPage,
      startPage,
      sidebarLastPage,
    }));
    const nextFinalPage = Math.max(finalPage, sidebarLastPage, bodyLastPage);

    if (nextFinalPage === finalPage) {
      return {
        finalPage,
        startPage,
        sidebarLastPage,
        iterations: iteration + 1,
      };
    }

    finalPage = nextFinalPage;
  }

  throw new Error('Sidebar placement did not converge');
}
