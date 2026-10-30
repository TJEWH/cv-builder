import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { file, insertOpportunity, json, literal, owner, reset, run, search, seedRun, sql, submit, upgrade } from '../opportunityMerge/db';
import { syntheticCanonicalMigrationRecords } from '../opportunityMerge/fixtures/synthetic-legacy';

const retired = ['particularly_suitable', 'particularly_suitable_reason', 'special_features'];
const descriptionSql = () => file('../../supabase/opportunity_description.sql');
const catalogue = () => json<any[]>('SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.opportunities o;');
const applications = () => json<any[]>('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;');
const reviews = () => json<any[]>('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;');
const states = () => json<Record<string, any>>('SELECT jsonb_object_agg(opportunity_id,fields) FROM private.opportunity_search_merge_state;');
const without = (value: Record<string, unknown>, fields: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
const supportRoot = (path: string) => path.replace(/^\//, '').split('/')[0];
let before: any[], beforeApplications: any[], beforeReviews: any[], beforeStates: Record<string, any>, beforeTriggers: any[];

function prerequisites() {
  sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
    DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"is_anonymous":false}'::jsonb $$;
    GRANT USAGE ON SCHEMA auth,private,public TO authenticated;
    GRANT SELECT ON private.opportunity_search_protocols,private.opportunity_search_settings TO authenticated;`);
  sql(file('../opportunityCanonical/fixtures/readiness-v4.sql'));
  for (const [name, args] of [['begin_opportunity_search', 'uuid,uuid'], ['refresh_opportunity_search_protocol', 'uuid'],
    ['save_opportunity_search_queries', 'uuid,jsonb'], ['complete_opportunity_search', 'uuid,jsonb'], ['read_opportunity_search_run', 'uuid']]) {
    sql(`CREATE OR REPLACE FUNCTION private.${name}(${args}) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  }
}

function setup() {
  reset(); upgrade(); prerequisites();
  const records = syntheticCanonicalMigrationRecords();
  Object.assign(records[0]!, {
    research_summary: 'Build acoustic robots. Hands-on experiments are central.',
    particularly_suitable: true, particularly_suitable_reason: 'Matches acoustic research interests.',
    special_features: ['Hands-on experiments are central.', 'Matches acoustic research interests.', 'Access to a dedicated robot lab.'],
  });
  Object.assign(records[1]!, {
    research_summary: 'Study physical sensing.\n\nUnique selling points\n- Existing research partnership.',
    particularly_suitable: false, particularly_suitable_reason: 'Existing research partnership.',
    special_features: ['Existing research partnership.', 'Industry collaboration.'],
  });
  Object.assign(records[2]!, { research_summary: null, particularly_suitable: null, particularly_suitable_reason: null, special_features: [] });
  records.push({ ...records[2], id: '82000000-0000-4000-8000-000000000003', opportunity_key: 'synthetic-features-only',
    title: 'Synthetic feature-only research', particularly_suitable_reason: 'A distinctive experimental research setting.',
    special_features: ['Access to specialised instrumentation.'] });
  for (const record of records) {
    record.sources = [{ url: `https://example.invalid/description/${record.id}`, kind: 'official',
      checked_at: '2026-01-03T09:00:00Z', precision: 'instant',
      supports: ['title', 'research_summary', ...retired, '/special_features/@old-feature', 'personal_fit', 'requirements', 'required_documents'] }];
    insertOpportunity(record);
  }
  sql(file('../../supabase/opportunity_canonical_v5.sql'));
  before = catalogue();
  sql(`INSERT INTO public.opportunity_reviews(user_id,opportunity_id,state,comment,created_at,updated_at)
    VALUES('${owner}','${before[0].id}','strong_interest','Keep my private evaluation.','2000-01-01','2000-01-02');`);
  const application = {
    id: randomUUID(), user_id: owner, opportunity_id: before[0].id, application_code: 'APP-1234567890',
    context_json: { ...before[0], research_summary: 'Frozen application research, not today’s catalogue.',
      particularly_suitable_reason: 'Frozen application fit rationale.', special_features: ['Frozen application distinction.'],
      preserved_private_context: 'Keep this application-only fact.' },
    context_captured_at: '2000-01-01T00:00:00Z', completed_checklist_keys: ['old:qualification:key', 'old:document:key'],
    status: 'submitted', notes: 'Application notes stay private.', submitted_at: '2000-01-04T08:00:00Z',
    status_history: [{ status: 'preparation', changedAt: '2000-01-01T08:00:00Z' }, { status: 'submitted', changedAt: '2000-01-04T08:00:00Z' }],
    workflow_stage: 'tracking', tracking_started: true, created_at: '2000-01-01T08:00:00Z', updated_at: '2000-01-04T08:00:00Z',
  };
  const columns = Object.keys(application).join(',');
  sql(`INSERT INTO public.applications(${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::public.applications,${literal(application)});`);
  sql(`CREATE FUNCTION public.description_fixture_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN new.updated_at=clock_timestamp(); RETURN new; END $$;
    CREATE TRIGGER description_enabled BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.description_fixture_touch();
    CREATE TRIGGER description_disabled BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.description_fixture_touch();
    ALTER TABLE public.applications DISABLE TRIGGER description_disabled;`);
  beforeApplications = applications(); beforeReviews = reviews(); beforeStates = states();
  beforeTriggers = json('SELECT jsonb_agg(jsonb_build_object(\'name\',tgname,\'enabled\',tgenabled) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=\'public.applications\'::regclass AND NOT tgisinternal;');
}

