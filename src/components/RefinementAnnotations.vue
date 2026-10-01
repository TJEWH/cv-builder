<script setup lang="ts">
import { reactive, watch } from 'vue';
import type { AnnotationStatus } from '../refinementTypes';
import type { AnnotationView } from '../composables/refinementAnnotations';
import { annotationFeedback } from '../composables/refinementAnnotations';
import PrivacyTextPreview from './PrivacyTextPreview.vue';

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
const props = defineProps<{
  items: Item[]; lang: string; disabled: boolean;
  save: (id: string, status: AnnotationStatus, response: string, previousReviewId: string | null) => Promise<boolean>;
  include: (id: string) => Promise<void>;
  privacyPreview: (value: string) => string;
}>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const drafts = reactive<Record<string, { status: AnnotationStatus; response: string; reviewId: string | null; savedStatus: AnnotationStatus; savedResponse: string }>>({});
const key = (item: Item) => `${item.proposalId}:${item.annotation.id}`;
const dirty = (item: Item) => { const d = drafts[key(item)]; return !!d && (d.status !== d.savedStatus || d.response !== d.savedResponse); };
function reset(item: Item) {
  drafts[key(item)] = { status: item.status, response: item.response || '', reviewId: item.reviewId, savedStatus: item.status, savedResponse: item.response || '' };
}
watch(() => props.items, items => { for (const item of items) if (!drafts[key(item)] || !dirty(item)) reset(item); }, { immediate: true });
async function save(item: Item) {
  const d = drafts[key(item)]!;
  if (await props.save(item.annotation.id, d.status, d.response, d.reviewId)) {
    const current = props.items.find(value => key(value) === key(item));
    if (current) reset(current);
  }
}
const typeLabel = (type: string) => type === 'question' ? text('Question', 'Frage') : type === 'todo' ? 'ToDo' : text('Comment', 'Kommentar');
</script>

<template>
  <section v-if="items.length" class="annotations" :aria-label="text('CV and letter annotations', 'Anmerkungen zu CV und Brief')">
    <h3>{{ text('Annotations', 'Anmerkungen') }}</h3>
    <p class="hint">{{ text('Notes and answers stay outside both documents and PDFs. Save a response or status here; include it as feedback when useful for a later round.', 'Anmerkungen und Antworten bleiben außerhalb beider Dokumente und PDFs. Antwort oder Status hier speichern und bei Bedarf als Feedback für eine spätere Runde einbeziehen.') }}</p>
    <article v-for="item in items" :key="key(item)" :data-annotation-id="item.annotation.id">
      <header><strong>{{ typeLabel(item.annotation.type) }}</strong><span class="status">{{ item.status === 'open' ? text('Open', 'Offen') : item.status === 'resolved' ? text('Resolved', 'Erledigt') : text('Dismissed', 'Verworfen') }}</span></header>
      <p class="target">{{ item.target }}</p>
      <p class="annotation-text">{{ item.annotation.text }}</p>
      <template v-if="item.annotation.document === 'letter' && item.annotation.location">
        <p v-if="item.referenceChanged" class="reference-warning" role="status">{{ text('Referenced text has changed', 'Referenzierter Text wurde geändert') }}</p>
        <details><summary>{{ text('Original text reference', 'Ursprünglicher Textbezug') }}</summary><blockquote>{{ item.annotation.location.quote }}</blockquote></details>
      </template>
      <label>{{ text('Your response (optional)', 'Deine Antwort (optional)') }}<textarea v-model="drafts[key(item)]!.response" rows="3" maxlength="12000" :disabled="disabled" /></label>
      <details v-if="drafts[key(item)]!.response.trim()"><summary>{{ text('Outgoing response privacy preview', 'Datenschutzvorschau der ausgehenden Antwort') }}</summary><PrivacyTextPreview :value="privacyPreview(drafts[key(item)]!.response)" :lang="lang" /></details>
      <label>{{ text('Annotation status', 'Status der Anmerkung') }}<select v-model="drafts[key(item)]!.status" :disabled="disabled"><option value="open">{{ text('Open', 'Offen') }}</option><option value="resolved">{{ text('Resolved', 'Erledigt') }}</option><option value="dismissed">{{ text('Dismissed', 'Verworfen') }}</option></select></label>
      <p v-if="drafts[key(item)]!.reviewId !== item.reviewId" role="alert">{{ text('This annotation changed elsewhere. Your unsaved response is retained; reload the saved annotation before editing again.', 'Diese Anmerkung wurde andernorts geändert. Deine ungespeicherte Antwort bleibt erhalten; vor weiteren Änderungen den gespeicherten Stand laden.') }} <button type="button" :disabled="disabled" @click="reset(item)">{{ text('Load saved annotation', 'Gespeicherte Anmerkung laden') }}</button></p>
      <div class="actions"><button type="button" :disabled="disabled || !dirty(item) || drafts[key(item)]!.reviewId !== item.reviewId" @click="save(item)">{{ text('Save annotation', 'Anmerkung speichern') }}</button><button type="button" :disabled="disabled || dirty(item) || item.included || (item.status !== 'open' && !item.response)" @click="include(item.annotation.id)">{{ item.included ? text('Included in feedback', 'Im Feedback enthalten') : text('Include as feedback', 'Als Feedback einbeziehen') }}</button></div>
      <details v-if="!dirty(item) && !item.included"><summary>{{ text('Feedback to include — privacy preview', 'Einzubeziehendes Feedback — Datenschutzvorschau') }}</summary><PrivacyTextPreview :value="privacyPreview(annotationFeedback(item))" :lang="lang" /></details>
    </article>
  </section>
</template>

<style scoped>
.annotations { border-top: 1px solid #28534e; margin-top: 1.2rem; padding-top: .6rem; }
article { border: 1px solid #28534e; border-radius: 10px; margin: .8rem 0; padding: 1rem; min-width: 0; }
header, .actions { display: flex; gap: .7rem; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; }.status { font-size: .8rem; border-radius: 12px; background: #185b4c; color: #d1fae5; padding: .2rem .6rem; }
.hint, .target { font-size: .86rem; color: #a6c1b9; }.annotation-text, blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
blockquote { margin: .6rem 0; border-left: 3px solid #28534e; padding-left: .7rem; }.reference-warning { color: #efcc87; background: #302b1a; padding: .5rem; border-radius: 6px; }
label { display: flex; flex-direction: column; gap: .3rem; margin: .65rem 0; font-size: .85rem; }
textarea, select, button { font: inherit; border: 1px solid #28534e; border-radius: 7px; padding: .6rem; background: #0b1b25; color: #d1fae5; max-width: 100%; }
textarea { resize: vertical; width: 100%; box-sizing: border-box; }button { cursor: pointer; }button:disabled { opacity: .55; cursor: default; }
@media (max-width: 640px) { .actions { align-items: stretch; flex-direction: column; }article { padding: .75rem; } }
</style>
