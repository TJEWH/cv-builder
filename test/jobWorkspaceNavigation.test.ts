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
    query: string; statusFilter: string; reviewFilter: string; hideWithApplication: boolean; sortBy: string; deadlineFilter: 'current' | 'past'; now: Date;
    recencyById: Map<string, 'new' | 'updated' | null>; unseenById: Map<string, 'new' | 'updated' | null>;
    fitScoreById: Map<string, number | undefined>; fitTone(score: number | undefined): string | undefined; fitLabel(score: number | undefined): string;
    filteredOpportunities: Opportunity[]; filteredApplications: Application[]; selectedOpportunity?: Opportunity; showingDetail: boolean; editingApplication?: Application;
    opportunityGroups: { key: string; title: string; items: Opportunity[] }[];
    removingId: string | null; removalDialog: { open?: boolean; showModal(): void; close(): void };
    openOpportunity(id: string): void; closeOpportunity(): void; closeApplication(): void; startApplication(item: Opportunity): Promise<void>;
    requestDetailRemoval(item: Application): Promise<void>; cancelRemoval(): void; confirmRemoval(item: Application): Promise<void>;
  } } }).$.setupState;
  return { setup, props, opportunity, opportunities, application, applications, receipts, reviews, storage, removed, created: () => created };
}

test('application search matches server codes and full IDs, including applications without a code', async (t) => {
  const { setup, props, application, applications } = mount(t);
  const coded = { ...application, id: '30000000-0000-4000-8000-000000000001', application_code: 'APP-7K4M9Q' };
  const legacy = { ...application, id: '30000000-0000-4000-8000-000000000002', application_code: null };
  applications.value = [coded, legacy];
  props.tab = 'applications';
  await nextTick();
  setup.query = ' app-7k4m9q ';
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [coded.id]);
  setup.query = coded.id;
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [coded.id]);
  setup.query = legacy.id;
  assert.deepEqual(setup.filteredApplications.map(item => item.id), [legacy.id]);
  setup.query = 'Robotics';
  assert.equal(setup.filteredApplications.length, 2, 'title search remains available');
});

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

test('deadline options show mutually exclusive current and past opportunities and keep other filters', async (t) => {
  const { setup, opportunities, reviews, applications, application } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, deadline: unknown, extra: Record<string, unknown> = {}) => normalizeOpportunity({
    id, title: `Research ${id}`, deadline, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', ...extra,
  });
  const past = make('past', '2026-10-06T11:59:59Z');
  const exact = make('exact', '2026-10-06T12:00:00Z');
  const current = make('future', '2026-10-07T12:00:00Z');
  const unknown = make('unknown', null);
  const invalid = make('invalid', 'Open until filled');
  const uninterested = make('not-interested', null);
  const applied = make('applied', null);
  opportunities.value = [past, exact, current, unknown, invalid, uninterested, applied];
  reviews.value = [{ user_id: 'account-one', opportunity_id: uninterested.id, state: 'not_interested', reviewed_updated_at: null, created_at: '', updated_at: '' }];
  applications.value = [{ ...application, opportunity_id: applied.id }];
  const ids = () => setup.filteredOpportunities.map(item => item.id).sort();
  assert.equal(setup.deadlineFilter, 'current');
  assert.deepEqual(ids(), ['exact', 'future', 'invalid', 'unknown']);
  setup.deadlineFilter = 'past';
  assert.deepEqual(ids(), ['past'], 'past excludes every current or unknown deadline');
  setup.query = 'unknown';
  assert.deepEqual(ids(), [], 'search still combines with the deadline choice');
  setup.deadlineFilter = 'current';
  assert.deepEqual(ids(), ['unknown']);
  setup.query = '';
  setup.reviewFilter = 'all';
  setup.hideWithApplication = false;
  assert.deepEqual(ids(), ['applied', 'exact', 'future', 'invalid', 'not-interested', 'unknown']);
  setup.now = new Date('2026-10-06T12:00:00.001Z');
  assert.equal(ids().includes('exact'), false, 'current deadlines expire reactively');
  setup.deadlineFilter = 'past';
  assert.deepEqual(ids(), ['exact', 'past']);
  setup.openOpportunity(past.id);
  await nextTick();
  setup.closeOpportunity();
  assert.equal(setup.deadlineFilter, 'past', 'opening and closing does not reset the chosen deadline view');
});

