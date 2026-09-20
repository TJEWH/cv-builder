import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer } from 'vue';
import type { Component } from 'vue';
import type { CvState } from '../src/types';
import { createSampleDocument } from '../src/composables/builtinConfigurations';

const filename = new URL('../src/components/CvAdjustmentWorkflow.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'cv-adjustment-workflow-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

// These fixtures expose only the domain fields consumed by the component.
// Reconstruction itself is deliberately stubbed: these tests exercise file-read races.
interface RequestFixture { sourceVariantId: string; publicRequest: { schemaVersion: number; requestId: string } }
interface ReviewFixture { state: CvState; changed: boolean; changedFieldCount: number }
interface WorkflowSetup {
  request: RequestFixture | null;
  responseText: string;
  reviewed: ReviewFixture | null;
  error: string;
  prepare(): void;
  responseEdited(): void;
  review(): void;
  importResponse(event: Event): Promise<void>;
}

function mountWorkflow(t: TestContext) {
  let unmount = () => {};
  t.after(() => unmount());
  const storage = new Map<string, string>();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  t.after(() => previousStorage ? Object.defineProperty(globalThis, 'localStorage', previousStorage) : Reflect.deleteProperty(globalThis, 'localStorage'));
  let requestCount = 0;
  const reviewedInputs: string[] = [];
  const domain = {
    prepareCvAdjustment: ({ variantId }: { variantId: string }): RequestFixture => ({ sourceVariantId: variantId, publicRequest: { schemaVersion: 1, requestId: `request-${++requestCount}` } }),
    reconstructCvAdjustment: (_request: RequestFixture, text: string, state: CvState): ReviewFixture => {
      reviewedInputs.push(text);
      return { state: { ...state, contact: { ...state.contact, role: text } }, changed: true, changedFieldCount: 1 };
    },
    buildCvAdjustmentPrompt: () => 'Fixture prompt',
    createCvAdjustmentRepository: () => { throw new Error('Importing a local response must not access the cloud.'); },
  };
  const exports: { default?: Component } = {};
  const requireFromComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path === '../composables/cvAdjustments' ? domain : requireFromComponent(path), exports);
  const component = { ...exports.default, render: () => null };
  const app = renderer.createApp(component, {
    state: createSampleDocument(), variantId: 'variant-one', applicationId: 'application-one',
    opportunity: { title: 'Research engineer' }, client: null, userId: 'account-one', lang: 'en',
  });
  const instance = app.mount({}) as unknown as { $: { setupState: WorkflowSetup } };
  let mounted = true;
  unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  instance.$.setupState.prepare();
  return { setup: instance.$.setupState, reviewedInputs, unmount };
}

function pendingFile() {
  let finish!: (text: string) => void;
  const content = new Promise<string>((resolve) => { finish = resolve; });
  const input = { value: 'selected-response.json', files: [{ size: 100, text: () => content }] };
  return { event: { target: input } as unknown as Event, input, finish };
}

test('a pending response import cannot replace a newer pasted and reviewed response', async (t) => {
  const { setup, reviewedInputs } = mountWorkflow(t);
  const file = pendingFile();
  const pending = setup.importResponse(file.event);
  assert.equal(file.input.value, '', 'clear the chooser so the same file can be selected again');
  setup.responseText = 'New pasted response';
  setup.responseEdited();
  setup.review();
  const reviewed = setup.reviewed;
  file.finish('Older file response');
  await pending;
  assert.equal(setup.responseText, 'New pasted response');
  assert.equal(setup.reviewed, reviewed);
  assert.deepEqual(reviewedInputs, ['New pasted response']);
  assert.equal(setup.error, '');
});

test('starting a second import invalidates the first even before either read finishes', async (t) => {
  const { setup, reviewedInputs } = mountWorkflow(t);
  const first = pendingFile();
  const second = pendingFile();
  const earlier = setup.importResponse(first.event);
  const latest = setup.importResponse(second.event);
  first.finish('First file response');
  await earlier;
  assert.equal(setup.responseText, '');
  assert.equal(Boolean(setup.reviewed), false);
  assert.deepEqual(reviewedInputs, []);
  second.finish('Second file response');
  await latest;
  assert.equal(setup.responseText, 'Second file response');
  assert.equal(setup.reviewed?.state.contact.role, 'Second file response');
  assert.deepEqual(reviewedInputs, ['Second file response']);
});

test('preparing a new privacy request discards a file read for the old request', async (t) => {
  const { setup, reviewedInputs } = mountWorkflow(t);
  const requestId = setup.request?.publicRequest.requestId;
  const file = pendingFile();
  const pending = setup.importResponse(file.event);
  setup.prepare();
  assert.notEqual(setup.request?.publicRequest.requestId, requestId);
  file.finish('Response for the old request');
  await pending;
  assert.equal(setup.responseText, '');
  assert.equal(setup.reviewed, null);
  assert.deepEqual(reviewedInputs, []);
});

test('unmounting the workflow discards pending response files', async (t) => {
  const { setup, reviewedInputs, unmount } = mountWorkflow(t);
  const file = pendingFile();
  const pending = setup.importResponse(file.event);
  unmount();
  file.finish('Response after leaving the application');
  await pending;
  assert.equal(setup.responseText, '');
  assert.equal(setup.reviewed, null);
  assert.deepEqual(reviewedInputs, []);
});
