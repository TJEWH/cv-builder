import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestState } from './helpers';
import { createAnonymizedContact } from '../src/composables/anonymization';
import { applyCvContent, createCvContentJson, cvContent, parseCvContentJson } from '../src/composables/cvJsonBackup';

function privateState() {
  return createTestState({
    contact: {
      name: 'SECRET_NAME', role: 'SECRET_ROLE', location: 'SECRET_LOCATION', email: 'SECRET_EMAIL@example.com',
      phone: 'SECRET_PHONE', website: 'https://example.com/SECRET_WEBSITE', linkedin: 'https://example.com/SECRET_LINKEDIN', github: 'https://example.com/SECRET_GITHUB',
    },
    about: { text: 'Worked for !!SECRET_CLIENT!! and [!!SECRET_LINK_LABEL!!](https://example.com/SECRET_LINK_TARGET).' },
    education: [{ id: 'degree-public', title: 'Public degree', thesis: 'A !!SECRET_THESIS!! thesis' },
      { id: 'degree-private', title: 'SECRET_DEGREE' }, { id: 'degree-hidden', title: 'SECRET_HIDDEN_DEGREE', hidden: true }],
    experience: { jobs: [{ id: 'job-private', company: 'SECRET_COMPANY', bullets: 'SECRET_JOB_TEXT' }] },
    languages: [{ id: 'lang-private', name: 'SECRET_LANGUAGE' }, { id: 'lang-public', name: 'English' }],
    hobbies: [{ id: 'hobby-hidden', name: 'SECRET_HOBBY' }],
    customSections: [
      { id: 'body-private', name: 'SECRET_BODY_NAME', text: 'SECRET_BODY_TEXT', entries: [{ id: 'body-private-item', title: 'SECRET_BODY_ITEM' }] },
      { id: 'body-public', name: 'Projects', text: 'Project !!SECRET_TEXT!!', entries: [
        { id: 'project-private', title: 'SECRET_PROJECT' }, { id: 'project-public', title: 'Public project', desc: 'Built !!SECRET_PRODUCT!!' },
      ] },
    ],
    sidebarSections: [
      { id: 'sidebar-private', name: 'SECRET_SIDEBAR_NAME', levelType: null, items: [{ id: 'sidebar-private-item', name: 'SECRET_SIDEBAR_ITEM' }] },
      { id: 'sidebar-public', name: 'Skills', levelType: null, items: [{ id: 'skill-private', name: 'SECRET_SKILL' }, { id: 'skill-public', name: 'TypeScript' }] },
    ],
    sectionNames: { header: 'SECRET_HEADER_LABEL', jobs: 'SECRET_JOBS_LABEL', hobbies: 'SECRET_HOBBIES_LABEL', 'body-private': 'SECRET_BODY_LABEL', about: 'About !!SECRET_ABOUT_LABEL!!' },
    disabled: ['hobbies'],
    anonymization: { excludedSections: ['jobs', 'body-private', 'sidebar-private'], excludedItems: ['degree-private', 'lang-private', 'project-private', 'skill-private'] },
  });
}

test('default content export anonymizes the header, omits hidden/private data, and redacts inline text', () => {
  const state = privateState();
  const before = structuredClone(state);
  const exported = createCvContentJson(state);
  const content = parseCvContentJson(JSON.stringify(exported));
  assert.equal(JSON.stringify(exported).includes('SECRET_'), false);
  assert.deepEqual(content.contact, createAnonymizedContact(state.contact));
  assert.equal(content.about.text, 'Worked for !!confidential text!! and !!confidential text!!.');
  assert.deepEqual(content.education.map(({ id }) => id), ['degree-public']);
  assert.deepEqual(content.experience.jobs, []);
  assert.deepEqual(content.hobbies, []);
  assert.deepEqual(content.customSections.map(({ id }) => id), ['body-public']);
  assert.deepEqual(content.sidebarSections.map(({ id }) => id), ['sidebar-public']);
  assert.equal(content.education[0].thesis, 'A !!confidential text!! thesis');
  assert.equal(content.customSections[0].text, 'Project !!confidential text!!');
  assert.deepEqual(state, before);
});

