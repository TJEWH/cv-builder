import type { SearchProfessionalProfile, SearchTemplate } from '../searchTypes';

interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const SEARCH_TEMPLATE_TEXT_MAX_LENGTH = 12000;
export const SEARCH_TEMPLATES_UPDATED_EVENT = 'cv-search-templates-updated';
export const DEFAULT_SEARCH_USER_PROMPT = 'Find currently open, funded PhDs and doctorates, Industrial PhDs and relevant applied research positions with solid funding and a start around early 2027. Verify funding, salary, contract, duration, eligibility and requirements from official vacancy listings and linked graduate-school rules. Research evidenced supervision and contact roles, required/optional/conditional application documents, research content and methods, teaching load, deadlines and sources. Prioritize strong technical fit, practical research, hands-on prototyping and a useful academic or industrial R&D career direction. Report only new or materially changed strong matches; remain quiet after a successful run with no such matches. Do not add a salary floor, minimum fit score or software-only exclusion that I have not requested.';
export const DEFAULT_SEARCH_PROFILE_PROMPT = 'Treat the research interests below as flexible alternatives: a position focused on one topic or a useful combination of topics may qualify. Do not require every topic in the same position. Evaluate the actual research questions and methods, beyond keyword matching. Favor relevant prototyping, machine learning, technical evaluation, real hardware, intelligent physical systems and interdisciplinary work. These are research interests and preferred directions, not claims of prior experience or qualifications.';
export const DEFAULT_SEARCH_RESEARCH_INTERESTS = 'Acoustic and physical sensing; acoustics; signal processing and audio; speech, voice and audio; machine listening; robot audition; sensor and multisensor fusion; robotics and human–robot interaction; embodied AI; embedded and edge AI; brain–computer interfaces; audio interfaces; vocal biomarkers.';
export const DEFAULT_SEARCH_LOCATION_PREFERENCES = 'Prioritize Scandinavia, followed by Europe, especially Germany and the United Kingdom. Also consider Japan, Australia and New Zealand, and interesting cooler locations in Southeast Asia or emerging countries. The working language should be English or German.';

function defaultTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Tirane'; }
  catch { return 'Europe/Tirane'; }
}
export function createSearchProfile(name = 'Professional profile'): SearchProfessionalProfile {
  return { id: crypto.randomUUID(), name, enabled: true, professionalContext: '', researchInterests: '', userPrompt: '' };
}
export function createSearchTemplate(name = 'New meta search', timezone = defaultTimezone()): SearchTemplate {
  return { id: crypto.randomUUID(), name, revision: 1, updatedAt: new Date().toISOString(), professionalContext: '', researchInterests: '', locationPreferences: '',
    userPrompt: '', profiles: [createSearchProfile()], dailyTime: '09:00', timezone };
}
export const DEFAULT_SEARCH_TEMPLATES: SearchTemplate[] = [{
  id: 'funded-european-phds', name: 'Funded research opportunities', revision: 1, updatedAt: '2026-10-28T00:00:00.000Z',
  professionalContext: '', researchInterests: '', locationPreferences: DEFAULT_SEARCH_LOCATION_PREFERENCES, userPrompt: DEFAULT_SEARCH_USER_PROMPT,
  profiles: [{ id: 'search-3', name: 'Acoustics, sensing & intelligent systems', enabled: true, professionalContext: '', researchInterests: DEFAULT_SEARCH_RESEARCH_INTERESTS, userPrompt: DEFAULT_SEARCH_PROFILE_PROMPT }],
  dailyTime: '09:00', timezone: 'Europe/Tirane',
}];

