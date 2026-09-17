import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_SIZE_ESTIMATE_CACHE_KEY,
  estimatePdfSizeFromCache,
  loadPdfSizeEstimateCache,
  normalizePdfSizeEstimateCache,
  recordPdfSizeMeasurement,
} from '../src/composables/pdfSizeEstimateCache.js';

const now = 1_750_000_000_000;
const png100 = { format: 'png', quality: 100 };
const jpeg90 = { format: 'jpeg', quality: 90 };

test('uses the latest exact size for the selected export quality', () => {
  const first = recordPdfSizeMeasurement([], png100, { bytes: 512_345 }, now);
  const cache = recordPdfSizeMeasurement(first, png100, { bytes: 498_765 }, now + 1_000);

  assert.equal(cache.entries.length, 1);
  assert.deepEqual(estimatePdfSizeFromCache(cache, png100), {
    bytes: 498_765,
    source: 'cached-exact',
    referenceOptions: png100,
  });
});

test('scales the latest exact size for the selected quality within its export format', () => {
  const pngCache = recordPdfSizeMeasurement([], png100, { bytes: 512_345 }, now);
  const cache = recordPdfSizeMeasurement(pngCache, jpeg90, { bytes: 183_200 }, now + 1_000);

  assert.equal(cache.entries.length, 2);
  assert.deepEqual(estimatePdfSizeFromCache(cache, { format: 'png', quality: 95 }), {
    bytes: 486_728,
    source: 'quality-scaled',
    referenceOptions: png100,
  });
  assert.deepEqual(estimatePdfSizeFromCache(cache, jpeg90), {
    bytes: 183_200,
    source: 'cached-exact',
    referenceOptions: jpeg90,
  });
  assert.deepEqual(estimatePdfSizeFromCache(cache, { format: 'webp', quality: 90 }), {
    bytes: null,
    source: 'unavailable',
    referenceOptions: null,
  });
});

test('drops obsolete prediction data while retaining a legacy exact size', () => {
  const legacy = {
    version: 2,
    staticProfile: { fixedBytes: 16_000 },
    entries: [{
      signature: 'old-signature',
      layers: { graphicsPixels: 8_160_000 },
      options: png100,
      bytes: 512_345,
      graphicsBytes: 470_000,
      createdAt: now,
    }],
  };

  assert.deepEqual(normalizePdfSizeEstimateCache(legacy), {
    version: 3,
    entries: [{ options: png100, bytes: 512_345, createdAt: now }],
  });
});

test('keeps vector sizes separate from raster formats and ignores quality changes', () => {
  const rasterCache = recordPdfSizeMeasurement([], png100, { bytes: 512_345 }, now);
  assert.equal(estimatePdfSizeFromCache(rasterCache, { format: 'vector' }).source, 'unavailable');

  const first = recordPdfSizeMeasurement(rasterCache, { format: 'vector', quality: 80 }, { bytes: 48_765 }, now + 1);
  const cache = recordPdfSizeMeasurement(first, { format: 'vector', quality: 95 }, { bytes: 46_789 }, now + 2);

  assert.equal(cache.entries.length, 2);
  assert.deepEqual(estimatePdfSizeFromCache(cache, { format: 'vector', quality: 82 }), {
    bytes: 46_789,
    source: 'cached-exact',
    referenceOptions: { format: 'vector', quality: 100 },
  });
  assert.equal(estimatePdfSizeFromCache(cache, png100).bytes, 512_345);
});

test('migrates legacy storage into the compact reference cache', () => {
  const legacy = [{
    signature: 'old-signature',
    layers: { graphicsPixels: 8_160_000 },
    options: png100,
    bytes: 512_345,
    graphicsBytes: 470_000,
    createdAt: now,
  }];
  const values = new Map([['cv-pdf-size-estimate-cache-v2', JSON.stringify(legacy)]]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  const cache = loadPdfSizeEstimateCache(storage);

  assert.equal(cache.version, 3);
  assert.equal(cache.entries.length, 1);
  assert.equal(estimatePdfSizeFromCache(cache, png100).bytes, 512_345);
  assert.equal(JSON.parse(storage.getItem(PDF_SIZE_ESTIMATE_CACHE_KEY)).version, 3);
});