test('personal fit sorts numeric structured scores high to low within groups, with zero before unknown', (t) => {
  const { setup, opportunities } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, score: unknown, extra: Record<string, unknown> = {}) => normalizeOpportunity({
    id, title: id, deadline: null, particularly_suitable: false,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    personal_fit: { score, summary: 'Synthetic fit rationale' }, ...extra,
  });
  const nested = make('nested-nine', undefined, { personal_fit: null, data: { personal_fit: { score: '9.1' } } });
  const missing = make('unknown', undefined);
  const zero = make('zero', 0);
  const ten = make('ten', 10);
  const recent = make('recent-eight', 8, { created_at: '2026-10-06T11:00:00Z', updated_at: '2026-10-06T11:00:00Z' });
  opportunities.value = [missing, zero, nested, recent, ten];
  setup.sortBy = 'personal_fit';
  assert.deepEqual(setup.opportunityGroups.map(({ key, items }) => [key, items.map(item => item.id)]), [
    ['recent', ['recent-eight']], ['other', ['ten', 'nested-nine', 'zero', 'unknown']],
  ], 'fit sorting also includes opportunities without the old strong-fit flag');
  for (const score of [-1, 11, NaN, Infinity, true, '', '9.8 / 10', 'high']) {
    opportunities.value = [make('invalid', score), zero, ten];
    assert.deepEqual(setup.filteredOpportunities.map(item => item.id), ['ten', 'zero', 'invalid'], String(score));
  }
});

test('strong-fit scores use the requested color boundaries without fabricating missing values', async (t) => {
  const { setup, opportunities, props } = mount(t);
  for (const [score, tone] of [[10, 'red'], [9.6, 'red'], [9.5, 'yellow'], [9.1, 'yellow'], [9, undefined], [8.8, undefined], [0, undefined], [undefined, undefined], [11, undefined]] as const) {
    const item = normalizeOpportunity({ id: 'strong-fit', title: 'Strong fit role', particularly_suitable: true, personal_fit: { score } });
    opportunities.value = [item];
    const parsed = setup.fitScoreById.get(item.id);
    assert.equal(setup.fitTone(parsed), tone, String(score));
    assert.equal(setup.fitLabel(parsed), score === undefined || score === 11 ? '' : `${score} / 10`);
  }
  props.lang = 'de';
  await nextTick();
  assert.equal(setup.fitLabel(9.6), '9,6 / 10');
});

