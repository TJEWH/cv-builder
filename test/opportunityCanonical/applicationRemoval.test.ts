import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { file, json, literal, owner, reset, sql } from '../opportunityMerge/db';

const otherOwner = randomUUID();
const opportunity = randomUUID();
const application = randomUUID();
const otherApplication = randomUUID();
const failedApplication = randomUUID();
const cv = randomUUID();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const actor = (account: string | null, body: string, anonymous = false) => `
  DO $$ BEGIN
    PERFORM set_config('request.jwt.claim.sub',${quote(account ?? '')},false);
    PERFORM set_config('request.jwt.claim.is_anonymous','${anonymous}',false);
  END $$;
  SET ROLE authenticated; ${body}; RESET ROLE;`;
const reviews = () => json('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;');
const applications = () => json('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;');
const migration = () => file('../../supabase/application_removal_review.sql');
let originalReviews: unknown;

before(() => {
  reset();
  sql(`DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('request.jwt.claim.is_anonymous',true),'')::boolean,false)) $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    GRANT SELECT,DELETE ON public.applications TO authenticated;
    ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY removal_fixture_read ON public.applications FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
    CREATE POLICY removal_fixture_delete ON public.applications FOR DELETE TO authenticated USING ((SELECT auth.uid())=user_id);
    CREATE TABLE public.cv_variants(id uuid PRIMARY KEY,user_id uuid NOT NULL,content_json jsonb NOT NULL);
    ALTER TABLE public.applications ADD FOREIGN KEY(cv_variant_id) REFERENCES public.cv_variants(id);
    -- Representative installed review columns, including the complete evaluation
    -- and frozen prediction. The delete RPC must not need access to this table.
    ALTER TABLE public.opportunity_reviews
      ADD COLUMN interest_rating numeric,
      ADD COLUMN interest_reasons jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN feedback_excluded boolean NOT NULL DEFAULT false,
      ADD COLUMN feedback_revision bigint NOT NULL DEFAULT 0,
      ADD COLUMN feedback_updated_at timestamptz,
      ADD COLUMN prediction_baseline jsonb,
      ADD COLUMN manually_archived boolean NOT NULL DEFAULT false,
      ADD COLUMN technical_issue_category text,
      ADD COLUMN technical_issue_note text,
      ADD COLUMN evaluation_revision bigint NOT NULL DEFAULT 0,
      ADD COLUMN search_feedback_summary text,
      ADD COLUMN search_feedback_revision bigint NOT NULL DEFAULT 0,
      ADD COLUMN search_feedback_summary_hash text,
      ADD COLUMN search_feedback_source_hash text,
      ADD COLUMN search_feedback_approved_at timestamptz,
      ADD COLUMN search_feedback_approved_summary_hash text,
      ADD COLUMN search_feedback_approved_source_hash text;
    REVOKE ALL ON public.opportunity_reviews FROM authenticated,anon;
    CREATE FUNCTION public.removal_fixture_reject_review_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Application deletion must not touch reviews'; END $$;
    CREATE TRIGGER removal_fixture_review_update BEFORE UPDATE ON public.opportunity_reviews
      FOR EACH ROW EXECUTE FUNCTION public.removal_fixture_reject_review_update();
    CREATE FUNCTION public.removal_fixture_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF old.notes='FAIL DELETE' THEN RAISE EXCEPTION 'Synthetic deletion failure'; END IF; RETURN old; END $$;
    CREATE TRIGGER removal_fixture_delete_failure BEFORE DELETE ON public.applications
      FOR EACH ROW EXECUTE FUNCTION public.removal_fixture_reject_delete();
    INSERT INTO public.opportunities(id,opportunity_key,title) VALUES('${opportunity}','synthetic-removal','Synthetic research');
    INSERT INTO public.cv_variants VALUES('${cv}','${owner}','{"private":"Keep this CV snapshot"}');`);
  for (const [account, state] of [[owner, 'not_interested'], [otherOwner, 'strong_interest']]) {
    const review = { user_id: account, opportunity_id: opportunity, state,
      comment: 'Keep my complete private evaluation.', interest_rating: 0,
      interest_reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }],
      feedback_excluded: true, feedback_revision: 4, feedback_updated_at: '2000-01-03T00:00:00Z',
      prediction_baseline: { score: 8, source_ref: 'frozen-original-assessment' },
      manually_archived: true, technical_issue_category: 'requirements', technical_issue_note: 'Keep my eligibility note.',
      evaluation_revision: 9, search_feedback_summary: 'Keep this exact approved text.', search_feedback_revision: 3,
      search_feedback_summary_hash: 'summary-hash', search_feedback_source_hash: 'source-hash',
      search_feedback_approved_at: '2000-01-03T00:00:00Z', search_feedback_approved_summary_hash: 'summary-hash',
      search_feedback_approved_source_hash: 'source-hash', reviewed_updated_at: '2000-01-02T00:00:00Z',
      created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-03T00:00:00Z' };
    const columns = Object.keys(review).join(',');
    sql(`INSERT INTO public.opportunity_reviews(${columns})
      SELECT ${columns} FROM jsonb_populate_record(NULL::public.opportunity_reviews,${literal(review)});`);
  }
  for (const [index, value] of [
    { id: application, user_id: owner, cv_variant_id: cv, notes: 'Keep unrelated rows' },
    { id: otherApplication, user_id: otherOwner, cv_variant_id: null, notes: 'Other account' },
    { id: failedApplication, user_id: owner, cv_variant_id: cv, notes: 'FAIL DELETE' },
  ].entries()) {
    const row = { ...value, opportunity_id: opportunity, application_code: `APP-000000000${index}`,
      context_json: { title: 'Frozen application research' }, context_captured_at: '2000-01-01T00:00:00Z',
      completed_checklist_keys: ['requirements:degree'], status_history: [{ status: 'preparation' }],
      created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-02T00:00:00Z' };
    const columns = Object.keys(row).join(',');
    sql(`INSERT INTO public.applications(${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::public.applications,${literal(row)});`);
  }
  originalReviews = reviews();
  sql(migration());
});

