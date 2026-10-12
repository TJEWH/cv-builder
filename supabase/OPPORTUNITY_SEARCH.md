# Opportunity search templates

Search templates belong to the signed-in owner. The app saves their criteria and requested schedule; ChatGPT owns and executes the actual scheduled task. Copying a prompt does not create or confirm a schedule.

## Install and upgrade

For a fresh workspace, apply `schema.sql` once as `postgres`. For an existing current workspace, inspect its deployed schema and apply the additive `opportunity_search.sql` upgrade. Never replay the fresh baseline over an existing workspace. The upgrade preserves opportunities, applications, captured application research, and old refinement protocols. It adds the missing `opportunities.research_summary` column without rewriting existing rows.

The upgrade is repeatable: tables/indexes retain their data, helper definitions are replaced deliberately, and an installed protocol version can only be reused with identical contents. Use the repository protocol generation/check command before releasing SQL; `opportunity_search.sql` is the source of the SQL contract and the generated block in `schema.sql` must match it. The generated protocol seed is shared by the fresh schema, upgrade and standalone protocol-release artifact.

Set the existing frontend `VITE_SUPABASE_URL` and publishable key for this same project. For a custom Supabase API domain, also set `VITE_SUPABASE_PROJECT_REF` to its exact project reference. Copy resolves the configured project at that moment and embeds no key. `public.opportunity_search_readiness()` must report a compatible installed protocol before the app produces a runnable prompt.

Do not edit an installed protocol row or delete a historical release. Publish a new reviewed version and move `private.opportunity_search_settings.active_protocol_version`. Schema changes require a reviewed upgrade; a ChatGPT “protocol update” only reads an already-installed compatible release. Bootstrap version 1 helper signatures remain stable across compatible prompt releases.

Run `npm run search:protocol` after changing the protocol source and bumping its release version; `npm run search:protocol:check` checks generated SQL and prompt fixtures. A schema upgrade seeds the initial protocol only when no active pointer exists, so repeating an older upgrade cannot downgrade a newer protocol. Apply the generated `opportunity_search_protocol.sql` deliberately to activate a new reviewed protocol release after any required schema upgrade.

## Storage and API contract

| Relation | Access and purpose |
| --- | --- |
| `opportunity_search_templates` | Owner-readable/writable criteria and schedule with optimistic revisions. |
| `opportunity_search_query_revisions` | Owner-readable, management-written queries pinned to a template and protocol revision. |
| `opportunity_search_runs` | Owner-readable pinned definition, queries, protocol, recovery counter and completion summary. |
| `opportunity_search_schedule_bindings` | Owner-readable task identity and timing confirmed after a real ChatGPT task-tool result. |
| `opportunity_search_receipts` | Owner-readable immutable researched payload and saved catalogue snapshot, plus verification time. |
| `private.opportunity_search_protocols` | Immutable protocol releases, result schemas and hashes; authenticated owners may read these non-secret instructions. |
| `private.opportunity_search_settings` | Active protocol pointer for new runs. |
| `private.opportunity_search_identities` | Management-only persistent canonical aliases used by ingestion. |
| `private.opportunity_search_schedule_claims` | Management-only creation claims that serialize setup across ChatGPT chats until a real task is confirmed. |

Browser writes use `save_opportunity_search_template(id, expected_revision, name, criteria, schedule)` with named parameters prefixed `p_`. Use expected revision `0` for a new UUID. A successful save increments the revision; an exact retry after a lost response returns the existing next revision. A stale or cross-owner write raises `40001`. Every direct table update also requires the next revision, and RLS prevents cross-owner access. Blank optional criteria impose no restriction. A name and at least one criterion of three non-whitespace characters are required.

Schedule JSON uses `frequency` (`hourly`, `daily`, `weekly`), `intervalHours` (1–168), ISO `weekdays` (1–7), local `time` (`HH:mm`), IANA `timezone`, and `runImmediately`. Weekly schedules require at least one weekday. ChatGPT performs timezone-aware scheduling; the database validates the stored timezone and local time and never converts them into a fixed UTC offset. Changed timing becomes effective when the existing ChatGPT task next loads this definition, or when the user copies an update prompt.

