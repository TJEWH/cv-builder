/** Development-only visual fixture; never imported by the production app. No network or auth. */
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState, SavedConfiguration } from '../../src/types';
import { library } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowDown, faArrowLeft, faArrowRight, faArrowsLeftRightToLine, faBriefcase, faCheck,
  faChevronLeft, faChevronRight, faCode, faDownload, faEnvelope, faEye, faEyeSlash,
  faFilePdf, faFolderOpen, faFont, faGlobe, faGraduationCap, faGripVertical, faHeart,
  faInfoCircle, faLanguage, faLayerGroup, faLink, faLinkSlash, faLocationDot, faLock,
  faLockOpen, faPalette, faPhone, faPlus, faSpinner, faSliders, faTableCellsLarge,
  faTableColumns, faTag, faTrash, faUserSecret, faWindowMaximize, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import JobWorkspace from '../../src/components/JobWorkspace.vue';
import AppToaster from '../../src/components/AppToaster.vue';
import DesktopSidebar from '../../src/components/DesktopSidebar.vue';
import { provideDesktopSidebar } from '../../src/composables/desktopSidebar';
import { createSampleDocument } from '../../src/composables/builtinConfigurations';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../../src/composables/motivationLetters';
import { createRefinementFixture, REFINEMENT_TABLES } from '../refinementFixture';
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
      hardware_software_balance: 'Software development with hands-on robot experiments.',
      supervisor_research_focus: { supervisor: 'Prof. Alex Example', summary: 'Learning safe human–robot collaboration from demonstrations.', keywords: ['Robot learning', 'Safety'], evidence: [{ label: 'Lab research', url: 'https://example.org/lab' }] },
      supervisor_top_papers: [{ title: 'Example paper on learning from human feedback', year: 2025, why_relevant: 'Connects interactive learning with safe robotics.', url: 'https://example.org/paper' }],
      requirements: [
        { item: 'MSc in robotics or computer science', category: 'required' },
        { requirement: 'Background in wireless communications, robotics, optimization and ML/AI', importance: 'plus' },
      ],
      required_documents: ['CV', 'Motivation letter (maximum 400 words)', 'Transcript of records', { item: 'Portfolio', importance: 'plus' }],
      official_url: 'https://example.org/opportunities/robotics', verification_level: 'official listing',
      source_url: 'https://example.org/opportunities/robotics', original_search: 'Robotics',
      sources: [
        { url: 'https://example.org/opportunities/robotics', supports: ['Salary', 'Duration'], checked_at: '2026-09-20' },
        { url: 'https://example.org/opportunities/robotics', supports: ['Requirements', 'Salary'], notes: 'Official listing' },
      ],
      data: { work_pattern: 'Hybrid', funding: 'Fully funded' }, created_at: recent, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000002', opportunity_key: 'research-engineer',
      title: 'Research Engineer — Embedded AI Systems', university: 'Institute for Responsible Computing', country: 'Germany',
      deadline: '2026-11-15T17:00:00Z', topics: ['Embedded systems', 'Efficient AI'],
      contact: [{ name: 'Dr. Robin Example', email: 'careers@example.org' }], particularly_suitable: true,
      personal_fit: { score: 9.6, summary: 'Strong embedded systems fit' },
      salary_text: 'TV-L E13', duration_months: 36, requirements: ['Embedded software experience'],
      required_documents: ['CV', 'Portfolio'], official_url: 'https://example.org/opportunities/embedded-ai',
      availability: 'open', created_at: now, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000003', opportunity_key: 'past-opportunity', title: 'Archived research position', institution: 'Example Institute', deadline: '2025-01-01', topics: ['Materials discovery'], contacts: [], personal_fit: { score: 6.4 }, original_search: 'Materials discovery', created_at: now, updated_at: now },
    { id: '10000000-0000-4000-8000-000000000004', opportunity_key: 'open-deadline', title: 'Rolling research fellowship', institution: 'Example Institute', deadline: null, topics: ['Research'], contacts: [], particularly_suitable: true, personal_fit: { score: 10 }, created_at: now, updated_at: now },
    { id: '10000000-0000-4000-8000-000000000005', opportunity_key: 'recent-learning', title: 'Learning Systems PhD', institution: 'Synthetic Science University', country: 'Sweden', deadline: null, topics: ['Learning'], particularly_suitable: true, personal_fit: { score: 9.1 }, created_at: recent, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000006', opportunity_key: 'older-unseen', title: 'Applied Robotics Fellowship', institution: 'Example Institute', country: 'Denmark', deadline: null, topics: ['Robotics'], particularly_suitable: true, personal_fit: { score: 9.5 }, created_at: now, updated_at: now },
    { id: '10000000-0000-4000-8000-000000000007', opportunity_key: 'older-update', title: 'Control Systems Researcher', institution: 'Synthetic Science University', country: 'Finland', deadline: null, topics: ['Control'], particularly_suitable: true, personal_fit: { score: 9.4 }, created_at: '2025-01-01T12:00:00Z', updated_at: now },
    { id: '10000000-0000-4000-8000-000000000008', opportunity_key: 'already-viewed', title: 'Reviewed AI Fellowship', institution: 'Synthetic Science University', country: 'Germany', deadline: null, topics: ['AI'], particularly_suitable: false, personal_fit: { score: 9.8 }, created_at: now, updated_at: recent },
    { id: '10000000-0000-4000-8000-000000000009', opportunity_key: 'unknown-fit', title: 'Research Assistant — Fit not scored', institution: 'Example Institute', country: 'France', deadline: null, topics: ['Research'], particularly_suitable: true, created_at: now, updated_at: now },
  ],
  applications: [],
  cv_variants: [],
  local_attachment_metadata: [],
  opportunity_reviews: [
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000003', state: 'strong_interest', reviewed_updated_at: now, created_at: now, updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000002', state: 'unreviewed', reviewed_updated_at: now, created_at: now, updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000007', state: 'unreviewed', reviewed_updated_at: '2025-01-01T12:00:00Z', created_at: '2025-01-01T12:00:00Z', updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000008', state: 'interested', reviewed_updated_at: recent, created_at: now, updated_at: recent },
  ],
};
const refinement = createRefinementFixture(database, account);

