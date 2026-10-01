import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalRefinementRequest, RefinementFeedback, RefinementProposalV1, RefinementProposalV2, RefinementRequest, RefinementSetup } from '../src/refinementTypes';
import { applyRefinementProposal, buildRefinementPrompt, createRefinementRepository, parseRefinementProposal, prepareRefinement, refinementSignature, sanitizeRefinementSetup, sanitizeRefinementText } from '../src/composables/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES } from '../src/composables/motivationLetters';
import { createTestState, stub } from './helpers';

const APP = 'c73b875d-e9bf-4655-adb1-1c2e63d1f4b4';
const CREATED = '2026-09-22T09:00:00.000Z';
function state() {
  return createTestState({ contact: { name: 'Taylor Green', role: 'Researcher', location: 'Berlin', email: 'taylor@example.com', phone: '+49 12345', website: 'https://taylor.example.com', linkedin: '', github: '' },
    about: { text: 'Taylor Green researches robotics with !!private collaboration!!.' },
    education: [{ id: 'local-education', institution: 'Public university', title: 'Physics', start: '2019', end: '2023', state: 'complete' }],
    experience: { jobs: [{ id: 'local-job', title: 'Research assistant', bullets: 'Developed measurement instruments.' }] },
  });
}
function setup(): RefinementSetup {
  return { template: { ...DEFAULT_LETTER_TEMPLATES[0], exampleText: 'Taylor Green writes !!private example!!. Contact taylor@example.com.' }, language: 'en', maxWords: 400 };
}
function local(options: Partial<Parameters<typeof prepareRefinement>[0]> = {}): LocalRefinementRequest {
  return prepareRefinement({ schemaVersion: 1, applicationId: APP, state: state(), variantId: 'private variant name', setup: setup(), letterText: '',
    opportunity: { title: 'PhD in robotics', requirements: 'CV, motivation letter of 400 words, transcript' },
    scope: 'both', feedback: [], parentProposalId: null, baselineSignature: refinementSignature({ cv: state(), letter: '' }), ...options });
}
function proposal(request: LocalRefinementRequest, edits: RefinementProposalV1['cvEdits'] = []): RefinementProposalV1 {
  return { schemaVersion: 1, requestId: request.request.requestId, summary: 'Emphasized relevant measurement work and drafted the letter.', cvEdits: edits,
    letterText: '# PhD application\n\nDear selection committee,\n\nMy research interests connect to your robotics project.\n\nSincerely,\n{{APPLICANT_NAME}}' };
}
function profile(request: LocalRefinementRequest) {
  const result = request.request.cv.fields.find((field) => field.label === 'Profile'); assert.ok(result); return result;
}

test('preparation freezes templates and current CV without leaking private names, markers or bindings', () => {
  const source = state(); const template = setup(); const before = structuredClone({ source, template });
  const request = local({ state: source, setup: template, letterText: 'Taylor Green is interested. !!Private rationale!!',
    opportunity: { title: 'PhD', notes: 'Email taylor@example.com. !!Private note!!' } });
  assert.deepEqual({ source, template }, before);
  source.about.text = 'Library changed'; template.template.structure = 'New library guidance'; template.template.revision++;
  assert.equal(request.request.letter.template.revision, before.template.template.revision);
  assert.equal(request.request.letter.template.structure, before.template.template.structure);
  assert.notEqual(request.cv.baselineState.about.text, source.about.text);
  const wire = JSON.stringify(request.request);
  for (const secret of ['Taylor Green', 'taylor@example.com', 'private collaboration', 'private example', 'Private rationale', 'Private note', 'private variant name', 'local-job', 'baselineState', 'bindings']) assert.equal(wire.includes(secret), false, secret);
  assert.match(request.request.letter.text, /\{\{APPLICANT_NAME\}\}/);
  assert.match(request.request.letter.template.exampleText!, /\{\{CONFIDENTIAL\}\}/);
  assert.equal(request.request.cv.requestId, request.request.requestId);
});

