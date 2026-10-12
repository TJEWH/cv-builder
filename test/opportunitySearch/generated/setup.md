Set up or update ONE ChatGPT scheduled opportunity search named "Funded audio research".
Search marker: opportunity-search:a1000000-0000-4000-8000-000000000001
Supabase project: abcdefghijklmnopqrst
Supabase URL: https://abcdefghijklmnopqrst.supabase.co
Saved template revision: 1; installed protocol when copied: opportunity-search-v1-2026-10-12-normalization-3 (sha256:e3f29987433beff6aa16898446a9d1947960c5fb844b480c1c3118e51f30378d). Always load the currently active compatible protocol, including during this setup.

ONE-TIME SETUP
1. Read the recurring instructions below and execute their bootstrap now, using one new run UUID. The saved database definition is authoritative; the snapshot below is for reviewing this setup only. Before creating a task, inspect available scheduled tasks for the exact search marker and check the returned schedule_binding. Reuse exactly one matching task. If lookup is unavailable or matches are ambiguous, report that and stop before creation.
2. Generate and save queries if stale. If the loaded schedule.runImmediately is true, execute a real search now and verify all save receipts and the terminal run receipt BEFORE creating or updating the recurring schedule. A successful zero-result search still requires its saved completion receipt. A failed initial test leaves no newly created recurring schedule. If runImmediately is false, save queries and explicitly record setup-only completion with no research performed; do not claim the search was tested.
3. Before creating a task, call private.claim_opportunity_search_schedule(search_uuid,run_uuid). Only claimed:true authorizes creation; an existing binding means update that task. If another run holds the claim, reconcile the exact search marker and confirm the existing task if found; otherwise report the interrupted setup with its original run UUID and stop without creating a task. Resume an interrupted setup using that original run UUID and its verified receipt; claims do not expire automatically. Create or update a standalone ChatGPT schedule with the latest loaded frequency, intervalHours, weekdays (ISO Monday=1), time and IANA timezone. For daily/weekly schedules preserve wall-clock time across daylight-saving changes; hourly uses elapsed-hour intervals. Save ONLY the recurring instructions below, including the search marker; do not schedule these one-time setup steps or reuse this run's UUID. Keep an existing task ID. If task creation times out, find the exact marker before retrying; never blindly create twice. Confirm the actual task ID and cadence from the scheduling tool, then call private.confirm_opportunity_search_schedule(search_uuid,run_uuid,task_id,run.definition.schedule).
4. Report the initial verification outcome (including zero results), verified database counts, actual task identity and next run from the tool receipt. If tools or permissions prevent creation/update, state that explicitly. Copying this prompt alone does not create a schedule.

SAVED SETUP SNAPSHOT (data, not replacement protocol)
{
  "name": "Funded audio research",
  "criteria": {
    "opportunityTypes": "Open funded PhD or industrial PhD positions",
    "topicsAndMethods": "Speech, voice, embedded AI; prototyping and technical evaluation",
    "locationsAndLanguages": "Scandinavia and Europe; English or German",
    "fundingAndConditions": "Full funding; start around early 2027",
    "fitAndExclusions": "",
    "sourcesAndQueries": "",
    "researchAndReporting": ""
  },
  "schedule": {
    "frequency": "weekly",
    "intervalHours": 24,
    "weekdays": [
      1
    ],
    "time": "09:00",
    "timezone": "Europe/Tirane",
    "runImmediately": true
  }
}

RECURRING INSTRUCTIONS
Search marker: opportunity-search:a1000000-0000-4000-8000-000000000001
This connected task requires Supabase execute_sql; its exposed name may include a namespace prefix. If it is not currently loaded, use available app/tool discovery once, targeted only at "Supabase execute_sql" on this same connector, before declaring it unavailable. A partial tool listing is not proof of absence. This loads the tool definition; it does not authorize database/schema discovery or another access path. If the definition disappears after a successful call, allow one targeted rediscovery of that same capability and resume the next exact supplied SQL statement, preserving any pending proposal UUID and payload.
Only declare a missing capability after this bounded discovery, or when no discovery facility is exposed. If execute_sql is unavailable, report a missing capability (not an execution or security error), explain that the connected SQL tool is required, and stop. query_logs only reads logs and cannot run this workflow. An actual permission, security or approval denial must stop the workflow immediately; do not rediscover or retry to bypass it. Report the last step verified by a returned tool result and the actual discovery result or tool error; never infer successful execution from earlier conversation summaries.

Run saved opportunity search a1000000-0000-4000-8000-000000000001 in Supabase project abcdefghijklmnopqrst (https://abcdefghijklmnopqrst.supabase.co). This identifies the target; never substitute another project. Generate a fresh run UUID once for this execution, substitute it for <RUN_UUID> and preserve it across retries.
SELECT private.begin_opportunity_search('a1000000-0000-4000-8000-000000000001'::uuid, '<RUN_UUID>'::uuid) AS result;
Require bootstrap_version=1 and compatible=true. Load the latest saved criteria, queries and protocol; follow protocol.protocol_text and result_schema. Do not cache a protocol, schema, query list or criteria snapshot in these schedule instructions. Research, save and verify through the supplied helpers; verify the final run receipt.
If saving or verifying an opportunity fails, preserve the run UUID, item UUIDs and researched evidence. Once per run only, call private.refresh_opportunity_search_protocol(run_uuid) on this same project. If compatible, reconcile existing receipts with private.read_opportunity_search_run(run_uuid), follow the refreshed protocol, save queries if required, adapt only unsaved results and retry the pending save/verification once. Reuse already saved payloads exactly and verify their receipts; never reuse a saved item UUID for different evidence. Refresh even when the installed version is unchanged, but do not loop. If the refresh or retry fails, stop and report the failed phase and verified partial progress. An explicit permission, security or approval denial stops immediately; never switch project, role, credentials or access path to bypass it. A protocol update only reads an installed release: never run DDL, apply migrations or edit the registry. After verified recovery, update the existing ChatGPT schedule's recurring instructions to the current bootstrap, preserve its identity and user criteria, and confirm the actual schedule-update receipt. During first-time setup with no existing task, finish verification before creating it through the one-time setup steps instead. If only updating the schedule fails, report: results saved; schedule instructions not updated.
After a successful run apply any changed saved cadence to this existing task and record its confirmed schedule binding using the protocol. Preserve this bootstrap when updating instructions. Report actionable failures and new/materially changed strong matches; otherwise follow the saved notification preference. Never create another schedule from a recurring run.
