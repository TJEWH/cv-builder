const interRegularUrl = new URL('../assets/pdf-fonts/Inter-Regular.ttf', import.meta.url).href;
const interBoldUrl = new URL('../assets/pdf-fonts/Inter-Bold.ttf', import.meta.url).href;

const POINTS_PER_CSS_PIXEL = 72 / 96;
const FONT_METRIC_SAMPLE = 'HbdpqgjÅ';
const fontMetricCaches = new WeakMap();

function binaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return result;
}

function rgb(value, fallback = [17, 24, 39]) {
  const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
  if (!match) return fallback;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return fallback;
  const alpha = Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1;
  return parts.slice(0, 3).map((part) => Math.round((part * alpha) + (255 * (1 - alpha))));
}

function finiteMetric(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function metricPair(measurement) {
  const ascent = finiteMetric(measurement.fontBoundingBoxAscent) || finiteMetric(measurement.actualBoundingBoxAscent);
  const descent = finiteMetric(measurement.fontBoundingBoxDescent) || finiteMetric(measurement.actualBoundingBoxDescent);
  return ascent && descent ? { ascent, descent } : null;
}

export function normalizeInterMetrics(target, inter) {
  if (!target || !inter) return { fontScale: 1, baselineOffset: 0, targetMetrics: null };
  const targetHeight = target.ascent + target.descent;
  const interHeight = inter.ascent + inter.descent;
  if (!targetHeight || !interHeight) return { fontScale: 1, baselineOffset: 0, targetMetrics: target };

  // Limit a bad browser metric response to a conservative adjustment. The
  // selectable families are all sans-serif, so their normal differences stay
  // well within this range.
  const fontScale = Math.max(.8, Math.min(1.2, targetHeight / interHeight));
  return {
    fontScale,
    baselineOffset: (inter.ascent * fontScale) - target.ascent,
    targetMetrics: target,
  };
}

function canvasFont(style, family, weight) {
  const fontSize = style.fontSize || '16px';
  const fontStyle = style.fontStyle || 'normal';
  return `${fontStyle} ${weight || style.fontWeight || '400'} ${fontSize} ${family}`;
}

function interNormalization(style, documentRef, weight) {
  const windowRef = documentRef.defaultView || window;
  let cache = fontMetricCaches.get(documentRef);
  if (!cache) {
    cache = new Map();
    fontMetricCaches.set(documentRef, cache);
  }

  const key = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily, weight].join('|');
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = documentRef.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return normalizeInterMetrics(null, null);

  context.font = canvasFont(style, style.fontFamily, style.fontWeight);
  const target = metricPair(context.measureText(FONT_METRIC_SAMPLE));
  context.font = canvasFont(style, 'Inter, ui-sans-serif, sans-serif', weight === 'bold' ? '700' : '400');
  const inter = metricPair(context.measureText(FONT_METRIC_SAMPLE));
  const normalization = normalizeInterMetrics(target, inter);
  cache.set(key, normalization);
  return normalization;
}

function baselineFor(rect, style, metrics) {
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const lineHeight = Number.parseFloat(style.lineHeight) || rect.height || fontSize * 1.35;
  const ascent = metrics?.ascent || (fontSize * .8);
  const descent = metrics?.descent || (fontSize * .2);
  return rect.top + Math.max(0, (lineHeight - ascent - descent) / 2) + ascent;
}

function isRenderableText(node) {
  if (!node.nodeValue) return false;
  const parent = node.parentElement;
  return parent && !parent.closest('script, style, noscript, textarea');
}