test('description upgrade refuses an active run and rolls back every change', () => {
  setup();
  const guardRun = randomUUID(); seedRun(guardRun);
  const snapshot = { catalogue: catalogue(), applications: applications(), reviews: reviews(), states: states(),
    schema: json('SELECT private.opportunity_storage_schema();'), protocol: sql('SELECT active_protocol_version FROM private.opportunity_search_settings;') };
  assert.throws(() => sql(descriptionSql()), /Finish active opportunity searches/);
  assert.deepEqual({ catalogue: catalogue(), applications: applications(), reviews: reviews(), states: states(),
    schema: json('SELECT private.opportunity_storage_schema();'), protocol: sql('SELECT active_protocol_version FROM private.opportunity_search_settings;') }, snapshot);
  assert.equal(sql("SELECT to_regclass('private.opportunity_description_archive') IS NULL;"), 't');
  sql(`UPDATE public.opportunity_search_runs SET status='complete' WHERE id='${guardRun}';`);
});

test('description migration preserves research and fit rationale once while removing redundant features', () => {
  sql(descriptionSql());
  const after = catalogue();
  assert.equal(after.length, before.length);
  const first = after.find(row => row.id === before[0].id);
  assert.equal(first.research_summary, 'Build acoustic robots. Hands-on experiments are central.\n\nUnique selling points\n- Matches acoustic research interests.\n- Access to a dedicated robot lab.');
  const second = after.find(row => row.id === before[1].id);
  assert.equal(second.research_summary, 'Study physical sensing.\n\nUnique selling points\n- Existing research partnership.\n- Industry collaboration.');
  assert.equal((second.research_summary.match(/Unique selling points/g) || []).length, 1);
  assert.equal(after.find(row => row.id === before[2].id).research_summary, null, 'absence of research stays unknown');
  assert.equal(after.find(row => row.opportunity_key === 'synthetic-features-only').research_summary,
    'Unique selling points\n- A distinctive experimental research setting.\n- Access to specialised instrumentation.', 'features survive when no earlier summary exists');
  for (const row of after) {
    const previous = before.find(item => item.id === row.id);
    assert.equal(row.metadata_schema_version, 6);
    for (const field of retired) assert.equal(Object.hasOwn(row, field), false);
    assert.deepEqual(without(row, ['research_summary', 'sources', 'metadata_schema_version']), without(previous, [...retired, 'research_summary', 'sources', 'metadata_schema_version']));
  }
  assert.equal(sql('SELECT bool_and(private.opportunity_payload_storage_valid(to_jsonb(o))) FROM public.opportunities o;'), 't');
});

