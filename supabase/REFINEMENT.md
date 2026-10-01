# Application refinement integration

Apply [`changes/application_refinement.sql`](changes/application_refinement.sql) once after `cv_adjustments.sql`, before releasing the new application frontend. [`schema.sql`](schema.sql) includes the same additive schema for new databases. No legacy records, templates, drafting tables, authentication policies or drafting APIs are rewritten. Run [`tests/application_refinement.sql`](tests/application_refinement.sql) as `postgres`; its synthetic users, applications and proposals roll back.

**Deployed:** **phd-workflow** (`ehkfzvjgesomteqpwrwa`) received `add_application_refinement_workflow`, migration version `20260922224611` (UTC), on **2026-09-23** in Europe/Tirane. Do not rerun this migration there. The complete expanded SQL suite passed after deployment, including CV-only letter preservation and removal of an account with active refinement records; every fixture rolled back.

The application stages are Preparation, Refinement, PDF review and Tracking. Complete application CV copies, private identity reconstruction, supporting files and final PDFs remain local. Letter template setup, anonymized current text, feedback and proposals are owner-scoped cloud records. Changing the reusable CV or letter library does not update an application's saved copy. Missing cloud schema must be shown as an actionable setup error without deleting local work.

## Browser contract

All three browser RPCs are `SECURITY INVOKER`, require a signed-in non-anonymous owner and use the existing owner RLS model. They return one JSON row, not an array.

| RPC | Arguments | Behavior |
| --- | --- | --- |
| `public.save_refinement_state` | `p_application_id`, `p_setup`, `p_approvals`, `p_expected_revision` | Save frozen template/settings with optimistic concurrency. Initial expected revision is `0`; subsequent saves require the current revision. Existing approval hashes may be preserved or cleared, but new approvals require a recorded review. |
| `public.publish_refinement_request` | `p_request` | On first insertion, freeze a request, capture authoritative application research and assigned privacy CV, and advance the current request atomically. Repeating the exact UUID and payload returns the original receipt without changing the current request. |
| `public.save_refinement_review` | `p_application_id`, nullable `p_request_id`, `p_kind`, `p_payload`, `p_id` | Append feedback, annotation updates or CV decisions, or atomically record an approval/reopening and update state. Identical retries return the stored row. |

Read `application_refinement_state`, `application_refinement_requests`, `application_refinement_proposals` and `application_refinement_reviews` through the signed-in client. Order request/review history by `created_at, id` and always load **all** feedback before publishing another request. Proposal refresh only adds history; it never changes working documents automatically.

Review payloads:

```json
{"text":"Keep the technical evidence and shorten the opening.","scope":"letter"}
{"revision":"v1:<64 lowercase SHA-256 hex characters>","expectedRevision":4}
{"expectedRevision":5}
```

The respective review kinds are `feedback`, `approve_cv`/`approve_letter`, and `reopen_cv`/`reopen_letter`. Approval hashes identify exact local document revisions without storing raw private content. After approval or reopening, reload state for its new revision. Manual changes clear the affected approval through state save. A letter setup change also clears letter approval and current request. Approved documents must be explicitly reopened before requesting edits to them.

`request_json` preserves the exact versioned `RefinementRequest` in `src/refinementTypes.ts`: IDs, editable privacy CV fields, frozen letter setup/current text, requested scope, parent proposal and accumulated feedback. Build feedback entries using the stored review ID, text, scope and `created_at`; every saved feedback row must appear exactly once in creation order. Missing, altered or reordered history is rejected. If complete history exceeds the bounded request size, publication fails explicitly rather than truncating context.

Each request row additionally contains server-captured `opportunity_snapshot` and `cv_snapshot`. These exclude application notes and files. The CV has identity placeholders and only existing privacy-filtered content; current editable fields in `request_json.cv.fields` include later manual wording corrections. Client-supplied opportunity text is already anonymized and must be treated as source material. The browser anonymizes every shared text boundary; the database additionally rejects inline confidentiality markers, sample identities and unknown structural fields. Arbitrary prose cannot be proven anonymous by SQL checks alone.

### Snapshot metadata and local availability

