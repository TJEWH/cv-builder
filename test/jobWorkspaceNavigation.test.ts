import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, ref } from 'vue';
import type { Component } from 'vue';
import type { Application, ApplicationStage, Opportunity, OpportunityReview } from '../src/cloudTypes';
import { normalizeOpportunity } from '../src/composables/useJobWorkspace';
import { useToasts, useToastWatch } from '../src/composables/useToasts';

const filename = new URL('../src/components/JobWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'job-workspace-navigation-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext, options: { restoredOpportunityId?: string; active?: boolean } = {}) {
  useToasts().clear();
  t.after(() => useToasts().clear());
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
    completed_checklist_keys: [], status: 'preparation', workflow_stage: 'preparation', tracking_started: false, notes: null, contacted_at: null, submitted_at: null,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  };
  const receipts: Opportunity[] = [];
  const reviews = ref<OpportunityReview[]>([]);
  const applications = ref<Application[]>([]);
  const opportunities = ref([opportunity]);
  let created = 0;
  const removed: string[] = [];
  const applicationUpdates: { id: string; changes: Partial<Application> }[] = [];
  const commentUpdates: { id: string; comment: string }[] = [];
  const stageUpdates: { id: string; stage: ApplicationStage }[] = [];
  let failNotes = false;
  let failComment = false;
  const saveApplication = (id: string, changes: Partial<Application>) => {
    const current = applications.value.find(item => item.id === id);
    if (!current) return null;
    const saved = { ...current, ...changes };
    applications.value = applications.value.map(item => item.id === id ? saved : item);
    return saved;
  };
  const workspace = {
    opportunities, applications, reviews,
    loading: ref(false), saving: ref(false), error: ref(''), opportunityCommentError: ref(''), refresh() {},
    markOpportunityReviewed: async (item: Opportunity) => { receipts.push(item); },
    createApplication: async () => { created++; applications.value.push(application); return application; },
    updateApplication: async (id: string, changes: Partial<Application>) => {
      applicationUpdates.push({ id, changes });
      if (failNotes && 'notes' in changes) { failNotes = false; return null; }
      return saveApplication(id, { ...changes, ...(changes.status ? { tracking_started: true } : {}) });
    },
    setApplicationStage: async (id: string, stage: ApplicationStage) => {
      stageUpdates.push({ id, stage });
      const current = applications.value.find(item => item.id === id);
      const status = ({ preparation: 'preparation', refinement: 'refinement', review: 'attachments', tracking: 'ready' } as const)[stage];
      return saveApplication(id, { workflow_stage: stage, ...(!current?.tracking_started ? { status } : {}) });
    },
    setApplicationChecklistItem: async () => false,
    setOpportunityComment: async (id: string, comment: string) => {
      commentUpdates.push({ id, comment });
      if (failComment) { failComment = false; return null; }
      const current = reviews.value.find(item => item.opportunity_id === id);
      const saved: OpportunityReview = { user_id: 'account-one', opportunity_id: id, state: 'unreviewed', reviewed_updated_at: null, created_at: '', updated_at: '', ...current, comment: comment.trim() || null };
      reviews.value = [...reviews.value.filter(item => item.opportunity_id !== id), saved];
      return saved;
    },
    removeApplication: async (id: string) => { removed.push(id); applications.value = applications.value.filter((item) => item.id !== id); return true; }, setOpportunityReview: async () => null,
    getApplicationContext: async () => null, refreshApplicationContext: async () => null,
  };
  const exports: { default?: Component } = {};
  const requireFromComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
    : path === '../composables/useJobWorkspace' ? { useJobWorkspace: () => workspace }
    : path === '../composables/useToasts' ? { useToasts, useToastWatch } : requireFromComponent(path), exports);
  const component = { ...exports.default, render: () => null };
  const props = reactive({ client: null, userId: 'account-one', tab: 'opportunities' as 'opportunities' | 'applications', lang: 'en', configurations: [], selectedId: '', readVersion: () => null, ...(options.active === undefined ? {} : { active: options.active }) });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; }, onNavigate: (tab: typeof props.tab) => { props.tab = tab; } }) });
  app.mount({});
  unmount = () => app.unmount();
  const setup = (mounted as { $: { setupState: {
    query: string; statusFilter: string; reviewFilter: string; hideWithApplication: boolean; hideNotInterested: boolean; sortBy: string; applicationSortBy: string; deadlineFilter: 'current' | 'past'; now: Date;
    statusLabel(status: string): string;
    notes: string; notesStatus: string; notesError: string; flushNotes(): Promise<boolean>;
    opportunityComment: string; commentStatus: string; commentError: string; flushComment(): Promise<boolean>;
    recencyById: Map<string, 'new' | 'updated' | null>; unseenById: Map<string, 'new' | 'updated' | null>;
    fitScoreById: Map<string, number | undefined>; fitTone(score: number | undefined): string | undefined; fitLabel(score: number | undefined): string;
    filteredOpportunities: Opportunity[]; filteredApplications: Application[]; selectedOpportunity?: Opportunity; showingDetail: boolean; editingApplication?: Application;
    opportunityGroups: { key: string; title: string; items: Opportunity[] }[];
    removingId: string | null; removalDialog: { open?: boolean; showModal(): void; close(): void };
    openOpportunity(id: string): void; closeOpportunity(): Promise<void>; closeApplication(): Promise<void>; startApplication(item: Opportunity): Promise<void>;
    openApplication(item: Application): void; openList(kind: 'opportunities' | 'applications'): Promise<boolean>; navigateDetail(direction: -1 | 1): Promise<void>;
    changeApplicationStatus(item: Application, event: Event): Promise<void>;
    requestDetailRemoval(item: Application): Promise<void>; cancelRemoval(): void; confirmRemoval(item: Application): Promise<void>;
  } } }).$.setupState;
  const componentProps = (mounted as { $props: { active: boolean } }).$props;
  return { setup, props, componentProps, opportunity, opportunities, application, applications, receipts, reviews, storage, removed, applicationUpdates, commentUpdates, stageUpdates, failNextNotesSave: () => { failNotes = true; }, failNextCommentSave: () => { failComment = true; }, created: () => created };
}