function textField(value: Record<string, unknown>, key: string, maximum = SEARCH_TEMPLATE_TEXT_MAX_LENGTH) {
  const text = value[key];
  if (typeof text !== 'string' || text.length > maximum || text.includes('\0')) throw new Error(`Invalid search ${key}; use text of at most ${maximum} characters.`);
  return text;
}
export function readSearchProfile(value: unknown): SearchProfessionalProfile {
  if (!isObject(value) || typeof value.enabled !== 'boolean') throw new Error('Invalid professional profile.');
  const id = textField(value, 'id', 200); const name = textField(value, 'name', 200);
  if (!id.trim() || !name.trim()) throw new Error('A professional profile needs a name and identifier.');
  return { id, name: name.trim(), enabled: value.enabled, professionalContext: textField(value, 'professionalContext'),
    researchInterests: textField(value, 'researchInterests'), userPrompt: textField(value, 'userPrompt') };
}
export function readSearchTemplate(value: unknown): SearchTemplate {
  if (!isObject(value) || !Array.isArray(value.profiles) || value.profiles.length > 30
    || !Number.isInteger(value.revision) || Number(value.revision) < 1) throw new Error('Invalid meta-search template.');
  const id = textField(value, 'id', 200); const name = textField(value, 'name', 200);
  if (!id.trim() || !name.trim()) throw new Error('A meta search needs a name and identifier.');
  const dailyTime = textField(value, 'dailyTime', 5); const timezone = textField(value, 'timezone', 100);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('Choose a valid daily time.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('Choose a valid IANA timezone.'); }
  const updatedAt = textField(value, 'updatedAt', 100);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid meta-search update date.');
  const profiles = value.profiles.map(readSearchProfile);
  if (new Set(profiles.map(item => item.id)).size !== profiles.length) throw new Error('Professional profile identifiers must be unique.');
  let cloud: SearchTemplate['cloud'];
  if (value.cloud !== undefined) {
    if (!isObject(value.cloud) || typeof value.cloud.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.cloud.id)
      || !Number.isInteger(value.cloud.revision) || Number(value.cloud.revision) < 1 || typeof value.cloud.contentKey !== 'string') throw new Error('Invalid published search reference.');
    cloud = { id: value.cloud.id, revision: Number(value.cloud.revision), contentKey: value.cloud.contentKey };
  }
  return { id, name: name.trim(), revision: Number(value.revision), updatedAt, professionalContext: textField(value, 'professionalContext'),
    researchInterests: textField(value, 'researchInterests'), locationPreferences: value.locationPreferences === undefined ? '' : textField(value, 'locationPreferences'), userPrompt: textField(value, 'userPrompt'), profiles, dailyTime, timezone, ...(cloud ? { cloud } : {}) };
}

export function searchTemplateContentKey(template: SearchTemplate): string {
  const { name, professionalContext, researchInterests, locationPreferences, userPrompt, profiles, dailyTime, timezone } = readSearchTemplate(template);
  return JSON.stringify({ name, professionalContext, researchInterests, locationPreferences, userPrompt, profiles, dailyTime, timezone });
}
function notifyChanged() { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(SEARCH_TEMPLATES_UPDATED_EVENT)); }

/** Collapse older libraries into one search without dropping their professional directions. */
export function mergeMetaSearches(templates: SearchTemplate[]): SearchTemplate {
  if (!templates.length) return clone(DEFAULT_SEARCH_TEMPLATES[0]!);
  const [first, ...others] = templates.map(readSearchTemplate);
  const primary = clone(first!);
  if (!others.length) return primary;
  const ids = new Set(primary.profiles.map(profile => profile.id));
  for (const [index, template] of others.entries()) {
    const profiles = template.profiles.length ? template.profiles : [{ id: `legacy-shared-${index}`, name: 'Shared context', enabled: false, professionalContext: '', researchInterests: '', userPrompt: '' }];
    for (const [profileIndex, profile] of profiles.entries()) {
      let id = profile.id;
      if (ids.has(id)) id = `merged-${index}-${profileIndex}-${id.slice(0,120)}`;
      ids.add(id);
      primary.profiles.push({
        ...profile, id, name: `${template.name}: ${profile.name}`.slice(0,200),
        professionalContext: [template.professionalContext, profile.professionalContext].filter(Boolean).join('\n\n'),
        researchInterests: [template.researchInterests, profile.researchInterests].filter(Boolean).join('\n\n'),
        userPrompt: [template.userPrompt, template.locationPreferences ? `Profile-specific region and language preferences:\n${template.locationPreferences}` : '', profile.userPrompt].filter(Boolean).join('\n\n'),
      });
    }
  }
  primary.userPrompt = [primary.userPrompt, 'Apply each profile as an alternative research direction. Explicit profile-specific conditions and regional preferences override the shared defaults for that profile.'].filter(Boolean).join('\n\n');
  return readSearchTemplate(primary);
}