test('delete-only migration matches fresh setup, is repeatable and retains invoker permissions', () => {
  const fresh = file('../../supabase/schema.sql').match(/create function public\.remove_job_application\(p_application_id uuid\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(fresh, 'Fresh setup must define the removal RPC');
  const expectedBody = fresh.match(/\$\$([\s\S]*?)\$\$/)?.[1]?.trim();
  assert.equal(sql("SELECT prosrc FROM pg_proc WHERE oid='public.remove_job_application(uuid)'::regprocedure;"), expectedBody);
  const before = { applications: applications(), reviews: reviews() };
  sql(migration());
  assert.deepEqual({ applications: applications(), reviews: reviews() }, before);
  assert.deepEqual(json(`SELECT jsonb_build_object('security_definer',prosecdef,'config',proconfig,
    'anonymous',has_function_privilege('anon',oid,'execute'),
    'authenticated',has_function_privilege('authenticated',oid,'execute'))
    FROM pg_proc WHERE oid='public.remove_job_application(uuid)'::regprocedure;`),
  { security_definer: false, config: ['search_path=""'], anonymous: false, authenticated: true });
});

test('confirmed deletion and its retry preserve every review field, other application and CV snapshot', () => {
  const before = applications();
  const beforeCv = sql('SELECT to_jsonb(c) FROM public.cv_variants c;');
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${application}')`)), application);
  assert.deepEqual(applications(), before.filter((row: { id: string }) => row.id !== application));
  assert.deepEqual(reviews(), originalReviews);
  assert.equal(sql('SELECT to_jsonb(c) FROM public.cv_variants c;'), beforeCv);
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${application}')`)), application);
  assert.deepEqual(reviews(), originalReviews);
});

test('unknown and another owner’s application IDs return the same acknowledgement without changing rows', () => {
  const before = applications();
  const missing = randomUUID();
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${otherApplication}')`)), otherApplication);
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${missing}')`)), missing);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
  // The explicit owner predicate also holds for callers with RLS bypass.
  assert.equal(sql(`DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${owner}',false); END $$;
    SELECT public.remove_job_application('${otherApplication}');`), otherApplication);
  assert.deepEqual(applications(), before);
});

test('signed-out and anonymous callers cannot delete an application', () => {
  const before = applications();
  assert.throws(() => sql(actor(null, `SELECT public.remove_job_application('${failedApplication}')`)), /A signed-in account is required/);
  assert.throws(() => sql(actor(owner, `SELECT public.remove_job_application('${failedApplication}')`, true)), /A signed-in account is required/);
  assert.throws(() => sql(`SET ROLE anon; SELECT public.remove_job_application('${failedApplication}');`), /permission denied for function/);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
});

test('database failure rolls back deletion and leaves review revisions and all cached facts intact', () => {
  const before = applications();
  assert.throws(() => sql(actor(owner, `SELECT public.remove_job_application('${failedApplication}')`)), /Synthetic deletion failure/);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
});
