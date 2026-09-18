import type { CvState, LegacyCvState, LegacyItem, CustomBodyField, ItemState, SidebarSection } from '../types';
import { normalizeMarkdownText } from './markdownText.ts';
import { normalizeAnonymizationState } from './anonymization.ts';

export const BODY_SECTION_KEYS = ['about', 'education', 'jobs'];
export const SIDEBAR_SECTION_KEYS = ['languages', 'hobbies'];
export const ITEM_STATES = ['planned', 'ongoing', 'complete'];
export const CUSTOM_BODY_FIELDS: CustomBodyField[] = ['title', 'institution', 'place', 'start', 'end', 'state', 'desc'];

let generatedId = 0;

export function createContentId(prefix = 'content') {
  generatedId += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10)
    || `${Date.now().toString(36)}${generatedId.toString(36)}`;
  return `${prefix}_${random}`;
}

function ensureArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function ensureIds<T extends LegacyItem>(items: T[] | undefined, prefix: string) {
  return ensureArray(items).map((item) => ({
    ...(item || {}),
    id: item?.id || createContentId(prefix),
    hidden: Boolean(item?.hidden),
  }));
}

function normalizeHobbies(value: LegacyCvState['hobbies']) {
  if (Array.isArray(value)) return ensureIds(value, 'hobby');
  if (value && typeof value === 'object') {
    return ensureIds(Object.values(value).filter(Boolean).map((name) => ({ name })), 'hobby');
  }
  return [];
}

function normalizedOrder(order: string[] | undefined, allowed: string[]) {
  const allowedSet = new Set(allowed);
  const known = new Set();
  const ordered = ensureArray<string>(order).filter((key) => {
    if (!allowedSet.has(key) || known.has(key)) return false;
    known.add(key);
    return true;
  });

  return [...ordered, ...allowed.filter((key) => !known.has(key))];
}

export function moveSectionInOrder(order: string[], key: string, direction: number) {
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= order.length) return order;
  const result = [...order];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function normalizeCustomBodyFields(fields: unknown): CustomBodyField[] {
  if (!Array.isArray(fields)) return [...CUSTOM_BODY_FIELDS];
  // Status replaces the retired Tools field in existing custom sections.
  const selected = new Set(fields.map((field) => field === 'tools' ? 'state' : field));
  return CUSTOM_BODY_FIELDS.filter((field) => selected.has(field));
}

export function normalizeItemState(value: unknown): ItemState {
  return typeof value === 'string' && ITEM_STATES.includes(value) ? value as ItemState : 'planned';
}

function normalizeCustomBodyEntryMode(value: unknown): 'textarea' | 'fields' {
  return value === 'textarea' ? 'textarea' : 'fields';
}

function normalizeCustomSections(state: LegacyCvState, migratedSections: NonNullable<LegacyCvState['customSections']> = []) {
  const customSections = ensureArray<NonNullable<LegacyCvState['customSections']>[number]>(state.customSections);
  const legacyCustom: NonNullable<LegacyCvState['customSections']> = customSections.length || !ensureArray<LegacyItem>(state.custom).length ? [] : [{
    id: createContentId('body'),
    name: state.lang === 'de' ? 'Eigene Sektion' : 'Custom Section',
    entries: ensureArray<LegacyItem>(state.custom),
  }];

  state.customSections = [...customSections, ...legacyCustom, ...migratedSections].map((section) => ({
    ...(section || {}),
    id: section?.id || createContentId('body'),
    name: section?.name || (state.lang === 'de' ? 'Neue Sektion' : 'New Section'),
    entryMode: normalizeCustomBodyEntryMode(section?.entryMode),
    text: normalizeMarkdownText(section?.text),
    fields: normalizeCustomBodyFields(section?.fields),
    entries: ensureIds(section?.entries, 'entry').map((entry) => {
      const { tools, ...item } = entry;
      return {
        ...item,
        institution: item.institution || '',
        state: normalizeItemState(item.state),
        desc: normalizeMarkdownText(item.desc),
      };
    }),
  }));

  delete state.custom;
}

