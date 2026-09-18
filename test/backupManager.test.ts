import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { CvState, SavedConfiguration } from '../src/types';
import { createEmptyDocument, createSampleDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID } from '../src/composables/builtinConfigurations';
import { createNormalizedContentState } from '../src/composables/contentLayout';

const filename = new URL('../src/components/BackupManager.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'backup-manager-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), exports);
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

test('empty template cannot be saved over; successful Save as unlocks a separate named document', async (t) => {
  const storage = new Map<string, string>();
  let failActiveWrite = false;
  t.mock.method(console, 'warn', () => {});
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failActiveWrite && key === 'CV_CONF_ACTIVE_ID') throw new Error('Storage full');
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const sampleApp = renderer.createApp(component, {
    state: createNormalizedContentState(createSampleDocument()), selectedId: SAMPLE_DOCUMENT_ID, lang: 'en',
  });
  const sampleInstance = sampleApp.mount({}) as unknown as { saveCurrent(): boolean };
  assert.equal(sampleInstance.saveCurrent(), true);
  assert.equal(storage.size, 0, 'the bundled sample must not be seeded into local storage');
  sampleApp.unmount();
  const props = reactive({
    state: createEmptyDocument(), selectedId: EMPTY_DOCUMENT_ID, lang: 'en',
    'onUpdate:selectedId': (id: string) => { props.selectedId = id; },
  });
  const app = renderer.createApp(component, props);
  const instance = app.mount({}) as unknown as {
    saveCurrent(): boolean; saveVersion(id: string, data: CvState): boolean;
    readConfigData(id: string): CvState;
    $: { setupState: { newName: string; saveAs(): void; deleteCurrent(): void; configs: SavedConfiguration[] } };
  };
  t.after(() => app.unmount());
  const setup = instance.$.setupState;
  assert.equal(instance.saveCurrent(), true);
  assert.equal(instance.saveVersion(EMPTY_DOCUMENT_ID, createEmptyDocument()), false);
  setup.deleteCurrent();
  assert.equal(storage.size, 0);
  setup.newName = '  ';
  setup.saveAs();
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID);

  failActiveWrite = true;
  setup.newName = 'My CV';
  setup.saveAs();
  await nextTick();
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID, 'failed activation must leave editing locked');

  failActiveWrite = false;
  setup.saveAs();
  await nextTick();
  assert.notEqual(props.selectedId, EMPTY_DOCUMENT_ID);
  assert.equal(storage.get('CV_CONF_ACTIVE_ID'), props.selectedId);
  assert.equal(instance.readConfigData(props.selectedId).contact.name, '');
  assert.ok(setup.configs.some(({ id }) => id === EMPTY_DOCUMENT_ID));
  assert.equal(storage.has(`CV_CONF_DATA:${EMPTY_DOCUMENT_ID}`), false);
});
