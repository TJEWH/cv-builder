<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import AutosaveTextarea from './AutosaveTextarea.vue';
import InfoHint from './InfoHint.vue';
import { OPPORTUNITY_INTEREST_REASON_CATEGORIES, type Opportunity, type OpportunityInterestReason, type OpportunityReview } from '../cloudTypes';
import { deriveOpportunityFeedback, normalizeOpportunityInterestReasons, parseOpportunityInterestRating, type OpportunitySubmissionEvidence } from '../composables/opportunityFeedback';
import { useApplicationNotesAutosave } from '../composables/useApplicationNotesAutosave';
import { commitPendingTextareas } from '../composables/textareaCommit';

interface FeedbackPatch { interest_rating?: number | null; interest_reasons?: OpportunityInterestReason[]; feedback_excluded?: boolean }
type SharingReview = OpportunityReview & {
  search_feedback_summary?: string | null;
  search_feedback_revision?: number;
  search_feedback_summary_hash?: string;
  search_feedback_source_hash?: string;
  search_feedback_approved_at?: string | null;
  search_feedback_approved_summary_hash?: string | null;
  search_feedback_approved_source_hash?: string | null;
};
const props = withDefaults(defineProps<{
  ownerId: string;
  opportunity: Opportunity;
  review?: SharingReview | null;
  application?: OpportunitySubmissionEvidence | null;
  structuredSharingEnabled?: boolean;
  searchAvailable?: boolean;
  busy?: boolean;
  lang?: string;
  saveFeedback(id: string, patch: FeedbackPatch): Promise<OpportunityReview | null>;
  saveSummary(id: string, text: string): Promise<OpportunityReview | null>;
  approveSummary(id: string, summaryHash: string, sourceHash: string, summaryRevision: number): Promise<OpportunityReview | null>;
  revokeSummary(id: string): Promise<OpportunityReview | null>;
  setStructuredSharing(enabled: boolean): Promise<boolean>;
  flushPrivateComment?: () => Promise<boolean>;
}>(), { review: null, application: null, structuredSharingEnabled: false, searchAvailable: false, busy: false, lang: 'en' });
const controlsId = `opportunity-feedback-${useId()}`;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const currentReview = computed(() => props.review?.user_id === props.ownerId && props.review.opportunity_id === props.opportunity.id ? props.review : null);
const scope = computed(() => `${props.ownerId}:${props.opportunity.id}`);
const ratingDraft = ref('');
const reasonCategory = ref<OpportunityInterestReason['category']>('topic');
const reasonPolarity = ref<OpportunityInterestReason['polarity']>('positive');
const reasonTarget = ref('');
const actionError = ref('');
const actionSaving = ref(false);
let generation = 0;
let retryAction: (() => Promise<boolean>) | null = null;
watch(scope, () => {
  generation++;
  actionError.value = '';
  actionSaving.value = false;
  retryAction = null;
  reasonTarget.value = '';
}, { flush: 'sync' });
watch([scope, () => currentReview.value?.interest_rating], () => {
  if (!actionSaving.value) ratingDraft.value = currentReview.value?.interest_rating?.toString() ?? '';
}, { immediate: true, flush: 'sync' });
const reasons = computed(() => currentReview.value?.interest_reasons ?? []);
const disabled = computed(() => props.busy || actionSaving.value);
const outcome = computed(() => deriveOpportunityFeedback({ user_id: props.ownerId, opportunity_id: props.opportunity.id,
  review: currentReview.value, applications: props.application ? [props.application] : [] }));
const originLabel = computed(() => ({
  explicit_rating: text('Your rating', 'Deine Bewertung'), categorical_review: text('Review category', 'Interessenauswahl'),
  confirmed_submission: text('Confirmed submission', 'Bestätigte Einreichung'), none: text('No interest evidence', 'Noch kein Interessenssignal'),
  excluded: text('Excluded', 'Ausgeschlossen'),
})[outcome.value.interest_origin]);

