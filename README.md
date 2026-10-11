# CV Builder – Vue.js

Application preparation workspace built with Vue 3, TypeScript and Vite. Discover opportunities, maintain reusable career-path CV variants, tailor independent application copies, finalize motivation letters and assemble complete PDF packages. Navigation uses local tab state without a router or application server, so the app remains compatible with GitHub Pages.

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Optional Supabase workspace](#optional-supabase-workspace)
- [Tech Stack](#-tech-stack)
- [Development](#-development)

---

## ✨ Features

### Content
- **Personal Information**: Name, role, contact details (email, phone, website, LinkedIn)
- **Sections**: About me, education, work experience, additional experience, projects
- **Sidebar Categories**: Add custom sidebar sections with badge, experience, or years-based skill displays
- **Soft Skills**: With references to jobs
- **Additional**: Languages, hobbies, certificates
- **Custom Sections**: Create your own sections with freely definable fields

### Design
- **Layouts**: Sidebar left/right, adjustable column ratio and starting page; content-sized height by default with adjustable bottom padding, or full-page height. The body returns to full width below a content-sized sidebar
- **Colors**: Font color with separate graphic and date opacity
- **Fonts**: Inter, Montserrat, Poppins, Raleway, Noto Sans, Rubik, and IBM Plex Sans ship as local project assets (regular, semibold, and bold Latin/Latin Extended faces). Other built-in fonts continue to use Bunny or Google on demand. Century Gothic is commercial and is not redistributed with the project; use licensed files if it must be bundled
- **Custom fonts**: In Design → Typography, choose Bunny or Google, enter a font family name, and import it. Imports verify the provider response and decode a font file before saving. A missing Bunny font is retried on Google; other errors are reported by type. Imported fonts become available for body text and headings, including favorite controls. The family name and actual source are saved in `design.customFonts` and retained in saved versions and JSON exports; reimporting a family updates its source
- **Typography**: H1-H3 and bullet font sizes
- **Heading Styles**: clean, underline, leftbar, pill
- **Badges**: Solid or outlined, with adjustable border radius
- **Spacing**: Page margins, header spacing, section/item gaps and body/sidebar spacing
- **Favorites**: Choose frequently used design controls for quick access

### Workflow
- **Three workspaces**: Opportunities, CV Studio and Applications. Switch freely; document preparation is iterative, without a required step order
- **Optional Supabase login**: Existing accounts can filter and review shared opportunities, mark interest privately, create applications and publish privacy-filtered refinement sources. CV Studio works without an account
- **Application stages**: Preparation → Refinement → Attachments → Tracking, with free navigation between stages
- **Frozen templates**: Selecting a career variant creates an independent application CV and publishes its anonymized snapshot. The selected letter template is also pinned to its revision. Library edits do not change existing application copies. Manual edits and accepted refinements stay with that application; an approved CV can explicitly be saved as a new reusable variant
- **ChatGPT refinement**: Copy a task for the selected CV or motivation letter. ChatGPT uses the existing project Supabase MCP to read the published sources and save a proposal. Sync applies a valid proposal for the current document snapshot to the application's working copy. Review the result, make manual corrections or answer its questions, then copy the next task with accumulated feedback. Approve CV and letter separately; approved documents remain unchanged in later rounds until reopened
- **Application references**: Copy the same server-assigned application code from the results list, mobile card or detail header. Search by code or complete UUID. Refinement copies a short `phd-workflow` instruction for the selected CV or motivation-letter scope. Older databases use the complete application UUID until the [code upgrade](supabase/REFINEMENT.md#application-reference-codes) is applied
- **Motivation letters**: Reusable templates with subject, salutation, closing, tone and structure guidance, explicit research interests and contextual follow-up questions, plus an optional example letter used only for style. Edit the complete letter with CV-matched styling. Word-count warnings are advisory; local revisions preserve earlier wording
- **Supporting documents**: CV Studio's **Local attachments** library holds reusable PDF/PNG/JPEG files with manually entered names and descriptions. Only these text fields sync to Supabase; files remain on the device. Applications select existing entries for ordered PDF package composition
- **Live Preview**: Refinement switches between the application CV and letter, with their corresponding preview. Attachments shows the assembled application package before download
- **Privacy editor**: Uses the Content layout and original text. Automatic masking controls sit above the Header, Body, and Sidebar tabs. Header masking is always on; selected Institution (companies and institutions), Place, and Start & end dates fields are disabled with explanatory hover text. Other fields remain editable, and only changes are saved as local privacy replacements. Edited fields are highlighted with a revert arrow. Existing manual replacements are retained when a mask is enabled and continue to take priority until reverted.
- **Auto-Save**: CV edits save automatically; save updates are announced to assistive technology without a visible status label beside the career-variant dropdown
- **Backup System**:
  - Browser-local CVs, letter templates and edits in LocalStorage; supporting files and package archives in IndexedDB
  - Named career variants selected in the CV Studio subtab row, beneath the Supabase account column; the editor and preview always follow the same selected document. The builder and preview wrap automatically on narrower screens
  - Separate content and configuration JSON files (CV data version 7). Content imports replace editable CV text and entries while preserving settings; configuration imports replace settings while preserving CV content
  - Content export/import respects privacy by default: apply automatic masks and manual privacy replacements, omit hidden/private sections and entries on export, and preserve their local originals on import. Imported changes to an existing replacement update that replacement. Enable **Bypass privacy proxy** for complete content export/replacement
  - Only the split formats are supported; old combined exports and raw state JSON are rejected. See [JSON formats and editing workflow](docs/json-format.md)
  - JSON filenames use the selected version title plus `-content` or `-config`; unsaved drafts use `cv-backup`
  - Deleting a configuration removes its stored document and the session recovery copy, clears the active editor/preview, and opens the empty document. Other saved configurations and independent application copies remain available. Open tabs discard deleted versions instead of autosaving them again
- **Safe Links**: Contact websites and Markdown links require explicit HTTP(S) URLs. Invalid links remain plain text; email links reject injected headers or extra recipients. PDF and SVG link annotations use the same URL checks
- **Multilingual**: German/English (UI + content)
- **Drag & Drop**: Reorder sections and entries

### Export
- **PDF Export**: Direct-download vector PDF with visible selectable text, clickable links and vector SVG icons
- **Complete application PDFs**: Include/exclude and reorder the tailored CV, finalized letter and supporting documents; preview the assembled package, then download a fixed PDF copy
- **Vector Previews**: Inline and full-size previews reuse the same scalable SVG pages; no raster images, quality settings, size estimates, or higher-resolution replacement render
- **Consistent Layout**: SVG previews and PDF downloads share one vector paint list, page slices, margins and sidebar positioning
- **Vector Fonts**: Uses the selected bundled or downloadable font, including its available weights and Unicode subsets. Bundled faces work offline; unsupported fonts or missing glyphs show an actionable error instead of silently substituting a different face
- **Page-Break Control**: Intelligent page breaks

## Optional Supabase workspace

The app remains a static frontend. Supabase is optional; local CV versions, autosave, JSON and PDF exports retain their existing browser storage behavior. Signing in never uploads a CV automatically.

1. For a new setup, apply [`supabase/schema.sql`](supabase/schema.sql) using the [Supabase setup guide](supabase/README.md). The deployed workspace is current; future changes require targeted migrations described in that guide. Do not rerun this setup over a deployed workspace. **phd-workflow** (`ehkfzvjgesomteqpwrwa`) is the deployment target. The current schema preserves the `opportunities` catalogue and private applications. Research records remain shared and read-only for signed-in users; catalogue imports are managed outside this app.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` as shown in [`.env.example`](.env.example). Existing `NEXT_PUBLIC_SUPABASE_*` names are also accepted. Restart Vite after changing configuration. Use only a publishable key (or legacy anon key); privileged keys and insecure production URLs are rejected before they can enter the bundle.
3. Provision users in Supabase Authentication and use their existing email/password in the **Sign in** form, in the desktop topbar or mobile bottom navigation. Account registration and password recovery are managed by the project administrator. The frontend verifies sessions with Auth; the database enforces authorization through RLS. Sessions use `sessionStorage`, without changing CV localStorage, and passwords are not persisted by the app.
4. **Opportunities** defaults to **Current opportunities** and hides opportunities marked **Not interesting** or with an existing application. The deadline dropdown switches exclusively between current and past opportunities; choose **Past opportunities** to show only expired deadlines. **Sort by → Personal fit: high to low** orders recorded numeric scores within each group, with missing or invalid scores last. Flagged strong fits show their recorded score instead of a generic badge: 9.6–10 in red and 9.1–9.5 in yellow; lower scores retain the standard badge color. The particularly-suitable checkbox has been removed. On mobile, open **Filters** to use these controls. Uncheck **Hide applications** to show those opportunities again, regardless of application status. Missing or invalid deadlines stay visible; a date-only deadline includes its entire local day, and precise deadline times/timezones are respected. Change the filters to restore hidden records. Select an opportunity to open its dedicated detail view, using the same persistent header and back-button layout as an application. Back returns to the results; on mobile, both opportunity and application results appear as larger-text cards, with editing actions in the item view. Each research group can be collapsed independently. Research overview, Salary & funding, Requirements, and Application documents appear first and start open. Advisor & lab context, Links & contacts, Particularly suitable, and Metadata follow in that order and start collapsed. The first group, Research overview & fit, combines the research summary, main listing link, and personal/academic/R&D fit assessments. Recorded 0–10 scores have labeled visual bars; missing or invalid scores are never estimated. Particularly suitable and Advisor & lab context remain separate groups; Topics is part of Metadata. Salary & funding includes contract duration. Links & contacts shows each destination once, combining its source evidence and notes. Blue **New · 24h** and amber **Updated · 24h** badges mark recently added or changed opportunities; New takes priority for recently created unseen opportunities; badges and priority grouping expire automatically after 24 hours, while unread left borders remain until viewed. Opening an opportunity or changing its review dropdown clears the highlight for that source version, saved privately to your account across sessions. A later research update highlights it again. Set **Not reviewed / Interested / Not interesting** in the desktop results or the item view; opening details does not change this choice.
5. **Create application** saves immediately and captures the opportunity's requirements, documents, contacts, deadline and advisor research. Repeated clicks open the existing application. **Preparation** immediately saves independent CV/letter template copies from its two dropdowns and opens tender requirements and application-document checklists by default. The application removal action is at the bottom of Preparation. **Refinement** publishes sources for the selected document, copies connected tasks and applies valid current proposals to the working copies. CV and letter approval remain separate. **Attachments** adds browser-local supporting files, arranges the complete package and previews it before download. **Tracking** is the only place to change application status and shows each recorded transition with its timestamp, followed by the current status. Earlier unrecorded changes are explicitly unknown. Each application remembers its selected stage; the tabs remain freely accessible. Research checklists retain unchanged items across reordering and language changes. Status remains independent of document readiness. **Remove** asks for confirmation and deletes the application and cascading refinement history while retaining cloud CV snapshots; its opportunity returns to the list. Captured research stays stable when the catalogue changes. Email links open your mail client.

The CV upload boundary substitutes contact samples, removes hidden/excluded content, applies selected field masks, and replaces known applicant names, emails, phones and profile links repeated in prose. Manual wording from **CV Studio → Privacy** is applied last and can override those defaults. Only changed fields are stored in the local `anonymization.fieldOverrides` map; the replaced originals and the map are not uploaded. Local variant names, item identifiers and unsupported configuration strings are omitted or replaced. Review the privacy projection because arbitrary prose can still contain personal information. Editing or deleting a local CV does not change an existing cloud snapshot. Exclamation punctuation such as `!!text!!` is ordinary text, with no masking or special Markdown rendering.

**Refinement** works on the selected **CV** or **Motivation letter**. Each published request includes the current application CV and letter, captured opportunity, frozen template, effective language/word limit and accumulated privacy-filtered feedback. Application settings take precedence over template defaults. An empty letter is an initial-draft request.

**Sync** loads saved proposals and publishes current sources when needed. **Copy task**, or **Copy feedback** after the initial proposal, publishes the current inputs and copies a short reference for a configured ChatGPT conversation with Supabase `execute_sql`. Unchanged inputs reuse the same immutable request. Copying does not start ChatGPT. The connected protocol reads that exact request and saves a proposal through the private management functions. **History → Connection & prompt details → Copy connected setup prompt** provides its complete instructions. If the connected SQL tool is unavailable, the task stops and reports the missing capability.

A valid proposal for the current snapshot automatically updates the selected document's working copy when it loads. Validation and reconstruction finish before either document changes; baseline checks protect manual corrections from outdated proposals. Saved application receipts prevent the same proposal from applying again after a reload. Review the result, edit wording under **Edit manually**, or answer annotations before copying another task. Document approval remains a separate action.

**Annotations** keep comments, ToDos and questions outside document text and PDF exports. Save a response and mark the note resolved to include its privacy-filtered answer in the next round automatically. Updating an included answer adds its new version; reopening or ignoring it cancels the earlier answer for future rounds. Feedback retains explicit proposal/annotation references. Letter text references remain attached to the originally proposed version; changed working text shows “Referenced text has changed” instead of searching for another passage.

**Preview proposal** opens a temporary **Original / Proposed** comparison with its proposal reference in both inline and expanded views. Closing it returns to the saved working documents. History keeps request IDs, timestamps, source versions, captured public sources and proposal exports. Missing private mappings block reconstruction; an outdated proposal can only preview its exact local baseline. Original CV fields, omitted private bullets and structured letter content remain in local request snapshots and application backups. Unreadable local documents block publication until restored. Without the original local baseline, freshness is unverified; see [snapshot metadata and local availability](supabase/REFINEMENT.md#snapshot-metadata-and-local-availability).

Version-2 CV proposals can reorder existing sections within their layout area, reorder entries and bullets, omit existing bullets, and shorten authorized prose by removing existing words. Every change shows its target, operation, explanation and before/after comparison. Ambiguous Markdown remains available for review comments. Retired version-1 rounds and manually imported proposal history are no longer supported; current working documents and version-2 reconstruction snapshots are retained.

Approve the CV and letter independently. Later rounds target the unapproved document; reopen an approved document before requesting changes to it. After approving the final CV, **Save as new variant** creates an independent reusable library copy. The complete-letter word counter warns when the chosen target is exceeded, without blocking approval or export. PDF packages use saved working documents and require both approvals. Supporting PDFs/images stay local and are not available through MCP. See [the refinement protocol, privacy boundary and setup](supabase/REFINEMENT.md).

The separate letter-drafting and CV-adjustment APIs are retired. The application uses version-2 connected refinement; its management functions use the existing MCP connection without impersonating an app user.

For GitHub Pages, configure **environment variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under **Settings → Environments → phd-workflow → Environment variables**. The workflow's build job uses the `phd-workflow` GitHub environment and embeds those values into the static frontend; the final publishing job uses the `github-pages` environment. Set the URL to `https://ehkfzvjgesomteqpwrwa.supabase.co` and use that project’s publishable key. The deployed Supabase project is determined by these variables, independently of local `.env.local` configuration. Omitting both produces a standalone local builder. These are public build-time configuration values, never a service-role or secret key. A public Supabase key is safe only together with the provided grants and RLS policies. See [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

Run `npm test` and `npm run build` with Node 22+ for client checks. The SQL suites in [`supabase/tests`](supabase/tests) exercise access control, privacy, authoritative capture, immutable history and deletion behavior inside transactions that roll back their fixtures. The dev-only [browser fixture](test/browser/job-workspace.html) uses in-memory data without an account or cloud writes and provides a 400-word PhD scenario and synthetic proposals.

The [synthetic refinement test guide](test/REFINEMENT_TESTING.md) maps the regression coverage and explains which boundaries are mocked. Run `npm run test:refinement` for focused regressions, or `npm run test:e2e:serve` and open `http://127.0.0.1:5177/cv-builder/test/e2e/index.html` to run five automated browser flows with the actual CV/letter preview and PDF renderers. This separate test server ignores production environment files and uses only synthetic in-memory requests, proposals and documents.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

App runs at `http://localhost:5173/cv-builder/`

---

## 🎯 Usage

### Choose a workspace

| Workspace | What to do there |
| --- | --- |
| **Opportunities** | Search/filter the Supabase catalogue, review research, mark interest and create or open an application. |
| **CV Studio** | Use **Variants**, **Content**, **Design**, **Privacy** and **Letter templates** to maintain reusable career-path documents. Select a variant beneath the desktop Supabase account controls. On mobile, use **Variants** to switch documents; the icon-labeled Studio tabs and **Open preview** sit in a horizontally scrollable row just above the bottom navigation. |
| **Applications** | Move freely among **Preparation**, **Refinement**, **Attachments** and **Tracking**. |

In **Preparation**, choose a career variant as the CV template and choose a letter template. Both become independent application copies. The full CV stays local while a privacy-filtered snapshot is saved to Supabase; the letter template's revision and optional example are pinned. Library changes do not alter these copies, and refinements stay with their application until an approved CV is explicitly saved as a new variant. Earlier application edits and restored data remain intact. Application working documents and private reconstruction data stay in this browser; cloud snapshots cannot recover them on another device. Supporting files/packages have a separate local backup.

The selected opportunity or application keeps its title visible while its content scrolls. On desktop, application stages stay in the sidebar; on phones, they sit above the bottom navigation. The application header shows its deadline. **Refinement** combines proposal summaries, annotation responses and direct CV/letter editing with a matching document preview. **Attachments** previews the complete application PDF. **Tracking** contains the status form and transition history. The opportunity lists retain grouped research, mobile cards and explicit removal confirmation.

Application codes are permanent server values and stay unchanged when a title or document changes. **Copy task** and **Copy feedback** use the selected refinement scope, for example `phd-workflow: APP-7K4M9Q — refine CV.` The example format is illustrative; the browser copies the actual server value or the complete UUID. The publish-and-copy flow ensures a matching current round exists before copying. It does not start ChatGPT. The task identifies the project, exact published request, schema version and scope. Empty letter sources request a first draft; existing letters request refinement of the complete published text. The connected setup prompt requires the task to stop if its request is no longer current.

If the connected Supabase toolset does not expose `execute_sql`, the task stops and reports the missing capability; `query_logs` only queries logs. The webapp cannot inspect or change another ChatGPT session's tool list. A security rejection after invoking a tool is a separate problem: preserve the exact failed tool-call error without changing database roles, RLS or grants based only on that message. An empty source letter is valid for initial-draft generation.

On desktop and mobile, **New & updated · 24h** contains only unseen additions or updates from the last 24 hours, including recently updated opportunities viewed before that change. Everything else shares the main list under **Other opportunities**; that heading is omitted when there are no recent entries. Older unread opportunities keep their blue or amber left border without a 24-hour badge or separate unread group. Opening an item immediately clears its unread marker and moves it out of the recent group. Filters and sorting apply within both groups.

Choose **Strong interest** under **Your review** for opportunities you want ChatGPT to use as evidence for future searches. This explicit preference is saved in Supabase independently of personal-fit scores and application status. Analyse these opportunities and develop new searches in ChatGPT with Supabase access, including expired tenders, lower-scoring results and entries from different original searches. The app provides the review option and filter; it does not prepare or start searches. Changing the review state removes that opportunity from the strong-interest selection.

Use **Personal Evaluation** in an opportunity's detail view to explain your interest or add other context. Evaluations are optional, save automatically, remain private to your account, and are retained when you change the review state or create an application. Clear the field to remove the evaluation. Save feedback appears only in toasts; failed saves keep your draft with a **Retry** action in the toast.

In **CV Studio → Letter templates**, edit four collapsible groups with icons: **Main text** (structure and research interests), **Tone** (writing guidance and example letter), **Feedback loop** (questions and refinement instructions), and **Formalities** (language, target words, subject, salutation, closing and base formatting). Only Main text opens by default. Edits save automatically on this device. Template selection remains beside the scrollable form (above it on narrow screens). This tab uses the full editor width without a CV preview. In **Privacy**, the inline preview, expanded preview and its download use the privacy-filtered CV; other CV tabs show the normal document.

**Main research interests** supplies your own research direction, including interests beyond your CV. Drafting connects relevant interests to the opportunity without forcing every topic into the letter or treating aspirations as proven experience.

**Questions and context to ask for** describes when a useful follow-up question should be raised. Both fields are optional, accept up to 4,000 characters, and appear in the outgoing privacy preview. The question field defaults to asking about relevant work, coursework or projects when an advertised required or beneficial qualification has no CV evidence; an honest learning interest may be useful if there is no experience. Existing custom or intentionally cleared guidance is retained.

The optional **Refinement system prompt** directs later iterations. Its default asks the writer to include resolved answers only when they support the letter’s central narrative and add value, omit irrelevant or unhelpful answers, and ask a focused follow-up when an answer is too vague to evaluate.

**Formalities → Base letter formatting** sets page margins, body size, header name size and line spacing. General defaults are 20 mm, 11 pt, 16 pt and 1.2. Each application keeps the formatting from its frozen template; **Refinement → Edit manually → Letter formatting** can override these values or reset to the frozen template defaults. Formatting affects the preview and PDF, remains local and does not enter shared writing instructions. Changing it requires a fresh layout approval without changing the letter text.

An optional example letter (up to 20,000 characters) guides wording and style; its claims never establish applicant qualifications. Select the template and set the language and target words in **Preparation**, then use **Refinement** for application instructions, generation, manual edits and approval. Edit the **Complete letter text**, including its subject, greeting and sign-off; a subject starting with `# ` renders as a heading. The letter uses the application CV's design. Later template-library edits do not change the pinned application template. To use a revised template in an existing application, select the updated template in **Preparation**, then publish a new round. The working letter is retained.

In **CV Studio → Local attachments**, choose a PDF or PNG/JPEG file and enter its **Attachment name** and **Description**, for example “Transcript of records” or “Letter of recommendation.” Both text fields are required and remain blank when choosing a file; the app does not infer them from its filename or contents. Saving while signed in syncs only these manually entered fields and the technical attachment/owner IDs to your private Supabase library. File bytes, filenames, sizes and file types stay in browser storage. Signed-out entries remain in the separate device library. Existing files and imported backups are retained without automatically publishing their old names; edit and save both fields explicitly to share their metadata.

In application **Attachments**, select existing attachments from that library. Each selection shows its description; removing it from a package leaves the reusable file intact. Metadata from another device can appear without a local file: use **Edit** on the library entry to add the file under that same attachment ID, or restore a file backup. Such entries cannot be newly selected or exported until their file is available. Application selections remain local package settings.

In **Attachments**, arrange and include/exclude package items and review the checklist. After CV and letter approval, the complete PDF preview updates automatically; use **Open preview** to expand it and **Download PDF** to save it. Unavailable included files block export. Office files need conversion to PDF before attachment. Submit through the institution's portal or email, then update **Tracking** manually.

### Basics
- Fill sections with `+` button, remove with `×`
- Eye icon (👁️) shows/hides sections
- Turn on Reorder at the top right of Content to drag the Body/Sidebar section cards directly (or use arrow keys on a handle); turning it off restores expanded editors
- Use **Copy section from variant** to reuse content from another career variant. Editing and previewing continue to target the same selected document.
- Use item handles to drag entries and sidebar skills directly
- CV edits save automatically without a visible save label. Letter-template revisions use **Save template revision**
- On mobile, use the bottom navigation for the three main workspaces and Supabase sign-in. CV Studio subtabs have icons and scroll horizontally alongside **Open preview** directly above it; use **Variants** to switch documents. Preview fits the PDF page to the screen; swipe left or right with one finger, or use the page arrows.
- Mobile Content tools sit at the editor header. Form inputs use 16px text to avoid iPhone Safari's automatic focus zoom without disabling pinch zoom. In Preview, switch between Normal and Privacy view; Download PDF exports the selected view.

### Customize Design

CV design defaults live in `src/defaults.ts`. New documents, the bundled sample,
editor controls, and preview/PDF rendering all use these values; saved settings
override them. Add UI translations to `src/i18n/dict.ts` for both supported
languages. Translation lookup uses only the current language, with no cross-language fallback.

- Design panel (palette icon) for layout, colors, fonts
- Sidebar position (left/right) selectable
- Heading styles: clean, underline, leftbar, pill
- Font color, opacity and typography individually adjustable

### Sidebar Categories
- Sidebar-only custom sections use a normal section header and optional skill levels
- Without a level type, skills render as badges

### Soft Skills
- Label, description + references to jobs
- Link with work experience

### Backup & Export
- **CV Studio → Variants** manages named career CVs and revision history. Split content/config JSON backups follow the existing privacy controls; enable **Bypass privacy proxy** when a complete private CV backup is intended.
- Application CVs, letters, frozen templates and private refinement reconstruction data remain in browser storage. **History** exports public requests and proposals; those exports do not contain the private originals needed to reconstruct working documents.
- **CV Studio → Letter templates** exports/imports the reusable template library, including examples.
- **CV Studio → Local attachments → Back up files & packages** preserves local attachments (including manual descriptions), package arrangements and previously archived PDFs. Keep this backup alongside your CV and template backups.
- Supporting files use IndexedDB and are never uploaded; only their manually saved names and descriptions sync to Supabase for signed-in users. CV and letter editing data use LocalStorage. Files do not synchronize across devices; keep downloaded backups before clearing browser data.
- **PDF Export** downloads the current CV or finalized letter. **Attachments → Download PDF** saves a complete application PDF, independent of later edits.

## 🛠 Tech Stack

- **Vue 3.5** + **Vite 7.2**: Framework & build tool
- **html2canvas layout adapter**: Cooperative DOM/CSS parsing and vector paint recording; no page canvas is allocated or raster-painted
- **PDFKit + Fontkit**: Lazy-loaded browser-only vector PDF export; no server or print dialog required, compatible with GitHub Pages
- **pdf-lib**: Browser-side composition of CV, letter and supporting PDF/image pages
- **FontAwesome 7**: Icon system
- **VueDraggable**: Handle-based section and item sorting
- **Local assets / Bunny Fonts / Google Fonts**: Common built-in fonts load from `public/fonts`; custom and unbundled fonts remain source-aware dynamic imports
- **LocalStorage + IndexedDB**: CV/letter editing state, reusable local files, application package arrangements and frozen PDF archives
- **Supabase**: Optional authenticated opportunities, application tracking, immutable refinement requests/proposals and owner feedback/reviews

---

## 👨‍💻 Development

### Scripts

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Test build
npm test             # Content, PDF geometry, rendering and storage tests
npm run test:refinement # Focused refinement and privacy regression tests
npm run test:e2e:serve  # Serve the synthetic browser test runner (see test guide)
```

### Extend Project

**New Section**: Extend shared CV contracts/validation → adjust FormBuilder + preview rendering → translations in `dict.ts`

**Design Option**: State → DesignPanel input → CSS variable in `applyCvDesign()` → use CSS

**Sidebar Skill Display**: Template in `SkillItem.vue` + level configuration in `FormBuilder.vue`

**Workspace boundaries**: `App.vue` owns tab navigation and the CV Studio document. `JobWorkspace.vue` handles opportunity/application selection; `ApplicationWorkspace.vue` owns the selected application's independent CV, letter and package. `applicationCv.ts`, `motivationLetters.ts`, `localDocuments.ts` and `applicationRefinement.ts` keep document/persistence concerns separate from presentation.

### Debugging

- **Vue DevTools**: Browser extension for component tree and state
- **Saved data**: inspect `localStorage.getItem('cv-session')` in the browser console

### Preview scheduling

Preview renders are cancelable: a newer content change aborts the previous job,
retaining the last complete vector preview until the replacement is ready. The DOM-based
renderer cannot run in a Web Worker, so `pdfRenderTask.ts` schedules short,
background-priority batches with a timer fallback. Inline and full-screen views
reuse the same SVG pages; opening a larger view does not render again.

`build/responsivePdfRenderer.ts` adds checkpoints to html2canvas's DOM clone,
parser and painter. Its bitmap surface is replaced with a vector command recorder;
a 1×1 native context is used only for font measurement and CSS state normalization.
Page-break spacing lives in `pdfPageBreaks.ts`. The layout dependency is pinned;
when upgrading it, review the guarded
adapter and run `npm test` and `npm run build`. Check rapid section lock/unlock
during rendering in the browser as well (development and production builds).

---

## 🚀 Deployment

### GitHub Pages (Configured ✅)

This project is configured for automatic deployment to GitHub Pages:

1. **Push to `main` branch** → Automatic build & deploy via GitHub Actions
2. **Configure GitHub Settings**: Go to Settings → Pages → Source: "GitHub Actions"
3. **Access**: `https://tjewh.github.io/cv-builder/`

### Manual Deployment

Create build: `npm run build` → `/dist` folder

**Other Static Hosting** (Netlify, Vercel, Cloudflare Pages):
- Build Command: `npm run build`
- Output: `dist`

**Custom Domain Deployment**: This build targets the GitHub Pages project URL at `/cv-builder/`. If you later use a custom domain served from its root, change `base` in `vite.config.ts` to `/` and add the domain configuration appropriate to that host.

---

## 📝 Notes

- **Browser**: Chrome/Edge/Firefox/Safari (latest versions)
- **Privacy**: Full CVs, private letter originals and supporting documents remain local. Explicit refinement publication sends anonymized current CV/letter content, frozen guidance and accumulated feedback to Supabase, alongside application tracking
- **Performance**: PDF export may be slow for very large CVs

---

**Good luck! 🎉**

### Type checking

Application code, Vue scripts, build adapters and tests use TypeScript with
strict checking, including unused imports and parameters. Run `npm run typecheck`
to check them without emitting files.
`npm run build` performs the same check before producing the Vite bundle.
Run `npm test` for the TypeScript regression suite via tsx.

Shared CV contracts are in `src/types.ts`; PDF recording, rendering and page
contracts are in `src/pdfTypes.ts`. Imported JSON, browser saves and bundled defaults
are validated against the current schema before use. Portable files use strict,
separate content/configuration schemas; older combined exports, mixed payloads,
unknown fields and raw state imports are rejected. Internal browser storage retains
the complete current state. Optional editor fields still receive defaults. Component events declare their payloads, and form schemas restrict
controls to compatible field types. The reflective Canvas command boundary and PDFKit 0.20 adapter are
explicitly isolated because the third-party APIs are dynamic or have older
type declarations.
