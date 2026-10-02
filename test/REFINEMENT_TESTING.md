# Synthetic refinement regression tests

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

Open [the synthetic runner](http://127.0.0.1:5177/cv-builder/test/e2e/index.html) and click **Run all synthetic flows**. The runner drives the real workspace controls and reports each assertion failure beside its flow. Success is **4/4 browser flows passed**. It leaves the final synthetic workspace open for inspection and can be rerun from a fresh in-memory fixture.

`test:e2e:serve` starts the server; it does not launch a headless browser or execute the flows by itself. A browser driver can click `#run-tests` and wait for `body[data-result="passed"]` or `body[data-result="failed"]`. `#test-status` and `#test-results` contain the readable report.

The dedicated Vite configuration does not load `.env` files, disables Supabase configuration, binds to loopback, and blocks connections outside its own origin. It reuses the production Vue components, styles and vector PDF build plugins. The existing interactive [job workspace fixture](browser/job-workspace.html) remains available; both fixtures share the same in-memory backend.

## Browser flows

1. **CV:** prepare a local CV, publish its privacy snapshot, import synthetic version-2 JSON, inspect the rendered proposal, exclude an operation, compare Original/Proposed, accept the exact candidate as a subvariant, inspect its accepted preview, remount and accept again. Distinct private tokens must follow their reordered bullets. Omitting the private linked bullet must retain the original source and mappings.
2. **Initial letter:** publish an explicitly empty source, verify the initial-draft label, import a proposal, inspect its rendered text and expanded comparison, accept into the working draft, remount and repeat acceptance. The CV remains unchanged.
3. **Existing letter:** publish the entire existing draft, preview its proposed replacement without overwriting it, compare in the expanded preview, accept and remount. The CV remains unchanged.
4. **Combined:** load both candidates from the mock connected history, refresh without changing the active review, switch proposals without mixing their contents, answer an annotation without changing document inputs or rendered PDF content, dismiss, edit the working source and verify the outdated warning and disabled acceptance. Finally approve working documents, verify export is blocked while an unaccepted proposal is active, leave temporary review through PDF review, and generate/load real CV and letter PDFs from accepted inputs. Application tracking status stays independent.

## Coverage matrix

| Required case | Regression coverage | Browser coverage |
| --- | --- | --- |
| Existing letter publication preserves complete text | `refinementRegression`, `refinementSources`, `applicationRefinement` | Existing-letter flow |
| Empty letter is an initial draft | `refinementRegression`, `refinementSources` | Initial-letter label, empty request and first acceptance |
| CV, letter and combined proposals immediately update previews | `refinementRegression`, `applicationRefinementWorkflow`, `refinementPreviewStatus` | All four flows, actual SVG preview text |
| Single-document scope leaves the other document unchanged | `refinementRegression` | CV-only and both letter flows |
| Operation selection, proposal switching, Original/Proposed | `refinementRegression`, `refinementChangeReview`, `applicationRefinementWorkflow` | CV selection/comparison, combined switch, expanded letter comparison |
| Section, entry and bullet reordering keeps identifiers associated | `cvStructuredRefinement`, `refinementRegression` | CV candidate and accepted subvariant |
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
| Finalized letters, subvariant hierarchy, failed commits and concurrent edits | `applicationRefinementWorkflow` | Covered by Node workflow tests |
| Shared entry points and active history selection | `applicationRefinementWorkflow`, `refinementEntryPoints`, `refinementHistory` | Scope-specific entry buttons, connected refresh and selection |
| Visible/pseudonymized/unshared values and approved context descriptions | `refinementPrivacy`, `cloudCvPrivacy`, `applicationRefinement` | Synthetic snapshot privacy boundary; detailed legend cases are Node tests |

Names in the table refer to `.test.ts` files in this directory. The shared `refinementFixture.ts` builds the synthetic source and backend; `refinementWorkflowHarness.ts` mounts the workspace script for Node tests. `e2e/runner.ts` uses the same fixture with the complete browser component tree.

## Real behavior and mock boundaries

- **Node workflow tests:** execute the actual workspace setup, composables, request generation, validation, reconstruction, selection, history and acceptance. A custom Vue renderer stubs child components. PDF provenance tests use stub PDF blobs and verify the renderer inputs; they do not render browser PDFs.
- **Browser flows:** execute the full Vue template and child components, actual reactive previews, expanded letter views, SVG rendering and vector PDF generation. PDF blobs are parsed with `pdf-lib` to check that valid pages were produced. Export provenance is checked at the actual renderer inputs. Annotation checks compare those inputs and the rendered PDF page markup, not binary PDF metadata. Controls are driven by DOM events; duplicate acceptance also calls the acceptance method because its UI button correctly disables an already applied selection.
- **Mocked in both:** Supabase query/RPC responses, authentication context, local/session storage, clipboard and the parent variant-library callback. Publication runs the real privacy projection before the fixture captures it. The fixture does not prove deployed RLS, SQL validation, PostgREST behavior, real authentication or ChatGPT proposal generation.
- **Reload coverage:** unmount/remount restores from the fixture's saved memory. It is not a full browser restart, real browser storage durability test or cross-device sync test.
- **Not exercised by the browser runner:** native file selection, clipboard permissions, attachment uploads, downloaded-file handling and production package delivery. Manual import uses pasted JSON; delayed file-read races are separately mocked in the Node workflow tests. Package composition has its existing Node tests.

No production database changes are needed. The separate SQL suites under `supabase/tests` are not invoked by these commands and were not run for Ticket 8.

## Verification recorded for Ticket 8

On 2026-10-02: the full Node suite passed **504/504**, the focused refinement suite passed **133/133**, the browser runner passed **4/4**, and `npm run build` passed typechecking and production bundling. Browser testing used the local in-app browser with the synthetic server above. Vite's existing large-chunk advisory remains non-blocking.