The existing request/state APIs support snapshot inspection and reuse without an additional database endpoint. The available metadata has distinct meanings:

| Source | Durable server metadata | Not supplied by this source |
| --- | --- | --- |
| Request row | Immutable request UUID, application/owner UUIDs and server `created_at`; frozen scope, inputs, parent proposal and ordered feedback | A sequential document version, original device or private reconstruction baseline |
| `cv_snapshot` | Assigned cloud CV `snapshotId`, cloud row `revision` and anonymized content captured on publication | Original CV Studio variant/base ID, original name or base revision, application CV working revision |
| `request_json.letter` | Frozen template ID, name, revision, `updatedAt`, guidance/settings and anonymized working text | Working letter revision ID, working timestamp, private text or final revision ID |
| `opportunity_snapshot` | The application's authoritative saved `context_json` at publication | A separate frozen `context_captured_at`; source-record dates inside the JSON are not the application's capture time |
| Refinement state | Current request UUID, approval hashes, state revision and `updated_at` | A document revision counter, guaranteed local file availability or proof that this device can reconstruct the request |

Original CV provenance (`baseId`, `variantId`, `baseName`, `baseRevision`), application CV working revision, full baselines, privacy-token bindings and local baseline signatures live in browser application records/backups. Letter working/history/final revision IDs also remain local. A cloud CV snapshot revision must not be labeled as the source template revision. Unknown original version or device availability should be displayed as unavailable rather than inferred from cloud timestamps or IDs.

The snapshot overview uses local `baseName`/`baseRevision` for CV source provenance, the local working-letter `updatedAt` and fingerprint for letter state, and the saved request's anonymized wording and `created_at` for the published copy. New local request records may freeze these source details in optional `LocalRefinementRequest.source`; this stays alongside local reconstruction data and is never inserted into `request_json`. Legacy requests and other devices may lack it. Freshness is verified only when the matching local baseline is available; missing local evidence is an unknown state, not proof that the snapshot is current or stale.

Use `current_request_id` to identify the active request, then its own `created_at` for the publication time. The most recent request by date is not necessarily current: saving changed letter setup clears the current pointer, and older immutable requests remain available. State revision/time may advance for settings, publication or approval actions; they do not identify the version of either working document.

### Reusing requests and retained feedback

An identical retry of `publish_refinement_request` returns the saved row before running capture/activation triggers. It does not recapture changed research/CV data, add later feedback, or reactivate an older request. Reusing a published snapshot for another prompt therefore requires that its UUID is still the server's current request and its frozen scope/inputs/history match the intended work. Applying a resulting proposal additionally requires the matching local baseline and reconstruction data. To make historical content current again, publish a new UUID through the existing API; do not overwrite history or set the pointer directly. After an uncertain publication result, first retry the same UUID and exact payload and reload current state before deciding whether a new round is needed.

The client fixes historical-request reactivation by reusing only the current published request and allocating a new UUID for a historical baseline. It continues to use the existing publication, state and request-reading APIs; no backend metadata, SQL or authentication changes are required. When the local letter record is genuinely absent, it may be initialized from the current request's anonymized letter text and frozen template/settings. This restores shared wording, not missing private identity data or prior local history. Never replace an existing local letter—even an empty one—and never silently treat a corrupt/unreadable local record as absent.

Feedback is anonymized before its review row is saved. A subsequent request must retain every saved reply's exact ID, text and scope in `created_at, id` order; its timestamp must represent the same instant. The server rejects missing, altered or additional entries. Rechecking old feedback against current privacy information must not silently change or discard it: if anonymization would now alter an immutable saved reply, stop publication and report that incompatibility. An already saved request's idempotent retry still requires its original JSON payload, including the original timestamp representation. Both request versions reject additional keys (version 2 adds only `cvStructure`), so durable source-version metadata cannot be added to the upload payload without a separate contract/database change.

## Existing ChatGPT Supabase MCP

### Application reference codes

[`changes/application_codes.sql`](changes/application_codes.sql) adds `applications.application_code` after the refinement migration. **phd-workflow** received it on **2026-10-01** as `add_persistent_application_codes`, migration version `20261001195548` (UTC); do not rerun it there. For other targets, confirm migration history before using the short-code workflow. New-database [`schema.sql`](schema.sql) includes it.

