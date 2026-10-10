# Synthetic refinement regression tests

The [refinement prompt checks](refinementProtocol/README.md) add generated Copy task Markdown, strict MCP trace validation and optional live agent runs using the existing Codex/Supabase connection. Run `npm run test:refinement-protocol` for automatic offline coverage; see that guide for fixture setup, live runs, reports and cleanup.

These tests use invented CVs, letters, private fragments, identifiers and proposals. They require no account, application backup, ChatGPT response or database credentials.

## Run

Use Node 22+ and the repository's installed dependencies:

```sh
npm test
npm run test:refinement
npm run build
```

The full suite runs all Node tests. The focused command runs refinement, structured CV operations, privacy and preview lifecycle regressions. The build also typechecks the browser runner.

For the browser flows:

```sh
npm run test:e2e:serve
```

Open [the synthetic runner](http://127.0.0.1:5177/cv-builder/test/e2e/index.html) and click **Run all synthetic flows**. The runner drives the real workspace controls and reports each assertion failure beside its flow. Success is **5/5 browser flows passed**. It leaves the final synthetic workspace open for inspection and can be rerun from a fresh in-memory fixture.

`test:e2e:serve` starts the server; it does not launch a headless browser or execute the flows by itself. A browser driver can click `#run-tests` and wait for `body[data-result="passed"]` or `body[data-result="failed"]`. `#test-status` and `#test-results` contain the readable report.

The dedicated Vite configuration does not load `.env` files, disables Supabase configuration, binds to loopback, and blocks connections outside its own origin. It reuses the production Vue components, styles and vector PDF build plugins. The existing interactive [job workspace fixture](browser/job-workspace.html) remains available; both fixtures share the same in-memory backend.

## Browser flows

1. **CV:** prepare a local CV, publish its privacy snapshot, import synthetic version-2 JSON, inspect the rendered proposal, exclude an operation, compare Original/Proposed, accept the exact candidate into the independent application CV, inspect its accepted preview, remount and accept again. Acceptance must leave the reusable variant library unchanged. Distinct private tokens must follow their reordered bullets. Omitting the private linked bullet must retain the original source and mappings.
2. **Initial letter:** publish an explicitly empty source, verify the initial-draft label, import a proposal, inspect its rendered text and expanded comparison, accept into the working draft, remount and repeat acceptance. The CV remains unchanged.
3. **Existing letter:** publish the entire existing draft, preview its proposed replacement without overwriting it, compare in the expanded preview, accept and remount. The CV remains unchanged.
4. **Combined:** load both candidates from the mock connected history, refresh without changing the active review, switch proposals without mixing their contents, answer an annotation without changing document inputs or rendered PDF content, dismiss, edit the working source and verify the outdated warning and disabled acceptance. Finally approve working documents, verify export is blocked while an unaccepted proposal is active, leave temporary review through PDF review, and generate/load real CV and letter PDFs from accepted inputs. Application tracking status stays independent.

5. **Research interests and questions:** edit and save a template through the real library controls, select its revision, publish an initial-letter request, inspect both guidance fields in the privacy preview, import a contextual question and save an answer. Verify neither documents nor rendered PDF change and no feedback is sent implicitly. Explicitly include the answer, remount, publish the next round, import a synthetic refinement using the confirmed context, then accept the exact preview.

## Coverage matrix

| Required case | Regression coverage | Browser coverage |
| --- | --- | --- |
| Research interests, contextual questions, privacy and legacy templates | `motivationLetters`, `cloudDrafting`, `applicationRefinement`, `refinementSources`, `refinementQuestionLoop` (including backup roundtrip and invalid reference rejection) | Template → question → explicit answer → next request → accepted letter |
| Existing letter publication preserves complete text | `refinementRegression`, `refinementSources`, `applicationRefinement` | Existing-letter flow |
| Empty letter is an initial draft | `refinementRegression`, `refinementSources` | Initial-letter label, empty request and first acceptance |
| CV, letter and combined proposals immediately update previews | `refinementRegression`, `applicationRefinementWorkflow`, `refinementPreviewStatus` | All five flows, actual SVG preview text |
| Single-document scope leaves the other document unchanged | `refinementRegression` | CV-only and both letter flows |
| Operation selection, proposal switching, Original/Proposed | `refinementRegression`, `refinementChangeReview`, `applicationRefinementWorkflow` | CV selection/comparison, combined switch, expanded letter comparison |
| Section, entry and bullet reordering keeps identifiers associated | `cvStructuredRefinement`, `refinementRegression` | CV candidate and accepted application copy |
| Different private tokens move with their own bullets | `refinementRegression`, `cvStructuredRefinement` | Exact reconstructed bullet text and rendered CV |
| Omit a token/link bullet without deleting its local originals | `refinementRegression`, `cvStructuredRefinement` | CV omission, source and mapping invariants |
| Unknown identifiers, altered tokens, unsupported operations, invalid selections | `refinementRegression`, `applicationRefinement`, `cvStructuredRefinement` | Covered by Node reconstruction/workspace tests |
| Source changes block acceptance but allow the exact old preview | `refinementRegression`, `applicationRefinement`, `applicationRefinementWorkflow` | Combined flow checks warning, old candidate and disabled acceptance |
| Reload and repeated acceptance preserve documents and avoid duplicates | `refinementRegression`, `applicationRefinementWorkflow` | CV, initial letter and existing letter remount/repeat |
| Annotation edits/answers do not enter text or PDF content | `refinementRegression`, `refinementAnnotations` | Combined flow compares document inputs and rendered PDF page markup |
| Legacy proposals remain readable without conversion | `refinementRegression`, `applicationRefinement`, `legacyRefinementHistory` | Covered by Node workflow tests |
| Outgoing payloads exclude private originals and reverse mappings | `refinementRegression`, `refinementPrivacy`, `applicationRefinement`, `cloudCvPrivacy` | Every preparation inspects the mock outgoing database |
| Missing source or token/element mapping fails without guessing | `refinementRegression`, `applicationRefinement`, `cvStructuredRefinement` | Covered by Node workspace/reconstruction tests |
| Export during review uses only accepted state | `refinementRegression`, `refinementPreviewStatus`, `applicationPackage` | Combined flow checks export gate, approved inputs and real PDFs |
| Finalized letters, independent application CVs, failed commits and concurrent edits | `applicationRefinementWorkflow` | Covered by Node workflow tests |
| Shared refinement scope and active history selection | `applicationRefinementWorkflow`, `refinementHistory` | Scope selection, connected refresh and history selection |
| Visible/pseudonymized/unshared values and approved context descriptions | `refinementPrivacy`, `cloudCvPrivacy`, `applicationRefinement` | Synthetic snapshot privacy boundary; detailed legend cases are Node tests |

Names in the table refer to `.test.ts` files in this directory. The shared `refinementFixture.ts` builds the synthetic source and backend; `refinementWorkflowHarness.ts` mounts the workspace script for Node tests. `e2e/runner.ts` uses the same fixture with the complete browser component tree.

## Real behavior and mock boundaries

- **Node workflow tests:** execute the actual workspace setup, composables, request generation, validation, reconstruction, selection, history and acceptance. A custom Vue renderer stubs child components. PDF provenance tests use stub PDF blobs and verify the renderer inputs; they do not render browser PDFs.
- **Browser flows:** execute the full Vue template and child components, actual reactive previews, expanded letter views, SVG rendering and vector PDF generation. PDF blobs are parsed with `pdf-lib` to check that valid pages were produced. Export provenance is checked at the actual renderer inputs. Annotation checks compare those inputs and the rendered PDF page markup, not binary PDF metadata. Controls are driven by DOM events; duplicate acceptance also calls the acceptance method because its UI button correctly disables an already applied selection.
- **Mocked in both:** Supabase query/RPC responses, authentication context, local/session storage, clipboard and the parent variant-library callback. Publication runs the real privacy projection before the fixture captures it. The fixture does not prove deployed RLS, SQL validation, PostgREST behavior, real authentication or ChatGPT proposal generation. The contextual question and revised letter are synthetic proposal fixtures, not model outputs; tests prove prompt/payload contents and the review flow, not drafting quality.
- **Reload coverage:** unmount/remount restores from the fixture's saved memory. It is not a full browser restart, real browser storage durability test or cross-device sync test.
- **Not exercised by the browser runner:** native file selection, clipboard permissions, attachment uploads, downloaded-file handling and production package delivery. Manual import uses pasted JSON; delayed file-read races are separately mocked in the Node workflow tests. Package composition has its existing Node tests.

No production database changes are needed. The separate SQL suites under `supabase/tests` are not invoked by these commands and were not run for Ticket 8.

## Verification recorded for Ticket 8

On 2026-10-02: the full Node suite passed **504/504**, the focused refinement suite passed **133/133**, the browser runner passed **4/4**, and `npm run build` passed typechecking and production bundling. Browser testing used the local in-app browser with the synthetic server above. Vite's existing large-chunk advisory remains non-blocking.


## Verification recorded for letter-template guidance

On 2026-10-03: **530/530 Node tests**, **5/5 browser flows**, typechecking and the production build passed. New coverage includes template interests and contextual question guidance, optional/legacy fields, frozen revisions and freshness, privacy filtering, imported and connected answers, explicit feedback inclusion, retries, stale updates, backup roundtrip and rejection of invalid review references. The fifth browser flow uses the real template editor and PDF preview but synthetic ChatGPT questions/letters and the in-memory Supabase boundary described above. No live model quality evaluation was performed.

Four SQL suites (application refinement, structured CV, annotations, and letter-template guidance) passed together in a rolled-back preflight. The new guidance suite passed again after the additive validator migration was deployed to **phd-workflow**. All synthetic database fixtures rolled back; actual authentication and PostgREST transport were not exercised by the browser tests. Existing large-bundle build advisories remain non-blocking.

## Local attachment regression checks

Run `npm test` for the complete Node suite, or `node --import tsx --test test/attachmentMetadata.test.ts test/localDocuments.test.ts test/localAttachmentsWorkflow.test.ts test/applicationPackage.test.ts` for attachment coverage. Tests verify metadata-only requests, required manual fields, paginated owner-scoped reads, stale sessions, cloud failure/retry with stable IDs, legacy filenames, local backup roundtrips, file replacement/relinking, account changes, reusable application selections and invalidation when a file changes during PDF composition.

With `npm run test:e2e:serve`, open `http://127.0.0.1:5177/cv-builder/test/e2e/attachments.html` and click **Run attachment workflow**. Four checks use the actual Vue components, local repository and PDF composer:

1. Create transcript and recommendation PDFs; verify file selection does not fill the manual fields and cloud requests contain no file data.
2. Select both library entries in application Preparation and verify their descriptions and saved package references.
3. Compose the package and verify the original PDF page sizes and order.
4. Remove a local file and verify that the metadata remains visible, the missing file is reported, and package export is blocked.

The attachment browser runner uses synthetic in-memory storage and Supabase transport. File selection is a synthetic browser `File`/`DataTransfer` event, not the operating-system file picker. It tests actual PDF bytes but does not deliver downloads or use production application data. Native IndexedDB and live Auth/PostgREST transport are not exercised by this runner. The separate [SQL test](../supabase/tests/local_attachment_metadata.sql) runs the real database policies and functions with synthetic users and JWT claims, then rolls back all fixtures.

The attachment update passed **546/546 Node tests**, all **4 attachment browser checks**, all **5 existing refinement browser flows**, TypeScript and the production build. The SQL suite passed in a combined migration preflight and again after deployment of `local_attachment_metadata` (`20261002231546`).

## CV Studio layout fixture

Using the isolated test server, open `/cv-builder/test/browser/cv-studio.html` for the full app with synthetic browser storage and a sample CV. It starts on Letter templates; no real local files, stored CVs or cloud sessions are used. Check that the selector and save button stay visible while the form scrolls, the sidebar submit still saves revisions and enforces required fields, and no CV preview appears on this tab. In Privacy, the synthetic name is replaced and the initially excluded work section is absent; toggling that exclusion updates the preview. Opening the expanded preview starts in privacy mode; Content returns to the normal synthetic CV.

Verified on 2026-10-06 at desktop and 390px viewport widths: fixed controls, form scrolling, template switching, successful save, native required-field validation and privacy/normal preview switching. The focused autosave/template suite passed **24/24** tests, and typechecking/production build passed. The browser fixture uses the actual rendering pipeline with in-memory storage and disabled cloud configuration.

## Opportunity list filters and grouping

Run `node --import tsx --test test/jobWorkspaceNavigation.test.ts test/opportunityContext.test.ts test/opportunityContextComponent.test.ts test/opportunityRecency.test.ts test/opportunityDeadline.test.ts`. On 2026-10-06, all **36 tests** passed, covering mutually exclusive current/past deadlines, unknown deadlines, structured personal-fit scores and color boundaries, sorting, exact 24-hour expiry, old unread markers, source-version receipts and account changes. Typechecking and production bundling also passed.

The existing `/cv-builder/test/browser/job-workspace.html` fixture now includes synthetic scores at 9.1, 9.5, 9.6 and 10, missing scores, recent additions/updates, older unread records, viewed records and a past deadline. Manual browser checks at desktop and 390px widths verified the dropdowns, mobile Filters panel, descending scores, red/yellow badges, persistent unread borders without old 24-hour tags, and regrouping after opening details. Backend calls were mocked; no production records were changed.
