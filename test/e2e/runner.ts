import { createApp, h, nextTick, type App, type Component } from 'vue';
import { PDFDocument } from 'pdf-lib';
import ApplicationWorkspace from '../../src/components/ApplicationWorkspace.vue';
import LetterTemplates from '../../src/components/LetterTemplates.vue';
import { createPrivateRefinementCv, createSyntheticRefinementWorkspace } from '../refinementFixture';
import { refinementSignature } from '../../src/composables/applicationRefinement';
import type { RefinementProposalRow, RefinementProposalV2 } from '../../src/refinementTypes';
import type { Workspace } from '../refinementWorkflowHarness';
import '../../src/assets/cv.css';
import './style.css';

type Fixture = ReturnType<typeof createSyntheticRefinementWorkspace>;
let app: App | undefined, setup: Workspace, fixture: Fixture;
let copiedPrompt = '';
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
  copiedPrompt = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copiedPrompt = value; } } });
  app = createApp({ render: () => h(ApplicationWorkspace as Component, { ...fixture.props, active: true, ref: (instance: unknown) => {
    if (instance) setup = (instance as { $: { setupState: Workspace } }).$.setupState;
  } }) });
  app.mount(root); await settle();
}
async function prepare(scope: 'cv' | 'letter', existing = 'Original working letter.') {
  await mount(); await field('Saved CV', 'base'); await field('Letter template', 'research');
  await field('Language', 'en'); await field('Target words', '400');
  await click('2Refinement'); await field('Refinement scope', 'letter');
  await disclose('Edit working document'); await field('Complete letter text', existing);
  await field('Refinement scope', scope);
  assert(setup.feedbackScope === scope, 'Refinement must use the selected scope');
  if (!existing && scope !== 'cv') {
    const initialNotice = root.querySelector<HTMLElement>('.initial-letter-notice');
    assert(initialNotice?.getClientRects().length && !initialNotice.closest('details'), 'Initial-draft intent must be visible without expanding privacy details');
  }
  await click('Sync Snapshot'); assert(!setup.error, setup.error);
  assert(!copiedPrompt, 'Publishing must not write to the clipboard');
  const saved = JSON.stringify(fixture.database);
  await click('Copy task'); assert(!setup.error, setup.error);
  assert(copiedPrompt.includes(`published request ${setup.requests[0].id}`), 'Copied task must reference the published request');
  assert(JSON.stringify(fixture.database) === saved, 'Copy task must not write to the database');
  assert(setup.requests[0].request_json.letter.text === existing, 'Published request must preserve the complete existing letter or explicit empty source');
  const outgoing = JSON.stringify(fixture.database);
  for (const secret of ['Synthetic Rowan', 'rowan@example.invalid', 'E2E North Lab', 'E2E South Lab', 'E2E Omit Lab', 'private.example.invalid', 'local-private-job', 'baselineState', 'bindings', 'structureBindings']) assert(!outgoing.includes(secret), `Outgoing fixture payload leaked ${secret}`);
  assert(outgoing.includes('{{PRIVATE_'), 'Privacy snapshot must contain pseudonyms');
}
async function loadProposal(row: RefinementProposalRow) {
  fixture.database.application_refinement_proposals.unshift(JSON.parse(JSON.stringify(row)));
  await click('Load proposals'); await field('Available proposals', row.id);
  assert(!setup.error, setup.error); assert(setup.reviewActive, 'Loaded proposals must activate the temporary preview');
}
function surface(kind: 'cv' | 'letter') { return root.querySelector<HTMLElement>(kind === 'cv' ? '.document-preview' : '.letter-preview')!; }
async function rendered(kind: 'cv' | 'letter', contains: string) {
  await field('Refinement scope', kind);
  await until(() => {
    const problem = surface(kind).querySelector('[role="alert"]'); if (problem) throw new Error(problem.textContent || 'Preview render failed');
    return [...surface(kind).querySelectorAll('.document-inline-preview .pdf-preview__page svg text')].map(node => node.textContent).join('').includes(contains);
  }, `real ${kind} PDF preview contains ${contains}`);
}
async function cvFlow() {
  await prepare('cv'); const working = snapshot(), local = setup.localRequests[setup.requests[0].id], originals = refinementSignature(local.cv);
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false });
  await loadProposal(row); assert(snapshot() === working, 'CV import modified working documents');
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
  const accepted = snapshot();
  await mount(true); assert(snapshot() === accepted, 'Remount changed accepted documents');
  await click('Preview selected changes'); await setup.acceptSelectedChanges(); await settle();
  assert(fixture.creations.length === 1 && snapshot() === accepted, 'Repeated acceptance duplicated or changed the result');
}
async function letterFlow(initial: boolean) {
  await prepare('letter', initial ? '' : 'Approved existing working draft.');
  const working = snapshot(), cv = refinementSignature(setup.record!.state);
  const text = initial ? 'Initial synthetic letter for the research programme.' : 'Refined synthetic letter building on my existing draft.';
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: text, persist: false });
  await loadProposal(row); await rendered('letter', text);
  assert(snapshot() === working, 'Letter import overwrote working or finalized text');
  assert(refinementSignature(setup.previewCvState) === cv, 'Letter-only preview changed CV content');
  assert(!surface('letter').querySelector('.document-inline-preview__actions'), 'Refinement must not show standalone preview/download actions');
  await click('Original', surface('letter')); assert(setup.previewLetterContent!.body === (initial ? '' : 'Approved existing working draft.'), 'Inline Original comparison used the wrong source');
  await click('Proposed', surface('letter'));
  await click('Accept selection'); assert(!setup.error, setup.error); assert(setup.letter!.working.body === text, 'Acceptance differs from displayed letter');
  assert(refinementSignature(setup.record!.state) === cv && fixture.creations.length === 0, 'Letter acceptance created or altered a CV');
  await rendered('letter', text); const accepted = snapshot();
  await mount(true); await click('Preview selected changes'); await setup.acceptSelectedChanges(); await settle(); assert(snapshot() === accepted, 'Repeated letter acceptance changed stored documents');
}
async function proposalReviewFlow() {
  await prepare('letter'); const working = snapshot();
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First combined proposal.' });
  await click('Load proposals'); await rendered('letter', 'First combined proposal.');
  assert(setup.selectedProposalId === first.id && snapshot() === working, 'Proposal load altered working state');
  const second = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Second combined proposal.' });
  (second.proposal_json as RefinementProposalV2).cvOperations = [];
  fixture.database.application_refinement_proposals.find(row => row.id === second.id)!.proposal_json = second.proposal_json;
  await click('Load proposals'); assert(setup.selectedProposalId === first.id, 'Refresh silently changed active proposal');
  await field('Available proposals', second.id); await rendered('letter', 'Second combined proposal.');
  assert(same(setup.previewCvState, setup.record!.state), 'Switch mixed the new letter with previous CV operations');
  const input = preview(), beforeSvg = surface('letter').querySelector('.pdf-preview__page')!.innerHTML;
  const annotation = root.querySelectorAll<HTMLElement>('.annotations article')[0];
  assert(annotation, 'Annotations unavailable'); const answer = annotation.querySelector<HTMLTextAreaElement>('textarea')!;
  answer.value = 'Confirmed synthetic evidence.'; answer.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  await field('Annotation status', 'resolved'); assert(!setup.error, setup.error);
  assert(preview() === input && snapshot() === working, 'Annotation answer entered document text');
  assert(surface('letter').querySelector('.pdf-preview__page')!.innerHTML === beforeSvg, 'Annotation answer changed rendered PDF content');
  await field('Annotation status', 'dismissed');
  assert(setup.feedbackHistory().at(-1)?.text.includes('Ignore this annotation'), 'Dismissing must cancel previously included feedback');
  assert(!setup.proposalAnnotations.find(item => item.annotation.id === 'annotation-2')?.included, 'Dismissed response must not be marked included');
  assert(snapshot() === working, 'Dismissing a comment must not alter documents');
  await click('Close temporary preview'); await rendered('letter', 'Original working letter.');
  await disclose('Edit working document'); await field('Complete letter text', 'Manual correction after publication.');
  await click('Preview selected changes');
  assert(root.textContent?.includes('Outdated — acceptance blocked.'), 'Outdated review must have a clear source warning');
  assert(button('Accept selection').disabled && setup.previewLetterContent!.body === 'Second combined proposal.', 'An outdated preview must use its exact original baseline and block acceptance');
  await click('Close temporary preview'); await field('Complete letter text', 'Original working letter.');
  await click('Approve letter'); await field('Refinement scope', 'cv'); await click('Approve CV');
  await click('Preview selected changes'); assert(!surface('cv').textContent?.includes('Download PDF'), 'Refinement must hide download actions');
  await click('3PDF review');
  assert(!setup.reviewActive && same(setup.previewCvState, setup.record!.state) && same(setup.previewLetterContent!.body, 'Original working letter.'), 'Normal export retained proposed content');
  await until(() => {
    const problem = root.querySelector('.application-documents [role="alert"]');
    if (problem) throw new Error(problem.textContent || 'Automatic package preview failed');
    return root.querySelector('.package-inline-pdf .pdf-canvas-page[data-rendered="true"] canvas') && !button('Download PDF').disabled;
  }, 'approved application automatically displays its complete PDF');
  for (const blob of [await setup.getCvPdf(), await setup.getLetterPdf()]) {
    const pdf = await PDFDocument.load(await blob.arrayBuffer()); assert(pdf.getPageCount() > 0, 'Normal export did not generate a real PDF');
  }
  assert(snapshot() !== working, 'Explicit approvals should retain their own saved state');
  assert(fixture.props.application.status === 'shortlist', 'Refinement changed application tracking status');
}
async function templateQuestionFlow() {
  await mount();
  fixture.props.application.context_json.requirements = ['Robot calibration experience is beneficial.'];
  app!.unmount(); root.replaceChildren();
  app = createApp({ render: () => h(LetterTemplates, { userId: fixture.props.userId, lang: 'en' }) });
  app.mount(root); await nextTick();
  const interests = 'Reliable robot sensing and reproducible experiments. I am also interested in scientific visualization.';
  const guidance = 'When required or beneficial robot calibration experience has no CV evidence, ask about relevant coursework or projects and a concrete example. If useful, ask about a genuine learning interest instead; do not assume experience.';
  await field('Main research interests (optional)', interests);
  await field('Questions and context to ask for (optional)', guidance);
  await until(() => root.querySelector('.template-save-status')?.textContent?.includes('All changes saved locally'), 'template guidance autosaves');
  await mount(true); await field('Saved CV', 'base'); await field('Letter template', 'research');
  await click('2Refinement'); await field('Refinement scope', 'letter');
  await click('Sync Snapshot'); await click('Copy task'); assert(!setup.error, setup.error);
  const source = setup.requests[0].request_json;
  assert(source.letter.template.researchInterests === interests && source.letter.template.questionGuidance === guidance, 'Published request lost the selected template guidance');
  await disclose('History / Details'); await disclose('Connection & prompt details'); await click('Copy connected setup prompt');
  assert(copiedPrompt.includes('never as proven experience or qualifications') && copiedPrompt.includes('required or beneficial opportunity criteria'), 'Draft instructions did not distinguish interests from evidence or explain contextual questions');
  const first = fixture.cloud.seedProposal(source.requestId, { persist: false, letterText: 'I am interested in reliable robot sensing and reproducible experiments.' });
  (first.proposal_json as RefinementProposalV2).annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null,
    text: 'Robot calibration is beneficial for this opportunity, but the CV does not document it. Have you calibrated a robot in coursework or a project? A concrete example could strengthen the letter; no experience is assumed.' }];
  await loadProposal(first); await rendered('letter', 'reliable robot sensing');
  const working = snapshot(), candidate = preview(), pdfBefore = surface('letter').querySelector('.pdf-preview__page')!.innerHTML;
  await field('Your response (optional)', 'I calibrated a robot in a coursework project and measured repeatability.');
  await field('Annotation status', 'resolved');
  assert(!setup.error, setup.error);
  assert(snapshot() === working && preview() === candidate && setup.feedbackHistory().length === 1, 'Resolving must include feedback without changing either document');
  assert(surface('letter').querySelector('.pdf-preview__page')!.innerHTML === pdfBefore, 'Answering changed the letter PDF');
  assert(setup.proposalAnnotations[0].included, 'Resolving must automatically include the saved response');
  await mount(true); await click('2Refinement');
  assert(setup.proposalAnnotations[0].included, 'Imported question inclusion was lost after reload');
  await click('Close temporary preview');
  await click('Sync Snapshot'); await click('Copy task'); assert(!setup.error, setup.error);
  const next = setup.requests[0].request_json;
  assert(next.requestId !== source.requestId && next.feedback.length === 1 && next.feedback[0].text.includes('measured repeatability'), 'Explicit question feedback did not enter a new request');
  assert(next.letter.template.researchInterests === interests && next.letter.template.questionGuidance === guidance, 'Next round changed the frozen template context');
  const refinedText = 'My interest in reliable robot sensing builds on a coursework project where I calibrated a robot and measured repeatability.';
  const second = fixture.cloud.seedProposal(next.requestId, { persist: false, letterText: refinedText });
  (second.proposal_json as RefinementProposalV2).annotations = [];
  await loadProposal(second); await rendered('letter', 'measured repeatability');
  assert(!setup.letter!.working.body, 'Refining with confirmed context persisted an unaccepted draft');
  await click('Accept selection'); assert(!setup.error, setup.error);
  assert(setup.letter!.working.body === refinedText, 'Acceptance did not match the reviewed contextual refinement');
  await rendered('letter', 'measured repeatability');
}
async function scopeLayoutFlow() {
  await prepare('letter');
  const visible = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length);
  const scopeOptions = [...root.querySelectorAll<HTMLSelectElement>('.refinement-controls select')][0].options;
  assert([...scopeOptions].map(option => option.value).join(',') === 'cv,letter', 'Only separate CV and letter scopes are available');
  const combined = root.querySelector('.refinement-stage')!;
  for (const removed of ['CV preview', 'Letter preview', 'Open preview', 'Download PDF', 'Import a refinement proposal', 'Manual drafts & backups', 'Earlier CV tailoring & letter drafts', 'Letter settings', 'Prepare sources & privacy', 'Save annotation', 'Include as feedback']) {
    assert(!combined.textContent?.includes(removed), `Removed refinement control remains: ${removed}`);
  }
  await field('Refinement scope', 'cv');
  assert(visible('.document-preview').length === 1 && visible('.letter-preview').length === 0, 'CV scope must select the CV inline preview');
  await disclose('Edit working document');
  assert(visible('.working-document').length === 1 && visible('.working-document')[0].querySelector('.builder'), 'CV scope must expose only the CV editor');
  const inner = root.querySelector('.content-panel__scroll-body')!;
  assert(getComputedStyle(inner).overflowY === 'visible' && getComputedStyle(inner).overscrollBehavior === 'auto', 'Embedded editor must allow scrolling to reach the refinement panel');
  assert(root.querySelector('.refinement-approval')?.contains(button('Approve CV')), 'Approval belongs below the editing disclosure');
  assert(!button('Approve CV').closest('details'), 'Approval must remain accessible when the editor is collapsed');
  await field('Refinement scope', 'letter');
  assert(visible('.document-preview').length === 0 && visible('.letter-preview').length === 1, 'Letter scope must select the letter inline preview');
  assert(visible('.working-document').length === 1 && visible('.working-document')[0].querySelector('textarea'), 'Letter scope must expose only the letter editor');
  await click('1Preparation');
  const settings = root.querySelector('.preparation-stage')!;
  assert(settings.textContent?.includes('Language') && settings.textContent?.includes('Target words'), 'Letter settings belong in Preparation');
}
runButton.addEventListener('click', async () => {
  runButton.disabled = true; results.replaceChildren(); status.textContent = 'Running'; document.body.dataset.result = 'running';
  let failed = 0;
  for (const [name, run] of [['Scope dropdown → task controls → scoped preview and editor → preparation settings', scopeLayoutFlow], ['CV privacy snapshot → load → automatic preview → select → subvariant → reload', cvFlow], ['Initial letter → automatic preview → accept → reload', () => letterFlow(true)], ['Existing letter → refinement preview → accept → reload', () => letterFlow(false)], ['Load → switch → resolve comment → dismiss preview → real approved PDFs', proposalReviewFlow], ['Template interests → contextual question → explicit answer feedback → refinement', templateQuestionFlow]] as const) {
    const item = document.createElement('li'); item.textContent = `Running: ${name}`; results.append(item);
    try { await run(); item.textContent = `PASS: ${name}`; item.dataset.result = 'pass'; }
    catch (cause) { failed++; item.textContent = `FAIL: ${name} — ${cause instanceof Error ? cause.message : String(cause)}`; item.dataset.result = 'fail'; }
  }
  status.textContent = `${6 - failed}/6 browser flows passed`; document.body.dataset.result = failed ? 'failed' : 'passed'; runButton.disabled = false;
});