async function runAction(action: () => Promise<boolean>, message: string): Promise<boolean> {
  if (disabled.value) return false;
  const ownerGeneration = generation;
  actionSaving.value = true;
  actionError.value = '';
  retryAction = () => runAction(action, message);
  try {
    const saved = await action();
    if (ownerGeneration !== generation) return false;
    if (!saved) throw new Error(message);
    retryAction = null;
    return true;
  } catch (error) {
    if (ownerGeneration === generation) actionError.value = error instanceof Error ? error.message : message;
    return false;
  } finally { if (ownerGeneration === generation) actionSaving.value = false; }
}
function savePatch(patch: FeedbackPatch) {
  const id = props.opportunity.id;
  return runAction(async () => Boolean(await props.saveFeedback(id, patch)), text('Feedback was not saved. Retry your change.', 'Feedback wurde nicht gespeichert. Versuche es erneut.'));
}
async function saveRating() {
  try {
    const rating = ratingDraft.value === '' ? null : parseOpportunityInterestRating(Number(ratingDraft.value));
    return await savePatch({ interest_rating: rating });
  } catch {
    retryAction = null;
    actionError.value = text('Enter a number from 0 to 10, or leave the rating empty.', 'Gib eine Zahl von 0 bis 10 ein oder lasse die Bewertung leer.');
    return false;
  }
}
async function clearRating() { ratingDraft.value = ''; return saveRating(); }
async function addReason() {
  try {
    const reason: OpportunityInterestReason = { category: reasonCategory.value, polarity: reasonPolarity.value };
    if (['topic', 'method'].includes(reason.category) && reasonTarget.value !== '') reason.target = reasonTarget.value;
    const updated = normalizeOpportunityInterestReasons([...reasons.value, reason]);
    if (await savePatch({ interest_reasons: updated })) reasonTarget.value = '';
  } catch {
    retryAction = null;
    actionError.value = text('Use at most 16 reasons and a topic or method of up to 120 characters.', 'Nutze höchstens 16 Gründe und ein Thema oder eine Methode mit bis zu 120 Zeichen.');
  }
}
const removeReason = (index: number) => savePatch({ interest_reasons: reasons.value.filter((_reason, position) => position !== index) });
const categoryLabel = (category: OpportunityInterestReason['category']) => ({ topic: text('Topic', 'Thema'), method: text('Method', 'Methode'), hardware: text('Hardware', 'Hardware'),
  location: text('Location', 'Ort'), funding: text('Funding', 'Finanzierung'), timing: text('Timing', 'Zeitpunkt'), other: text('Other', 'Sonstiges') })[category];
const reasonLabel = (reason: OpportunityInterestReason) => `${categoryLabel(reason.category)}: ${reason.polarity === 'positive' ? text('Prefer', 'Bevorzugt') : text('Avoid', 'Vermeiden')}${reason.target ? ` — ${reason.target}` : ''}`;

const { notes: summaryDraft, status: summaryStatus, error: summaryError, flush: flushSummary } = useApplicationNotesAutosave({
  application: () => ({ id: props.opportunity.id, notes: currentReview.value?.search_feedback_summary ?? '' }),
  owner: () => props.ownerId,
  save: async (id, value) => Boolean(await props.saveSummary(id, value)),
  storagePrefix: 'CV_SEARCH_FEEDBACK_SUMMARY_DRAFT', maxLength: 600,
  errorMessage: () => text('Summary was not saved. Your draft is kept. Retry before leaving.', 'Die Zusammenfassung wurde nicht gespeichert. Dein Entwurf bleibt erhalten. Versuche es vor dem Verlassen erneut.'),
});
const summaryApproved = computed(() => Boolean(currentReview.value?.search_feedback_approved_at)
  && summaryDraft.value === (currentReview.value?.search_feedback_summary ?? '')
  && currentReview.value?.search_feedback_approved_summary_hash === currentReview.value?.search_feedback_summary_hash
  && currentReview.value?.search_feedback_approved_source_hash === currentReview.value?.search_feedback_source_hash);
