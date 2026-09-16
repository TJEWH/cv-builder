import UPNG from 'upng-js';

export const PDF_IMAGE_FORMATS = ['png', 'jpeg', 'webp'];
export const DEFAULT_EXPORT_OPTIONS = Object.freeze({ format: 'png', quality: 100 });

export function normalizeExportOptions(options = {}) {
  const requestedFormat = options.format ?? options.type;
  const format = PDF_IMAGE_FORMATS.includes(requestedFormat) ? requestedFormat : DEFAULT_EXPORT_OPTIONS.format;
  const suppliedQuality = Number(options.quality);
  const rawQuality = suppliedQuality > 0 && suppliedQuality <= 1
    ? Math.round(suppliedQuality * 100)
    : Number.parseInt(options.quality, 10);
  const quality = Number.isFinite(rawQuality)
    ? Math.min(100, Math.max(80, rawQuality))
    : DEFAULT_EXPORT_OPTIONS.quality;

  return { format, quality };
}

export function imageMimeType(format) {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export function pngPaletteColors(quality) {
  const normalized = normalizeExportOptions({ format: 'png', quality }).quality;
  if (normalized === 100) return 0;
  if (normalized >= 95) return 256;
  if (normalized >= 90) return 128;
  if (normalized >= 85) return 64;
  return 32;
}

export function formatPdfBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function encodedPdfImageByteLength(data) {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  if (typeof data !== 'string') return 0;
  const dataUrl = data;
  const separator = dataUrl.indexOf(',');
  if (separator === -1) return 0;
  const payload = dataUrl.slice(separator + 1).replace(/\s/g, '');
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function isDataUrlOfType(dataUrl, mimeType) {
  return typeof dataUrl === 'string' && dataUrl.startsWith(`data:${mimeType};`);
}

/**
 * Encode the graphics-only PDF background. At 100 PNG retains every canvas
 * pixel; lower PNG settings use an indexed palette to trade subtle gradients
 * for smaller, still-PNG page images.
 */
export function encodePdfPageImage(canvas, exportOptions = {}) {
  const { format, quality } = normalizeExportOptions(exportOptions);

  if (format === 'png' && quality < 100) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG compression could not access the page canvas');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const encoded = UPNG.encode(
      [pixels.data.buffer.slice(0)],
      canvas.width,
      canvas.height,
      pngPaletteColors(quality),
    );
    return { data: new Uint8Array(encoded), format: 'PNG' };
  }

  const mimeType = imageMimeType(format);
  const data = canvas.toDataURL(mimeType, format === 'png' ? undefined : quality / 100);
  if (!isDataUrlOfType(data, mimeType)) {
    if (format === 'webp') {
      throw new Error('WebP export is not supported by this browser. Choose PNG or JPEG.');
    }
    throw new Error(`The browser could not encode the page as ${format.toUpperCase()}`);
  }

  return { data, format: format.toUpperCase() };
}
