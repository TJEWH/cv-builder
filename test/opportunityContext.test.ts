import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityGroups, opportunityContextMarkdown, opportunityFieldLabel } from '../src/composables/opportunityContext';
import type { OpportunityContextNode } from '../src/composables/opportunityContext';

function flatten(nodes: OpportunityContextNode[]): OpportunityContextNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
}
const fixture = {
  id: 'hidden-id', user_id: 'hidden-account', title: 'Robotics PhD', institution: 'Example University',
  official_url: 'https://example.org/position', application_url: 'https://example.org/apply',
  contacts: [{ name: 'Dr. Example', role: 'scientific_contact', email: 'science@example.org' }],
  supervisors: [{ name: 'Prof. Example', role: 'main_supervisor' }],
  supervisor_research_focus: { 'Prof. Example': { focus_summary: 'Human–robot interaction', keywords: ['Robotics', 'Learning'],
    evidence: ['https://example.org/lab'], checked_at: '2026-09-20T10:00:00Z', limitations: 'Profile may be incomplete.' } },
  supervisor_top_papers: [{ title: 'Robots that learn', year: 2025, venue: 'Example Conference', doi: '10.1234/learning.2025',
    selection_basis: 'Listed on the lab page', why_relevant: 'Matches the advertised project', evidence: ['https://example.org/papers'] }],
  salary: { model: 'TV-L E13', amount: 55000, currency: 'EUR', period: 'annually', details: 'Full-time position' },
  topics: ['Robotics', 'Machine learning'], requirements: ['Relevant MSc', { requirement: 'Programming', details: ['Python', 'C++'] }],
  required_documents: ['CV', { name: 'Motivation letter', details: 'Up to two pages' }],
  personal_fit: { assessment: 'High', reason: 'Experience aligns well' },
  deadline: '2026-10-30', deadline_timezone: 'Europe/Berlin', vacancy_id: 'REF-26',
  data: { additional_research_note: { method: 'Field study', participant_count: 40 } },
};

test('live opportunity shapes are assigned to useful groups and rendered as recursive values', () => {
  const groups = buildOpportunityGroups(fixture, 'en');
  assert.deepEqual(groups.map(({ id }) => id), ['links', 'research', 'salary', 'topics', 'requirements', 'documents', 'metadata']);
  const research = groups.find(({ id }) => id === 'research')!;
  assert.deepEqual(research.items.slice(0, 2).map(({ label }) => label), ['Advisor research focus', 'Representative papers']);
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.ok(nodes.some(({ label, text }) => label === 'Focus summary' && text === 'Human–robot interaction'));
  assert.ok(nodes.some(({ label, text }) => label === 'Year' && text === '2025'), 'years must not get a thousands separator');
  assert.ok(nodes.some(({ label, text }) => label === 'Amount' && text === '55,000'));
  assert.ok(nodes.some(({ label }) => label === 'Programming'));
  assert.ok(nodes.some(({ label }) => label === 'Motivation letter'));
  assert.ok(nodes.some(({ label, text }) => label === 'Participant count' && text === '40'));
  assert.ok(nodes.some(({ text }) => text === 'Scientific contact'));
  assert.equal(nodes.some(({ text }) => text?.includes('hidden-id') || text?.includes('hidden-account')), false);
  assert.equal(nodes.some(({ text }) => text?.startsWith('{') || text?.startsWith('[')), false, 'objects and arrays must never become JSON text');
});

test('unrecorded advisor research is explicitly identified without inventing facts', () => {
  const groups = buildOpportunityGroups({ supervisor_research_focus: {}, supervisor_top_papers: [] }, 'en');
  const research = groups.find(({ id }) => id === 'research')!;
  assert.deepEqual(research.items.map(({ text, missing }) => [text, missing]), [
    ['Advisor research focus not recorded.', true], ['Representative papers not recorded.', true],
  ]);
  const nested = buildOpportunityGroups({ supervisor_research_focus: {}, data: { supervisor_research_focus: { summary: 'Recorded in research dataset' } } }, 'en');
  const nodes = flatten(nested.flatMap(({ items }) => items));
  assert.equal(nodes.some(({ text }) => text === 'Advisor research focus not recorded.'), false);
  assert.equal(nodes.filter(({ text }) => text === 'Recorded in research dataset').length, 1);
});

