phd-workflow: APP-25885ABDB2 — refine CV.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability, explain that the connected SQL tool is required, and stop; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project refinement-test-project to read published request 21efe057-41c6-40f2-a58e-2976babb5be4 (schemaVersion 2, scope cv) for application 0ffb08cd-0031-4193-a455-32a189c28999: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
SELECT private.resolve_application_reference(E'APP-25885ABDB2') AS application_reference;
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals 0ffb08cd-0031-4193-a455-32a189c28999 and current_request_id equals 21efe057-41c6-40f2-a58e-2976babb5be4, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id 21efe057-41c6-40f2-a58e-2976babb5be4 and protocol_id v1:1731648119faa19c8c5b899a2d16005bb15e12733d8cd4dad2372a74b907ada3. Read that exact document next:
SELECT private.read_refinement_protocol('21efe057-41c6-40f2-a58e-2976babb5be4'::uuid, E'v1:1731648119faa19c8c5b899a2d16005bb15e12733d8cd4dad2372a74b907ada3') AS refinement_protocol;
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
Keep the letter unchanged.
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.
