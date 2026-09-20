import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import { cloneCv, copyCvSection, createApplicationCv, cvDifferences, isApplicationCvPublished, listCareerRevisions, loadApplicationCv, pinCareerRevision, resetCvDifference, saveApplicationCv } from '../src/composables/applicationCv';
import { normalizeContentState } from '../src/composables/contentLayout';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('application CV copies retain independent content and pinned sources across later base edits', () => {
  const store = memoryStorage(); const source = createSampleDocument();
  const first = createApplicationCv('owner', 'application-a', 'research', 'Research', source, store);
  const second = createApplicationCv('owner', 'application-b', 'research', 'Research', source, store);
  first.state.contact.role = 'Robotics researcher';
  first.state.experience.jobs[0]!.title = 'Application-specific title';
  source.contact.role = 'Changed career variant';
  pinCareerRevision('research', source, store);
  saveApplicationCv(first, store); saveApplicationCv(second, store);
  assert.equal(loadApplicationCv('owner', 'application-a', store)?.state.contact.role, 'Robotics researcher');
  assert.equal(first.baseState.contact.role, second.state.contact.role);
  assert.notEqual(first.state.experience.jobs[0]!.title, second.state.experience.jobs[0]!.title);
  assert.equal(first.baseRevision, 1);
  assert.equal(listCareerRevisions('research', store).length, 2);
  assert.equal(loadApplicationCv('other-owner', 'application-a', store), null);
});
test('career checkpoints deduplicate unchanged documents and return detached content', () => {
  const store = memoryStorage(); const source = createSampleDocument();
  pinCareerRevision('career', source, store); pinCareerRevision('career', source, store);
  const history = listCareerRevisions('career', store);
  assert.equal(history.length, 1);
  history[0]!.state.contact.name = 'Modified read';
  assert.notEqual(listCareerRevisions('career', store)[0]!.state.contact.name, 'Modified read');
});
test('resetting one naming adjustment preserves unrelated application adjustments', () => {
  const record = createApplicationCv('u', 'a', 'research', 'Research', createSampleDocument(), memoryStorage());
  record.state.contact.role = 'Adjusted role'; record.state.about.text = 'Adjusted summary';
  const difference = cvDifferences(record.baseState, record.state).find(({ label }) => label === 'contact › role')!;
  record.state = resetCvDifference(record, difference);
  assert.equal(record.state.contact.role, record.baseState.contact.role);
  assert.equal(record.state.about.text, 'Adjusted summary');
  assert.throws(() => resetCvDifference(record, difference), /no longer exists/);
});
test('reordered entries are treated as a whole collection rather than mismatching array indexes', () => {
  const before = createSampleDocument(); const after = cloneCv(before);
  assert.ok(after.experience.jobs.length > 1);
  after.experience.jobs.reverse();
  const changes = cvDifferences(before, after);
  assert.deepEqual(changes.map(({ path }) => path), [['experience', 'jobs']]);
});
test('publication status follows exact local content and assigned cloud snapshot', () => {
  const record = createApplicationCv('u', 'a', 'research', 'Research', createSampleDocument(), memoryStorage());
  record.publishedSnapshotId = 'snapshot-1'; record.publishedState = cloneCv(record.state);
  assert.equal(isApplicationCvPublished(record, 'snapshot-1'), true);
  assert.equal(isApplicationCvPublished(record, 'snapshot-2'), false);
  record.state.contact.role = 'Changed after upload';
  assert.equal(isApplicationCvPublished(record, 'snapshot-1'), false);
});
test('section copying changes only the target and its chosen section', () => {
  const source = createSampleDocument(); const target = cloneCv(source);
  source.about.text = 'Research-focused summary'; target.contact.role = 'Application headline';
  const result = copyCvSection(target, source, 'about');
  assert.equal(result.about.text, source.about.text);
  assert.equal(result.contact.role, target.contact.role);
  assert.notEqual(target.about.text, source.about.text);
  result.about.text = 'New local edit';
  assert.equal(source.about.text, 'Research-focused summary');
});
test('failed writes preserve previous stored CV and corrupt or foreign backups are rejected', () => {
  const store = memoryStorage(); const record = createApplicationCv('u', 'a', 'research', 'Research', createSampleDocument(), store);
  saveApplicationCv(record, store);
  const original = loadApplicationCv('u', 'a', store);
  record.state.about.text = 'Unsaved edit';
  assert.throws(() => saveApplicationCv(record, { ...store, setItem: () => { throw new Error('Quota exceeded'); } }), /Quota/);
  assert.deepEqual(loadApplicationCv('u', 'a', store), original);
  assert.throws(() => loadApplicationCv('u', 'a', { ...store, getItem: () => JSON.stringify({ ...record, userId: 'someone-else' }) }), /invalid/);
});

