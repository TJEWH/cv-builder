import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { file, insertOpportunity, json, literal, reset, run, owner, seedRun, sql, sqlAsync, submit, upgrade } from './db';

const fixture = JSON.parse(file('./fixtures/run-1602c633.json'));
const t0 = '2026-01-01T09:00:00Z';
const t1 = '2026-01-02T09:00:00Z';
const t2 = '2026-01-03T09:00:00Z';
const url = 'https://example.edu/jobs/research-123';
const source = (supports: string[], time = t1, link = url, kind = 'official') => ({ url: link, kind, checked_at: time, supports });
function payload(fields: Record<string, unknown> = {}, time = t1, key: string = randomUUID()): any {
  return { opportunity_key: key, title: 'Research opportunity', last_checked_at: time, ...fields,
    sources: fields.sources || [source(['title', ...Object.keys(fields).filter((x) => x !== 'merge_control')], time)] };
}
function plan(before: any, incoming: any, state: any = null): any {
  return json(`SELECT private.opportunity_merge_plan(${literal(before)},${literal(incoming)},${literal(state)});`);
}
function canon(field: string, value: unknown): any {
  return json(`SELECT private.opportunity_merge_canonical('${field}',${literal(value)});`);
}
const decisions = (p: any, prefix: string) => (p.decisions || p.field_decisions).filter((d: any) => d.path === prefix || d.path.startsWith(`${prefix}/`));
const assessment = (score: number) => ({ score, scale_min: 0, scale_max: 10, summary: `Evidence-based assessment ${score}` });

test('installed baseline reproduces run 1602c633 and the three known failures', () => {
  reset(); seedRun(fixture.sourceRunId); insertOpportunity(fixture.before);
  const first = submit(fixture.submissions[0].payload, fixture.submissions[0].itemId, fixture.sourceRunId);
  assert.equal(first.snapshot.contacts.filter((x: any) => x.email === 'lauri.juvela@aalto.fi').length, 2);
  assert.deepEqual(first.snapshot.requirements, fixture.before.requirements, 'array/object mismatch silently retains old requirements');
  assert.deepEqual(first.snapshot.required_documents, fixture.before.required_documents);
  const second = submit(fixture.submissions[1].payload, fixture.submissions[1].itemId, fixture.sourceRunId);
  assert.ok(second.conflicts.includes('requirements'), 'rejected/ineffective proposals advanced source timestamps');
  assert.ok(second.conflicts.includes('required_documents'));
});

test('draft replay preserves admission stages/documents and merges people by identity', () => {
  reset(); upgrade(); seedRun(); seedRun(fixture.sourceRunId); insertOpportunity({ ...fixture.before, data: { ...fixture.before.data, unrelated_context: { preserve: 'rich metadata' } } });
  const first = submit(fixture.submissions[0].payload, fixture.submissions[0].itemId, fixture.sourceRunId);
  const second = submit(fixture.submissions[1].payload, fixture.submissions[1].itemId, fixture.sourceRunId);
  for (const r of [first, second]) {
    assert.equal(r.snapshot.contacts.filter((x: any) => x.email === 'lauri.juvela@aalto.fi').length, 1);
    assert.equal(r.snapshot.supervisors.filter((x: any) => x.email === 'lauri.juvela@aalto.fi').length, 1);
    assert.ok(r.snapshot.requirements.some((x: any) => x.stage === 'doctoral_admission'));
    assert.ok(r.snapshot.required_documents.some((x: any) => x.text.includes('Financing plan')));
    assert.ok(r.field_decisions.length > 0);
    assert.ok(r.before_snapshot);
  }
  assert.ok(second.snapshot.required_documents.some((x: any) => x.status === 'conditional'));
  assert.deepEqual(second.snapshot.data.unrelated_context, { preserve: 'rich metadata' }, 'unrelated rich metadata survives');
  assert.ok(first.normalization.some((x: any) => x.field === 'requirements'));
});

