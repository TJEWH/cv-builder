# Application refinement integration

The supported exchange is the connected Supabase workflow: **Sync / Copy task → ChatGPT → Sync**. It uses version-2 requests and proposals. Standalone letter-drafting/CV-adjustment APIs, version-1 refinement and manual proposal imports are retired. Opportunities, applications, current refinement history and private working documents are preserved.

For a new database use [`schema.sql`](schema.sql). The deployed workspace is current; future changes to existing installations require targeted migrations as described in [setup](README.md). Applied and superseded upgrade scripts have been removed. The source contract is [`src/refinementTypes.ts`](../src/refinementTypes.ts); copied instructions are generated from the same contract and verified by [`test/refinementProtocol`](../test/refinementProtocol).

## Workflow and storage

Preparation freezes an independent application CV and letter-template revision. The app publishes privacy-filtered wording and settings. Copy task publishes and verifies the associated protocol document before copying a short instruction. ChatGPT reads the exact request and protocol through the project's management connection and saves a validated proposal. Sync applies an eligible proposal to the current working document, subject to exact baseline, scope and approval checks. The user reviews the result, answers annotations, edits wording and separately approves CV and letter.

Current cloud history remains available. Selecting a historical proposal opens a comparison against its frozen local source; a stale proposal cannot replace newer working documents. Template-library edits do not update application copies. Missing schema or local reconstruction data produces an error without deleting working documents.

Complete CVs, private letter text, token/structure mappings and source signatures remain in browser storage. Supporting files and generated PDF packages remain in IndexedDB. Supabase stores anonymized source snapshots, frozen settings, proposals, feedback and approval hashes. Cloud records cannot reconstruct missing private originals. Application notes and supporting files are not included in refinement requests.

## Browser contract

Signed-in non-anonymous owners use these RPCs with existing RLS. They return a JSON row, not an array.

| RPC | Arguments | Behavior |
| --- | --- | --- |
| `public.save_refinement_state` | `p_application_id`, `p_setup`, `p_approvals`, `p_expected_revision` | Save frozen setup with optimistic concurrency. Initial revision is `0`; new approval hashes require a recorded approval review. |
| `public.publish_refinement_request` | `p_request` | Freeze a request, capture the assigned public CV and application research, and atomically advance the current request. |
| `public.publish_refinement_protocol` | `p_request_id`, `p_protocol_id`, `p_protocol_text` | Store the immutable connected protocol; verify its receipt before copying the task. |
| `public.save_refinement_review` | `p_application_id`, nullable `p_request_id`, `p_kind`, `p_payload`, `p_id` | Append feedback, annotations or CV decisions; approvals/reopenings also update state atomically. |
| `public.clear_refinement_history` | `p_application_id`, `p_expected_revision`, `p_scope` | Clear the selected document's refinement history while retaining the other document's history, setup, approval hashes and the application itself. |

Read the owner-scoped `application_refinement_state`, `application_refinement_requests`, `application_refinement_proposals` and `application_refinement_reviews` tables. Load all pages and order history by `created_at, id`. Validate ownership and application/request identities on every page. Use `current_request_id` to identify the active source; the newest timestamp alone does not establish freshness.

Requests have `schemaVersion: 2`, request/application IDs, `cv`, `cvStructure`, frozen `letter`, `scope`, ordered `feedback`, `parentProposalId` and optional `privacyLegend`. The nested `cv.schemaVersion: 1` describes the current privacy-field format; it is not the retired outer refinement protocol. Source paths and reverse mappings never enter request JSON.

Template formatting (page margins, body size, header name size and line spacing) stays in the private local template baseline. Application overrides also remain local. These rendering settings are omitted from shared setup and request templates and require no additional database fields.

Exact UUID/payload retries return the original receipt. They do not recapture inputs or reactivate an old request. New inputs, scope, research or feedback require a new request. Reuse requires both the server's current pointer and matching local inputs. Feedback must contain every saved reply exactly once, in order, with unchanged text, scope, ID and equivalent timestamp. Publication fails if privacy rechecking would alter an immutable saved reply or if the complete history exceeds the size limit; it never truncates context silently.

The server-captured CV snapshot ID/revision is distinct from the local CV Studio source revision. State timestamps/revisions can change for setup and approvals and are not document version counters. Local source metadata may be unavailable on another device; show that as unknown instead of inferring it from cloud timestamps.

### Application reference codes

Each application has an immutable, globally unique server-generated code such as `APP-7D60E4A912`. Resolve the complete code or UUID; never guess from a title. Browser resolution is owner-scoped. The management resolver is restricted to `postgres` and returns the application identity and current request pointer.

### Protocol location for copied tasks

Protocol documents live in `public.application_refinement_protocols.protocol_text`, keyed by `request_id` and the frontend's SHA-256 `protocol_id`. They contain rules and SQL operations, without embedding CV/letter source text. Repeated copies reuse an identical document; changed instructions get a new protocol ID.

