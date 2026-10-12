/**
 * Isolated PostgreSQL checks; never connects to a Supabase project.
 * Run: node test/opportunitySearch/sqlRunner.mjs
 * If PGlite is installed outside this project, set PGLITE_MODULE_PATH to its
 * absolute ESM entry file (for example /path/node_modules/@electric-sql/pglite/dist/index.js).
 * Auth helpers below model the claims used by SQL policies; this does not test GoTrue,
 * PostgREST, a live connector, real parallel connections, or ChatGPT scheduling.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '@electric-sql/pglite').catch(error => {
  throw new Error('Install the project PGlite dev dependency or set PGLITE_MODULE_PATH to its ESM entry file.', { cause: error });
});
const read = path => readFile(resolve(root, path), 'utf8');
const schema = await read('supabase/schema.sql');
const upgrade = await read('supabase/opportunity_search.sql');
const release = await read('supabase/opportunity_search_protocol.sql');
const protocolText = await read('test/opportunitySearch/generated/protocol.md');
const resultSchema = JSON.parse(await read('test/opportunitySearch/generated/result.schema.json'));
const expectedHash = 'sha256:' + createHash('sha256').update(JSON.stringify({ text: protocolText, schema: resultSchema, bootstrap: 1 })).digest('hex');
const authStub = `
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,aud text,role text,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;`;

async function withDatabase(test) {
  const database = new PGlite();
  try {
    await database.exec(authStub);
    await test(database);
  } finally { await database.close(); }
}

async function assertProtocol(database) {
  const result = await database.query(`select p.* from private.opportunity_search_protocols p
    join private.opportunity_search_settings s on s.active_protocol_version=p.version;`);
  assert.equal(result.rows.length, 1, 'Exactly one installed protocol must be active');
  const protocol = result.rows[0];
  assert.equal(protocol.contract_version, 1);
  assert.equal(protocol.protocol_hash, expectedHash, 'Stored hash must match the generated source and schema');
  assert.equal(protocol.protocol_text, protocolText);
  assert.deepEqual(protocol.result_schema, resultSchema);
  return protocol;
}

async function assertNoFixtureRows(database) {
  for (const table of ['auth.users', 'public.opportunities', 'public.applications', 'public.application_refinement_requests',
    'public.application_refinement_proposals', 'public.application_refinement_reviews', 'public.opportunity_search_templates',
    'public.opportunity_search_runs', 'public.opportunity_search_query_revisions', 'public.opportunity_search_schedule_bindings',
    'public.opportunity_search_receipts']) {
    const count = await database.query(`select count(*)::integer as count from ${table}`);
    assert.equal(count.rows[0].count, 0, `${table}: SQL fixture did not roll back`);
  }
}

await withDatabase(async database => {
  await database.exec(schema);
  const installed = await assertProtocol(database);
  const suites = (await readdir(resolve(root, 'supabase/tests'))).filter(name => name.endsWith('.sql')).sort();
  for (const name of suites) {
    try { await database.exec(await read(`supabase/tests/${name}`)); }
    catch (error) { throw new Error(`${name}: ${error.message}\n${error.where || ''}`, { cause: error }); }
    console.log(`PASS: ${name}`);
  }
  await assertNoFixtureRows(database);
  await database.exec(upgrade);
  await database.exec(release);
  await database.exec(release);
  assert.deepEqual(await assertProtocol(database), installed, 'Repeated seeds must preserve immutable release contents and creation time');
  const count = await database.query('select count(*)::integer as count from private.opportunity_search_protocols');
  assert.equal(count.rows[0].count, 1, 'Repeated release installation must not create duplicate versions');

  // A copied/modified artifact must not silently reuse an already published version.
  const conflictingRelease = release.replaceAll(expectedHash, 'sha256:' + '0'.repeat(64));
  await assert.rejects(database.exec(conflictingRelease), /Installed opportunity protocol version differs/);
  await database.exec('rollback;');
  assert.deepEqual(await assertProtocol(database), installed);
  await database.exec(`insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
    values('future-release',1,'future-hash','Future protocol','{}');
    update private.opportunity_search_settings set active_protocol_version='future-release';`);
  await database.exec(upgrade);
  const retainedPointer = await database.query('select active_protocol_version from private.opportunity_search_settings');
  assert.equal(retainedPointer.rows[0].active_protocol_version, 'future-release', 'Repeating an old schema upgrade must not downgrade the active protocol');
  await database.exec(release);
  await assertProtocol(database);
  console.log(`PASS: fresh schema, ${suites.length} SQL suites, fixture rollback, repeat release, and immutable seed conflict`);
});

async function testUpgrade(deployedShape) {
  await withDatabase(async database => {
    const marker = schema.indexOf('-- BEGIN GENERATED OPPORTUNITY SEARCH SQL');
    assert.ok(marker > 0, 'Fresh schema must identify its generated search extension');
    const baseline = schema.slice(0, marker).replace('  research_summary text,\n', '') + '\ncommit;';
    await database.exec(baseline);
    if (deployedShape) {
      await database.exec(`alter table public.opportunities drop column cv_track;
        alter table public.opportunities drop column duration_months;
        alter table public.opportunities drop column historical_match_status;
        alter table public.opportunities add column research_summary text;
        alter table public.opportunities alter column metadata_schema_version set default 3;`);
    }
    await database.exec(`insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
      values('10000000-0000-0000-0000-000000000001','authenticated','authenticated','sql-upgrade@example.invalid','{}','{}');
      insert into public.opportunities(id,opportunity_key,title,data,sources)
      values('20000000-0000-0000-0000-000000000001','upgrade-retained','Retained research','{"rich":"original"}','[{"url":"https://example.invalid/role"}]');
      set request.jwt.claims='{"sub":"10000000-0000-0000-0000-000000000001","is_anonymous":false,"role":"authenticated"}';
      set role authenticated;
      select public.create_job_application('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
      reset role;`);
    if (deployedShape) await database.exec("update public.opportunities set research_summary='Preserve the deployed summary';");
    const before = await database.query(`select to_jsonb(a) as application,(select to_jsonb(o) from public.opportunities o limit 1) as opportunity from public.applications a`);
    await database.exec(upgrade);
    await database.exec(upgrade);
    await assertProtocol(database);
    const after = await database.query(`select to_jsonb(a) as application,
      (select to_jsonb(o)${deployedShape ? '' : "-'research_summary'"} from public.opportunities o limit 1) as opportunity from public.applications a`);
    assert.deepEqual(after.rows, before.rows, 'Upgrade must retain all existing opportunity fields and application snapshots');
    await database.exec(await read('supabase/tests/opportunity_search.sql'));
    console.log(`PASS: ${deployedShape ? 'deployed column shape and metadata version 3' : 'baseline missing research_summary'}, repeat upgrade, record preservation, and search SQL suite`);
  });
}

await testUpgrade(false);
await testUpgrade(true);
// Exercise a real v1 payload/receipt and an in-flight v1 run, then atomically upgrade.
await withDatabase(async database => {
  await database.exec(schema);
  await database.exec(await read('test/opportunitySearch/legacy-v1.sql'));
  const ids = {
    owner: '11000000-0000-0000-0000-000000000001', search: '22000000-0000-0000-0000-000000000001',
    run: '33000000-0000-0000-0000-000000000001', pending: '33000000-0000-0000-0000-000000000002',
    item: '44000000-0000-0000-0000-000000000001', pendingItem: '44000000-0000-0000-0000-000000000002',
  };
  const legacyPayload = { opportunity_key: 'legacy-scale-fixture', title: 'Legacy scale', last_checked_at: new Date().toISOString(),
    personal_fit: { score: 4, summary: 'Original scale was not recorded.', subscores: { legacy: 5 } },
    sources: [{ url: 'https://legacy.invalid/jobs/1', kind: 'official', checked_at: new Date().toISOString(), supports: ['personal_fit'] }],
  };
  const sql = async (statement, args = []) => (await database.query(statement, args)).rows;
  await sql('insert into auth.users(id) values($1)', [ids.owner]);
  await sql(`insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values($1,$2,'Legacy fixture','{"topicsAndMethods":"Audio research"}',
    '{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":true}')`, [ids.search, ids.owner]);
  for (const run of [ids.run, ids.pending]) {
    await sql('select private.begin_opportunity_search($1::uuid,$2::uuid)', [ids.search, run]);
    await sql(`select private.save_opportunity_search_queries($1::uuid,'[{"query":"audio phd"}]')`, [run]);
  }
  const saved = (await sql('select private.submit_opportunity_search_result($1::uuid,$2::uuid,$3::jsonb) as result', [ids.run, ids.item, JSON.stringify(legacyPayload)]))[0].result;
  await database.exec(`set request.jwt.claims='{"sub":"${ids.owner}","is_anonymous":false,"role":"authenticated"}'; set role authenticated;`);
  const readinessBefore = (await sql('select public.opportunity_search_readiness() as result'))[0].result;
  assert.equal(readinessBefore.ready, false, 'Old active protocol must not pass scoring readiness');
  await sql('select public.create_job_application($1::uuid,$2::uuid)', ['55000000-0000-0000-0000-000000000001', saved.opportunity_id]);
  await database.exec('reset role;');
  const oldRelease = await sql("select to_jsonb(p) as value from private.opportunity_search_protocols p where version='opportunity-search-v1-2026-10-12'");
  const catalogueBefore = await sql('select to_jsonb(o) as value from public.opportunities o');
  const applicationsBefore = await sql('select to_jsonb(a) as value from public.applications a');
  await database.exec(await read('supabase/opportunity_search_release.sql'));
  await assertProtocol(database);
  assert.deepEqual(await sql('select to_jsonb(o) as value from public.opportunities o'), catalogueBefore, 'No historical ratings rewritten');
  assert.deepEqual(await sql('select to_jsonb(a) as value from public.applications a'), applicationsBefore, 'Application snapshots preserved');
  assert.deepEqual(await sql("select to_jsonb(p) as value from private.opportunity_search_protocols p where version='opportunity-search-v1-2026-10-12'"), oldRelease, 'Old release immutable');
  await database.exec('set role authenticated;');
  assert.equal((await sql('select public.opportunity_search_readiness() as result'))[0].result.ready, true);
  await database.exec('reset role;');
  assert.deepEqual((await sql('select private.submit_opportunity_search_result($1::uuid,$2::uuid,$3::jsonb) as result', [ids.run, ids.item, JSON.stringify(legacyPayload)]))[0].result, saved, 'Exact old receipt is replayable');
  assert.equal((await sql('select private.verify_opportunity_search_result($1::uuid,$2::uuid) as result', [ids.run, ids.item]))[0].result.verified, true);
  const pendingPayload = { ...legacyPayload, opportunity_key: 'pending-scale-fixture' };
  await assert.rejects(sql('select private.submit_opportunity_search_result($1::uuid,$2::uuid,$3::jsonb)', [ids.pending, ids.pendingItem, JSON.stringify(pendingPayload)]), /scale_min=0/);
  const refreshed = (await sql('select private.refresh_opportunity_search_protocol($1::uuid) as result', [ids.pending]))[0].result;
  assert.equal(refreshed.run.recovery_count, 1);
  assert.equal(refreshed.query_stale, true);
  await assert.rejects(sql('select private.refresh_opportunity_search_protocol($1::uuid)', [ids.pending]), /once per active run/);
  await sql(`select private.save_opportunity_search_queries($1::uuid,'[{"query":"audio phd reassessed"}]')`, [ids.pending]);
  pendingPayload.personal_fit = { score: 8.2, scale_min: 0, scale_max: 10, summary: 'Reassessed directly from evidence.' };
  await sql('select private.submit_opportunity_search_result($1::uuid,$2::uuid,$3::jsonb)', [ids.pending, ids.pendingItem, JSON.stringify(pendingPayload)]);
  const verified = (await sql('select private.verify_opportunity_search_result($1::uuid,$2::uuid) as result', [ids.pending, ids.pendingItem]))[0].result;
  assert.deepEqual(verified.current_snapshot.personal_fit, pendingPayload.personal_fit);
  await database.exec(await read('supabase/tests/opportunity_search_assessments.sql'));
  console.log('PASS: v1 receipt replay, historical/application preservation, readiness, atomic release and one-recovery upgrade');
});
console.log('PASS: all isolated SQL checks');
