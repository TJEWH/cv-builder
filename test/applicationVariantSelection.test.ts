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
import type { RefinementRequestRow, RefinementProposalRow, RefinementScope } from '../src/refinementTypes';

const account = '90000000-0000-4000-8000-000000000001';
const applicationId = '10000000-0000-4000-8000-000000000001';
interface WorkspaceSetup {
  record: ApplicationCvRecord | null; pendingBaseId: string; pendingSubId: string; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; error: string; saveError: string; letterText: string;
  pendingTemplateId: string; missingLetterTemplate: boolean;
  cvApproved: boolean; letterApproved: boolean; feedbackScope: RefinementScope; feedback: string;
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; selectedProposalId: string; prompt: string;
  shortInstruction: string; shortInstructionNotice: string; shortInstructionError: string;
  assignBase(): void; importBackup(event: Event): Promise<void>; useLetterTemplate(): Promise<void>; saveSetup(): Promise<void>;
  initialPrompt(): Promise<void>; checkProposals(): Promise<void>; openProposal(): void;
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
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
  app.mount({}); unmount = () => app.unmount();
  const setup = (mounted as { $: { setupState: WorkspaceSetup } }).$.setupState;
  return { setup, props, states, base, database, cloud, clipboard, clipboardWrites };
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
  await setup.checkProposals(); setup.selectedProposalId = firstProposal.id; setup.openProposal();
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
  assert.deepEqual(secondProposal.proposal_json.cvEdits, []);
  await setup.checkProposals(); setup.selectedProposalId = secondProposal.id; setup.openProposal();
  assert.equal(setup.error, '');
  assert.equal(setup.cvApproved, true, 'letter-only revisions preserve CV approval');
  setup.feedback = 'Keep the closing concise as well.';
  await setup.requestImprovement();
  assert.equal(setup.error, '');
  assert.equal(setup.requests[0].request_json.feedback.length, 2);
  const thirdProposal = cloud.seedProposal(setup.requests[0].id, { overLimit: true });
  await setup.checkProposals(); setup.selectedProposalId = thirdProposal.id; setup.openProposal();
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
  await setup.checkProposals(); setup.selectedProposalId = proposed.id; setup.openProposal();
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
  assert.match(setup.error, /superseded round/);
  assert.equal(JSON.stringify(setup.record!.state), baselineCv);
  assert.equal(JSON.stringify(setup.letter), baselineLetter);
  assert.ok(setup.proposals.some(item => item.id === olderProposal.id), 'the older proposal remains in review history');

  const currentProposal = cloud.seedProposal(currentRequest.id);
  await setup.checkProposals(); setup.selectedProposalId = currentProposal.id; setup.openProposal();
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
