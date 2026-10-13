# Optional Supabase workspace

The app is a static frontend. Supabase supplies the shared opportunity catalogue, private applications and [connected CV/letter
refinement](REFINEMENT.md). Local CV editing and PDF export work without an account.

Deploy to **phd-workflow** (`ehkfzvjgesomteqpwrwa`) with the matching GitHub Pages environment.
The user authorized deletion of the unused **Test** project (`vhkfrseocgiqxshrbevd`). Deletion awaits browser login; the project still exists.

## Storage and workflow boundaries

**CV Studio** maintains CV variants, letter templates and attachments. Applications have Preparation, Refinement, Attachments and
Tracking stages. Selecting templates freezes independent working copies. Save an approved application CV as a new reusable variant.

Complete CVs, letters and private reconstruction data stay in LocalStorage. Attachment files, package arrangements and
archived PDFs use IndexedDB. Cloud records cannot restore private originals on another device. CV, template and file/package backups
are separate.

Refinement publishes privacy-filtered sources for the selected document. **Copy task** / **Copy feedback** prepares a connected ChatGPT
handoff; **Sync** applies a valid current-snapshot proposal. You can correct wording, resolve annotations and approve each document.
Reopen approved documents before editing. In Attachments, assemble local PDFs, then submit and track the application by hand.

The attachment library shares explicitly saved names, descriptions and attachment/owner IDs. File bytes and file-derived metadata stay
local. There is no Storage bucket or cloud application-attachment table. To export a metadata-only entry, add its file on this device.

## Setup

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, using
   the root [`.env.example`](../.env.example). Use a publishable key, never a secret
   or `service_role` key. Restart Vite after changes. You can also use the existing `NEXT_PUBLIC_*`
   equivalents. Configure the same values in the deployment environment.
2. For a **new database**, apply [`schema.sql`](schema.sql) once. It contains the
   current schema and excludes retired standalone drafting APIs. Never replay it over an existing workspace.
3. For an **existing database**, inspect its applied migrations and deployed
   definitions before applying missing changes. Follow the schema maintenance guidance below.
   The document-scoped history UI requires [`refinement_scoped_history.sql`](refinement_scoped_history.sql)
   before frontend rollout. This additive upgrade adds clear metadata and the
   three-argument `clear_refinement_history` RPC while preserving the legacy endpoint.
   The Tracking tab's Reset history button requires
   [`application_history_reset.sql`](application_history_reset.sql) before frontend rollout.
   Installing it leaves existing history intact; an owner's explicit reset retains
   only the current status and its original recorded time.
   [`application_tracking_navigation.sql`](application_tracking_navigation.sql) keeps
   Tracking navigation and history resets from automatically assigning Ready.
4. Provision existing email/password users through Supabase Authentication. The
   app has no signup or recovery flow. For this restricted workspace, keep public
   signup disabled and configure recovery, rate limits and password protection.
5. Maintain `public.opportunities` through trusted administrative tooling. The
   frontend reads shared research and changes only the signed-in owner's records.

## Schema maintenance

[`schema.sql`](schema.sql) is the current fresh-install baseline. Find historical upgrade scripts in Git and deployed migration history
in Supabase. Migration `20261013122212` (`application_history_reset`) was applied to
**phd-workflow** on 2026-10-13 (Europe/Tirane). Owner-only reset, timestamp and note
preservation, repeated resets, later status changes and access checks passed using
temporary records in a rolled-back transaction. Existing application rows were unchanged.

Migration `20261013124138` (`application_tracking_navigation`) was applied to
**phd-workflow** on 2026-10-13. The live rollback test confirmed that entering
Tracking, saving notes and resetting history preserve the preceding status;
explicit Ready and subsequent status changes still work. Existing application rows were unchanged.

Migration `20261011122600` (`letter_refinement_system_prompt`) adds the optional `refinementSystemPrompt` template field to the
existing validator, with a 4,000 UTF-16-unit limit. Use the targeted [`refinement_system_prompt.sql`](refinement_system_prompt.sql) upgrade
for other existing databases. The live template-guidance suite passed after deployment and rolled back its synthetic records.

The confirmed cleanup migrations are `20261010231056` (`retire_legacy_drafting`), `20261010231602`
(`retire_legacy_refinement_formats`), `20261010231941` (`current_refinement_privacy`) and `20261010232812`
(`retire_legacy_application_creation`). They retired the standalone APIs, storage and outer version-1 protocol while preserving
opportunities, applications and current history. Application creation and CV assignment use separate current APIs.

For future schema changes, compare the deployed definitions with the desired baseline and prepare a targeted, reviewed migration.
Preserve data, ownership, grants and RLS; apply and verify the migration, then update the fresh-install schema. Never replay the baseline
or historical scripts over an existing workspace.

