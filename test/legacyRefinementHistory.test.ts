import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, type Component } from 'vue';
import { createRefinementFixture } from './refinementFixture';

const filename = new URL('../src/components/LegacyRefinementHistory.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'legacy-history-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), componentExports);
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
const owner = '90000000-0000-4000-8000-000000000001', applicationId = '10000000-0000-4000-8000-000000000001', requestId = '20000000-0000-4000-8000-000000000001';
function mount(options: { unavailable?: string; wait?: Promise<void> } = {}) {
  const fields = [{ id: 'field-1', label: 'Profile', text: 'Existing research skills.' }];
  const row = { id: requestId, user_id: owner, application_id: applicationId, created_at: '2026-09-01T00:00:00Z' };
  const database = { applications: [],
    drafting_contexts: [{ ...row, cv_variant_id: 'old-cv', context_json: { schemaVersion: 1, cv: { snapshotId: 'old-cv', revision: 4 }, template: { name: 'Archived template', revision: 2 }, instructions: 'Archived instructions.' } }],
    motivation_letter_drafts: [{ ...row, context_id: requestId, body: 'Archived generated letter.' }],
    cv_adjustment_requests: [{ ...row, request_json: { schemaVersion: 1, requestId, fields, opportunity: {}, instructions: 'Earlier CV instruction.' } }],
    cv_adjustment_responses: [{ ...row, request_id: requestId, response_json: { schemaVersion: 1, requestId, edits: [] } }],
  };
  const fixture = createRefinementFixture(database, owner), before = JSON.stringify(database);
  const client = { from(table: string) {
    if (table === options.unavailable) throw new Error('Legacy table unavailable.');
    const query = fixture.from(table);
    if (options.wait) { const then = query.then; query.then = (resolve, reject) => options.wait!.then(() => then(resolve, reject)); }
    return query;
  }, rpc() { assert.fail('Viewing legacy history must not write to Supabase.'); } };
  let instance: any;
  const app = renderer.createApp({ render: () => h({ ...componentExports.default, render: () => null }, { client, userId: owner, applicationId, lang: 'en', letter: null, locked: true, ref: (value: unknown) => instance = value }) });
  app.mount({});
  const setup = instance.$.setupState;
  return { setup, app, unchanged: () => assert.equal(JSON.stringify(database), before) };
}
async function idle(setup: { busy: boolean }) {
  for (let count = 0; count < 20; count++) { await nextTick(); await new Promise<void>(resolve => setImmediate(resolve)); if (!setup.busy) return; }
  assert.fail('History did not finish loading.');
}
test('legacy history loads saved requests, drafts and responses without writes or current-setting substitution', async t => {
  const { setup, app, unchanged } = mount(); t.after(() => app.unmount()); await idle(setup);
  assert.equal(setup.error, ''); assert.equal(setup.contexts[0].context_json.template.revision, 2);
  assert.equal(setup.drafts[0].body, 'Archived generated letter.'); assert.equal(setup.cvRequests[0].request_json.instructions, 'Earlier CV instruction.');
  await setup.loadResponses(requestId); assert.equal(setup.responses[requestId].length, 1);
  assert.equal(setup.originalContext('missing'), undefined); assert.equal(setup.instructions(undefined), 'Unknown'); assert.equal(setup.instructions(''), 'None supplied');
  unchanged();
});
test('an unavailable legacy table keeps other history accessible and unmount rejects late reads', async t => {
  const first = mount({ unavailable: 'cv_adjustment_requests' }); t.after(() => first.app.unmount()); await idle(first.setup);
  assert.match(first.setup.error, /Some legacy history could not be loaded/);
  assert.equal(first.setup.contexts.length, 1); assert.equal(first.setup.drafts.length, 1); assert.equal(first.setup.cvRequests.length, 0); first.unchanged();
  let finish!: () => void;
  const late = mount({ wait: new Promise<void>(resolve => { finish = resolve; }) });
  late.app.unmount(); finish(); await idle(late.setup);
  assert.deepEqual(late.setup.contexts, []); assert.deepEqual(late.setup.drafts, []); assert.deepEqual(late.setup.cvRequests, []); late.unchanged();
});
