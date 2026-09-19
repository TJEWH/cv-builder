import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { TestContext } from 'node:test';
import type { CvState, CvJsonKind, SavedConfiguration } from '../src/types';
import { createCvContentJson, createCvConfigJson, cvContent, cvConfig, MAX_CV_JSON_FILE_BYTES } from '../src/composables/cvJsonBackup';
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
    beforeLoad: (): boolean => true,
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
    $: { setupState: {
      deleteCurrent(): void; exportJson(kind: CvJsonKind): void;
      importJson(event: Event, kind: CvJsonKind): Promise<void>;
      onStorageChange(event: StorageEvent): void; backupMsg: string; bypassPrivacyProxy: boolean;
    } };
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

test('split JSON filenames use the version title and type, with a neutral draft fallback', async (t) => {
  const { props, setup, global } = savedVersionFixture(t);
  const filenames: string[] = [];
  const link = { href: '', download: '', click() { filenames.push(this.download); }, remove() {} };
  global('document', { createElement: () => link, body: { appendChild() {} } });
  global('window', { setTimeout: (fn: () => void) => fn(), removeEventListener() {} });
  t.mock.method(URL, 'createObjectURL', () => 'blob:test');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  setup.exportJson('content');
  setup.exportJson('config');
  props.selectedId = '';
  await nextTick();
  setup.exportJson('content');
  assert.deepEqual(filenames, [`engineering-2026-content-v${props.state.version}.json`, `engineering-2026-config-v${props.state.version}.json`, `cv-backup-content-v${props.state.version}.json`]);
  assert.ok(filenames.every((name) => !name.includes('private-person')));
});

function fileEvent(text: string, size = text.length) {
  return { target: { files: [{ size, text: async () => text }], value: 'selected.json' } } as unknown as Event;
}

test('bypassed content import overwrites the selected version content and preserves configuration', async (t) => {
  const { props, storage, instance, setup } = savedVersionFixture(t);
  setup.bypassPrivacyProxy = true;
  const settings = cvConfig(props.state);
  const backup = createCvContentJson(createEmptyDocument());
  backup.data.contact.name = 'Edited in another context';
  backup.data.about.text = 'Replacement, not merged content';
  await setup.importJson(fileEvent(JSON.stringify(backup)), 'content');
  await nextTick();
  assert.equal(props.selectedId, 'target');
  assert.deepEqual(cvContent(props.state), backup.data);
  assert.deepEqual(cvConfig(props.state), settings);
  assert.equal(instance.saveCurrent(), true);
  assert.deepEqual(cvContent(JSON.parse(storage.get('CV_CONF_DATA:target')!).data), backup.data);
  assert.equal(setup.backupMsg, 'versionContentImported');
});

test('configuration import replaces settings without changing the selected version content', async (t) => {
  const { props, instance, setup } = savedVersionFixture(t);
  const content = cvContent(props.state);
  const backup = createCvConfigJson(createEmptyDocument());
  backup.data.design.ink = '#123456';
  await setup.importJson(fileEvent(JSON.stringify(backup)), 'config');
  await nextTick();
  assert.equal(props.selectedId, 'target');
  assert.deepEqual(cvContent(props.state), content);
  assert.deepEqual(cvConfig(props.state), backup.data);
  assert.equal(instance.saveCurrent(), true);
  assert.equal(setup.backupMsg, 'versionConfigImported');
});

test('the default content import preserves private local fields and imports textarea placeholders', async (t) => {
  const { props, setup, instance, storage } = savedVersionFixture(t);
  assert.equal(setup.bypassPrivacyProxy, false);
  props.state.anonymization.excludedSections = ['jobs'];
  const originalContact = structuredClone(JSON.parse(JSON.stringify(props.state.contact)));
  const originalJobs = JSON.parse(JSON.stringify(props.state.experience.jobs));
  const file = createCvContentJson(createEmptyDocument(), { bypassPrivacy: true });
  file.data.contact.name = 'Anonymized header';
  file.data.about.text = 'Worked for !!confidential text!!.';
  await setup.importJson(fileEvent(JSON.stringify(file)), 'content');
  await nextTick();
  assert.deepEqual(props.state.contact, originalContact);
  assert.deepEqual(props.state.experience.jobs, originalJobs);
  assert.equal(props.state.about.text, file.data.about.text);
  assert.equal(instance.saveCurrent(), true);
  assert.deepEqual(JSON.parse(storage.get('CV_CONF_DATA:target')!).data.contact, originalContact);
});

