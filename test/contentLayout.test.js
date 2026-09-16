import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContentState, reorderVisibleSectionOrder } from '../src/composables/contentLayout.js';

test('reorders visible sections while preserving hidden section positions', () => {
  const order = ['about', 'education', 'jobs', 'research'];

  assert.deepEqual(
    reorderVisibleSectionOrder(order, ['education'], ['research', 'jobs', 'about']),
    ['research', 'education', 'jobs', 'about'],
  );
});

test('defaults legacy CVs to breakable body sections', () => {
  const state = { version: 2, experience: {} };
  normalizeContentState(state);
  assert.deepEqual(state.keepTogetherSections, []);
});

test('retains only current body section keys in keep-together settings', () => {
  const state = {
    version: 7,
    experience: {},
    customSections: [{ id: 'body_current', name: 'Projects', entries: [] }],
    sidebarSections: [{ id: 'sidebar_current', name: 'Skills', items: [] }],
    keepTogetherSections: ['education', 'body_current', 'jobs', 'education', 'body_deleted', 'sidebar_current', 'languages', null],
  };
  normalizeContentState(state);
  assert.deepEqual(state.keepTogetherSections, ['education', 'body_current', 'jobs']);

  state.customSections = [];
  normalizeContentState(state);
  assert.deepEqual(state.keepTogetherSections, ['education', 'jobs']);
});

test('migrates legacy ordering into fixed body and sidebar orders', () => {
  const state = {
    version: 1,
    lang: 'en',
    disabled: ['skills'],
    skills: [{ title: 'Legacy skills' }],
    orderMain: ['projects', 'legacy_body', 'skills'],
    orderSide: ['skills', 'certs', 'languages'],
    sectionPlacement: { legacy_body: 'sidebar' },
    customSections: [{ id: 'legacy_body', name: 'Legacy', entries: [{ title: 'Entry' }] }],
    education: [{ title: 'Degree' }],
    experience: { jobs: [{}], addExp: [], projects: [{ title: 'Legacy project' }] },
    languages: [{}],
    hobbies: [{}],
    certs: [{}],
  };

  normalizeContentState(state);

  const migratedProject = state.customSections.find((section) => section.name === 'Projects & Publications');
  const migratedCertificates = state.sidebarSections.find((section) => section.name === 'Certificates');
  assert.deepEqual(state.bodyOrder, [migratedProject.id, 'legacy_body', 'about', 'education', 'jobs']);
  assert.deepEqual(state.sidebarOrder, [migratedCertificates.id, 'languages', 'hobbies']);
  assert.equal(state.skills, undefined);
  assert.equal(state.sectionPlacement, undefined);
  assert.equal(state.experience.projects, undefined);
  assert.equal(state.certs, undefined);
  assert.deepEqual(state.disabled, []);
  assert.ok(state.education[0].id);
  assert.ok(state.experience.jobs[0].id);
  assert.ok(state.customSections[0].entries[0].id);
});

test('converts a legacy custom array to a single body-only custom section', () => {
  const state = {
    version: 1,
    lang: 'de',
    custom: [{ title: 'Vortrag' }],
    experience: {},
  };

  normalizeContentState(state);

  assert.equal(state.custom, undefined);
  assert.equal(state.customSections.length, 1);
  assert.equal(state.customSections[0].name, 'Eigene Sektion');
  assert.deepEqual(state.customSections[0].fields, ['title', 'institution', 'place', 'start', 'end', 'tools', 'desc']);
  assert.equal(state.customSections[0].entries[0].institution, '');
  assert.equal(state.customSections[0].entries[0].title, 'Vortrag');
  assert.ok(state.bodyOrder.includes(state.customSections[0].id));
  assert.deepEqual(state.sidebarSections, []);
});

