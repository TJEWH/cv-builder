phd-workflow: APP-87B154F2D8 — refine motivation letter.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability and ask me to use Copy full prompt with sources in the app; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request e9647f80-9179-4c3c-ab33-1f57624e4523 (schemaVersion 2, scope letter) for application cbf80c2d-10d8-4745-a0d5-2e4d5f746da4: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-87B154F2D8') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals cbf80c2d-10d8-4745-a0d5-2e4d5f746da4 and current_request_id equals e9647f80-9179-4c3c-ab33-1f57624e4523, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id e9647f80-9179-4c3c-ab33-1f57624e4523 and protocol_id v1:0e5d711c27d77da4d8e3f1bd9755f278a2a5619df99a047621172617b3eb1e2b. Read that exact document next:
SELECT private.read_refinement_protocol('e9647f80-9179-4c3c-ab33-1f57624e4523'::uuid, E'v1:0e5d711c27d77da4d8e3f1bd9755f278a2a5619df99a047621172617b3eb1e2b') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Refine the complete existing letter in this request, preserving my corrections.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