test('opportunity navigation follows captured group order, skips removed results, and stops at either end', async (t) => {
  const { setup, opportunities, reviews } = mount(t);
  setup.now = new Date('2026-10-06T12:00:00Z');
  const make = (id: string, title: string, recent = false) => normalizeOpportunity({
    id, title, deadline: null,
    created_at: recent ? '2026-10-06T11:00:00Z' : '2026-10-01T12:00:00Z',
    updated_at: recent ? '2026-10-06T11:00:00Z' : '2026-10-01T12:00:00Z',
  });
  const alpha = make('alpha', 'Research Alpha');
  const bravo = make('bravo', 'Research Bravo', true);
  const charlie = make('charlie', 'Research Charlie');
  const delta = make('delta', 'Research Delta', true);
  opportunities.value = [charlie, delta, make('excluded', 'Other role', true), bravo, alpha];
  setup.query = 'Research';
  setup.sortBy = 'title';
  assert.deepEqual(setup.opportunityGroups.flatMap(group => group.items.map(item => item.id)), ['bravo', 'delta', 'alpha', 'charlie']);
  setup.openOpportunity(bravo.id);
  assert.deepEqual(setup.opportunityGroups.flatMap(group => group.items.map(item => item.id)), ['delta', 'alpha', 'bravo', 'charlie']);
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, bravo.id, 'the first result does not wrap to the last');
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, delta.id, 'read receipts do not change the captured navigation order');
  reviews.value = [{ user_id: 'account-one', opportunity_id: delta.id, state: 'not_interested', reviewed_updated_at: delta.updated_at, created_at: '', updated_at: '' }];
  assert.equal(setup.filteredOpportunities.some(item => item.id === delta.id), false);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, alpha.id, 'a review that hides the current result still allows navigation');
  opportunities.value = opportunities.value.filter(item => item.id !== delta.id);
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, bravo.id, 'removed results are skipped');
  await setup.navigateDetail(1);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, charlie.id);
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, charlie.id, 'the last result does not wrap to the first');
  assert.equal(setup.query, 'Research');
  assert.equal(setup.sortBy, 'title');
  assert.equal(setup.hideNotInterested, true);
});