test('only unseen additions and updates from the last 24 hours form a separate group', async (t) => {
  const { setup, opportunities, reviews, receipts } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const old = '2026-10-01T12:00:00Z';
  const recent = '2026-10-06T11:00:00Z';
  const make = (id: string, title: string, created: string, updated: string) => normalizeOpportunity({
    id, title, institution: title.startsWith('A') ? 'Zulu University' : 'Alpha University', deadline: null,
    created_at: created, updated_at: updated,
  });
  const added = make('added', 'Alpha engineering', recent, recent);
  const updated = make('updated', 'Zulu engineering', old, recent);
  const oldUnseen = make('old-unseen', 'Beta engineering', old, old);
  const oldChanged = make('old-changed', 'Gamma physics', old, '2026-10-04T12:00:00Z');
  const viewed = make('viewed', 'Delta physics', recent, recent);
  const boundary = make('exact-24h', 'Eta engineering', '2026-10-05T12:00:00Z', '2026-10-05T12:00:00Z');
  opportunities.value = [viewed, oldUnseen, updated, added, oldChanged, boundary];
  reviews.value = [
    { user_id: 'account-one', opportunity_id: updated.id, state: 'unreviewed', reviewed_updated_at: old, created_at: old, updated_at: old },
    { user_id: 'account-one', opportunity_id: oldChanged.id, state: 'unreviewed', reviewed_updated_at: old, created_at: old, updated_at: old },
    { user_id: 'account-one', opportunity_id: viewed.id, state: 'unreviewed', reviewed_updated_at: recent, created_at: recent, updated_at: recent },
  ];
  setup.sortBy = 'title';
  const groupedIds = () => setup.opportunityGroups.map(({ key, items }) => [key, items.map(item => item.id)]);
  assert.deepEqual(groupedIds(), [['recent', ['added', 'updated']], ['other', ['old-unseen', 'viewed', 'exact-24h', 'old-changed']]]);
  assert.deepEqual(setup.opportunityGroups.map(group => group.title), ['New & updated · 24h', 'Other opportunities']);
  assert.equal(setup.recencyById.get(boundary.id), null, 'exactly 24 hours is outside the recent group and tag');
  assert.equal(setup.recencyById.get(oldUnseen.id), null);
  assert.equal(setup.recencyById.get(oldChanged.id), null);
  assert.equal(setup.unseenById.get(oldUnseen.id), 'new', 'old unseen rows keep their left-border styling');
  assert.equal(setup.unseenById.get(oldChanged.id), 'updated', 'old unseen changes keep their updated left-border styling');
  assert.equal(setup.unseenById.get(viewed.id), null);
  setup.sortBy = 'institution';
  assert.deepEqual(groupedIds()[0], ['recent', ['updated', 'added']], 'other sorting applies within the recent group');
  setup.query = 'engineering';
  assert.deepEqual(groupedIds(), [['recent', ['updated', 'added']], ['other', ['old-unseen', 'exact-24h']]]);
  setup.openOpportunity(added.id);
  assert.deepEqual(groupedIds(), [['recent', ['updated']], ['other', ['old-unseen', 'exact-24h', 'added']]], 'opening removes the row from the recent group immediately, without waiting for its remote receipt');
  assert.equal(setup.unseenById.get(added.id), null);
  await nextTick();
  assert.deepEqual(receipts.map(({ id }) => id), [added.id]);
  setup.closeOpportunity();
  assert.equal(setup.query, 'engineering');
  assert.equal(setup.sortBy, 'institution');
  setup.now = new Date('2026-10-07T11:00:00Z');
  assert.deepEqual(groupedIds(), [['other', ['old-unseen', 'updated', 'exact-24h', 'added']]]);
  assert.equal(setup.opportunityGroups[0].title, '', 'a lone ordinary group has no heading');
  assert.equal(setup.recencyById.get(updated.id), null, 'the clock removes a stale 24h badge');
  assert.equal(setup.unseenById.get(updated.id), 'updated', 'expiration preserves its unread border until viewed');
});

test('opening timestamp-less opportunities acknowledges them locally until the account changes', async (t) => {
  const { setup, opportunities, props } = mount(t);
  const item = normalizeOpportunity({ id: 'without-version', title: 'Undated role' });
  opportunities.value = [item];
  assert.equal(setup.unseenById.get(item.id), 'new');
  setup.openOpportunity(item.id);
  assert.equal(setup.unseenById.get(item.id), null);
  assert.equal(setup.recencyById.get(item.id), null);
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.unseenById.get(item.id), 'new');
});

test('restoring opportunity detail records a visit and account changes clear local visits', async (t) => {
  const { setup, props, opportunity, receipts } = mount(t, { restoredOpportunityId: 'opportunity-one' });
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.unseenById.get(opportunity.id), null);
  assert.deepEqual(receipts.map(({ id }) => id), [opportunity.id]);
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.unseenById.get(opportunity.id), 'new');
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
