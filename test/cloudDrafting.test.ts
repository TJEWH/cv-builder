import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../src/cloudTypes';
import type { PublishDraftingInput } from '../src/draftingTypes';
import { createDraftingRepository, DRAFTING_IDENTITY_PLACEHOLDERS, prepareDraftingContext, sanitizeDraftingInput } from '../src/composables/cloudDrafting';
import { createTestState, stub } from './helpers';

const input: PublishDraftingInput = {
  template: { id: 'research', name: 'Research letter', revision: 1, structure: 'Opening, evidence, fit, closing', tone: 'Professional' },
  language: 'en', instructions: '', maxWords: 500,
};
const application = stub<Application>({ id: 'app-a', user_id: 'owner-a', cv_variant_id: 'cv-a',
  context_json: { title: 'Robotics role', contacts: [{ email: 'supervisor@example.org' }], requirements: ['Degree'] },
  context_captured_at: '2026-09-20T10:00:00Z', notes: 'Never send these notes', contact_email: 'private-contact@example.org',
});
type Request = { name: string; params?: Record<string, unknown>; filters: Record<string, unknown>; order?: string };
function fakeClient(handler: (query: Request) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>) {
  const queries: Request[] = [];
  function query(name: string, params?: Record<string, unknown>) {
    const request: Request = { name, params, filters: {} };
    const builder = {
      select() { return builder; },
      eq(key: string, value: unknown) { request.filters[key] = value; return builder; },
      order(key: string) { request.order = key; return builder; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        queries.push(request);
        return Promise.resolve().then(() => handler(request)).then(resolve, reject);
      },
    };
    return builder;
  }
  return { queries, client: stub<SupabaseClient>({ from: query, rpc: query }) };
}
function context(id = 'context-a', userId = 'owner-a', appId = 'app-a') {
  return { id, user_id: userId, application_id: appId, cv_variant_id: 'cv-a', created_at: '2026-09-20T10:00:00Z',
    context_json: prepareDraftingContext({ ...input, application, cvState: createTestState() }) };
}

test('offline drafting context excludes private state and sample identity while preserving opportunity research', () => {
  const state = createTestState({ contact: { name: 'Private Person', location: 'Private Town', role: 'Researcher', email: 'private@example.org', phone: '12345', website: 'https://private.example.org', linkedin: '', github: '' },
    about: { text: 'Private Person studies robotics. !!Secret project!!' },
    education: [{ id: 'hidden-school', institution: 'Secret Institute', hidden: true }, { id: 'public-school', institution: 'Public Institute' }],
    design: { fontBody: 'Inter', customFonts: [{ name: 'Private Font', source: 'google' }] },
  });
  const before = structuredClone(state);
  const result = prepareDraftingContext({ ...input, application, cvState: state,
    template: { ...input.template, structure: 'Present Private Person, then fit. [!!Private link!!](https://secret.example)' },
    instructions: 'Reply to private@example.org; hide !!another secret!!.',
  });
  assert.deepEqual(result.opportunity, application.context_json);
  assert.deepEqual(result.cv.content.contact, DRAFTING_IDENTITY_PLACEHOLDERS);
  assert.equal(result.cv.content.about.text, '{{APPLICANT_NAME}} studies robotics. {{CONFIDENTIAL}}');
  assert.equal(result.template.structure, 'Present {{APPLICANT_NAME}}, then fit. {{CONFIDENTIAL}}');
  assert.equal(result.instructions, 'Reply to {{APPLICANT_EMAIL}}; hide {{CONFIDENTIAL}}.');
  assert.deepEqual(result.cv.theme, { fontBody: 'Inter' });
  for (const secret of ['Secret Institute', 'Secret project', 'Private Person', 'private@example.org', 'Never send these notes', 'Private Font', 'secret.example', 'Alex Muster']) {
    assert.equal(JSON.stringify(result).includes(secret), false, secret);
  }
  assert.deepEqual(state, before);
  result.opportunity.title = 'Different';
  assert.equal(application.context_json.title, 'Robotics role');
});

test('input sanitization allows only explicit template fields and validates useful bounds', () => {
  const result = sanitizeDraftingInput({ ...input, privateExtra: 'Do not share', template: { ...input.template, privateExtra: 'Do not share' } } as PublishDraftingInput);
  assert.deepEqual(result, input);
  for (const maxWords of [0, 49, 5001, NaN, 100.5]) assert.throws(() => sanitizeDraftingInput({ ...input, maxWords }), /Word limit/);
  assert.throws(() => sanitizeDraftingInput({ ...input, template: { ...input.template, revision: 0 } }), /saved letter template/);
  assert.throws(() => sanitizeDraftingInput({ ...input, instructions: 'a'.repeat(20001) }), /Instructions/);
});

