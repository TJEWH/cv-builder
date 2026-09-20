# Optional Supabase workspace

The CV builder remains a frontend-only application. Its complete CVs, saved local versions and editor preferences stay in browser storage. Supabase adds an authenticated opportunities catalogue and private application records; it is not required for local editing or export.

The application workspaces also support immutable motivation-letter drafting contexts, returned draft history, and [privacy-preserving CV wording adjustments](CV_ADJUSTMENTS.md). See [`DRAFTING.md`](DRAFTING.md) for the additive database upgrade, transactional verification, privacy boundary, and authenticated ChatGPT integration contract. Supporting documents and finalized letters stay in browser storage.

## Workspace and storage boundaries

**Opportunities** searches the shared catalogue and creates applications. **CV Studio** maintains reusable career variants, pinned revisions and letter templates. **Applications** provides Overview, CV, Motivation letter and Documents & export tabs that can be used in any order.

An application links to a career variant or a single-level subvariant and follows its saved CV Studio edits. Application-specific tailoring creates a subvariant, leaving the original variant unchanged. Existing independent application copies preserve earlier adjustments until explicitly adopted; restored backups remain detached until reassigned. The local application CV is separate from its immutable anonymized Supabase snapshot. Complete CVs and letter edits/revisions use LocalStorage; supporting files, package arrangements and frozen PDFs use IndexedDB. Application CV, letter/template, and file/package backups are available separately. Cloud records alone cannot restore missing full local documents.

## Setup

1. Copy the optional variables from the root `.env.example` into `.env.local`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Use the project's publishable key, never a secret or `service_role` key. Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` configuration is supported too. Restart Vite after changing these values.
2. For a **new database**, apply [`schema.sql`](schema.sql) once using a Supabase SQL migration or the SQL editor. This is a consolidated setup script, not a repeatable migration. For a workspace with only the original CV/application schema, apply [`opportunity_review_workflow.sql`](changes/opportunity_review_workflow.sql), [`refresh_application_research_context.sql`](changes/refresh_application_research_context.sql), [`opportunity_review_receipts.sql`](changes/opportunity_review_receipts.sql), [`application_checklists_and_removal.sql`](changes/application_checklists_and_removal.sql), then [`application_letter_drafting.sql`](changes/application_letter_drafting.sql) and [`cv_adjustments.sql`](changes/cv_adjustments.sql). Skip upgrades already present. The deployment project **phd-workflow** (`ehkfzvjgesomteqpwrwa`) has all these changes, including `add_application_letter_drafting` applied on 2026-09-20 and `add_private_cv_adjustments` applied on 2026-09-21; do not rerun them there. The earlier Test project remains initialized but is not the deployment target.
3. Provision the intended email/password users through Supabase Authentication. The application signs in existing users; it does not create accounts. Review the project's password policy, auth rate limits and account recovery configuration. For a restricted workspace, keep public account signup disabled.
4. Enable **leaked password protection** in the project's Auth settings if available for its plan. The earlier Test project reported this setting as **disabled** on 2026-09-20. The current **phd-workflow** security advisor also reported leaked password protection as disabled on 2026-09-20; its Auth settings were not changed by this update. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
5. Populate and maintain `public.opportunities` through trusted backend/admin tooling. The frontend can only read the catalogue, create applications and update the signed-in user's private records.

The catalogue is shared with every signed-in, non-anonymous Supabase user. Check that this access model is appropriate before enabling signup or adding users. Signed-out browsers (`anon`) have no access to these tables or the application RPCs. `opportunity_history`, when present, remains outside the frontend's access.

## Data contract

