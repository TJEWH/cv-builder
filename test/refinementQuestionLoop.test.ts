import assert from 'node:assert/strict';
import test from 'node:test';
import type { RefinementProposalV2 } from '../src/refinementTypes';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, mount, prepare, refinementKey, loadHistoricalProposal } from './refinementWorkflowHarness';

const question = 'The opportunity lists robot calibration as beneficial, but the CV does not document it. Have you calibrated a robot? If so, describe one example; otherwise, would learning it support your research interests?';
const response = 'I calibrated a research robot at E2E North Lab and recorded its repeatability.';

async function importQuestion(fixture: ReturnType<typeof mount>) {
  const setup = fixture.setup;
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false, letterText: 'A proposed motivation letter based on documented evidence.' });
  (incoming.proposal_json as RefinementProposalV2).annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null, text: question }];
  await loadHistoricalProposal(setup, incoming);
  assert.equal(setup.error, '');
  return setup;
}

for (const imported of [true, false]) test(`${imported ? 'imported' : 'connected'} resolved contextual question automatically feeds a fresh privacy-safe request without changing documents`, async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.letter!.templateSnapshot!.researchInterests = 'Reliable robot sensing and reproducible calibration, inspired by E2E North Lab.';
  setup.letter!.templateSnapshot!.questionGuidance = 'Ask about undocumented robot calibration experience when a required or beneficial qualification is relevant to the letter.';
  await setup.publishSources(); assert.equal(setup.error, '');
  const source = setup.requests[0];
  assert.match(source.request_json.letter.template.researchInterests!, /Reliable robot sensing/);
  assert.doesNotMatch(JSON.stringify(source.request_json), /E2E North Lab/);
  assert.match(source.request_json.letter.template.questionGuidance!, /undocumented robot calibration/);
  if (imported) await importQuestion(fixture);
  else {
    const incoming = fixture.cloud.seedProposal(source.id, { letterText: 'A proposed motivation letter based on documented evidence.' });
    const payload = incoming.proposal_json as RefinementProposalV2;
    payload.annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null, text: question }];
    fixture.database.application_refinement_proposals[0].proposal_json = payload;
    await setup.checkProposals();
  }
  await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, 'A proposed motivation letter based on documented evidence.');
  const proposalId = setup.selectedProposalId;
  const before = documents(setup), previewBefore = JSON.stringify(setup.previewLetterContent), savedCloud = JSON.stringify(fixture.database);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', response, null), true);
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.match(setup.proposalAnnotations[0].response!, /calibrated a research robot/);
  assert.doesNotMatch(setup.proposalAnnotations[0].response!, /E2E North Lab/);
  assert.equal(setup.feedbackHistory().length, 1, 'resolving saves and includes the answer automatically');
  assert.notEqual(JSON.stringify(fixture.database), savedCloud, 'resolved answers create a saved feedback receipt');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  assert.equal(JSON.stringify(setup.previewLetterContent), previewBefore);
  await setup.includeAnnotationFeedback('annotation-1'); await setup.includeAnnotationFeedback('annotation-1');
  assert.equal(setup.error, '');
  assert.equal(setup.feedbackHistory().length, 1);
  const shared = setup.feedbackHistory()[0];
  assert.match(shared.text, /robot calibration as beneficial/);
  assert.match(shared.text, /User response: I calibrated a research robot/);
  assert.doesNotMatch(shared.text, /E2E North Lab/);
  assert.equal(!!shared.annotation, !imported, 'local-only proposal references never become cloud foreign keys');
  assert.equal(fixture.database.application_refinement_reviews.filter(row => row.kind === 'feedback').length, 1);
  setup = fixture.reopen(); await idle(setup);
  if (imported) setup.selectReviewProposal(proposalId);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(setup.feedbackHistory().length, 1, 'refresh and reload do not duplicate locally associated cloud feedback');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  const next = setup.requests[0].request_json;
  assert.notEqual(next.requestId, source.id);
  assert.deepEqual(JSON.parse(JSON.stringify(next.feedback)), [shared]);
  assert.equal(next.letter.template.researchInterests, source.request_json.letter.template.researchInterests);
  assert.equal(next.letter.template.questionGuidance, source.request_json.letter.template.questionGuidance);
  assert.doesNotMatch(JSON.stringify(next), /E2E North Lab|E2E South Lab|E2E Omit Lab|structureBindings|baselineState/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

test('imported annotation answers reject stale updates and roll back failed local saves', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  await importQuestion(fixture); const before = documents(setup), cloudBefore = JSON.stringify(fixture.database);
  fixture.failSave(refinementKey);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', null), false);
  assert.match(setup.error, /Local storage quota reached/);
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  setup.persist();
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', null), true);
  const firstReview = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', firstReview), true);
  assert.equal(setup.proposalAnnotations[0].reviewId, firstReview, 'an unchanged answer is idempotent');
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', 'An obsolete answer.', null), false);
  assert.match(setup.error, /changed elsewhere/);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(await setup.saveAnnotation('annotation-1', 'open', 'More precise calibration example.', firstReview), true);
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  assert.equal(setup.proposalAnnotations[0].response, 'More precise calibration example.');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  assert.notEqual(JSON.stringify(fixture.database), cloudBefore, 'resolution and reopening preserve ordered feedback and cancellation receipts');
});

for (const imported of [false, true]) test(`${imported ? 'historical local' : 'connected'} feedback failure retries the saved answer without duplicates`, async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  if (imported) await importQuestion(fixture);
  else {
    fixture.cloud.seedProposal(setup.requests[0].id); await setup.checkProposals();
  }
  await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  const proposalId = setup.selectedProposalId;
  const before = documents(setup), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  let fail = true;
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'save_refinement_review' && args.p_kind === 'feedback' && fail) { fail = false; return { data: null, error: new Error('Feedback unavailable') }; }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', null), false);
  assert.match(setup.error, /Feedback unavailable/);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].included, false);
  setup = fixture.reopen(); await idle(setup);
  if (imported) setup.selectReviewProposal(proposalId);
  const reference = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', reference), true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', reference), true);
  assert.equal(setup.feedbackHistory().length, 1);
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Correction: I observed the calibration, but did not perform it.', reference), true);
  assert.equal(setup.feedbackHistory().length, 2);
  assert.match(setup.feedbackHistory()[1].text, /Correction: I observed/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

for (const previouslyResolved of [false, true]) test(`ignored comments ${previouslyResolved ? 'cancel their earlier feedback' : 'never enter feedback'}`, async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id); await setup.syncRefinement(); await idle(setup); assert.equal(setup.error, '');
  const before = documents(setup), request = setup.requests[0];
  if (previouslyResolved) assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Earlier response that must be ignored.', null), true);
  const reviewId = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'ignored', 'Earlier response that must be ignored.', reviewId), true);
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.equal(setup.feedbackHistory().length, previouslyResolved ? 2 : 0);
  if (previouslyResolved) {
    assert.match(setup.feedbackHistory().at(-1)!.text, /Status: ignored.*Ignore this annotation/s);
    assert.doesNotMatch(setup.feedbackHistory().at(-1)!.text, /Earlier response/);
  }
  setup = fixture.reopen(); await idle(setup); setup.discardReview(); await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'ignored');
  assert.equal(setup.requests[0].request_json.feedback.length, previouslyResolved ? 2 : 0);
  assert.equal(request.request_json.feedback.length, 0, 'older published requests remain immutable');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});
