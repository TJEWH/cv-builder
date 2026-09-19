# CV Builder – Vue.js

Modern resume generator built with Vue 3, TypeScript and Vite. Create professional CVs with real-time preview and PDF export.

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
- **Optional Supabase login**: Existing accounts can filter and review a shared opportunities table, privately mark interest, create applications in one click, assign privacy CV snapshots later, and export combined research context for ChatGPT. The local builder works without Supabase
- **Live Preview**: Inline live preview with a full-size in-app preview mode
- **Auto-Save**: Automatic saving with status indicator
- **Backup System**:
  - Browser-local persistence (LocalStorage)
  - Multiple named configurations, loaded automatically when selected
  - Separate content and configuration JSON files (CV data version 7). Content imports replace editable CV text and entries while preserving settings; configuration imports replace settings while preserving CV content
  - Content export/import respects privacy by default: anonymize header/contact, omit hidden/private sections and entries on export, and preserve their local values on import. Enable **Bypass privacy proxy** for complete content export/replacement. Inline redaction placeholders are imported literally; secret words are never restored automatically
  - Only the split formats are supported; old combined exports and raw state JSON are rejected. See [JSON formats and editing workflow](docs/json-format.md)
  - JSON filenames use the selected version title plus `-content` or `-config`; unsaved drafts use `cv-backup`
  - Deleting a configuration removes its stored document and the session recovery copy, clears the active editor/preview, and opens the empty document. Other saved configurations remain available. Open tabs discard deleted versions instead of autosaving them again
- **Safe Links**: Contact websites and Markdown links require explicit HTTP(S) URLs. Invalid links remain plain text; email links reject injected headers or extra recipients. PDF and SVG link annotations use the same URL checks
- **Multilingual**: German/English (UI + content)
- **Drag & Drop**: Reorder sections and entries

### Export
- **PDF Export**: Direct-download vector PDF with visible selectable text, clickable links and vector SVG icons
- **Vector Previews**: Inline and full-size previews reuse the same scalable SVG pages; no raster images, quality settings, size estimates, or higher-resolution replacement render
- **Consistent Layout**: SVG previews and PDF downloads share one vector paint list, page slices, margins and sidebar positioning
- **Vector Fonts**: Uses the selected bundled or downloadable font, including its available weights and Unicode subsets. Bundled faces work offline; unsupported fonts or missing glyphs show an actionable error instead of silently substituting a different face
- **Page-Break Control**: Intelligent page breaks

## Optional Supabase workspace

The app remains a static frontend. Supabase is optional; local CV versions, autosave, JSON and PDF exports retain their existing browser storage behavior. Signing in never uploads a CV automatically.

1. For a new setup, apply [`supabase/schema.sql`](supabase/schema.sql) once using the Supabase SQL editor or a migration. It preserves an existing `opportunities` catalogue and creates private `opportunity_reviews`, `cv_variants`, `applications` and `drafts` tables, ownership policies and application RPCs. The complete schema is already applied to the deployment project **phd-workflow** (`ehkfzvjgesomteqpwrwa`); do not rerun the setup there. The earlier Test project is no longer the deployment target. Research records remain shared and read-only for signed-in users; catalogue imports are managed outside this app. See [database setup and migration history](supabase/README.md).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` as shown in [`.env.example`](.env.example). Existing `NEXT_PUBLIC_SUPABASE_*` names are also accepted. Restart Vite after changing configuration. Use only a publishable key (or legacy anon key); privileged keys and insecure production URLs are rejected before they can enter the bundle.
3. Provision users in Supabase Authentication and use their existing email/password in the topbar **Sign in** form. Account registration and password recovery are managed by the project administrator. The frontend verifies sessions with Auth; the database enforces authorization through RLS. Sessions use `sessionStorage`, without changing CV localStorage, and passwords are not persisted by the app.
4. **Opportunities** hides past deadlines and opportunities marked **Not interesting** by default. Missing or invalid deadlines stay visible; a date-only deadline includes its entire local day, and precise deadline times/timezones are respected. Change the filters to restore hidden records. **Review** expands the row into Links & contacts, Research context, Salary & funding, Topics, Requirements, Application documents and Metadata. Your **Not reviewed / Interested / Not interesting** state is private to your account.
5. **Create application** saves immediately, without an email form or CV selection. The database captures the opportunity's requirements, documents, researched contacts, deadline, `supervisor_research_focus`, `supervisor_top_papers` and other context. Repeated clicks open the existing application. In **Applications**, expand the row to edit status, notes and contact/submission dates. Save a named CV under **Versions**, select it in the application, review its privacy projection and save to assign an immutable snapshot. Applications can exist without a CV until you are ready.
6. **Refresh research** explicitly replaces the saved opportunity context with the current catalogue record, preserving your CV and progress. Research is otherwise stable when the catalogue changes. **Prepare evaluation context** loads the saved application and its exact assigned privacy CV, then lets you copy or download a Markdown brief for ChatGPT. It includes advisor research and papers, requirements, documents, contacts, deadlines, notes, source links, capture time and the selected privacy CV. Missing research/CV inputs are identified explicitly. The brief supports a fit evaluation and later one-page motivation-letter drafting; it does not call ChatGPT or send emails. Email links open your mail client.

The upload boundary reuses the existing privacy rules: contact information becomes sample data; hidden/excluded sections and items are removed; `!!confidential text!!` is redacted. Local version names, item identifiers and unsupported configuration strings are omitted or replaced. Unmarked CV text remains included, so review the privacy settings before uploading. Notes and researched employer contacts are stored in your private application context. Deleting or editing a local CV does not change an existing cloud snapshot. Context exports read the assigned cloud snapshot, never the current private editor state. The `drafts` table is available for future integrations; this UI does not generate or edit motivation letters yet.

For GitHub Pages, configure **environment variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under **Settings → Environments → phd-workflow → Environment variables**. The workflow's build job uses the `phd-workflow` GitHub environment and embeds those values into the static frontend; the final publishing job uses the `github-pages` environment. Set the URL to `https://ehkfzvjgesomteqpwrwa.supabase.co` and use that project’s publishable key. The deployed Supabase project is determined by these variables, independently of local `.env.local` configuration. Omitting both produces a standalone local builder. These are public build-time configuration values, never a service-role or secret key. A public Supabase key is safe only together with the provided grants and RLS policies. See [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

