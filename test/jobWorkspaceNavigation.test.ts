import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, ref } from 'vue';
import type { Component } from 'vue';
import type { Application, Opportunity, OpportunityReview } from '../src/cloudTypes';
import { normalizeOpportunity } from '../src/composables/useJobWorkspace';

const filename = new URL('../src/components/JobWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'job-workspace-navigation-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext, options: { restoredOpportunityId?: string } = {}) {
  const storage = new Map<string, string>();
  if (options.restoredOpportunityId) storage.set('CV_SELECTED_OPPORTUNITY:account-one', options.restoredOpportunityId);
  let unmount = () => {};
  t.after(() => unmount());
  for (const [key, value] of Object.entries({
    window: { setInterval: () => 1, clearInterval() {} },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const opportunity = normalizeOpportunity({ id: 'opportunity-one', title: 'Robotics researcher', institution: 'Research University', deadline: null, topics: ['Robotics'], updated_at: '2026-09-20T12:00:00Z' });
  const application: Application = {
    id: 'application-one', user_id: 'account-one', opportunity_id: opportunity.id, cv_variant_id: null,
    contact_email: null, context_json: opportunity.details, context_captured_at: '2026-09-20T12:00:00Z',
    completed_checklist_keys: [], status: 'shortlist', notes: null, contacted_at: null, submitted_at: null,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  };
  const receipts: Opportunity[] = [];
  const reviews = ref<OpportunityReview[]>([]);
  const applications = ref<Application[]>([]);
  const opportunities = ref([opportunity]);
  let created = 0;
  const removed: string[] = [];
  const workspace = {
    opportunities, applications, reviews,
    loading: ref(false), saving: ref(false), error: ref(''), refresh() {},
    markOpportunityReviewed: async (item: Opportunity) => { receipts.push(item); },
    createApplication: async () => { created++; applications.value.push(application); return application; },
    updateApplication: async () => null, setApplicationChecklistItem: async () => false,
    removeApplication: async (id: string) => { removed.push(id); applications.value = applications.value.filter((item) => item.id !== id); return true; }, setOpportunityReview: async () => null,
    getApplicationContext: async () => null, refreshApplicationContext: async () => null,
  };
  const exports: { default?: Component } = {};
  const requireFromComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
    : path === '../composables/useJobWorkspace' ? { useJobWorkspace: () => workspace } : requireFromComponent(path), exports);
  const component = { ...exports.default, render: () => null };
  const props = reactive({ client: null, userId: 'account-one', tab: 'opportunities' as 'opportunities' | 'applications', lang: 'en', configurations: [], selectedId: '', readVersion: () => null });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; }, onNavigate: (tab: typeof props.tab) => { props.tab = tab; } }) });
  app.mount({});
  unmount = () => app.unmount();
  const setup = (mounted as { $: { setupState: {
    query: string; statusFilter: string; reviewFilter: string; hideWithApplication: boolean; sortBy: string;
    filteredOpportunities: Opportunity[]; selectedOpportunity?: Opportunity; showingDetail: boolean; editingApplication?: Application;
    opportunityGroups: { key: string; title: string; items: Opportunity[] }[];
    removingId: string | null; removalDialog: { open?: boolean; showModal(): void; close(): void };
    openOpportunity(id: string): void; closeOpportunity(): void; closeApplication(): void; startApplication(item: Opportunity): Promise<void>;
    requestDetailRemoval(item: Application): Promise<void>; cancelRemoval(): void; confirmRemoval(item: Application): Promise<void>;
  } } }).$.setupState;
  return { setup, props, opportunity, opportunities, application, receipts, reviews, storage, removed, created: () => created };
}

test('opportunity detail preserves filters and stays open after its review removes it from results', async (t) => {
  const { setup, opportunity, receipts, reviews, storage } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  await nextTick();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.deepEqual(receipts.map(({ id }) => id), [opportunity.id]);
  assert.equal(storage.get('CV_SELECTED_OPPORTUNITY:account-one'), opportunity.id);
  reviews.value = [{ user_id: 'account-one', opportunity_id: opportunity.id, state: 'not_interested', reviewed_updated_at: opportunity.updated_at, created_at: '', updated_at: '' }];
  assert.equal(setup.filteredOpportunities.length, 0);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id, 'selection is independent of current list filters');
  setup.closeOpportunity();
  await nextTick();
  assert.equal(setup.showingDetail, false);
  assert.equal(setup.query, 'Robotics');
  assert.equal(setup.reviewFilter, 'active');
  assert.equal(storage.has('CV_SELECTED_OPPORTUNITY:account-one'), false);
});