The copied task names the project, application, exact request/version/scope and protocol ID. ChatGPT must use the connected Supabase `execute_sql` capability and these management functions:

```sql
SELECT private.resolve_application_reference('<application code or UUID>');
SELECT private.read_refinement_protocol('<request UUID>'::uuid, '<protocol ID>');
SELECT private.read_refinement_request('<request UUID>'::uuid);
SELECT private.save_refinement_proposal('<request UUID>'::uuid, '<proposal UUID>'::uuid, '<escaped proposal JSON>'::jsonb);
```

Verify all returned identities, scope and schema version. If the connected `execute_sql` definition is not loaded, use available app/tool discovery once, targeted only at `Supabase execute_sql` on the same connector. Namespaced tool names are valid; a partial listing alone does not establish absence. One targeted rediscovery is allowed if the definition disappears after a successful call, then continue with the next exact statement and the same pending proposal UUID/payload. This is tool loading, not permission to discover database contents or use another access path. If the capability is still unavailable (or discovery itself is unavailable), the current request differs, the protocol is missing, or a permission/security/approval check fails, stop and report the last step verified by an actual returned result. Do not rediscover to bypass a denial, switch roles, use logs as a SQL channel, broaden permissions or substitute another request. Supabase management helpers are invoker functions executable only by `postgres`; browser publication does not authorize management impersonation.

Generate one proposal UUID per logical proposal. Use proper SQL escaping or a collision-free dollar quote. Retry an uncertain save with the same UUID and identical payload. Confirm the persisted receipt's ID, application, request and complete proposal before reporting success. Do not write proposal tables directly or approve documents through this external exchange.

## Structured CV and letter proposals

Version-2 proposals contain `schemaVersion`, `requestId`, `summary`, `cvOperations`, `cvComments`, `letterText` and optional `annotations`. Allowed operations target only references in the published topology:

- `reorder_sections`, `reorder_entries`, `reorder_bullets`: provide the complete existing sibling order.
- `shorten_text`: nonempty extractive shortening of an existing range, retaining exact whitespace-separated words in their original order.
- `omit_bullet`: omit a nonessential complete bullet without destroying its frozen private source.

Each operation has a unique change ID and an explanation. Unknown IDs, duplicate targets of the same operation, cross-parent moves, new sections/entries and omission plus shortening of the same bullet are rejected. Reordering plus omission uses the complete original order, then removes selected omissions. Existing privacy tokens and links must remain intact. Comments use existing field IDs and do not mutate content.

Topology and operation/comment lists are bounded at 1,000 entries; field/range text at 20,000 UTF-16 units; labels at 200; explanations at 1,000. Extractive shortening separately counts Unicode code points and must be strictly shorter. CV-only proposals preserve the entire letter byte-for-byte; letter-only proposals have no CV operations. Approved documents must be reopened before changes. No qualifications, evidence, dates or facts may be invented.

CV decision reviews have this shape:

```json
{"proposalId":"<UUID>","accepted":["change-1"],"rejected":["change-2"],"revision":"v1:<64 lowercase SHA-256 hex characters>"}
```

The lists partition all operation IDs exactly once. `revision` is the current signature format, not a refinement schema version. Decisions must reference the owner's current request. SQL validates scope, ownership and approvals; the browser additionally verifies private local baselines and commits the reconstructed document. Decisions do not themselves approve documents.

Approval reviews use `{"revision":"v1:<hash>","expectedRevision":4}` with kind `approve_cv` or `approve_letter`; reopening uses `{"expectedRevision":5}`. Reload state after either operation. Manual changes clear the affected approval. A setup change also clears letter approval and the current request.

## Annotations and feedback

Annotations remain outside document text, word counts and PDF rendering. Each has exactly `id`, `type`, `document`, `location` and `text`. Types are `comment`, `todo`, `question`; documents are `cv` or `letter`. Location is null, an existing CV `{fieldId}`, or a letter `{start,quote}` anchored by zero-based Unicode code-point offset. Text is limited to 4,000 UTF-16 units; quotes to 2,000; at most 100 annotations are accepted. Changed letter text invalidates the displayed anchor; the app never silently relocates it.

An annotation review has this shape:

```json
{"proposalId":"<UUID>","annotationId":"annotation-1","status":"resolved","response":"Used controlled experiments.","previousReviewId":null}
```

Status is `open`, `resolved` or `ignored`. Response is null or nonempty text up to 12,000 UTF-16 units. Later updates must name the most recent review UUID. Stale writes fail; exact review-ID retries are idempotent. Responses are privacy-filtered before saving.

