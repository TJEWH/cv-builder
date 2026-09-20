import type { Application } from '../cloudTypes';
import type { Contact, CvState } from '../types';
import type { ApplicationLetter, LetterContent, LetterContextVersion, LetterRevision, LetterTemplate } from '../letterTypes';

interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const contentKeys = ['subject', 'salutation', 'body', 'closing'] as const;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const EMPTY_LETTER: LetterContent = { subject: '', salutation: '', body: '', closing: '' };
export const DEFAULT_TEMPLATE_GUIDANCE = {
  subjectInstructions: 'Write a concise subject naming the advertised position and any reference number from the opportunity. Do not invent a reference number.',
  salutationInstructions: 'Address the recipient named in the tender or opportunity using their stated title. If no suitable person is named, address the hiring or selection committee. Match the letter language and do not guess gender or titles.',
  closingInstructions: 'Close professionally in the letter language, express interest in a conversation and sign with {{APPLICANT_NAME}}.',
};

export const DEFAULT_LETTER_TEMPLATES: LetterTemplate[] = [{
  id: 'research', name: 'Research application', revision: 1,
  ...DEFAULT_TEMPLATE_GUIDANCE,
  structure: 'Opening: identify the opportunity and research interest.\nEvidence: connect two relevant experiences from the CV to the requirements.\nResearch fit: explain a specific connection to the project.\nClosing: state the contribution and interest in a discussion.',
  tone: 'Specific, thoughtful and professional. Use only facts present in the context; do not invent experience.',
  language: 'en', maxWords: 450, updatedAt: '2026-09-20T00:00:00.000Z',
}, {
  id: 'industry', name: 'Industry application', revision: 1,
  ...DEFAULT_TEMPLATE_GUIDANCE,
  structure: 'Opening: role and motivation.\nRelevant evidence: two examples of skills and outcomes from the CV.\nContribution: connect experience to the organization and role.\nClosing: concise invitation to discuss.',
  tone: 'Clear, concise and confident. Avoid generic claims and invented qualifications.',
  language: 'en', maxWords: 350, updatedAt: '2026-09-20T00:00:00.000Z',
}];

function readContent(value: unknown): LetterContent {
  if (!isObject(value) || contentKeys.some((key) => typeof value[key] !== 'string')) throw new Error('Invalid letter content.');
  return Object.fromEntries(contentKeys.map((key) => [key, value[key]])) as unknown as LetterContent;
}

function readVersion(value: unknown): LetterContextVersion {
  if (!isObject(value) || typeof value.content !== 'string' || typeof value.theme !== 'string') throw new Error('Invalid letter context.');
  return { content: value.content, theme: value.theme };
}

export function readLetterTemplate(value: unknown): LetterTemplate {
  if (!isObject(value) || ['id', 'name', 'structure', 'tone', 'language', 'updatedAt'].some((key) => typeof value[key] !== 'string')
    || !String(value.id).trim() || !String(value.name).trim() || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || !Number.isInteger(value.maxWords) || Number(value.maxWords) < 50 || Number(value.maxWords) > 2000) throw new Error('Invalid letter template.');
  const guidance = { ...DEFAULT_TEMPLATE_GUIDANCE };
  for (const key of Object.keys(guidance) as (keyof typeof guidance)[]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > 1000) throw new Error('Template instructions must contain at most 1000 characters each.');
    guidance[key] = value[key];
  }
  return { ...guidance, id: String(value.id), name: String(value.name), revision: Number(value.revision), structure: String(value.structure),
    tone: String(value.tone), language: String(value.language), maxWords: Number(value.maxWords), updatedAt: String(value.updatedAt) };
}

function readRecord(value: unknown, userId: string, applicationId: string): ApplicationLetter {
  if (!isObject(value) || value.version !== 1 || value.userId !== userId || value.applicationId !== applicationId
    || typeof value.templateId !== 'string' || typeof value.instructions !== 'string' || typeof value.language !== 'string'
    || !Number.isInteger(value.maxWords) || Number(value.maxWords) < 50 || Number(value.maxWords) > 2000 || typeof value.updatedAt !== 'string'
    || !(value.finalRevisionId === null || typeof value.finalRevisionId === 'string') || !Array.isArray(value.revisions)) throw new Error('Stored letter could not be read. Restore its local backup before editing.');
  const revisions = value.revisions.map((item): LetterRevision => {
    if (!isObject(item) || typeof item.id !== 'string' || !['generated', 'edited', 'final'].includes(String(item.kind)) || typeof item.createdAt !== 'string') throw new Error('Invalid letter revision.');
    return { id: item.id, kind: item.kind as LetterRevision['kind'], content: readContent(item.content), context: readVersion(item.context),
      createdAt: item.createdAt, ...(typeof item.cloudDraftId === 'string' ? { cloudDraftId: item.cloudDraftId } : {}),
      ...(typeof item.cloudContextId === 'string' ? { cloudContextId: item.cloudContextId } : {}) };
  });
  return { version: 1, applicationId, userId, templateId: value.templateId, instructions: value.instructions, language: value.language,
    maxWords: Number(value.maxWords), working: readContent(value.working), workingContext: readVersion(value.workingContext),
    publishedContexts: isObject(value.publishedContexts) ? Object.fromEntries(Object.entries(value.publishedContexts).map(([key, version]) => [key, readVersion(version)])) : {},
    finalRevisionId: value.finalRevisionId, revisions, updatedAt: value.updatedAt };
}