function from(table: string) {
  if (REFINEMENT_TABLES.includes(table as typeof REFINEMENT_TABLES[number])) return refinement.from(table);
  const filters: [string, unknown][] = [];
  let first = 0;
  let last = Infinity;
  let one = false;
  let patch: Row | null = null;
  let upsert: Row | null = null;
  let signal: AbortSignal | undefined;
  let ordering: { column: string; ascending: boolean } | null = null;
  const execute = () => {
    if (signal?.aborted) return { data: null, error: new Error('Aborted') };
    if (!database[table]) return { data: null, error: { code: '42P01', message: `Unknown fixture table: ${table}` } };
    if (upsert) {
      const saved = database[table].find((row) => row.user_id === upsert!.user_id && row.opportunity_id === upsert!.opportunity_id);
      if (saved) Object.assign(saved, upsert, { updated_at: new Date().toISOString() });
      else database[table].push({ ...upsert, created_at: now, updated_at: now });
      filters.push(['user_id', upsert.user_id], ['opportunity_id', upsert.opportunity_id]);
    }
    const matching = database[table].filter((row) => filters.every(([key, value]) => row[key] === value));
    if (ordering) {
      const { column, ascending } = ordering;
      matching.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
    }
    const selected = matching.slice(first, last + 1);
    if (patch) selected.forEach((row) => {
      if (table === 'applications' && patch!.status && patch!.status !== row.status) {
        row.status_history = [...(row.status_history as Row[] || []), { status: patch!.status, changedAt: new Date().toISOString() }];
      }
      const tracking = table === 'applications' ? { tracking_started: row.tracking_started === true || patch!.tracking_started === true } : {};
      Object.assign(row, patch, tracking, { updated_at: new Date().toISOString() });
    });
    return { data: structuredClone(one ? selected[0] ?? null : selected), error: null, count: matching.length };
  };
  const builder = {
    select(_fields: string) { return builder; },
    order(column: string, options: { ascending?: boolean } = {}) { ordering = { column, ascending: options.ascending !== false }; return builder; },
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
  supabaseUrl: 'https://fixture.supabase.co',
  from,
  rpc(name: string, parameters: Row) {
    let signal: AbortSignal | undefined;
    const execute = () => {
      if (signal?.aborted) return { data: null, error: new Error('Aborted') };
      if (['save_refinement_state', 'publish_refinement_request', 'save_refinement_review'].includes(name)) return refinement.rpc(name, parameters);
      const snapshot = {
        id: parameters.p_cv_variant_id, user_id: account, name: parameters.p_cv_name,
        content_json: parameters.p_content_json, config_json: parameters.p_config_json,
        cv_version: parameters.p_cv_version, revision: 1, is_base_variant: false, created_at: new Date().toISOString(),
      };
      if (name === 'review_job_opportunity' || name === 'save_opportunity_comment') {
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        if (!opportunity) return { error: new Error('Missing fixture opportunity') };
        let review = database.opportunity_reviews.find((row) => row.opportunity_id === opportunity.id && row.user_id === account);
        if (!review) {
          review = { user_id: account, opportunity_id: opportunity.id, state: 'unreviewed', reviewed_updated_at: null, created_at: now, updated_at: now };
          database.opportunity_reviews.push(review);
        }
        if (parameters.p_state) review.state = parameters.p_state;
        if (name === 'save_opportunity_comment') review.comment = String(parameters.p_comment || '').trim() || null;
        if (parameters.p_observed_updated_at === opportunity.updated_at) review.reviewed_updated_at = opportunity.updated_at;
        review.updated_at = new Date().toISOString();
        return { data: structuredClone(review), error: null };
      } else if (name === 'create_job_application') {
        const existing = database.applications.find((row) => row.opportunity_id === parameters.p_opportunity_id);
        if (existing) return { data: existing.id, error: null };
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        database.applications.push({ id: parameters.p_application_id, user_id: account,
          application_code: opportunity?.id === '10000000-0000-4000-8000-000000000001' ? 'APP-7K4M9Q' : null,
          opportunity_id: parameters.p_opportunity_id, cv_variant_id: null,
          contact_email: null, context_json: structuredClone(opportunity), context_captured_at: new Date().toISOString(), status: 'preparation', workflow_stage: 'preparation', tracking_started: false,
          status_history: [{ status: 'preparation', changedAt: new Date().toISOString() }], completed_checklist_keys: [], notes: null,
          contacted_at: null, submitted_at: null, created_at: now, updated_at: now });
      } else if (name === 'set_job_application_stage') {
        const application = database.applications.find(row => row.id === parameters.p_application_id && row.user_id === account);
        if (!application) return { error: new Error('Missing fixture application') };
        const stage = String(parameters.p_stage);
        const status = ({ preparation: 'preparation', refinement: 'refinement', review: 'attachments', tracking: 'ready' } as Record<string, string>)[stage];
        if (!status) return { error: new Error('Invalid fixture application stage') };
        application.workflow_stage = stage;
        if (!application.tracking_started && status !== application.status) {
          application.status = status;
          application.status_history = [...(application.status_history as Row[] || []), { status, changedAt: new Date().toISOString() }];
        }
        application.updated_at = new Date().toISOString();
        return { data: structuredClone(application), error: null };
      } else if (name === 'set_job_application_checklist_item') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id && row.user_id === account);
        if (!application) return { error: new Error('Missing fixture application') };
        const keys = new Set(application.completed_checklist_keys as string[]);
        if (parameters.p_completed) keys.add(String(parameters.p_item_key));
        else keys.delete(String(parameters.p_item_key));
        application.completed_checklist_keys = [...keys];
        application.updated_at = new Date().toISOString();
        return { data: structuredClone(application), error: null };
      } else if (name === 'remove_job_application') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id && row.user_id === account);
        database.applications = database.applications.filter((row) => row !== application);
        for (const table of REFINEMENT_TABLES) database[table] = database[table].filter(row => row.application_id !== application?.id);
        const review = database.opportunity_reviews.find((row) => row.opportunity_id === application?.opportunity_id && row.user_id === account);
        if (review?.state === 'not_interested') review.state = 'unreviewed';
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
    };
    const builder = {
      abortSignal(value: AbortSignal) { signal = value; return builder; },
      then(resolve: (value: ReturnType<typeof execute>) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve().then(execute).then(resolve, reject);
      },
    };
    return builder;
  },
} as unknown as SupabaseClient;

