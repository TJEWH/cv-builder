import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createSearchProfile, createSearchTemplateRepository, searchTemplateContentKey } from '../src/composables/useSearchTemplates';
import type { SearchTemplate } from '../src/searchTypes';
import * as textareaCommit from '../src/composables/textareaCommit';
import { clearSearchDraft, recoverSearchDraft } from '../src/composables/searchTemplateRecovery';

interface Editor {
  form: SearchTemplate;
  selectedId: string;
  profileId: string;
  status: string;
  error: string;
  importing: boolean;
  copiedFallback: string;
  publishing: boolean;
  published: boolean;
  selectProfile(id: string): void;
  addProfile(): void;
  removeProfile(): void;
  flushSave(): boolean;
  flushTextareas(): Promise<boolean>;
  copy(kind: 'system' | 'user' | 'daily'): Promise<void>;
  publish(): Promise<boolean> | undefined;
  importLibrary(event: Event): Promise<void>;
}

const filename = new URL('../src/components/SearchTemplates.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'search-template-autosave' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const requireComponent = createRequire(filename);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = new Map<string, string>();
  const recoveryData = new Map<string, string>();
  let failWrites = false;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('Storage full'); data.set(key, value); },
  };
  const restoreGlobals: (() => void)[] = [];
  for (const account of ['owner', 'other']) {
    const previous = recoverSearchDraft(account);
    if (previous) clearSearchDraft(account, previous.form.id);
  }
  for (const [name, value] of Object.entries({ localStorage: storage, window: new EventTarget(), sessionStorage: {
    getItem: (key: string) => recoveryData.get(key) ?? null,
    setItem: (key: string, value: string) => { recoveryData.set(key, value); },
    removeItem: (key: string) => { recoveryData.delete(key); },
  } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restoreGlobals.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const owner = createSearchTemplateRepository(storage, 'owner');
  const initial = owner.listTemplates()[0]!;
  initial.profiles.push(createSearchProfile('Second profile'));
  owner.saveTemplate(initial);
  const copied: string[] = [];
  const published: SearchTemplate[] = [];
  const cloudSearches: Array<{ id: string; revision: number }> = [];
  let publicationGate: Promise<void> | null = null;
  const holdPublication = () => {
    let release!: () => void;
    publicationGate = new Promise<void>(resolve => { release = resolve; });
    return release;
  };
  const exports: { default?: Component } = {};
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('.vue')) return { default: {} };
    if (path.endsWith('/textareaCommit')) return textareaCommit;
    if (path.endsWith('/searchPrompts')) return {
      buildSearchSystemPrompt: () => 'Fixed protocol',
      buildSearchUserPrompt: (value: SearchTemplate) => JSON.stringify(value),
      buildDailySearchPrompt: (value: SearchTemplate) => JSON.stringify(value),
    };
    if (path.endsWith('/searchTemplateCloud')) return {
      isSearchTemplatePublished: (value: SearchTemplate) => value.cloud?.contentKey === searchTemplateContentKey(value),
      listCloudSearchTemplates: async () => cloudSearches,
      importCloudSearchTemplate: () => { throw new Error('Cloud import was not requested'); },
      publishSearchTemplate: async (_client: unknown, _owner: string, value: SearchTemplate) => {
        published.push(JSON.parse(JSON.stringify(value)));
        if (publicationGate) await publicationGate;
        return { ...value, cloud: { id: 'a0000000-0000-4000-8000-000000000001', revision: 1, contentKey: searchTemplateContentKey(value) } };
      },
    };
    if (path.endsWith('/preparedClipboard')) return {
      copyPreparedText: async (prepare: () => Promise<string | null>) => {
        const value = await prepare();
        if (value === null) return null;
        copied.push(value); return { value, copied: true };
      },
    };
    return requireComponent(path);
  }, exports);
  const rpcCalls: string[] = [];
  const client = { rpc: async (name: string) => { rpcCalls.push(name); throw new Error('No cloud action expected'); } };
  const props = reactive({ userId: 'owner', lang: 'en', client });
  let instance: unknown;
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { instance = value; } }) });
  app.mount({});
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => {
    try {
      unmount();
      for (const account of ['owner', 'other']) {
        const recovered = recoverSearchDraft(account);
        if (recovered) clearSearchDraft(account, recovered.form.id);
      }
    } finally { restoreGlobals.forEach(restore => restore()); }
  });
  const editor = (instance as { $: { setupState: Editor } }).$.setupState;
  return { editor, owner, data, props, copied, rpcCalls, published, cloudSearches, unmount, holdPublication, fail: (value: boolean) => { failWrites = value; } };
}

