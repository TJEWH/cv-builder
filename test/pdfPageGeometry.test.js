import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPdfPageGeometry,
  resolveLastPageSidebarPlacement,
} from '../src/composables/pdfPageGeometry.js';

test('maps source coordinates to the first page and padded continuation pages', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 2,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.firstPageSourceHeight, 594);
  assert.equal(geometry.continuationSourceHeight, 574);
  assert.equal(geometry.pageStart(2), 1168);
  assert.equal(geometry.pageIndexForSourceY(593.9), 0);
  assert.equal(geometry.pageIndexForSourceY(594), 1);
  assert.equal(geometry.pageCountForSourceHeight(1168), 2);
});

test('finds the latest whole page where a sidebar can begin and still end on the final page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.sidebarStartPageForFinalPage(200, 2, 80), 2);
  assert.equal(geometry.sidebarStartPageForFinalPage(400, 2, 80), 1);
  assert.equal(geometry.sidebarStartPageForFinalPage(780, 2, 80), 0);
});

test('accounts for the header before placing a sidebar on the cover page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  assert.equal(geometry.sidebarStartPageForFinalPage(250, 0, 80), 0);
  assert.equal(geometry.sidebarStartPageForFinalPage(217, 0, 80), 0);
});

test('places a short sidebar on the body final page', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 200,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.deepEqual(placement, {
    finalPage: 2,
    startPage: 2,
    sidebarLastPage: 2,
    iterations: 1,
  });
});

test('uses only the minimum preceding pages for a multi-page sidebar', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 400,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.equal(placement.finalPage, 2);
  assert.equal(placement.startPage, 1);
  assert.equal(placement.sidebarLastPage, 2);
});

test('extends the document with sidebar-only final pages when necessary', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 900,
    firstPageSidebarTop: 80,
    initialFinalPage: 1,
    measureBodyFinalPage: () => 1,
  });

  assert.equal(placement.startPage, 0);
  assert.equal(placement.sidebarLastPage, 3);
  assert.equal(placement.finalPage, 3);
});

test('promotes the final page when a sidebar causes body reflow', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 1,
    firstPageHeight: 297,
    continuationTopPadding: 10,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 200,
    firstPageSidebarTop: 80,
    initialFinalPage: 2,
    measureBodyFinalPage: ({ finalPage }) => (finalPage === 2 ? 3 : 2),
  });

  assert.equal(placement.finalPage, 3);
  assert.equal(placement.startPage, 3);
  assert.equal(placement.sidebarLastPage, 3);
  assert.equal(placement.iterations, 2);
});

test('keeps last-page placement correct with margin-reduced pages and continuation padding', () => {
  const geometry = createPdfPageGeometry({
    sourcePixelsPerMillimeter: 2.5,
    firstPageHeight: 267,
    continuationTopPadding: 12,
  });

  const placement = resolveLastPageSidebarPlacement({
    geometry,
    sidebarHeight: 900,
    firstPageSidebarTop: 120,
    initialFinalPage: 2,
    measureBodyFinalPage: () => 2,
  });

  assert.equal(geometry.firstPageSourceHeight, 667.5);
  assert.equal(geometry.continuationSourceHeight, 637.5);
  assert.equal(placement.startPage, 1);
  assert.equal(placement.sidebarLastPage, 2);
  assert.equal(placement.finalPage, 2);
});
