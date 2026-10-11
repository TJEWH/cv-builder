import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRefinementRepository, refinementSignature } from '../src/composables/applicationRefinement';
import { createRefinementFixture } from './refinementFixture';
import { stub } from './helpers';
import { refinementMatchesScope } from '../src/composables/refinementHistory';
import { account, applicationId, documents, idle, mount, prepare, refinementKey, type Workspace } from './refinementWorkflowHarness';

const documentFingerprint = (setup: Workspace) => refinementSignature(JSON.parse(documents(setup)));
const scopedRequests = (setup: Workspace) => setup.requests.filter(row => refinementMatchesScope(row.request_json.scope, setup.pane, row.cleared_scopes));

function history(setup: Workspace) {
  return refinementSignature({ requests: setup.requests, proposals: setup.proposals, reviews: setup.reviews,
    localRequests: setup.localRequests,
    parent: setup.parentProposalId, selected: setup.selectedProposalId, review: setup.reviewActive, feedback: setup.feedbackHistory() });
}

function assertEmptyHistory(setup: Workspace) {
  assert.deepEqual(scopedRequests(setup), []);
  assert.equal(Object.values(setup.localRequests).some(local => !local.publishedAt && refinementMatchesScope(local.request.scope, setup.pane)), false);
  assert.deepEqual(setup.feedbackHistory(), []); assert.deepEqual(setup.resetRequestIds, []);
  assert.equal(setup.parentProposalId, null); assert.equal(setup.selectedProposalId, ''); assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.proposalAnnotations, []); assert.equal(setup.canClearHistory, false);
  assert.equal(setup.showInitialRefinement, true);
}

function assertFreshInitialRequest(setup: Workspace) {
  assert.equal(scopedRequests(setup).length, 1);
  const request = scopedRequests(setup)[0];
  assert.equal(setup.cloudState!.current_request_id, request.id);
  assert.ok(setup.localRequests[request.id]);
  assert.equal(setup.localRequests[request.id].publishedAt, request.created_at);
  assert.equal(request.request_json.parentProposalId, null); assert.deepEqual(request.request_json.feedback, []);
  assert.equal(setup.proposals.some(row => row.request_id === request.id), false);
  assert.deepEqual(setup.feedbackHistory(), []); assert.deepEqual(setup.resetRequestIds, []);
  assert.equal(setup.parentProposalId, null); assert.equal(setup.selectedProposalId, ''); assert.equal(setup.reviewActive, false);
  assert.deepEqual(setup.proposalAnnotations, []); assert.equal(setup.showInitialRefinement, true);
}

test('clear history deletes cloud and local iterations while preserving working documents and creates a fresh next task', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const firstId = setup.requests[0].id;
  fixture.cloud.seedProposal(firstId, { letterText: 'Current draft to keep after clearing history.' });
  await setup.syncRefinement(); assert.equal(setup.error, '');
  assert.equal(setup.showInitialRefinement, false);
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Previous iteration answer.', null), true);
  assert.equal(setup.feedbackHistory().length, 1);
  await setup.checkProposals(); setup.openProposal();
  assert.equal(setup.reviewActive, false); assert.equal(setup.canClearHistory, true);
  assert.equal(setup.feedbackHistory().length, 1, 'the letter round retains its saved question answer');
  const before = documentFingerprint(setup), state = JSON.parse(JSON.stringify(setup.cloudState));

  await setup.clearRefinementHistory();

  assert.equal(setup.error, ''); assertEmptyHistory(setup);
  assert.equal(documentFingerprint(setup), before);
  assert.equal(setup.reviews.every(row => row.kind === 'cv_decisions'), true, 'historical CV decision sources remain available');
  assert.equal(setup.cloudState!.revision, state.revision + 1);
  assert.equal(setup.cloudState!.current_request_id, null);
  assert.deepEqual(setup.cloudState!.setup_json, state.setup_json);
  assert.deepEqual(setup.cloudState!.approvals_json, state.approvals_json);
  const stored = JSON.parse(fixture.storage.getItem(refinementKey)!);
  assert.deepEqual(Object.keys(stored.requests).sort(), setup.requests.map(row => row.id).sort());

  setup = fixture.reopen(); await idle(setup); await setup.checkProposals();
  assert.equal(setup.error, ''); assertFreshInitialRequest(setup); assert.equal(documentFingerprint(setup), before);
  const loadedRequestId = scopedRequests(setup)[0].id;
  await setup.copyIterationTask();
  assert.equal(setup.error, ''); assert.equal(scopedRequests(setup).length, 1);
  assert.equal(scopedRequests(setup)[0].id, loadedRequestId, 'copying reuses the initial request automatically published on load');
  assert.equal(setup.showInitialRefinement, true, 'the first task after clearing history awaits an initial proposal');
  const next = scopedRequests(setup)[0].request_json;
  assert.notEqual(next.requestId, firstId); assert.equal(next.parentProposalId, null); assert.deepEqual(next.feedback, []);
  assert.equal(next.letter.text, 'Current draft to keep after clearing history.');
  assert.equal(documentFingerprint(setup), before);
});

