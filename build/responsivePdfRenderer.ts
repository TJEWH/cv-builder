import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const canvasId = 'virtual:responsive-html2canvas';

function replaceOnce(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) {
    throw new Error(`PDF renderer dependency changed; review its cooperative scheduling adapter: ${before}`);
  }
  return source.replace(before, after);
}

/**
 * html2canvas 1.4.1 has synchronous DOM cloning/parsing and a microtask-only
 * painter. Retain its layout/paint coordinates but record vector commands,
 * adding checkpoints at node boundaries. Exact-match guards fail on incompatible
 * upgrades instead of silently shipping a blocking or incorrectly patched build.
 * The upstream source/license remains in the dependency, not a vendored copy.
 */
export function makeCanvasCooperative(source: string) {
  const change = (before: string, after: string) => { source = replaceOnce(source, before, after); };
  // SVG is emitted as SVG/PDF paths, so bitmap SVG capability probing is unused.
  change('var value = testSVG(document);', 'var value = true;');
  change('context = new Context(contextOptions, windowBounds);',
    'context = new Context(contextOptions, windowBounds); context.renderTask = opts.renderTask; context.createVectorContext = opts.createVectorContext;');
  // Retain the mature DOM/CSS painter, but replace its bitmap surface entirely.
  change("_this._activeEffects = [];\n        _this.canvas = options.canvas ? options.canvas : document.createElement('canvas');\n        _this.ctx = _this.canvas.getContext('2d');",
    '_this._activeEffects = [];\n        _this.canvas = { width: 0, height: 0, style: {} };\n        _this.ctx = context.createVectorContext(_this.canvas);');
  change('this.documentElement = this.cloneNode(element.ownerDocument.documentElement, false);',
    'this.ready = this.cloneNode(element.ownerDocument.documentElement, false).then(root => { this.documentElement = root; });');
  change('var iframe = createIFrameContainer(ownerDocument, windowSize);',
    'var iframe = createIFrameContainer(ownerDocument, windowSize); this.context.renderTask?.own(iframe);');
  change('var interval = setInterval(function () {', `var interval = setInterval(function () {
                if (!iframe.isConnected) {
                    clearInterval(interval);
                    reject(new DOMException('Render canceled', 'AbortError'));
                    return;
                }`);

  for (const method of ['appendChildNode', 'cloneChildNodes', 'cloneNode']) {
    change(`DocumentCloner.prototype.${method} = function (`, `DocumentCloner.prototype.${method} = async function (`);
  }
  change('clone.appendChild(this.cloneNode(child, copyStyles));', 'clone.appendChild(await this.cloneNode(child, copyStyles));');
  change('assignedNodes.forEach(function (assignedNode) { return _this.appendChildNode(clone, assignedNode, copyStyles); });',
    'for (const assignedNode of assignedNodes) { await this.appendChildNode(clone, assignedNode, copyStyles); }');
  change('this.appendChildNode(clone, child, copyStyles);', 'await this.appendChildNode(clone, child, copyStyles);');
  change('this.cloneChildNodes(node, clone, copyStyles);', 'await this.cloneChildNodes(node, clone, copyStyles);');
  change('DocumentCloner.prototype.cloneNode = async function (node, copyStyles) {',
    'DocumentCloner.prototype.cloneNode = async function (node, copyStyles) { const pause = this.context.renderTask?.checkpoint(); if (pause) await pause;');
  change(`clonedElement = documentCloner.clonedReferenceElement;
                if (!clonedElement) {
                    return [2 /*return*/, Promise.reject("Unable to find element in cloned iframe")];
                }
                return [4 /*yield*/, documentCloner.toIFrame(ownerDocument, windowBounds)];`,
  `return [4 /*yield*/, documentCloner.ready.then(function () {
                    clonedElement = documentCloner.clonedReferenceElement;
                    if (!clonedElement) throw new Error("Unable to find element in cloned iframe");
                    context.renderTask?.check();
                    return documentCloner.toIFrame(ownerDocument, windowBounds);
                })];`);

  // Retain the synchronous parser used inside html2canvas's iframe container;
  // the CV's main tree uses this otherwise identical asynchronous traversal.
  const nodeParser = source.slice(source.indexOf('var parseNodeTree ='), source.indexOf('var createContainer ='));
  const treeParser = source.slice(source.indexOf('var parseTree ='), source.indexOf('var createsRealStackingContext ='));
  let asyncParser = (nodeParser + treeParser)
    .replaceAll('parseNodeTree', 'parseNodeTreeAsync')
    .replaceAll('parseTree', 'parseTreeAsync')
    .replaceAll('= function (', '= async function (');
  asyncParser = replaceOnce(asyncParser,
    'childNode.assignedNodes().forEach(function (childNode) { return parseNodeTreeAsync(context, childNode, parent, root); });',
    'for (const assignedNode of childNode.assignedNodes()) { await parseNodeTreeAsync(context, assignedNode, parent, root); }');
  asyncParser = asyncParser.replaceAll('        parseNodeTreeAsync(', '        await parseNodeTreeAsync(')
    .replace('    parseNodeTreeAsync(context, element', '    await parseNodeTreeAsync(context, element');
  asyncParser = replaceOnce(asyncParser, 'nextNode = childNode.nextSibling;',
    'const pause = context.renderTask?.checkpoint(); if (pause) await pause; nextNode = childNode.nextSibling;');
  change('var createContainer =', `${asyncParser}\nvar createContainer =`);
  change('root = parseTree(context, clonedElement);',
    'return [4 /*yield*/, parseTreeAsync(context, clonedElement).then(function (root) {');
  change('return [4 /*yield*/, renderer.render(root)];', 'return renderer.render(root); })];');

  // These upstream painting methods already await their children. Yielding here
  // preserves paint order, clipping and canvas save/restore state exactly.
  const paintCheckpoints = `
['renderStack', 'renderNodeContent', 'renderNodeBackgroundAndBorders'].forEach(function (name) {
    const original = CanvasRenderer.prototype[name];
    CanvasRenderer.prototype[name] = async function (...args) {
        const pause = this.context.renderTask?.checkpoint();
        if (pause) await pause;
        return original.apply(this, args);
    };
});
`;
  change('var parseBackgroundColor =', `${paintCheckpoints}\nvar parseBackgroundColor =`);
  return source;
}

export default function responsivePdfRenderer() {
  return {
    name: 'responsive-pdf-renderer',
    enforce: 'pre' as const,
    resolveId(id: string) { if (id === canvasId) return `\0${canvasId}`; },
    load(id: string) {
      if (id === `\0${canvasId}`) {
        return makeCanvasCooperative(readFileSync(require.resolve('html2canvas/dist/html2canvas.esm.js'), 'utf8'));
      }
    },
  };
}
