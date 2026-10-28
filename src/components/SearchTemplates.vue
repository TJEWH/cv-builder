<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfiguration } from '../lib/supabase';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faAlignLeft, faChevronDown, faClock, faCopy, faDownload, faGlobe, faPlus, faSliders, faUpload, faUser } from '@fortawesome/free-solid-svg-icons';
import type { SearchTemplate } from '../searchTypes';
import { createSearchTemplateRepository, createSearchProfile } from '../composables/useSearchTemplates';
import { buildDailySearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt } from '../composables/searchPrompts';
import { listCloudSearchTemplates, importCloudSearchTemplate, publishSearchTemplate, isSearchTemplatePublished } from '../composables/searchTemplateCloud';
import type { SearchCloudTemplate } from '../composables/searchTemplateCloud';
import { commitPendingTextareas } from '../composables/textareaCommit';
import { copyPreparedText } from '../composables/preparedClipboard';
import { clearSearchDraft, recoverSearchDraft, retainSearchDraft } from '../composables/searchTemplateRecovery';
import { useDesktopSidebar } from '../composables/desktopSidebar';
import { useToastWatch } from '../composables/useToasts';
import AutosaveTextarea from './AutosaveTextarea.vue';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import InfoHint from './InfoHint.vue';

const props = withDefaults(defineProps<{ userId: string; lang?: string; sidebarActive?: boolean; projectId?: string; client?: SupabaseClient | null }>(), { sidebarActive: true });
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const controlsId = useId();
const desktopSidebar = useDesktopSidebar();
const connectedProjectId = computed(() => props.projectId || (supabaseConfiguration.status === 'ready' ? new URL(supabaseConfiguration.url).hostname.split('.')[0] : undefined));
const form = ref<SearchTemplate | null>(null);
const selectedId = ref('');
const profileId = ref('');
const profile = computed(() => form.value?.profiles.find(item => item.id === profileId.value));
const enabledCount = computed(() => form.value?.profiles.filter(item => item.enabled).length || 0);
const status = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
const error = ref('');
const notice = ref('');
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => notice.value, { tone: 'success' });
const copying = ref(false);
const importing = ref(false);
const publishing = ref(false);
const loadingCloud = ref(false);
const published = computed(() => !!form.value && !dirty && isSearchTemplatePublished(form.value));
const importInput = ref<HTMLInputElement | null>(null);
const copiedFallback = ref('');
let editingOwner = props.userId;
let baseline: SearchTemplate | null = null;
let dirty = false;
let replacing = false;
let disposed = false;
let importGeneration = 0;
let ownerGeneration = 0;
let publication: Promise<boolean> | null = null;
const repository = () => createSearchTemplateRepository(localStorage, editingOwner);
function replace(value: SearchTemplate | null) {
  replacing = true;
  form.value = value ? JSON.parse(JSON.stringify(value)) : null;
  baseline = value ? JSON.parse(JSON.stringify(value)) : null;
  dirty = false; replacing = false; status.value = 'saved';
  if (!value?.profiles.some(item => item.id === profileId.value)) profileId.value = value?.profiles[0]?.id || '';
}
function reload() {
  const selected = repository().listTemplates()[0] || null;
  selectedId.value = selected?.id || ''; replace(selected);
}
function retryLoad() {
  try { reload(); error.value = ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function save(): boolean {
  if (!dirty || !form.value) return true;
  status.value = 'saving';
  try {
    const saved = repository().saveTemplate(form.value, baseline);
    clearSearchDraft(editingOwner, saved.id);
    selectedId.value = saved.id; replace(saved);
    error.value = ''; copiedFallback.value = '';
    window.dispatchEvent(new Event('cv-search-templates-updated'));
    return true;
  } catch (cause) {
    retainSearchDraft(editingOwner, form.value, baseline);
    status.value = 'error'; error.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  }
}
function flushSave() { commitPendingTextareas(); return save(); }
async function flushTextareas() {
  if (publication && !await publication) return false;
  return flushSave();
}
defineExpose({ flushSave, flushTextareas });
function selectProfile(id: string) { if (!publishing.value && flushSave()) profileId.value = id; }
function addProfile() {
  if (publishing.value || !flushSave() || !form.value) return;
  const added = createSearchProfile();
  form.value.profiles.push(added); profileId.value = added.id; save();
}
function removeProfile() {
  if (publishing.value || !flushSave() || !form.value || !profile.value) return;
  form.value.profiles = form.value.profiles.filter(item => item.id !== profileId.value);
  profileId.value = form.value.profiles[0]?.id || ''; save();
}
watch(form, () => {
  if (replacing) return;
  dirty = true; status.value = 'unsaved'; notice.value = ''; copiedFallback.value = '';
}, { deep: true, flush: 'sync' });
watch(() => props.userId, id => {
  flushSave(); editingOwner = id; selectedId.value = ''; profileId.value = ''; importGeneration++; importing.value = false;
  ownerGeneration++; publication = null; copying.value = false;
  loadingCloud.value = false; publishing.value = false;
  notice.value = ''; error.value = ''; replace(null);
  try {
    reload();
    const recovered = recoverSearchDraft(editingOwner);
    if (recovered) {
      replace(recovered.form); baseline = recovered.baseline; selectedId.value = recovered.form.id;
      dirty = true; status.value = 'unsaved';
      notice.value = text('Your unsaved search draft was recovered. Review it and retry saving.', 'Dein ungespeicherter Suchentwurf wurde wiederhergestellt. Prüfe ihn und speichere erneut.');
    }
  } catch (cause) { error.value = String(cause); status.value = 'error'; }
}, { immediate: true });
function prompt(kind: 'system' | 'user' | 'daily') {
  if (!form.value) return '';
  const options = { projectId: connectedProjectId.value };
  if (kind === 'system') return buildSearchSystemPrompt(form.value, options);
  if (kind === 'user') return buildSearchUserPrompt(form.value, options);
  return buildDailySearchPrompt(form.value, options);
}
async function loadCloud() {
  if (!props.client || loadingCloud.value || !flushSave()) return;
  const token = ownerGeneration; loadingCloud.value = true;
  try {
    const rows = await listCloudSearchTemplates(props.client, props.userId);
    if (disposed || token !== ownerGeneration) return;
    const row = form.value?.cloud ? rows.find(item => item.id === form.value?.cloud?.id) : rows[0];
    if (row) useCloud(row);
    else notice.value = text('No saved search found in this workspace.', 'Keine gespeicherte Suche in diesem Arbeitsbereich gefunden.');
  } catch (cause) { if (token === ownerGeneration && !disposed) error.value = String(cause); }
  finally { if (token === ownerGeneration) loadingCloud.value = false; }
}
function useCloud(row: SearchCloudTemplate) {
  if (publishing.value || !flushSave()) return;
  try {
    const imported = importCloudSearchTemplate(row);
    replace(imported); selectedId.value = imported.id; baseline = null; dirty = true;
    if (save()) notice.value = text('Search loaded. Review the daily time and enabled profiles before publishing.', 'Suche geladen. Prüfe tägliche Uhrzeit und aktivierte Profile vor dem Veröffentlichen.');
  } catch (cause) { error.value = String(cause); }
}
function publish() {
  if (!props.client || publishing.value || !flushSave() || !form.value) return;
  const owner = props.userId;
  const token = ownerGeneration;
  const client = props.client;
  const snapshot = JSON.parse(JSON.stringify(form.value)) as SearchTemplate;
  publishing.value = true; error.value = ''; notice.value = '';
  const operation = (async () => { try {
    if (!snapshot.cloud) {
      const rows = await listCloudSearchTemplates(client, owner);
      if (disposed || token !== ownerGeneration) return false;
      const existing = rows[0];
      if (existing) snapshot.cloud = { id: existing.id, revision: existing.revision, contentKey: '' };
    }
    const result = await publishSearchTemplate(client, owner, snapshot);
    if (disposed || token !== ownerGeneration) return false;
    // Preserve any typing or selection changes while the publication was in flight.
    if (form.value?.id === snapshot.id) {
      form.value.cloud = result.cloud;
      if (!flushSave()) return false;
    }
    notice.value = text('Search published and verified. Copy the daily prompt to create or update your ChatGPT schedule.', 'Suche veröffentlicht und geprüft. Kopiere den täglichen Prompt, um deinen ChatGPT-Zeitplan zu erstellen oder zu aktualisieren.');
    return true;
  } catch (cause) { if (token === ownerGeneration && !disposed) error.value = cause instanceof Error ? cause.message : String(cause); return false; }
  finally { if (token === ownerGeneration) { publishing.value = false; publication = null; } }
  })();
  publication = operation;
  return operation;
}
const systemPreview = computed(() => { try { return prompt('system'); } catch { return ''; } });
const userPreview = computed(() => { try { return prompt('user'); } catch { return ''; } });
async function copy(kind: 'system' | 'user' | 'daily') {
  if (copying.value) return;
  copying.value = true; notice.value = ''; error.value = '';
  const token = ownerGeneration;
  try {
    const result = await copyPreparedText(async () => flushSave() ? prompt(kind) : null);
    if (!result || disposed || token !== ownerGeneration) return;
    if (result.copied) notice.value = text('Prompt copied. Use it in your ChatGPT search schedule.', 'Prompt kopiert. Verwende ihn in deinem ChatGPT-Suchzeitplan.');
    else { copiedFallback.value = result.value; notice.value = text('Clipboard unavailable. Select and copy the prompt below.', 'Zwischenablage nicht verfügbar. Markiere und kopiere den Prompt unten.'); }
  } catch (cause) { if (token === ownerGeneration && !disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (token === ownerGeneration) copying.value = false; }
}
function download() {
  if (!flushSave()) return;
  try {
    const url = URL.createObjectURL(new Blob([repository().exportTemplates()], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'meta-search.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = String(cause); }
}
async function importLibrary(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file || importing.value || publishing.value || !flushSave()) return;
  importing.value = true;
  const token = ++importGeneration;
  try {
    const raw = await file.text();
    if (disposed || token !== importGeneration || publishing.value || !flushSave()) return;
    repository().importTemplates(raw); reload(); window.dispatchEvent(new Event('cv-search-templates-updated'));
    notice.value = text('Meta search restored from backup.', 'Metasuche aus der Sicherung wiederhergestellt.');
  } catch (cause) { if (!disposed && token === importGeneration) error.value = String(cause); }
  finally { if (token === importGeneration) importing.value = false; }
}
onBeforeUnmount(() => { flushSave(); disposed = true; importGeneration++; ownerGeneration++; });
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
            <button class="search-primary" type="button" :disabled="!client || publishing || !enabledCount || published" @click="publish">{{ publishing ? text('Publishing…', 'Veröffentlichen…') : published ? text('Published and up to date', 'Veröffentlicht und aktuell') : text('Publish search', 'Suche veröffentlichen') }}</button>
            <InfoHint :lang="lang" :label="text('Publish search', 'Suche veröffentlichen')" :text="text('Shares the strategy, shared context, enabled profiles and daily time with your private Supabase search. Changes stay local until publication. An existing saved search is reused.', 'Teilt Strategie, gemeinsamen Kontext, aktivierte Profile und tägliche Uhrzeit mit deiner privaten Supabase-Suche. Änderungen bleiben bis zur Veröffentlichung lokal. Eine vorhandene Suche wird weiterverwendet.')" />
          </div>
          <div class="search-action-row">
            <button type="button" :disabled="copying || !enabledCount || !published" @click="copy('daily')"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" />{{ text('Copy daily search prompt', 'Täglichen Suchprompt kopieren') }}</button>
            <InfoHint :lang="lang" :label="text('Daily search prompt', 'Täglicher Suchprompt')" :text="text('Paste the prompt into ChatGPT to set up or update the daily search. Each run loads the published search and current protocol. Copying does not create a schedule.', 'Den Prompt in ChatGPT einfügen, um die tägliche Suche einzurichten oder zu aktualisieren. Jeder Lauf lädt die veröffentlichte Suche und das aktuelle Protokoll. Kopieren erstellt keinen Zeitplan.')" />
          </div>
          <details class="search-files">
            <summary>{{ text('Saved search & backup', 'Gespeicherte Suche & Sicherung') }}<InfoHint :lang="lang" :label="text('Saved search & backup', 'Gespeicherte Suche & Sicherung')" :text="text('Loading replaces the local editor with the published search. Import restores this one search from a JSON backup; it never creates another instance or imports another account’s schedule binding. Backups include private context.', 'Laden ersetzt den lokalen Editor durch die veröffentlichte Suche. Import stellt diese eine Suche aus einer JSON-Sicherung wieder her und erstellt keine weitere Instanz. Zeitplanverknüpfungen anderer Konten werden nicht übernommen. Sicherungen enthalten privaten Kontext.')" /></summary>
            <div class="search-file-actions">
              <button type="button" :disabled="!client || loadingCloud || publishing" @click="loadCloud">{{ loadingCloud ? text('Loading…', 'Lädt…') : text('Load published search', 'Veröffentlichte Suche laden') }}</button>
              <button type="button" @click="download"><FontAwesomeIcon :icon="faDownload" aria-hidden="true" />{{ text('Export search', 'Suche exportieren') }}</button>
              <button type="button" :disabled="importing || publishing" @click="importInput?.click()"><FontAwesomeIcon :icon="faUpload" aria-hidden="true" />{{ importing ? text('Importing…', 'Importieren…') : text('Import search', 'Suche importieren') }}</button>
            </div>
          </details>
          <input ref="importInput" hidden type="file" accept=".json,application/json" @change="importLibrary" />
        </aside>
      </DesktopSidebarPortal>
      <form v-if="form" class="search-form" @submit.prevent="flushSave" @focusout="flushSave">
        <div v-if="status !== 'saved'" class="search-save-state" aria-live="polite"><span>{{ status === 'error' ? text('Could not save changes', 'Änderungen konnten nicht gespeichert werden') : status === 'unsaved' ? text('Unsaved changes', 'Ungespeicherte Änderungen') : text('Saving…', 'Speichert…') }}</span><button v-if="status === 'error'" type="button" @click="flushSave">{{ text('Retry save', 'Speichern wiederholen') }}</button></div>
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
            <div class="search-profile-tabs" :aria-label="text('Choose professional profile', 'Berufliches Profil wählen')"><button v-for="item in form.profiles" :key="item.id" type="button" :disabled="publishing" :aria-pressed="profileId === item.id" @click="selectProfile(item.id)">{{ item.name }}<span v-if="!item.enabled"> · {{ text('off', 'aus') }}</span></button><button type="button" :disabled="publishing" @click="addProfile"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" />{{ text('Add profile', 'Profil hinzufügen') }}</button></div>
            <template v-if="profile">
              <div class="search-profile-heading"><label>{{ text('Profile name', 'Profilname') }}<input v-model="profile.name" required maxlength="120" /></label><label class="search-enabled"><input v-model="profile.enabled" type="checkbox" @change="flushSave" />{{ text('Include in daily search', 'In tägliche Suche aufnehmen') }}</label></div>
              <label :for="`${controlsId}-profile-prompt`">{{ text('Profile user prompt · English', 'Profil-Nutzerprompt · Englisch') }}</label><AutosaveTextarea :key="`${profileId}-prompt`" :id="`${controlsId}-profile-prompt`" v-model.lazy="profile.userPrompt" lang="en" rows="5" maxlength="12000" @commit="flushSave" />
              <div class="hint-label-row"><label :for="`${controlsId}-profile-context`">{{ text('Professional background and goals · English', 'Beruflicher Hintergrund und Ziele · Englisch') }}</label><InfoHint :lang="lang" :label="text('Professional context', 'Beruflicher Kontext')" :text="text('Describe supported experience and goals. This context can be reused for motivation letters after selecting the profile for an application.', 'Belegte Erfahrungen und Ziele beschreiben. Dieser Kontext kann nach Auswahl des Profils für eine Bewerbung in Motivationsschreiben verwendet werden.')" /></div><AutosaveTextarea :key="`${profileId}-context`" :id="`${controlsId}-profile-context`" v-model.lazy="profile.professionalContext" lang="en" rows="5" maxlength="12000" @commit="flushSave" />
              <div class="hint-label-row"><label :for="`${controlsId}-profile-interests`">{{ text('Research interests · English', 'Forschungsinteressen · Englisch') }}</label><InfoHint :lang="lang" :label="text('Research interests', 'Forschungsinteressen')" :text="text('Interests are alternative directions: a role can fit one interest or a combination. Interests guide fit and motivation; they do not establish qualifications.', 'Interessen sind alternative Richtungen: Eine Stelle kann zu einem Interesse oder einer Kombination passen. Interessen begründen Passung und Motivation, belegen aber keine Qualifikationen.')" /></div><AutosaveTextarea :key="`${profileId}-interests`" :id="`${controlsId}-profile-interests`" v-model.lazy="profile.researchInterests" lang="en" rows="4" maxlength="12000" @commit="flushSave" />
              <button class="search-remove" type="button" :disabled="publishing" @click="removeProfile">{{ text('Remove this profile', 'Dieses Profil entfernen') }}</button>
            </template>
            <p v-else>{{ text('Add a professional profile to define your search.', 'Füge ein berufliches Profil für deine Suche hinzu.') }}</p>
          </div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faAlignLeft" aria-hidden="true" /><span>{{ text('Shared professional context', 'Gemeinsamer beruflicher Kontext') }}</span><InfoHint :lang="lang" :label="text('Shared professional context', 'Gemeinsamer beruflicher Kontext')" :text="text('Background, goals and interests shared by all profiles. Available alongside the selected profile when preparing motivation letters. Interests remain aspirations, not qualifications.', 'Hintergrund, Ziele und Interessen für alle Profile. Bei Motivationsschreiben zusätzlich zum ausgewählten Profil verfügbar. Interessen bleiben Ziele, keine Qualifikationen.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><label :for="`${controlsId}-context`">{{ text('Professional background and goals · English', 'Beruflicher Hintergrund und Ziele · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-context`" v-model.lazy="form.professionalContext" lang="en" rows="5" maxlength="12000" @commit="flushSave" /><label :for="`${controlsId}-interests`">{{ text('Research interests · English', 'Forschungsinteressen · Englisch') }}</label><AutosaveTextarea :id="`${controlsId}-interests`" v-model.lazy="form.researchInterests" lang="en" rows="4" maxlength="12000" @commit="flushSave" /></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faClock" aria-hidden="true" /><span>{{ text('Daily schedule', 'Täglicher Zeitplan') }}</span><InfoHint :lang="lang" :label="text('Daily schedule', 'Täglicher Zeitplan')" :text="text('Publish, then copy the daily prompt to ChatGPT to create or update the schedule. A time change must also reach the ChatGPT schedule. Successful runs without new or materially changed strong matches stay quiet.', 'Veröffentlichen und den täglichen Prompt in ChatGPT kopieren, um den Zeitplan zu erstellen oder zu aktualisieren. Eine geänderte Uhrzeit muss auch im ChatGPT-Zeitplan ankommen. Erfolgreiche Läufe ohne neue oder wesentlich geänderte starke Treffer bleiben still.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-schedule"><label>{{ text('Daily time', 'Tägliche Uhrzeit') }}<input v-model="form.dailyTime" type="time" required @change="flushSave" /></label><label>{{ text('Time zone', 'Zeitzone') }}<input v-model="form.timezone" placeholder="Europe/Tirane" required @change="flushSave" /></label></div></div>
        </details>
        <details class="search-section">
          <summary><FontAwesomeIcon :icon="faSliders" aria-hidden="true" /><span>{{ text('Generated prompts · English', 'Generierte Prompts · Englisch') }}</span><InfoHint :lang="lang" :label="text('Generated prompts', 'Generierte Prompts')" :text="text('Copied prompts include shared context and enabled profiles. Review the text before sharing with ChatGPT. A published search is required to execute the connected workflow.', 'Kopierte Prompts enthalten gemeinsamen Kontext und aktivierte Profile. Den Text vor dem Teilen mit ChatGPT prüfen. Die verknüpfte Suche muss vor ihrer Ausführung veröffentlicht werden.')" /><FontAwesomeIcon :icon="faChevronDown" class="search-chevron" aria-hidden="true" /></summary>
          <div class="search-fields"><div class="search-prompt-title"><label :for="`${controlsId}-system`">System prompt</label><button type="button" :disabled="copying" @click="copy('system')">{{ text('Copy system prompt', 'Systemprompt kopieren') }}</button></div><AutosaveTextarea :id="`${controlsId}-system`" :model-value="systemPreview" readonly lang="en" rows="10" /><div class="search-prompt-title"><label :for="`${controlsId}-user`">User prompt</label><button type="button" :disabled="copying || !enabledCount" @click="copy('user')">{{ text('Copy user prompt', 'Nutzerprompt kopieren') }}</button></div><AutosaveTextarea :id="`${controlsId}-user`" :model-value="userPreview" readonly lang="en" rows="10" /></div>
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