test('clearing iteration history keeps both document approvals and all letter revisions through reload', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Approved final draft.' });
  await setup.syncRefinement(); await setup.approve('letter'); await setup.approve('cv');
  assert.equal(setup.error, ''); assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, true);
  const before = documentFingerprint(setup), approvals = JSON.parse(JSON.stringify(setup.approvals));
  assert.ok(setup.letter!.revisions.length);

  setup.feedbackScope = 'letter'; await idle(setup);
  await setup.clearRefinementHistory();

  const assertLetterHistoryCleared = () => {
    assert.equal(setup.error, ''); assert.equal(setup.canClearHistory, false);
    assert.equal(setup.requests.some(row => refinementMatchesScope(row.request_json.scope, 'letter', row.cleared_scopes)), false);
    assert.equal(setup.reviews.some(row => row.kind === 'approve_letter'), false);
    assert.equal(setup.reviews.some(row => row.kind === 'approve_cv'), true, 'CV approval history survives clearing letter history');
    assert.equal(documentFingerprint(setup), before);
  };
  assertLetterHistoryCleared();
  assert.deepEqual(setup.approvals, approvals); assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, true);
  setup = fixture.reopen(); await idle(setup);
  assertLetterHistoryCleared();
  assert.deepEqual(setup.approvals, approvals); assert.equal(setup.cvApproved, true); assert.equal(setup.letterApproved, true);
});

for (const failure of [
  { error: { message: 'Cloud history is temporarily unavailable.' }, expected: /temporarily unavailable/ },
  { error: { code: 'PGRST202', message: 'Function not found.' }, expected: /database setup is incomplete/i },
]) test(`failed history clear preserves local and cloud history: ${failure.error.message}`, async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Saved proposed draft.' });
  await setup.checkProposals(); setup.openProposal();
  const before = documentFingerprint(setup), savedHistory = history(setup), cloud = refinementSignature(fixture.database);
  const local = fixture.storage.getItem(refinementKey), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'clear_refinement_history'
    ? { data: null, error: failure.error } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;

  await setup.clearRefinementHistory();

  assert.match(setup.error, failure.expected); assert.equal(documentFingerprint(setup), before); assert.equal(history(setup), savedHistory);
  assert.equal(refinementSignature(fixture.database), cloud); assert.equal(fixture.storage.getItem(refinementKey), local);
});

test('cloud-confirmed history removal recovers on reload when persisting local cleanup initially fails', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const firstId = setup.requests[0].id;
  fixture.cloud.seedProposal(firstId, { letterText: 'Keep this working draft through cleanup recovery.' });
  await setup.syncRefinement(); assert.equal(setup.error, '');
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Keep this saved answer only until history is cleared.', null), true);
  const before = documentFingerprint(setup);
  fixture.failSave(refinementKey);

  await setup.clearRefinementHistory();

  assert.equal(documentFingerprint(setup), before);
  assert.equal(fixture.database.application_refinement_requests.every(row => (row.cleared_scopes as string[]).includes('letter')), true);
  setup = fixture.reopen(); await idle(setup); await setup.checkProposals();
  assert.equal(setup.error, ''); assert.equal(setup.saveError, ''); assertFreshInitialRequest(setup);
  assert.notEqual(scopedRequests(setup)[0].id, firstId);
  assert.equal(scopedRequests(setup)[0].request_json.letter.text, 'Keep this working draft through cleanup recovery.');
  assert.equal(documentFingerprint(setup), before);
});

test('observed cloud publication recovers a missing receipt and remote clearing retains only genuinely unpublished work', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  const publishedId = setup.requests[0].id;
  setup.updateLetter('A new working draft awaiting its first publication.');
  const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'publish_refinement_request'
    ? { data: null, error: { message: 'Publication temporarily unavailable.' } } : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;
  await setup.publishSources();
  assert.match(setup.error, /Publication temporarily unavailable/);
  const pendingId = Object.keys(setup.localRequests).find(id => id !== publishedId)!;
  assert.ok(pendingId); assert.equal(setup.localRequests[pendingId].publishedAt, undefined);
  const pending = refinementSignature(setup.localRequests[pendingId]);
  delete setup.localRequests[publishedId].publishedAt; setup.persist();
  fixture.cloud.client.rpc = rpc;

  await setup.checkProposals();

  assert.equal(setup.error, '');
  assert.equal(setup.localRequests[publishedId].publishedAt, setup.requests[0].created_at);
  assert.equal(refinementSignature(setup.localRequests[pendingId]), pending);
  const before = documentFingerprint(setup);
  await createRefinementRepository(fixture.cloud.client, () => account).clearHistory(applicationId, setup.cloudState!.revision);
  await setup.checkProposals();
  assert.equal(setup.error, ''); assert.deepEqual(setup.requests, []);
  assert.deepEqual(Object.keys(setup.localRequests), [pendingId]);
  assert.equal(refinementSignature(setup.localRequests[pendingId]), pending);
  assert.equal(documentFingerprint(setup), before);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, ''); assert.deepEqual(Object.keys(setup.localRequests), [pendingId]);
  assert.equal(setup.requests.length, 1); assert.equal(setup.requests[0].id, pendingId);
  const { publishedAt, ...publishedPending } = setup.localRequests[pendingId];
  assert.equal(publishedAt, setup.requests[0].created_at);
  assert.equal(refinementSignature(publishedPending), pending, 'automatic sync publishes the same pending receipt without changing its frozen sources');
  assert.equal(documentFingerprint(setup), before);
});

