import { normalizeExportOptions } from './pdfImageEncoding.js';

export const PDF_SIZE_ESTIMATE_CACHE_KEY = 'cv-pdf-size-estimate-cache-v2';
export const PDF_SIZE_ESTIMATE_CACHE_VERSION = 2;
export const PDF_SIZE_ESTIMATE_TTL_MS = 60 * 60 * 1000;
const LEGACY_PDF_SIZE_ESTIMATE_CACHE_KEY = 'cv-pdf-size-estimate-cache-v1';
const MAX_CACHE_ENTRIES = 80;
const EXPORTER_PROFILE_ID = 'hybrid-selectable-inter-v1';
const FALLBACK_STATIC_BYTES = 16_000;
const FALLBACK_PAGE_BYTES = 700;
const FALLBACK_GLYPH_BYTES = 6;
const FALLBACK_LINK_BYTES = 90;

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

function fingerprintFactor(fingerprint = {}) {
  const palette = Math.max(1, finite(fingerprint.paletteSize, 1));
  const ink = Math.max(0, Math.min(1, finite(fingerprint.inkRatio)));
  const edges = Math.max(0, Math.min(1, finite(fingerprint.edgeRatio)));
  return 0.65 + Math.min(1, palette / 128) * 0.2 + ink * 0.1 + edges * 0.05;
}

function isFresh(createdAt, now = Date.now()) {
  const timestamp = finite(createdAt);
  return timestamp > 0 && now >= timestamp && now - timestamp < PDF_SIZE_ESTIMATE_TTL_MS;
}

function normalizeFingerprint(value = {}) {
  const ratio = (input) => Math.round(Math.max(0, Math.min(1, finite(input))) * 10_000) / 10_000;
  return {
    inkRatio: ratio(value.inkRatio),
    edgeRatio: ratio(value.edgeRatio),
    paletteSize: Math.max(0, Math.round(finite(value.paletteSize))),
    samples: Math.max(0, Math.round(finite(value.samples))),
  };
}

function normalizeLayers(value = {}) {
  return {
    signature: typeof value.signature === 'string' ? value.signature : '',
    designHash: typeof value.designHash === 'string' ? value.designHash : '',
    pageCount: Math.max(1, Math.round(finite(value.pageCount, 1))),
    graphicsPixels: Math.max(1, finite(value.graphicsPixels, 1)),
    textCharacters: Math.max(0, Math.round(finite(value.textCharacters))),
    textGlyphs: Math.max(0, Math.round(finite(value.textGlyphs, value.textCharacters))),
    linkCount: Math.max(0, Math.round(finite(value.linkCount))),
    graphicsFingerprint: normalizeFingerprint(value.graphicsFingerprint),
  };
}

function normalizeStaticProfile(value) {
  if (!value || value.exporter !== EXPORTER_PROFILE_ID || !Number.isFinite(Number(value.fixedBytes))) return null;
  return {
    exporter: EXPORTER_PROFILE_ID,
    fixedBytes: Math.max(0, Math.round(finite(value.fixedBytes))),
    pageBytes: Math.max(0, Math.round(finite(value.pageBytes, FALLBACK_PAGE_BYTES))),
    glyphBytes: Math.max(0, finite(value.glyphBytes, FALLBACK_GLYPH_BYTES)),
    linkBytes: Math.max(0, Math.round(finite(value.linkBytes, FALLBACK_LINK_BYTES))),
    createdAt: finite(value.createdAt),
  };
}

function emptyCache() {
  return { version: PDF_SIZE_ESTIMATE_CACHE_VERSION, staticProfile: null, entries: [] };
}

function profileFor(cache) {
  return cache.staticProfile || {
    exporter: EXPORTER_PROFILE_ID,
    fixedBytes: FALLBACK_STATIC_BYTES,
    pageBytes: FALLBACK_PAGE_BYTES,
    glyphBytes: FALLBACK_GLYPH_BYTES,
    linkBytes: FALLBACK_LINK_BYTES,
    createdAt: 0,
  };
}

function variableBytes(layers, profile) {
  return (
    layers.pageCount * profile.pageBytes
    + layers.textGlyphs * profile.glyphBytes
    + layers.linkCount * profile.linkBytes
  );
}

function scaleRatio(source, target) {
  return Math.max(0.2, target / Math.max(1, source));
}

function layerDistance(left, right) {
  if (left.designHash !== right.designHash) return Number.POSITIVE_INFINITY;
  const ratioDistance = (a, b) => Math.abs(Math.log((Math.max(1, a) / Math.max(1, b))));
  return (
    Math.abs(left.pageCount - right.pageCount) * 2
    + ratioDistance(left.graphicsPixels, right.graphicsPixels) * 3
    + ratioDistance(left.textGlyphs + 1, right.textGlyphs + 1)
    + ratioDistance(left.graphicsFingerprint.paletteSize + 1, right.graphicsFingerprint.paletteSize + 1)
    + Math.abs(left.graphicsFingerprint.inkRatio - right.graphicsFingerprint.inkRatio) * 2
    + Math.abs(left.graphicsFingerprint.edgeRatio - right.graphicsFingerprint.edgeRatio)
  );
}

