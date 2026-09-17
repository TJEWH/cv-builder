import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const canvasId = 'virtual:responsive-html2canvas';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`PDF renderer dependency changed; review its cooperative scheduling adapter: ${before}`);
  }
  return source.replace(before, after);
}

/**
 * html2canvas 1.4.1 has synchronous DOM cloning/parsing and a microtask-only
 * painter. Keep its rendering/layout algorithms intact, adding checkpoints at
 * node boundaries. Exact-match guards and tests deliberately fail on incompatible
 * upgrades instead of silently shipping a blocking or incorrectly patched build.
 * The upstream source/license remains in the dependency, not a vendored copy.
 */
export function makeCanvasCooperative(source) {
  const change = (before, after) => { source = replaceOnce(source, before, after); };
  change('context = new Context(contextOptions, windowBounds);',
    'context = new Context(contextOptions, windowBounds); context.renderTask = opts.renderTask;');
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

export function makePagebreaksCooperative(source) {
  source = replaceOnce(source, 'function toContainer_pagebreak()', 'async function toContainer_pagebreak()');
  source = replaceOnce(source, 'Array.prototype.forEach.call(els, function pagebreak_loop(el) {',
    'for (const el of els) { const pause = this.opt.renderTask?.checkpoint(); if (pause) await pause;');
  return replaceOnce(source, '    });\n  });\n};', '    }\n  });\n};');
}

export default function responsivePdfRenderer() {
  return {
    name: 'responsive-pdf-renderer',
    enforce: 'pre',
    resolveId(id) { if (id === canvasId) return `\0${canvasId}`; },
    load(id) {
      if (id === `\0${canvasId}`) {
        return makeCanvasCooperative(readFileSync(require.resolve('html2canvas/dist/html2canvas.esm.js'), 'utf8'));
      }
    },
    transform(source, id) {
      // Vite adds version queries to excluded dependencies during development.
      id = id.split('?')[0];
      if (id.endsWith('/html2pdf.js/src/worker.js')) {
        source = replaceOnce(source, "from 'html2canvas'", `from '${canvasId}'`);
        source = replaceOnce(source, 'document.body.appendChild(this.prop.overlay);',
          'this.prop.overlay.inert = true; document.body.appendChild(this.prop.overlay); this.opt.renderTask?.own(this.prop.overlay);');
        source = replaceOnce(source, 'document.body.removeChild(this.prop.overlay);', 'this.prop.overlay.remove();');
        return replaceOnce(source, "position: 'fixed', overflow: 'hidden', zIndex: 1000,",
          "position: 'fixed', overflow: 'hidden', zIndex: 1000, pointerEvents: 'none',");
      }
      if (id.endsWith('/html2pdf.js/src/plugin/pagebreaks.js')) return makePagebreaksCooperative(source);
    },
  };
}
