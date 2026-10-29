import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { file, insertOpportunity, json, literal, reset, seedRun, sql, submit, upgrade, owner } from '../opportunityMerge/db';
import { syntheticCanonicalMigrationRecords } from '../opportunityMerge/fixtures/synthetic-legacy';

const source = (time='2000-01-02T09:00:00Z') => ({url:'https://example.invalid/jobs/canonical',kind:'official',checked_at:time,precision:'instant',supports:['title','city','contacts','requirements','data','personal_fit']});
let before: any[];
let beforeReviews: string;
let beforeApplications: string;
function prerequisites() {
  sql(`DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"is_anonymous":false}'::jsonb $$;
    GRANT USAGE ON SCHEMA auth,private,public TO authenticated; GRANT SELECT ON private.opportunity_search_protocols,private.opportunity_search_settings TO authenticated;`);
  sql(file('../opportunityCanonical/fixtures/readiness-v4.sql'));
  for (const [name,args] of [['begin_opportunity_search','uuid,uuid'],['refresh_opportunity_search_protocol','uuid'],['save_opportunity_search_queries','uuid,jsonb'],['complete_opportunity_search','uuid,jsonb'],['read_opportunity_search_run','uuid']]) {
    sql(`CREATE OR REPLACE FUNCTION private.${name}(${args}) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  }
}

test('one-time conversion preserves a fully synthetic legacy catalogue and private context', () => {
  reset(); upgrade();
  prerequisites();
  for (const record of syntheticCanonicalMigrationRecords()) insertOpportunity(record);
  before=json('SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.opportunities o;');
  sql(`INSERT INTO public.opportunity_reviews(user_id,opportunity_id,state,comment) VALUES('${owner}','${before[0].id}','interested','Preserve my review');`);
  const app={id:randomUUID(),user_id:owner,opportunity_id:before[0].id,application_code:'APP-1234567890',context_json:{snapshot:before[0],private_note:'Keep the frozen application'},context_captured_at:'2000-01-01T00:00:00Z',completed_checklist_keys:['old:content:key'],status_history:[{status:'preparation'}]};
  const cols=Object.keys(app).join(',');sql(`INSERT INTO public.applications(${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public.applications,${literal(app)});`);
  beforeReviews=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;');
  beforeApplications=sql('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;');
  sql(file('../../supabase/opportunity_canonical_v5.sql'));
  const after=json<any[]>('SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.opportunities o;');
  assert.equal(after.length,before.length);
  for (let i=0;i<after.length;i++) {
    assert.equal(after[i].id,before[i].id); assert.equal(after[i].created_at,before[i].created_at); assert.equal(after[i].updated_at,before[i].updated_at);
    assert.equal(after[i].metadata_schema_version,5);
    for (const field of ['personal_fit','rd_career_potential','research_career_potential']) {
      assert.equal(after[i][field].score,before[i][field].score??null,`${field}: score unchanged`);
      assert.equal(after[i][field].scale_min,0); assert.equal(after[i][field].scale_max,10);
    }
  }
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;'),beforeReviews);
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;'),beforeApplications);
  assert.equal(json('SELECT count(*) FROM private.opportunity_payload_archive;'),before.length);
  assert.equal(json('SELECT count(*) FROM private.opportunity_search_merge_state;'),before.length);
  assert.equal(sql('SELECT bool_and(private.opportunity_payload_storage_valid(to_jsonb(o))) FROM public.opportunities o;'),'t');
  const grouped = after.find(record => record.opportunity_key === 'synthetic-canonical-grouped');
  assert.equal(grouped.contacts.length, 1, 'case-normalized contact identity is unique after migration');
  assert.deepEqual(grouped.contacts[0].roles.map((role: string) => role.toLowerCase()).sort(), ['contact', 'supervisor']);
  assert.ok(grouped.requirements.some((item: any) => item.status === 'conditional'));
  assert.ok(grouped.required_documents.some((item: any) => item.stage === 'doctoral_admission'));
  const endpoints = after.find(record => record.opportunity_key === 'synthetic-canonical-endpoints');
  assert.equal(endpoints.personal_fit.score, 0);
  assert.equal(endpoints.research_career_potential.score, 10);
  assert.equal(endpoints.rd_career_potential.score, 4.25);
  assert.ok(endpoints.requirements.some((item: any) => item.status === 'optional'));
  assert.ok(endpoints.required_documents.some((item: any) => item.status === 'conditional' && item.conditions.includes('Only when requested')));
  assert.ok(endpoints.sources.some((item: any) => item.precision === 'date' && item.checked_at === '2000-01-01'));
});

test('live schema and payloads have no compatibility keys or alias formats', () => {
  const schema=json('SELECT private.opportunity_search_result_schema();');
  assert.equal(schema['x-canonical-version'],5); assert.ok(!schema['x-legacy-inputs']);
  const records=json<any[]>('SELECT jsonb_agg(to_jsonb(o)) FROM public.opportunities o;');
  function visit(value:any) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value||typeof value!=='object') return;
    for (const [key,child] of Object.entries(value)) { assert.ok(key!=='legacy'&&!key.startsWith('legacy_'),key);visit(child); }
  }
  records.forEach(visit);
  assert.equal(sql("SELECT to_regprocedure('private.opportunity_merge_input_schema_v3()') IS NULL AND to_regprocedure('private.opportunity_merge_checklist(jsonb,text,text,text)') IS NULL AND to_regprocedure('private.opportunity_search_merge_value(jsonb,jsonb)') IS NULL AND to_regprocedure('private.opportunity_search_normalize_record(jsonb)') IS NULL;"),'t');
  for (const r of records) for (const f of ['contacts','supervisors','requirements','required_documents','supervisor_top_papers','sources']) {
    const ids=r[f].map((x:any)=>x[f==='sources'?'source_id':'entity_id']);assert.equal(new Set(ids).size,ids.length,`${r.opportunity_key}.${f}: unique identities`);
  }
});

test('reviewed JSON schema and read-only installation checks match the installed functions', () => {
  assert.deepEqual(json('SELECT private.opportunity_storage_schema();'),JSON.parse(file('../../supabase/opportunity_schema_v5.json')));
  sql(file('../../supabase/tests/opportunity_canonical_installation.sql'));
});

test('canonical-only intake rejects old shapes at every affected boundary', () => {
  seedRun();
  const base={opportunity_key:'reject-old-shapes',title:'Research',last_checked_at:'2000-01-02T09:00:00Z',sources:[source()]};
  const invalids=[{contact:[]},{documents:[]},{salary_text:'Funded'},{university:'University'},{contacts:['Person']},{contacts:[{name:'Person',role:'Supervisor'}]},
    {requirements:['MSc']},{requirements:{required:['MSc']}},{required_documents:{required:['CV']}},{required_documents:[{document:'CV'}]},
    {salary:{salary_amount:3000}},{sources:[{url:'https://example.invalid/jobs/x',type:'official_ad',checked_at:'2000-01-01',supports:['title']}]},
    {supervisor_top_papers:{Person:{papers:[]}}},{data:{methods:['DSP']}},{data:{custom_object:{unknown:true}}}];
  for (const change of invalids) assert.throws(()=>submit({...base,...change},randomUUID()),/canonical|schema|Unknown\/protected/i,JSON.stringify(change));
});

test('owner readiness reads the canonical schema through the normal invoker permissions', () => {
  const r=json(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${owner}'; SELECT public.opportunity_search_readiness(); COMMIT;`);
  assert.equal(r.ready,true); assert.equal(r.protocol_version,'opportunity-search-v1-canonical-5');
});

test('strict storage also rejects direct legacy JSON writes', () => {
  assert.throws(()=>sql(`UPDATE public.opportunities SET contacts='["Person"]' WHERE id='${before[0].id}';`),/opportunities_payload_v5_check/);
  assert.throws(()=>sql(`UPDATE public.opportunities SET data=data||'{"methods":["DSP"]}' WHERE id='${before[0].id}';`),/opportunities_payload_v5_check/);
});

test('canonical writes assign stable IDs and keep evidence/retries atomic', () => {
  const p={opportunity_key:randomUUID(),title:'Canonical research',last_checked_at:'2000-01-02T09:00:00Z',sources:[source()],city:'City',
    contacts:[{name:'Person',email:'person@example.invalid',roles:['Scientific contact']}],requirements:[{text:'MSc',status:'required',stage:'recruitment'}],
    personal_fit:{score:8.4,scale_min:0,scale_max:10,summary:'Research fit'}};
  const item=randomUUID();const r=submit(p,item);assert.equal(r.merge_version,5);assert.ok(r.snapshot.contacts[0].entity_id);assert.ok(r.snapshot.sources[0].source_id);
  assert.deepEqual(submit(p,item),r);
  const next=submit({...p,last_checked_at:'2000-01-03T09:00:00Z',sources:[source('2000-01-03T09:00:00Z')],contacts:[{name:'Person',email:'person@example.invalid',phone:'123'}]},randomUUID());
  assert.equal(next.snapshot.contacts.length,1);assert.equal(next.snapshot.contacts[0].phone,'123');assert.deepEqual(next.snapshot.contacts[0].roles,['Scientific contact']);
});

test('URL sets retain case-sensitive paths while deduplicating equivalent hosts', () => {
  const urls=json<string[]>(`SELECT private.opportunity_canonical_set('/contacts/@person/source_urls','["https://EXAMPLE.invalid/Job","https://example.invalid/Job","https://example.invalid/job"]');`);
  assert.equal(urls.length,2);
  assert.deepEqual(urls.map(url=>new URL(url).pathname).sort(),['/Job','/job']);
  assert.ok(urls.every(url=>new URL(url).hostname==='example.invalid'));
});

test('migration rollback refuses subsequent catalogue edits', () => {
  const preview=json('SELECT private.rollback_opportunity_payload_v5();');
  assert.ok(preview.blockers.includes('catalogue_or_evidence_changed_after_migration'));assert.throws(()=>sql('SELECT private.rollback_opportunity_payload_v5(true);'),/rollback blocked/i);
});

test('the archived migration restores exact previous records, evidence, defaults and functions', () => {
  // Remove only the new synthetic search records created by this isolated suite.
  sql(`DELETE FROM public.opportunity_search_receipts; DELETE FROM private.opportunity_search_merge_audit;
    DELETE FROM private.opportunity_search_merge_state WHERE opportunity_id NOT IN (SELECT opportunity_id FROM private.opportunity_payload_archive);
    DELETE FROM private.opportunity_search_identities WHERE opportunity_id NOT IN (SELECT opportunity_id FROM private.opportunity_payload_archive);
    DELETE FROM public.opportunities WHERE id NOT IN (SELECT opportunity_id FROM private.opportunity_payload_archive);
    UPDATE public.opportunity_search_runs SET status='complete';`);
  assert.deepEqual(json('SELECT private.rollback_opportunity_payload_v5();').blockers,[]);
  assert.equal(json('SELECT private.rollback_opportunity_payload_v5(true);').applied,true);
  assert.deepEqual(json('SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.opportunities o;'),before);
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;'),beforeReviews);
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;'),beforeApplications);
  assert.equal(sql("SELECT active_protocol_version FROM private.opportunity_search_settings;"),'opportunity-search-v1-merge-4');
  assert.equal(json('SELECT private.rollback_opportunity_payload_v5(true);').already_rolled_back,true);
});
