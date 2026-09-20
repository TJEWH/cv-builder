<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState, SavedConfiguration } from '../types';
import type { Application, Opportunity, OpportunityReviewState } from '../cloudTypes';
import { APPLICATION_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { useJobWorkspace } from '../composables/useJobWorkspace';
import { safeEmailUrl } from '../composables/safeUrl';
import { isOpportunityDeadlinePassed, opportunityDeadlineSortKey, formatOpportunityDeadline } from '../composables/opportunityDeadline';
import { opportunityRecency } from '../composables/opportunityRecency';
import { buildApplicationEvaluationContext } from '../composables/applicationEvaluationContext';
import OpportunityContext from './OpportunityContext.vue';
import ApplicationWorkspace from './ApplicationWorkspace.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import { removeApplicationCv } from '../composables/applicationCv';

const props = defineProps<{
  client: SupabaseClient | null; userId: string; tab: 'opportunities' | 'applications'; lang: string;
  configurations: SavedConfiguration[]; selectedId: string; readVersion: (id: string) => CvState | null;
  createSubvariant?: (parentId: string, name: string, state: CvState) => string | null;
}>();
const emit = defineEmits<{ navigate: [tab: 'opportunities' | 'applications']; 'save-career-variant': [name: string, state: CvState]; 'edit-variant': [id: string] }>();
const { opportunities, applications, reviews, loading, saving, error, createApplication,
  updateApplication, setApplicationChecklistItem, removeApplication, setOpportunityReview, markOpportunityReviewed, getApplicationContext, refreshApplicationContext } = useJobWorkspace(props.client, () => props.userId);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const queries = reactive({ opportunities: '', applications: '' });
const query = computed({ get: () => queries[props.tab], set: (value: string) => { queries[props.tab] = value; } });
const statusFilter = ref('');
const reviewFilter = ref('active');
const suitableOnly = ref(false);
const hideExpired = ref(true);
const hideWithApplication = ref(true);
const sortBy = ref('deadline');
const applicationSortBy = ref('deadline');
const removingId = ref<string | null>(null);
const removedOpportunityId = ref<string | null>(null);
const selectedOpportunityId = ref<string | null>(null);
try { selectedOpportunityId.value = sessionStorage.getItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(selectedOpportunityId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ } });
const editingId = ref<string | null>(null);
try { editingId.value = sessionStorage.getItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(editingId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_APPLICATION:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional preference. */ } });
const notice = ref('');
const formError = ref('');
const contextError = ref('');
const exportText = ref('');
const preparingContext = ref(false);
const tableScroll = ref<HTMLElement | null>(null);
const opportunityDetail = ref<HTMLElement | null>(null);
const form = reactive({ notes: '', contactedAt: '', submittedAt: '' });
const now = ref(new Date());
const clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
let viewEpoch = 0;
onBeforeUnmount(() => { window.clearInterval(clockTimer); viewEpoch++; });
const reviewById = computed(() => new Map(reviews.value.map((item) => [item.opportunity_id, item])));
const recencyById = computed(() => new Map(opportunities.value.map((item) => [item.id, opportunityRecency(item, now.value, reviewById.value.get(item.id)?.reviewed_updated_at)])));
const reviewState = (id: string): OpportunityReviewState => reviewById.value.get(id)?.state || 'unreviewed';
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
const filteredApplications = computed(() => applications.value.filter((item) => (!statusFilter.value || item.status === statusFilter.value)
  && [item.context_json.title, item.context_json.institution, item.context_json.university].join(' ').toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim()))
  .toSorted((a, b) => applicationSortBy.value === 'title' ? contextTitle(a).localeCompare(contextTitle(b))
    : applicationSortBy.value === 'institution' ? contextInstitution(a).localeCompare(contextInstitution(b))
      : opportunityDeadlineSortKey(a.context_json) - opportunityDeadlineSortKey(b.context_json)));