function pendingImport() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(finish => { resolve = finish; });
  const input = { files: [{ text: () => promise }], value: 'searches.json' };
  return { event: { target: input } as unknown as Event, input, resolve };
}

test('search prompt typing stays local until a commit and repeated commits do not create revisions', t => {
  const { editor, owner, rpcCalls } = fixture(t);
  const id = editor.selectedId;
  const revision = editor.form.revision;
  editor.form.userPrompt = 'Draft strategy while typing';
  assert.equal(editor.status, 'unsaved');
  t.mock.timers.tick(60000);
  assert.notEqual(owner.listTemplates().find(item => item.id === id)?.userPrompt, editor.form.userPrompt);
  assert.equal(editor.flushSave(), true);
  assert.equal(editor.status, 'saved');
  assert.equal(owner.listTemplates().find(item => item.id === id)?.userPrompt, 'Draft strategy while typing');
  assert.equal(editor.form.revision, revision + 1);
  assert.equal(editor.flushSave(), true);
  assert.equal(editor.form.revision, revision + 1);
  assert.deepEqual(rpcCalls, [], 'committing private drafts must not publish them');
});

test('profile switches publish pending textarea drafts before replacing editor models', t => {
  const { editor, owner } = fixture(t);
  const id = editor.selectedId;
  const originalProfile = editor.profileId;
  const nextProfile = editor.form.profiles.find(item => item.id !== originalProfile)!.id;
  let pending = true;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    editor.form.profiles.find(item => item.id === originalProfile)!.professionalContext = 'Final pending professional background';
    editor.flushSave();
  });
  try {
    editor.selectProfile(nextProfile);
    assert.equal(editor.profileId, nextProfile);
    assert.equal(owner.listTemplates().find(item => item.id === id)?.profiles.find(item => item.id === originalProfile)?.professionalContext, 'Final pending professional background');
  } finally { unregister(); }
});

test('copy flushes pending profile drafts and includes the saved snapshot without publishing', async t => {
  const { editor, owner, copied, rpcCalls, published } = fixture(t);
  let pending = true;
  const unregister = textareaCommit.registerTextareaCommit(() => {
    if (!pending) return;
    pending = false;
    editor.form.researchInterests = 'Acoustic sensing from the pending textarea';
  });
  try {
    await editor.copy('user');
    assert.equal(copied.length, 1);
    assert.equal(JSON.parse(copied[0]!).researchInterests, 'Acoustic sensing from the pending textarea');
    assert.equal(owner.listTemplates().find(item => item.id === editor.selectedId)?.researchInterests, 'Acoustic sensing from the pending textarea');
    assert.deepEqual(rpcCalls, []);
    assert.equal(published.length, 0);
  } finally { unregister(); }
});

test('only explicit publication sends the committed private context to the cloud adapter', async t => {
  const { editor, owner, published } = fixture(t);
  editor.form.professionalContext = 'Private professional background';
  assert.equal(editor.flushSave(), true);
  assert.equal(published.length, 0);
  editor.form.researchInterests = 'Interest added just before publication';
  await editor.publish();
  assert.equal(published.length, 1);
  assert.equal(published[0]?.professionalContext, 'Private professional background');
  assert.equal(published[0]?.researchInterests, 'Interest added just before publication');
  assert.equal(editor.published, true);
  assert.ok(owner.listTemplates().find(item => item.id === editor.selectedId)?.cloud);
  editor.form.userPrompt = 'Changed strategy after publication';
  assert.equal(editor.published, false);
  assert.equal(editor.flushSave(), true);
  assert.equal(published.length, 1, 'further commits do not republish changed context');
});