test('repository clear targets only the owned application and rejects stale revisions', async t => {
  const source = mount(t), setup = await prepare(source, 'base', { scope: 'letter' });
  const state = JSON.parse(JSON.stringify(setup.cloudState!));
  const owned = '10000000-0000-4000-8000-000000000002', foreign = '10000000-0000-4000-8000-000000000003';
  const empty = '10000000-0000-4000-8000-000000000004';
  const database: Record<string, Record<string, unknown>[]> = {
    applications: [{ id: applicationId, user_id: account }, { id: owned, user_id: account }, { id: foreign, user_id: 'other' }, { id: empty, user_id: account }],
    application_refinement_state: [applicationId, owned, foreign].map(id => ({ ...state, application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_requests: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_proposals: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), application_id: id, user_id: id === foreign ? 'other' : account })),
    application_refinement_reviews: [applicationId, owned, foreign].map(id => ({ id: crypto.randomUUID(), application_id: id, user_id: id === foreign ? 'other' : account })),
  };
  const fixture = createRefinementFixture(database, account), repository = createRefinementRepository(fixture.client, () => account);
  const before = refinementSignature(database);
  await assert.rejects(repository.clearHistory(applicationId, state.revision - 1), /changed|revision/i);
  await assert.rejects(repository.clearHistory(foreign, 0), /application/i);
  assert.equal(refinementSignature(database), before);
  assert.equal(await repository.clearHistory(empty, 0), null);
  assert.equal(refinementSignature(database), before);
  const cleared = await repository.clearHistory(applicationId, state.revision);
  assert.equal(cleared!.revision, state.revision + 1); assert.equal(cleared!.current_request_id, null);
  assert.deepEqual(database.application_refinement_state.slice(1), [owned, foreign].map(id => ({ ...state, application_id: id, user_id: id === foreign ? 'other' : account })));
  for (const table of ['application_refinement_requests', 'application_refinement_proposals', 'application_refinement_reviews']) {
    assert.deepEqual(database[table].map(row => row.application_id), [owned, foreign]);
  }
});

test('repository clear validates its returned revision, empty current request, owner, and session', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const state = JSON.parse(JSON.stringify(setup.cloudState!));
  const receipt = { ...state, revision: state.revision + 1, current_request_id: null };
  for (const invalid of [{ ...receipt, application_id: crypto.randomUUID() }, { ...receipt, user_id: 'other' },
    { ...receipt, revision: state.revision }, { ...receipt, current_request_id: setup.requests[0].id }, null]) {
    const client = stub<SupabaseClient>({ rpc: async () => ({ data: invalid, error: null }) });
    await assert.rejects(createRefinementRepository(client, () => account).clearHistory(applicationId, state.revision), /verif|confirm/i);
  }
  let current = account;
  const client = stub<SupabaseClient>({ rpc: async () => { current = 'other'; return { data: receipt, error: null }; } });
  await assert.rejects(createRefinementRepository(client, () => current).clearHistory(applicationId, state.revision), /Session changed/i);
});

