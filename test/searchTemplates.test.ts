import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudTemplate } from '../src/searchTypes';
import { createSearchProfile, createSearchTemplate, createSearchTemplateRepository, DEFAULT_SEARCH_TEMPLATES, readSearchTemplate, searchTemplateContentKey } from '../src/composables/useSearchTemplates';
import { buildDailySearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt, isSearchTemplatePublished, searchProfileLetterContext } from '../src/composables/searchPrompts';
import { importCloudSearchTemplate, publishSearchTemplate, searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/composables/searchTemplateCloud';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
function template() { return clone(DEFAULT_SEARCH_TEMPLATES[0]!); }
const owner = '11111111-1111-4111-8111-111111111111';
const cloudId = '22222222-2222-4222-8222-222222222222';

test('the single meta search isolates account storage, clones values and resets without creating an empty library', () => {
  const storage = memory(); const first = createSearchTemplateRepository(storage, owner); const second = createSearchTemplateRepository(storage, 'another-owner');
  const initial = first.listTemplates()[0]!; initial.userPrompt = 'My own search'; first.saveTemplate(initial);
  assert.notEqual(second.listTemplates()[0]!.userPrompt, initial.userPrompt);
  initial.userPrompt = 'Changed after save'; assert.notEqual(first.listTemplates()[0]!.userPrompt, initial.userPrompt);
  first.deleteTemplate(initial.id); assert.deepEqual(first.listTemplates(), DEFAULT_SEARCH_TEMPLATES);
});

test('search commits save only changed snapshots and merge nonconflicting edits across tabs', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner);
  const baseline = repository.listTemplates()[0]!;
  const latest = repository.saveTemplate({ ...baseline, userPrompt: 'Another tab’s strategy' }, baseline);
  const saved = repository.saveTemplate({ ...baseline, professionalContext: 'Confirmed measurement experience.' }, baseline);
  assert.equal(saved.userPrompt, latest.userPrompt); assert.equal(saved.professionalContext, 'Confirmed measurement experience.');
  assert.equal(saved.revision, latest.revision + 1);
  assert.deepEqual(repository.saveTemplate(saved, saved), saved, 'identical commits must not advance revisions');
  assert.throws(() => repository.saveTemplate({ ...baseline, userPrompt: 'Conflicting strategy' }, baseline), /another tab/);
});

test('failed storage writes preserve the previous persisted snapshot and caller draft', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner); const baseline = repository.saveTemplate(template());
  const draft = { ...baseline, userPrompt: 'Keep my unsaved strategy.' };
  storage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => repository.saveTemplate(draft, baseline), /Storage full/);
  assert.equal(draft.userPrompt, 'Keep my unsaved strategy.'); assert.equal(repository.listTemplates()[0]!.userPrompt, baseline.userPrompt);
});

test('import restores the single search while preserving only its own existing schedule reference', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner);
  const original = template(); original.cloud = { id: cloudId, revision: 4, contentKey: searchTemplateContentKey(original) };
  repository.saveTemplate(original);
  const backup = JSON.parse(repository.exportTemplates());
  backup.templates[0].name = 'Restored research direction';
  backup.templates[0].cloud.id = '33333333-3333-4333-8333-333333333333';
  const restored = repository.importTemplates(JSON.stringify(backup));
  assert.equal(restored.length, 1); assert.equal(restored[0]!.id, original.id);
  assert.deepEqual(restored[0]!.cloud, original.cloud, 'an imported account or task reference must never replace the existing local binding');
  assert.equal(restored[0]!.name, 'Restored research direction');
  assert.equal(isSearchTemplatePublished(restored[0]!), false);
  assert.equal(repository.listTemplates().length, 1);
});

test('legacy multiple searches become profiles in one search and retain a raw recovery backup on save', () => {
  const storage = memory();
  const original = template();
  const alternative = createSearchTemplate('BCI direction', 'Europe/Tirane');
  alternative.userPrompt = 'Find applied brain–computer interface roles.';
  alternative.professionalContext = 'Confirmed EEG experiment background.';
  alternative.locationPreferences = 'Prioritize Japan.';
  const raw = JSON.stringify([original, alternative]);
  const key = `cv.search-templates.v1:${encodeURIComponent(owner)}`;
  storage.setItem(key, raw);
  const repository = createSearchTemplateRepository(storage, owner);
  const merged = repository.listTemplates()[0]!;
  assert.equal(repository.listTemplates().length, 1);
  assert.equal(merged.id, original.id);
  assert.equal(merged.profiles.length, 2);
  assert.ok(merged.profiles[1]!.userPrompt.includes(alternative.userPrompt));
  assert.ok(merged.profiles[1]!.userPrompt.includes('Prioritize Japan'));
  assert.equal(merged.profiles[1]!.professionalContext, alternative.professionalContext);
  assert.equal(storage.getItem(key), raw, 'reading does not modify existing private records');
  repository.saveTemplate({ ...merged, name: 'My research' }, merged);
  assert.equal(JSON.parse(storage.getItem(key)!).length, 1);
  assert.equal(storage.getItem(`${key}:legacy-library`), raw);
});