| Table | Access | Purpose |
| --- | --- | --- |
| `opportunities` | Authenticated, non-anonymous users: read only | Existing shared research records; `institution`, `contacts`, structured metadata and research history are preserved. |
| `opportunity_reviews` | Owner only | Per-opportunity `unreviewed`, `interested` or `not_interested` state plus `reviewed_updated_at`, the source version last viewed; missing rows also mean unreviewed. |
| `cv_variants` | Owner only | Immutable privacy-filtered content/config snapshots; complete local CVs are never uploaded by the app. |
| `applications` | Owner only | Required opportunity, captured research, optional CV snapshot and optional legacy employer `contact_email`, status, notes, private `completed_checklist_keys`, and contact/submission timestamps. |
| `drafts` | Owner only | Legacy integration drafts (`motivation_letter`, `cv_suggestions`, `contact_email`); preserved for existing clients. |
| `drafting_contexts` | Owner only; immutable | Server-captured opportunity research, assigned anonymized CV, template, theme and drafting settings. |
| `motivation_letter_drafts` | Owner only; append only | Returned draft text linked to one exact owner/application/context; local edited/final letters are separate. |
| `cv_adjustment_requests` | Owner only; immutable | Reviewed public text fields, privacy placeholders and optional application context; full CVs and reconstruction data stay local. |
| `cv_adjustment_responses` | Owner only; append only | Returned field edits bound to an exact request; accepted changes are reconstructed locally as subvariants. |

Application statuses are `shortlist`, `contacted`, `submitted`, `interview`, `offer`, `rejected` and `withdrawn`. An owner can have one application per opportunity. Creating an application requires no CV or contact email; a privacy CV can be assigned later. Composite foreign keys prevent referencing another user's CV, parent CV or application. Assigned CVs and referenced opportunities cannot be removed while an application needs them; deleting an application cascades its drafts, and deleting an account removes its private records and interest reviews.

CV snapshots use the builder's privacy export and a filtered configuration. The browser also replaces known applicant names, emails, phones and profile links repeated in prose while preserving professional roles and cities. The database accepts only fixed sample contact values or blank contact values, rejects unknown top-level content/config fields and prevents changing saved content, configuration, version or ownership. Drafting bundles convert sample contacts into explicit identity placeholders. Database checks cannot identify personal information embedded in arbitrary prose: keep the frontend's privacy projection at every upload boundary.

`review_job_opportunity(p_opportunity_id, p_observed_updated_at, p_state)` atomically saves an optional interest choice and the version viewed. Opening a row leaves the existing choice untouched. Only the matching current source timestamp can advance a receipt, and stale requests cannot regress it. Receipts use existing owner RLS and remain separate from the shared catalogue. New/updated highlights clear after opening a row or changing its dropdown, persist across sessions, and return for a later source update.

`create_job_application(p_application_id, p_opportunity_id)` creates an application without uploading a CV. Repeated clicks for the same owner's opportunity return the existing application ID without changing its saved data. The previous eight-argument overload remains available for clients opened before the upgrade. `assign_job_application_cv` creates a privacy snapshot and saves permitted application edits in one transaction; retries with identical IDs/payload are safe. Assignment edits are limited to `contact_email`, `status`, `notes`, `contacted_at` and `submitted_at`.

Each application captures the full opportunity row as `context_json`, including `requirements`, `required_documents`, `contacts`, `supervisors`, `supervisor_research_focus` and `supervisor_top_papers`; `context_captured_at` records server capture time. Normal edits and later catalogue changes leave that saved context stable. `refresh_job_application_context(p_application_id)` explicitly captures the latest research while preserving the selected CV, status, notes and contact email. Both RPC and direct table writes use an invoker trigger which replaces client-supplied context with authoritative source data. Application identity and ownership cannot be changed.

All application RPCs run as the caller (`SECURITY INVOKER`), enforce owner RLS and reject anonymous accounts. Research fields are stored without inventing missing data. The two new supervisor research columns were present but empty across the catalogue at the time of the upgrade; use explicit refresh to include later research in an existing application.

`publish_application_drafting_context` freezes the current assigned privacy CV and saved opportunity research. `read_application_drafting_context` returns an owned context; `save_application_letter_draft` appends a new draft for that exact context. Later source edits do not change published bundles. The app never overwrites local letter edits when refreshing incoming drafts. An administrative developer Supabase connection normally has no app-user JWT and cannot invoke these owner-authenticated RPCs: use an authenticated integration or retrieve the selected context read-only and import the drafted text manually. See [integration details](DRAFTING.md).

## Applied migrations and verification

