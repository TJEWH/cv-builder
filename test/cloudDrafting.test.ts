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
      select() { return builder; }, range() { return builder; },
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
  assert.equal(result.cv.content.about.text, '{{APPLICANT_NAME}} studies robotics. !!Secret project!!');
  assert.equal(result.template.structure, 'Present {{APPLICANT_NAME}}, then fit. [!!Private link!!](https://secret.example)');
  assert.equal(result.instructions, 'Reply to {{APPLICANT_EMAIL}}; hide !!another secret!!.');
  assert.deepEqual(result.cv.theme, { fontBody: 'Inter' });
  for (const secret of ['Secret Institute', 'Private Person', 'private@example.org', 'Never send these notes', 'Private Font', 'Alex Muster']) {
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
  assert.equal(safe.template.structure, `${input.template.structure}\n\nSubject instructions:\nName the position for {{APPLICANT_NAME}}.\n\nSalutation instructions:\nUse the contact in the tender; omit !!Secret contact!!.\n\nClosing instructions:\nSign {{APPLICANT_NAME}}. Contact {{APPLICANT_EMAIL}}.`);
  assert.deepEqual(sanitizeDraftingInput(safe), safe);
  assert.deepEqual(Object.keys(safe.template).sort(), ['id', 'name', 'revision', 'structure', 'tone']);
  const { client, queries } = fakeClient(({ params }) => ({ data: context(String(params?.p_context_id)), error: null }));
  await createDraftingRepository(client, () => 'owner-a').publishContext('app-a', safe);
  assert.deepEqual(queries[0].params?.p_template, safe.template);
  assert.throws(() => sanitizeDraftingInput({ ...input, template: { ...input.template, subjectInstructions: 'a'.repeat(1001) } }), /Subject instructions/);
});

test('template examples share only anonymized style guidance through the legacy structure field', () => {
  const state = createTestState({ contact: { ...createTestState().contact, name: 'Private Person', email: 'private@example.org' } });
  const exampleText = 'Private Person wrote to private@example.org about !!Secret work!!. [!!Private letter!!](https://secret.example).';
  const safe = sanitizeDraftingInput({ ...input, template: { ...input.template, exampleText } }, state);
  assert.ok(safe.template.structure.includes('wording, style and structure only; never use its claims as applicant evidence'));
  assert.ok(safe.template.structure.includes('{{APPLICANT_NAME}} wrote to {{APPLICANT_EMAIL}} about !!Secret work!!. [!!Private letter!!](https://secret.example).'));
  for (const secret of ['Private Person', 'private@example.org']) assert.ok(!JSON.stringify(safe).includes(secret));
  assert.deepEqual(Object.keys(safe.template).sort(), ['id', 'name', 'revision', 'structure', 'tone']);
  assert.deepEqual(sanitizeDraftingInput(safe), safe, 'repeated sanitization must not append the example twice');
  assert.equal(exampleText.includes('Private Person'), true, 'local source wording stays unchanged');
  assert.throws(() => sanitizeDraftingInput({ ...input, template: { ...input.template, exampleText: 'a'.repeat(20001) } }), /Example letter/);
  assert.throws(() => sanitizeDraftingInput({ ...input, template: { ...input.template, exampleText: 'a'.repeat(20000) } }), /Template structure/);
});

test('research and question guidance uses the existing five-key cloud template projection once without leaking originals', async () => {
  const state = createTestState({ contact: { ...createTestState().contact, name: 'Private Person', email: 'private@example.org' } });
  const local = { ...input, template: { ...input.template,
    researchInterests: 'Private Person is interested in sensor fusion and !!Private research direction!!.',
    questionGuidance: 'Ask private@example.org about evidence for field testing and [!!Private project!!](https://secret.example).',
  } };
  const before = structuredClone(local);
  const safe = sanitizeDraftingInput(local, state);
  assert.deepEqual(Object.keys(safe.template).sort(), ['id', 'name', 'revision', 'structure', 'tone']);
  assert.match(safe.template.structure, /Applicant research interests \(intent, not evidence of experience; select relevant interests/);
  assert.match(safe.template.structure, /Follow-up question guidance \(ask only when useful; keep questions separate from letter text/);
  assert.match(safe.template.structure, /never assume missing CV evidence means no experience/);
  assert.match(safe.template.structure, /\{\{APPLICANT_NAME\}\} is interested in sensor fusion and !!Private research direction!!/);
  assert.match(safe.template.structure, /Ask \{\{APPLICANT_EMAIL\}\} about evidence for field testing and \[!!Private project!!\]/);
  for (const privateValue of ['Private Person', 'private@example.org']) {
    assert.equal(JSON.stringify(safe).includes(privateValue), false, privateValue);
  }
  assert.deepEqual(sanitizeDraftingInput(safe), safe);
  assert.deepEqual(local, before, 'local user-authored interests and guidance remain intact');
  const { client, queries } = fakeClient(({ params }) => ({ data: context(String(params?.p_context_id)), error: null }));
  await createDraftingRepository(client, () => 'owner-a').publishContext('app-a', safe);
  assert.deepEqual(queries[0].params?.p_template, safe.template, 'repository sanitization must not append guidance again');
});

test('optional drafting guidance accepts empty text and bounded values but rejects malformed fields', () => {
  for (const key of ['researchInterests', 'questionGuidance'] as const) {
    assert.deepEqual(sanitizeDraftingInput({ ...input, template: { ...input.template, [key]: '' } }), input);
    assert.deepEqual(sanitizeDraftingInput({ ...input, template: { ...input.template, [key]: ' \n ' } }), input);
    assert.ok(sanitizeDraftingInput({ ...input, template: { ...input.template, [key]: 'x'.repeat(4000) } }).template.structure.includes('x'.repeat(4000)));
    for (const value of [null, 42, {}, 'x'.repeat(4001)]) {
      const malformed = { ...input, template: { ...input.template, [key]: value } } as PublishDraftingInput;
      assert.throws(() => sanitizeDraftingInput(malformed), new RegExp(key));
    }
  }
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


test('drafting CV text applies manual privacy replacements after contact and field-type masking', () => {
  const state = createTestState({ contact: { ...createTestState().contact, name: 'Private Person' }, about: { text: 'Worked with John Doe.' },
    experience: { jobs: [{ id: 'Private Person-job', company: 'Private Company' }] },
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company'], fieldOverrides: {
      '["contact","name"]': 'Approved Private Person',
      '["about","text"]': 'Worked with a qualified person.',
      '["item","Private Person-job","company"]': 'Approved Private Company',
    } },
  });
  const result = prepareDraftingContext({ ...input, application, cvState: state });
  assert.equal(result.cv.content.contact.name, 'Approved Private Person');
  assert.equal(result.cv.content.about.text, 'Worked with a qualified person.');
  assert.equal(result.cv.content.experience.jobs[0].company, 'Approved Private Company');
  assert.ok(!JSON.stringify(result).includes('John Doe'));
  assert.equal(state.about.text, 'Worked with John Doe.');
});
