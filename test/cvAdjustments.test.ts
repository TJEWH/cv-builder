import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCvAdjustmentPrompt, createCvAdjustmentRepository, parseCvAdjustmentResponse, prepareCvAdjustment, reconstructCvAdjustment } from '../src/composables/cvAdjustments';
import type { LocalCvAdjustmentRequest } from '../src/cvAdjustmentTypes';
import { createTestState, stub } from './helpers';

function fixture() {
  return createTestState({ contact: { name: 'Taylor [Q]', role: 'Researcher', location: 'Neustadt', email: 'taylor@example.org', phone: '+44 12345', website: 'https://taylor.example.org', linkedin: '', github: '' },
    about: { text: 'Taylor [Q] researches !!secret robotics!!. Contact taylor@example.org.' },
    education: [{ id: 'private-degree-id', title: 'Physics', institution: 'Public university', start: '2019', end: '2023', state: 'complete' }],
    experience: { jobs: [{ id: 'private-job-id', title: 'Research assistant', bullets: 'Built prototypes.' }, { id: 'hidden-id', title: 'Hidden employer', hidden: true }, { id: 'excluded-id', title: 'Excluded employer' }] },
    anonymization: { excludedSections: ['private-section'], excludedItems: ['excluded-id'] },
    customSections: [{ id: 'private-section', name: 'Secret section', text: 'Excluded body', entryMode: 'textarea', entries: [] }, { id: 'public-section', name: 'Research', entryMode: 'textarea', text: 'Public prose !!private fragment!!', entries: [{ id: 'inactive-entry', desc: 'Inactive form content' }] }],
    sidebarSections: [{ id: 'private-sidebar-id', name: 'Skills', levelType: 'years', items: [{ id: 'skill-id', name: 'Python', levelValue: 5 }] }],
    design: { ink: '#203040', customFonts: [{ name: 'Private font', source: 'google' }] },
  });
}
function response(request: LocalCvAdjustmentRequest, edits: { fieldId: string; text: string }[] = []) {
  return { schemaVersion: 1, requestId: request.publicRequest.requestId, edits };
}
function field(request: LocalCvAdjustmentRequest, label: string) {
  const result = request.publicRequest.fields.find((entry) => entry.label === label);
  assert.ok(result, label); return result;
}

test('adjustment projection omits identity, local metadata, hidden/excluded and inactive content', () => {
  const state = fixture(); const before = structuredClone(state);
  const request = prepareCvAdjustment({ state, variantId: 'Private local variant', instructions: 'Tailor Taylor [Q] for !!secret target!!.', opportunity: { title: 'Robotics', requirement: 'Contact taylor@example.org. !!hidden note!!' } });
  const wire = JSON.stringify(request.publicRequest);
  for (const secret of ['Taylor [Q]', 'taylor@example.org', 'secret robotics', 'secret target', 'hidden note', 'private-', 'Hidden employer', 'Excluded employer', 'Secret section', 'Excluded body', 'Inactive form content', 'Private font', 'Private local variant', 'private fragment']) assert.equal(wire.includes(secret), false, secret);
  assert.ok(wire.includes('Public university')); assert.ok(wire.includes('Research assistant'));
  assert.equal(field(request, 'Professional headline').text, 'Researcher');
  assert.equal(request.publicRequest.instructions, 'Tailor {{APPLICANT_NAME}} for {{CONFIDENTIAL}}.');
  assert.deepEqual(state, before);
});

test('accepted wording reconstructs private fragments exactly and preserves CV IDs, structures and layout', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  const profile = field(request, 'Profile'); const title = field(request, 'Experience 1: title');
  const result = reconstructCvAdjustment(request, response(request, [
    { fieldId: profile.id, text: profile.text.replace('researches', 'specializes in') },
    { fieldId: title.id, text: 'Robotics research assistant' },
  ]), state);
  const expected = structuredClone(state); expected.about.text = expected.about.text.replace('researches', 'specializes in'); expected.experience.jobs[0].title = 'Robotics research assistant';
  assert.deepEqual(result.state, expected); assert.equal(result.changed, true); assert.equal(result.changedFieldCount, 2);
  assert.deepEqual(state, fixture()); assert.equal(result.state.education[0].id, 'private-degree-id');
});

test('private Markdown links, existing token literals and repeated identities restore without token collisions', () => {
  const state = fixture();
  state.about.text = '[!!Private label!!](https://secret.example) {{PRIVATE_1}} {{OTHER}} TAYLOR [Q] Taylor [Q] and [Portfolio](https://taylor.example.org)';
  const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  assert.equal(profile.text.includes('secret.example'), false); assert.equal(profile.text.includes('taylor.example'), false);
  const result = reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: `Evidence: ${profile.text}` }]), state);
  assert.equal(result.state.about.text, `Evidence: ${state.about.text}`);
});