// Explicit inventory: a new schema field fails the coverage assertion until it has examples.
const examples: Record<string, [unknown, unknown]> = {
  opportunity_key: ['key-old', 'key-new'], title: ['Research opportunity', 'Corrected role'],
  vacancy_id: ['VAC-1', 'VAC-2'], institution: ['University One', 'University Two'], unit: ['Lab One', 'Lab Two'],
  city: ['Espoo', 'Helsinki'], country: ['Finland', 'Sweden'], position_type: ['PhD', 'Industrial PhD'],
  availability: ['open', 'closed'], official_url: [url, `${url}-updated`], source_url: [url, `${url}-updated`],
  application_url: [`${url}/apply`, `${url}/new-apply`], verification_level: ['official_current', 'official_rechecked'],
  source_context: ['Earlier official context', 'Corrected official context'], deadline: ['2027-01-01', '2027-02-01'],
  deadline_time_local: ['12:00:00', '13:00:00'], deadline_timezone: ['Europe/Helsinki', 'UTC+02:00'],
  deadline_original_text: ['January deadline', 'February deadline'], start_date: ['2027-01-01', '2027-02-01'],
  duration_details: ['Two years', 'Four years'], research_summary: ['Audio research', 'Acoustics research'],
  particularly_suitable: [true, false], particularly_suitable_reason: ['Good research fit', 'Changed research fit'],
  topics: [['Acoustics'], ['BCI']], special_features: [['Hardware'], ['Prototyping']], open_questions: [['Funding?'], ['Teaching?']],
  contacts: [[{ name: 'Person One', email: 'person@example.edu' }], [{ name: 'Person One', email: 'person@example.edu', phone: '123' }]],
  supervisors: [[{ name: 'Person One', email: 'person@example.edu' }], [{ name: 'Person One', email: 'person@example.edu', institution: 'Lab' }]],
  requirements: [[{ text: 'MSc', status: 'required', stage: 'recruitment' }], [{ text: 'English proof', status: 'conditional', stage: 'doctoral_admission' }]],
  required_documents: [[{ text: 'CV', status: 'required', stage: 'recruitment' }], [{ text: 'Plan', status: 'required', stage: 'doctoral_admission' }]],
  salary: [{ amount: 3000, currency: 'EUR', period: 'month', gross: true }, { amount: 3500, currency: 'EUR', period: 'month', gross: true }],
  personal_fit: [assessment(7), assessment(8)], rd_career_potential: [assessment(7), assessment(8)], research_career_potential: [assessment(7), assessment(8)],
  supervisor_reputation: [{ assessment: 'Relevant', evidence: 'Earlier evidence' }, { assessment: 'Established', evidence: 'Current evidence' }],
  hardware_software_balance: [{ summary: 'Software' }, { summary: 'Hardware' }],
  supervisor_research_focus: [{ Person: { topics: ['Audio'], details: 'Earlier focus' } }, { Person: { details: 'Current focus', methods: ['DSP'] } }],
  supervisor_top_papers: [[{ doi: '10.1/one', title: 'Earlier paper' }], [{ doi: '10.1/one', title: 'Corrected paper', year: 2026 }]],
  data: [{ unknown: { preserve: 'rich', replace: 'old' }, research_methods: ['Audio'] }, { unknown: { replace: 'new' }, research_methods: ['DSP'] }],
  last_checked_at: [t0, t1], sources: [[source(['title'], t0)], [source(['title'], t1)]], merge_control: [{ corrections: [] }, { corrections: [] }],
};

test('every result field has an explicit policy/example and every database column is classified', () => {
  const schema = json('SELECT private.opportunity_search_result_schema();');
  assert.deepEqual(Object.keys(examples).sort(), Object.keys(schema.properties).sort());
  const columns: string[] = json(`SELECT jsonb_agg(attname ORDER BY attname) FROM pg_attribute WHERE attrelid='public.opportunities'::regclass AND attnum>0 AND NOT attisdropped;`);
  const protectedColumns = ['id', 'record_type', 'metadata_schema_version', 'created_at', 'updated_at'];
  assert.deepEqual(columns, [...Object.keys(examples).filter((x) => x !== 'merge_control'), ...protectedColumns].sort());
  for (const key of protectedColumns) {
    assert.throws(() => submit(payload({ [key]: 'forbidden' }), randomUUID()), /Unknown\/protected/);
  }
});

test('all writable fields: additions, newer/older/equal evidence, empty partials, repeated submissions', async (ctx) => {
  for (const [field, [a, b]] of Object.entries(examples)) {
    await ctx.test(field, () => {
      const base = payload({ [field]: a }, t0, `matrix-${field}`);
      const next = payload({ [field]: b }, t1, `matrix-${field}`);
      const fresh = plan(null, base);
      if (!['merge_control', 'sources'].includes(field)) assert.ok(fresh.value[field] !== undefined, `${field}: new value persisted`);
      const p = plan(fresh.value, next, fresh.state);
      assert.ok(p.decisions.length > 0);
      const replay = plan(p.value, next, p.state);
      assert.deepEqual(replay.value, p.value, `${field}: duplicate is stable`);
      assert.deepEqual(replay.state, p.state, `${field}: duplicate evidence is stable`);
      if (!['opportunity_key', 'last_checked_at', 'sources', 'merge_control'].includes(field)) {
        const stale = plan(fresh.value, { ...next, sources: [source(['title', field], '2025-12-31T09:00:00Z')] }, fresh.state);
        assert.ok(decisions(stale, `/${field}`).filter((d: any) => d.before !== null).every((d: any) => JSON.stringify(d.after) === JSON.stringify(d.before)), `${field}: stale evidence retains every existing value; separately evidenced additions may fill gaps`);
        const equal = plan(fresh.value, { ...next, sources: [source(['title', field], t0)] }, fresh.state);
        const ds = decisions(equal, `/${field}`);
        assert.ok(ds.every((d: any) => ['unchanged', 'conflicting', 'accepted'].includes(d.status)));
        assert.ok(ds.filter((d: any) => d.before !== null && JSON.stringify(d.before) !== JSON.stringify(d.proposed)).every((d: any) => d.status !== 'accepted'), `${field}: equal timestamp cannot overwrite a value`);
        const emptyValue = Array.isArray(a) ? [] : typeof a === 'object' ? {} : typeof a === 'string' && ['title','verification_level'].includes(field) ? a : null;
        if (['personal_fit','rd_career_potential','research_career_potential'].includes(field)) {
          assert.throws(() => plan(fresh.value, { ...base, [field]: emptyValue }, fresh.state), /schema/, 'incomplete assessments must be omitted');
        } else {
          const empty = plan(fresh.value, { ...base, [field]: emptyValue }, fresh.state);
          assert.deepEqual(empty.value[field], fresh.value[field], `${field}: null partial cannot erase`);
        }
      }
    });
  }
});

