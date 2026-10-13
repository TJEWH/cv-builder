import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { AnnotationStatus } from '../src/refinementTypes';
import type { AnnotationView } from '../src/composables/refinementAnnotations';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
interface Draft {
  status: AnnotationStatus; response: string; reviewId: string | null;
  failed: boolean; failedStatus: AnnotationStatus | null; partialFailure: boolean; saving: boolean;
}
interface Setup {
  drafts: Record<string, Draft>;
  key(item: Item): string;
  save(item: Item): Promise<void>;
  flush(): Promise<boolean>;
  failureMessage(item: Item): string;
}
const filename = new URL('../src/components/RefinementAnnotations.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'refinement-annotations-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireFromComponent(path), componentExports);
const component = { ...componentExports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
  setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext) {
  const item: Item = {
    annotation: { id: 'annotation-1', type: 'question', document: 'cv', location: { fieldId: 'field-1' }, text: 'Which methods did you use?' },
    proposalId: 'proposal-1', requestId: 'request-1', status: 'resolved', response: 'Saved answer.', reviewId: 'review-1',
    target: 'CV · Experience 2: bullets', referenceChanged: false, included: true,
  };
  const props = reactive({ items: [item], lang: 'en', disabled: false,
    save: async (_id: string, _status: AnnotationStatus, _response: string, _reviewId: string | null): Promise<boolean> => false,
    privacyPreview: (value: string) => value,
  });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({}); t.after(() => app.unmount());
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, item: props.items[0]!, draft: () => setup.drafts[setup.key(props.items[0]!)]! };
}

test('failed ignore restores the saved status and preserves the unsaved response for another attempt', async t => {
  const { props, setup, item, draft } = mount(t);
  draft().response = 'Unsaved answer to retain.';
  draft().status = 'ignored';
  await setup.save(item);
  assert.equal(draft().status, 'resolved');
  assert.equal(draft().response, 'Unsaved answer to retain.');
  assert.equal(draft().reviewId, 'review-1');
  assert.equal(draft().failedStatus, 'ignored');
  assert.equal(draft().partialFailure, false);
  assert.equal(draft().saving, false);
  assert.match(setup.failureMessage(item), /Choose Ignored again to retry/);

  props.save = async (_id, status, response) => {
    props.items = [{ ...item, status, response, reviewId: 'review-2', included: false }];
    await nextTick();
    return true;
  };
  await nextTick();
  draft().status = 'ignored';
  await setup.save(item);
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().failed, false);
  assert.equal(draft().reviewId, 'review-2');
});

test('a failed feedback cancellation preserves a persisted ignored review and reports partial failure', async t => {
  const { props, setup, item, draft } = mount(t);
  props.save = async (_id, status, response) => {
    props.items = [{ ...item, status, response, reviewId: 'review-2', included: false }];
    await nextTick();
    return false;
  };
  await nextTick();
  draft().status = 'ignored';
  await setup.save(item);
  assert.equal(draft().status, 'ignored');
  assert.equal(draft().reviewId, 'review-2');
  assert.equal(draft().failed, true);
  assert.equal(draft().partialFailure, true);
  assert.match(setup.failureMessage(item), /previous feedback could not be cancelled/);
});

test('a rejected save retains the response and exits the saving state with a recovery message', async t => {
  const { props, setup, item, draft } = mount(t);
  props.save = async () => { throw { message: 'Synthetic network failure' }; };
  await nextTick();
  draft().response = 'Keep this answer.';
  draft().status = 'ignored';
  await setup.save(item);
  assert.equal(draft().status, 'resolved');
  assert.equal(draft().response, 'Keep this answer.');
  assert.equal(draft().failed, true);
  assert.equal(draft().saving, false);
  assert.doesNotMatch(setup.failureMessage(item), /\[object Object\]/);
});

test('typing keeps even open responses local until an explicit commit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  props.save = async (_id, status, response) => {
    writes.push(response);
    props.items = [{ ...item, status, response, reviewId: 'review-2' }];
    await nextTick();
    return true;
  };
  draft().status = 'open';
  draft().response = 'A draft answer without resolving the question.';
  await nextTick();
  t.mock.timers.tick(60_000);
  await nextTick();
  assert.deepEqual(writes, []);
  await setup.save(item);
  assert.deepEqual(writes, ['A draft answer without resolving the question.']);
  assert.equal(draft().status, 'open');
});

test('a completed request preserves newer typing and waits for its own commit', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  let finish!: () => void;
  props.save = async (_id, status, response) => {
    writes.push(response);
    await new Promise<void>(resolve => { finish = resolve; });
    props.items = [{ ...item, status, response, reviewId: 'review-' + (writes.length + 1) }];
    await nextTick();
    return true;
  };
  await nextTick();
  draft().response = 'First committed response.';
  const first = setup.save(item);
  draft().response = 'Newer typing remains local.';
  finish(); await first; await nextTick();
  assert.equal(draft().response, 'Newer typing remains local.');
  assert.equal(draft().reviewId, 'review-2');
  assert.deepEqual(writes, ['First committed response.']);
  const second = setup.flush();
  finish();
  assert.equal(await second, true);
  assert.deepEqual(writes, ['First committed response.', 'Newer typing remains local.']);
});

test('queued commits capture their exact snapshots and deduplicate repeated commits', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: { response: string; reviewId: string | null }[] = [];
  let finish!: () => void;
  props.save = async (_id, status, response, reviewId) => {
    writes.push({ response, reviewId });
    await new Promise<void>(resolve => { finish = resolve; });
    props.items = [{ ...item, status, response, reviewId: 'review-' + (writes.length + 1) }];
    await nextTick();
    return true;
  };
  await nextTick();
  draft().response = 'First snapshot.';
  const first = setup.save(item), duplicate = setup.save(item);
  assert.equal(first, duplicate);
  draft().response = 'Second snapshot.';
  const second = setup.save(item);
  draft().response = 'Uncommitted third draft.';
  finish(); await first; await nextTick();
  assert.deepEqual(writes, [{ response: 'First snapshot.', reviewId: 'review-1' }, { response: 'Second snapshot.', reviewId: 'review-2' }]);
  finish(); await second; await nextTick();
  assert.equal(draft().response, 'Uncommitted third draft.');
  assert.equal(draft().reviewId, 'review-3');
  assert.equal(writes.length, 2);
});

test('a commit made while disabled retains its captured text until saving becomes available', async t => {
  const { props, setup, item, draft } = mount(t);
  const writes: string[] = [];
  props.disabled = true;
  props.save = async (_id, status, response) => {
    writes.push(response);
    props.items = [{ ...item, status, response, reviewId: 'review-2' }];
    await nextTick(); return true;
  };
  await nextTick();
  draft().response = 'Commit before another operation finishes.';
  const saving = setup.save(item);
  draft().response = 'Typed while waiting.';
  await nextTick(); assert.deepEqual(writes, []);
  props.disabled = false;
  await nextTick(); await saving;
  assert.deepEqual(writes, ['Commit before another operation finishes.']);
  assert.equal(draft().response, 'Typed while waiting.');
});
