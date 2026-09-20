<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState, SavedConfiguration } from '../types';
import type { Application, Opportunity, OpportunityReviewState } from '../cloudTypes';
import { APPLICATION_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { useJobWorkspace } from '../composables/useJobWorkspace';
import { createCloudCvSnapshot } from '../composables/cloudCvPrivacy';
import { safeEmailUrl } from '../composables/safeUrl';
import { isOpportunityDeadlinePassed, opportunityDeadlineSortKey, formatOpportunityDeadline } from '../composables/opportunityDeadline';
import { buildApplicationEvaluationContext } from '../composables/applicationEvaluationContext';
import OpportunityContext from './OpportunityContext.vue';

const props = defineProps<{
  client: SupabaseClient | null; userId: string; tab: 'opportunities' | 'applications'; lang: string;
  configurations: SavedConfiguration[]; selectedId: string; readVersion: (id: string) => CvState | null;
}>();
const emit = defineEmits<{ navigate: [tab: 'opportunities' | 'applications'] }>();
const { opportunities, applications, cvVariants, reviews, loading, saving, error, refresh, createApplication,
  updateApplication, setOpportunityReview, getApplicationContext, refreshApplicationContext } = useJobWorkspace(props.client, () => props.userId);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const query = ref('');
const statusFilter = ref('');
const reviewFilter = ref('active');
const suitableOnly = ref(false);
const hideExpired = ref(true);
const hideWithApplication = ref(true);
const sortBy = ref('deadline');
const expandedOpportunity = ref<string | null>(null);
const editingId = ref<string | null>(null);
const notice = ref('');
const formError = ref('');
const contextError = ref('');
const exportText = ref('');
const preparingContext = ref(false);
const tableScroll = ref<HTMLElement | null>(null);
const form = reactive({ versionId: '', status: 'shortlist' as Application['status'], notes: '', contactedAt: '', submittedAt: '' });
const snapshot = ref<ReturnType<typeof createCloudCvSnapshot> | null>(null);
const selectedCv = ref<CvState | null>(null);
const now = ref(new Date());
const clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
let viewEpoch = 0;
onBeforeUnmount(() => { window.clearInterval(clockTimer); viewEpoch++; });
const reviewById = computed(() => new Map(reviews.value.map((item) => [item.opportunity_id, item.state])));
const reviewState = (id: string): OpportunityReviewState => reviewById.value.get(id) || 'unreviewed';
const applicationByOpportunity = computed(() => new Map(applications.value.map((item) => [item.opportunity_id, item])));
const filteredOpportunities = computed(() => {
  const needle = query.value.toLocaleLowerCase().trim();
  return opportunities.value.filter((item) => (!suitableOnly.value || item.particularly_suitable)
    && (!hideExpired.value || !isOpportunityDeadlinePassed(item.details, now.value))
    && (!hideWithApplication.value || !applicationByOpportunity.value.has(item.id))
    && (reviewFilter.value === 'all' || (reviewFilter.value === 'active' ? reviewState(item.id) !== 'not_interested' : reviewState(item.id) === reviewFilter.value))
    && (!needle || [item.title, item.university, item.country, ...item.topics].join(' ').toLocaleLowerCase().includes(needle)))
    .toSorted((a, b) => sortBy.value === 'title' ? a.title.localeCompare(b.title)
      : sortBy.value === 'institution' ? (a.university || '').localeCompare(b.university || '')
        : opportunityDeadlineSortKey(a.details) - opportunityDeadlineSortKey(b.details));
});
const opportunityById = computed(() => new Map(opportunities.value.map((item) => [item.id, item])));
const cvById = computed(() => new Map(cvVariants.value.map((item) => [item.id, item])));
const filteredApplications = computed(() => applications.value.filter((item) => (!statusFilter.value || item.status === statusFilter.value)
  && [item.context_json.title, item.context_json.institution, item.context_json.university].join(' ').toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim())));
