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
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../src/composables/motivationLetters';
import { createRefinementFixture } from './refinementFixture';
import type { ApplicationLetter } from '../src/letterTypes';
import type { LocalRefinementRequest, RefinementRequestRow, RefinementProposalRow, RefinementScope, RefinementSetup } from '../src/refinementTypes';

const account = '90000000-0000-4000-8000-000000000001';
const applicationId = '10000000-0000-4000-8000-000000000001';
interface WorkspaceSetup {
  record: ApplicationCvRecord | null; pendingBaseId: string; pendingSubId: string; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; error: string; saveError: string; letterText: string;
  pendingTemplateId: string; missingLetterTemplate: boolean;
  cvApproved: boolean; letterApproved: boolean; feedbackScope: RefinementScope; feedback: string;
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; selectedProposalId: string; prompt: string;
  shortInstruction: string; shortInstructionNotice: string; shortInstructionError: string;
  preparedSource: LocalRefinementRequest | null; sourceError: string;
  effectiveSettings: { setup: RefinementSetup; provenance: unknown };
  currentPublishedRequest: RefinementRequestRow | null; publishedSource: RefinementRequestRow | null;
  publicationStatus: 'unpublished' | 'current' | 'outdated' | 'unverifiable';
  assignBase(): void; importBackup(event: Event): Promise<void>; useLetterTemplate(): Promise<void>; saveSetup(): Promise<void>;
  initialPrompt(): Promise<void>; checkProposals(): Promise<void>; openProposal(): void;
  acceptSelectedChanges(): Promise<void>; toggleProposedChange(id: string, included: boolean): void; toggleProposedLetter(included: boolean): void; discardReview(): void;
  selectedChangeIds: string[]; includeProposedLetter: boolean; reviewActive: boolean; previewCvState: CvState | null;
  previewLetterContent: ApplicationLetter['working'] | undefined; temporaryReview: { result: { state: CvState; letterText: string } | null; error: string }; reviewAcceptanceError: string;
  proposalChanges: { id: string; type: string; status: 'proposed' | 'accepted' | 'rejected'; before: string; after: string; target: string }[];
  copyShortInstruction(): Promise<void>;
  updateLetter(text: string): void; approve(kind: 'cv' | 'letter', reopen?: boolean): Promise<void>; requestImprovement(): Promise<void>;
}
async function idle(setup: WorkspaceSetup) {
  for (let count = 0; count < 30; count++) {
    await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
    if (!setup.busy && !setup.refreshing) return;
  }
  assert.fail('Workspace did not become idle.');
}