The stable management SQL surface is:

```sql
select private.begin_opportunity_search('<search UUID>', '<stable run UUID>');
select private.save_opportunity_search_queries('<run UUID>', '[{"query":"...","sources":["..."]}]'::jsonb);
select private.submit_opportunity_search_result('<run UUID>', '<stable item UUID>', '<opportunity JSON>'::jsonb);
select private.verify_opportunity_search_result('<run UUID>', '<item UUID>');
select private.complete_opportunity_search('<run UUID>', '{"status":"complete","notes":"...","unresolvedCount":0}'::jsonb);
select private.read_opportunity_search_run('<run UUID>');
select private.claim_opportunity_search_schedule('<search UUID>', '<completed run UUID>');
select private.confirm_opportunity_search_schedule('<search UUID>', '<run UUID>', '<confirmed ChatGPT task ID>', '<pinned schedule JSON>'::jsonb);
```

Use the exact bootstrap and protocol SQL templates from the copied prompt, including correct SQL-literal escaping. Never interpolate unescaped source text. These functions are `SECURITY INVOKER`, restricted to `postgres`, and do not impersonate browser users. The existing Supabase management connector retains administrative access beyond these helpers; this workflow does not turn it into a least-privilege end-user API or suppress ChatGPT tool approvals.

## Run and recovery semantics

`begin_opportunity_search` reserves a stable run UUID and pins the current definition and installed protocol. Reusing that UUID returns the same run even after the user edits the template. Generated queries are immutable for each template/protocol combination; subsequent compatible runs reuse them. Manual query guidance remains in the saved criteria and is part of every new generated revision.

Submit each opportunity separately, then read its verification receipt separately. Successful completion requires saved queries and verification of every submitted item. Zero matches still produce a persisted completion row which must be read back. A failed run can be recorded with `{"status":"failed","notes":"the failed step"}` while retaining prior verified results. Server-calculated counts distinguish new, updated, unchanged and verified results; they are not trusted from the model.

A write, verification or uncertain transport outcome permits **one** call per active run to:

```sql
select private.refresh_opportunity_search_protocol('<run UUID>');
```

The helper retains the run UUID, definition and saved item receipts, consumes the recovery budget, and loads the latest compatible installed release. It does not run migrations. If no compatible release exists it returns `compatible: false` while still consuming the attempt. A second refresh is rejected. Reconcile saved receipts and retry pending evidence using the same item UUIDs. A successful save cannot be overwritten by sending different evidence under the same item UUID. Explicit permission denials are reported, never bypassed.

After successful recovery, ChatGPT updates the **existing** task instructions to the current bootstrap, then confirms the actual task result in Supabase. If that update fails, report “results saved; schedule update failed” accurately. A confirmed task ID cannot be replaced silently with another ID, and older runs cannot overwrite newer confirmed timing. Every schedule confirmation requires a completed run with saved queries and verified item receipts. With `runImmediately` enabled this is a real verification search; with it disabled, setup must explicitly complete a setup-only run without claiming that research was performed.

Before creating an external task, complete the verification or setup-only run and call `claim_opportunity_search_schedule`. Only `claimed: true` allows that run to create a task. An existing `schedule_binding` must be reused. If another setup holds the claim, reconcile its exact search marker and confirm an actually found task; if none is found, report the incomplete setup and resume using the original `claim_run_id` and its saved receipt. Claims never expire or transfer automatically because a lost external response might already have created a task. Successful confirmation clears the pending claim atomically. Concurrent setup requests therefore cannot both receive creation permission, while an interrupted creation remains recoverable without a blind duplicate.

## Canonical catalogue and evidence

Ingestion is atomic per item. A short transaction lock serializes supported ingestion calls while matching opportunity keys, institution-scoped vacancy IDs and normalized vacancy-specific URLs, including historical aliases. Different keys found by different searches resolve to the same canonical record. Matching multiple existing records returns a conflict; title similarity never merges records. Generic careers/listing URLs do not identify a vacancy. URL query parameters identifying an opening remain significant; fragments and known tracking parameters do not.