test('opportunity navigation saves evaluations and retains the current draft when saving fails', async (t) => {
  const { setup, opportunity, opportunities, reviews, failNextCommentSave } = mount(t);
  const other = normalizeOpportunity({ id: 'other', title: 'Second research role', deadline: null });
  opportunities.value = [opportunity, other];
  setup.sortBy = 'title';
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Ask about access to the robotics lab.';
  failNextCommentSave();
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Ask about access to the robotics lab.');
  assert.equal(setup.commentStatus, 'error');
  await setup.navigateDetail(1);
  assert.equal(setup.selectedOpportunity?.id, other.id);
  assert.equal(setup.opportunityComment, '');
  assert.equal(reviews.value.find(item => item.opportunity_id === opportunity.id)?.comment, 'Ask about access to the robotics lab.');
  await setup.navigateDetail(-1);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Ask about access to the robotics lab.');
});

test('application navigation follows sorted filtered results and saves notes before changing the selection', async (t) => {
  const { setup, props, application, applications, failNextNotesSave } = mount(t);
  const make = (id: string, title: string): Application => ({ ...application, id, context_json: { ...application.context_json, title, institution: 'Example University', university: 'Example University' } });
  const alpha = make('alpha', 'Research Alpha');
  const bravo = make('bravo', 'Research Bravo');
  const charlie = make('charlie', 'Research Charlie');
  applications.value = [charlie, { ...make('excluded-status', 'Research Between'), status: 'submitted' }, bravo, make('excluded-query', 'Other role'), alpha];
  props.tab = 'applications';
  await nextTick();
  setup.query = 'Research';
  setup.statusFilter = 'preparation';
  setup.applicationSortBy = 'title';
  assert.deepEqual(setup.filteredApplications.map(item => item.id), ['alpha', 'bravo', 'charlie']);
  setup.openApplication(alpha);
  await setup.navigateDetail(-1);
  assert.equal(setup.editingApplication?.id, alpha.id);
  setup.notes = 'Discuss the start date.';
  failNextNotesSave();
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, alpha.id);
  assert.equal(setup.notes, 'Discuss the start date.');
  assert.equal(setup.notesStatus, 'error');
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, bravo.id);
  assert.equal(applications.value.find(item => item.id === alpha.id)?.notes, 'Discuss the start date.');
  assert.equal(setup.notes, '');
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, charlie.id);
  await setup.navigateDetail(1);
  assert.equal(setup.editingApplication?.id, charlie.id, 'the last application does not wrap');
  applications.value = applications.value.filter(item => item.id !== bravo.id);
  await setup.navigateDetail(-1);
  assert.equal(setup.editingApplication?.id, alpha.id, 'removed applications are skipped');
  assert.equal(setup.notes, 'Discuss the start date.');
  assert.equal(setup.query, 'Research');
  assert.equal(setup.statusFilter, 'preparation');
  assert.equal(setup.applicationSortBy, 'title');
});

test('workspace list navigation clears same-tab and cross-tab details while internal application links still open details', async (t) => {
  const { setup, props, opportunity, application, storage, created } = mount(t);
  setup.query = 'Robotics';
  setup.openOpportunity(opportunity.id);
  assert.equal(await setup.openList('opportunities'), true);
  await nextTick();
  assert.equal(setup.showingDetail, false);
  assert.equal(storage.has('CV_SELECTED_OPPORTUNITY:account-one'), false);
  assert.equal(setup.query, 'Robotics');
  setup.openOpportunity(opportunity.id);
  await setup.startApplication(opportunity);
  assert.equal(props.tab, 'applications');
  assert.equal(setup.editingApplication?.id, application.id, 'internal creation opens the resulting application');
  setup.query = 'Research';
  assert.equal(await setup.openList('opportunities'), true);
  props.tab = 'opportunities';
  await nextTick();
  assert.equal(setup.showingDetail, false, 'switching to opportunities clears its remembered detail');
  assert.equal(setup.query, 'Robotics');
  assert.equal(await setup.openList('applications'), true);
  props.tab = 'applications';
  await nextTick();
  assert.equal(setup.showingDetail, false, 'switching to applications clears its remembered detail');
  assert.equal(setup.query, 'Research');
  assert.equal(storage.has('CV_SELECTED_APPLICATION:account-one'), false);
  await setup.startApplication(opportunity);
  assert.equal(created(), 1, 'an internal link reopens the existing application');
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(await setup.openList('applications'), true);
  assert.equal(setup.showingDetail, false, 'clicking the active applications tab returns to its list');
});

