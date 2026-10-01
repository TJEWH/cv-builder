import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { Application } from '../src/cloudTypes';
import type { CvState, SavedConfiguration } from '../src/types';
import type { ApplicationLetter } from '../src/letterTypes';
import type { LocalRefinementRequest, RefinementProposalRow, RefinementRequestRow } from '../src/refinementTypes';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import { cloneCv, loadApplicationCv, type ApplicationCvRecord } from '../src/composables/applicationCv';
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { subvariantParent } from '../src/composables/careerVariants';
import { finalizeLetter } from '../src/composables/motivationLetters';
import { createRefinementFixture } from './refinementFixture';

const account = '90000000-0000-4000-8000-000000000001';
const applicationId = '10000000-0000-4000-8000-000000000001';
const refinementKey = `CV_REFINEMENT:1:${account}:${applicationId}`;
interface Workspace {
  record: ApplicationCvRecord | null; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; error: string; saveError: string;
  pendingBaseId: string; pendingSubId: string; selectedProposalId: string; manualProposalText: string;
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; localRequests: Record<string, LocalRefinementRequest>;
  selectedChangeIds: string[]; includeProposedLetter: boolean; reviewActive: boolean;
  previewCvState: CvState | null; previewLetterContent: ApplicationLetter['working'] | undefined;
  reviewAcceptanceError: string; letterText: string;
  assignBase(): void; useLetterTemplate(): Promise<void>; initialPrompt(): Promise<void>; checkProposals(): Promise<void>;
  importProposal(): void | Promise<void>; openProposal(): void; discardReview(): void; acceptSelectedChanges(): Promise<void>;
  persist(): void;
  approve(kind: 'cv' | 'letter', reopen?: boolean): Promise<void>;
  updateLetter(value: string): void; toggleProposedChange(id: string, included: boolean): void;
}

const filename = new URL('../src/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'refinement-workflow' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
  : path === '../lib/supabase' ? { supabaseConfiguration: { status: 'ready', url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }
    : requireComponent(path), componentExports);
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });

async function idle(workspace: Workspace) {
  for (let index = 0; index < 40; index++) {
    await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
    if (!workspace.busy && !workspace.refreshing) return;
  }
  assert.fail('Refinement workspace did not become idle.');
}

