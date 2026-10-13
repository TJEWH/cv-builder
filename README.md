# CV Harness

CV Harness is a personal workspace for research, PhD, and job applications. Maintain reusable CVs and letter templates, tailor documents for each application, and assemble PDF packages for submission.

Use **CV Studio** without an account. Connect Supabase to review opportunities, manage applications, and refine documents through ChatGPT. The interface supports English and German on desktop and mobile.

## Run locally

Requires Node.js **22.13 or newer** and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (default: [localhost:5173/cv-builder/](http://localhost:5173/cv-builder/)). You can leave Supabase unconfigured for local CV editing and PDF export.

## Workspaces

| Workspace | Use it to |
| --- | --- |
| **CV Studio** | Edit CV variants, customize layout and typography, manage letter templates, set privacy replacements, and store supporting files. |
| **Opportunities** | Review the shared research catalogue, filter results, record interest, and create applications. Requires Supabase. |
| **Applications** | Prepare application documents, review refinements, assemble PDF packages, and track progress. Requires Supabase. |

The opportunity catalogue comes from outside the app. Use the app to review existing research; conduct new searches through your research tools.

### Application workflow

Move between these stages in any order:

| Stage | Actions |
| --- | --- |
| **Preparation** | Choose a saved CV and letter template; review the opportunity and required documents. |
| **Refinement** | Request changes, review the result, edit wording, and approve the CV and letter. |
| **Attachments** | Select supporting files, arrange the package, preview it, and download the PDF. |
| **Tracking** | Record application status and notes; review status history. |

Template selection creates independent application copies pinned to their source revisions. Later library edits leave those copies unchanged. After approving an application CV, use **Save as new variant** to reuse it elsewhere.

For ChatGPT refinement, select **CV** or **Letter** and copy the task into a conversation with access to the project's Supabase MCP `execute_sql` tool. Copying a task does not start ChatGPT. ChatGPT reads the published sources and saves a proposal; loading a valid proposal for the current snapshot updates the working copy. Review the result and approve each document before export. See the [refinement guide](supabase/REFINEMENT.md) for the protocol and review rules.

Package export requires both document approvals and the files for all included attachments. Submit the downloaded package through the institution's portal or email, then update **Tracking**.

## Documents, privacy, and backups

CV and letter PDFs contain selectable text, clickable links, and vector graphics. Adjust sections, fonts, margins, and page breaks in CV Studio. Add supporting PDF, PNG, or JPEG files through **Local attachments**; convert office documents to PDF before attaching them.

Full working CVs, letters, templates, and private refinement data stay in browser storage. Supporting files and package archives use IndexedDB. Signing in does not upload a CV.

Refinement publication sends privacy-filtered sources and feedback to Supabase. Review the outgoing content: masking known fields cannot remove identifying details from all prose. Saving an attachment's metadata while signed in shares its name, description, and identifiers; its file contents stay on the device.

Keep separate backups before changing devices or clearing browser data:

- **CV Studio → Variants**: export content and configuration JSON. Enable **Bypass privacy proxy** for a complete private CV backup; default content exports apply privacy settings.
- **CV Studio → Letter templates**: export the template library.
- **CV Studio → Local attachments → Back up files & packages**: export supporting files, package arrangements, and archived PDFs.

Cloud history cannot restore private working originals or local files. See [JSON formats and import behavior](docs/json-format.md) before editing or restoring a backup.

## Connect Supabase

1. Follow the [Supabase setup guide](supabase/README.md) to prepare the database and provision accounts. Use `schema.sql` for a new database; use targeted migrations for an existing workspace.
2. Copy [`.env.example`](.env.example) to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Restart Vite and sign in with an existing account. The project administrator manages registration and password recovery.

Use a publishable key or a legacy `anon` key in frontend configuration. Keep secret and `service_role` keys out of the frontend. Database grants and row-level security control access to shared research and private application records.

## Development

New autosaving textareas must follow the [shared textarea behavior](docs/textarea-behavior.md): save on blur or Enter, keep typing local, and flush before navigation.

The app uses Vue 3, TypeScript, and Vite. It runs as a static frontend with local tab navigation. PDFKit and Fontkit handle CV and letter exports, pdf-lib assembles application packages, and PDF.js renders package previews.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run typecheck` | Check application, Vue, build, and test types. |
| `npm test` | Run the Node regression suite. |
| `npm run test:refinement` | Run refinement and privacy regressions. |
| `npm run test:refinement-protocol` | Check generated instructions and the connected protocol. |
| `npm run test:e2e:serve` | Serve the synthetic browser test runners. |
| `npm run build` | Typecheck and build into `dist/`. |
| `npm run preview` | Serve the production build for local inspection. |

Browser tests use in-memory data and an isolated Vite configuration. Follow the [testing guide](test/REFINEMENT_TESTING.md) to run them. Database tests require a separate run; `npm test` does not verify deployed permissions.

| Path | Contents |
| --- | --- |
| [`src/components/`](src/components) | Workspace screens, document editors, and preview controls. |
| [`src/composables/`](src/composables) | Document state, privacy, persistence, refinement, and rendering logic. |
| [`src/types.ts`](src/types.ts), [`src/pdfTypes.ts`](src/pdfTypes.ts) | Shared CV and PDF contracts. |
| [`build/`](build) | PDF renderer adapters and build plugins. |
| [`supabase/`](supabase) | Database setup, refinement contracts, and SQL tests. |
| [`test/`](test) | Regression suites and synthetic browser fixtures. |

The PDF renderer uses build-time adapters for pinned dependencies. After changing those dependencies, check the adapters, run the tests and build, and inspect document previews and exports in the browser.

## Deployment

The [GitHub Actions workflow](.github/workflows/deploy.yml) builds and deploys to GitHub Pages after a push to `main`. Configure Pages to use **GitHub Actions** and supply the public Supabase build variables through the `phd-workflow` GitHub environment.

The build targets `/cv-builder/` and writes to `dist/`. For another static host, run `npm run build` and serve that directory. Change `base` in [`vite.config.ts`](vite.config.ts) to match the hosting path, using `/` for a domain root.

## Documentation

- [JSON formats and editing workflow](docs/json-format.md)
- [Supabase setup and security model](supabase/README.md)
- [Application refinement contract](supabase/REFINEMENT.md)
- [Application and browser testing](test/REFINEMENT_TESTING.md)
- [Refinement protocol tests](test/refinementProtocol/README.md)
- [Product scope and constraints](PRODUCT.md)
