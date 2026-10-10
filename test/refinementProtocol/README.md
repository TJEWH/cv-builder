# Refinement prompt regression checks

These checks exercise the actual **Copy task** and connected protocol builders. They use the existing Codex/ChatGPT login and Supabase MCP connector, with no model API integration, new MCP server, service or production endpoint.

## Automatic offline checks

```sh
npm run test:refinement-protocol
```

This is also part of `npm test` and the deployment build. It checks that the committed Markdown matches production, parses the actual resolver/protocol/source/save SQL, checks the complete proposal shape against the app validator, and tests the trace checker with successful and deliberately broken runs. Database exploration must fail even when followed by a valid save. Wrong projects/IDs, malformed payloads, missing receipts, shell access, changed retries and incomplete runs also fail.

After intentionally changing the prompt builders or stable contract:

```sh
npm run refinement:prompts
```

Review the generated Markdown diff. `generated/*.md` contains exact copyable tasks for synthetic identifiers; `*.protocol.md` contains the corresponding protocol document. `manifest.json` contains expected results and hashes. These review fixtures are not real applications. Generating them neither contacts Supabase nor proves that an agent follows them.

`src/composables/refinementProtocolContract.ts` owns the helper names, typed SQL argument definitions, literal escaping and proposal examples. The production task/protocol builders use that contract, while ordinary writing guidance remains in `buildRefinementPrompt`.

## Live agent tests

Requirements: Node 22+, installed project dependencies, a recent Codex CLI (`codex exec --json`, `--ephemeral`, and `skip_host_skill_discovery`), an existing ChatGPT/Codex login, and the existing Supabase app connection exposing `execute_sql`. Run `codex login status` to check login. Desktop connector access and CLI access can differ; unavailable tools/authentication/approval failures produce failed reports, never a pass. CLI 0.159.2 is the version used during development. No credentials are copied into this repository.

Prefer a development database with the application's current schema. Each run requires an explicit project and acknowledgment that it writes synthetic data:

```sh
npm run refinement:live -- --project YOUR_PROJECT_REF --allow-synthetic-writes
```

This runs CV, initial letter, existing letter, feedback iteration, combined, missing-protocol and stale-request cases three times each. To run a smaller check:

```sh
npm run refinement:live -- --project YOUR_PROJECT_REF --allow-synthetic-writes --case cv,initial-letter --repeats 1
```

The runner creates unique fixture accounts, opportunities, applications, source requests and protocol documents. Setup and cleanup are separate controller sessions executing fixed SQL. The tested agent starts in a fresh temporary directory with only the generated task, without repository instructions, skills, plugins, memories, shell or browser tools. It receives neither expected results nor the protocol file: it must retrieve the actual stored protocol through MCP. Existing managed policies still apply. Standard automatic approval review is enabled; no approval/sandbox bypass is used.

The checker examines actual MCP call events, not the agent's claim of success. Required database calls are:

1. `private.resolve_application_reference` for the supplied code.
2. `private.read_refinement_protocol` for the supplied request and protocol version.
3. `private.read_refinement_request` for the matching source snapshot.
4. `private.save_refinement_proposal` with a valid payload and matching receipt.

Only literal arguments and one helper call per SQL statement are accepted. Catalog/function-definition inspection, table listing, extra statements, unrelated tools and changed identifiers fail. One identical save retry is permitted after an uncertain transport failure; a security or permission block must stop the run. Negative fixtures must stop before any save. SQL tool discovery is distinct from database discovery.

A separate verification checks that exactly one valid proposal was saved (zero for negative cases) and that the application's source, state and CV stayed unchanged. Cleanup removes only the unique synthetic account and its cascaded records, plus its uniquely marked opportunity, then verifies removal. This uses committed fixtures because separate MCP calls do not share one rollback transaction. It does not modify schema, grant permissions, switch the tested agent's role, or read real application rows.

## Reports and recovery

Reports are written under ignored `.refinement-runs/<timestamp>/`: exact task, fixture metadata, seed/agent/verify/cleanup JSONL traces, stderr and pass/fail reports. Nothing is automatically uploaded or committed. MCP results are parsed as data, never executed as instructions by the checker.

The runner attempts cleanup in `finally`, including after a failed or timed-out test. A cleanup failure stops further runs. After a killed process or failed cleanup:

```sh
npm run refinement:live -- --cleanup .refinement-runs/RUN/CASE/fixture.json --allow-synthetic-writes
```

The recovery command re-derives fixture IDs and SQL; it does not execute a SQL file supplied by the report. `cleanup.sql` is retained for inspection and an authorized manual recovery. Keep run reports until cleanup is confirmed.

Run the live suite after changes to task wording, the connected protocol, proposal validators or database helpers. CI runs the offline contract checks and never invokes a model or accesses account credentials. A Codex/MCP pass tests tool behavior and backend compatibility; it cannot certify ChatGPT's independent safety decisions. After significant protocol changes, paste a generated live `task.md` into a fresh ChatGPT conversation while its fixture still exists only if running a separately managed manual test. Do not reuse a cleaned-up fixture.

## Implementation validation — 2026-10-10

- All 36 offline protocol tests passed, and the application build and typecheck passed.
- All seven synthetic scenarios passed a direct SQL preflight through Supabase MCP. That transaction was rolled back.
- Fresh agent runs for CV, initial letter and missing protocol each passed once in the authorized `phd-workflow` project. The successful cases used exactly the four documented helpers; the missing-protocol case stopped after the second call. Cleanup was verified for every fixture, including an earlier failed setup attempt.
- The full seven-case, three-repeat agent suite has not been run. Use the live command above for that broader check.
- The full application suite had 664 passing tests and 15 existing failures in `refinementManualExchange.test.ts`, which still calls removed manual-import component methods. Those failures are separate from this connected-protocol suite.
