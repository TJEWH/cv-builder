import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createLetterRepository } from '../src/composables/motivationLetters';
import type { LetterTemplate } from '../src/letterTypes';

const filename = new URL('../src/components/LetterTemplates.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'letter-template-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
interface Editor {
  form: LetterTemplate; selectedId: string; saveStatus: string; error: string;
  select(id: string): void; create(): void; flushSave(): boolean;
}

test('templates autosave edits, flush before navigation, and preserve account ownership and failed edits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
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
    const revision = editor.form.revision;
    editor.form.researchInterests = 'Early edit';
    editor.form.researchInterests = 'Latest research interests';
    assert.equal(editor.saveStatus, 'saving');
    t.mock.timers.tick(250);
    assert.equal(editor.saveStatus, 'saved');
    assert.equal(owner.defaultTemplate()?.researchInterests, 'Latest research interests');
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'one revision per debounced batch');
    t.mock.timers.tick(1000);
    assert.equal(owner.defaultTemplate()?.revision, revision + 1, 'saving metadata must not trigger another autosave');

    editor.form.tone = 'The last edit before switching';
    editor.select('industry');
    assert.equal(owner.defaultTemplate()?.tone, 'The last edit before switching');
    editor.create();
    assert.ok(owner.listTemplates().some(template => template.id === editor.selectedId), 'new templates save immediately');

    failWrites = true;
    editor.form.name = 'Unsaved name';
    t.mock.timers.tick(250);
    assert.equal(editor.saveStatus, 'error');
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