function predictedGraphicsBytes(entry, targetLayers, targetOptions) {
  const sourceWeight = compressionWeight(entry.options);
  const targetWeight = compressionWeight(targetOptions);
  const geometryScale = scaleRatio(entry.layers.graphicsPixels, targetLayers.graphicsPixels);
  const complexityScale = fingerprintFactor(targetLayers.graphicsFingerprint) / fingerprintFactor(entry.layers.graphicsFingerprint);
  return Math.max(0, entry.graphicsBytes * geometryScale * complexityScale * (targetWeight / sourceWeight));
}

function predictedDynamicBytes(entry, targetLayers, profile) {
  const recordedDynamic = Math.max(0, entry.bytes - entry.graphicsBytes - profile.fixedBytes);
  const sourceVariable = Math.max(1, variableBytes(entry.layers, profile));
  return recordedDynamic * (variableBytes(targetLayers, profile) / sourceVariable);
}

function heuristicGraphicsBytes(layers, options) {
  return layers.graphicsPixels * 0.018 * compressionWeight(options) * fingerprintFactor(layers.graphicsFingerprint);
}

/**
 * Creates a compact, non-content cache key from document state, page geometry
 * and the preview's already-captured graphic fingerprint. Encoded page images
 * are deliberately never read by the estimator.
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
    sectionNames: state.sectionNames,
  };
  const text = countText(textLayers);
  const pageList = Array.isArray(pages) ? pages : [];
  const geometry = pageList.map((page) => ({
    width: Math.round(finite(page?.canvasWidth)),
    height: Math.round(Math.max(0, finite(page?.sourceBottom) - finite(page?.sourceTop))),
    contentWidth: Math.round(finite(page?.contentWidth)),
    offset: Math.round(finite(page?.topOffset)),
  }));
  const graphicsPixels = geometry.reduce((total, page) => total + page.width * page.height, 0);
  const fingerprintTotals = pageList.reduce((total, page) => {
    const fingerprint = normalizeFingerprint(page?.graphicsFingerprint);
    const weight = Math.max(1, fingerprint.samples);
    total.samples += weight;
    total.ink += fingerprint.inkRatio * weight;
    total.edges += fingerprint.edgeRatio * weight;
    total.palette.add(fingerprint.paletteSize);
    return total;
  }, { samples: 0, ink: 0, edges: 0, palette: new Set() });
  const graphicsFingerprint = {
    samples: fingerprintTotals.samples,
    inkRatio: fingerprintTotals.samples ? fingerprintTotals.ink / fingerprintTotals.samples : 0,
    edgeRatio: fingerprintTotals.samples ? fingerprintTotals.edges / fingerprintTotals.samples : 0,
    paletteSize: fingerprintTotals.palette.size ? Math.max(...fingerprintTotals.palette) : 0,
  };
  const documentHash = hash(JSON.stringify(documentState));
  const designHash = hash(JSON.stringify(state.design || {}));
  const geometryHash = hash(JSON.stringify(geometry));

  return normalizeLayers({
    signature: `v2:${documentHash}:${geometryHash}`,
    designHash,
    pageCount: Math.max(1, geometry.length),
    graphicsPixels: Math.max(1, graphicsPixels),
    textCharacters: text.characters,
    textGlyphs: text.characters,
    linkCount: text.links,
    graphicsFingerprint,
  });
}

export function normalizePdfSizeEstimateCache(value) {
  const source = Array.isArray(value) ? { entries: value } : value;
  if (!source || typeof source !== 'object') return emptyCache();
  const entries = Array.isArray(source.entries) ? source.entries : [];
  return {
    version: PDF_SIZE_ESTIMATE_CACHE_VERSION,
    staticProfile: normalizeStaticProfile(source.staticProfile),
    entries: entries
      .filter((entry) => (
        entry
        && typeof entry.signature === 'string'
        && entry.layers
        && Number.isFinite(Number(entry.bytes))
        && Number.isFinite(Number(entry.graphicsBytes))
        && entry.options
      ))
      .map((entry) => ({
        signature: entry.signature,
        layers: normalizeLayers(entry.layers),
        options: normalizeExportOptions(entry.options),
        bytes: Math.max(0, Math.round(finite(entry.bytes))),
        graphicsBytes: Math.max(0, Math.round(finite(entry.graphicsBytes))),
        createdAt: finite(entry.createdAt),
      }))
      .slice(0, MAX_CACHE_ENTRIES),
  };
}

export function loadPdfSizeEstimateCache(storage = globalThis.localStorage) {
  try {
    const current = storage?.getItem(PDF_SIZE_ESTIMATE_CACHE_KEY);
    // Earlier releases kept just an array of complete PDF samples. Preserve
    // those numerical records as calibration candidates, but never copy text
    // or page-image data into the new cache.
    const raw = current ?? storage?.getItem(LEGACY_PDF_SIZE_ESTIMATE_CACHE_KEY);
    const cache = normalizePdfSizeEstimateCache(JSON.parse(raw || 'null'));
    if (current == null && raw != null) {
      try {
        storage?.setItem?.(PDF_SIZE_ESTIMATE_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // The in-memory migration is still useful if browser storage is full.
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
    // Estimate caching is optional and must never block an export.
  }
}

export function hasFreshPdfSizeCalibration(cache, layers, options, now = Date.now()) {
  const normalized = normalizePdfSizeEstimateCache(cache);
  return normalized.entries.some((entry) => (
    entry.signature === layers.signature
    && optionKey(entry.options) === optionKey(options)
    && isFresh(entry.createdAt, now)
  ));
}

export function hasFreshPdfStaticProfile(cache, now = Date.now()) {
  return isFresh(normalizePdfSizeEstimateCache(cache).staticProfile?.createdAt, now);
}

export function needsPdfSizeGroundTruth(cache, layers, options, now = Date.now()) {
  return !hasFreshPdfSizeCalibration(cache, layers, options, now)
    || !hasFreshPdfStaticProfile(cache, now);
}

function deriveStaticProfile(existingProfile, measurement, layers, now) {
  if (isFresh(existingProfile?.createdAt, now)) return existingProfile;
  const provisional = profileFor({ staticProfile: null });
  const nonGraphics = Math.max(0, finite(measurement.bytes) - finite(measurement.graphicsBytes));
  const fixedBytes = Math.max(0, Math.round(nonGraphics - variableBytes(layers, provisional)));
  return { ...provisional, fixedBytes, createdAt: now };
}

export function recordPdfSizeMeasurement(cache, layers, options, measurement, now = Date.now()) {
  const normalized = normalizePdfSizeEstimateCache(cache);
  const normalizedLayers = normalizeLayers({
    ...layers,
    textGlyphs: measurement?.textGlyphs ?? layers.textGlyphs,
    linkCount: measurement?.linkCount ?? layers.linkCount,
  });
  const staticProfile = deriveStaticProfile(normalized.staticProfile, measurement, normalizedLayers, now);
  const record = {
    signature: normalizedLayers.signature,
    layers: normalizedLayers,
    options: normalizeExportOptions(options),
    bytes: Math.max(0, Math.round(finite(measurement?.bytes))),
    graphicsBytes: Math.max(0, Math.round(finite(measurement?.graphicsBytes))),
    createdAt: now,
  };
  const key = `${record.signature}:${optionKey(record.options)}`;
  return {
    version: PDF_SIZE_ESTIMATE_CACHE_VERSION,
    staticProfile,
    entries: [record, ...normalized.entries.filter((entry) => `${entry.signature}:${optionKey(entry.options)}` !== key)]
      .slice(0, MAX_CACHE_ENTRIES),
  };
}

/**
 * Predict using a fresh exact measurement first, then a same-CV calibration,
 * compatible layer history, or an information-layer heuristic. None of these
 * paths renders a PDF or encodes another image.
 */
