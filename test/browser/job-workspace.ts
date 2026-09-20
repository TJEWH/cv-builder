/** Development-only visual fixture; never imported by the production app. No network or auth. */
import { createApp, defineComponent, h, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { library } from '@fortawesome/fontawesome-svg-core';
import { faLock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import JobWorkspace from '../../src/components/JobWorkspace.vue';
import { createSampleDocument } from '../../src/composables/builtinConfigurations';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('The browser fixture is available only on the development server.');

type Row = Record<string, unknown>;
const account = '90000000-0000-4000-8000-000000000001';
const now = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const database: Record<string, Row[]> = {
  opportunities: [
    { id: '10000000-0000-4000-8000-000000000001', opportunity_key: 'robotics-phd',
      title: 'PhD in Human-Centred Robotics', university: 'Northbridge Technical University', country: 'Netherlands',
      deadline: '2026-10-30T23:59:00Z', topics: ['Robotics', 'Human–robot interaction', 'Machine learning'],
      contact: [{ name: 'Prof. Alex Example', email: 'robotics@example.org' }], particularly_suitable: true,
      salary_text: '€3,100–€3,900 / month', duration_months: 48, supervisor: 'Prof. Alex Example',
      duration_details: 'Four-year funded doctoral contract.',
      research_summary: 'Study how robots can learn safe collaboration from human demonstrations, combining learning algorithms with physical experiments.',
      personal_fit: { score: 8.8, summary: 'Strong alignment with robotics experience', gaps: ['Develop experimental design skills'] },
      research_career_potential: { score: 9, summary: 'Publish research in human–robot interaction' },
      rd_career_potential: { score: 8, summary: 'Transfer safe learning methods to industrial R&D' },
      particularly_suitable_reason: 'Combines robot learning with practical experiments.',
      supervisor_research_focus: { supervisor: 'Prof. Alex Example', summary: 'Learning safe human–robot collaboration from demonstrations.', keywords: ['Robot learning', 'Safety'], evidence: [{ label: 'Lab research', url: 'https://example.org/lab' }] },
      supervisor_top_papers: [{ title: 'Example paper on learning from human feedback', year: 2025, why_relevant: 'Connects interactive learning with safe robotics.', url: 'https://example.org/paper' }],
      requirements: ['MSc in robotics or computer science', 'Python and C++ experience'],
      required_documents: ['CV', 'Motivation letter', 'Academic transcripts'],
      official_url: 'https://example.org/opportunities/robotics', verification_level: 'official listing',
      source_url: 'https://example.org/opportunities/robotics',
      sources: [
        { url: 'https://example.org/opportunities/robotics', supports: ['Salary', 'Duration'], checked_at: '2026-09-20' },
        { url: 'https://example.org/opportunities/robotics', supports: ['Requirements', 'Salary'], notes: 'Official listing' },
      ],
      data: { work_pattern: 'Hybrid', funding: 'Fully funded' }, created_at: recent, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000002', opportunity_key: 'research-engineer',
      title: 'Research Engineer — Embedded AI Systems', university: 'Institute for Responsible Computing', country: 'Germany',
      deadline: '2026-11-15T17:00:00Z', topics: ['Embedded systems', 'Efficient AI'],
      contact: [{ name: 'Dr. Robin Example', email: 'careers@example.org' }], particularly_suitable: false,
      salary_text: 'TV-L E13', duration_months: 36, requirements: ['Embedded software experience'],
      required_documents: ['CV', 'Portfolio'], official_url: 'https://example.org/opportunities/embedded-ai',
      availability: 'open', created_at: now, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000003', opportunity_key: 'past-opportunity', title: 'Archived research position', institution: 'Example Institute', deadline: '2025-01-01', topics: [], contacts: [], created_at: now, updated_at: now },
    { id: '10000000-0000-4000-8000-000000000004', opportunity_key: 'open-deadline', title: 'Rolling research fellowship', institution: 'Example Institute', deadline: null, topics: ['Research'], contacts: [], created_at: now, updated_at: now },
  ],
  applications: [],
  cv_variants: [],
  opportunity_reviews: [],
};

function from(table: string) {
  const filters: [string, unknown][] = [];
  let first = 0;
  let last = Infinity;
  let one = false;
  let patch: Row | null = null;
  let upsert: Row | null = null;
  let signal: AbortSignal | undefined;
  const execute = () => {
    if (signal?.aborted) return { data: null, error: new Error('Aborted') };
    if (upsert) {
      const saved = database[table].find((row) => row.user_id === upsert!.user_id && row.opportunity_id === upsert!.opportunity_id);
      if (saved) Object.assign(saved, upsert, { updated_at: new Date().toISOString() });
      else database[table].push({ ...upsert, created_at: now, updated_at: now });
      filters.push(['user_id', upsert.user_id], ['opportunity_id', upsert.opportunity_id]);
    }
    const matching = database[table].filter((row) => filters.every(([key, value]) => row[key] === value));
    const selected = matching.slice(first, last + 1);
    if (patch) selected.forEach((row) => Object.assign(row, patch, { updated_at: new Date().toISOString() }));
    return { data: structuredClone(one ? selected[0] ?? null : selected), error: null, count: matching.length };
  };
  const builder = {
    select(_fields: string) { return builder; },
    order(_column: string, _options: unknown) { return builder; },
    range(start: number, end: number) { first = start; last = end; return builder; },
    eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
    update(value: Row) { patch = value; return builder; },
    upsert(value: Row) { upsert = value; return builder; },
    single() { one = true; return builder; },
    abortSignal(value: AbortSignal) { signal = value; return builder; },
    then(resolve: (value: ReturnType<typeof execute>) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(execute()).then(resolve, reject);
    },
  };
  return builder;
}

const client = {
  from,
  rpc(name: string, parameters: Row) {
    return { async abortSignal(signal: AbortSignal) {
      if (signal.aborted) return { error: new Error('Aborted') };
      const snapshot = {
        id: parameters.p_cv_variant_id, user_id: account, name: parameters.p_cv_name,
        content_json: parameters.p_content_json, config_json: parameters.p_config_json,
        cv_version: parameters.p_cv_version, revision: 1, is_base_variant: false, created_at: new Date().toISOString(),
      };
      if (name === 'review_job_opportunity') {
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        if (!opportunity) return { error: new Error('Missing fixture opportunity') };
        let review = database.opportunity_reviews.find((row) => row.opportunity_id === opportunity.id && row.user_id === account);
        if (!review) {
          review = { user_id: account, opportunity_id: opportunity.id, state: 'unreviewed', reviewed_updated_at: null, created_at: now, updated_at: now };
          database.opportunity_reviews.push(review);
        }
        if (parameters.p_state) review.state = parameters.p_state;
        if (parameters.p_observed_updated_at === opportunity.updated_at) review.reviewed_updated_at = opportunity.updated_at;
        review.updated_at = new Date().toISOString();
        return { data: structuredClone(review), error: null };
      } else if (name === 'create_job_application') {
        const existing = database.applications.find((row) => row.opportunity_id === parameters.p_opportunity_id);
        if (existing) return { data: existing.id, error: null };
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        database.applications.push({ id: parameters.p_application_id, user_id: account,
          opportunity_id: parameters.p_opportunity_id, cv_variant_id: null,
          contact_email: null, context_json: structuredClone(opportunity), context_captured_at: new Date().toISOString(), status: 'shortlist', notes: null,
          contacted_at: null, submitted_at: null, created_at: now, updated_at: now });
      } else if (name === 'assign_job_application_cv') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id);
        if (!application) return { error: new Error('Missing fixture application') };
        database.cv_variants.push(snapshot);
        Object.assign(application, parameters.p_changes, { cv_variant_id: snapshot.id, updated_at: new Date().toISOString() });
      } else if (name === 'refresh_job_application_context') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id);
        if (!application) return { error: new Error('Missing fixture application') };
        application.context_json = structuredClone(database.opportunities.find((row) => row.id === application.opportunity_id));
        application.context_captured_at = new Date().toISOString();
      } else return { error: new Error(`Unsupported fixture RPC: ${name}`) };
      return { data: parameters.p_application_id, error: null };
    } };
  },
} as unknown as SupabaseClient;

