# Optional Supabase workspace

The CV builder remains a frontend-only application. Its complete CVs, saved local versions and editor preferences stay in browser storage. Supabase adds an authenticated opportunities catalogue and private application records; it is not required for local editing or export.

## Setup

1. Copy the optional variables from the root `.env.example` into `.env.local`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Use the project's publishable key, never a secret or `service_role` key. Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` configuration is supported too. Restart Vite after changing these values.
2. For a **new database**, apply [`schema.sql`](schema.sql) once using a Supabase SQL migration or the SQL editor. This is a consolidated setup script, not a repeatable migration. For a workspace with only the original CV/application schema, apply [`opportunity_review_workflow.sql`](changes/opportunity_review_workflow.sql) followed by [`refresh_application_research_context.sql`](changes/refresh_application_research_context.sql). The deployment project **phd-workflow** (`ehkfzvjgesomteqpwrwa`) already has the complete schema; do not rerun these scripts there. The earlier Test project also remains initialized.
3. Provision the intended email/password users through Supabase Authentication. The application signs in existing users; it does not create accounts. Review the project's password policy, auth rate limits and account recovery configuration. For a restricted workspace, keep public account signup disabled.
4. Enable **leaked password protection** in the project's Auth settings if available for its plan. The earlier Test project reported this setting as **disabled** on 2026-09-20. The security advisor for the current **phd-workflow** project reported no password-protection warning; its Auth settings were not changed by this setup. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
5. Populate and maintain `public.opportunities` through trusted backend/admin tooling. The frontend can only read the catalogue, create applications and update the signed-in user's private records.

The catalogue is shared with every signed-in, non-anonymous Supabase user. Check that this access model is appropriate before enabling signup or adding users. Signed-out browsers (`anon`) have no access to these tables or the application RPCs. `opportunity_history`, when present, remains outside the frontend's access.

## Data contract

| Table | Access | Purpose |
| --- | --- | --- |
| `opportunities` | Authenticated, non-anonymous users: read only | Existing shared research records; `institution`, `contacts`, structured metadata and research history are preserved. |
| `opportunity_reviews` | Owner only | Per-opportunity `unreviewed`, `interested` or `not_interested` state; missing rows also mean unreviewed. |
| `cv_variants` | Owner only | Immutable privacy-filtered content/config snapshots; complete local CVs are never uploaded by the app. |
| `applications` | Owner only | Required opportunity, captured research, optional CV snapshot and optional legacy employer `contact_email`, status, notes and contact/submission timestamps. |
| `drafts` | Owner only | `motivation_letter`, `cv_suggestions` or `contact_email` content associated with an application. |

Application statuses are `shortlist`, `contacted`, `submitted`, `interview`, `offer`, `rejected` and `withdrawn`. An owner can have one application per opportunity. Creating an application requires no CV or contact email; a privacy CV can be assigned later. Composite foreign keys prevent referencing another user's CV, parent CV or application. Assigned CVs and referenced opportunities cannot be removed while an application needs them; deleting an application cascades its drafts, and deleting an account removes its private records and interest reviews.

CV snapshots use the builder's existing privacy export and a filtered configuration. The database additionally accepts only fixed sample contact values or blank contact values, rejects unknown top-level content/config fields and prevents changing saved content, configuration, version or ownership. Database checks cannot identify personal information embedded in arbitrary prose: keep the frontend's privacy projection at every upload boundary.

`create_job_application(p_application_id, p_opportunity_id)` creates an application without uploading a CV. Repeated clicks for the same owner's opportunity return the existing application ID without changing its saved data. The previous eight-argument overload remains available for clients opened before the upgrade. `assign_job_application_cv` creates a privacy snapshot and saves permitted application edits in one transaction; retries with identical IDs/payload are safe. Assignment edits are limited to `contact_email`, `status`, `notes`, `contacted_at` and `submitted_at`.

Each application captures the full opportunity row as `context_json`, including `requirements`, `required_documents`, `contacts`, `supervisors`, `supervisor_research_focus` and `supervisor_top_papers`; `context_captured_at` records server capture time. Normal edits and later catalogue changes leave that saved context stable. `refresh_job_application_context(p_application_id)` explicitly captures the latest research while preserving the selected CV, status, notes and contact email. Both RPC and direct table writes use an invoker trigger which replaces client-supplied context with authoritative source data. Application identity and ownership cannot be changed.