export function createLetterRepository(storage: StorageAdapter, userId: string) {
  const scope = `cv.letters.v1:${encodeURIComponent(userId || 'local')}`;
  const templatesKey = `${scope}:templates`;
  const applicationKey = (id: string) => `${scope}:application:${encodeURIComponent(id)}`;
  function listTemplates(): LetterTemplate[] {
    const raw = storage.getItem(templatesKey);
    if (!raw) return clone(DEFAULT_LETTER_TEMPLATES);
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Stored templates could not be read.');
    return data.map(readLetterTemplate);
  }
  return {
    listTemplates,
    saveTemplate(input: LetterTemplate) {
      const template = readLetterTemplate(input);
      const templates = listTemplates();
      const previous = templates.find((item) => item.id === template.id);
      const saved = { ...template, revision: previous ? previous.revision + 1 : 1, updatedAt: now() };
      storage.setItem(templatesKey, JSON.stringify([...templates.filter((item) => item.id !== saved.id), saved]));
      return clone(saved);
    },
    importTemplates(json: string) {
      const parsed: unknown = JSON.parse(json);
      if (!isObject(parsed) || parsed.format !== 'cv-letter-templates' || parsed.version !== 1 || !Array.isArray(parsed.templates)) throw new Error('Choose a letter template library exported by this app.');
      const incoming = parsed.templates.map(readLetterTemplate);
      const templates = listTemplates();
      // Imported libraries are copied, so existing template choices and revisions stay stable.
      const copies = incoming.map((item) => ({ ...item, id: crypto.randomUUID(), revision: 1, updatedAt: now() }));
      storage.setItem(templatesKey, JSON.stringify([...templates, ...copies]));
      return copies;
    },
    exportTemplates() { return JSON.stringify({ format: 'cv-letter-templates', version: 1, templates: listTemplates() }, null, 2); },
    load(applicationId: string) {
      const raw = storage.getItem(applicationKey(applicationId));
      return raw ? readRecord(JSON.parse(raw), userId, applicationId) : null;
    },
    save(record: ApplicationLetter) {
      const validated = readRecord(record, userId, record.applicationId);
      storage.setItem(applicationKey(record.applicationId), JSON.stringify(validated));
      return clone(validated);
    },
    exportLetter(applicationId: string) {
      const raw = storage.getItem(applicationKey(applicationId));
      if (!raw) throw new Error('There is no saved letter to export.');
      return raw;
    },
    importLetter(json: string, applicationId: string) {
      const record = readRecord(JSON.parse(json), userId, applicationId);
      storage.setItem(applicationKey(applicationId), JSON.stringify(record));
      return clone(record);
    },
  };
}

/** Stable local revision identity; never uploaded. */
function fingerprint(value: unknown) {
  function stable(input: unknown): string {
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    if (isObject(input)) return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(',')}}`;
    return JSON.stringify(input) ?? 'null';
  }
  let hash = 2166136261;
  for (const char of stable(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

/** JSONB may reorder object keys while preserving identical research/content. */
export function sameLetterContextInput(left: unknown, right: unknown) { return fingerprint(left) === fingerprint(right); }

export function letterContextVersion(application: Pick<Application, 'context_json' | 'cv_variant_id'>, state: CvState | null, template: LetterTemplate, language: string, instructions: string, maxWords: number): LetterContextVersion {
  const { design, completedSections: _completed, keepTogetherSections: _together, sectionHeaderSizes: _sizes, ...content } = state || {};
  return { content: fingerprint({ opportunity: application.context_json, cv: content, template, language, instructions, maxWords }), theme: fingerprint(design || {}) };
}

export function createApplicationLetter(userId: string, applicationId: string, template: LetterTemplate, context: LetterContextVersion, lang = template.language): ApplicationLetter {
  return { version: 1, userId, applicationId, templateId: template.id, instructions: '', language: lang, maxWords: template.maxWords,
    working: { ...EMPTY_LETTER }, workingContext: clone(context), publishedContexts: {}, revisions: [], finalRevisionId: null, updatedAt: now() };
}

export function contextChanges(record: ApplicationLetter, context: LetterContextVersion) {
  return { content: record.workingContext.content !== context.content, theme: record.workingContext.theme !== context.theme };
}

/** A final pointer alone never authorizes an export of different working text. */
export function finalizedLetterRevision(record: ApplicationLetter): LetterRevision | null {
  const revision = record.revisions.find((item) => item.id === record.finalRevisionId && item.kind === 'final');
  if (!revision || JSON.stringify(revision.content) !== JSON.stringify(record.working)
    || revision.context.content !== record.workingContext.content || revision.context.theme !== record.workingContext.theme) return null;
  return revision;
}

export function editLetter(record: ApplicationLetter, content: LetterContent) {
  if (JSON.stringify(content) === JSON.stringify(record.working)) return clone(record);
  return { ...clone(record), working: readContent(content), finalRevisionId: null, updatedAt: now() };
}

/** One editable document, retaining a simple subject heading and every existing text block. */
export function letterToEditableText(content: LetterContent): string {
  return [content.subject ? `# ${content.subject}` : '', content.salutation, content.body, content.closing].filter((part) => part.length > 0).join('\n\n');
}