function characterFragments(root, textNode) {
  const documentRef = root.ownerDocument;
  const windowRef = documentRef.defaultView || window;
  const rootRect = root.getBoundingClientRect();
  const style = windowRef.getComputedStyle(textNode.parentElement);
  const weight = Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold' ? 'bold' : 'normal';
  const normalization = interNormalization(style, documentRef, weight);
  const source = textNode.nodeValue;
  const fragments = [];

  for (let index = 0; index < source.length; index += 1) {
    const range = documentRef.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const href = textNode.parentElement.closest('a[href]')?.href || null;
    fragments.push({
      text: source[index], href, left: rect.left, top: rect.top,
      width: rect.width, height: rect.height, style,
      rootLeft: rootRect.left, rootTop: rootRect.top,
    });
  }

  // Draw each glyph at its browser-measured advance position.  A PDF font's
  // metrics are not bit-for-bit identical to a browser font, so drawing a
  // complete line could make its ending drift or appear to wrap differently.
  return fragments.map((fragment) => ({
    text: fragment.text,
    href: fragment.href,
    x: fragment.left - fragment.rootLeft,
    y: fragment.top - fragment.rootTop,
    width: fragment.width,
    height: fragment.height,
    baseline: baselineFor({ top: fragment.top, height: fragment.height }, fragment.style, normalization.targetMetrics)
      + normalization.baselineOffset - fragment.rootTop,
    fontSize: (Number.parseFloat(fragment.style.fontSize) || 16) * POINTS_PER_CSS_PIXEL * normalization.fontScale,
    weight,
    color: rgb(fragment.style.color),
  }));
}

function listMarkers(root) {
  const windowRef = root.ownerDocument.defaultView || window;
  const rootRect = root.getBoundingClientRect();
  return [...root.querySelectorAll('li')].map((item) => {
    const rect = item.getBoundingClientRect();
    const style = windowRef.getComputedStyle(item);
    return {
      x: rect.left - rootRect.left - 8,
      y: rect.top - rootRect.top + (rect.height / 2),
      style: style.listStyleType || 'disc',
      color: rgb(style.color),
    };
  });
}

/** Capture visible browser layout before its text paint is suppressed. */
export function capturePdfOverlay(root) {
  const documentRef = root.ownerDocument;
  const nodeFilter = documentRef.defaultView?.NodeFilter || NodeFilter;
  const walker = documentRef.createTreeWalker(root, nodeFilter.SHOW_TEXT);
  const text = [];
  let node = walker.nextNode();
  while (node) {
    if (isRenderableText(node)) text.push(...characterFragments(root, node));
    node = walker.nextNode();
  }
  const rootBounds = root.getBoundingClientRect();
  return {
    text,
    markers: listMarkers(root),
    // html2canvas renders a ceil()ed CSS rectangle before applying its scale.
    // Preserve that same dimension rather than a scrollHeight or fractional
    // layout box so neither axis accumulates a per-page scale error.
    width: Math.ceil(rootBounds.width),
    height: Math.ceil(rootBounds.height),
  };
}

/**
 * Move captured DOM geometry into the exact pixel grid of the completed
 * html2canvas result. From this point onward text and background graphics
 * share one coordinate system and therefore one set of page breaks.
 */
export function rasterizePdfOverlay(capture, canvas) {
  const horizontalScale = canvas.width / capture.width;
  const verticalScale = canvas.height / capture.height;
  const rasterize = (command) => ({
    ...command,
    rasterX: command.x * horizontalScale,
    rasterY: command.y * verticalScale,
    rasterWidth: command.width * horizontalScale,
    rasterHeight: command.height * verticalScale,
    rasterBaseline: (command.baseline ?? command.y) * verticalScale,
  });

  return {
    ...capture,
    text: capture.text.map(rasterize),
    markers: capture.markers.map(rasterize),
  };
}

