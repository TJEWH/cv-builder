import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { file, reset, sql } from './db';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (output: string): any => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).at(-1) ?? null;
const actor = (owner: string, body: string) => `do $$begin perform set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,false);end $$;set role authenticated;${body};reset role;`;
const owner = randomUUID(), otherOwner = randomUUID(), search = randomUUID();
const legacyQueryRevision = randomUUID();
const legacyQueries = [{ query: 'Acoustic sensing PhD', sources: ['example.invalid'] }];
const legacyPlanDocument = { schema_version: 2, queries: [
  { query_id: randomUUID(), query: legacyQueries[0]!.query, text_hash: digest(legacyQueries[0]!.query), role: 'core', manual: true, sources: legacyQueries[0]!.sources },
  { query_id: randomUUID(), query: 'Human-computer interaction funded PhD', text_hash: digest('Human-computer interaction funded PhD'), role: 'core', manual: true, sources: ['manual.example.invalid'] },
  { query_id: randomUUID(), query: 'Adjacent acoustic sensing methods', text_hash: digest('Adjacent acoustic sensing methods'), role: 'adaptive', manual: false },
  { query_id: randomUUID(), query: 'Exploratory embodied interface research', text_hash: digest('Exploratory embodied interface research'), role: 'exploration', manual: false },
] };
const cadence = { frequency: 'daily', intervalHours: 24, weekdays: [], time: '09:00', timezone: 'UTC', runImmediately: false };
const reviews = [
  { comment: null, summary: null, expected: null },
  { comment: 'Full evaluation.', summary: null, expected: 'Full evaluation.' },
  { comment: null, summary: 'Feedback alone.', expected: 'Feedback alone.' },
  { comment: 'Identical text.', summary: 'Identical text.', expected: 'Identical text.' },
  { comment: 'A longer comment includes its excerpt.', summary: 'its excerpt', expected: 'A longer comment includes its excerpt.' },
  { comment: 'same', summary: 'A larger same summary.', expected: 'A larger same summary.' },
  { comment: 'Existing evaluation.', summary: 'Distinct feedback.', expected: 'Existing evaluation.\n\nDistinct feedback.' },
  { comment: '  leading \n', summary: '\ttrailing  ', expected: '  leading \n\n\n\ttrailing  ' },
  { comment: '🧪'.repeat(5000), summary: 'Separate context. '.repeat(30), expected: `${'🧪'.repeat(5000)}\n\n${'Separate context. '.repeat(30)}` },
].map(value => ({ ...value, opportunity: randomUUID() }));
let beforeReviews: any[];
let beforeConsent: any;
let applicationHash: string;
let snapshotIdentity: string;
let metricBefore: string;
let legacyPlanRow: any;
let legacyQueryRow: any;
let descriptionSettingsBefore: any;