const filename = new URL('../src/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'application-variant-selection' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
const requireFromComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
  : path === '../lib/supabase' ? { supabaseConfiguration: { status: 'ready', url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }
    : requireFromComponent(path), exports);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
function mount(t: TestContext, legacy?: 'unchanged' | 'tailored', missingLetterTemplate = false) {
  let unmount = () => {};
  t.after(() => unmount());
  const data = new Map<string, string>();
  const clipboardWrites: string[] = [];
  const clipboard = { writeText: async (value: string) => { clipboardWrites.push(value); } };
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  for (const [name, value] of Object.entries({ localStorage: storage, sessionStorage: storage,
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name));
  }
  const base = cloneCv(createSampleDocument());
  const states = new Map([['base', base]]);
  if (legacy) {
    const record = createApplicationCv(account, applicationId, 'base', 'Research', base);
    if (legacy === 'tailored') record.state.about.text = 'Previously tailored application';
    saveApplicationCv(record);
  }
  if (missingLetterTemplate) {
    const letter = createApplicationLetter(account, applicationId, { ...DEFAULT_LETTER_TEMPLATES[0]!, id: 'removed-template' }, { content: 'legacy', theme: 'legacy' });
    delete letter.templateSnapshot;
    letter.working = { subject: 'Existing subject', salutation: 'Dear committee,', body: 'My original letter must remain available.', closing: 'Kind regards' };
    createLetterRepository(storage, account).save(letter);
  }
  const application: Application = { id: applicationId, user_id: account, opportunity_id: '20000000-0000-4000-8000-000000000001',
    context_json: { title: 'Robotics PhD', required_documents: ['CV', 'Motivation letter (maximum 400 words)', 'Transcript of records'] }, context_captured_at: new Date().toISOString(),
    cv_variant_id: null, completed_checklist_keys: [], status: 'shortlist', contact_email: null, notes: null, contacted_at: null, submitted_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const database: Record<string, Record<string, unknown>[]> = { applications: [{ ...application }], cv_variants: [] };
  const cloud = createRefinementFixture(database, account);
  const props = reactive({
    application,
    client: cloud.client, userId: account, lang: 'en', projectId: 'fixture', configurations: [{ id: 'base', name: 'Research' }] as SavedConfiguration[],
    readVersion: (id: string) => states.get(id) || null,
    publishCv: async (state: CvState) => {
      const snapshot = createCloudCvSnapshot(state);
      database.cv_variants.push({ ...snapshot, user_id: account });
      props.application = { ...props.application, cv_variant_id: snapshot.id };
      database.applications[0].cv_variant_id = snapshot.id;
      return props.application;
    },
    createSubvariant: (source: string, name: string, state: CvState) => {
      const id = `child-${states.size}`;
      const parentId = props.configurations.find(item => item.id === source)?.parentId || source;
      states.set(id, cloneCv(state)); props.configurations.push({ id, name, parentId }); return id;
    },
  });
  const component = { ...exports.default, render: () => null };
  function mountComponent() {
    let mounted: unknown;
    const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
    app.mount({}); unmount = () => app.unmount();
    return (mounted as { $: { setupState: WorkspaceSetup } }).$.setupState;
  }
  const setup = mountComponent();
  const reopen = () => { unmount(); return mountComponent(); };
  return { setup, reopen, props, states, base, database, cloud, storage, clipboard, clipboardWrites };
}

test('applications freeze selected CVs and keep manual edits independent from the template library', async (t) => {
  const { setup, props, states, base, database } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.record?.variantId, 'base');
  assert.equal(setup.record?.detached, true);
  assert.equal(database.cv_variants.length, 1, 'selection publishes an anonymized snapshot');
  assert.ok(setup.record?.publishedSnapshotId);
  assert.equal(states.size, 1);
  const edited = cloneCv(base); edited.about.text = 'Edited in CV Studio'; states.set('base', edited);
  props.configurations = [{ id: 'base', name: 'Research', mtime: 2 }];
  await nextTick();
  assert.equal(setup.record?.state.about.text, base.about.text, 'library updates cannot overwrite the application snapshot');
  setup.record!.state.about.text = 'Tailored manually for this application';
  await nextTick();
  assert.equal(states.get('base')?.about.text, 'Edited in CV Studio');
  assert.equal(states.size, 1, 'application edits never create library subvariants automatically');
  assert.equal(loadApplicationCv(account, applicationId)?.state.about.text, 'Tailored manually for this application');
});

test('tailored legacy application CVs remain intact as independent copies', async (t) => {
  const { setup, states } = mount(t, 'tailored');
  await idle(setup);
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.record?.detached, true);
  assert.equal(setup.record?.state.about.text, 'Previously tailored application');
  assert.equal(states.size, 1);
});

test('unchanged legacy application copies stay pinned instead of rejoining their original variant', async (t) => {
  const { setup, states } = mount(t, 'unchanged');
  await idle(setup);
  assert.equal(setup.record?.variantId, undefined);
  assert.equal(setup.record?.detached, true);
  assert.equal(states.size, 1);
});

test('legacy letters whose original template is missing require an explicit replacement without losing wording', async (t) => {
  const { setup, database } = mount(t, 'unchanged', true);
  await idle(setup);
  const original = JSON.parse(JSON.stringify(setup.letter));
  assert.equal(setup.missingLetterTemplate, true);
  assert.equal(setup.pendingTemplateId, '');
  await assert.rejects(setup.saveSetup(), /original letter template is unavailable.*Use letter template/);
  assert.equal(database.cv_variants.length, 0, 'missing template blocks publishing preparation');
  assert.equal(database.application_refinement_state.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter)), original, 'failed setup keeps the entire legacy record intact');
  setup.pendingTemplateId = 'research';
  await setup.useLetterTemplate();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.missingLetterTemplate, false);
  assert.equal(setup.letter?.templateSnapshot?.id, 'research');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter?.working)), original.working);
  assert.equal(database.application_refinement_state.length, 1, 'explicit replacement can be saved normally');
});

test('restored backups stay detached even when unchanged from their historical base', async (t) => {
  const { setup, props, states, base } = mount(t);
  await idle(setup);
  const backup = createApplicationCv(account, applicationId, 'base', 'Research', base);
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
  const reloaded = loadApplicationCv(account, applicationId);
  assert.equal(reloaded?.detached, true, 'detachment survives a page reload');
  assert.equal(reloaded?.state.about.text, base.about.text);
  setup.pendingBaseId = 'base'; setup.assignBase();
  await idle(setup);
  assert.equal(setup.record?.variantId, 'base', 'explicit reassignment adopts the current variant');
  assert.equal(setup.record?.state.about.text, updated.about.text);
});

