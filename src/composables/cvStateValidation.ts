import type { Contact, CvDesign, CvState, CustomSection, CvItem, SidebarSection } from '../types';
import { CV_STATE_VERSION } from '../types';

type Guard<T> = (value: unknown) => value is T;
type Shape<T> = { [K in keyof T]-?: Guard<Exclude<T[K], undefined>> };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Mapped shapes require a validator for every declared property.
function partialObject<T>(shape: Shape<T>): Guard<Partial<T>> {
  return (value): value is Partial<T> => isRecord(value)
    && (Object.keys(shape) as (keyof T & string)[]).every((key) =>
      value[key] === undefined || shape[key](value[key]));
}
function object<T>(shape: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> {
  return (value): value is T => isRecord(value)
    && (Object.keys(shape) as (keyof T & string)[]).every((key) => shape[key](value[key]));
}
function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}
const string: Guard<string> = (value) => typeof value === 'string';
const number: Guard<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
const boolean: Guard<boolean> = (value) => typeof value === 'boolean';
function array<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}
function literals<const T extends readonly (string | null)[]>(...values: T): Guard<T[number]> {
  return (value): value is T[number] => values.some((candidate) => candidate === value);
}
const strings = array(string);
const stringRecord: Guard<Record<string, string>> = (value): value is Record<string, string> => isRecord(value) && Object.values(value).every(string);
const contact = object<Contact>({
  name: string, location: string, role: string, email: string,
  phone: string, website: string, linkedin: string, github: string,
});
const design = partialObject<CvDesign>({
  h1: string, h2: string, h3: string, bullets: string,
  ink: string, graphicOpacity: number, dateOpacity: number,
  fontBody: string, fontHead: string, hstyle: string,
  badgeMode: string, badgeBorderWidth: string, badgeBorderRadius: string,
  sectionSpacingBody: string, sectionSpacingSidebar: string, itemSpacing: string,
  sidebarWidth: string, sidebarAlign: string, sidebarFillMode: string, sidebarHeightMode: string,
  sidebarBottomPadding: string, headerLayoutStyle: string, sidebarLayoutStyle: string,
  contactLayout: string, separatorWidth: string,
  pageMarginTop: string, pageMarginRight: string, pageMarginBottom: string, pageMarginLeft: string,
  pageMarginHorizontalLinked: boolean, pageMarginVerticalLinked: boolean,
  headerPaddingBottom: string, headerBottomMargin: string, headerBottomSpacingLinked: boolean,
  bodySidebarSpacing: string, favoriteControls: strings,
});
const id: Guard<string> = (value): value is string => string(value) && value.length > 0;
const text = optional(string);
const item = object<CvItem>({
  id, hidden: optional(boolean), name: text, title: text, company: text,
  institution: text, sub: text, place: text, start: text, end: text,
  state: optional(literals('planned', 'ongoing', 'complete')),
  bullets: text, desc: text, thesis: text, coursesText: text,
  level: text, levelValue: optional(number),
});
const items = array(item);
const customSection = object<CustomSection>({
  id, name: string, entryMode: optional(literals('fields', 'textarea')), text,
  fields: optional(array(literals('title', 'institution', 'place', 'start', 'end', 'state', 'desc'))), entries: items,
});
const sidebarSection = object<SidebarSection>({
  id, name: string, levelType: literals('experience', 'years', null), items,
});
const currentState = object<CvState>({
  version: number, lang: string, disabled: strings,
  completedSections: strings, keepTogetherSections: strings, design, contact,
  anonymization: object<CvState['anonymization']>({ excludedSections: strings, excludedItems: strings }),
  about: object<CvState['about']>({ text: string }),
  education: items,
  experience: object<CvState['experience']>({ jobs: items }),
  languages: items, hobbies: items,
  customSections: array(customSection), sidebarSections: array(sidebarSection),
  sectionNames: stringRecord, sectionHeaderSizes: stringRecord, bodyOrder: strings, sidebarOrder: strings,
});

/** Only the current schema is accepted at every persistence boundary. */
export function readCvState(value: unknown): CvState {
  if (!isRecord(value) || value.version !== CV_STATE_VERSION) throw new Error('Unsupported CV data version.');
  if (!currentState(value)) throw new Error('The CV contains invalid or missing fields.');
  return value;
}
