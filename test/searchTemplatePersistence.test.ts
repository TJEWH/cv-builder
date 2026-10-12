import assert from 'node:assert/strict';
import test from 'node:test';
import { ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultSearchSchedule, emptySearchCriteria, searchDraftStorageKey, useOpportunitySearchTemplates, validateSearchTemplate } from '../src/composables/opportunitySearchTemplates';
import type { SearchTemplate } from '../src/searchTypes';
const configuration = { status: 'ready' as const, url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_do_not_copy_credentials' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function memoryStorage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
const schedule = defaultSearchSchedule('Europe/Berlin');
const row = (owner = 'owner-a', id = '10000000-0000-4000-8000-000000000001') => ({ id, user_id: owner, name: 'Audio research', criteria: { ...emptySearchCriteria(), opportunityTypes: 'Funded PhD' }, schedule: clone(schedule), revision: 1, created_at: '2026-10-12T08:00:00Z', updated_at: '2026-10-12T08:00:00Z' });
type Response = { data: any; error: null | { code?: string; message: string } };
function harness(initial = [row()], storage = memoryStorage()) {
  const user = ref('owner-a'); const database = new Map(initial.map(item => [item.id, clone(item)]));
  const bindings: Record<string, unknown>[] = [], runs: Record<string, unknown>[] = [];
  const saves: Record<string, unknown>[] = []; const copied: string[] = [];
  let saveHook: ((args: Record<string, unknown>, commit: () => Response) => Promise<Response>) | undefined;
  let readinessHook: (() => Promise<Response>) | undefined;
  let clipboardFails = false, unavailable = false;
  const readiness = () => ({ data: { ready: true, bootstrap_version: 1, protocol_version: 'opportunity-search-v1', protocol_hash: 'sha256:test' }, error: null });
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = []; let maximum = 500, first = 0;
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, order() { return query; },
        range(start: number, last: number) { first = start; maximum = last - start + 1; return query; }, limit(value: number) { maximum = value; return query; },
        then(resolve: (response: Response) => void) {
          const entries = table === 'opportunity_search_templates' ? [...database.values()] : table === 'opportunity_search_runs' ? runs : bindings;
          resolve(unavailable ? { data: null, error: { code: '42P01', message: 'Missing table' } } : { data: clone(entries.filter(item => filters.every(([key, value]) => (item as Record<string, unknown>)[key] === value)).slice(first, first + maximum)), error: null });
        },
      }; return query;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === 'opportunity_search_readiness') return readinessHook?.() ?? Promise.resolve(readiness());
      assert.equal(name, 'save_opportunity_search_template');
      const input = clone(args!); saves.push(input);
      const commit = (): Response => {
        const previous = database.get(String(input.p_id));
        if (previous && (previous.user_id !== user.value || previous.revision !== input.p_expected_revision)) {
          const intended = { name: input.p_name, criteria: input.p_criteria, schedule: input.p_schedule };
          const current = { name: previous.name, criteria: previous.criteria, schedule: previous.schedule };
          if (previous.user_id === user.value && previous.revision === Number(input.p_expected_revision) + 1 && JSON.stringify(intended) === JSON.stringify(current)) return { data: clone(previous), error: null };
          return { data: null, error: { code: '40001', message: 'Revision conflict' } };
        }
        const saved = { ...row(user.value, String(input.p_id)), name: String(input.p_name), criteria: clone(input.p_criteria) as ReturnType<typeof emptySearchCriteria>, schedule: clone(input.p_schedule) as typeof schedule, revision: Number(input.p_expected_revision) + 1 };
        database.set(saved.id, saved); return { data: clone(saved), error: null };
      };
      return saveHook ? saveHook(input, commit) : Promise.resolve(commit());
    },
  } as unknown as SupabaseClient;
  const state = useOpportunitySearchTemplates({ userId: user, client, configuration, storage, autosaveDelay: 100000,
    clipboard: { async writeText(value: string) { if (clipboardFails) throw new Error('Denied'); copied.push(value); } } });
  return { state, user, database, saves, copied, bindings, runs, storage, client,
    set saveHook(value: typeof saveHook) { saveHook = value; }, set readinessHook(value: typeof readinessHook) { readinessHook = value; },
    set clipboardFails(value: boolean) { clipboardFails = value; }, set unavailable(value: boolean) { unavailable = value; } };
}