test('normalizes configurable custom body fields without losing entry data', () => {
  const state = {
    version: 4,
    customSections: [{
      id: 'custom',
      name: 'Talks',
      fields: ['end', 'title', 'tools', 'unknown', 'title'],
      entries: [{ title: 'VueConf', place: 'Berlin', start: '2025', end: '2025', tools: 'Vue, Vite', desc: 'Session' }],
    }],
    experience: {},
  };

  normalizeContentState(state);

  assert.deepEqual(state.customSections[0].fields, ['title', 'end', 'tools']);
  assert.equal(state.customSections[0].entries[0].place, 'Berlin');
  assert.equal(state.customSections[0].entries[0].tools, 'Vue, Vite');
  assert.equal(state.customSections[0].entries[0].desc, 'Session');
});

test('normalizes sidebar skill sections without a configurable section header', () => {
  const state = {
    version: 2,
    lang: 'en',
    bodyOrder: ['about'],
    sidebarOrder: ['custom_sidebar'],
    sidebarSections: [{ id: 'custom_sidebar', name: 'Tools', levelType: 'years', items: [{ name: 'Vue', levelValue: 4 }] }],
    experience: {},
  };

  normalizeContentState(state);

  assert.equal(state.sidebarSections[0].items[0].id.length > 0, true);
  assert.deepEqual(state.sidebarOrder, ['custom_sidebar', 'languages', 'hobbies']);
  assert.equal(state.sidebarSections[0].levelType, 'years');
});

test('preserves item visibility without automatically grouping hidden sections', () => {
  const state = {
    version: 2,
    bodyOrder: ['jobs', 'about'],
    sidebarOrder: ['languages'],
    education: [{ title: 'Degree', hidden: true }],
    experience: { jobs: [{}] },
    languages: [{}],
    hobbies: [{}],
  };

  normalizeContentState(state);

  assert.deepEqual(state.bodyOrder, ['jobs', 'about', 'education']);
  assert.deepEqual(state.sidebarOrder, ['languages', 'hobbies']);
  assert.equal(state.education[0].hidden, true);
  assert.equal(state.experience.jobs[0].hidden, false);
});

test('migrates legacy markdown and education details to shared text fields', () => {
  const state = {
    version: 2,
    about: { text: 'Intro\n- About point' },
    education: [{ thesisTopic: 'Machine Learning', thesisBullets: ['Research', 'Publication'], courses: [{ title: 'Algorithms', description: 'Advanced' }, { title: 'Databases', description: '' }] }],
    experience: {
      jobs: [{ bullets: ['Launch', 'Mentor'] }],
      addExp: [{ desc: 'Prototype\n- Validated idea' }],
      projects: [{ desc: 'CLI utility' }],
    },
    customSections: [{ id: 'custom', name: 'Custom', entries: [{ desc: 'Talk\n- Audience Q&A' }] }],
  };

  normalizeContentState(state);

  assert.equal(state.version, 5);
  assert.equal(state.experience.jobs[0].bullets, '- Launch\n- Mentor');
  assert.equal(state.education[0].thesis, 'Machine Learning\n- Research\n- Publication');
  assert.equal(state.education[0].coursesText, '- Algorithms — Advanced\n- Databases');
  assert.equal(state.education[0].thesisTopic, undefined);
  assert.equal(state.education[0].thesisBullets, undefined);
  assert.equal(state.education[0].courses, undefined);
  assert.equal(state.experience.addExp, undefined);
  assert.equal(state.experience.projects, undefined);
  assert.equal(state.customSections.some((section) => section.entries.some((entry) => entry.desc === 'Prototype\n- Validated idea')), true);
  assert.equal(state.customSections[0].entries[0].desc, 'Talk\n- Audience Q&A');
});

test('preserves existing v5 education text while removing obsolete fields', () => {
  const state = {
    version: 5,
    education: [{
      thesis: '**Existing thesis**',
      coursesText: '- Existing course',
      thesisTopic: 'Old topic',
      thesisBullets: ['Old detail'],
      courses: [{ title: 'Old course' }],
    }],
    experience: {},
  };

  normalizeContentState(state);

  assert.equal(state.education[0].thesis, '**Existing thesis**');
  assert.equal(state.education[0].coursesText, '- Existing course');
  assert.equal(state.education[0].thesisTopic, undefined);
  assert.equal(state.education[0].thesisBullets, undefined);
  assert.equal(state.education[0].courses, undefined);
});
