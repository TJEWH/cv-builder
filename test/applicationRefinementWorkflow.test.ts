import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneCv, loadApplicationCv } from '../src/composables/applicationCv';
import { finalizeLetter } from '../src/composables/motivationLetters';
import type { ApplicationLetter } from '../src/letterTypes';
import { account, applicationId, refinementKey, mount, prepare, idle, documents, loadHistoricalProposal } from './refinementWorkflowHarness';

test('loading an existing local proposal activates the complete temporary candidate without a cloud write or document save', async t => {
  const fixture = mount(t); const setup = await prepare(fixture);
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Imported proposed letter.' });
  fixture.database.application_refinement_proposals = [];
  const savedDocuments = documents(setup), savedPrivate = JSON.stringify(setup.localRequests), savedCloud = JSON.stringify(fixture.database);
  await loadHistoricalProposal(setup, incoming);
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

test('accepting a historical local proposal commits locally and persists its idempotent receipt across reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture);
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Locally accepted imported proposal.' });
  fixture.database.application_refinement_proposals = [];
  const beforeCloud = JSON.stringify(fixture.database);
  await loadHistoricalProposal(setup, incoming);
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


test('refinement scope changes preserve working documents and independent application status', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const before = documents(setup), status = fixture.props.application.status;
  for (const scope of ['cv', 'letter', 'both'] as const) {
    setup.tab = 'refinement'; setup.feedbackScope = scope; await idle(setup);
    assert.equal(setup.feedbackScope, scope); assert.equal(setup.tab, 'refinement');
    assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
  }
  await setup.approve('cv'); await idle(setup);
  assert.equal(setup.feedbackScope, 'letter', 'approving the CV switches refinement to the letter');
  assert.equal(fixture.props.application.status, status);
});

test('history selection activates exact older proposal previews, and refresh keeps that review active', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const oldRequest = setup.requests[0];
  const old = fixture.cloud.seedProposal(oldRequest.id, { letterText: 'Earlier proposal.' });
  setup.updateLetter('New manual wording.'); await setup.publishSources();
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
  assert.equal(setup.reviewActive, true, 'selecting the same ignored proposal reopens its temporary preview');
  assert.equal(documents(setup), before); assert.equal(fixture.props.application.status, status);
});

test('an older run is never automatically loaded when the current request has no proposal', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Older response.' });
  setup.updateLetter('Next round source.'); await setup.publishSources();
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.selectedProposalId, ''); assert.equal(reopened.reviewActive, false);
  assert.equal(reopened.proposals.length, 1, 'the old proposal remains accessible in history');
});

for (const scope of ['cv', 'letter', 'both'] as const) test(`short ${scope} task copies the application reference only after publishing the matching current sources`, async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  fixture.props.application.application_code = 'APP-SYNTHETIC';
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  setup.feedbackScope = scope;
  await setup.publishSources();
  assert.equal(copied.length, 0, 'publishing must not copy anything');
  await setup.copyTask();
  assert.equal(setup.error, '');
  const document = scope === 'cv' ? 'CV' : scope === 'letter' ? 'motivation letter' : 'both';
  assert.ok(copied.at(-1)!.startsWith(`phd-workflow: APP-SYNTHETIC — refine ${document}.\n`));
  const current = fixture.database.application_refinement_state[0].current_request_id;
  assert.equal(typeof current, 'string');
  assert.equal(setup.requests.find(row => row.id === current)?.request_json.scope, scope);
  assert.ok(copied.at(-1)!.includes(`published request ${current}`));
  assert.ok(copied.at(-1)!.includes(`scope ${scope}`));
  assert.ok(!copied.at(-1)!.includes('Original private working letter.'));
  const storedProtocol = fixture.database.application_refinement_protocols.find(row => row.request_id === current)!;
  assert.ok(storedProtocol, 'copy stores the protocol for an already-published request');
  assert.ok(copied.at(-1)!.includes(`SELECT private.read_refinement_protocol('${current}'::uuid, E'${storedProtocol.protocol_id}')`));
  assert.match(copied.at(-1)!, /public.application_refinement_protocols.*protocol_text/);
  assert.match(String(storedProtocol.protocol_text), /private.save_refinement_proposal/);
  assert.match(String(storedProtocol.protocol_text), /precisely this JSON contract/);
  assert.doesNotMatch(String(storedProtocol.protocol_text), /Original private working letter|BEGIN_APPROVED_REQUEST_JSON/);
  const count = setup.requests.length;
  await setup.copyTask(); assert.equal(setup.requests.length, count, 'unchanged sources reuse the published request');
  assert.equal(fixture.database.application_refinement_protocols.length, 1, 'copy retries reuse the identical protocol');
  setup.updateLetter('Manual correction for the next round.');
  await setup.copyTask(); assert.match(setup.error, /Publish the current sources/);
  assert.equal(copied.length, 2, 'copying changed sources must not publish or copy an old request');
  assert.equal(setup.requests.length, count);
  await setup.publishSources(); assert.equal(copied.length, 2);
  await setup.copyTask(); assert.equal(setup.requests.length, count + 1);
  assert.ok(copied.at(-1)!.includes(`published request ${fixture.database.application_refinement_state[0].current_request_id}`));
  assert.ok(!copied.at(-1)!.includes(String(current)), 'the next task cannot retain a superseded request reference');
  setup.updateLetter('Unpublished changed source.');
  fixture.cloud.client.rpc = (() => Promise.resolve({ data: null, error: new Error('Synthetic publication failure') })) as unknown as typeof fixture.cloud.client.rpc;
  await setup.publishSources(); assert.ok(setup.error); assert.equal(copied.length, 3);
  await setup.copyTask(); assert.ok(setup.error); assert.equal(copied.length, 3, 'failed publication must not copy an instruction for old sources');
});

