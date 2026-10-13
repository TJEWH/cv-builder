<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, watch } from 'vue';
import AutosaveTextarea from './AutosaveTextarea.vue';
import type { AnnotationStatus } from '../refinementTypes';
import { QUESTION_GROUPS, questionPresentation, type AnnotationView, type QuestionGroup } from '../composables/refinementAnnotations';
import { useToasts } from '../composables/useToasts';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
const props = defineProps<{
  items: Item[]; lang: string; disabled: boolean; hideHeading?: boolean;
  comments?: { id: string; explanation: string }[];
  save: (id: string, status: AnnotationStatus, response: string, previousReviewId: string | null) => Promise<boolean>;
  privacyPreview: (value: string) => string;
}>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const { notify, dismiss } = useToasts();
const drafts = reactive<Record<string, { status: AnnotationStatus; response: string; reviewId: string | null; savedStatus: AnnotationStatus; savedResponse: string; saving: boolean; failed: boolean; failedStatus: AnnotationStatus | null; partialFailure: boolean }>>({});
const key = (item: Item) => `${item.proposalId}:${item.annotation.id}`;
const dirty = (item: Item) => { const d = drafts[key(item)]; return !!d && (d.status !== d.savedStatus || d.response !== d.savedResponse); };
function reset(item: Item) {
  drafts[key(item)] = { status: item.status, response: item.response || '', reviewId: item.reviewId, savedStatus: item.status, savedResponse: item.response || '', saving: false, failed: false, failedStatus: null, partialFailure: false };
}
watch(() => props.items, items => { for (const item of items) if (!drafts[key(item)] || !dirty(item) && !drafts[key(item)]!.saving && !drafts[key(item)]!.failed) reset(item); }, { immediate: true });
const conflictToasts = new Map<string, number>();
watch(() => props.items.filter(item => !drafts[key(item)]?.saving && drafts[key(item)]?.reviewId !== item.reviewId).map(key), (conflicts, previous) => {
  for (const id of previous) if (!conflicts.includes(id)) {
    dismiss(conflictToasts.get(id) || 0);
    conflictToasts.delete(id);
  }
  for (const id of conflicts) if (!previous.includes(id)) conflictToasts.set(id, notify({
    key: `annotation-conflict-${id}`,
    message: text('This annotation changed elsewhere. Your unsaved response is retained; reload the saved annotation before editing again.', 'Diese Anmerkung wurde andernorts geändert. Deine ungespeicherte Antwort bleibt erhalten; vor weiteren Änderungen den gespeicherten Stand laden.'),
    tone: 'warning',
    action: { label: text('Load saved annotation', 'Gespeicherte Anmerkung laden'), run: () => {
      const current = props.items.find(item => key(item) === id);
      if (current && !props.disabled) reset(current);
    } },
  }));
});
type Commit = { key: string; item: Item; status: AnnotationStatus; response: string; promise: Promise<boolean>; resolve: (saved: boolean) => void };
const queue: Commit[] = [];
let activeCommit: Commit | null = null;
let disposed = false;
watch(() => props.disabled, disabled => {
  if (!disabled) void drain();
});
onBeforeUnmount(() => {
  disposed = true;
  for (const commit of queue.splice(0)) commit.resolve(false);
  for (const id of conflictToasts.values()) dismiss(id);
});
function save(item: Item): Promise<boolean> {
  if (disposed) return Promise.resolve(false);
  const d = drafts[key(item)]!;
  const status = d.status, response = d.response;
  const pending = [...queue].reverse().find(commit => commit.key === key(item)) || (activeCommit?.key === key(item) ? activeCommit : null);
  if (pending?.status === status && pending.response === response) return pending.promise;
  if (!pending && !dirty(item) && !d.failed) return Promise.resolve(true);
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  queue.push({ key: key(item), item, status, response, promise, resolve });
  void drain();
  return promise;
}
async function drain() {
  if (activeCommit || props.disabled || disposed) return;
  const commit = queue.shift();
  if (!commit) return;
  activeCommit = commit;
  const { item, status, response } = commit;
  const d = drafts[commit.key]!;
  let saved = false;
  // Only a review written by this queue may advance the base for a later commit.
  const current = props.items.find(value => key(value) === commit.key);
  if (!current || d.reviewId !== current.reviewId) {
    activeCommit = null; commit.resolve(false); void drain(); return;
  }
  d.saving = true; d.failed = false; d.failedStatus = null; d.partialFailure = false;
  function acceptSaved(current: Item) {
    const unchanged = d.status === status && d.response === response;
    d.savedStatus = current.status; d.savedResponse = current.response || ''; d.reviewId = current.reviewId;
    if (unchanged) { d.status = current.status; d.response = current.response || ''; }
  }
  function failed() {
    const current = props.items.find(value => key(value) === key(item));
    const statusSaved = !!current && current.status === status && (current.response || '') === props.privacyPreview(response).trim();
    if (current && statusSaved) acceptSaved(current);
    d.failed = true; d.failedStatus = status; d.partialFailure = statusSaved;
    // A failed ignore must not look persisted or leave a hidden response stranded.
    if (status === 'ignored' && !statusSaved && d.status === status) d.status = d.savedStatus;
  }
  try {
    saved = await props.save(item.annotation.id, status, response, d.reviewId);
    const current = props.items.find(value => key(value) === key(item));
    if (saved) { if (current) acceptSaved(current); }
    else failed();
  } catch {
    failed();
  } finally {
    d.saving = false;
    commit.resolve(saved);
    activeCommit = null;
    // The parent's busy flag is propagated before starting the next snapshot.
    await nextTick();
    void drain();
  }
}
async function flush(): Promise<boolean> {
  const results = await Promise.all(props.items.map(item => save(item)));
  return results.every(Boolean) && props.items.every(item => !dirty(item) && !drafts[key(item)]!.failed);
}
defineExpose({ flush });
function failureMessage(item: Item) {
  const draft = drafts[key(item)]!;
  if (draft.failedStatus === 'ignored') return draft.partialFailure
    ? text('Ignored status saved, but previous feedback could not be cancelled. Change the status to Open, then Ignored to retry.', 'Der Status „Ignoriert“ wurde gespeichert, vorheriges Feedback konnte aber nicht zurückgenommen werden. Zum Wiederholen den Status auf „Offen“ und danach auf „Ignoriert“ setzen.')
    : text('Ignoring failed. Your previous status and response are retained. Choose Ignored again to retry.', 'Ignorieren fehlgeschlagen. Der vorherige Status und deine Antwort bleiben erhalten. Zum Wiederholen erneut „Ignoriert“ auswählen.');
  return text('The comment could not be fully saved. Your response is retained.', 'Der Kommentar konnte nicht vollständig gespeichert werden. Deine Antwort bleibt erhalten.');
}
const questionGroupLabel = (group: QuestionGroup) => ({
  application_requirements: text('Application requirements', 'Bewerbungsanforderungen'),
  experience: text('Your experience', 'Eigene Erfahrung'),
  follow_up: text('Follow-up questions', 'Rückfragen'),
  other: text('Other', 'Sonstige'),
})[group];
const groups = computed(() => QUESTION_GROUPS.map(group => ({
  id: group,
  items: props.items.filter(item => questionPresentation(item.annotation.text).group === group),
  comments: (props.comments || []).filter(comment => questionPresentation(comment.explanation).group === group),
})).filter(group => group.items.length || group.comments.length));
</script>