async function flush(): Promise<boolean> { commitPendingTextareas(); return flushSummary(); }
async function approve() {
  commitPendingTextareas();
  const ownerGeneration = generation;
  if (!await flushSummary() || props.flushPrivateComment && !await props.flushPrivateComment() || ownerGeneration !== generation) return false;
  const id = props.opportunity.id, approvedText = summaryDraft.value, review = currentReview.value;
  if (!approvedText.trim()) return false;
  if (!review?.search_feedback_summary_hash || !review.search_feedback_source_hash || review.search_feedback_revision === undefined) {
    actionError.value = text('Reload the saved summary before approving it.', 'Lade die gespeicherte Zusammenfassung vor der Freigabe erneut.');
    return false;
  }
  const summaryHash = review.search_feedback_summary_hash, sourceHash = review.search_feedback_source_hash, summaryRevision = review.search_feedback_revision;
  return runAction(async () => Boolean(await props.approveSummary(id, summaryHash, sourceHash, summaryRevision)),
    text('Summary approval failed. Check the saved summary and retry.', 'Die Freigabe ist fehlgeschlagen. Prüfe die gespeicherte Zusammenfassung und versuche es erneut.'));
}
function revoke() {
  const id = props.opportunity.id;
  return runAction(async () => Boolean(await props.revokeSummary(id)), text('Sharing could not be revoked. Retry.', 'Die Freigabe konnte nicht widerrufen werden. Versuche es erneut.'));
}
function toggleStructuredSharing() {
  const enabled = !props.structuredSharingEnabled;
  return runAction(() => props.setStructuredSharing(enabled), text('The sharing setting was not saved. Retry.', 'Die Freigabeeinstellung wurde nicht gespeichert. Versuche es erneut.'));
}
function retry() { return retryAction?.(); }
defineExpose({ flush });
</script>

