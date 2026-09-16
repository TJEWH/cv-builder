import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_SIZE_ESTIMATE_CACHE_KEY,
  PDF_SIZE_ESTIMATE_TTL_MS,
  createPdfSizeLayerInfo,
  estimatePdfSizeFromLayerCache,
  hasFreshPdfSizeCalibration,
  loadPdfSizeEstimateCache,
  needsPdfSizeGroundTruth,
  normalizePdfSizeEstimateCache,
  recordPdfSizeMeasurement,
} from '../src/composables/pdfSizeEstimateCache.js';

const now = 1_750_000_000_000;
const state = {
  design: { fontBody: 'Inter', graphicOpacity: 100 },
  exportOptions: { format: 'png', quality: 100 },
  contact: { email: 'test@example.com', website: 'https://example.com' },
  about: { text: 'A short profile with selectable text.' },
  education: [],
  experience: { jobs: [] },
  languages: [],
  hobbies: [],
  customSections: [],
  sidebarSections: [],
  softSkills: [],
};

const pages = [{
  canvasWidth: 2400,
  sourceTop: 0,
  sourceBottom: 3400,
  contentWidth: 210,
  topOffset: 0,
  graphicsFingerprint: { samples: 864, inkRatio: 0.18, edgeRatio: 0.12, paletteSize: 9 },
}];

const measurement = {
  bytes: 512_345,
  graphicsBytes: 470_000,
  textGlyphs: 95,
  linkCount: 2,
};

test('layer signatures ignore export settings and page image data', () => {
  const before = createPdfSizeLayerInfo(state, [{ ...pages[0], imageData: 'data:image/png;base64,first' }]);
  const changedExportState = { ...state, exportOptions: { format: 'jpeg', quality: 80 } };
  const after = createPdfSizeLayerInfo(changedExportState, [{ ...pages[0], imageData: 'data:image/png;base64,second' }]);

  assert.equal(before.signature, after.signature);
  assert.equal(before.graphicsPixels, 8_160_000);
  assert.deepEqual(before.graphicsFingerprint, pages[0].graphicsFingerprint);
});

test('a fresh matching calibration is exact and suppresses background ground truth', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, state.exportOptions, measurement, now);

  assert.deepEqual(
    estimatePdfSizeFromLayerCache(cache, layers, state.exportOptions, now + 100),
    { bytes: measurement.bytes, source: 'cached-exact' },
  );
  assert.equal(hasFreshPdfSizeCalibration(cache, layers, state.exportOptions, now + 100), true);
  assert.equal(needsPdfSizeGroundTruth(cache, layers, state.exportOptions, now + 100), false);
});

test('calibrations and shared exporter profiles expire after one hour', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, state.exportOptions, measurement, now);
  const expiredAt = now + PDF_SIZE_ESTIMATE_TTL_MS;

  assert.equal(hasFreshPdfSizeCalibration(cache, layers, state.exportOptions, expiredAt), false);
  assert.equal(needsPdfSizeGroundTruth(cache, layers, state.exportOptions, expiredAt), true);
  assert.equal(
    estimatePdfSizeFromLayerCache(cache, layers, state.exportOptions, expiredAt).source,
    'cached-calibrated',
  );
});

test('shared static PDF overhead is retained while new dynamic measurements are recorded', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const first = recordPdfSizeMeasurement([], layers, state.exportOptions, measurement, now);
  const second = recordPdfSizeMeasurement(first, layers, { format: 'jpeg', quality: 95 }, {
    ...measurement,
    bytes: 180_000,
    graphicsBytes: 130_000,
  }, now + 1_000);

  assert.deepEqual(second.staticProfile, first.staticProfile);
  assert.equal(second.entries.length, 2);
  assert.equal(second.entries[0].graphicsBytes, 130_000);
  assert.equal(second.entries[0].layers.textGlyphs, measurement.textGlyphs);
});

test('a same-CV measurement calibrates a changed image option without rendering', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, { format: 'png', quality: 100 }, measurement, now);
  const prediction = estimatePdfSizeFromLayerCache(cache, layers, { format: 'png', quality: 95 }, now + 100);

  assert.equal(prediction.source, 'cached-calibrated');
  assert.ok(prediction.bytes > 0);
  assert.ok(prediction.bytes < measurement.bytes);
});

test('a compatible layer profile is used before the no-cache heuristic fallback', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, state.exportOptions, measurement, now);
  const changedState = {
    ...state,
    about: { text: `${state.about.text} A nearby content change.` },
  };
  const nearbyLayers = createPdfSizeLayerInfo(changedState, pages);

  assert.equal(
    estimatePdfSizeFromLayerCache(cache, nearbyLayers, state.exportOptions, now + 100).source,
    'similar-layer',
  );
  assert.equal(
    estimatePdfSizeFromLayerCache([], layers, state.exportOptions, now).source,
    'layer-heuristic',
  );
});

test('migrates legacy array caches into the timestamped two-layer schema', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const legacy = [{
    signature: layers.signature,
    layers,
    options: state.exportOptions,
    bytes: measurement.bytes,
    graphicsBytes: measurement.graphicsBytes,
    createdAt: now,
  }];
  const values = new Map([['cv-pdf-size-estimate-cache-v1', JSON.stringify(legacy)]]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const cache = loadPdfSizeEstimateCache(storage);

  assert.equal(cache.version, 2);
  assert.equal(cache.entries.length, 1);
  assert.equal(cache.staticProfile, null);
  assert.equal(normalizePdfSizeEstimateCache(cache).entries[0].signature, layers.signature);
  assert.equal(JSON.parse(storage.getItem(PDF_SIZE_ESTIMATE_CACHE_KEY)).version, 2);
});