function mount(t: TestContext) {
  let unmount = () => {};
  t.after(() => unmount());
  const data = new Map<string, string>();
  const writes: { key: string; value: string }[] = [];
  let failNextWriteKey: string | null = null;
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      if (key === failNextWriteKey) { failNextWriteKey = null; throw new Error('Local storage quota reached.'); }
      data.set(key, value); writes.push({ key, value });
    }, removeItem: (key: string) => data.delete(key) };
  for (const [key, value] of Object.entries({ localStorage: storage, sessionStorage: storage,
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard: { writeText: async () => {} } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const base = cloneCv(createSampleDocument());
  const states = new Map([['base', base]]);
  const application: Application = { id: applicationId, user_id: account, opportunity_id: '20000000-0000-4000-8000-000000000001',
    context_json: { title: 'Robotics PhD' }, context_captured_at: new Date().toISOString(), cv_variant_id: null,
    completed_checklist_keys: [], status: 'shortlist', contact_email: null, notes: null, contacted_at: null, submitted_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const database: Record<string, Record<string, unknown>[]> = { applications: [{ ...application }], cv_variants: [] };
  const cloud = createRefinementFixture(database, account);
  let creationFails = false;
  const creations: { sourceId: string; id: string; state: CvState }[] = [];
  const props = reactive({ application, client: cloud.client, userId: account, lang: 'en', projectId: 'fixture',
    configurations: [{ id: 'base', name: 'Research' }] as SavedConfiguration[],
    readVersion: (id: string) => states.get(id) || null,
    publishCv: async (state: CvState) => {
      const snapshot = createCloudCvSnapshot(state);
      database.cv_variants.push({ ...snapshot, user_id: account });
      props.application = { ...props.application, cv_variant_id: snapshot.id };
      database.applications[0].cv_variant_id = snapshot.id;
      return props.application;
    },
    createSubvariant: (sourceId: string, name: string, state: CvState) => {
      if (creationFails) return null;
      const parentId = subvariantParent(sourceId, props.configurations);
      const id = `accepted-${creations.length + 1}`;
      states.set(id, cloneCv(state)); props.configurations.push({ id, name, parentId });
      creations.push({ sourceId, id, state: cloneCv(state) }); return id;
    },
  });
  const component = { ...componentExports.default, render: () => null };
  function open() {
    let mounted: unknown;
    const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
    app.mount({}); unmount = () => app.unmount();
    return (mounted as { $: { setupState: Workspace } }).$.setupState;
  }
  const setup = open();
  return { setup, props, states, base, storage, data, writes, database, cloud, creations,
    failCreation() { creationFails = true; }, failSave(key: string) { failNextWriteKey = key; }, reopen() { unmount(); return open(); } };
}

async function prepare(fixture: ReturnType<typeof mount>, sourceId = 'base') {
  const { setup } = fixture;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.pendingSubId = sourceId === 'base' ? '' : sourceId;
  setup.assignBase(); await idle(setup); await setup.useLetterTemplate();
  setup.updateLetter('Original private working letter.'); await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  return setup;
}
const documents = (setup: Workspace) => JSON.stringify({ record: setup.record, letter: setup.letter });

test('manual proposal import activates the complete temporary candidate without a cloud write or document save', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Imported proposed letter.' });
  fixture.database.application_refinement_proposals = [];
  const savedDocuments = documents(setup), savedPrivate = JSON.stringify(setup.localRequests), savedCloud = JSON.stringify(fixture.database);
  setup.manualProposalText = JSON.stringify(incoming.proposal_json);
  await setup.importProposal(); await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.reviewActive, true);
  assert.ok(setup.selectedProposalId);
  assert.notDeepEqual(setup.previewCvState?.bodyOrder, setup.record?.state.bodyOrder);
  assert.equal(setup.previewLetterContent?.body, 'Imported proposed letter.');
  assert.equal(documents(setup), savedDocuments);
  assert.equal(JSON.stringify(setup.localRequests), savedPrivate);
  assert.equal(JSON.stringify(fixture.database), savedCloud);
});

test('refreshing proposal history preserves the active proposal and its selection when a newer return arrives', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First proposal under review.' });
  await setup.checkProposals();
  setup.toggleProposedChange(setup.selectedChangeIds[0], false);
  const selection = [...setup.selectedChangeIds], candidate = JSON.stringify(setup.previewCvState);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'New proposal waiting in history.' });
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.equal(setup.proposals.length, 2);
  assert.equal(setup.selectedProposalId, first.id);
  assert.deepEqual(setup.selectedChangeIds, selection);
  assert.equal(JSON.stringify(setup.previewCvState), candidate);
  assert.equal(setup.previewLetterContent?.body, 'First proposal under review.');
});

test('accepting a subvariant proposal creates one sibling with exactly the reviewed content, including after reload', async t => {
  const fixture = mount(t);
  const source = cloneCv(fixture.base); source.about.text += '\nA manually tailored source sentence.';
  fixture.states.set('source-child', source);
  fixture.props.configurations.push({ id: 'source-child', name: 'Tailored source', parentId: 'base' });
  let setup = await prepare(fixture, 'source-child');
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Accepted reviewed letter.' });
  await setup.checkProposals();
  const candidate = cloneCv(setup.previewCvState!), privateBefore = JSON.stringify(setup.localRequests[proposal.proposal_json.requestId].cv);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1);
  const created = fixture.creations[0];
  assert.equal(fixture.props.configurations.find(item => item.id === created.id)?.parentId, 'base');
  assert.deepEqual(created.state, candidate);
  assert.deepEqual(setup.record?.state, candidate);
  assert.equal(setup.record?.variantId, created.id);
  assert.equal(setup.letterText, 'Accepted reviewed letter.');
  assert.deepEqual(fixture.states.get('source-child'), source);
  assert.equal(JSON.stringify(setup.localRequests[proposal.proposal_json.requestId].cv), privateBefore);
  assert.deepEqual(loadApplicationCv(account, applicationId)?.state, candidate);
  const acceptedDocuments = documents(setup);
  setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 1);
  assert.equal(documents(setup), acceptedDocuments);
  setup = fixture.reopen(); await idle(setup); setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 1, 'a local acceptance receipt prevents duplicate subvariants after reload');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(acceptedDocuments));
});