test('default import preserves local protected data and imports redacted textarea text literally', () => {
  const state = privateState();
  const before = structuredClone(state);
  const content = createCvContentJson(state).data;
  content.about.text += ' Revised by another editor.';
  content.contact.name = 'Incoming contact must not replace the local header';
  content.education[0].title = 'Updated public degree';
  content.education.push({ id: 'degree-private', title: 'Overwrite attempt' });
  content.sectionNames.jobs = 'Overwrite attempt';
  content.languages = [];
  const imported = structuredClone(content);
  const result = applyCvContent(state, content);
  assert.deepEqual(result.contact, state.contact);
  assert.deepEqual(result.experience, state.experience);
  assert.deepEqual(result.hobbies, state.hobbies);
  assert.deepEqual(result.education.slice(1), state.education.slice(1));
  assert.equal(result.education[0].title, 'Updated public degree');
  assert.equal(result.education[0].thesis, 'A !!confidential text!! thesis');
  assert.deepEqual(result.languages, [state.languages[0]]);
  assert.deepEqual(result.customSections[0], state.customSections[0]);
  assert.deepEqual(result.customSections[1].entries[0], state.customSections[1].entries[0]);
  assert.deepEqual(result.sidebarSections[0], state.sidebarSections[0]);
  assert.deepEqual(result.sidebarSections[1].items[0], state.sidebarSections[1].items[0]);
  assert.equal(result.sectionNames.jobs, state.sectionNames.jobs);
  assert.equal(result.about.text, content.about.text);
  assert.equal(result.about.text.includes('SECRET_CLIENT'), false);
  assert.equal(result.customSections[1].text, 'Project !!confidential text!!');
  assert.deepEqual(result.anonymization, state.anonymization);
  assert.deepEqual(result.design, state.design);
  assert.deepEqual(content, imported);
  assert.deepEqual(state, before);
});

test('protected sections are retained even when emptied, renamed or omitted by the imported file', () => {
  const state = privateState();
  state.anonymization.excludedSections.push('about', 'education', 'languages');
  const content = cvContent(createTestState());
  content.about.text = 'Replacement';
  content.customSections = [{ id: 'body-private', name: 'Replacement', entries: [] }];
  const result = applyCvContent(state, content);
  assert.deepEqual(result.about, state.about);
  assert.deepEqual(result.education, state.education);
  assert.deepEqual(result.languages, state.languages);
  assert.deepEqual(result.customSections.find(({ id }) => id === 'body-private'), state.customSections[0]);
  // A removed public container still retains its protected entry, not its public entries.
  assert.deepEqual(result.customSections.find(({ id }) => id === 'body-public')?.entries, [state.customSections[1].entries[0]]);
  assert.deepEqual(result.sidebarSections.find(({ id }) => id === 'sidebar-public')?.items, [state.sidebarSections[1].items[0]]);
});

test('moving an excluded item to another section cannot overwrite or duplicate it', () => {
  const state = privateState();
  const content = createCvContentJson(state).data;
  content.education.push({ id: 'project-private', title: 'Moved overwrite attempt' });
  const result = applyCvContent(state, content);
  assert.equal(result.education.some(({ id }) => id === 'project-private'), false);
  assert.deepEqual(result.customSections[1].entries[0], state.customSections[1].entries[0]);
});

test('bypass exports all original content, including header, hidden sections and inline secrets', () => {
  const state = privateState();
  const exported = createCvContentJson(state, { bypassPrivacy: true });
  assert.deepEqual(exported.data, cvContent(state));
  assert.equal(exported.data.contact.name, 'SECRET_NAME');
  assert.equal(exported.data.about.text.includes('!!SECRET_CLIENT!!'), true);
  assert.ok(exported.data.customSections.some(({ id }) => id === 'body-private'));
  assert.ok(exported.data.education.some(({ id }) => id === 'degree-hidden'));
  const modified = structuredClone(exported.data);
  modified.contact.name = 'New real name';
  modified.education = [];
  modified.customSections = [];
  const result = applyCvContent(state, modified, { bypassPrivacy: true });
  assert.deepEqual(cvContent(result), modified);
  assert.equal(result.contact.name, 'New real name');
  assert.deepEqual(result.design, state.design);
});

test('neither import mode attempts to deanonymize textarea placeholders', () => {
  for (const bypassPrivacy of [false, true]) {
    const state = privateState();
    const content = createCvContentJson(state).data;
    content.about.text = 'Changed order: !!confidential text!!. New paragraph: !!literal marker!!.';
    const result = applyCvContent(state, content, { bypassPrivacy });
    assert.equal(result.about.text, content.about.text);
    assert.equal(result.about.text.includes('SECRET_CLIENT'), false);
  }
});