test('mounting FormBuilder adds no adjustments or extra career revision before a single role edit', () => {
  const store = memoryStorage();
  const source = createSampleDocument();
  const original = structuredClone(source);
  const record = createApplicationCv('owner', 'app', 'career', 'Career', source, store);
  normalizeContentState(record.state); // The same normalization executed by FormBuilder on mount.
  assert.deepEqual(cvDifferences(record.baseState, record.state), []);
  assert.deepEqual(source, original);
  record.state.contact.role = 'Research engineer';
  assert.deepEqual(cvDifferences(record.baseState, record.state).map(({ label }) => label), ['contact › role']);
  pinCareerRevision('career', cloneCv(source), store);
  assert.equal(listCareerRevisions('career', store).length, 1);
});

test('legacy application records normalize base, working and published copies without losing real adjustments', () => {
  const store = memoryStorage();
  const raw = createSampleDocument();
  const record = createApplicationCv('owner', 'app', 'career', 'Career', raw, store);
  // Simulate data stored before application CV normalization was introduced.
  record.baseState = structuredClone(raw);
  record.state = structuredClone(raw);
  record.state.contact.role = 'Tailored role';
  normalizeContentState(record.state);
  record.publishedSnapshotId = 'snapshot';
  record.publishedState = structuredClone(raw);
  record.publishedState.contact.role = 'Tailored role';
  saveApplicationCv(record, store);
  const storedBeforeRead = [...store.values.entries()];
  const restored = loadApplicationCv('owner', 'app', store)!;
  assert.deepEqual(cvDifferences(restored.baseState, restored.state).map(({ label }) => label), ['contact › role']);
  assert.equal(isApplicationCvPublished(restored, 'snapshot'), true);
  assert.deepEqual([...store.values.entries()], storedBeforeRead);
  assert.equal(restored.baseState.customSections[0]!.entryMode, 'fields');
  assert.equal(restored.baseState.sidebarSections[0]!.items[0]!.levelValue, 0);
});

test('normalization retains explicit custom content, layout options and non-default skill values', () => {
  const source = createSampleDocument();
  const section = source.customSections[0]!;
  section.entryMode = 'textarea'; section.text = 'Meaningful custom narrative'; section.fields = ['title', 'institution'];
  section.entries[0]!.institution = 'Research Laboratory'; section.entries[0]!.desc = 'Meaningful evidence';
  source.sectionHeaderSizes[section.id] = 'h3';
  source.sidebarSections[0]!.levelType = 'experience'; source.sidebarSections[0]!.items[0]!.levelValue = 8;
  const original = structuredClone(source);
  const normalized = cloneCv(source);
  assert.equal(normalized.customSections[0]!.entryMode, 'textarea');
  assert.equal(normalized.customSections[0]!.text, 'Meaningful custom narrative');
  assert.deepEqual(normalized.customSections[0]!.fields, ['title', 'institution']);
  assert.equal(normalized.customSections[0]!.entries[0]!.institution, 'Research Laboratory');
  assert.equal(normalized.customSections[0]!.entries[0]!.desc, 'Meaningful evidence');
  assert.equal(normalized.sectionHeaderSizes[section.id], 'h3');
  assert.equal(normalized.sidebarSections[0]!.items[0]!.levelValue, 8);
  assert.deepEqual(source, original);
  assert.deepEqual(cvDifferences(source, normalized), []);
});

test('normalization treats explicit editor defaults and reordered object keys as the same career checkpoint', () => {
  const store = memoryStorage();
  const source = createSampleDocument();
  pinCareerRevision('career', source, store);
  const normalized = cloneCv(source);
  normalized.customSections[0] = { text: '', entryMode: 'fields', ...normalized.customSections[0]! };
  pinCareerRevision('career', normalized, store);
  assert.equal(listCareerRevisions('career', store).length, 1);
  assert.deepEqual(cvDifferences(source, normalized), []);
});