test('workspace list navigation remains in the current detail until evaluation and notes saves succeed', async (t) => {
  const { setup, props, opportunity, application, reviews, applications, failNextCommentSave, failNextNotesSave } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Funding needs clarification.';
  failNextCommentSave();
  assert.equal(await setup.openList('applications'), false);
  assert.equal(props.tab, 'opportunities');
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  assert.equal(setup.opportunityComment, 'Funding needs clarification.');
  assert.equal(await setup.openList('opportunities'), true);
  assert.equal(reviews.value[0].comment, 'Funding needs clarification.');
  await setup.startApplication(opportunity);
  setup.notes = 'Confirm funding before submitting.';
  failNextNotesSave();
  assert.equal(await setup.openList('applications'), false);
  assert.equal(setup.editingApplication?.id, application.id);
  assert.equal(setup.notes, 'Confirm funding before submitting.');
  assert.equal(await setup.openList('applications'), true);
  assert.equal(setup.showingDetail, false);
  assert.equal(applications.value[0].notes, 'Confirm funding before submitting.');
});

test('the latest list request wins and opening a detail cancels a pending list request', async (t) => {
  const { setup, opportunity } = mount(t);
  setup.openOpportunity(opportunity.id);
  const earlier = setup.openList('opportunities');
  const later = setup.openList('applications');
  assert.deepEqual(await Promise.all([earlier, later]), [false, true]);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
  const pending = setup.openList('opportunities');
  setup.openOpportunity(opportunity.id);
  assert.equal(await pending, false);
  assert.equal(setup.selectedOpportunity?.id, opportunity.id);
});

test('opportunity comments save before closing, reopen independently, and can be cleared', async (t) => {
  const { setup, opportunity, opportunities, reviews, commentUpdates } = mount(t);
  const other = normalizeOpportunity({ id: 'other-opportunity', title: 'Different research' });
  opportunities.value.push(other);
  reviews.value = [{ user_id: 'account-one', opportunity_id: opportunity.id, state: 'strong_interest', comment: 'Great supervisor match.', reviewed_updated_at: opportunity.updated_at, created_at: '', updated_at: '' }];
  setup.openOpportunity(opportunity.id);
  assert.equal(setup.opportunityComment, 'Great supervisor match.');
  setup.opportunityComment = 'Strong fit: hands-on robotics and funded research.';
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, false);
  assert.deepEqual(commentUpdates, [{ id: opportunity.id, comment: 'Strong fit: hands-on robotics and funded research.' }]);
  assert.equal(reviews.value[0].state, 'strong_interest');
  setup.openOpportunity(other.id);
  assert.equal(setup.opportunityComment, '');
  setup.openOpportunity(opportunity.id);
  assert.equal(setup.opportunityComment, commentUpdates[0].comment);
  setup.opportunityComment = '';
  assert.equal(await setup.flushComment(), true);
  assert.equal(reviews.value[0].comment, null);
  assert.equal(reviews.value[0].state, 'strong_interest');
});

test('failed opportunity comment saves retain the draft and detail until retry succeeds', async (t) => {
  const { setup, opportunity, reviews, failNextCommentSave } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Not interesting: the work is mostly theoretical.';
  failNextCommentSave();
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, true);
  assert.equal(setup.commentStatus, 'error');
  assert.match(setup.commentError, /Could not save your evaluation/);
  assert.equal(setup.opportunityComment, 'Not interesting: the work is mostly theoretical.');
  await setup.closeOpportunity();
  assert.equal(setup.showingDetail, false);
  assert.equal(reviews.value[0].comment, 'Not interesting: the work is mostly theoretical.');
});