The server assigns each application a persistent code such as `APP-7D60E4A912`, including existing applications during the one-time upgrade. Codes are globally unique and immutable. Both supported creation RPCs retry random code collisions without changing their existing UUID-based idempotency. Browser-supplied codes are ignored on insertion; existing applications cannot be renamed by editing their code. Backfill preserves all other application fields and timestamps. The application UUID remains the internal identity. Treat the returned code as an opaque reference; do not synthesize codes from UUIDs, titles or list order.

The browser can resolve a reference through owner-scoped `public.resolve_application_reference(p_reference)`. The existing management MCP uses:

```sql
select private.resolve_application_reference('APP-7D60E4A912');
```

Both resolvers accept a complete application code or a complete application UUID, trim surrounding whitespace and normalize letter case. Partial values, title searches and wildcard lookup are not supported. They return only `application_id`, `application_code` and nullable `current_request_id`. The public resolver retains owner RLS; the private resolver is an invoker function restricted to `postgres`. A code is a reference, not a permission or secret.

For a short ChatGPT prompt, resolve the provided code in the explicitly configured project, then read its `current_request_id` using `private.read_refinement_request`. Confirm the returned request belongs to the resolved application and its frozen scope matches the short instruction; preserve privacy tokens and accumulated feedback before saving a proposal. A missing `current_request_id` or different scope means the owner must publish a matching round in the app first. Copying the code or short prompt does not publish a request, approve edits, or authorize changing another application. A long prompt containing an explicit request UUID continues to use that exact immutable request rather than silently selecting a newer round.

[`tests/application_codes.sql`](tests/application_codes.sql) verifies backfill validity, generated values, immutable updates, exact creation retries, actual forced code collisions across owners for both creation APIs, bounded allocation failure without orphaned CVs, owner isolation, admin-only management access, full UUID fallback and current request mapping. The transaction removes every synthetic fixture and its temporary collision trigger/sequence.

The full code suite and existing workspace-security/refinement SQL suites passed after deployment, with all fixtures rolled back. All **8 existing applications** received distinct, non-null codes, and a before/after checksum confirmed every non-code field remained unchanged. Advisors reported no new finding; the existing history-table notices, leaked-password-protection warning and older unused-index notices remain.

### Draft request and proposal operations

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

## Structured CV refinement, version 2

**Applied to phd-workflow on 2026-10-01:** [`changes/structured_cv_refinement.sql`](changes/structured_cv_refinement.sql), migration `structured_cv_refinement` / `20261001205721` UTC. Other targets must apply this additive upgrade before the version-2 frontend publishes requests. It replaces the existing request/proposal/review validation functions and extends the allowed review kinds; tables, RLS, management-role checks, immutable history and existing RPC signatures remain unchanged. [`schema.sql`](schema.sql) includes the same upgrade. Do not apply it twice. Existing version-1 requests and proposals remain readable with their original JSON; a proposal must use the same version as its request.

A version-2 request retains the existing identifiers, nested version-1 `cv` fields, letter, scope and accumulated feedback, and adds `cvStructure`. That structure carries only public opaque references: body/sidebar areas; sections and their area; entries and their section; bullets and their editable field; exact shortenable ranges; and unsupported fields with an explanation. All parent lists are complete, unique permutations of their children. An entry's bullets come from one editable field. A range matches either one entire bullet or one entire non-bullet field; duplicate ranges and unsupported/supported overlap are rejected. Paths, private binding data and full application CVs remain local.

The matching proposal shape is:

```json
{
  "schemaVersion": 2,
  "requestId": "<request UUID>",
  "summary": "Prioritize relevant evidence and remove redundant wording.",
  "cvOperations": [
    {"id":"change-1","type":"reorder_sections","targetId":"body","order":["section-2","section-1"],"explanation":"Prioritize relevant evidence."},
    {"id":"change-2","type":"shorten_text","targetId":"range-1","text":"Research evidence.","explanation":"Remove redundant words."}
  ],
  "cvComments": [{"id":"comment-1","fieldId":"field-4","explanation":"Review this unsupported block manually."}],
  "letterText": "Complete motivation letter."
}
```

