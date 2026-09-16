import { normalizeExportOptions } from './pdfImageEncoding.js';

export const PDF_SIZE_ESTIMATE_CACHE_KEY = 'cv-pdf-size-estimate-cache-v1';
const MAX_CACHE_ENTRIES = 80;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function countText(value, totals = { characters: 0, lines: 0, links: 0 }) {
  if (typeof value === 'string') {
    totals.characters += value.length;
    totals.lines += value.split(/\r?\n/).length;
    totals.links += (value.match(/(?:https?:\/\/|mailto:|www\.)/gi) || []).length;
    return totals;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => countText(item, totals));
    return totals;
  }
  if (value && typeof value === 'object') Object.values(value).forEach((item) => countText(item, totals));
  return totals;
}

function optionKey(options) {
  const { format, quality } = normalizeExportOptions(options);
  return `${format}:${quality}`;
}

function compressionWeight(options) {
  const { format, quality } = normalizeExportOptions(options);
  if (format === 'png') {
    if (quality === 100) return 1;
    if (quality >= 95) return 0.47;
    if (quality >= 90) return 0.35;
    if (quality >= 85) return 0.27;
    return 0.21;
  }
  if (format === 'jpeg') return 0.18 + quality * 0.0082;
  return 0.72 + quality * 0.007;
}

function layerDistance(left, right) {
  if (left.designHash !== right.designHash) return Number.POSITIVE_INFINITY;
  const ratioDistance = (a, b) => Math.abs(Math.log((Math.max(1, a) / Math.max(1, b))));
  return (
    Math.abs(left.pageCount - right.pageCount) * 2
    + ratioDistance(left.graphicsPixels, right.graphicsPixels) * 4
    + ratioDistance(left.textCharacters, right.textCharacters)
    + ratioDistance(left.linkCount + 1, right.linkCount + 1) * 0.5
  );
}

function scaleCachedMeasurement(entry, targetLayers, targetOptions) {
  const sourceWeight = compressionWeight(entry.options);
  const targetWeight = compressionWeight(targetOptions);
  const sourceGraphics = Math.max(1, finite(entry.graphicsBytes));
  const sourceStatic = Math.max(0, finite(entry.bytes) - sourceGraphics);
  const graphicsScale = Math.max(0.1, targetLayers.graphicsPixels / Math.max(1, entry.layers.graphicsPixels));
  const textScale = Math.max(0.3, targetLayers.textCharacters / Math.max(1, entry.layers.textCharacters));
  const pageScale = Math.max(0.5, targetLayers.pageCount / Math.max(1, entry.layers.pageCount));
  const estimatedGraphics = sourceGraphics * graphicsScale * (targetWeight / sourceWeight);
  const estimatedStatic = sourceStatic * (textScale * 0.75 + pageScale * 0.25);
  return Math.round(estimatedGraphics + estimatedStatic);
}

/**
 * Creates a compact, non-content cache key from the document's information
 * layers and preview geometry. Page image data is deliberately not inspected:
 * automatic estimates never encode a new image or PDF.
 */
export function createPdfSizeLayerInfo(state = {}, pages = []) {
  const { exportOptions: _ignoredExportOptions, ...documentState } = state;
  const textLayers = {
    contact: state.contact,
    about: state.about,
    education: state.education,
    experience: state.experience,
    languages: state.languages,
    hobbies: state.hobbies,
    customSections: state.customSections,
    sidebarSections: state.sidebarSections,
    softSkills: state.softSkills,
    sectionNames: state.sectionNames,
  };
  const text = countText(textLayers);
  const geometry = (Array.isArray(pages) ? pages : []).map((page) => ({
    width: Math.round(finite(page?.canvasWidth)),
    height: Math.round(Math.max(0, finite(page?.sourceBottom) - finite(page?.sourceTop))),
    contentWidth: Math.round(finite(page?.contentWidth)),
    offset: Math.round(finite(page?.topOffset)),
  }));
  const graphicsPixels = geometry.reduce((total, page) => total + page.width * page.height, 0);
  const documentHash = hash(JSON.stringify(documentState));
  const designHash = hash(JSON.stringify(state.design || {}));
  const geometryHash = hash(JSON.stringify(geometry));

  return {
    signature: `v1:${documentHash}:${geometryHash}`,
    designHash,
    pageCount: Math.max(1, geometry.length),
    graphicsPixels: Math.max(1, graphicsPixels),
    textCharacters: text.characters,
    linkCount: text.links,
  };
}