test('all template guidance reaches the existing cloud structure after privacy redaction exactly once', async () => {
  const state = createTestState({ contact: { ...createTestState().contact, name: 'Private Person', email: 'private@example.org' } });
  const safe = sanitizeDraftingInput({ ...input, template: { ...input.template,
    subjectInstructions: 'Name the position for Private Person.',
    salutationInstructions: 'Use the contact in the tender; omit !!Secret contact!!.',
    closingInstructions: 'Sign Private Person. Contact private@example.org.',
  } }, state);
  assert.equal(safe.template.structure, `${input.template.structure}\n\nSubject instructions:\nName the position for {{APPLICANT_NAME}}.\n\nSalutation instructions:\nUse the contact in the tender; omit {{CONFIDENTIAL}}.\n\nClosing instructions:\nSign {{APPLICANT_NAME}}. Contact {{APPLICANT_EMAIL}}.`);
  assert.deepEqual(sanitizeDraftingInput(safe), safe);
  assert.deepEqual(Object.keys(safe.template).sort(), ['id', 'name', 'revision', 'structure', 'tone']);
  const { client, queries } = fakeClient(({ params }) => ({ data: context(String(params?.p_context_id)), error: null }));
  await createDraftingRepository(client, () => 'owner-a').publishContext('app-a', safe);
  assert.deepEqual(queries[0].params?.p_template, safe.template);
  assert.throws(() => sanitizeDraftingInput({ ...input, template: { ...input.template, subjectInstructions: 'a'.repeat(1001) } }), /Subject instructions/);
});

test('roles and cities remain factual CV evidence while contact identity fields become placeholders', () => {
  const state = createTestState({ experience: { jobs: [{ id: 'job', title: 'Software Engineer', place: 'Neustadt', company: 'Public employer' }] } });
  const result = prepareDraftingContext({ ...input, application, cvState: state,
    instructions: 'Describe my experience as a Software Engineer in Neustadt.',
  });
  assert.equal(result.cv.content.experience.jobs[0].title, 'Software Engineer');
  assert.equal(result.cv.content.experience.jobs[0].place, 'Neustadt');
  assert.equal(result.instructions, 'Describe my experience as a Software Engineer in Neustadt.');
  assert.equal(result.cv.content.contact.role, '{{APPLICANT_ROLE}}');
  assert.equal(result.cv.content.contact.location, '{{APPLICANT_LOCATION}}');
});

test('publishing context sends template settings only and reuses an ID after an uncertain failure', async () => {
  let first = true;
  const { client, queries } = fakeClient(({ params }) => {
    if (first) { first = false; return { data: null, error: new Error('Network response lost') }; }
    return { data: context(String(params?.p_context_id)), error: null };
  });
  const repository = createDraftingRepository(client, () => 'owner-a');
  await assert.rejects(repository.publishContext('app-a', input), /Network/);
  const published = await repository.publishContext('app-a', input);
  assert.equal(queries[0].params?.p_context_id, queries[1].params?.p_context_id);
  assert.equal(published.id, queries[0].params?.p_context_id);
  assert.deepEqual(Object.keys(queries[0].params!).sort(), ['p_application_id', 'p_context_id', 'p_instructions', 'p_language', 'p_max_words', 'p_template']);
  await repository.publishContext('app-a', input);
  assert.notEqual(queries[1].params?.p_context_id, queries[2].params?.p_context_id);
});

test('draft history is account and application scoped and rejects foreign records', async () => {
  const { client, queries } = fakeClient(({ name }) => ({ data: name === 'drafting_contexts' ? [context()] : [{
    id: 'draft-a', user_id: 'owner-a', application_id: 'app-a', context_id: 'context-a', body: 'Draft', created_at: '2026-09-20T10:00:00Z',
  }], error: null }));
  const repository = createDraftingRepository(client, () => 'owner-a');
  await repository.listContexts('app-a'); await repository.listDrafts('app-a');
  assert.ok(queries.every(({ filters }) => filters.user_id === 'owner-a' && filters.application_id === 'app-a'));
  const foreign = fakeClient(() => ({ data: [context('context-b', 'owner-b')], error: null }));
  await assert.rejects(createDraftingRepository(foreign.client, () => 'owner-a').listContexts('app-a'), /verified/);
});

test('returned drafts append safely and do not send local finalization metadata', async () => {
  const { client, queries } = fakeClient(({ params }) => ({ data: {
    id: params?.p_draft_id, user_id: 'owner-a', application_id: 'app-a', context_id: params?.p_context_id,
    body: params?.p_body, created_at: '2026-09-20T10:00:00Z',
  }, error: null }));
  const repository = createDraftingRepository(client, () => 'owner-a');
  const first = await repository.saveDraft('app-a', 'context-a', 'Signed Alex Muster.');
  const second = await repository.saveDraft('app-a', 'context-a', 'Revised.');
  assert.notEqual(first.id, second.id);
  assert.equal(first.body, 'Signed {{APPLICANT_NAME}}.');
  assert.ok(queries.every(({ name }) => name === 'save_application_letter_draft'));
  await assert.rejects(repository.saveDraft('app-a', 'context-a', ''), /Draft/);
});

test('session changes reject stale responses and missing schema has an actionable error', async () => {
  let userId = 'owner-a';
  const { client } = fakeClient(() => { userId = 'owner-b'; return { data: [context()], error: null }; });
  await assert.rejects(createDraftingRepository(client, () => userId).listContexts('app-a'), /Session changed/);
  const unavailable = fakeClient(() => ({ data: null, error: { code: 'PGRST202' } }));
  await assert.rejects(createDraftingRepository(unavailable.client, () => 'owner-a').publishContext('app-a', input), /database update/);
  await assert.rejects(createDraftingRepository(null, () => null).listDrafts('app-a'), /Sign in/);
});
