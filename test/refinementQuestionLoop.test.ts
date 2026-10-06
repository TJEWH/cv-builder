import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { RefinementProposalV2 } from '../src/refinementTypes';
import { createPrivateRefinementCv } from './refinementFixture';
import { documents, idle, mount, prepare, refinementKey, type Workspace } from './refinementWorkflowHarness';

const question = 'The opportunity lists robot calibration as beneficial, but the CV does not document it. Have you calibrated a robot? If so, describe one example; otherwise, would learning it support your research interests?';
const response = 'I calibrated a research robot at E2E North Lab and recorded its repeatability.';

async function importQuestion(fixture: ReturnType<typeof mount>) {
  const setup = fixture.setup;
  const incoming = fixture.cloud.seedProposal(setup.requests[0].id, { persist: false, letterText: 'A proposed motivation letter based on documented evidence.' });
  (incoming.proposal_json as RefinementProposalV2).annotations = [{ id: 'annotation-1', type: 'question', document: 'letter', location: null, text: question }];
  setup.manualProposalText = JSON.stringify(incoming.proposal_json);
  await setup.importProposal(); await idle(setup);
  assert.equal(setup.error, '');
  return setup;
}

for (const imported of [true, false]) test(`${imported ? 'imported' : 'connected'} contextual question feeds a fresh privacy-safe request without changing documents`, async t => {
  const fixture = mount(t, createPrivateRefinementCv()); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.letter!.templateSnapshot!.researchInterests = 'Reliable robot sensing and reproducible calibration, inspired by !!E2E North Lab!!.';
  setup.letter!.templateSnapshot!.questionGuidance = 'Ask about undocumented robot calibration experience when a required or beneficial qualification is relevant to the letter.';
  await setup.initialPrompt(); assert.equal(setup.error, '');
  const source = setup.requests[0], before = documents(setup);
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
  const previewBefore = JSON.stringify(setup.previewLetterContent), savedCloud = JSON.stringify(fixture.database);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', response, null), true);
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.match(setup.proposalAnnotations[0].response!, /calibrated a research robot/);
  assert.doesNotMatch(setup.proposalAnnotations[0].response!, /E2E North Lab/);
  assert.equal(setup.feedbackHistory().length, 0, 'saving an answer does not include it without consent');
  if (imported) assert.equal(JSON.stringify(fixture.database), savedCloud, 'answering an imported question stays local');
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
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(setup.feedbackHistory().length, 1, 'refresh and reload do not duplicate locally associated cloud feedback');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  setup.discardReview(); await setup.initialPrompt();
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
  assert.equal(await setup.saveAnnotation('annotation-1', 'dismissed', 'An obsolete answer.', null), false);
  assert.match(setup.error, /changed elsewhere/);
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(await setup.saveAnnotation('annotation-1', 'open', 'More precise calibration example.', firstReview), true);
  assert.equal(setup.proposalAnnotations[0].status, 'open');
  assert.equal(setup.proposalAnnotations[0].response, 'More precise calibration example.');
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
  assert.equal(JSON.stringify(fixture.database), cloudBefore);
});

test('imported feedback retries reuse a cloud receipt if local saving fails and keep answer versions distinct', async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  await importQuestion(fixture); const before = documents(setup);
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed calibration experience.', null), true);
  fixture.failSave(refinementKey);
  await setup.includeAnnotationFeedback('annotation-1');
  assert.match(setup.error, /Local storage quota reached/);
  assert.equal(setup.proposalAnnotations[0].included, false);
  assert.equal(fixture.database.application_refinement_reviews.length, 1);
  setup = fixture.reopen(); await idle(setup);
  await setup.includeAnnotationFeedback('annotation-1');
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.equal(fixture.database.application_refinement_reviews.length, 1);
  const previous = setup.proposalAnnotations[0].reviewId;
  assert.equal(await setup.saveAnnotation('annotation-1', 'resolved', 'Correction: I observed the calibration, but did not perform it.', previous), true);
  assert.equal(setup.proposalAnnotations[0].included, false, 'an edited answer needs explicit inclusion again');
  await setup.includeAnnotationFeedback('annotation-1');
  assert.equal(setup.error, '');
  assert.equal(setup.feedbackHistory().length, 2);
  assert.match(setup.feedbackHistory()[1].text, /Correction: I observed/);
  assert.deepEqual(JSON.parse(documents(setup)), JSON.parse(before));
});

