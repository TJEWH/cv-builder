# Opportunity schema and merge contract 6

The current code contract is defined by [the canonical JSON Schema](../supabase/opportunity_schema_v6.json) and [the description migration](../supabase/opportunity_description.sql). Apply the migration after the v5 conversion and installed adaptive-search upgrades, before rolling out this frontend. Bootstrap/search signatures remain contract 1. The upgraded protocol is `opportunity-search-v1-canonical-6`; every migrated catalogue record has `metadata_schema_version: 6`. Intake and storage accept only that closed schema.

The description ends with a “Unique selling points” section containing distinguishing job features and specific fit rationale. Separate suitability flags, suitability-reason fields and special-features lists have been removed. The one-time migration appends existing useful text without duplicate bullets, remaps evidence to `research_summary`, and updates frozen application descriptions without refreshing their research or changing application state. A private before/after archive supports administrator inspection; normal readers and writers do not convert retired fields.

## One-time conversion

The owner authorized migrating existing opportunity payloads and confirmed that **all existing ratings use a 0–10 scale**. The converter preserves each rating number and adds explicit scale bounds. An absent rating becomes an explicit unrated assessment (`score: null`), never zero.

Before changing records, the migration archives complete original rows, effective evidence, function definitions/permissions, score constraints, defaults and identity aliases in administrator-only private tables. It converts the whole catalogue in a locked transaction, validates every planned row first, and aborts on any invalid conversion. Original IDs, created/updated timestamps, reviews, comments, frozen application snapshots, checklist completions and application history are preserved. It checks a complete review/application checksum before commit.

Known aliases become named canonical fields. Miscellaneous historical facts that have no direct field become structured `{label,text,source_urls?}` notes in the appropriate domain. The exact originals remain in the private archive. Requirement importance, conditions and application stages survive; an unspecified requirement never becomes mandatory. Date-only evidence stays date-only. An assumed midnight deadline is removed from the official time field and its uncertainty is recorded. Historical source observations remain available, but rejected old receipt claims do not become effective evidence.

Temporary converters are removed after conversion. The installed writer and storage check reject string entities, grouped checklists, singular/plural aliases, unknown extension properties, old salary/source keys and legacy format wrappers. Archived receipts and frozen application contexts retain their original representation; the display renderer can still read these historical snapshots without rewriting them.

## Production verification

All **186 records** were converted and archived, pass the strict storage schema, have unique entity/source identities, and match their saved migration after-snapshots and effective state. Every existing rating number is unchanged. IDs and created/updated timestamps are unchanged. All **186 reviews and 29 applications**, including frozen context and checklist completions, retain the exact complete-record checksum `baae598514af4ba48570a26dc0cc5a6916038e0421cda9f7deb37f4fc0cbcacd`.

The converted catalogue SHA-256 is `b8370bfdb71cdb84818bf0d3ae931cdd6fc87bb29e6fe0e3290d027687468c7b`. Deployment rechecked the captured input checksum under the catalogue lock before conversion. All **25 new/replaced function bodies** match the reviewed SQL; they use invoker security and empty search paths. The active schema/protocol hash matches, and normal authenticated-owner readiness returns `ready: true` (bootstrap 1).

[Read-only installed-function checks](../supabase/tests/opportunity_canonical_installation.sql) passed against production using synthetic JSON, with no search submissions. They verify strict intake, stable IDs, rejected-evidence isolation, same-evidence corrections and URL path identity. The administrator-only rollback preview reported 186 records and no blockers; no production rollback was executed. Exact restoration and refusal to overwrite later changes passed in isolation. The full-catalogue rehearsal passed, the final 10-test canonical suite and 65 workspace/rendering tests passed, and typecheck/build passed.

