# Opportunity meta research

The Opportunities sidebar contains one meta-research workspace per account, with shared strategy, professional context, alternative research profiles and region priorities. English system and user prompts are generated from that definition. A role can match one or several interests; it need not match every profile.

## Edit, autosave, replace

1. Edit the meta search. Textareas keep typing in a local draft and commit on blur or Enter; Shift+Enter adds a newline and IME confirmation does not save. See [textarea behavior](textarea-behavior.md).
2. Each committed snapshot automatically saves to Supabase. Saves are serialized and duplicate commits share the pending request. Typing during a save remains a separate draft until the next commit. Failed snapshots remain recoverable and block copying or navigation until saved.
3. Select **Copy replace prompt**. It commits pending textareas and waits for their saves, then copies a short instruction identifying the project and saved search UUID.
4. Paste that instruction into ChatGPT. One SQL read returns the complete saved prompt, requested schedule and existing task binding. ChatGPT updates the bound task or identifies the existing meta-research task by purpose, keeps one active meta-search task and disables superseded related tasks. Unrelated scheduled work is preserved. A task is created only when none exists; an inactive search disables its task.

Copying itself does not alter ChatGPT tasks. Replacement does not run a search, create setup runs, claim a schedule or chain further Supabase requests. The actual scheduled research execution still follows the installed opportunity-search protocol.

## Storage and requests

The app reads owner-scoped search records once when the editor opens. Each commit uses one `save_opportunity_meta_search` RPC, which atomically returns its saved row. No preflight or follow-up verification read is required. The RPC enforces owner RLS, expected revisions and exact lost-response retries; a stale conflicting edit remains an error.

The existing `public.opportunity_search_templates` row now has a private `meta_search` JSONB document containing version, active state, complete editable state, system prompt, user prompt and recurring-task prompt. All profiles, including disabled ones, are retained for editing across devices. Disabled profile context is omitted from the generated user prompt and the short replacement read excludes raw editor state. Committing this search is authorized cloud persistence; it does not approve application documents, upload attachments or submit applications.

The existing seven-string criteria contract is retained for the installed search protocol. Each criterion remains limited to 12,000 characters. Oversized context fails without truncation. The additive [autosave upgrade](../supabase/opportunity_meta_search_autosave.sql) adds the full prompt and the single-request save RPC. Older search writers invalidate a stale full prompt if they change criteria or schedule.

Local account-scoped snapshots and failed-draft recovery remain available. Older local libraries consolidate into professional profiles inside one search; the original raw library is retained before the first changed save. Search-library changes do not delete remote records or schedules.

## Search execution

The stored recurring prompt uses bootstrap contract 1 and `private.begin_opportunity_search(search_uuid, run_uuid)` when a scheduled run actually starts. That loads the current definition, protocol, result schema and query revision. Query publication, canonical identity matching, source provenance, richer-evidence preservation, numeric 0–10 scoring, result submission and separate persistence receipts remain governed by the existing protocol. Search writes preserve user reviews and captured application context.

New recommendations require at least 72 hours until a verified official deadline at run time. Date-only deadlines are evaluated conservatively at 00:00 in the established local timezone without inventing an official stored time. Verified rolling/open-until-filled vacancies remain eligible. Existing records can receive verified deadline and closure updates. Successful runs without new or materially changed strong matches stay quiet.

## Letter reuse

Application Preparation can explicitly select this search’s shared context or a professional profile, including a disabled profile. The application letter keeps an independent local snapshot and shares it only through the existing privacy-filtered refinement flow. Research interests remain aspirations rather than proof of qualifications. Editing a search profile does not rewrite or approve an application’s documents.