The current interface saves annotation actions and includes their relevant feedback through the connected review API. Feedback includes text, scope and an `annotation` reference with proposal/annotation/review IDs. The server verifies the referenced version, owner, request and document scope. A next request contains the complete ordered feedback history. Later explicit corrections supersede earlier answers; ignored or open annotations must not be treated as confirmed evidence. Answering an annotation does not change CV or letter text directly.

Frozen letter templates can include optional `researchInterests`, `questionGuidance` and `refinementSystemPrompt`, each up to 4,000 UTF-16 units. Interests are aspirations, not qualifications. Questions should seek concrete missing evidence without inferring that absent CV detail means absent experience. Draft from confirmed evidence and put questions in separate letter annotations; never fabricate an answer.

The **Refinement system prompt** controls how letter iterations evaluate resolved answers. Its default includes details only when they strengthen the letter's golden thread (the central narrative connecting motivation, experience and the opportunity) and add relevant value. It omits unrelated or repetitive details and asks a focused follow-up when an answer is too vague to evaluate. A resolved answer remains available as feedback; resolving it does not require including it in the letter. Follow-ups stay in review annotations, and uncertain details stay out of the draft until clarified. Custom prompts remain subject to factual, privacy and document-scope constraints and later explicit user corrections. CV-only rounds preserve the letter unchanged.

New templates and older templates opened in CV Studio receive an editable default when this field is absent. Custom text and explicitly empty values are preserved. Existing application snapshots and exported legacy templates remain unchanged; current refinement protocols use the default when an older snapshot has no field. Template changes reach existing applications only through explicit template selection.

## CV Privacy editor

CV Studio Privacy preserves original fields locally and applies automatic masking followed by explicit replacements. Only changed values are stored in `anonymization.fieldOverrides`, keyed by stable item/section identities. Public snapshots contain resolved wording without originals or reverse mappings. Replacement fields are comments-only for AI; applying a proposal never substitutes their public replacement into private CV text. `!!text!!` is ordinary punctuation, not a privacy instruction.

### Privacy preview and approved context (Ticket 6)

Optional `privacyLegend` entries contain `fieldId`, `token`, `type`, `description`. Supported types are person, organization, location, link, contact, confidential and other. Descriptions are nonempty, at most 500 UTF-16 units and cannot contain original values, mappings, controls, placeholders or HTML. Each token must occur in its field and appear at most once in the legend.

Descriptions are locally approved against the exact private source, path and token occurrence. Changed sources require new approval. Descriptions provide context only; they do not replace tokens or enable reconstruction. The preview distinguishes visible, pseudonymized and unshared content. The app filters known identities and protected originals in free text, while SQL validates the public shape and token boundaries. Arbitrary prose cannot be proven anonymous by SQL alone.

## Clearing refinement history

Clear refinement history removes the selected document's refinement requests, protocols, proposals, feedback, annotations and approval events. It retains the other document's history, working documents, assigned CV snapshots, frozen preparation settings and approval hashes. Other applications and opportunities are unaffected. Legacy rounds and feedback shared by both documents use `cleared_scopes` metadata, so clearing one document hides only its portion; clearing the second removes the shared rows. An exhausted round remains as a hidden immutable source while surviving opposite-document reviews or later iteration lineage still reference it. Request-less feedback and approval events follow their own document scope. The two-argument legacy endpoint still clears both documents explicitly.

The owner supplies the current state revision and `cv`, `letter` or `both` scope. The helper uses the same application advisory lock as publication/proposal writes, clears the pointer only if its request has no remaining active document scope and increments revision atomically. A missing state accepts revision `0` and returns JSON null. An empty-history retry with the new revision is safe; stale revisions fail. Publication keeps the existing complete-feedback contract while excluding shared replies cleared for the requested document.

The public endpoint is invoker-only. Its narrowly granted `private.clear_refinement_history` helper is a `postgres`-owned security-definer function with explicit non-anonymous owner checks. Scoped immutable triggers permit only this controlled deletion or monotonic `cleared_scopes` update; ordinary table deletion and updates remain revoked. New rows must have empty clear metadata. Failures restore the prior scope and roll back the data together. Apply [`refinement_scoped_history.sql`](refinement_scoped_history.sql) to upgrade an existing database; fresh installations include it in `schema.sql`.

## Verification and rollout

Run `npm test`, `npm run refinement:prompts:check`, `npm run test:refinement-protocol` and `npm run build`. Browser checks use synthetic data; see [testing](../test/REFINEMENT_TESTING.md).

SQL suites under [`tests`](tests) exercise real database functions and RLS with synthetic users/JWT claims and roll all fixtures back. Cover workspace security, current structured refinement, privacy, annotations, protocol publication, review retries, history clearing, approval concurrency and application removal. Run security/performance advisors after DDL and compare against the pre-migration baseline. Browser mocks do not prove deployed RLS or live Auth/PostgREST transport.
