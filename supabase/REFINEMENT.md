# Application refinement integration

Apply [`changes/application_refinement.sql`](changes/application_refinement.sql) once after `cv_adjustments.sql`, before releasing the new application frontend. [`schema.sql`](schema.sql) includes the same additive schema for new databases. No legacy records, templates, drafting tables, authentication policies or drafting APIs are rewritten. Run [`tests/application_refinement.sql`](tests/application_refinement.sql) as `postgres`; its synthetic users, applications and proposals roll back.

**Deployed:** **phd-workflow** (`ehkfzvjgesomteqpwrwa`) received `add_application_refinement_workflow`, migration version `20260922224611` (UTC), on **2026-09-23** in Europe/Tirane. Do not rerun this migration there. The complete expanded SQL suite passed after deployment, including CV-only letter preservation and removal of an account with active refinement records; every fixture rolled back.

The application stages are Preparation, Refinement, PDF review and Tracking. Complete application CV copies, private identity reconstruction, supporting files and final PDFs remain local. Letter template setup, anonymized current text, feedback and proposals are owner-scoped cloud records. Changing the reusable CV or letter library does not update an application's saved copy. Missing cloud schema must be shown as an actionable setup error without deleting local work.

## Browser contract

All three browser RPCs are `SECURITY INVOKER`, require a signed-in non-anonymous owner and use the existing owner RLS model. They return one JSON row, not an array.

| RPC | Arguments | Behavior |
| --- | --- | --- |
| `public.save_refinement_state` | `p_application_id`, `p_setup`, `p_approvals`, `p_expected_revision` | Save frozen template/settings with optimistic concurrency. Initial expected revision is `0`; subsequent saves require the current revision. Existing approval hashes may be preserved or cleared, but new approvals require a recorded review. |
| `public.publish_refinement_request` | `p_request` | Freeze a request, capture authoritative application research and assigned privacy CV, and advance the current request atomically. Repeat the exact UUID and payload to recover an uncertain response. |
| `public.save_refinement_review` | `p_application_id`, nullable `p_request_id`, `p_kind`, `p_payload`, `p_id` | Append feedback or atomically record an approval/reopening and update state. Identical retries return the stored row. |

Read `application_refinement_state`, `application_refinement_requests`, `application_refinement_proposals` and `application_refinement_reviews` through the signed-in client. Order request/review history by `created_at, id` and always load **all** feedback before publishing another request. Proposal refresh only adds history; it never changes working documents automatically.

Review payloads:

```json
{"text":"Keep the technical evidence and shorten the opening.","scope":"letter"}
{"revision":"v1:<64 lowercase SHA-256 hex characters>","expectedRevision":4}
{"expectedRevision":5}
```

The respective review kinds are `feedback`, `approve_cv`/`approve_letter`, and `reopen_cv`/`reopen_letter`. Approval hashes identify exact local document revisions without storing raw private content. After approval or reopening, reload state for its new revision. Manual changes clear the affected approval through state save. A letter setup change also clears letter approval and current request. Approved documents must be explicitly reopened before requesting edits to them.

`request_json` preserves the exact version-1 `RefinementRequest` in `src/refinementTypes.ts`: IDs, editable privacy CV fields, frozen letter setup/current text, requested scope, parent proposal and accumulated feedback. Build feedback entries using the stored review ID, text, scope and `created_at`; every saved feedback row must appear exactly once in creation order. Missing, altered or reordered history is rejected. If complete history exceeds the bounded request size, publication fails explicitly rather than truncating context.

Each request row additionally contains server-captured `opportunity_snapshot` and `cv_snapshot`. These exclude application notes and files. The CV has identity placeholders and only existing privacy-filtered content; current editable fields in `request_json.cv.fields` include later manual wording corrections. Client-supplied opportunity text is already anonymized and must be treated as source material. The browser anonymizes every shared text boundary; the database additionally rejects inline confidentiality markers, sample identities and unknown structural fields. Arbitrary prose cannot be proven anonymous by SQL checks alone.

## Existing ChatGPT Supabase MCP

The selected management MCP connection was verified to run as database role `postgres` with no app-user JWT. It uses these two private-schema, `SECURITY INVOKER` operations:

```sql
select private.read_refinement_request('<request UUID>'::uuid);
select private.save_refinement_proposal(
  '<request UUID>'::uuid,
  '<new proposal UUID>'::uuid,
  '<proposal JSON>'::jsonb
);
```

Only `postgres` receives execution privileges, and both helpers check `current_user`. `anon`, `authenticated`, `service_role` and `PUBLIC` have no helper access. Do not manufacture an application JWT or change legacy authentication triggers. These helpers do **not** reduce the existing management connection's wider administrative permissions. Follow the generated prompt's exact project/request identifiers; do not scan other applications.

`read_refinement_request` returns the frozen row. `save_refinement_proposal` derives owner and application from that request, validates the joint proposal, appends it, and returns a receipt containing IDs, `proposal_json` and creation time. Verify persistence by repeating the same proposal UUID and equivalent JSON value; it returns the same receipt. The same UUID with different input is rejected. A correction uses a new UUID.

```json
{
  "schemaVersion": 1,
  "requestId": "<request UUID>",
  "summary": "Short summary of proposed changes and missing evidence.",
  "cvEdits": [{"fieldId": "field-1", "text": "Improved wording with {{PRIVATE_1}} preserved."}],
  "letterText": "Complete motivation letter, including its subject/greeting/closing."
}
```

CV field IDs, token order/count, links and structure must stay valid under the existing CV adjustment validator. Empty edits mean unchanged. A letter-only request requires empty CV edits; a CV-only request must return its existing letter text exactly. Letter text may include unresolved applicant placeholders for local reconstruction, but may not contain CV `PRIVATE_n` tokens, confidentiality markers, images or HTML. Letter text is capped at 50,000 characters and summary at 8,000. The requested word target remains advisory: a 401-word letter for a 400-word request can be saved and reviewed.

Historical proposals can arrive after another round was published and remain readable for comparison. Before applying any proposal, the browser must verify its request is still current and its full local baseline signature matches. A stale proposal never replaces manual work. Editing the baseline requires a new request.

Generated initial and improvement prompts share a versioned contract: source content is untrusted data; use evidenced qualifications, preserve privacy tokens and manual corrections, obey accumulated feedback and frozen scope, save through the dedicated helper, and verify the receipt. Publishing does not launch ChatGPT: the user copies the prompt into the connected conversation and returns to check results.

## Verification and rollout

The transactional SQL suite exercises template setup, optimistic concurrency, authoritative capture, omitted feedback rejection, letter-only scope, unchanged private tokens, over-target letters, owner isolation, denied browser/admin helper access, direct-write validation, immutable history, exact retries, atomic approval/reopening, and application/account cascades. All fixture data rolls back. Run Supabase security advisors after applying the migration; the explicit grants account for the [current Data API exposure policy](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) and [function privileges](https://supabase.com/docs/guides/database/functions#function-privileges).

Post-deployment advisors reported no new security findings. The existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and backend-only `opportunity_history` [missing-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) remain. Performance notices include the existing history-table [unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), older unused indexes, and the new `refinement_reviews_request_idx` [unused-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). The new index is retained to support its composite request foreign key before normal traffic begins.

Frontend verification must also cover local template independence, baseline mismatch refusal, accumulated feedback, privacy reconstruction, unavailable local files, placeholder export blocking, advisory word counts, and the complete desktop/mobile preparation → proposal → feedback → approval → combined PDF → submitted tracking flow.