test('the content checkbox controls export privacy and resets when the selected version changes', async (t) => {
  const { props, setup, global } = savedVersionFixture(t);
  props.state.anonymization.excludedSections = ['jobs'];
  props.state.about.text = 'Built !!Private Product!!.';
  const blobs: Blob[] = [];
  global('document', { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } });
  global('window', { setTimeout: (fn: () => void) => fn(), removeEventListener() {} });
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return 'blob:test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  setup.exportJson('content');
  setup.bypassPrivacyProxy = true;
  setup.exportJson('content');
  const [privateExport, completeExport] = await Promise.all(blobs.map(async (blob) => JSON.parse(await blob.text())));
  assert.notEqual(privateExport.data.contact.name, 'Private Person');
  assert.deepEqual(privateExport.data.experience.jobs, []);
  assert.equal(privateExport.data.about.text, 'Built !!confidential text!!.');
  assert.equal(completeExport.data.contact.name, 'Private Person');
  assert.ok(completeExport.data.experience.jobs.length > 0);
  assert.equal(completeExport.data.about.text, props.state.about.text);
  props.selectedId = 'other';
  await nextTick();
  assert.equal(setup.bypassPrivacyProxy, false);
});

test('invalid, wrong-kind, legacy, oversized, and cancelled imports leave content and selection untouched', async (t) => {
  const { props, storage, setup, global } = savedVersionFixture(t);
  const before = JSON.stringify(props.state);
  const saved = [...storage];
  const content = createCvContentJson(props.state);
  for (const file of [fileEvent('{'), fileEvent(JSON.stringify(createCvConfigJson(props.state))),
    fileEvent(JSON.stringify({ ...content, format: 'cv-builder/cv', data: props.state })),
    fileEvent(JSON.stringify({ ...content, data: { ...content.data, contact: null } })),
    fileEvent(JSON.stringify(content), MAX_CV_JSON_FILE_BYTES + 1)]) {
    await setup.importJson(file, 'content');
    assert.equal(JSON.stringify(props.state), before);
    assert.equal(props.selectedId, 'target');
    assert.deepEqual([...storage], saved);
  }
  global('confirm', () => false);
  await setup.importJson(fileEvent(JSON.stringify(content)), 'content');
  assert.equal(JSON.stringify(props.state), before);
  assert.deepEqual([...storage], saved);
});

test('imports into the empty template become editable drafts', async (t) => {
  const { props, setup } = savedVersionFixture(t);
  props.selectedId = EMPTY_DOCUMENT_ID;
  props.state = createEmptyDocument();
  await nextTick();
  const content = createCvContentJson(createSampleDocument(), { bypassPrivacy: true });
  setup.bypassPrivacyProxy = true;
  await setup.importJson(fileEvent(JSON.stringify(content)), 'content');
  await nextTick();
  assert.equal(props.selectedId, '');
  assert.deepEqual(cvContent(props.state), content.data);
});

test('a failed pre-import save leaves the version unchanged', async (t) => {
  const { props, setup } = savedVersionFixture(t);
  const before = JSON.stringify(props.state);
  props.beforeLoad = () => false;
  await nextTick();
  await setup.importJson(fileEvent(JSON.stringify(createCvContentJson(createEmptyDocument()))), 'content');
  assert.equal(JSON.stringify(props.state), before);
  assert.equal(props.selectedId, 'target');
});

test('changing versions while a file is being read cannot replace the newly selected version', async (t) => {
  const { props, setup } = savedVersionFixture(t);
  let finish!: (text: string) => void;
  const reading = new Promise<string>((resolve) => { finish = resolve; });
  const event = { target: { files: [{ size: 100, text: () => reading }], value: 'file.json' } } as unknown as Event;
  const pending = setup.importJson(event, 'content');
  props.selectedId = 'other';
  await nextTick();
  const before = JSON.stringify(props.state);
  finish(JSON.stringify(createCvContentJson(createEmptyDocument())));
  await pending;
  assert.equal(JSON.stringify(props.state), before);
  assert.equal(setup.backupMsg, 'versionImportTargetChanged');
});