test('defaults are local-time weekly Monday with immediate verification and optional fields remain unrestricted', () => {
  assert.deepEqual(schedule, { frequency: 'weekly', intervalHours: 1, weekdays: [1], time: '09:00', timezone: 'Europe/Berlin', runImmediately: true });
  const template: SearchTemplate = { id: 'test', userId: 'a', name: 'Search', criteria: { ...emptySearchCriteria(), topicsAndMethods: 'BCI' }, schedule, revision: 0, createdAt: '', updatedAt: '' };
  assert.equal(validateSearchTemplate(template), '');
  assert.match(validateSearchTemplate({ ...template, criteria: emptySearchCriteria() }), /criterion/);
  assert.match(validateSearchTemplate({ ...template, schedule: { ...schedule, timezone: 'UTC+2' } }), /IANA/);
  assert.equal(validateSearchTemplate({ ...template, schedule: { ...schedule, frequency: 'hourly', intervalHours: 168, weekdays: [] } }), '');
});

test('blank and invalid templates stay in project/owner scoped local recovery without cloud writes', async t => {
  const h = harness([]); t.after(h.state.dispose); await tick(); await h.state.createBlank();
  h.state.form.value!.name = 'My new search';
  assert.equal(await h.state.flushSave(), false); assert.equal(h.saves.length, 0); assert.equal(h.state.status.value, 'pending');
  const key = searchDraftStorageKey(configuration.url, 'owner-a');
  assert.ok(h.storage.data.get(key)?.includes('My new search'));
  h.state.dispose();
  const recovered = harness([], h.storage); t.after(recovered.state.dispose); await tick();
  assert.equal(recovered.state.form.value?.name, 'My new search');
  recovered.user.value = 'owner-b'; await tick(); assert.equal(recovered.state.form.value, null);
  assert.notEqual(key, searchDraftStorageKey('https://other.supabase.co', 'owner-a'));
});

test('edits during a pending save serialize against its acknowledged revision without losing text', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  const gate = deferred<Response>(); let commit!: () => Response;
  h.saveHook = async (_args, apply) => { commit = apply; return gate.promise; };
  h.state.form.value!.name = 'First edit'; const saving = h.state.flushSave();
  h.state.form.value!.criteria.topicsAndMethods = 'Latest text while saving';
  h.saveHook = undefined; gate.resolve(commit());
  assert.equal(await saving, true);
  assert.deepEqual(h.saves.map(call => call.p_expected_revision), [1, 2]);
  assert.equal(h.state.form.value!.revision, 3); assert.equal(h.state.form.value!.criteria.topicsAndMethods, 'Latest text while saving');
  assert.equal(h.state.status.value, 'saved'); assert.equal(h.storage.data.size, 0);
});

test('database JSONB key ordering does not invalidate the acknowledged save receipt', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  h.saveHook = async (_args, commit) => {
    const response = commit();
    response.data.schedule = Object.fromEntries(Object.entries(response.data.schedule).reverse());
    response.data.criteria = Object.fromEntries(Object.entries(response.data.criteria).reverse());
    return response;
  };
  h.state.form.value!.name = '  Canonical saved name  ';
  assert.equal(await h.state.flushSave(), true);
  assert.equal(h.state.form.value!.name, 'Canonical saved name');
  assert.equal(h.state.status.value, 'saved');
});

test('uncertain write failures retain the old expected revision and exact retry reconciles the saved receipt', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  h.saveHook = async (_args, commit) => { commit(); return { data: null, error: { message: 'Connection interrupted' } }; };
  h.state.form.value!.name = 'Lost response';
  assert.equal(await h.state.flushSave(), false); assert.equal(h.state.form.value!.revision, 1); assert.equal(h.state.status.value, 'error');
  h.saveHook = undefined;
  assert.equal(await h.state.retrySave(), true); assert.equal(h.state.form.value!.revision, 2);
  assert.deepEqual(h.saves.map(call => call.p_expected_revision), [1, 1]);
});

test('stale revisions keep the local draft, block retries and reload only on explicit discard', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  h.state.form.value!.name = 'My pending edit';
  const server = h.database.get(row().id)!; server.revision = 2; server.name = 'Other tab';
  assert.equal(await h.state.flushSave(), false); assert.equal(h.state.form.value!.name, 'My pending edit');
  assert.match(h.state.error.value, /newer saved revision/); assert.ok(h.storage.data.size);
  assert.equal(await h.state.retrySave(), false); assert.equal(h.saves.length, 1);
  await h.state.reloadRemote(); assert.equal(h.state.form.value!.name, 'Other tab'); assert.equal(h.state.form.value!.revision, 2); assert.equal(h.storage.data.size, 0);
});