Sources require `url`, `kind`, `checked_at` and `supports`. Personal/research/R&D fit objects require a numeric top-level `score` from 0 to 10, explicit `scale_min: 0` and `scale_max: 10`, and a `summary`; optional numeric `subscores` use the same scale. No guessed contacts, invented supervisor roles or unsupported facts belong in results. `data` can hold sourced methods and teaching-load details. New results reject the retired `cv_track`, `duration_months` and `historical_match_status` fields.

Empty values never replace existing evidence. Missing fields can be filled. A newer official check of the same source can justify a changed fact; conflicting or weaker evidence is retained in the per-item observation and flagged in `open_questions`. Sources accumulate, closed opportunities remain, and `last_checked_at` never moves backwards. Existing application snapshots and review state are untouched.

Verification checks that exactly one canonical row still exists and returns both the immutable saved snapshot and current catalogue row. `changed_since_save` is explicit when another run updated the row between calls: report current confirmed facts and acknowledge changed fields, rather than treating the older snapshot as the latest state.

## Verification

Run `npm run test:search`, `npm run test:sql`, and `npm run build`. The pinned PGlite development dependency provides an isolated Postgres engine for all SQL suites and both upgrade shapes. It creates no hosted project and changes no live data. The runner uses minimal Auth stubs to test database ownership rules; it does not simulate Supabase HTTP/Auth or concurrent database connections.

Run `tests/opportunity_search.sql` as `postgres` after fresh installation and after upgrading a current workspace. Fixtures roll back. It covers ownership/anonymous access, stale and uncertain-save retries, immutable protocols/queries, pinned runs, the one-refresh limit, score validation, URL deduplication, ambiguity, weaker/empty evidence, separate verification, zero results and duplicate task prevention.

Before release, run all existing SQL suites and verify a fresh installation plus a repeat upgrade. The existing catalogue and application snapshot checks must remain unchanged. A real ChatGPT immediate run and later scheduled run are separate acceptance checks: local SQL/TypeScript tests cannot establish the user's connector availability, scheduling capability or approval behavior.

