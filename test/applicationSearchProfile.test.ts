import assert from 'node:assert/strict';
import test from 'node:test';
import type { LetterTemplate } from '../src/letterTypes';
import { createSearchTemplate, createSearchTemplateRepository } from '../src/composables/useSearchTemplates';
import { idle, mount, prepare, type Workspace } from './refinementWorkflowHarness';

type ProfileWorkspace = Workspace & {
  selectSearchProfile(id: string): Promise<void>;
  reloadSearchTemplates(): void;
  selectedSearchProfileId: string;
  effectiveLetterTemplate: LetterTemplate;
};
function seedProfile(fixture: ReturnType<typeof mount>, enabled = true) {
  const repository = createSearchTemplateRepository(fixture.storage, fixture.props.userId);
  const template = createSearchTemplate('Robotics opportunities');
  template.professionalContext = 'Confirmed experience with sensor analysis.';
  template.researchInterests = 'Reliable and reproducible research.';
  template.profiles[0]!.name = 'Robot perception';
  template.profiles[0]!.enabled = enabled;
  template.profiles[0]!.researchInterests = 'Learning robot perception.';
  const saved = repository.saveTemplate(template);
  const setup = fixture.setup as ProfileWorkspace;
  setup.reloadSearchTemplates();
  return { repository, saved, id: JSON.stringify([saved.id, saved.profiles[0]!.id]) };
}

test('selecting reusable profile context is local, explicit and frozen through reopening', async t => {
  const fixture = mount(t);
  const setup = fixture.setup as ProfileWorkspace;
  await idle(setup);
  const { repository, saved, id } = seedProfile(fixture, false);
  const beforeCloud = JSON.stringify(fixture.database);
  setup.updateLetter('My existing manual letter.');
  await setup.selectSearchProfile(id);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.searchProfile?.templateId, saved.id);
  assert.equal(saved.profiles[0]!.enabled, false, 'profiles remain reusable when paused for searches');
  assert.match(setup.effectiveLetterTemplate.structure, /Learning robot perception/);
  assert.equal(setup.letter!.working.body, 'My existing manual letter.');
  assert.equal(JSON.stringify(fixture.database), beforeCloud, 'selecting private context does not publish sources or upload a CV');

  repository.saveTemplate({ ...saved, professionalContext: 'Later library edits.' });
  setup.reloadSearchTemplates();
  assert.match(setup.letter!.searchProfile!.professionalContext, /Confirmed experience/);
  assert.equal(setup.selectedSearchProfileId, 'saved');
  const reopened = fixture.reopen() as ProfileWorkspace;
  await idle(reopened);
  assert.match(reopened.letter!.searchProfile!.professionalContext, /Confirmed experience/);
  assert.equal(reopened.letter!.working.body, 'My existing manual letter.');
  await reopened.selectSearchProfile('');
  assert.equal(reopened.letter!.searchProfile, undefined);
  assert.equal(reopened.letter!.working.body, 'My existing manual letter.');
});

test('a newly discovered letter proposal prevents replacing its selected professional context', async t => {
  const fixture = mount(t);
  const setup = await prepare(fixture, 'base', { scope: 'letter' }) as ProfileWorkspace;
  const { id } = seedProfile(fixture);
  fixture.cloud.seedProposal(setup.requests[0]!.id);
  await setup.selectSearchProfile(id);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(setup.proposals.length, 1, 'selection refreshes the remote history before replacing its source');
});

test('oversized profile reuse reports the contract limit and keeps the previous letter context', async t => {
  const fixture = mount(t);
  const setup = fixture.setup as ProfileWorkspace;
  await idle(setup);
  const { repository, saved, id } = seedProfile(fixture);
  saved.professionalContext = 'a'.repeat(12000);
  saved.profiles[0]!.professionalContext = 'b'.repeat(12000);
  repository.saveTemplate(saved);
  setup.reloadSearchTemplates();
  await setup.selectSearchProfile(id);
  assert.match(setup.error, /20,000-character refinement limit/);
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(setup.saveError, '');
});

test('publishing and clearing letter refinement preserves its selected profile without duplicating context', async t => {
  const fixture = mount(t);
  const setup = fixture.setup as ProfileWorkspace;
  await idle(setup);
  const { id } = seedProfile(fixture);
  await setup.selectSearchProfile(id);
  const captured = JSON.parse(JSON.stringify(setup.letter!.searchProfile));
  await prepare(fixture, 'base', { scope: 'letter' });
  assert.match(setup.requests[0]!.request_json.letter.template.structure, /Learning robot perception/);
  fixture.cloud.seedProposal(setup.requests[0]!.id);
  await setup.syncRefinement();
  await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  assert.deepEqual(setup.letter!.searchProfile, captured);
  assert.equal(setup.letter!.working.body, '');
  assert.equal((setup.effectiveLetterTemplate.structure.match(/Reusable search-profile context/g) || []).length, 1);
  assert.equal(setup.letter!.templateSnapshot!.structure.includes('Reusable search-profile context'), false);
});
