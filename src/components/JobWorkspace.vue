<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CvState, SavedConfiguration } from '../types';
import type { Application, Opportunity, OpportunityReviewState } from '../cloudTypes';
import { APPLICATION_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { useJobWorkspace } from '../composables/useJobWorkspace';
import { safeEmailUrl } from '../composables/safeUrl';
import { isOpportunityDeadlinePassed, opportunityDeadlineSortKey, formatOpportunityDeadline } from '../composables/opportunityDeadline';
import { hasReviewedOpportunity, opportunityRecency } from '../composables/opportunityRecency';
import { personalFitScore } from '../composables/opportunityContext';
import { applicationStatusHistory } from '../composables/applicationTracking';
import OpportunityContext from './OpportunityContext.vue';
import ApplicationWorkspace from './ApplicationWorkspace.vue';
import ApplicationIdentifier from './ApplicationIdentifier.vue';
import WorkspaceDetailHeader from './WorkspaceDetailHeader.vue';
import { removeApplicationCv } from '../composables/applicationCv';
import { useToastWatch } from '../composables/useToasts';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../composables/desktopSidebar';

const props = withDefaults(defineProps<{
  client: SupabaseClient | null; userId: string; tab: 'opportunities' | 'applications'; lang: string;
  configurations: SavedConfiguration[]; selectedId: string; readVersion: (id: string) => CvState | null;
  createSubvariant?: (parentId: string, name: string, state: CvState) => string | null;
  projectId?: string;
  active?: boolean;
}>(), { active: true });
const desktopSidebar = useDesktopSidebar();
const sidebarActive = computed(() => desktopSidebar.value && props.active !== false);
const emit = defineEmits<{ navigate: [tab: 'opportunities' | 'applications']; 'save-career-variant': [name: string, state: CvState]; 'edit-variant': [id: string] }>();
const { opportunities, applications, reviews, loading, saving, error, createApplication,
  updateApplication, setApplicationChecklistItem, removeApplication, setOpportunityReview, markOpportunityReviewed, refreshApplicationContext } = useJobWorkspace(props.client, () => props.userId);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const queries = reactive({ opportunities: '', applications: '' });
const query = computed({ get: () => queries[props.tab], set: (value: string) => { queries[props.tab] = value; } });
const statusFilter = ref('');
const reviewFilter = ref('all');
const hideNotInterested = ref(true);
const deadlineFilter = ref<'current' | 'past'>('current');
const opportunityFiltersOpen = ref(false);
const hideWithApplication = ref(true);
const sortBy = ref('deadline');
const applicationSortBy = ref('deadline');
const removingId = ref<string | null>(null);
const removalDialog = ref<HTMLDialogElement | null>(null);
const removedOpportunityId = ref<string | null>(null);
const visitedOpportunityVersions = ref(new Map<string, string | null>());
const selectedOpportunityId = ref<string | null>(null);
try { selectedOpportunityId.value = sessionStorage.getItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(selectedOpportunityId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_OPPORTUNITY:${props.userId}`); } catch { /* Optional navigation state. */ } });
const editingId = ref<string | null>(null);
try { editingId.value = sessionStorage.getItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional navigation state. */ }
watch(editingId, (id) => { try { if (id) sessionStorage.setItem(`CV_SELECTED_APPLICATION:${props.userId}`, id); else sessionStorage.removeItem(`CV_SELECTED_APPLICATION:${props.userId}`); } catch { /* Optional preference. */ } });
const notice = ref('');
const formError = ref('');
const tableScroll = ref<HTMLElement | null>(null);
const opportunityDetail = ref<HTMLElement | null>(null);
const form = reactive({ notes: '' });
const now = ref(new Date());
const clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
onBeforeUnmount(() => { window.clearInterval(clockTimer); });
const reviewById = computed(() => new Map(reviews.value.map((item) => [item.opportunity_id, item])));
const reviewedVersionById = computed(() => new Map(opportunities.value.map((item) => {
  const localVisit = visitedOpportunityVersions.value.get(item.id);
  const savedVisit = reviewById.value.get(item.id)?.reviewed_updated_at;
  const versions = [localVisit, savedVisit].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  return [item.id, versions.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0]];
})));
const recencyById = computed(() => new Map(opportunities.value.map((item) => [item.id, opportunityRecency(item, now.value, reviewedVersionById.value.get(item.id))])));
// The visit marker persists after the 24-hour badge and priority grouping expire.
const unseenById = computed(() => new Map(opportunities.value.map((item) => {
  const reviewedVersion = reviewedVersionById.value.get(item.id);
  const visitedWithoutVersion = !item.updated_at && !item.created_at && (visitedOpportunityVersions.value.has(item.id) || !!reviewedVersion);
  return [item.id, hasReviewedOpportunity(item, reviewedVersion) || visitedWithoutVersion ? null : recencyById.value.get(item.id) || (reviewedVersion ? 'updated' : 'new')];
})));
const fitScoreById = computed(() => new Map(opportunities.value.map((item) => [item.id, personalFitScore(item.details.personal_fit ?? item.data.personal_fit)])));
function fitTone(score: number | undefined) { return score !== undefined && score >= 9.6 ? 'red' : score !== undefined && score >= 9.1 ? 'yellow' : undefined; }
function fitLabel(score: number | undefined) { return score === undefined ? '' : `${props.lang === 'de' ? String(score).replace('.', ',') : score} / 10`; }
const reviewState = (id: string): OpportunityReviewState => reviewById.value.get(id)?.state || 'unreviewed';
const applicationByOpportunity = computed(() => new Map(applications.value.map((item) => [item.opportunity_id, item])));
const filteredOpportunities = computed(() => {
  const needle = query.value.toLocaleLowerCase().trim();
  return opportunities.value.filter((item) => (isOpportunityDeadlinePassed(item.details, now.value) === (deadlineFilter.value === 'past'))
    && (!hideWithApplication.value || !applicationByOpportunity.value.has(item.id))
    && (!hideNotInterested.value || reviewState(item.id) !== 'not_interested')
    && (reviewFilter.value === 'all' || reviewState(item.id) === reviewFilter.value)
    && (!needle || [item.title, item.university, item.country, ...item.topics].join(' ').toLocaleLowerCase().includes(needle)))
    .toSorted((a, b) => sortBy.value === 'personal_fit' ? (fitScoreById.value.get(b.id) ?? -1) - (fitScoreById.value.get(a.id) ?? -1)
      : sortBy.value === 'title' ? a.title.localeCompare(b.title)
      : sortBy.value === 'institution' ? (a.university || '').localeCompare(b.university || '')
        : opportunityDeadlineSortKey(a.details) - opportunityDeadlineSortKey(b.details));
});
const opportunityGroups = computed(() => {
  const recent: Opportunity[] = [];
  const other: Opportunity[] = [];
  for (const item of filteredOpportunities.value) {
    (recencyById.value.get(item.id) ? recent : other).push(item);
  }
  return [
    { key: 'recent', title: text('New & updated · 24h', 'Neu & aktualisiert · 24 Std.'), items: recent },
    { key: 'other', title: recent.length ? text('Other opportunities', 'Weitere Stellenangebote') : '', items: other },
  ].filter((group) => group.items.length);
});
const opportunityById = computed(() => new Map(opportunities.value.map((item) => [item.id, item])));
const filteredApplications = computed(() => applications.value.filter((item) => (!statusFilter.value || item.status === statusFilter.value)
  && [item.application_code, item.id, item.context_json.title, item.context_json.institution, item.context_json.university].join(' ').toLocaleLowerCase().includes(query.value.toLocaleLowerCase().trim()))
  .toSorted((a, b) => applicationSortBy.value === 'title' ? contextTitle(a).localeCompare(contextTitle(b))
    : applicationSortBy.value === 'institution' ? contextInstitution(a).localeCompare(contextInstitution(b))
      : opportunityDeadlineSortKey(a.context_json) - opportunityDeadlineSortKey(b.context_json)));
const editingApplication = computed(() => applications.value.find(({ id }) => id === editingId.value));
const selectedOpportunity = computed(() => opportunityById.value.get(selectedOpportunityId.value || ''));
const showingDetail = computed(() => props.tab === 'opportunities' ? Boolean(selectedOpportunity.value) : Boolean(editingApplication.value));
const statusNames: Record<string, [string, string]> = {
  shortlist: ['Shortlist', 'Vorgemerkt'], contacted: ['Contacted', 'Kontaktiert'], submitted: ['Submitted', 'Eingereicht'],
  interview: ['Interview', 'Gespräch'], offer: ['Offer', 'Angebot'], rejected: ['Rejected', 'Abgelehnt'], withdrawn: ['Withdrawn', 'Zurückgezogen'],
  unreviewed: ['Not reviewed', 'Ungeprüft'], interested: ['Interested', 'Interessant'], strong_interest: ['Strong interest', 'Starkes Interesse'], not_interested: ['Not interesting', 'Nicht interessant'],
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
const statusHistory = computed(() => editingApplication.value ? applicationStatusHistory(editingApplication.value) : []);
function timestampLabel(value: string) {
  return new Intl.DateTimeFormat(props.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
}
const hasUnsavedChanges = computed(() => Boolean(editingApplication.value && form.notes !== (editingApplication.value.notes || '')));
watch(() => props.tab, () => { notice.value = ''; cancelRemoval(); removedOpportunityId.value = null; });
watch(() => props.userId, () => { editingId.value = null; selectedOpportunityId.value = null; cancelRemoval(); removedOpportunityId.value = null; visitedOpportunityVersions.value = new Map(); });
watch(form, () => { formError.value = ''; });
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
  opportunityFiltersOpen.value = false;
  recordOpportunityVisit(opportunity);
  selectedOpportunityId.value = id;
  nextTick(() => opportunityDetail.value?.focus({ preventScroll: true }));
}
function recordOpportunityVisit(opportunity: Opportunity) {
  const version = opportunity.updated_at || opportunity.created_at;
  if (visitedOpportunityVersions.value.has(opportunity.id) && visitedOpportunityVersions.value.get(opportunity.id) === version) return;
  // Move an opened result immediately, including while its remote receipt is pending.
  visitedOpportunityVersions.value.set(opportunity.id, version);
  void markOpportunityReviewed(opportunity);
}
watch([selectedOpportunity, () => props.tab], ([opportunity, tab]) => {
  if (opportunity && tab === 'opportunities') recordOpportunityVisit(opportunity);
}, { immediate: true });
function closeOpportunity() {
  const id = selectedOpportunityId.value;
  selectedOpportunityId.value = null;
  if (id) focusResult('opportunities', id);
}
async function changeReview(item: Opportunity, event: Event) {
  notice.value = '';
  const target = event.target as HTMLSelectElement;
  const result = await setOpportunityReview(item.id, target.value as OpportunityReviewState);
  if (!result) target.value = reviewState(item.id);
  else notice.value = result.state === 'not_interested' && hideNotInterested.value
    ? text('Marked as not interesting. Uncheck “Hide not interesting” to show it again.', 'Als nicht interessant markiert. Deaktiviere „Nicht interessante ausblenden“, um sie wieder anzuzeigen.')
    : text('Your review state was saved.', 'Deine Bewertung wurde gespeichert.');
}
function openApplication(application: Application) {
  editingId.value = application.id;
  form.notes = application.notes || '';
  formError.value = '';
}
watch(editingApplication, (application, previous) => { if (application && !previous) openApplication(application); });
function closeApplication() {
  formError.value = '';
  if (hasUnsavedChanges.value) { formError.value = text('Save your notes before leaving this application.', 'Speichere deine Notizen, bevor du diese Bewerbung verlässt.'); return; }
  const id = editingId.value;
  editingId.value = null;
  if (id) focusResult('applications', id);
}
function toggleApplication(application: Application) {
  if (saving.value) return;
  formError.value = '';
  if (hasUnsavedChanges.value) { formError.value = text('Save your changes before closing or switching applications.', 'Speichere deine Änderungen, bevor du die Bewerbung schließt oder wechselst.'); return; }
  if (editingId.value !== application.id) {
    openApplication(application);
    return;
  }
  editingId.value = null;
}
async function startApplication(item: Opportunity) {
  notice.value = '';
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
  notice.value = ''; formError.value = '';
  const id = editingId.value;
  const result = await updateApplication(id, { notes: form.notes });
  if (!result) { formError.value = error.value || text('Could not save.', 'Speichern fehlgeschlagen.'); return; }
  openApplication(result);
  notice.value = text('Application saved.', 'Bewerbung gespeichert.');
}
async function changeApplicationStatus(item: Application, event: Event) {
  notice.value = '';
  const target = event.target as HTMLSelectElement;
  const result = await updateApplication(item.id, { status: target.value as Application['status'] });
  if (!result) target.value = item.status;
  else { notice.value = text('Application status saved.', 'Bewerbungsstatus gespeichert.'); }
}
async function changeChecklist(item: Application, key: string, completed: boolean) {
  await setApplicationChecklistItem(item.id, key, completed);
}
async function confirmRemoval(item: Application) {
  notice.value = '';
  if (!await removeApplication(item.id)) return;
  cancelRemoval();
  if (editingId.value === item.id) editingId.value = null;
  try { removeApplicationCv(props.userId, item.id); } catch { /* Other local backups remain available. */ }
  removedOpportunityId.value = item.opportunity_id;
  notice.value = text('Application removed. The opportunity is available again.', 'Bewerbung entfernt. Die Stelle ist wieder verfügbar.');
}
async function requestDetailRemoval(item: Application) {
  removingId.value = item.id;
  await nextTick();
  if (editingId.value === item.id && removingId.value === item.id && !removalDialog.value?.open) removalDialog.value?.showModal();
}
function cancelRemoval() {
  removingId.value = null;
  removalDialog.value?.close();
}
async function showRemovedOpportunity(id: string) {
  const opportunity = id && opportunityById.value.get(id);
  emit('navigate', 'opportunities');
  await nextTick();
  query.value = ''; reviewFilter.value = 'all'; hideNotInterested.value = true;
  if (opportunity) {
    deadlineFilter.value = isOpportunityDeadlinePassed(opportunity.details, now.value) ? 'past' : 'current';
    openOpportunity(opportunity.id);
  }
}
async function refreshResearch() {
  if (!editingId.value || saving.value || hasUnsavedChanges.value) return;
  notice.value = '';
  const result = await refreshApplicationContext(editingId.value);
  if (!result) return;
  openApplication(result);
  notice.value = text('Research context refreshed from the opportunity. Your CV and application progress are preserved.', 'Forschungskontext aus dem Stellenangebot aktualisiert. CV und Bewerbungsfortschritt bleiben erhalten.');
}
useToastWatch(() => error.value, { tone: 'error' });
useToastWatch(() => formError.value !== error.value ? formError.value : '', { tone: 'error' });
useToastWatch(() => notice.value, () => {
  const id = removedOpportunityId.value;
  const removed = notice.value === text('Application removed. The opportunity is available again.', 'Bewerbung entfernt. Die Stelle ist wieder verfügbar.');
  return { tone: 'success', action: id && removed ? { label: text('View opportunity', 'Stelle ansehen'), run: () => showRemovedOpportunity(id) } : undefined };
});
</script>

<template>
  <section :id="`builder-group-${tab}`" class="jobs-workspace" :aria-label="tab === 'opportunities' ? text('Opportunities', 'Stellenangebote') : text('Applications', 'Bewerbungen')">
    <DesktopSidebarPortal area="major" :active="props.active !== false && !showingDetail">
    <div v-show="!showingDetail" class="jobs-toolbar jobs-sidebar-controls" :class="{ 'jobs-toolbar--sidebar': sidebarActive }">
      <label class="jobs-search"><span>{{ text('Search', 'Suchen') }}</span><input v-model="query" type="search" :placeholder="tab === 'applications' ? text('Title, institution or application ID…', 'Titel, Einrichtung oder Bewerbungs-ID…') : text('Title, institution or country…', 'Titel, Einrichtung oder Land…')" /></label>
      <button v-if="tab === 'opportunities'" class="btn jobs-filter-toggle" type="button" :aria-expanded="opportunityFiltersOpen" aria-controls="opportunity-filters" @click="opportunityFiltersOpen = !opportunityFiltersOpen">{{ text('Filters', 'Filter') }}</button>
      <div v-if="tab === 'opportunities'" id="opportunity-filters" class="jobs-opportunity-filters" :class="{ 'is-open': opportunityFiltersOpen }">
        <label>{{ text('Review state', 'Bewertung') }}<select v-model="reviewFilter"><option value="all">{{ text('All review states', 'Alle Bewertungen') }}</option><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
        <label>{{ text('Opportunities', 'Stellenangebote') }}<select v-model="deadlineFilter"><option value="current">{{ text('Current opportunities', 'Aktuelle Stellenangebote') }}</option><option value="past">{{ text('Past opportunities', 'Abgelaufene Stellenangebote') }}</option></select></label>
        <label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="sortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option><option value="personal_fit">{{ text('Personal fit: high to low', 'Persönliche Passung: absteigend') }}</option></select></label>
        <DesktopSidebarPortal area="minor" :active="props.active !== false && !showingDetail">
          <div class="jobs-filter-checks jobs-sidebar-controls"><label class="jobs-check"><input v-model="hideWithApplication" type="checkbox" /> {{ text('Hide applications', 'Stellen mit Bewerbungen ausblenden') }}</label><label class="jobs-check"><input v-model="hideNotInterested" type="checkbox" /> {{ text('Hide not interesting', 'Nicht interessante ausblenden') }}</label></div>
        </DesktopSidebarPortal>
      </div>
      <template v-else><label>{{ text('Status', 'Status') }}<select v-model="statusFilter"><option value="">{{ text('All statuses', 'Alle Status') }}</option><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label><label>{{ text('Sort by', 'Sortieren nach') }}<select v-model="applicationSortBy"><option value="deadline">{{ text('Deadline', 'Frist') }}</option><option value="title">{{ text('Title', 'Titel') }}</option><option value="institution">{{ text('Institution', 'Einrichtung') }}</option></select></label></template>
      <span class="jobs-count">{{ tab === 'opportunities' ? filteredOpportunities.length : filteredApplications.length }} {{ text('results', 'Ergebnisse') }}</span>
    </div>
    </DesktopSidebarPortal>
    <div v-show="!showingDetail" ref="tableScroll" class="jobs-table-scroll" tabindex="0" :aria-label="text('Scrollable results table', 'Scrollbare Ergebnistabelle')">
      <table v-if="tab === 'opportunities'" class="jobs-opportunities-table">
        <colgroup><col style="width: 27%" /><col style="width: 10%" /><col style="width: 12%" /><col style="width: 17%" /><col style="width: 15%" /><col style="width: 19%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Opportunity', 'Stelle') }}</th><th scope="col">{{ text('Country', 'Land') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Topics', 'Themen') }}</th><th scope="col">{{ text('Your review', 'Deine Bewertung') }}</th><th scope="col">{{ text('Actions', 'Aktionen') }}</th></tr></thead>
        <tbody v-for="group in opportunityGroups" :key="group.key">
          <tr v-if="group.title" class="jobs-group-row" :data-opportunity-group="group.key"><th scope="rowgroup" colspan="6">{{ group.title }} <span>{{ group.items.length }}</span></th></tr>
          <template v-for="item in group.items" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'jobs-opportunity--new': recencyById.get(item.id) === 'new', 'jobs-opportunity--updated': recencyById.get(item.id) === 'updated', 'jobs-opportunity--unseen-new': unseenById.get(item.id) === 'new', 'jobs-opportunity--unseen-updated': unseenById.get(item.id) === 'updated' }" @click="openOpportunity(item.id)">
            <td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :aria-label="`${text('Open opportunity:', 'Stelle öffnen:')} ${item.title}`" @click.stop="openOpportunity(item.id)"><span class="jobs-row-chevron" aria-hidden="true">›</span><strong>{{ item.title }}</strong></button><span class="jobs-subline">{{ item.university || '—' }}</span><div v-if="recencyById.get(item.id) || (item.particularly_suitable && fitScoreById.get(item.id) !== undefined)" class="jobs-opportunity-badges"><span v-if="recencyById.get(item.id)" class="jobs-badge" :class="`jobs-badge--${recencyById.get(item.id)}`" :title="recencyById.get(item.id) === 'new' ? text('Added within the last 24 hours', 'In den letzten 24 Stunden hinzugefügt') : text('Updated within the last 24 hours', 'In den letzten 24 Stunden aktualisiert')">{{ recencyById.get(item.id) === 'new' ? text('New · 24h', 'Neu · 24 Std.') : text('Updated · 24h', 'Aktualisiert · 24 Std.') }}</span><span v-if="item.particularly_suitable && fitScoreById.get(item.id) !== undefined" class="jobs-badge jobs-fit-score" :class="fitTone(fitScoreById.get(item.id)) && `jobs-fit-score--${fitTone(fitScoreById.get(item.id))}`" :aria-label="`${text('Personal fit', 'Persönliche Passung')}: ${fitLabel(fitScoreById.get(item.id))}`" :title="text('Personal fit score', 'Bewertung der persönlichen Passung')">{{ fitLabel(fitScoreById.get(item.id)) }}</span></div></td>
            <td :data-label="text('Country', 'Land')">{{ item.country || '—' }}</td><td :data-label="text('Deadline', 'Frist')"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.details, now) }">{{ formatOpportunityDeadline(item.details, lang) }}</span></td>
            <td class="jobs-topics jobs-cell-wide" :data-label="text('Topics', 'Themen')">{{ item.topics.join(' · ') || '—' }}</td><td class="jobs-cell-state" :data-label="text('Your review', 'Deine Bewertung')" @click.stop><select class="jobs-review-select" :aria-label="`${text('Review state for', 'Bewertung für')} ${item.title}`" :value="reviewState(item.id)" :disabled="saving" @change="changeReview(item, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></td>
            <td class="jobs-cell-actions"><div class="jobs-row-actions" @click.stop><button class="btn btn--success" type="button" :disabled="saving" @click="startApplication(item)">{{ applicationByOpportunity.has(item.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</button></div></td>
          </tr>
        </template></tbody><tbody v-if="!filteredOpportunities.length"><tr><td colspan="6" class="jobs-empty"><p :class="{ 'app-hint': !loading }">{{ loading ? text('Loading opportunities…', 'Stellenangebote werden geladen…') : text('No matching opportunities. Adjust the deadline, application, review or search filters.', 'Keine passenden Stellen. Ändere die Frist-, Bewerbungs-, Bewertungs- oder Suchfilter.') }}</p></td></tr></tbody>
      </table>
      <table v-else class="jobs-applications-table">
        <colgroup><col style="width: 34%" /><col style="width: 18%" /><col style="width: 30%" /><col style="width: 18%" /></colgroup>
        <thead><tr><th scope="col">{{ text('Application', 'Bewerbung') }}</th><th scope="col">{{ text('Deadline', 'Frist') }}</th><th scope="col">{{ text('Contact person', 'Kontaktperson') }}</th><th scope="col">{{ text('Status', 'Status') }}</th></tr></thead>
        <tbody><template v-for="item in filteredApplications" :key="item.id">
          <tr :data-item-id="item.id" class="jobs-result-row" :class="{ 'is-expanded': editingId === item.id }" :aria-disabled="saving" @click="toggleApplication(item)"><td class="jobs-cell-heading"><button class="jobs-row-toggle" type="button" :disabled="saving" :aria-label="`${text('Open application:', 'Bewerbung öffnen:')} ${contextTitle(item)}`" @click.stop="toggleApplication(item)"><span class="jobs-row-chevron" aria-hidden="true">›</span><strong>{{ contextTitle(item) }}</strong></button><span class="jobs-subline">{{ contextInstitution(item) }}</span><ApplicationIdentifier :application="item" :lang="lang" /></td><td :data-label="text('Deadline', 'Frist')"><span :class="{ 'jobs-expired': isOpportunityDeadlinePassed(item.context_json, now) }">{{ formatOpportunityDeadline(item.context_json, lang) }}</span></td>
            <td class="jobs-cell-wide jobs-cell-contacts" :data-label="text('Contact person', 'Kontaktperson')"><template v-for="(person, index) in contacts(item)" :key="index"><span class="jobs-subline">{{ person.name }}</span><a v-if="safeEmailUrl(person.email)" :href="safeEmailUrl(person.email)!" @click.stop>{{ person.email }}</a><span v-else>{{ person.email }}</span></template><span v-if="!contacts(item).length">{{ text('Not recorded', 'Nicht erfasst') }}</span></td>
            <td class="jobs-cell-state" :data-label="text('Status', 'Status')" @click.stop><span class="jobs-badge">{{ statusLabel(item.status) }}</span></td>
          </tr>

        </template><tr v-if="!filteredApplications.length"><td colspan="4" class="jobs-empty"><p :class="{ 'app-hint': !loading }">{{ loading ? text('Loading applications…', 'Bewerbungen werden geladen…') : text('No matching applications. Create one from an opportunity.', 'Keine passenden Bewerbungen. Lege eine aus einem Stellenangebot an.') }}</p><button class="btn" type="button" @click="emit('navigate', 'opportunities')">{{ text('Browse opportunities', 'Stellenangebote ansehen') }}</button></td></tr></tbody>
      </table>
    </div>
    <section v-if="selectedOpportunity" v-show="tab === 'opportunities'" ref="opportunityDetail" class="opportunity-detail" :class="{ 'opportunity-detail--sidebar': sidebarActive }" :aria-label="selectedOpportunity.title" tabindex="-1">
      <WorkspaceDetailHeader class="opportunity-detail__header" :class="{ 'opportunity-detail__header--sidebar': sidebarActive }" :sidebar-active="props.active !== false && tab === 'opportunities'" :title="selectedOpportunity.title" :subtitle="selectedOpportunity.university || undefined" :back-label="text('All opportunities', 'Alle Stellenangebote')" @back="closeOpportunity">
        <template #metadata>
          <span v-if="selectedOpportunity.country" class="opportunity-detail__country" :title="selectedOpportunity.country">{{ selectedOpportunity.country }}</span>
          <span class="opportunity-detail__deadline" :class="{ 'jobs-expired': isOpportunityDeadlinePassed(selectedOpportunity.details, now) }" :title="`${text('Deadline', 'Frist')}: ${formatOpportunityDeadline(selectedOpportunity.details, lang)}`" :aria-label="`${text('Deadline', 'Frist')}: ${formatOpportunityDeadline(selectedOpportunity.details, lang)}`"><span class="opportunity-detail__deadline-label">{{ text('Deadline', 'Frist') }}: </span>{{ formatOpportunityDeadline(selectedOpportunity.details, lang) }}</span>
          <span v-if="selectedOpportunity.particularly_suitable && fitScoreById.get(selectedOpportunity.id) !== undefined" class="jobs-badge jobs-fit-score opportunity-detail__fit" :class="fitTone(fitScoreById.get(selectedOpportunity.id)) && `jobs-fit-score--${fitTone(fitScoreById.get(selectedOpportunity.id))}`" :aria-label="`${text('Personal fit', 'Persönliche Passung')}: ${fitLabel(fitScoreById.get(selectedOpportunity.id))}`" :title="text('Personal fit score', 'Bewertung der persönlichen Passung')">{{ fitLabel(fitScoreById.get(selectedOpportunity.id)) }}</span>
        </template>
        <template v-if="applicationByOpportunity.has(selectedOpportunity.id)" #secondary-actions>
          <ApplicationIdentifier :application="applicationByOpportunity.get(selectedOpportunity.id)!" :lang="lang" />
        </template>
        <template #actions>
          <label class="jobs-detail-state jobs-sidebar-controls"><span class="jobs-action-label">{{ text('Your review', 'Deine Bewertung') }}</span><select :aria-label="text('Your review', 'Deine Bewertung')" :value="reviewState(selectedOpportunity.id)" :disabled="saving" @change="changeReview(selectedOpportunity, $event)"><option v-for="state in OPPORTUNITY_REVIEW_STATES" :key="state" :value="state">{{ statusLabel(state) }}</option></select></label>
          <button class="btn btn--success jobs-detail-action" type="button" :disabled="saving" @click="startApplication(selectedOpportunity)"><span class="jobs-action-desktop">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Open application', 'Bewerbung öffnen') : text('Create application', 'Bewerbung anlegen') }}</span><span class="jobs-action-mobile">{{ applicationByOpportunity.has(selectedOpportunity.id) ? text('Open', 'Öffnen') : text('Apply', 'Bewerben') }}</span></button>
        </template>
      </WorkspaceDetailHeader>
      <div class="opportunity-detail__body"><OpportunityContext :key="selectedOpportunity.id" :context="selectedOpportunity.details" :lang="lang" /></div>
    </section>
    <ApplicationWorkspace v-if="editingApplication" v-show="tab === 'applications'" :active="props.active !== false && tab === 'applications'" :checklist-saving="saving" @toggle-checklist="(key, completed) => changeChecklist(editingApplication!, key, completed)" :key="userId + ':' + editingApplication.id" :application="editingApplication" :client="client" :user-id="userId" :lang="lang" :project-id="projectId" :configurations="configurations" :read-version="readVersion" :create-subvariant="createSubvariant" :publish-cv="(state) => updateApplication(editingApplication!.id, { cvState: state })" @close="closeApplication" @edit-variant="id => emit('edit-variant', id)">
      <template #preparation-actions>
        <button class="btn btn--danger jobs-remove-application" type="button" :disabled="saving" :aria-label="`${text('Remove application for', 'Bewerbung entfernen für')} ${contextTitle(editingApplication)}`" @click="requestDetailRemoval(editingApplication)">{{ text('Remove application', 'Bewerbung entfernen') }}</button>
      </template>
      <template #preparation>
            <div class="jobs-review-toolbar"><h2>{{ text('Application workspace', 'Bewerbung bearbeiten') }}</h2><span>{{ text('Context saved', 'Kontext gespeichert') }}: {{ dateLabel(editingApplication.context_captured_at) }}</span><button class="btn" type="button" :disabled="saving || hasUnsavedChanges" @click="refreshResearch">{{ text('Refresh research', 'Forschung aktualisieren') }}</button></div>
            <OpportunityContext :context="editingApplication.context_json" :lang="lang" :default-open-groups="['requirements', 'documents']" checklist :completed-keys="editingApplication.completed_checklist_keys || []" :saving="saving" @toggle-checklist="(key, completed) => changeChecklist(editingApplication!, key, completed)" />
      </template>
      <template #tracking>
        <label class="jobs-detail-state"><span class="jobs-action-label">{{ text('Status', 'Status') }}</span><select :aria-label="`${text('Status for', 'Status für')} ${contextTitle(editingApplication)}`" :value="editingApplication.status" :disabled="saving || hasUnsavedChanges" @change="changeApplicationStatus(editingApplication, $event)"><option v-for="status in APPLICATION_STATUSES" :key="status" :value="status">{{ statusLabel(status) }}</option></select></label>
        <section class="application-status-history" :aria-label="text('Status history', 'Statusverlauf')">
          <h3>{{ text('Status history', 'Statusverlauf') }}</h3>
          <p v-if="statusHistory.some(entry => !entry.changedAt)" class="app-hint jobs-subline">{{ text('Earlier status changes and their times were not recorded.', 'Frühere Statusänderungen und ihre Zeitpunkte wurden nicht erfasst.') }}</p>
          <ol><li v-for="(entry, index) in statusHistory" :key="index" :aria-current="index === statusHistory.length - 1 ? 'step' : undefined">
            <strong>{{ statusLabel(entry.status) }}</strong><span v-if="index === statusHistory.length - 1" class="jobs-badge">{{ text('Current', 'Aktuell') }}</span>
            <time v-if="entry.changedAt" :datetime="entry.changedAt">{{ timestampLabel(entry.changedAt) }}</time><span v-else class="jobs-subline">{{ text('Time not recorded', 'Zeitpunkt nicht erfasst') }}</span>
          </li></ol>
        </section>
            <form class="application-inline-form" @submit.prevent="saveApplication">
              <div class="application-fields">
                <label class="application-notes">{{ text('Notes', 'Notizen') }}<textarea v-model="form.notes" rows="3" maxlength="20000" :disabled="saving" /></label>
              </div>
              <div class="jobs-form-footer"><button class="btn btn--success" type="submit" :disabled="saving || !hasUnsavedChanges">{{ saving ? text('Saving…', 'Speichert…') : text('Save changes', 'Änderungen speichern') }}</button></div>
            </form>

      </template>
    </ApplicationWorkspace>
    <dialog ref="removalDialog" class="jobs-removal-dialog" :aria-label="text('Remove application', 'Bewerbung entfernen')" @cancel="removingId = null">
      <div v-if="editingApplication && removingId === editingApplication.id" class="jobs-removal-confirm">
        <p class="app-hint">{{ text('Remove this application? Its notes, checklist progress and saved drafts will be deleted. Your CV versions remain available.', 'Bewerbung entfernen? Notizen, Checklistenfortschritt und gespeicherte Entwürfe werden gelöscht. Deine CV-Versionen bleiben erhalten.') }}</p>
        <div class="jobs-row-actions"><button class="btn" type="button" autofocus :disabled="saving" @click="cancelRemoval">{{ text('Cancel', 'Abbrechen') }}</button><button class="btn btn--danger" type="button" :disabled="saving" @click="confirmRemoval(editingApplication)">{{ text('Remove application', 'Bewerbung entfernen') }}</button></div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.jobs-workspace { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; color: #d1fae5; scrollbar-width: thin; }

.jobs-workspace > :not(.jobs-table-scroll) { flex-shrink: 0; }
.jobs-workspace > .application-workspace, .jobs-workspace > .opportunity-detail { flex: 1 1 auto; min-height: 0; }
.opportunity-detail { display: flex; flex-direction: column; min-width: 0; padding: 32px; overflow: hidden;}
.opportunity-detail__body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-gutter: stable; }
.application-status-history h3 { color: #9be8c7; margin: 0 0 12px; }
.application-status-history ol { list-style: none; margin: 12px 0 0 5px; padding: 0 0 0 18px; border-left: 2px solid #356454; }
.application-status-history li { position: relative; padding: 0 0 18px; font-size: 13px; }
.application-status-history li::before { content: ''; position: absolute; left: -24px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: #356454; }
.application-status-history li[aria-current=step]::before { background: #9be8c7; }
.application-status-history time { display: block; margin-top: 5px; color: #a6c1b9; }
.application-status-history .jobs-badge { margin-left: 9px; }
.jobs-workspace .jobs-detail-state { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.jobs-workspace .jobs-detail-state select { width: auto; min-width: 0; max-width: 100%; padding: 6px 9px; }
.jobs-action-mobile { display: none; }
.jobs-remove-application { min-height: 44px; padding: 10px 16px; border-color: #ef4444; background: #b91c1c; color: #fff; font-weight: 600; }
.jobs-remove-application:hover:not(:disabled) { border-color: #f87171; background: #991b1b; }
.jobs-workspace > .jobs-table-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; }
.jobs-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.jobs-heading h1 { margin: 4px 0 8px; font-size: 27px; letter-spacing: -.6px; }
.jobs-heading p { margin: 0 0 12px; color: #9bb3ad; line-height: 1.55; }
.jobs-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin: 14px 0 18px; }
.jobs-workspace label, .jobs-sidebar-controls label, label.jobs-sidebar-controls { display: grid; gap: 8px; font-size: 12px; }
.jobs-search { flex: 1; min-width: 200px; max-width: 450px; }
.jobs-toolbar .jobs-check, .jobs-filter-checks .jobs-check { display: flex; align-items: center; }
.jobs-filter-checks { display: grid; gap: 2px; }
.jobs-opportunity-filters { display: contents; }
.jobs-filter-toggle { display: none; }
.jobs-count { margin-left: auto; color: #9bb3ad; font-size: 12px; padding-bottom: 10px; }
.jobs-workspace input, .jobs-workspace select, .jobs-workspace textarea, .jobs-sidebar-controls :is(input, select, textarea) { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid #29524e; border-radius: 7px; background: #0b1b25; color: #e3f7ef; font: inherit; color-scheme: dark; }
.jobs-workspace input[type=checkbox], .jobs-sidebar-controls input[type=checkbox] { flex-shrink: 0; width: auto; }
.jobs-workspace :is(button, input, select, textarea, summary, a):focus-visible, .jobs-sidebar-controls :is(button, input, select, textarea):focus-visible { outline: 2px solid #6ee7b7; outline-offset: 3px; }
.jobs-workspace button:disabled, .jobs-sidebar-controls button:disabled { opacity: .5; cursor: not-allowed; }
.jobs-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
.jobs-opportunities-table, .jobs-applications-table { table-layout: fixed; min-width: 960px; }
.jobs-workspace td { min-width: 0; max-width: none; overflow-wrap: anywhere; }
.jobs-opportunities-table .jobs-row-actions { min-width: 0; }
.jobs-opportunities-table .jobs-row-actions .btn { white-space: normal; }
.jobs-workspace th { position: sticky; top: 0; z-index: 1; }
th { padding: 13px 14px; white-space: nowrap; background: #0d242c; color: #8db7ab; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.jobs-workspace .jobs-group-row th { position: static; padding: 11px 14px; border-top: 1px solid #29504b; color: #b6edda; background: #0a1c25; font-size: 12px; text-transform: none; letter-spacing: 0; }
.jobs-group-row th span { margin-left: 6px; color: #8db7ab; font-weight: normal; }
td { padding: 16px 14px; vertical-align: top; border-top: 1px solid #17383c; line-height: 1.5; }
td:first-child { min-width: 220px; max-width: 340px; }
td a { color: #8be9bf; overflow-wrap: anywhere; }
.jobs-subline { display: block; margin-top: 5px; color: #94afa6; font-size: 11px; }
.jobs-topics { min-width: 130px; max-width: 220px; color: #a7c4b9; }
.jobs-workspace .jobs-review-select, .jobs-workspace .jobs-row-select { width: 100%; min-width: 0; padding: 7px 5px; font-size: 11px; cursor: pointer; }
.jobs-removal-confirm { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: #fecaca; }
.jobs-removal-confirm p { flex: 1; min-width: 240px; margin: 0; }
.jobs-removal-dialog { width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 22px; border: 1px solid #29504b; border-radius: 12px; background: #081b25; color: #e3f7ef; overflow: auto; box-sizing: border-box; }
.jobs-removal-dialog::backdrop { background: rgb(0 0 0 / 65%); }
.jobs-removal-dialog .jobs-row-actions { justify-content: flex-end; width: 100%; }
.jobs-row-actions { display: flex; flex-wrap: wrap; gap: 7px; min-width: 145px; }
.jobs-row-actions .btn { font-size: 11px; white-space: nowrap; }
.jobs-badge { display: inline-block; padding: 3px 7px; margin-top: 4px; border-radius: 5px; background: #123e36; color: #9be8c7; font-size: 10px; white-space: nowrap; }
.jobs-expired { color: #dfbc8a; }
.jobs-empty { padding: 45px 20px; text-align: center; color: #94afa6; }
.jobs-empty .btn { display: block; margin: 16px auto 0; }
.jobs-opportunity-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.jobs-badge--new { background: #153e57; color: #b9e5ff; }
.jobs-badge--updated { background: #49351c; color: #ffe0a0; }
.jobs-fit-score--red { background: #591f2b; color: #ffadb7; }
.jobs-fit-score--yellow { background: #4a3c10; color: #ffe278; }
tr.jobs-opportunity--new { background: #0b202e; }
tr.jobs-opportunity--updated { background: #24241e; }
.jobs-opportunity--unseen-new > td:first-child { box-shadow: inset 3px 0 #77caff; }
.jobs-opportunity--unseen-updated > td:first-child { box-shadow: inset 3px 0 #efbf69; }
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
.jobs-form-footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.jobs-upload-preview summary { color: #a0e7ca; cursor: pointer; }
.jobs-upload-preview pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #041016; font: 11px/1.5 monospace; }
@media (max-width: 1000px) {
  .jobs-opportunities-table, .jobs-applications-table { display: block; table-layout: auto; min-width: 0; }
  table colgroup { display: none; }
  table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  table tbody { display: grid; gap: 12px; }
  table tbody + tbody { margin-top: 12px; }
  table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; min-width: 0; overflow: hidden; border: 1px solid #29504b; border-radius: 10px; background: #081b25; }
  .jobs-workspace td { display: block; min-width: 0; max-width: none; padding: 11px 12px; border: 0; }
  td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 5px; color: #8db7ab; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; }
  .jobs-cell-heading, .jobs-cell-wide, .jobs-empty { grid-column: 1 / -1; }
  .jobs-group-row { display: block; border: 0; border-radius: 0; }
  .jobs-group-row th { display: block; }
  .jobs-cell-heading { background: #102730; border-bottom: 1px solid #29504b; }
  .jobs-row-toggle { font-size: 14px; }
  .jobs-cell-actions { display: flex; align-self: end; }
  .jobs-cell-actions .btn { width: 100%; white-space: normal; }
  .jobs-cell-actions .jobs-row-actions { width: 100%; min-width: 0; }
  .jobs-workspace .jobs-row-select, .jobs-workspace .jobs-review-select { min-height: 40px; font-size: 12px; }
  .jobs-result-row .btn { min-height: 40px; }
  .jobs-removal-confirm p { min-width: 0; flex-basis: 100%; }
}
@media (min-width: 761px) {
  .opportunity-detail:not(.opportunity-detail--sidebar) { margin-bottom: 40px; }
  .opportunity-detail__header:not(.opportunity-detail__header--sidebar) :deep(.workspace-detail-header__controls) { position: fixed; inset-inline: 0; bottom: 0; z-index: 30; display: flex; align-items: center; gap: 20px; min-height: 66px; padding: 12px max(20px, calc((100vw - 1484px) / 2)); box-sizing: border-box; border-top: 1px solid #24504e; background: #06141f; box-shadow: 0 -6px 20px #0003; }
  .opportunity-detail__header :deep(.workspace-detail-header__back) { gap: 8px; font-size: 13px; }
  .opportunity-detail__header :deep(.workspace-detail-header__actions) { flex: 1; justify-content: flex-end; gap: 20px; }
  .opportunity-detail__header .jobs-detail-action { font-size: 13px; }
  .jobs-toolbar--sidebar { display: grid; align-items: stretch; gap: 16px; margin: 0; }
  .jobs-toolbar--sidebar .jobs-search { min-width: 0; max-width: none; }
  .jobs-toolbar--sidebar .jobs-count { margin-left: 0; padding: 0; }
  .jobs-filter-checks { gap: 12px; }
}
@media (min-width: 761px) and (max-height: 600px) {
  .jobs-workspace { padding: 0; }
  .opportunity-detail { padding: 32px; }
}
@media (max-width: 760px) {
  .jobs-workspace { padding: 0; font-size: 16px; }
  .jobs-heading h1 { font-size: 23px; }
  .jobs-heading p { font-size: 12px; }
  .jobs-toolbar { position: fixed; left: 0; right: 0; bottom: var(--mobile-tabs-height, 76px); z-index: 35; height: var(--mobile-context-row-height, 52px); box-sizing: border-box; align-items: center; margin: 0; padding: 5px 8px; border-top: 1px solid #21423e; background: #071820; }
  .jobs-toolbar > :not(.jobs-search) { display: none; }
  .jobs-toolbar > .jobs-filter-toggle { display: block; flex-shrink: 0; min-height: 40px; }
  .jobs-toolbar:has(.jobs-filter-toggle) .jobs-search { flex-basis: 0; }
  .jobs-toolbar > .jobs-opportunity-filters.is-open { display: grid; position: absolute; bottom: 100%; left: 0; right: 0; max-height: calc(100dvh - var(--mobile-tabs-height, 76px) - 64px); overflow: auto; gap: 14px; padding: 16px; border-top: 1px solid #29524e; background: #071820; box-shadow: 0 -8px 24px rgb(0 0 0 / 25%); }
  .jobs-search { flex-basis: 100%; max-width: none; min-width: 0; }
  .jobs-workspace .jobs-search input { height: 40px; padding: 8px 12px; }
  .jobs-search > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .jobs-workspace :is(input, select, textarea) { font-size: 16px; }
  .jobs-workspace label { font-size: 14px; }
  table { font-size: 16px; }
  .jobs-row-toggle { font-size: 18px; }
  .jobs-subline { font-size: 14px; }
  .jobs-badge { font-size: 12px; }
  .jobs-topics { font-size: 15px; }
  td[data-label]::before { font-size: 12px; }
  .jobs-workspace .jobs-group-row th { font-size: 15px; padding: 11px 0; }
  table tbody { gap: 8px; }
  table tr { column-gap: 12px; border: 0; border-bottom: 1px solid #21423e; border-radius: 0; background: transparent; }
  .jobs-workspace td { padding: 8px 0; }
  .jobs-workspace :is(.jobs-cell-state, .jobs-cell-actions) { display: none; }
  .jobs-cell-heading { background: transparent; }
  .jobs-opportunity--unseen-new > td:first-child, .jobs-opportunity--unseen-updated > td:first-child { padding-left: 10px; }
  .opportunity-detail { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .opportunity-detail__header :deep(.workspace-detail-header__metadata) { flex-wrap: nowrap; gap: 8px; }
  .opportunity-detail__country { flex: 0 1 auto; max-width: 28%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opportunity-detail__deadline { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opportunity-detail__deadline-label { display: none; }
  .opportunity-detail__fit { flex-shrink: 0; margin: 0; padding: 0; border-radius: 0; background: transparent; font-size: 12px; }
  .opportunity-detail__body { padding: 12px 8px 0; scrollbar-gutter: auto; }
  .jobs-workspace .jobs-detail-state { flex: 1; }
  .jobs-workspace .jobs-detail-state select { width: 100%; height: 40px; padding: 6px; }
  .jobs-detail-action { flex-shrink: 0; min-height: 40px; padding: 7px 10px; }
  .jobs-action-label, .jobs-action-desktop { display: none; }
  .jobs-action-mobile { display: inline; }
  .jobs-removal-dialog { padding: 18px; }
  .jobs-removal-dialog .jobs-row-actions .btn { font-size: 16px; }
  .jobs-form-footer { flex-wrap: wrap; }
  .application-fields { grid-template-columns: 1fr; }
  .application-inline-form { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .jobs-review-toolbar { align-items: stretch; gap: 10px; margin-bottom: 16px; }
  .jobs-review-toolbar h2 { display: none; }
  .jobs-workspace :deep(.opportunity-context__group dl) { gap: 14px; }
  .jobs-workspace :deep(.opportunity-context__field--fit) { padding: 0; border: 0; border-radius: 0; background: transparent; }
}
</style>
