import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPdfSizeLayerInfo,
  estimatePdfSizeFromLayerCache,
  recordPdfSizeMeasurement,
} from '../src/composables/pdfSizeEstimateCache.js';

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

const pages = [{ canvasWidth: 2400, sourceTop: 0, sourceBottom: 3400, contentWidth: 210, topOffset: 0 }];

test('layer signatures ignore export settings and never include image data', () => {
  const before = createPdfSizeLayerInfo(state, [{ ...pages[0], imageData: 'data:image/png;base64,first' }]);
  const changedExportState = { ...state, exportOptions: { format: 'jpeg', quality: 80 } };
  const after = createPdfSizeLayerInfo(changedExportState, [{ ...pages[0], imageData: 'data:image/png;base64,second' }]);

  assert.equal(before.signature, after.signature);
  assert.equal(before.graphicsPixels, 8_160_000);
});

test('returns an exact cached measurement for the same information layers and export settings', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, { format: 'png', quality: 100 }, {
    bytes: 512_345,
    graphicsBytes: 470_000,
  });

  assert.deepEqual(
    estimatePdfSizeFromLayerCache(cache, layers, { format: 'png', quality: 100 }),
    { bytes: 512_345, source: 'cached-exact' },
  );
});

test('uses a cached graphics and text-layer measurement to calibrate a changed format', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const cache = recordPdfSizeMeasurement([], layers, { format: 'png', quality: 100 }, {
    bytes: 600_000,
    graphicsBytes: 500_000,
  });
  const prediction = estimatePdfSizeFromLayerCache(cache, layers, { format: 'png', quality: 95 });

  assert.equal(prediction.source, 'cached-calibrated');
  assert.ok(prediction.bytes > 100_000);
  assert.ok(prediction.bytes < 600_000);
});

test('falls back to information-layer heuristics without cached final output', () => {
  const layers = createPdfSizeLayerInfo(state, pages);
  const prediction = estimatePdfSizeFromLayerCache([], layers, { format: 'png', quality: 100 });

  assert.equal(prediction.source, 'layer-heuristic');
  assert.ok(prediction.bytes > 0);
});