function normalizeSidebarSections(state: LegacyCvState, migratedSections: Partial<SidebarSection>[] = []) {
  state.sidebarSections = [...ensureArray<Partial<SidebarSection>>(state.sidebarSections), ...migratedSections].map((section) => ({
    ...(section || {}),
    id: section?.id || createContentId('sidebar'),
    name: section?.name || (state.lang === 'de' ? 'Neue Sidebar-Sektion' : 'New Sidebar Section'),
    levelType: section?.levelType === 'experience' || section?.levelType === 'years' ? section.levelType : null,
    items: ensureIds(section?.items, 'skill').map((item) => ({
      ...item,
      name: item.name || '',
      levelValue: Number(item.levelValue) || 0,
    })),
  }));
}

function migrationName(state: LegacyCvState, key: string, fallback: string) {
  return state.sectionNames?.[key] || fallback;
}

function legacyBodySections(state: LegacyCvState) {
  const additional = ensureArray<LegacyItem>(state.experience?.addExp);
  const projects = ensureArray<LegacyItem>(state.experience?.projects);
  const ids: Record<string, string> = {};
  const sections: NonNullable<LegacyCvState['customSections']> = [];

  if (additional.length) {
    const id = createContentId('body');
    ids.addExp = id;
    sections.push({
      id,
      name: migrationName(state, 'addExp', state.lang === 'de' ? 'Weitere Erfahrung' : 'Additional Experience'),
      fields: CUSTOM_BODY_FIELDS,
      entries: ensureIds(additional, 'entry').map((item) => ({
        id: item.id,
        hidden: item.hidden,
        title: item.title || '',
        place: item.place || '',
        start: item.start || '',
        end: item.end || '',
        desc: [item.sub, normalizeMarkdownText(item.desc)].filter(Boolean).join('\n'),
      })),
    });
  }

  if (projects.length) {
    const id = createContentId('body');
    ids.projects = id;
    sections.push({
      id,
      name: migrationName(state, 'projects', state.lang === 'de' ? 'Projekte & Publikationen' : 'Projects & Publications'),
      fields: CUSTOM_BODY_FIELDS,
      entries: ensureIds(projects, 'entry').map((item) => ({
        id: item.id,
        hidden: item.hidden,
        title: item.title || '',
        place: item.place || '',
        start: item.start || '',
        end: item.end || '',
        desc: normalizeMarkdownText(item.desc),
      })),
    });
  }

  return { ids, sections };
}

function legacySidebarSections(state: LegacyCvState): { ids: Record<string, string>; sections: Partial<SidebarSection>[] } {
  const certificates = ensureArray<LegacyItem>(state.certs);
  if (!certificates.length) return { ids: {}, sections: [] };

  const id = createContentId('sidebar');
  return {
    ids: { certs: id },
    sections: [{
      id,
      name: migrationName(state, 'certs', state.lang === 'de' ? 'Zertifikate' : 'Certificates'),
      levelType: null,
      items: ensureIds(certificates, 'skill').map((certificate) => ({
        id: certificate.id,
        hidden: certificate.hidden,
        name: [certificate.name, certificate.year].filter(Boolean).join(' · '),
        levelValue: 0,
      })),
    }],
  };
}

function normalizeLegacyCourses(value: unknown) {
  if (!Array.isArray(value)) return normalizeMarkdownText(value);
  return value
    .map((course) => {
      if (typeof course === 'string') return course.trim();
      const title = String(course?.title || '').trim();
      const description = String(course?.description || '').trim();
      return [title, description].filter(Boolean).join(title && description ? ' — ' : '');
    })
    .filter(Boolean)
    .map((course) => `- ${course.replace(/^\s*-\s*/, '')}`)
    .join('\n');
}

function normalizeEducationItem(item: LegacyItem & { id: string }, migrateLegacyEducation: boolean) {
  const thesis = migrateLegacyEducation && item?.thesis == null
    ? [String(item?.thesisTopic || '').trim(), normalizeMarkdownText(item?.thesisBullets)].filter(Boolean).join('\n')
    : normalizeMarkdownText(item?.thesis);
  const coursesText = migrateLegacyEducation && item?.coursesText == null
    ? normalizeLegacyCourses(item?.courses)
    : normalizeMarkdownText(item?.coursesText);
  const { thesisTopic, thesisBullets, courses, ...education } = item || {};
  return { ...education, thesis, coursesText };
}

