# CV Builder – Vue.js

Application preparation workspace built with Vue 3, TypeScript and Vite. Discover opportunities, maintain career-path CV variants and tailored subvariants, finalize motivation letters and assemble complete PDF packages. Navigation uses local tab state without a router or application server, so the app remains compatible with GitHub Pages.

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
- **Optional Supabase login**: Existing accounts can filter and review shared opportunities, mark interest privately, create applications and publish anonymized drafting contexts. CV Studio works without an account
- **Variants and subvariants**: Applications select a reusable career variant directly. Create a subvariant for tailored wording or design and edit it in CV Studio. Subvariants have exactly one parent level; copying one creates a sibling
- **ChatGPT CV tailoring**: Prepare a privacy snapshot, publish it to Supabase or copy the prompt, then review returned wording before accepting it as a subvariant. Private values and layout are reconstructed locally; unchanged responses keep the original variant
- **Motivation letters**: Reusable templates with separate subject, salutation and closing instructions; edit the complete letter in one field with CV-matched styling. Local working and finalized revisions, imported/generated draft history and context-change notices preserve existing edits
- **Supporting documents**: Reusable browser-local PDF/PNG/JPEG library, ordered package composition, missing-file checks and frozen PDF archives
- **Live Preview**: Application CV, motivation-letter and document-package tabs keep input forms on the left and an inline preview on the right, with a full-size preview dialog. On mobile, an **Open preview** button opens the preview without squeezing the editor
- **Auto-Save**: CV edits save automatically; save updates are announced to assistive technology without a visible status label beside the career-variant dropdown
- **Backup System**:
  - Browser-local CVs, letter templates and edits in LocalStorage; supporting files and package archives in IndexedDB
  - Named career variants selected in the CV Studio subtab row, beneath the Supabase account column; the editor and preview always follow the same selected document. The builder and preview wrap automatically on narrower screens
  - Separate content and configuration JSON files (CV data version 7). Content imports replace editable CV text and entries while preserving settings; configuration imports replace settings while preserving CV content
  - Content export/import respects privacy by default: anonymize header/contact, omit hidden/private sections and entries on export, and preserve their local values on import. Enable **Bypass privacy proxy** for complete content export/replacement. Inline redaction placeholders are imported literally; secret words are never restored automatically
  - Only the split formats are supported; old combined exports and raw state JSON are rejected. See [JSON formats and editing workflow](docs/json-format.md)
  - JSON filenames use the selected version title plus `-content` or `-config`; unsaved drafts use `cv-backup`
  - Deleting a configuration removes its stored document and the session recovery copy, clears the active editor/preview, and opens the empty document. A parent with subvariants cannot be deleted until those subvariants are removed. Other saved configurations remain available. Open tabs discard deleted versions instead of autosaving them again
- **Safe Links**: Contact websites and Markdown links require explicit HTTP(S) URLs. Invalid links remain plain text; email links reject injected headers or extra recipients. PDF and SVG link annotations use the same URL checks
- **Multilingual**: German/English (UI + content)
- **Drag & Drop**: Reorder sections and entries

### Export
- **PDF Export**: Direct-download vector PDF with visible selectable text, clickable links and vector SVG icons
- **Complete application PDFs**: Include/exclude and reorder the tailored CV, finalized letter and supporting documents; preview the assembled package, then download and archive a fixed local copy
- **Vector Previews**: Inline and full-size previews reuse the same scalable SVG pages; no raster images, quality settings, size estimates, or higher-resolution replacement render
- **Consistent Layout**: SVG previews and PDF downloads share one vector paint list, page slices, margins and sidebar positioning
- **Vector Fonts**: Uses the selected bundled or downloadable font, including its available weights and Unicode subsets. Bundled faces work offline; unsupported fonts or missing glyphs show an actionable error instead of silently substituting a different face
- **Page-Break Control**: Intelligent page breaks

## Optional Supabase workspace

The app remains a static frontend. Supabase is optional; local CV versions, autosave, JSON and PDF exports retain their existing browser storage behavior. Signing in never uploads a CV automatically.

