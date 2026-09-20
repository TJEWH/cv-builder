import { onScopeDispose, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application, ApplicationContext, CloudCvSnapshot, CloudCvVariant, CreateApplicationInput, Opportunity, OpportunityReview, OpportunityReviewState, UpdateApplicationInput } from '../cloudTypes';
import { APPLICATION_STATUSES, OPPORTUNITY_REVIEW_STATES } from '../cloudTypes';
import { SAMPLE_CONTACT } from '../defaults';
import { CV_STATE_VERSION } from '../types';
import { createCloudCvSnapshot } from './cloudCvPrivacy';
import { isRecord, readCvConfig, readCvContent } from './cvStateValidation';
import { hasReviewedOpportunity } from './opportunityRecency';

const PAGE_SIZE = 500;
const CV_SUMMARY_FIELDS = 'id,user_id,name,cv_version,revision,created_at';

function displayText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join('; ') || null;
  if (isRecord(value)) return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${displayText(item) ?? ''}`).join('; ') || null;
  return null;
}

/** Imported research datasets use richer JSON values and slightly different column names. */
export function normalizeOpportunity(value: unknown): Opportunity {
  if (!isRecord(value) || typeof value.id !== 'string') throw new Error('The opportunities table returned an invalid record.');
  return {
    id: value.id, opportunity_key: displayText(value.opportunity_key) ?? value.id,
    vacancy_id: displayText(value.vacancy_id), title: displayText(value.title) ?? 'Untitled opportunity',
    university: displayText(value.university ?? value.institution), country: displayText(value.country),
    deadline: displayText(value.deadline), supervisor: displayText(value.supervisor ?? value.supervisors),
    supervisor_reputation: displayText(value.supervisor_reputation),
    supervisor_research_focus: isRecord(value.supervisor_research_focus) ? value.supervisor_research_focus : {},
    supervisor_top_papers: Array.isArray(value.supervisor_top_papers) ? value.supervisor_top_papers : [],
    contact: value.contact ?? value.contacts ?? [],
    topics: Array.isArray(value.topics) ? value.topics.map(displayText).filter((topic): topic is string => topic !== null) : [],
    duration_months: typeof value.duration_months === 'number' ? value.duration_months : null,
    salary_text: displayText(value.salary_text ?? value.salary),
    research_career_potential: displayText(value.research_career_potential), rd_career_potential: displayText(value.rd_career_potential),
    hardware_software_profile: displayText(value.hardware_software_profile), personal_fit: displayText(value.personal_fit),
    particularly_suitable: typeof value.particularly_suitable === 'boolean' ? value.particularly_suitable : null,
    special_features: displayText(value.special_features), requirements: value.requirements ?? [], required_documents: value.required_documents ?? [],
    official_url: displayText(value.official_url), availability: displayText(value.availability), verification_level: displayText(value.verification_level),
    data: isRecord(value.data) ? value.data : {}, details: value,
    created_at: displayText(value.created_at), updated_at: displayText(value.updated_at),
  };
}

function errorMessage(reason: unknown, fallback: string): string {
  if (isRecord(reason) && reason.code === '23505') return 'An application already exists for this opportunity. Refresh to view it.';
  if (isRecord(reason) && (reason.code === 'PGRST202' || reason.code === '42P01')) return 'The job workspace database setup is incomplete. Apply the Supabase migration and try again.';
  if (isRecord(reason) && (reason.code === '42501' || reason.code === 'PGRST301')) return 'Your session cannot access this workspace. Sign in again and retry.';
  return reason instanceof Error ? reason.message : fallback;
}

function contactEmail(value: string | null): string | null {
  const email = value?.trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Enter the employer’s valid contact email.');
  return email;
}

function dateValue(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (!Number.isFinite(Date.parse(value))) throw new Error('Enter a valid application date.');
  return new Date(value).toISOString();
}

interface PendingSnapshot { fingerprint: string; applicationId: string; snapshot: CloudCvSnapshot }
interface PendingApplication { opportunityId: string; applicationId: string }

function cloudSnapshot(value: unknown, account: string): CloudCvSnapshot {
  if (!isRecord(value) || value.user_id !== account || typeof value.id !== 'string' || typeof value.name !== 'string'
    || value.cv_version !== CV_STATE_VERSION || typeof value.revision !== 'number' || typeof value.is_base_variant !== 'boolean') {
    throw new Error('The assigned CV snapshot is invalid or unavailable.');
  }
  const content = readCvContent(value.content_json);
  for (const key of Object.keys(SAMPLE_CONTACT) as (keyof typeof SAMPLE_CONTACT)[]) {
    if (content.contact[key] !== '' && content.contact[key] !== SAMPLE_CONTACT[key]) {
      throw new Error('The assigned CV is not a privacy snapshot. Assign a new privacy CV before exporting.');
    }
  }
  return { id: value.id, name: value.name, content_json: content, config_json: readCvConfig(value.config_json),
    cv_version: value.cv_version, revision: value.revision, is_base_variant: value.is_base_variant };
}

/** Cloud state is ephemeral and account-scoped; this never changes the local CV store. */
export function useJobWorkspace(client: SupabaseClient | null, userId: MaybeRefOrGetter<string | null | undefined>) {
  const opportunities = ref<Opportunity[]>([]);
  const applications = ref<Application[]>([]);
  const cvVariants = ref<CloudCvVariant[]>([]);
  const reviews = ref<OpportunityReview[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  let epoch = 0;
  let loadSequence = 0;
  let loadController: AbortController | null = null;
  const controllers = new Set<AbortController>();
  const pendingReviews = new Set<string>();
  let pendingCreate: PendingApplication | null = null;
  let pendingAssignment: PendingSnapshot | null = null;

  const current = (account: string, generation: number) => epoch === generation && toValue(userId) === account;
  function reset() {
    epoch++;
    loadSequence++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    pendingReviews.clear();
    loadController = null;
    opportunities.value = []; applications.value = []; cvVariants.value = []; reviews.value = [];
    loading.value = false; saving.value = false; error.value = '';
    pendingCreate = null; pendingAssignment = null;
  }

  async function rows(table: string, fields: string, account: string, signal: AbortSignal) {
    const result: Record<string, unknown>[] = [];
    for (let offset = 0; ;) {
      if (signal.aborted) throw new Error('Request cancelled.');
      const orderColumn = table === 'opportunity_reviews' ? 'opportunity_id' : 'id';
      let query = client!.from(table).select(fields, { count: 'exact' }).order(orderColumn, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      // Opportunities are a shared, authenticated-read-only catalogue. RLS enforces access.
      if (table !== 'opportunities') query = query.eq('user_id', account);
      const { data, count, error: queryError } = await query.abortSignal(signal);
      if (queryError) throw queryError;
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      result.push(...page);
      // Respect projects configured with a lower API row cap than our requested page size.
      offset += page.length;
      if (!page.length || (count !== null && count !== undefined ? offset >= count : page.length < PAGE_SIZE)) return result;
    }
  }

  async function refresh(): Promise<boolean> {
    const account = toValue(userId);
    if (!client || !account || saving.value) return false;
    const generation = epoch;
    const sequence = ++loadSequence;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    controllers.add(controller);
    loading.value = true; error.value = '';
    try {
      const [opportunityRows, applicationRows, cvRows, reviewRows] = await Promise.all([
        rows('opportunities', '*', account, controller.signal), rows('applications', '*', account, controller.signal),
        rows('cv_variants', CV_SUMMARY_FIELDS, account, controller.signal),
        rows('opportunity_reviews', '*', account, controller.signal),
      ]);
      if (!current(account, generation) || sequence !== loadSequence) return false;
      opportunities.value = opportunityRows.map(normalizeOpportunity);
      applications.value = applicationRows as unknown as Application[];
      cvVariants.value = cvRows as unknown as CloudCvVariant[];
      reviews.value = reviewRows as unknown as OpportunityReview[];
      return true;
    } catch (reason) {
      if (current(account, generation) && sequence === loadSequence) error.value = errorMessage(reason, 'Could not load the job workspace. Check your connection and retry.');
      return false;
    } finally {
      controllers.delete(controller);
      if (current(account, generation) && sequence === loadSequence) { loading.value = false; loadController = null; }
    }
  }

  function snapshotParameters(snapshot: CloudCvSnapshot) {
    return { p_cv_variant_id: snapshot.id, p_cv_name: snapshot.name, p_content_json: snapshot.content_json,
      p_config_json: snapshot.config_json, p_cv_version: snapshot.cv_version };
  }

  async function runMutation<T>(action: (account: string, generation: number, signal: AbortSignal) => Promise<T>, saveResult: (value: T) => void,
    failureMessage = 'Could not save the application. Check your connection and retry.'): Promise<T | null> {
    const account = toValue(userId);
    if (!client || !account || saving.value) return null;
    const generation = epoch;
    const controller = new AbortController();
    controllers.add(controller);
    // An older read must not overwrite the results of a newer write.
    loadSequence++; loadController?.abort(); loading.value = false;
    saving.value = true; error.value = '';
    try {
      const result = await action(account, generation, controller.signal);
      if (!current(account, generation)) return null;
      saveResult(result);
      return result;
    } catch (reason) {
      if (current(account, generation)) error.value = errorMessage(reason, failureMessage);
      return null;
    } finally {
      controllers.delete(controller);
      if (current(account, generation)) saving.value = false;
    }
  }

  async function applicationById(id: string, account: string, signal: AbortSignal): Promise<Application> {
    const { data, error: queryError } = await client!.from('applications').select('*').eq('user_id', account).eq('id', id).abortSignal(signal).single();
    if (queryError) throw queryError;
    if (!data || data.user_id !== account || data.id !== id) throw new Error('The saved application could not be loaded. Refresh the workspace.');
    return data as Application;
  }

  function recordSnapshot(snapshot: CloudCvSnapshot, account: string, generation: number) {
    if (!current(account, generation)) return;
    const summary: CloudCvVariant = { id: snapshot.id, user_id: account, name: snapshot.name,
      cv_version: snapshot.cv_version, revision: snapshot.revision, created_at: new Date().toISOString() };
    cvVariants.value = [summary, ...cvVariants.value.filter(({ id }) => id !== snapshot.id)];
  }

  function rememberApplication(application: Application) {
    applications.value = [application, ...applications.value.filter(({ id }) => id !== application.id)];
  }

  function createApplication(input: CreateApplicationInput): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      if (!input.opportunityId) throw new Error('Select an opportunity to create an application.');
      if (pendingCreate?.opportunityId !== input.opportunityId) pendingCreate = { opportunityId: input.opportunityId, applicationId: crypto.randomUUID() };
      const operation = pendingCreate;
      const { data, error: queryError } = await client!.rpc('create_job_application', {
        p_application_id: operation.applicationId, p_opportunity_id: input.opportunityId,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!current(account, generation)) throw new Error('Session changed.');
      if (typeof data !== 'string' || !data) throw new Error('The application could not be confirmed. Refresh the workspace.');
      // The RPC returns an existing application for repeated clicks on the same opportunity.
      const application = await applicationById(data, account, signal);
      if (current(account, generation)) pendingCreate = null;
      return application;
    }, rememberApplication);
  }

  function updateApplication(id: string, input: UpdateApplicationInput): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      const patch: Record<string, unknown> = {};
      if (input.status !== undefined) {
        if (!APPLICATION_STATUSES.includes(input.status)) throw new Error('Select a valid application status.');
        patch.status = input.status;
      }
      if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
      if (input.contactEmail !== undefined) patch.contact_email = contactEmail(input.contactEmail);
      if (input.contactedAt !== undefined) patch.contacted_at = dateValue(input.contactedAt);
      if (input.submittedAt !== undefined) patch.submitted_at = dateValue(input.submittedAt);
      if (input.cvState) {
        const next = createCloudCvSnapshot(input.cvState);
        const fingerprint = JSON.stringify([account, id, next.content_json, next.config_json]);
        if (pendingAssignment?.fingerprint !== fingerprint) pendingAssignment = { fingerprint, applicationId: id, snapshot: next };
        const operation = pendingAssignment;
        const { error: queryError } = await client!.rpc('assign_job_application_cv', {
          p_application_id: id, p_changes: patch, ...snapshotParameters(operation.snapshot),
        }).abortSignal(signal);
        if (queryError) throw queryError;
        if (!current(account, generation)) throw new Error('Session changed.');
        recordSnapshot(operation.snapshot, account, generation);
      }
      if (!current(account, generation)) throw new Error('Session changed.');
      let application: Application;
      if (!input.cvState && Object.keys(patch).length) {
        const { data, error: queryError } = await client!.from('applications').update(patch).eq('id', id).eq('user_id', account).select('*').abortSignal(signal).single();
        if (queryError) throw queryError;
        if (!data) throw new Error('The application could not be updated. Refresh the workspace.');
        application = data as Application;
      } else application = await applicationById(id, account, signal);
      if (current(account, generation)) pendingAssignment = null;
      return application;
    }, rememberApplication);
  }

  function setApplicationChecklistItem(id: string, key: string, completed: boolean): Promise<Application | null> {
    return runMutation(async (account, _generation, signal) => {
      if (!/^(requirements|documents):/.test(key) || key.length > 16000) throw new Error('Invalid checklist item.');
      const { data, error: queryError } = await client!.rpc('set_job_application_checklist_item', {
        p_application_id: id, p_item_key: key, p_completed: completed,
      }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!data || data.id !== id || data.user_id !== account || !Array.isArray(data.completed_checklist_keys)) {
        throw new Error('The checklist could not be saved. Refresh and retry.');
      }
      return data as Application;
    }, rememberApplication, 'Could not save checklist progress. Check your connection and retry.');
  }

  function removeApplication(id: string): Promise<string | null> {
    const opportunityId = applications.value.find((application) => application.id === id)?.opportunity_id;
    return runMutation(async (_account, _generation, signal) => {
      if (!opportunityId) throw new Error('Refresh to load the application before removing it.');
      const { data, error: queryError } = await client!.rpc('remove_job_application', { p_application_id: id }).abortSignal(signal);
      if (queryError) throw queryError;
      if (data !== id) throw new Error('Removal could not be confirmed. Refresh and retry.');
      return id;
    }, () => {
      applications.value = applications.value.filter((application) => application.id !== id);
      reviews.value = reviews.value.map((review) => review.opportunity_id === opportunityId && review.state === 'not_interested'
        ? { ...review, state: 'unreviewed' } : review);
      if (pendingCreate?.applicationId === id) pendingCreate = null;
      if (pendingAssignment?.applicationId === id) pendingAssignment = null;
    }, 'Could not remove the application. Check your connection and retry.');
  }

  /** Refresh only the trusted catalogue snapshot; the server preserves application edits and CV assignment. */
  function refreshApplicationContext(id: string): Promise<Application | null> {
    return runMutation(async (account, generation, signal) => {
      const { data, error: queryError } = await client!.rpc('refresh_job_application_context', { p_application_id: id }).abortSignal(signal);
      if (queryError) throw queryError;
      if (!current(account, generation)) throw new Error('Session changed.');
      if (data !== id) throw new Error('The research refresh could not be confirmed. Refresh the workspace.');
      return applicationById(id, account, signal);
    }, rememberApplication, 'Could not refresh the application research. Check your connection and retry.');
  }

  async function saveOpportunityReview(account: string, opportunityId: string, observedVersion: string | null, state: OpportunityReviewState | null, signal: AbortSignal): Promise<OpportunityReview> {
    const { data, error: queryError } = await client!.rpc('review_job_opportunity', {
      p_opportunity_id: opportunityId, p_observed_updated_at: observedVersion, p_state: state,
    }).abortSignal(signal);
    if (queryError) throw queryError;
    if (!data || data.user_id !== account || data.opportunity_id !== opportunityId
      || !OPPORTUNITY_REVIEW_STATES.includes(data.state)) throw new Error('The review could not be saved. Refresh and retry.');
    return data as OpportunityReview;
  }

  function rememberReview(review: OpportunityReview, receiptOnly = false) {
    const previous = reviews.value.find(({ opportunity_id }) => opportunity_id === review.opportunity_id);
    const saved = receiptOnly && previous ? { ...previous } : { ...review };
    // Opening a row and changing its state may finish in either order. Neither may lose a newer receipt or choice.
    saved.reviewed_updated_at = previous?.reviewed_updated_at
      && (!review.reviewed_updated_at || Date.parse(previous.reviewed_updated_at) > Date.parse(review.reviewed_updated_at))
      ? previous.reviewed_updated_at : review.reviewed_updated_at;
    reviews.value = [saved, ...reviews.value.filter(({ opportunity_id }) => opportunity_id !== review.opportunity_id)];
  }

  function setOpportunityReview(opportunityId: string, state: OpportunityReviewState): Promise<OpportunityReview | null> {
    const opportunity = opportunities.value.find(({ id }) => id === opportunityId);
    const observedVersion = opportunity?.updated_at || opportunity?.created_at || null;
    return runMutation(async (account, _generation, signal) => {
      if (!opportunityId || !OPPORTUNITY_REVIEW_STATES.includes(state)) throw new Error('Select a valid opportunity review state.');
      return saveOpportunityReview(account, opportunityId, observedVersion, state, signal);
    }, (review) => rememberReview(review),
    'Could not save the opportunity review. Check your connection and retry.');
  }

  /** A read receipt never blocks another row, changes interest, or acknowledges an unseen source update. */
  async function markOpportunityReviewed(opportunity: Opportunity): Promise<OpportunityReview | null> {
    const account = toValue(userId);
    const observedVersion = opportunity.updated_at || opportunity.created_at;
    const previous = reviews.value.find(({ opportunity_id }) => opportunity_id === opportunity.id);
    if (!client || !account || !observedVersion || hasReviewedOpportunity(opportunity, previous?.reviewed_updated_at)) return null;
    const generation = epoch;
    const key = `${generation}:${opportunity.id}:${observedVersion}`;
    if (pendingReviews.has(key)) return null;
    pendingReviews.add(key);
    const controller = new AbortController();
    controllers.add(controller);
    error.value = '';
    try {
      const review = await saveOpportunityReview(account, opportunity.id, observedVersion, null, controller.signal);
      if (!current(account, generation)) return null;
      // A refresh started before this write completed may contain the old receipt.
      loadSequence++; loadController?.abort(); loading.value = false;
      rememberReview(review, true);
      return review;
    } catch (reason) {
      if (current(account, generation)) error.value = errorMessage(reason, 'Could not mark the opportunity as reviewed. Reopen it to retry.');
      return null;
    } finally {
      pendingReviews.delete(key);
      controllers.delete(controller);
    }
  }

  /** Fetch only on explicit export/inspection. The context and CV refer to the same stored application. */
  async function getApplicationContext(id: string): Promise<ApplicationContext | null> {
    const account = toValue(userId);
    if (!client || !account) return null;
    const generation = epoch;
    const controller = new AbortController();
    controllers.add(controller);
    error.value = '';
    try {
      const application = await applicationById(id, account, controller.signal);
      if (!current(account, generation)) return null;
      if (!application.cv_variant_id) return { application, cv: null };
      const { data, error: queryError } = await client.from('cv_variants')
        .select('id,user_id,name,content_json,config_json,cv_version,revision,is_base_variant')
        .eq('id', application.cv_variant_id).eq('user_id', account).abortSignal(controller.signal).single();
      if (queryError) throw queryError;
      if (!current(account, generation)) return null;
      const cv = cloudSnapshot(data, account);
      if (cv.id !== application.cv_variant_id) throw new Error('The assigned CV snapshot could not be verified.');
      return { application, cv };
    } catch (reason) {
      if (current(account, generation)) error.value = errorMessage(reason, 'Could not load the application context. Check your connection and retry.');
      return null;
    } finally {
      controllers.delete(controller);
    }
  }

  watch(() => toValue(userId), () => { reset(); void refresh(); }, { immediate: true, flush: 'sync' });
  onScopeDispose(reset);
  return { opportunities, applications, cvVariants, reviews, loading, saving, error, refresh, createApplication, updateApplication, setApplicationChecklistItem, removeApplication, refreshApplicationContext, setOpportunityReview, markOpportunityReviewed, getApplicationContext };
}
