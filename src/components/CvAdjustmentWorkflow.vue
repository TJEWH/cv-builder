<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState } from '../types';
import type { LocalCvAdjustmentRequest } from '../cvAdjustmentTypes';
import { prepareCvAdjustment, reconstructCvAdjustment, createCvAdjustmentRepository, buildCvAdjustmentPrompt } from '../composables/cvAdjustments';
import { cvDifferences } from '../composables/applicationCv';

const props = defineProps<{
  state: CvState; variantId: string; applicationId: string; opportunity: Record<string, unknown>;
  client: SupabaseClient | null; userId: string; lang: string;
}>();
const emit = defineEmits<{ apply: [state: CvState] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const instructions = ref('');
const request = ref<LocalCvAdjustmentRequest | null>(null);
const responseText = ref('');
const reviewed = ref<ReturnType<typeof reconstructCvAdjustment> | null>(null);
const published = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const storageKey = `CV_ADJUSTMENT_REQUEST:1:${encodeURIComponent(props.userId)}:${encodeURIComponent(props.applicationId)}:${encodeURIComponent(props.variantId)}`;
const repository = () => {
  if (!props.client) throw new Error(text('Sign in to publish or retrieve adjustments.', 'Melde dich zum Veröffentlichen oder Abrufen der Anpassungen an.'));
  return createCvAdjustmentRepository(props.client, () => props.userId);
};
type ResponseRow = Awaited<ReturnType<ReturnType<typeof createCvAdjustmentRepository>['listResponses']>>[number];
const responses = ref<ResponseRow[]>([]);
const prompt = computed(() => request.value ? buildCvAdjustmentPrompt(request.value.publicRequest) : '');
const changes = computed(() => reviewed.value ? cvDifferences(props.state, reviewed.value.state) : []);
const fileInput = ref<HTMLInputElement | null>(null);
let disposed = false;
let importSequence = 0;
const urls = new Set<string>();
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (stored?.request?.sourceVariantId === props.variantId && stored.request.publicRequest?.schemaVersion === 1) {
    request.value = stored.request; published.value = stored.published === true;
  }
} catch { /* A new request can always be prepared if a local draft is unreadable. */ }
function saveRequest(value: LocalCvAdjustmentRequest, isPublished: boolean) {
  localStorage.setItem(storageKey, JSON.stringify({ request: value, published: isPublished }));
}
function prepare() {
  try {
    const next = prepareCvAdjustment({ state: props.state, variantId: props.variantId, applicationId: props.applicationId, opportunity: props.opportunity, instructions: instructions.value });
    saveRequest(next, false);
    importSequence++; request.value = next; published.value = false; responseText.value = ''; reviewed.value = null; responses.value = [];
    error.value = ''; notice.value = text('Privacy snapshot prepared. Review it before sharing.', 'Datenschutz-Snapshot vorbereitet. Prüfe ihn vor dem Teilen.');
  } catch (cause) { error.value = String(cause); }
}
async function publish() {
  if (!request.value || busy.value) return;
  busy.value = true; error.value = '';
  const target = request.value;
  try {
    // Store the private reconstruction baseline locally before any cloud write.
    saveRequest(target, published.value);
    await repository().publishRequest(target.publicRequest, props.applicationId);
    if (disposed || request.value !== target) return;
    saveRequest(target, true); published.value = true;
    notice.value = text('Privacy snapshot published. ChatGPT can read this request through your configured Supabase connection.', 'Datenschutz-Snapshot veröffentlicht. ChatGPT kann diese Anfrage über deine konfigurierte Supabase-Verbindung lesen.');
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (!disposed) busy.value = false; }
}
async function refresh() {
  if (!request.value || busy.value) return;
  const id = request.value.publicRequest.requestId;
  busy.value = true; error.value = '';
  try {
    const result = await repository().listResponses(id);
    if (disposed || id !== request.value?.publicRequest.requestId) return;
    responses.value = result;
    if (!result.length) notice.value = text('No returned adjustments yet. You can also paste ChatGPT’s JSON below.', 'Noch keine Anpassungen vorhanden. Du kannst ChatGPTs JSON auch unten einfügen.');
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (!disposed) busy.value = false; }
}
function reconstruct() {
  if (!request.value || request.value.sourceVariantId !== props.variantId) throw new Error('Prepare a request for the selected variant first.');
  return reconstructCvAdjustment(request.value, responseText.value, props.state);
}
function review() {
  reviewed.value = null; error.value = ''; notice.value = '';
  try {
    reviewed.value = reconstruct();
    if (!reviewed.value.changed) notice.value = text('No adjustments were returned. The selected variant is used unchanged.', 'Es wurden keine Anpassungen zurückgegeben. Die ausgewählte Variante wird unverändert verwendet.');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function apply() {
  try {
    const result = reconstruct();
    if (!result.changed) { reviewed.value = result; return; }
    emit('apply', result.state);
  } catch (cause) { reviewed.value = null; error.value = cause instanceof Error ? cause.message : String(cause); }
}
function responseEdited() { importSequence++; reviewed.value = null; }
function useResponse(row: ResponseRow) { importSequence++; responseText.value = JSON.stringify(row.response_json, null, 2); review(); }
async function copyPrompt() {
  try { await navigator.clipboard.writeText(prompt.value); notice.value = text('ChatGPT instructions copied.', 'ChatGPT-Anleitung kopiert.'); }
  catch { error.value = text('Copy the instructions from the text field below.', 'Kopiere die Anleitung aus dem Textfeld unten.'); }
}
function downloadPrompt() {
  const url = URL.createObjectURL(new Blob([prompt.value], { type: 'text/plain' })); urls.add(url);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cv-adjustment-request.txt'; anchor.click();
}
async function importResponse(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  const sequence = ++importSequence;
  const previousText = responseText.value;
  const id = request.value?.publicRequest.requestId;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('The response file is too large.');
    const content = await file.text();
    if (disposed || sequence !== importSequence || previousText !== responseText.value || id !== request.value?.publicRequest.requestId) return;
    responseText.value = content; review();
  } catch (cause) { if (!disposed) error.value = String(cause); }
}
onBeforeUnmount(() => { disposed = true; for (const url of urls) URL.revokeObjectURL(url); });
</script>

<template>
  <section class="cv-adjustment-workflow">
    <h2>{{ text('Tailor with ChatGPT', 'Mit ChatGPT anpassen') }}</h2>
    <p>{{ text('Share an anonymized snapshot, then review the returned wording. Your private details and layout are restored locally. Accepted changes become a subvariant; an unchanged response keeps the selected variant.', 'Teile einen anonymisierten Snapshot und prüfe die zurückgegebenen Formulierungen. Private Angaben und Layout werden lokal wiederhergestellt. Akzeptierte Änderungen werden zu einer Untervariante; ohne Änderungen bleibt die ausgewählte Variante bestehen.') }}</p>
    <label>{{ text('Adjustment instructions', 'Hinweise zur Anpassung') }}<textarea v-model="instructions" rows="3" maxlength="4000" :placeholder="text('Emphasize experience relevant to this opportunity…', 'Relevante Erfahrung für diese Stelle hervorheben…')" /></label>
    <button type="button" class="btn" :disabled="busy" @click="prepare">{{ text('Prepare privacy snapshot', 'Datenschutz-Snapshot vorbereiten') }}</button>
    <p v-if="error" role="alert" class="adjustment-error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="request">
      <details><summary>{{ text('Review snapshot & ChatGPT instructions', 'Snapshot & ChatGPT-Anleitung prüfen') }}</summary><textarea :value="prompt" readonly rows="12" :aria-label="text('ChatGPT instructions and privacy snapshot', 'ChatGPT-Anleitung und Datenschutz-Snapshot')" /></details>
      <div class="adjustment-actions"><button type="button" class="btn" :disabled="busy || published || !client" @click="publish">{{ published ? text('Published to Supabase', 'In Supabase veröffentlicht') : text('Publish snapshot to Supabase', 'Snapshot in Supabase veröffentlichen') }}</button><button type="button" class="btn" @click="copyPrompt">{{ text('Copy ChatGPT instructions', 'ChatGPT-Anleitung kopieren') }}</button><button type="button" class="btn" @click="downloadPrompt">{{ text('Download instructions', 'Anleitung herunterladen') }}</button></div>
      <p class="adjustment-hint">{{ text('Publishing does not run ChatGPT. Use a configured Supabase connection to read the request and an authenticated Action to return it, or paste the returned JSON here. The private reconstruction data stays in this browser.', 'Das Veröffentlichen führt ChatGPT nicht aus. Lies die Anfrage über eine konfigurierte Supabase-Verbindung und gib sie über eine authentifizierte Action zurück, oder füge das zurückgegebene JSON hier ein. Die privaten Wiederherstellungsdaten bleiben in diesem Browser.') }}</p>
      <button type="button" class="btn" :disabled="busy || !published || !client" @click="refresh">{{ text('Refresh returned adjustments', 'Anpassungen abrufen') }}</button>
      <ul v-if="responses.length" class="response-list"><li v-for="row in responses" :key="row.id"><button type="button" class="btn" @click="useResponse(row)">{{ text('Review response', 'Antwort prüfen') }} · {{ new Date(row.created_at).toLocaleString() }}</button></li></ul>
      <label>{{ text('Returned adjustment JSON', 'Zurückgegebenes Anpassungs-JSON') }}<textarea v-model="responseText" rows="6" @input="responseEdited" /></label>
      <div class="adjustment-actions"><button type="button" class="btn" :disabled="!responseText.trim()" @click="review">{{ text('Review changes', 'Änderungen prüfen') }}</button><button type="button" class="btn" @click="fileInput?.click()">{{ text('Import response', 'Antwort importieren') }}</button><input ref="fileInput" type="file" hidden accept="application/json,.json,.txt" @change="importResponse" /></div>
      <template v-if="reviewed?.changed"><p>{{ reviewed.changedFieldCount }} {{ text('fields adjusted. Review before creating a subvariant.', 'Felder angepasst. Vor dem Erstellen einer Untervariante prüfen.') }}</p><ul class="change-list"><li v-for="change in changes" :key="change.label"><strong>{{ change.label }}</strong><del>{{ change.before }}</del><ins>{{ change.after }}</ins></li></ul><button type="button" class="btn btn--success" @click="apply">{{ text('Accept as subvariant', 'Als Untervariante übernehmen') }}</button></template>
    </template>
  </section>
</template>

<style scoped>
.cv-adjustment-workflow{display:grid;gap:12px;min-width:0;padding:0;margin-top:24px;color:#d1fae5}
h2{margin:0;font-size:18px;color:inherit}p{margin:0;font-size:13px;line-height:1.6;color:#adc8be}
label{display:grid;gap:6px;font-size:13px}textarea{width:100%;min-width:0;resize:vertical}
.cv-adjustment-workflow>.btn{justify-self:start}.adjustment-actions{display:flex;flex-wrap:wrap;gap:8px}
summary{cursor:pointer;font-size:13px;color:#9ee6c7;margin-bottom:8px}.adjustment-error{color:#fecaca}
.adjustment-hint{font-size:12px}.response-list,.change-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.change-list li{display:grid;gap:6px;font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}.change-list del{color:#f0b3b3}.change-list ins{color:#a3e3c3;text-decoration:none}
</style>