export function estimatePdfSizeFromLayerCache(cache, layers, options, now = Date.now()) {
  const normalizedCache = normalizePdfSizeEstimateCache(cache);
  const normalizedLayers = normalizeLayers(layers);
  const normalizedOptions = normalizeExportOptions(options);
  const profile = profileFor(normalizedCache);
  const sameDocument = normalizedCache.entries.filter((entry) => entry.signature === normalizedLayers.signature);
  const exact = sameDocument.find((entry) => optionKey(entry.options) === optionKey(normalizedOptions) && isFresh(entry.createdAt, now));
  if (exact) return { bytes: exact.bytes, source: 'cached-exact' };

  const sameDocumentSource = sameDocument
    .sort((left, right) => {
      const formatPenalty = Number(left.options.format !== normalizedOptions.format) - Number(right.options.format !== normalizedOptions.format);
      return formatPenalty || Math.abs(left.options.quality - normalizedOptions.quality) - Math.abs(right.options.quality - normalizedOptions.quality);
    })[0];
  if (sameDocumentSource) {
    return {
      bytes: Math.round(profile.fixedBytes + predictedDynamicBytes(sameDocumentSource, normalizedLayers, profile) + predictedGraphicsBytes(sameDocumentSource, normalizedLayers, normalizedOptions)),
      source: 'cached-calibrated',
    };
  }

  const similar = normalizedCache.entries
    .map((entry) => ({ entry, distance: layerDistance(entry.layers, normalizedLayers) }))
    .filter(({ distance }) => Number.isFinite(distance) && distance <= 4)
    .sort((left, right) => left.distance - right.distance)[0];
  if (similar) {
    return {
      bytes: Math.round(profile.fixedBytes + predictedDynamicBytes(similar.entry, normalizedLayers, profile) + predictedGraphicsBytes(similar.entry, normalizedLayers, normalizedOptions)),
      source: 'similar-layer',
    };
  }

  return {
    bytes: Math.round(profile.fixedBytes + variableBytes(normalizedLayers, profile) + heuristicGraphicsBytes(normalizedLayers, normalizedOptions)),
    source: 'layer-heuristic',
  };
}