test('safe web, email and DOI links work while dangerous or injected links remain plain text', () => {
  const groups = buildOpportunityGroups({ contacts: [
    { email: 'alice@example.org' }, { email: 'alice@example.org?bcc=other@example.org' },
  ], source_url: 'javascript:alert(1)', application_url: 'https://user:secret@example.org',
  sources: [{ title: '<img src=x onerror=alert(1)>', url: 'https://example.org/?q=test' }],
  supervisor_top_papers: [{ title: 'Paper', doi: '10.1234/example-paper' }],
  data: { broken_url: 'java\nscript:alert(1)' } }, 'en');
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.deepEqual(nodes.flatMap(({ href }) => href ? [href] : []).sort(), [
    'https://doi.org/10.1234/example-paper', 'https://example.org/?q=test', 'mailto:alice@example.org',
  ].sort());
  assert.ok(nodes.some(({ label }) => label === '<img src=x onerror=alert(1)>'), 'UI must receive text nodes for Vue escaping');
});

test('duplicate research wrappers do not repeat fields, while extra details and false/zero remain visible', () => {
  const groups = buildOpportunityGroups({ institution: 'Example', data: { university: 'Example',
    salary: { amount: 0 }, personal_fit: { matches: false }, extra: null, empty: [] },
  salary: { details: 'Grant pending' } }, 'en');
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.equal(nodes.filter(({ text }) => text === 'Example').length, 1);
  assert.ok(nodes.some(({ text }) => text === '0'));
  assert.ok(nodes.some(({ text }) => text === 'No'));
  assert.ok(nodes.some(({ text }) => text === 'Grant pending'));
  assert.equal(nodes.some(({ label }) => label === 'Empty'), false);
});

test('Markdown export is readable grouped context with safe links and no executable HTML', () => {
  const text = opportunityContextMarkdown({ ...fixture, title: '<script>bad()</script> **Robotics**',
    requirements: ['[click](javascript:alert(1))', 'Line one\n# Unexpected heading'] }, 'en');
  assert.match(text, /## Research context/);
  assert.match(text, /\*\*Relevance to the opportunity:\*\* Matches the advertised project/);
  assert.match(text, /\*\*Amount:\*\* 55,000/);
  assert.match(text, /\[10\.1234\/learning\.2025\]\(<https:\/\/doi.org\/10\.1234\/learning\.2025>\)/);
  assert.match(text, /&lt;script&gt;/);
  assert.equal(text.includes('<script>'), false);
  assert.equal(text.includes('[click](javascript:'), false);
  assert.equal(text.includes('\n# Unexpected heading'), false);
  assert.equal(text.includes('hidden-id'), false);
  assert.equal(text.includes('"focus_summary"'), false);
});

test('German labels translate nested known fields and preserve unknown human-readable labels', () => {
  const groups = buildOpportunityGroups(fixture, 'de');
  assert.ok(groups.some(({ label }) => label === 'Bewerbungsunterlagen'));
  assert.ok(flatten(groups.flatMap(({ items }) => items)).some(({ label, text }) => label === 'Betrag' && text === '55.000'));
  assert.equal(opportunityFieldLabel('selection_basis', 'de'), 'Auswahlgrundlage');
  assert.equal(opportunityFieldLabel('labWebsiteUrl', 'en'), 'Lab Website URL');
});

test('unexpected cyclic values and unsupported values cannot break context rendering', () => {
  const data: Record<string, unknown> = { notes: 'Retained note', irrelevant: undefined, count: NaN };
  data.data = data;
  data.references = { self: data };
  const groups = buildOpportunityGroups({ data }, 'en');
  assert.ok(flatten(groups.flatMap(({ items }) => items)).some(({ text }) => text === 'Retained note'));
});