test('feedback iterations retain every earlier instruction and current manual corrections', () => {
  const feedback: RefinementFeedback[] = Array.from({ length: 80 }, (_, index) => ({ id: crypto.randomUUID(), scope: 'both', text: `Correction ${index}: avoid generic claims about Taylor Green.`, createdAt: CREATED }));
  const current = state(); current.experience.jobs[0].bullets = 'Built a measurement prototype, not a deployed product.';
  const request = local({ state: current, feedback, parentProposalId: crypto.randomUUID(), letterText: 'Keep this manual correction. Taylor Green.' });
  assert.equal(request.request.feedback.length, feedback.length);
  assert.deepEqual(request.request.feedback.map(({ id }) => id), feedback.map(({ id }) => id));
  assert.match(request.request.cv.fields.find(({ label }) => label === 'Experience 1: bullets')!.text, /not a deployed product/);
  assert.equal(request.request.letter.text, 'Keep this manual correction. {{APPLICANT_NAME}}.');
  assert.equal(request.request.feedback[79].text, 'Correction 79: avoid generic claims about {{APPLICANT_NAME}}.');
  assert.equal(feedback[0].text.includes('Taylor Green'), true, 'sanitization cannot rewrite local feedback');
});

test('existing application instructions remain anonymized in initial and improvement requests', () => {
  const instructions = 'Describe Taylor Green’s experience in concise language. Avoid !!private requirement!! and taylor@example.com.';
  const initial = local({ instructions });
  assert.equal(initial.request.cv.instructions, 'Describe {{APPLICANT_NAME}}’s experience in concise language. Avoid {{CONFIDENTIAL}} and {{APPLICANT_EMAIL}}.');
  assert.equal(initial.cv.publicRequest.instructions, initial.request.cv.instructions);
  const improved = local({ instructions, parentProposalId: crypto.randomUUID(), feedback: [{ id: crypto.randomUUID(), scope: 'letter', text: 'Use a warmer opening.', createdAt: CREATED }] });
  assert.equal(improved.request.cv.instructions, initial.request.cv.instructions);
  assert.match(buildRefinementPrompt(improved.request, 'test-project'), /application-specific instructions in request_json\.cv\.instructions/);
  assert.match(buildRefinementPrompt(improved.request, 'test-project'), /Later explicit corrections supersede conflicting earlier feedback or application-specific writing instructions/);
  assert.equal(local().request.cv.instructions, '', 'older callers need not provide additional instructions');
  assert.throws(() => local({ instructions: 'x'.repeat(20001) }), /too long/);
});

test('privacy sanitizer handles private links, unclosed markers and identity boundaries', () => {
  const cv = state(); cv.contact.name = 'Ann';
  assert.equal(sanitizeRefinementText('Ann writes an annual report. [!!Private label!!](https://private.example) !!unclosed', cv), '{{APPLICANT_NAME}} writes an annual report. {{CONFIDENTIAL}} {{CONFIDENTIAL}}');
  const settings = sanitizeRefinementSetup(setup(), state());
  assert.equal(JSON.stringify(settings).includes('taylor@example.com'), false);
  assert.throws(() => sanitizeRefinementText('bad\u0000text', cv), /control/);
});

test('reviewed joint proposal preserves identities, private fragments and CV structure', () => {
  const request = local(); const field = profile(request);
  const incoming = proposal(request, [{ fieldId: field.id, text: field.text.replace('researches', 'studies') }]);
  const result = applyRefinementProposal(request, incoming, state(), request.baselineSignature);
  const expected = state(); expected.about.text = expected.about.text.replace('researches', 'studies');
  assert.deepEqual(result.state, expected); assert.equal(result.letterText, incoming.letterText);
  assert.notEqual(result.state, request.cv.baselineState); assert.deepEqual(request.cv.baselineState, state());
});

test('proposal scope protects approved documents and allows advisory word-limit overruns', () => {
  const letterRound = local({ scope: 'letter' });
  const longLetter = { ...proposal(letterRound), letterText: 'word '.repeat(401).trim() };
  assert.equal(parseRefinementProposal(longLetter, letterRound.request).letterText.split(' ').length, 401);
  assert.throws(() => parseRefinementProposal({ ...longLetter, cvEdits: [{ fieldId: 'field-1', text: 'Changed' }] }, letterRound.request), /only change the letter/);
  const cvRound = local({ scope: 'cv', letterText: 'The approved letter remains exactly as written.\n' });
  assert.throws(() => parseRefinementProposal(proposal(cvRound), cvRound.request), /approved letter must remain unchanged/);
  const valid = { ...proposal(cvRound), letterText: cvRound.request.letter.text };
  assert.deepEqual(parseRefinementProposal(valid, cvRound.request), valid);
});

