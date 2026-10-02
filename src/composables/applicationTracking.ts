import { APPLICATION_STATUSES, type Application } from '../cloudTypes';

export function opensInTracking(status: Application['status']): boolean {
  return status !== 'shortlist' && status !== 'contacted';
}

/** Never infer a transition date from unrelated edits or legacy contact/submission dates. */
export function applicationStatusHistory(application: Application): NonNullable<Application['status_history']> {
  const history = application.status_history;
  if (!Array.isArray(history) || !history.length || !history.every(entry => entry && APPLICATION_STATUSES.includes(entry.status)
    && (entry.changedAt === null || typeof entry.changedAt === 'string' && Number.isFinite(Date.parse(entry.changedAt))))) {
    return [{ status: application.status, changedAt: null }];
  }
  return history.at(-1)!.status === application.status ? history : [...history, { status: application.status, changedAt: null }];
}