Allowed operations are `reorder_sections`, `reorder_entries`, `reorder_bullets`, `omit_bullet` and `shorten_text`. Reordering requires every original child exactly once within its original parent; it cannot move sections between body and sidebar. A proposal may reorder and omit bullets: its order still contains the original complete list, and the local reconstruction removes selected omissions afterward. Duplicate targets of the same operation type, unknown references, extra properties and omission plus shortening of the same bullet are rejected. Comments refer to an authorized field and do not mutate content. Letter-only requests require empty `cvOperations`; read-only comments remain allowed. CV-only requests preserve the complete letter exactly.

Shortening is deliberately extractive. The replacement must be nonempty, strictly shorter by Unicode character count, and a case-sensitive subsequence of original whitespace-separated tokens in their original order. It may remove words, not invent or paraphrase them. Punctuation belongs to its token. Existing privacy-token order/count, link, HTML and image safeguards also apply. The backend bounds each graph list and operations/comments list to 1,000, field/range text to 20,000 UTF-16 units, labels to 200 and explanations/reasons to 1,000, matching JavaScript string bounds. The strictly-shorter comparison separately counts Unicode code points. Source content and explanations are untrusted data.

Loading a refinement immediately shows its proposed CV and letter in temporary previews. Checkbox changes update that temporary state immediately; working documents, published sources and approvals stay unchanged until explicit acceptance. The browser reconstructs the application copy against its exact saved baseline and records decisions only when the user accepts the selection. Older proposals can be previewed against their original local baseline, but stale proposals cannot replace newer working documents. Temporary previews cannot be exported as finalized documents. `save_refinement_review` supports `p_kind='cv_decisions'` with this exact payload:

```json
{"proposalId":"<proposal UUID>","accepted":["change-1"],"rejected":["change-2"],"revision":"v1:<64 lowercase SHA-256 hex characters>"}
```

The two lists must partition all proposal operation IDs exactly once; version-1 proposals instead use their `cvEdits` field IDs. The linked proposal must belong to this owner, application and non-null current request. An approved CV must be reopened before accepting any change; recording all changes as rejected is allowed. Decisions append audit history and do not mutate cloud state or approve the document. Their revision is an opaque signature of the committed local CV. Because the private CV lives locally, SQL cannot prove that local revision from cloud text; the browser must verify the baseline and perform the local commit. Exact review-ID retries return the original receipt. Publishing a newer round makes old proposals viewable, but prevents new decisions against their stale request.

Run [`tests/structured_cv_refinement.sql`](tests/structured_cv_refinement.sql) as `postgres`, then rerun the existing refinement and workspace-security suites. The new transaction covers every operation, malformed topology, unsupported targets, duplicate/conflicting operations, extractive shortening, privacy/link preservation, scope/version matching, exact retries, decision partitions, approved/stale/cross-owner refusal and legacy decisions. Every fixture rolls back. Before deployment, the upgrade and the existing `application_refinement.sql`, `workspace_security.sql` and new structured suite passed together in one rolled-back transaction. The structured suite passed again after deployment, including Unicode bounds and URL whitespace checks. Security advisors showed no new findings; previously documented notices remain unchanged. Frontend deployment is separate from this database upgrade.

## Verification and rollout