test('stale CV or application baseline cannot overwrite manual edits or changed settings', () => {
  const request = local(); const incoming = proposal(request);
  assert.throws(() => applyRefinementProposal(request, incoming, state(), refinementSignature('changed letter')), /application changed/);
  const changedCv = state(); changedCv.about.text = 'Manual correction';
  assert.throws(() => applyRefinementProposal(request, incoming, changedCv, request.baselineSignature), /CV changed/);
  const tampered = structuredClone(request); tampered.request.cv.fields[0].text = 'Changed public baseline';
  assert.throws(() => applyRefinementProposal(tampered, incoming, state(), request.baselineSignature), /inconsistent/);
});

test('public proposal validation rejects cross-request, structural, token and link changes before application', () => {
  const request = local(); const field = profile(request); const incoming = proposal(request);
  assert.throws(() => parseRefinementProposal({ ...incoming, requestId: crypto.randomUUID() }, request.request), /another refinement/);
  assert.throws(() => parseRefinementProposal({ ...incoming, extra: 'unrecognized' }, request.request), /Invalid/);
  for (const edit of [{ fieldId: 'field-999', text: 'Unavailable' }, { fieldId: field.id, text: field.text.replace(/\{\{PRIVATE_\d+\}\}/, '') },
    { fieldId: field.id, text: `${field.text} {{PRIVATE_99}}` }, { fieldId: field.id, text: `${field.text} https://evil.example` },
    { fieldId: field.id, text: `${field.text} <img src=x>` }]) {
    assert.throws(() => parseRefinementProposal({ ...incoming, cvEdits: [edit] }, request.request), /unavailable|placeholders|cannot add/);
  }
  for (const letterText of ['{{PRIVATE_1}}', '<script>evil</script>', '!!private!!', '']) {
    assert.throws(() => parseRefinementProposal({ ...incoming, letterText }, request.request), /Letters cannot|complete letter/);
  }
});

test('versioned prompts use exact scope and identifiers, preserve history and require verified idempotent saving', () => {
  const request = local({ scope: 'letter', feedback: [{ id: crypto.randomUUID(), scope: 'letter', text: 'Keep the opening concise.', createdAt: CREATED }] });
  const prompt = buildRefinementPrompt(request.request, 'test-project-id');
  for (const value of [APP, request.request.requestId, 'test-project-id', 'private.read_refinement_request', 'private.save_refinement_proposal', 'EVERY ordered feedback', 'SAME proposal UUID', 'persisted receipt', 'style only', 'scope is letter']) assert.ok(prompt.includes(value), value);
  assert.equal(prompt.includes('Taylor Green'), false);
  assert.throws(() => buildRefinementPrompt(request.request, "bad'); select 1"), /identifier/);
});

