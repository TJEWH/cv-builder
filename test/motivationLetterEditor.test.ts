import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../src/cloudTypes';
import type { ApplicationLetter } from '../src/letterTypes';
import type { PublishDraftingInput } from '../src/draftingTypes';
import { prepareDraftingContext } from '../src/composables/cloudDrafting';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import { stub } from './helpers';

const filename = new URL('../src/components/MotivationLetterEditor.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'motivation-letter-editor-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireFromComponent(path), exports);
const component = { ...exports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

test('replacing the application with its same-ID published CV preserves the in-flight context and local letter', async (t) => {
  const storage = new Map<string, string>();
  let unmount = () => {};
  t.after(() => unmount());
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    window: { addEventListener() {}, removeEventListener() {} },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const application: Application = {
    id: 'application-one', user_id: 'owner', opportunity_id: 'opportunity-one', cv_variant_id: null, contact_email: null,
    context_json: { title: 'Research engineer', requirements: ['Robotics'] }, context_captured_at: '2026-09-20T12:00:00Z',
    completed_checklist_keys: [], status: 'shortlist', notes: null, contacted_at: null, submitted_at: null,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  };
  const cvState = createSampleDocument();
  let finishPublish!: (value: Application) => void;
  const pendingCv = new Promise<Application>((resolve) => { finishPublish = resolve; });
  let rpcCalls = 0;
  const client = stub<SupabaseClient>({
    rpc: async (_name: string, args: { p_context_id: string; p_template: PublishDraftingInput['template']; p_language: string; p_instructions: string; p_max_words: number }) => {
      rpcCalls++;
      return { error: null, data: {
        id: args.p_context_id, user_id: 'owner', application_id: application.id, cv_variant_id: 'snapshot-one', created_at: '2026-09-20T13:00:00Z',
        context_json: prepareDraftingContext({ application: { ...application, cv_variant_id: 'snapshot-one' }, cvState,
          template: args.p_template, language: args.p_language, instructions: args.p_instructions, maxWords: args.p_max_words }),
      } };
    },
  });
  const props = reactive({ application, cvState, client, userId: 'owner', lang: 'en', publishCv: () => pendingCv });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({});
  unmount = () => app.unmount();
  const setup = (mounted as { $: { setupState: {
    record: ApplicationLetter; busy: boolean; error: string; publishedContextId: string; editorText: string;
    updateText(value: string): void; publishContext(): Promise<void>;
  } } }).$.setupState;
  setup.record.working = { subject: 'Research application', salutation: 'Dear committee,', body: 'Keep my manually edited letter.', closing: 'Kind regards,\n{{APPLICANT_NAME}}' };
  await nextTick();
  const completeText = '# Research application\n\nDear committee,\n\nKeep my manually edited letter.\n\nKind regards,\n{{APPLICANT_NAME}}';
  assert.equal(setup.editorText, completeText, 'the full editor includes every existing structured field');
  const editedText = completeText.replace('Research application', 'Robotics application').replace('Dear committee,', 'Dear Dr. Example,').replace('Kind regards,', 'Yours sincerely,');
  setup.updateText(editedText);
  const originalRecord = setup.record;
  const pending = setup.publishContext();
  assert.equal(setup.busy, true);
  props.application = { ...application, cv_variant_id: 'snapshot-one', updated_at: '2026-09-20T13:00:00Z' };
  await nextTick();
  assert.equal(setup.record, originalRecord, 'same application identity must not reload the local record');
  assert.equal(setup.busy, true, 'same-ID refresh must not cancel the context publication');
  finishPublish(props.application);
  await pending;
  assert.equal(rpcCalls, 1);
  assert.equal(setup.error, '');
  assert.equal(setup.record.working.subject, 'Robotics application');
  assert.equal(setup.record.working.body, 'Dear Dr. Example,\n\nKeep my manually edited letter.\n\nYours sincerely,\n{{APPLICANT_NAME}}');
  assert.equal(setup.editorText, editedText);
  assert.ok(setup.publishedContextId);
  assert.ok(setup.record.publishedContexts[setup.publishedContextId]);
});