test('copy task does not copy a protocol locator when publication fails or returns a mismatched receipt', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  for (const mode of ['missing', 'mismatch']) {
    fixture.cloud.client.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name !== 'publish_refinement_protocol') return rpc(name, args);
      if (mode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Missing protocol RPC' } };
      const result = await rpc(name, args);
      return { ...result, data: { ...result.data, protocol_text: 'Wrong protocol' } };
    }) as unknown as typeof fixture.cloud.client.rpc;
    await setup.copyTask();
    assert.match(setup.error, mode === 'missing' ? /pending migration/ : /protocol could not be confirmed/);
    assert.equal(copied.length, 0);
  }
});

test('connected setup copies the published request without creating another round', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  await setup.connectedPrompt(); assert.equal(setup.error, '');
  assert.match(copied.at(-1)!, /private.read_refinement_request/);
  assert.match(copied.at(-1)!, /If execute_sql is unavailable, report a missing capability/);
  assert.doesNotMatch(copied.at(-1)!, /BEGIN_APPROVED_REQUEST_JSON/);
  await setup.publishSources();
  assert.equal(copied.length, 1, 'publishing and copying are independent');
  assert.equal(setup.requests.length, 1);
});

test('an empty letter publishes an explicit first-draft task and switches to refinement after a working draft exists', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { letterText: '', scope: 'letter' });
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  const before = documents(setup);
  await setup.copyTask();
  assert.equal(setup.error, '');
  assert.match(copied.at(-1)!, /create an initial motivation-letter draft/);
  assert.match(copied.at(-1)!, /no existing letter is required/);
  assert.equal(setup.requests[0].request_json.letter.text, '');
  assert.equal(documents(setup), before, 'copying the task must not generate or replace local letter content');
  setup.updateLetter('A complete manually written letter.');
  await setup.publishSources(); await setup.copyTask();
  assert.equal(setup.error, '');
  assert.match(copied.at(-1)!, /refine motivation letter/);
  assert.match(copied.at(-1)!, /Refine the complete existing letter/);
  assert.doesNotMatch(copied.at(-1)!, /source letter is intentionally empty/);
  assert.equal(setup.requests[0].request_json.letter.text, 'A complete manually written letter.');
});

test('later application statuses open Tracking despite an earlier saved tab, while preparation statuses retain navigation', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  const navigationKey = `CV_APPLICATION_TAB:${account}:${applicationId}`;
  for (const status of ['submitted', 'interview', 'offer', 'rejected', 'withdrawn'] as const) {
    fixture.props.application.status = status;
    fixture.storage.setItem(navigationKey, 'refinement');
    const setup = fixture.reopen(); await idle(setup);
    assert.equal(setup.tab, 'tracking');
    setup.tab = 'preparation'; await idle(setup);
    assert.equal(setup.tab, 'preparation', 'default selection must not lock other tabs');
  }
  for (const status of ['shortlist', 'contacted'] as const) {
    fixture.props.application.status = status;
    fixture.storage.setItem(navigationKey, 'refinement');
    const setup = fixture.reopen(); await idle(setup); assert.equal(setup.tab, 'refinement');
    fixture.props.application.status = 'submitted'; await idle(setup); assert.equal(setup.tab, 'tracking');
  }
});

test('new applications and saved combined scopes select a separate document scope', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  assert.equal(fixture.setup.feedbackScope, 'cv');
  const setup = await prepare(fixture, 'base', { scope: 'both' });
  fixture.cloud.seedProposal(setup.requests[0].id);
  const reopened = fixture.reopen(); await idle(reopened);
  assert.equal(reopened.feedbackScope, 'cv', 'an old combined scope must not return to the dropdown');
  reopened.openProposal();
  assert.match(reopened.reviewAcceptanceError, /separate request/);
  reopened.discardReview(); reopened.feedbackScope = 'letter'; await reopened.publishSources();
  assert.equal(reopened.error, '');
  assert.equal(reopened.requests[0].request_json.scope, 'letter');
  const again = fixture.reopen(); await idle(again);
  assert.equal(again.feedbackScope, 'letter');
});