const editingApplication = computed(() => applications.value.find(({ id }) => id === editingId.value));
const selectedOpportunity = computed(() => opportunityById.value.get(selectedOpportunityId.value || ''));
const showingDetail = computed(() => props.tab === 'opportunities' ? Boolean(selectedOpportunity.value) : Boolean(editingApplication.value));
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
  return Boolean(item && (form.notes !== (item.notes || '')
    || form.contactedAt !== toLocalDateTime(item.contacted_at) || form.submittedAt !== toLocalDateTime(item.submitted_at)));
});
watch(() => props.tab, () => { notice.value = ''; removingId.value = null; removedOpportunityId.value = null; viewEpoch++; preparingContext.value = false; exportText.value = ''; });
watch(() => props.userId, () => { editingId.value = null; selectedOpportunityId.value = null; removingId.value = null; removedOpportunityId.value = null; viewEpoch++; exportText.value = ''; });
watch(form, () => { exportText.value = ''; contextError.value = ''; viewEpoch++; preparingContext.value = false; });
function focusResult(kind: 'opportunities' | 'applications', id: string) {
  nextTick(() => {
    if (props.tab !== kind) return;
    const row = Array.from(tableScroll.value?.querySelectorAll<HTMLElement>('[data-item-id]') || []).find((item) => item.dataset.itemId === id);
    row?.querySelector<HTMLButtonElement>('.jobs-row-toggle')?.focus({ preventScroll: true });
  });
}
function openOpportunity(id: string) {
  const opportunity = opportunityById.value.get(id);
  if (!opportunity) return;
  selectedOpportunityId.value = id;
  void markOpportunityReviewed(opportunity);
  nextTick(() => opportunityDetail.value?.focus({ preventScroll: true }));
}
function closeOpportunity() {
  const id = selectedOpportunityId.value;
  selectedOpportunityId.value = null;
  if (id) focusResult('opportunities', id);
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
  editingId.value = application.id;
  form.notes = application.notes || ''; form.contactedAt = toLocalDateTime(application.contacted_at); form.submittedAt = toLocalDateTime(application.submitted_at);
  formError.value = ''; exportText.value = ''; contextError.value = ''; viewEpoch++; preparingContext.value = false;
}
watch(editingApplication, (application, previous) => { if (application && !previous) openApplication(application); });
function closeApplication() {
  if (hasUnsavedChanges.value) { formError.value = text('Save overview changes before leaving this application.', 'Speichere die Übersicht, bevor du diese Bewerbung verlässt.'); return; }
  const id = editingId.value;
  editingId.value = null;
  if (id) focusResult('applications', id);
}
function toggleApplication(application: Application) {
  if (saving.value) return;
  if (hasUnsavedChanges.value) { formError.value = text('Save your changes before closing or switching applications.', 'Speichere deine Änderungen, bevor du die Bewerbung schließt oder wechselst.'); return; }
  if (editingId.value !== application.id) {
    openApplication(application);
    return;
  }
  editingId.value = null;
  exportText.value = '';
  preparingContext.value = false;
  viewEpoch++;
}
async function startApplication(item: Opportunity) {
  const existing = applicationByOpportunity.value.get(item.id);
  const application = existing || await createApplication({ opportunityId: item.id });
  if (!application) return;
  emit('navigate', 'applications');
  await nextTick();
  openApplication(application);
  notice.value = existing ? '' : text('Application created with all opportunity context. Assign a career variant in the CV tab when ready.', 'Bewerbung mit allen Stellendaten angelegt. Weise im CV-Tab eine Karrierevariante zu, sobald du bereit bist.');
}
async function saveApplication() {
  if (!editingId.value || saving.value) return;
  const id = editingId.value;
  const result = await updateApplication(id, { notes: form.notes,
    contactedAt: form.contactedAt || null, submittedAt: form.submittedAt || null });
  if (!result) { formError.value = error.value || text('Could not save.', 'Speichern fehlgeschlagen.'); return; }
  openApplication(result);
  notice.value = text('Application saved.', 'Bewerbung gespeichert.');
}
function invalidateEvaluation() { exportText.value = ''; contextError.value = ''; preparingContext.value = false; viewEpoch++; }
async function changeApplicationStatus(item: Application, event: Event) {
  const target = event.target as HTMLSelectElement;
  const result = await updateApplication(item.id, { status: target.value as Application['status'] });
  if (!result) target.value = item.status;
  else { invalidateEvaluation(); notice.value = text('Application status saved.', 'Bewerbungsstatus gespeichert.'); }
}
async function changeChecklist(item: Application, key: string, completed: boolean) {
  if (await setApplicationChecklistItem(item.id, key, completed)) invalidateEvaluation();
}
async function confirmRemoval(item: Application) {
  if (!await removeApplication(item.id)) return;
  removingId.value = null;
  if (editingId.value === item.id) editingId.value = null;
  try { removeApplicationCv(props.userId, item.id); } catch { /* Other local backups remain available. */ }
  invalidateEvaluation();
  removedOpportunityId.value = item.opportunity_id;
  notice.value = text('Application removed. The opportunity is available again.', 'Bewerbung entfernt. Die Stelle ist wieder verfügbar.');
}
async function showRemovedOpportunity() {
  const id = removedOpportunityId.value;
  const opportunity = id && opportunityById.value.get(id);
  emit('navigate', 'opportunities');
  await nextTick();
  query.value = ''; reviewFilter.value = 'active'; suitableOnly.value = false;
  if (opportunity) {
    if (isOpportunityDeadlinePassed(opportunity.details, now.value)) hideExpired.value = false;
    openOpportunity(opportunity.id);
  }
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
    <p v-if="error" class="jobs-error" role="alert">{{ error }}</p><p v-if="notice" class="jobs-notice" role="status">{{ notice }} <button v-if="removedOpportunityId" class="btn" type="button" @click="showRemovedOpportunity">{{ text('View opportunity', 'Stelle ansehen') }}</button></p>
    <div v-show="!showingDetail" class="jobs-toolbar">
      <label class="jobs-search"><span>{{ text('Search', 'Suchen') }}</span><input v-model="query" type="search" :placeholder="text('Title, institution or country…', 'Titel, Einrichtung oder Land…')" /></label>
      <template v-if="tab === 'opportunities'">
        <label>{{ text('Review state', 'Bewertung') }}<select v-model="reviewFilter"><option value="active">{{ text('Hide not interesting', 'Nicht interessante ausblenden') }}</option><option value="all">{{ text('All review states', 'Alle Bewertungen') }}</option><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
        <label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="sortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option></select></label>
        <div class="jobs-filter-checks"><label class="jobs-check"><input v-model="hideExpired" type="checkbox" /> {{ text('Hide past deadlines', 'Abgelaufene Fristen ausblenden') }}</label><label class="jobs-check"><input v-model="hideWithApplication" type="checkbox" /> {{ text('Hide opportunities with applications', 'Stellen mit Bewerbungen ausblenden') }}</label><label class="jobs-check"><input v-model="suitableOnly" type="checkbox" /> {{ text('Particularly suitable', 'Besonders passend') }}</label></div>
      </template>
      <template v-else><label>{{ text('Status', 'Status') }}<select v-model="statusFilter"><option value="">{{ text('All statuses', 'Alle Status') }}</option><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label><label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="applicationSortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option></select></label></template>
      <span class="jobs-count">{{ tab === 'opportunities' ? filteredOpportunities.length : filteredApplications.length }} {{ text('results', 'Ergebnisse') }}</span>
    </div>
    <div v-show="!showingDetail" ref="tableScroll" class="jobs-table-scroll" tabindex="0" :aria-label="text('Scrollable results table', 'Scrollbare Ergebnistabelle')">
      <table v-if="tab === 'opportunities'" class="jobs-opportunities-table">
        <colgroup><col style="width: 27%" /><col style="width: 10%" /><col style="width: 12%" /><col style="width: 17%" /><col style="width: 15%" /><col style="width: 19%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Opportunity', 'Stelle') }}</th><th scope="col">{{ text('Country', 'Land') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Topics', 'Themen') }}</th><th scope="col">{{ text('Your review', 'Deine Bewertung') }}</th><th scope="col">{{ text('Actions', 'Aktionen') }}</th></tr></thead>
        <tbody><template v-for="item in filteredOpportunities" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'jobs-opportunity--new': recencyById.get(item.id) === 'new', 'jobs-opportunity--updated': recencyById.get(item.id) === 'updated' }" @click="openOpportunity(item.id)">
            <td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :aria-label="`${text('Open opportunity:', 'Stelle öffnen:')} ${item.title}`" @click.stop="openOpportunity(item.id)"><span class="jobs-row-chevron" aria-hidden="true">›</span><strong>{{ item.title }}</strong></button><span class="jobs-subline">{{ item.university || '—' }}</span><div v-if="recencyById.get(item.id) || item.particularly_suitable" class="jobs-opportunity-badges"><span v-if="recencyById.get(item.id)" class="jobs-badge" :class="`jobs-badge--${recencyById.get(item.id)}`" :title="recencyById.get(item.id) === 'new' ? text('Added within the last 24 hours', 'In den letzten 24 Stunden hinzugefügt') : text('Updated within the last 24 hours', 'In den letzten 24 Stunden aktualisiert')">{{ recencyById.get(item.id) === 'new' ? text('New · 24h', 'Neu · 24 Std.') : text('Updated · 24h', 'Aktualisiert · 24 Std.') }}</span><span v-if="item.particularly_suitable" class="jobs-badge">{{ text('Strong fit', 'Besonders passend') }}</span></div></td>
            <td :data-label="text('Country', 'Land')">{{ item.country || '—' }}</td><td :data-label="text('Deadline', 'Frist')"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.details, now) }">{{ formatOpportunityDeadline(item.details, lang) }}</span></td>
            <td class="jobs-topics jobs-cell-wide" :data-label="text('Topics', 'Themen')">{{ item.topics.join(' · ') || '—' }}</td><td :data-label="text('Your review', 'Deine Bewertung')" @click.stop><select class="jobs-review-select" :aria-label="`${text('Review state for', 'Bewertung für')} ${item.title}`" :value="reviewState(item.id)" :disabled="saving" @change="changeReview(item, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></td>
            <td class="jobs-cell-actions"><div class="jobs-row-actions" @click.stop><button class="btn btn--success" type="button" :disabled="saving" @click="startApplication(item)">{{ applicationByOpportunity.has(item.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</button></div></td>
          </tr>
        </template><tr v-if="!filteredOpportunities.length"><td colspan="6" class="jobs-empty">{{ loading ? text('Loading opportunities…', 'Stellenangebote werden geladen…') : text('No matching opportunities. Adjust the deadline, application, review or search filters.', 'Keine passenden Stellen. Ändere die Frist-, Bewerbungs-, Bewertungs- oder Suchfilter.') }}</td></tr></tbody>
      </table>
      <table v-else class="jobs-applications-table">
        <colgroup><col style="width: 29%" /><col style="width: 16%" /><col style="width: 27%" /><col style="width: 16%" /><col style="width: 12%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Application', 'Bewerbung') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Contact person', 'Kontaktperson') }}</th><th scope="col">{{ text('Status', 'Status') }}</th><th scope="col">{{ text('Actions', 'Aktionen') }}</th></tr></thead>
        <tbody><template v-for="item in filteredApplications" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'is-expanded': editingId === item.id }" :aria-disabled="saving" @click="toggleApplication(item)"><td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :disabled="saving" :aria-label="`${text('Open application:', 'Bewerbung öffnen:')} ${contextTitle(item)}`" @click.stop="toggleApplication(item)"><span class="jobs-row-chevron" aria-hidden="true">›</span><strong>{{ contextTitle(item) }}</strong></button><span class="jobs-subline">{{ contextInstitution(item) }}</span></td><td :data-label="text('Deadline', 'Frist')"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.context_json, now) }">{{ formatOpportunityDeadline(item.context_json, lang) }}</span></td>
            <td class="jobs-cell-wide jobs-cell-contacts" :data-label="text('Contact person', 'Kontaktperson')"><template v-for="(person, index) in contacts(item)" :key="index"><span class="jobs-subline">{{ person.name }}</span><a v-if="safeEmailUrl(person.email)" :href="safeEmailUrl(person.email)!" @click.stop>{{ person.email }}</a><span v-else>{{ person.email }}</span></template><span v-if="!contacts(item).length">{{ text('Not recorded', 'Nicht erfasst') }}</span></td>
            <td :data-label="text('Status', 'Status')" @click.stop><select class="jobs-row-select" :aria-label="`${text('Status for', 'Status für')} ${contextTitle(item)}`" :value="item.status" :disabled="saving || hasUnsavedChanges" @change="changeApplicationStatus(item, $event)"><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></td>
            <td class="jobs-cell-actions" @click.stop><button class="btn btn--danger" type="button" :disabled="saving" :aria-label="`${text('Remove application for', 'Bewerbung entfernen für')} ${contextTitle(item)}`" @click="removingId = item.id">{{ text('Remove', 'Entfernen') }}</button></td></tr>
          <tr v-if="removingId === item.id" class="jobs-removal-row"><td colspan="5"><div class="jobs-removal-confirm" role="alert"><p>{{ text('Remove this application? Its notes, checklist progress and saved drafts will be deleted. Your CV versions remain available.', 'Bewerbung entfernen? Notizen, Checklistenfortschritt und gespeicherte Entwürfe werden gelöscht. Deine CV-Versionen bleiben erhalten.') }}</p><div class="jobs-row-actions"><button class="btn btn--danger" type="button" :disabled="saving" @click="confirmRemoval(item)">{{ text('Remove application', 'Bewerbung entfernen') }}</button><button class="btn" type="button" :disabled="saving" @click="removingId = null">{{ text('Cancel', 'Abbrechen') }}</button></div></div></td></tr>

        </template><tr v-if="!filteredApplications.length"><td colspan="5" class="jobs-empty">{{ loading ? text('Loading applications…', 'Bewerbungen werden geladen…') : text('No matching applications. Create one from an opportunity.', 'Keine passenden Bewerbungen. Lege eine aus einem Stellenangebot an.') }}<button class="btn" type="button" @click="emit('navigate', 'opportunities')">{{ text('Browse opportunities', 'Stellenangebote ansehen') }}</button></td></tr></tbody>
      </table>
    </div>
    <section v-if="selectedOpportunity" v-show="tab === 'opportunities'" ref="opportunityDetail" class="opportunity-detail" :aria-label="selectedOpportunity.title" tabindex="-1">
      <WorkspaceDetailHeader :title="selectedOpportunity.title" :subtitle="selectedOpportunity.university || undefined" :back-label="text('All opportunities', 'Alle Stellenangebote')" @back="closeOpportunity">
        <template #metadata>
          <span v-if="selectedOpportunity.country">{{ selectedOpportunity.country }}</span>
          <span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(selectedOpportunity.details, now) }">{{ text('Deadline', 'Frist') }}: {{ formatOpportunityDeadline(selectedOpportunity.details, lang) }}</span>
          <span v-if="selectedOpportunity.particularly_suitable" class="jobs-badge">{{ text('Strong fit', 'Besonders passend') }}</span>
          <label class="opportunity-detail__review">{{ text('Your review', 'Deine Bewertung') }}<select :value="reviewState(selectedOpportunity.id)" :disabled="saving" @change="changeReview(selectedOpportunity, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
          <button class="btn btn--success" type="button" :disabled="saving" @click="startApplication(selectedOpportunity)">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</button>
        </template>
      </WorkspaceDetailHeader>
      <div class="opportunity-detail__body"><OpportunityContext :key="selectedOpportunity.id" :context="selectedOpportunity.details" :lang="lang" /></div>
    </section>
    <ApplicationWorkspace v-if="editingApplication" v-show="tab === 'applications'" :key="userId + ':' + editingApplication.id" :application="editingApplication" :client="client" :user-id="userId" :lang="lang" :configurations="configurations" :read-version="readVersion" :create-subvariant="createSubvariant" :publish-cv="(state) => updateApplication(editingApplication!.id, { cvState: state })" @close="closeApplication" @edit-variant="id => emit('edit-variant', id)">
      <template #overview>
            <div class="jobs-review-toolbar"><h2>{{ text('Application workspace', 'Bewerbung bearbeiten') }}</h2><span>{{ text('Context saved', 'Kontext gespeichert') }}: {{ dateLabel(editingApplication.context_captured_at) }}</span><button class="btn" type="button" :disabled="saving || hasUnsavedChanges || preparingContext" @click="refreshResearch">{{ text('Refresh research', 'Forschung aktualisieren') }}</button></div>
            <form class="application-inline-form" @submit.prevent="saveApplication">
              <div class="application-fields">
                <label>{{ text('First contacted', 'Erster Kontakt') }}<input v-model="form.contactedAt" type="datetime-local" :disabled="saving" /></label>
                <label>{{ text('Submitted', 'Eingereicht') }}<input v-model="form.submittedAt" type="datetime-local" :disabled="saving" /></label>
                <label class="application-notes">{{ text('Notes', 'Notizen') }}<textarea v-model="form.notes" rows="3" maxlength="20000" :disabled="saving" /></label>
              </div>
              <p v-if="formError" class="jobs-error" role="alert">{{ formError }}</p><div class="jobs-form-footer"><span>{{ hasUnsavedChanges ? text('Unsaved changes', 'Ungespeicherte Änderungen') : text('All changes saved', 'Alle Änderungen gespeichert') }}</span><button class="btn btn--success" type="submit" :disabled="saving || !hasUnsavedChanges">{{ saving ? text('Saving…', 'Speichert…') : text('Save changes', 'Änderungen speichern') }}</button></div>
            </form>
            <section class="jobs-evaluation"><h3>{{ text('Context for ChatGPT', 'Kontext für ChatGPT') }}</h3><p>{{ text('Prepare the saved opportunity research, requirements, documents, contacts and assigned privacy CV for a fit evaluation and a later one-page motivation draft.', 'Bereite die gespeicherte Forschung, Anforderungen, Unterlagen, Kontakte und den zugewiesenen anonymisierten CV für eine Eignungsbewertung und ein späteres einseitiges Motivationsschreiben vor.') }}</p><p v-if="hasUnsavedChanges" class="jobs-subline">{{ text('Save your changes before preparing the context.', 'Speichere deine Änderungen, bevor du den Kontext vorbereitest.') }}</p><button class="btn" type="button" :disabled="saving || preparingContext || hasUnsavedChanges" @click="prepareEvaluationContext">{{ preparingContext ? text('Preparing…', 'Wird vorbereitet…') : text('Prepare evaluation context', 'Bewertungskontext vorbereiten') }}</button><p v-if="contextError" class="jobs-error" role="alert">{{ contextError }}</p><div v-if="exportText" class="jobs-export"><label>{{ text('Evaluation brief', 'Bewertungsunterlagen') }}<textarea :value="exportText" readonly rows="8" /></label><div class="jobs-row-actions"><button class="btn" type="button" @click="copyContext">{{ text('Copy context', 'Kontext kopieren') }}</button><button class="btn" type="button" @click="downloadContext">{{ text('Download context (.md)', 'Kontext herunterladen (.md)') }}</button></div></div></section>
            <OpportunityContext :context="editingApplication.context_json" :lang="lang" checklist :completed-keys="editingApplication.completed_checklist_keys || []" :saving="saving" @toggle-checklist="(key, completed) => changeChecklist(editingApplication!, key, completed)" />

      </template>
    </ApplicationWorkspace>
  </section>
</template>

<style scoped>
.jobs-workspace { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; color: #d1fae5; scrollbar-width: thin; }

.jobs-workspace > :not(.jobs-table-scroll) { flex-shrink: 0; }
.jobs-workspace > .application-workspace, .jobs-workspace > .opportunity-detail { flex: 1 1 auto; min-height: 0; }
.opportunity-detail { display: flex; flex-direction: column; min-width: 0; padding: 20px; overflow: hidden; border: 1px solid #24504e; border-radius: 12px; background: #06141f; }
.opportunity-detail__body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-gutter: stable; padding: 20px 4px 0 0; }
.jobs-workspace .opportunity-detail__review { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; margin-left: auto; }
.jobs-workspace .opportunity-detail__review select { width: auto; max-width: 100%; padding: 6px 9px; }
.jobs-workspace > .jobs-table-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; }
.jobs-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.jobs-heading h1 { margin: 4px 0 8px; font-size: 27px; letter-spacing: -.6px; }
.jobs-heading p { margin: 0 0 12px; color: #9bb3ad; line-height: 1.55; }
.jobs-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin: 0 0 18px; }
.jobs-workspace label { display: grid; gap: 8px; font-size: 12px; }
.jobs-search { flex: 1; min-width: 200px; max-width: 450px; }
.jobs-toolbar .jobs-check { display: flex; align-items: center; }
.jobs-filter-checks { display: grid; gap: 2px; }
.jobs-count { margin-left: auto; color: #9bb3ad; font-size: 12px; padding-bottom: 10px; }
.jobs-workspace input, .jobs-workspace select, .jobs-workspace textarea { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid #29524e; border-radius: 7px; background: #0b1b25; color: #e3f7ef; font: inherit; color-scheme: dark; }
.jobs-workspace input[type=checkbox] { width: auto; }
.jobs-workspace :is(button, input, select, textarea, summary, a):focus-visible { outline: 2px solid #6ee7b7; outline-offset: 3px; }
.jobs-workspace button:disabled { opacity: .5; cursor: not-allowed; }
.jobs-table-scroll { overflow-x: auto; border: 1px solid #173c3e; border-radius: 9px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
.jobs-opportunities-table, .jobs-applications-table { table-layout: fixed; min-width: 960px; }
.jobs-workspace td { min-width: 0; max-width: none; overflow-wrap: anywhere; }
.jobs-opportunities-table .jobs-row-actions { min-width: 0; }
.jobs-opportunities-table .jobs-row-actions .btn { white-space: normal; }
.jobs-workspace th { position: sticky; top: 0; z-index: 1; }
th { padding: 13px 14px; white-space: nowrap; background: #0d242c; color: #8db7ab; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
td { padding: 16px 14px; vertical-align: top; border-top: 1px solid #17383c; line-height: 1.5; }
td:first-child { min-width: 220px; max-width: 340px; }
td a { color: #8be9bf; overflow-wrap: anywhere; }
.jobs-subline { display: block; margin-top: 5px; color: #94afa6; font-size: 11px; }
.jobs-topics { min-width: 130px; max-width: 220px; color: #a7c4b9; }
.jobs-workspace .jobs-review-select, .jobs-workspace .jobs-row-select { width: 100%; min-width: 0; padding: 7px 5px; font-size: 11px; cursor: pointer; }
.jobs-removal-confirm { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: #fecaca; }
.jobs-removal-confirm p { flex: 1; min-width: 240px; margin: 0; }
.jobs-row-actions { display: flex; flex-wrap: wrap; gap: 7px; min-width: 145px; }
.jobs-row-actions .btn { font-size: 11px; white-space: nowrap; }
.jobs-badge { display: inline-block; padding: 3px 7px; margin-top: 4px; border-radius: 5px; background: #123e36; color: #9be8c7; font-size: 10px; white-space: nowrap; }
.jobs-expired { color: #dfbc8a; }
.jobs-empty { padding: 45px 20px; text-align: center; color: #94afa6; }
.jobs-empty .btn { display: block; margin: 16px auto 0; }
.jobs-error { padding: 10px 12px; color: #fecaca; background: #381f28; border-radius: 7px; font-size: 12px; }
.jobs-notice { color: #86efac; font-size: 13px; }
.jobs-opportunity-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.jobs-badge--new { background: #153e57; color: #b9e5ff; }
.jobs-badge--updated { background: #49351c; color: #ffe0a0; }
tr.jobs-opportunity--new { background: #0b202e; }
tr.jobs-opportunity--updated { background: #24241e; }
.jobs-opportunity--new > td:first-child { box-shadow: inset 3px 0 #77caff; }
.jobs-opportunity--updated > td:first-child { box-shadow: inset 3px 0 #efbf69; }
tr.is-expanded { background: #0b242b; }
.jobs-result-row { cursor: pointer; }
.jobs-result-row[aria-disabled="true"] { cursor: wait; }
.jobs-result-row:hover, .jobs-result-row:focus-within { background: #103038; }
.jobs-row-toggle { display: flex; align-items: baseline; gap: 8px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.jobs-row-chevron { display: inline-block; flex-shrink: 0; color: #6ee7b7; font-size: 18px; line-height: 1; transition: transform .15s ease; }
.jobs-review-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 0 0 22px; }
.jobs-review-toolbar h2 { margin: 0 auto 0 0; font-size: 18px; color: #b6edda; }
.jobs-review-toolbar > span { color: #92afa6; font-size: 11px; }
.application-inline-form { display: grid; gap: 14px; padding: 0; background: transparent; border: 0; border-radius: 0; }
.application-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.application-notes { grid-column: 1 / -1; }
.jobs-form-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.jobs-form-footer > span { font-size: 11px; color: #91afa4; }
.jobs-upload-preview summary { color: #a0e7ca; cursor: pointer; }
.jobs-upload-preview pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #041016; font: 11px/1.5 monospace; }
.jobs-evaluation { margin: 24px 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
.jobs-evaluation h3 { margin: 0 0 8px; font-size: 16px; }
.jobs-evaluation p { color: #9ab7ad; line-height: 1.6; }
.jobs-export { display: grid; gap: 12px; margin-top: 18px; }
.jobs-export textarea { resize: vertical; font: 12px/1.5 monospace; }
@media (max-width: 1000px) {
  .jobs-table-scroll { border: 0; border-radius: 0; }
  .jobs-opportunities-table, .jobs-applications-table { display: block; table-layout: auto; min-width: 0; }
  table colgroup { display: none; }
  table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  table tbody { display: grid; gap: 12px; }
  table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; min-width: 0; overflow: hidden; border: 1px solid #29504b; border-radius: 10px; background: #081b25; }
  .jobs-workspace td { display: block; min-width: 0; max-width: none; padding: 11px 12px; border: 0; }
  td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 5px; color: #8db7ab; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; }
  .jobs-cell-heading, .jobs-cell-wide, .jobs-empty, .jobs-removal-row > td { grid-column: 1 / -1; }
  .jobs-cell-heading { background: #102730; border-bottom: 1px solid #29504b; }
  .jobs-row-toggle { font-size: 14px; }
  .jobs-cell-actions { display: flex; align-self: end; }
  .jobs-cell-actions .btn { width: 100%; white-space: normal; }
  .jobs-cell-actions .jobs-row-actions { width: 100%; min-width: 0; }
  .jobs-workspace .jobs-row-select, .jobs-workspace .jobs-review-select { min-height: 40px; font-size: 12px; }
  .jobs-result-row .btn { min-height: 40px; }
  .jobs-removal-confirm p { min-width: 0; flex-basis: 100%; }
}
@media (min-width: 761px) and (max-height: 600px) {
  .jobs-workspace { padding: 10px; }
  .opportunity-detail { padding: 10px; }
}
@media (max-width: 760px) {
  .jobs-workspace { padding: 0; }
  .jobs-heading h1 { font-size: 23px; }
  .jobs-heading p { font-size: 12px; }
  .jobs-toolbar { margin-bottom: 12px; }
  .jobs-toolbar > :not(.jobs-search) { display: none; }
  .jobs-search { flex-basis: 100%; max-width: none; min-width: 0; }
  .jobs-search > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  table tbody { gap: 8px; }
  table tr { column-gap: 12px; border: 0; border-bottom: 1px solid #21423e; border-radius: 0; background: transparent; }
  .jobs-workspace td { padding: 8px 0; }
  .jobs-cell-heading { background: transparent; }
  .jobs-opportunity--new > td:first-child, .jobs-opportunity--updated > td:first-child { box-shadow: none; }
  .opportunity-detail { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .opportunity-detail__body { padding: 12px 0 0; scrollbar-gutter: auto; }
  .jobs-workspace .opportunity-detail__review { margin-left: 0; }
  .jobs-form-footer { flex-wrap: wrap; }
  .application-fields { grid-template-columns: 1fr; }
  .application-inline-form, .jobs-evaluation { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .jobs-review-toolbar { align-items: stretch; gap: 10px; margin-bottom: 16px; }
  .jobs-review-toolbar h2 { display: none; }
  .jobs-workspace :deep(.opportunity-context) { gap: 8px; }
  .jobs-workspace :deep(.opportunity-context__group) { padding: 10px 0; border: 0; border-radius: 0; background: transparent; }
  .jobs-workspace :deep(.opportunity-context__group[open] > summary) { margin-bottom: 12px; }
  .jobs-workspace :deep(.opportunity-context__group dl) { gap: 14px; }
  .jobs-workspace :deep(.opportunity-context__field--fit) { padding: 0; border: 0; border-radius: 0; background: transparent; }
}
</style>