Deployment verification on 2026-10-12: the live search SQL suite passed and rolled back its fixtures. All 154 opportunities and 10 applications retained identical fingerprints. Security advisors reported only informational missing policies on deliberately management-only private identity/claim tables (no client grants), the existing management-only opportunity history table, and the existing Auth setting with [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No new client catalogue-write permission or public management function was introduced.

## Explicit assessment scales (scoring release 2)

Every search template uses the shared installed scoring protocol. New assessments in `personal_fit`, `rd_career_potential`, and `research_career_potential` require a numeric `score` between 0 and 10, numeric `scale_min: 0` and `scale_max: 10`, and a nonblank `summary`. Optional named `subscores` use the same numeric range. Omit unsupported assessments and explain missing evidence in `open_questions`; null, empty objects, categorical labels, numeric strings and other scales are rejected by the submission helper. ChatGPT must reassess evidence directly on 0–10; it must not infer or convert an older rating mechanically.

The read-only `private.inspect_opportunity_search_result(run_uuid, identity_json)` accepts only `opportunity_key`, `institution`, `vacancy_id` and the three vacancy URL fields. It returns `match_count`, `opportunity_id` and `snapshot`; ambiguous identities raise a conflict. It is an advisory read before submission, which rechecks matching under its existing catalogue lock. Inspection has the same administrative access restriction as submission. Schema instructions come from the installed result schema, not ad hoc table discovery.

A rating without the complete explicit scale contract remains unchanged in storage and appears as **Scale unverified / Skala nicht verifiziert** in details and exports. It supplies no numeric meter, ranking or strong-fit score badge. Reassessment replaces each assessment as a whole after existing evidence checks pass, preserving its prior value verbatim in the receipt's `previous_assessments`. No old subscores inherit a new scale. No historical catalogue or application snapshots are bulk-rewritten.

For existing projects, apply the generated **`opportunity_search_release.sql`** to install helper changes and activate the scoring release in a single transaction. `opportunity_search.sql` alone deliberately retains an existing active-version pointer; the standalone protocol seed checks that the inspection dependency is installed. Existing receipt payloads and historical releases remain immutable. Exact receipt retries still work; an in-flight legacy payload without scale bounds must use the existing one-refresh/one-retry recovery and current schema. Readiness rejects an old active scoring schema.

Dynamic schedules load the new release on their next run. Older schedules containing only the static legacy prompt require the setup/update handoff. This release does not edit ChatGPT tasks. `test/opportunitySearch/legacyCoverage.ts` maps all eight original prompt paragraphs to the shared protocol and verification; its source fixture also checks all 38 listed fields. The old schema-discovery/direct-DML and write-retry instructions are intentionally replaced by installed schema, helper calls and bounded recovery.

Verification includes canonical/legacy rating rendering, strict SQL validation, inspection races simulated between lookup and submit, reassessment provenance, old receipt replay, in-flight protocol recovery, and fresh/upgrade preservation. PGlite executes the PostgreSQL contract in isolation; it does not model genuinely parallel server sessions or ChatGPT's external tools.

### Verified rollout — 2026-10-12

Installed `opportunity-search-v1-2026-10-12-scoring-2` in the configured `phd-workflow` project through the `opportunity_search_explicit_assessment_scales` migration. Active release hash: `sha256:e06cfa8cc4b97a1a573cd004aa575d8637dad0714a033e0658a82f3a5d8899d8`. Bootstrap remains 1, and the original release and its hash remain intact.

Validation passed: 905 automated tests, 20 isolated SQL suites, both baseline/deployed-shape upgrades, old-receipt replay and in-flight recovery, protocol artifact checks, typecheck and production build. The scoring/inspection SQL fixture also passed on the live project inside a rolled-back transaction. The 154 opportunities and 10 applications retained identical full-row fingerprints before and after deployment. Browser-role access to the inspection helper remains denied. Interactive ChatGPT runs, real parallel SQL sessions and a new visual browser inspection were not exercised by these checks.

Security advisors introduced no new findings. The existing informational [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) remain on the deliberately restricted identity, schedule-claim and opportunity-history tables. The existing [disabled leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains; this change does not alter Auth configuration. The build retains its existing large-chunk warning.

## Historical catalogue normalization (release 3)

`opportunity-search-v1-2026-10-12-normalization-3` aligns the shared search-template protocol with useful historical data shapes. Requirements and documents accept either arrays of text/objects or grouped objects; teaching load accepts text or structured status/details. Advisor research focus and representative papers are supported fields. Email application links are valid application routes, but never vacancy identities. Optional non-null database fields must be omitted when unknown rather than submitted as JSON null.

The generated `private.opportunity_search_result_schema()` is the single schema used by both the published protocol and the recursive SQL validator. Supported schema keywords are guarded by a TypeScript test; SQL fixtures exercise nested values, malformed types, source field references, timestamps, calendar dates and deadline zones. Readiness requires the installed validator schema to equal the active release schema. No PostgreSQL extension is required. Private management access remains restricted; the owner readiness check can read the schema but cannot call management helpers.

Shared project/listing/application pages are excluded from identity matching. Generic-page language/tracking parameters do not make a page vacancy-specific; vacancy ID query parameters and individual job application paths remain significant. `data.url_roles` can mark each main URL as `vacancy`, `listing`, `application_portal`, `context`, or `unknown`. Non-vacancy roles suppress both current URL matching and stale identity aliases for that URL. Inspection accepts this role metadata only, without broadening access to other record data. Conflicting specific identities still return an ambiguity conflict.

Historical source labels are retained verbatim in `legacy`; explicit `official_*` labels are recognized as historical official claims. Normalization is not a new verification. Exact field references and a small set of unambiguous aliases are mapped to `supports`. Other claims remain in `unmapped_supports`, and absent mappings remain empty with an open review question. Incomplete historical coverage conservatively participates in evidence protection. New sources use canonical kinds and exact supported field names.

A historical date-only `checked_at` remains a date; the schema explicitly accepts that precision. It never authorizes replacement of an existing fact. When comparing against a historical date, the merge helper uses the latest possible instant of that date across UTC offsets as a conservative bound, without storing a fabricated timestamp. Fresh research records an actual timestamp and offset. Deadline zones accept IANA names, UTC/GMT, or fixed `UTC±HH:MM` offsets. Known EEST/AoE labels are represented as fixed offsets while retaining original wording; a missing zone is never inferred from the viewer's timezone.

Installation and catalogue alignment are separate:

1. Apply `opportunity_search_release.sql` to install all helpers and activate the immutable release atomically. Fresh installs embed identical helper/schema definitions in `schema.sql`.
2. Preview proposed changes with `select opportunity_key, private.opportunity_search_normalize_record(to_jsonb(o)) from public.opportunities o;` and review unresolved cases.
3. Run `select private.align_opportunity_search_catalogue();` as the existing administrative role. This explicit, idempotent operation preserves full immutable before/after snapshots in `private.opportunity_search_normalization_history`, scoped to the normalization release and opportunity ID. It takes the existing catalogue lock and does not delete or merge opportunities.
4. Verify identity ambiguity counts, score/application fingerprints, source timestamps and the recorded snapshots separately. Re-running alignment reports already aligned entries and makes no further changes.

Alignment changes only source metadata, additive canonical data aliases, explicit deadline-offset representation, open review questions and `updated_at`. Grouped requirements/documents, scores and subscores, research facts, original URLs, `last_checked_at`, application snapshots, receipts and historical protocol releases remain unchanged. Conflicting aliases are retained and flagged. Empty source lists stay empty. Unknown-scale ratings remain **Scale unverified** until evidence-based reassessment; migration never assigns a scale or a new score.

The user selected preserving and flagging unresolved evidence rather than re-researching it. New dynamic searches load this release automatically; schedules using a static pasted protocol still need the generated setup/update prompt. No ChatGPT task is edited by this release.

### Verified normalization rollout — 2026-10-12

Installed through `opportunity_search_lossless_catalogue_normalization` and activated release `opportunity-search-v1-2026-10-12-normalization-3`, hash `sha256:e3f29987433beff6aa16898446a9d1947960c5fb844b480c1c3118e51f30378d`. The active schema equals the generated SQL validator schema. The new SQL regression fixture passed on the live project with all its writes rolled back before alignment.

The reviewed alignment updated metadata on 154 opportunities and recorded 154 immutable before/after snapshots. Separate live verification found **zero ambiguous identities**, zero lost source objects, zero lost original data values, zero changed research-check times and zero unexpected changed fields. All 341 source objects are retained; 244 are now recognized as historically official/institutional claims. Thirteen canonical research-method fields and 43 teaching-load fields were added from unambiguous aliases; three fixed deadline offsets retain their original labels. The assessment fingerprint (`5646184ed4bc288978dcdd3a295e488b`), all 10 application records (`7539ad01d5718175feb93bccd4d402d9`), and both historical release hashes remained identical.

Unresolved evidence is deliberately retained: 22 entries have no source provenance; 113 have sources with unknown/partially unmapped coverage; one has competing teaching aliases and one has a timed deadline without a zone. These overlap across 136 entries with review questions. Historical assessments, including empty defaults, still do not satisfy the **new-submission** scoring schema and must be omitted from partial submissions until reassessed. No remaining populated factual field violates its declared schema.

Validation passed: 53 focused TypeScript/component tests, 21 isolated SQL suites, fresh/repeated installs, both upgrade shapes, old receipt replay, the live rolled-back normalization suite, protocol generation checks, typecheck and production build. The build retains its existing large-chunk warning. Actual ChatGPT scheduling tools were not exercised or edited.

Security advisors show one additional informational [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the deliberately private normalization history table: RLS is enabled, client grants are revoked, and browser access is tested as denied. The pre-existing [disabled leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is unchanged. No catalogue write permissions were added to browser roles.