test('library autosaves do not reset pending variant and subvariant selections', async (t) => {
  const { setup, props, states, base } = mount(t);
  await idle(setup);
  states.set('other', cloneCv(base)); states.set('other-child', cloneCv(base));
  props.configurations.push({ id: 'other', name: 'Other path' }, { id: 'other-child', name: 'Other application', parentId: 'other' });
  setup.pendingBaseId = 'base'; setup.assignBase();
  await idle(setup);
  setup.pendingBaseId = 'other'; setup.pendingSubId = 'other-child';
  const updated = cloneCv(base); updated.about.text = 'Saved while choosing another CV';
  states.set('base', updated);
  props.configurations = props.configurations.map(item => ({ ...item, mtime: 20 }));
  await nextTick();
  assert.equal(setup.record?.state.about.text, base.about.text, 'the application still uses its frozen CV snapshot');
  assert.equal(setup.pendingBaseId, 'other');
  assert.equal(setup.pendingSubId, 'other-child');
  setup.assignBase();
  await idle(setup);
  assert.equal(setup.record?.variantId, 'other-child');
});

test('refinement preserves manual fixes and accumulates letter-only feedback while retaining CV approval', async (t) => {
  const { setup, states, database, cloud } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.letter!.maxWords = 400;
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.match(setup.prompt, /private\.read_refinement_request/);
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].request_json.letter.maxWords, 400);
  const firstProposal = cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals(); setup.selectedProposalId = firstProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(states.size, 1);
  assert.ok(setup.letterText.includes('Human-Centred Robotics'));
  setup.record!.state.about.text += '\nManual CV correction retained.';
  setup.updateLetter(setup.letterText + '\n\nManual letter correction retained.');
  await nextTick();
  await setup.approve('cv');
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true);
  assert.equal(setup.feedbackScope, 'letter');
  setup.feedback = 'Avoid generic claims and retain my manual corrections.';
  await setup.requestImprovement();
  assert.equal(setup.error, '');
  const second = setup.requests[0];
  assert.equal(second.request_json.scope, 'letter');
  assert.equal(second.request_json.feedback.length, 1);
  assert.ok(second.request_json.letter.text.includes('Manual letter correction retained.'));
  assert.ok(second.request_json.cv.fields.some(field => field.text.includes('Manual CV correction retained.')));
  const secondProposal = cloud.seedProposal(second.id);
  assert.deepEqual(secondProposal.proposal_json.schemaVersion === 2 ? secondProposal.proposal_json.cvOperations : secondProposal.proposal_json.cvEdits, []);
  await setup.checkProposals(); setup.selectedProposalId = secondProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true, 'letter-only revisions preserve CV approval');
  setup.feedback = 'Keep the closing concise as well.';
  await setup.requestImprovement();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.feedback.length, 2);
  const thirdProposal = cloud.seedProposal(setup.requests[0].id, { overLimit: true });
  await setup.checkProposals(); setup.selectedProposalId = thirdProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  await setup.approve('letter');
  assert.equal(setup.error, '', 'word count is advisory and does not block approval');
  assert.equal(setup.cvApproved, true);
  assert.equal(setup.letterApproved, true);
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 2);
  setup.updateLetter(setup.letterText + '\nA further manual change.');
  await nextTick();
  assert.equal(setup.letterApproved, false, 'changing an approved letter reopens its review');
  assert.equal(setup.cvApproved, true);
});

test('an unchanged returned letter preserves private wording and its approval when a joint proposal changes the CV', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  const originalText = `Dear selection committee,\n\nI am interested in the advertised research.\n\nKind regards,\n${setup.record!.state.contact.name}`;
  setup.updateLetter(originalText);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const request = setup.requests[0];
  assert.equal(request.request_json.scope, 'both');
  assert.notEqual(request.request_json.letter.text, originalText, 'published identity is anonymized');
  await setup.approve('letter');
  assert.equal(setup.letterApproved, true);
  const approved = JSON.stringify(setup.letter);
  const proposed = cloud.seedProposal(request.id, { letterText: request.request_json.letter.text });
  await setup.checkProposals(); setup.selectedProposalId = proposed.id; setup.openProposal(); await setup.acceptSelectedChanges();
  await nextTick();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, originalText, 'an unchanged public letter must not replace its private local wording');
  assert.equal(setup.letterApproved, true, 'a CV-only content change retains letter approval');
  assert.equal(JSON.stringify(setup.letter), approved, 'unchanged approved letters retain their exact final revision and history');
});