On **2026-09-19**, the original **Test** project (`vhkfrseocgiqxshrbevd`) received:

1. `add_private_cv_application_workspace`
2. `normalize_shared_catalogue_auth_initplan`

The second migration changes only the syntax of the cached JWT lookup in the shared catalogue policy, preserving its authorization behavior. On **2026-09-20** (Europe/Tirane), the project then received:

3. `add_opportunity_reviews_and_application_context`
4. `refresh_application_research_context`

Existing applications were backfilled with current opportunity context once, without changing their prior CV, email, notes, status, creation or update timestamps. That upgrade remains part of the consolidated `schema.sql`; later deployment-project additions are listed below.

Both [`tests/workspace_security.sql`](tests/workspace_security.sql) and [`tests/review_workflow.sql`](tests/review_workflow.sql) passed against that project after the migrations. Run each entire file as the SQL editor / `postgres` role to repeat the verification. They create random fixture users and records inside transactions, simulate authenticated and anonymous requests, and roll everything back. An exception fails the run; a final `PASS` result confirms completion.

The checks cover owner CRUD; cross-user reads, updates, deletes and owner spoofing; cross-tenant foreign keys; shared catalogue read-only permissions; rejection of private contacts and unknown config fields; immutable CV snapshots; server timestamps; atomic reassignment and failed-save rollback; identical retries; anonymous denial; and application/account deletion cascades. Review tests additionally verify interest upsert/isolation, creation without CV/email, duplicate-click protection, complete authoritative research, stable saved context, explicit refresh, and rejection of forged context.

The latest upgrade baseline contained **55 opportunities**, **4 history records**, **1 application** and **1 CV snapshot**, and those counts remained unchanged afterward. Hashes of the existing application's original fields and the complete existing CV row matched before and after the upgrade. Drafts, interest reviews and test users remained at **0**; all test fixtures rolled back.

Supabase advisors reported no new security warnings or performance warnings after the final migration. Remaining findings were:

- Pre-existing **leaked password protection disabled** warning, described above.
- Informational [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on the unchanged, frontend-inaccessible `opportunity_history` table.
- Informational [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), including research indexes and the new review foreign-key index before normal use. These indexes were retained.

## Current deployment project: phd-workflow

On **2026-09-20**, the deployment target changed to **phd-workflow** (`ehkfzvjgesomteqpwrwa`). Its GitHub Pages build uses the GitHub environment named `phd-workflow`; configure that environment’s `VITE_SUPABASE_URL` as `https://ehkfzvjgesomteqpwrwa.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` as this project's publishable key. GitHub variable values were not inspected through an authenticated GitHub API session. Local `.env.local` was also switched to this project and remains ignored by Git.

The project already contained 64 opportunities, including advisor research columns, but had no application workspace tables or access policies. Migration `add_secure_cv_application_workspace` applied the consolidated `schema.sql`, including private CVs, applications, drafts, reviews, atomic RPCs, and explicit removal of browser grants on the backend-only history table and its sequence. That setup enabled RLS on the six tables then present. The complete catalogue checksum matched before and after migration; no opportunity data changed. No accounts, CVs or applications were copied from Test.

Both SQL security suites passed on **phd-workflow**, with all fixtures rolled back. At that initial setup, the security advisor returned no warnings; its only informational finding was the intentionally inaccessible history table having RLS enabled without policies. Earlier Test-specific audit findings above describe that project's historical state, not this deployment project.

The project had **no Auth users** at verification time. Provision an account in **phd-workflow → Authentication → Users** before signing in; Test accounts do not carry over between projects. The local production build passed and its generated bundle contains the phd-workflow URL, with no Test project URL.

On **2026-09-20**, **phd-workflow** also received `add_private_opportunity_review_receipts` ([SQL](changes/opportunity_review_receipts.sql)). [`tests/review_receipts.sql`](tests/review_receipts.sql) and the existing review workflow suite passed with rolled-back fixtures. Receipt checks cover account isolation, anonymous denial, stale/future versions, unchanged shared research and preservation of interest choices. The security advisor reports the existing backend-only history table without frontend policies (INFO), and disabled leaked password protection (WARN; see the setup recommendation above).

The performance advisor also flags the existing backend-only history table’s [unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) (INFO). This receipt migration does not change that table.

On **2026-09-20**, **phd-workflow** received `add_application_checklists_and_removal` ([SQL](changes/application_checklists_and_removal.sql)). The private application column `completed_checklist_keys` stores completed requirement/document identities. Identities are based on canonical source content, not list positions or translated labels, so reorder/language changes retain progress and changed items start unchecked. Existing application RLS applies to the new field. `set_job_application_checklist_item` atomically changes one key without overwriting another device’s checks or the saved research/CV. A research refresh preserves stored checks; only keys still matching the visible research are counted or exported.

`remove_job_application` deletes only the caller’s application and cascading drafts, retains CV snapshots and shared opportunities, and resets a previous “not interesting” review so the opportunity can return to the default review list. Repeated removal requests are safe. The frontend shows an inline confirmation and a “View opportunity” action after success; existing deadline filters still apply to general browsing.

[`tests/application_checklists_and_removal.sql`](tests/application_checklists_and_removal.sql) and the existing review workflow suite passed on **phd-workflow**, with all fixtures rolled back. Checks cover checklist persistence, per-item retries, refresh preservation, bounds, owner isolation, anonymous denial, deletion retries, draft cascades, retained CV snapshots, unchanged research and application recreation. No existing application records were removed during implementation. Security advisor findings remain the previously documented leaked-password-protection warning and backend-only history-table informational notice.

On **2026-09-20**, **phd-workflow** received `add_application_letter_drafting` ([SQL](changes/application_letter_drafting.sql)). It adds immutable `drafting_contexts` and append-only `motivation_letter_drafts`, explicit API grants, owner RLS, composite ownership/context foreign keys and invoker RPCs. Existing application, CV, legacy draft and catalogue data are preserved.

The complete [`tests/application_letter_drafting.sql`](tests/application_letter_drafting.sql) suite passed against **phd-workflow**, with every fixture rolled back. It verifies authoritative source capture, sample-identity placeholders, preservation of factual roles/cities, input bounds, identical retries, immutability, cross-user and cross-application denial, anonymous denial and deletion cascades. The security advisor reported no new finding; the existing **leaked password protection disabled** warning remains. This database deployment does not configure a ChatGPT OAuth client or connector.


On **2026-09-21**, **phd-workflow** received `add_private_cv_adjustments` ([SQL](changes/cv_adjustments.sql)). It adds only `cv_adjustment_requests`, `cv_adjustment_responses`, owner RLS, indexed composite ownership foreign keys, immutable row guards and caller-permission RPCs. Requests may optionally belong to an application. Deleting that application cascades its requests/responses; independent requests remain until account deletion or administrative cleanup. Existing opportunity, application, CV and drafting records are unchanged.

The complete [`tests/cv_adjustments.sql`](tests/cv_adjustments.sql) suite passed with random synthetic users and records, all rolled back. It verifies exact JSON shapes, payload and field bounds, known field IDs, private-token preservation, link/HTML rejection, direct-write validation, owner isolation, anonymous denial, append-only history, identical retries, server timestamps and application/account cascades. See [CV_ADJUSTMENTS.md](CV_ADJUSTMENTS.md) for authenticated RPC examples and the manual workflow. Publication does not configure or start a ChatGPT connection; private full-CV reconstruction remains local.

Final verification retained **63 opportunities**, **11 applications**, and **0 CV snapshots, drafting contexts or motivation-letter drafts**. Both new adjustment tables contained **0 rows** after rollback. Both have RLS enabled; the three public adjustment RPCs are `SECURITY INVOKER`, have an empty `search_path`, allow authenticated execution and deny `anon` execution.

Advisors found no new security issue or performance warning. Remaining findings are the existing [leaked password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), the unchanged backend-only history table's [missing RLS policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), plus informational [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). The new `cv_adjustment_requests_recent_idx` is retained for the owner-scoped all-requests query, which has not yet been used in normal traffic.
