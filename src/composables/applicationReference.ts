import type { Application } from '../cloudTypes';
import type { RefinementRequest, RefinementScope } from '../refinementTypes';
import { refinementProtocolDocument } from './applicationRefinement';
import { refinementSql } from './refinementProtocolContract';

type ApplicationReference = Pick<Application, 'id' | 'application_code'>;

/** Codes are opaque server values. A complete UUID is the only legacy fallback. */
export function applicationIdentifier(application: ApplicationReference): string {
  return typeof application.application_code === 'string' && application.application_code.trim()
    ? application.application_code : application.id;
}

export function buildShortRefinementInstruction(application: ApplicationReference, scope: RefinementScope, context?: { projectId: string; request: RefinementRequest }): string {
  const document = scope === 'cv' ? 'CV' : scope === 'letter' ? 'motivation letter' : 'both';
  const reference = applicationIdentifier(application);
  // Retain the legacy reference format for callers without a published source.
  if (!context) return `phd-workflow: ${reference} — refine ${document}.`;
  const { request, projectId } = context;
  if (request.applicationId !== application.id || request.scope !== scope) throw new Error('The copied task must match the published application and scope.');
  if (!/^[a-z0-9-]{1,100}$/i.test(projectId)) throw new Error('The connected Supabase project identifier is missing or invalid.');
  const initialLetter = scope !== 'cv' && !request.letter.text.trim();
  const task = initialLetter ? scope === 'letter' ? 'create an initial motivation-letter draft' : 'refine the CV and create an initial motivation-letter draft' : `refine ${document}`;
  const protocol = refinementProtocolDocument(request, projectId);
  return `phd-workflow: ${reference} — ${task}.
This connected task requires Supabase execute_sql. If it is unavailable, report the missing capability, explain that the connected SQL tool is required, and stop; query_logs cannot run this workflow. Do not try another access path.
Use my connected Supabase project ${projectId} to read published request ${request.requestId} (schemaVersion ${request.schemaVersion}, scope ${scope}) for application ${application.id}: its privacy-filtered CV, opportunity, letter settings and feedback.
First resolve the application using exactly this SQL through execute_sql:
${refinementSql('resolve', [reference], 'application_reference')}
Use the private management resolver. public.resolve_application_reference is for signed-in web-app sessions and must not be used for this task. The management connection must already have the required role; do not switch roles or change authentication.
Confirm the returned application_id equals ${application.id} and current_request_id equals ${request.requestId}, so this exact request is still current; otherwise stop and ask me to publish a matching round.
The complete refinement protocol is stored in this Supabase project's public.application_refinement_protocols table, in protocol_text, for request_id ${request.requestId} and protocol_id ${protocol.id}. Read that exact document next:
${refinementSql('protocol', [request.requestId, protocol.id], 'refinement_protocol')}
Verify its application_id, request_id and protocol_id match this task. Follow its protocol_text for the source read, complete proposal JSON format, validation rules and save query. No schema discovery or inspection of database function definitions is needed. If this protocol is missing or mismatched, stop and ask me to copy the task again; do not guess the payload format.
${scope === 'cv' ? 'Keep the letter unchanged.' : initialLetter ? 'The published source letter is intentionally empty. Create the first draft from the published evidence and template; no existing letter is required.' : 'Refine the complete existing letter in this request, preserving my corrections.'}
Save one new refinement proposal for my review through that protocol. Do not replace or approve working/final documents. If a tool call is blocked, stop and report the exact error; do not change permissions, roles or access paths.`;
}
