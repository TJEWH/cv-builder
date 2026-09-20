import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, OpportunityReview } from '../src/cloudTypes';
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { normalizeOpportunity, useJobWorkspace } from '../src/composables/useJobWorkspace';
import { opportunityRecency } from '../src/composables/opportunityRecency';
import { createTestState, stub } from './helpers';

interface Query {
  table: string;
  operation: 'select' | 'update' | 'rpc' | 'upsert';
  fields?: string;
  filters: Record<string, unknown>;
  payload?: Record<string, unknown>;
  range?: [number, number];
  single?: boolean;
  signal?: AbortSignal;
  orderColumn?: string;
  onConflict?: string;
}
interface Result { data: unknown; error: unknown; count?: number }
function fakeClient(handler: (query: Query) => Result | Promise<Result>) {
  const queries: Query[] = [];
  function query(table: string, operation: Query['operation'] = 'select', payload?: Record<string, unknown>) {
    const request: Query = { table, operation, filters: {}, payload };
    const builder = {
      select(fields: string) { request.fields = fields; return builder; },
      order(column: string) { request.orderColumn = column; return builder; },
      range(from: number, to: number) { request.range = [from, to]; return builder; },
      eq(key: string, value: unknown) { request.filters[key] = value; return builder; },
      abortSignal(signal: AbortSignal) { request.signal = signal; return builder; },
      single() { request.single = true; return builder; },
      update(value: Record<string, unknown>) { request.operation = 'update'; request.payload = value; return builder; },
      upsert(value: Record<string, unknown>, options: { onConflict: string }) { request.operation = 'upsert'; request.payload = value; request.onConflict = options.onConflict; return builder; },
      then(resolve: (result: Result) => unknown, reject: (reason: unknown) => unknown) {
        queries.push(request);
        return Promise.resolve().then(() => handler(request)).then(resolve, reject);
      },
    };
    return builder;
  }
  return { queries, client: stub<SupabaseClient>({ from: query, rpc: (name: string, parameters: Record<string, unknown>) => query(name, 'rpc', parameters) }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function settleUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('The asynchronous operation did not settle.');
}
function application(id = 'application-1', cvId: string | null = 'cv-1'): Application {
  return { id, user_id: 'account-a', opportunity_id: 'opportunity-1', cv_variant_id: cvId,
    contact_email: 'employer@example.org', status: 'shortlist', completed_checklist_keys: [], notes: null, contacted_at: null, submitted_at: null,
    context_json: { title: 'Researcher', requirements: ['Degree'], supervisor_research_focus: { robotics: 'Applied robotics' }, supervisor_top_papers: [{ title: 'Paper', year: 2025 }] },
    context_captured_at: '2026-09-19T16:00:00.000Z',
    created_at: '2026-09-19T16:00:00.000Z', updated_at: '2026-09-19T16:00:00.000Z' };
}

function review(opportunityId = 'opportunity-1', state: OpportunityReview['state'] = 'interested'): OpportunityReview {
  return { user_id: 'account-a', opportunity_id: opportunityId, state, reviewed_updated_at: null, created_at: '2026-09-19T16:00:00.000Z', updated_at: '2026-09-19T16:00:00.000Z' };
}

test('opportunity normalization preserves shared catalogue research and aliases JSON values', () => {
  const contacts = [{ name: 'Professor Example', email: 'employer@example.org' }];
  const row = { id: 'job', title: 'Researcher', institution: 'Institute', contacts, supervisors: [{ name: 'Professor Example' }],
    salary: { amount: 50000, currency: 'EUR' }, requirements: ['Degree'], topics: ['Robotics'], extra_research: 'Preserved',
    supervisor_research_focus: { robotics: 'Applied robotics' }, supervisor_top_papers: [{ title: 'Paper', year: 2025 }] };
  const result = normalizeOpportunity(row);
  assert.equal(result.university, 'Institute');
  assert.deepEqual(result.contact, contacts);
  assert.equal(result.supervisor, 'name: Professor Example');
  assert.equal(result.salary_text, 'amount: 50000; currency: EUR');
  assert.deepEqual(result.supervisor_research_focus, row.supervisor_research_focus);
  assert.deepEqual(result.supervisor_top_papers, row.supervisor_top_papers);
  assert.deepEqual(result.details, row);
});

test('standalone mode performs no cloud calls and pagination loads all shared opportunities', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.table === 'opportunities'
    ? Array.from({ length: query.range?.[0] === 0 ? 500 : 2 }, (_, index) => ({ id: String((query.range?.[0] ?? 0) + index), title: 'Researcher' })) : [], error: null }));
  const scope = effectScope();
  const account = ref<string | null>(null);
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  assert.equal(await workspace.refresh(), false);
  assert.equal(queries.length, 0);
  account.value = 'account-a';
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.opportunities.value.length, 502);
  assert.deepEqual(queries.filter(({ table }) => table === 'opportunities').map(({ range }) => range), [[0, 499], [500, 999]]);
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ filters }) => !('user_id' in filters)));
  assert.ok(queries.filter(({ table }) => table !== 'opportunities').every(({ filters }) => filters.user_id === 'account-a'));
  assert.equal(queries.find(({ table }) => table === 'cv_variants')?.fields?.includes('content_json'), false);
  assert.equal(queries.find(({ table }) => table === 'opportunity_reviews')?.orderColumn, 'opportunity_id');
  scope.stop();
});

