import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRefinementPrompt, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementText } from '../src/composables/applicationRefinement';
import { privacyContextTargets, privacySegments, redactMarkedOriginals, validatePrivacyLegend } from '../src/composables/refinementPrivacy';
import { validatePrivateTokenLines } from '../src/composables/cvAdjustments';
import { DEFAULT_LETTER_TEMPLATES } from '../src/composables/motivationLetters';
import type { ApprovedPrivacyContexts, RefinementProposalV2 } from '../src/refinementTypes';
import { createTestState } from './helpers';

const APP = 'a0000000-0000-4000-8000-000000000001';
const state = () => createTestState({
  contact: { name: 'Taylor Secret', email: 'private@example.invalid', role: 'Engineer', location: 'Berlin', phone: '', website: '', linkedin: '', github: '' },
  about: { text: 'Public employer in Berlin. [Public report](https://public.example.invalid).' },
  experience: { jobs: [{ id: 'local-job', title: 'Engineer', bullets: '- Built precise sensors at !!Secret Works!!.\n- Evaluated existing results with !!Secret Lab!!.' }, { id: 'hidden-job', title: 'Unshared job', hidden: true }] },
});
function prepare(overrides: Partial<Parameters<typeof prepareRefinement>[0]> = {}) {
  return prepareRefinement({ applicationId: APP, state: state(), variantId: 'local-variant', setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 },
    letterText: 'Existing letter.', opportunity: {}, scope: 'both', feedback: [], parentProposalId: null, baselineSignature: refinementSignature('baseline'), ...overrides });
}
const proposal = (local: ReturnType<typeof prepare>, changes: RefinementProposalV2['cvOperations'] = []): RefinementProposalV2 => ({ schemaVersion: 2, requestId: local.request.requestId, summary: 'Concise evidence.', cvOperations: changes, cvComments: [], letterText: 'Proposed letter.' });

test('descriptions require explicit local approval and publish only the exact public legend', () => {
  const local = prepare();
  assert.equal(local.request.privacyLegend, undefined);
  const targets = privacyContextTargets(local.cv, refinementSignature);
  assert.equal(targets.length, 2);
  const approved: ApprovedPrivacyContexts = { [targets[0].sourceKey]: { type: 'organization', description: 'Engineering company specializing in sensor technology' } };
  const prepared = prepare({ privacyContexts: approved });
  assert.deepEqual(prepared.request.privacyLegend, [{ fieldId: targets[0].fieldId, token: targets[0].token, type: 'organization', description: approved[targets[0].sourceKey].description }]);
  const wire = JSON.stringify(prepared.request);
  for (const secret of ['Secret Works', 'Secret Lab', 'Taylor Secret', 'private@example.invalid', 'Unshared job', 'local-job', 'local-variant', targets[0].sourceKey, 'bindings', 'baselineState']) assert.equal(wire.includes(secret), false, secret);
  assert.deepEqual(reconstructRefinementProposal(prepared, proposal(prepared), [], APP).state, reconstructRefinementProposal(local, proposal(local), [], APP).state);
  assert.match(buildRefinementPrompt(prepared.request, 'test-project'), /context only, never substitutes for tokens/);
});

test('approvals follow the exact private source rather than reused public token numbers', () => {
  const source = state(), local = prepare({ state: source });
  const target = privacyContextTargets(local.cv, refinementSignature)[0];
  const privacyContexts: ApprovedPrivacyContexts = { [target.sourceKey]: { type: 'organization', description: 'Sensor company' } };
  source.about.text = 'Research with !!New first secret!!.';
  const renumbered = prepare({ state: source, privacyContexts });
  assert.equal(renumbered.request.privacyLegend?.[0].token, '{{PRIVATE_2}}');
  assert.equal(renumbered.request.privacyLegend?.length, 1);
  source.experience.jobs[0].bullets = source.experience.jobs[0].bullets!.replace('Secret Works', 'Different Works');
  assert.equal(prepare({ state: source, privacyContexts }).request.privacyLegend, undefined);
  assert.equal(prepare({ privacyContexts, variantId: 'other-variant' }).request.privacyLegend, undefined);
});

