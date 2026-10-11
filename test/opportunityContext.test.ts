import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityGroups, checklistKeys, opportunityContextMarkdown, opportunityFieldLabel, personalFitScore, requirementTableRows } from '../src/composables/opportunityContext';
import type { OpportunityContextNode } from '../src/composables/opportunityContext';

function flatten(nodes: OpportunityContextNode[]): OpportunityContextNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
}

test('checklist identities survive reordering, object property order and language changes but not changed content', () => {
  const context = { requirements: ['MSc', { requirement: 'Programming', details: ['Python', 'C++'] }], required_documents: ['CV', 'Letter'] };
  const keys = (value: Record<string, unknown>, lang = 'en') => checklistKeys(buildOpportunityGroups(value, lang).flatMap(({ items }) => items)).sort();
  const original = keys(context);
  assert.equal(original.length, 4);
  assert.deepEqual(keys({ ...context, requirements: [{ details: ['Python', 'C++'], requirement: 'Programming' }, 'MSc'], required_documents: ['Letter', 'CV'] }, 'de'), original);
  const changed = keys({ ...context, required_documents: ['CV', 'Letter, maximum one page'] });
  assert.equal(changed.filter((key) => original.includes(key)).length, 3);
  assert.deepEqual(keys({ requirements: [], required_documents: null }), []);
  const nested = keys({ requirements: { mandatory: ['MSc', 'English'], preferred: ['Python'] }, application_documents: ['CV'] });
  assert.equal(nested.length, 4);
  assert.ok(nested.includes(original.find((key) => key.startsWith('documents:required_documents:') && key.endsWith('"CV"'))!));
  const markdown = opportunityContextMarkdown(context, 'en', [original.find((key) => key.endsWith('"CV"'))!]);
  assert.match(markdown, /- \[x\] CV/);
  assert.match(markdown, /- \[ \] Letter/);
});
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
  assert.deepEqual(groups.map(({ id }) => id), ['overview', 'requirements', 'documents', 'salary', 'advisor', 'links', 'metadata']);
  const research = groups.find(({ id }) => id === 'advisor')!;
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
  const research = groups.find(({ id }) => id === 'advisor')!;
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
  assert.match(text, /## Advisor & lab context/);
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

test('duration and research assessments move to their respective groups, including nested data', () => {
  const groups = buildOpportunityGroups({ duration_months: 48, duration_details: 'Renewable contract',
    personal_fit: { gaps: ['Training needed'] }, research_career_potential: 'Academic route', rd_career_potential: 'Industry route',
    particularly_suitable: false, particularly_suitable_reason: 'Requires more experience',
    data: { start_date: '2027-01-01', lab_context: 'Robotics group', hardware_software_balance: 'Mostly software' } }, 'en');
  const texts = (id: string) => flatten(groups.find((group) => group.id === id)?.items || []).map((node) => node.text);
  assert.ok(texts('salary').includes('48'));
  assert.ok(texts('salary').includes('Renewable contract'));
  assert.ok(texts('salary').includes('1 Jan 2027'));
  assert.ok(texts('overview').includes('Training needed'));
  assert.equal(texts('overview').includes('Mostly software'), false);
  assert.ok(texts('overview').includes('Academic route'));
  assert.ok(texts('overview').includes('Industry route'));
  assert.deepEqual(texts('suitability'), ['No', 'Requires more experience', 'Mostly software']);
  assert.ok(texts('advisor').includes('Robotics group'));
  assert.equal(texts('metadata').includes('48'), false);
});

test('requirement rows retain content and checklist identities while separating explicit required/optional flags', () => {
  const requirements = { required: ['Relevant MSc'], optional: [
    { requirement: 'Programming', required: true, details: ['Python', 'C++'], url: 'https://example.org/requirements' },
    { requirement: 'German', required: false },
    { requirement: 'Portfolio', optional: true },
  ], other: ['Unclassified item'] };
  for (const lang of ['en', 'de']) {
    const node = buildOpportunityGroups({ requirements }, lang).find(group => group.id === 'requirements')!.items[0];
    const snapshot = structuredClone(node);
    const rows = requirementTableRows(node);
    assert.deepEqual(rows.map(row => row.requirementStatus), ['required', 'required', 'optional', 'optional', undefined]);
    assert.deepEqual(rows.map(row => row.checklistKey), checklistKeys([node]));
    assert.equal(rows[1].label, 'Programming');
    assert.ok(flatten(rows[1].children || []).some(child => child.text === 'C++'));
    assert.ok(rows[1].children?.some(child => child.href === 'https://example.org/requirements'));
    assert.equal(rows[1].children?.some(child => child.id.endsWith('.required')), false);
    assert.equal(rows[2].children?.length, 0);
    assert.deepEqual(node, snapshot, 'the table projection must not alter the source or export');
  }
  const node = buildOpportunityGroups({ requirements: [{ requirement: 'Conflicting flags', required: true, optional: true }] }, 'en')
    .find(group => group.id === 'requirements')!.items[0];
  const [row] = requirementTableRows(node);
  assert.equal(row.requirementStatus, undefined);
  assert.equal(row.children?.length, 2, 'conflicting source flags remain visible');
});

test('item/category records and document statuses produce item rows with their original checklist keys', () => {
  const context = {
    requirements: [{ item: 'Degree', category: 'required' }, { item: 'Robotics', category: 'beneficial' }, { item: 'German', required: false, beneficial: true }],
    required_documents: ['CV', { item: 'Portfolio', status: 'optional' }],
    desired_skills: { preferred: ['Python'], recommended: ['C++'] },
  };
  const groups = buildOpportunityGroups(context, 'en');
  const requirementGroup = groups.find(group => group.id === 'requirements')!;
  const rows = requirementGroup.items.flatMap(requirementTableRows);
  assert.deepEqual(rows.map(row => row.requirementStatus), ['required', 'beneficial', 'beneficial', 'preferred', 'recommended']);
  assert.deepEqual(rows.slice(0, 3).map(row => row.label), ['Degree', 'Robotics', 'German']);
  assert.ok(rows.slice(0, 3).every(row => !row.children?.length));
  assert.equal(rows[1].checklistKey, 'requirements:requirements:{"category":"beneficial","item":"Robotics"}');
  const documents = groups.find(group => group.id === 'documents')!;
  assert.deepEqual(documents.items.flatMap(requirementTableRows).map(row => row.requirementStatus), ['required', 'optional']);
  assert.deepEqual(checklistKeys(documents.items), documents.items.flatMap(requirementTableRows).map(row => row.checklistKey));
  const unspecified = buildOpportunityGroups({ application_documents: ['CV'] }, 'en').find(group => group.id === 'documents')!;
  assert.equal(requirementTableRows(unspecified.items[0])[0].requirementStatus, undefined, 'generic document fields do not imply a required status');
});

test('repeated source URLs merge evidence without losing distinct links, contact details or metadata', () => {
  const context = {
    official_url: 'https://example.org/job', application_url: 'https://example.org/job',
    sources: [
      { url: 'https://example.org/job', supports: ['Salary'], checked_at: '2026-09-20' },
      { url: 'https://example.org/job', supports: ['Requirements', 'Salary'], notes: 'Official source' },
      { url: 'https://example.org/job?language=de', supports: ['German wording'] },
      { description: 'Archived source without URL' },
    ],
    contacts: [{ name: 'Dr. Example', email: 'science@example.org', role: 'scientific_contact', website: 'https://example.org/job' }],
    contact_email: 'science@example.org',
    data: { sources: [{ url: 'https://example.org/job', supports: ['Duration'], verified: false, fee: 0 }] },
  };
  const original = structuredClone(context);
  const groups = buildOpportunityGroups(context, 'en');
  const links = groups.find(({ id }) => id === 'links')!;
  const overview = groups.find(({ id }) => id === 'overview')!;
  const nodes = flatten([...overview.items, ...links.items]);
  assert.deepEqual(nodes.flatMap((node) => node.href ? [node.href] : []).sort(), [
    'https://example.org/job', 'https://example.org/job?language=de', 'mailto:science@example.org',
  ]);
  const source = overview.items.find((node) => node.href === 'https://example.org/job')!;
  const sourceText = flatten(source.children || []).map((node) => node.text);
  for (const value of ['Official source', 'No', '0']) assert.ok(sourceText.includes(value), value);
  const metadataText = flatten(groups.find(({ id }) => id === 'metadata')!.items).map((node) => node.text);
  for (const value of ['Salary', 'Requirements', 'Duration', '20 Sept 2026']) {
    assert.ok(metadataText.includes(value), value);
    assert.equal(sourceText.includes(value), false, value);
  }
  assert.equal(metadataText.filter((text) => text === 'Salary').length, 1);
  assert.ok(nodes.some((node) => node.text === 'Archived source without URL'));
  const email = links.items.find((node) => node.href === 'mailto:science@example.org')!;
  assert.ok(email.label?.includes('Dr. Example'));
  assert.ok(flatten(email.children || []).some((node) => node.text === 'Scientific contact'));
  assert.deepEqual(context, original, 'rendering must not mutate stored research');
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.equal(markdown.split('](<https://example.org/job>)').length - 1, 1);
  assert.ok(markdown.includes('Duration'));
});

test('primary source type, supports and checked date move to metadata in both languages', () => {
  const context = {
    research_summary: 'Research into safe collaboration', official_url: 'https://example.org/job',
    sources: [{ url: 'https://example.org/job', type: 'Official vacancy', supports: ['Project'], checked_at: '2026-09-20', notes: 'Keep this note' }],
    data: { sources: [{ url: 'https://example.org/job', supports: ['Project', 'Funding'] }] },
  };
  const original = structuredClone(context);
  for (const lang of ['en', 'de']) {
    const groups = buildOpportunityGroups(context, lang);
    const overview = groups.find(({ id }) => id === 'overview')!;
    const metadata = groups.find(({ id }) => id === 'metadata')!;
    const source = overview.items.find(({ kind }) => kind === 'main-link')!;
    const relocated = metadata.items.find(({ text }) => text === source.text)!;
    assert.equal(source.href, context.official_url);
    assert.ok(flatten(source.children || []).some(({ text }) => text === 'Keep this note'));
    assert.deepEqual(relocated.children?.map(({ label }) => label), lang === 'de' ? ['Typ', 'Belegt', 'Geprüft'] : ['Type', 'Supports', 'Checked']);
    const metadataValues = flatten(relocated.children || []).map(({ text }) => text);
    for (const value of ['Official vacancy', 'Project', 'Funding']) {
      assert.equal(metadataValues.filter(text => text === value).length, 1);
      assert.equal(flatten(overview.items).some(({ text }) => text === value), false);
    }
    assert.equal(flatten(groups.flatMap(({ items }) => items)).filter(({ href }) => href === context.official_url).length, 1);
    const markdown = opportunityContextMarkdown(context, lang);
    const metadataHeading = lang === 'de' ? '## Metadaten' : '## Metadata';
    assert.ok(markdown.indexOf('Official vacancy') > markdown.indexOf(metadataHeading));
  }
  assert.deepEqual(context, original);
});

test('overview puts research, the main link and normalized fit scores first; topics live in metadata', () => {
  const context = { topics: ['Robotics'], rd_career_potential: { score: 7, summary: 'Industry opportunities' },
    research_career_potential: { score: '9.5', summary: 'Academic opportunities' }, personal_fit: { score: 8.8, gaps: ['Learn C++'] },
    research_summary: 'Research into safe collaboration', official_url: 'https://example.org/job',
    source_url: 'https://example.org/job', sources: [{ url: 'https://example.org/job', supports: ['Project'] }] };
  const groups = buildOpportunityGroups(context, 'en');
  const overview = groups[0];
  assert.equal(overview.id, 'overview');
  assert.deepEqual(overview.items.map((node) => node.kind), ['summary', 'main-link', 'fit', 'fit', 'fit']);
  assert.deepEqual(overview.items.filter((node) => node.kind === 'fit').map((node) => [node.label, node.score, node.text]), [
    ['Personal fit', 8.8, '8.8 / 10'], ['Academic career potential', 9.5, '9.5 / 10'], ['R&D career potential', 7, '7 / 10'],
  ]);
  assert.ok(flatten(overview.items).some((node) => node.text === 'Learn C++'));
  assert.equal(flatten(groups.flatMap((group) => group.items)).filter((node) => node.href === 'https://example.org/job').length, 1);
  assert.ok(flatten(groups.find((group) => group.id === 'metadata')!.items).some((node) => node.text === 'Robotics'));
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.match(markdown, /\*\*Personal fit:\*\* 8\.8 \/ 10/);
  assert.equal(markdown.includes('## Topics'), false);
});

test('fit visualization accepts zero and ten, but never invents or clamps missing and invalid scores', () => {
  for (const value of [0, 10, 0.5, '8.25']) {
    const fit = buildOpportunityGroups({ personal_fit: { score: value, summary: 'Rationale' } }, 'en')[0].items[0];
    assert.equal(fit.score, Number(value));
    assert.equal(fit.children?.some((node) => node.label === 'Score'), false);
  }
  for (const value of [null, undefined, '', ' ', true, false, -1, 11, 88, NaN, Infinity, 'high', '8/10']) {
    const fit = buildOpportunityGroups({ personal_fit: { score: value, summary: 'Rationale' } }, 'en')[0].items[0];
    assert.equal(fit.kind, 'fit');
    assert.equal(fit.score, undefined, String(value));
    assert.ok(flatten([fit]).some((node) => node.text === 'Rationale'));
  }
  const nested = buildOpportunityGroups({ data: { personal_fit: { score: 8.8 } } }, 'de')[0].items[0];
  assert.equal(nested.text, '8,8 / 10');
});

test('personal fit sorting and badges read the same explicit scores as the detail view', () => {
  for (const [value, expected] of [
    [0, 0], [10, 10], [9.1, 9.1], [9.5, 9.5], [9.6, 9.6],
    [' 9.6 ', 9.6], ['0.00', 0], ['10.0', 10], ['8.25', 8.25],
  ] as const) {
    assert.equal(personalFitScore(value), expected);
    const structured = { score: value, summary: 'An assessment with 2 gaps' };
    assert.equal(personalFitScore(structured), expected);
    const fit = buildOpportunityGroups({ personal_fit: structured }, 'en')[0].items[0];
    assert.equal(fit.score, expected);
    assert.deepEqual(structured, { score: value, summary: 'An assessment with 2 gaps' });
  }
});

test('personal fit scores reject malformed values without using prose, nested fields or coercion', () => {
  const invalid = [
    undefined, null, '', ' ', true, false, -0.1, 10.01, NaN, Infinity, -Infinity,
    '9.6 / 10', 'Strong fit: 9.6', '9,6', '1e1', '0xA', '+9.6', '.5', '9.',
    [], [9.6], {}, { assessment: '9.6' }, { summary: 'Personal fit 9.6' },
    { score: { score: 9.6 } }, { value: 9.6 },
  ];
  for (const value of invalid) {
    assert.equal(personalFitScore(value), undefined, `Unexpected score for ${String(value)}`);
    assert.equal(personalFitScore({ score: value }), undefined, `Unexpected structured score for ${String(value)}`);
  }
});