test('creating and reopening an application preserves opportunity selection and account boundaries', async (t) => {
  const { setup, props, opportunity, application, created } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  await setup.startApplication(opportunity);
  await nextTick();
  assert.equal(props.tab, 'applications');
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.query, '', 'application search remains independent');
  setup.closeApplication();
  props.tab = 'opportunities';
  await nextTick();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.query, 'Robotics');
  await setup.startApplication(opportunity);
  assert.equal(created(), 1, 'opening an existing application must not create a duplicate');
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.selectedOpportunity, undefined);
  assert.equal(setup.editingApplication, undefined);
  assert.equal(setup.showingDetail, false);
});

test('unvisited opportunities stay above visited results with independent sorting and filters', async (t) => {
  const { setup, opportunities, reviews, receipts } = mount(t);
  const old = '2025-01-01T12:00:00Z';
  const make = (id: string, title: string, institution: string, deadline: string) => normalizeOpportunity({ id, title, institution, deadline, topics: [], created_at: old, updated_at: '2026-09-21T12:00:00Z' });
  const unreadA = make('unread-a', 'Alpha engineering', 'Zulu University', '2099-12-10');
  const unreadZ = make('unread-z', 'Zulu engineering', 'Alpha University', '2099-12-01');
  const readA = make('read-a', 'Alpha physics', 'Zulu University', '2099-12-11');
  const readZ = make('read-z', 'Zulu physics', 'Alpha University', '2099-12-02');
  opportunities.value = [readA, unreadZ, readZ, unreadA];
  reviews.value = [readA, readZ].map((item) => ({ user_id: 'account-one', opportunity_id: item.id, state: 'unreviewed', reviewed_updated_at: old, created_at: old, updated_at: old }));
  const groupedIds = () => setup.opportunityGroups.map(({ key, items }) => [key, items.map(({ id }) => id)]);
  assert.deepEqual(groupedIds(), [['new', ['unread-z', 'unread-a']], ['visited', ['read-z', 'read-a']]], 'old unseen rows remain new, while later updates do not return visited rows to the new group');
  setup.sortBy = 'title';
  assert.deepEqual(groupedIds(), [['new', ['unread-a', 'unread-z']], ['visited', ['read-a', 'read-z']]]);
  setup.sortBy = 'institution';
  assert.deepEqual(groupedIds(), [['new', ['unread-z', 'unread-a']], ['visited', ['read-z', 'read-a']]]);
  setup.query = 'engineering';
  assert.deepEqual(groupedIds(), [['new', ['unread-z', 'unread-a']]]);
  setup.openOpportunity(unreadA.id);
  assert.deepEqual(groupedIds(), [['new', ['unread-z']], ['visited', ['unread-a']]], 'opening moves the result before the remote receipt is returned');
  await nextTick();
  assert.deepEqual(receipts.map(({ id }) => id), ['unread-a']);
  setup.closeOpportunity();
  assert.equal(setup.query, 'engineering');
  assert.deepEqual(groupedIds(), [['new', ['unread-z']], ['visited', ['unread-a']]]);
});

test('restoring opportunity detail records a visit and account changes clear local visits', async (t) => {
  const { setup, props, opportunity, receipts } = mount(t, { restoredOpportunityId: 'opportunity-one' });
  assert.equal(setup.showingDetail, true);
  assert.deepEqual(setup.opportunityGroups.map(({ key }) => key), ['visited']);
  assert.deepEqual(receipts.map(({ id }) => id), [opportunity.id]);
  props.userId = 'account-two';
  await nextTick();
  assert.deepEqual(setup.opportunityGroups.map(({ key }) => key), ['new']);
  assert.equal(setup.showingDetail, false);
});

test('application detail removal requires confirmation and cancellation preserves the selected item', async (t) => {
  const { setup, opportunity, application, removed } = mount(t);
  let dialogOpened = false;
  setup.removalDialog = { showModal() { dialogOpened = true; }, close() { dialogOpened = false; } };
  await setup.startApplication(opportunity);
  await setup.requestDetailRemoval(application);
  assert.equal(dialogOpened, true);
  assert.equal(setup.removingId, application.id);
  assert.deepEqual(removed, []);
  setup.cancelRemoval();
  assert.equal(dialogOpened, false);
  assert.equal(setup.removingId, null);
  assert.equal(setup.editingApplication?.id, application.id);
  assert.deepEqual(removed, []);
  await setup.requestDetailRemoval(application);
  await setup.confirmRemoval(application);
  assert.deepEqual(removed, [application.id]);
  assert.equal(dialogOpened, false);
  assert.equal(setup.editingApplication, undefined);
});