test('marked originals are filtered from feedback, instructions, template examples and descriptions', () => {
  const local = prepare(), target = privacyContextTargets(local.cv, refinementSignature)[0];
  const text = 'Taylor Secret worked at Secret Works. private@example.invalid !!Extra secret!!';
  const request = prepare({ instructions: text, letterText: text, opportunity: { notes: text },
    setup: { template: { ...DEFAULT_LETTER_TEMPLATES[0], exampleText: text, tone: text }, language: 'en', maxWords: 400 },
    feedback: [{ id: crypto.randomUUID(), text, scope: 'both', createdAt: '2026-10-02T00:00:00Z' }] }).request;
  assert.equal(JSON.stringify(request).includes('Secret Works'), false);
  assert.equal(JSON.stringify(request).includes('Extra secret'), false);
  assert.match(request.cv.instructions, /CONFIDENTIAL/);
  assert.equal(sanitizeRefinementText('Secret Works', state()), '{{CONFIDENTIAL}}');
  for (const description of ['Work at Secret Works', 'private@example.invalid', 'Taylor Secret', '!!private!!']) {
    assert.throws(() => prepare({ privacyContexts: { [target.sourceKey]: { type: 'organization', description } } }), /protected text|Invalid approved/);
  }
  const minimal = state(); minimal.about.text = '!!A!! and !!a longer secret!!';
  assert.equal(redactMarkedOriginals('a longer secret {{PRIVATE_1}} {{CONFIDENTIAL}} A', minimal), '{{CONFIDENTIAL}} {{PRIVATE_1}} {{CONFIDENTIAL}} {{CONFIDENTIAL}}');
  minimal.about.text = 'Evidence from !!  Secret Works  !!.';
  assert.equal(sanitizeRefinementText('Secret Works', minimal), '{{CONFIDENTIAL}}');
});

test('legend validation rejects invented references, hidden mappings, invalid types and unsafe descriptions', () => {
  const local = prepare(), field = local.request.cv.fields.find(field => field.text.includes('{{PRIVATE_1}}'))!;
  const entry = { fieldId: field.id, token: '{{PRIVATE_1}}', type: 'organization', description: 'Sensor company' };
  for (const value of [null, {}, [entry, entry], [{ ...entry, original: 'Private original' }], [{ ...entry, fieldId: 'field-999' }], [{ ...entry, token: '{{PRIVATE_999}}' }], [{ ...entry, type: 'inferred' }], ...['', ' '.repeat(3), 'a'.repeat(501), '😀'.repeat(251), '!!private!!', '{{PRIVATE_1}}', '<b>HTML</b>', 'two\nlines'].map(description => [{ ...entry, description }])]) {
    assert.throws(() => validatePrivacyLegend(value, local.request.cv.fields));
    assert.throws(() => parseRefinementProposal(proposal(local), { ...local.request, privacyLegend: value } as typeof local.request));
  }
  validatePrivacyLegend([{ ...entry, description: '😀'.repeat(250) }], local.request.cv.fields);
  validatePrivacyLegend([], local.request.cv.fields);
});

test('visible employers, locations and links remain classified visible beside pseudonyms', () => {
  const parts = privacySegments('Public employer, Berlin, https://public.example.invalid {{PRIVATE_1}} {{APPLICANT_NAME}} {{CONFIDENTIAL}}');
  assert.deepEqual(parts.filter(part => part.status === 'pseudonymized').map(part => part.text), ['{{PRIVATE_1}}', '{{APPLICANT_NAME}}', '{{CONFIDENTIAL}}']);
  assert.match(parts[0].text, /Public employer, Berlin, https:/);
  assert.equal(parts[0].status, 'visible');
});

test('whole bullets carry their private tokens; omission never deletes local originals or mappings', () => {
  const local = prepare(); assert.equal(local.request.schemaVersion, 2); if (local.request.schemaVersion !== 2) return;
  const before = structuredClone(local), entry = local.request.cvStructure.entries.find(entry => entry.bulletIds.length === 2)!;
  const reordered = reconstructRefinementProposal(local, proposal(local, [{ id: 'change-1', type: 'reorder_bullets', targetId: entry.id, order: [...entry.bulletIds].reverse(), explanation: 'Prioritize evaluation.' }]), undefined, APP);
  assert.match(reordered.state.experience.jobs[0].bullets!, /^- Evaluated existing results with !!Secret Lab!!\./);
  const omitted = reconstructRefinementProposal(local, proposal(local, [{ id: 'change-1', type: 'omit_bullet', targetId: entry.bulletIds[0], explanation: 'Omit unrelated work.' }]), undefined, APP);
  assert.equal(omitted.state.experience.jobs[0].bullets!.includes('Secret Works'), false);
  assert.deepEqual(local, before);
  const range = local.request.cvStructure.ranges.find(range => range.bulletId === entry.bulletIds[0])!;
  assert.throws(() => parseRefinementProposal(proposal(local, [{ id: 'change-1', type: 'shorten_text', targetId: range.id, text: range.text.replace('{{PRIVATE_1}}', '{{PRIVATE_2}}'), explanation: 'Invalid token transfer.' }]), local.request), /token|shorten|extractive/i);
  assert.throws(() => validatePrivateTokenLines('Work {{PRIVATE_1}}.\nUnrelated work.', 'Work.\nUnrelated work {{PRIVATE_1}}.'), /attached/);
  validatePrivateTokenLines('Work {{PRIVATE_1}}.\r\nOther.', 'Relevant work {{PRIVATE_1}}.\nOther.');
});