test('invalid letter content in a combined backup leaves the application CV and letter untouched', async (t) => {
  const { setup, base } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('Existing letter that must survive an invalid backup.');
  setup.record!.state.about.text = 'Existing application CV that must survive.';
  await nextTick();
  const beforeRecord = JSON.stringify(setup.record);
  const beforeLetter = JSON.stringify(setup.letter);
  const incomingCv = createApplicationCv(account, applicationId, 'base', 'Incoming backup', base);
  incomingCv.state.about.text = 'This incoming CV must never be partially restored.';
  const backup = { kind: 'application-refinement-backup', version: 1, record: incomingCv, letter: { ...setup.letter, working: null } };
  const input = { value: 'broken-backup.json', files: [{ size: 500, text: async () => JSON.stringify(backup) }] };
  await setup.importBackup({ target: input } as unknown as Event);
  assert.match(setup.error, /letter content/i);
  assert.equal(JSON.stringify(setup.record), beforeRecord);
  assert.equal(JSON.stringify(setup.letter), beforeLetter);
  assert.deepEqual(loadApplicationCv(account, applicationId), JSON.parse(beforeRecord), 'failed restore must preserve the saved CV as well');
});

test('requesting improvements never applies an unopened proposal over newer manual corrections', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('A manually drafted letter before the request.');
  await setup.initialPrompt();
  const proposed = cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals(); setup.selectedProposalId = proposed.id;
  setup.discardReview();
  setup.updateLetter('Newer manual correction must be the starting point.');
  setup.record!.state.about.text += '\nNewer CV correction.';
  setup.feedback = 'Keep my updated wording and make the closing more precise.';
  await setup.requestImprovement();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Newer manual correction must be the starting point.');
  assert.equal(setup.requests[0].request_json.letter.text, setup.letterText);
  assert.ok(setup.requests[0].request_json.cv.fields.some(field => field.text.includes('Newer CV correction.')));
  assert.equal(setup.requests[0].request_json.feedback.length, 1);
});

test('superseded feedback rounds remain viewable but cannot replace documents with the same baseline', async (t) => {
  const { setup, cloud } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('The current manual letter stays unchanged until I open an eligible proposal.');
  await setup.initialPrompt();
  const firstRequest = setup.requests[0];
  const olderProposal = cloud.seedProposal(firstRequest.id);
  await setup.checkProposals(); setup.selectedProposalId = olderProposal.id;
  const baselineCv = JSON.stringify(setup.record!.state);
  const baselineLetter = JSON.stringify(setup.letter);

  // Feedback alone supersedes the request: the CV and letter baseline remains identical.
  setup.discardReview();
  setup.feedback = 'Do not use the generic opening from the previous proposal.';
  await setup.requestImprovement();
  assert.equal(setup.error, '');
  const currentRequest = setup.requests[0];
  assert.notEqual(currentRequest.id, firstRequest.id);
  assert.equal(currentRequest.request_json.feedback.length, 1);
  assert.deepEqual(currentRequest.request_json.cv.fields, firstRequest.request_json.cv.fields);
  assert.equal(currentRequest.request_json.letter.text, firstRequest.request_json.letter.text);
  setup.selectedProposalId = olderProposal.id;
  setup.openProposal();
  assert.equal(setup.error, '', 'historical proposal previews remain available');
  assert.match(setup.reviewAcceptanceError, /superseded round/);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /superseded round/);
  assert.equal(JSON.stringify(setup.record!.state), baselineCv);
  assert.equal(JSON.stringify(setup.letter), baselineLetter);
  assert.ok(setup.proposals.some(item => item.id === olderProposal.id), 'the older proposal remains in review history');

  const currentProposal = cloud.seedProposal(currentRequest.id);
  await setup.checkProposals(); setup.selectedProposalId = currentProposal.id; setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '', 'the current proposal is still eligible for explicit application');
});

