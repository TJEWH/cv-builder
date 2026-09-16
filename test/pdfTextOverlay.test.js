import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInterMetrics,
  overlayPageFragments,
  rasterizePdfOverlay,
} from '../src/composables/pdfTextOverlay.js';

const page = {
  sourceTop: 300,
  sourceBottom: 600,
  canvasPixelsPerCssPixel: 3,
  sourceWidth: 600,
  contentWidth: 200,
  leftOffset: 5,
  topOffset: 10,
  renderedHeight: 100,
};

test('maps DOM text geometry into the matching PDF page slice', () => {
  const result = overlayPageFragments({ x: 60, y: 120, width: 80, height: 20, baseline: 136 }, page);
  assert.deepEqual(result, {
    x: 25, y: 16.666666666666664, width: 26.666666666666664, height: 6.666666666666666,
    baseline: 22, fontSize: undefined, clipped: false, clipY: 10, clipHeight: 100,
  });
});

test('assigns text at a page boundary to its baseline page only', () => {
  const result = overlayPageFragments({ x: 0, y: 190, width: 20, height: 20, baseline: 205 }, page);
  assert.equal(result, null);
  assert.equal(overlayPageFragments({ x: 0, y: 205, width: 20, height: 5, baseline: 209 }, page), null);
});

test('uses an independent vertical raster scale for source y coordinates', () => {
  const result = overlayPageFragments(
    { x: 60, y: 125, width: 80, height: 20, baseline: 141 },
    { ...page, canvasPixelsPerCssPixelY: 2.5 },
  );

  assert.equal(result.y, 11.38888888888889);
  assert.equal(result.baseline, 15.833333333333334);
});

test('uses raster page slices as the single authority for hybrid text placement', () => {
  const capture = rasterizePdfOverlay({
    width: 600,
    height: 1000,
    text: [{ x: 60, y: 400, width: 80, height: 20, baseline: 416 }],
    markers: [],
  }, { width: 1800, height: 3100 });
  const rasterPage = {
    sourceTop: 1200,
    sourceBottom: 2400,
    canvasWidth: 1800,
    contentWidth: 180,
    leftOffset: 5,
    topOffset: 20,
    renderedHeight: 120,
  };

  const result = overlayPageFragments(capture.text[0], rasterPage);
  assert.equal(result.x, 23);
  assert.equal(result.y, 24);
  assert.ok(Math.abs(result.baseline - 28.96) < 1e-9);
  assert.equal(overlayPageFragments({ ...capture.text[0], rasterBaseline: 1199 }, rasterPage), null);
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
