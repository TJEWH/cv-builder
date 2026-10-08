<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationLetter } from '../letterTypes';
import type { DraftingContext, MotivationLetterDraft } from '../draftingTypes';
import type { CvAdjustmentRequestRow, CvAdjustmentResponseRow } from '../cvAdjustmentTypes';
import { createDraftingRepository } from '../composables/cloudDrafting';
import { createCvAdjustmentRepository } from '../composables/cvAdjustments';
import { letterToEditableText } from '../composables/motivationLetters';
import { useToastWatch } from '../composables/useToasts';
const props = defineProps<{ client: SupabaseClient | null; userId: string; applicationId: string; lang: string; letter: ApplicationLetter | null; locked: boolean }>();
const emit = defineEmits<{ restore: [id: string]; keepDraft: [draft: MotivationLetterDraft]; download: [value: unknown, filename: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const unknown = () => text('Unknown', 'Unbekannt');
const instructions = (value?: string) => typeof value === 'string' ? value || text('None supplied', 'Keine übermittelt') : unknown();
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(props.lang === 'de' ? 'de-DE' : 'en-GB') : text('Unknown', 'Unbekannt');
const contexts = ref<DraftingContext[]>([]), drafts = ref<MotivationLetterDraft[]>([]), cvRequests = ref<CvAdjustmentRequestRow[]>([]);
const responses = ref<Record<string, CvAdjustmentResponseRow[]>>({});
const busy = ref(false), error = ref('');
useToastWatch(() => error.value, { tone: 'error' });
let disposed = false;
const letters = createDraftingRepository(props.client, () => disposed ? null : props.userId);
const cvs = createCvAdjustmentRepository(props.client, () => disposed ? null : props.userId);
async function refresh() {
  if (busy.value || !props.client) return;
  busy.value = true; error.value = '';
  try {
    const results = await Promise.allSettled([letters.listContexts(props.applicationId), letters.listDrafts(props.applicationId), cvs.listRequests(props.applicationId)]);
    if (disposed) return;
    const [contextResult, draftResult, cvResult] = results;
    if (contextResult.status === 'fulfilled') contexts.value = contextResult.value;
    if (draftResult.status === 'fulfilled') drafts.value = draftResult.value;
    if (cvResult.status === 'fulfilled') cvRequests.value = cvResult.value;
    if (results.some(result => result.status === 'rejected')) error.value = text('Some legacy history could not be loaded. Saved documents are unchanged. Refresh to retry.', 'Ein Teil des früheren Verlaufs konnte nicht geladen werden. Gespeicherte Dokumente sind unverändert. Erneut aktualisieren.');
  } finally { busy.value = false; }
}
async function loadResponses(id: string) {
  if (!props.client || busy.value || !cvRequests.value.some(row => row.id === id)) return;
  busy.value = true; error.value = '';
  try { const result = await cvs.listResponses(id); if (!disposed) responses.value = { ...responses.value, [id]: result }; }
  catch { if (!disposed) error.value = text('Earlier CV proposals could not be loaded. Refresh to retry.', 'Frühere CV-Vorschläge konnten nicht geladen werden. Erneut aktualisieren.'); }
  finally { busy.value = false; }
}
const originalContext = (id: string) => contexts.value.find(row => row.id === id);
onMounted(refresh);
onBeforeUnmount(() => { disposed = true; });
</script>
<template>
  <section class="legacy-history">
    <h4>{{ text('Earlier CV tailoring & letter drafts', 'Frühere CV-Anpassungen & Briefentwürfe') }}</h4>
    <p class="app-hint">{{ text('These saved records remain available. Start new requests in the shared refinement workflow. Missing historical versions are unknown; viewing history never changes working documents.', 'Diese gespeicherten Datensätze bleiben verfügbar. Neue Anfragen im gemeinsamen Überarbeitungsablauf beginnen. Fehlende historische Versionen sind unbekannt; das Ansehen ändert keine Arbeitsfassung.') }}</p>
    <button type="button" :disabled="busy || !client" @click="refresh">{{ busy ? text('Loading…', 'Laden…') : text('Refresh earlier history', 'Früheren Verlauf aktualisieren') }}</button>
    <details class="disclosure-row" v-for="context in contexts" :key="context.id"><summary>{{ text('Letter request', 'Briefanfrage') }} · {{ date(context.created_at) }}</summary><p>{{ context.id }}</p><p>CV: {{ context.context_json.cv.snapshotId || text('Unknown', 'Unbekannt') }} · r{{ context.context_json.cv.revision ?? text('Unknown', 'Unbekannt') }}</p><p>{{ text('Template', 'Vorlage') }}: {{ context.context_json.template.name || unknown() }} · r{{ context.context_json.template.revision ?? unknown() }}</p><p>{{ text('Letter source / prompt version: Unknown', 'Briefquelle / Prompt-Version: Unbekannt') }}</p><p>{{ text('Approved additional instructions', 'Freigegebene zusätzliche Hinweise') }}: {{ instructions(context.context_json.instructions) }}</p><button type="button" @click="emit('download', context, 'legacy-letter-request-' + context.id + '.json')">{{ text('Export request', 'Anfrage exportieren') }}</button></details>
    <details class="disclosure-row" v-for="draft in drafts" :key="draft.id"><summary>{{ text('Letter draft', 'Briefentwurf') }} · {{ date(draft.created_at) }}</summary><p>{{ text('Proposal', 'Vorschlag') }}: {{ draft.id }}<br />{{ text('Request', 'Anfrage') }}: {{ draft.context_id }}</p><p>{{ text('Template revision', 'Vorlagenrevision') }}: {{ originalContext(draft.context_id)?.context_json.template.revision ?? text('Unknown', 'Unbekannt') }}</p><pre>{{ draft.body }}</pre><button type="button" :disabled="!letter || letter.revisions.some(item => item.cloudDraftId === draft.id)" @click="emit('keepDraft', draft)">{{ text('Keep in local draft history', 'Im lokalen Entwurfsverlauf behalten') }}</button><button type="button" @click="emit('download', draft, 'legacy-letter-draft-' + draft.id + '.json')">{{ text('Export draft', 'Entwurf exportieren') }}</button></details>
    <details class="disclosure-row" v-for="request in cvRequests" :key="request.id"><summary>{{ text('CV request', 'CV-Anfrage') }} · {{ date(request.created_at) }}</summary><p>{{ request.id }}</p><p>{{ text('Source document / template / prompt versions: Unknown', 'Quelldokument- / Vorlagen- / Prompt-Versionen: Unbekannt') }}</p><p>{{ text('Approved additional instructions', 'Freigegebene zusätzliche Hinweise') }}: {{ instructions(request.request_json.instructions) }}</p><details class="disclosure-row"><summary>{{ text('Public source', 'Öffentliche Quelle') }}</summary><pre>{{ JSON.stringify(request.request_json, null, 2) }}</pre></details><button type="button" @click="emit('download', request.request_json, 'legacy-cv-request-' + request.id + '.json')">{{ text('Export request', 'Anfrage exportieren') }}</button><button type="button" :disabled="busy" @click="loadResponses(request.id)">{{ text('Load earlier proposals', 'Frühere Vorschläge laden') }}</button><p v-if="responses[request.id]?.length === 0" class="app-hint">{{ text('No earlier proposals.', 'Keine früheren Vorschläge.') }}</p><article v-for="response in responses[request.id]" :key="response.id"><p>{{ response.id }} · {{ date(response.created_at) }}</p><p class="app-hint">{{ text('Archived wording proposal. Private source mappings are not verified in this archive view; it cannot be applied here.', 'Archivierter Wortlautvorschlag. Private Quellzuordnungen werden in dieser Archivansicht nicht geprüft; er kann hier nicht übernommen werden.') }}</p><pre>{{ JSON.stringify(response.response_json, null, 2) }}</pre><button type="button" @click="emit('download', response.response_json, 'legacy-cv-proposal-' + response.id + '.json')">{{ text('Export proposal', 'Vorschlag exportieren') }}</button></article></details>
    <details class="disclosure-row" v-if="letter?.revisions.length"><summary>{{ text('Local letter drafts & revisions', 'Lokale Briefentwürfe & Revisionen') }} ({{ letter.revisions.length }})</summary><details class="disclosure-row" v-for="revision in [...letter.revisions].reverse()" :key="revision.id"><summary>{{ revision.kind }} · {{ date(revision.createdAt) }}</summary><p>{{ revision.id }}</p><p>{{ text('Source context', 'Quellkontext') }}: {{ revision.cloudContextId || text('Unknown', 'Unbekannt') }}</p><pre>{{ letterToEditableText(revision.content) }}</pre><button type="button" :disabled="locked" @click="emit('restore', revision.id)">{{ text('Restore as working draft', 'Als Arbeitsfassung wiederherstellen') }}</button></details></details>
  </section>
</template>
<style scoped>
.legacy-history{border-top:1px solid #28534e;margin-top:16px;padding-top:8px;font-size:13px;overflow-wrap:anywhere}article{margin:12px 0}p{white-space:pre-wrap;line-height:1.5}pre{max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}button{font:inherit;color:inherit;border:1px solid #28534e;background:#0b1b25;border-radius:6px;padding:8px;margin:4px 8px 4px 0;cursor:pointer}button:disabled{opacity:.5}h4{font-size:14px}article{border-left:2px solid #28534e;padding-left:12px}
</style>