test('creating an application flushes opportunity comments and stops when saving fails', async (t) => {
  const { setup, opportunity, reviews, failNextCommentSave, created } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Ask about access to the robotics lab.';
  failNextCommentSave();
  await setup.startApplication(opportunity);
  assert.equal(created(), 0);
  await setup.startApplication(opportunity);
  assert.equal(created(), 1);
  assert.equal(reviews.value[0].comment, 'Ask about access to the robotics lab.');
});

test('switching accounts cancels pending opportunity comments and clears the editor', async (t) => {
  const { setup, props, opportunity, commentUpdates } = mount(t);
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Private account-one reasoning.';
  props.userId = 'account-two';
  await nextTick();
  assert.equal(setup.opportunityComment, '');
  assert.equal(setup.selectedOpportunity, undefined);
  assert.deepEqual(commentUpdates, []);
});

test('evaluation save feedback uses one toast and does not announce untouched fields', async (t) => {
  const { setup, opportunity } = mount(t);
  const { toasts } = useToasts();
  setup.openOpportunity(opportunity.id);
  await nextTick();
  assert.equal(toasts.value.length, 0);
  setup.opportunityComment = 'Strong match with my research.';
  await nextTick();
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].message, 'Saving evaluation…');
  const toastId = toasts.value[0].id;
  await setup.flushComment();
  await nextTick();
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].id, toastId);
  assert.equal(toasts.value[0].message, 'Evaluation saved.');
  assert.equal(toasts.value[0].tone, 'success');
  await setup.closeOpportunity();
  await nextTick();
  assert.equal(toasts.value[0].message, 'Evaluation saved.', 'closing does not remove the success before it can be seen');
});

test('failed evaluation saves offer a toast retry and stale retries cannot save a different account', async (t) => {
  const { setup, props, opportunity, commentUpdates, failNextCommentSave } = mount(t);
  const { toasts } = useToasts();
  setup.openOpportunity(opportunity.id);
  setup.opportunityComment = 'Funding is unclear.';
  failNextCommentSave();
  await setup.flushComment();
  await nextTick();
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].tone, 'error');
  assert.equal(toasts.value[0].action?.label, 'Retry');
  const retry = toasts.value[0].action!.run;
  await retry();
  await nextTick();
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].message, 'Evaluation saved.');
  setup.opportunityComment = 'A newer private evaluation.';
  failNextCommentSave();
  await setup.flushComment();
  await nextTick();
  const staleRetry = toasts.value[0].action!.run;
  props.userId = 'account-two';
  await nextTick();
  assert.equal(toasts.value.length, 0);
  const writes = commentUpdates.length;
  await staleRetry();
  assert.equal(commentUpdates.length, writes);
});

test('standalone workspaces activate sidebar controls by default while accepting explicit inactivity', async (t) => {
  const { props, componentProps } = mount(t);
  assert.equal(componentProps.active, true);
  props.active = false;
  await nextTick();
  assert.equal(componentProps.active, false);
});

test('strong-interest reviews remain filterable for current and past opportunities regardless of score', (t) => {
  const { setup, props, opportunity, opportunities, reviews } = mount(t);
  const past = normalizeOpportunity({ id: 'past', title: 'Materials discovery', deadline: '2025-01-01', personal_fit: { score: 5.8 }, original_search: 'Materials' });
  opportunities.value.push(past);
  reviews.value = [opportunity, past].map(item => ({ user_id: props.userId, opportunity_id: item.id, state: 'strong_interest', reviewed_updated_at: item.updated_at, created_at: '', updated_at: '' }));
  setup.reviewFilter = 'strong_interest';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [opportunity.id]);
  setup.deadlineFilter = 'past';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [past.id]);
  reviews.value[1].state = 'interested';
  assert.equal(setup.filteredOpportunities.length, 0);
});

