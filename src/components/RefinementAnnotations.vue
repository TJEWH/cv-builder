<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue';
import type { AnnotationStatus } from '../refinementTypes';
import type { AnnotationView } from '../composables/refinementAnnotations';
import { useToasts } from '../composables/useToasts';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
const props = defineProps<{
  items: Item[]; lang: string; disabled: boolean;
  save: (id: string, status: AnnotationStatus, response: string, previousReviewId: string | null) => Promise<boolean>;
  privacyPreview: (value: string) => string;
}>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const { notify, dismiss } = useToasts();
const drafts = reactive<Record<string, { status: AnnotationStatus; response: string; reviewId: string | null; savedStatus: AnnotationStatus; savedResponse: string; saving: boolean; failed: boolean }>>({});
const key = (item: Item) => `${item.proposalId}:${item.annotation.id}`;
const dirty = (item: Item) => { const d = drafts[key(item)]; return !!d && (d.status !== d.savedStatus || d.response !== d.savedResponse); };
function reset(item: Item) {
  drafts[key(item)] = { status: item.status, response: item.response || '', reviewId: item.reviewId, savedStatus: item.status, savedResponse: item.response || '', saving: false, failed: false };
}
watch(() => props.items, items => { for (const item of items) if (!drafts[key(item)] || !dirty(item) && !drafts[key(item)]!.saving && !drafts[key(item)]!.failed) reset(item); }, { immediate: true });
const conflictToasts = new Map<string, number>();
watch(() => props.items.filter(item => drafts[key(item)]?.reviewId !== item.reviewId).map(key), (conflicts, previous) => {
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
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Set<string>();
function schedule(item: Item) {
  clearTimeout(timers.get(key(item)));
  if (drafts[key(item)]!.status === 'resolved') timers.set(key(item), setTimeout(() => { void save(item); }, 400));
}
watch(() => props.disabled, disabled => {
  if (!disabled) for (const id of [...pending]) {
    const item = props.items.find(value => key(value) === id);
    pending.delete(id); if (item) void save(item);
  }
});
onBeforeUnmount(() => {
  for (const timer of timers.values()) clearTimeout(timer);
  for (const id of conflictToasts.values()) dismiss(id);
});
async function save(item: Item) {
  clearTimeout(timers.get(key(item)));
  const d = drafts[key(item)]!;
  if (props.disabled) { pending.add(key(item)); return; }
  if (d.saving || d.reviewId !== item.reviewId) return;
  d.saving = true; d.failed = false;
  const status = d.status, response = d.response;
  try {
    const saved = await props.save(item.annotation.id, status, response, d.reviewId);
    const current = props.items.find(value => key(value) === key(item));
    if (current && (saved || current.status === status && (current.response || '') === props.privacyPreview(response).trim())) reset(current);
    drafts[key(item)]!.failed = !saved;
  } finally { drafts[key(item)]!.saving = false; }
}
const typeLabel = (type: string) => type === 'question' ? text('Question', 'Frage') : type === 'todo' ? 'ToDo' : text('Comment', 'Kommentar');
</script>

<template>
  <section v-if="items.length" class="annotations" :aria-label="text('CV and letter annotations', 'Anmerkungen zu CV und Brief')">
    <h3>{{ text('Comments', 'Kommentare') }}</h3>
    <p class="app-hint">{{ text('Resolve a comment to save your response and use it as feedback. Dismissed comments are ignored.', 'Einen Kommentar erledigen, um die Antwort zu speichern und als Feedback zu verwenden. Verworfene Kommentare werden ignoriert.') }}</p>
    <article v-for="item in items" :key="key(item)" :data-annotation-id="item.annotation.id" :aria-busy="drafts[key(item)]!.saving">
      <header><strong>{{ typeLabel(item.annotation.type) }}</strong><span class="status">{{ item.status === 'open' ? text('Open', 'Offen') : item.status === 'resolved' ? text('Resolved', 'Erledigt') : text('Dismissed', 'Verworfen') }}</span></header>
      <p class="target">{{ item.target }}</p>
      <p class="annotation-text">{{ item.annotation.text }}</p>
      <template v-if="item.annotation.document === 'letter' && item.annotation.location">
        <p v-if="item.referenceChanged" class="app-hint">{{ text('Referenced text has changed', 'Referenzierter Text wurde geändert') }}</p>
        <details class="disclosure-row"><summary>{{ text('Original text reference', 'Ursprünglicher Textbezug') }}</summary><blockquote>{{ item.annotation.location.quote }}</blockquote></details>
      </template>
      <label v-if="drafts[key(item)]!.status !== 'dismissed'">{{ text('Your response (optional)', 'Deine Antwort (optional)') }}<textarea v-model="drafts[key(item)]!.response" @input="schedule(item)" rows="3" maxlength="12000" :disabled="disabled" /></label>
      <label>{{ text('Annotation status', 'Status der Anmerkung') }}<select v-model="drafts[key(item)]!.status" :disabled="disabled" @change="save(item)"><option value="open">{{ text('Open', 'Offen') }}</option><option value="resolved">{{ text('Resolved', 'Erledigt') }}</option><option value="dismissed">{{ text('Dismissed', 'Verworfen') }}</option></select></label>
      <p v-if="drafts[key(item)]!.reviewId !== item.reviewId" class="app-hint">{{ text('Load the saved annotation before continuing.', 'Vor dem Fortfahren die gespeicherte Anmerkung laden.') }} <button type="button" :disabled="disabled" @click="reset(item)">{{ text('Load saved annotation', 'Gespeicherte Anmerkung laden') }}</button></p>
      <p class="app-hint">{{ item.status === 'dismissed' ? text('Ignored', 'Wird ignoriert') : item.included ? text('Included as feedback', 'Als Feedback enthalten') : text('Resolve to include your response as feedback.', 'Erledigen, um die Antwort als Feedback zu übernehmen.') }}</p>
      <button v-if="drafts[key(item)]!.failed" type="button" :disabled="disabled || drafts[key(item)]!.saving || drafts[key(item)]!.reviewId !== item.reviewId" @click="save(item)">{{ text('Retry save', 'Erneut speichern') }}</button>
    </article>
  </section>
</template>

<style scoped>
.annotations { border-top: 1px solid #28534e; margin-top: 1.2rem; padding-top: .6rem; }
article { border: 1px solid #28534e; border-radius: 10px; margin: .8rem 0; padding: 1rem; min-width: 0; }
header { display: flex; gap: .7rem; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; }.status { font-size: .8rem; border-radius: 12px; background: #185b4c; color: #d1fae5; padding: .2rem .6rem; }
.target { font-size: .86rem; color: #a6c1b9; }.annotation-text, blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
blockquote { margin: .6rem 0; border-left: 3px solid #28534e; padding-left: .7rem; }
label { display: flex; flex-direction: column; gap: .3rem; margin: .65rem 0; font-size: .85rem; }
textarea, select, button { font: inherit; border: 1px solid #28534e; border-radius: 7px; padding: .6rem; background: #0b1b25; color: #d1fae5; max-width: 100%; }
textarea { resize: vertical; width: 100%; box-sizing: border-box; }button { cursor: pointer; }button:disabled { opacity: .55; cursor: default; }
@media (max-width: 640px) { article { padding: .75rem; } }
</style>