document.documentElement.style.setProperty('--font-body', 'system-ui, sans-serif');
document.documentElement.style.setProperty('--ink', '#d1fae5');
library.add(faLock);
const Fixture = defineComponent({
  setup() {
    const tab = ref<'opportunities' | 'applications'>('opportunities');
    const lang = ref('en');
    const cv = createSampleDocument();
    return () => h('main', { style: 'display:grid;grid-template-rows:auto minmax(0,1fr);height:100dvh;overflow:hidden;padding:16px;max-width:1440px;margin:auto' }, [
      h('header', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 16px;color:#9be8c7' }, [
        h('strong', 'Browser fixture · In-memory data only'),
        ...(['opportunities', 'applications'] as const).map((value) => h('button', { class: 'btn', onClick: () => { tab.value = value; } }, value)),
        h('button', { class: 'btn', onClick: () => { lang.value = lang.value === 'en' ? 'de' : 'en'; } }, lang.value === 'en' ? 'Deutsch' : 'English'),
      ]),
      h(JobWorkspace, { client, userId: account, tab: tab.value, lang: lang.value,
        configurations: [{ id: 'sample-cv', name: 'Sample research CV', mtime: 1 }], selectedId: 'sample-cv',
        readVersion: () => structuredClone(cv), onNavigate: (value: 'opportunities' | 'applications') => { tab.value = value; } }),
    ]);
  },
});
createApp(Fixture).component('font-awesome-icon', FontAwesomeIcon).mount('#app');