test('publication reuses the existing saved search for an unlinked local workspace', async t => {
  const { editor, owner, published, cloudSearches } = fixture(t);
  const id = editor.selectedId;
  const existing = { id: 'b0000000-0000-4000-8000-000000000001', revision: 5 };
  cloudSearches.push(existing);
  assert.equal(await editor.publish(), true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.cloud?.id, existing.id);
  assert.equal(published[0]!.cloud?.revision, existing.revision);
  assert.equal(editor.selectedId, id);
  assert.equal(owner.listTemplates().length, 1);
});

test('navigation flush waits for publication and saves newer typing without claiming it was published', async t => {
  const { editor, owner, holdPublication } = fixture(t);
  const release = holdPublication();
  const publishing = editor.publish();
  editor.form.userPrompt = 'New strategy typed while an older snapshot was publishing';
  let settled = false;
  const navigating = editor.flushTextareas().then(value => { settled = true; return value; });
  await nextTick();
  assert.equal(settled, false, 'navigation must wait for the active persistence layer');
  release();
  await publishing;
  assert.equal(await navigating, true);
  assert.equal(editor.published, false, 'the cloud reference belongs to the original snapshot');
  assert.equal(owner.listTemplates().find(item => item.id === editor.selectedId)?.userPrompt, 'New strategy typed while an older snapshot was publishing');
});

test('returning to an account cannot revive its stale publication response', async t => {
  const { editor, owner, props, holdPublication } = fixture(t);
  const id = editor.selectedId;
  const release = holdPublication();
  const publishing = editor.publish();
  props.userId = 'other'; await nextTick();
  props.userId = 'owner'; await nextTick();
  release(); await publishing;
  assert.equal(editor.selectedId, id);
  assert.equal(editor.published, false);
  assert.equal(owner.listTemplates().find(item => item.id === id)?.cloud, undefined);
});

test('publication retains its cloud binding when local persistence fails and blocks pending navigation', async t => {
  const { editor, owner, holdPublication, fail } = fixture(t);
  const release = holdPublication();
  const publishing = editor.publish();
  const navigating = editor.flushTextareas();
  fail(true); release();
  assert.equal(await publishing, false);
  assert.equal(await navigating, false);
  assert.equal(editor.status, 'error');
  assert.ok(editor.form.cloud, 'a successful cloud write must retain its reference for local-save retry');
  assert.equal(owner.listTemplates().find(item => item.id === editor.selectedId)?.cloud, undefined);
  const cloudId = editor.form.cloud.id;
  fail(false);
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.listTemplates().find(item => item.id === editor.selectedId)?.cloud?.id, cloudId);
});

test('pending publication blocks replacing or removing profiles until its cloud binding is saved', async t => {
  const { editor, owner, holdPublication } = fixture(t);
  const id = editor.selectedId;
  const profileId = editor.profileId;
  const nextProfile = editor.form.profiles.find(item => item.id !== profileId)!.id;
  const initialCount = editor.form.profiles.length;
  const release = holdPublication();
  const publishing = editor.publish();
  editor.selectProfile(nextProfile); editor.addProfile(); editor.removeProfile();
  assert.equal(editor.selectedId, id);
  assert.equal(editor.profileId, profileId);
  assert.equal(editor.form.profiles.length, initialCount);
  release(); await publishing;
  editor.selectProfile(nextProfile);
  assert.equal(editor.profileId, nextProfile);
  assert.ok(owner.listTemplates().find(item => item.id === id)?.cloud);
});

