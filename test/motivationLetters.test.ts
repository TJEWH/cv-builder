import assert from 'node:assert/strict';
import test from 'node:test';
import { addIncomingDraft, contextChanges, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, DEFAULT_TEMPLATE_GUIDANCE,
  editLetter, finalizedLetterRevision, finalizeLetter, letterContextVersion, letterFromEditableText, letterToEditableText, openLetterRevision, parseIncomingLetter, readLetterTemplate, resolveLetterContent,
  sameLetterContextInput, saveWorkingRevision, unresolvedLetterPlaceholders } from '../src/composables/motivationLetters';
import { createTestState } from './helpers';

const template = DEFAULT_LETTER_TEMPLATES[0];
const version = { content: 'content-1', theme: 'theme-1' };
const contact = { ...createTestState().contact, name: 'Private Applicant' };
const content = { subject: 'Research application', salutation: 'Dear committee,', body: 'My research experience fits this role.', closing: 'Kind regards,\n{{APPLICANT_NAME}}' };
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

test('letter storage isolates accounts and applications and stores independent copies', () => {
  const storage = memory();
  const first = createLetterRepository(storage, 'user-one');
  const second = createLetterRepository(storage, 'user-two');
  const record = editLetter(createApplicationLetter('user-one', 'application-one', template, version), content);
  first.save(record);
  assert.equal(second.load('application-one'), null);
  assert.equal(first.load('application-two'), null);
  record.working.body = 'Changed after save';
  assert.equal(first.load('application-one')?.working.body, content.body);
  const loaded = first.load('application-one')!;
  loaded.working.body = 'Changed after load';
  assert.equal(first.load('application-one')?.working.body, content.body);
  assert.throws(() => second.save(record), /Stored letter could not be read/);
});

test('incoming cloud drafts append idempotently and never overwrite edits or a final revision', () => {
  const original = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const incoming = { ...content, body: 'A newly generated alternative.' };
  const updated = addIncomingDraft(original, incoming, version, { cloudDraftId: 'draft-1', cloudContextId: 'context-1' });
  assert.deepEqual(updated.working, original.working);
  assert.equal(updated.finalRevisionId, original.finalRevisionId);
  assert.equal(updated.revisions.length, 2);
  assert.equal(original.revisions.length, 1);
  assert.equal(addIncomingDraft(updated, incoming, version, { cloudDraftId: 'draft-1' }).revisions.length, 2);
});

test('opening an incoming draft archives current edits while preserving all final snapshots', () => {
  const final = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const finalId = final.finalRevisionId;
  const edited = editLetter(final, { ...content, body: 'My later edit' });
  assert.equal(edited.finalRevisionId, null);
  const incoming = addIncomingDraft(edited, { ...content, body: 'An alternative' }, version);
  const opened = openLetterRevision(incoming, incoming.revisions.at(-1)!.id);
  assert.equal(opened.working.body, 'An alternative');
  assert.equal(opened.revisions.at(-1)?.content.body, 'My later edit');
  assert.equal(opened.revisions.find((item) => item.id === finalId)?.content.body, content.body);
  const restored = openLetterRevision(opened, finalId!);
  assert.equal(restored.finalRevisionId, finalId);
  assert.equal(restored.working.body, content.body);
});

test('context fingerprints detect CV facts, opportunity and template changes separately from visual changes', () => {
  const state = createTestState();
  const application = { context_json: { title: 'Researcher', requirements: ['Robotics'] }, cv_variant_id: 'snapshot-1' };
  const initial = letterContextVersion(application, state, template, 'en', '', 450);
  const record = createApplicationLetter('owner', 'app', template, initial);
  assert.deepEqual(contextChanges(record, letterContextVersion({ ...application, cv_variant_id: 'republished-same-cv' }, state, template, 'en', '', 450)), { content: false, theme: false });
  const changedStyle = createTestState({ design: { ...state.design, ink: '#123456' } });
  assert.deepEqual(contextChanges(record, letterContextVersion(application, changedStyle, template, 'en', '', 450)), { content: false, theme: true });
  const changedFacts = createTestState({ ...state, about: { text: 'New research interest.' } });
  assert.deepEqual(contextChanges(record, letterContextVersion(application, changedFacts, template, 'en', '', 450)), { content: true, theme: false });
  for (const changed of [
    letterContextVersion({ ...application, context_json: { title: 'New role' } }, state, template, 'en', '', 450),
    letterContextVersion(application, state, { ...template, revision: 2, tone: 'More concise' }, 'en', '', 450),
    letterContextVersion(application, state, { ...template, salutationInstructions: 'Use the named project supervisor.' }, 'en', '', 450),
    letterContextVersion(application, state, template, 'de', '', 450),
    letterContextVersion(application, state, template, 'en', 'Focus on control theory', 450),
  ]) assert.equal(contextChanges(record, changed).content, true);
});