function createOpportunity() {
  const opportunity = randomUUID();
  sql(`insert into public.opportunities(id,opportunity_key,title,institution,topics,deadline)
    values(${quote(opportunity)},${quote('synthetic-evaluation-'+opportunity)},'Synthetic research','Synthetic Institution',array['Acoustics'],'2028-01-01');`);
  return opportunity;
}
const review = (opportunity: string, account = owner) => object(sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(account)} and opportunity_id=${quote(opportunity)};`));

before(() => {
  reset({ searchProtocol: true });
  for (const path of ADAPTIVE_RELEASE_MIGRATIONS) {
    if (['opportunity_description.sql','opportunity_evaluation.sql'].includes(path)) break;
    sql(file(`../../supabase/${path}`));
  }
  sql(`insert into auth.users(id) values(${quote(owner)}),(${quote(otherOwner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(${quote(search)},${quote(owner)},'Synthetic evaluation','{"topicsAndMethods":"Acoustics"}',${json(cadence)});`);
  for (const [index, value] of reviews.entries()) {
    sql(`insert into public.opportunities(id,opportunity_key,title,institution,topics,deadline)
      values(${quote(value.opportunity)},${quote('synthetic-evaluation-'+value.opportunity)},'Synthetic research','Synthetic Institution',array['Acoustics'],'2028-01-01');
      insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,comment,search_feedback_summary,manually_archived,technical_issue_category)
      values(${quote(owner)},${quote(value.opportunity)},'interested',${index},${value.comment === null ? 'null' : quote(value.comment)},
        ${value.summary === null ? 'null' : quote(value.summary)},${index === 2},${index === 2 ? "'requirements'" : 'null'});`);
  }
  const approved = reviews[6]!;
  sql(actor(owner, `select public.approve_opportunity_feedback_summary(${quote(approved.opportunity)},
    (select search_feedback_summary_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(approved.opportunity)}),
    (select search_feedback_source_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(approved.opportunity)}),
    (select search_feedback_revision from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(approved.opportunity)}));
    select public.set_opportunity_feedback_consent(${quote(search)},true);
    select public.save_opportunity_search_adaptation(${quote(search)},true,false,0)`));
  sql(`insert into public.applications(user_id,opportunity_id,notes) values(${quote(owner)},${quote(approved.opportunity)},'PRIVATE APPLICATION CANARY');
    select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`);
  // A historical pinned proof is an input to the one-time cutover, never a current writer format.
  sql(`alter table public.opportunity_search_feedback_snapshots disable trigger opportunity_feedback_snapshot_redaction;
    update public.opportunity_search_feedback_snapshots s set packet=jsonb_set(packet,'{examples}',(
      select jsonb_agg(case when e->>'opportunity_id'=${quote(approved.opportunity)} then
        (e-'summary_inclusion')||jsonb_build_object('search_feedback_summary',r.search_feedback_summary,'summary_approval',
          jsonb_build_object('summary_hash',r.search_feedback_summary_hash,'source_hash',r.search_feedback_source_hash,
            'summary_revision',r.search_feedback_revision,'approved_at',r.search_feedback_approved_at)) else e end)
      from jsonb_array_elements(s.packet->'examples') e cross join public.opportunity_reviews r
      where r.user_id=${quote(owner)} and r.opportunity_id=${quote(approved.opportunity)})) where user_id=${quote(owner)};
    alter table public.opportunity_search_feedback_snapshots enable trigger opportunity_feedback_snapshot_redaction;`);
  sql(`insert into public.opportunity_search_query_revisions(id,user_id,search_id,template_revision,protocol_version,queries,created_at)
    select ${quote(legacyQueryRevision)},${quote(owner)},${quote(search)},revision,'opportunity-search-v1-canonical-5',${json(legacyQueries)},'2001-01-01'
    from public.opportunity_search_templates where id=${quote(search)};
    select private.publish_opportunity_search_plan(${quote(owner)},${quote(search)},${quote(legacyQueryRevision)},${json(legacyPlanDocument)},
      (select revision from public.opportunity_search_templates where id=${quote(search)}),
      (select feedback_revision from public.opportunity_search_adaptive_settings where user_id=${quote(owner)} and search_id=${quote(search)}),
      0,'opportunity-search-v1-canonical-5');`);
  legacyPlanRow = object(sql(`select to_jsonb(p) from public.opportunity_search_query_plans p join public.opportunity_search_adaptive_settings s
    on p.id=s.query_plan_id where s.user_id=${quote(owner)} and s.search_id=${quote(search)};`));
  legacyQueryRow = object(sql(`select to_jsonb(q) from public.opportunity_search_query_revisions q where id=${quote(legacyQueryRevision)};`));
  descriptionSettingsBefore = object(sql(`select to_jsonb(s) from public.opportunity_search_adaptive_settings s where user_id=${quote(owner)} and search_id=${quote(search)};`));
  assert.equal(legacyPlanRow.protocol_version, 'opportunity-search-v1-canonical-5');
  assert.equal(descriptionSettingsBefore.query_plan_id, legacyPlanRow.id);
  beforeReviews = JSON.parse(sql(`select jsonb_agg(to_jsonb(r) order by opportunity_id) from public.opportunity_reviews r where user_id=${quote(owner)};`));
  metricBefore = sql(`select jsonb_agg(private.opportunity_interest_metric(user_id,opportunity_id) order by opportunity_id) from public.opportunity_reviews where user_id=${quote(owner)};`);
  snapshotIdentity = sql("select jsonb_agg(to_jsonb(s)-array['packet','redact_aggregates'] order by user_id,search_id,feedback_revision) from public.opportunity_search_feedback_snapshots s;");
  sql(file('../../supabase/opportunity_description.sql'));
  beforeConsent = object(sql(`select to_jsonb(s)-'feedback_dirty' from public.opportunity_search_adaptive_settings s where user_id=${quote(owner)} and search_id=${quote(search)};`));
  applicationHash = sql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from public.applications a;");
  sql(file('../../supabase/opportunity_evaluation.sql'));
});

test('the canonical migration copies the active plan and queries while retaining immutable v5 evidence and manual identities', () => {
  assert.deepEqual(object(sql(`select to_jsonb(p) from public.opportunity_search_query_plans p where id=${quote(legacyPlanRow.id)};`)), legacyPlanRow);
  assert.deepEqual(object(sql(`select to_jsonb(q) from public.opportunity_search_query_revisions q where id=${quote(legacyQueryRevision)};`)), legacyQueryRow);
  const query = object(sql(`select to_jsonb(q) from public.opportunity_search_query_revisions q
    where user_id=${quote(owner)} and search_id=${quote(search)} and protocol_version='opportunity-search-v1-canonical-6';`));
  assert.notEqual(query.id, legacyQueryRow.id);
  for (const key of ['user_id','search_id','template_revision','queries']) assert.deepEqual(query[key], legacyQueryRow[key], key);
  const current = object(sql(`select to_jsonb(p) from public.opportunity_search_query_plans p join public.opportunity_search_adaptive_settings s
    on p.id=s.query_plan_id where s.user_id=${quote(owner)} and s.search_id=${quote(search)};`));
  assert.ok(current, 'the active v5 plan must remain available through a current-contract copy');
  assert.notEqual(current.id, legacyPlanRow.id);
  assert.equal(current.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.equal(current.query_revision_id, query.id);
  assert.equal(current.plan_revision, legacyPlanRow.plan_revision + 1);
  assert.notEqual(current.plan_hash, legacyPlanRow.plan_hash);
  assert.equal(sql(`select plan_hash=encode(sha256(convert_to(jsonb_build_object('planning_policy',planning_policy,
    'query_revision_id',query_revision_id,'base_revision',base_revision,'feedback_revision',feedback_revision,
    'preference_revision',preference_revision,'protocol_version',protocol_version,'document',document)::text,'UTF8')),'hex')
    from public.opportunity_search_query_plans where id=${quote(current.id)};`), 't');
  for (const key of ['user_id','search_id','document','planning_policy','base_revision','feedback_revision','preference_revision']) {
    assert.deepEqual(current[key], legacyPlanRow[key], key);
  }
  const settings = object(sql(`select to_jsonb(s) from public.opportunity_search_adaptive_settings s where user_id=${quote(owner)} and search_id=${quote(search)};`));
  assert.equal(settings.query_plan_dirty, true);
  assert.equal(settings.query_plan_revision, current.plan_revision);
  for (const key of ['structured_feedback_enabled','consent_revision','adaptation_enabled','adaptation_paused','adaptation_revision','preference_revision']) {
    assert.deepEqual(settings[key], descriptionSettingsBefore[key], key);
  }
  const prompt = sql(`select private.adaptive_search_recurring_prompt(${quote(search)},'abcdefghijklmnopqrst');`);
  assert.match(prompt, /canonical v6/); assert.doesNotMatch(prompt, /canonical v5/);
});

test('one-time migration preserves every complete evaluation, revisions, interest and unrelated owner state', () => {
  const readiness = object(sql(actor(owner, 'select public.opportunity_search_readiness()')));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.equal(sql(`select bool_and(position('opportunity-search-v1-canonical-5' in pg_get_functiondef(signature::regprocedure))=0)
    from unnest(array['private.ack_adaptive_search_rollback(uuid,uuid,jsonb)','public.opportunity_search_planning_capacity(uuid,uuid)',
      'private.begin_adaptive_opportunity_search(uuid,uuid)','private.require_adaptive_setup_scope(uuid,text,boolean)',
      'private.legacy_dynamic_search_rollback_prompt(uuid,text)','private.read_adaptive_search_rollback(uuid,uuid,text)',
      'private.opportunity_search_adaptive_shape(text,jsonb)']) signatures(signature);`), 't');
  for (const value of reviews) {
    const current = review(value.opportunity);
    const previous = beforeReviews.find(item => item.opportunity_id === value.opportunity);
    assert.equal(current.comment, value.expected);
    assert.equal(current.evaluation_revision, previous.search_feedback_revision);
    for (const field of ['comment','search_feedback_summary','search_feedback_revision','search_feedback_summary_hash','search_feedback_source_hash',
      'search_feedback_approved_at','search_feedback_approved_summary_hash','search_feedback_approved_source_hash']) delete previous[field];
    delete current.comment; delete current.evaluation_revision;
    assert.deepEqual(current, previous);
  }
  assert.equal(sql(`select jsonb_agg(private.opportunity_interest_metric(user_id,opportunity_id) order by opportunity_id) from public.opportunity_reviews where user_id=${quote(owner)};`), metricBefore);
  assert.equal(sql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from public.applications a;"), applicationHash);
  assert.deepEqual(object(sql(`select to_jsonb(s)-'feedback_dirty' from public.opportunity_search_adaptive_settings s where user_id=${quote(owner)} and search_id=${quote(search)};`)), beforeConsent);
  assert.equal(sql("select jsonb_agg(to_jsonb(s)-array['packet','redact_aggregates'] order by user_id,search_id,feedback_revision) from public.opportunity_search_feedback_snapshots s;"), snapshotIdentity);
  assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='opportunity_reviews' and column_name like 'search_feedback_%';"), '0');
  assert.equal(sql("select to_regclass('public.opportunity_feedback_summary_approvals') is null;"), 't');
  assert.equal(sql("select to_regprocedure('public.approve_opportunity_feedback_summary(uuid,text,text,bigint)') is null and to_regprocedure('public.revoke_opportunity_feedback_summary(uuid)') is null;"), 't');
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prosrc~'(review|new|old|r)[.]search_feedback_(summary|revision|source_hash|approved)';"), '0');
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prosrc~'summary_approval|search_feedback_approved';"), '0');
  assert.throws(() => sql(file('../../supabase/opportunity_evaluation.sql')), /must run once/);
});

test('historical approval packets are redacted once and current excerpt packets retain one source', () => {
  const packet = object(sql(`select packet from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)} order by feedback_revision desc limit 1;`));
  assert.equal(packet.privacy_scope_changed, true);
  assert.equal(packet.examples.some((item: any) => 'summary_approval' in item), false);
  const oldApproval = packet.examples.find((item: any) => item.opportunity_id === reviews[6]!.opportunity);
  assert.equal(oldApproval.search_feedback_summary, undefined);
  assert.equal(oldApproval.summary_inclusion, undefined);
  const retained = packet.examples.find((item: any) => item.opportunity_id === reviews[1]!.opportunity);
  assert.equal(retained.search_feedback_summary, reviews[1]!.comment);
  const current = object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(reviews[6]!.opportunity)})`)));
  assert.equal(current.search_feedback_summary, reviews[6]!.expected);
  assert.equal(current.summary_approval, undefined);
  assert.equal(sql(`select private.project_opportunity_feedback(${quote(owner)},${quote(reviews[6]!.opportunity)})=public.project_opportunity_feedback_preview(${quote(owner)},${quote(reviews[6]!.opportunity)});`), 't');
  assert.equal(sql(`select private.opportunity_search_adaptive_shape('example',${json(Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'withheld_counts')))});`), 't');
});

