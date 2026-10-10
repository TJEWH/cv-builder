import assert from 'node:assert/strict';
import test from 'node:test';
import { refinementSignature } from '../src/composables/applicationRefinement';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, mount, prepare, refinementKey } from './refinementWorkflowHarness';

test('full prompt publishes current private-filtered sources and does not require a ChatGPT database tool', async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = fixture.setup;
  await idle(setup); await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'cv'; setup.tab = 'refinement'; await idle(setup);
  let copied = '';
  navigator.clipboard.writeText = async value => { copied = value; };

  await setup.copyFullPromptWithSources();

  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  const request = setup.requests[0].request_json;
  assert.ok(copied.includes(request.requestId));
  assert.match(copied, /No Supabase connection.*required/);
  assert.match(copied, /Return proposal JSON directly/);
  assert.match(copied, /"scope":\s*"cv"/);
  assert.match(copied, /"letter"/);
  assert.match(copied, /"cvStructure"/);
  assert.match(copied, /\{\{PRIVATE_\d+\}\}/);
  assert.equal(copied.includes('execute_sql'), false);
  for (const secret of ['E2E North Lab', 'E2E South Lab', 'E2E Omit Lab', 'private.example.invalid', 'rowan@example.invalid', 'local-private-job', 'baselineState', 'sourceSignatures', 'structureBindings']) {
    assert.equal(copied.includes(secret), false, `The full prompt exposed ${secret}`);
  }
  await setup.copyFullPromptWithSources();
  assert.equal(setup.requests.length, 1, 'repeated full-prompt copying reuses the unchanged current request');
});

test('full prompt remains available for manual selection when clipboard access fails', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter', letterText: '' });
  navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable.'); };

  await setup.copyFullPromptWithSources();

  assert.ok(setup.fallbackPrompt.includes(setup.requests[0].id));
  assert.match(setup.fallbackPrompt, /source letter is intentionally empty/);
  assert.match(setup.fallbackPrompt, /No Supabase connection.*required/);
  assert.equal(setup.requests.length, 1);
});

test('pasted CV proposal applies once, preserves private content and letter, and survives reload', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'cv', letterText: '' });
  setup.tab = 'refinement'; await idle(setup);
  const request = setup.requests[0], baseline = refinementSignature(setup.localRequests[request.id].cv), originalLetter = refinementSignature(setup.letter);
  const payload = fixture.cloud.seedProposal(request.id, { persist: false }).proposal_json;
  const cloudBefore = refinementSignature(fixture.database);
  setup.proposalInput = JSON.stringify(payload);

  await setup.importProposal(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.proposalInput, '');
  assert.equal(setup.importedProposals.length, 1);
  const importedId = setup.importedProposals[0].id;
  assert.equal(setup.selectedProposalId, importedId);
  assert.equal(setup.parentProposalId, null, 'local proposal IDs must never become a cloud parent reference');
  assert.equal(fixture.creations.length, 1);
  assert.equal(setup.localRequests[request.id].acceptances?.length, 1);
  assert.equal(refinementSignature(setup.localRequests[request.id].cv), baseline);
  assert.equal(refinementSignature(setup.letter), originalLetter);
  assert.equal(refinementSignature(fixture.database), cloudBefore, 'manual proposal and its acceptance stay local');
  assert.match(setup.record!.state.experience.jobs.find(job => job.id === 'local-private-job-a')!.bullets || '', /E2E South Lab/);
  const applied = documents(setup);
  setup.proposalInput = JSON.stringify(payload);
  await setup.importProposal();
  assert.equal(setup.error, ''); assert.equal(setup.proposalInput, '');
  assert.equal(documents(setup), applied); assert.equal(fixture.creations.length, 1); assert.equal(setup.importedProposals.length, 1);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, '');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(applied)); assert.equal(setup.importedProposals[0].id, importedId);
  assert.equal(fixture.creations.length, 1);
  await setup.syncRefinement();
  assert.equal(setup.error, ''); assert.equal(setup.requests.length, 1, 'Sync must not start a fresh iteration after a local proposal was applied');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(applied)); assert.equal(fixture.creations.length, 1);
});

