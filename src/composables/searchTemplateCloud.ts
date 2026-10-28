import type { SupabaseClient } from '@supabase/supabase-js';
import { SEARCH_CRITERIA_KEYS } from '../searchTypes';
import type { SearchCloudSchedule, SearchCloudTemplate, SearchCriteria, SearchTemplate, SearchMetaSearchDocument } from '../searchTypes';
import { createSearchProfile, readSearchTemplate, searchTemplateContentKey } from './useSearchTemplates';
import { SEARCH_DEADLINE_RULE, buildSearchSystemPrompt, buildSearchUserPrompt, buildRecurringSearchPrompt } from './searchPrompts';
import type { SearchPromptOptions } from './searchPrompts';
export { isSearchTemplateSaved } from './searchPrompts';
export type { SearchCloudTemplate } from '../searchTypes';

const PAYLOAD_MARKER = 'CV Harness meta-search context v1\n';
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
function matchesPayload(row: SearchCloudTemplate, name: string, criteria: SearchCriteria, schedule: SearchCloudSchedule) {
  return row.name === name && stable(row.criteria) === stable(criteria) && stable(row.schedule) === stable(schedule);
}
function criterion(value: string, label: string) {
  if ([...value].length > 12000) throw new Error(`The saved ${label} exceeds 12,000 characters. Shorten it before saving; your local draft is retained.`);
  return value;
}
export function searchTemplateCloudCriteria(input: SearchTemplate): SearchCriteria {
  const template = readSearchTemplate(input);
  const profiles = template.profiles.filter(profile => profile.enabled);
  return {
    opportunityTypes: profiles.length ? 'Find currently open opportunities matching the shared strategy and at least one enabled professional profile. Apply the explicit opportunity types and hard filters in that strategy.' : 'No professional profiles are enabled. Do not run this search or recommend opportunities.',
    topicsAndMethods: criterion([template.researchInterests, ...profiles.map(profile => `${profile.name}: ${profile.researchInterests}`)].filter(Boolean).join('\n\n'), 'research interests'),
    locationsAndLanguages: criterion(template.locationPreferences, 'location and language preferences'),
    fundingAndConditions: SEARCH_DEADLINE_RULE,
    fitAndExclusions: criterion(PAYLOAD_MARKER + JSON.stringify({ version: 1, professionalContext: template.professionalContext,
      researchInterests: template.researchInterests, profiles }), 'professional profile context'),
    sourcesAndQueries: 'Prefer official vacancy listings, institutions/labs, graduate-school rules and linked application pages. Generate focused queries for each enabled professional profile, preserve explicit manual queries and exclusions, and follow the installed immutable query-revision contract.',
    researchAndReporting: criterion(template.userPrompt, 'user prompt'),
  };
}
export function searchTemplateCloudSchedule(input: SearchTemplate): SearchCloudSchedule {
  const template = readSearchTemplate(input);
  return { frequency: 'daily', intervalHours: 1, weekdays: [], time: template.dailyTime, timezone: template.timezone, runImmediately: true };
}
function asCloudTemplate(value: unknown, userId: string): SearchCloudTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved search response is invalid.');
  const row = value as SearchCloudTemplate;
  if (row.user_id !== userId || typeof row.id !== 'string' || typeof row.name !== 'string' || !Number.isInteger(row.revision) || row.revision < 1
    || !row.criteria || typeof row.criteria !== 'object' || !row.schedule || typeof row.schedule !== 'object'
    || SEARCH_CRITERIA_KEYS.some(key => row.criteria[key] !== undefined && typeof row.criteria[key] !== 'string')) throw new Error('The saved search does not match the signed-in owner.');
  return row;
}
export async function listCloudSearchTemplates(client: SupabaseClient, userId: string): Promise<SearchCloudTemplate[]> {
  const { data, error } = await client.from('opportunity_search_templates').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('The saved search list could not be read.');
  return data.map(item => asCloudTemplate(item, userId));
}
export function importCloudSearchTemplate(row: SearchCloudTemplate): SearchTemplate {
  if (row.meta_search?.version === 1) {
    const template = readSearchTemplate({ ...row.meta_search.editor, name: row.name, dailyTime: row.schedule.time, timezone: row.schedule.timezone, cloud: undefined });
    return { ...template, cloud: { id: row.id, revision: row.revision, contentKey: searchTemplateContentKey(template) } };
  }
  let context: { professionalContext: string; researchInterests: string; profiles: SearchTemplate['profiles'] } | null = null;
  if (row.criteria.fitAndExclusions?.startsWith(PAYLOAD_MARKER)) {
    const parsed = JSON.parse(row.criteria.fitAndExclusions.slice(PAYLOAD_MARKER.length));
    if (parsed.version !== 1) throw new Error('This saved meta-search context version is unsupported.');
    context = parsed;
  }
  const template = readSearchTemplate({ id: row.id, name: row.name, revision: row.revision, updatedAt: row.updated_at,
    professionalContext: context?.professionalContext ?? '', researchInterests: context?.researchInterests ?? '', locationPreferences: row.criteria.locationsAndLanguages || '',
    profiles: context?.profiles ?? [{ ...createSearchProfile('Existing search strategy'), userPrompt: SEARCH_CRITERIA_KEYS.map(key => `${key}:\n${row.criteria[key] || ''}`).join('\n\n') }],
    userPrompt: context ? row.criteria.researchAndReporting || '' : '', dailyTime: row.schedule.time, timezone: row.schedule.timezone });
  // Legacy records need one committed save to attach the complete replacement prompt.
  return { ...template, cloud: { id: row.id, revision: row.revision, contentKey: '' } };
}
async function stableCloudId(userId: string, localId: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cv-search-template-v1:${userId}:${localId}`))).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** One atomic save returns the acknowledged row; no preflight/read-back chain. */
export async function saveSearchTemplate(client: SupabaseClient, userId: string, input: SearchTemplate, options: SearchPromptOptions = {}): Promise<SearchTemplate> {
  const template = readSearchTemplate(input);
  const criteria = searchTemplateCloudCriteria(template); const schedule = searchTemplateCloudSchedule(template);
  const id = template.cloud?.id || await stableCloudId(userId, template.id);
  const expectedRevision = template.cloud?.revision || 0;
  const bound = { ...template, cloud: { id, revision: Math.max(1, expectedRevision), contentKey: searchTemplateContentKey(template) } };
  const { cloud: _cloud, ...editor } = template;
  const metaSearch: SearchMetaSearchDocument = { version: 1, active: template.profiles.some(profile => profile.enabled), editor,
    systemPrompt: buildSearchSystemPrompt(bound, options), userPrompt: buildSearchUserPrompt(bound, options), recurringPrompt: buildRecurringSearchPrompt(bound, options) };
  const { data, error } = await client.rpc('save_opportunity_meta_search', { p_id: id, p_expected_revision: expectedRevision,
    p_name: template.name, p_criteria: criteria, p_schedule: schedule, p_meta_search: metaSearch });
  if (error) throw error;
  const saved = asCloudTemplate(Array.isArray(data) ? data[0] : data, userId);
  if (saved.id !== id || saved.revision !== expectedRevision + 1 || !matchesPayload(saved, template.name, criteria, schedule)
    || stable(saved.meta_search) !== stable(metaSearch)) throw new Error('The server did not acknowledge this exact meta-search snapshot. Your draft is retained.');
  return { ...template, cloud: { id, revision: saved.revision, contentKey: searchTemplateContentKey(template) } };
}
