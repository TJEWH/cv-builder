import { createApp, h, nextTick, type App, type Component } from 'vue';
import { PDFDocument } from 'pdf-lib';
import ApplicationWorkspace from '../../src/components/ApplicationWorkspace.vue';
import { createPrivateRefinementCv, createSyntheticRefinementWorkspace } from '../refinementFixture';
import { refinementSignature } from '../../src/composables/applicationRefinement';
import type { RefinementProposalRow, RefinementProposalV2 } from '../../src/refinementTypes';
import type { Workspace } from '../refinementWorkflowHarness';
import '../../src/assets/cv.css';
import './style.css';

type Fixture = ReturnType<typeof createSyntheticRefinementWorkspace>;
let app: App | undefined, setup: Workspace, fixture: Fixture;
const root = document.querySelector<HTMLElement>('#workspace')!;
const results = document.querySelector<HTMLOListElement>('#test-results')!;
const status = document.querySelector<HTMLElement>('#test-status')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-tests')!;
const same = (a: unknown, b: unknown) => refinementSignature(a) === refinementSignature(b);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const snapshot = () => refinementSignature([setup.record, setup.letter]);
const preview = () => refinementSignature([setup.previewCvState, setup.previewLetterCvState, setup.previewLetterContent]);
async function until(check: () => unknown, label: string, timeout = 30000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25)); await nextTick();
  }
}
async function settle() {
  await nextTick(); await new Promise(requestAnimationFrame);
  await until(() => !setup.busy && !setup.refreshing, 'workspace finishes its operation');
  await nextTick(); await new Promise(requestAnimationFrame);
}
function button(name: string, parent: ParentNode = root) {
  const result = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name);
  assert(result, `Missing button: ${name}`); return result;
}
async function click(name: string, parent: ParentNode = root) {
  const element = button(name, parent); assert(!element.disabled, `Disabled button: ${name}`); element.click(); await settle();
}
async function disclose(name: string) {
  const summary = [...root.querySelectorAll('summary')].find(node => node.textContent?.trim() === name);
  assert(summary, `Missing disclosure: ${name}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) summary.click();
  await nextTick();
}
async function field(name: string, value: string) {
  const label = [...root.querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === name);
  const control = label?.querySelector<HTMLSelectElement | HTMLTextAreaElement | HTMLInputElement>('select,textarea,input');
  assert(control, `Missing field: ${name}`); assert(!control.disabled, `Disabled field: ${name}`);
  control.value = value; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await settle();
}
async function mount(reload = false) {
  app?.unmount(); root.replaceChildren();
  if (!reload) fixture = createSyntheticRefinementWorkspace(createPrivateRefinementCv());
  Object.defineProperty(window, 'localStorage', { configurable: true, value: fixture.storage });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fixture.storage });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  app = createApp({ render: () => h(ApplicationWorkspace as Component, { ...fixture.props, ref: (instance: unknown) => {
    if (instance) setup = (instance as { $: { setupState: Workspace } }).$.setupState;
  } }) });
  app.mount(root); await settle();
}
async function prepare(scope: 'cv' | 'letter' | 'both', existing = 'Original working letter.') {
  await mount(); await field('Career variant', 'base'); await click('Use CV template'); await click('Use letter template');
  if (scope === 'both') await click('2Refinement');
  else await click(scope === 'cv' ? 'Tailor CV' : 'Draft or refine letter');
  assert(setup.feedbackScope === scope, 'Entry point must select the matching shared scope');
  await click('Letter preview'); await disclose('Edit / approve working documents'); await field('Complete letter text', existing);
  await disclose('Prepare sources & privacy');
  if (!existing) assert(root.textContent?.includes('No letter available — create an initial draft.'), 'Empty source must be labelled as initial-draft generation');
  await click('Publish sources & copy prompt'); assert(!setup.error, setup.error);
  assert(setup.requests[0].request_json.letter.text === existing, 'Published request must preserve the complete existing letter or explicit empty source');
  const outgoing = JSON.stringify(fixture.database);
  for (const secret of ['Synthetic Rowan', 'rowan@example.invalid', 'E2E North Lab', 'E2E South Lab', 'E2E Omit Lab', 'private.example.invalid', 'local-private-job', 'baselineState', 'bindings', 'structureBindings']) assert(!outgoing.includes(secret), `Outgoing fixture payload leaked ${secret}`);
  assert(outgoing.includes('{{PRIVATE_'), 'Privacy snapshot must contain pseudonyms');
}
async function importProposal(row: RefinementProposalRow) {
  await disclose('Import a refinement proposal'); await field('Proposal JSON', JSON.stringify(row.proposal_json));
  await click('Load proposed preview'); assert(!setup.error, setup.error); assert(setup.reviewActive, 'Import must automatically activate proposed preview');
}
function surface(kind: 'cv' | 'letter') { return root.querySelector<HTMLElement>(kind === 'cv' ? '.document-preview' : '.letter-preview')!; }
async function rendered(kind: 'cv' | 'letter', contains: string) {
  await click(kind === 'cv' ? 'CV preview' : 'Letter preview');
  await until(() => {
    const problem = surface(kind).querySelector('[role="alert"]'); if (problem) throw new Error(problem.textContent || 'Preview render failed');
    return [...surface(kind).querySelectorAll('.document-inline-preview .pdf-preview__page svg text')].map(node => node.textContent).join('').includes(contains);
  }, `real ${kind} PDF preview contains ${contains}`);
}
async function cvFlow() {
  await prepare('cv'); const working = snapshot(), local = setup.localRequests[setup.requests[0].id], originals = refinementSignature(local.cv);
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false });
  await importProposal(row); assert(snapshot() === working, 'CV import modified working documents');
  await rendered('cv', 'E2E South Lab');
  const job = setup.previewCvState!.experience.jobs.find(job => job.id === 'local-private-job-a')!;
  assert(job.bullets === '- Evaluated robots with !!E2E South Lab!!.\n- Built sensors with !!E2E North Lab!!.', 'Moved tokens or linked omission reconstructed incorrectly');
  assert(setup.previewLetterContent!.body === 'Original working letter.', 'CV-only preview changed the letter');
  const change = (row.proposal_json as RefinementProposalV2).cvOperations.find(op => op.type === 'reorder_sections')!;
  const checkbox = root.querySelector<HTMLInputElement>(`input[aria-label^="Include ${change.id} "]`) || [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(node => node.parentElement?.textContent?.includes(`Include ${change.id} ·`));
  assert(checkbox, 'Missing CV operation control'); checkbox.click(); await settle();
  assert(same(setup.previewCvState!.bodyOrder, setup.record!.state.bodyOrder), 'Excluding operation did not recompute preview');
  await click('Original', surface('cv')); assert(same(setup.previewCvState, setup.record!.state), 'Original toggle did not restore exact source');
  await click('Proposed', surface('cv')); const candidate = refinementSignature(setup.previewCvState);
  await click('Accept selection'); assert(!setup.error, setup.error);
  assert(fixture.creations.length === 1 && refinementSignature(setup.record!.state) === candidate, 'Acceptance did not save exactly one reviewed subvariant');
  assert(originals === refinementSignature(local.cv), 'Acceptance changed private originals or reconstruction mappings');
  assert(fixture.base.experience.jobs[0].bullets!.includes('private.example.invalid'), 'Omission destroyed the source link');
  await rendered('cv', 'E2E South Lab'); const accepted = snapshot();
  await mount(true); assert(snapshot() === accepted, 'Remount changed accepted documents');
  await click('Preview selected changes'); await setup.acceptSelectedChanges(); await settle();
  assert(fixture.creations.length === 1 && snapshot() === accepted, 'Repeated acceptance duplicated or changed the result');
}
async function letterFlow(initial: boolean) {
  await prepare('letter', initial ? '' : 'Approved existing working draft.');
  const working = snapshot(), cv = refinementSignature(setup.record!.state);
  const text = initial ? 'Initial synthetic letter for the research programme.' : 'Refined synthetic letter building on my existing draft.';
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: text, persist: false });
  await importProposal(row); await rendered('letter', text);
  assert(snapshot() === working, 'Letter import overwrote working or finalized text');
  assert(refinementSignature(setup.previewCvState) === cv, 'Letter-only preview changed CV content');
  await click('Open preview', surface('letter')); const dialog = document.querySelector('dialog.document-full-preview[open][aria-label="Motivation letter"]');
  assert(dialog?.textContent?.includes(setup.selectedProposalId), 'Expanded preview did not share the active proposal');
  await click('Original', dialog!); assert(setup.previewLetterContent!.body === (initial ? '' : 'Approved existing working draft.'), 'Expanded Original comparison used the wrong source');
  await click('Proposed', dialog!); await click('Back to builder', dialog!);
  await click('Accept selection'); assert(!setup.error, setup.error); assert(setup.letter!.working.body === text, 'Acceptance differs from displayed letter');
  assert(refinementSignature(setup.record!.state) === cv && fixture.creations.length === 0, 'Letter acceptance created or altered a CV');
  await rendered('letter', text); const accepted = snapshot();
  await mount(true); await click('Preview selected changes'); await setup.acceptSelectedChanges(); await settle(); assert(snapshot() === accepted, 'Repeated letter acceptance changed stored documents');
}
async function combinedFlow() {
  await prepare('both'); const working = snapshot();
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First combined proposal.' });
  await click('Load / refresh proposals'); await rendered('cv', 'E2E South Lab'); await rendered('letter', 'First combined proposal.');
  assert(setup.selectedProposalId === first.id && snapshot() === working, 'Combined load altered working state');
  const second = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Second combined proposal.' });
  (second.proposal_json as RefinementProposalV2).cvOperations = [];
  fixture.database.application_refinement_proposals.find(row => row.id === second.id)!.proposal_json = second.proposal_json;
  await click('Load / refresh proposals'); assert(setup.selectedProposalId === first.id, 'Refresh silently changed active proposal');
  await field('Available proposals', second.id); await rendered('letter', 'Second combined proposal.');
  assert(same(setup.previewCvState, setup.record!.state), 'Switch mixed the new letter with previous CV operations');
  const input = preview(), beforeSvg = surface('letter').querySelector('.pdf-preview__page')!.innerHTML;
  const annotation = root.querySelectorAll<HTMLElement>('.annotations article')[0];
  assert(annotation, 'Annotations unavailable'); const answer = annotation.querySelector<HTMLTextAreaElement>('textarea')!;
  answer.value = 'Confirmed synthetic evidence.'; answer.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  await click('Save annotation', annotation); assert(!setup.error, setup.error);
  assert(preview() === input && snapshot() === working, 'Annotation answer entered document text');
  assert(surface('letter').querySelector('.pdf-preview__page')!.innerHTML === beforeSvg, 'Annotation answer changed rendered PDF content');
  await click('Close temporary preview'); await rendered('letter', 'Original working letter.');
  await disclose('Edit / approve working documents'); await field('Complete letter text', 'Manual correction after publication.');
  await click('Preview selected changes');
  assert(root.textContent?.includes('Outdated — acceptance blocked.'), 'Outdated review must have a clear source warning');
  assert(button('Accept selection').disabled && setup.previewLetterContent!.body === 'Second combined proposal.', 'An outdated preview must use its exact original baseline and block acceptance');
  await click('Close temporary preview'); await field('Complete letter text', 'Original working letter.');
  await click('Approve letter'); await click('CV preview'); await click('Approve CV');
  await click('Preview selected changes'); assert(button('Download PDF', surface('cv')).disabled, 'Unaccepted CV download must be disabled');
  await click('3PDF review');
  assert(!setup.reviewActive && same(setup.previewCvState, setup.record!.state) && same(setup.previewLetterContent!.body, 'Original working letter.'), 'Normal export retained proposed content');
  for (const blob of [await setup.getCvPdf(), await setup.getLetterPdf()]) {
    const pdf = await PDFDocument.load(await blob.arrayBuffer()); assert(pdf.getPageCount() > 0, 'Normal export did not generate a real PDF');
  }
  assert(snapshot() !== working, 'Explicit approvals should retain their own saved state');
  assert(fixture.props.application.status === 'shortlist', 'Refinement changed application tracking status');
}
runButton.addEventListener('click', async () => {
  runButton.disabled = true; results.replaceChildren(); status.textContent = 'Running'; document.body.dataset.result = 'running';
  let failed = 0;
  for (const [name, run] of [['CV privacy snapshot → import → automatic preview → select → subvariant → reload', cvFlow], ['Initial letter → automatic preview → accept → reload', () => letterFlow(true)], ['Existing letter → refinement preview → accept → reload', () => letterFlow(false)], ['Combined load → switch → annotation → dismiss → real approved PDFs', combinedFlow]] as const) {
    const item = document.createElement('li'); item.textContent = `Running: ${name}`; results.append(item);
    try { await run(); item.textContent = `PASS: ${name}`; item.dataset.result = 'pass'; }
    catch (cause) { failed++; item.textContent = `FAIL: ${name} — ${cause instanceof Error ? cause.message : String(cause)}`; item.dataset.result = 'fail'; }
  }
  status.textContent = `${4 - failed}/4 browser flows passed`; document.body.dataset.result = failed ? 'failed' : 'passed'; runButton.disabled = false;
});
