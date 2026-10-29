<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { OpportunityDispositionPatch, OpportunityReview, OpportunityTechnicalIssue } from '../cloudTypes';
import { OPPORTUNITY_TECHNICAL_ISSUES } from '../cloudTypes';
import { normalizeOpportunityDispositionPatch } from '../composables/opportunityDisposition';
import { useApplicationNotesAutosave } from '../composables/useApplicationNotesAutosave';
import { commitPendingTextareas } from '../composables/textareaCommit';
import AutosaveTextarea from './AutosaveTextarea.vue';
import InfoHint from './InfoHint.vue';

const props = withDefaults(defineProps<{
  ownerId: string; opportunityId: string; review?: OpportunityReview | null; busy?: boolean; lang?: string;
  saveDisposition(id: string, patch: OpportunityDispositionPatch): Promise<OpportunityReview | null>;
}>(), { review: null, busy: false, lang: 'en' });
const controlId = `opportunity-disposition-${useId()}`;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const currentReview = computed(() => props.review?.user_id === props.ownerId && props.review.opportunity_id === props.opportunityId ? props.review : null);
const scope = computed(() => `${props.ownerId}:${props.opportunityId}`);
const archivedDraft = ref(false), archivedDirty = ref(false);
const categoryDraft = ref<OpportunityTechnicalIssue | ''>(''), categoryDirty = ref(false);
const actionError = ref(''), pendingCount = ref(0);
let generation = 0, queue: Promise<unknown> = Promise.resolve();
let failedPatch: OpportunityDispositionPatch | null = null;
watch(scope, () => {
  generation++; queue = Promise.resolve(); pendingCount.value = 0; failedPatch = null; actionError.value = '';
  archivedDirty.value = false; categoryDirty.value = false;
  archivedDraft.value = currentReview.value?.manually_archived ?? false;
  categoryDraft.value = currentReview.value?.technical_issue_category ?? '';
}, { immediate: true, flush: 'sync' });
watch(currentReview, review => {
  if (archivedDraft.value === (review?.manually_archived ?? false)) archivedDirty.value = false;
  if (categoryDraft.value === (review?.technical_issue_category ?? '')) categoryDirty.value = false;
  if (!archivedDirty.value) archivedDraft.value = review?.manually_archived ?? false;
  if (!categoryDirty.value) categoryDraft.value = review?.technical_issue_category ?? '';
}, { flush: 'sync' });
const disabled = computed(() => props.busy || pendingCount.value > 0);
function persist(input: OpportunityDispositionPatch, id = props.opportunityId): Promise<boolean> {
  const patch = normalizeOpportunityDispositionPatch(input), ownerGeneration = generation;
  const owner = props.ownerId;
  const isCurrent = () => ownerGeneration === generation && owner === props.ownerId && id === props.opportunityId;
  if (isCurrent()) { pendingCount.value++; actionError.value = ''; }
  const pending = queue.then(async () => {
    if (owner !== props.ownerId) return false;
    try {
      const saved = await props.saveDisposition(id, patch);
      if (owner !== props.ownerId) return false;
      if (!saved || saved.user_id !== owner || saved.opportunity_id !== id
        || Object.entries(patch).some(([key, value]) => saved[key as keyof OpportunityReview] !== value)) throw new Error();
      if (isCurrent()) {
        failedPatch = null;
        if (Object.hasOwn(patch, 'manually_archived') && archivedDraft.value === patch.manually_archived) archivedDirty.value = false;
        if (Object.hasOwn(patch, 'technical_issue_category') && categoryDraft.value === (patch.technical_issue_category ?? '')) categoryDirty.value = false;
      }
      return true;
    } catch {
      if (isCurrent()) {
        failedPatch = patch;
        actionError.value = text('The opportunity status was not saved. Your draft is kept. Retry before leaving.', 'Der Stellenstatus wurde nicht gespeichert. Dein Entwurf bleibt erhalten. Versuche es vor dem Verlassen erneut.');
      }
      return false;
    }
  }).finally(() => { if (isCurrent()) pendingCount.value--; });
  queue = pending;
  return pending;
}
function changeArchived(event: Event) {
  archivedDraft.value = (event.target as HTMLInputElement).checked; archivedDirty.value = true;
  return persist({ manually_archived: archivedDraft.value });
}
function changeCategory(event: Event) {
  categoryDraft.value = (event.target as HTMLSelectElement).value as OpportunityTechnicalIssue | ''; categoryDirty.value = true;
  return persist({ technical_issue_category: categoryDraft.value || null });
}
const { notes, status: noteStatus, error: noteError, flush: flushNote } = useApplicationNotesAutosave({
  application: () => ({ id: props.opportunityId, notes: currentReview.value?.technical_issue_note }), owner: () => props.ownerId,
  storagePrefix: 'CV_OPPORTUNITY_TECHNICAL_NOTE_DRAFT', maxLength: 2000,
  save: async (id, note) => {
    if (Array.from(note).length > 1000) return false;
    return persist({ technical_issue_note: note || null }, id);
  },
  errorMessage: () => text('The technical note was not saved. Keep it to 1,000 characters and retry.', 'Die technische Notiz wurde nicht gespeichert. Verwende höchstens 1.000 Zeichen und versuche es erneut.'),
});
const noteLength = computed(() => Array.from(notes.value).length);
const categoryLabel = (category: OpportunityTechnicalIssue) => ({
  closed: text('Already closed', 'Bereits geschlossen'), requirements: text('Requirements cannot be met', 'Voraussetzungen nicht erfüllbar'),
  application_problem: text('Application or portal problem', 'Bewerbungs- oder Portalproblem'), other: text('Other technical problem', 'Anderes technisches Problem'),
})[category];
async function retry() { if (noteError.value) return flushNote(); return failedPatch ? persist(failedPatch) : true; }
async function flush(): Promise<boolean> {
  commitPendingTextareas();
  const ownerGeneration = generation;
  await queue;
  if (ownerGeneration !== generation || failedPatch || archivedDirty.value || categoryDirty.value) return false;
  return await flushNote() && ownerGeneration === generation;
}
defineExpose({ flush });
</script>