test('rejected sources cannot poison later corrections, including previously untouched fields', () => {
  const p0 = plan(null, payload({ city: 'Espoo', country: 'Finland' }, t0, 'poison'));
  const rejected = plan(p0.value, payload({ city: 'False city', sources: [source(['city', 'country'], t2, 'https://other.edu/jobs/123')] }, t2, 'poison'), p0.state);
  assert.equal(rejected.value.city, 'Espoo');
  assert.deepEqual(rejected.state['/city'], p0.state['/city']);
  const corrected = plan(rejected.value, payload({ city: 'Helsinki', country: 'Sweden' }, t1, 'poison'), rejected.state);
  assert.equal(corrected.value.city, 'Helsinki');
  assert.equal(corrected.value.country, 'Sweden');
  assert.equal(corrected.state['/city'].evidence[0].checked_at, t1);
});

test('same-evidence corrections use exact expected values and original timestamps', () => {
  const p0 = plan(null, payload({ city: 'Espoo' }, t1, 'correct'));
  const proposed = payload({ city: 'Helsinki' }, t1, 'correct');
  const equal = plan(p0.value, proposed, p0.state);
  assert.equal(equal.value.city, 'Espoo');
  assert.equal(decisions(equal, '/city')[0].status, 'conflicting');
  const correction = { corrections: [{ path: '/city', expected: 'Espoo', reason: 'Correct interpretation of the same official page.' }] };
  const corrected = plan(equal.value, { ...proposed, merge_control: correction }, equal.state);
  assert.equal(corrected.value.city, 'Helsinki');
  assert.equal(decisions(corrected, '/city')[0].reason, 'same_evidence_correction');
  assert.equal(corrected.state['/city'].evidence[0].checked_at, t1);
  const stale = plan(corrected.value, { ...proposed, city: 'Another city', merge_control: correction, sources: [source(['city'], t2)] }, corrected.state);
  assert.equal(stale.value.city, 'Helsinki');
  assert.equal(decisions(stale, '/city')[0].reason, 'correction_precondition_failed');
});

test('people normalization is deterministic, enriches identities and preserves ambiguity/roles', () => {
  const raw = [{ name: 'Lauri Juvela', email: ' LAURI@EXAMPLE.EDU ', role: 'Supervisor' }, { name: 'Lauri Juvela', email: 'lauri@example.edu', phone: '123', role: 'Scientific contact' }];
  const a = canon('contacts', raw);
  assert.deepEqual(a, canon('contacts', raw.toReversed()));
  assert.deepEqual(a, canon('contacts', a), 'normalization is idempotent');
  assert.equal(a.length, 1); assert.equal(a[0].roles.length, 2); assert.ok(a[0].legacy_variants);
  assert.equal(canon('contacts', [{ name: 'Same Name', email: 'one@u.edu' }, { name: 'Same Name', email: 'two@u.edu' }]).length, 2);
  const p0 = plan(null, payload({ contacts: [{ name: 'New Person' }] }, t0, 'people'));
  const p1 = plan(p0.value, payload({ contacts: [{ name: 'New Person', email: 'new@u.edu' }] }, t1, 'people'), p0.state);
  assert.equal(p1.value.contacts.length, 1); assert.equal(p1.value.contacts[0].email, 'new@u.edu');
});

test('checklists preserve statuses, conditions, stages, unknown groups and legacy values', () => {
  const raw = { required: ['MSc'], optional: [{ document: 'Portfolio', condition: 'If available' }], conditional: ['Language test'], university_admission: ['Plan'], custom_group: ['Special form'] };
  const c = canon('required_documents', raw);
  assert.equal(c.find((x: any) => x.text === 'Portfolio').status, 'optional');
  assert.equal(c.find((x: any) => x.text === 'Portfolio').condition, 'If available');
  assert.equal(c.find((x: any) => x.text === 'Language test').status, 'conditional');
  assert.equal(c.find((x: any) => x.text === 'Plan').stage, 'doctoral_admission');
  assert.equal(c.find((x: any) => x.text === 'Special form').legacy_group, 'custom_group');
  assert.deepEqual(canon('required_documents', c), c);
  assert.equal(canon('requirements', ['Unlabelled item'])[0].status, 'unspecified');
  const stages = canon('requirements', [{ requirement: 'MSc', stage: 'recruitment' }, { requirement: 'MSc', stage: 'doctoral_admission' }]);
  assert.equal(stages.length, 2, 'different stages are distinct');
});