test('retired fields disappear from schema, source coverage and current effective-state keys', () => {
  const storage = json('SELECT private.opportunity_storage_schema();');
  assert.deepEqual(storage, JSON.parse(file('../../supabase/opportunity_schema_v6.json')));
  assert.equal(storage['x-canonical-version'], 6);
  const intake = json('SELECT private.opportunity_search_result_schema();');
  for (const field of retired) {
    assert.equal(Object.hasOwn(storage.properties, field), false);
    assert.equal(Object.hasOwn(intake.properties, field), false);
  }
  const afterStates = states();
  for (const row of catalogue()) {
    for (const observation of row.sources) {
      assert.equal(observation.supports.some((path: string) => retired.includes(supportRoot(path))), false);
      assert.equal(new Set(observation.supports).size, observation.supports.length);
    }
    const state = afterStates[row.id];
    assert.equal(Object.keys(state).some(path => retired.includes(supportRoot(path))), false);
    assert.equal(state['/research_summary'].value, row.research_summary);
    const previous = beforeStates[row.id]!;
    const previousEvidence = Object.entries(previous).filter(([path]) => ['research_summary', 'particularly_suitable_reason', 'special_features'].includes(supportRoot(path)))
      .flatMap(([, value]) => (value as { evidence?: unknown[] }).evidence || []).map(value => JSON.stringify(value));
    for (const evidence of state['/research_summary'].evidence) assert.ok(previousEvidence.includes(JSON.stringify(evidence)), 'description evidence must come from the preserved source fields');
    assert.deepEqual(without(state, ['/research_summary']), without(previous, Object.keys(previous).filter(path => ['research_summary', ...retired].includes(supportRoot(path)))));
  }
});

test('frozen applications change representation without refreshing facts or changing private workflow state', () => {
  const after = applications();
  assert.deepEqual(reviews(), beforeReviews);
  assert.equal(after.length, beforeApplications.length);
  for (const application of after) {
    const previous = beforeApplications.find(row => row.id === application.id);
    assert.deepEqual(without(application, ['context_json']), without(previous, ['context_json']));
    const context = application.context_json;
    for (const field of retired) assert.equal(Object.hasOwn(context, field), false);
    assert.equal(context.research_summary, 'Frozen application research, not today’s catalogue.\n\nUnique selling points\n- Frozen application fit rationale.\n- Frozen application distinction.');
    assert.equal(context.preserved_private_context, previous.context_json.preserved_private_context);
    assert.equal(context.metadata_schema_version, 6);
    for (const observation of context.sources) assert.equal(observation.supports.some((path: string) => retired.includes(supportRoot(path))), false, 'saved source coverage uses the current description field');
    assert.deepEqual(without(context, ['research_summary', 'sources', 'metadata_schema_version']), without(previous.context_json, [...retired, 'research_summary', 'sources', 'metadata_schema_version']));
  }
  assert.deepEqual(json('SELECT jsonb_agg(jsonb_build_object(\'name\',tgname,\'enabled\',tgenabled) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=\'public.applications\'::regclass AND NOT tgisinternal;'), beforeTriggers);
});

test('private archive preserves exact before and after payloads for every transformed record', () => {
  const archived = json<any[]>('SELECT jsonb_agg(to_jsonb(a) ORDER BY kind,id) FROM private.opportunity_description_archive a;');
  for (const row of archived) {
    if (row.kind === 'opportunity') {
      assert.deepEqual(row.before_payload, before.find(item => item.id === row.id));
      assert.deepEqual(row.after_payload, catalogue().find(item => item.id === row.id));
    } else if (row.kind === 'application_context') {
      assert.deepEqual(row.before_payload, beforeApplications.find(item => item.id === row.id).context_json);
      assert.deepEqual(row.after_payload, applications().find(item => item.id === row.id).context_json);
    } else {
      assert.deepEqual(row.before_payload, beforeStates[row.id]);
      assert.deepEqual(row.after_payload, states()[row.id]);
    }
  }
  assert.equal(archived.length, before.length * 2 + beforeApplications.length);
});