<template>
  <section class="feedback-controls" :aria-labelledby="`${controlsId}-heading`">
    <div class="feedback-heading"><h3 :id="`${controlsId}-heading`">{{ text('Search feedback', 'Suchfeedback') }}</h3><InfoHint :lang="lang" :label="text('Search feedback', 'Suchfeedback')" :text="text('Interest is separate from AI fit and application outcomes. A confirmed submission is a fallback only when you have no rating or interest category. Viewing an opportunity never counts as interest.', 'Interesse ist unabhängig von KI-Passung und Bewerbungsergebnissen. Eine bestätigte Einreichung zählt nur ohne eigene Bewertung oder Interessenauswahl. Das Öffnen einer Stelle zählt nicht als Interesse.')" /></div>
    <div class="feedback-interest-row">
      <label :for="`${controlsId}-rating`">{{ text('Interest override (0–10)', 'Eigene Interessensbewertung (0–10)') }}<input :id="`${controlsId}-rating`" v-model="ratingDraft" type="number" min="0" max="10" step="any" inputmode="decimal" :disabled="disabled" :placeholder="text('Use review category', 'Interessenauswahl verwenden')" @change="saveRating" @keydown.enter.prevent="saveRating" /></label>
      <button v-if="ratingDraft !== ''" class="btn" type="button" :disabled="disabled" @click="clearRating">{{ text('Clear rating', 'Bewertung entfernen') }}</button>
      <p class="feedback-score" aria-live="polite">{{ outcome.interest_score === null ? text('No adaptive score', 'Kein adaptiver Wert') : `${outcome.interest_score}/10` }}<span>{{ originLabel }}</span></p>
    </div>
    <label class="feedback-check"><input type="checkbox" :checked="currentReview?.feedback_excluded ?? false" :disabled="disabled" @change="savePatch({ feedback_excluded: ($event.target as HTMLInputElement).checked })" />{{ text('Exclude from adaptive search', 'Von adaptiver Suche ausschließen') }}</label>
    <fieldset class="feedback-reasons" :disabled="disabled"><legend>{{ text('Reasons', 'Gründe') }}</legend>
      <ul v-if="reasons.length"><li v-for="(reason, index) in reasons" :key="`${reason.category}:${reason.polarity}:${reason.target || ''}`"><span>{{ reasonLabel(reason) }}</span><button class="btn" type="button" :aria-label="`${text('Remove reason', 'Grund entfernen')}: ${reasonLabel(reason)}`" @click="removeReason(index)">{{ text('Remove', 'Entfernen') }}</button></li></ul>
      <div class="feedback-reason-inputs"><label>{{ text('Category', 'Kategorie') }}<select v-model="reasonCategory" :aria-label="text('Category', 'Kategorie')"><option v-for="category in OPPORTUNITY_INTEREST_REASON_CATEGORIES" :key="category" :value="category">{{ categoryLabel(category) }}</option></select></label><label>{{ text('Preference', 'Präferenz') }}<select v-model="reasonPolarity" :aria-label="text('Preference', 'Präferenz')"><option value="positive">{{ text('Prefer', 'Bevorzugen') }}</option><option value="negative">{{ text('Avoid', 'Vermeiden') }}</option></select></label><label v-if="['topic', 'method'].includes(reasonCategory)">{{ text('Topic or method (optional)', 'Thema oder Methode (optional)') }}<input v-model="reasonTarget" type="text" maxlength="240" @keydown.enter.prevent="addReason" /></label><button class="btn" type="button" :disabled="reasons.length >= 16" @click="addReason">{{ text('Add reason', 'Grund hinzufügen') }}</button></div>
    </fieldset>
    <div class="feedback-summary"><div class="feedback-heading"><label :for="`${controlsId}-summary`">{{ text('Summary for search feedback', 'Zusammenfassung für Suchfeedback') }}</label><InfoHint :lang="lang" :label="text('Summary for search feedback', 'Zusammenfassung für Suchfeedback')" :text="text('Write a short, safe explanation yourself. Your private evaluation is never copied here. Saving keeps a private draft; only Approve for search feedback permits this exact text to be shared. Editing it or the private explanation removes approval. Remove personal names, contacts and confidential details.', 'Schreibe selbst eine kurze, unbedenkliche Begründung. Deine private Einschätzung wird hier nie übernommen. Speichern sichert nur einen privaten Entwurf; erst die ausdrückliche Freigabe erlaubt das Teilen dieses genauen Texts. Änderungen daran oder an der privaten Einschätzung heben die Freigabe auf. Entferne Personennamen, Kontaktdaten und vertrauliche Angaben.')" /></div>
      <AutosaveTextarea :id="`${controlsId}-summary`" v-model="summaryDraft" rows="3" maxlength="600" :aria-invalid="summaryError ? true : undefined" @commit="flushSummary" />
      <div class="feedback-summary-actions"><span role="status">{{ summaryError || (summaryApproved ? text('Approved for search feedback', 'Für Suchfeedback freigegeben') : summaryStatus === 'saving' ? text('Saving draft…', 'Entwurf wird gespeichert…') : summaryStatus === 'unsaved' ? text('Unsaved private draft', 'Ungespeicherter privater Entwurf') : text('Private draft — not shared', 'Privater Entwurf — nicht geteilt')) }}</span><button v-if="summaryError" class="btn" type="button" @click="flushSummary">{{ text('Retry save', 'Speichern erneut versuchen') }}</button><button v-if="summaryApproved" class="btn" type="button" :disabled="disabled" @click="revoke">{{ text('Revoke sharing', 'Freigabe widerrufen') }}</button><button v-else class="btn" type="button" :disabled="disabled || !summaryDraft.trim()" @click="approve">{{ text('Approve for search feedback', 'Für Suchfeedback freigeben') }}</button></div>
    </div>
    <div class="feedback-consent"><div class="feedback-heading"><span>{{ text('Structured feedback for this search', 'Strukturiertes Feedback für diese Suche') }}</span><InfoHint :lang="lang" :label="text('Structured feedback sharing', 'Freigabe strukturierten Feedbacks')" :text="text('Enabling authorizes current and historical opportunity titles, institutions, public sources and topics, your review state, rating, reasons and minimal confirmed-submission evidence. It never authorizes private comments, contacts, application notes, CVs or letters. Approved summaries have their own approval.', 'Die Aktivierung erlaubt aktuelle und frühere Stellentitel, Institutionen, öffentliche Quellen und Themen sowie deine Interessenauswahl, Bewertungen, Gründe und minimale Nachweise bestätigter Einreichungen. Private Kommentare, Kontakte, Bewerbungsnotizen, Lebensläufe oder Briefe sind ausgeschlossen. Zusammenfassungen benötigen eine eigene Freigabe.')" /></div><p v-if="!structuredSharingEnabled">{{ text('Use reviews, ratings, reasons and confirmed submissions. Private comments and application documents stay private.', 'Interessenauswahl, Bewertungen, Gründe und bestätigte Einreichungen verwenden. Private Kommentare und Bewerbungsdokumente bleiben privat.') }}</p><button class="btn" type="button" :disabled="disabled || !searchAvailable" @click="toggleStructuredSharing">{{ structuredSharingEnabled ? text('Disable structured feedback', 'Strukturiertes Feedback deaktivieren') : text('Use structured feedback for this search', 'Strukturiertes Feedback für diese Suche verwenden') }}</button><p v-if="!searchAvailable">{{ text('Save a meta search to enable structured feedback.', 'Speichere eine Metasuche, um strukturiertes Feedback zu aktivieren.') }}</p></div>
    <div v-if="actionError" class="feedback-error" role="alert"><span>{{ actionError }}</span><button v-if="retryAction" class="btn" type="button" :disabled="disabled" @click="retry">{{ text('Retry', 'Erneut versuchen') }}</button></div>
  </section>