test('copy waits for autosave and rechecks edits made during the compatibility call', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  const gate = deferred<Response>(); h.readinessHook = () => gate.promise;
  h.state.form.value!.name = 'Before check';
  const copying = h.state.copyPrompt(); await tick();
  h.state.form.value!.name = 'After check'; h.readinessHook = undefined;
  gate.resolve({ data: { ready: true, bootstrap_version: 1, protocol_version: 'opportunity-search-v1', protocol_hash: 'sha256:test' }, error: null });
  assert.equal(await copying, true); assert.equal(h.saves.length, 2); assert.equal(h.copied.length, 1);
  assert.equal(h.state.form.value!.name, 'After check'); assert.match(h.copied[0], /abcdefghijklmnopqrst/);
  assert.doesNotMatch(h.copied[0], /sb_publishable/); assert.equal(h.state.scheduleConfirmation.value, null);
});

test('clipboard denial keeps a selectable preview and missing backend compatibility prevents copying', async t => {
  const h = harness(); t.after(h.state.dispose); await tick(); h.clipboardFails = true;
  assert.equal(await h.state.copyPrompt(), false); assert.ok(h.state.promptPreview.value); assert.match(h.state.notice.value, /Select and copy/);
  h.readinessHook = async () => ({ data: { ready: false, bootstrap_version: 1, protocol_version: null, protocol_hash: null }, error: null });
  assert.equal(await h.state.copyPrompt(), false); assert.equal(h.copied.length, 0); assert.match(h.state.error.value, /compatible opportunity search upgrade/);
});

test('late save responses after an account switch cannot populate the new owner state', async t => {
  const h = harness([row(), row('owner-b', '20000000-0000-4000-8000-000000000002')]); t.after(h.state.dispose); await tick();
  const gate = deferred<Response>(); h.saveHook = () => gate.promise;
  h.state.form.value!.name = 'Owner A draft'; const saving = h.state.flushSave();
  h.user.value = 'owner-b'; await tick();
  gate.resolve({ data: { ...row(), name: 'Owner A draft', revision: 2 }, error: null });
  assert.equal(await saving, false); assert.equal(h.state.form.value!.userId, 'owner-b'); assert.equal(h.state.form.value!.name, 'Audio research');
  assert.ok(h.storage.data.has(searchDraftStorageKey(configuration.url, 'owner-a')));
});

test('activity uses persisted owner records and duplication creates an independent saved search', async t => {
  const h = harness(); t.after(h.state.dispose); await tick();
  h.bindings.push({ search_id: row().id, user_id: 'owner-a', task_id: 'real-task-id', schedule, template_revision: 1, protocol_version: 'opportunity-search-v1', confirmed_at: '2026-10-12T10:00:00Z' });
  h.runs.push({ id: 'run', search_id: row().id, user_id: 'owner-a', status: 'complete', created_at: '2026-10-12T09:00:00Z', completed_at: '2026-10-12T09:05:00Z', summary: { notes: 'No new matches.' } });
  await h.state.reloadRemote(); assert.equal(h.state.scheduleConfirmation.value?.task_id, 'real-task-id'); assert.equal(h.state.latestRun.value?.started_at, '2026-10-12T09:00:00Z');
  await h.state.duplicate(); assert.notEqual(h.state.form.value!.id, row().id); assert.equal(h.state.form.value!.revision, 1);
  assert.equal(h.state.scheduleConfirmation.value, null); assert.equal(h.state.templates.value.length, 2);
});

test('retry recovers a failed empty-library load and never creates a schedule', async t => {
  const h = harness(); t.after(h.state.dispose);
  h.unavailable = true; await tick();
  assert.equal(h.state.form.value, null); assert.ok(h.state.error.value);
  h.unavailable = false;
  assert.equal(await h.state.retrySave(), true);
  assert.equal((h.state.form.value as SearchTemplate | null)?.id, row().id);
  assert.equal(h.state.scheduleConfirmation.value, null);
});

test('a duplicate requested during an old-owner save cannot copy data into a new owner', async t => {
  const h = harness([row(), row('owner-b', '20000000-0000-4000-8000-000000000002')]); t.after(h.state.dispose); await tick();
  const gate = deferred<Response>(); h.saveHook = () => gate.promise;
  h.state.form.value!.name = 'Owner A private search';
  const duplicate = h.state.duplicate();
  h.user.value = 'owner-b'; await tick();
  gate.resolve({ data: { ...row(), name: 'Owner A private search', revision: 2 }, error: null });
  await duplicate;
  assert.equal(h.state.templates.value.length, 1);
  assert.equal(h.state.form.value!.userId, 'owner-b');
  assert.equal(h.state.form.value!.name, 'Audio research');
});
