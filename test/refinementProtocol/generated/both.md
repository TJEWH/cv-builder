phd-workflow: APP-4ED8487A78 — refine both.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability and ask me to use Copy full prompt with sources in the app; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request fe0a8403-4a59-4e7e-aee3-7fc79502ba43 (schemaVersion 2, scope both) for application e421dad0-48d1-47f2-a7a1-b582c37a4da0: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-4ED8487A78') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals e421dad0-48d1-47f2-a7a1-b582c37a4da0 and current_request_id equals fe0a8403-4a59-4e7e-aee3-7fc79502ba43, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id fe0a8403-4a59-4e7e-aee3-7fc79502ba43 and protocol_id v1:753f2c52ff1526df77c2b688b34949912e33332b28872fe0aa427d2e1ea146f0. Read that exact document next:
SELECT private.read_refinement_protocol('fe0a8403-4a59-4e7e-aee3-7fc79502ba43'::uuid, E'v1:753f2c52ff1526df77c2b688b34949912e33332b28872fe0aa427d2e1ea146f0') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Refine the complete existing letter in this request, preserving my corrections.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