test('copying the short instruction follows server code and scope changes without publishing preparation or requests', async (t) => {
  const { setup, props, database, clipboardWrites } = mount(t);
  await idle(setup);
  const before = JSON.stringify(database);
  assert.equal(setup.shortInstruction, `phd-workflow: ${applicationId} — refine both.`);
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), setup.shortInstruction);
  assert.ok(setup.shortInstructionNotice);
  assert.equal(setup.shortInstructionError, '');

  props.application = { ...props.application, application_code: 'SERVER-CaseSensitive_29' };
  setup.feedbackScope = 'cv'; await nextTick();
  assert.equal(setup.shortInstruction, 'phd-workflow: SERVER-CaseSensitive_29 — refine CV.');
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), 'phd-workflow: SERVER-CaseSensitive_29 — refine CV.');

  props.application = { ...props.application, context_json: { ...props.application.context_json, title: 'A renamed PhD opportunity' } };
  setup.feedbackScope = 'letter'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), 'phd-workflow: SERVER-CaseSensitive_29 — refine motivation letter.');
  assert.equal(JSON.stringify(database), before, 'copying must not save setup, publish snapshots, or start a refinement round');
  assert.equal(setup.requests.length, 0);
  assert.equal(setup.prompt, '', 'copying the short instruction is independent of generating the full protocol prompt');
});

test('clipboard failures remain local to the short instruction and can be retried without cloud mutations', async (t) => {
  const { setup, database, clipboard, clipboardWrites } = mount(t);
  await idle(setup);
  const before = JSON.stringify(database);
  setup.error = 'Existing application synchronization error.';
  clipboard.writeText = async () => { throw new Error('Clipboard permission denied.'); };
  await setup.copyShortInstruction();
  assert.ok(setup.shortInstructionError);
  assert.equal(setup.shortInstructionNotice, '');
  assert.equal(setup.error, 'Existing application synchronization error.');
  assert.equal(JSON.stringify(database), before);

  clipboard.writeText = async (value: string) => { clipboardWrites.push(value); };
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), setup.shortInstruction);
  assert.equal(setup.shortInstructionError, '');
  assert.ok(setup.shortInstructionNotice);
  assert.equal(JSON.stringify(database), before);
});

test('publishing an initial round uses the same selected scope as the copied short instruction', async (t) => {
  const { setup, clipboardWrites } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.feedbackScope = 'letter'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), `phd-workflow: ${applicationId} — refine motivation letter.`);
  assert.equal(setup.requests.length, 0, 'copy alone must not publish the selected scope');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.scope, 'letter');
  const firstRequestId = setup.requests[0].id;

  setup.feedbackScope = 'cv'; await nextTick();
  await setup.copyShortInstruction();
  assert.equal(clipboardWrites.at(-1), `phd-workflow: ${applicationId} — refine CV.`);
  assert.equal(setup.requests[0].id, firstRequestId, 'a different copy selection still must not mutate the published round');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.scope, 'cv');
  assert.notEqual(setup.requests[0].id, firstRequestId, 'a scope change requires its own immutable request');
});

test('published sources contain the complete private-filtered working letter and effective application settings', async (t) => {
  const { setup } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.record!.state.contact.name = 'Dr Ada Example';
  setup.record!.state.contact.email = 'ada.private@example.org';
  setup.letter!.language = 'de';
  setup.letter!.maxWords = 400;
  setup.letter!.instructions = 'Focus on experiments; contact ada.private@example.org. Omit !!private instruction!!.';
  setup.letter!.templateSnapshot!.exampleText = 'Reference opening for Dr Ada Example. !!private example!!';
  const completeLetter = '# A specific research application\n\nDear committee,\n\n'
    + 'A documented experiment demonstrates careful research. '.repeat(320)
    + '\n\nKeep this final paragraph intact. Contact ada.private@example.org. !!confidential detail!!\n\nKind regards,\nDr Ada Example';
  setup.updateLetter(completeLetter);
  const privateWorking = JSON.stringify(setup.letter!.working);
  assert.equal(setup.sourceError, '');
  assert.equal(setup.effectiveSettings.setup.language, 'de');
  assert.equal(setup.effectiveSettings.setup.maxWords, 400);
  const sourcePreview = setup.preparedSource!.request;
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const request = setup.requests[0].request_json;
  assert.equal(request.letter.text, setup.letterText
    .replaceAll('ada.private@example.org', '{{APPLICANT_EMAIL}}')
    .replaceAll('Dr Ada Example', '{{APPLICANT_NAME}}')
    .replace('!!confidential detail!!', '{{CONFIDENTIAL}}'));
  assert.ok(request.letter.text.includes('Keep this final paragraph intact.'), 'the complete working letter is published, not an excerpt');
  assert.equal(request.letter.language, 'de');
  assert.equal(request.letter.maxWords, 400);
  assert.notEqual(request.letter.language, request.letter.template.language, 'application language overrides the template default');
  assert.equal(request.cv.instructions, 'Focus on experiments; contact {{APPLICANT_EMAIL}}. Omit {{CONFIDENTIAL}}.');
  assert.equal(request.letter.template.exampleText, 'Reference opening for {{APPLICANT_NAME}}. {{CONFIDENTIAL}}');
  assert.deepEqual(request.letter, sourcePreview.letter, 'the source overview matches the letter/settings actually published');
  assert.deepEqual(request.cv.fields, sourcePreview.cv.fields);
  assert.equal(request.cv.instructions, sourcePreview.cv.instructions);
  assert.equal(JSON.stringify(setup.letter!.working), privateWorking, 'publication never rewrites private working text');
});