test('saving or importing another search never creates a second instance', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner);
  repository.saveTemplate(createSearchTemplate('Restored search'));
  assert.equal(repository.listTemplates().length, 1);
  const backup = { format: 'cv-search-templates', version: 1, templates: [template(), createSearchTemplate('Robotics direction')] };
  repository.importTemplates(JSON.stringify(backup));
  assert.equal(repository.listTemplates().length, 1);
  assert.equal(repository.listTemplates()[0]!.profiles.length, 2);
});

test('search template validation rejects ambiguous identities, oversized fields and invalid schedules', () => {
  const original = template();
  for (const invalid of [
    { ...original, dailyTime: '24:00' }, { ...original, timezone: 'Somewhere/Invalid' },
    { ...original, professionalContext: 'x'.repeat(12001) }, { ...original, userPrompt: 'unsafe\0text' },
    { ...original, profiles: [original.profiles[0], original.profiles[0]] },
  ]) assert.throws(() => readSearchTemplate(invalid));
  const created = createSearchTemplate('My meta search', 'Europe/Tirane');
  assert.equal(readSearchTemplate(created).name, 'My meta search'); assert.equal(created.dailyTime, '09:00');
  const { locationPreferences: _locations, ...legacy } = created;
  assert.equal(readSearchTemplate(legacy).locationPreferences, '', 'older local templates retain an unrestricted location field');
});

test('default search combines flexible professional interests with the latest geography and funding intent', () => {
  const original = template();
  assert.equal(original.profiles.length, 1);
  for (const topic of ['physical sensing', 'machine listening', 'robot audition', 'multisensor fusion', 'embodied AI', 'edge AI', 'brain–computer', 'audio interfaces', 'vocal biomarkers']) assert.ok(original.profiles[0]!.researchInterests.includes(topic), topic);
  for (const place of ['Scandinavia', 'Germany', 'United Kingdom', 'Japan', 'Australia', 'New Zealand', 'Southeast Asia', 'English or German']) assert.ok(original.locationPreferences.includes(place), place);
  assert.ok(original.profiles[0]!.userPrompt.includes('Do not require every topic'));
  assert.ok(original.userPrompt.includes('early 2027'));
  assert.ok(original.userPrompt.includes('Industrial PhDs'));
  assert.equal(searchTemplateCloudCriteria(original).locationsAndLanguages, original.locationPreferences);
});

test('letter context combines only shared and explicitly selected professional material', () => {
  const original = { ...template(), professionalContext: 'Confirmed engineering background.', researchInterests: 'Acoustic measurements.' };
  original.profiles[0] = { ...original.profiles[0]!, enabled: false, professionalContext: 'Confirmed sensor experiments.', researchInterests: 'Robot audition.', userPrompt: 'This is search strategy, not letter evidence.' };
  assert.deepEqual(searchProfileLetterContext(original), { professionalContext: original.professionalContext, researchInterests: original.researchInterests });
  assert.deepEqual(searchProfileLetterContext(original, original.profiles[0]!.id), {
    professionalContext: 'Confirmed engineering background.\n\nConfirmed sensor experiments.', researchInterests: 'Acoustic measurements.\n\nRobot audition.',
  });
  assert.throws(() => searchProfileLetterContext(original, 'deleted-profile'), /no longer available/);
});

test('system prompt preserves dynamic protocol, receipts, access limits, numeric scores and deadline rules', () => {
  const system = buildSearchSystemPrompt(template());
  for (const required of ['bootstrap_version=1', 'compatible=true', 'protocol_text', 'result_schema', 'private.begin_opportunity_search', 'separate call', '72 hours', '00:00', 'rolling', 'scale_min=0', 'scale_max=10', 'user reviews', 'permission', 'Stay quiet']) assert.ok(system.includes(required), required);
  assert.ok(system.includes('without inventing a stored deadline time'));
  assert.ok(!system.includes('private.submit_opportunity_search_result('), 'installed protocol owns result submission signatures');
});