test('account changes clear old rows immediately and discard late network replies', async () => {
  const oldRead = deferred<Result>();
  let hold = false;
  const { client, queries } = fakeClient((query) => hold ? oldRead.promise : { data: query.table === 'opportunities'
    ? [{ id: 'job-a', title: 'Old catalogue row' }] : query.table === 'applications' ? [application()] : query.table === 'opportunity_reviews' ? [review()] : [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.applications.value.length, 1);
  assert.equal(workspace.reviews.value.length, 1);
  hold = true;
  const reading = workspace.refresh();
  await settleUntil(() => queries.length === 8);
  account.value = null;
  assert.deepEqual(workspace.applications.value, []);
  assert.deepEqual(workspace.opportunities.value, []);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  assert.ok(queries.slice(4).every(({ signal }) => signal?.aborted));
  oldRead.resolve({ data: [application('stale-application')], error: null });
  assert.equal(await reading, false);
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('pagination also honors projects with an API row limit below the requested page size', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.table === 'opportunities'
    ? Array.from({ length: Math.min(100, 230 - (query.range?.[0] ?? 0)) }, (_, index) => ({ id: String((query.range?.[0] ?? 0) + index), title: 'Researcher' })) : [],
  count: query.table === 'opportunities' ? 230 : 0, error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.opportunities.value.length, 230);
  assert.deepEqual(queries.filter(({ table }) => table === 'opportunities').map(({ range }) => range?.[0]), [0, 100, 200]);
  scope.stop();
});

test('one-click create retries reuse RPC IDs, preserve server context, and never upload CV data', async () => {
  let rpcAttempts = 0;
  let persisted: ReturnType<typeof application> | null = null;
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      rpcAttempts++;
      persisted = { ...application(String(query.payload?.p_application_id), null), contact_email: null };
      return rpcAttempts === 1 ? { data: null, error: { message: 'Network response lost' } } : { data: persisted.id, error: null };
    }
    return { data: query.single ? persisted : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const input = { opportunityId: 'opportunity-1' };
  assert.equal(await workspace.createApplication(input), null);
  assert.match(workspace.error.value, /Could not save/);
  const result = await workspace.createApplication(input);
  assert.ok(result);
  const rpcCalls = queries.filter(({ operation }) => operation === 'rpc');
  assert.deepEqual(rpcCalls[0].payload, rpcCalls[1].payload);
  assert.deepEqual(Object.keys(rpcCalls[0].payload!).sort(), ['p_application_id', 'p_opportunity_id']);
  assert.equal(result.cv_variant_id, null);
  assert.equal(result.contact_email, null);
  assert.deepEqual(result.context_json, application().context_json);
  assert.equal(workspace.applications.value.length, 1);
  assert.deepEqual(workspace.cvVariants.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('logout during a write prevents follow-up reads and stale local rows; refresh cannot race a save', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.createApplication({ opportunityId: 'job' });
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const count = queries.length;
  assert.equal(await workspace.refresh(), false);
  assert.equal(queries.length, count);
  account.value = null;
  writing.resolve({ data: 'application-id', error: null });
  assert.equal(await pending, null);
  assert.equal(queries.length, count, 'do not start an application read under the next account');
  assert.deepEqual(workspace.applications.value, []);
  assert.deepEqual(workspace.cvVariants.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('reassigning a CV sends metadata in the same atomic RPC and never overwrites existing CV content', async () => {
  let persisted = application();
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      persisted = { ...persisted, cv_variant_id: String(query.payload?.p_cv_variant_id), status: 'submitted' };
      return { data: persisted.cv_variant_id, error: null };
    }
    return { data: query.single ? persisted : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const updated = await workspace.updateApplication('application-1', { cvState: createTestState(), status: 'submitted', contactEmail: 'employer@example.org', notes: ' Follow up ' });
  assert.ok(updated);
  assert.notEqual(updated.cv_variant_id, 'cv-1');
  const rpc = queries.find(({ operation }) => operation === 'rpc');
  assert.equal(rpc?.table, 'assign_job_application_cv');
  assert.deepEqual(rpc?.payload?.p_changes, { status: 'submitted', contact_email: 'employer@example.org', notes: 'Follow up' });
  assert.equal(queries.some(({ operation }) => operation === 'update'), false);
  scope.stop();
});

test('repeated one-click creates use the existing application ID returned by the server', async () => {
  const existing = application('existing-application', null);
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? { data: existing.id, error: null } : { data: query.single ? existing : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.createApplication({ opportunityId: 'opportunity-1' }))?.id, existing.id);
  assert.equal((await workspace.createApplication({ opportunityId: 'opportunity-1' }))?.id, existing.id);
  assert.equal(workspace.applications.value.length, 1);
  assert.ok(queries.filter(({ single }) => single).every(({ filters }) => filters.id === existing.id && filters.user_id === 'account-a'));
  scope.stop();
});

test('opportunity review RPC updates the current user’s choice without writing the shared catalogue', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.operation === 'rpc'
    ? { ...review(), state: query.payload?.p_state } : query.table === 'opportunity_reviews' ? [review('other-opportunity')] : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.setOpportunityReview('opportunity-1', 'not_interested'))?.state, 'not_interested');
  assert.equal((await workspace.setOpportunityReview('opportunity-1', 'unreviewed'))?.state, 'unreviewed');
  assert.equal(workspace.reviews.value.length, 2);
  assert.equal(workspace.reviews.value.find(({ opportunity_id }) => opportunity_id === 'opportunity-1')?.state, 'unreviewed');
  const writes = queries.filter(({ operation }) => operation === 'rpc');
  assert.equal(writes[0].table, 'review_job_opportunity');
  assert.deepEqual(writes[0].payload, { p_opportunity_id: 'opportunity-1', p_observed_updated_at: null, p_state: 'not_interested' });
  assert.equal(queries.some(({ table, operation }) => table === 'opportunities' && operation !== 'select'), false);
  scope.stop();
});

test('late review writes cannot restore a previous user’s choices after logout', async () => {
  const saving = deferred<Result>();
  const { client } = fakeClient((query) => query.operation === 'rpc' ? saving.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.setOpportunityReview('opportunity-1', 'interested');
  account.value = null;
  saving.resolve({ data: review(), error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('opening and changing review state persist the viewed source version across fresh workspaces', async () => {
  const source = normalizeOpportunity({ id: 'opportunity-1', title: 'Researcher', created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-20T10:00:00Z' });
  let stored = review('opportunity-1', 'not_interested');
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'], reviewed_updated_at: String(query.payload?.p_observed_updated_at) };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunities' ? [source.details] : query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.markOpportunityReviewed(source))?.state, 'not_interested');
  assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal(await workspace.markOpportunityReviewed(source), null, 'reopening a reviewed version makes no redundant write');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  await workspace.setOpportunityReview(source.id, 'interested');
  assert.deepEqual(queries.at(-1)?.payload, { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: 'interested' });
  scope.stop();
  const nextScope = effectScope();
  const reloaded = nextScope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(opportunityRecency(reloaded.opportunities.value[0], new Date('2026-09-20T12:00:00Z'), reloaded.reviews.value[0].reviewed_updated_at), null);
  assert.equal(reloaded.reviews.value[0].state, 'interested');
  nextScope.stop();
});

test('parallel row receipts do not block state changes or overwrite a newer interest choice', async () => {
  const opening = deferred<Result>();
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  const source2 = normalizeOpportunity({ id: 'opportunity-2', updated_at: source.updated_at });
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? query.payload?.p_state === null ? opening.promise
      : { data: { ...review('opportunity-1', 'interested'), reviewed_updated_at: source.updated_at }, error: null }
    : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.markOpportunityReviewed(source);
  assert.equal(workspace.saving.value, false);
  const duplicate = workspace.markOpportunityReviewed(source);
  assert.equal(await duplicate, null);
  await workspace.setOpportunityReview(source.id, 'interested');
  opening.resolve({ data: { ...review('opportunity-1', 'unreviewed'), reviewed_updated_at: source.updated_at }, error: null });
  await pending;
  assert.equal(workspace.reviews.value[0].state, 'interested');
  assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 2);
  // Unexpected cross-opportunity response is rejected, never applied to the second row.
  assert.equal(await workspace.markOpportunityReviewed(source2), null);
  assert.equal(workspace.reviews.value.length, 1);
  scope.stop();
});

test('failed receipts keep highlights and old receipts cannot cross account changes', async () => {
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  const writing = deferred<Result>();
  let fail = true;
  const { client } = fakeClient((query) => query.operation === 'rpc'
    ? fail ? { data: null, error: { message: 'Offline' } } : writing.promise
    : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.markOpportunityReviewed(source), null);
  assert.equal(workspace.reviews.value.length, 0);
  assert.match(workspace.error.value, /Could not mark/);
  fail = false;
  const pending = workspace.markOpportunityReviewed(source);
  assert.equal(workspace.error.value, '', 'retry clears the previous failure');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  writing.resolve({ data: { ...review(), reviewed_updated_at: source.updated_at }, error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('rapidly opening different rows saves both receipts and an older refresh cannot restore highlights', async () => {
  const version = '2026-09-20T10:00:00Z';
  const first = deferred<Result>();
  const second = deferred<Result>();
  const reading = deferred<Result>();
  let holdReads = false;
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? query.payload?.p_opportunity_id === 'first' ? first.promise : second.promise
    : holdReads ? reading.promise : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const pendingFirst = workspace.markOpportunityReviewed(normalizeOpportunity({ id: 'first', updated_at: version }));
  const pendingSecond = workspace.markOpportunityReviewed(normalizeOpportunity({ id: 'second', updated_at: version }));
  await settleUntil(() => queries.filter(({ operation }) => operation === 'rpc').length === 2);
  holdReads = true;
  const refresh = workspace.refresh();
  await settleUntil(() => queries.filter(({ operation }) => operation === 'select').length === 8);
  second.resolve({ data: { ...review('second', 'unreviewed'), reviewed_updated_at: version }, error: null });
  first.resolve({ data: { ...review('first', 'unreviewed'), reviewed_updated_at: version }, error: null });
  await Promise.all([pendingFirst, pendingSecond]);
  reading.resolve({ data: [], error: null });
  assert.equal(await refresh, false);
  assert.deepEqual(workspace.reviews.value.map(({ opportunity_id }) => opportunity_id).sort(), ['first', 'second']);
  assert.ok(workspace.reviews.value.every(({ reviewed_updated_at }) => reviewed_updated_at === version));
  scope.stop();
});

test('metadata can be saved before CV assignment and employer contact email is optional', async () => {
  const { client, queries } = fakeClient((query) => ({ data: query.operation === 'update'
    ? { ...application('application-1', null), ...query.payload } : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const updated = await workspace.updateApplication('application-1', { status: 'contacted', notes: 'Asked about supervision', contactEmail: '' });
  assert.ok(updated);
  assert.equal(updated.cv_variant_id, null);
  assert.equal(updated.contact_email, null);
  assert.equal(queries.some(({ operation }) => operation === 'rpc'), false);
  assert.deepEqual(queries.find(({ operation }) => operation === 'update')?.payload,
    { status: 'contacted', notes: 'Asked about supervision', contact_email: null });
  scope.stop();
});

test('checklist mutations save only one task and retain owned application context and CV', async () => {
  let stored = application();
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc') {
      const keys = new Set(stored.completed_checklist_keys);
      if (query.payload?.p_completed) keys.add(String(query.payload.p_item_key));
      else keys.delete(String(query.payload?.p_item_key));
      stored = { ...stored, completed_checklist_keys: [...keys] };
      return { data: stored, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  await workspace.setApplicationChecklistItem(stored.id, 'requirements:degree', true);
  await workspace.setApplicationChecklistItem(stored.id, 'documents:cv', true);
  await workspace.setApplicationChecklistItem(stored.id, 'requirements:degree', false);
  assert.deepEqual(workspace.applications.value[0].completed_checklist_keys, ['documents:cv']);
  assert.deepEqual(workspace.applications.value[0].context_json, application().context_json);
  assert.equal(workspace.applications.value[0].cv_variant_id, 'cv-1');
  assert.deepEqual(queries.find(({ operation }) => operation === 'rpc')?.payload,
    { p_application_id: stored.id, p_item_key: 'requirements:degree', p_completed: true });
  await workspace.refresh();
  assert.deepEqual(workspace.applications.value[0].completed_checklist_keys, ['documents:cv']);
  scope.stop();
});

test('removal returns the opportunity to the review list only after confirmed success and keeps CV snapshots', async () => {
  let fail = true;
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? fail ? { data: null, error: { message: 'Offline' } } : { data: query.payload?.p_application_id, error: null }
    : { data: query.table === 'applications' ? [application(), { ...application('other'), opportunity_id: 'other-opportunity' }]
      : query.table === 'opportunity_reviews' ? [review('opportunity-1', 'not_interested')]
        : query.table === 'cv_variants' ? [{ id: 'cv-1', user_id: 'account-a', name: 'Snapshot' }] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.removeApplication('application-1'), null);
  assert.equal(workspace.applications.value.length, 2);
  assert.equal(workspace.reviews.value[0].state, 'not_interested');
  fail = false;
  assert.equal(await workspace.removeApplication('application-1'), 'application-1');
  assert.deepEqual(workspace.applications.value.map(({ id }) => id), ['other']);
  assert.equal(workspace.reviews.value[0].state, 'unreviewed');
  assert.equal(workspace.cvVariants.value.length, 1);
  assert.deepEqual(queries.filter(({ operation }) => operation === 'rpc').map(({ table, payload }) => ({ table, payload })),
    Array.from({ length: 2 }, () => ({ table: 'remove_job_application', payload: { p_application_id: 'application-1' } })));
  scope.stop();
});

test('late checklist and removal results cannot affect another signed-in account', async () => {
  for (const operation of ['checklist', 'remove']) {
    const writing = deferred<Result>();
    const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? writing.promise
      : { data: query.table === 'applications' ? [application()] : [], error: null });
    const scope = effectScope();
    const account = ref<string | null>('account-a');
    const workspace = scope.run(() => useJobWorkspace(client, account))!;
    await settleUntil(() => !workspace.loading.value);
    const pending = operation === 'checklist' ? workspace.setApplicationChecklistItem('application-1', 'documents:cv', true) : workspace.removeApplication('application-1');
    await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
    account.value = null;
    writing.resolve({ data: operation === 'checklist' ? { ...application(), completed_checklist_keys: ['documents:cv'] } : 'application-1', error: null });
    assert.equal(await pending, null);
    assert.deepEqual(workspace.applications.value, []);
    scope.stop();
  }
});

test('application context loads the exact saved privacy CV from a fresh owned application only on request', async () => {
  const stored = createCloudCvSnapshot(createTestState({ about: { text: 'Exact saved research CV' } }));
  const fresh = application('application-1', stored.id);
  const { client, queries } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? fresh : { ...stored, user_id: 'account-a' }
    : query.table === 'applications' ? [application('application-1', 'old-cv')] : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(queries.some(({ fields }) => fields?.includes('content_json')), false);
  const context = await workspace.getApplicationContext('application-1');
  assert.deepEqual(context, { application: fresh, cv: stored });
  const read = queries.find(({ table, single }) => table === 'cv_variants' && single);
  assert.deepEqual(read?.filters, { id: stored.id, user_id: 'account-a' });
  assert.equal(context?.cv?.content_json.about.text, 'Exact saved research CV');
  assert.deepEqual(context?.application.context_json.supervisor_top_papers, [{ title: 'Paper', year: 2025 }]);
  scope.stop();
});

test('unassigned CV is an explicit valid context while missing assigned CV prevents partial export', async () => {
  let assigned = false;
  const { client, queries } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? application('application-1', assigned ? 'missing-cv' : null) : null
    : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const context = await workspace.getApplicationContext('application-1');
  assert.ok(context);
  assert.equal(context.cv, null);
  assert.equal(workspace.error.value, '');
  assert.equal(queries.some(({ table, single }) => table === 'cv_variants' && single), false);
  assigned = true;
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /invalid or unavailable/);
  scope.stop();
});

test('context loading rejects non-private CVs and cross-user responses', async () => {
  const stored = createCloudCvSnapshot(createTestState());
  let owner = 'account-a';
  stored.content_json.contact.email = 'private@example.org';
  const { client } = fakeClient((query) => ({ data: query.single
    ? query.table === 'applications' ? { ...application('application-1', stored.id), user_id: owner } : { ...stored, user_id: owner }
    : [], error: null }));
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /not a privacy snapshot/);
  owner = 'account-b';
  assert.equal(await workspace.getApplicationContext('application-1'), null);
  assert.match(workspace.error.value, /could not be loaded/);
  scope.stop();
});

test('logout while a saved CV is loading discards the complete application context', async () => {
  const cvRead = deferred<Result>();
  const stored = createCloudCvSnapshot(createTestState());
  const { client, queries } = fakeClient((query) => query.single
    ? query.table === 'applications' ? { data: application('application-1', stored.id), error: null } : cvRead.promise
    : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const reading = workspace.getApplicationContext('application-1');
  await settleUntil(() => queries.some(({ table, single }) => table === 'cv_variants' && single));
  account.value = null;
  cvRead.resolve({ data: { ...stored, user_id: 'account-a' }, error: null });
  assert.equal(await reading, null);
  assert.equal(workspace.error.value, '');
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('explicit research refresh uses only the application ID and preserves its saved CV and metadata', async () => {
  const original: Application = { ...application(), status: 'interview', notes: 'Prepare presentation', contacted_at: '2026-09-19T17:00:00.000Z', submitted_at: '2026-09-19T18:00:00.000Z' };
  const updated: Application = { ...original, context_json: { ...original.context_json, supervisor_top_papers: [{ title: 'New verified paper', year: 2026 }] }, context_captured_at: '2026-09-20T12:00:00.000Z' };
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? { data: original.id, error: null }
    : { data: query.single ? updated : query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.deepEqual(workspace.applications.value[0].context_json, original.context_json);
  const result = await workspace.refreshApplicationContext(original.id);
  assert.deepEqual(result, updated);
  assert.deepEqual(workspace.applications.value[0], updated);
  assert.equal(result?.cv_variant_id, original.cv_variant_id);
  assert.equal(result?.notes, original.notes);
  assert.equal(result?.status, original.status);
  assert.equal(result?.contact_email, original.contact_email);
  const rpc = queries.find(({ operation }) => operation === 'rpc');
  assert.equal(rpc?.table, 'refresh_job_application_context');
  assert.deepEqual(rpc?.payload, { p_application_id: original.id });
  assert.equal(queries.some(({ operation, fields }) => operation === 'update' || fields?.includes('content_json')), false);
  scope.stop();
});

test('logout during research refresh prevents follow-up reads and stale application updates', async () => {
  const updating = deferred<Result>();
  const { client, queries } = fakeClient((query) => query.operation === 'rpc' ? updating.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.refreshApplicationContext('application-1');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const count = queries.length;
  account.value = null;
  updating.resolve({ data: 'application-1', error: null });
  assert.equal(await pending, null);
  assert.equal(queries.length, count);
  assert.deepEqual(workspace.applications.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});
