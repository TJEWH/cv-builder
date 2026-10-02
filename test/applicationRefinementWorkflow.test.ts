import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneCv, loadApplicationCv } from '../src/composables/applicationCv';
import { finalizeLetter } from '../src/composables/motivationLetters';
import type { ApplicationLetter } from '../src/letterTypes';
import { account, applicationId, refinementKey, mount, prepare, idle, documents } from './refinementWorkflowHarness';

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


test('all refinement entry points share scope, working documents and independent application status', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const before = documents(setup), status = fixture.props.application.status;
  for (const scope of ['cv', 'letter', 'both'] as const) {
    setup.enterRefinement(scope); await idle(setup);
    assert.equal(setup.feedbackScope, scope); assert.equal(setup.tab, 'refinement');
    assert.equal(setup.pane, scope === 'letter' ? 'letter' : 'cv');
    assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
  }
  await setup.approve('cv'); setup.enterRefinement('both');
  assert.equal(setup.feedbackScope, 'letter', 'a shortcut cannot reopen an approved document');
  assert.equal(fixture.props.application.status, status);
});

test('history selection activates exact older proposal previews, and refresh keeps that review active', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const oldRequest = setup.requests[0];
  const old = fixture.cloud.seedProposal(oldRequest.id, { letterText: 'Earlier proposal.' });
  setup.updateLetter('New manual wording.'); await setup.initialPrompt();
  const current = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Current proposal.' });
  await setup.checkProposals();
  assert.equal(setup.selectedProposalId, old.id, 'publishing and refreshing preserve an already active review');
  setup.selectReviewProposal(current.id);
  assert.equal(setup.previewLetterContent?.body, 'Current proposal.');
  const before = documents(setup), status = fixture.props.application.status;
  setup.selectReviewProposal(old.id);
  assert.equal(setup.previewLetterContent?.body, 'Earlier proposal.');
  assert.match(setup.reviewAcceptanceError, /superseded/);
  await setup.checkProposals(); assert.equal(setup.selectedProposalId, old.id);
  setup.discardReview(); setup.selectReviewProposal(old.id);
  assert.equal(setup.reviewActive, true, 'selecting the same dismissed proposal reopens its temporary preview');
  assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
});

test('an older run is never automatically loaded when the current request has no proposal', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Older response.' });
  setup.updateLetter('Next round source.'); await setup.initialPrompt();
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.selectedProposalId, ''); assert.equal(reopened.reviewActive, false);
  assert.equal(reopened.proposals.length, 1, 'the old proposal remains accessible in history');
});

function proposalFile(text: () => Promise<string>) {
  return { target: { value: 'proposal.json', files: [{ size: 1000, text }] } } as unknown as Event;
}
for (const interruptedBy of ['paste', 'second file', 'new request', 'unmount'] as const) test(`pending manual proposal files yield to ${interruptedBy}`, async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const row = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'File proposal.' });
  const newer = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Newer file.' });
  fixture.database.application_refinement_proposals = [];
  let finish!: (text: string) => void;
  const pending = setup.importProposalFile(proposalFile(() => new Promise(resolve => { finish = resolve; })));
  if (interruptedBy === 'paste') setup.manualProposalText = 'newer pasted input';
  if (interruptedBy === 'second file') {
    await setup.importProposalFile(proposalFile(async () => JSON.stringify(newer.proposal_json)));
    assert.equal(setup.error, '');
  }
  if (interruptedBy === 'new request') { setup.updateLetter('New source.'); await setup.initialPrompt(); }
  if (interruptedBy === 'unmount') fixture.close();
  finish(JSON.stringify(row.proposal_json)); await pending;
  if (interruptedBy === 'second file') assert.equal(setup.previewLetterContent?.body, 'Newer file.');
  else assert.equal(setup.reviewActive, false);
  if (interruptedBy === 'paste') assert.equal(setup.manualProposalText, 'newer pasted input');
  assert.equal(setup.letterText, interruptedBy === 'new request' ? 'New source.' : 'Original private working letter.');
});

test('manual and legacy cloud letters remain in local history until explicitly restored', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const working = JSON.stringify(setup.letter!.working), beforeCloud = JSON.stringify(fixture.database);
  setup.manualLetterText = JSON.stringify({ subject: 'Imported subject', salutation: 'Dear committee,', body: 'Imported evidence.', closing: 'Kind regards' });
  setup.keepIncomingLetter(); assert.equal(setup.error, '');
  const imported = setup.letter!.revisions.at(-1)!;
  assert.equal(imported.kind, 'generated'); assert.deepEqual(imported.context, { content: 'unknown', theme: 'unknown' });
  assert.equal(JSON.stringify(setup.letter!.working), working); assert.equal(setup.historyOpen, true);
  const draft = { id: crypto.randomUUID(), user_id: account, application_id: applicationId, context_id: crypto.randomUUID(), body: 'Earlier generated letter.', created_at: '2026-09-01T00:00:00Z' };
  setup.keepIncomingLetter(draft); setup.keepIncomingLetter(draft);
  assert.equal(setup.letter!.revisions.filter(item => item.cloudDraftId === draft.id).length, 1);
  assert.equal(JSON.stringify(setup.letter!.working), working); assert.equal(JSON.stringify(fixture.database), beforeCloud);
  setup.reopenLocalLetterRevision(imported.id);
  assert.equal(setup.letter!.working.body, 'Imported evidence.'); assert.equal(setup.pane, 'letter');
  assert.ok(setup.letter!.revisions.some(item => JSON.stringify(item.content) === working), 'restoring preserves prior edits');
  assert.equal(fixture.props.application.status, 'shortlist');
});

test('restoring a legacy revision or letter backup cannot silently replace a finalized letter', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  setup.manualLetterText = 'Incoming draft.'; setup.keepIncomingLetter();
  const draftId = setup.letter!.revisions.at(-1)!.id;
  setup.letter = finalizeLetter(setup.letter!, setup.letter!.workingContext, setup.record!.state.contact);
  const before = documents(setup);
  setup.reopenLocalLetterRevision(draftId); assert.match(setup.error, /finalized letter/);
  await setup.importLetterBackup(proposalFile(async () => JSON.stringify(setup.letter)));
  assert.match(setup.error, /finalized letter/); assert.equal(documents(setup), before);
});
