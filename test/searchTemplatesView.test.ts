import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createSSRApp, h, ref, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';

const filename = new URL('../src/components/SearchTemplates.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'search-templates-view-test', inlineTemplate: true, templateOptions: { ssr: true } });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentRequire = createRequire(filename);

function facade() {
  const template = { id: 'search-1', name: 'Instrument research', revision: 1,
    criteria: { opportunityTypes: 'Funded PhD', topicsAndMethods: '', locationsAndLanguages: '', fundingAndConditions: '', fitAndExclusions: '', sourcesAndQueries: '', researchAndReporting: '' },
    schedule: { frequency: 'weekly', intervalHours: 6, weekdays: [1], time: '09:00', timezone: 'Europe/Berlin', runImmediately: true },
  };
  return {
    templates: ref([template]), form: ref(template), selectedId: ref(template.id), status: ref('saved'),
    error: ref(''), validationError: ref(''), databaseLabel: ref('example-project.supabase.co'), latestRun: ref<null | Record<string, unknown>>(null),
    scheduleConfirmation: ref<null | Record<string, unknown>>(null), promptPreview: ref(''), loading: ref(false), copying: ref(false), notice: ref(''),
    select: async () => {}, createBlank: async () => {}, createStarter: async () => {}, duplicate: async () => {}, flushSave: async () => true,
    copyPrompt: async () => {}, preparePrompt: async () => {}, retrySave: async () => {}, reloadRemote: async () => {},
  };
}
async function render(state: ReturnType<typeof facade>, lang = 'en') {
  const component: { default?: Component } = {};
  new Function('require', 'exports', code)((path: string) => {
    if (path.endsWith('/opportunitySearchTemplates')) return { useOpportunitySearchTemplates: () => state };
    if (path.endsWith('/desktopSidebar')) return { useDesktopSidebar: () => ref(false) };
    if (path.endsWith('.vue')) return { default: { inheritAttrs: false, setup: (_props: unknown, context: { slots: { default?: () => unknown } }) => () => context.slots.default?.() } };
    return componentRequire(path);
  }, component);
  return renderToString(createSSRApp({ render: () => h(component.default!, { userId: 'owner', client: null, lang }) }));
}

test('search editor exposes all seven criteria, explicit timezone and schedule verification without claiming activation', async () => {
  const html = await render(facade());
  for (const label of ['Opportunity types and availability', 'Topics and methods', 'Locations and languages', 'Funding and conditions', 'Fit and exclusions', 'Sources and query guidance', 'Research and reporting guidance']) assert.ok(html.includes(label), label);
  assert.match(html, /value="Europe\/Berlin"/);
  assert.match(html, /value="09:00"/);
  assert.match(html, /Run immediately to verify/);
  assert.match(html, /No confirmed schedule yet/);
  assert.match(html, /No recorded run yet/);
  assert.match(html, /Copying a prompt does not create a schedule/);
  assert.match(html, /blank fields add no restriction/);
  assert.doesNotMatch(html, /<h1|Connected database|>Select all<|>Preview prompt<|>Prepare preview</);
  assert.equal(html.match(/>Copy setup prompt</g)?.length, 1);
  assert.match(html, /<p class="app-hint"[^>]*>/);
  assert.match(html, /<section class="search-prompt-section"[^>]*>[\s\S]*?<textarea[^>]*readonly/);
  assert.doesNotMatch(html, /<details[^>]*class="[^"]*search-prompt-section/);
});

test('only recorded schedule confirmation changes the copy action; prompt preview remains selectable plain text', async () => {
  const state = facade();
  state.promptPreview.value = 'Run saved search <search-1>.\nNever display <script>markup</script>.';
  let html = await render(state);
  assert.match(html, /Copy setup prompt/);
  assert.doesNotMatch(html, /Copy update prompt/);
  assert.match(html, /readonly[^>]*>Run saved search &lt;search-1&gt;/);
  assert.doesNotMatch(html, /<script>markup<\/script>/);
  state.scheduleConfirmation.value = { task_id: 'task-confirmed-1', confirmed_at: '2026-10-12T09:00:00Z' };
  state.latestRun.value = { status: 'completed', completed_at: '2026-10-12T08:59:00Z', summary: 'No new matches.' };
  html = await render(state);
  assert.match(html, /Copy update prompt/);
  assert.match(html, /task-confirmed-1/);
  assert.match(html, /No new matches\./);
  assert.doesNotMatch(html, /No confirmed schedule yet/);
});

test('failed drafts retain a visible recovery path and disable ordinary refresh that would discard them', async () => {
  const state = facade();
  state.status.value = 'error';
  state.error.value = 'A newer version exists. Keep this draft or reload the saved version.';
  const html = await render(state);
  assert.match(html, /role="alert"/);
  assert.match(html, /Changes not saved/);
  assert.match(html, /Discard local draft and reload/);
  assert.match(html, /<button type="button" disabled[^>]*>Refresh<\/button>/);
});

test('German search controls and verification guidance stay localized', async () => {
  const html = await render(facade(), 'de');
  for (const label of ['Suchvorlagen', 'Suchkriterien', 'Zeitzone', 'Zur Prüfung sofort ausführen', 'Noch kein bestätigter Zeitplan', 'Einrichtungs-Prompt kopieren']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, />Saved to Supabase</);
});