test('type conflicts stay visible; extension arrays and assessments are atomic', () => {
  const p0 = plan(null, payload({ data: { custom: ['one'], typed: { existing: true }, living_standard: { score: 4, oldDetail: 'old' } }, personal_fit: assessment(6) }, t0, 'types'));
  const p1 = plan(p0.value, payload({ data: { custom: ['two'], typed: ['wrong-shape'], living_standard: { score: 5 } }, personal_fit: assessment(8) }, t1, 'types'), p0.state);
  assert.deepEqual(p1.value.data.custom, ['two']);
  assert.deepEqual(p1.value.data.typed, { existing: true });
  assert.deepEqual(p1.value.data.living_standard, { score: 5 });
  assert.deepEqual(p1.value.personal_fit, assessment(8));
  assert.equal(decisions(p1, '/data/typed')[0].status, 'conflicting');
  assert.throws(() => plan(p0.value, payload({ personal_fit: { score: 80, summary: 'legacy' } })), /schema/);
});

test('precise pointer evidence only changes the supported leaves', () => {
  const p0 = plan(null, payload({ data: { a: 'old', b: 'old' } }, t0, 'paths'));
  const p1 = plan(p0.value, payload({ data: { a: 'new', b: 'new' }, sources: [source(['/data/a'], t1)] }, t1, 'paths'), p0.state);
  assert.equal(p1.value.data.a, 'new'); assert.equal(p1.value.data.b, 'old');
  assert.deepEqual(p1.state['/data/b'], p0.state['/data/b']);
});

test('salary/deadline tuples avoid mixed units and stale local times', () => {
  const p0 = plan(null, payload({ salary: { amount: 3000, currency: 'EUR', period: 'month' }, deadline: '2027-01-01', deadline_time_local: '12:00:00', deadline_timezone: 'Europe/Helsinki' }, t0, 'tuples'));
  const bad = plan(p0.value, payload({ salary: { amount: 4000 }, deadline: '2027-02-01' }, t1, 'tuples'), p0.state);
  assert.equal(bad.value.salary.amount, 3000); assert.equal(bad.value.deadline, '2027-01-01');
  const good = plan(p0.value, payload({ salary: { amount: 4000, currency: 'USD', period: 'year' }, deadline: '2027-02-01', deadline_time_local: '13:00:00', deadline_timezone: 'UTC+02:00' }, t1, 'tuples'), p0.state);
  assert.equal(good.value.salary.currency, 'USD'); assert.equal(good.value.deadline, '2027-02-01');
});

test('legacy aliases normalize without changing immutable original payloads', () => {
  const p = payload({ contact: { name: 'Contact', email: 'contact@u.edu' }, documents: { optional: ['Portfolio'] }, salary_text: 'Funded stipend; amount unspecified', university: 'University' });
  const r = submit(p, randomUUID());
  assert.equal(r.snapshot.contacts[0].email, 'contact@u.edu');
  assert.equal(r.snapshot.required_documents[0].status, 'optional');
  assert.equal(r.snapshot.salary.legacy_value, p.salary_text);
  assert.equal(r.snapshot.institution, 'University');
});

test('submission is atomic/idempotent and receipts explain all decisions with diffs', () => {
  const p = payload({ city: 'Espoo', personal_fit: assessment(7) }); const item = randomUUID();
  const r = submit(p, item); const again = submit(p, item);
  assert.deepEqual(again, r);
  assert.equal(json(`SELECT count(*) FROM private.opportunity_search_merge_audit WHERE run_id='${run}' AND item_id='${item}';`), 1);
  assert.throws(() => submit({ ...p, city: 'changed' }, item), /cannot be reused/);
  const noop = submit(p, randomUUID()); assert.equal(noop.snapshot.updated_at, r.snapshot.updated_at);
  const verified = json(`SELECT private.verify_opportunity_search_result('${run}','${item}');`);
  assert.equal(verified.verified, true);
  assert.ok(r.field_decisions.every((d: any) => 'before' in d && 'after' in d && 'proposed' in d));
  const counts = sql('SELECT count(*) FROM public.opportunities;');
  assert.throws(() => submit(payload({ personal_fit: { score: 100, summary: 'invalid' } }), randomUUID()), /schema/);
  assert.equal(sql('SELECT count(*) FROM public.opportunities;'), counts);
});

test('concurrent submissions serialize identities and preserve both independent enrichments', async () => {
  const run2 = randomUUID(); seedRun(run2);
  const key = `concurrent-${randomUUID()}`; const item1 = randomUUID(); const item2 = randomUUID();
  const p1 = payload({ city: 'Espoo' }, t1, key); const p2 = payload({ country: 'Finland' }, t1, key);
  const a = sqlAsync(`BEGIN; SELECT private.submit_opportunity_search_result('${run}','${item1}',${literal(p1)}); SELECT pg_sleep(0.3); COMMIT;`);
  const b = sqlAsync(`SELECT private.submit_opportunity_search_result('${run2}','${item2}',${literal(p2)});`);
  await Promise.all([a, b]);
  const rows = json(`SELECT jsonb_agg(to_jsonb(o)) FROM public.opportunities o WHERE opportunity_key='${key}';`);
  assert.equal(rows.length, 1); assert.equal(rows[0].city, 'Espoo'); assert.equal(rows[0].country, 'Finland');
});