test('v6 readiness, evidenced writes, verification and exact item retries use the new contract', () => {
  const readiness = json(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}'; SELECT public.opportunity_search_readiness(); COMMIT;`);
  assert.equal(readiness.ready, true); assert.equal(readiness.protocol_version, 'opportunity-search-v1-canonical-6');
  seedRun();
  const payload = { opportunity_key: 'description-v6-save', title: 'New canonical research',
    research_summary: 'Build sensing hardware.\n\nUnique selling points\n- Dedicated experimental facilities.',
    last_checked_at: '2000-01-03T09:00:00Z', sources: [{ url: 'https://example.invalid/jobs/description-v6', kind: 'official',
      checked_at: '2000-01-03T09:00:00Z', precision: 'instant', supports: ['title', 'research_summary'] }] };
  const item = randomUUID(), receipt = submit(payload, item);
  assert.equal(receipt.merge_version, 6); assert.equal(receipt.snapshot.metadata_schema_version, 6);
  assert.equal(receipt.snapshot.research_summary, payload.research_summary);
  assert.ok(receipt.field_decisions.some((decision: any) => decision.path === '/research_summary' && decision.status === 'accepted'));
  assert.deepEqual(submit(payload, item), receipt);
  const state = json(`SELECT fields FROM private.opportunity_search_merge_state WHERE opportunity_id='${receipt.opportunity_id}';`);
  assert.equal(state['/research_summary'].value, payload.research_summary);
  assert.ok(state['/research_summary'].evidence.some((evidence: any) => evidence.url === payload.sources[0].url));
  const verified = json(`SELECT private.verify_opportunity_search_result('${run}','${item}');`);
  assert.equal(verified.verified, true);
  assert.equal(submit(payload, item).verified, true);
  assert.throws(() => submit({ ...payload, research_summary: 'Different evidence' }, item), /cannot be reused/);
});

test('v6 intake rejects retired fields and retired evidence paths without writing records', () => {
  const count = json('SELECT count(*) FROM public.opportunities;');
  const base = { opportunity_key: 'description-v6-rejection', title: 'Reject old fields', last_checked_at: '2000-01-03T09:00:00Z',
    sources: [{ url: 'https://example.invalid/jobs/reject-description', kind: 'official', checked_at: '2000-01-03T09:00:00Z', precision: 'instant', supports: ['title'] }] };
  for (const patch of [{ particularly_suitable: true }, { particularly_suitable_reason: 'Old fit rationale' }, { special_features: ['Old feature'] }]) {
    assert.throws(() => submit({ ...base, ...patch }, randomUUID()), /canonical|schema|Unknown\/protected/i);
  }
  for (const field of retired) assert.throws(() => submit({ ...base, sources: [{ ...base.sources[0], supports: ['title', `/${field}`] }] }, randomUUID()), /Unknown evidence field/);
  assert.equal(json('SELECT count(*) FROM public.opportunities;'), count);
  assert.equal(sql(`SELECT search_id='${search}' FROM public.opportunity_search_runs WHERE id='${run}';`), 't');
});

test('a late malformed saved-context failure rolls back catalogue, schema, constraints and trigger states', () => {
  setup();
  sql(`UPDATE public.applications SET context_json=jsonb_set(context_json,'{special_features}','{"unexpected":"historical object"}');`);
  const snapshot = () => ({ catalogue: catalogue(), applications: applications(), reviews: reviews(), states: states(),
    schema: json('SELECT private.opportunity_storage_schema();'), protocol: sql('SELECT active_protocol_version FROM private.opportunity_search_settings;'),
    constraints: sql("SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.opportunities'::regclass;"),
    triggers: sql("SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.applications'::regclass AND NOT tgisinternal;") });
  const previous = snapshot();
  assert.throws(() => sql(descriptionSql()), /Inspect the non-array special_features/);
  assert.deepEqual(snapshot(), previous);
  assert.equal(sql("SELECT to_regclass('private.opportunity_description_archive') IS NULL;"), 't');
});
