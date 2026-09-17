import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInterMetrics,
  overlayPageFragments,
  rasterizePdfOverlay,
  drawPdfOverlay,
} from '../src/composables/pdfTextOverlay.js';

const page = {
  sourceTop: 300,
  sourceBottom: 600,
  canvasWidth: 1800,
  contentWidth: 200,
  leftOffset: 5,
  topOffset: 10,
};

function rasterizeText(text, canvas = { width: 1800, height: 3000 }) {
  return rasterizePdfOverlay({ width: 600, height: 1000, text: [text] }, canvas).text[0];
}

test('maps DOM text geometry into the matching PDF page slice', () => {
  const result = overlayPageFragments(rasterizeText({ x: 60, y: 120, width: 80, height: 20, baseline: 136 }), page);
  const expected = { x: 25, y: 10 + 20 / 3, width: 80 / 3, height: 20 / 3, baseline: 22 };
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Math.abs(result[key] - value) < 1e-9, key);
  }
});

test('assigns text at a page boundary to its baseline page only', () => {
  const result = overlayPageFragments(rasterizeText({ x: 0, y: 190, width: 20, height: 20, baseline: 205 }), page);
  assert.equal(result, null);
  assert.equal(overlayPageFragments(rasterizeText({ x: 0, y: 205, width: 20, height: 5, baseline: 209 }), page), null);
  assert.ok(overlayPageFragments(rasterizeText({ x: 0, y: 95, width: 20, height: 10, baseline: 100 }), page));
  assert.equal(overlayPageFragments(rasterizeText({ x: 0, y: 195, width: 20, height: 10, baseline: 200 }), page), null);
});

test('uses an independent vertical raster scale for source y coordinates', () => {
  const result = overlayPageFragments(
    rasterizeText({ x: 60, y: 125, width: 80, height: 20, baseline: 141 }, { width: 1800, height: 2500 }),
    page,
  );

  assert.equal(result.y, 11.38888888888889);
  assert.ok(Math.abs(result.baseline - 15.833333333333334) < 1e-9);
});

test('uses raster page slices as the single authority for hybrid text placement', () => {
  const capture = rasterizePdfOverlay({
    width: 600,
    height: 1000,
    text: [{ x: 60, y: 400, width: 80, height: 20, baseline: 416 }],
  }, { width: 1800, height: 3100 });
  const rasterPage = {
    sourceTop: 1200,
    sourceBottom: 2400,
    canvasWidth: 1800,
    contentWidth: 180,
    leftOffset: 5,
    topOffset: 20,
  };

  const result = overlayPageFragments(capture.text[0], rasterPage);
  assert.equal(result.x, 23);
  assert.equal(result.y, 24);
  assert.ok(Math.abs(result.baseline - 28.96) < 1e-9);
  assert.equal(overlayPageFragments({ ...capture.text[0], rasterBaseline: 1199 }, rasterPage), null);
});

test('writes only invisible text and places links on the glyph baseline page', async () => {
  const calls = [];
  let currentPage;
  const doc = {
    setPage: (value) => { currentPage = value; },
    setFont() {},
    setFontSize() {},
    text: (...args) => calls.push({ type: 'text', page: currentPage, args }),
    link: (...args) => calls.push({ type: 'link', page: currentPage, args }),
  };
  const text = rasterizeText({
    text: 'A', x: 0, y: 95, width: 20, height: 10, baseline: 100,
    href: 'https://example.com', fontSize: 10, weight: 'normal',
  });
  await drawPdfOverlay(doc, { text: [text] }, [
    { ...page, sourceTop: 0, sourceBottom: 300 },
    page,
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].page, 2);
  assert.deepEqual(calls[0].args, ['A', 5, 10, { renderingMode: 'invisible' }]);
  assert.equal(calls[1].page, 2);
  assert.deepEqual(calls[1].args.at(-1), { url: 'https://example.com' });
});

test('normalizes invisible Inter metrics to the raster font height and baseline', () => {
  const result = normalizeInterMetrics(
    { ascent: 9, descent: 3 },
    { ascent: 8, descent: 2 },
  );

  assert.equal(result.fontScale, 1.2);
  assert.ok(Math.abs(result.baselineOffset - .6) < 1e-9);
});

test('leaves Inter metrics unchanged when the raster metrics are unavailable', () => {
  assert.deepEqual(normalizeInterMetrics(null, null), {
    fontScale: 1,
    baselineOffset: 0,
    targetMetrics: null,
  });
});
