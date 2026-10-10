phd-workflow: APP-20DEF97595 — refine CV.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability and ask me to use Copy full prompt with sources in the app; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request 1c2676f2-5fe5-4812-a3a0-2a7b549ef787 (schemaVersion 2, scope cv) for application a6b0dafc-ba11-4a2e-afa8-51b537f56acc: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-20DEF97595') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals a6b0dafc-ba11-4a2e-afa8-51b537f56acc and current_request_id equals 1c2676f2-5fe5-4812-a3a0-2a7b549ef787, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id 1c2676f2-5fe5-4812-a3a0-2a7b549ef787 and protocol_id v1:4dbc1e1720aa65ed0a094a0225fed0378297264c37244eb1d953d3b0df72ff1e. Read that exact document next:
SELECT private.read_refinement_protocol('1c2676f2-5fe5-4812-a3a0-2a7b549ef787'::uuid, E'v1:4dbc1e1720aa65ed0a094a0225fed0378297264c37244eb1d953d3b0df72ff1e') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Keep the letter unchanged.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