test('reopening and refreshing preserve the saved working documents without publishing or applying proposals', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('The local working letter that survives reopening.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  fixture.cloud.seedProposal(setup.requests[0].id);
  setup.updateLetter('A newer local correction, independent of the pending proposal.');
  setup.record!.state.about.text += '\nA newer local CV correction.';
  await nextTick();
  const documents = JSON.stringify({ cv: setup.record, letter: setup.letter });
  const database = JSON.stringify(fixture.database);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.deepEqual(JSON.parse(JSON.stringify({ cv: setup.record, letter: setup.letter })), JSON.parse(documents));
  assert.equal(JSON.stringify(fixture.database), database, 'opening an application is read-only in the cloud');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.proposals.length, 1, 'a returned proposal remains available for explicit review');
  await setup.checkProposals();
  assert.equal(setup.error, '');
  assert.deepEqual(JSON.parse(JSON.stringify({ cv: setup.record, letter: setup.letter })), JSON.parse(documents));
  assert.equal(JSON.stringify(fixture.database), database, 'refreshing must not publish another request or change settings');
});

test('publishing unchanged current sources reuses the same request without cloud mutations after reopening', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('The unchanged letter to reuse for the published round.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const originalRequest = JSON.stringify(setup.requests[0]);
  const originalPrompt = setup.prompt;
  const database = JSON.stringify(fixture.database);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(setup.requests[0]), originalRequest);
  assert.equal(setup.prompt, originalPrompt);
  assert.equal(JSON.stringify(fixture.database), database, 'reusing a request must not increment the state revision or republish snapshots');
  setup = fixture.reopen();
  await idle(setup);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(setup.requests[0]), originalRequest);
  assert.equal(setup.prompt, originalPrompt);
  assert.equal(JSON.stringify(fixture.database), database);
});

test('changes mark the published source outdated without changing its immutable receipt', async (t) => {
  const { setup, database } = mount(t);
  await idle(setup);
  assert.equal(setup.publicationStatus, 'unpublished');
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  const originalText = 'Current letter with deliberate wording.';
  setup.updateLetter(originalText);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.publicationStatus, 'current');
  const receipt = JSON.stringify(setup.publishedSource);
  const cloudBefore = JSON.stringify(database);

  setup.updateLetter(originalText + '\nA local amendment.');
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  setup.updateLetter(originalText);
  assert.equal(setup.publicationStatus, 'current');

  const originalLanguage = setup.letter!.language;
  setup.letter!.language = originalLanguage === 'de' ? 'en' : 'de';
  assert.equal(setup.publicationStatus, 'outdated');
  setup.letter!.language = originalLanguage;
  setup.feedbackScope = 'cv';
  assert.equal(setup.publicationStatus, 'outdated');
  setup.feedbackScope = 'both';
  assert.equal(setup.publicationStatus, 'current');
  setup.letter!.instructions = 'Add more emphasis on reproducible experiments.';
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  assert.equal(JSON.stringify(database), cloudBefore, 'source changes remain local until explicitly published');
});

test('proposal selection and explicit application keep the published source separate from returned drafts', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('My published source letter.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const request = setup.requests[0];
  const first = cloud.seedProposal(request.id, { letterText: 'First returned draft.' });
  const second = cloud.seedProposal(request.id, { letterText: 'Second returned draft.' });
  await setup.checkProposals();
  const receipt = JSON.stringify(setup.publishedSource);
  const sourceRows = JSON.stringify(database.application_refinement_requests);
  const documents = JSON.stringify({ cv: setup.record, letter: setup.letter });
  setup.selectedProposalId = first.id;
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  setup.selectedProposalId = second.id;
  assert.equal(JSON.stringify({ cv: setup.record, letter: setup.letter }), documents, 'selecting a proposal is read-only');
  assert.equal(setup.currentPublishedRequest?.id, request.id);
  assert.equal(setup.publishedSource?.request_json.letter.text, 'My published source letter.');
  setup.openProposal(); await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, 'Second returned draft.');
  assert.equal(setup.preparedSource?.request.letter.text, 'Second returned draft.');
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(setup.publishedSource), receipt);
  assert.equal(JSON.stringify(database.application_refinement_requests), sourceRows);
});

