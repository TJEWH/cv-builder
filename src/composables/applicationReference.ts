import type { Application } from '../cloudTypes';
import type { RefinementScope } from '../refinementTypes';

type ApplicationReference = Pick<Application, 'id' | 'application_code'>;

/** Codes are opaque server values. A complete UUID is the only legacy fallback. */
export function applicationIdentifier(application: ApplicationReference): string {
  return typeof application.application_code === 'string' && application.application_code.trim()
    ? application.application_code : application.id;
}

export function buildShortRefinementInstruction(application: ApplicationReference, scope: RefinementScope): string {
  const document = scope === 'cv' ? 'CV' : scope === 'letter' ? 'motivation letter' : 'both';
  return `phd-workflow: ${applicationIdentifier(application)} — refine ${document}.`;
}
