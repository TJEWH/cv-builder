const recordedMethods = new Set([
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
  'rect', 'roundRect', 'arc', 'arcTo', 'ellipse', 'fill', 'stroke', 'clip',
  'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'fillText', 'strokeText',
  'setLineDash', 'putImageData', 'reset',
]);
const recordedTextMetrics = [
  'width', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
];
const stateMethods = new Set(['save', 'restore', 'setLineDash']);

function fontDescriptor(font, declaration) {
  if (declaration) declaration.font = font;
  // Canvas normalizes font sizes to pixels. The fallback also lets recordings
  // from an OffscreenCanvas work without a document/CSSStyleDeclaration.
  const match = /^(.*?)\b([\d.]+)px(?:\s*\/\s*\S+)?\s+(.+)$/.exec(font);
  const prefix = match?.[1] || '';
  const weight = declaration?.fontWeight || /\b([1-9]\d{0,2}|bold)\b/.exec(prefix)?.[1] || 'normal';
  return Object.freeze({
    family: declaration?.fontFamily || match?.[3] || 'sans-serif',
    size: Number.parseFloat(declaration?.fontSize || match?.[2]) || 10,
    weight: weight === 'bold' ? 700 : Number.parseFloat(weight) || 400,
    style: declaration?.fontStyle || /\b(italic|oblique)\b/.exec(prefix)?.[1] || 'normal',
  });
}

/**
 * Record paint commands without executing any raster drawing. A tiny native
 * context is used only for CSS state normalization and browser font metrics.
 */
export function createPdfCanvasRecording() {
  const records = [];
  const fonts = new Map();
  const wrappedContexts = new WeakMap();

  function wrap(context, canvas = context.canvas) {
    const existing = wrappedContexts.get(context);
    if (existing) return existing;
    const declaration = canvas?.ownerDocument?.createElement('span').style;
    const methods = new Map();

    const proxy = new Proxy(context, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const cached = methods.get(property);
        if (cached?.original === value) return cached.bound;

        const bound = recordedMethods.has(property)
          ? (...args) => {
            const result = stateMethods.has(property) ? Reflect.apply(value, target, args) : undefined;
            const record = {
              type: 'call',
              method: property,
              // Preserve image/Path2D identities while snapshotting mutable
              // argument arrays such as line dashes and roundRect radii.
              args: args.map((argument) => Array.isArray(argument) ? [...argument] : argument),
            };
            if (property === 'fillText' || property === 'strokeText') {
              if (!fonts.has(target.font)) fonts.set(target.font, fontDescriptor(target.font, declaration));
              record.font = fonts.get(target.font);
              record.fontString = target.font;
              const metrics = target.measureText(args[0]);
              record.metrics = Object.fromEntries(recordedTextMetrics.map((name) => [name, metrics[name]]));
            }
            records.push(record);
            return result;
          }
          : value.bind(target);
        methods.set(property, { original: value, bound });
        return bound;
      },
      set(target, property, value) {
        const updated = Reflect.set(target, property, value, target);
        if (updated && typeof property === 'string') {
          // Canvas ignores invalid assignments and normalizes colors/fonts.
          // Record the value it actually accepted, not the requested value.
          records.push({ type: 'set', property, value: Reflect.get(target, property, target) });
        }
        return updated;
      },
    });
    wrappedContexts.set(context, proxy);
    return proxy;
  }

  function createContext(surface, documentRef = document) {
    const measurement = documentRef.createElement('canvas');
    measurement.width = measurement.height = 1;
    const context = measurement.getContext('2d');
    if (!context) throw new Error('Browser font measurement is unavailable');
    return wrap(context, { ...surface, ownerDocument: documentRef });
  }

  return { records, createContext, wrap };
}