export function normalizeContentState(state: LegacyCvState): asserts state is CvState {
  // A normalized document must also satisfy the editor's non-content fields.
  // Older backups can omit these even when their section data is valid.
  state.lang ||= 'en';
  state.design ||= {};
  state.completedSections = ensureArray<string>(state.completedSections);
  state.contact = { name: '', location: '', role: '', email: '', phone: '', website: '', linkedin: '', github: '', ...state.contact };
  const isLegacyState = (Number(state.version) || 1) < 2;
  const migrateLegacyEducation = (Number(state.version) || 1) < 5;
  state.version = Math.max(Number(state.version) || 1, 5);
  const legacyBody = legacyBodySections(state);
  const legacySidebar = legacySidebarSections(state);
  const migratedIds: Record<string, string> = { ...legacyBody.ids, ...legacySidebar.ids };
  const sourceBodyOrder = isLegacyState ? state.orderMain : (state.bodyOrder || state.orderMain);
  const sourceSidebarOrder = isLegacyState ? state.orderSide : (state.sidebarOrder || state.orderSide);
  state.disabled = ensureArray<string>(state.disabled).filter((key) => !['skills', 'addExp', 'projects', 'certs'].includes(key));
  state.sectionNames ||= {};
  state.sectionHeaderSizes ||= {};
  Object.entries(migratedIds).forEach(([legacyKey, id]) => {
    if (state.sectionHeaderSizes![legacyKey] != null) state.sectionHeaderSizes![id] = state.sectionHeaderSizes![legacyKey];
  });
  ['skills', 'addExp', 'projects', 'certs'].forEach((key) => {
    delete state.sectionNames![key];
    delete state.sectionHeaderSizes![key];
  });

  state.about = {
    ...(state.about || {}),
    text: normalizeMarkdownText(state.about?.text),
  };
  state.experience ||= {};
  state.education = ensureIds(state.education, 'education').map((item) => normalizeEducationItem(item, migrateLegacyEducation));
  state.experience.jobs = ensureIds(state.experience.jobs, 'job').map((entry) => {
    const { tools, ...item } = entry;
    return {
      ...item,
      state: normalizeItemState(item.state),
      bullets: normalizeMarkdownText(item.bullets),
    };
  });
  state.languages = ensureIds(state.languages, 'language');
  state.hobbies = normalizeHobbies(state.hobbies);

  normalizeCustomSections(state, legacyBody.sections);
  normalizeSidebarSections(state, legacySidebar.sections);
  state.customSections!.forEach((section) => {
    if (state.sectionHeaderSizes![section.id!] == null) state.sectionHeaderSizes![section.id!] = 'h2';
  });

  const bodyKeys = [...BODY_SECTION_KEYS, ...state.customSections!.map((section) => section.id!)];
  const sidebarKeys = [...SIDEBAR_SECTION_KEYS, ...state.sidebarSections!.map((section) => section.id!)];
  const validBodyKeys = new Set(bodyKeys);
  state.keepTogetherSections = [...new Set(ensureArray<string>(state.keepTogetherSections)
    .filter((key) => typeof key === 'string' && validBodyKeys.has(key)))];
  state.bodyOrder = normalizedOrder(ensureArray<string>(sourceBodyOrder).map((key) => migratedIds[key] || key), bodyKeys);
  state.sidebarOrder = normalizedOrder(ensureArray<string>(sourceSidebarOrder).map((key) => migratedIds[key] || key), sidebarKeys);
  normalizeAnonymizationState(state as CvState);

  delete state.experience.addExp;
  delete state.experience.projects;
  delete state.certs;
  delete state.design?.addExpColumns;
  delete state.skills;
  delete state.orderMain;
  delete state.orderSide;
  delete state.sectionPlacement;
}