const editingApplication = computed(() => applications.value.find(({ id }) => id === editingId.value));
const statusNames: Record<string, [string, string]> = {
  shortlist: ['Shortlist', 'Vorgemerkt'], contacted: ['Contacted', 'Kontaktiert'], submitted: ['Submitted', 'Eingereicht'],
  interview: ['Interview', 'Gespräch'], offer: ['Offer', 'Angebot'], rejected: ['Rejected', 'Abgelehnt'], withdrawn: ['Withdrawn', 'Zurückgezogen'],
  unreviewed: ['Not reviewed', 'Ungeprüft'], interested: ['Interested', 'Interessant'], not_interested: ['Not interesting', 'Nicht interessant'],
};
function statusLabel(value: string) { const pair = statusNames[value]; return pair ? text(...pair) : value; }
function contextTitle(item: Application) { return String(item.context_json.title || opportunityById.value.get(item.opportunity_id)?.title || text('Application', 'Bewerbung')); }
function contextInstitution(item: Application) { return String(item.context_json.institution || item.context_json.university || ''); }
function contacts(item: Application): { name: string; email: string }[] {
  const raw = item.context_json.contacts ?? item.context_json.contact ?? item.context_json.supervisors ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  const people = values.flatMap((entry) => {
    if (typeof entry === 'string') return [{ name: safeEmailUrl(entry) ? '' : entry, email: safeEmailUrl(entry) ? entry : '' }];
    if (!entry || typeof entry !== 'object') return [];
    return [{ name: typeof entry.name === 'string' ? entry.name : '', email: typeof entry.email === 'string' ? entry.email : '' }];
  }).filter(({ name, email }) => name || email);
  return people.length ? people : item.contact_email ? [{ name: '', email: item.contact_email }] : [];
}
function dateLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(props.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium' }).format(new Date(value));
}
function toLocalDateTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const hasUnsavedChanges = computed(() => {
  const item = editingApplication.value;
  return Boolean(item && (form.versionId || form.status !== item.status || form.notes !== (item.notes || '')
    || form.contactedAt !== toLocalDateTime(item.contacted_at) || form.submittedAt !== toLocalDateTime(item.submitted_at)));
});
watch(() => form.versionId, (id) => {
  snapshot.value = null; selectedCv.value = null; formError.value = ''; exportText.value = '';
  if (!id) return;
  try {
    const state = props.readVersion(id);
    if (!state) throw new Error('missing');
    snapshot.value = createCloudCvSnapshot(state);
    selectedCv.value = JSON.parse(JSON.stringify(state));
  } catch {
    formError.value = text('This local CV could not be read. Return to Versions and save it first.', 'Diese lokale CV-Version konnte nicht gelesen werden. Bitte zuerst unter Versionen speichern.');
  }
}, { flush: 'sync' });
watch(() => props.tab, () => { query.value = ''; notice.value = ''; viewEpoch++; preparingContext.value = false; exportText.value = ''; });
watch(() => props.userId, () => { editingId.value = null; expandedOpportunity.value = null; viewEpoch++; exportText.value = ''; });
watch(form, () => { exportText.value = ''; contextError.value = ''; viewEpoch++; preparingContext.value = false; });
function toggleOpportunity(id: string) {
  expandedOpportunity.value = expandedOpportunity.value === id ? null : id;
  if (expandedOpportunity.value) nextTick(() => { if (tableScroll.value) tableScroll.value.scrollLeft = 0; });
}
async function changeReview(item: Opportunity, event: Event) {
  const target = event.target as HTMLSelectElement;
  const result = await setOpportunityReview(item.id, target.value as OpportunityReviewState);
  if (!result) target.value = reviewState(item.id);
  else notice.value = result.state === 'not_interested' && reviewFilter.value === 'active'
    ? text('Marked as not interesting. Choose “All review states” to show it again.', 'Als nicht interessant markiert. Unter „Alle Bewertungen“ wieder sichtbar.')
    : text('Your review state was saved.', 'Deine Bewertung wurde gespeichert.');
}
function openApplication(application: Application) {
  editingId.value = application.id; form.versionId = ''; form.status = application.status;
  form.notes = application.notes || ''; form.contactedAt = toLocalDateTime(application.contacted_at); form.submittedAt = toLocalDateTime(application.submitted_at);
  formError.value = ''; exportText.value = ''; contextError.value = ''; viewEpoch++; preparingContext.value = false;
  nextTick(() => { if (tableScroll.value) tableScroll.value.scrollLeft = 0; });
}
async function startApplication(item: Opportunity) {
  const existing = applicationByOpportunity.value.get(item.id);
  const application = existing || await createApplication({ opportunityId: item.id });
  if (!application) return;
  emit('navigate', 'applications');
  await nextTick();
  openApplication(application);
  notice.value = existing ? '' : text('Application created with all opportunity context. You can assign a CV below.', 'Bewerbung mit allen Stellendaten angelegt. Du kannst unten einen CV zuweisen.');
}
async function saveApplication() {
  if (!editingId.value || saving.value) return;
  if (form.versionId && !selectedCv.value) { formError.value = text('Select a valid saved CV.', 'Bitte einen gültigen gespeicherten CV auswählen.'); return; }
  const id = editingId.value;
  const result = await updateApplication(id, { status: form.status, notes: form.notes,
    contactedAt: form.contactedAt || null, submittedAt: form.submittedAt || null,
    ...(selectedCv.value ? { cvState: selectedCv.value } : {}) });
  if (!result) { formError.value = error.value || text('Could not save.', 'Speichern fehlgeschlagen.'); return; }
  openApplication(result);
  notice.value = text('Application saved.', 'Bewerbung gespeichert.');
}
async function prepareEvaluationContext() {
  const id = editingId.value;
  if (!id || preparingContext.value || hasUnsavedChanges.value) return;
  const epoch = viewEpoch;
  preparingContext.value = true; contextError.value = ''; exportText.value = '';
  try {
    const result = await getApplicationContext(id);
    if (epoch !== viewEpoch || editingId.value !== id) return;
    if (!result) { contextError.value = error.value || text('Could not load saved application context.', 'Der gespeicherte Bewerbungskontext konnte nicht geladen werden.'); return; }
    exportText.value = buildApplicationEvaluationContext(result.application, result.cv, props.lang);
  } catch { if (epoch === viewEpoch) contextError.value = text('Could not prepare the context. Try again.', 'Der Kontext konnte nicht vorbereitet werden. Bitte erneut versuchen.'); }
  finally { if (epoch === viewEpoch) preparingContext.value = false; }
}
async function refreshResearch() {
  if (!editingId.value || saving.value || hasUnsavedChanges.value) return;
  const result = await refreshApplicationContext(editingId.value);
  if (!result) return;
  openApplication(result);
  notice.value = text('Research context refreshed from the opportunity. Your CV and application progress are preserved.', 'Forschungskontext aus dem Stellenangebot aktualisiert. CV und Bewerbungsfortschritt bleiben erhalten.');
}
async function copyContext() {
  try { await navigator.clipboard.writeText(exportText.value); notice.value = text('Application context copied.', 'Bewerbungskontext kopiert.'); }
  catch { contextError.value = text('Clipboard unavailable. Download the context instead.', 'Zwischenablage nicht verfügbar. Bitte den Kontext herunterladen.'); }
}
function downloadContext() {
  const url = URL.createObjectURL(new Blob([exportText.value], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `application-context-${editingId.value}.md`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <section :id="`builder-group-${tab}`" class="jobs-workspace" :aria-label="tab === 'opportunities' ? text('Opportunities', 'Stellenangebote') : text('Applications', 'Bewerbungen')">
    <header class="jobs-heading"><div><p class="jobs-eyebrow">{{ text('YOUR NEXT CHAPTER', 'DEIN NÄCHSTES KAPITEL') }}</p><h1>{{ tab === 'opportunities' ? text('Job opportunities', 'Stellenangebote') : text('Your applications', 'Deine Bewerbungen') }}</h1><p>{{ tab === 'opportunities' ? text('Review the research, keep what interests you, and create an application in one click.', 'Prüfe die Forschung, markiere interessante Stellen und lege mit einem Klick eine Bewerbung an.') : text('Research, requirements, documents and your CV — together for each application.', 'Forschung, Anforderungen, Unterlagen und dein CV — zusammen für jede Bewerbung.') }}</p></div><button class="btn" type="button" :disabled="loading || saving" @click="refresh">{{ loading ? text('Loading…', 'Lädt…') : text('Refresh', 'Aktualisieren') }}</button></header>
    <p class="jobs-privacy"><font-awesome-icon :icon="['fas', 'lock']" /> {{ text('Your full CV stays in this browser. Only a privacy snapshot is uploaded when you assign a CV to an application.', 'Dein vollständiger CV bleibt in diesem Browser. Nur beim Zuweisen eines CVs wird ein anonymisierter Snapshot hochgeladen.') }}</p>
    <p v-if="error" class="jobs-error" role="alert">{{ error }}</p><p v-if="notice" class="jobs-notice" role="status">{{ notice }}</p>
    <div class="jobs-toolbar">
      <label class="jobs-search"><span>{{ text('Search', 'Suchen') }}</span><input v-model="query" type="search" :placeholder="text('Title, institution or country…', 'Titel, Einrichtung oder Land…')" /></label>
      <template v-if="tab === 'opportunities'">
        <label>{{ text('Review state', 'Bewertung') }}<select v-model="reviewFilter"><option value="active">{{ text('Hide not interesting', 'Nicht interessante ausblenden') }}</option><option value="all">{{ text('All review states', 'Alle Bewertungen') }}</option><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
        <label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="sortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option></select></label>
        <div class="jobs-filter-checks"><label class="jobs-check"><input v-model="hideExpired" type="checkbox" /> {{ text('Hide past deadlines', 'Abgelaufene Fristen ausblenden') }}</label><label class="jobs-check"><input v-model="hideWithApplication" type="checkbox" /> {{ text('Hide opportunities with applications', 'Stellen mit Bewerbungen ausblenden') }}</label><label class="jobs-check"><input v-model="suitableOnly" type="checkbox" /> {{ text('Particularly suitable', 'Besonders passend') }}</label></div>
      </template>
      <label v-else>{{ text('Status', 'Status') }}<select v-model="statusFilter"><option value="">{{ text('All statuses', 'Alle Status') }}</option><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label>
      <span class="jobs-count">{{ tab === 'opportunities' ? filteredOpportunities.length : filteredApplications.length }} {{ text('results', 'Ergebnisse') }}</span>
    </div>
    <div ref="tableScroll" class="jobs-table-scroll" tabindex="0" :aria-label="text('Scrollable results table', 'Scrollbare Ergebnistabelle')">
      <table v-if="tab === 'opportunities'">
        <thead><tr><th>{{ text('Opportunity', 'Stelle') }}</th><th>{{ text('Country', 'Land') }}</th><th>{{ text('Deadline', 'Frist') }}</th><th>{{ text('Topics', 'Themen') }}</th><th>{{ text('Your review', 'Deine Bewertung') }}</th><th>{{ text('Actions', 'Aktionen') }}</th></tr></thead>
        <tbody><template v-for="item in filteredOpportunities" :key="item.id">
          <tr :class="{ 'is-expanded': expandedOpportunity === item.id }">
            <td><strong>{{ item.title }}</strong><span class="jobs-subline">{{ item.university || '—' }}</span><span v-if="item.particularly_suitable" class="jobs-badge">{{ text('Strong fit', 'Besonders passend') }}</span></td>
            <td>{{ item.country || '—' }}</td><td><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.details, now) }">{{ formatOpportunityDeadline(item.details, lang) }}</span></td>
            <td class="jobs-topics">{{ item.topics.join(' · ') || '—' }}</td><td><span class="jobs-badge">{{ statusLabel(reviewState(item.id)) }}</span></td>
            <td><div class="jobs-row-actions"><button class="btn" type="button" :aria-expanded="expandedOpportunity === item.id" :aria-controls="`opportunity-review-${item.id}`" @click="toggleOpportunity(item.id)">{{ expandedOpportunity === item.id ? text('Collapse', 'Zuklappen') : text('Review', 'Ansehen') }}</button><button class="btn btn--success" type="button" :disabled="saving" @click="startApplication(item)">{{ applicationByOpportunity.has(item.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</button></div></td>
          </tr>
          <tr v-if="expandedOpportunity === item.id" class="jobs-expanded-row"><td colspan="6"><section :id="`opportunity-review-${item.id}`" class="jobs-inline-review" :aria-label="item.title"><div class="jobs-review-toolbar"><h2>{{ text('Opportunity review', 'Stelle prüfen') }}</h2><label>{{ text('Your review state', 'Deine Bewertung') }}<select :value="reviewState(item.id)" :disabled="saving" @change="changeReview(item, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label><span>{{ text('Private to your account', 'Nur für dein Konto') }}</span></div><OpportunityContext :context="item.details" :lang="lang" /></section></td></tr>
        </template><tr v-if="!filteredOpportunities.length"><td colspan="6" class="jobs-empty">{{ loading ? text('Loading opportunities…', 'Stellenangebote werden geladen…') : text('No matching opportunities. Adjust the deadline, application, review or search filters.', 'Keine passenden Stellen. Ändere die Frist-, Bewerbungs-, Bewertungs- oder Suchfilter.') }}</td></tr></tbody>
      </table>
      <table v-else>
        <thead><tr><th>{{ text('Application', 'Bewerbung') }}</th><th>{{ text('Deadline', 'Frist') }}</th><th>{{ text('Contact person', 'Kontaktperson') }}</th><th>{{ text('CV version', 'CV-Version') }}</th><th>{{ text('Status', 'Status') }}</th><th>{{ text('Actions', 'Aktionen') }}</th></tr></thead>
        <tbody><template v-for="item in filteredApplications" :key="item.id">
          <tr :class="{ 'is-expanded': editingId === item.id }"><td><strong>{{ contextTitle(item) }}</strong><span class="jobs-subline">{{ contextInstitution(item) }}</span></td><td>{{ formatOpportunityDeadline(item.context_json, lang) }}</td>
            <td><template v-for="(person, index) in contacts(item)" :key="index"><span class="jobs-subline">{{ person.name }}</span><a v-if="safeEmailUrl(person.email)" :href="safeEmailUrl(person.email)!">{{ person.email }}</a><span v-else>{{ person.email }}</span></template><span v-if="!contacts(item).length">{{ text('Not recorded', 'Nicht erfasst') }}</span></td>
            <td class="jobs-cv-column">{{ (item.cv_variant_id && cvById.get(item.cv_variant_id)?.name) || text('Select a CV later', 'CV später auswählen') }}</td><td><span class="jobs-badge">{{ statusLabel(item.status) }}</span></td><td><button class="btn" type="button" :disabled="saving" :aria-expanded="editingId === item.id" :aria-controls="`application-review-${item.id}`" @click="editingId === item.id ? (editingId = null, exportText = '', viewEpoch++) : openApplication(item)">{{ editingId === item.id ? text('Collapse', 'Zuklappen') : text('Review application', 'Bewerbung ansehen') }}</button></td></tr>
          <tr v-if="editingId === item.id" class="jobs-expanded-row"><td colspan="6"><section :id="`application-review-${item.id}`" class="jobs-inline-review">
            <div class="jobs-review-toolbar"><h2>{{ text('Application workspace', 'Bewerbung bearbeiten') }}</h2><span>{{ text('Context saved', 'Kontext gespeichert') }}: {{ dateLabel(item.context_captured_at) }}</span><button class="btn" type="button" :disabled="saving || hasUnsavedChanges || preparingContext" @click="refreshResearch">{{ text('Refresh research', 'Forschung aktualisieren') }}</button></div>
            <form class="application-inline-form" @submit.prevent="saveApplication">
              <div class="application-fields">
                <label class="application-notes">{{ text('CV version', 'CV-Version') }}<select v-model="form.versionId" :disabled="saving"><option value="">{{ item.cv_variant_id ? text('Keep assigned privacy CV', 'Zugewiesenen anonymisierten CV behalten') : text('No CV assigned — choose when ready', 'Noch kein CV zugewiesen — später auswählen') }}</option><option v-for="configuration in configurations" :key="configuration.id" :value="configuration.id">{{ configuration.name }}</option></select></label>
                <p v-if="!configurations.length" class="application-notes jobs-subline">{{ text('Save a local CV under Versions to assign it here. Your application is already saved.', 'Speichere einen lokalen CV unter Versionen, um ihn hier zuzuweisen. Deine Bewerbung ist bereits gespeichert.') }}</p>
                <label>{{ text('Status', 'Status') }}<select v-model="form.status" :disabled="saving"><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label>
                <label>{{ text('First contacted', 'Erster Kontakt') }}<input v-model="form.contactedAt" type="datetime-local" :disabled="saving" /></label>
                <label>{{ text('Submitted', 'Eingereicht') }}<input v-model="form.submittedAt" type="datetime-local" :disabled="saving" /></label>
                <label class="application-notes">{{ text('Notes', 'Notizen') }}<textarea v-model="form.notes" rows="3" maxlength="20000" :disabled="saving" /></label>
              </div>
              <details v-if="snapshot" class="jobs-upload-preview"><summary>{{ text('Review privacy CV before upload', 'Anonymisierten CV vor dem Upload prüfen') }}</summary><p>{{ text('Contact details, hidden content and !!confidential text!! are removed. Unmarked text remains included.', 'Kontaktdaten, ausgeblendete Inhalte und !!vertraulicher Text!! werden entfernt. Unmarkierter Text bleibt enthalten.') }}</p><pre>{{ JSON.stringify({ content: snapshot.content_json, config: snapshot.config_json }, null, 2) }}</pre></details>
              <p v-if="formError" class="jobs-error" role="alert">{{ formError }}</p><div class="jobs-form-footer"><span>{{ hasUnsavedChanges ? text('Unsaved changes', 'Ungespeicherte Änderungen') : text('All changes saved', 'Alle Änderungen gespeichert') }}</span><button class="btn btn--success" type="submit" :disabled="saving || !hasUnsavedChanges || (!!form.versionId && !selectedCv)">{{ saving ? text('Saving…', 'Speichert…') : text('Save changes', 'Änderungen speichern') }}</button></div>
            </form>
            <section class="jobs-evaluation"><h3>{{ text('Context for ChatGPT', 'Kontext für ChatGPT') }}</h3><p>{{ text('Prepare the saved opportunity research, requirements, documents, contacts and assigned privacy CV for a fit evaluation and a later one-page motivation draft.', 'Bereite die gespeicherte Forschung, Anforderungen, Unterlagen, Kontakte und den zugewiesenen anonymisierten CV für eine Eignungsbewertung und ein späteres einseitiges Motivationsschreiben vor.') }}</p><p v-if="hasUnsavedChanges" class="jobs-subline">{{ text('Save your changes before preparing the context.', 'Speichere deine Änderungen, bevor du den Kontext vorbereitest.') }}</p><button class="btn" type="button" :disabled="saving || preparingContext || hasUnsavedChanges" @click="prepareEvaluationContext">{{ preparingContext ? text('Preparing…', 'Wird vorbereitet…') : text('Prepare evaluation context', 'Bewertungskontext vorbereiten') }}</button><p v-if="contextError" class="jobs-error" role="alert">{{ contextError }}</p><div v-if="exportText" class="jobs-export"><label>{{ text('Evaluation brief', 'Bewertungsunterlagen') }}<textarea :value="exportText" readonly rows="8" /></label><div class="jobs-row-actions"><button class="btn" type="button" @click="copyContext">{{ text('Copy context', 'Kontext kopieren') }}</button><button class="btn" type="button" @click="downloadContext">{{ text('Download context (.md)', 'Kontext herunterladen (.md)') }}</button></div></div></section>
            <OpportunityContext :context="item.context_json" :lang="lang" />
          </section></td></tr>
        </template><tr v-if="!filteredApplications.length"><td colspan="6" class="jobs-empty">{{ loading ? text('Loading applications…', 'Bewerbungen werden geladen…') : text('No matching applications. Create one from an opportunity.', 'Keine passenden Bewerbungen. Lege eine aus einem Stellenangebot an.') }}<button class="btn" type="button" @click="emit('navigate', 'opportunities')">{{ text('Browse opportunities', 'Stellenangebote ansehen') }}</button></td></tr></tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.jobs-workspace { min-height: 0; overflow: auto; padding: 24px; border: 1px solid #134e4a; border-radius: 12px; color: #d1fae5; background: #06141f; scrollbar-width: thin; }
.jobs-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.jobs-heading h1 { margin: 4px 0 8px; font-size: 27px; letter-spacing: -.6px; }
.jobs-heading p { margin: 0 0 12px; color: #9bb3ad; line-height: 1.55; }
.jobs-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.8px; color: #6ee7b7 !important; }
.jobs-privacy { padding: 12px 14px; border: 1px solid #164e46; border-radius: 8px; background: #0c2428; color: #a9cec2; font-size: 12px; line-height: 1.6; }
.jobs-privacy .svg-inline--fa { margin-right: 6px; }
.jobs-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin: 24px 0 18px; }
.jobs-workspace label { display: grid; gap: 8px; font-size: 12px; }
.jobs-search { flex: 1; min-width: 200px; max-width: 450px; }
.jobs-toolbar .jobs-check { display: flex; align-items: center; }
.jobs-filter-checks { display: grid; gap: 8px; padding-bottom: 4px; }
.jobs-count { margin-left: auto; color: #9bb3ad; font-size: 12px; padding-bottom: 10px; }
.jobs-workspace input, .jobs-workspace select, .jobs-workspace textarea { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid #29524e; border-radius: 7px; background: #0b1b25; color: #e3f7ef; font: inherit; color-scheme: dark; }
.jobs-workspace input[type=checkbox] { width: auto; }
.jobs-workspace :is(button, input, select, textarea, summary, a):focus-visible { outline: 2px solid #6ee7b7; outline-offset: 3px; }
.jobs-workspace button:disabled { opacity: .5; cursor: not-allowed; }
.jobs-table-scroll { overflow-x: auto; border: 1px solid #173c3e; border-radius: 9px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
th { padding: 13px 14px; white-space: nowrap; background: #0d242c; color: #8db7ab; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
td { padding: 16px 14px; vertical-align: top; border-top: 1px solid #17383c; line-height: 1.5; }
td:first-child { min-width: 220px; max-width: 340px; }
td a { color: #8be9bf; overflow-wrap: anywhere; }
.jobs-subline { display: block; margin-top: 5px; color: #94afa6; font-size: 11px; }
.jobs-topics { min-width: 130px; max-width: 220px; color: #a7c4b9; }
.jobs-cv-column { min-width: 160px; max-width: 220px; overflow-wrap: anywhere; }
.jobs-row-actions { display: flex; flex-wrap: wrap; gap: 7px; min-width: 145px; }
.jobs-row-actions .btn { font-size: 11px; white-space: nowrap; }
.jobs-badge { display: inline-block; padding: 3px 7px; margin-top: 4px; border-radius: 5px; background: #123e36; color: #9be8c7; font-size: 10px; white-space: nowrap; }
.jobs-expired { color: #dfbc8a; }
.jobs-empty { padding: 45px 20px; text-align: center; color: #94afa6; }
.jobs-empty .btn { display: block; margin: 16px auto 0; }
.jobs-error { padding: 10px 12px; color: #fecaca; background: #381f28; border-radius: 7px; font-size: 12px; }
.jobs-notice { color: #86efac; font-size: 13px; }
tr.is-expanded { background: #0b242b; }
.jobs-expanded-row > td { padding: 0; min-width: 0; max-width: none; background: #0b1e27; }
.jobs-inline-review { padding: 22px; border-left: 3px solid #34c492; min-width: 0; }
.jobs-review-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 0 0 22px; }
.jobs-review-toolbar h2 { margin: 0 auto 0 0; font-size: 18px; color: #b6edda; }
.jobs-review-toolbar > span { color: #92afa6; font-size: 11px; }
.application-inline-form { display: grid; gap: 14px; padding: 20px; background: #071821; border: 1px solid #285047; border-radius: 10px; }
.application-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.application-notes { grid-column: 1 / -1; }
.jobs-form-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.jobs-form-footer > span { font-size: 11px; color: #91afa4; }
.jobs-upload-preview summary { color: #a0e7ca; cursor: pointer; }
.jobs-upload-preview pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #041016; font: 11px/1.5 monospace; }
.jobs-evaluation { margin: 24px 0; padding: 20px; border: 1px solid #28494b; border-radius: 10px; background: #0c202b; }
.jobs-evaluation h3 { margin: 0 0 8px; font-size: 16px; }
.jobs-evaluation p { color: #9ab7ad; line-height: 1.6; }
.jobs-export { display: grid; gap: 12px; margin-top: 18px; }
.jobs-export textarea { resize: vertical; font: 12px/1.5 monospace; }
@media (max-width: 760px) {
  .jobs-workspace { padding: 16px; }
  .jobs-heading h1 { font-size: 23px; }
  .jobs-heading p { font-size: 12px; }
  .jobs-count { display: none; }
  .jobs-inline-review { width: calc(100vw - 92px); padding: 14px; }
  .application-fields { grid-template-columns: 1fr; }
  .application-inline-form, .jobs-evaluation { padding: 14px; }
  .jobs-review-toolbar { align-items: stretch; }
}
</style>