export function overlayPageFragments(command, page) {
  if (Number.isFinite(command.rasterBaseline)) {
    // These are the exact sourceY/sliceHeight ranges used to crop the raster
    // page background. A glyph belongs only to the slice containing its
    // rasterized baseline.
    if (command.rasterBaseline < page.sourceTop || command.rasterBaseline >= page.sourceBottom) return null;
    const millimetersPerRasterPixel = page.contentWidth / page.canvasWidth;
    return {
      x: page.leftOffset + (command.rasterX * millimetersPerRasterPixel),
      y: page.topOffset + ((command.rasterY - page.sourceTop) * millimetersPerRasterPixel),
      width: command.rasterWidth * millimetersPerRasterPixel,
      height: command.rasterHeight * millimetersPerRasterPixel,
      baseline: page.topOffset + ((command.rasterBaseline - page.sourceTop) * millimetersPerRasterPixel),
      clipped: false,
      clipY: page.topOffset,
      clipHeight: page.renderedHeight,
    };
  }

  const verticalScale = page.canvasPixelsPerCssPixelY || page.canvasPixelsPerCssPixel;
  const horizontalScale = page.canvasPixelsPerCssPixel || verticalScale;
  const sourceTop = page.sourceTop / verticalScale;
  const sourceBottom = page.sourceBottom / verticalScale;
  const baseline = command.baseline ?? command.y;
  // A text fragment may paint across the raster slice boundary. Assign it to
  // the one page containing its baseline rather than emitting it twice or
  // forcing a clipping path (which can render as a border in some viewers).
  if (baseline < sourceTop || baseline >= sourceBottom) return null;
  // html2canvas rounds the canvas width and height independently. A source
  // that is, for example, 793.7 CSS pixels wide can become 2382 raster
  // pixels, while its integer scroll height becomes an exact 3× multiple.
  // Mapping Y with the horizontal factor makes every lower fragment drift.
  // Derive both physical axes from the same raster dimensions that were
  // supplied to jsPDF's addImage call.
  const mmPerCssPixelX = page.contentWidth / page.sourceWidth;
  const mmPerCssPixelY = mmPerCssPixelX * (verticalScale / horizontalScale);
  return {
    x: page.leftOffset + (command.x * mmPerCssPixelX),
    y: page.topOffset + ((command.y - sourceTop) * mmPerCssPixelY),
    width: command.width * mmPerCssPixelX,
    height: command.height * mmPerCssPixelY,
    baseline: page.topOffset + ((command.baseline - sourceTop) * mmPerCssPixelY),
    fontSize: command.fontSize,
    clipped: false,
    clipY: page.topOffset,
    clipHeight: page.renderedHeight,
  };
}

async function registerInter(doc) {
  if (typeof window === 'undefined') return;
  const [regular, bold] = await Promise.all([fetch(interRegularUrl), fetch(interBoldUrl)]);
  if (!regular.ok || !bold.ok) throw new Error('The bundled PDF fonts could not be loaded');
  doc.addFileToVFS('CvInter-Regular.ttf', binaryString(await regular.arrayBuffer()));
  doc.addFileToVFS('CvInter-Bold.ttf', binaryString(await bold.arrayBuffer()));
  doc.addFont('CvInter-Regular.ttf', 'CvInter', 'normal');
  doc.addFont('CvInter-Bold.ttf', 'CvInter', 'bold');
}

function drawMarker(doc, command, fragment) {
  doc.setDrawColor(...command.color);
  doc.setFillColor(...command.color);
  const x = fragment.x;
  const y = fragment.y + (fragment.height / 2);
  if (command.style === 'circle') doc.circle(x, y, .8, 'S');
  else if (command.style === 'square') doc.rect(x - .7, y - .7, 1.4, 1.4, 'F');
  else if (command.style === 'disclosure-closed') doc.triangle(x - .7, y - .7, x - .7, y + .7, x + .7, y, 'F');
  else doc.circle(x, y, .75, 'F');
}

/** Draw a selectable text/link layer above an already-rendered PDF page. */
export async function drawPdfOverlay(doc, capture, pages, {
  invisibleText = false,
  drawMarkers = true,
} = {}) {
  await registerInter(doc);
  for (const [index, page] of pages.entries()) {
    doc.setPage(index + 1);
    if (drawMarkers) {
      for (const marker of capture.markers) {
        const fragment = overlayPageFragments({ ...marker, width: 0, height: 1.5, baseline: marker.y }, page);
        if (fragment) drawMarker(doc, marker, fragment);
      }
    }
    for (const text of capture.text) {
      const fragment = overlayPageFragments(text, page);
      if (!fragment) continue;
      doc.setFont('CvInter', text.weight);
      doc.setFontSize(text.fontSize);
      doc.setTextColor(...text.color);
      // This layer uses PDF invisible-text rendering, so clipping is neither
      // required nor desirable. Some PDF viewers stroke the clipping path as
      // a black frame around the page content.
      doc.text(text.text, fragment.x, fragment.baseline, invisibleText ? { renderingMode: 'invisible' } : undefined);
      if (text.href) doc.link(fragment.x, fragment.y, fragment.width, fragment.height, { url: text.href });
    }
  }
}