</template>

<style scoped>
.feedback-controls { display: grid; gap: 18px; min-width: 0; color: var(--ui-text); padding-block: 14px; }
.feedback-heading { display: flex; align-items: center; gap: 4px; min-width: 0; }
.feedback-heading h3 { margin: 0; color: inherit; font: 600 14px/1.5 var(--font-ui); }
.feedback-controls label, .feedback-heading > span, .feedback-reasons legend { color: var(--ui-text); font: 600 12px/1.5 var(--font-ui); }
.feedback-controls label:not(.feedback-check) { display: grid; gap: 6px; }
.feedback-controls :is(input:not([type=checkbox]),select), .feedback-summary :deep(textarea) { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: 400 14px/1.5 var(--font-ui); caret-color: var(--ui-accent); }
.feedback-summary :deep(textarea) { resize: vertical; }
.feedback-controls :is(input,select,button):focus-visible, .feedback-summary :deep(textarea:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.feedback-interest-row { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; }
.feedback-interest-row > label { flex: 1 1 200px; max-width: 300px; }
.feedback-controls .feedback-score { display: grid; gap: 2px; margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; }
.feedback-score span, .feedback-summary-actions > span, .feedback-consent p { color: var(--ui-muted); font-size: 12px; line-height: 1.6; }
.feedback-check { display: flex; align-items: center; gap: 8px; }
.feedback-check input { width: 16px; height: 16px; accent-color: var(--ui-accent); }
.feedback-reasons { min-width: 0; margin: 0; padding: 0; border: 0; }
.feedback-reasons legend { padding: 0 0 8px; }
.feedback-reasons ul { display: grid; gap: 6px; padding: 0; margin: 0 0 10px; list-style: none; }
.feedback-reasons li, .feedback-summary-actions, .feedback-error { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.feedback-reasons li { font-size: 13px; overflow-wrap: anywhere; }
.feedback-reason-inputs { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(110px, 1fr) minmax(140px, 2fr) auto; align-items: end; gap: 10px; }
.feedback-summary { display: grid; gap: 8px; }
.feedback-consent { display: grid; justify-items: start; gap: 8px; border-top: 1px solid var(--ui-divider); padding-top: 14px; }
.feedback-consent p { max-width: 75ch; margin: 0; }
.feedback-error { color: var(--ui-danger-text, var(--ui-text)); font-size: 13px; }
.feedback-controls button:disabled { opacity: .55; cursor: default; }
@media (max-width: 760px) {
  .feedback-reason-inputs { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .feedback-reason-inputs > :nth-child(3) { grid-column: 1 / -1; }
  .feedback-controls :is(input:not([type=checkbox]),select), .feedback-summary :deep(textarea) { font-size: 16px; }
  .feedback-controls button { min-height: 44px; }
}
</style>
