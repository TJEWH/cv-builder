import type { SupabaseClient } from '@supabase/supabase-js';
import type { Application } from '../cloudTypes';
import type { DraftingContext, DraftingContextBundle, MotivationLetterDraft, PublishDraftingInput } from '../draftingTypes';
import { SAMPLE_CONTACT } from '../defaults';
import type { CvState } from '../types';
import { createCloudCvSnapshot } from './cloudCvPrivacy';
import { IDENTITY_PLACEHOLDERS, redactKnownIdentityText } from './identityRedaction';

export const DRAFTING_IDENTITY_PLACEHOLDERS = IDENTITY_PLACEHOLDERS;

function privateText(text: string, state?: CvState): string {
  const result = text.replace(/\[([^\]]*)\]\(([^\s)]+)\)/g, (link, label: string, href: string) => (
    /!![\s\S]*?!!/.test(label + href) ? '{{CONFIDENTIAL}}' : link
  )).replace(/!![\s\S]*?!!/g, '{{CONFIDENTIAL}}');
  return redactKnownIdentityText(result, [SAMPLE_CONTACT, ...(state ? [state.contact] : [])]);
}

function mapText<T>(value: T, state?: CvState): T {
  if (typeof value === 'string') return privateText(value, state) as T;
  if (Array.isArray(value)) return value.map((entry) => mapText(entry, state)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, mapText(entry, state)])) as T;
  return value;
}

function bounded(value: string, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`${label} must contain ${min}–${max} characters.`);
  return value.trim();
}

/** Explicitly select fields: editor metadata, CVs, local paths and extra properties cannot enter this payload. */
export function sanitizeDraftingInput(input: PublishDraftingInput, cvState?: CvState): PublishDraftingInput {
  if (!input.template || !Number.isInteger(input.template.revision) || input.template.revision < 1) throw new Error('Select a saved letter template.');
  if (!Number.isInteger(input.maxWords) || input.maxWords < 50 || input.maxWords > 5000) throw new Error('Word limit must be between 50 and 5000.');
  const clean = (value: string, label: string, min: number, max: number) => bounded(privateText(value, cvState), label, min, max);
  // Keep the existing server contract: template-specific instructions are named
  // sections of structure and pass through the same identity/privacy boundary.
  const structure = [clean(input.template.structure, 'Template structure', 1, 20000)];
  for (const [key, label] of [
    ['subjectInstructions', 'Subject instructions'],
    ['salutationInstructions', 'Salutation instructions'],
    ['closingInstructions', 'Closing instructions'],
  ] as const) {
    const value = input.template[key];
    if (value !== undefined && value !== '') structure.push(`${label}:\n${clean(value, label, 1, 1000)}`);
  }
  return {
    template: {
      id: clean(input.template.id, 'Template ID', 1, 200),
      name: clean(input.template.name, 'Template name', 1, 200),
      revision: input.template.revision,
      structure: bounded(structure.join('\n\n'), 'Template structure', 1, 20000),
      tone: clean(input.template.tone, 'Template tone', 1, 1000),
    },
    language: bounded(input.language, 'Language', 2, 20),
    instructions: clean(input.instructions, 'Instructions', 0, 20000),
    maxWords: input.maxWords,
  };
}