<template>
  <section v-if="groups.length" class="annotations" :aria-label="text('Questions', 'Fragen')">
    <h3 v-if="!hideHeading">{{ text('Questions', 'Fragen') }}</h3>
    <section v-for="group in groups" :key="group.id" class="question-group" :data-question-group="group.id">
      <h4>{{ questionGroupLabel(group.id) }}</h4>
      <article v-for="item in group.items" :key="key(item)" class="annotation-row" :data-annotation-id="item.annotation.id" :aria-label="item.target" :aria-busy="drafts[key(item)]!.saving">
        <p class="annotation-text">{{ questionPresentation(item.annotation.text).text }}</p>
        <template v-if="item.annotation.document === 'letter' && item.annotation.location">
          <p v-if="item.referenceChanged" class="app-hint">{{ text('Referenced text has changed', 'Referenzierter Text wurde geändert') }}</p>
          <details class="disclosure-row"><summary>{{ text('Original text reference', 'Ursprünglicher Textbezug') }}</summary><blockquote>{{ item.annotation.location.quote }}</blockquote></details>
        </template>
        <label v-if="drafts[key(item)]!.status !== 'ignored'">{{ text('Your response (optional)', 'Deine Antwort (optional)') }}<AutosaveTextarea v-model="drafts[key(item)]!.response" @commit="save(item)" rows="3" maxlength="12000" :disabled="disabled" /></label>
        <label>{{ text('Status', 'Status') }}<select v-model="drafts[key(item)]!.status" :disabled="disabled" @change="save(item)"><option value="open">{{ text('Open', 'Offen') }}</option><option value="resolved">{{ text('Resolved', 'Erledigt') }}</option><option value="ignored">{{ text('Ignored', 'Ignoriert') }}</option></select></label>
        <p v-if="drafts[key(item)]!.reviewId !== item.reviewId" class="app-hint">{{ text('Load the saved annotation before continuing.', 'Vor dem Fortfahren die gespeicherte Anmerkung laden.') }} <button type="button" :disabled="disabled" @click="reset(item)">{{ text('Load saved annotation', 'Gespeicherte Anmerkung laden') }}</button></p>
        <p v-if="drafts[key(item)]!.failed" class="save-error" role="alert">{{ failureMessage(item) }}</p>
        <button v-if="drafts[key(item)]!.failed && drafts[key(item)]!.failedStatus !== 'ignored' && drafts[key(item)]!.status !== 'ignored'" type="button" :disabled="disabled || drafts[key(item)]!.saving || drafts[key(item)]!.reviewId !== item.reviewId" @click="save(item)">{{ text('Retry save', 'Erneut speichern') }}</button>
      </article>
      <p v-for="comment in group.comments" :key="comment.id" class="legacy-question">{{ questionPresentation(comment.explanation).text }}</p>
    </section>
  </section>
</template>

<style scoped>
.annotations { margin: 0; }
.question-group + .question-group { margin-top: 28px; }
.question-group h4 { font-size: 14px; margin: 0 0 12px; color: var(--ui-muted, #a6c1b9); }
.annotation-row { margin: 0; padding: 0; min-width: 0; }
.annotation-row + .annotation-row, .legacy-question { margin-top: 24px; }
.annotation-text { margin: 0 0 12px; }
.annotation-text, .legacy-question, blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
.save-error { color: #fecaca; font-size: .85rem; }
blockquote { margin: .6rem 0; border-left: 3px solid #28534e; padding-left: .7rem; }
label { display: flex; flex-direction: column; gap: .3rem; margin: .65rem 0; font-size: .85rem; }
textarea, select, button { font: inherit; border: 1px solid #28534e; border-radius: 7px; padding: .6rem; background: #0b1b25; color: #d1fae5; max-width: 100%; }
textarea { resize: vertical; width: 100%; box-sizing: border-box; }button { cursor: pointer; }button:disabled { opacity: .55; cursor: default; }
@media (max-width: 640px) { .annotation-row { padding: .75rem 0; } }
</style>
