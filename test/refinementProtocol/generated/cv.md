phd-workflow: APP-64FB13D53C — refine CV.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability and ask me to use Copy full prompt with sources in the app; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request 5fcea2b2-43e6-43ff-a356-999e1e56c1ac (schemaVersion 2, scope cv) for application 7c0d4bb2-8b39-425c-a05d-0f5639434aee: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-64FB13D53C') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals 7c0d4bb2-8b39-425c-a05d-0f5639434aee and current_request_id equals 5fcea2b2-43e6-43ff-a356-999e1e56c1ac, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id 5fcea2b2-43e6-43ff-a356-999e1e56c1ac and protocol_id v1:4aed0cee8ce175a9c684bca55a9cd24b09964db7c4dd017c3b183c239062c717. Read that exact document next:
SELECT private.read_refinement_protocol('5fcea2b2-43e6-43ff-a356-999e1e56c1ac'::uuid, E'v1:4aed0cee8ce175a9c684bca55a9cd24b09964db7c4dd017c3b183c239062c717') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Keep the letter unchanged.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
