import { PDFDocument } from 'pdfkit';
import { toBlob } from 'pdfkit/output';
import { create as createFont } from 'fontkit';
import { createVectorFontResolver } from './pdfVectorFonts.js';
import { createVectorGraphicsContext, parseCanvasColor } from './pdfVectorGraphics.js';
import { vectorTextIntersectsPage } from './pdfVectorText.js';
import { vectorPageLinks } from './pdfVectorLinks.js';

const POINTS_PER_MILLIMETER = 72 / 25.4;

function drawText(context, record, runs) {
  const [text, x, y, maxWidth] = record.args;
  if (!text || !runs.length) return;
  context.withPaint((doc, state) => {
    const widths = runs.map((run) => {
      doc.font(run.font, run.id).fontSize(run.fontSize);
      return doc.widthOfString(run.text);
    });
    const fontWidth = widths.reduce((sum, width) => sum + width, 0);
    const browserWidth = record.metrics.width;
    const width = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(browserWidth, maxWidth) : browserWidth;
    const scale = fontWidth > 0 ? width / fontWidth : 1;
    let left = x;
    if (state.textAlign === 'center') left -= width / 2;
    if (state.textAlign === 'right' || (state.textAlign === 'end' && state.direction !== 'rtl')) left -= width;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      doc.font(run.font, run.id).fontSize(run.fontSize);
      if (run.syntheticBold) {
        const paint = parseCanvasColor(state.fillStyle);
        doc.strokeColor(paint.color).strokeOpacity(paint.opacity * state.globalAlpha).lineWidth(run.fontSize / 30);
      }
      doc.text(run.text, left, y, {
        lineBreak: false,
        baseline: state.textBaseline,
        horizontalScaling: scale * 100,
        oblique: run.syntheticItalic ? 14 : false,
        stroke: record.method === 'strokeText' || run.syntheticBold,
        fill: record.method !== 'strokeText',
      });
      left += widths[index] * scale;
    }
  }, { stroke: record.method === 'strokeText' });
}

/**
 * Replay the shared vector paint list as PDF paths and visible embedded fonts.
 */
export async function renderVectorPdf({ recording, canvas, pages, links, fontStyleUrls, loadedFaces, pageWidth, pageHeight, task }) {
  const resolver = await task.wait(createVectorFontResolver({ document: globalThis.document, stylesheetUrls: fontStyleUrls, loadedFaces, createFont }));
  const textRuns = new Map();
  for (const record of recording.records) {
    if (record.method !== 'fillText' && record.method !== 'strokeText') continue;
    // Canvas treats ASCII control whitespace as spaces; PDFKit would otherwise
    // lay out a newline again, and fonts do not contain glyphs for these codes.
    const text = String(record.args[0]).replace(/[\t\n\f\r]/g, ' ');
    if (!text) continue;
    const pause = task.checkpoint();
    if (pause) await pause;
    textRuns.set(record, await task.wait(resolver.resolve(record.fontString, text)));
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    font: null,
    compress: true,
    info: { Creator: 'CV Builder', Producer: 'CV Builder vector export' },
  });
  const blob = toBlob(doc);
  // Attach a handler immediately, including when a drawing error aborts export.
  blob.catch(() => {});
  try {
    const pageOptions = { size: [pageWidth * POINTS_PER_MILLIMETER, pageHeight * POINTS_PER_MILLIMETER], margin: 0 };
    // An empty CV still downloads a valid single blank page.
    if (!pages.length) doc.addPage(pageOptions);
    for (const page of pages) {
      await task.checkpoint(true);
      doc.addPage(pageOptions);
      const pixelScale = page.contentWidth * POINTS_PER_MILLIMETER / page.canvasWidth;
      doc.save();
      doc.translate(page.leftOffset * POINTS_PER_MILLIMETER, page.topOffset * POINTS_PER_MILLIMETER);
      doc.rect(0, 0, page.canvasWidth * pixelScale, (page.sourceBottom - page.sourceTop) * pixelScale).clip();
      doc.scale(pixelScale).translate(0, -page.sourceTop);
      const context = createVectorGraphicsContext(doc);
      for (const record of recording.records) {
        const pause = task.checkpoint();
        if (pause) await pause;
        if (textRuns.has(record)) {
          // Do not put an invisible copy of the entire CV on every page. Only
          // text whose actual painted bounds intersect this slice belongs here.
          if (vectorTextIntersectsPage(record, context.state, page)) drawText(context, record, textRuns.get(record));
        } else context.apply(record);
      }
      context.finish();
      doc.restore();
      for (const link of vectorPageLinks(links, canvas, page)) {
        doc.link(link.x * POINTS_PER_MILLIMETER, link.y * POINTS_PER_MILLIMETER,
          link.width * POINTS_PER_MILLIMETER, link.height * POINTS_PER_MILLIMETER, link.href);
      }
    }
    doc.end();
    return await task.wait(blob);
  } catch (error) {
    // Finish the output collector even when drawing or cancellation aborts.
    doc.emit('error', error);
    throw error;
  }
}
