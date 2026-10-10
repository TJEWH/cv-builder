import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';

interface Setup {
  confirmingClear: boolean;
  requestClear(): void;
  cancelClear(): void;
  confirmClear(): void;
}
const filename = new URL('../src/components/RefinementHistory.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'refinement-history-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), componentExports);
const component = { ...componentExports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
  setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext) {
  const props = reactive({ requests: [], proposals: [], localRequests: {}, currentRequestId: null,
    activeId: '', reviewActive: false, accepted: false, canReset: true, canClear: true,
    publicationStatus: 'current' as const, lang: 'en', busy: false, open: true });
  let cleared = 0;
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, {
    ...props, onClear: () => { cleared++; }, ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount({}); t.after(() => app.unmount());
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, cleared: () => cleared };
}

test('clearing history requires confirmation and cancellation preserves history', t => {
  const { setup, cleared } = mount(t);
  setup.confirmClear();
  assert.equal(cleared(), 0);
  setup.requestClear();
  assert.equal(setup.confirmingClear, true);
  assert.equal(cleared(), 0);
  setup.cancelClear();
  assert.equal(setup.confirmingClear, false);
  assert.equal(cleared(), 0);
  setup.requestClear();
  setup.confirmClear();
  assert.equal(setup.confirmingClear, false);
  assert.equal(cleared(), 1);
  setup.confirmClear();
  assert.equal(cleared(), 1);
});

test('busy history cannot be cleared, including after opening confirmation', async t => {
  const { props, setup, cleared } = mount(t);
  setup.requestClear();
  props.busy = true;
  await nextTick();
  assert.equal(setup.confirmingClear, false);
  setup.requestClear();
  assert.equal(setup.confirmingClear, false);
  setup.confirmClear();
  assert.equal(cleared(), 0);
});

test('unavailable history cannot be cleared, including after opening confirmation', async t => {
  const { props, setup, cleared } = mount(t);
  setup.requestClear();
  props.canClear = false;
  await nextTick();
  assert.equal(setup.confirmingClear, false);
  setup.requestClear();
  assert.equal(setup.confirmingClear, false);
  setup.confirmClear();
  assert.equal(cleared(), 0);
});