test('scoped repository clearing retains the other document and clears legacy shared rounds one facet at a time', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const letterId = setup.requests[0].id, cvId = crypto.randomUUID(), sharedId = crypto.randomUUID();
  const source = structuredClone(fixture.database.application_refinement_requests[0]);
  for (const [id, scope] of [[cvId, 'cv'], [sharedId, 'both']] as const) {
    const row = structuredClone(source);
    row.id = id;
    const request = row.request_json as typeof setup.requests[0]['request_json'];
    request.requestId = id; request.cv.requestId = id; request.scope = scope;
    fixture.database.application_refinement_requests.push(row);
  }
  for (const id of [letterId, cvId, sharedId]) fixture.cloud.seedProposal(id);
  const cvFeedback = await repository.saveReview(applicationId, null, 'feedback', { text: 'CV evidence.', scope: 'cv' });
  const letterFeedback = await repository.saveReview(applicationId, null, 'feedback', { text: 'Letter fit.', scope: 'letter' });
  const sharedFeedback = await repository.saveReview(applicationId, null, 'feedback', { text: 'Shared research.', scope: 'both' });
  const cloudState = fixture.database.application_refinement_state[0];
  cloudState.current_request_id = sharedId;
  const originalState = structuredClone(cloudState);
  const originalLetter = refinementSignature(fixture.database.application_refinement_requests.find(row => row.id === letterId));

  const clearedCv = await repository.clearHistory(applicationId, Number(cloudState.revision), 'cv');

  assert.equal(clearedCv!.current_request_id, sharedId);
  assert.deepEqual(clearedCv!.setup_json, originalState.setup_json);
  assert.deepEqual(clearedCv!.approvals_json, originalState.approvals_json);
  const requests = await repository.listRequests(applicationId), reviews = await repository.listReviews(applicationId);
  assert.equal(requests.some(row => row.id === cvId), false);
  assert.deepEqual(requests.find(row => row.id === sharedId)!.cleared_scopes, ['cv']);
  assert.equal(refinementSignature(requests.find(row => row.id === letterId)), originalLetter);
  assert.equal((await repository.listProposals(applicationId)).some(row => row.request_id === cvId), false);
  assert.equal(reviews.some(row => row.id === cvFeedback.id), false);
  assert.deepEqual(reviews.find(row => row.id === letterFeedback.id), letterFeedback);
  assert.deepEqual(reviews.find(row => row.id === sharedFeedback.id)!.cleared_scopes, ['cv']);

  await assert.rejects(repository.clearHistory(applicationId, Number(originalState.revision), 'letter'), /changed|revision/i);
  const clearedLetter = await repository.clearHistory(applicationId, clearedCv!.revision, 'letter');
  assert.equal(clearedLetter!.current_request_id, null);
  assert.deepEqual(await repository.listRequests(applicationId), []);
  assert.deepEqual(await repository.listProposals(applicationId), []);
  assert.deepEqual(await repository.listReviews(applicationId), []);
});

test('scoped repository clearing preserves a current request belonging only to the other document', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const requestId = setup.requests[0].id;
  const state = await repository.clearHistory(applicationId, setup.cloudState!.revision, 'cv');
  assert.equal(state!.current_request_id, requestId);
  assert.equal((await repository.listRequests(applicationId))[0].id, requestId);
});

test('scoped clearing keeps historical opposite-document reviews and their original source request', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'cv' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  const requestId = setup.requests[0].id;
  const proposal = fixture.cloud.seedProposal(requestId);
  const feedback = await repository.saveReview(applicationId, requestId, 'feedback', { text: 'Letter motivation.', scope: 'letter' });
  const annotation = await repository.saveReview(applicationId, requestId, 'annotation', {
    proposalId: proposal.id, annotationId: 'annotation-2', status: 'resolved', response: 'Confirmed motivation.', previousReviewId: null,
  });
  const beforeProposal = refinementSignature(await repository.listProposals(applicationId));

  const state = await repository.clearHistory(applicationId, setup.cloudState!.revision, 'cv');

  assert.equal(state!.current_request_id, null, 'cleared CV request must not remain active despite retained letter source');
  const requests = await repository.listRequests(applicationId);
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].cleared_scopes, ['cv']);
  assert.equal(refinementMatchesScope(requests[0].request_json.scope, 'cv', requests[0].cleared_scopes), false);
  assert.deepEqual(await repository.listReviews(applicationId), [feedback, annotation]);
  assert.equal(refinementSignature(await repository.listProposals(applicationId)), beforeProposal);

  await repository.clearHistory(applicationId, state!.revision, 'letter');
  assert.deepEqual(await repository.listRequests(applicationId), []);
  assert.deepEqual(await repository.listProposals(applicationId), []);
  assert.deepEqual(await repository.listReviews(applicationId), []);
});

test('repository readers reject malformed cleared history scopes', async t => {
  const fixture = mount(t); await prepare(fixture, 'base', { scope: 'letter' });
  const repository = createRefinementRepository(fixture.cloud.client, () => account);
  await repository.saveReview(applicationId, null, 'feedback', { text: 'Research evidence.', scope: 'both' });
  for (const invalid of [null, 'cv', ['both'], ['cv', 'cv'], ['cv', 'letter', 'cv']]) {
    fixture.database.application_refinement_requests[0].cleared_scopes = invalid;
    await assert.rejects(repository.listRequests(applicationId), /scopes.*verified/i);
    fixture.database.application_refinement_reviews[0].cleared_scopes = invalid;
    await assert.rejects(repository.listReviews(applicationId), /scopes.*verified/i);
  }
});