test('editor-only checklist changes do not invalidate letter context', () => {
  const state = createTestState();
  const application = { context_json: {}, cv_variant_id: null };
  assert.deepEqual(
    letterContextVersion(application, state, template, 'en', '', 450),
    letterContextVersion(application, { ...state, completedSections: ['about'] }, template, 'en', '', 450),
  );
});

test('published context comparison ignores JSONB key ordering but preserves fact and array differences', () => {
  assert.equal(sameLetterContextInput({ title: 'Role', requirements: { b: 2, a: 1 } }, { requirements: { a: 1, b: 2 }, title: 'Role' }), true);
  assert.equal(sameLetterContextInput({ requirements: ['A', 'B'] }, { requirements: ['B', 'A'] }), false);
  assert.equal(sameLetterContextInput({ title: 'Role' }, { title: 'Different role' }), false);
});

test('identity placeholders resolve only in the local rendered copy and missing values remain visible', () => {
  const contact = { ...createTestState().contact, name: 'Private Person', email: 'private@example.test', phone: '' };
  const input = { ...content, body: 'Contact {{APPLICANT_EMAIL}} or [APPLICANT_PHONE]. {{UNKNOWN_VALUE}}', closing: 'Regards, {{APPLICANT_NAME}}' };
  const resolved = resolveLetterContent(input, contact);
  assert.equal(resolved.closing, 'Regards, Private Person');
  assert.ok(resolved.body.includes('private@example.test'));
  assert.equal(input.closing, 'Regards, {{APPLICANT_NAME}}');
  assert.deepEqual(unresolvedLetterPlaceholders(input, contact), ['[APPLICANT_PHONE]', '{{UNKNOWN_VALUE}}']);
  assert.ok(unresolvedLetterPlaceholders(input, null).includes('{{APPLICANT_NAME}}'));
});

test('finalization rejects empty and unresolved letters and preserves immutable final snapshots', () => {
  const empty = createApplicationLetter('owner', 'app', template, version);
  assert.throws(() => finalizeLetter(empty, version, null), /Write or import/);
  assert.throws(() => finalizeLetter(editLetter(empty, content), version, null), /Resolve all placeholders/);
  const final = finalizeLetter(editLetter(empty, content), version, contact);
  final.working.body = 'Mutable working text';
  assert.equal(final.revisions[0].content.body, content.body);
  const savedRevision = saveWorkingRevision(final);
  savedRevision.working.body = 'Yet another change';
  assert.equal(savedRevision.revisions.at(-1)?.content.body, 'Mutable working text');
});

test('export readiness requires a matching immutable final revision, not just a stored final ID', () => {
  const final = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  assert.equal(finalizedLetterRevision(final)?.id, final.finalRevisionId);
  assert.equal(finalizedLetterRevision({ ...final, finalRevisionId: 'missing-final' }), null);
  assert.equal(finalizedLetterRevision({ ...final, workingContext: { ...version, content: 'unreviewed-context' } }), null);
  assert.equal(finalizedLetterRevision({ ...final, working: { ...content, body: 'Unfinalized changes' } }), null);
});

test('templates have monotonic revisions and importing copies never changes an assigned template', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const defaults = repository.listTemplates();
  defaults[0].name = 'Edited name';
  assert.notEqual(repository.listTemplates()[0].name, 'Edited name');
  const saved = repository.saveTemplate({ ...template, tone: 'New tone' });
  assert.equal(saved.revision, 2);
  const exported = repository.exportTemplates();
  const copies = repository.importTemplates(exported);
  assert.ok(copies.every((copy) => !DEFAULT_LETTER_TEMPLATES.some((item) => item.id === copy.id)));
  assert.equal(repository.listTemplates().find((item) => item.id === template.id)?.revision, 2);
  assert.equal(repository.listTemplates().length, 4);
});

