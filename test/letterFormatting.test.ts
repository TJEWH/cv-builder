import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApplicationLetter, LetterFormatting } from '../src/letterTypes';
import { DEFAULT_LETTER_FORMATTING, readLetterFormatting, resolveLetterFormatting } from '../src/composables/letterFormatting';
import { contextChanges, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizedLetterRevision, finalizeLetter, formatLetter, letterContextVersion, selectApplicationLetterTemplate } from '../src/composables/motivationLetters';
import { createTestState } from './helpers';

const template = DEFAULT_LETTER_TEMPLATES[0]!;
const state = createTestState();
const application = { context_json: { title: 'PhD position' }, cv_variant_id: null };
const context = letterContextVersion(application, state, template, 'en', '', 450);
const custom: LetterFormatting = { marginMm: 25, fontSizePt: 12, lineHeight: 1.5 };
const createLetter = () => createApplicationLetter('owner', 'application', template, context);
function repository() {
  const data = new Map<string, string>();
  return createLetterRepository({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }, 'owner');
}

test('older letters use independent general PhD defaults without rewriting their backups', () => {
  assert.deepEqual(resolveLetterFormatting(), { marginMm: 20, fontSizePt: 11, lineHeight: 1.2 });
  const resolved = resolveLetterFormatting();
  resolved.marginMm = 15;
  assert.equal(DEFAULT_LETTER_FORMATTING.marginMm, 20);
  const store = repository();
  const original = createLetter();
  store.save(original);
  assert.deepEqual(store.load('application'), original);
  assert.equal('formatting' in store.importLetter(store.exportLetter('application'), 'application'), false);
});

test('custom letter formatting survives application saves and backup imports independently', () => {
  const store = repository();
  const first = formatLetter(createLetter(), custom);
  store.save(first);
  store.save({ ...createLetter(), applicationId: 'other-application' });
  assert.deepEqual(store.load('application')?.formatting, custom);
  assert.equal(store.load('other-application')?.formatting, undefined);
  const imported = store.importLetter(store.exportLetter('application'), 'application');
  assert.deepEqual(imported.formatting, custom);
  imported.formatting!.marginMm = 30;
  assert.deepEqual(store.load('application')?.formatting, custom);
  assert.deepEqual(selectApplicationLetterTemplate(first, DEFAULT_LETTER_TEMPLATES[1]!).formatting, custom);
});

test('formatting validation accepts boundary values and rejects malformed or out-of-range backups', () => {
  for (const value of [{ marginMm: 10, fontSizePt: 10, lineHeight: 1 }, { marginMm: 30, fontSizePt: 14, lineHeight: 2 }]) {
    assert.deepEqual(readLetterFormatting(value), value);
  }
  const store = repository();
  for (const formatting of [null, [], {}, 'default', { ...custom, marginMm: 9 }, { ...custom, marginMm: 31 },
    { ...custom, fontSizePt: 9.9 }, { ...custom, fontSizePt: 14.1 }, { ...custom, lineHeight: .9 }, { ...custom, lineHeight: 2.1 },
    { ...custom, marginMm: '25' }, { ...custom, lineHeight: Infinity }, { ...custom, fontSizePt: NaN }]) {
    assert.throws(() => readLetterFormatting(formatting), /letter formatting/i);
    assert.throws(() => store.importLetter(JSON.stringify({ ...createLetter(), formatting }), 'application'), /letter formatting/i);
  }
  assert.throws(() => store.save({ ...createLetter(), formatting: { ...custom, marginMm: NaN } } as ApplicationLetter), /letter formatting/i);
});

test('formatting changes only the layout context and explicit defaults match absent settings', () => {
  assert.deepEqual(letterContextVersion(application, state, template, 'en', '', 450, { ...DEFAULT_LETTER_FORMATTING }), context);
  const formatted = letterContextVersion(application, state, template, 'en', '', 450, custom);
  assert.deepEqual(contextChanges(createLetter(), formatted), { content: false, theme: true });
  for (const change of [{ marginMm: 25 }, { fontSizePt: 12 }, { lineHeight: 1.5 }]) {
    const changed = letterContextVersion(application, state, template, 'en', '', 450, { ...DEFAULT_LETTER_FORMATTING, ...change });
    assert.equal(changed.content, context.content);
    assert.notEqual(changed.theme, context.theme);
  }
});

test('formatting edits and reset require fresh approval without changing wording or prior final revisions', () => {
  const written = editLetter(createLetter(), { subject: 'PhD application', salutation: 'Dear Selection Committee,', body: 'My research experience fits the project.', closing: 'Yours sincerely,' });
  const approved = finalizeLetter(written, context, state.contact);
  const formatted = formatLetter(approved, custom);
  assert.equal(formatted.finalRevisionId, null);
  assert.equal(finalizedLetterRevision(formatted), null);
  assert.deepEqual(formatted.working, approved.working);
  assert.deepEqual(formatted.revisions, approved.revisions);
  assert.deepEqual(formatted.workingContext, approved.workingContext, 'a format edit leaves layout review pending');
  assert.ok(approved.finalRevisionId, 'the source is immutable');
  assert.equal(approved.formatting, undefined);
  const customContext = letterContextVersion(application, state, template, 'en', '', 450, custom);
  const approvedCustom = finalizeLetter(formatted, customContext, state.contact);
  assert.equal(formatLetter(approvedCustom, custom).finalRevisionId, approvedCustom.finalRevisionId, 'unchanged formatting preserves approval');
  const reset = formatLetter(approvedCustom);
  assert.equal(reset.finalRevisionId, null);
  assert.equal('formatting' in reset, false);
  assert.deepEqual(resolveLetterFormatting(reset.formatting), DEFAULT_LETTER_FORMATTING);
  assert.deepEqual(reset.working, approvedCustom.working);
  assert.equal(formatLetter(approved, { ...DEFAULT_LETTER_FORMATTING }).finalRevisionId, approved.finalRevisionId);
});
