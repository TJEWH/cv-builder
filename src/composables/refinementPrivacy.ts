import type { CvAdjustmentField, LocalCvAdjustmentRequest } from '../cvAdjustmentTypes';
import type { ApprovedPrivacyContexts, PrivacyContextType, PrivacyLegendEntry } from '../refinementTypes';
import type { CvState } from '../types';

export const PRIVACY_CONTEXT_TYPES: readonly PrivacyContextType[] = ['person', 'organization', 'location', 'link', 'contact', 'confidential', 'other'];
const TOKEN = /\{\{PRIVATE_[1-9][0-9]*\}\}/g;
export const PRIVACY_DESCRIPTION_LIMIT = 500;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validatePrivacyLegend(value: unknown, fields: CvAdjustmentField[]): asserts value is PrivacyLegendEntry[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid privacy legend.');
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).sort().join(',') !== 'description,fieldId,token,type'
      || typeof entry.fieldId !== 'string' || typeof entry.token !== 'string' || !/^\{\{PRIVATE_[1-9][0-9]*\}\}$/.test(entry.token)
      || !PRIVACY_CONTEXT_TYPES.includes(entry.type as PrivacyContextType) || typeof entry.description !== 'string'
      || !entry.description.trim() || entry.description.length > PRIVACY_DESCRIPTION_LIMIT
      || /[\u0000-\u001f\u007f]|!!|\{\{|\}\}|<|>/u.test(entry.description)) throw new Error('Invalid approved privacy context. Use a type and a short plain-text description.');
    if (seen.has(entry.token) || !fields.find(field => field.id === entry.fieldId)?.text.match(TOKEN)?.includes(entry.token)) throw new Error('The privacy legend must reference each token once in its original content field.');
    seen.add(entry.token);
  }
}

/** Exposes opaque approval keys and public references only, never token originals. */
export function privacyContextTargets(local: LocalCvAdjustmentRequest, signature: (value: unknown) => string) {
  return local.publicRequest.fields.flatMap(field => {
    const binding = local.bindings.find(item => item.fieldId === field.id);
    if (!binding) return [];
    const source = binding.path.reduce<unknown>((value, part) => value && typeof value === 'object' ? Reflect.get(value, part) : undefined, local.baselineState);
    return (field.text.match(TOKEN) || []).map((token, index) => ({ fieldId: field.id, token, label: field.label,
      sourceKey: signature([local.sourceVariantId, binding.path, source, binding.tokens[token], index]) }));
  });
}

export function preparePrivacyLegend(local: LocalCvAdjustmentRequest, approved: ApprovedPrivacyContexts, signature: (value: unknown) => string, sanitize: (value: string) => string): PrivacyLegendEntry[] {
  const entries = privacyContextTargets(local, signature).flatMap(target => {
    if (!Object.hasOwn(approved, target.sourceKey)) return [];
    const context = approved[target.sourceKey];
    const entry = { fieldId: target.fieldId, token: target.token, type: context?.type, description: context?.description };
    validatePrivacyLegend([entry], local.publicRequest.fields);
    if (sanitize(entry.description) !== entry.description) throw new Error('An approved context description contains protected text. Replace it with general wording before sharing.');
    return [entry];
  });
  validatePrivacyLegend(entries, local.publicRequest.fields);
  return entries;
}

/** Preserve placeholders while filtering repeated marked secrets in outgoing free text. */
export function redactMarkedOriginals(text: string, state: CvState): string {
  const secrets = new Set<string>();
  function visit(value: unknown) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/!!([\s\S]*?)(?:!!|$)/g)) if (match[1].trim()) { secrets.add(match[1]); secrets.add(match[1].trim()); }
      for (const match of value.matchAll(/\[([^\]]*)\]\(([^\s)]+)\)/g)) if (/!!/.test(match[1] + match[2])) secrets.add(match[2].replaceAll('!!', ''));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) Object.values(value).forEach(visit);
  }
  visit(state);
  const originals = [...secrets].sort((a, b) => b.length - a.length);
  return originals.reduce((value, original) => value.split(/(\{\{[A-Z_0-9]+\}\})/g)
    .map(part => /^\{\{[A-Z_0-9]+\}\}$/.test(part) ? part : part.replace(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), '{{CONFIDENTIAL}}')).join(''), text);
}

/** Classification describes the public projection, not guesses about employers, cities or links. */
export function privacySegments(text: string): { status: 'visible' | 'pseudonymized'; text: string }[] {
  return text.split(/(\{\{(?:PRIVATE_[1-9][0-9]*|APPLICANT_[A-Z_]+|CONFIDENTIAL)\}\})/g).filter(Boolean)
    .map(part => ({ status: /^\{\{(?:PRIVATE_[1-9][0-9]*|APPLICANT_[A-Z_]+|CONFIDENTIAL)\}\}$/.test(part) ? 'pseudonymized' : 'visible', text: part }));
}