<template>
  <section class="opportunity-disposition" :aria-label="text('Opportunity status', 'Stellenstatus')">
    <div class="disposition-heading"><label class="disposition-check"><input type="checkbox" :checked="archivedDraft" :disabled="disabled" @change="changeArchived" />{{ text('Move this opportunity to Past', 'Diese Stelle nach Vergangen verschieben') }}</label><InfoHint :lang="lang" :label="text('Past opportunity', 'Vergangene Stelle')" :text="text('This is your personal list status. You can undo it. It does not change the official deadline, application status or interest rating. The issue category helps search feedback distinguish technical problems from dislike. Technical details stay private; use the evaluation above for a shared explanation.', 'Dies ist dein persönlicher Listenstatus. Du kannst ihn rückgängig machen. Die offizielle Frist, der Bewerbungsstatus und deine Interessensbewertung bleiben unverändert. Die Problemkategorie unterscheidet technische Hindernisse von fehlendem Interesse. Technische Details bleiben privat; nutze die Einschätzung oben für eine geteilte Erklärung.')" /></div>
    <div v-if="archivedDraft" class="disposition-details">
      <label :for="`${controlId}-category`">{{ text('Technical issue (optional)', 'Technisches Problem (optional)') }}<select :id="`${controlId}-category`" :value="categoryDraft" :disabled="disabled" @change="changeCategory"><option value="">{{ text('No technical issue specified', 'Kein technisches Problem angegeben') }}</option><option v-for="category in OPPORTUNITY_TECHNICAL_ISSUES" :key="category" :value="category">{{ categoryLabel(category) }}</option></select></label>
      <label :for="`${controlId}-note`">{{ text('Technical details (optional)', 'Technische Details (optional)') }}</label>
      <AutosaveTextarea :id="`${controlId}-note`" v-model="notes" rows="2" maxlength="2000" :aria-invalid="noteError ? true : undefined" @commit="flushNote" />
      <div class="disposition-note-meta"><span class="disposition-status" role="status">{{ noteStatus === 'saving' ? text('Saving technical note…', 'Technische Notiz wird gespeichert…') : noteStatus === 'unsaved' ? text('Unsaved technical note', 'Ungespeicherte technische Notiz') : '' }}</span><span>{{ noteLength }} / 1000</span></div>
    </div>
    <div v-if="actionError || noteError" class="disposition-error" role="alert"><span>{{ actionError || noteError }}</span><button class="btn" type="button" :disabled="disabled" @click="retry">{{ text('Retry save', 'Speichern erneut versuchen') }}</button></div>
  </section>
</template>

<style scoped>
.opportunity-disposition { display: grid; gap: 10px; padding-block: 14px; border-top: 1px solid var(--ui-divider); color: var(--ui-text); font: 400 13px/1.5 var(--font-ui); }
.disposition-heading { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.opportunity-disposition .disposition-check { display: flex; align-items: center; gap: 8px; min-width: 0; }
.opportunity-disposition input[type=checkbox] { flex: 0 0 16px; width: 16px; min-width: 16px; max-width: 16px; height: 16px; padding: 0; margin: 0; accent-color: var(--ui-accent); }
.disposition-details { display: grid; gap: 6px; min-width: 0; }
.disposition-details label { display: grid; gap: 6px; font-weight: 600; font-size: 12px; }
.disposition-details select, .disposition-details :deep(textarea) { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: 7px; color: var(--ui-text); background: var(--ui-control); font: 400 14px/1.5 var(--font-ui); }
.disposition-details :deep(textarea) { resize: vertical; }
.disposition-status { color: var(--ui-muted); font-size: 12px; }
.disposition-note-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; color: var(--ui-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.disposition-error { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--ui-danger-text, var(--ui-text)); }
.opportunity-disposition :is(input,select,button):focus-visible, .disposition-details :deep(textarea:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
@media (max-width: 760px) { .disposition-check, .opportunity-disposition button, .disposition-details select { min-height: 44px; } .disposition-details select, .disposition-details :deep(textarea) { font-size: 16px; } }
</style>