1. For a new setup, apply [`supabase/schema.sql`](supabase/schema.sql) once using the Supabase SQL editor or a migration. It preserves an existing `opportunities` catalogue and creates private review, application, CV-snapshot, drafting and CV-adjustment tables with ownership policies and RPCs. The complete schema, including `add_application_letter_drafting` and `add_private_cv_adjustments`, is already applied to **phd-workflow** (`ehkfzvjgesomteqpwrwa`) as of 2026-09-21; do not rerun setup there. The earlier Test project is no longer the deployment target. Research records remain shared and read-only for signed-in users; catalogue imports are managed outside this app. See [database setup and migration history](supabase/README.md).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` as shown in [`.env.example`](.env.example). Existing `NEXT_PUBLIC_SUPABASE_*` names are also accepted. Restart Vite after changing configuration. Use only a publishable key (or legacy anon key); privileged keys and insecure production URLs are rejected before they can enter the bundle.
3. Provision users in Supabase Authentication and use their existing email/password in the **Sign in** form, in the desktop topbar or mobile bottom navigation. Account registration and password recovery are managed by the project administrator. The frontend verifies sessions with Auth; the database enforces authorization through RLS. Sessions use `sessionStorage`, without changing CV localStorage, and passwords are not persisted by the app.
4. **Opportunities** hides past deadlines, opportunities marked **Not interesting**, and opportunities with an existing application by default. Uncheck **Hide opportunities with applications** to show those opportunities again, regardless of application status. Missing or invalid deadlines stay visible; a date-only deadline includes its entire local day, and precise deadline times/timezones are respected. Change the filters to restore hidden records. Select an opportunity to open its dedicated detail view, using the same persistent header and back-button layout as an application. Back returns to the results; on mobile, both opportunity and application results appear as larger-text cards, with editing actions in the item view. Each research group can be collapsed independently. Research overview, Salary & funding, Requirements, and Application documents appear first and start open. Advisor & lab context, Links & contacts, Particularly suitable, and Metadata follow in that order and start collapsed. The first group, Research overview & fit, combines the research summary, main listing link, and personal/academic/R&D fit assessments. Recorded 0–10 scores have labeled visual bars; missing or invalid scores are never estimated. Particularly suitable and Advisor & lab context remain separate groups; Topics is part of Metadata. Salary & funding includes contract duration. Links & contacts shows each destination once, combining its source evidence and notes. Blue **New · 24h** and amber **Updated · 24h** badges mark recently added or changed opportunities; New takes priority for unseen opportunities and highlights expire automatically after 24 hours. Opening an opportunity or changing its review dropdown clears the highlight for that source version, saved privately to your account across sessions. A later research update highlights it again. Set **Not reviewed / Interested / Not interesting** in the desktop results or the item view; opening details does not change this choice.
5. **Create application** saves immediately, without an email form or CV selection. The database captures the opportunity's requirements, documents, researched contacts, deadline and advisor research. Repeated clicks open the existing application. In **Applications**, select an application to open **Overview**, **CV**, **Motivation letter** and **Documents & export**. Status remains independent of document readiness. Overview retains notes, contact/submission dates and requirement/document checklists; unchanged checklist items keep their progress across research refreshes, reordering and language changes. In **CV**, select an existing career variant or subvariant, then review its privacy projection before publishing an immutable cloud snapshot. Create a subvariant and open CV Studio when application-specific edits are needed. **Remove** asks for confirmation and deletes the cloud application and cascading draft contexts/history while retaining cloud CV snapshots. Its opportunity returns to the list. Applications can exist without a CV until you are ready.
6. **Refresh research** explicitly replaces the saved opportunity context with the current catalogue record, preserving your CV and progress. Research is otherwise stable when the catalogue changes. **Prepare evaluation context** loads the saved application and its exact assigned privacy CV, then lets you copy or download a Markdown brief for ChatGPT. It includes advisor research and papers, requirements, documents, contacts, deadlines, notes, source links, capture time and the selected privacy CV. Missing research/CV inputs are identified explicitly. The brief supports a fit evaluation and later one-page motivation-letter drafting; it does not call ChatGPT or send emails. Email links open your mail client.

The CV upload boundary substitutes contact samples, removes hidden/excluded content, redacts `!!confidential text!!` and replaces known applicant names, emails, phones and profile links repeated in prose. Roles and cities remain career evidence. Local variant names, item identifiers and unsupported configuration strings are omitted or replaced. Review the privacy projection because arbitrary unmarked prose can still contain personal information. Editing or deleting a local CV does not change an existing cloud snapshot.

**Motivation letter → Publish context to Supabase** freezes the assigned anonymized application CV, captured opportunity research, template, theme, language and drafting guidance. Drafting contexts use explicit applicant placeholders and omit private application notes. Returned drafts are appended to history and opened explicitly; manual/final text stays local. This is separate from the broader evaluation brief described above, which includes application notes.

Publishing a context does not invoke ChatGPT. An existing developer Supabase connection can retrieve the selected context through an explicitly requested read-only operation, but normally has no app-user JWT and cannot invoke the owner-authenticated draft-write RPC. Use an authenticated connector/Action for returned cloud drafts, or copy/download context and import the returned text locally. See [drafting integration and authentication](supabase/DRAFTING.md).

**Application → CV → Tailor with ChatGPT** prepares editable anonymized text fields for the selected variant. Review the snapshot, then publish it to Supabase or copy/download the prompt. A configured authenticated integration can return a response through Supabase; manual JSON paste/import also works. Accepting reviewed changes creates a subvariant, while an unchanged response keeps the selected variant. Private reconstruction data stays on this device, and responses for an outdated CV are rejected. See [CV adjustment workflow and integration](supabase/CV_ADJUSTMENTS.md).

For GitHub Pages, configure **environment variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under **Settings → Environments → phd-workflow → Environment variables**. The workflow's build job uses the `phd-workflow` GitHub environment and embeds those values into the static frontend; the final publishing job uses the `github-pages` environment. Set the URL to `https://ehkfzvjgesomteqpwrwa.supabase.co` and use that project’s publishable key. The deployed Supabase project is determined by these variables, independently of local `.env.local` configuration. Omitting both produces a standalone local builder. These are public build-time configuration values, never a service-role or secret key. A public Supabase key is safe only together with the provided grants and RLS policies. See [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