/** After editing, salutation and closing are ordinary parts of the complete body. */
export function letterFromEditableText(text: string): LetterContent {
  const subject = /^# ([^\r\n]*)(?:\r?\n(?:\r?\n)?|$)/.exec(text);
  return { ...EMPTY_LETTER, subject: subject?.[1] || '', body: subject ? text.slice(subject[0].length) : text };
}

export function addIncomingDraft(record: ApplicationLetter, content: LetterContent, context: LetterContextVersion, metadata: { cloudDraftId?: string; cloudContextId?: string } = {}) {
  if (metadata.cloudDraftId && record.revisions.some((item) => item.cloudDraftId === metadata.cloudDraftId)) return clone(record);
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'generated', content: readContent(content), context: clone(context), createdAt: now(), ...metadata };
  return { ...clone(record), revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

export function saveWorkingRevision(record: ApplicationLetter) {
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'edited', content: clone(record.working), context: clone(record.workingContext), createdAt: now() };
  return { ...clone(record), revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

/** Explicitly opening a draft archives current edits and never removes a final revision. */
export function openLetterRevision(record: ApplicationLetter, revisionId: string) {
  const source = record.revisions.find((item) => item.id === revisionId);
  if (!source) throw new Error('Letter revision is unavailable.');
  const copy = clone(record);
  if (Object.values(copy.working).some((value) => value.trim())) copy.revisions.push({ id: crypto.randomUUID(), kind: 'edited', content: clone(copy.working), context: clone(copy.workingContext), createdAt: now() });
  copy.working = clone(source.content);
  copy.workingContext = clone(source.context);
  copy.finalRevisionId = source.kind === 'final' ? source.id : null;
  copy.updatedAt = now();
  return copy;
}

export function finalizeLetter(record: ApplicationLetter, context: LetterContextVersion, contact: Contact | null) {
  if (!record.working.body.trim()) throw new Error('Write or import the letter before finalizing it.');
  if (unresolvedLetterPlaceholders(record.working, contact).length) throw new Error('Resolve all placeholders before finalizing the letter.');
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'final', content: clone(record.working), context: clone(context), createdAt: now() };
  return { ...clone(record), workingContext: clone(context), finalRevisionId: revision.id, revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

const identityFields: Record<string, keyof Contact> = { NAME: 'name', EMAIL: 'email', PHONE: 'phone', LOCATION: 'location', ROLE: 'role', WEBSITE: 'website', LINKEDIN: 'linkedin', GITHUB: 'github' };
const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\[([A-Z][A-Z_]+)\]/g;
export function resolveLetterText(text: string, contact: Contact | null) {
  return text.replace(placeholderPattern, (token, braces: string | undefined, brackets: string | undefined) => {
    const key = (braces || brackets || '').trim().toUpperCase().replace(/^(APPLICANT|CANDIDATE|CONTACT)[._]/, '');
    const field = identityFields[key];
    return field && contact?.[field] ? contact[field] : token;
  });
}
export function resolveLetterContent(content: LetterContent, contact: Contact | null): LetterContent {
  return Object.fromEntries(contentKeys.map((key) => [key, resolveLetterText(content[key], contact)])) as unknown as LetterContent;
}
export function unresolvedLetterPlaceholders(content: LetterContent, contact: Contact | null) {
  return [...new Set(Object.values(resolveLetterContent(content, contact)).flatMap((value) => [...value.matchAll(placeholderPattern)].map((match) => match[0])))];
}

export function parseIncomingLetter(text: string): LetterContent {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?|\n?```$/g, '');
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObject(parsed) || typeof parsed.body !== 'string') throw new Error('Draft JSON needs a body field.');
    return readContent({ ...EMPTY_LETTER, ...parsed });
  }
  return { ...EMPTY_LETTER, body: text.trim() };
}