The transactional SQL suite exercises template setup, optimistic concurrency, authoritative capture, omitted feedback rejection, letter-only scope, unchanged private tokens, over-target letters, owner isolation, denied browser/admin helper access, direct-write validation, immutable history, exact retries, atomic approval/reopening, and application/account cascades. All fixture data rolls back. Run Supabase security advisors after applying the migration; the explicit grants account for the [current Data API exposure policy](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) and [function privileges](https://supabase.com/docs/guides/database/functions#function-privileges).

Post-deployment advisors reported no new security findings. The existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and backend-only `opportunity_history` [missing-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) remain. Performance notices include the existing history-table [unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), older unused indexes, and the new `refinement_reviews_request_idx` [unused-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). The new index is retained to support its composite request foreign key before normal traffic begins.

Frontend verification must also cover local template independence, baseline mismatch refusal, accumulated feedback, privacy reconstruction, unavailable local files, placeholder export blocking, advisory word counts, and the complete desktop/mobile preparation → proposal → feedback → approval → combined PDF → submitted tracking flow.


## Shared annotation extension

**Deployed:** **phd-workflow** received `refinement_annotations`, version `20261001213228` (UTC), on **2026-10-01**. Post-deployment transactional checks passed; do not reapply it there.

Apply [`changes/refinement_annotations.sql`](changes/refinement_annotations.sql) after the structured CV upgrade, before releasing this frontend. The consolidated schema includes it. No new tables, document fields or history streams are introduced, and existing proposals are immutable. Existing v1 and v2 proposals without annotations remain readable; neither their summaries nor `cvComments` are automatically reinterpreted.

Version-2 proposals may additionally provide `annotations` (an array, at most 100 entries). The generated prompt includes it, using `[]` when no notes are needed. Each entry has exactly these fields:

```json
{"id":"annotation-1","type":"question","document":"cv","location":{"fieldId":"field-1"},"text":"Which research methods did you use?"}
{"id":"annotation-2","type":"todo","document":"letter","location":{"start":0,"quote":"Dear committee,"},"text":"Confirm the addressee before submission."}
```

`type` is `comment`, `todo` or `question`; `document` is `cv` or `letter`. `location` can be `null` for a whole-document annotation. CV fields must exist in the exact request. Letter `start` is a zero-based Unicode code-point offset in the returned `letterText`, and `quote` must match there exactly. Text is nonempty and limited to 4,000 UTF-16 units; quotes to 2,000. Unknown keys, IDs, invalid locations and privacy violations are rejected. Notes never enter CV operation application, letter rendering, word counts or PDF export.

Initial status is `open`, with no response. The signed-in browser uses the existing `save_refinement_review` RPC with `kind: "annotation"`, the proposal's request ID and this payload:

```json
{"proposalId":"<UUID>","annotationId":"annotation-1","status":"resolved","response":"Used controlled experiments.","previousReviewId":null}
```

Status may be `open`, `resolved` or `dismissed`. Response is null or nonempty text up to 12,000 UTF-16 units. The browser scrubs known identity and confidential markers before saving. Later updates must supply the last annotation review UUID as `previousReviewId`. The state-row lock serializes these checks; stale updates fail without changing documents. Identical review UUID/payload retries return the original receipt. Historical proposals remain answerable, and opening them projects the latest status from existing reviews. Unsaved component responses survive a failed save or a conflicting refresh until the user explicitly loads the saved annotation.

“Included as feedback” is a separate, explicit action. Open or answered annotations can append an ordinary `feedback` review with its existing `text`/`scope`, plus:

```json
{"annotation":{"proposalId":"<UUID>","annotationId":"annotation-1","reviewId":"<annotation review UUID, or null for untouched open notes>"}}
```

The backend validates proposal ownership, application/request membership, the annotation ID, latest response revision and document scope. The browser composes the note, original reference, status and answer, applies outgoing privacy checks again, and stores the resulting feedback. Include this same `annotation` reference in each frozen request's corresponding feedback entry. Earlier entries remain unchanged and must occur exactly once in chronological order, even when a later answer supersedes them. Annotation status updates alone do not publish feedback or change source documents; selecting “Include as feedback” makes an existing request outdated until the user publishes the next round.

Letter references conservatively identify the originally proposed document version (normalizing only the existing letter parser/serializer). Any changed rendered version displays **Referenced text has changed**, while the original quote remains available separately. The app never searches for another occurrence and silently moves the annotation. Document-wide notes have no text anchor.

All operations retain owner-authenticated invoker RPCs and existing RLS. Private proposal writes remain restricted to the `postgres` management connection. Helper validation functions have explicit revokes/grants. Run [`tests/refinement_annotations.sql`](tests/refinement_annotations.sql) as `postgres`; synthetic fixtures roll back. It checks strict payloads, Unicode offsets/bounds, exact retries, stale updates, unchanged state, referenced feedback preservation, legacy summaries, historical notes, cross-user isolation and anonymous denial.
