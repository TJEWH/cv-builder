import { createApp, h, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import SearchTemplates from '../../src/components/SearchTemplates.vue';
import { DEFAULT_SEARCH_TEMPLATES, searchTemplateContentKey } from '../../src/composables/useSearchTemplates';
import { buildRecurringSearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt } from '../../src/composables/searchPrompts';
import { searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../../src/composables/searchTemplateCloud';
import type { SearchCloudTemplate } from '../../src/searchTypes';
import type { AdaptiveSearchRunnerState } from '../../src/composables/adaptiveSearchTask';
import '../../src/assets/cv.css';

const owner = '11111111-1111-4111-8111-111111111111', search = '22222222-2222-4222-8222-222222222222', project = 'abcdefghijklmnopqrst';
const template = structuredClone(DEFAULT_SEARCH_TEMPLATES[0]!);
template.name = 'Synthetic adaptive search'; template.researchInterests = 'BCI; acoustic sensing';
template.cloud = { id: search, revision: 1, contentKey: searchTemplateContentKey(template) };
let row: SearchCloudTemplate = { id: search, user_id: owner, name: template.name, revision: 1,
  criteria: searchTemplateCloudCriteria(template), schedule: searchTemplateCloudSchedule(template), created_at: template.updatedAt, updated_at: template.updatedAt,
  meta_search: { version: 1, active: true, editor: structuredClone(template), systemPrompt: buildSearchSystemPrompt(template),
    userPrompt: buildSearchUserPrompt(template), recurringPrompt: buildRecurringSearchPrompt(template) } };
let state: AdaptiveSearchRunnerState = { setup_contract_version: 1, user_id: owner, search_id: search, project_ref: project,
  revision: 0, mode: 'legacy', migration_requested: false, ready: true, readiness_code: 'ready', setup_id: null,
  binding: { task_id: 'synthetic-existing-task', schedule: row.schedule, runner_capability: null } };
const calls: { name: string; args: Record<string, unknown> }[] = [];
const copied = ref(''), saveCount = ref(0), requestCount = ref(0);
let holdRequest = false, releaseRequest: (() => void) | null = null, failSave = false;
let failReadiness = new URLSearchParams(location.search).has('readinessFailure');
const client = { from: (name: string) => {
  if (name !== 'opportunity_search_templates') throw new Error('Unexpected fixture table');
  return { select: () => ({ eq: () => ({ order: async () => ({ data: [structuredClone(row)], error: null }) }) }) };
}, rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args: structuredClone(args) });
  if (name === 'read_adaptive_search_readiness') return failReadiness
    ? { data: null, error: { code: 'NETWORK', message: 'Synthetic readiness unavailable' } } : { data: structuredClone(state), error: null };
  if (name === 'request_adaptive_search_migration') {
    requestCount.value++;
    if (holdRequest) await new Promise<void>(resolve => { releaseRequest = resolve; });
    if (!state.migration_requested || state.setup_id !== args.p_setup_id) state = { ...state, revision: state.revision + 1, migration_requested: true, setup_id: String(args.p_setup_id) };
    return { data: structuredClone(state), error: null };
  }
  if (name === 'save_opportunity_meta_search') {
    if (failSave) { failSave = false; return { data: null, error: new Error('Synthetic save failed; draft retained') }; }
    saveCount.value++;
    row = { ...row, name: String(args.p_name), criteria: structuredClone(args.p_criteria) as SearchCloudTemplate['criteria'],
      schedule: structuredClone(args.p_schedule) as SearchCloudTemplate['schedule'], meta_search: structuredClone(args.p_meta_search) as SearchCloudTemplate['meta_search'],
      revision: Number(args.p_expected_revision) + 1 };
    return { data: structuredClone(row), error: null };
  }
  throw new Error('Unexpected synthetic RPC');
} } as unknown as SupabaseClient;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.value = value; } } });
Object.assign(window, { adaptiveFixture: {
  holdRequest: () => { holdRequest = true; }, releaseRequest: () => { holdRequest = false; releaseRequest?.(); },
  failSave: () => { failSave = true; }, failReadiness: (value: boolean) => { failReadiness = value; },
  snapshot: () => structuredClone({ row, state, calls, copied: copied.value }),
} });
createApp({ setup() { return () => h('main', { style: 'height:100vh;display:flex;flex-direction:column' }, [
  h('p', { style: 'padding:8px' }, 'Synthetic fixture — no production connection or scheduled task operations.'),
  h('output', { 'data-testid': 'fixture-events', style: 'padding:8px' }, `Saves: ${saveCount.value}; requests: ${requestCount.value}`),
  h(SearchTemplates, { userId: owner, projectId: project, client, lang: 'en', sidebarActive: false, style: 'flex:1;min-height:0' }),
]); } }).mount('#app');