test('hide not interesting is an independent checkbox that combines with review and application filters', (t) => {
  const { setup, props, opportunity, opportunities, reviews, applications, application } = mount(t);
  const ignored = normalizeOpportunity({ id: 'ignored', title: 'Ignored opportunity', deadline: null });
  opportunities.value.push(ignored);
  reviews.value = [
    { user_id: props.userId, opportunity_id: opportunity.id, state: 'strong_interest', reviewed_updated_at: null, created_at: '', updated_at: '' },
    { user_id: props.userId, opportunity_id: ignored.id, state: 'not_interested', reviewed_updated_at: null, created_at: '', updated_at: '' },
  ];
  assert.equal(setup.reviewFilter, 'all');
  assert.equal(setup.hideNotInterested, true);
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [opportunity.id]);
  setup.hideNotInterested = false;
  assert.equal(setup.filteredOpportunities.length, 2);
  setup.reviewFilter = 'not_interested';
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [ignored.id]);
  applications.value = [{ ...application, opportunity_id: ignored.id }];
  assert.equal(setup.filteredOpportunities.length, 0);
  setup.hideWithApplication = false;
  assert.deepEqual(setup.filteredOpportunities.map(item => item.id), [ignored.id]);
  setup.hideNotInterested = true;
  assert.equal(setup.filteredOpportunities.length, 0);
  assert.equal(setup.reviewFilter, 'not_interested', 'the checkbox preserves the chosen review filter');
});

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

test('application status filters include each preparation stage and Ready alongside tracking states', async (t) => {
  const { setup, props, application, applications } = mount(t);
  const statuses = ['preparation', 'refinement', 'attachments', 'ready', 'contacted', 'submitted'] as const;
  applications.value = statuses.map(status => ({ ...application, id: `application-${status}`, status }));
  props.tab = 'applications';
  await nextTick();
  for (const status of statuses) {
    setup.statusFilter = status;
    assert.deepEqual(setup.filteredApplications.map(item => item.id), [`application-${status}`]);
  }
  assert.deepEqual(statuses.slice(0, 4).map(status => setup.statusLabel(status)), ['Preparation', 'Refinement', 'Attachments', 'Ready']);
  setup.statusFilter = '';
  assert.equal(setup.filteredApplications.length, statuses.length);
});

test('tracking dropdown flushes pending notes and selecting Ready starts tracking even when already ready', async (t) => {
  const { setup, opportunity, applications, applicationUpdates } = mount(t);
  await setup.startApplication(opportunity);
  applications.value = applications.value.map(item => ({ ...item, workflow_stage: 'tracking', status: 'ready' }));
  await nextTick();
  setup.notes = 'Ask about the project start date.';
  const select = { value: 'ready' };
  await setup.changeApplicationStatus(setup.editingApplication!, { target: select } as unknown as Event);
  assert.deepEqual(applicationUpdates.map(update => update.changes), [{ notes: 'Ask about the project start date.' }, { status: 'ready' }]);
  assert.equal(setup.editingApplication?.notes, 'Ask about the project start date.');
  assert.equal(setup.editingApplication?.tracking_started, true);
  assert.equal(setup.notesStatus, 'saved');
});

test('closing an application flushes its latest notes and reopening restores the saved value', async (t) => {
  const { setup, opportunity, applications, applicationUpdates } = mount(t);
  await setup.startApplication(opportunity);
  setup.notes = 'A final note before leaving.';
  await setup.closeApplication();
  assert.equal(setup.editingApplication, undefined);
  assert.equal(applications.value[0].notes, 'A final note before leaving.');
  assert.equal(applicationUpdates.length, 1);
  await setup.startApplication(opportunity);
  assert.equal(setup.notes, 'A final note before leaving.');
});

test('failed note autosave keeps the application open and retains the draft for retry', async (t) => {
  const { setup, opportunity, failNextNotesSave } = mount(t);
  await setup.startApplication(opportunity);
  setup.notes = 'Keep this note when the connection fails.';
  failNextNotesSave();
  await setup.closeApplication();
  assert.ok(setup.editingApplication);
  assert.equal(setup.notes, 'Keep this note when the connection fails.');
  assert.equal(setup.notesStatus, 'error');
  await setup.closeApplication();
  assert.equal(setup.editingApplication, undefined);
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
  assert.equal(setup.reviewFilter, 'all');
  assert.equal(setup.hideNotInterested, true);
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
  await setup.closeApplication();
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
  setup.hideNotInterested = false;
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