test('a full evaluation saves atomically once and cannot be written through the removed second field', () => {
  const opportunity = createOpportunity();
  const complete = `  ${'🧪'.repeat(700)} Acoustic research.\n `;
  const saved = object(sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(complete)})`)));
  assert.equal(saved.comment, complete);
  assert.equal(saved.evaluation_revision, 1);
  assert.equal(saved.feedback_revision, 0, 'evaluation edits cannot manufacture numeric interest');
  assert.equal(object(sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(complete)})`))).evaluation_revision, 1);
  const next = object(sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(complete+'Next sentence.')})`)));
  assert.equal(next.evaluation_revision, 2);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"search_feedback_summary":"Second source"}')`)), /supported partial feedback/);
  assert.equal(review(opportunity).comment, complete+'Next sentence.');
  const rated = object(sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"interest_rating":0}')`)));
  assert.equal(rated.evaluation_revision, 2); assert.equal(rated.interest_rating, 0);
  sql(actor(owner, `update public.opportunity_reviews set evaluation_revision=9999 where opportunity_id=${quote(opportunity)}`));
  assert.equal(review(opportunity).evaluation_revision, 2, 'a client cannot forge the proof revision');
  sql(actor(owner, `update public.opportunity_reviews set comment='A direct owner edit.',evaluation_revision=9999 where opportunity_id=${quote(opportunity)}`));
  assert.equal(review(opportunity).evaluation_revision, 3, 'a direct owner edit advances the server revision once');
});

