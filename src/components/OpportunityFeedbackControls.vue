<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import AutosaveTextarea from './AutosaveTextarea.vue';
import InfoHint from './InfoHint.vue';
import { OPPORTUNITY_INTEREST_REASON_CATEGORIES, type Opportunity, type OpportunityInterestReason, type OpportunityReview } from '../cloudTypes';
import { deriveOpportunityFeedback, normalizeOpportunityInterestReasons, parseOpportunityInterestRating, type OpportunitySubmissionEvidence } from '../composables/opportunityFeedback';
import { commitPendingTextareas } from '../composables/textareaCommit';
import { useToastWatch } from '../composables/useToasts';
import { opportunityFeedbackTextIsSafe } from '../composables/opportunityFeedbackPrivacy';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH } from '../composables/opportunityEvaluation';

interface FeedbackPatch { interest_rating?: number | null; interest_reasons?: OpportunityInterestReason[]; feedback_excluded?: boolean }
const props = withDefaults(defineProps<{
  ownerId: string;
  opportunity: Opportunity;
  review?: OpportunityReview | null;
  application?: OpportunitySubmissionEvidence | null;
  structuredSharingEnabled?: boolean;
  searchAvailable?: boolean;
  busy?: boolean;
  lang?: string;
  evaluationText: string;
  evaluationStatus?: string;
  evaluationError?: string;
  evaluationInputId?: string;
  evaluationLabelledby?: string;
  saveFeedback(id: string, patch: FeedbackPatch): Promise<OpportunityReview | null>;
  setStructuredSharing(enabled: boolean): Promise<boolean>;
  flushPrivateComment: () => Promise<boolean>;
}>(), { review: null, application: null, structuredSharingEnabled: false, searchAvailable: false, busy: false, lang: 'en' });
const controlsId = `opportunity-feedback-${useId()}`;
const emit = defineEmits<{ 'update:evaluationText': [value: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const currentReview = computed(() => props.review?.user_id === props.ownerId && props.review.opportunity_id === props.opportunity.id ? props.review : null);
const scope = computed(() => `${props.ownerId}:${props.opportunity.id}`);
const ratingDraft = ref('');
const reasonCategories = ref<OpportunityInterestReason['category'][]>(['topic']);
const reasonPolarity = ref<OpportunityInterestReason['polarity']>('positive');
const reasonTarget = ref('');
const actionError = ref('');
const actionSaving = ref(false);
let generation = 0;
let ratingSaving: Promise<boolean> | null = null;
let retryAction: (() => Promise<boolean>) | null = null;
watch(scope, () => {
  generation++;
  actionError.value = '';
  actionSaving.value = false;
  retryAction = null;
  ratingSaving = null;
  ratingDraft.value = '';
  reasonCategories.value = ['topic'];
  reasonPolarity.value = 'positive';
  reasonTarget.value = '';
}, { flush: 'sync' });
watch([scope, () => currentReview.value?.interest_rating], (next, previous) => {
  const saved = next[1]?.toString() ?? '', prior = previous?.[1]?.toString() ?? '';
  if (!previous || next[0] !== previous[0] || ratingDraft.value === prior || ratingDraft.value === saved) ratingDraft.value = saved;
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
const ratingPending = computed(() => ratingDraft.value !== (currentReview.value?.interest_rating?.toString() ?? ''));
const ratingSliderValue = computed(() => ratingDraft.value === '' ? outcome.value.interest_score ?? 5 : Number(ratingDraft.value));
const ratingValueLabel = computed(() => ratingDraft.value === '' ? text('Use review category', 'Interessenauswahl verwenden') : `${ratingDraft.value}/10`);
const ratingValueText = computed(() => ratingDraft.value === ''
  ? `${text('No override', 'Keine eigene Bewertung')} · ${originLabel.value}${outcome.value.interest_score === null ? '' : `: ${outcome.value.interest_score}/10`}`
  : `${ratingDraft.value}/10 · ${ratingPending.value ? text('Unsaved rating', 'Ungespeicherte Bewertung') : originLabel.value}`);
function draftRating(event: Event) { ratingDraft.value = (event.target as HTMLInputElement).value; }

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
async function saveRating(): Promise<boolean> {
  if (ratingSaving) return ratingSaving;
  try {
    const rating = ratingDraft.value === '' ? null : parseOpportunityInterestRating(Number(ratingDraft.value));
    if (rating === (currentReview.value?.interest_rating ?? null)) return true;
    const pending = savePatch({ interest_rating: rating });
    ratingSaving = pending;
    try { return await pending; } finally { if (ratingSaving === pending) ratingSaving = null; }
  } catch {
    retryAction = null;
    actionError.value = text('Enter a number from 0 to 10, or leave the rating empty.', 'Gib eine Zahl von 0 bis 10 ein oder lasse die Bewertung leer.');
    return false;
  }
}
async function clearRating() { ratingDraft.value = ''; return saveRating(); }
async function addReason() {
  try {
    if (!reasonCategories.value.length) throw new TypeError('Choose at least one reason category.');
    const additions = [...new Set(reasonCategories.value)].flatMap(category => {
      const reason: OpportunityInterestReason = { category, polarity: reasonPolarity.value };
      if (['topic', 'method'].includes(category) && reasonTarget.value !== '') reason.target = reasonTarget.value;
      return normalizeOpportunityInterestReasons([reason]);
    });
    const existing = normalizeOpportunityInterestReasons(reasons.value);
    const distinct = [...new Map([...existing, ...additions].map(reason => [JSON.stringify(reason), reason])).values()];
    const updated = normalizeOpportunityInterestReasons(distinct);
    if (JSON.stringify(updated) === JSON.stringify(normalizeOpportunityInterestReasons(reasons.value)) || await savePatch({ interest_reasons: updated })) reasonTarget.value = '';
  } catch {
    retryAction = null;
    actionError.value = text('Use at most 16 reasons and a topic or method of up to 120 characters.', 'Nutze höchstens 16 Gründe und ein Thema oder eine Methode mit bis zu 120 Zeichen.');
  }
}
const removeReason = (index: number) => savePatch({ interest_reasons: reasons.value.filter((_reason, position) => position !== index) });
const categoryLabel = (category: OpportunityInterestReason['category']) => ({ topic: text('Topic', 'Thema'), method: text('Method', 'Methode'), hardware: text('Hardware', 'Hardware'),
  location: text('Location', 'Ort'), funding: text('Funding', 'Finanzierung'), timing: text('Timing', 'Zeitpunkt'), other: text('Other', 'Sonstiges') })[category];
const reasonLabel = (reason: OpportunityInterestReason) => `${categoryLabel(reason.category)}: ${reason.polarity === 'positive' ? text('Prefer', 'Bevorzugt') : text('Avoid', 'Vermeiden')}${reason.target ? ` — ${reason.target}` : ''}`;

const summaryDraft = computed({
  get: () => props.evaluationText,
  set: (value: string) => emit('update:evaluationText', value),
});
const summaryError = computed(() => props.evaluationError ?? '');
const summaryLength = computed(() => Array.from(summaryDraft.value).length);
const summaryInvalid = computed(() => Boolean(summaryError.value) || summaryLength.value > MAX_OPPORTUNITY_EVALUATION_LENGTH);
const summaryExcerpt = computed(() => Array.from(summaryDraft.value).slice(0,600).join(''));
const summaryEligible = computed(() => !currentReview.value?.feedback_excluded && opportunityFeedbackTextIsSafe(summaryDraft.value,MAX_OPPORTUNITY_EVALUATION_LENGTH) && opportunityFeedbackTextIsSafe(summaryExcerpt.value));
const summaryIncluded = computed(() => props.structuredSharingEnabled && summaryEligible.value);
const flushSummary = () => props.flushPrivateComment();
async function flush(): Promise<boolean> {
  commitPendingTextareas();
  if ((ratingSaving || ratingPending.value) && !await saveRating() || ratingPending.value) return false;
  return true;
}
function toggleStructuredSharing() {
  const enabled = !props.structuredSharingEnabled;
  return runAction(() => props.setStructuredSharing(enabled), text('The sharing setting was not saved. Retry.', 'Die Freigabeeinstellung wurde nicht gespeichert. Versuche es erneut.'));
}
function retry() { return retryAction?.(); }
useToastWatch(() => actionError.value, () => ({ tone: 'error', action: retryAction ? { label: text('Retry', 'Erneut versuchen'), run: retry } : undefined }));
defineExpose({ flush });
</script>

<template>
  <section class="feedback-controls" :aria-label="text('Search feedback', 'Suchfeedback')">
    <div class="feedback-summary">
      <div class="feedback-heading"><label :for="evaluationInputId || `${controlsId}-summary`">{{ text('Personal evaluation', 'Persönliche Einschätzung') }}</label><InfoHint :lang="lang" :label="text('Evaluation and search feedback', 'Einschätzung und Suchfeedback')" :text="text('Saved evaluation text is included in search feedback by default when structured feedback is enabled. The exclusion checkbox below applies to all feedback for this opportunity. Longer evaluations use a clearly labelled first-600-character excerpt; the full evaluation stays saved. Contact details, credentials and unsafe instructions are withheld.', 'Gespeicherte Einschätzungen werden bei aktiviertem strukturiertem Feedback standardmäßig einbezogen. Das Ausschlussfeld unten gilt für das gesamte Feedback dieser Stelle. Längere Einschätzungen verwenden einen gekennzeichneten Auszug der ersten 600 Zeichen; der vollständige Text bleibt gespeichert. Kontaktdaten, Zugangsdaten und unsichere Anweisungen werden zurückgehalten.')" /><span class="feedback-summary-count">{{ summaryLength }} / {{ MAX_OPPORTUNITY_EVALUATION_LENGTH }} {{ text('characters', 'Zeichen') }}</span></div>
      <AutosaveTextarea :id="evaluationInputId || `${controlsId}-summary`" v-model="summaryDraft" :aria-labelledby="evaluationLabelledby" rows="3" :aria-invalid="summaryInvalid || undefined" @commit="flushSummary" />
      <details v-if="summaryLength > 600 && summaryEligible" class="feedback-excerpt"><summary>{{ text('Search feedback excerpt — first 600 characters', 'Suchfeedback-Auszug — erste 600 Zeichen') }}</summary><p>{{ summaryExcerpt }}</p></details>
      <InfoHint :lang="lang" :label="text('Evaluation feedback inclusion', 'Einbeziehung der Einschätzung')" :text="currentReview?.feedback_excluded ? text('Excluded from search feedback', 'Vom Suchfeedback ausgeschlossen') : !summaryDraft.trim() ? text('No feedback text yet', 'Noch kein Feedbacktext') : !summaryEligible ? text('Text withheld by content safeguards', 'Text durch Inhaltsprüfung zurückgehalten') : summaryIncluded ? text('Included in search feedback', 'Im Suchfeedback enthalten') : text('Included when structured feedback is enabled', 'Bei aktiviertem strukturiertem Feedback enthalten')" />
      <button v-if="summaryError" class="btn" type="button" @click="flushSummary">{{ text('Retry save', 'Speichern erneut versuchen') }}</button>
    </div>
    <div class="feedback-interest-row">
      <div class="feedback-rating"><div class="feedback-heading"><label :for="`${controlsId}-rating`">{{ text('Interest override (0–10)', 'Eigene Interessensbewertung (0–10)') }}</label><output :for="`${controlsId}-rating`">{{ ratingValueLabel }}</output></div><input :id="`${controlsId}-rating`" type="range" min="0" max="10" step="0.1" :value="ratingSliderValue" :aria-valuetext="ratingValueText" :disabled="disabled" @input="draftRating" @change="saveRating" /></div>
      <button v-if="ratingDraft !== ''" class="btn" type="button" :disabled="disabled" @click="clearRating">{{ text('Clear rating', 'Bewertung entfernen') }}</button>
      <p class="feedback-score">{{ outcome.interest_score === null ? text('No adaptive score', 'Kein adaptiver Wert') : `${outcome.interest_score}/10` }}<span>{{ originLabel }}</span></p>
    </div>
    <label class="feedback-check"><input type="checkbox" :checked="currentReview?.feedback_excluded ?? false" :disabled="disabled" @change="savePatch({ feedback_excluded: ($event.target as HTMLInputElement).checked })" />{{ text('Exclude this opportunity from search feedback', 'Diese Stelle vom Suchfeedback ausschließen') }}</label>
    <fieldset class="feedback-reasons" :disabled="disabled"><legend>{{ text('Reasons', 'Gründe') }}</legend>
      <ul v-if="reasons.length"><li v-for="(reason, index) in reasons" :key="`${reason.category}:${reason.polarity}:${reason.target || ''}`"><span>{{ reasonLabel(reason) }}</span><button class="btn" type="button" :aria-label="`${text('Remove reason', 'Grund entfernen')}: ${reasonLabel(reason)}`" @click="removeReason(index)">{{ text('Remove', 'Entfernen') }}</button></li></ul>
      <fieldset class="feedback-categories"><legend class="feedback-heading">{{ text('Categories', 'Kategorien') }}<InfoHint :lang="lang" :label="text('Reason categories', 'Kategorien der Gründe')" :text="text('Select one or more categories. Add saves them together with the selected preference. A topic or method target applies only to those two categories.', 'Wähle eine oder mehrere Kategorien. Hinzufügen speichert sie gemeinsam mit der gewählten Präferenz. Ein Thema oder eine Methode gilt nur für diese beiden Kategorien.')" /></legend><div class="feedback-category-options"><label v-for="category in OPPORTUNITY_INTEREST_REASON_CATEGORIES" :key="category" class="feedback-category"><input v-model="reasonCategories" type="checkbox" :value="category" />{{ categoryLabel(category) }}</label></div></fieldset>
      <div class="feedback-reason-inputs"><label>{{ text('Preference', 'Präferenz') }}<select v-model="reasonPolarity" :aria-label="text('Preference', 'Präferenz')"><option value="positive">{{ text('Prefer', 'Bevorzugen') }}</option><option value="negative">{{ text('Avoid', 'Vermeiden') }}</option></select></label><label v-if="reasonCategories.some(category => ['topic', 'method'].includes(category))">{{ text('Topic or method (optional)', 'Thema oder Methode (optional)') }}<input v-model="reasonTarget" type="text" maxlength="240" @keydown.enter.prevent="addReason" /></label><button class="btn" type="button" :disabled="!reasonCategories.length" @click="addReason">{{ text('Add reasons', 'Gründe hinzufügen') }}</button></div>
    </fieldset>
    <div class="feedback-consent"><div class="feedback-heading"><span>{{ text('Structured feedback for this search', 'Strukturiertes Feedback für diese Suche') }}</span><InfoHint :lang="lang" :label="text('Structured feedback sharing', 'Freigabe strukturierten Feedbacks')" :text="text('Enabling authorizes current and historical opportunity titles, institutions, public sources and topics, your review state, rating, reasons and minimal confirmed-submission evidence. Saved evaluation text is included by default, using the first 600 characters when longer. The exclusion checkbox applies to text and structured signals. Contacts, application notes, CVs and letters remain outside this feedback.', 'Die Aktivierung erlaubt aktuelle und frühere Stellentitel, Institutionen, öffentliche Quellen und Themen sowie deine Interessenauswahl, Bewertungen, Gründe und minimale Nachweise bestätigter Einreichungen. Gespeicherte Einschätzungen sind standardmäßig enthalten, bei längeren Texten die ersten 600 Zeichen. Das Ausschlussfeld gilt für Text und strukturierte Signale. Kontakte, Bewerbungsnotizen, Lebensläufe und Briefe bleiben ausgeschlossen.')" /></div><button class="btn" type="button" :disabled="disabled || !searchAvailable" @click="toggleStructuredSharing">{{ structuredSharingEnabled ? text('Disable structured feedback', 'Strukturiertes Feedback deaktivieren') : text('Use structured feedback for this search', 'Strukturiertes Feedback für diese Suche verwenden') }}</button><InfoHint v-if="!searchAvailable" :lang="lang" :label="text('Enable structured feedback', 'Strukturiertes Feedback aktivieren')" :text="text('Save a meta search to enable structured feedback.', 'Speichere eine Metasuche, um strukturiertes Feedback zu aktivieren.')" /></div>
    <button v-if="actionError && retryAction" class="btn" type="button" :disabled="disabled" @click="retry">{{ text('Retry', 'Erneut versuchen') }}</button>
  </section>
</template>

<style scoped>
.feedback-controls { display: grid; gap: 18px; min-width: 0; color: var(--ui-text); padding-block: 14px; }
.feedback-heading { display: flex; align-items: center; gap: 4px; min-width: 0; }
.feedback-controls label, .feedback-heading > span, .feedback-reasons legend { color: var(--ui-text); font: 600 12px/1.5 var(--font-ui); }
.feedback-controls label:not(.feedback-check):not(.feedback-category) { display: grid; gap: 6px; }
.feedback-controls :is(input:not([type=checkbox]):not([type=range]),select), .feedback-summary :deep(textarea) { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); font: 400 14px/1.5 var(--font-ui); caret-color: var(--ui-accent); }
.feedback-summary :deep(textarea) { resize: vertical; }
.feedback-controls :is(input,select,button):focus-visible, .feedback-summary :deep(textarea:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.feedback-interest-row { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; }
.feedback-rating { display: grid; flex: 1 1 240px; max-width: 560px; gap: 8px; min-width: 0; }
.feedback-rating .feedback-heading { justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.feedback-rating output { color: var(--ui-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.feedback-controls .feedback-rating input[type=range] { width: 100%; min-width: 0; min-height: 28px; margin: 0; padding: 0; accent-color: var(--ui-accent); cursor: pointer; }
.feedback-controls .feedback-score { display: grid; gap: 2px; margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; }
.feedback-score span { color: var(--ui-muted); font-size: 12px; line-height: 1.6; }
.feedback-check { display: flex; align-items: center; gap: 8px; }
.feedback-controls :is(.feedback-check,.feedback-category) input[type=checkbox] { flex: 0 0 16px; box-sizing: border-box; width: 16px; min-width: 16px; max-width: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--ui-accent); }
.feedback-reasons { min-width: 0; margin: 0; padding: 0; border: 0; }
.feedback-reasons legend { padding: 0 0 8px; }
.feedback-reasons ul { display: grid; gap: 6px; padding: 0; margin: 0 0 10px; list-style: none; }
.feedback-reasons li { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.feedback-reasons li { font-size: 13px; overflow-wrap: anywhere; }
.feedback-categories { min-width: 0; margin: 0 0 12px; border: 0; padding: 0; }
.feedback-categories legend { padding: 0 0 8px; }
.feedback-category-options { display: flex; flex-wrap: wrap; gap: 8px; }
.feedback-controls .feedback-category { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; box-sizing: border-box; padding: 6px 9px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); cursor: pointer; font-weight: 400; }
.feedback-category:has(input:checked) { border-color: var(--ui-accent); }
.feedback-category:hover { background: var(--ui-hover, var(--ui-control)); }
.feedback-reason-inputs { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.feedback-reason-inputs > label { flex: 1 1 180px; min-width: 0; }
.feedback-summary { display: grid; gap: 8px; }
.feedback-summary-count { margin-inline-start: auto; color: var(--ui-muted); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 400; }
.feedback-summary .feedback-heading { flex-wrap: wrap; }
.feedback-excerpt { color: var(--ui-muted); font-size: 12px; line-height: 1.6; }
.feedback-excerpt summary { cursor: pointer; }
.feedback-excerpt p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0; }
.feedback-consent { display: grid; justify-items: start; gap: 8px; border-top: 1px solid var(--ui-divider); padding-top: 14px; }
.feedback-controls button:disabled { opacity: .55; cursor: default; }
@media (max-width: 760px) {
  .feedback-controls :is(input:not([type=checkbox]):not([type=range]),select), .feedback-summary :deep(textarea) { font-size: 16px; }
  .feedback-controls button, .feedback-controls .feedback-category, .feedback-controls .feedback-rating input[type=range] { min-height: 44px; }
}
</style>