test('disabled sections and excluded header are neither uploaded nor adjustable', () => {
  const state = fixture(); state.disabled = ['header', 'about', 'education', 'private-sidebar-id'];
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.ok(request.publicRequest.fields.every(({ label }) => !/headline|Profile|Education|Sidebar/.test(label)));
  assert.equal(JSON.stringify(request.publicRequest).includes('Public university'), false);
});

test('empty and equivalent responses are no-ops and return an isolated unchanged CV', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  for (const edits of [[], request.publicRequest.fields.map(({ id, text }) => ({ fieldId: id, text }))]) {
    const result = reconstructCvAdjustment(request, JSON.stringify(response(request, edits)), state);
    assert.equal(result.changed, false); assert.equal(result.changedFieldCount, 0); assert.deepEqual(result.state, state); assert.notEqual(result.state, state);
  }
});

test('optional undefined fields and reordered object keys do not create false stale-baseline conflicts', () => {
  const state = fixture(); state.education[0].thesis = undefined;
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  const reordered = Object.fromEntries(Object.entries(state).reverse()) as typeof state;
  assert.equal(reconstructCvAdjustment(request, response(request), reordered).changed, false);
});

test('stale content or layout and responses for other requests are rejected', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.throws(() => reconstructCvAdjustment(request, response(request), { ...state, about: { text: 'Changed' } }), /CV changed/);
  assert.throws(() => reconstructCvAdjustment(request, response(request), { ...state, design: { ink: '#000' } }), /CV changed/);
  assert.throws(() => reconstructCvAdjustment(request, { ...response(request), requestId: crypto.randomUUID() }, state), /another CV/);
});

test('private tokens cannot be removed, duplicated, reordered, invented or moved across fields', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  const tokens = profile.text.match(/\{\{PRIVATE_\d+\}\}/g)!;
  const unsafe = [profile.text.replace(tokens[0], ''), `${profile.text} ${tokens[0]}`, profile.text.replace(tokens[0], '{{PRIVATE_999}}'),
    profile.text.replace(tokens[0], 'SWAP').replace(tokens[1], tokens[0]).replace('SWAP', tokens[1]), `${profile.text} {{APPLICANT_NAME}}`, `${profile.text} !!new secret!!`];
  for (const text of unsafe) assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text }]), state), /Private placeholders/);
  const headline = field(request, 'Professional headline');
  assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: headline.id, text: `Engineer ${tokens[0]}` }]), state), /Private placeholders/);
});

test('responses cannot target local paths, add fields, duplicate fields, or carry prototype payloads', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  for (const edits of [[{ fieldId: 'contact.name', text: 'Injected' }], [{ fieldId: 'field-99999', text: 'Injected' }], [{ fieldId: profile.id, text: profile.text }, { fieldId: profile.id, text: profile.text }]]) {
    assert.throws(() => reconstructCvAdjustment(request, response(request, edits), state), /Invalid|unavailable/);
  }
  assert.throws(() => parseCvAdjustmentResponse({ ...response(request), extra: 'secret' }), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse(JSON.stringify(response(request)).replace('"edits":[]', '"edits":[],"__proto__":{"polluted":true}')), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse({ ...response(request), edits: [{ fieldId: profile.id, text: profile.text, path: ['contact', 'name'] }] }), /Invalid/);
  assert.equal(Object.hasOwn({}, 'polluted'), false);
});

test('malicious new URLs, images and HTML or private tokens in link destinations are rejected', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  for (const text of [`${profile.text} https://evil.example`, `${profile.text} ![image](image.png)`, `${profile.text} <img src=x>`, profile.text.replace(/(\{\{PRIVATE_\d+\}\})/, '[send]($1)')]) {
    assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text }]), state), /cannot add links/);
  }
});

test('persisted local bindings cannot redirect edits into identity or alter secret reconstruction', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  request.bindings.forEach((binding) => { binding.path = ['contact', 'name']; for (const key of Object.keys(binding.tokens)) binding.tokens[key] = 'tampered'; });
  const result = reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: `Public ${profile.text}` }]), state);
  assert.equal(result.state.contact.name, state.contact.name); assert.equal(result.state.about.text, `Public ${state.about.text}`);
  request.publicRequest.fields[0].text = 'tampered';
  assert.throws(() => reconstructCvAdjustment(request, response(request), state), /inconsistent/);
});

test('JSON bounds, controls, unmatched privacy markers and short identity boundaries are safe', () => {
  const state = createTestState({ contact: { ...fixture().contact, name: 'Ann' }, about: { text: 'Ann writes an annual report. !!unclosed secret' } });
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.ok(field(request, 'Profile').text.includes('annual report')); assert.equal(JSON.stringify(request.publicRequest).includes('unclosed secret'), false);
  assert.throws(() => prepareCvAdjustment({ state, variantId: 'base', instructions: 'x'.repeat(20001) }), /too long/);
  assert.throws(() => parseCvAdjustmentResponse(response(request, [{ fieldId: 'field-1', text: 'a\u0000b' }])), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse('x'.repeat(1048577)), /too large/);
  assert.throws(() => parseCvAdjustmentResponse('```json\n{}\n```'), /Markdown/);
  const prompt = buildCvAdjustmentPrompt(request.publicRequest); assert.ok(prompt.includes(request.publicRequest.requestId)); assert.equal(prompt.includes('unclosed secret'), false);
});