Post-deployment advisors introduced no warnings/errors. The two administrator-only archive tables intentionally deny client access through grants and RLS without policies ([advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Existing unrelated Auth and RLS performance warnings were unchanged.

## Canonical field policies

All nested object shapes are closed in JSON Schema. The server assigns stable entity/source IDs when omitted for new entities; reuse inspected IDs for updates.

| Fields | Representation and merge policy |
| --- | --- |
| `opportunity_key` | Immutable canonical key; matching alternate keys can become identity aliases. |
| `title`, `institution`, `unit`, `city`, `country`, `position_type`, `availability`, `verification_level`, `source_context`, `duration_details`, `research_summary` | Evidence-aware scalars. Missing/empty partial values retain current information. |
| `vacancy_id` | Institution-scoped string. Conflicting nonempty IDs stop automatic matching; correction requires exact expected value and adequate evidence. |
| `official_url`, `source_url`, `application_url` | Scalar URLs; `data.url_roles` distinguishes vacancy, listing, application and context pages. URL identity retains case-sensitive paths and removes tracking parameters. |
| `deadline`, `deadline_time_local`, `deadline_timezone`, `deadline_original_text` | Coherent date/local-time/established-zone/original-wording tuple. Rejected tuple changes reject the proposed tuple together. Date-only values do not acquire an assumed official time. |
| `start_date` | ISO date or null; never invent a day for a start window. |
| `topics`, `open_questions`, named methods/roles/conditions/formats and similar lists | Deterministic normalized string sets. URL lists use URL-aware identity and preserve case-sensitive paths. Unspecified members survive. |
| `contacts`, `supervisors` | Arrays of people with `entity_id`, name/email/ORCID, `roles`, typed verification, source URLs and structured notes. Match stable ID/ORCID/email, then unambiguous compatible name. Contradictory identities do not collapse. |
| `requirements`, `required_documents` | Arrays of `{entity_id,text,status,stage,conditions,...}`. Match ID or normalized text within its application stage. Required, optional, conditional, preferred, recommended, desired, advantageous and unspecified are distinct. |
| `supervisor_top_papers` | Flat publication array with stable IDs, DOI/URL/title/year identity, supervisor associations, selection basis, relevance and sources. |
| `supervisor_research_focus` | Named `profiles` array, with typed research topics/methods and notes. Profiles merge by identity; objects merge per leaf. |
| `salary` | Numeric amount/range, currency, period, gross flag and model form a coherent atomic quote. Details, typed components and source notes are separate. Incomplete quote replacement conflicts. No currency or gross status is invented. |
| `personal_fit`, `rd_career_potential`, `research_career_potential` | Atomic assessments with `score` (0–10 or null), `scale_min:0`, `scale_max:10`, explanation, optional subscores/gaps/notes. No mixed old rationale and new score. |
| `supervisor_reputation`, `hardware_software_balance`, `data.living_standard` | Complete typed descriptive assessments, replaced atomically with adequate evidence. Previous values remain in audit snapshots. |
| `data` | Named research methods, teaching load, living standard, URL roles, research context, application process, funding, start details, provenance and notes. No arbitrary extension keys. Objects merge per leaf; structured facts use normalized identities. |
| `sources` | Observations `{source_id,url,kind,checked_at,precision,supports,notes}`. Match URL/kind/check time; combine coverage for the same observation and retain different observations. Precision is instant/date/unknown. This history does not authorize every stored field. |
| `last_checked_at` | Monotonic check time; a newer run does not authorize stale fact replacement. |
| `id`, `record_type`, `metadata_schema_version`, `created_at`, `updated_at` | Protected server metadata. Search payloads cannot assign these. |

## Atomic evidence, corrections and receipts

The database is the merge authority. Submission serializes identity matching and locks the canonical row. Values, effective evidence, identity aliases, audit snapshots and receipt commit together. Effective field state is keyed by escaped path and stable entity identity. Rejected/conflicting fields never advance provenance; historical source entries do not override this binding.

A fresh replacement needs precise official/institution/graduate-school evidence. Older evidence cannot replace a known value. Missing leaves can be filled without replacing richer siblings. Different official authorities conflict unless explicitly reconciled. Date-only evidence cannot authorize replacement. An unchanged fact can advance its own evidence if genuinely revalidated.

Equal-time disagreement conflicts by default. Legitimate same-evidence corrections use an exact inspected value and a reason:

```json
{"merge_control":{"corrections":[{"path":"/city","expected":"Espoo","reason":"The same official notice specifies Helsinki as the workplace."}]}}
```

Inspect with `private.inspect_opportunity_search_result` in a separate request. Its `snapshot` is already canonical and `effective_fields` exposes value/evidence bindings. Do not normalize it again. Do not invent a later timestamp. Collection clearing/replacement also requires compare-and-set. Parent corrections supersede stale child bindings; old proposals cannot resurrect cleared values or removed members.

Each submission receipt includes before/saved snapshots, accepted/rejected/unchanged/conflicting field decisions, reasons, effective/proposed evidence and previous assessments. A successful receipt does not mean every proposed field won. Identical raw payload retries with the same item UUID return the same receipt; a changed payload under that UUID fails. Repeated unchanged content does not churn `updated_at`.

Verify in a separate `private.verify_opportunity_search_result` call before claiming persistence. Respect `changed_since_save` and `rolled_back`. Search runs never rewrite reviews, applications or checklist context.

## Isolated tests and reproduction

The Docker-only runner accepts only authored synthetic fixtures. It has no connection-string, external snapshot or production-capture override. It resets only labelled container `cv-opportunity-merge-test`, database `opportunity_merge_test`, and refuses network access, bind mounts or published ports. Suites share an exclusive local lock and must run sequentially.

```sh
docker run --detach --name cv-opportunity-merge-test --label cv-builder.test-suite=opportunity-merge --network none --env POSTGRES_PASSWORD=isolated-test-only postgres:17.6
docker exec cv-opportunity-merge-test createdb -U postgres opportunity_merge_test
npm run test:opportunity-merge
npm run test:opportunity-canonical
docker rm --force --volumes cv-opportunity-merge-test
```

The v4 suite uses a freshly authored synthetic replay of the contact identity, checklist array/object and rejected-provenance failures. It also covers every database field, same-time corrections, partial data, concurrency, receipts, synthetic private context, permission boundaries and run rollback. Its fixtures make no claim to reconstruct historical production records.

The v5 suite converts an authored synthetic legacy catalogue containing duplicate contacts, grouped checklists, admission stages, optional/conditional documents, salary aliases, date-only sources, score endpoints, decimals and unrated values. It validates every converted record and score, rejects retired formats through writer/storage boundaries, verifies owner readiness and stable IDs, preserves URL path distinctions, and exercises blocked and exact successful migration rollback. Captured opportunity records are neither read nor accepted by these runners.

## Guarded rollback

The v5 rollback below applies only to an unchanged v5 installation. After the v6 description migration, use a separately reviewed forward correction; do not replay v5 rollback over the current schema.

Migration rollback is administrator-only and preview-first:

```sql
SELECT private.rollback_opportunity_payload_v5();
```

It refuses active searches, later opportunity/evidence changes, count changes or identity changes. With a clear preview, an explicitly authorized `p_apply=true` restores original rows/evidence, functions/permissions, defaults/checks and active v4 protocol atomically. It leaves user reviews/applications untouched and is idempotent. It must not overwrite subsequent research; use a separately reviewed forward correction if blocked.

Run-specific rollback remains `private.rollback_opportunity_search_merge(run_uuid)`. It uses item audits in reverse order, refuses later changes and never deletes new opportunity records. Historical pre-v4 runs have no suitable audit snapshots and cannot be rolled back by inventing them.

## Installation history

V4 was installed on 2026-10-28 as `20261028210636` (`opportunity_search_merge_v4`) plus audit FK index `20261028210937`. All 34 installed function bodies matched reviewed source and all 186 opportunity rows remained unchanged (complete-record SHA-256 `45707d4f315ef7253c159114d6e371167ab2b62bd92e017c56a381d97e924fe8`). That checksum is the v5 conversion input, not the expected checksum after normalization. The v4 migration and isolated regression fixtures remain necessary to rehearse the v5 upgrade and rollback; installation checks now target the active canonical v6 contract.

## Canonical data consumers

The opportunity renderer and letter-refinement sharing path are checked independently. `opportunityPresentation.ts` filters storage identities from displayed text and shared opportunity evidence, including labeled migration notes that preserve a retired ID. Public vacancy references, ORCIDs, DOIs and source URLs remain available. Storage snapshots and checklist fingerprints are not rewritten by this projection.

Canonical people remain single entries with nested contact/evidence links. Every checklist status is recognized, including explicit `unspecified`, which overrides an inherited document-group default. Application-process notes stay readable without becoming checklist tasks.

The follow-up verification checked production using aggregate queries only: 186 valid opportunities, 791 requirement entries, 710 document entries and no duplicate contact identities. All 29 existing application snapshots also have no duplicate contacts and remain frozen in their original format. New applications capture canonical data; existing snapshots change only through an explicit context refresh, never an implicit template/letter action.

The 137 targeted consumer tests cover canonical display strings, component rendering in English/German, complete requirement/document transfer into letter refinement, nested-ID suppression, public references, checklist semantics and unchanged snapshots. Desktop and a real 390px iframe browsing context were checked through the browser fixture; `test/browser/job-workspace.html?flow=canonical-data` and `test/browser/canonical-opportunity-mobile.html` reproduce that inspection with synthetic records. Typecheck/build pass. These frontend changes are local repository changes; the production database was only read during this follow-up.


## Description contract verification

`test/opportunityCanonical/description.test.ts` rehearses the v5-to-v6 upgrade with synthetic records, verifies full rollback on failure, preserves all review/application state, checks the exact schema and evidence mappings, and exercises v6 writes, verification and idempotent retries. The current evaluation integration suite also applies v6 over the complete adaptive-search installation, checking startup/readiness and all installed protocol guards.
