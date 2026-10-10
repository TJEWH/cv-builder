import { createApp, h, nextTick, ref, type App, type Component } from 'vue';
import { PDFDocument } from 'pdf-lib';
import ApplicationWorkspace from '../../src/components/ApplicationWorkspace.vue';
import LetterTemplates from '../../src/components/LetterTemplates.vue';
import AppToaster from '../../src/components/AppToaster.vue';
import DesktopSidebar from '../../src/components/DesktopSidebar.vue';
import { provideDesktopSidebar } from '../../src/composables/desktopSidebar';
import { useToasts } from '../../src/composables/useToasts';
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
const sidebarMode = new URLSearchParams(location.search).get('sidebar') === '1';
const sidebarEnabled = () => sidebarMode && window.matchMedia('(min-width:761px)').matches;
const { clear: clearToasts } = useToasts();
const toasterRoot = document.createElement('div');
document.body.append(toasterRoot);
createApp(AppToaster, { lang: 'en' }).mount(toasterRoot);
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
  await until(() => !setup.busy && !setup.refreshing && !setup.syncing, 'workspace finishes its operation');
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
  clearToasts();
  if (!reload) fixture = createSyntheticRefinementWorkspace(createPrivateRefinementCv());
  Object.defineProperty(window, 'localStorage', { configurable: true, value: fixture.storage });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fixture.storage });
  copiedPrompt = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copiedPrompt = value; } } });
  app = createApp({ setup() {
    const desktop = ref(sidebarEnabled());
    provideDesktopSidebar(desktop);
    return () => {
      const workspace = h(ApplicationWorkspace as Component, { ...fixture.props, active: true, ref: (instance: unknown) => {
        if (instance) setup = (instance as { $: { setupState: Workspace } }).$.setupState;
      } });
      return desktop.value ? h('div', {
        class: 'e2e-sidebar-workspace',
        style: 'display:grid;grid-template-columns:20% minmax(0,1fr);height:100%;width:100%;min-width:0;min-height:0;overflow:hidden',
      }, [h(DesktopSidebar, { lang: 'en' }, { header: () => h('span', { style: 'display:grid;place-items:center;height:100%' }, 'Synthetic account') }), workspace]) : workspace;
    };
  } });
  app.mount(root); await settle();
}
async function prepare(scope: 'cv' | 'letter', existing = 'Original working letter.') {
  await mount(); await field('Saved CV', 'base'); await field('Letter template', 'research');
  await field('Language', 'en'); await field('Target words', '400');
  await click('2Refinement'); await field('Refinement scope', 'letter');
  await disclose('Edit manually'); await field('Complete letter text', existing);
  await field('Refinement scope', scope);
  assert(setup.feedbackScope === scope, 'Refinement must use the selected scope');
  const initial = root.querySelector<HTMLElement>('.initial-refinement');
  assert(initial?.getClientRects().length && initial.contains(button('Copy task')), 'Initial refinement must expose its copy task action');
  assert(!initial.closest('details') && !root.querySelector('.next-refinement'), 'Initial refinement must be visible outside disclosures and replace next refinement');
  await click('Copy task'); assert(!setup.error, setup.error);
  assert(copiedPrompt.includes(`published request ${setup.requests[0].id}`), 'Initial task must publish and reference its source request');
  assert(setup.requests[0].request_json.letter.text === existing, 'Initial task must preserve the working source letter');
  const request = setup.requests[0].id;
  await click('Copy task'); assert(setup.requests.length === 1 && setup.requests[0].id === request, 'Repeated task copying duplicated its request');
  const outgoing = JSON.stringify(fixture.database);
  for (const secret of ['Synthetic Rowan', 'rowan@example.invalid', 'E2E North Lab', 'E2E South Lab', 'E2E Omit Lab', 'private.example.invalid', 'local-private-job', 'baselineState', 'bindings', 'structureBindings']) assert(!outgoing.includes(secret), `Outgoing fixture payload leaked ${secret}`);
  assert(outgoing.includes('{{PRIVATE_'), 'Privacy snapshot must contain pseudonyms');
}
async function loadProposal(row: RefinementProposalRow) {
  fixture.database.application_refinement_proposals.unshift(JSON.parse(JSON.stringify(row)));
  await click('Sync');
  assert(!setup.error, setup.error);
  assert(setup.selectedProposalId === row.id && !setup.reviewActive, 'Sync must apply the returned proposal as the working document');
  assert(!root.querySelector('.initial-refinement') && root.querySelector('.next-refinement'), 'The first proposal must replace initial refinement with next refinement');
  assert(!root.querySelector('.current-review')?.closest('details'), 'Current review must remain outside disclosures');
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
  await prepare('cv');
  const request = setup.requests[0], local = setup.localRequests[request.id], originals = refinementSignature(local.cv);
  const row = fixture.cloud.seedProposal(request.id, { persist: false });
  await loadProposal(row); await rendered('cv', 'E2E South Lab');
  const job = setup.record!.state.experience.jobs.find(job => job.id === 'local-private-job-a')!;
  assert(job.bullets === '- Evaluated robots with !!E2E South Lab!!.\n- Built sensors with !!E2E North Lab!!.', 'Automatic application reconstructed tokens incorrectly');
  assert(setup.letter!.working.body === 'Original working letter.', 'CV application changed the letter');
  assert(fixture.creations.length === 0, 'Automatic CV application must keep changes within this application');
  assert(originals === refinementSignature(local.cv), 'Automatic application changed the original private mappings');
  assert(fixture.base.experience.jobs[0].bullets!.includes('private.example.invalid'), 'Omission destroyed the original source link');
  const changes = root.querySelector<HTMLElement>('.proposal-changes');
  assert(changes?.getClientRects().length && !changes.closest('details'), 'Automatic changes must remain visible outside disclosures');
  assert(!root.querySelector('input[aria-label^="Include "]:not(:disabled)'), 'Automatically applied changes must not allow manual selection');
  const applied = refinementSignature(setup.record!.state);
  await click('Preview proposal');
  await click('Original', root.querySelector('.proposal-content')!); assert(same(setup.previewCvState, local.cv.baselineState), 'Comparison did not show the frozen original CV');
  await click('Proposed', root.querySelector('.proposal-content')!); assert(refinementSignature(setup.previewCvState) === applied, 'Comparison differs from the applied CV');
  await click('Close preview'); await click('Sync'); await mount(true); await click('Sync');
  assert(fixture.creations.length === 0 && refinementSignature(setup.record!.state) === applied, 'Repeated sync or reload duplicated the applied CV');
  assert(setup.requests.length === 1, 'Sync started a new iteration without copying the next task');
  assert(!root.querySelector('.approved-variant-save'), 'An unapproved CV must not offer saving to the variant library');
  if (setup.reviewActive) await click('Close preview');
  await click('Approve CV');
  await field('Variant name', 'Approved robotics CV');
  const applicationCopy = snapshot();
  await click('Save as new variant');
  assert(Number(fixture.creations.length) === 1 && fixture.creations[0].name === 'Approved robotics CV', 'Explicit save must create one named variant');
  assert(refinementSignature(fixture.creations[0].state) === applied && !('parentId' in fixture.props.configurations.at(-1)!), 'Saved variant must contain the approved CV with no parent');
  assert(snapshot() === applicationCopy && setup.cvApproved, 'Saving a variant must preserve the independent application and approval');
  assert(button('Variant saved').disabled, 'Repeated saves must be disabled once the approved CV is saved');
  await mount(true);
  assert(button('Variant saved').disabled && Number(fixture.creations.length) === 1, 'Reload must retain the saved variant receipt');
}
async function letterFlow(initial: boolean) {
  const original = initial ? '' : 'Approved existing working draft.';
  await prepare('letter', original);
  const cv = refinementSignature(setup.record!.state);
  const text = initial ? 'Initial synthetic letter for the research programme.' : 'Refined synthetic letter building on my existing draft.';
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: text, persist: false });
  row.proposal_json.summary = 'The draft connects the applicant’s research interest to the programme. It emphasizes documented experience and motivation. This extra legacy sentence must not be shown.';
  await loadProposal(row); await rendered('letter', text);
  assert(setup.letter!.working.body === text, 'Loaded letter was not applied automatically');
  assert(refinementSignature(setup.record!.state) === cv && fixture.creations.length === 0, 'Letter application created or altered a CV');
  assert(!root.querySelector('.proposal-content')?.textContent?.includes('This extra legacy sentence must not be shown.'), 'Active letter summary must be limited to two sentences');
  assert(!root.querySelector('.proposal-content')?.textContent?.includes('Include proposed letter'), 'Letter selection toggle must be removed');
  assert(!surface('letter').querySelector('.document-inline-preview__actions'), 'Refinement must not show standalone preview/download actions');
  await click('Preview proposal');
  await click('Original', root.querySelector('.proposal-content')!); assert(setup.previewLetterContent!.body === original, 'Comparison did not show the exact original letter');
  await click('Proposed', root.querySelector('.proposal-content')!); assert(same(setup.previewLetterContent!.body, text), 'Proposed comparison differs from applied letter');
  await click('Close preview');
  const revisions = setup.letter!.revisions.length;
  await mount(true); await click('Sync'); await rendered('letter', text);
  assert(setup.letter!.working.body === text && setup.letter!.revisions.length === revisions, 'Repeated sync or reload duplicated the applied letter');
}
async function proposalReviewFlow() {
  await prepare('letter');
  const originalCv = refinementSignature(setup.record!.state);
  const first = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'First automatically applied proposal.', persist: false });
  await loadProposal(first); await rendered('letter', 'First automatically applied proposal.');
  const minor = root.querySelector(sidebarEnabled() ? '#desktop-sidebar-minor' : '.proposal-preview-action')!;
  assert(minor?.contains(button('Preview proposal')), 'Proposal preview belongs in the minor action area');
  assert(root.querySelector(sidebarEnabled() ? '#desktop-sidebar-major' : '.refinement-toolbar')?.contains(button('Approve letter')), 'Approval belongs in the major action area');
  assert(minor?.contains(button('Sync')), 'Sync belongs in the minor action area');
  const applied = snapshot(), input = preview(), beforeSvg = surface('letter').querySelector('.pdf-preview__page')!.innerHTML;
  await field('Your response (optional)', 'Confirmed synthetic evidence.');
  await field('Annotation status', 'resolved'); assert(!setup.error, setup.error);
  assert(preview() === input && snapshot() === applied, 'Resolving a question changed document content');
  assert(surface('letter').querySelector('.pdf-preview__page')!.innerHTML === beforeSvg, 'Resolving a question changed the rendered PDF');
  await field('Annotation status', 'ignored');
  assert(setup.feedbackHistory().at(-1)?.text.includes('Ignore this annotation'), 'Ignoring must cancel earlier answer feedback');
  const annotation = root.querySelector('.annotations article')!;
  assert(!annotation.querySelector('textarea'), 'Ignoring an annotation must hide its response input');
  const firstRequest = setup.requests[0].id;
  await click('Copy feedback'); assert(!setup.error, setup.error);
  assert(setup.requests[0].id !== firstRequest && copiedPrompt.includes(setup.requests[0].id), 'Next iteration must publish and copy a new task');
  assert(setup.requests[0].request_json.letter.text === 'First automatically applied proposal.', 'Next iteration lost the applied working letter');
  const next = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Second automatically applied proposal.', persist: false });
  await loadProposal(next); await rendered('letter', 'Second automatically applied proposal.');
  await disclose('History'); await click('Reset to original state'); assert(!setup.error, setup.error);
  assert(root.querySelector('.initial-refinement') && !root.querySelector('.next-refinement'), 'Reset must restore initial refinement');
  assert(setup.letter!.working.body === 'Original working letter.' && refinementSignature(setup.record!.state) === originalCv, 'Reset must restore both original documents');
  assert(setup.proposals.length === 2 && setup.letter!.revisions.some(revision => revision.cloudDraftId === next.id), 'Reset must preserve proposal and letter history');
  await click('Sync'); await rendered('letter', 'Original working letter.');
  assert(setup.letter!.working.body === 'Original working letter.', 'Sync replayed a reset proposal');
  await click('Approve letter'); await field('Refinement scope', 'cv'); await click('Approve CV'); await click('3Attachments');
  await until(() => {
    const problem = root.querySelector('.application-documents [role="alert"]');
    if (problem) throw new Error(problem.textContent || 'Automatic package preview failed');
    return root.querySelector('.package-inline-pdf .pdf-canvas-page[data-rendered="true"] canvas') && !button('Download PDF').disabled;
  }, 'approved application automatically displays its complete PDF');
  for (const blob of [await setup.getCvPdf(), await setup.getLetterPdf()]) {
    const pdf = await PDFDocument.load(await blob.arrayBuffer()); assert(pdf.getPageCount() > 0, 'Normal export did not generate a real PDF');
  }
  assert(fixture.props.application.status === 'attachments', 'The Attachments tab did not persist the application stage');
}
async function templateQuestionFlow() {
  await mount();
  fixture.props.application.context_json.requirements = ['Robot calibration experience is beneficial.'];
  app!.unmount(); root.replaceChildren();
  app = createApp({ render: () => h(LetterTemplates, { userId: fixture.props.userId, lang: 'en' }) });
  app.mount(root); await nextTick();
  const interests = 'Reliable robot sensing and reproducible experiments. I am also interested in scientific visualization.';
  const guidance = 'When required or beneficial robot calibration experience has no CV evidence, ask about relevant coursework or projects and a concrete example. If useful, ask about a genuine learning interest instead; do not assume experience.';
  await field('Main research interests (optional)', interests); await field('Questions and context to ask for (optional)', guidance);
  await until(() => [...document.querySelectorAll('.app-toaster [role="status"]')].some(toast => toast.textContent?.includes('All changes saved locally')), 'template guidance autosaves');
  await mount(true); await field('Saved CV', 'base'); await field('Letter template', 'research');
  await click('2Refinement'); await field('Refinement scope', 'letter'); await click('Copy task'); assert(!setup.error, setup.error);
  const source = setup.requests[0].request_json;
  assert(source.letter.template.researchInterests === interests && source.letter.template.questionGuidance === guidance, 'Published request lost selected template guidance');
  const first = fixture.cloud.seedProposal(source.requestId, { persist: false, letterText: 'I am interested in reliable robot sensing and reproducible experiments.' });
  (first.proposal_json as RefinementProposalV2).annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null,
    text: 'Robot calibration is beneficial, but the CV does not document it. Have you calibrated a robot in coursework or a project? A concrete example could strengthen the letter; no experience is assumed.' }];
  await loadProposal(first); await rendered('letter', 'reliable robot sensing');
  const working = snapshot(), pdfBefore = surface('letter').querySelector('.pdf-preview__page')!.innerHTML;
  await field('Your response (optional)', 'I calibrated a robot in a coursework project and measured repeatability.'); await field('Annotation status', 'resolved');
  assert(!setup.error && setup.proposalAnnotations[0].included, 'Resolving must save and include the response');
  assert(snapshot() === working && surface('letter').querySelector('.pdf-preview__page')!.innerHTML === pdfBefore, 'Answering changed the applied letter');
  await mount(true); await click('2Refinement');
  assert(setup.proposalAnnotations[0].included, 'Question feedback was lost after reload');
  await click('Copy feedback'); assert(!setup.error, setup.error);
  const next = setup.requests[0].request_json;
  assert(next.requestId !== source.requestId && next.feedback.length === 1 && next.feedback[0].text.includes('measured repeatability'), 'Resolved feedback did not enter the next task');
  assert(next.letter.text === 'I am interested in reliable robot sensing and reproducible experiments.', 'Next task lost the applied initial draft');
  const refinedText = 'My interest in reliable robot sensing builds on a coursework project where I calibrated a robot and measured repeatability.';
  const second = fixture.cloud.seedProposal(next.requestId, { persist: false, letterText: refinedText });
  (second.proposal_json as RefinementProposalV2).annotations = [];
  await loadProposal(second); await rendered('letter', 'measured repeatability');
  assert(setup.letter!.working.body === refinedText, 'Next returned proposal was not applied automatically');
}
async function scopeLayoutFlow() {
  await prepare('letter');
  const visible = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length);
  const toolbar = root.querySelector<HTMLElement>('.refinement-toolbar');
  const scope = toolbar?.querySelector<HTMLSelectElement>('select');
  assert(toolbar && scope, 'Refinement must expose its scope beside the task actions');
  if (sidebarEnabled()) assert(root.querySelector('#desktop-sidebar-major')?.contains(toolbar), 'Refinement actions belong in the major sidebar area');
  const approvalActions = root.querySelector(sidebarEnabled() ? '#desktop-sidebar-major' : '.refinement-toolbar');
  const syncActions = root.querySelector(sidebarEnabled() ? '#desktop-sidebar-minor' : '.proposal-preview-action');
  assert(approvalActions && syncActions, 'Refinement must expose both action areas');
  assert(syncActions?.contains(button('Sync')), 'Sync belongs in the minor action area');
  assert(approvalActions?.contains(button('Approve letter')), 'Letter approval belongs in the major action area');
  assert(button('Sync', syncActions).querySelector('svg'), 'Sync must have an icon');
  const scopeOptions = scope.options;
  assert([...scopeOptions].map(option => option.value).join(',') === 'cv,letter', 'Only separate CV and letter scopes are available');
  const combined = root.querySelector('.refinement-stage')!;
  for (const removed of ['CV preview', 'Letter preview', 'Open preview', 'Download PDF', 'Import a refinement proposal', 'Manual drafts & backups', 'Earlier CV tailoring & letter drafts', 'Letter settings', 'Prepare sources & privacy', 'Save annotation', 'Include as feedback']) {
    assert(!combined.textContent?.includes(removed), `Removed refinement control remains: ${removed}`);
  }
  await field('Refinement scope', 'cv');
  assert(visible('.document-preview').length === 1 && visible('.letter-preview').length === 0, 'CV scope must select the CV inline preview');
  await disclose('Edit manually');
  assert(visible('.working-document').length === 1 && visible('.working-document')[0].querySelector('.builder'), 'CV scope must expose only the CV editor');
  const experience = button('Professional Experience');
  if (experience.getAttribute('aria-expanded') === 'false') await click('Professional Experience');
  const inner = root.querySelector('.content-panel__scroll-body')!;
  assert(getComputedStyle(inner).overflowY === 'visible' && getComputedStyle(inner).overscrollBehavior === 'auto', 'Embedded editor must allow scrolling to reach the refinement panel');
  const approveCv = button('Approve CV');
  assert(approvalActions.contains(approveCv) && toolbar.contains(approveCv), 'CV approval belongs in the major action area');
  assert(!approveCv.closest('details'), 'Approval must remain accessible when the editor is collapsed');
  assert(approveCv.querySelector('svg'), 'CV approval must have an icon');
  assert(![...approvalActions.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Approve letter'), 'CV scope must replace letter approval with CV approval');
  clearToasts();
  const mobile = window.matchMedia('(max-width:760px)').matches;
  const scroller = root.querySelector<HTMLElement>(mobile ? '.workflow-body' : '.refinement-controls')!;
  const initialToolbarTop = toolbar.getBoundingClientRect().top;
  scroller.scrollTop = scroller.scrollHeight;
  await nextTick(); await new Promise(requestAnimationFrame);
  assert(scroller.scrollTop > 0, 'The layout check must scroll beyond the beginning of the refinement');
  const toolbarBounds = toolbar.getBoundingClientRect();
  const viewport = root.querySelector(sidebarEnabled() ? '.desktop-sidebar__actions' : '.workflow-body')!.getBoundingClientRect();
  assert(Math.abs(toolbarBounds.top - initialToolbarTop) <= (mobile ? 8 : 1), 'Scope and approval must stay at the top while reviewing content farther down');
  for (const control of [scope, button('Approve CV', toolbar)]) {
    const bounds = control.getBoundingClientRect();
    assert(bounds.width > 0 && bounds.height > 0 && bounds.top >= viewport.top - 8 && bounds.bottom <= viewport.bottom + 1, 'Scope and task actions must remain visible after scrolling the editor or PDF');
    if (sidebarEnabled()) assert(bounds.left >= viewport.left && bounds.right <= viewport.right, 'Sidebar controls must fit within the sidebar width');
  }
  scroller.scrollTop = 0;
  await nextTick(); await new Promise(requestAnimationFrame);
  await field('Refinement scope', 'letter');
  assert(visible('.document-preview').length === 0 && visible('.letter-preview').length === 1, 'Letter scope must select the letter inline preview');
  assert(visible('.working-document').length === 1 && visible('.working-document')[0].querySelector('textarea'), 'Letter scope must expose only the letter editor');
  const approveLetter = button('Approve letter');
  assert(approvalActions.contains(approveLetter) && toolbar.contains(approveLetter), 'Switching to letter scope must show letter approval in the major action area');
  assert(approveLetter.querySelector('svg') && !approveLetter.closest('details'), 'Letter approval must have an icon and remain outside disclosures');
  assert(![...approvalActions.querySelectorAll('button')].some(node => node.textContent?.trim() === 'Approve CV'), 'Letter scope must replace CV approval with letter approval');
  await click('1Preparation');
  const settings = root.querySelector('.preparation-settings')!;
  assert(settings.textContent?.includes('Language') && settings.textContent?.includes('Target words'), 'Letter settings belong in Preparation');
  if (sidebarEnabled()) {
    const selection = root.querySelector('.preparation-selection')!;
    assert(root.querySelector('#desktop-sidebar-major')?.contains(selection), 'CV and letter selection belong in the major sidebar area');
    assert(selection.textContent?.includes('Saved CV') && selection.textContent?.includes('Letter template'), 'Both preparation selectors must share the major sidebar area');
    assert(root.querySelector('#desktop-sidebar-minor')?.contains(settings), 'Language and target words belong in the minor sidebar area');
  }
}
const flows = [
  ['scope-layout', 'Scope dropdown → task controls → scoped preview and editor → preparation settings', scopeLayoutFlow],
  ['cv', 'CV snapshot → application-only changes → compare → reload → save approved variant', cvFlow],
  ['initial-letter', 'Initial letter → automatic application → compare → reload', () => letterFlow(true)],
  ['existing-letter', 'Existing letter → automatic refinement → compare → reload', () => letterFlow(false)],
  ['proposal-review', 'Automatic application → ignored answer → next iteration → reset → approved PDFs', proposalReviewFlow],
  ['template-questions', 'Template interests → contextual question → explicit answer feedback → refinement', templateQuestionFlow],
] as const;
const flowId = new URLSearchParams(location.search).get('flow');
const selectedFlows = flows.filter(([id]) => !flowId || id === flowId);
if (flowId) runButton.textContent = `Run ${flowId} flow`;
if (!selectedFlows.length) {
  runButton.disabled = true;
  status.textContent = `Unknown flow: ${flowId}`;
  document.body.dataset.result = 'failed';
}
runButton.addEventListener('click', async () => {
  runButton.disabled = true; results.replaceChildren(); status.textContent = 'Running'; document.body.dataset.result = 'running';
  let failed = 0;
  for (const [, name, run] of selectedFlows) {
    const item = document.createElement('li'); item.textContent = `Running: ${name}`; results.append(item);
    try { await run(); item.textContent = `PASS: ${name}`; item.dataset.result = 'pass'; }
    catch (cause) { failed++; item.textContent = `FAIL: ${name} — ${cause instanceof Error ? cause.message : String(cause)}`; item.dataset.result = 'fail'; }
  }
  status.textContent = `${selectedFlows.length - failed}/${selectedFlows.length} browser flows passed`; document.body.dataset.result = failed ? 'failed' : 'passed'; runButton.disabled = false;
});
