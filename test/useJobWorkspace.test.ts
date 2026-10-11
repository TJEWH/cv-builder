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
    contact_email: 'employer@example.org', status: 'preparation', completed_checklist_keys: [], notes: null, contacted_at: null, submitted_at: null,
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

test('server application codes survive list, create, and update roundtrips without becoming client-generated writes', async (t) => {
  let persisted = { ...application('coded-application'), application_code: 'PHD-ServerAssigned_7A' };
  const { client, queries } = fakeClient((query) => {
    if (query.operation === 'rpc' && query.table === 'create_job_application') return { data: persisted.id, error: null };
    if (query.operation === 'update' && query.table === 'applications') {
      persisted = { ...persisted, ...query.payload, context_json: { ...persisted.context_json, title: 'A renamed opportunity' } };
      return { data: persisted, error: null };
    }
    return { data: query.table === 'applications' ? query.single ? persisted : [persisted] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(workspace.applications.value[0].application_code, 'PHD-ServerAssigned_7A');
  const created = await workspace.createApplication({ opportunityId: 'opportunity-1' });
  assert.equal(created?.application_code, 'PHD-ServerAssigned_7A');
  const updated = await workspace.updateApplication(persisted.id, { notes: 'A local tracking note.', status: 'contacted' });
  assert.equal(updated?.application_code, 'PHD-ServerAssigned_7A');
  assert.equal(updated?.context_json.title, 'A renamed opportunity');
  assert.equal(workspace.applications.value[0].application_code, 'PHD-ServerAssigned_7A');
  const writes = queries.filter(query => query.operation !== 'select');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(query => !Object.hasOwn(query.payload || {}, 'application_code')));
  assert.ok(writes.every(query => !JSON.stringify(query.payload).includes('PHD-ServerAssigned_7A')));
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

test('late strong-interest writes cannot restore a previous user’s choices after an account change', async () => {
  const saving = deferred<Result>();
  const { client } = fakeClient((query) => query.operation === 'rpc' ? saving.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.setOpportunityReview('opportunity-1', 'strong_interest');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  saving.resolve({ data: review('opportunity-1', 'strong_interest'), error: null });
  assert.equal(await pending, null);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.error.value, '');
  scope.stop();
});

test('opportunity comments persist across reloads, interest choices and receipts, and can be cleared', async (t) => {
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  let stored: OpportunityReview = review(source.id, 'unreviewed');
  const { client, queries } = fakeClient((query) => {
    if (query.table === 'save_opportunity_comment') {
      stored = { ...stored, comment: query.payload?.p_comment as string | null };
      return { data: { ...stored }, error: null };
    }
    if (query.table === 'review_job_opportunity') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'],
        reviewed_updated_at: query.payload?.p_observed_updated_at as string | null };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunities' ? [source.details]
      : query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const saved = await workspace.setOpportunityComment(source.id, '  Excellent research fit.\nDiscuss funding.  ');
  assert.equal(saved?.comment, 'Excellent research fit.\nDiscuss funding.');
  assert.equal(saved?.state, 'unreviewed', 'a comment does not choose an interest state');
  assert.equal(saved?.reviewed_updated_at, null, 'a comment does not acknowledge source changes');
  await workspace.markOpportunityReviewed(source);
  await workspace.setOpportunityReview(source.id, 'strong_interest');
  scope.stop();

  const nextScope = effectScope(); t.after(() => nextScope.stop());
  const reloaded = nextScope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(reloaded.reviews.value[0].comment, 'Excellent research fit.\nDiscuss funding.');
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal((await reloaded.setOpportunityComment(source.id, ' \n\t '))?.comment, null);
  assert.equal(await reloaded.refresh(), true);
  assert.equal(reloaded.reviews.value[0].comment, null);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.deepEqual(queries.filter(({ table }) => table === 'save_opportunity_comment').map(({ payload }) => payload), [
    { p_opportunity_id: source.id, p_comment: 'Excellent research fit.\nDiscuss funding.' },
    { p_opportunity_id: source.id, p_comment: null },
  ]);
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ operation }) => operation === 'select'));
});

test('invalid or failed comment saves preserve the saved comment and report a useful error', async (t) => {
  const original = { ...review(), comment: 'Location does not work for me.' };
  let response: Result = { data: null, error: { message: 'Offline' } };
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? response
    : { data: query.table === 'opportunity_reviews' ? [original] : [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'x'.repeat(5001)), null);
  assert.match(workspace.opportunityCommentError.value, /5,000 characters/);
  assert.equal(workspace.error.value, '', 'comment errors do not trigger the generic workspace error toast');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 0);
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
  assert.match(workspace.opportunityCommentError.value, /Could not save the opportunity comment/);
  response = { data: null, error: { code: 'PGRST202' } };
  assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
  assert.match(workspace.opportunityCommentError.value, /database setup is incomplete/);
  for (const invalid of [
    { ...original, user_id: 'account-b' },
    { ...original, opportunity_id: 'another-opportunity' },
    { ...original, comment: undefined },
  ]) {
    response = { data: invalid, error: null };
    assert.equal(await workspace.setOpportunityComment(original.opportunity_id, 'New comment'), null);
    assert.match(workspace.opportunityCommentError.value, /comment could not be saved/);
    assert.deepEqual(workspace.reviews.value, [original]);
  }
  response = { data: { ...original, comment: 'x'.repeat(5000) }, error: null };
  assert.ok(await workspace.setOpportunityComment(original.opportunity_id, 'x'.repeat(5000)));
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('comment errors stay separate from unrelated workspace failures and clear when the account changes', async (t) => {
  const { client } = fakeClient(query => query.operation === 'rpc'
    ? { data: null, error: { message: 'Offline' } } : { data: [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.setOpportunityReview('opportunity-1', 'strong_interest'), null);
  assert.match(workspace.error.value, /Could not save the opportunity review/);
  const reviewFailure = workspace.error.value;
  assert.equal(await workspace.setOpportunityComment('opportunity-1', 'Private evaluation'), null);
  assert.match(workspace.opportunityCommentError.value, /Could not save the opportunity comment/);
  assert.equal(workspace.error.value, reviewFailure, 'a comment save must neither replace nor dismiss an unrelated failure');
  account.value = 'account-b';
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('comment saves and interest changes share user order without sending unrelated fields', async (t) => {
  const firstWrite = deferred<Result>();
  let held = true;
  let stored: OpportunityReview = { ...review(), comment: null };
  const { client, queries } = fakeClient(async query => {
    if (query.operation === 'rpc') {
      if (held) { held = false; await firstWrite.promise; }
      stored = query.table === 'save_opportunity_comment' ? { ...stored, comment: query.payload?.p_comment as string | null }
        : { ...stored, state: query.payload?.p_state as OpportunityReview['state'] };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'opportunity_reviews' ? [{ ...stored }] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const comment = workspace.setOpportunityComment(stored.opportunity_id, 'Earlier thought');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const interest = workspace.setOpportunityReview(stored.opportunity_id, 'not_interested');
  const revisedComment = workspace.setOpportunityComment(stored.opportunity_id, 'The location is too far away.');
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  firstWrite.resolve({ data: null, error: null });
  await Promise.all([comment, interest, revisedComment]);
  assert.equal(workspace.reviews.value[0].state, 'not_interested');
  assert.equal(workspace.reviews.value[0].comment, 'The location is too far away.');
  assert.deepEqual(queries.filter(({ operation }) => operation === 'rpc').map(({ table }) => table),
    ['save_opportunity_comment', 'review_job_opportunity', 'save_opportunity_comment']);
});

test('late and queued comment saves cannot cross account changes', async (t) => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope(); t.after(() => scope.stop());
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const comment = workspace.setOpportunityComment('opportunity-1', 'Private reason');
  await settleUntil(() => queries.some(({ operation }) => operation === 'rpc'));
  const queued = workspace.setOpportunityComment('opportunity-1', 'Another private reason');
  account.value = 'account-b';
  await settleUntil(() => !workspace.loading.value);
  assert.ok(queries.find(({ operation }) => operation === 'rpc')?.signal?.aborted);
  writing.resolve({ data: { ...review(), comment: 'Private reason' }, error: null });
  assert.deepEqual(await Promise.all([comment, queued]), [null, null]);
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 1);
  assert.deepEqual(workspace.reviews.value, []);
  assert.equal(workspace.opportunityCommentError.value, '');
  assert.equal(workspace.error.value, '');
});

test('comments and concurrent receipts preserve both changes in either response order', async (t) => {
  for (const receiptFirst of [true, false]) await t.test(receiptFirst ? 'receipt finishes first' : 'comment finishes first', async () => {
    const comment = deferred<Result>();
    const receipt = deferred<Result>();
    const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
    const original = { ...review(source.id, 'strong_interest'), comment: 'Previous reason' };
    const { client, queries } = fakeClient(query => query.operation === 'rpc'
      ? query.table === 'save_opportunity_comment' ? comment.promise : receipt.promise
      : { data: query.table === 'opportunity_reviews' ? [original] : [], error: null });
    const scope = effectScope();
    try {
      const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
      await settleUntil(() => !workspace.loading.value);
      const pendingReceipt = workspace.markOpportunityReviewed(source);
      const pendingComment = workspace.setOpportunityComment(source.id, 'Funding confirmed.');
      await settleUntil(() => queries.filter(({ operation }) => operation === 'rpc').length === 2);
      const commentReply = { data: { ...original, comment: 'Funding confirmed.' }, error: null };
      const receiptReply = { data: { ...original, reviewed_updated_at: source.updated_at }, error: null };
      if (receiptFirst) {
        receipt.resolve(receiptReply); await pendingReceipt;
        comment.resolve(commentReply); await pendingComment;
      } else {
        comment.resolve(commentReply); await pendingComment;
        receipt.resolve(receiptReply); await pendingReceipt;
      }
      assert.equal(workspace.reviews.value[0].comment, 'Funding confirmed.');
      assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
      assert.equal(workspace.reviews.value[0].state, 'strong_interest');
    } finally { scope.stop(); }
  });
});

test('strong interest survives a fresh workspace, updated-source receipt, and application creation', async (t) => {
  let source = { id: 'opportunity-1', title: 'Materials discovery', personal_fit: { score: 6.4 },
    deadline: '2025-01-01', original_search: 'Materials discovery', created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-20T10:00:00Z' };
  let stored = review('opportunity-1', 'unreviewed');
  let created: Application | null = null;
  const { client, queries } = fakeClient((query) => {
    if (query.table === 'review_job_opportunity') {
      stored = { ...stored, state: (query.payload?.p_state ?? stored.state) as OpportunityReview['state'],
        reviewed_updated_at: String(query.payload?.p_observed_updated_at) };
      return { data: { ...stored }, error: null };
    }
    if (query.table === 'create_job_application') {
      created = application(String(query.payload?.p_application_id), null);
      return { data: created.id, error: null };
    }
    return { data: query.table === 'opportunities' ? [{ ...source }]
      : query.table === 'opportunity_reviews' ? [{ ...stored }]
        : query.table === 'applications' ? query.single ? created : created ? [created] : [] : [], error: null };
  });
  const scope = effectScope(); t.after(() => scope.stop());
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal((await workspace.setOpportunityReview(source.id, 'strong_interest'))?.state, 'strong_interest');
  assert.deepEqual(queries.at(-1)?.payload,
    { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: 'strong_interest' });
  scope.stop();

  const nextScope = effectScope(); t.after(() => nextScope.stop());
  const reloaded = nextScope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !reloaded.loading.value);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);

  source = { ...source, updated_at: '2026-09-21T10:00:00Z' };
  assert.equal(await reloaded.refresh(), true);
  assert.equal((await reloaded.markOpportunityReviewed(reloaded.opportunities.value[0]))?.state, 'strong_interest');
  assert.deepEqual(queries.at(-1)?.payload,
    { p_opportunity_id: source.id, p_observed_updated_at: source.updated_at, p_state: null });
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(reloaded.reviews.value[0].reviewed_updated_at, source.updated_at);

  assert.ok(await reloaded.createApplication({ opportunityId: source.id }));
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(await reloaded.refresh(), true);
  assert.equal(reloaded.reviews.value[0].state, 'strong_interest');
  assert.equal(queries.filter(({ table }) => table === 'review_job_opportunity').length, 2,
    'creating an application does not write or weaken an explicit review preference');
  assert.ok(queries.filter(({ table }) => table === 'opportunities').every(({ operation }) => operation === 'select'));
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

test('parallel row receipts do not block state changes or overwrite a newer strong-interest choice', async () => {
  const opening = deferred<Result>();
  const source = normalizeOpportunity({ id: 'opportunity-1', updated_at: '2026-09-20T10:00:00Z' });
  const source2 = normalizeOpportunity({ id: 'opportunity-2', updated_at: source.updated_at });
  const { client, queries } = fakeClient((query) => query.operation === 'rpc'
    ? query.payload?.p_state === null ? opening.promise
      : { data: { ...review('opportunity-1', 'strong_interest'), reviewed_updated_at: source.updated_at }, error: null }
    : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const pending = workspace.markOpportunityReviewed(source);
  assert.equal(workspace.saving.value, false);
  const duplicate = workspace.markOpportunityReviewed(source);
  assert.equal(await duplicate, null);
  await workspace.setOpportunityReview(source.id, 'strong_interest');
  opening.resolve({ data: { ...review('opportunity-1', 'unreviewed'), reviewed_updated_at: source.updated_at }, error: null });
  await pending;
  assert.equal(workspace.reviews.value[0].state, 'strong_interest');
  assert.equal(workspace.reviews.value[0].reviewed_updated_at, source.updated_at);
  assert.equal(queries.filter(({ operation }) => operation === 'rpc').length, 2);
  // Reject a response for another opportunity and leave the second row unchanged.
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
    { status: 'contacted', tracking_started: true, notes: 'Asked about supervision', contact_email: null });
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

test('stage saves queue with explicit tracking choices and preserve the server lock', async () => {
  const firstWrite = deferred<Result>();
  let held = true;
  let stored: Application = { ...application(), workflow_stage: 'preparation', tracking_started: false };
  const stages = { preparation: 'preparation', refinement: 'refinement', review: 'attachments', tracking: 'ready' } as const;
  const { client, queries } = fakeClient(async query => {
    if (query.operation === 'rpc' && query.table === 'set_job_application_stage') {
      if (held) { held = false; await firstWrite.promise; }
      const stage = query.payload!.p_stage as keyof typeof stages;
      stored = { ...stored, workflow_stage: stage, status: stored.tracking_started ? stored.status : stages[stage] };
      return { data: { ...stored }, error: null };
    }
    if (query.operation === 'update') {
      stored = { ...stored, ...query.payload };
      return { data: { ...stored }, error: null };
    }
    return { data: query.table === 'applications' ? [stored] : [], error: null };
  });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage(stored.id, 'tracking');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const explicitReady = workspace.updateApplication(stored.id, { status: 'ready' });
  const lastStage = workspace.setApplicationStage(stored.id, 'review');
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
  firstWrite.resolve({ data: null, error: null });
  assert.equal((await stage)?.status, 'ready');
  assert.equal((await explicitReady)?.tracking_started, true);
  assert.equal((await lastStage)?.workflow_stage, 'review');
  assert.equal(workspace.applications.value[0].status, 'ready');
  assert.deepEqual(queries.filter(query => query.operation !== 'select').map(query => query.table),
    ['set_job_application_stage', 'applications', 'set_job_application_stage']);
  assert.deepEqual(queries.find(query => query.operation === 'update')?.payload, { status: 'ready', tracking_started: true });
  scope.stop();
});

test('queued application writes cannot run under the next account', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const account = ref<string | null>('account-a');
  const workspace = scope.run(() => useJobWorkspace(client, account))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage('application-1', 'refinement');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const note = workspace.updateApplication('application-1', { notes: 'Old account note' });
  const tracking = workspace.updateApplication('application-1', { status: 'submitted' });
  account.value = null;
  writing.resolve({ data: { ...application(), workflow_stage: 'refinement', status: 'refinement' }, error: null });
  assert.deepEqual(await Promise.all([stage, note, tracking]), [null, null, null]);
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
  assert.deepEqual(workspace.applications.value, []);
  scope.stop();
});

test('missing workflow RPC reports setup failure without inventing a saved stage', async () => {
  const original: Application = { ...application(), status: 'ready' };
  const { client } = fakeClient(query => query.operation === 'rpc' ? { data: null, error: { code: 'PGRST202' } }
    : { data: query.table === 'applications' ? [original] : [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  assert.equal(await workspace.setApplicationStage(original.id, 'refinement'), null);
  assert.match(workspace.error.value, /database setup is incomplete/);
  assert.equal(workspace.applications.value[0].workflow_stage, undefined);
  assert.equal(workspace.applications.value[0].status, 'ready');
  scope.stop();
});

test('disposed workspaces discard queued writes and reject new writes', async () => {
  const writing = deferred<Result>();
  const { client, queries } = fakeClient(query => query.operation === 'rpc' ? writing.promise : { data: [], error: null });
  const scope = effectScope();
  const workspace = scope.run(() => useJobWorkspace(client, ref('account-a')))!;
  await settleUntil(() => !workspace.loading.value);
  const stage = workspace.setApplicationStage('application-1', 'review');
  await settleUntil(() => queries.some(query => query.operation === 'rpc'));
  const pendingNote = workspace.updateApplication('application-1', { notes: 'Queued note' });
  scope.stop();
  assert.equal(await workspace.updateApplication('application-1', { notes: 'After unmount' }), null);
  assert.equal(await workspace.setApplicationStage('application-1', 'tracking'), null);
  assert.equal(await workspace.refresh(), false);
  writing.resolve({ data: { ...application(), workflow_stage: 'review', status: 'attachments' }, error: null });
  assert.deepEqual(await Promise.all([stage, pendingNote]), [null, null]);
  assert.equal(queries.filter(query => query.operation !== 'select').length, 1);
});