All application RPCs run as the caller (`SECURITY INVOKER`), enforce owner RLS and reject anonymous accounts. Research fields are stored without inventing missing data. The two new supervisor research columns were present but empty across the catalogue at the time of the upgrade; use explicit refresh to include later research in an existing application.

## Applied migrations and verification

On **2026-09-19**, the original **Test** project (`vhkfrseocgiqxshrbevd`) received:

1. `add_private_cv_application_workspace`
2. `normalize_shared_catalogue_auth_initplan`

The second migration changes only the syntax of the cached JWT lookup in the shared catalogue policy, preserving its authorization behavior. On **2026-09-20** (Europe/Tirane), the project then received:

3. `add_opportunity_reviews_and_application_context`
4. `refresh_application_research_context`

Existing applications were backfilled with current opportunity context once, without changing their prior CV, email, notes, status, creation or update timestamps. The final state is represented by `schema.sql`.

Both [`tests/workspace_security.sql`](tests/workspace_security.sql) and [`tests/review_workflow.sql`](tests/review_workflow.sql) passed against that project after the migrations. Run each entire file as the SQL editor / `postgres` role to repeat the verification. They create random fixture users and records inside transactions, simulate authenticated and anonymous requests, and roll everything back. An exception fails the run; a final `PASS` result confirms completion.

The checks cover owner CRUD; cross-user reads, updates, deletes and owner spoofing; cross-tenant foreign keys; shared catalogue read-only permissions; rejection of private contacts and unknown config fields; immutable CV snapshots; server timestamps; atomic reassignment and failed-save rollback; identical retries; anonymous denial; and application/account deletion cascades. Review tests additionally verify interest upsert/isolation, creation without CV/email, duplicate-click protection, complete authoritative research, stable saved context, explicit refresh, and rejection of forged context.

The latest upgrade baseline contained **55 opportunities**, **4 history records**, **1 application** and **1 CV snapshot**, and those counts remained unchanged afterward. Hashes of the existing application's original fields and the complete existing CV row matched before and after the upgrade. Drafts, interest reviews and test users remained at **0**; all test fixtures rolled back.

Supabase advisors reported no new security warnings or performance warnings after the final migration. Remaining findings were:

- Pre-existing **leaked password protection disabled** warning, described above.
- Informational [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on the unchanged, frontend-inaccessible `opportunity_history` table.
- Informational [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), including research indexes and the new review foreign-key index before normal use. These indexes were retained.

## Current deployment project: phd-workflow

On **2026-09-20**, the deployment target changed to **phd-workflow** (`ehkfzvjgesomteqpwrwa`). Its GitHub Pages build uses the GitHub environment named `phd-workflow`; configure that environment’s `VITE_SUPABASE_URL` as `https://ehkfzvjgesomteqpwrwa.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` as this project's publishable key. GitHub variable values were not inspected through an authenticated GitHub API session. Local `.env.local` was also switched to this project and remains ignored by Git.

The project already contained 64 opportunities, including advisor research columns, but had no application workspace tables or access policies. Migration `add_secure_cv_application_workspace` applied the consolidated `schema.sql`, including private CVs, applications, drafts, reviews, atomic RPCs, and explicit removal of browser grants on the backend-only history table and its sequence. RLS is enabled on all six tables. The complete catalogue checksum matched before and after migration; no opportunity data changed. No accounts, CVs or applications were copied from Test.

Both SQL security suites passed on **phd-workflow**, with all fixtures rolled back. The security advisor returned no warnings; its only informational finding is the intentionally inaccessible history table having RLS enabled without policies. Earlier Test-specific audit findings above describe that project's historical state, not this deployment project.

The project had **no Auth users** at verification time. Provision an account in **phd-workflow → Authentication → Users** before signing in; Test accounts do not carry over between projects. The local production build passed and its generated bundle contains the phd-workflow URL, with no Test project URL.
