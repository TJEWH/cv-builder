/**
 * Read the existing evaluation and feedback draft as one lossless editor value.
 * This projection never saves or approves either source; commits own persistence.
 */
export function mergeOpportunityEvaluation(comment?: string | null, summary?: string | null): string {
  const evaluation = comment ?? '', feedback = summary ?? '';
  if (evaluation.includes(feedback)) return evaluation;
  if (feedback.includes(evaluation)) return feedback;
  return `${evaluation}\n\n${feedback}`;
}

type EvaluationDraftStorage = Pick<Storage, 'getItem' | 'removeItem'>;
const legacyDraftKey = (owner: string, id: string) => `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:${encodeURIComponent(owner)}:${encodeURIComponent(id)}`;
function draftStorage(storage?: EvaluationDraftStorage | null): EvaluationDraftStorage | null {
  try { return storage === undefined ? globalThis.localStorage ?? null : storage; } catch { return null; }
}

/** Read only the old editor's bounded owner/opportunity recovery key. */
export function readLegacyOpportunityFeedbackDraft(owner: string, id: string, storage?: EvaluationDraftStorage | null): string | undefined {
  try {
    const parsed: unknown = JSON.parse(draftStorage(storage)?.getItem(legacyDraftKey(owner, id)) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed) || typeof parsed.value !== 'string'
      || Array.from(parsed.value).length > 600) return undefined;
    return parsed.value;
  } catch { return undefined; }
}

/** A successful unified commit clears only the legacy version it incorporated. */
export function clearLegacyOpportunityFeedbackDraft(owner: string, id: string, expected: string | undefined, storage?: EvaluationDraftStorage | null): boolean {
  if (expected === undefined) return false;
  try {
    const target = draftStorage(storage);
    if (!target || readLegacyOpportunityFeedbackDraft(owner, id, target) !== expected) return false;
    target.removeItem(legacyDraftKey(owner, id));
    return true;
  } catch { return false; }
}
