import type { TestContext } from 'node:test';
import type { CvState, LegacyCvState, SaveStatus } from '../src/types';
import { stub } from './helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, nextTick, reactive, ref, watch } from 'vue';
import { normalizeContentState } from '../src/composables/contentLayout.ts';
import { useSectionVersions } from '../src/composables/useSectionVersions.ts';

function fixture(t: TestContext) {
  const makeVersion = (name: string, customIds: string[]): CvState => {
    const data = {
      version: 7, contact: { name }, about: { text: name }, completedSections: [],
      experience: { jobs: [{ id: 'job', title: name }] },
      customSections: customIds.map((id) => ({ id, name: `${name} ${id}`, entries: [{ title: name }] })),
      sidebarSections: [{ id: 'skills', name: 'Skills', items: [{ name }] }],
      design: { fontBody: name }, anonymization: { excludedSections: [], excludedItems: [] },
    };
    normalizeContentState(stub<LegacyCvState>(data));
    return stub<CvState>(data);
  };
  const saved = new Map([
    ['one', makeVersion('One', ['shared'])],
    ['two', makeVersion('Two', ['shared', 'extra'])],
    ['three', makeVersion('Three', [])],
  ]);
  const state = reactive(structuredClone(saved.get('one')!));
  const selectedId = ref('one');
  const configurations = ref([...saved.keys()].map((id) => ({ id, name: id })));
  const saves: string[] = [];
  const statuses: SaveStatus[] = [];
  let failSave = false;
  let activeChanges = 0;
  const scope = effectScope();
  const versions = scope.run(() => {
    watch(state, () => { activeChanges += 1; }, { deep: true, flush: 'sync' });
    return useSectionVersions({
      state: () => state, selectedId: () => selectedId.value, configurations: () => configurations.value,
      readVersion: (id) => saved.get(id),
      saveVersion: (id, data) => {
        if (failSave) return false;
        saves.push(id);
        saved.set(id, data);
        return true;
      },
      onStatus: (value) => statuses.push(value),
    });
  });
  t.after(() => scope.stop());
  assert.ok(versions);
  versions.enabled.value = true;
  return { versions, state, saved, saves, statuses, selectedId, configurations,
    fail: (value: boolean) => { failSave = value; }, activeChanges: () => activeChanges };
}

test('section choices use stable IDs and include only versions containing each section', (t) => {
  const { versions } = fixture(t);
  assert.deepEqual(versions.options('jobs').map(({ id }) => id), ['one', 'two', 'three']);
  assert.deepEqual(versions.options('shared').map(({ id }) => id), ['one', 'two']);
  assert.deepEqual(versions.options('extra').map(({ id }) => id), ['two']);
  assert.ok(versions.order('body').includes('extra'));
  versions.select('shared', 'three');
  assert.equal(versions.versionId('shared'), 'one');
  assert.equal(versions.sectionState('extra').customSections[1].name, 'Two extra');
});

test('edits to alternate versions persist together without touching the active CV or switching it', (t) => {
  const { versions, state, saved, saves, selectedId, activeChanges } = fixture(t);
  const original = JSON.stringify(state);
  versions.select('jobs', 'two');
  versions.select('shared', 'two');
  versions.select('skills', 'two');
  versions.sectionState('jobs').experience.jobs = [{ id: 'different-job', title: 'Different story' }];
  versions.sectionState('shared').customSections[0].entries[0].title = 'Different project';
  versions.sectionState('skills').sidebarSections[0].items.push({ id: 'new-skill', name: 'New skill' });
  assert.equal(versions.flush(), true);
  assert.deepEqual(saves, ['two']);
  assert.equal(saved.get('two')!.experience.jobs[0].title, 'Different story');
  assert.equal(saved.get('two')!.customSections[0].entries[0].title, 'Different project');
  assert.equal(saved.get('two')!.sidebarSections[0].items.length, 2);
  assert.equal(saved.get('two')!.design.fontBody, 'Two');
  assert.equal(selectedId.value, 'one');
  assert.equal(JSON.stringify(state), original);
  assert.equal(activeChanges(), 0);
});

test('current-version edits retain live preview reactivity and never write a stale saved snapshot', (t) => {
  const { versions, state, saves, activeChanges } = fixture(t);
  versions.sectionState('about').about.text = 'Live edits';
  assert.equal(state.about.text, 'Live edits');
  assert.ok(activeChanges() > 0);
  versions.flush();
  assert.deepEqual(saves, []);
});

test('switching section versions rapidly retains edits and disabling mode returns to the active CV', (t) => {
  const { versions, state, saved } = fixture(t);
  versions.select('header', 'two');
  versions.sectionState('header').contact.name = 'Updated Two';
  versions.select('header', 'three');
  versions.sectionState('header').contact.name = 'Updated Three';
  versions.select('header', 'two');
  assert.equal(versions.sectionState('header').contact.name, 'Updated Two');
  versions.enabled.value = false;
  assert.equal(versions.sectionState('header'), state);
  assert.equal(saved.get('two')!.contact.name, 'Updated Two');
  assert.equal(saved.get('three')!.contact.name, 'Updated Three');
});

test('failed saves keep their edits for retry and block resetting before a whole-version change', (t) => {
  const { versions, saved, statuses, fail } = fixture(t);
  versions.select('about', 'two');
  versions.sectionState('about').about.text = 'Keep this edit';
  fail(true);
  assert.equal(versions.reset(), false);
  assert.equal(statuses.at(-1), 'error');
  assert.equal(versions.sectionState('about').about.text, 'Keep this edit');
  fail(false);
  assert.equal(versions.reset(), true);
  assert.equal(saved.get('two')!.about.text, 'Keep this edit');
  assert.equal(versions.enabled.value, false);
});

test('deleted versions disappear from choices and draft content remains independently editable', async (t) => {
  const { versions, configurations, selectedId, state } = fixture(t);
  selectedId.value = '';
  assert.ok(versions);
  versions.enabled.value = true;
  assert.equal(versions.options('header')[0].id, '');
  versions.select('shared', 'two');
  configurations.value = configurations.value.filter(({ id }) => id !== 'two');
  await nextTick();
  assert.equal(versions.versionId('shared'), '');
  assert.equal(versions.sectionState('shared'), state);
  assert.equal(versions.order('body').includes('extra'), false);
});