test('run rollback previews, restores exact snapshots, and preserves reviews/application context', () => {
  const rId = randomUUID(); seedRun(rId);
  const before = insertOpportunity({ opportunity_key: `rollback-${randomUUID()}`, title: 'Research opportunity', city: 'Espoo', sources: [source(['title','city'], t0)] });
  const id = before.id;
  sql(`INSERT INTO public.opportunity_reviews(user_id,opportunity_id,state,comment) VALUES('${owner}','${id}','interested','Private review');`);
  // Populate all installed NOT NULL fields without involving application workflow RPCs.
  const appColumns = json<any[]>(`SELECT jsonb_agg(jsonb_build_object('name',column_name,'default',column_default,'nullable',is_nullable,'type',udt_name)) FROM information_schema.columns WHERE table_schema='public' AND table_name='applications';`);
  const app: any = { id: randomUUID(), user_id: owner, opportunity_id: id, application_code: 'APP-1234567890', context_json: { frozen: 'Original application context' }, status_history: [{ status: 'preparation', at: t0 }] };
  for (const c of appColumns) if (c.nullable === 'NO' && c.default === null && app[c.name] === undefined) app[c.name] = c.type === 'jsonb' ? {} : c.type === 'timestamptz' ? t0 : c.type === 'bool' ? false : c.type === 'int4' ? 1 : c.type === 'uuid' ? randomUUID() : 'fixture';
  const cols = Object.keys(app).map((k) => `"${k}"`).join(',');
  sql(`INSERT INTO public.applications(${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public.applications,${literal(app)});`);
  const contextBefore = sql(`SELECT to_jsonb(a) FROM public.applications a WHERE id='${app.id}';`);
  submit(payload({ city: 'Helsinki' }, t1, before.opportunity_key), randomUUID(), rId);
  submit(payload({ country: 'Finland' }, t2, before.opportunity_key), randomUUID(), rId);
  sql(`UPDATE public.opportunity_search_runs SET status='complete' WHERE id='${rId}';`);
  assert.deepEqual(json(`SELECT private.rollback_opportunity_search_merge('${rId}');`).blockers, []);
  assert.equal(json(`SELECT private.rollback_opportunity_search_merge('${rId}',true);`).applied, true);
  assert.deepEqual(json(`SELECT to_jsonb(o) FROM public.opportunities o WHERE id='${id}';`), before);
  assert.equal(sql(`SELECT to_jsonb(a) FROM public.applications a WHERE id='${app.id}';`), contextBefore);
  assert.equal(sql(`SELECT comment FROM public.opportunity_reviews WHERE opportunity_id='${id}';`), 'Private review');
});