async function backup(t: TestContext, setup: Workspace) {
  let saved: Blob | undefined;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { saved = blob; return 'blob:synthetic-backup'; });
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {} }) } });
  t.after(() => previousDocument ? Object.defineProperty(globalThis, 'document', previousDocument) : Reflect.deleteProperty(globalThis, 'document'));
  Object.assign(window, { setTimeout() { return 1; } });
  setup.downloadBackup(); assert.ok(saved);
  return JSON.parse(await saved.text());
}
const backupFile = (value: unknown) => ({ target: { value: 'backup.json', files: [{ size: 10000, text: async () => JSON.stringify(value) }] } }) as unknown as Event;

test('application backup roundtrip restores imported question answers and explicit feedback for the next request', async t => {
  const fixture = mount(t, createPrivateRefinementCv()); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  await importQuestion(fixture);
  await setup.saveAnnotation('annotation-1', 'resolved', response, null);
  await setup.includeAnnotationFeedback('annotation-1');
  const saved = await backup(t, setup), feedback = JSON.parse(JSON.stringify(setup.feedbackHistory()));
  const originalCv = JSON.parse(JSON.stringify(setup.record!.state)), originalLetter = JSON.parse(JSON.stringify(setup.letter!.working));
  const cloudBefore = JSON.stringify(fixture.database), originalReviewId = setup.proposalAnnotations[0].reviewId;
  await setup.saveAnnotation('annotation-1', 'open', 'A later local answer.', originalReviewId);
  await setup.importBackup(backupFile(saved));
  assert.equal(setup.error, '');
  assert.equal(setup.proposalAnnotations[0].status, 'resolved');
  assert.equal(setup.proposalAnnotations[0].reviewId, originalReviewId);
  assert.equal(setup.proposalAnnotations[0].included, true);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.record!.state)), originalCv);
  assert.deepEqual(JSON.parse(JSON.stringify(setup.letter!.working)), originalLetter);
  assert.equal(JSON.stringify(fixture.database), cloudBefore, 'backup restore is local');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.feedbackHistory())), feedback);
  await setup.initialPrompt();
  assert.equal(setup.error, '');
  assert.deepEqual(JSON.parse(JSON.stringify(setup.requests[0].request_json.feedback)), feedback);
});

test('application backup rejects invalid imported review references and approval rows without changing state', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' });
  await importQuestion(fixture);
  await setup.saveAnnotation('annotation-1', 'resolved', 'Confirmed experience.', null);
  await setup.includeAnnotationFeedback('annotation-1');
  const saved = await backup(t, setup);
  const before = documents(setup), localBefore = fixture.storage.getItem(refinementKey), cloudBefore = JSON.stringify(fixture.database);
  const invalidBackups = [
    (value: typeof saved) => { value.importedReviews[0].payload.proposalId = crypto.randomUUID(); },
    (value: typeof saved) => { value.importedReviews[0].payload.annotationId = 'annotation-999'; },
    (value: typeof saved) => { value.importedReviews[0].payload.previousReviewId = crypto.randomUUID(); },
    (value: typeof saved) => { value.importedReviews.find((row: { kind: string }) => row.kind === 'feedback').payload.annotation.reviewId = crypto.randomUUID(); },
    (value: typeof saved) => { value.importedReviews.find((row: { kind: string }) => row.kind === 'feedback').payload.scope = 'cv'; },
    (value: typeof saved) => { value.importedReviews[0].kind = 'approve_letter'; value.importedReviews[0].payload = { revision: 'v1:' + 'a'.repeat(64), expectedRevision: 1 }; },
  ];
  for (const mutate of invalidBackups) {
    const value = structuredClone(saved); mutate(value);
    await setup.importBackup(backupFile(value));
    assert.match(setup.error, /backup|review|annotation|feedback/i);
    assert.equal(documents(setup), before);
    assert.equal(fixture.storage.getItem(refinementKey), localBefore);
    assert.equal(JSON.stringify(fixture.database), cloudBefore);
  }
});
