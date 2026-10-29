# Opportunity meta research

The Opportunities sidebar contains one meta-research workspace per account, with one shared profile and region priorities. The profile has three semicolon-separated textareas: opportunity/job types and sources; research interests including preferred tasks/methods and avoided tasks; salary, funding and conditions. English system and user prompts are generated from those fields. Research directions are alternatives: a role can match one direction or a useful combination, without fulfilling every interest. Explicit hard exclusions remain binding.

## Edit, autosave, replace

1. Edit the meta search. Textareas keep typing in a local draft and commit on blur or Enter; Shift+Enter adds a newline and IME confirmation does not save. See [textarea behavior](textarea-behavior.md).
2. Each committed snapshot automatically saves to Supabase. Saves are serialized and duplicate commits share the pending request. Typing during a save remains a separate draft until the next commit. Failed snapshots remain recoverable and block copying or navigation until saved.
3. Select **Copy replace prompt**. It commits pending textareas and waits for their saves, then copies a short instruction identifying the project and saved search UUID.
4. Paste that instruction into ChatGPT. One SQL read returns the complete saved prompt, requested schedule and existing task binding. ChatGPT updates the bound task or identifies the existing meta-research task by purpose, keeps one active meta-search task and disables superseded related tasks. Unrelated scheduled work is preserved. A task is created only when none exists. The shared meta search is always included in the daily schedule.

Copying itself does not alter ChatGPT tasks. Replacement does not run a search, create setup runs, claim a schedule or chain further Supabase requests. The actual scheduled research execution still follows the installed opportunity-search protocol.

## Storage and requests

The app reads owner-scoped search records once when the editor opens. Each commit uses one `save_opportunity_meta_search` RPC, which atomically returns its saved row. No preflight or follow-up verification read is required. The RPC enforces owner RLS, expected revisions and exact lost-response retries; a stale conflicting edit remains an error.

The existing `public.opportunity_search_templates` row now has a private `meta_search` JSONB document containing version, active state, complete editable state, system prompt, user prompt and recurring-task prompt. The single profile is always active; there is no inclusion toggle. The short replacement read excludes raw editor state. Older profile libraries are read into the shared fields without activating disabled directions; removed background/goals and disabled content are retained only for recovery, not used as search criteria or letter evidence. Committing this search is authorized cloud persistence; it does not approve application documents, upload attachments or submit applications.

The existing seven-string criteria contract is retained for the installed search protocol. Each criterion remains limited to 12,000 characters. Oversized context fails without truncation. The additive [autosave upgrade](../supabase/opportunity_meta_search_autosave.sql) adds the full prompt and the single-request save RPC. Older search writers invalidate a stale full prompt if they change criteria or schedule.

Local account-scoped snapshots and failed-draft recovery remain available. Older local libraries consolidate into one shared search; the original raw library is retained before the first changed save. Search-library changes do not delete remote records or schedules.

## Search execution

The stored recurring prompt uses bootstrap contract 1 and `private.begin_opportunity_search(search_uuid, run_uuid)` when a scheduled run actually starts. That loads the current definition, protocol, result schema and query revision. Query publication, canonical identity matching, source provenance, richer-evidence preservation, numeric 0–10 scoring, result submission and separate persistence receipts remain governed by the existing protocol. Search writes preserve user reviews and captured application context.

New recommendations require at least 72 hours until a verified official deadline at run time. Date-only deadlines are evaluated conservatively at 00:00 in the established local timezone without inventing an official stored time. Verified rolling/open-until-filled vacancies remain eligible. Existing records can receive verified deadline and closure updates. Successful runs without new or materially changed strong matches stay quiet.

## Letter reuse

Letter templates have a **Use research interests from meta search** checkbox, enabled by default. When enabled, new letter setup uses the shared research-interest field; disabling it uses the template’s own research interests and preserves that custom wording for later use. On a fresh device, the preview and initial application setup can read the owner’s saved cloud search without writing it. The application letter keeps an independent local snapshot and shares it only through the existing privacy-filtered refinement flow. Research interests remain aspirations rather than proof of qualifications. Existing application work, approved documents and captured source preferences are not silently rewritten when the search or library checkbox changes. Reselect the letter template to adopt a different source preference, or use **Refresh shared interests** for an unrefined letter already linked to the shared source.
