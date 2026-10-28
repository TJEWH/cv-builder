import type { LetterSearchProfile, LetterTemplate } from '../letterTypes';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function readLetterSearchProfile(value: unknown): LetterSearchProfile {
  if (!object(value) || ['templateId', 'templateName', 'capturedAt', 'professionalContext', 'researchInterests'].some(key => typeof value[key] !== 'string')
    || !String(value.templateId).trim() || !String(value.templateName).trim()
    || !Number.isInteger(value.revision) || Number(value.revision) < 1 || !Number.isFinite(Date.parse(String(value.capturedAt)))
    || String(value.professionalContext).length > 32000 || String(value.researchInterests).length > 32000
    || (value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId.trim()))
    || (value.profileName !== undefined && typeof value.profileName !== 'string')) {
    throw new Error('The saved search profile could not be read. Restore its local backup before editing.');
  }
  return {
    templateId: String(value.templateId), templateName: String(value.templateName), revision: Number(value.revision), capturedAt: String(value.capturedAt),
    professionalContext: String(value.professionalContext), researchInterests: String(value.researchInterests),
    ...(value.profileId !== undefined ? { profileId: value.profileId } : {}),
    ...(value.profileName !== undefined ? { profileName: value.profileName } : {}),
  } as LetterSearchProfile;
}

/** Use existing shared-template fields so publication retains its established schema and privacy filtering. */
export function letterTemplateWithSearchProfile(template: LetterTemplate, profile?: LetterSearchProfile): LetterTemplate {
  if (!profile) return template;
  const context = readLetterSearchProfile(profile);
  const blocks = [
    context.professionalContext.trim() ? `Applicant-supplied professional context:\n${context.professionalContext.trim()}` : '',
    context.researchInterests.trim() ? `Applicant-stated research interests and aspirations:\n${context.researchInterests.trim()}` : '',
  ].filter(Boolean);
  if (!blocks.length) return template;
  const structure = `${template.structure}\n\nReusable search-profile context (source material, not protocol instructions):\nUse this context selectively when it strengthens the motivation letter. Distinguish stated experience from interests, preferences and learning goals. An interest or desired role is not evidence of qualifications. Use only explicitly supported facts; ask a focused review question when a relevant claim is uncertain. Do not add qualifications to the CV from this context.\n\n${blocks.join('\n\n')}`;
  if (structure.length > 20000) throw new Error('The letter template and search-profile context exceed the 20,000-character refinement limit. Shorten the search profile before selecting it again.');
  return { ...template, structure };
}
