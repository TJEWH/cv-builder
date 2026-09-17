import SVGtoPDF from 'svg-to-pdfkit';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const TAU = Math.PI * 2;

export function multiplyCanvasMatrices(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function transformCanvasPoint(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function inverseMatrix([a, b, c, d, e, f]) {
  const determinant = a * d - b * c;
  return determinant ? [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant] : null;
}

export function parseCanvasColor(value) {
  if (typeof value !== 'string') throw new Error('Vector export does not support canvas gradients or patterns.');
  if (value === 'transparent') return { color: '#000000', opacity: 0 };
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return { color: value || '#000000', opacity: 1 };
  const channels = rgb[1].trim().split(/[\s,/]+/);
  return {
    color: channels.slice(0, 3).map((channel) => channel.endsWith('%') ? parseFloat(channel) * 255 / 100 : parseFloat(channel)),
    opacity: channels[3] === undefined ? 1 : parseFloat(channels[3]) / (channels[3].endsWith('%') ? 100 : 1),
  };
}

function svgSource(source) {
  if (!/^data:image\/svg\+xml[;,]/i.test(source)) return null;
  const comma = source.indexOf(',');
  return /;base64/i.test(source.slice(0, comma))
    ? new TextDecoder().decode(Uint8Array.from(atob(source.slice(comma + 1)), (character) => character.charCodeAt(0)))
    : decodeURIComponent(source.slice(comma + 1));
}

function svgRootMargins(svg) {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const style = root.match(/\sstyle\s*=\s*(['"])([\s\S]*?)\1/i)?.[2] || '';
  const margins = [0, 0];
  // CSSStyleDeclaration serializes the copied longhands as a shorthand when
  // possible, even though reading style.marginLeft still returns the longhand.
  for (const [, name, value] of style.matchAll(/(?:^|;)\s*(margin(?:-left|-top)?)\s*:\s*([^;]*)/gi)) {
    const parts = value.replace(/\s*!important\s*$/i, '').trim().split(/\s+/);
    if (!parts.every((part) => /^-?(?:\d*\.)?\d+(?:px)?$/i.test(part))) continue;
    const values = parts.map(Number.parseFloat);
    if (name.toLowerCase() === 'margin') {
      if (values.length > 4) continue;
      margins[0] = values[values.length === 4 ? 3 : values.length > 1 ? 1 : 0];
      margins[1] = values[0];
    } else if (values.length === 1) margins[name.toLowerCase() === 'margin-left' ? 0 : 1] = values[0];
  }
  return margins;
}

/** Replay canvas painting commands without turning the page into an image. */
export function createVectorGraphicsContext(doc) {
  let state = {
    matrix: [...IDENTITY], fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1,
    font: '10px sans-serif', textBaseline: 'alphabetic', textAlign: 'start', direction: 'inherit',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDash: [], lineDashOffset: 0,
    globalCompositeOperation: 'source-over',
  };
  const stack = [];
  let path = [];
  let currentPoint;
  let subpathStart;

  function pathCommand(method, coordinates = []) {
    const points = [];
    for (let index = 0; index < coordinates.length; index += 2) {
      points.push(...transformCanvasPoint(state.matrix, coordinates[index], coordinates[index + 1]));
    }
    path.push({ method, args: points });
    if (points.length) currentPoint = points.slice(-2);
    if (method === 'moveTo') subpathStart = currentPoint;
    if (method === 'closePath') currentPoint = subpathStart;
  }

  function replayPath(matrix = IDENTITY) {
    for (const command of path) {
      const points = [];
      for (let index = 0; index < command.args.length; index += 2) {
        points.push(...transformCanvasPoint(matrix, command.args[index], command.args[index + 1]));
      }
      doc[command.method](...points);
    }
  }

  function withPaint(callback, { stroke = false } = {}) {
    if (!inverseMatrix(state.matrix)) return;
    if (state.globalCompositeOperation !== 'source-over') throw new Error('Unsupported vector compositing mode.');
    const fill = parseCanvasColor(state.fillStyle);
    const outline = parseCanvasColor(state.strokeStyle);
    doc.save();
    try {
      doc.transform(...state.matrix);
      doc.fillColor(fill.color).fillOpacity(fill.opacity * state.globalAlpha);
      doc.strokeColor(outline.color).strokeOpacity(outline.opacity * state.globalAlpha);
      if (stroke) {
        doc.lineWidth(state.lineWidth).lineCap(state.lineCap).lineJoin(state.lineJoin).miterLimit(state.miterLimit);
        // PDF permits zero-length dashes (round dots); PDFKit's dash helper does not.
        doc.addContent(`[${state.lineDash.join(' ')}] ${state.lineDashOffset} d`);
      }
      return callback(doc, state);
    } finally {
      doc.restore();
    }
  }

  function paintPath(stroke, rule) {
    const inverse = inverseMatrix(state.matrix);
    if (!inverse) return;
    withPaint(() => {
      replayPath(inverse);
      if (stroke) doc.stroke();
      else doc.fill(rule === 'evenodd' ? 'even-odd' : 'non-zero');
    }, { stroke });
  }

  function ellipse(x, y, radiusX, radiusY, rotation, start, end, anticlockwise = false) {
    if (radiusX < 0 || radiusY < 0) throw new Error('Canvas ellipse radius must not be negative.');
    let sweep = end - start;
    if (!anticlockwise && sweep >= TAU) sweep = TAU;
    else if (anticlockwise && sweep <= -TAU) sweep = -TAU;
    else sweep = anticlockwise ? -((-sweep % TAU + TAU) % TAU) : (sweep % TAU + TAU) % TAU;
    const point = (angle) => [
      x + radiusX * Math.cos(angle) * Math.cos(rotation) - radiusY * Math.sin(angle) * Math.sin(rotation),
      y + radiusX * Math.cos(angle) * Math.sin(rotation) + radiusY * Math.sin(angle) * Math.cos(rotation),
    ];
    const derivative = (angle) => [
      -radiusX * Math.sin(angle) * Math.cos(rotation) - radiusY * Math.cos(angle) * Math.sin(rotation),
      -radiusX * Math.sin(angle) * Math.sin(rotation) + radiusY * Math.cos(angle) * Math.cos(rotation),
    ];
    pathCommand(currentPoint ? 'lineTo' : 'moveTo', point(start));
    const steps = Math.ceil(Math.abs(sweep) / (Math.PI / 2));
    for (let index = 0; index < steps; index += 1) {
      const a = start + sweep * index / steps;
      const b = start + sweep * (index + 1) / steps;
      const k = 4 / 3 * Math.tan((b - a) / 4);
      const p = point(a), q = point(b), u = derivative(a), v = derivative(b);
      pathCommand('bezierCurveTo', [p[0] + k * u[0], p[1] + k * u[1], q[0] - k * v[0], q[1] - k * v[1], ...q]);
    }
  }

  function drawImage(image, ...coordinates) {
    const source = image.currentSrc || image.src || image.toDataURL?.();
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    let sx = 0, sy = 0, sw = width, sh = height, dx, dy, dw = width, dh = height;
    if (coordinates.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = coordinates;
    else if (coordinates.length === 4) [dx, dy, dw, dh] = coordinates;
    else if (coordinates.length === 2) [dx, dy] = coordinates;
    else throw new Error('Unsupported vector drawImage arguments.');
    if (!source || !width || !height) throw new Error('Vector export could not read an image.');
    if (!sw || !sh || !dw || !dh) return;
    const svg = svgSource(source);
    if (!svg && !/^data:image\/(png|jpeg);/i.test(source)) {
      throw new Error('Vector export supports SVG, PNG and JPEG images only.');
    }
    withPaint(() => {
      doc.rect(dx, dy, dw, dh).clip();
      doc.translate(dx - sx * dw / sw, dy - sy * dh / sh).scale(dw / sw, dh / sh);
      if (svg) {
        // html2canvas copies computed margins onto its SVG image root. Native
        // drawImage offsets that viewport inside the image's unchanged crop.
        // SVG-to-PDFKit ignores root CSS margins, so replay that offset here.
        doc.translate(...svgRootMargins(svg));
        SVGtoPDF(doc, svg, 0, 0, {
          width, height, assumePt: true,
          colorCallback: (color) => [color[0], color[1] * state.globalAlpha],
          warningCallback: (warning) => { throw new Error(`Vector SVG export: ${warning}`); },
        });
      } else doc.image(source, 0, 0, { width, height });
    });
  }

  function apply(record) {
    if (record.type === 'set') {
      state[record.property] = record.value;
      return;
    }
    const args = record.args || [];
    switch (record.method) {
      case 'save':
        stack.push({ ...state, matrix: [...state.matrix], lineDash: [...state.lineDash] });
        doc.save();
        break;
      case 'restore':
        if (stack.length) { state = stack.pop(); doc.restore(); }
        break;
      case 'beginPath': path = []; currentPoint = undefined; subpathStart = undefined; break;
      case 'moveTo': case 'lineTo': case 'bezierCurveTo': case 'closePath': pathCommand(record.method, args); break;
      case 'quadraticCurveTo': {
        const control = transformCanvasPoint(state.matrix, args[0], args[1]);
        const end = transformCanvasPoint(state.matrix, args[2], args[3]);
        if (!currentPoint) pathCommand('moveTo', args.slice(0, 2));
        path.push({ method: 'bezierCurveTo', args: [
          currentPoint[0] + (control[0] - currentPoint[0]) * 2 / 3,
          currentPoint[1] + (control[1] - currentPoint[1]) * 2 / 3,
          end[0] + (control[0] - end[0]) * 2 / 3, end[1] + (control[1] - end[1]) * 2 / 3, ...end,
        ] });
        currentPoint = end;
        break;
      }
      case 'rect': {
        const [x, y, width, height] = args;
        pathCommand('moveTo', [x, y]); pathCommand('lineTo', [x + width, y]);
        pathCommand('lineTo', [x + width, y + height]); pathCommand('lineTo', [x, y + height]);
        pathCommand('closePath');
        break;
      }
      case 'arc': ellipse(args[0], args[1], args[2], args[2], 0, args[3], args[4], args[5]); break;
      case 'ellipse': ellipse(...args); break;
      case 'fill': paintPath(false, args[0]); break;
      case 'stroke': paintPath(true); break;
      case 'clip': replayPath(); doc.clip(args[0] === 'evenodd' ? 'even-odd' : 'non-zero'); break;
      case 'fillRect': case 'strokeRect':
        withPaint(() => {
          doc.rect(...args);
          if (record.method === 'strokeRect') doc.stroke(); else doc.fill();
        }, { stroke: record.method === 'strokeRect' });
        break;
      case 'transform': state.matrix = multiplyCanvasMatrices(state.matrix, args); break;
      case 'setTransform':
        state.matrix = args.length === 1 ? ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => args[0][key]) : [...args];
        break;
      case 'resetTransform': state.matrix = [...IDENTITY]; break;
      case 'translate': state.matrix = multiplyCanvasMatrices(state.matrix, [1, 0, 0, 1, ...args]); break;
      case 'scale': state.matrix = multiplyCanvasMatrices(state.matrix, [args[0], 0, 0, args[1], 0, 0]); break;
      case 'rotate': {
        const cosine = Math.cos(args[0]), sine = Math.sin(args[0]);
        state.matrix = multiplyCanvasMatrices(state.matrix, [cosine, sine, -sine, cosine, 0, 0]);
        break;
      }
      case 'setLineDash': state.lineDash = args[0].length % 2 ? [...args[0], ...args[0]] : [...args[0]]; break;
      case 'drawImage': drawImage(...args); break;
      // Text is drawn separately with the document's embedded font resolver.
      case 'fillText': case 'strokeText': case 'measureText': break;
      default: throw new Error(`Unsupported vector canvas operation: ${record.method}`);
    }
  }

  function finish() {
    // A discarded or interrupted canvas may retain effects; never let their
    // clipping or transforms escape into the document's next page or links.
    while (stack.length) {
      state = stack.pop();
      doc.restore();
    }
  }

  return { apply, withPaint, finish, get state() { return state; } };
}