Run `npm test` and `npm run build` with Node 22+ for client checks. The SQL suites in [`supabase/tests`](supabase/tests), including [`application_letter_drafting.sql`](supabase/tests/application_letter_drafting.sql) and [`cv_adjustments.sql`](supabase/tests/cv_adjustments.sql), exercise access control, tenant isolation, privacy, authoritative capture, immutable history and deletion behavior inside transactions that roll back their fixtures. The drafting suite passed on **phd-workflow** on 2026-09-20; the CV-adjustment suite passed on 2026-09-21. The dev-only [browser fixture](test/browser/job-workspace.html) uses in-memory data without an account or cloud writes.

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
| **CV Studio** | Use **Variants**, **Content**, **Design**, **Privacy** and **Letter templates** to maintain reusable career-path documents. Select a career variant and, optionally, a subvariant in adjacent dropdowns beneath the desktop Supabase account controls. On mobile, use **Variants** to switch documents; the icon-labeled Studio tabs and **Open preview** sit in a horizontally scrollable row just above the bottom navigation. |
| **Applications** | Select an application and move freely among **Overview**, **CV**, **Motivation letter** and **Documents & export**. |

Applications use their selected local variant directly and follow changes made to it in CV Studio. The application CV tab contains selection, preview, privacy publishing and tailoring actions. **Create subvariant & edit** preserves the original and opens the tailored document in CV Studio. Copies of subvariants remain siblings, so there are no subsubvariants. Older independent application edits remain intact until explicitly saved as a subvariant. Restored backups stay pinned until you select or create a variant; a cloud privacy snapshot cannot recover private CV information on another device.