/** Offline counterpart of the server projection. It never includes application notes or contact email. */
export function prepareDraftingContext(input: PublishDraftingInput & { application: Application; cvState: CvState }): DraftingContextBundle {
  const snapshot = createCloudCvSnapshot(input.cvState);
  const content = mapText(snapshot.content_json, input.cvState);
  content.contact = { ...DRAFTING_IDENTITY_PLACEHOLDERS };
  return {
    schemaVersion: 1,
    opportunity: JSON.parse(JSON.stringify(input.application.context_json)) as Record<string, unknown>,
    opportunityCapturedAt: input.application.context_captured_at,
    cv: { snapshotId: input.application.cv_variant_id, revision: snapshot.revision, content, theme: snapshot.config_json.design },
    ...sanitizeDraftingInput(input, input.cvState),
    identityPlaceholders: { ...DRAFTING_IDENTITY_PLACEHOLDERS },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function checkedContext(data: unknown, account: string, applicationId: string): DraftingContext {
  if (!record(data) || data.user_id !== account || data.application_id !== applicationId || typeof data.id !== 'string'
    || typeof data.cv_variant_id !== 'string' || typeof data.created_at !== 'string' || !record(data.context_json)
    || data.context_json.schemaVersion !== 1 || !record(data.context_json.cv) || !record(data.context_json.template)) {
    throw new Error('The drafting context could not be verified. Refresh and retry.');
  }
  return data as unknown as DraftingContext;
}

function checkedDraft(data: unknown, account: string, applicationId: string): MotivationLetterDraft {
  if (!record(data) || data.user_id !== account || data.application_id !== applicationId || typeof data.id !== 'string'
    || typeof data.context_id !== 'string' || typeof data.body !== 'string' || typeof data.created_at !== 'string') {
    throw new Error('The returned letter draft could not be verified. Refresh and retry.');
  }
  return data as unknown as MotivationLetterDraft;
}

/** Stateless account-scoped adapter. Callers retain their own loading state and local finalized text. */
export function createDraftingRepository(client: SupabaseClient | null, getUserId: () => string | null | undefined) {
  // Reuse IDs after uncertain network failures. Distinct context/body creates a new append-only record.
  const pendingContexts = new Map<string, string>();
  const pendingDrafts = new Map<string, string>();
  function account(): string {
    const id = getUserId();
    if (!client || !id) throw new Error('Sign in to publish drafting context or retrieve drafts.');
    return id;
  }
  function current(id: string) {
    if (getUserId() !== id) throw new Error('Session changed. Reload this application.');
  }
  function throwError(error: unknown) {
    if (record(error) && ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(String(error.code))) {
      throw new Error('The connected workspace needs the motivation letter drafting database update. Local preparation and editing remain available.');
    }
    if (error) throw error;
  }
  async function listContexts(applicationId: string): Promise<DraftingContext[]> {
    const owner = account();
    const { data, error } = await client!.from('drafting_contexts').select('*').eq('user_id', owner)
      .eq('application_id', applicationId).order('created_at', { ascending: false });
    current(owner); throwError(error);
    if (!Array.isArray(data)) throw new Error('Drafting context history could not be loaded.');
    return data.map((row) => checkedContext(row, owner, applicationId));
  }
  async function listDrafts(applicationId: string): Promise<MotivationLetterDraft[]> {
    const owner = account();
    const { data, error } = await client!.from('motivation_letter_drafts').select('*').eq('user_id', owner)
      .eq('application_id', applicationId).order('created_at', { ascending: false });
    current(owner); throwError(error);
    if (!Array.isArray(data)) throw new Error('Letter drafts could not be loaded.');
    return data.map((row) => checkedDraft(row, owner, applicationId));
  }
  async function publishContext(applicationId: string, input: PublishDraftingInput): Promise<DraftingContext> {
    const owner = account();
    const safe = sanitizeDraftingInput(input);
    const fingerprint = JSON.stringify([owner, applicationId, safe]);
    const id = pendingContexts.get(fingerprint) ?? crypto.randomUUID();
    pendingContexts.set(fingerprint, id);
    const { data, error } = await client!.rpc('publish_application_drafting_context', {
      p_context_id: id, p_application_id: applicationId, p_template: safe.template,
      p_language: safe.language, p_instructions: safe.instructions, p_max_words: safe.maxWords,
    });
    current(owner); throwError(error);
    const result = checkedContext(data, owner, applicationId);
    if (result.id !== id) throw new Error('The published context could not be confirmed.');
    pendingContexts.delete(fingerprint);
    return result;
  }
  async function saveDraft(applicationId: string, contextId: string, body: string): Promise<MotivationLetterDraft> {
    const owner = account();
    const text = bounded(privateText(body), 'Draft', 1, 100000);
    const fingerprint = JSON.stringify([owner, applicationId, contextId, text]);
    const id = pendingDrafts.get(fingerprint) ?? crypto.randomUUID();
    pendingDrafts.set(fingerprint, id);
    const { data, error } = await client!.rpc('save_application_letter_draft', {
      p_draft_id: id, p_application_id: applicationId, p_context_id: contextId, p_body: text,
    });
    current(owner); throwError(error);
    const result = checkedDraft(data, owner, applicationId);
    if (result.id !== id || result.context_id !== contextId) throw new Error('The new draft could not be confirmed.');
    pendingDrafts.delete(fingerprint);
    return result;
  }
  return { listContexts, listDrafts, publishContext, saveDraft };
}