test('pasted initial letter draft becomes working text and the next full prompt includes it and resolved feedback', async t => {
  const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture, 'base', { scope: 'letter', letterText: '' });
  setup.tab = 'refinement'; await idle(setup);
  const first = setup.requests[0], cv = refinementSignature(setup.record!.state);
  const payload = fixture.cloud.seedProposal(first.id, { persist: false, letterText: 'The initial generated draft for the next iteration.' }).proposal_json;
  setup.proposalInput = JSON.stringify(payload);

  await setup.importProposal(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, payload.letterText);
  assert.equal(refinementSignature(setup.record!.state), cv);
  assert.equal(setup.localRequests[first.id].letterBaseline!.text, '');
  assert.equal(fixture.database.application_refinement_proposals.length, 0);
  assert.equal(await setup.saveAnnotation('annotation-2', 'resolved', 'Emphasize the confirmed reproducible experiment.', null), true);
  let copied = '';
  navigator.clipboard.writeText = async value => { copied = value; };

  await setup.copyFullPromptWithSources();

  assert.equal(setup.error, '');
  const next = setup.requests[0].request_json;
  assert.notEqual(next.requestId, first.id);
  assert.equal(next.letter.text, payload.letterText);
  assert.equal(next.parentProposalId, null);
  assert.equal(next.feedback.length, 1);
  assert.match(next.feedback[0].text, /confirmed reproducible experiment/);
  assert.ok(copied.includes(next.requestId));
  assert.ok(copied.includes(payload.letterText));
  const applied = documents(setup), revisions = setup.letter!.revisions.length;
  setup.proposalInput = JSON.stringify(payload);
  await setup.importProposal();
  assert.ok(setup.error, 'a duplicate from a superseded round must not reactivate that round');
  assert.equal(documents(setup), applied); assert.equal(setup.letter!.revisions.length, revisions);
});

for (const defect of ['invalid JSON', 'wrong request', 'invalid operation', 'stale source', 'superseded request', 'missing local snapshot', 'wrong scope', 'approved document', 'reset request'] as const) {
  test(`${defect} rejects pasted proposals before storing them or changing documents`, async t => {
    const fixture = mount(t, createPrivateRefinementCv()), setup = await prepare(fixture, 'base', { scope: 'cv', letterText: 'Original letter.' });
    setup.tab = 'refinement'; await idle(setup);
    const request = setup.requests[0], payload = fixture.cloud.seedProposal(request.id, { persist: false }).proposal_json;
    if (defect === 'wrong request') payload.requestId = crypto.randomUUID();
    if (defect === 'invalid operation') {
      assert.equal(payload.schemaVersion, 2);
      if (payload.schemaVersion !== 2) throw new Error('Expected v2');
      payload.cvOperations[0].targetId = 'unknown-target';
    }
    if (defect === 'stale source') setup.record!.state.about.text = 'A manual correction after publishing.';
    if (defect === 'superseded request') { setup.record!.state.about.text = 'A source for a new request.'; await setup.copyIterationTask(); assert.equal(setup.error, ''); }
    if (defect === 'missing local snapshot') delete setup.localRequests[request.id];
    if (defect === 'wrong scope') setup.feedbackScope = 'letter';
    if (defect === 'approved document') { await setup.approve('cv'); assert.equal(setup.error, ''); }
    if (defect === 'reset request') { await setup.resetOriginalState(); assert.equal(setup.error, ''); }
    await idle(setup);
    const before = documents(setup), cloud = refinementSignature(fixture.database), imports = refinementSignature(setup.importedProposals), creations = fixture.creations.length;
    setup.proposalInput = defect === 'invalid JSON' ? '{bad' : JSON.stringify(payload);

    await setup.importProposal(); await idle(setup);

    assert.ok(setup.error, `${defect} must provide an actionable import error`);
    assert.equal(documents(setup), before);
    assert.equal(refinementSignature(fixture.database), cloud);
    assert.equal(refinementSignature(setup.importedProposals), imports);
    assert.equal(fixture.creations.length, creations);
  });
}

test('identical pasted and cloud proposals reuse the existing proposal and acceptance', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter', letterText: '' });
  setup.tab = 'refinement'; await idle(setup);
  const cloudProposal = fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'A draft already returned through the connector.' });
  await setup.syncRefinement(); assert.equal(setup.error, '');
  const before = documents(setup), acceptedCount = setup.localRequests[cloudProposal.request_id].acceptances?.length;
  setup.proposalInput = JSON.stringify(cloudProposal.proposal_json);

  await setup.importProposal();

  assert.equal(setup.error, ''); assert.equal(setup.proposalInput, '');
  assert.equal(setup.importedProposals.length, 0); assert.equal(setup.proposals.length, 1);
  assert.equal(documents(setup), before);
  assert.equal(setup.localRequests[cloudProposal.request_id].acceptances?.length, acceptedCount);
});

test('a local save failure leaves pasted text retryable and does not apply or retain an unsaved proposal', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter', letterText: '' });
  setup.tab = 'refinement'; await idle(setup);
  const payload = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false, letterText: 'A safely retryable draft.' }).proposal_json;
  const before = documents(setup), cloud = refinementSignature(fixture.database);
  setup.proposalInput = JSON.stringify(payload);
  fixture.failSave(refinementKey);

  await setup.importProposal(); await idle(setup);

  assert.match(setup.error, /save|storage|quota/i);
  assert.equal(documents(setup), before);
  assert.equal(refinementSignature(fixture.database), cloud);
  assert.equal(setup.importedProposals.length, 0);
  assert.equal(setup.proposalInput, JSON.stringify(payload));
  assert.equal(fixture.creations.length, 0);
  setup.persist();
  await setup.importProposal(); await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, payload.letterText);
  assert.equal(setup.importedProposals.length, 1);
  assert.equal(setup.localRequests[setup.requests[0].id].acceptances?.length, 1);
});
