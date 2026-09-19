import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';

const filename = new URL('../src/components/PdfPreview.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'pdf-preview-gestures', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), exports);

type HostNode = { tag?: string; props: Record<string, unknown> };
type TouchPoint = { identifier: number; clientX: number; clientY: number };
const point = (x: number, y = 100, id = 1): TouchPoint => ({ identifier: id, clientX: x, clientY: y });

function mountPreview({ total = 3, enabled = true } = {}) {
  let section: HostNode;
  const renderer = createRenderer<HostNode, HostNode>({
    createElement(tag) {
      const node = { tag, props: {} };
      if (tag === 'section') section = node;
      return node;
    },
    createText: () => ({ props: {} }), createComment: () => ({ props: {} }),
    insert() {}, remove() {}, setText() {}, setElementText() {},
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    parentNode: () => null, nextSibling: () => null,
  });
  const changes: number[] = [];
  const props = reactive({
    pages: Array.from({ length: total }, () => ({ svg: '<svg />' })),
    page: 1, lang: 'en', gestureNavigation: enabled,
    'onUpdate:page': (page: number) => { changes.push(page); props.page = page; },
  });
  const app = renderer.createApp({ render: () => h(exports.default!, { ...props }) });
  app.mount({ props: {} });

  function touch(type: 'start' | 'move' | 'end' | 'cancel', points: TouchPoint[]) {
    const event = {
      touches: type === 'end' || type === 'cancel' ? [] : points,
      changedTouches: points, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    const key = type === 'start' ? 'onTouchstartPassive' : `onTouch${type}`;
    (section!.props[key] as (event: unknown) => void)(event);
    return event;
  }
  async function swipe(from: TouchPoint, to: TouchPoint) {
    touch('start', [from]);
    touch('move', [to]);
    const event = touch('end', [to]);
    await nextTick();
    return event;
  }
  return { props, changes, touch, swipe, unmount: () => app.unmount() };
}

test('one-finger swipes turn one page in each direction and stop at either boundary', async (t) => {
  const preview = mountPreview();
  t.after(preview.unmount);
  await preview.swipe(point(300), point(40));
  assert.equal(preview.props.page, 2);
  await preview.swipe(point(300), point(40));
  assert.equal(preview.props.page, 3);
  await preview.swipe(point(300), point(40));
  assert.deepEqual(preview.changes, [2, 3]);
  await preview.swipe(point(40), point(300));
  await preview.swipe(point(40), point(300));
  await preview.swipe(point(40), point(300));
  assert.deepEqual(preview.changes, [2, 3, 2, 1]);
});

test('taps and vertical gestures preserve links and scrolling; page swipes suppress clicks', async (t) => {
  const preview = mountPreview();
  t.after(preview.unmount);
  assert.equal((await preview.swipe(point(100), point(102))).defaultPrevented, false);
  assert.equal((await preview.swipe(point(100, 100), point(160, 300))).defaultPrevented, false);
  assert.deepEqual(preview.changes, []);
  preview.touch('start', [point(300)]);
  assert.equal(preview.touch('move', [point(100)]).defaultPrevented, true);
  assert.equal(preview.touch('end', [point(100)]).defaultPrevented, true);
  await nextTick();
  assert.deepEqual(preview.changes, [2]);
  preview.touch('end', [point(100)]);
  assert.deepEqual(preview.changes, [2], 'a completed gesture cannot turn a second page');
});

test('multi-touch, cancelled touches, and an unrelated finger never turn pages', async (t) => {
  const preview = mountPreview();
  t.after(preview.unmount);
  preview.touch('start', [point(300)]);
  preview.touch('start', [point(300), point(200, 100, 2)]);
  preview.touch('move', [point(100)]);
  preview.touch('end', [point(100)]);
  preview.touch('start', [point(300)]);
  preview.touch('move', [point(200), point(150, 100, 2)]);
  preview.touch('end', [point(100)]);
  preview.touch('start', [point(300)]);
  preview.touch('cancel', [point(200)]);
  preview.touch('end', [point(100)]);
  await preview.swipe(point(300), point(100, 100, 2));
  assert.deepEqual(preview.changes, []);
});

test('single-page previews and disabled gesture navigation leave touches alone', async (t) => {
  for (const options of [{ total: 1 }, { total: 0 }, { enabled: false }]) {
    const preview = mountPreview(options);
    t.after(preview.unmount);
    const event = await preview.swipe(point(300), point(100));
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(preview.changes, []);
  }
});