test('projection checks the complete source before deriving a codepoint-bounded excerpt and hashes', () => {
  const opportunity = createOpportunity();
  const complete = '🧪'.repeat(1000)+' Acoustic research.';
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(complete)})`));
  const packet = object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)));
  assert.equal(packet.search_feedback_summary, '🧪'.repeat(600));
  assert.deepEqual(packet.summary_inclusion, { policy_version:'included-unless-excluded-v1',summary_hash:digest('🧪'.repeat(600)),source_hash:digest(complete),
    summary_revision:1,truncated:true,source_length:Array.from(complete).length });
  assert.equal(packet.interest_score, null);
  const unsafe = 'Acoustic research. '.repeat(50)+' private@example.invalid';
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(unsafe)})`));
  assert.equal(object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`))), null);
  assert.equal(review(opportunity).comment, unsafe, 'withholding never truncates the private evaluation');
  const maximum = '🧪'.repeat(12000);
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(maximum)})`));
  assert.equal(review(opportunity).comment, maximum);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(maximum+'x')})`)), /12000/);
  assert.equal(review(opportunity).comment, maximum);
});

test('editing, exclusion and consent revocation cannot revive pinned text or cross owners', () => {
  const opportunity = reviews[1]!.opportunity;
  sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`);
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},'Changed current evaluation.')`));
  const packets = JSON.parse(sql(`select jsonb_agg(packet) from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)};`));
  for (const packet of packets) for (const item of packet.examples) if (item.opportunity_id === opportunity) assert.equal(item.search_feedback_summary, undefined);
  assert.equal(sql(`select feedback_dirty from public.opportunity_search_adaptive_settings where user_id=${quote(owner)} and search_id=${quote(search)};`), 't');
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":true}')`));
  assert.equal(object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`))), null);
  const other = object(sql(actor(otherOwner, `select public.save_opportunity_comment(${quote(opportunity)},'Other owner evaluation.')`)));
  assert.equal(other.user_id, otherOwner);
  assert.equal(review(opportunity).comment, 'Changed current evaluation.');
  assert.throws(() => sql(actor(otherOwner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)), /Feedback unavailable/);
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},false)`));
  assert.equal(sql(`select bool_and(jsonb_array_length(packet->'examples')=0) from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)};`), 't');
  assert.equal(sql("select has_function_privilege('anon','public.save_opportunity_comment(uuid,text)','execute');"), 'f');
});