test('failed saves retain the draft and block profile changes and copying until retry', async t => {
  const { editor, owner, copied, fail } = fixture(t);
  const id = editor.selectedId;
  const profileId = editor.profileId;
  const nextProfile = editor.form.profiles.find(item => item.id !== profileId)!.id;
  editor.form.userPrompt = 'Important unsaved search strategy';
  fail(true);
  assert.equal(editor.flushSave(), false);
  assert.equal(editor.status, 'error');
  assert.match(editor.error, /Storage full/);
  editor.selectProfile(nextProfile);
  assert.equal(editor.profileId, profileId);
  assert.equal(editor.selectedId, id);
  assert.equal(editor.form.userPrompt, 'Important unsaved search strategy');
  await editor.copy('user');
  assert.deepEqual(copied, [], 'failed persistence must leave the clipboard untouched');
  assert.notEqual(owner.listTemplates().find(item => item.id === id)?.userPrompt, editor.form.userPrompt);
  fail(false);
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.listTemplates().find(item => item.id === id)?.userPrompt, 'Important unsaved search strategy');
});

test('conflicting edits from another tab keep the saved version and local draft intact', t => {
  const { editor, owner } = fixture(t);
  const original = owner.listTemplates().find(item => item.id === editor.selectedId)!;
  owner.saveTemplate({ ...original, researchInterests: 'Interests saved in another tab' });
  editor.form.researchInterests = 'Conflicting local interests';
  assert.equal(editor.flushSave(), false);
  assert.match(editor.error, /another tab/i);
  editor.selectProfile(editor.form.profiles.find(item => item.id !== editor.profileId)!.id);
  assert.equal(editor.selectedId, original.id);
  assert.equal(editor.form.researchInterests, 'Conflicting local interests');
  assert.equal(owner.listTemplates().find(item => item.id === original.id)?.researchInterests, 'Interests saved in another tab');
});

test('a failed private draft recovers only for its original account after switching away and back', async t => {
  const { editor, owner, props, fail } = fixture(t);
  const id = editor.selectedId;
  editor.form.professionalContext = 'Private unsaved professional context';
  fail(true);
  assert.equal(editor.flushSave(), false);
  props.userId = 'other'; await nextTick();
  assert.notEqual(editor.form.professionalContext, 'Private unsaved professional context');
  props.userId = 'owner'; await nextTick();
  assert.equal(editor.selectedId, id);
  assert.equal(editor.form.professionalContext, 'Private unsaved professional context');
  assert.equal(editor.status, 'unsaved');
  fail(false);
  assert.equal(editor.flushSave(), true);
  assert.equal(owner.listTemplates().find(item => item.id === id)?.professionalContext, 'Private unsaved professional context');
  assert.equal(recoverSearchDraft('owner'), null, 'successful saving clears the recovered version');
});

test('switching accounts cancels a pending import and leaves imports available for the new account', async t => {
  const { editor, owner, props } = fixture(t);
  const library = owner.exportTemplates();
  const pending = pendingImport();
  const importing = editor.importLibrary(pending.event);
  assert.equal(editor.importing, true);
  props.userId = 'other'; await nextTick();
  assert.equal(editor.importing, false, 'a cancelled account import must release its busy state');
  pending.resolve(library); await importing;
  assert.equal(createSearchTemplateRepository(localStorage, 'other').listTemplates().length, 1);
  const retry = pendingImport();
  const latest = editor.importLibrary(retry.event);
  retry.resolve(library); await latest;
  assert.equal(createSearchTemplateRepository(localStorage, 'other').listTemplates().length, 1);
  assert.equal(editor.form.profiles.length, 2, 'import restores the single search rather than appending another instance');
});

test('closing the editor cancels a file read and cannot import into the old account afterward', async t => {
  const { editor, owner, unmount } = fixture(t);
  const library = owner.exportTemplates();
  const count = owner.listTemplates().length;
  const pending = pendingImport();
  const importing = editor.importLibrary(pending.event);
  unmount(); pending.resolve(library); await importing;
  assert.equal(owner.listTemplates().length, count);
});
