import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createLetterRepository } from '../src/composables/motivationLetters';
import type { LetterTemplate } from '../src/letterTypes';
import { useToasts, useToastWatch } from '../src/composables/useToasts';

const filename = new URL('../src/components/LetterTemplates.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'letter-template-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : path.endsWith('/useToasts') ? { useToasts, useToastWatch } : requireComponent(path), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
interface Editor {
  form: LetterTemplate; selectedId: string; saveStatus: string; error: string; isImporting: boolean;
  select(id: string): void; create(): void; flushSave(): boolean;
  importLibrary(event: Event): Promise<void>;
}

function importFixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const restoreGlobals: (() => void)[] = [];
  for (const [name, value] of Object.entries({ localStorage: storage, window: new EventTarget() })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restoreGlobals.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const props = reactive({ userId: 'owner', lang: 'en' });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({});
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => { try { unmount(); useToasts().clear(); } finally { restoreGlobals.forEach(restore => restore()); } });
  const owner = createLetterRepository(storage, 'owner');
  return { editor: (instance as { $: { setupState: Editor } }).$.setupState, props, owner, data, unmount };
}

function pendingImport() {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>(finish => { resolve = finish; });
  const input = { files: [{ text: () => pending }], value: 'library.json' };
  return { event: { target: input } as unknown as Event, input, resolve };
}

test('only one letter library import runs at a time and edits made during the read are saved', async t => {
  const { editor, owner } = importFixture(t);
  const library = owner.exportTemplates();
  const initialCount = owner.listTemplates().length;
  const selectedId = editor.selectedId;
  const first = pendingImport();
  const importing = editor.importLibrary(first.event);
  assert.equal(editor.isImporting, true);
  assert.equal(first.input.value, '', 'the same file can be selected again after this attempt');
  let extraReads = 0;
  for (let i = 0; i < 10; i++) await editor.importLibrary({ target: { files: [{ text: async () => { extraReads++; return library; } }], value: 'library.json' } } as unknown as Event);
  assert.equal(extraReads, 0);
  editor.form.researchInterests = 'Current edits made while the file is read';
  first.resolve(library); await importing;
  assert.equal(editor.isImporting, false);
  assert.equal(owner.listTemplates().length, initialCount * 2);
  assert.equal(owner.listTemplates().find(template => template.id === selectedId)?.researchInterests, editor.form.researchInterests);
  assert.equal(editor.form.researchInterests, 'Current edits made while the file is read');
});

test('failed library reads leave the editor intact and allow selecting the same file again', async t => {
  const { editor, owner } = importFixture(t);
  const original = JSON.stringify(editor.form);
  let failRead = true;
  const input = { files: [{ text: async () => { if (failRead) throw new Error('File is unavailable'); return owner.exportTemplates(); } }], value: 'library.json' };
  await editor.importLibrary({ target: input } as unknown as Event);
  assert.equal(editor.isImporting, false); assert.equal(input.value, '');
  assert.match(editor.error, /Select the file again to retry/);
  assert.equal(JSON.stringify(editor.form), original);
  assert.equal(owner.listTemplates().length, 2);
  failRead = false; input.value = 'library.json';
  await editor.importLibrary({ target: input } as unknown as Event);
  assert.equal(editor.error, ''); assert.equal(owner.listTemplates().length, 4);
});

test('closing the template editor cancels a pending import without later writes or errors', async t => {
  const { editor, owner, data, unmount } = importFixture(t);
  const library = owner.exportTemplates();
  const pending = pendingImport();
  const importing = editor.importLibrary(pending.event);
  unmount(); pending.resolve(library); await importing;
  assert.equal(data.size, 0); assert.equal(editor.error, '');
});

test('returning to the original account cannot revive an older import or unlock a newer one', async t => {
  const { editor, owner, props } = importFixture(t);
  const library = owner.exportTemplates();
  const old = pendingImport(), latest = pendingImport();
  const staleImport = editor.importLibrary(old.event);
  props.userId = 'other'; await nextTick();
  assert.equal(editor.isImporting, false);
  props.userId = 'owner'; await nextTick();
  const latestImport = editor.importLibrary(latest.event);
  old.resolve(library); await staleImport;
  assert.equal(owner.listTemplates().length, 2);
  assert.equal(editor.isImporting, true, 'stale completion must not clear the active import state');
  latest.resolve(library); await latestImport;
  assert.equal(owner.listTemplates().length, 4); assert.equal(editor.isImporting, false);
});

