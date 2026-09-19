import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { TestContext } from 'node:test';
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

test('switching versions never asks for confirmation', async (t) => {
  const storage = new Map<string, string>();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousConfirm = Object.getOwnPropertyDescriptor(globalThis, 'confirm');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: () => { throw new Error('Version switching must not prompt'); } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (previousConfirm) Object.defineProperty(globalThis, 'confirm', previousConfirm);
    else Reflect.deleteProperty(globalThis, 'confirm');
  });

  let loaded: CvState | null = null;
  const props = reactive({
    state: createNormalizedContentState(createSampleDocument()), selectedId: SAMPLE_DOCUMENT_ID, lang: 'en',
    onLoad: (data: CvState) => { loaded = data; },
    'onUpdate:selectedId': (id: string) => { props.selectedId = id; },
  });
  const app = renderer.createApp(component, props);
  const instance = app.mount({}) as unknown as { selectConfiguration(id: string): boolean };
  t.after(() => app.unmount());

  assert.equal(instance.selectConfiguration(EMPTY_DOCUMENT_ID), true);
  await nextTick();
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID);
  assert.equal((loaded as CvState | null)?.contact.name, '');
});

function savedVersionFixture(t: TestContext) {
  const state = createSampleDocument();
  state.contact.name = 'Private Person';
  const storage = new Map([
    ['CV_CONF_INDEX', JSON.stringify([{ id: 'target', name: 'Engineering 2026' }, { id: 'other', name: 'Other version' }])],
    ['CV_CONF_DATA:target', JSON.stringify({ __meta: { id: 'target' }, data: state })],
    ['CV_CONF_DATA:other', JSON.stringify({ __meta: { id: 'other' }, data: createEmptyDocument() })],
    ['CV_CONF_ACTIVE_ID', 'target'],
    ['cv-session', JSON.stringify(state)],
  ]);
  function global(name: string, value: unknown) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  global('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  global('confirm', () => true);
  const deleted: string[] = [];
  const props = reactive({
    state, selectedId: 'target', lang: 'en',
    onLoad: (data: CvState) => { props.state = data; },
    'onUpdate:selectedId': (id: string) => { props.selectedId = id; },
    onVersionDeleted: (id: string) => deleted.push(id),
  });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({});
  const instance = mounted as {
    saveCurrent(): boolean; saveVersion(id: string, data: CvState): boolean;
    restoreActiveConfig(): CvState | null;
    $: { setupState: { deleteCurrent(): void; exportJson(): void; onStorageChange(event: StorageEvent): void } };
  };
  t.after(() => app.unmount());
  return { storage, props, instance, setup: instance.$.setupState, deleted, global };
}

test('deletion removes persisted data and the recovery copy, opens empty state, and cannot autosave the old version', async (t) => {
  const { storage, props, instance, setup, deleted } = savedVersionFixture(t);
  const original = storage.get('CV_CONF_DATA:other');
  setup.deleteCurrent();
  await nextTick();
  assert.equal(storage.has('CV_CONF_DATA:target'), false);
  assert.equal(storage.has('cv-session'), false);
  assert.deepEqual(JSON.parse(storage.get('CV_CONF_INDEX')!), [{ id: 'other', name: 'Other version' }]);
  assert.equal(storage.get('CV_CONF_ACTIVE_ID'), EMPTY_DOCUMENT_ID);
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID);
  assert.equal(props.state.contact.name, '');
  assert.deepEqual(deleted, ['target']);
  assert.equal(instance.restoreActiveConfig()?.contact.name, '');
  assert.equal(instance.saveCurrent(), true);
  assert.equal(instance.saveVersion('target', createSampleDocument()), false);
  assert.equal(storage.has('CV_CONF_DATA:target'), false);
  assert.equal(storage.has('cv-session'), false);
  assert.equal(storage.get('CV_CONF_DATA:other'), original);
});

test('a stale tab drops its deleted active version before autosaving', async (t) => {
  const { storage, props, instance, deleted } = savedVersionFixture(t);
  storage.delete('CV_CONF_DATA:target');
  // Even before the index storage event arrives, a deleted payload is final.
  assert.equal(instance.saveCurrent(), true);
  await nextTick();
  assert.equal(props.state.contact.name, '');
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID);
  assert.equal(storage.has('CV_CONF_DATA:target'), false);
  assert.equal(instance.saveVersion('target', createSampleDocument()), false);
  assert.deepEqual(deleted, ['target']);
});

test('another tab deletion clears the current editor through the storage event', async (t) => {
  const { storage, props, setup, deleted } = savedVersionFixture(t);
  storage.delete('CV_CONF_DATA:target');
  setup.onStorageChange({ storageArea: localStorage, key: 'CV_CONF_DATA:target' } as StorageEvent);
  await nextTick();
  assert.equal(props.state.contact.name, '');
  assert.equal(props.selectedId, EMPTY_DOCUMENT_ID);
  assert.deepEqual(deleted, ['target']);
});

test('JSON filenames use the version title, with a neutral fallback for an unsaved draft', async (t) => {
  const { props, setup, global } = savedVersionFixture(t);
  const filenames: string[] = [];
  const link = { href: '', download: '', click() { filenames.push(this.download); }, remove() {} };
  global('document', { createElement: () => link, body: { appendChild() {} } });
  global('window', { setTimeout: (fn: () => void) => fn(), removeEventListener() {} });
  t.mock.method(URL, 'createObjectURL', () => 'blob:test');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  setup.exportJson();
  props.selectedId = '';
  await nextTick();
  setup.exportJson();
  assert.deepEqual(filenames, [`engineering-2026-v${props.state.version}.json`, `cv-backup-v${props.state.version}.json`]);
  assert.ok(filenames.every((name) => !name.includes('private-person')));
});