test('short follow-up instructions resolve only the referenced application and require a current matching scope', () => {
  const request = local({ scope: 'letter' });
  const prompt = buildRefinementPrompt(request.request, 'test-project');
  assert.ok(prompt.includes(`1. Read the immutable request through SQL: select private.read_refinement_request('${request.request.requestId}'::uuid);`), 'the initial run remains bound to its explicit immutable request');
  assert.match(prompt, /For a later explicit "phd-workflow: <code or complete UUID>/);
  assert.match(prompt, /select private\.resolve_application_reference\('<safely SQL-escaped reference>'\)/);
  assert.match(prompt, /escape apostrophes correctly, never guess codes or derive them from titles/);
  assert.match(prompt, /Read the returned current_request_id through private\.read_refinement_request/);
  assert.match(prompt, /application_id equals the resolver's application_id/);
  assert.match(prompt, /requestId equals current_request_id/);
  assert.match(prompt, /CV = cv, motivation letter = letter, both = both/);
  assert.match(prompt, /no current request or the scope differs, stop and ask the user to publish a new matching round in the webapp/);
  assert.match(prompt, /Do not fabricate or mutate requests, reuse an older round, or read unrelated applications/);
  assert.match(prompt, /freshly resolved application\/request identifiers and requested scope throughout, including the proposal payload/);
});

test('revision fingerprints match SHA-256 canonical JSON and conceal private values', () => {
  for (const value of [null, '', 'Private Taylor Green', '🌿'.repeat(100), ['a', 1], { a: 1, b: 2 }]) {
    assert.equal(refinementSignature(value), `v1:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`);
  }
  assert.equal(refinementSignature({ a: 1, b: 2, optional: undefined }), refinementSignature({ b: 2, a: 1 }));
  assert.notEqual(refinementSignature({ letter: 'Correction' }), refinementSignature({ letter: 'Old text' }));
  assert.equal(refinementSignature(state()).includes('Taylor'), false);
});

type Query = { name: string; params?: Record<string, unknown>; filters: Record<string, unknown>; orders: [string, boolean][] };
function fakeClient(handler: (query: Query) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>) {
  const queries: Query[] = [];
  function query(name: string, params?: Record<string, unknown>) {
    const entry: Query = { name, params, filters: {}, orders: [] };
    const builder = { select() { return builder; }, eq(key: string, value: unknown) { entry.filters[key] = value; return builder; },
      maybeSingle() { return builder; }, order(key: string, options: { ascending: boolean }) { entry.orders.push([key, options.ascending]); return builder; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { queries.push(entry); return Promise.resolve().then(() => handler(entry)).then(resolve, reject); } };
    return builder;
  }
  return { client: stub<SupabaseClient>({ from: query, rpc: query }), queries };
}
function requestRow(request: RefinementRequest, user = 'owner') {
  return { id: request.requestId, application_id: request.applicationId, user_id: user, request_json: request, created_at: CREATED };
}
function stateRow(settings: RefinementSetup, revision = 1) {
  return { application_id: APP, user_id: 'owner', setup_json: settings, approvals_json: { cv: null, letter: null }, current_request_id: null, revision, updated_at: CREATED };
}

test('request publication only uploads public data and retries with the same immutable request UUID', async () => {
  const request = local(); let failed = false;
  const { client, queries } = fakeClient(() => {
    if (!failed) { failed = true; return { data: null, error: new Error('Network failure') }; }
    return { data: requestRow(request.request), error: null };
  });
  const repo = createRefinementRepository(client, () => 'owner');
  await assert.rejects(repo.publishRequest(request.request), /Network/);
  assert.deepEqual(await repo.publishRequest(request.request), requestRow(request.request));
  assert.deepEqual(queries[0].params, queries[1].params);
  assert.deepEqual(Object.keys(queries[0].params!), ['p_request']);
  assert.equal(JSON.stringify(queries).includes('private collaboration'), false);
  await assert.rejects(repo.publishRequest(stub(request)), /Invalid/);
});

test('repository verifies exact publication receipt without accepting dropped feedback', async () => {
  const request = local({ feedback: [{ id: crypto.randomUUID(), scope: 'both', text: 'Keep all corrections.', createdAt: CREATED }] });
  const { client } = fakeClient(() => ({ data: requestRow({ ...request.request, feedback: [] }), error: null }));
  await assert.rejects(createRefinementRepository(client, () => 'owner').publishRequest(request.request), /could not be confirmed/);
});

test('owner-scoped histories reject foreign application/account rows and mid-flight account switches', async () => {
  const request = local(); const incoming = proposal(request);
  const row = { id: crypto.randomUUID(), application_id: APP, user_id: 'owner', request_id: request.request.requestId, proposal_json: incoming, created_at: CREATED };
  const good = fakeClient(() => ({ data: [row], error: null }));
  assert.deepEqual(await createRefinementRepository(good.client, () => 'owner').listProposals(APP), [row]);
  assert.deepEqual(good.queries[0].filters, { user_id: 'owner', application_id: APP });
  for (const badRow of [{ ...row, user_id: 'foreign' }, { ...row, application_id: crypto.randomUUID() }, { ...row, request_id: crypto.randomUUID() }]) {
    const bad = fakeClient(() => ({ data: [badRow], error: null }));
    await assert.rejects(createRefinementRepository(bad.client, () => 'owner').listProposals(APP), /verified/);
  }
  let owner = 'owner';
  const switched = fakeClient(() => { owner = 'new account'; return { data: [row], error: null }; });
  await assert.rejects(createRefinementRepository(switched.client, () => owner).listProposals(APP), /Session changed/);
});

test('settings use compare-and-swap and verify revision plus persisted approval values', async () => {
  const settings = sanitizeRefinementSetup(setup(), state());
  const good = fakeClient(() => ({ data: stateRow(settings), error: null }));
  const saved = await createRefinementRepository(good.client, () => 'owner').saveState(APP, settings, { cv: null, letter: null }, 0);
  assert.equal(saved.revision, 1); assert.equal(good.queries[0].params?.p_expected_revision, 0);
  const stale = fakeClient(() => ({ data: stateRow(settings, 3), error: null }));
  await assert.rejects(createRefinementRepository(stale.client, () => 'owner').saveState(APP, settings, { cv: null, letter: null }, 1), /could not be confirmed/);
});

test('feedback saves are append-only, retries use the same ID, and read order preserves all context', async () => {
  let fail = true;
  const { client, queries } = fakeClient(({ name, params }) => {
    if (name === 'application_refinement_reviews') return { data: [], error: null };
    if (fail) { fail = false; return { data: null, error: new Error('Uncertain network failure') }; }
    return { data: { id: params?.p_id, application_id: APP, user_id: 'owner', request_id: params?.p_request_id, kind: params?.p_kind, payload: params?.p_payload, created_at: CREATED }, error: null };
  });
  const repo = createRefinementRepository(client, () => 'owner'); const feedback = { scope: 'letter', text: 'Retain my corrected opening.' };
  await assert.rejects(repo.saveReview(APP, null, 'feedback', feedback), /network/);
  await repo.saveReview(APP, null, 'feedback', feedback);
  assert.equal(queries[0].params?.p_id, queries[1].params?.p_id);
  await repo.saveReview(APP, null, 'feedback', feedback);
  assert.notEqual(queries[1].params?.p_id, queries[2].params?.p_id);
  await repo.listReviews(APP); assert.deepEqual(queries[3].orders, [['created_at', true], ['id', true]]);
});

test('missing schema and authentication produce actionable errors while leaving local documents intact', async () => {
  const request = local(); const before = structuredClone(request);
  const missing = fakeClient(() => ({ data: null, error: { code: 'PGRST202' } }));
  await assert.rejects(createRefinementRepository(missing.client, () => 'owner').publishRequest(request.request), /pending migration.*local documents are preserved/);
  await assert.rejects(createRefinementRepository(null, () => null).listRequests(APP), /Sign in/);
  assert.deepEqual(request, before);
});

function structuredProposal(request: LocalRefinementRequest): RefinementProposalV2 {
  assert.equal(request.request.schemaVersion, 2);
  if (request.request.schemaVersion !== 2) throw new Error('Expected protocol v2.');
  const area = request.request.cvStructure.areas.find(item => item.sectionIds.length > 1);
  assert.ok(area, 'test CV needs multiple existing sections');
  return { schemaVersion: 2, requestId: request.request.requestId, summary: 'Prioritize the existing research evidence.',
    cvOperations: [{ id: 'change-1', type: 'reorder_sections', targetId: area.id, order: [...area.sectionIds].reverse(), explanation: 'Bring relevant existing sections forward.' }],
    cvComments: [], letterText: 'Dear committee,\n\nMy documented research interests match the project.\n\nKind regards,\n{{APPLICANT_NAME}}' };
}

test('new requests default to v2 with public topology and local-only reconstruction bindings', () => {
  const request = local({ schemaVersion: undefined });
  assert.equal(request.request.schemaVersion, 2);
  if (request.request.schemaVersion !== 2) throw new Error('Expected v2.');
  assert.equal(request.request.cv.schemaVersion, 1, 'existing field protocol remains version 1');
  assert.equal(request.request.cvStructure.schemaVersion, 1);
  assert.ok(request.structureBindings);
  const publicJson = JSON.stringify(request.request);
  for (const secret of ['local-job', 'local-education', 'private collaboration', 'Taylor Green', 'baselineState', 'entriesPath', 'bindings']) assert.equal(publicJson.includes(secret), false, secret);
  assert.equal(local().request.schemaVersion, 1, 'explicit legacy requests remain legacy');
  assert.throws(() => local({ schemaVersion: 3 as 2 }), /Unsupported.*version/);
});

test('structured proposals validate fully before selected operations produce an isolated preview', () => {
  const request = local({ schemaVersion: 2 }); const incoming = structuredProposal(request);
  const before = structuredClone({ request, source: state(), incoming });
  assert.deepEqual(parseRefinementProposal(incoming, request.request), incoming);
  const rejected = applyRefinementProposal(request, incoming, state(), request.baselineSignature, []);
  assert.deepEqual(rejected.state, state());
  const accepted = applyRefinementProposal(request, incoming, state(), request.baselineSignature, ['change-1']);
  assert.notDeepEqual(accepted.state.bodyOrder, state().bodyOrder);
  assert.equal(accepted.state.about.text, state().about.text);
  assert.equal(accepted.letterText, incoming.letterText);
  assert.deepEqual({ request, source: state(), incoming }, before, 'preview must never mutate its source or proposal');
  assert.throws(() => applyRefinementProposal(request, incoming, state(), request.baselineSignature, ['change-99']), /selected|unknown|available/i);
  assert.throws(() => applyRefinementProposal(request, incoming, state(), request.baselineSignature, ['change-1', 'change-1']), /duplicate|unique/i);
  assert.throws(() => applyRefinementProposal(request, incoming, state(), refinementSignature('changed')), /application changed/);
});

test('structured protocol rejects invalid targets, unsupported operations, missing explanations and scope violations', () => {
  const request = local({ schemaVersion: 2 }); const incoming = structuredProposal(request);
  for (const operation of [
    { ...incoming.cvOperations[0], type: 'rewrite_cv' },
    { ...incoming.cvOperations[0], targetId: 'section-999' },
    { ...incoming.cvOperations[0], explanation: '' },
    { ...incoming.cvOperations[0], unexpected: true },
  ]) assert.throws(() => parseRefinementProposal({ ...incoming, cvOperations: [operation] }, request.request));
  const letterOnly = local({ schemaVersion: 2, scope: 'letter' });
  assert.throws(() => parseRefinementProposal({ ...incoming, requestId: letterOnly.request.requestId }, letterOnly.request), /only change the letter/);
  const cvOnly = local({ schemaVersion: 2, scope: 'cv', letterText: 'Keep my letter verbatim.' });
  assert.throws(() => parseRefinementProposal({ ...incoming, requestId: cvOnly.request.requestId }, cvOnly.request), /letter must remain unchanged/);
  const withComment = { ...incoming, cvComments: [{ id: 'comment-1', fieldId: profile(request).id, explanation: 'This wording requires the applicant to confirm its evidence.' }] };
  assert.deepEqual(parseRefinementProposal(withComment, request.request), withComment);
  assert.throws(() => parseRefinementProposal({ ...withComment, cvComments: [{ ...withComment.cvComments[0], fieldId: 'field-999' }] }, request.request));
});

test('legacy wording proposals remain readable and selectively applicable without automatic structural promotion', async () => {
  const legacy = local(); const field = profile(legacy);
  const incoming = proposal(legacy, [{ fieldId: field.id, text: field.text.replace('researches', 'studies') }]);
  const row = { id: crypto.randomUUID(), application_id: APP, user_id: 'owner', request_id: legacy.request.requestId, proposal_json: incoming, created_at: CREATED };
  const client = fakeClient(() => ({ data: [row], error: null }));
  const [loaded] = await createRefinementRepository(client.client, () => 'owner').listProposals(APP);
  assert.equal(loaded.proposal_json.schemaVersion, 1);
  assert.deepEqual(applyRefinementProposal(legacy, loaded.proposal_json, state(), legacy.baselineSignature, []).state, state());
  assert.match(applyRefinementProposal(legacy, loaded.proposal_json, state(), legacy.baselineSignature, [field.id]).state.about.text, /studies/);
  assert.throws(() => applyRefinementProposal(legacy, incoming, state(), legacy.baselineSignature, ['field-999']), /available legacy/);
  const modern = local({ schemaVersion: 2 });
  assert.throws(() => parseRefinementProposal({ ...incoming, requestId: modern.request.requestId }, modern.request), /protocol version/);
  assert.throws(() => parseRefinementProposal({ ...structuredProposal(modern), requestId: legacy.request.requestId }, legacy.request), /protocol version/);
  assert.match(buildRefinementPrompt(legacy.request, 'test-project'), /Legacy wording-only protocol/);
});

test('v2 prompt limits operations to existing references and requires extractive shortening, explanations and verified saving', () => {
  const request = local({ schemaVersion: 2 });
  const prompt = buildRefinementPrompt(request.request, 'test-project');
  for (const phrase of ['protocol v2', 'request_json.cvStructure', 'extractive', 'without adding or paraphrasing', 'unique change-N', 'cvComments', 'omit_bullet', 'existing fieldId', 'nonempty explanation', 'complete letter consistent', 'persisted receipt', 'SAME proposal UUID']) assert.ok(prompt.includes(phrase), phrase);
  assert.ok(prompt.includes('"cvOperations":[]'));
  assert.equal(prompt.includes('"cvEdits":'), false);
});

test('CV decision logs validate their exact shape, preserve receipt data and reject overlapping or missing identifiers', async () => {
  const request = local({ schemaVersion: 2 });
  const { client, queries } = fakeClient(({ params }) => ({ data: { id: params?.p_id, application_id: APP, user_id: 'owner', request_id: params?.p_request_id, kind: params?.p_kind, payload: params?.p_payload, created_at: CREATED }, error: null }));
  const repo = createRefinementRepository(client, () => 'owner');
  const decisions = { proposalId: crypto.randomUUID(), accepted: ['change-1'], rejected: ['change-2'], revision: refinementSignature('accepted working CV') };
  const row = await repo.saveReview(APP, request.request.requestId, 'cv_decisions', decisions);
  assert.deepEqual(row.payload, decisions);
  assert.equal(queries[0].params?.p_kind, 'cv_decisions');
  for (const bad of [ { ...decisions, rejected: ['change-1'] }, { ...decisions, accepted: ['unknown'] }, { ...decisions, revision: 'plain text' }, { ...decisions, extra: true } ]) await assert.rejects(repo.saveReview(APP, request.request.requestId, 'cv_decisions', bad), /CV review decisions/);
  await assert.rejects(repo.saveReview(APP, null, 'cv_decisions', decisions), /request ID/);
});

test('v2 publication reports a required backend migration without downgrading or changing the local request', async () => {
  const request = local({ schemaVersion: 2 }); const before = structuredClone(request);
  const missing = fakeClient(() => ({ data: null, error: { code: '22023', message: 'Invalid refinement request schemaVersion.' } }));
  await assert.rejects(createRefinementRepository(missing.client, () => 'owner').publishRequest(request.request), /protocol v2.*migration.*local documents are preserved/);
  assert.deepEqual(request, before);
});

test('annotation reviews retain retry identity and explain a missing annotation database upgrade', async () => {
  const request = local();
  const payload = { proposalId: crypto.randomUUID(), annotationId: 'annotation-1', status: 'resolved', response: 'Confirmed evidence.', previousReviewId: null };
  let fail = true;
  const backend = fakeClient(({ params }) => {
    if (fail) { fail = false; return { data: null, error: { code: '22023', message: 'Invalid review kind.' } }; }
    return { data: { id: params?.p_id, application_id: APP, user_id: 'owner', request_id: params?.p_request_id, kind: params?.p_kind, payload: params?.p_payload, created_at: CREATED }, error: null };
  });
  const repository = createRefinementRepository(backend.client, () => 'owner');
  await assert.rejects(repository.saveReview(APP, request.request.requestId, 'annotation', payload), /annotations database migration.*unsaved response are preserved/);
  await repository.saveReview(APP, request.request.requestId, 'annotation', payload);
  assert.equal(backend.queries[0].params?.p_id, backend.queries[1].params?.p_id);
  await assert.rejects(repository.saveReview(APP, null, 'annotation', payload), /proposal request ID/);
});