test('rollback refuses later writes and new-record deletion; admin-only functions stay private', () => {
  const rId = randomUUID(); seedRun(rId);
  const b = insertOpportunity({ opportunity_key: `later-${randomUUID()}`, title: 'Research opportunity', city: 'Espoo', sources: [source(['title','city'], t0)] });
  submit(payload({ city: 'Helsinki' }, t1, b.opportunity_key), randomUUID(), rId);
  sql(`UPDATE public.opportunity_search_runs SET status='complete' WHERE id='${rId}'; UPDATE public.opportunities SET country='Later manual update' WHERE id='${b.id}';`);
  assert.equal(json(`SELECT private.rollback_opportunity_search_merge('${rId}');`).blockers[0].reason, 'changed_after_run');
  assert.throws(() => sql(`SELECT private.rollback_opportunity_search_merge('${rId}',true);`), /Rollback blocked/);
  const newRun = randomUUID(); seedRun(newRun); submit(payload(), randomUUID(), newRun);
  sql(`UPDATE public.opportunity_search_runs SET status='complete' WHERE id='${newRun}';`);
  assert.equal(json(`SELECT private.rollback_opportunity_search_merge('${newRun}');`).blockers[0].reason, 'new_record_removal_requires_separate_approval');
  const legacyRun = randomUUID(); seedRun(legacyRun); sql(`UPDATE public.opportunity_search_runs SET status='complete' WHERE id='${legacyRun}';`);
  assert.equal(json(`SELECT private.rollback_opportunity_search_merge('${legacyRun}');`).applied, false);
  assert.equal(sql(`SELECT has_function_privilege('authenticated','private.submit_opportunity_search_result(uuid,uuid,jsonb)','EXECUTE');`), 'f');
  assert.equal(sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'opportunity_merge_%' AND prosecdef;`), '0');
});

test('one complete new record and update round-trip every writable schema field through the real writer', () => {
  const key = randomUUID();
  const firstFields = Object.fromEntries(Object.entries(examples).map(([k, pair]) => [k, pair[0]]));
  const nextFields = Object.fromEntries(Object.entries(examples).map(([k, pair]) => [k, pair[1]]));
  for (const x of [firstFields,nextFields]) { delete x.sources; delete x.merge_control; delete x.opportunity_key; }
  nextFields.vacancy_id = firstFields.vacancy_id;
  const p0 = payload(firstFields, t0, key); const r0 = submit(p0, randomUUID());
  const p1 = payload(nextFields, t1, key); const r1 = submit(p1, randomUUID());
  assert.deepEqual(r1.before_snapshot, r0.snapshot);
  for (const field of Object.keys(firstFields)) assert.ok(field in r1.snapshot, field);
  assert.equal(r1.snapshot.personal_fit.score, 8);
  assert.equal(r1.previous_assessments.personal_fit.score, 7);
  const item = randomUUID(); const r2 = submit(p1,item);
  assert.equal(r2.snapshot.updated_at, r1.snapshot.updated_at);
  assert.deepEqual(submit(p1,item),r2);
});

test('historical source observations match URL/kind/check time while effective claims remain separate', () => {
  const raw = [source(['city'],t1),source(['country'],t1,`${url}?utm_source=test`)];
  const c = canon('sources',raw);
  assert.equal(c.length,1); assert.deepEqual(c[0].supports,['city','country']);
  assert.deepEqual(canon('sources',c),c);
  const history = canon('sources',[...raw,source(['city'],t0)]);
  assert.equal(history.length,2,'different observations retain their exact check times');
});

test('an audit failure rolls back values, effective evidence, aliases and receipts together', () => {
  const key = randomUUID(); const r0 = submit(payload({ city:'Espoo' },t0,key),randomUUID());
  const before = sql(`SELECT fields FROM private.opportunity_search_merge_state WHERE opportunity_id='${r0.opportunity_id}';`);
  sql(`CREATE FUNCTION private.fail_merge_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;
    CREATE TRIGGER fail_merge_audit_fixture BEFORE INSERT ON private.opportunity_search_merge_audit FOR EACH ROW EXECUTE FUNCTION private.fail_merge_audit_fixture();`);
  const item = randomUUID();
  try { assert.throws(() => submit(payload({ city:'Helsinki' },t1,key),item),/fixture audit failure/); }
  finally { sql('DROP TRIGGER fail_merge_audit_fixture ON private.opportunity_search_merge_audit; DROP FUNCTION private.fail_merge_audit_fixture();'); }
  assert.deepEqual(json(`SELECT to_jsonb(o) FROM public.opportunities o WHERE id='${r0.opportunity_id}';`),r0.snapshot);
  assert.equal(sql(`SELECT fields FROM private.opportunity_search_merge_state WHERE opportunity_id='${r0.opportunity_id}';`),before);
  assert.equal(sql(`SELECT count(*) FROM public.opportunity_search_receipts WHERE run_id='${run}' AND item_id='${item}';`),'0');
});

test('concurrent identical item retries produce one value/evidence/audit receipt', async () => {
  const item = randomUUID(); const p = payload({ city:'Espoo' });
  const query = `SELECT private.submit_opportunity_search_result('${run}','${item}',${literal(p)});`;
  const [a,b] = await Promise.all([sqlAsync(query),sqlAsync(query)]);
  assert.deepEqual(JSON.parse(a),JSON.parse(b));
  assert.equal(sql(`SELECT count(*) FROM private.opportunity_search_merge_audit WHERE item_id='${item}';`),'1');
});

test('vacancy-ID corrections require a canonical compare-and-set and retire the erroneous alias', () => {
  const key = randomUUID(); const p = payload({ institution:'University',vacancy_id:'WRONG-ID' },t0,key);
  submit(p,randomUUID());
  assert.throws(() => submit(payload({ institution:'University',vacancy_id:'RIGHT-ID' },t1,key),randomUUID()),/Conflicting vacancy IDs/);
  const r = submit(payload({ institution:'University',vacancy_id:'RIGHT-ID',merge_control:{ corrections:[{ path:'/vacancy_id',expected:'WRONG-ID',reason:'Correct the transcribed official vacancy ID.' }] } },t1,key),randomUUID());
  assert.equal(r.snapshot.vacancy_id,'RIGHT-ID');
  assert.equal(sql(`SELECT count(*) FROM private.opportunity_search_identities WHERE opportunity_id='${r.opportunity_id}' AND identity_key='vacancy:university:wrong-id';`),'0');
});

test('salary supplements cannot advance effective quote evidence and ambiguous units stay legacy', () => {
  const p0 = plan(null,payload({salary:{amount:3000,currency:'EUR',period:'month',gross:true}},t0,'salary-scope'));
  const p1 = plan(p0.value,payload({salary:{details:'Verified funding details'}},t2,'salary-scope'),p0.state);
  assert.deepEqual(p1.state['/salary/@quote'],p0.state['/salary/@quote']);
  const p2 = plan(p1.value,payload({salary:{amount:3500,currency:'EUR',period:'month',gross:true}},t1,'salary-scope'),p1.state);
  assert.equal(p2.value.salary.amount,3500);
  assert.equal(p2.value.salary.details,'Verified funding details');
  const legacy = canon('salary',{amount:'3000',currency:'eur',period:'monthly',other:'retain'});
  assert.equal(legacy.amount,3000); assert.equal(legacy.currency,'EUR'); assert.equal(legacy.period,'month');
  assert.equal(legacy.legacy_fields.amount,'3000'); assert.equal(legacy.other,'retain');
  assert.equal(canon('salary',{currency:'$'}).legacy_fields.currency,'$');
});

test('malformed historical source dates stay lossless and cannot authorize replacement', () => {
  const before = {opportunity_key:'legacy-time',title:'Research opportunity',city:'Espoo',sources:[{url,kind:'official',checked_at:'Tuesday',supports:['city']}],last_checked_at:t0};
  const p = plan(before,payload({country:'Finland'},t1,'legacy-time'));
  assert.equal(p.value.city,'Espoo');
  assert.ok(p.value.sources.some((s:any)=>s.checked_at==='Tuesday'));
  const r = plan(before,payload({city:'Helsinki',sources:[source(['city'],'2026-01-02')]},t1,'legacy-time'));
  assert.equal(r.value.city,'Espoo');
});

test('publication groups preserve all supervisor associations with one DOI identity', () => {
  const papers = canon('supervisor_top_papers',[{supervisor:'Person One',papers:[{doi:'10.1/example',title:'Paper'}]},{supervisor:'Person Two',papers:[{doi:'https://doi.org/10.1/example',title:'Paper'}]}]);
  assert.equal(papers.length,1); assert.deepEqual(papers[0].supervisors,['Person One','Person Two']);
  assert.deepEqual(canon('supervisor_top_papers',papers),papers);
});

test('confirmed unchanged values advance only their own effective evidence and block stale changes', () => {
  const p0 = plan(null,payload({city:'Espoo',country:'Finland'},t0,'revalidate'));
  const p1 = plan(p0.value,payload({city:'Espoo'},t2,'revalidate'),p0.state);
  assert.equal(p1.state['/city'].evidence[0].checked_at,t2);
  assert.deepEqual(p1.state['/country'],p0.state['/country']);
  assert.equal(decisions(p1,'/city')[0].reason,'same_value_revalidated');
  const p2 = plan(p1.value,payload({city:'Helsinki'},t1,'revalidate'),p1.state);
  assert.equal(p2.value.city,'Espoo'); assert.equal(decisions(p2,'/city')[0].reason,'stale_evidence');
});

test('entity evidence paths remain stable when email or DOI enriches an identity', () => {
  const p0 = plan(null,payload({contacts:[{name:'Person',role:'Supervisor'}],supervisor_top_papers:[{title:'Paper',year:2026,url:'https://u.edu/paper/1'}]},t0,'entity-paths'));
  const p1 = plan(p0.value,payload({contacts:[{name:'Person',email:'person@u.edu',role:'Confirmed supervisor'}],supervisor_top_papers:[{title:'Paper',year:2026,url:'https://u.edu/paper/1',doi:'10.1/new'}]},t2,'entity-paths'),p0.state);
  assert.equal(p1.value.contacts.length,1); assert.equal(p1.value.supervisor_top_papers.length,1);
  assert.equal(p1.value.contacts[0].entity_id,p0.value.contacts[0].entity_id);
  assert.equal(p1.value.supervisor_top_papers[0].entity_id,p0.value.supervisor_top_papers[0].entity_id);
  const p2 = plan(p1.value,payload({contacts:[{name:'Person',email:'person@u.edu',role:'Stale role'}]},t1,'entity-paths'),p1.state);
  assert.equal(p2.value.contacts[0].role,'Confirmed supervisor');
});

test('whole-object corrections honor newer leaves and protect later leaf updates/cleared values', () => {
  const p0 = plan(null,payload({data:{a:'old',b:'retain'}},t0,'parent-correction'));
  const p1 = plan(p0.value,payload({data:{a:'new'}},t2,'parent-correction'),p0.state);
  const control = {corrections:[{path:'/data',expected:p1.value.data,reason:'Correct the full interpretation.'}]};
  const stale = plan(p1.value,payload({data:{a:'wrong'},merge_control:control},t1,'parent-correction'),p1.state);
  assert.deepEqual(stale.value.data,p1.value.data);
  const t3 = '2026-01-04T09:00:00Z';
  const corrected = plan(p1.value,payload({data:{a:'correct'},merge_control:control},t3,'parent-correction'),p1.state);
  assert.deepEqual(corrected.value.data,{a:'correct'});
  const old = plan(corrected.value,payload({data:{a:'stale',b:'resurrected'}},t2,'parent-correction'),corrected.state);
  assert.deepEqual(old.value.data,{a:'correct'});
  assert.ok(decisions(old,'/data/b').some((d:any)=>d.reason==='stale_evidence_for_cleared_value'));
});

test('normalized set equivalents keep their stored value and effective evidence consistent', () => {
  const p0 = plan(null,payload({topics:['Signal processing']},t0,'set-values'));
  const p1 = plan(p0.value,payload({topics:['SIGNAL_PROCESSING']},t1,'set-values'),p0.state);
  assert.deepEqual(p1.value.topics,['Signal processing']);
  const d = decisions(p1,'/topics')[0];
  assert.equal(p1.state[d.path].value,p1.value.topics[0]);
  assert.equal(p1.state[d.path].evidence[0].checked_at,t1);
});

test('evidence paths treat underscores as literal characters, never SQL LIKE wildcards', () => {
  const p0 = plan(null,payload({data:{a_b:{value:'old'},aZb:{value:'old'}}},t0,'literal-paths'));
  const p1 = plan(p0.value,payload({data:{a_b:{value:'new'},aZb:{value:'wrong'}},sources:[source(['/data/a_b'],t1)]},t1,'literal-paths'),p0.state);
  assert.equal(p1.value.data.a_b.value,'new'); assert.equal(p1.value.data.aZb.value,'old');
});

test('equivalent local deadline time formats are unchanged without invented precision', () => {
  const p0 = plan(null,payload({deadline:'2027-01-01',deadline_time_local:'12:00',deadline_timezone:'UTC+02:00'},t0,'time-format'));
  const p1 = plan(p0.value,payload({deadline_time_local:'12:00:00'},t0,'time-format'),p0.state);
  assert.equal(p1.value.deadline_time_local,'12:00:00');
  assert.equal(decisions(p1,'/deadline_time_local')[0].status,'unchanged');
  const dateOnly = plan(null,payload({deadline:'2027-01-01'},t0,'date-only'));
  assert.ok(!dateOnly.value.deadline_time_local);
});

test('concurrent corrections cannot both win against the same expected scalar', async () => {
  const key = randomUUID(); const otherRun = randomUUID(); seedRun(otherRun);
  submit(payload({city:'Espoo'},t0,key),randomUUID());
  const correction = {corrections:[{path:'/city',expected:'Espoo',reason:'Correct workplace against current official evidence.'}]};
  const p1 = payload({city:'Helsinki',merge_control:correction},t1,key);
  const p2 = payload({city:'Turku',merge_control:correction},t1,key);
  const results = await Promise.all([
    sqlAsync(`SELECT private.submit_opportunity_search_result('${run}','${randomUUID()}',${literal(p1)});`),
    sqlAsync(`SELECT private.submit_opportunity_search_result('${otherRun}','${randomUUID()}',${literal(p2)});`),
  ]);
  const cityDecisions = results.map((x)=>decisions(JSON.parse(x),'/city')[0]);
  assert.equal(cityDecisions.filter((x:any)=>x.status==='accepted').length,1);
  assert.equal(cityDecisions.filter((x:any)=>x.reason==='correction_precondition_failed').length,1);
});

test('same-evidence legacy corrections are not blocked by additional historical observations', () => {
  const before = {opportunity_key:'legacy-correction',title:'Research opportunity',city:'Espoo',last_checked_at:t1,
    sources:[source(['city'],t0),source(['city'],t1),source(['city'],t1,'https://example.edu/graduate-school','graduate_school')]};
  const p = plan(before,payload({city:'Helsinki',sources:[source(['city'],t1,url,'institution')],merge_control:{corrections:[{path:'/city',expected:'Espoo',reason:'Correct the interpretation of this exact official notice.'}]}},t1,'legacy-correction'));
  assert.equal(p.value.city,'Helsinki');
  assert.equal(decisions(p,'/city')[0].reason,'same_evidence_correction');
  assert.equal(decisions(p,'/city')[0].after_evidence[0].checked_at,t1);
});

test('all installed research/teaching aliases normalize, while contradictory aliases stay unresolved', () => {
  for (const alias of ['teaching','teaching_text','teaching_and_departmental_duties']) {
    const p = plan(null,payload({data:{[alias]:'Official teaching duties'}}));
    assert.equal(p.value.data.teaching_load,'Official teaching duties');
  }
  for (const alias of ['methods','methodology','advertised_methods']) {
    const p = plan(null,payload({data:{[alias]:['DSP']}}));
    assert.deepEqual(p.value.data.research_methods,['DSP']);
  }
  const p = plan(null,payload({data:{methods:['DSP'],methodology:['BCI']}}));
  assert.ok(!p.value.data.research_methods);
  assert.deepEqual(p.value.data.methods,['DSP']); assert.deepEqual(p.value.data.methodology,['BCI']);
  assert.ok(p.decisions.some((d:any)=>d.reason==='ambiguous_legacy_aliases'));
  const equivalent = plan(null,payload({data:{methods:['DSP','ML'],methodology:['ML','DSP']}}));
  assert.deepEqual(equivalent.value.data.research_methods,['DSP','ML']);
  assert.ok(!equivalent.decisions.some((d:any)=>d.reason==='ambiguous_legacy_aliases'));
});

test('inspection returns raw and canonical legacy snapshots plus effective evidence for corrections', () => {
  const key = randomUUID();
  insertOpportunity({opportunity_key:key,title:'Research opportunity',requirements:['MSc'],sources:[source(['requirements'],t1)]});
  const inspected = json(`SELECT private.inspect_opportunity_search_result('${run}',${literal({opportunity_key:key})});`);
  assert.deepEqual(inspected.snapshot.requirements,['MSc']);
  assert.equal(inspected.canonical_snapshot.requirements[0].text,'MSc');
  const expected = inspected.canonical_snapshot.requirements;
  const next = [{text:'Relevant MSc',status:'required',stage:'recruitment'}];
  const p = payload({requirements:next,merge_control:{corrections:[{path:'/requirements',expected,reason:'Correct the scope using the same official evidence.'}]}},t1,key);
  const r = submit(p,randomUUID()); assert.equal(r.snapshot.requirements[0].text,'Relevant MSc');
  const after = json(`SELECT private.inspect_opportunity_search_result('${run}',${literal({opportunity_key:key})});`);
  assert.deepEqual(after.effective_fields['/requirements'].value,r.snapshot.requirements);
  assert.equal(after.effective_fields['/requirements'].evidence[0].checked_at,t1);
});