test('reopening preserves a deliberately empty local working letter instead of restoring old source text', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('An older source letter already published.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  setup.updateLetter('');
  const before = JSON.stringify(fixture.database);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, '');
  assert.equal(setup.publicationStatus, 'outdated');
  assert.equal(JSON.stringify(fixture.database), before);
});

test('a missing local letter is restored from the complete published source without creating a request', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter(`The source text remains available when this device has no letter.\n\nKind regards,\n${setup.record!.state.contact.name}`);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const sourceText = setup.requests[0].request_json.letter.text;
  assert.notEqual(sourceText, setup.letterText, 'the saved source has identity placeholders');
  const before = JSON.stringify(fixture.database);
  fixture.storage.removeItem(`cv.letters.v1:${account}:application:${applicationId}`);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letterText, sourceText, 'restoration uses the full saved letter, not an empty template');
  assert.equal(setup.requests.length, 1);
  assert.equal(JSON.stringify(fixture.database), before);
});

test('an unreadable local letter is reported and preserved instead of being replaced by cloud source text', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('Published letter before a local storage problem.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const before = JSON.stringify(fixture.database);
  const key = `cv.letters.v1:${account}:application:${applicationId}`;
  const refinementKey = `CV_REFINEMENT:1:${account}:${applicationId}`;
  const savedRefinement = fixture.storage.getItem(refinementKey);
  const unreadable = '{"working":"recoverable unfinished local text"';
  fixture.storage.setItem(key, unreadable);
  setup = fixture.reopen();
  await idle(setup);
  await setup.checkProposals();
  assert.ok(setup.saveError, 'a local read error must remain visible');
  assert.equal(setup.letter, null);
  assert.equal(fixture.storage.getItem(key), unreadable, 'cloud loading cannot overwrite recoverable local data');
  assert.equal(fixture.storage.getItem(refinementKey), savedRefinement, 'a failed load cannot discard saved private request bindings');
  assert.equal(JSON.stringify(fixture.database), before);
});

test('reverting to an older published baseline creates a new current request instead of reviving its old round', async (t) => {
  const { setup, database } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('Baseline A: retain this exact wording.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const first = JSON.parse(JSON.stringify(setup.requests[0])) as RefinementRequestRow;
  setup.updateLetter('Baseline B: a later deliberate revision.');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const second = setup.requests[0];
  assert.notEqual(second.id, first.id);
  setup.updateLetter('Baseline A: retain this exact wording.');
  assert.equal(setup.publicationStatus, 'outdated');
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const third = setup.requests[0];
  assert.notEqual(third.id, first.id, 'an old immutable round cannot become current again through idempotent replay');
  assert.notEqual(third.id, second.id);
  assert.equal(third.request_json.letter.text, first.request_json.letter.text);
  assert.equal(setup.requests.length, 3);
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(setup.currentPublishedRequest?.id, third.id);
  assert.equal(database.application_refinement_state[0].current_request_id, third.id);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.requests.find(item => item.id === first.id))), first);
});

test('a cold reopen retains a letter-only published scope and reuses its current request', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate();
  setup.updateLetter('A letter-only round selected without locking the CV.');
  setup.feedbackScope = 'letter';
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  const requestId = setup.requests[0].id;
  const before = JSON.stringify(fixture.database);
  setup = fixture.reopen();
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.feedbackScope, 'letter');
  assert.equal(setup.publicationStatus, 'current');
  assert.equal(setup.currentPublishedRequest?.id, requestId);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(JSON.stringify(fixture.database), before);
});