type Query = { name: string; params?: Record<string, unknown>; filters: Record<string, unknown> };
function fakeClient(handler: (query: Query) => { data: unknown; error: unknown }) {
  const queries: Query[] = [];
  function query(name: string, params?: Record<string, unknown>) {
    const entry: Query = { name, params, filters: {} };
    const builder = { select() { return builder; }, eq(key: string, value: unknown) { entry.filters[key] = value; return builder; }, order() { return builder; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { queries.push(entry); return Promise.resolve().then(() => handler(entry)).then(resolve, reject); } };
    return builder;
  }
  return { client: stub<SupabaseClient>({ from: query, rpc: query }), queries };
}
function requestRow(request: LocalCvAdjustmentRequest, owner = 'owner', app: string | null = 'app') {
  return { id: request.publicRequest.requestId, user_id: owner, application_id: app, request_json: request.publicRequest, created_at: '2026-09-21T00:00:00Z' };
}
test('repository upload accepts only public request and preserves retry identity', async () => {
  const request = prepareCvAdjustment({ state: fixture(), variantId: 'private-variant' }); let failed = false;
  const { client, queries } = fakeClient(() => {
    if (!failed) { failed = true; return { data: null, error: new Error('Network') }; }
    return { data: requestRow(request), error: null };
  });
  const repo = createCvAdjustmentRepository(client, () => 'owner');
  await assert.rejects(repo.publishRequest(request.publicRequest, 'app'), /Network/); await repo.publishRequest(request.publicRequest, 'app');
  assert.deepEqual(queries[0].params, queries[1].params);
  assert.deepEqual(Object.keys(queries[0].params!).sort(), ['p_application_id', 'p_request', 'p_request_id']);
  for (const secret of ['baselineState', 'sourceVariantId', 'bindings', 'private-variant', 'secret robotics']) assert.equal(JSON.stringify(queries).includes(secret), false);
  await assert.rejects(repo.publishRequest(stub(request), 'app'), /Invalid/);
});

test('repository response history rejects foreign ownership, wrong request and account switches', async () => {
  const request = prepareCvAdjustment({ state: fixture(), variantId: 'base' }); const id = request.publicRequest.requestId;
  const row = { id: crypto.randomUUID(), user_id: 'owner', request_id: id, response_json: response(request), created_at: '2026-09-21T00:00:00Z' };
  const { client, queries } = fakeClient(() => ({ data: [row], error: null }));
  assert.deepEqual(await createCvAdjustmentRepository(client, () => 'owner').listResponses(id), [row]);
  assert.deepEqual(queries[0].filters, { user_id: 'owner', request_id: id });
  for (const foreign of [{ ...row, user_id: 'someone' }, { ...row, request_id: crypto.randomUUID() }]) {
    const bad = fakeClient(() => ({ data: [foreign], error: null }));
    await assert.rejects(createCvAdjustmentRepository(bad.client, () => 'owner').listResponses(id), /verified/);
  }
  let owner = 'owner'; const switched = fakeClient(() => { owner = 'someone'; return { data: [row], error: null }; });
  await assert.rejects(createCvAdjustmentRepository(switched.client, () => owner).listResponses(id), /Session changed/);
});

test('response writes are append-only and retry an uncertain operation with its existing UUID', async () => {
  const request = prepareCvAdjustment({ state: fixture(), variantId: 'base' }); let fail = true;
  const { client, queries } = fakeClient(({ params }) => {
    if (fail) { fail = false; return { data: null, error: new Error('Network') }; }
    return { data: { id: params?.p_response_id, user_id: 'owner', request_id: params?.p_request_id, response_json: params?.p_response, created_at: '2026-09-21T00:00:00Z' }, error: null };
  });
  const repo = createCvAdjustmentRepository(client, () => 'owner'); const id = request.publicRequest.requestId;
  await assert.rejects(repo.saveResponse(id, response(request)), /Network/); await repo.saveResponse(id, response(request));
  assert.equal(queries[0].params?.p_response_id, queries[1].params?.p_response_id);
  await repo.saveResponse(id, response(request)); assert.notEqual(queries[1].params?.p_response_id, queries[2].params?.p_response_id);
  const missing = fakeClient(() => ({ data: null, error: { code: 'PGRST202' } }));
  await assert.rejects(createCvAdjustmentRepository(missing.client, () => 'owner').listResponses(id), /database update/);
  await assert.rejects(createCvAdjustmentRepository(null, () => null).listResponses(id), /Sign in/);
});