test('subvariant creation failure leaves both application documents intact and review retryable', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Letter that must not be partially accepted.' });
  await setup.checkProposals(); const before = documents(setup);
  fixture.failCreation(); await setup.acceptSelectedChanges();
  assert.match(setup.error, /variant|save/i);
  assert.equal(documents(setup), before);
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.reviewActive, true);
});

test('a working edit during decision recording prevents either candidate document from being committed', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const originalLetter = JSON.stringify(setup.letter);
  const client = fixture.props.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
  const originalRpc = client.rpc.bind(client);
  client.rpc = async (name, args) => {
    const result = await originalRpc(name, args);
    if (name === 'save_refinement_review' && args.p_kind === 'cv_decisions') setup.record!.state.about.text = 'A manual edit arrived while saving.';
    return result;
  };
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /changed|conflict/i);
  assert.equal(setup.record?.state.about.text, 'A manual edit arrived while saving.');
  assert.equal(JSON.stringify(setup.letter), originalLetter);
  assert.equal(fixture.creations.length, 0);
  assert.equal(setup.reviewActive, true);
});

test('a finalized letter is not replaced merely because its cloud approval flag is absent', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  setup.letter = finalizeLetter(setup.letter!, setup.letter!.workingContext, setup.record!.state.contact);
  const finalBefore = JSON.stringify(setup.letter);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Replacement for a finalized letter.' });
  await setup.checkProposals();
  assert.equal(setup.previewLetterContent?.body, 'Replacement for a finalized letter.');
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /final|reopen/i);
  assert.equal(JSON.stringify(setup.letter), finalBefore);
  assert.equal(fixture.creations.length, 0);
  const finalized = structuredClone(JSON.parse(finalBefore) as ApplicationLetter);
  setup.discardReview();
  await setup.approve('letter', true);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.finalRevisionId, null);
  setup.openProposal();
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Replacement for a finalized letter.');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter!.revisions.find(item => item.id === finalized.finalRevisionId))), finalized.revisions.find(item => item.id === finalized.finalRevisionId), 'explicit reopening preserves the finalized revision in history');
});

test('a failed local commit restores both documents and reuses its completed subvariant when retried', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed document pair.' });
  await setup.checkProposals();
  const before = documents(setup), savedBefore = new Map(fixture.data);
  fixture.failSave(`cv.letters.v1:${account}:application:${applicationId}`);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /Local storage quota reached/);
  assert.equal(documents(setup), before);
  for (const [key, value] of savedBefore) assert.equal(fixture.storage.getItem(key), value, `${key} must be rolled back`);
  assert.equal(setup.reviewActive, true);
  assert.equal(fixture.creations.length, 1, 'only a complete validated subvariant can have been saved');
  setup.persist();
  assert.equal(setup.saveError, '');
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(fixture.creations.length, 1, 'retry must reuse the complete candidate already in the library');
  assert.equal(setup.record?.variantId, fixture.creations[0].id);
  assert.equal(setup.letterText, 'Proposed document pair.');
});

test('accepting a manually imported proposal commits locally and persists its idempotent receipt across reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture);
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Locally accepted imported proposal.' });
  fixture.database.application_refinement_proposals = [];
  const beforeCloud = JSON.stringify(fixture.database);
  setup.manualProposalText = JSON.stringify(incoming.proposal_json); await setup.importProposal(); await idle(setup);
  const proposalId = setup.selectedProposalId, previewState = cloneCv(setup.previewCvState!);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record?.state, previewState);
  assert.equal(setup.letterText, 'Locally accepted imported proposal.');
  assert.equal(JSON.stringify(fixture.database), beforeCloud);
  assert.equal(fixture.creations.length, 1);
  assert.ok(JSON.parse(fixture.storage.getItem(refinementKey)!).requests[incoming.proposal_json.requestId].acceptances.some((receipt: { proposalId: string }) => receipt.proposalId === proposalId));
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.selectedProposalId, proposalId);
  setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(fixture.creations.length, 1);
  assert.equal(JSON.stringify(fixture.database), beforeCloud);
});
