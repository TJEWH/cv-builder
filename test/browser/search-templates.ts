/** Development-only fixture. Every database operation stays in memory; CSP prevents external requests. */
import { computed, createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import SearchTemplates from '../../src/components/SearchTemplates.vue';
import DesktopSidebar from '../../src/components/DesktopSidebar.vue';
import DesktopSidebarPortal from '../../src/components/DesktopSidebarPortal.vue';
import { provideDesktopSidebar } from '../../src/composables/desktopSidebar';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Search browser fixtures are development-only.');
type Row = Record<string, unknown>;
const owner = '90000000-0000-4000-8000-000000000031';
const searchId = '90000000-0000-4000-8000-000000000032';
const now = '2026-10-12T09:00:00Z';
const schedule = { frequency: 'weekly', intervalHours: 6, weekdays: [1], time: '09:00', timezone: 'Europe/Berlin', runImmediately: true };
const template = { id: searchId, user_id: owner, name: 'Funded PhD · Human–technology research', revision: 3, created_at: now, updated_at: now,
  criteria: {
    opportunityTypes: 'Currently open, funded PhD and Industrial PhD positions. Include applied research positions with a clear research focus.',
    topicsAndMethods: 'Human–computer interaction, tangible interfaces, human-centred robotics and interactive systems. Prioritize research that combines physical prototyping, hardware, machine learning and technical evaluation.',
    locationsAndLanguages: 'Prioritize Germany, Switzerland, Austria and the Netherlands. English or German working language.',
    fundingAndConditions: 'Funding must be confirmed by an official source. Research salary, contract duration, eligibility and expected start date.',
    fitAndExclusions: 'Prefer hands-on applied research with a path toward industrial R&D. Exclude purely theoretical work without prototyping or empirical evaluation.',
    sourcesAndQueries: 'Start with university and institute career pages, EURAXESS and official project websites. Follow aggregators to the original vacancy.',
    researchAndReporting: 'Research supervisors separately from administrative contacts. Report strong new matches and meaningful changes; avoid repeating unchanged results.',
  }, schedule,
};
const rows: Record<string, Row[]> = {
  opportunity_search_templates: [template],
  opportunity_search_runs: [{ id: '90000000-0000-4000-8000-000000000033', user_id: owner, search_id: searchId, status: 'complete', created_at: now, completed_at: now, summary: { message: '2 new matches saved and verified.' } }],
  opportunity_search_schedule_bindings: [{ user_id: owner, search_id: searchId, task_id: 'fixture-schedule-1', schedule, template_revision: 3, confirmed_at: now, protocol_version: 'opportunity-search-v1-2026-10-12' }],
};
function from(table: string) {
  const filters: [string, unknown][] = [];
  let first = 0, last = Infinity;
  const query = {
    select() { return query; },
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    order() { return query; },
    range(start: number, end: number) { first = start; last = end; return query; },
    limit(count: number) { last = count - 1; return query; },
    abortSignal() { return query; },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const data = rows[table]?.filter(row => filters.every(([key, value]) => row[key] === value)).slice(first, last + 1);
      return Promise.resolve(data ? { data: structuredClone(data), error: null } : { data: null, error: { message: `Unknown fixture table ${table}` } }).then(resolve, reject);
    },
  };
  return query;
}
const fakeClient = {
  supabaseUrl: 'https://searchfixture.supabase.co', from,
  async rpc(name: string, params: Row = {}) {
    if (name === 'opportunity_search_readiness') return { data: { ready: true, bootstrap_version: 1, protocol_version: 'opportunity-search-v1-2026-10-12', protocol_hash: `sha256:${'a'.repeat(64)}` }, error: null };
    if (name !== 'save_opportunity_search_template') return { data: null, error: { message: `Unknown fixture RPC ${name}` } };
    const stored = rows.opportunity_search_templates.find(row => row.id === params.p_id);
    if ((stored?.revision || 0) !== params.p_expected_revision) return { data: null, error: { code: '40001', message: 'Search template revision conflict.' } };
    const next = { id: params.p_id, user_id: owner, name: params.p_name, criteria: structuredClone(params.p_criteria), schedule: structuredClone(params.p_schedule), revision: Number(params.p_expected_revision) + 1, created_at: stored?.created_at || now, updated_at: new Date().toISOString() };
    if (stored) Object.assign(stored, next); else rows.opportunity_search_templates.push(next);
    return { data: structuredClone(next), error: null };
  },
} as unknown as SupabaseClient;

createApp({ setup() {
  const lang = ref(new URLSearchParams(location.search).get('lang') || 'en');
  const mobileMedia = window.matchMedia('(max-width:760px)');
  const mobile = ref(mobileMedia.matches);
  const updateViewport = () => { mobile.value = mobileMedia.matches; };
  onMounted(() => mobileMedia.addEventListener('change', updateViewport));
  onBeforeUnmount(() => mobileMedia.removeEventListener('change', updateViewport));
  provideDesktopSidebar(computed(() => !mobile.value));
  return () => h('main', { class: 'search-fixture' }, [
    h(DesktopSidebar, { lang: lang.value }, { header: () => h('div', { class: 'fixture-account' }, 'Supabase · Isolated fixture') }),
    h('header', { class: 'fixture-heading' }, [h('strong', 'Opportunities'), h('button', { class: 'btn', onClick: () => { lang.value = lang.value === 'de' ? 'en' : 'de'; } }, lang.value === 'de' ? 'English' : 'Deutsch')]),
    h(DesktopSidebarPortal, { area: 'subtabs' }, { default: () => h('nav', { class: 'fixture-opportunity-tabs', 'aria-label': 'Opportunity sections' }, [
      h('button', { class: 'btn', type: 'button', 'aria-pressed': false }, lang.value === 'de' ? 'Ergebnisse' : 'Results'),
      h('button', { class: 'btn', type: 'button', 'aria-pressed': true }, lang.value === 'de' ? 'Suchvorlagen' : 'Search templates'),
    ]) }),
    h(SearchTemplates, { client: fakeClient, userId: owner, lang: lang.value, configuration: { status: 'ready', url: 'https://searchfixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }),
    h('nav', { class: 'fixture-mobile-tabs', 'aria-label': 'Workspaces' }, ['CV Studio', 'Opportunities', 'Applications'].map(label => h('button', { class: 'btn', type: 'button' }, label))),
  ]);
} }).mount('#app');