The selected opportunity or application keeps its title visible while its content scrolls. Application subtabs also remain visible. **Overview** provides the research and tracking form; **CV**, **Motivation letter** and **Documents & export** share a split layout with independently scrolling input forms on the left and a fixed preview area on the right. CV Studio, application CVs and motivation letters share the same paginated inline and full-size preview components, including mobile page fitting and pinch/swipe gestures. Only the combined document package uses the browser PDF viewer. On mobile, use **Open preview** while keeping the forms at full width. Search occupies a compact row above the bottom navigation. List cards show readable summaries. Compact mobile item headers have a bottom divider; opportunity country, deadline and fit share one metadata row. Opportunity review and Apply actions sit alongside Back above the bottom navigation. Application tabs sit between the bottom navigation and the Back/status row. Remove is a separate action below the application metadata, with confirmation, and is absent from result rows. Scrollable item content has a small side inset and separators between collapsible groups.

On desktop and mobile, **New opportunities** groups results that have no saved visit receipt above **Previously viewed** results. Opening an item moves it into the lower group immediately; existing filters and sorting still apply within each group. This grouping does not expire with the separate 24-hour highlight badges.

In **CV Studio → Letter templates**, the library and editor scroll within the available viewport. Describe subject formatting, salutation and closing in their separate instruction fields. Salutation guidance can tell the drafter how to use a named contact from the tender and what to do when none is available; subject guidance can specify the position title and tender reference. Choose the template in an application and prepare anonymized context, then import a draft or refresh drafts returned by a configured integration. Edit the **Complete letter text** field, including the generated subject, greeting and sign-off, and finalize locally. Start a subject line with `# ` to style it as a heading. The letter uses the application CV's design. Changes to content or styling request review without overwriting existing wording.

In **Documents & export**, add PDFs or PNG/JPEG images, reuse files from the local library and arrange the package. Excluded items are omitted intentionally; unavailable included files block export. Preview the complete PDF before **Download & archive**. Office files need conversion to PDF before attachment.

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
- **Application → CV → Back up full application CV** preserves the full tailored copy and its base revision. Restore it in the same application's CV tab.
- **Motivation letter** has a separate local letter backup, including edits and revision history. **Letter templates** can export/import the reusable template library.
- **Documents & export → Back up files & packages** includes local attachments, package arrangements and archived PDFs. Editable CVs and letters have separate backups.
- Supporting files use IndexedDB and are never uploaded. CV and letter editing data use LocalStorage. These files do not synchronize across devices; keep downloaded backups before clearing browser data.
- **PDF Export** downloads the current CV or finalized letter. **Download & archive** preserves a complete application PDF locally, independent of later edits.

## 🛠 Tech Stack

- **Vue 3.5** + **Vite 7.2**: Framework & build tool
- **html2canvas layout adapter**: Cooperative DOM/CSS parsing and vector paint recording; no page canvas is allocated or raster-painted
- **PDFKit + Fontkit**: Lazy-loaded browser-only vector PDF export; no server or print dialog required, compatible with GitHub Pages
- **pdf-lib**: Browser-side composition of CV, letter and supporting PDF/image pages
- **FontAwesome 7**: Icon system
- **VueDraggable**: Handle-based section and item sorting
- **Local assets / Bunny Fonts / Google Fonts**: Common built-in fonts load from `public/fonts`; custom and unbundled fonts remain source-aware dynamic imports
- **LocalStorage + IndexedDB**: CV/letter editing state, reusable local files, application package arrangements and frozen PDF archives
- **Supabase**: Optional authenticated opportunities, application tracking and immutable anonymized drafting contexts

---

## 👨‍💻 Development

### Scripts

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Test build
npm test             # Content, PDF geometry, rendering and storage tests
```

### Extend Project

**New Section**: Extend shared CV contracts/validation → adjust FormBuilder + preview rendering → translations in `dict.ts`

**Design Option**: State → DesignPanel input → CSS variable in `applyCvDesign()` → use CSS

**Sidebar Skill Display**: Template in `SkillItem.vue` + level configuration in `FormBuilder.vue`

**Workspace boundaries**: `App.vue` owns tab navigation and the CV Studio document. `JobWorkspace.vue` handles opportunity/application selection; `ApplicationWorkspace.vue` owns the selected application's independent CV, letter and package. `applicationCv.ts`, `motivationLetters.ts`, `localDocuments.ts` and `cloudDrafting.ts` keep document/persistence concerns separate from presentation.

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
- **Privacy**: Full CVs, edited/final letters and supporting documents remain local. Optional Supabase stores application tracking and explicitly published anonymized CV/drafting material
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