The baseline installs atomically, with one definition per function and no historical data backfills. Its consolidated definitions,
constraints, permissions, policies, triggers and indexes were checked against the pre-cleanup baseline.

## Current data contract

| Table | Access and purpose |
| --- | --- |
| `opportunities` | Shared read-only research for authenticated, non-anonymous users. |
| `opportunity_reviews` | Owner-only interest, optional private comment and viewed-source receipt. |
| `cv_variants` | Owner-only immutable privacy-filtered CV/configuration snapshots. |
| `applications` | Owner-only captured research, CV reference, notes, checklist, saved stage and status history. |
| `application_refinement_state` | Owner-only settings, current request, approval hashes and optimistic revision. |
| `application_refinement_requests` | Immutable public CV/letter source context, scope and accumulated feedback. |
| `application_refinement_protocols` | Immutable connected instructions bound to an exact request and protocol hash. |
| `application_refinement_proposals` | Owner-readable, management-appended v2 operations, comments, annotations and letter text. |
| `application_refinement_reviews` | Append-only feedback, annotation responses, CV decisions and approval/reopen records. |
| `local_attachment_metadata` | Owner-only attachment `id`, `user_id`, manually entered `name` and `description`. |

One owner can have one application per opportunity. Server-assigned application codes are immutable; exact codes or complete UUIDs
resolve without title guessing. Captured research stays stable until an explicit context refresh. Composite foreign keys prevent
cross-owner references. Removing an application retains shared research and CV snapshots while cascading its refinement state/history;
account deletion removes the owner's private records. Backend-only `opportunity_history` is outside frontend access and is not part of
this cleanup.

## Active APIs and security model

Browser RPCs use `SECURITY INVOKER`, owner RLS and non-anonymous account checks. `create_job_application(uuid,uuid)` creates without a
CV and returns the existing application on repeated creation. `assign_job_application_cv` atomically publishes a privacy snapshot and
applies permitted edits. Authoritative capture rejects forged research context.

`review_job_opportunity` records interest/source receipts; `save_opportunity_comment` changes private reasoning. `strong_interest` is
independent of fit scores. Checklist, stage, context-refresh and removal RPCs retain their scoped contracts. Saved stages and explicit
tracking are separate. Before an explicit tracking choice, Preparation, Refinement and Attachments set the matching status.
Opening Tracking preserves the status and history; Ready is an explicit dropdown choice. Reset history also preserves the current
status. Server-maintained status history leaves unknown historical times unrecorded.

Refinement uses `save_refinement_state`, `publish_refinement_request`, `publish_refinement_protocol`, `save_refinement_review` and
`clear_refinement_history`. Private management helpers resolve an exact reference, read its request/protocol and append a proposal with
a stable retry UUID and verified receipt. They require `postgres` without JWT impersonation or wider browser grants. The MCP
has administrative access beyond this supported workflow.

History clearing uses a separate owner-checked private definer helper behind its public invoker wrapper, with revision and document-scope
checks. Shared historical rounds retain the other document's history and any immutable sources its reviews or later rounds still need.
It grants no access to management read/save helpers. See [the complete refinement contract](REFINEMENT.md).

The active helpers `job_drafting_redact_samples`, `cv_adjustment_validate_request` and `cv_adjustment_validate_response` keep their
earlier names. Current structured shortening still uses them. Inner `cv.schemaVersion` and `cvStructure.schemaVersion` remain **1**;
only the retired outer request/proposal format was version 1. Private reverse mappings stay local. Database validation cannot detect
every identity inside arbitrary prose, so every publication must retain the frontend privacy projection.

## Verification

Run each complete [`tests/*.sql`](tests) file as the administrative SQL role. Suites create synthetic users and records, exercise
authenticated/anonymous boundaries, and roll back their fixtures. An exception fails the run; a final PASS confirms it. The retired
standalone API suites were removed; current suites cover their surviving application, privacy, access-control and deletion
responsibilities.

Cleanup verification completed locally: fresh schema plus **18 SQL suites**, **770 Node tests**, the production build, and **six
browser flows across verification runs**. All **16 live SQL suites** also passed with their synthetic fixtures rolled back.

The updated workspace-security and retirement suites passed again after the fourth migration, including absence of the old creation
signature and availability of both current APIs.

Postflight retained **150 opportunities** with the unchanged catalogue checksum `f710bf0b6d1b763555df48991bbeb21a` and **8
applications**. Concurrent owner activity created a CV snapshot and v2 request during deployment; totals are **15 CV snapshots** and
**10 refinement requests**. Application-field checksums changed alongside that activity. The scoped migrations preserved application
and opportunity records.

The original **14 CV snapshots** and **9 refinement requests** retain their exact checksums
`47dc553d28f6a757f1505bba5d12040a` and `98137e9ad01658c3d0b34fdb8ca0dbec` respectively; the later records are additional activity.
