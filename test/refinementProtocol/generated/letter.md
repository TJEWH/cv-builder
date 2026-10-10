phd-workflow: APP-AB2A1D7C0E — refine motivation letter.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability, explain that the connected SQL tool is required, and stop; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request 0be69ef0-ee10-4950-ab53-a89f372e64e4 (schemaVersion 2, scope letter) for application 75cab682-cd13-4384-aecf-dee7de5d4c29: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-AB2A1D7C0E') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals 75cab682-cd13-4384-aecf-dee7de5d4c29 and current_request_id equals 0be69ef0-ee10-4950-ab53-a89f372e64e4, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id 0be69ef0-ee10-4950-ab53-a89f372e64e4 and protocol_id v1:7617da48b7dd208b59107b36907dc93c71c54c2abb571a5abb6fb863f6e50997. Read that exact document next:
SELECT private.read_refinement_protocol('0be69ef0-ee10-4950-ab53-a89f372e64e4'::uuid, E'v1:7617da48b7dd208b59107b36907dc93c71c54c2abb571a5abb6fb863f6e50997') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Refine the complete existing letter in this request, preserving my corrections.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