export function normalizePdfSizeEstimateCache(value) {
  const entries = Array.isArray(value) ? value : value?.entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => (
      entry
      && typeof entry.signature === 'string'
      && entry.layers
      && Number.isFinite(Number(entry.bytes))
      && Number.isFinite(Number(entry.graphicsBytes))
      && entry.options
    ))
    .slice(0, MAX_CACHE_ENTRIES);
}

export function loadPdfSizeEstimateCache(storage = globalThis.localStorage) {
  try {
    return normalizePdfSizeEstimateCache(JSON.parse(storage?.getItem(PDF_SIZE_ESTIMATE_CACHE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function savePdfSizeEstimateCache(entries, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PDF_SIZE_ESTIMATE_CACHE_KEY, JSON.stringify(normalizePdfSizeEstimateCache(entries)));
  } catch {
    // Estimate caching is optional and must never block an export.
  }
}

export function recordPdfSizeMeasurement(entries, layers, options, measurement) {
  const normalized = normalizePdfSizeEstimateCache(entries);
  const record = {
    signature: layers.signature,
    layers,
    options: normalizeExportOptions(options),
    bytes: Math.max(0, Math.round(finite(measurement?.bytes))),
    graphicsBytes: Math.max(0, Math.round(finite(measurement?.graphicsBytes))),
    createdAt: Date.now(),
  };
  const key = `${record.signature}:${optionKey(record.options)}`;
  return [record, ...normalized.filter((entry) => `${entry.signature}:${optionKey(entry.options)}` !== key)]
    .slice(0, MAX_CACHE_ENTRIES);
}

/**
 * Predict with exact cached data first, then calibrate a related cached layer
 * measurement. The final fallback considers only page geometry and text/link
 * information—never encoded preview images or a newly rendered PDF.
 */
export function estimatePdfSizeFromLayerCache(entries, layers, options) {
  const normalizedOptions = normalizeExportOptions(options);
  const cache = normalizePdfSizeEstimateCache(entries);
  const sameDocument = cache.filter((entry) => entry.signature === layers.signature);
  const exact = sameDocument.find((entry) => optionKey(entry.options) === optionKey(normalizedOptions));
  if (exact) return { bytes: exact.bytes, source: 'cached-exact' };

  const sameDocumentSource = sameDocument
    .sort((left, right) => {
      const formatPenalty = Number(left.options.format !== normalizedOptions.format) - Number(right.options.format !== normalizedOptions.format);
      return formatPenalty || Math.abs(left.options.quality - normalizedOptions.quality) - Math.abs(right.options.quality - normalizedOptions.quality);
    })[0];
  if (sameDocumentSource) {
    return { bytes: scaleCachedMeasurement(sameDocumentSource, layers, normalizedOptions), source: 'cached-calibrated' };
  }

  const similar = cache
    .map((entry) => ({ entry, distance: layerDistance(entry.layers, layers) }))
    .filter(({ distance }) => Number.isFinite(distance) && distance <= 4)
    .sort((left, right) => left.distance - right.distance)[0];
  if (similar) {
    return { bytes: scaleCachedMeasurement(similar.entry, layers, normalizedOptions), source: 'similar-layer' };
  }

  const graphicsBytes = layers.graphicsPixels * 0.035 * compressionWeight(normalizedOptions);
  const textBytes = 12_000 + layers.textCharacters * 0.9 + layers.linkCount * 160 + layers.pageCount * 2_500;
  return { bytes: Math.round(graphicsBytes + textBytes), source: 'layer-heuristic' };
}