test('English editable user prompts include enabled profiles, excluding disabled private context', () => {
  const original = template(); original.profiles.push({ ...createSearchProfile('Hidden profile'), enabled: false, professionalContext: 'PRIVATE DISABLED CONTEXT' });
  const user = buildSearchUserPrompt(original); const criteria = searchTemplateCloudCriteria(original);
  assert.ok(user.includes('Acoustic and physical sensing')); assert.ok(user.includes('A match to any enabled profile'));
  assert.ok(!user.includes('PRIVATE DISABLED CONTEXT')); assert.ok(!JSON.stringify(criteria).includes('PRIVATE DISABLED CONTEXT'));
  original.profiles.forEach(profile => { profile.enabled = false; });
  assert.throws(() => searchTemplateCloudCriteria(original), /Enable at least one/);
});

test('separately copied system and user prompts bind the exact published search or block execution', () => {
  const original = template();
  for (const prompt of [buildSearchSystemPrompt(original), buildSearchUserPrompt(original)]) {
    assert.ok(prompt.includes('EXECUTION NOT READY'));
    assert.ok(prompt.includes('Publish the current template'));
    assert.ok(prompt.includes('Do not guess a UUID'));
  }
  original.cloud = { id: cloudId, revision: 1, contentKey: searchTemplateContentKey(original) };
  for (const prompt of [buildSearchSystemPrompt(original), buildSearchUserPrompt(original)]) {
    assert.ok(prompt.includes('EXECUTION BINDING'));
    assert.ok(prompt.includes('ehkfzvjgesomteqpwrwa'));
    assert.ok(prompt.includes(`private.begin_opportunity_search('${cloudId}'::uuid`));
    assert.ok(prompt.includes('current run.definition.criteria'));
    assert.ok(prompt.includes('Never guess another search identity'));
  }
  original.userPrompt += ' Unpublished change.';
  assert.ok(buildSearchUserPrompt(original).includes('EXECUTION NOT READY'));
  assert.ok(buildSearchSystemPrompt(original).includes('EXECUTION NOT READY'));
});

test('published criteria fit existing whitelist and preserve full context without silent truncation', () => {
  const original = { ...template(), professionalContext: 'My confirmed projects.', researchInterests: 'Sensor fusion.' };
  const criteria = searchTemplateCloudCriteria(original);
  assert.deepEqual(Object.keys(criteria).sort(), ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'].sort());
  assert.ok(criteria.fitAndExclusions.includes('My confirmed projects.'));
  const oversized = { ...original, professionalContext: 'x'.repeat(12000), profiles: [{ ...original.profiles[0]!, professionalContext: 'x'.repeat(12000) }] };
  assert.throws(() => searchTemplateCloudCriteria(oversized), /Shorten it before publishing/);
});

test('daily prompt requires current explicit publication and uses dynamic bootstrap for every recurrence', () => {
  const original = template(); assert.throws(() => buildDailySearchPrompt(original), /Publish the current/);
  original.cloud = { id: cloudId, revision: 1, contentKey: searchTemplateContentKey(original) };
  assert.equal(isSearchTemplatePublished(original), true);
  const prompt = buildDailySearchPrompt(original);
  for (const required of [cloudId, '09:00', 'Europe/Tirane', 'claim_opportunity_search_schedule', 'confirm_opportunity_search_schedule', 'claimed=true', 'schedule_binding', 'existing task', 'current user prompt', 'without the corresponding successful tool receipt']) assert.ok(prompt.includes(required), required);
  assert.ok(!prompt.includes(original.profiles[0]!.userPrompt), 'recurring tasks must read saved criteria rather than stale strategy snapshots');
  original.userPrompt += ' New preference.'; assert.equal(isSearchTemplatePublished(original), false);
  assert.throws(() => buildDailySearchPrompt(original), /Publish the current/);
});

test('cloud imports preserve profile context and flag legacy schedule conversion until explicit publication', () => {
  const original = template();
  const row: SearchCloudTemplate = { id: cloudId, user_id: owner, name: original.name, criteria: searchTemplateCloudCriteria(original), schedule: searchTemplateCloudSchedule(original), revision: 8, created_at: original.updatedAt, updated_at: original.updatedAt };
  const imported = importCloudSearchTemplate(row);
  assert.deepEqual(imported.profiles, original.profiles); assert.equal(isSearchTemplatePublished(imported), true);
  const legacy = importCloudSearchTemplate({ ...row, criteria: { ...row.criteria, fitAndExclusions: 'Strong technical fit.' }, schedule: { ...row.schedule, frequency: 'weekly', weekdays: [1] } });
  assert.equal(legacy.dailyTime, row.schedule.time); assert.equal(legacy.timezone, row.schedule.timezone);
  assert.ok(legacy.profiles[0]!.userPrompt.includes('Strong technical fit.')); assert.equal(isSearchTemplatePublished(legacy), false);
  const oldContract = importCloudSearchTemplate({ ...row, criteria: { ...row.criteria, fundingAndConditions: 'Report with 48 hours remaining.' } });
  assert.equal(isSearchTemplatePublished(oldContract), false, 'an older fixed deadline rule requires explicit republication');
});

test('cloud publication verifies owner and separate read-back and uses a stable identity on retries', async () => {
  const original = template(); const savedIds: string[] = []; let saved: SearchCloudTemplate | null = null;
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      savedIds.push(String(args.p_id));
      saved = { id: String(args.p_id), user_id: owner, name: String(args.p_name), criteria: args.p_criteria as SearchCloudTemplate['criteria'], schedule: args.p_schedule as SearchCloudTemplate['schedule'], revision: 1, created_at: original.updatedAt, updated_at: original.updatedAt };
      return { data: saved, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved, error: null }), single: async () => ({ data: saved, error: null }) }) }) }) }),
  } as unknown as SupabaseClient;
  const first = await publishSearchTemplate(client, owner, original); const retry = await publishSearchTemplate(client, owner, original);
  assert.equal(savedIds.length, 1, 'an exact next-revision retry recovers the verified saved row without writing again');
  assert.equal(savedIds[0], retry.cloud!.id); assert.equal(isSearchTemplatePublished(first), true); assert.deepEqual(first.cloud, retry.cloud);
});