test('loaded structured changes immediately preview without accepting, and each toggle updates only temporary state', async (t) => {
  const { setup, cloud, database, base, storage } = mount(t);
  await idle(setup);
  setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup);
  await setup.useLetterTemplate(); setup.updateLetter('Existing local letter.'); await setup.initialPrompt();
  const before = JSON.stringify({ record: setup.record, letter: setup.letter });
  const savedBefore = storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId);
  const proposal = cloud.seedProposal(setup.requests[0].id, { letterText: 'Proposed letter immediately visible.' });
  assert.equal(proposal.proposal_json.schemaVersion, 2);
  await setup.checkProposals();
  assert.equal(setup.reviewActive, true, 'loading immediately enables the proposal preview');
  assert.notDeepEqual(setup.previewCvState?.bodyOrder, base.bodyOrder);
  assert.equal(setup.previewLetterContent?.body, 'Proposed letter immediately visible.');
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'));
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  const reorder = setup.proposalChanges.find(change => change.type === 'reorder_sections')!;
  assert.ok(reorder);
  setup.toggleProposedChange(reorder.id, false);
  assert.deepEqual(setup.previewCvState?.bodyOrder, base.bodyOrder, 'deselecting immediately restores the original section order in preview');
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.equal(storage.getItem('CV_REFINEMENT:1:' + account + ':' + applicationId), savedBefore);
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'), 'exclusion from preview is not rejection');
  const accepted = [...setup.selectedChangeIds];
  const result = cloneCv(setup.previewCvState!);
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.record?.state, result);
  assert.equal(setup.letterText, 'Proposed letter immediately visible.');
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.cvApproved, false);
  const decision = database.application_refinement_reviews.find(row => row.kind === 'cv_decisions')!;
  assert.deepEqual((decision.payload as { accepted: string[] }).accepted, accepted);
  assert.deepEqual((decision.payload as { rejected: string[] }).rejected, [reorder.id]);
  assert.equal(setup.proposalChanges.find(change => change.id === reorder.id)?.status, 'rejected');
  assert.ok(setup.proposalChanges.filter(change => accepted.includes(change.id)).every(change => change.status === 'accepted'));
});

test('closing or reopening a temporary review never accepts it and newer manual corrections block application', async (t) => {
  const fixture = mount(t);
  let setup = fixture.setup;
  await idle(setup); setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup); await setup.useLetterTemplate();
  setup.updateLetter('Retained manual letter.'); await setup.initialPrompt(); fixture.cloud.seedProposal(setup.requests[0].id);
  await setup.checkProposals();
  const original = JSON.stringify({ record: setup.record, letter: setup.letter });
  setup.discardReview();
  assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.previewCvState, setup.record?.state);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.reviewActive, true, 'reopening automatically previews the loaded proposal');
  assert.deepEqual(JSON.parse(JSON.stringify({ record: setup.record, letter: setup.letter })), JSON.parse(original));
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
  setup.discardReview(); setup.record!.state.about.text = 'New manual correction supersedes the request.'; await nextTick(); setup.openProposal();
  assert.ok(setup.temporaryReview.result, 'an old proposal remains viewable against its frozen source');
  assert.match(setup.reviewAcceptanceError, /changed after this request/);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /changed after this request/);
  assert.equal(setup.record!.state.about.text, 'New manual correction supersedes the request.');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 0);
});

test('failed decision recording leaves selected changes proposed and working copies unchanged for retry', async (t) => {
  const { setup, cloud, database, props } = mount(t);
  await idle(setup); setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup); await setup.useLetterTemplate();
  await setup.initialPrompt(); cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  const before = JSON.stringify({ record: setup.record, letter: setup.letter });
  const client = props.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
  const rpc = client.rpc.bind(client);
  client.rpc = async (name, args) => name === 'save_refinement_review' && args.p_kind === 'cv_decisions' ? { data: null, error: new Error('Temporary connection failure') } : rpc(name, args);
  await setup.acceptSelectedChanges();
  assert.match(setup.error, /Temporary connection failure/);
  assert.equal(JSON.stringify({ record: setup.record, letter: setup.letter }), before);
  assert.equal(setup.reviewActive, true);
  assert.ok(setup.proposalChanges.every(change => change.status === 'proposed'));
  client.rpc = rpc;
  await setup.acceptSelectedChanges();
  assert.equal(setup.error, '');
  assert.equal(database.application_refinement_reviews.filter(row => row.kind === 'cv_decisions').length, 1);
});


test('invalid returned structural targets are rejected before preview rendering or document mutation', async (t) => {
  const { setup, cloud, database } = mount(t);
  await idle(setup); setup.pendingBaseId = 'base'; setup.assignBase(); await idle(setup); await setup.useLetterTemplate();
  await setup.initialPrompt(); const row = cloud.seedProposal(setup.requests[0].id);
  const stored = database.application_refinement_proposals.find(item => item.id === row.id)!;
  (stored.proposal_json as { cvOperations: { targetId: string }[] }).cvOperations[0].targetId = 'unknown-area';
  const before = JSON.stringify({ cv: setup.record, letter: setup.letter });
  await setup.checkProposals();
  assert.match(setup.error, /permutation|target/);
  assert.equal(setup.proposals.length, 0);
  assert.equal(setup.reviewActive, false);
  assert.equal(JSON.stringify({ cv: setup.record, letter: setup.letter }), before);
});
