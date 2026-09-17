import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import responsivePdfRenderer, { makeCanvasCooperative, makePagebreaksCooperative } from '../build/responsivePdfRenderer.js';

const require = createRequire(import.meta.url);
const canvas = readFileSync(require.resolve('html2canvas/dist/html2canvas.esm.js'), 'utf8');
const pagebreaks = readFileSync(require.resolve('html2pdf.js/src/plugin/pagebreaks.js'), 'utf8');

test('the installed canvas renderer supports the guarded scheduling adapter', () => {
  const transformed = makeCanvasCooperative(canvas);
  assert.doesNotThrow(() => new Function(transformed.replace('export default html2canvas;', '')));
  assert.match(transformed, /await parseNodeTreeAsync\(context, childNode, container, root\)/);
  assert.match(transformed, /await this\.cloneChildNodes\(node, clone, copyStyles\)/);
  assert.match(transformed, /context\.renderTask\?\.own\(iframe\)/);
});

test('page-break placement can yield without changing its placement rules', () => {
  const transformed = makePagebreaksCooperative(pagebreaks);
  assert.doesNotThrow(() => new Function(transformed.replace(/^import .*;$/gm, '')));
  assert.match(transformed, /async function toContainer_pagebreak/);
  assert.match(transformed, /this\.opt\.renderTask\?\.checkpoint\(\)/);
  assert.match(transformed, /endPage !== startPage && nPages <= 1/);
});

test('incompatible dependency updates fail loudly instead of disabling cancellation', () => {
  assert.throws(() => makeCanvasCooperative(canvas.replace('this.documentElement = this.cloneNode', 'this.root = this.cloneNode')), /dependency changed/);
  assert.throws(() => makePagebreaksCooperative(pagebreaks.replace('pagebreak_loop', 'new_loop')), /dependency changed/);
});

test('development cache queries still get the cooperative renderer and non-intercepting overlay', () => {
  const path = require.resolve('html2pdf.js/src/worker.js');
  const worker = readFileSync(path, 'utf8');
  const plugin = responsivePdfRenderer();
  const production = plugin.transform(worker, path);
  assert.equal(plugin.transform(worker, `${path}?v=dev-cache`), production);
  assert.match(production, /pointerEvents: 'none'/);
  assert.match(production, /from 'virtual:responsive-html2canvas'/);
});