document.documentElement.style.setProperty('--font-body', 'system-ui, sans-serif');
document.documentElement.style.setProperty('--ink', '#d1fae5');
library.add(
  faArrowDown, faArrowLeft, faArrowRight, faArrowsLeftRightToLine, faBriefcase, faCheck,
  faChevronLeft, faChevronRight, faCode, faDownload, faEnvelope, faEye, faEyeSlash,
  faFilePdf, faFolderOpen, faFont, faGithub, faGlobe, faGraduationCap, faGripVertical,
  faHeart, faInfoCircle, faLanguage, faLayerGroup, faLinkedin, faLink, faLinkSlash,
  faLocationDot, faLock, faLockOpen, faPalette, faPhone, faPlus, faSpinner, faSliders,
  faTableCellsLarge, faTableColumns, faTag, faTrash, faUserSecret, faWindowMaximize, faXmark,
);
const Fixture = defineComponent({
  setup() {
    const viewport = window.matchMedia('(min-width: 761px)');
    const desktop = ref(viewport.matches);
    const resize = () => { desktop.value = viewport.matches; };
    viewport.addEventListener('change', resize);
    onBeforeUnmount(() => viewport.removeEventListener('change', resize));
    provideDesktopSidebar(desktop);
    const tab = ref<'opportunities' | 'applications'>('opportunities');
    const lang = ref('en');
    const draftStatus = ref('');
    const workspaceKey = ref(0);
    const cv = createSampleDocument();
    const fixtureVariants = ref<SavedConfiguration[]>([{ id: 'sample-cv', name: 'Sample research CV', mtime: 1 }]);
    const fixtureStates = new Map<string, CvState>([['sample-cv', cv]]);
    // Opt-in regression using the real phone layout and controls:
    // /test/browser/job-workspace.html?flow=phone-filters at a viewport <= 760px.
    onMounted(async () => {
      if (new URLSearchParams(location.search).get('flow') !== 'phone-filters') return;
      const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const settle = async () => { await nextTick(); await new Promise(requestAnimationFrame); };
      const rows = () => [...document.querySelectorAll<HTMLElement>('.jobs-applications-table .jobs-result-row')];
      document.body.dataset.filterTest = 'running';
      try {
        assert(!desktop.value, 'Run the phone filter check at a viewport no wider than 760px.');
        for (const opportunity of database.opportunities.slice(0, 2)) {
          await client.rpc('create_job_application', { p_application_id: crypto.randomUUID(), p_opportunity_id: opportunity.id });
        }
        database.applications[0].status = 'interview';
        tab.value = 'applications'; workspaceKey.value++;
        const deadline = performance.now() + 5000;
        do { await settle(); } while (rows().length !== 2 && performance.now() < deadline);
        assert(rows().length === 2, 'Both synthetic applications must load.');
        const toggle = document.querySelector<HTMLButtonElement>('.jobs-filter-toggle');
        assert(toggle && toggle.getBoundingClientRect().height >= 44, 'Applications must expose a touch-sized Filters button.');
        toggle.click(); await settle();
        const panel = document.getElementById(toggle.getAttribute('aria-controls')!);
        assert(panel?.getClientRects().length, 'The Filters button must open its controlled panel.');
        const selects = panel.querySelectorAll<HTMLSelectElement>('select');
        const status = selects[0], sort = selects[1];
        assert(status && sort && status.getBoundingClientRect().height >= 44 && sort.getBoundingClientRect().height >= 44, 'Status and Sort must both be usable touch controls.');
        sort.value = 'institution'; sort.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        assert(rows()[0].textContent?.includes('Research Engineer'), 'Institution sorting must reorder the application results.');
        status.value = 'interview'; status.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        assert(rows().length === 1 && rows()[0].textContent?.includes('Human-Centred Robotics'), 'Status filtering must show only the matching application.');
        status.focus();
        status.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
        assert(toggle.getAttribute('aria-expanded') === 'false' && !panel.getClientRects().length && document.activeElement === toggle, 'Escape must close Filters and return focus to its trigger.');
        toggle.click(); await settle();
        assert(status.value === 'interview' && sort.value === 'institution', 'Closing Filters must preserve the selected filter and sort.');
        const navigation = document.querySelectorAll<HTMLButtonElement>('.fixture-mobile-nav button');
        navigation[0].click(); await settle();
        assert(toggle.getAttribute('aria-expanded') === 'false', 'Changing workspaces must close Filters.');
        toggle.click(); await settle();
        assert(document.querySelectorAll('#jobs-opportunities-filters select').length === 3, 'Opportunity filters must remain available in the shared panel.');
        navigation[1].click(); await settle();
        toggle.click(); await settle();
        const retained = document.querySelectorAll<HTMLSelectElement>('#jobs-applications-filters select');
        assert(retained[0].value === 'interview' && retained[1].value === 'institution' && rows().length === 1, 'Workspace changes must preserve application filters and results.');
        toggle.click(); await settle();
        const search = document.querySelector<HTMLInputElement>('.jobs-search input')!;
        search.focus();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        search.dispatchEvent(escape); await settle();
        assert(!escape.defaultPrevented && document.activeElement === search, 'Escape must leave the search control alone when Filters is closed.');
        draftStatus.value = 'PASS: Phone application filtering, sorting, touch targets and focus restoration.';
        document.body.dataset.filterTest = 'passed';
      } catch (cause) {
        draftStatus.value = `FAIL: ${cause instanceof Error ? cause.message : String(cause)}`;
        document.body.dataset.filterTest = 'failed';
      }
      document.body.dataset.filterTestMessage = draftStatus.value;
    });
    async function select400WordScenario() {
      const template = { ...DEFAULT_LETTER_TEMPLATES[0], maxWords: 400 };
      createLetterRepository(localStorage, account).saveTemplate(template);
      await client.rpc('create_job_application', { p_application_id: crypto.randomUUID(), p_opportunity_id: database.opportunities[0].id });
      tab.value = 'applications'; workspaceKey.value++;
      draftStatus.value = '400-word PhD scenario ready. Open the application, select both templates and attach a transcript.';
    }
    function returnRefinementProposal(overLimit = false) {
      try {
        const returned = refinement.seedProposal(undefined, { overLimit });
        draftStatus.value = `Synthetic proposal returned (${returned.proposal_json.cvOperations.length} CV changes). Use “Check for proposal”, then select the latest proposal.`;
      } catch (cause) { draftStatus.value = cause instanceof Error ? cause.message : String(cause); }
    }
    return () => h('main', { class: ['browser-workspace-fixture', { 'has-desktop-sidebar': desktop.value }], style: 'display:grid;grid-template-rows:auto minmax(0,1fr);height:100dvh;overflow:hidden;padding:16px;max-width:1440px;margin:auto' }, [
      h(AppToaster, { lang: lang.value }),
      h(DesktopSidebar, { lang: lang.value, style: desktop.value ? '' : 'display:none' }, { header: () => h('span', { style: 'display:grid;place-items:center' }, 'Synthetic account') }),
      h('header', { class: 'fixture-toolbar', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 16px;color:#9be8c7' }, [
        h('strong', 'Browser fixture · In-memory data only'),
        ...(['opportunities', 'applications'] as const).map((value) => h('button', { class: 'btn', onClick: () => { tab.value = value; } }, value)),
        h('button', { class: 'btn', onClick: () => { lang.value = lang.value === 'en' ? 'de' : 'en'; } }, lang.value === 'en' ? 'Deutsch' : 'English'),
        h('button', { class: 'btn', onClick: select400WordScenario }, '400-word PhD scenario'),
        h('button', { class: 'btn', onClick: () => { workspaceKey.value++; draftStatus.value = 'Workspace reopened with existing browser documents and cloud data.'; } }, 'Reopen workspace'),
        h('button', { class: 'btn', onClick: () => returnRefinementProposal() }, 'Return refinement proposal'),
        h('button', { class: 'btn', onClick: () => returnRefinementProposal(true) }, 'Return over-limit proposal'),
        draftStatus.value ? h('span', { role: 'status', style: 'font-size:12px' }, draftStatus.value) : null,
      ]),
      h(JobWorkspace, { key: workspaceKey.value, client, userId: account, tab: tab.value, lang: lang.value, projectId: 'fixture',
        configurations: fixtureVariants.value, selectedId: 'sample-cv',
        readVersion: (id: string) => fixtureStates.has(id) ? structuredClone(fixtureStates.get(id)!) : null,
        createVariant: (name: string, state: CvState) => {
          const id = crypto.randomUUID(); fixtureStates.set(id, structuredClone(state));
          fixtureVariants.value.push({ id, name, mtime: Date.now() }); return id;
        },
        onEditVariant: (id: string) => { draftStatus.value = `Open ${fixtureVariants.value.find(item => item.id === id)?.name} in CV Studio (fixture).`; },
        onNavigate: (value: 'opportunities' | 'applications') => { tab.value = value; } }),
      h('nav', { class: 'fixture-mobile-nav', 'aria-label': 'Fixture workspaces' },
        (['opportunities', 'applications'] as const).map((value) => h('button', { class: 'btn', 'aria-pressed': tab.value === value, onClick: () => { tab.value = value; } }, value))),
    ]);
  },
});
document.documentElement.classList.add('app-dark');
const app = createApp(Fixture);
app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } });
app.component('InputText', InputText);
app.component('InputNumber', InputNumber);
app.component('Select', Select);
app.component('Textarea', Textarea);
app.component('font-awesome-icon', FontAwesomeIcon);
app.mount('#app');
