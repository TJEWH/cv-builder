import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { Application } from '../src/cloudTypes';
import type { CvState, SavedConfiguration } from '../src/types';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import { cloneCv, createApplicationCv, loadApplicationCv, saveApplicationCv } from '../src/composables/applicationCv';
import type { ApplicationCvRecord } from '../src/composables/applicationCv';

const filename = new URL('../src/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'application-variant-selection' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireFromComponent(path), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
function mount(t: TestContext, legacy?: 'unchanged' | 'tailored') {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  for (const name of ['localStorage', 'sessionStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: storage });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const base = cloneCv(createSampleDocument());
  const states = new Map([['base', base]]);
  if (legacy) {
    const record = createApplicationCv('user', 'application', 'base', 'Research', base);
    if (legacy === 'tailored') record.state.about.text = 'Previously tailored application';
    saveApplicationCv(record);
  }
  const props = reactive({
    application: { id: 'application', context_json: { title: 'Robotics' }, cv_variant_id: null } as unknown as Application,
    client: null, userId: 'user', lang: 'en', configurations: [{ id: 'base', name: 'Research' }] as SavedConfiguration[],
    readVersion: (id: string) => states.get(id) || null,
    publishCv: async () => null,
    createSubvariant: (source: string, name: string, state: CvState) => {
      const id = `child-${states.size}`;
      const parentId = props.configurations.find(item => item.id === source)?.parentId || source;
      states.set(id, cloneCv(state)); props.configurations.push({ id, name, parentId }); return id;
    },
  });
  const component = { ...exports.default, render: () => null };
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({}); t.after(() => app.unmount());
  const setup = (mounted as { $: { setupState: {
    record: ApplicationCvRecord | null; pendingBaseId: string; pendingSubId: string; legacyAdjustments: boolean;
    assignBase(): void; acceptAdjustedCv(state: CvState): void; createTailoredVariant(state?: CvState, open?: boolean): string | null;
    importBackup(event: Event): Promise<void>;
  } } }).$.setupState;
  return { setup, props, states, base };
}

test('applications use the original variant until changed and follow Studio edits', async (t) => {
  const { setup, props, states, base } = mount(t);
  setup.pendingBaseId = 'base'; setup.assignBase();
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(states.size, 1);
  setup.acceptAdjustedCv(cloneCv(base));
  assert.equal(states.size, 1, 'an unchanged response does not create a subvariant');
  const edited = cloneCv(base); edited.about.text = 'Edited in CV Studio'; states.set('base', edited);
  props.configurations = [{ id: 'base', name: 'Research', mtime: 2 }];
  await nextTick();
  assert.equal(setup.record?.state.about.text, edited.about.text);
  setup.acceptAdjustedCv({ ...cloneCv(edited), about: { text: 'Tailored for robotics' } });
  await nextTick();
  assert.equal(setup.record?.variantId, 'child-1');
  assert.equal(props.configurations.find(item => item.id === 'child-1')?.parentId, 'base');
  assert.equal(states.get('base')?.about.text, 'Edited in CV Studio');
  setup.createTailoredVariant(undefined, false); await nextTick();
  assert.equal(props.configurations.find(item => item.id === 'child-2')?.parentId, 'base');
});

test('tailored legacy application CVs remain intact until explicitly converted', (t) => {
  const { setup, states } = mount(t, 'tailored');
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.legacyAdjustments, true);
  assert.equal(setup.record?.state.about.text, 'Previously tailored application');
  assert.equal(states.size, 1);
});

test('unchanged legacy application copies rejoin their original variant', (t) => {
  const { setup, states } = mount(t, 'unchanged');
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(states.size, 1);
});

test('restored backups stay detached even when unchanged from their historical base', async (t) => {
  const { setup, props, states, base } = mount(t);
  const backup = createApplicationCv('user', 'application', 'base', 'Research', base);
  const updated = cloneCv(base);
  updated.about.text = 'Newer text in the current career variant';
  states.set('base', updated);
  const input = { value: 'backup.json', files: [{ size: 100, text: async () => JSON.stringify({ kind: 'application-cv-backup', record: backup }) }] };
  await setup.importBackup({ target: input } as unknown as Event);
  assert.equal(setup.record?.detached, true);
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.record?.state.about.text, base.about.text);
  props.configurations = [{ id: 'base', name: 'Research', mtime: 5 }];
  await nextTick();
  assert.equal(setup.record?.state.about.text, base.about.text, 'library refresh cannot overwrite restored content');
  const reloaded = loadApplicationCv('user', 'application');
  assert.equal(reloaded?.detached, true, 'detachment survives a page reload');
  assert.equal(reloaded?.state.about.text, base.about.text);
  setup.pendingBaseId = 'base'; setup.assignBase();
  assert.equal(setup.record?.variantId, 'base', 'explicit reassignment adopts the current variant');
  assert.equal(setup.record?.state.about.text, updated.about.text);
});

test('library autosaves do not reset pending variant and subvariant selections', async (t) => {
  const { setup, props, states, base } = mount(t);
  states.set('other', cloneCv(base)); states.set('other-child', cloneCv(base));
  props.configurations.push({ id: 'other', name: 'Other path' }, { id: 'other-child', name: 'Other application', parentId: 'other' });
  setup.pendingBaseId = 'base'; setup.assignBase();
  await nextTick();
  setup.pendingBaseId = 'other'; setup.pendingSubId = 'other-child';
  const updated = cloneCv(base); updated.about.text = 'Saved while choosing another CV';
  states.set('base', updated);
  props.configurations = props.configurations.map(item => ({ ...item, mtime: 20 }));
  await nextTick();
  assert.equal(setup.record?.state.about.text, updated.about.text, 'assigned CV still follows Studio changes');
  assert.equal(setup.pendingBaseId, 'other');
  assert.equal(setup.pendingSubId, 'other-child');
  setup.assignBase();
  assert.equal(setup.record?.variantId, 'other-child');
});
