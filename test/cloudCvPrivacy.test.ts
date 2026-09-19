import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { readCvConfig, readCvContent } from '../src/composables/cvStateValidation';
import { createDefaultDesign, SAMPLE_CONTACT } from '../src/defaults';
import { createTestState } from './helpers';

const options = { id: '1ba99b9b-a230-4492-9c80-dd16a1d1560a', now: new Date('2026-09-19T16:00:00.000Z') };

test('cloud CVs always use contact placeholders and redact confidential content without mutating local state', () => {
  const state = createTestState({
    contact: Object.fromEntries(Object.keys(SAMPLE_CONTACT).map((key) => [key, `Private contact ${key}`])) as typeof SAMPLE_CONTACT,
    about: { text: 'Public !!Private about!!' },
    education: [{ id: 'Private education ID', title: 'Public !!Private degree!!', desc: '[!!Private label!!](https://private-link.example)' }],
    customSections: [{ id: 'Private section ID', name: 'Research !!Private section!!', entries: [{ id: 'Private entry ID', desc: '!!Private desc!!' }] }],
    sidebarSections: [{ id: 'Private sidebar ID', name: 'Skills !!Private skills!!', levelType: null, items: [{ id: 'Private skill ID', name: '!!Private skill name!!' }] }],
    sectionNames: { education: 'Education !!Private heading!!', 'Private section ID': 'Public title' },
    bodyOrder: ['education', 'Private section ID'], sidebarOrder: ['Private sidebar ID'],
  });
  const before = structuredClone(state);
  const snapshot = createCloudCvSnapshot(state, options);
  assert.deepEqual(snapshot.content_json.contact, SAMPLE_CONTACT);
  assert.equal(snapshot.content_json.about.text, 'Public !!confidential text!!');
  assert.equal(snapshot.content_json.education[0].desc, '!!confidential text!!');
  assert.equal(JSON.stringify(snapshot).includes('Private'), false);
  assert.equal(JSON.stringify(snapshot).includes('private-link.example'), false);
  assert.deepEqual(state, before);
  snapshot.content_json.education[0].title = 'Edited snapshot';
  assert.deepEqual(state, before);
  assert.equal(snapshot.name, 'Privacy CV 2026-09-19T16:00:00.000Z 1ba99b9b');
  assert.equal(snapshot.cv_version, 7);
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.is_base_variant, false);
  assert.equal(Object.hasOwn(snapshot.content_json, 'format'), false);
});

test('excluded and hidden content and every associated local reference are absent from uploads', () => {
  const state = createTestState({
    disabled: ['education', 'private-disabled'],
    anonymization: { excludedSections: ['private-section'], excludedItems: ['private-excluded-item'] },
    education: [{ id: 'private-education', title: 'private degree' }],
    experience: { jobs: [{ id: 'public-job', company: 'Public company' }, { id: 'private-hidden', company: 'private employer', hidden: true }, { id: 'private-excluded-item', title: 'private title' }] },
    customSections: [{ id: 'private-section', name: 'private title', entries: [] }, { id: 'public-section', name: 'Research', entries: [] }],
    sidebarSections: [{ id: 'private-disabled', name: 'private sidebar', levelType: null, items: [] }],
    sectionNames: { 'private-section': 'private name', 'private-disabled': 'private other name', 'public-section': 'Research', unknown: 'private unknown name' },
    sectionHeaderSizes: { 'private-section': 'private size', 'public-section': 'h3' },
    bodyOrder: ['education', 'jobs', 'private-section', 'public-section'], sidebarOrder: ['private-disabled'],
    completedSections: ['private-section', 'public-section'], keepTogetherSections: ['private-section', 'public-section'],
  });
  const snapshot = createCloudCvSnapshot(state, options);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.deepEqual(snapshot.content_json.education, []);
  assert.deepEqual(snapshot.content_json.experience.jobs, [{ id: 'item-1', company: 'Public company' }]);
  assert.deepEqual(snapshot.config_json.disabled, ['education']);
  assert.deepEqual(snapshot.config_json.bodyOrder, ['jobs', 'section-1']);
  assert.deepEqual(snapshot.config_json.sectionHeaderSizes, { 'section-1': 'h3' });
  assert.deepEqual(snapshot.config_json.completedSections, ['section-1']);
  assert.deepEqual(snapshot.config_json.keepTogetherSections, ['section-1']);
  assert.deepEqual(snapshot.config_json.anonymization, { excludedSections: [], excludedItems: [] });
  assert.deepEqual(snapshot.config_json.hiddenItems, []);
  assert.deepEqual(snapshot.content_json.sectionNames, { 'section-1': 'Research' });
  readCvContent(snapshot.content_json); readCvConfig(snapshot.config_json);
});

test('unknown fields and arbitrary config strings cannot escape via the cloud projection', () => {
  const state = createTestState({ education: [{ id: 'private-id', title: 'Public' }], design: {
    fontBody: 'private font name', fontHead: 'Inter', ink: 'private color', h1: '24pt', h2: '12pt private size',
    customFonts: [{ name: 'private custom font', source: 'google' }], favoriteControls: ['private favorite'],
  }, sectionHeaderSizes: { education: 'private header style' } });
  for (const object of [state, state.contact, state.about, state.education[0], state.design]) Object.assign(object, { unknown: 'private unknown' });
  const snapshot = createCloudCvSnapshot(state, options);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.deepEqual(snapshot.config_json.design, { fontHead: 'Inter', h1: '24pt' });
  assert.deepEqual(snapshot.config_json.sectionHeaderSizes, {});
});

test('supported presentation settings survive cloud projection while editor-only fonts and favorites stay local', () => {
  const design = createDefaultDesign();
  const { favoriteControls: _favorites, customFonts: _fonts, ...expected } = design;
  const snapshot = createCloudCvSnapshot(createTestState({ design }), options);
  assert.deepEqual(snapshot.config_json.design, expected);
  assert.deepEqual(snapshot.content_json.contact, createTestState().contact);
});

test('snapshot identity must be generated independently of local CV metadata', () => {
  assert.throws(() => createCloudCvSnapshot(createTestState(), { id: 'private name' }), /Invalid snapshot ID/);
  const first = createCloudCvSnapshot(createTestState());
  const second = createCloudCvSnapshot(createTestState());
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.name, second.name);
});