test('legacy template libraries receive editable defaults and retain explicit guidance in backups', () => {
  const { subjectInstructions, salutationInstructions, closingInstructions, ...legacy } = template;
  const read = readLetterTemplate(legacy);
  assert.equal(read.subjectInstructions, DEFAULT_TEMPLATE_GUIDANCE.subjectInstructions);
  assert.equal(read.salutationInstructions, DEFAULT_TEMPLATE_GUIDANCE.salutationInstructions);
  assert.equal(read.closingInstructions, DEFAULT_TEMPLATE_GUIDANCE.closingInstructions);
  const repository = createLetterRepository(memory(), 'owner');
  const saved = repository.saveTemplate({ ...read, subjectInstructions: 'Include the tender reference.', salutationInstructions: 'Address the named supervisor.', closingInstructions: 'Close with a short invitation.' });
  const imported = repository.importTemplates(repository.exportTemplates()).find((item) => item.name === saved.name)!;
  assert.equal(imported.subjectInstructions, saved.subjectInstructions);
  assert.equal(imported.salutationInstructions, saved.salutationInstructions);
  assert.equal(imported.closingInstructions, saved.closingInstructions);
  assert.throws(() => readLetterTemplate({ ...legacy, subjectInstructions: 42 }), /instructions/);
  assert.throws(() => readLetterTemplate({ ...legacy, closingInstructions: 'a'.repeat(1001) }), /instructions/);
});

test('complete-letter editing preserves every legacy block and old revisions while making all wording editable', () => {
  const original = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const fullText = letterToEditableText(original.working);
  for (const part of Object.values(content)) assert.ok(fullText.includes(part));
  const changed = fullText.replace('Dear committee,', 'Dear Dr. Example,').replace('Kind regards,', 'Yours sincerely,');
  const updated = editLetter(original, letterFromEditableText(changed));
  assert.equal(updated.working.subject, content.subject);
  assert.equal(updated.working.salutation, '');
  assert.equal(updated.working.closing, '');
  assert.ok(updated.working.body.includes('Dear Dr. Example,'));
  assert.ok(updated.working.body.includes('Yours sincerely,'));
  assert.equal(letterToEditableText(updated.working), changed);
  assert.equal(updated.finalRevisionId, null);
  assert.deepEqual(updated.revisions[0].content, content);
  assert.deepEqual(original.working, content);
  const repository = createLetterRepository(memory(), 'owner');
  repository.save(updated);
  assert.deepEqual(repository.importLetter(repository.exportLetter('app'), 'app').working, updated.working);
});

test('complete-letter editor supports plain text, empty text and body whitespace without hidden extra blocks', () => {
  for (const body of ['', 'A complete letter without a subject', '\nOpening\n\n\nBody\n\nClosing\n']) {
    assert.equal(letterToEditableText(letterFromEditableText(body)), body);
  }
  assert.deepEqual(letterFromEditableText('# Subject only'), { subject: 'Subject only', salutation: '', body: '', closing: '' });
});

test('backup restore rejects a different application or account and retains published context tracking', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const record = createApplicationLetter('owner', 'app', template, version);
  record.publishedContexts['cloud-context-1'] = version;
  repository.save(record);
  const json = repository.exportLetter('app');
  const other = createLetterRepository(memory(), 'someone-else');
  assert.throws(() => other.importLetter(json, 'app'), /Stored letter could not be read/);
  assert.throws(() => repository.importLetter(json, 'different-app'), /Stored letter could not be read/);
  assert.deepEqual(repository.importLetter(json, 'app').publishedContexts, record.publishedContexts);
});

test('damaged storage and quota errors surface instead of silently replacing user work', () => {
  const storage = memory();
  const repository = createLetterRepository(storage, 'owner');
  repository.save(createApplicationLetter('owner', 'app', template, version));
  const key = [...storage.values.keys()][0];
  storage.values.set(key, '{invalid');
  assert.throws(() => repository.load('app'));
  assert.equal(storage.values.get(key), '{invalid');
  const failing = createLetterRepository({ getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } }, 'owner');
  assert.throws(() => failing.save(createApplicationLetter('owner', 'app', template, version)), /Quota exceeded/);
});

test('plain text and structured generated drafts import as inert content', () => {
  assert.equal(parseIncomingLetter('<script>alert(1)</script>').body, '<script>alert(1)</script>');
  assert.deepEqual(parseIncomingLetter('```json\n{"subject":"Subject","body":"Body"}\n```'), { subject: 'Subject', salutation: '', body: 'Body', closing: '' });
  assert.throws(() => parseIncomingLetter('{"subject":"Missing body"}'), /needs a body/);
  assert.throws(() => parseIncomingLetter('{"body":2}'), /needs a body/);
});
