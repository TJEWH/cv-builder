import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { legacyCoverage } from './opportunitySearch/legacyCoverage';
import { buildOpportunitySearchSetupPrompt, resolveSearchEnvironment, opportunitySearchSql, SEARCH_RECOVERY_INSTRUCTION, OPPORTUNITY_RESULT_SCHEMA, OPPORTUNITY_SEARCH_PROTOCOL } from '../src/composables/opportunitySearchProtocol';
import { generateSearchProtocol, sampleSearch, searchProtocolHash } from './opportunitySearch/generate';
import { parseSupabaseConfiguration } from '../src/lib/supabaseConfig';

const environment = { projectRef: 'abcdefghijklmnopqrst', url: 'https://abcdefghijklmnopqrst.supabase.co' };
const readiness = { ready: true, bootstrap_version: 1, protocol_version: 'installed-test-release', protocol_hash: searchProtocolHash };
test('copied search prompt resolves target and schedules only dynamic recurring instructions', () => {
  const prompt = buildOpportunitySearchSetupPrompt({ template: sampleSearch, environment, readiness });
  assert.ok(prompt.includes(environment.projectRef));
  assert.ok(prompt.includes(sampleSearch.id));
  assert.ok(prompt.includes('BEFORE creating or updating'));
  const recurring = prompt.split('\nRECURRING INSTRUCTIONS\n')[1]!;
  assert.ok(recurring.includes('Generate a fresh run UUID'));
  assert.ok(recurring.includes('Never create another schedule'));
  assert.ok(!recurring.includes('Full funding; start around early 2027'));
  assert.ok(!recurring.includes('ONE-TIME SETUP'));
  assert.ok(prompt.includes('Europe/Tirane'));
  assert.equal(prompt.split(SEARCH_RECOVERY_INSTRUCTION).length - 1, 1);
  assert.ok(prompt.includes('exact search marker'));
});
test('existing binding uses actual task ID and requires update, never replacement', () => {
  const prompt = buildOpportunitySearchSetupPrompt({ template: sampleSearch, environment, readiness,
    binding: { search_id: sampleSearch.id, user_id: sampleSearch.userId, task_id: 'task_123', schedule: sampleSearch.schedule,
      template_revision: 1, protocol_version: 'old', confirmed_at: '2026-10-12T00:00:00Z' } });
  assert.ok(prompt.includes('task_123'));
  assert.ok(prompt.includes('do not create a replacement'));
  assert.ok(prompt.includes('Once per run only'));
  assert.ok(prompt.includes('results saved; schedule instructions not updated'));
  assert.ok(prompt.includes('denial stops immediately'));
});
test('copy refuses uninstalled or incompatible protocol and unsaved template', () => {
  assert.throws(() => buildOpportunitySearchSetupPrompt({ template: sampleSearch, environment, readiness: { ...readiness, ready: false } }));
  assert.throws(() => buildOpportunitySearchSetupPrompt({ template: sampleSearch, environment, readiness: { ...readiness, bootstrap_version: 2 } }));
  assert.throws(() => buildOpportunitySearchSetupPrompt({ template: { ...sampleSearch, revision: 0 }, environment, readiness }));
});
test('environment resolution never guesses custom/local domains or leaks keys', () => {
  const config = parseSupabaseConfiguration(environment.url, 'sb_publishable_123456789');
  assert.deepEqual(resolveSearchEnvironment(config), environment);
  assert.throws(() => resolveSearchEnvironment({ status: 'ready', url: 'https://data.example.com', publishableKey: 'secret' }));
  assert.deepEqual(resolveSearchEnvironment({ status: 'ready', url: 'https://data.example.com', publishableKey: 'secret', projectRef: environment.projectRef }),
    { projectRef: environment.projectRef, url: 'https://data.example.com' });
  assert.throws(() => resolveSearchEnvironment({ status: 'ready', url: environment.url, publishableKey: 'secret', projectRef: 'zyxwvutsrqponmlkjihg' }));
  assert.throws(() => resolveSearchEnvironment({ status: 'ready', url: 'http://localhost:54321', publishableKey: 'secret', projectRef: environment.projectRef }));
});
test('SQL builder quotes arbitrary evidence safely and validates UUIDs', () => {
  const payload = JSON.stringify({ title: "O'Brien\\Lab", notes: '日本語\nquoted' });
  const sql = opportunitySearchSql('submit', [sampleSearch.id, sampleSearch.id, payload]);
  assert.ok(sql.includes("O''Brien"));
  assert.ok(sql.includes('\\\\\\\\Lab'));
  assert.ok(sql.endsWith('::jsonb) AS result;'));
  assert.throws(() => opportunitySearchSql('begin', ['not-a-uuid', sampleSearch.id]));
  assert.throws(() => opportunitySearchSql('begin', [sampleSearch.id]));
  assert.throws(() => opportunitySearchSql('queries', [sampleSearch.id, '\0']));
});
test('result contract covers factual research, evidence and assessments without retired fields', () => {
  const fields = OPPORTUNITY_RESULT_SCHEMA.properties;
  for (const key of ['research_summary','data','sources','personal_fit','deadline_timezone','supervisors','contacts']) assert.ok(key in fields);
  for (const key of ['cv_track','duration_months','historical_match_status']) assert.ok(!(key in fields));
  assert.equal(fields.personal_fit.properties.score.maximum, 10);
});
test('generated database seed, schema and prompt fixtures stay synchronized', () => generateSearchProtocol(true));


