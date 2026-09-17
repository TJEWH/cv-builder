import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePdfPageImage,
  formatPdfBytes,
  normalizeExportOptions,
  PDF_EXPORT_FORMATS,
  PDF_IMAGE_FORMATS,
  pngPaletteColors,
} from '../src/composables/pdfImageEncoding.js';

test('normalizes persisted export options and legacy image settings', () => {
  assert.deepEqual(normalizeExportOptions(), { format: 'png', quality: 100 });
  assert.deepEqual(normalizeExportOptions({ format: 'jpeg', quality: '94' }), { format: 'jpeg', quality: 94 });
  assert.deepEqual(normalizeExportOptions({ type: 'webp', quality: .9 }), { format: 'webp', quality: 90 });
  assert.deepEqual(normalizeExportOptions({ format: 'gif', quality: 200 }), { format: 'png', quality: 100 });
  assert.deepEqual(normalizeExportOptions({ format: 'png', quality: 1 }), { format: 'png', quality: 100 });
});

test('normalizes vector PDF options without an image quality setting', () => {
  assert.deepEqual(normalizeExportOptions({ format: 'vector', quality: 80 }), { format: 'vector', quality: 100 });
  assert.deepEqual(normalizeExportOptions({ type: 'vector', quality: .9 }), { format: 'vector', quality: 100 });
  assert.ok(PDF_EXPORT_FORMATS.includes('vector'));
  assert.ok(!PDF_IMAGE_FORMATS.includes('vector'));
});

test('does not accidentally rasterize vector PDF pages', () => {
  assert.throws(
    () => encodePdfPageImage({}, { format: 'vector' }),
    /Vector PDF pages must be rendered directly/,
  );
});

test('maps PNG quality to the documented palette thresholds', () => {
  assert.equal(pngPaletteColors(100), 0);
  assert.equal(pngPaletteColors(99), 256);
  assert.equal(pngPaletteColors(95), 256);
  assert.equal(pngPaletteColors(94), 128);
  assert.equal(pngPaletteColors(90), 128);
  assert.equal(pngPaletteColors(89), 64);
  assert.equal(pngPaletteColors(85), 64);
  assert.equal(pngPaletteColors(84), 32);
  assert.equal(pngPaletteColors(80), 32);
});

test('encodes a palette-compressed PNG as a PNG byte stream', () => {
  const canvas = {
    width: 2,
    height: 1,
    getContext: () => ({
      getImageData: () => ({
        data: new Uint8ClampedArray([255, 255, 255, 255, 17, 24, 39, 255]),
      }),
    }),
  };
  const encoded = encodePdfPageImage(canvas, { format: 'png', quality: 95 });
  assert.equal(encoded.format, 'PNG');
  assert.deepEqual([...encoded.data.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('formats PDF byte estimates for display', () => {
  assert.equal(formatPdfBytes(999), '999 B');
  assert.equal(formatPdfBytes(1024), '1.0 KB');
  assert.equal(formatPdfBytes(1.5 * 1024 * 1024), '1.50 MB');
  assert.equal(formatPdfBytes(-1), '');
});

test('rejects a WebP canvas fallback instead of changing the output format', () => {
  const canvas = {
    toDataURL: () => 'data:image/png;base64,AA==',
  };
  assert.throws(
    () => encodePdfPageImage(canvas, { format: 'webp', quality: 90 }),
    /WebP export is not supported/,
  );
});
