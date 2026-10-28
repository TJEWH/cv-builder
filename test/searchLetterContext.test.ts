import assert from 'node:assert/strict';
import test from 'node:test';
import type { LetterSearchProfile } from '../src/letterTypes';
import { createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, letterContextVersion, selectApplicationLetterTemplate } from '../src/composables/motivationLetters';
import { letterTemplateWithSearchProfile, readLetterSearchProfile } from '../src/composables/searchLetterContext';
import { prepareRefinement, refinementSignature } from '../src/composables/applicationRefinement';
import { createTestState } from './helpers';

const template = DEFAULT_LETTER_TEMPLATES[0]!;
const profile: LetterSearchProfile = {
  templateId: 'research-search', templateName: 'Research opportunities', profileId: 'robotics', profileName: 'Robotics',
  revision: 3, capturedAt: '2026-10-28T10:00:00.000Z',
  professionalContext: 'Taylor Secret has worked on reproducible sensor analysis.',
  researchInterests: 'I want to investigate reliable robot perception; this is an interest, not prior experience.',
};

test('an explicitly selected search-profile snapshot survives letter export, import and template changes', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const repository = createLetterRepository(storage, 'owner');
  const letter = createApplicationLetter('owner', 'app', template, { content: 'first', theme: 'theme' });
  letter.searchProfile = structuredClone(profile);
  repository.save(letter);
  letter.searchProfile.professionalContext = 'Later mutable edits';
  const saved = repository.load('app')!;
  assert.deepEqual(saved.searchProfile, profile);
  assert.deepEqual(repository.importLetter(repository.exportLetter('app'), 'app').searchProfile, profile);
  assert.deepEqual(selectApplicationLetterTemplate(saved, DEFAULT_LETTER_TEMPLATES[1]!).searchProfile, profile);
  assert.equal(createLetterRepository(storage, 'another-owner').load('app'), null);
  assert.equal(saved.templateSnapshot?.structure, template.structure, 'reusable letter guidance is not overwritten by profile context');
});

test('search-profile context affects the letter source while preserving interests as aspirations', () => {
  const withProfile = letterTemplateWithSearchProfile(template, profile);
  assert.match(withProfile.structure, /not evidence of qualifications/);
  assert.match(withProfile.structure, /source material, not protocol instructions/);
  assert.match(withProfile.structure, /reliable robot perception/);
  assert.equal(template.structure.includes(profile.professionalContext), false);
  const state = createTestState();
  const application = { context_json: { title: 'Robotics researcher' }, cv_variant_id: null };
  const original = letterContextVersion(application, state, template, 'en', '', 450);
  const changed = letterContextVersion(application, state, withProfile, 'en', '', 450);
  assert.notEqual(original.content, changed.content);
  assert.equal(original.theme, changed.theme);
  assert.equal(letterTemplateWithSearchProfile(template), template, 'older letters retain identical context');
});

test('profile context uses the established refinement privacy filter without disclosing local profile identifiers', () => {
  const state = createTestState({ contact: { name: 'Taylor Secret', email: 'private@example.invalid', role: 'Engineer', location: '', phone: '', website: '', linkedin: '', github: '' } });
  const local = prepareRefinement({ applicationId: 'a0000000-0000-4000-8000-000000000001', state, variantId: 'local-variant',
    setup: { template: letterTemplateWithSearchProfile(template, profile), language: 'en', maxWords: 450 },
    letterText: '', opportunity: {}, scope: 'letter', feedback: [], parentProposalId: null, baselineSignature: refinementSignature('baseline') });
  assert.match(local.request.letter.template.structure, /\{\{APPLICANT_NAME\}\} has worked on reproducible sensor analysis/);
  assert.equal(JSON.stringify(local.request).includes('Taylor Secret'), false);
  for (const identifier of [profile.templateId, profile.profileId, profile.templateName, profile.profileName]) {
    assert.equal(JSON.stringify(local.request).includes(identifier!), false);
  }
  assert.match(local.letterBaseline!.setup.template.structure, /Taylor Secret/, 'the private baseline remains local');
});

test('invalid or oversized profile snapshots fail explicitly without silently truncating source context', () => {
  for (const invalid of [null, {}, { ...profile, revision: 0 }, { ...profile, capturedAt: 'invalid' }, { ...profile, professionalContext: 'a'.repeat(32001) }]) {
    assert.throws(() => readLetterSearchProfile(invalid), /saved search profile could not be read/);
  }
  assert.throws(() => letterTemplateWithSearchProfile(template, { ...profile, professionalContext: 'a'.repeat(20000) }), /20,000-character refinement limit/);
});