/** Synchronous commit-driven storage; failures leave the caller's editor intact. */
export function createSearchTemplateRepository(storage: StorageAdapter, userId: string) {
  const key = `cv.search-templates.v1:${encodeURIComponent(userId || 'local')}`;
  function listTemplates(): SearchTemplate[] {
    const raw = storage.getItem(key);
    if (!raw) return clone(DEFAULT_SEARCH_TEMPLATES);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Stored meta searches could not be read. Restore their backup before editing.');
    const templates = parsed.map(readSearchTemplate);
    if (new Set(templates.map(item => item.id)).size !== templates.length) throw new Error('Stored meta searches contain duplicate identifiers.');
    return [mergeMetaSearches(templates)];
  }
  function write(templates: SearchTemplate[]) {
    const previous = storage.getItem(key);
    if (previous && JSON.parse(previous).length > 1 && !storage.getItem(`${key}:legacy-library`)) storage.setItem(`${key}:legacy-library`, previous);
    storage.setItem(key, JSON.stringify(templates)); notifyChanged();
  }
  return {
    listTemplates,
    saveTemplate(input: SearchTemplate, baseline?: SearchTemplate | null) {
      let template = readSearchTemplate(input);
      const templates = listTemplates();
      const previous = templates.find(item => item.id === template.id);
      if (baseline) {
        const original = readSearchTemplate(baseline);
        if (original.id !== template.id || !previous) throw new Error('This meta search is no longer saved. Your edits remain in the editor.');
        const merged: Record<string, unknown> = { ...previous };
        for (const field of Object.keys({ ...original, ...template }) as (keyof SearchTemplate)[]) {
          if (['id', 'revision', 'updatedAt'].includes(field)) continue;
          const before = JSON.stringify(original[field]); const incoming = JSON.stringify(template[field]); const current = JSON.stringify(previous[field]);
          if (before === incoming) continue;
          if (current !== before && current !== incoming) throw new Error('This meta search changed in another tab. Your edits remain here; copy them before reloading.');
          merged[field] = template[field];
        }
        template = readSearchTemplate(merged);
      }
      if (previous && JSON.stringify({ ...template, revision: previous.revision, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return clone(previous);
      const saved = { ...template, revision: previous ? previous.revision + 1 : 1, updatedAt: new Date().toISOString() };
      write([saved]);
      return clone(saved);
    },
    deleteTemplate(id: string, expectedRevision?: number) {
      const templates = listTemplates(); const previous = templates.find(item => item.id === id);
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision) throw new Error('This meta search changed in another tab. Reload before removing it.');
      if (previous) write(clone(DEFAULT_SEARCH_TEMPLATES));
    },
    exportTemplates() { return JSON.stringify({ format: 'cv-search-templates', version: 1, templates: listTemplates() }, null, 2); },
    importTemplates(json: string) {
      const data: unknown = JSON.parse(json);
      if (!isObject(data) || data.format !== 'cv-search-templates' || data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 100) throw new Error('Invalid meta-search backup.');
      if (!data.templates.length) throw new Error('The backup must contain a meta search.');
      const current = listTemplates()[0]!;
      const imported = mergeMetaSearches(data.templates.map(readSearchTemplate));
      const saved = { ...imported, id: current.id, revision: current.revision + 1, cloud: current.cloud, updatedAt: new Date().toISOString() };
      write([saved]);
      return [clone(saved)];
    },
  };
}
