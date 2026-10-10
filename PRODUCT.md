# CV Harness

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the project owner, preparing their own research, PhD, and career applications. Product decisions should serve this personal workflow. A broader applicant audience is not an established requirement.

## Product Purpose

CV Harness is a personal application preparation workspace. It brings opportunity research, reusable career material, application-specific CVs and motivation letters, PDF packages, and application tracking into one workflow.

Success means reusing accurate career material across applications, retaining control over personal information and AI proposals, and producing reliable final documents ready for submission.

## Positioning

The product connects a reusable document library with independent application copies and the research context for each opportunity. It supports an iterative handoff to ChatGPT for proposed CV and letter changes, followed by review, editing, and separate approval of each document. This describes its working mechanism; no competitive superiority or application-outcome claim has been established.

## Operating Context

- **CV Studio** maintains career variants and subvariants, CV content, document design, privacy settings, letter templates, and local attachments. It works without an account.
- **Opportunities** presents an externally maintained research catalogue. The user reviews research and requirements, records interest, and creates applications. The app does not conduct searches itself.
- **Applications** provides Preparation, Refinement, PDF review, and Tracking. These stages allow free navigation and iteration.
- Selecting CV and letter templates creates independent application copies pinned to their source revisions. Later library edits do not silently change those copies.
- Refinement uses an explicit external ChatGPT handoff through a connected workspace or copied sources and proposal import. The user reviews proposals, supplies feedback, edits wording, and approves the CV and letter independently.
- PDF review assembles the CV, letter, and selected supporting documents into an ordered package for preview, download, and a fixed local archive. Submission occurs through the institution's portal or email; application status is updated manually.

## Capabilities and Constraints

The following describes the existing implementation, as documented in the repository at initialization:

- The app is a static Vue 3 and TypeScript frontend built with Vite, using local tab navigation and a GitHub Pages-compatible base path. Local CV work does not require an application server.
- The optional Supabase workspace provides signed-in opportunity and application features. Signing in does not automatically upload a CV.
- CV and letter editing data uses browser-local storage. Supporting PDF, PNG, and JPEG files and archived packages use IndexedDB. Only explicitly saved attachment names and descriptions, plus their identifiers, are shared with the connected workspace; file contents remain local.
- Cloud records do not constitute a complete backup of private local documents or supporting files. Moving devices or clearing browser data requires appropriate document and file backups.
- Explicit sharing uses privacy-filtered sources. Contact substitution, excluded content, and marked redactions help protect personal data, but unmarked prose can still identify the applicant. Do not describe this as guaranteed anonymity.
- Content and configuration have separate JSON backup formats. Privacy-aware content export/import is the default; full private content transfer requires the explicit bypass setting.
- CVs support configurable sections, ordering, document layout, typography, and reusable variants. Motivation letters use application CV styling and retain revision history.
- SVG previews and vector PDF exports share rendering data. Selectable text, supported fonts, safe clickable links, pagination, and agreement between preview and download are functional requirements.
- The interface and document content support German and English. Desktop and mobile layouts already exist; neither device class has been confirmed as the exclusive priority.
- Opportunity interest, document approval, and application status are distinct states. Research refreshes and template changes must preserve the user's application work according to their explicit actions.
- Research interests, example letters, and AI suggestions do not establish applicant qualifications. Missing evidence and missing research scores must remain distinguishable from verified information.

## Brand Commitments

The confirmed product name is **CV Harness**. Existing UI, repository metadata, and documentation still contain **CV Builder**; those are legacy implementation names, not a competing product-name decision. This initialization records the name without changing application copy.

No additional voice, visual identity, or aesthetic constraint was specified during initialization.

## Evidence on Hand

- `README.md` documents existing capabilities, workflows, storage boundaries, and export behavior.
- `src/App.vue` and `src/components/ApplicationWorkspace.vue` implement the main workspaces and application stages.
- `src/i18n/dict.ts` contains existing German/English interface terminology and privacy explanations.
- `docs/json-format.md` documents content/configuration backups and privacy-aware editing.
- `test/browser/job-workspace.html` and `test/fixtures/` provide development scenarios and synthetic fixtures. They are demonstrations, not evidence of real applicant outcomes.
- `public/fonts/` includes bundled font assets and license information. Preserve the licensing boundaries documented in the repository.

No testimonials, acceptance-rate evidence, ATS certification, customer counts, or commercial positioning claims were established in this initialization. Do not invent them.

## Product Principles

1. **Reuse accurate career material.** Maintain useful source variants while preserving the independence of each application's documents.
2. **Keep sharing deliberate.** Retain personal data locally unless explicitly shared, and make the outgoing information understandable to the user.
3. **Keep the user in control of AI changes.** Treat generated content as proposals requiring review; preserve factual grounding and document-specific approval.
4. **Make final PDFs dependable.** Protect preview/export fidelity, document completeness, and recoverable local copies.
5. **Support iteration.** Let the user move between research, preparation, refinement, review, and tracking without conflating progress with submission status.

## Open Decisions

- Device priority and usage frequency beyond the confirmed personal workflow.
- Any product-specific accessibility requirements or formal conformance target; initialization does not assert that the current implementation meets one.
- Any future expansion beyond the owner's research, PhD, and career applications.
