import { transformCanvasPoint } from './pdfVectorGraphics.js';

export function vectorTextIntersectsPage(record, state, page) {
  const [, originX, y] = record.args;
  const metrics = record.metrics;
  const x = originX - (state.textAlign === 'center' ? metrics.width / 2
    : state.textAlign === 'right' || (state.textAlign === 'end' && state.direction !== 'rtl') ? metrics.width : 0);
  const ascent = metrics.actualBoundingBoxAscent ?? record.font.size;
  const descent = metrics.actualBoundingBoxDescent ?? 0;
  const points = [[x, y - ascent], [x + metrics.width, y - ascent], [x, y + descent], [x + metrics.width, y + descent]]
    .map(([left, top]) => transformCanvasPoint(state.matrix, left, top));
  return state.globalAlpha > 0
    && Math.max(...points.map((point) => point[0])) > 0
    && Math.min(...points.map((point) => point[0])) < page.canvasWidth
    && Math.max(...points.map((point) => point[1])) > page.sourceTop
    && Math.min(...points.map((point) => point[1])) < page.sourceBottom;
}
