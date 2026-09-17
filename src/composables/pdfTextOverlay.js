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
  const fontSize = (Number.parseFloat(style.fontSize) || 16) * POINTS_PER_CSS_PIXEL * normalization.fontScale;
  const href = textNode.parentElement.closest('a[href]')?.href || null;
  const source = textNode.nodeValue;
  const fragments = [];
  const range = documentRef.createRange();

  // Capture each glyph at its browser-measured advance position so the PDF
  // font's slightly different metrics cannot shift the selectable text.
  for (let index = 0; index < source.length; index += 1) {
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    fragments.push({
      text: source[index],
      href,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
      baseline: baselineFor(rect, style, normalization.targetMetrics)
        + normalization.baselineOffset - rootRect.top,
      fontSize,
      weight,
    });
  }

  return fragments;
}

/** Capture text geometry for the PDF's invisible, selectable text/link layer. */
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
    rasterBaseline: command.baseline * verticalScale,
  });

  return {
    ...capture,
    text: capture.text.map(rasterize),
  };
}

export function overlayPageFragments(command, page) {
  // Use exactly the same slices and pixel-to-mm scale as the raster background.
  // A glyph belongs only to the page containing its baseline, even when its
  // bounding box crosses a page boundary.
  if (command.rasterBaseline < page.sourceTop || command.rasterBaseline >= page.sourceBottom) return null;
  const millimetersPerRasterPixel = page.contentWidth / page.canvasWidth;
  return {
    x: page.leftOffset + (command.rasterX * millimetersPerRasterPixel),
    y: page.topOffset + ((command.rasterY - page.sourceTop) * millimetersPerRasterPixel),
    width: command.rasterWidth * millimetersPerRasterPixel,
    height: command.rasterHeight * millimetersPerRasterPixel,
    baseline: page.topOffset + ((command.rasterBaseline - page.sourceTop) * millimetersPerRasterPixel),
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

/** Draw a selectable text/link layer above an already-rendered PDF page. */
export async function drawPdfOverlay(doc, capture, pages) {
  await registerInter(doc);
  for (const [index, page] of pages.entries()) {
    doc.setPage(index + 1);
    for (const text of capture.text) {
      const fragment = overlayPageFragments(text, page);
      if (!fragment) continue;
      doc.setFont('CvInter', text.weight);
      doc.setFontSize(text.fontSize);
      // This layer uses PDF invisible-text rendering, so clipping is neither
      // required nor desirable. Some PDF viewers stroke the clipping path as
      // a black frame around the page content.
      doc.text(text.text, fragment.x, fragment.baseline, { renderingMode: 'invisible' });
      if (text.href) doc.link(fragment.x, fragment.y, fragment.width, fragment.height, { url: text.href });
    }
  }
}