test('cloud publication never marks an unverified or other-owner response as published', async () => {
  const original = template();
  const invalidClient = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    rpc: async () => ({ data: { id: cloudId, user_id: 'other', revision: 1 }, error: null }) } as unknown as SupabaseClient;
  await assert.rejects(publishSearchTemplate(invalidClient, owner, original), /signed-in owner/);
  assert.equal(original.cloud, undefined);
});

test('cloud retries recover a successful write after failed verification without another save or revision', async () => {
  const original = template(); let saved: SearchCloudTemplate | null = null; let writes = 0; let verificationFails = true;
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      writes++;
      saved = { id: String(args.p_id), user_id: owner, name: String(args.p_name), criteria: args.p_criteria as SearchCloudTemplate['criteria'], schedule: args.p_schedule as SearchCloudTemplate['schedule'], revision: 1, created_at: original.updatedAt, updated_at: original.updatedAt };
      return { data: saved, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: saved, error: null }),
      single: async () => ({ data: verificationFails ? null : saved, error: verificationFails ? new Error('Read-back connection lost') : null }),
    }) }) }) }),
  } as unknown as SupabaseClient;
  await assert.rejects(publishSearchTemplate(client, owner, original), /connection lost/);
  assert.equal(original.cloud, undefined);
  verificationFails = false;
  const recovered = await publishSearchTemplate(client, owner, original);
  assert.equal(writes, 1); assert.equal(recovered.cloud!.revision, 1); assert.equal(isSearchTemplatePublished(recovered), true);
});

test('cloud retry recovery rejects different content and revisions beyond the exact intended next revision', async () => {
  const original = template(); original.cloud = { id: cloudId, revision: 4, contentKey: '' };
  let saved: SearchCloudTemplate = { id: cloudId, user_id: owner, name: original.name, criteria: searchTemplateCloudCriteria(original), schedule: searchTemplateCloudSchedule(original), revision: 6, created_at: original.updatedAt, updated_at: original.updatedAt };
  let writes = 0;
  const client = {
    rpc: async () => { writes++; return { data: null, error: null }; },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) }) }) }),
  } as unknown as SupabaseClient;
  await assert.rejects(publishSearchTemplate(client, owner, original), /changed elsewhere/);
  saved = { ...saved, revision: 5, criteria: { ...saved.criteria, researchAndReporting: 'Another tab’s strategy' } };
  await assert.rejects(publishSearchTemplate(client, owner, original), /changed elsewhere/);
  assert.equal(writes, 0); assert.equal(original.cloud.revision, 4);
});
