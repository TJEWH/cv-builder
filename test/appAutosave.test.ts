import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, nextTick, ref } from 'vue';
import type { Component } from 'vue';
import type { CvState, SaveStatus } from '../src/types';

const filename = new URL('../src/App.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'app-autosave-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromApp = createRequire(filename);
new Function('require', 'exports', code)((path: string) => {
  if (path.endsWith('.vue')) return { default: {} };
  if (path.endsWith('/useSupabaseAuth')) return { useSupabaseAuth: () => ({ user: ref(null), client: null }) };
  if (path.endsWith('/useCvDesign')) return { useCvDesign() {} };
  if (path.endsWith('/usePdfExport')) return { usePdfExport: () => ({ exportToPdf() {}, renderPreview: async () => [], revokeDownloads() {} }) };
  return requireFromApp(path);
}, exports);
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

test('CV Studio reports pending edits immediately, updates the saved time, and flushes the final edit before leaving', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 8, 20, 12, 0, 0) });
  const listeners = new Map<string, () => void>();
  const storage = new Map<string, string>();
  class ElementStub { matches(selector: string) { return selector === 'input[type="range"]'; } }
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    sessionStorage: { getItem: () => null, setItem() {} },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
      removeEventListener: (event: string) => listeners.delete(event),
    },
    document: { activeElement: null },
    Element: ElementStub,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  let saved = true;
  const snapshots: CvState[] = [];
  const app = renderer.createApp(component);
  const instance = app.mount({}) as unknown as { $: { setupState: {
    state: CvState; saveStatus: SaveStatus; saveStatusLabel: string;
    backupManager: unknown; onPreviewSliderPointerDown(event: PointerEvent): void;
  } } };
  const setup = instance.$.setupState;
  setup.backupManager = { saveCurrent: () => { snapshots.push(JSON.parse(JSON.stringify(setup.state))); return saved; } };
  try {
    setup.state.contact.name = 'A pending edit';
    assert.equal(setup.saveStatus, 'saving', 'status must change before Vue renders the next frame');
    t.mock.timers.tick(250);
    await nextTick();
    assert.equal(setup.saveStatus, 'saved');
    const firstLabel = setup.saveStatusLabel;

    t.mock.timers.tick(1000);
    setup.state.contact.name = 'The final edit before navigation';
    listeners.get('pagehide')!();
    assert.equal(snapshots.at(-1)?.contact.name, 'The final edit before navigation');
    assert.equal(setup.saveStatus, 'saved');
    assert.notEqual(setup.saveStatusLabel, firstLabel, 'successful saves update the visible save time');

    setup.onPreviewSliderPointerDown({ target: new ElementStub() } as unknown as PointerEvent);
    setup.state.design.h1 = '44px';
    const beforeRelease = snapshots.length;
    t.mock.timers.tick(300);
    assert.equal(snapshots.length, beforeRelease, 'slider editing remains deferred during the drag');
    assert.equal(setup.saveStatus, 'saving');
    listeners.get('blur')!();
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'saved', 'losing the window during a drag must not leave Saving stuck');
    assert.equal(snapshots.at(-1)?.design.h1, '44px');

    saved = false;
    setup.state.contact.name = 'Cannot be persisted';
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'error');
    saved = true;
    setup.state.contact.name = 'Recovered';
    t.mock.timers.tick(250);
    assert.equal(setup.saveStatus, 'saved');
  } finally {
    app.unmount();
  }
});