test('the complete migrated adaptive installation starts with the current canonical contract', () => {
  const project = 'abcdefghijklmnopqrst', run = randomUUID();
  const reviewsBefore = sql("select md5(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id)::text) from public.opportunity_reviews r;");
  sql(`update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;`);
  sql(actor(owner, `select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0)`));
  const started = object(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.equal(started.compatible, true, JSON.stringify(started));
  assert.equal(started.release.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.equal(started.release.schema_version, 6);
  assert.equal(started.result_schema['x-canonical-version'], 6);
  assert.equal(started.scope.user_id, owner);
  assert.equal(started.query_plan.basis.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.deepEqual(started.query_plan.document.queries, legacyPlanDocument.queries.filter(query => query.role === 'core'));
  const refreshed = object(sql(`select private.publish_opportunity_search_plan(${quote(owner)},${quote(search)},
    (select id from public.opportunity_search_query_revisions where user_id=${quote(owner)} and search_id=${quote(search)}
      and protocol_version='opportunity-search-v1-canonical-6'),${json(started.query_plan.document)},
    ${started.base.revision},${started.feedback.feedback_revision},${started.preferences.revision},'opportunity-search-v1-canonical-6');`));
  assert.equal(refreshed.basis.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.deepEqual(refreshed.document, started.query_plan.document, 'a normal current plan refresh preserves the exposed manual identities');
  assert.deepEqual(object(sql(`select to_jsonb(p) from public.opportunity_search_query_plans p where id=${quote(legacyPlanRow.id)};`)), legacyPlanRow);
  assert.equal(sql("select md5(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id)::text) from public.opportunity_reviews r;"), reviewsBefore);
});
