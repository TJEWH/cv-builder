import type { CloudCvSnapshot } from '../cloudTypes';
import type { CvConfig, CvDesign, CvState } from '../types';
import { CV_STATE_VERSION } from '../types';
import { createCvConfigJson, createCvContentJson } from './cvJsonBackup';
import { readCvConfig, readCvContent } from './cvStateValidation';
import { BODY_FONTS, HEADING_FONTS } from './webFonts';
import { redactKnownIdentityValues } from './identityRedaction';

const BUILTIN_SECTIONS = ['header', 'about', 'education', 'jobs', 'languages', 'hobbies'];
const DESIGN_CHOICES: Partial<Record<keyof CvDesign, readonly string[]>> = {
  fontBody: ['', ...BODY_FONTS, ...HEADING_FONTS], fontHead: ['', ...BODY_FONTS, ...HEADING_FONTS],
  hstyle: ['clean', 'underline', 'leftbar', 'pill'], badgeMode: ['solid', 'border'],
  sidebarAlign: ['left', 'right'], sidebarFillMode: ['start', 'last-page', 'after-cover'],
  sidebarHeightMode: ['content', 'full-page'], headerLayoutStyle: ['boxed', 'separator'],
  sidebarLayoutStyle: ['boxed', 'separator'], contactLayout: ['side', 'below', 'sidebar', 'footer'],
};

/** Configuration strings are user input too: only presentation values may leave the browser. */
function privacyDesign(design: CvDesign): CvDesign {
  return Object.fromEntries(Object.entries(design).filter(([key, value]) => {
    if (key === 'customFonts' || key === 'favoriteControls') return false;
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100;
    if (typeof value !== 'string') return false;
    const choices = DESIGN_CHOICES[key as keyof CvDesign];
    if (choices) return choices.includes(value);
    if (key === 'ink') return /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value);
    return /^(?:\d{1,3}(?:\.\d{1,3})?)(?:mm|px|pt|fr)$/.test(value);
  })) as CvDesign;
}

/** The only upload boundary for local CVs. This never returns local names, IDs or metadata. */
export function createCloudCvSnapshot(state: CvState, options: { id?: string; now?: Date } = {}): CloudCvSnapshot {
  const id = options.id ?? crypto.randomUUID();
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new Error('Invalid snapshot ID.');
  const now = options.now ?? new Date();
  // Reuse the existing privacy rules, then remove local identifiers and config-only leaks.
  const privacyContent = createCvContentJson(state).data;
  const content = redactKnownIdentityValues(privacyContent, [state.contact]);
  // The existing database accepts fixed sample contacts or blanks. Keep that
  // contract while removing repeated real identity from the projected prose.
  content.contact = privacyContent.contact;
  const localConfig = createCvConfigJson(state).data;
  const excludedSections = new Set([...state.disabled, ...state.anonymization.excludedSections]);
  const sectionIds = new Map(BUILTIN_SECTIONS.filter((key) => !excludedSections.has(key)).map((key) => [key, key]));
  [...content.customSections, ...content.sidebarSections].forEach((section, index) => {
    const cloudId = `section-${index + 1}`;
    sectionIds.set(section.id, cloudId);
    section.id = cloudId;
  });
  const items = [content.education, content.experience.jobs, content.languages, content.hobbies,
    ...content.customSections.map(({ entries }) => entries), ...content.sidebarSections.map(({ items }) => items)].flat();
  items.forEach((item, index) => { item.id = `item-${index + 1}`; });
  content.sectionNames = Object.fromEntries(Object.entries(content.sectionNames)
    .filter(([key]) => sectionIds.has(key)).map(([key, value]) => [sectionIds.get(key)!, value]));
  const mappedIds = (values: string[]) => [...new Set(values.flatMap((key) => sectionIds.has(key) ? [sectionIds.get(key)!] : []))];
  const config: CvConfig = {
    lang: localConfig.lang,
    design: privacyDesign(localConfig.design),
    disabled: BUILTIN_SECTIONS.filter((key) => excludedSections.has(key)),
    completedSections: mappedIds(localConfig.completedSections),
    keepTogetherSections: mappedIds(localConfig.keepTogetherSections),
    anonymization: { excludedSections: [], excludedItems: [] },
    hiddenItems: [],
    sectionHeaderSizes: Object.fromEntries(Object.entries(localConfig.sectionHeaderSizes)
      .filter(([key, value]) => sectionIds.has(key) && ['h1', 'h2', 'h3'].includes(value))
      .map(([key, value]) => [sectionIds.get(key)!, value])),
    bodyOrder: mappedIds(localConfig.bodyOrder),
    sidebarOrder: mappedIds(localConfig.sidebarOrder),
  };
  return {
    id, name: `Privacy CV ${now.toISOString()} ${id.slice(0, 8)}`,
    content_json: readCvContent(content), config_json: readCvConfig(config),
    cv_version: CV_STATE_VERSION, revision: 1, is_base_variant: false,
  };
}
