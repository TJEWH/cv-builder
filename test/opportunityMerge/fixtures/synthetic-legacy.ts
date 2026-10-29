/**
 * Authored synthetic regression data. No opportunity, person, source, UUID or
 * timestamp here comes from a captured catalogue or external snapshot.
 *
 * The first update deliberately changes checklist arrays into grouped objects.
 * The old merger keeps those old values, unions whole person objects, and still
 * advances their source timestamps. A same-evidence follow-up then reproduces
 * the blocked-correction bug without retaining any real search result.
 */
export const syntheticContactEmail = 'researcher@example.invalid';
export const syntheticEvidenceUrl = 'https://example.invalid/jobs/synthetic-sensing';
export const syntheticLegacyTimes = {
  before: '2026-01-01T09:00:00Z',
  update: '2026-01-02T09:00:00Z',
} as const;

const source = (time: string) => ({
  url: syntheticEvidenceUrl, kind: 'official', checked_at: time,
  supports: ['title', 'contacts', 'supervisors', 'requirements', 'required_documents'],
});

export function syntheticLegacyMergeFixture() {
  const key = 'synthetic-legacy-sensing';
  const before = {
    id: '81000000-0000-4000-8000-000000000001',
    opportunity_key: key,
    title: 'Synthetic sensing research position',
    institution: 'Example Research Institute',
    official_url: syntheticEvidenceUrl,
    contacts: [{ name: 'Synthetic Researcher', email: syntheticContactEmail, role: 'Scientific contact' }],
    supervisors: [{ name: 'Synthetic Researcher', email: syntheticContactEmail, role: 'Supervisor' }],
    requirements: ['Relevant MSc degree'],
    required_documents: ['CV'],
    data: { research_methods: ['Physical sensing'] },
    personal_fit: { score: 8.25, summary: 'Synthetic technical fit' },
    research_career_potential: { score: 9, summary: 'Synthetic academic path' },
    rd_career_potential: { score: 7.5, summary: 'Synthetic applied research path' },
    sources: [source(syntheticLegacyTimes.before)],
    last_checked_at: syntheticLegacyTimes.before,
    created_at: '2025-12-01T09:00:00Z',
    updated_at: syntheticLegacyTimes.before,
  };
  const common = {
    opportunity_key: key,
    title: before.title,
    contacts: [{ name: 'Synthetic Researcher', email: syntheticContactEmail, role: 'Scientific contact', phone: '555-0100' }],
    supervisors: [{ name: 'Synthetic Researcher', email: syntheticContactEmail, role: 'Supervisor', institution: before.institution }],
    sources: [source(syntheticLegacyTimes.update)],
    last_checked_at: syntheticLegacyTimes.update,
  };
  return {
    sourceRunId: '81000000-0000-4000-8000-000000000002',
    before,
    submissions: [
      {
        itemId: '81000000-0000-4000-8000-000000000003',
        payload: {
          ...common,
          requirements: { required: ['Relevant MSc degree'], university_admission: ['Graduate-school admission'] },
          required_documents: { required: ['CV'], university_admission: ['Financing plan'] },
        },
      },
      {
        itemId: '81000000-0000-4000-8000-000000000004',
        payload: {
          ...common,
          requirements: [
            { text: 'Relevant MSc degree', status: 'required', stage: 'recruitment' },
            { text: 'Graduate-school admission', status: 'required', stage: 'doctoral_admission' },
            { text: 'Language proof', status: 'conditional', stage: 'doctoral_admission', conditions: 'Only if requested by the admission office' },
          ],
          required_documents: [
            { text: 'CV', status: 'required', stage: 'recruitment' },
            { text: 'Financing plan', status: 'required', stage: 'doctoral_admission' },
            { text: 'Language certificate', status: 'conditional', stage: 'doctoral_admission', conditions: 'Only if requested by the admission office' },
          ],
        },
      },
    ],
  };
}

/** Independent legacy representations for the one-time v5 conversion suite. */
export function syntheticCanonicalMigrationRecords(): Record<string, unknown>[] {
  return [
    syntheticLegacyMergeFixture().before,
    {
      id: '82000000-0000-4000-8000-000000000001',
      opportunity_key: 'synthetic-canonical-grouped', title: 'Synthetic grouped research',
      contacts: [
        { name: 'Synthetic Contact', email: 'CONTACT@example.invalid', role: 'Contact' },
        { name: 'Synthetic Contact', email: 'contact@example.invalid', role: 'Supervisor', phone: '555-0101' },
      ],
      requirements: { required: ['MSc'], conditional: ['Language proof'] },
      required_documents: { required: ['CV'], university_admission: ['Research plan'] },
      salary: { amount: '3000', currency: 'eur', period: 'monthly', gross: true, holiday_allowance_pct: 8 },
      data: { methods: ['DSP'], teaching_text: 'Duties by agreement', custom_fact: { keep: 'Synthetic research context' } },
      personal_fit: { score: 8.7, summary: 'Synthetic historical rating' },
      sources: [{ url: 'https://example.invalid/jobs/grouped', type: 'official_ad', checked_at: '2000-01-01', supports: ['requirements', 'salary'] }],
      created_at: '1999-12-01T00:00:00Z', updated_at: '2000-01-01T00:00:00Z',
    },
    {
      id: '82000000-0000-4000-8000-000000000002',
      opportunity_key: 'synthetic-canonical-endpoints', title: 'Synthetic endpoint assessments',
      contacts: [{ name: 'Synthetic Coordinator', email: 'coordinator@example.invalid', roles: ['Administrative contact'] }],
      supervisors: [{ name: 'Synthetic Supervisor', email: 'supervisor@example.invalid', roles: ['Supervisor'] }],
      requirements: [
        { requirement: 'Technical degree', required: true, stage: 'recruitment' },
        { text: 'Prior publications', status: 'optional', stage: 'recruitment' },
      ],
      required_documents: [
        { document: 'Research outline', status: 'required', stage: 'doctoral_admission' },
        { text: 'Language certificate', status: 'conditional', stage: 'doctoral_admission', conditions: 'Only when requested' },
      ],
      salary: { amount: 42000, currency: 'EUR', period: 'year', gross: true },
      data: { research_methods: ['Embedded sensing'], teaching_load: { status: 'unknown', details: 'Confirm with the institute' } },
      personal_fit: { score: 0, summary: 'Synthetic explicit zero' },
      research_career_potential: { score: 10, summary: 'Synthetic upper endpoint' },
      rd_career_potential: { score: 4.25, summary: 'Synthetic decimal assessment' },
      sources: [{ url: 'https://example.invalid/jobs/endpoints', kind: 'official', checked_at: '2000-01-01', precision: 'date', supports: ['title', 'requirements'] }],
      created_at: '1999-12-02T00:00:00Z', updated_at: '2000-01-02T00:00:00Z',
    },
  ];
}