Run `npm test` and `npm run build` with Node 22+ for client checks. [`supabase/tests/workspace_security.sql`](supabase/tests/workspace_security.sql) and [`supabase/tests/review_workflow.sql`](supabase/tests/review_workflow.sql) exercise access control, tenant isolation, privacy constraints, review states, one-click creation and authoritative context capture/refresh inside transactions that roll back their fixtures. The dev-only [browser fixture](test/browser/job-workspace.html) uses in-memory data to check the full UI without an account or cloud writes.

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

### Basics
- Fill sections with `+` button, remove with `×`
- Eye icon (👁️) shows/hides sections
- Turn on Reorder at the top right of Content to drag the Body/Sidebar section cards directly (or use arrow keys on a handle); turning it off restores expanded editors
- Turn on Versions next to Reorder to edit each section in a different saved CV version. Each section lists only versions containing it; edits save to that version, while the preview continues to show the whole version selected in the topbar. Custom sections retain their identity when a version is duplicated, even if renamed later.
- Use item handles to drag entries and sidebar skills directly
- Auto-save saves all changes automatically
- On mobile, use the bottom tabs to switch between Versions, Content, Design, Privacy and Preview. Preview fits the complete PDF page to the screen; swipe left or right with one finger, or use the page arrows.
- Mobile Content tools sit above the bottom tabs. In Preview, switch between Normal and Privacy view; Download PDF exports the selected view.

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
- **Versions tab**: Multiple named configurations; saving a new one copies the current configuration
- Browser-local storage (LocalStorage)
- **PDF Export**: Download directly from the builder or full preview mode
- Import/export JSON files possible

## 🛠 Tech Stack

- **Vue 3.5** + **Vite 7.2**: Framework & build tool
- **html2canvas layout adapter**: Cooperative DOM/CSS parsing and vector paint recording; no page canvas is allocated or raster-painted
- **PDFKit + Fontkit**: Lazy-loaded browser-only vector PDF export; no server or print dialog required, compatible with GitHub Pages
- **FontAwesome 7**: Icon system
- **VueDraggable**: Handle-based section and item sorting
- **Local assets / Bunny Fonts / Google Fonts**: Common built-in fonts load from `public/fonts`; custom and unbundled fonts remain source-aware dynamic imports
- **LocalStorage**: Persistent storage and named browser configurations

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

**New Section**: Extend state in `App.vue` → adjust FormBuilder + Preview → translations in `dict.ts`

**Design Option**: State → DesignPanel input → CSS variable in `applyCvDesign()` → use CSS

**Sidebar Skill Display**: Template in `SkillItem.vue` + level configuration in `FormBuilder.vue`

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
- **Privacy**: No cloud, no tracking, 100% local
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