test('every legacy prompt paragraph, factual field and retired-field exclusion has maintained coverage', () => {
  const paragraphs = readFileSync(new URL('./opportunitySearch/legacy-prompt.txt', import.meta.url), 'utf8').split('\n\n');
  assert.deepEqual(legacyCoverage.map(row => row.paragraph), paragraphs.map((_, index) => index));
  for (const row of legacyCoverage) {
    assert.ok(row.treatment);
    for (const phrase of row.protocol) assert.ok(OPPORTUNITY_SEARCH_PROTOCOL.includes(phrase), `Legacy paragraph ${row.paragraph}: ${phrase}`);
    for (const path of row.verification) assert.ok(existsSync(new URL('../' + path, import.meta.url)), path);
  }
  const fields = paragraphs[4].split(': ')[1]!.split('.')[0]!.replace(' und ', ', ').split(', ');
  for (const field of fields) assert.ok(field in OPPORTUNITY_RESULT_SCHEMA.properties, field);
  assert.equal(fields.length, 38);
  for (const field of ['cv_track', 'duration_months', 'historical_match_status']) assert.ok(!(field in OPPORTUNITY_RESULT_SCHEMA.properties));
});

test('all saved template variants bootstrap one shared assessment contract despite conflicting criteria', () => {
  for (const name of ['Blank template completed', 'Research starter', 'Duplicated search', 'Existing search']) {
    const prompt = buildOpportunitySearchSetupPrompt({ template: { ...sampleSearch, name,
      criteria: { ...sampleSearch.criteria, researchAndReporting: 'Use very good or a 1–5 rating.' } }, environment, readiness });
    assert.ok(prompt.includes('follow protocol.protocol_text and result_schema'));
    assert.ok(prompt.includes('Do not cache a protocol, schema, query list or criteria snapshot'));
    assert.ok(prompt.includes('saved database definition is authoritative'));
  }
  assert.ok(OPPORTUNITY_SEARCH_PROTOCOL.includes('scale requirements override conflicting editable search guidance'));
  for (const field of ['personal_fit', 'rd_career_potential', 'research_career_potential'] as const) {
    const assessment = OPPORTUNITY_RESULT_SCHEMA.properties[field];
    assert.deepEqual(assessment.required, ['score', 'scale_min', 'scale_max', 'summary']);
    assert.equal(assessment.properties.scale_min.const, 0);
    assert.equal(assessment.properties.scale_max.const, 10);
  }
});

test('the generated contract uses only vocabulary enforced by the database validator', () => {
  const supported = new Set(['type', 'properties', 'additionalProperties', 'required', 'anyOf', 'const', 'enum',
    'items', 'minItems', 'minProperties', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format']);
  function check(schema: unknown) {
    if (typeof schema === 'boolean') return;
    assert.ok(schema && typeof schema === 'object');
    const node = schema as Record<string, unknown>;
    for (const key of Object.keys(node)) assert.ok(supported.has(key), `SQL validator does not implement ${key}`);
    if (node.format) assert.ok(['date', 'date-time', 'opportunity-timezone'].includes(String(node.format)));
    if (node.properties) Object.values(node.properties as object).forEach(check);
    if (node.anyOf) (node.anyOf as unknown[]).forEach(check);
    for (const key of ['items', 'additionalProperties']) if (key in node) check(node[key]);
  }
  check(OPPORTUNITY_RESULT_SCHEMA);
});

test('the shared protocol preserves historical structures, imprecise provenance and uncertain scales', () => {
  for (const phrase of ['never flatten away conditions', 'mailto application_url', 'Only vacancy-specific URLs',
    'unmapped_supports', 'never invent midnight', 'Missing historical sources remain missing',
    'supervisor_research_focus', 'supervisor_top_papers', 'omit them from partial submissions']) {
    assert.ok(OPPORTUNITY_SEARCH_PROTOCOL.includes(phrase), phrase);
  }
  assert.ok('anyOf' in OPPORTUNITY_RESULT_SCHEMA.properties.requirements);
  assert.ok('supervisor_top_papers' in OPPORTUNITY_RESULT_SCHEMA.properties);
});
