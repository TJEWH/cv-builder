<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfiguration } from '../lib/supabase';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft, faChevronDown, faClock, faCopy, faGlobe, faPlus, faSliders, faUser } from '@fortawesome/free-solid-svg-icons';
import type { SearchTemplate, SearchTemplateCloudBinding } from '../searchTypes';
import { createSearchTemplateRepository, createSearchProfile, readSearchTemplate, searchTemplateContentKey } from '../composables/useSearchTemplates';
import { buildReplaceSearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt, isSearchTemplateSaved } from '../composables/searchPrompts';
import { listCloudSearchTemplates, importCloudSearchTemplate, saveSearchTemplate } from '../composables/searchTemplateCloud';
import { commitPendingTextareas } from '../composables/textareaCommit';
import { copyPreparedText } from '../composables/preparedClipboard';
import { clearSearchDraft, recoverSearchDraft, retainSearchDraft } from '../composables/searchTemplateRecovery';
import { useDesktopSidebar } from '../composables/desktopSidebar';
import { useToastWatch } from '../composables/useToasts';
import AutosaveTextarea from './AutosaveTextarea.vue';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import InfoHint from './InfoHint.vue';

const props = withDefaults(defineProps<{ userId: string; lang?: string; sidebarActive?: boolean; projectId?: string; client?: SupabaseClient | null }>(), { sidebarActive: true });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const controlsId = useId();
const desktopSidebar = useDesktopSidebar();
const connectedProjectId = computed(() => props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0] : undefined));
const form = ref<SearchTemplate | null>(null);
const profileId = ref('');
const profile = computed(() => form.value?.profiles.find(item => item.id === profileId.value));
const enabledCount = computed(() => form.value?.profiles.filter(item => item.enabled).length || 0);
const status = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
const error = ref('');
const notice = ref('');
const loadingCloud = ref(false);
const loadError = ref(false);
const copying = ref(false);
const copiedFallback = ref('');
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => notice.value, { tone: 'success' });
let editingOwner = props.userId;
let baseline: SearchTemplate | null = null;
let binding: SearchTemplateCloudBinding | undefined;
let dirty = false;
let replacing = false;
let disposed = false;
let ownerGeneration = 0;
let typingVersion = 0;
let modelVersion = 0;
let committedTypingVersion = 0;
let navigationRequest = 0;
let ready: Promise<void> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();
let pending: Promise<boolean> | null = null;
let pendingKey: string | null = null;
let failedWrite: SearchTemplate | null = null;
const repository = () => createSearchTemplateRepository(localStorage, editingOwner);
function replace(value: SearchTemplate | null) {
  replacing = true; form.value = value ? clone(value) : null; baseline = value ? clone(value) : null;
  dirty = false; replacing = false; committedTypingVersion = typingVersion;
  if (!value?.profiles.some(item => item.id === profileId.value)) profileId.value = value?.profiles[0]?.id || '';
}
function onDraftInput() { typingVersion++; status.value = 'unsaved'; notice.value = ''; copiedFallback.value = ''; }
function patchBinding(value: SearchTemplateCloudBinding) {
  binding = clone(value);
  replacing = true;
  if (form.value) form.value.cloud = clone(value);
  if (baseline) baseline.cloud = clone(value);
  replacing = false;
}
async function initialize(owner: string, token: number) {
  const client = props.client;
  if (!client) throw new Error(text('Connect Supabase to save the meta search.', 'Verbinde Supabase, um die Metasuche zu speichern.'));
  const version = typingVersion; const initialModelVersion = modelVersion;
  const initial = form.value;
  const hasLocal = !!localStorage.getItem(`cv.search-templates.v1:${encodeURIComponent(owner || 'local')}`);
  const localPending = !!recoverSearchDraft(owner) || !!initial && (initial.cloud ? !isSearchTemplateSaved(initial) : hasLocal);
  loadingCloud.value = true;
  try {
    const rows = await listCloudSearchTemplates(client, owner);
    if (disposed || token !== ownerGeneration) return;
    const row = initial?.cloud ? rows.find(item => item.id === initial.cloud!.id) : rows.find(item => item.meta_search?.version === 1) || rows[0];
    if (initial?.cloud && !row) throw new Error('The saved meta search is unavailable. Your local draft is retained.');
    if (row) {
      const saved = importCloudSearchTemplate(row);
      binding = saved.cloud;
      if (!localPending && !dirty && typingVersion === version && modelVersion === initialModelVersion) {
        replace(saved);
        const stored = repository().saveTemplate(saved, null);
        baseline = clone(stored);
        replacing = true; form.value = clone(stored); replacing = false;
      } else if (saved.cloud) patchBinding({ ...saved.cloud, contentKey: initial?.cloud?.contentKey || '' });
    }
    status.value = form.value && isSearchTemplateSaved(form.value) && typingVersion === committedTypingVersion ? 'saved' : 'unsaved';
  } finally { if (token === ownerGeneration) loadingCloud.value = false; }
}
function commitSnapshot(): Promise<boolean> {
  if (!form.value) return Promise.resolve(false);
  const owner = editingOwner; const token = ownerGeneration; const inputVersion = typingVersion;
  let snapshot: SearchTemplate;
  try {
    snapshot = repository().saveTemplate(readSearchTemplate(form.value), baseline);
    baseline = clone(snapshot);
    replacing = true; form.value = clone(snapshot); replacing = false;
    dirty = false; committedTypingVersion = inputVersion;
  } catch (cause) {
    retainSearchDraft(owner, form.value, baseline);
    error.value = cause instanceof Error ? cause.message : String(cause); status.value = 'error';
    return Promise.resolve(false);
  }
  const key = searchTemplateContentKey(snapshot);
  if (pending && pendingKey === key) return pending;
  if (!pending && !failedWrite && isSearchTemplateSaved(snapshot)) { status.value = 'saved'; return Promise.resolve(true); }
  retainSearchDraft(owner, snapshot, baseline);
  const client = props.client;
  const options = { projectId: connectedProjectId.value };
  const initialization = ready;
  status.value = 'saving'; error.value = '';
  const current = () => !disposed && token === ownerGeneration && owner === editingOwner;
  const operation = queue.then(async () => {
    try {
      await initialization;
      if (!current() || !client) return false;
      status.value = 'saving';
      let result: SearchTemplate;
      if (failedWrite) {
        result = await saveSearchTemplate(client, owner, failedWrite, options);
        if (!current()) return false;
        patchBinding(result.cloud!); failedWrite = null;
        if (searchTemplateContentKey(result) !== key) {
          failedWrite = { ...snapshot, cloud: binding }; result = await saveSearchTemplate(client, owner, failedWrite, options);
        }
      } else {
        failedWrite = { ...snapshot, cloud: binding || snapshot.cloud };
        result = await saveSearchTemplate(client, owner, failedWrite, options);
      }
      if (!current()) return false;
      failedWrite = null; patchBinding(result.cloud!);
      // Store only the acknowledgment on the newest local version, preserving newer edits.
      const latest = repository().listTemplates()[0]!;
      if (latest.id === snapshot.id) {
        const stored = repository().saveTemplate({ ...latest, cloud: result.cloud }, latest);
        if (baseline) { baseline.cloud = clone(result.cloud); baseline.revision = stored.revision; baseline.updatedAt = stored.updatedAt; }
      }
      clearSearchDraft(owner, snapshot.id, key);
      const unchanged = !!form.value && searchTemplateContentKey(form.value) === key && typingVersion === inputVersion;
      status.value = unchanged ? 'saved' : 'unsaved'; error.value = '';
      return unchanged;
    } catch (cause) {
      if (current()) { error.value = cause instanceof Error ? cause.message : String(cause); status.value = 'error'; }
      return false;
    }
  }).finally(() => { if (current() && pending === operation) { pending = null; pendingKey = null; } });
  pending = operation; pendingKey = key; queue = operation;
  return operation;
}
function flushSave(): Promise<boolean> {
  commitPendingTextareas();
  if (loadingCloud.value && !dirty) return ready.then(() => commitSnapshot(), () => false);
  return commitSnapshot();
}
async function flushTextareas() {
  const result = await flushSave();
  return result && typingVersion === committedTypingVersion;
}
defineExpose({ flushSave, flushTextareas });
async function selectProfile(id: string) {
  const request = ++navigationRequest; const token = ownerGeneration;
  if (await flushTextareas() && request === navigationRequest && token === ownerGeneration) profileId.value = id;
}
async function addProfile() {
  const token = ownerGeneration;
  if (!await flushTextareas() || token !== ownerGeneration || !form.value) return;
  const added = createSearchProfile(); form.value.profiles.push(added); profileId.value = added.id;
  await flushSave();
}
async function removeProfile() {
  const token = ownerGeneration; const id = profileId.value;
  if (!await flushTextareas() || token !== ownerGeneration || !form.value || profileId.value !== id) return;
  form.value.profiles = form.value.profiles.filter(item => item.id !== id); profileId.value = form.value.profiles[0]?.id || '';
  await flushSave();
}
watch(form, () => {
  if (replacing || !form.value) return;
  modelVersion++;
  dirty = true; status.value = 'unsaved'; notice.value = ''; copiedFallback.value = '';
}, { deep: true, flush: 'sync' });
watch(() => props.userId, id => {
  if (form.value && (dirty || !isSearchTemplateSaved(form.value))) retainSearchDraft(editingOwner, form.value, baseline);
  ownerGeneration++; editingOwner = id; profileId.value = ''; copying.value = false; navigationRequest++;
  pending = null; pendingKey = null; failedWrite = null; binding = undefined; queue = Promise.resolve();
  error.value = ''; notice.value = ''; loadError.value = false; replace(null);
  try {
    const local = repository().listTemplates()[0]!; const recovered = recoverSearchDraft(id);
    replace(recovered?.form || local); baseline = recovered?.baseline || clone(local); binding = local.cloud;
    const token = ownerGeneration;
    ready = initialize(id, token).catch(cause => {
      if (!disposed && token === ownerGeneration) { loadError.value = true; error.value = cause instanceof Error ? cause.message : String(cause); status.value = 'error'; }
      throw cause;
    });
    void ready.catch(() => {});
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); status.value = 'error'; }
}, { immediate: true });
async function retryLoad() {
  const token = ownerGeneration;
  ready = initialize(editingOwner, token);
  try { await ready; loadError.value = false; error.value = ''; await flushSave(); } catch (cause) { loadError.value = true; error.value = cause instanceof Error ? cause.message : String(cause); status.value = 'error'; }
}
function retrySave() { return loadError.value ? retryLoad() : flushSave(); }
const systemPreview = computed(() => { try { return form.value ? buildSearchSystemPrompt(form.value, { projectId: connectedProjectId.value }) : ''; } catch { return ''; } });
const userPreview = computed(() => { try { return form.value ? buildSearchUserPrompt(form.value, { projectId: connectedProjectId.value }) : ''; } catch { return ''; } });
async function copy() {
  if (copying.value) return;
  const token = ownerGeneration; copying.value = true; notice.value = '';
  try {
    const result = await copyPreparedText(async () => {
      if (!await flushTextareas() || !form.value || token !== ownerGeneration || disposed) return null;
      return buildReplaceSearchPrompt(form.value, { projectId: connectedProjectId.value });
    });
    if (!result || disposed || token !== ownerGeneration) return;
    if (result.copied) notice.value = text('Replacement instruction copied. Paste it into ChatGPT to replace the meta-search schedule.', 'Ersetzungsanweisung kopiert. In ChatGPT einfügen, um den Metasuch-Zeitplan zu ersetzen.');
    else { copiedFallback.value = result.value; notice.value = text('Select and copy the instruction below.', 'Die Anweisung unten markieren und kopieren.'); }
  } catch (cause) { if (!disposed && token === ownerGeneration) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (token === ownerGeneration) copying.value = false; }
}
onBeforeUnmount(() => { if (form.value && status.value !== 'saved') retainSearchDraft(editingOwner, form.value, baseline); disposed = true; ownerGeneration++; });
</script>
<template>
  <section class="search-templates">
    <header class="search-heading">
      <h2>{{ text('Meta research', 'Metasuche') }}<InfoHint :lang="lang" :label="text('Meta research', 'Metasuche')" :text="text('One daily search across your professional profiles. Reuse the same professional context and research interests in motivation letters.', 'Eine tägliche Suche über deine beruflichen Profile. Beruflichen Kontext und Forschungsinteressen auch für Motivationsschreiben verwenden.')" /></h2>
    </header>
    <div v-if="error && !form" class="search-load-error" role="alert"><p>{{ error }}</p><button type="button" @click="retryLoad">{{ text('Retry loading search', 'Suche erneut laden') }}</button></div>
    <div class="search-layout" :class="{ 'search-layout--sidebar': desktopSidebar && sidebarActive }">
      <DesktopSidebarPortal area="major" :active="sidebarActive">
        <aside class="search-library" :aria-label="text('Meta research actions', 'Metasuchaktionen')">
          <div class="search-action-row">
            <button class="search-primary" type="button" :disabled="copying || loadingCloud || !client" @click="copy"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" />{{ copying ? text('Preparing…', 'Vorbereiten…') : text('Copy replace prompt', 'Ersetzungsanweisung kopieren') }}</button>
            <InfoHint :lang="lang" :label="text('Replace meta search', 'Metasuche ersetzen')" :text="text('Edits save to Supabase on blur or Enter. Copy this short instruction and paste it into ChatGPT to read the saved prompt and replace the existing meta-search scheduled task. Copying itself does not change the schedule.', 'Änderungen werden beim Verlassen des Felds oder mit Enter in Supabase gespeichert. Die kurze Anweisung kopieren und in ChatGPT einfügen, um den gespeicherten Prompt zu lesen und die bestehende geplante Metasuche zu ersetzen. Kopieren selbst ändert den Zeitplan nicht.')" />
          </div>
        </aside>
      </DesktopSidebarPortal>
      <form v-if="form" class="search-form" @submit.prevent="flushSave" @focusout="flushSave" @input.capture="onDraftInput">
        <div v-if="status !== 'saved' || loadingCloud" class="search-save-state" aria-live="polite"><span>{{ loadingCloud ? text('Loading meta search…', 'Metasuche wird geladen…') : status === 'error' ? text('Could not save changes', 'Änderungen konnten nicht gespeichert werden') : status === 'unsaved' ? text('Unsaved changes', 'Ungespeicherte Änderungen') : text('Saving…', 'Speichert…') }}</span><button v-if="status === 'error'" type="button" @click="retrySave">{{ text('Retry save', 'Speichern wiederholen') }}</button></div>
        <p v-if="error" class="search-error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
        <details class="search-section" open>
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Shared search strategy', 'Gemeinsame Suchstrategie') }}</span><InfoHint :lang="lang" :label="text('Shared search strategy', 'Gemeinsame Suchstrategie')" :text="text('Edit the user prompt in English. The system prompt adds verification, deduplication, scoring and the 72-hour recommendation deadline rule. Matching one or more research interests can qualify.', 'Den Nutzerprompt auf Englisch bearbeiten. Der Systemprompt ergänzt Verifikation, Deduplizierung, Bewertungen und die 72-Stunden-Fristregel für Empfehlungen. Eine Passung zu einem oder mehreren Forschungsinteressen kann ausreichen.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-strategy`">{{ text('User prompt · English', 'Nutzerprompt · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-strategy`" v-model.lazy="form.userPrompt" lang="en" rows="7" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faGlobe" aria-hidden="true" /><span>{{ text('Regions and language priorities', 'Regionale und sprachliche Prioritäten') }}</span><InfoHint :lang="lang" :label="text('Regions and language priorities', 'Regionale und sprachliche Prioritäten')" :text="text('List preferred regions in priority order and distinguish preferences from exclusions. A profile’s user prompt can extend or narrow these preferences.', 'Bevorzugte Regionen nach Priorität auflisten und Präferenzen von Ausschlüssen unterscheiden. Der Nutzerprompt eines Profils kann diese Präferenzen erweitern oder eingrenzen.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-locations`">{{ text('Region and language preferences · English', 'Regionale und sprachliche Präferenzen · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-locations`" v-model.lazy="form.locationPreferences" lang="en" rows="5" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section" open>
          <summary><FontAwesomeIcon :icon="faUser" aria-hidden="true" /><span>{{ text('Professional profiles', 'Berufliche Profile') }}</span><span class="search-profile-count">{{ enabledCount }} {{ text('enabled', 'aktiv') }}</span><InfoHint :lang="lang" :label="text('Professional profiles', 'Berufliche Profile')" :text="text('All enabled profiles contribute alternative directions to this one daily search. Their professional context and interests can also be selected in application preparation.', 'Alle aktivierten Profile ergänzen alternative Richtungen dieser einen täglichen Suche. Beruflicher Kontext und Interessen können auch in der Bewerbungsvorbereitung ausgewählt werden.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields">
            <div class="search-profile-tabs" :aria-label="text('Choose professional profile', 'Berufliches Profil wählen')"><button v-for="item in form.profiles" :key="item.id" type="button"  :aria-pressed="profileId === item.id" @click="selectProfile(item.id)">{{ item.name }}<span v-if="!item.enabled"> · {{ text('off', 'aus') }}</span></button><button type="button"  @click="addProfile"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" />{{ text('Add profile', 'Profil hinzufügen') }}</button></div>
            <template v-if="profile">
              <div class="search-profile-heading"><label>{{ text('Profile name', 'Profilname') }}<input v-model="profile.name" required maxlength="120" /></label><label class="search-enabled"><input v-model="profile.enabled" type="checkbox" @change="flushSave" />{{ text('Include in daily search', 'In tägliche Suche aufnehmen') }}</label></div>
              <label :for="`${controlsId}-profile-prompt`">{{ text('Profile user prompt · English', 'Profil-Nutzerprompt · Englisch') }}</label><AutosaveTextarea :key="`${profileId}-prompt`" :id="`${controlsId}-profile-prompt`" v-model.lazy="profile.userPrompt" lang="en" rows="5" maxlength="12000" @commit="flushSave" />
              <div class="hint-label-row"><label :for="`${controlsId}-profile-context`">{{ text('Professional background and goals · English', 'Beruflicher Hintergrund und Ziele · Englisch') }}</label><InfoHint :lang="lang" :label="text('Professional context', 'Beruflicher Kontext')" :text="text('Describe supported experience and goals. This context can be reused for motivation letters after selecting the profile for an application.', 'Belegte Erfahrungen und Ziele beschreiben. Dieser Kontext kann nach Auswahl des Profils für eine Bewerbung in Motivationsschreiben verwendet werden.')" /></div><AutosaveTextarea :key="`${profileId}-context`" :id="`${controlsId}-profile-context`" v-model.lazy="profile.professionalContext" lang="en" rows="5" maxlength="12000" @commit="flushSave" />
              <div class="hint-label-row"><label :for="`${controlsId}-profile-interests`">{{ text('Research interests · English', 'Forschungsinteressen · Englisch') }}</label><InfoHint :lang="lang" :label="text('Research interests', 'Forschungsinteressen')" :text="text('Interests are alternative directions: a role can fit one interest or a combination. Interests guide fit and motivation; they do not establish qualifications.', 'Interessen sind alternative Richtungen: Eine Stelle kann zu einem Interesse oder einer Kombination passen. Interessen begründen Passung und Motivation, belegen aber keine Qualifikationen.')" /></div><AutosaveTextarea :key="`${profileId}-interests`" :id="`${controlsId}-profile-interests`" v-model.lazy="profile.researchInterests" lang="en" rows="4" maxlength="12000" @commit="flushSave" />
              <button class="search-remove" type="button"  @click="removeProfile">{{ text('Remove this profile', 'Dieses Profil entfernen') }}</button>
            </template>
            <p v-else>{{ text('Add a professional profile to define your search.', 'Füge ein berufliches Profil für deine Suche hinzu.') }}</p>
          </div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Shared professional context', 'Gemeinsamer beruflicher Kontext') }}</span><InfoHint :lang="lang" :label="text('Shared professional context', 'Gemeinsamer beruflicher Kontext')" :text="text('Background, goals and interests shared by all profiles. Available alongside the selected profile when preparing motivation letters. Interests remain aspirations, not qualifications.', 'Hintergrund, Ziele und Interessen für alle Profile. Bei Motivationsschreiben zusätzlich zum ausgewählten Profil verfügbar. Interessen bleiben Ziele, keine Qualifikationen.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-context`">{{ text('Professional background and goals · English', 'Beruflicher Hintergrund und Ziele · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-context`" v-model.lazy="form.professionalContext" lang="en" rows="5" maxlength="12000" @commit="flushSave" /><label :for="`${controlsId}-interests`">{{ text('Research interests · English', 'Forschungsinteressen · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-interests`" v-model.lazy="form.researchInterests" lang="en" rows="4" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faClock" aria-hidden="true" /><span>{{ text('Daily schedule', 'Täglicher Zeitplan') }}</span><InfoHint :lang="lang" :label="text('Daily schedule', 'Täglicher Zeitplan')" :text="text('Time and context save automatically. Copy the replacement instruction into ChatGPT to apply the saved schedule. Successful runs without new or materially changed strong matches stay quiet.', 'Uhrzeit und Kontext werden automatisch gespeichert. Die Ersetzungsanweisung in ChatGPT einfügen, um den gespeicherten Zeitplan anzuwenden. Erfolgreiche Läufe ohne neue oder wesentlich geänderte starke Treffer bleiben still.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-schedule"><label>{{ text('Daily time', 'Tägliche Uhrzeit') }}<input v-model="form.dailyTime" type="time" required @change="flushSave" /></label><label>{{ text('Time zone', 'Zeitzone') }}<input v-model="form.timezone" placeholder="Europe/Tirane" required @change="flushSave" /></label></div></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faSliders" aria-hidden="true" /><span>{{ text('Generated prompts · English', 'Generierte Prompts · Englisch') }}</span><InfoHint :lang="lang" :label="text('Generated prompts', 'Generierte Prompts')" :text="text('These are the complete English prompts saved in Supabase. The short replacement instruction tells ChatGPT where to read them. Search execution keeps the existing research protocol.', 'Dies sind die vollständigen englischen Prompts in Supabase. Die kurze Ersetzungsanweisung zeigt ChatGPT, wo es sie lesen kann. Die Suchausführung verwendet weiterhin das bestehende Forschungsprotokoll.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-prompt-title"><label :for="`${controlsId}-system`">System prompt</label></div><AutosaveTextarea :id="`${controlsId}-system`" :model-value="systemPreview" readonly lang="en" rows="10" /><div class="search-prompt-title"><label :for="`${controlsId}-user`">User prompt</label></div><AutosaveTextarea :id="`${controlsId}-user`" :model-value="userPreview" readonly lang="en" rows="10" /></div>
        </details>
        <div v-if="copiedFallback" class="search-fields"><label :for="`${controlsId}-fallback`">{{ text('Select and copy prompt', 'Prompt markieren und kopieren') }}</label><AutosaveTextarea :id="`${controlsId}-fallback`" :model-value="copiedFallback" readonly lang="en" rows="12" /></div>
      </form>
      <p v-else>{{ text('Your saved search could not be opened. Recover its backup before importing another file.', 'Deine gespeicherte Suche konnte nicht geöffnet werden. Stelle ihre Sicherung wieder her, bevor du eine weitere Datei importierst.') }}</p>
    </div>
  </section>
</template>

<style scoped>
.search-templates { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 28px 32px; color: var(--ui-text); overflow: hidden; }
.search-heading { margin-bottom: 20px; flex-shrink: 0; }
.search-heading h2 { margin: 0 0 8px; font: 700 22px/1.3 var(--font-ui); color: var(--ui-text); text-shadow: none; text-transform: none; letter-spacing: 0; }
.search-templates p, .search-library p { margin: 0; max-width: 75ch; color: var(--ui-muted); font-size: 13px; line-height: 1.6; }
.search-layout { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 24px; min-width: 0; min-height: 0; flex: 1 1 0; overflow: hidden; }
.search-layout--sidebar { grid-template-columns: minmax(0, 1fr); }
.search-library { display: grid; align-content: start; gap: 16px; min-width: 0; }
.search-form { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overscroll-behavior: contain; }
.search-action-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.search-action-row > button { flex: 1; min-width: 0; }
.search-templates :is(button, input, select, textarea), .search-library :is(button, input, select) { box-sizing: border-box; min-width: 0; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-control); color: var(--ui-text); padding: 10px 12px; font: 400 14px/1.5 var(--font-ui); }
.search-templates :is(input, select, textarea), .search-library select { width: 100%; }
.search-templates button, .search-library button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
.search-templates button:hover:not(:disabled), .search-library button:hover:not(:disabled) { background: var(--ui-surface-hover); }
.search-templates button:disabled, .search-library button:disabled { opacity: .55; cursor: default; }
.search-templates :is(button,input,select,textarea,summary):focus-visible, .search-library :is(button,select,summary):focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.search-templates label, .search-library label { display: grid; gap: 7px; color: var(--ui-text); font: 600 12px/1.4 var(--font-ui); }
.search-section { border-top: 1px solid var(--ui-divider); min-width: 0; }
.search-section > summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 16px; box-sizing: border-box; cursor: pointer; list-style: none; font: 600 14px/1.5 var(--font-ui); }
.search-section > summary::-webkit-details-marker { display: none; }
.search-section > summary::marker { content: ''; }
.search-section > summary > svg { width: 16px; flex-shrink: 0; color: var(--ui-accent); }
.search-section > summary > .search-chevron { margin-left: auto; width: 12px; color: var(--ui-muted); }
.search-section[open] > summary > .search-chevron { transform: rotate(180deg); }
.search-fields { display: grid; gap: 12px; padding: 4px 16px 22px; min-width: 0; }
.search-fields > label:not(:first-child) { margin-top: 6px; }
.search-save-state { display: flex; align-items: center; gap: 10px; min-height: 20px; color: var(--ui-muted); font-size: 12px; }
.search-load-error { display: grid; justify-items: start; gap: 10px; padding-bottom: 16px; }
.search-templates .search-error { color: var(--ui-danger-text, var(--ui-text)); }
.search-profile-tabs { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0; }
.search-profile-tabs button { white-space: normal; overflow-wrap: anywhere; }
.search-profile-tabs [aria-pressed="true"] { color: var(--ui-accent); border-color: var(--ui-accent-border); background: var(--ui-active); }
.search-profile-count { color: var(--ui-muted); font-size: 12px; font-weight: 400; }
.search-profile-heading, .search-schedule { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end; }
.search-profile-heading .search-enabled { display: flex; align-items: center; min-height: 42px; gap: 8px; }
.search-enabled input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--ui-accent); }
.search-remove { justify-self: start; margin-top: 8px; }
.search-copy-actions { display: grid; gap: 8px; padding-top: 16px; }
.search-library .search-primary { color: var(--ui-accent); border-color: var(--ui-accent-border); }
.search-library .search-copy-actions p { font-size: 12px; }
.search-files { border-top: 1px solid var(--ui-divider); padding-top: 12px; }
.search-files summary { cursor: pointer; font: 600 13px/1.5 var(--font-ui); color: var(--ui-muted); }
.search-file-actions { display: grid; gap: 10px; margin-top: 12px; }
.search-prompt-title { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.search-templates textarea { resize: vertical; caret-color: var(--ui-accent); }
@media (max-width: 760px) {
  .search-templates { padding: 20px 12px; overflow: auto; overscroll-behavior: contain; }
  .search-heading { margin-bottom: 20px; }
  .search-layout { display: flex; flex-direction: column; flex: 0 0 auto; overflow: visible; }
  .search-form { overflow: visible; }
  .search-profile-heading, .search-schedule { grid-template-columns: minmax(0, 1fr); }
  .search-templates :is(input,select,textarea), .search-library select { font-size: 16px; }
  .search-templates button:not(.info-hint__button), .search-library button:not(.info-hint__button) { min-height: 44px; }
  .search-fields { padding-left: 4px; padding-right: 4px; }
}
</style>