test('templates autosave edits, flush before navigation, and preserve account ownership and failed edits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notifications = useToasts();
  notifications.clear();
  t.after(() => notifications.clear());
  const data = new Map<string, string>();
  let failWrites = false;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {
    if (failWrites) throw new Error('Storage full');
    data.set(key, value);
  } };
  const events = new EventTarget();
  for (const [name, value] of Object.entries({ localStorage: storage, window: events })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const props = reactive({ userId: 'owner', lang: 'en' });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({});
  const editor = (instance as { $: { setupState: Editor } }).$.setupState;
  const owner = createLetterRepository(storage, 'owner');
  try {
    t.mock.timers.tick(3000);
    assert.equal(notifications.toasts.value.length, 0, 'opening a saved template must not announce a save');
    const revision = editor.form.revision;
    editor.form.researchInterests = 'Early edit';
    editor.form.researchInterests = 'Latest research interests';
    assert.equal(editor.saveStatus, 'saving');
    t.mock.timers.tick(250);
    assert.equal(editor.saveStatus, 'saved');
    assert.equal(owner.defaultTemplate()?.researchInterests, 'Latest research interests');
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'one revision per debounced batch');
    assert.equal(notifications.toasts.value.length, 0, 'saving a keystroke batch must not immediately interrupt typing');
    t.mock.timers.tick(1000);
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'saving metadata must not trigger another autosave');
    assert.equal(notifications.toasts.value.length, 0, 'the notification waits for idle time');

    editor.form.researchInterests = 'Another editing batch';
    t.mock.timers.tick(250);
    t.mock.timers.tick(1250);
    assert.equal(notifications.toasts.value.length, 0, 'new input cancels the earlier pending save notification');
    t.mock.timers.tick(250);
    assert.equal(notifications.toasts.value.length, 1);
    assert.equal(notifications.toasts.value[0]?.message, 'All changes saved locally');
    assert.equal(notifications.toasts.value[0]?.tone, 'success');
    const saveToastId = notifications.toasts.value[0]?.id;

    editor.form.tone = 'The last edit before switching';
    editor.select('industry');
    assert.equal(owner.defaultTemplate()?.tone, 'The last edit before switching');
    editor.create();
    assert.ok(owner.listTemplates().some(template => template.id === editor.selectedId), 'new templates save immediately');
    t.mock.timers.tick(1500);
    assert.equal(notifications.toasts.value.length, 1, 'subsequent saves update the existing notification instead of adding a stack');
    assert.equal(notifications.toasts.value[0]?.id, saveToastId);

    failWrites = true;
    editor.form.name = 'Unsaved name';
    t.mock.timers.tick(250);
    assert.equal(editor.saveStatus, 'error');
    assert.equal(notifications.toasts.value.at(-1)?.message, 'Storage full');
    assert.equal(notifications.toasts.value.at(-1)?.tone, 'error');
    const unsavedId = editor.selectedId;
    editor.select('research');
    assert.equal(editor.selectedId, unsavedId, 'failed saves keep the editor on its unsaved template');
    assert.equal(editor.form.name, 'Unsaved name');
    failWrites = false;
    events.dispatchEvent(new Event('pagehide'));
    assert.equal(editor.saveStatus, 'saved');

    editor.form.name = 'Owner edit before account switch';
    props.userId = 'other'; await nextTick();
    assert.equal(owner.listTemplates().find(template => template.id === unsavedId)?.name, 'Owner edit before account switch');
    assert.equal(createLetterRepository(storage, 'other').listTemplates().length, 2, 'edits never cross accounts');
    editor.form.tone = 'Saved when the editor closes';
  } finally { app.unmount(); }
  assert.equal(createLetterRepository(storage, 'other').defaultTemplate()?.tone, 'Saved when the editor closes');
});
