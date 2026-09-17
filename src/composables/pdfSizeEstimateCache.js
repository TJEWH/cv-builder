import { normalizeExportOptions } from './pdfImageEncoding.js';

export const PDF_SIZE_ESTIMATE_CACHE_KEY = 'cv-pdf-size-estimate-cache-v3';
export const PDF_SIZE_ESTIMATE_CACHE_VERSION = 3;
const LEGACY_CACHE_KEYS = [
  'cv-pdf-size-estimate-cache-v2',
  'cv-pdf-size-estimate-cache-v1',
];
const MAX_CACHE_ENTRIES = 12;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionKey(options) {
  const { format, quality } = normalizeExportOptions(options);
  return `${format}:${quality}`;
}

function emptyCache() {
  return { version: PDF_SIZE_ESTIMATE_CACHE_VERSION, entries: [] };
}

function normalizeEntry(entry) {
  if (!entry || !entry.options || !Number.isFinite(Number(entry.bytes))) return null;
  return {
    options: normalizeExportOptions(entry.options),
    bytes: Math.max(0, Math.round(finite(entry.bytes))),
    createdAt: Math.max(0, finite(entry.createdAt)),
  };
}

/**
 * The size display deliberately stores only the last exact size for each
 * export format/quality combination. It is a reference, not a prediction:
 * content, page geometry, and encoded image data never enter the cache.
 */
export function normalizePdfSizeEstimateCache(value) {
  const source = Array.isArray(value) ? { entries: value } : value;
  if (!source || typeof source !== 'object') return emptyCache();

  const newestByOption = new Map();
  (Array.isArray(source.entries) ? source.entries : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .forEach((entry) => {
      const key = optionKey(entry.options);
      const existing = newestByOption.get(key);
      if (!existing || entry.createdAt >= existing.createdAt) newestByOption.set(key, entry);
    });

  return {
    version: PDF_SIZE_ESTIMATE_CACHE_VERSION,
    entries: [...newestByOption.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_CACHE_ENTRIES),
  };
}

export function loadPdfSizeEstimateCache(storage = globalThis.localStorage) {
  try {
    const current = storage?.getItem(PDF_SIZE_ESTIMATE_CACHE_KEY);
    const legacy = LEGACY_CACHE_KEYS
      .map((key) => storage?.getItem(key))
      .find((value) => value != null);
    const cache = normalizePdfSizeEstimateCache(JSON.parse(current ?? legacy ?? 'null'));
    if (current == null && legacy != null) {
      try {
        storage?.setItem?.(PDF_SIZE_ESTIMATE_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // Caching is optional; the in-memory migration still works.
      }
    }
    return cache;
  } catch {
    return emptyCache();
  }
}

export function savePdfSizeEstimateCache(cache, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PDF_SIZE_ESTIMATE_CACHE_KEY, JSON.stringify(normalizePdfSizeEstimateCache(cache)));
  } catch {
    // Estimate caching must never block an export.
  }
}

export function recordPdfSizeMeasurement(cache, options, measurement, now = Date.now()) {
  if (!measurement || !Number.isFinite(Number(measurement.bytes))) {
    return normalizePdfSizeEstimateCache(cache);
  }

  const normalized = normalizePdfSizeEstimateCache(cache);
  const entry = {
    options: normalizeExportOptions(options),
    bytes: Math.max(0, Math.round(finite(measurement.bytes))),
    createdAt: now,
  };
  const key = optionKey(entry.options);
  return normalizePdfSizeEstimateCache({
    entries: [entry, ...normalized.entries.filter((candidate) => optionKey(candidate.options) !== key)],
  });
}

export function estimatePdfSizeFromCache(cache, options) {
  const targetOptions = normalizeExportOptions(options);
  const reference = normalizePdfSizeEstimateCache(cache).entries
    .find((candidate) => candidate.options.format === targetOptions.format);
  if (!reference) {
    return { bytes: null, source: 'unavailable', referenceOptions: null };
  }

  const sameQuality = reference.options.quality === targetOptions.quality;
  return {
    bytes: Math.round(reference.bytes * (targetOptions.quality / reference.options.quality)),
    source: sameQuality ? 'cached-exact' : 'quality-scaled',
    referenceOptions: reference.options,
  };
}
