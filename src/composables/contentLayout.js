import { normalizeMarkdownText } from './markdownText.js';
import { normalizeAnonymizationState } from './anonymization.js';

export const BODY_SECTION_KEYS = ['about', 'education', 'jobs'];
export const SIDEBAR_SECTION_KEYS = ['languages', 'hobbies'];
export const ITEM_STATES = ['planned', 'ongoing', 'complete'];
export const CUSTOM_BODY_FIELDS = ['title', 'institution', 'place', 'start', 'end', 'state', 'desc'];

let generatedId = 0;

export function createContentId(prefix = 'content') {
  generatedId += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10)
    || `${Date.now().toString(36)}${generatedId.toString(36)}`;
  return `${prefix}_${random}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureIds(items, prefix) {
  return ensureArray(items).map((item) => ({
    ...(item || {}),
    id: item?.id || createContentId(prefix),
    hidden: Boolean(item?.hidden),
  }));
}

function normalizeHobbies(value) {
  if (Array.isArray(value)) return ensureIds(value, 'hobby');
  if (value && typeof value === 'object') {
    return ensureIds(Object.values(value).filter(Boolean).map((name) => ({ name })), 'hobby');
  }
  return [];
}

function normalizedOrder(order, allowed) {
  const allowedSet = new Set(allowed);
  const known = new Set();
  const ordered = ensureArray(order).filter((key) => {
    if (!allowedSet.has(key) || known.has(key)) return false;
    known.add(key);
    return true;
  });

  return [...ordered, ...allowed.filter((key) => !known.has(key))];
}

export function moveSectionInOrder(order, key, direction) {
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= order.length) return order;
  const result = [...order];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function normalizeCustomBodyFields(fields) {
  if (!Array.isArray(fields)) return [...CUSTOM_BODY_FIELDS];
  // Status replaces the retired Tools field in existing custom sections.
  const selected = new Set(fields.map((field) => field === 'tools' ? 'state' : field));
  return CUSTOM_BODY_FIELDS.filter((field) => selected.has(field));
}

export function normalizeItemState(value) {
  return ITEM_STATES.includes(value) ? value : 'planned';
}

function normalizeCustomBodyEntryMode(value) {
  return value === 'textarea' ? 'textarea' : 'fields';
}

function normalizeCustomSections(state, migratedSections = []) {
  const customSections = ensureArray(state.customSections);
  const legacyCustom = customSections.length || !ensureArray(state.custom).length ? [] : [{
    id: createContentId('body'),
    name: state.lang === 'de' ? 'Eigene Sektion' : 'Custom Section',
    entries: ensureArray(state.custom),
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

function normalizeSidebarSections(state, migratedSections = []) {
  state.sidebarSections = [...ensureArray(state.sidebarSections), ...migratedSections].map((section) => ({
    ...(section || {}),
    id: section?.id || createContentId('sidebar'),
    name: section?.name || (state.lang === 'de' ? 'Neue Sidebar-Sektion' : 'New Sidebar Section'),
    levelType: ['experience', 'years'].includes(section?.levelType) ? section.levelType : null,
    items: ensureIds(section?.items, 'skill').map((item) => ({
      ...item,
      name: item.name || '',
      levelValue: Number(item.levelValue) || 0,
    })),
  }));
}

function migrationName(state, key, fallback) {
  return state.sectionNames?.[key] || fallback;
}

function legacyBodySections(state) {
  const additional = ensureArray(state.experience?.addExp);
  const projects = ensureArray(state.experience?.projects);
  const ids = {};
  const sections = [];

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

function legacySidebarSections(state) {
  const certificates = ensureArray(state.certs);
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

function normalizeLegacyCourses(value) {
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

function normalizeEducationItem(item, migrateLegacyEducation) {
  const thesis = migrateLegacyEducation && item?.thesis == null
    ? [String(item?.thesisTopic || '').trim(), normalizeMarkdownText(item?.thesisBullets)].filter(Boolean).join('\n')
    : normalizeMarkdownText(item?.thesis);
  const coursesText = migrateLegacyEducation && item?.coursesText == null
    ? normalizeLegacyCourses(item?.courses)
    : normalizeMarkdownText(item?.coursesText);
  const { thesisTopic, thesisBullets, courses, ...education } = item || {};
  return { ...education, thesis, coursesText };
}

export function normalizeContentState(state) {
  const isLegacyState = (Number(state.version) || 1) < 2;
  const migrateLegacyEducation = (Number(state.version) || 1) < 5;
  state.version = Math.max(Number(state.version) || 1, 5);
  const legacyBody = legacyBodySections(state);
  const legacySidebar = legacySidebarSections(state);
  const migratedIds = { ...legacyBody.ids, ...legacySidebar.ids };
  const sourceBodyOrder = isLegacyState ? state.orderMain : (state.bodyOrder || state.orderMain);
  const sourceSidebarOrder = isLegacyState ? state.orderSide : (state.sidebarOrder || state.orderSide);
  state.disabled = ensureArray(state.disabled).filter((key) => !['skills', 'addExp', 'projects', 'certs'].includes(key));
  state.sectionNames ||= {};
  state.sectionHeaderSizes ||= {};
  Object.entries(migratedIds).forEach(([legacyKey, id]) => {
    if (state.sectionHeaderSizes[legacyKey] != null) state.sectionHeaderSizes[id] = state.sectionHeaderSizes[legacyKey];
  });
  ['skills', 'addExp', 'projects', 'certs'].forEach((key) => {
    delete state.sectionNames[key];
    delete state.sectionHeaderSizes[key];
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
  state.customSections.forEach((section) => {
    if (state.sectionHeaderSizes[section.id] == null) state.sectionHeaderSizes[section.id] = 'h2';
  });

  const bodyKeys = [...BODY_SECTION_KEYS, ...state.customSections.map((section) => section.id)];
  const sidebarKeys = [...SIDEBAR_SECTION_KEYS, ...state.sidebarSections.map((section) => section.id)];
  const validBodyKeys = new Set(bodyKeys);
  state.keepTogetherSections = [...new Set(ensureArray(state.keepTogetherSections)
    .filter((key) => typeof key === 'string' && validBodyKeys.has(key)))];
  state.bodyOrder = normalizedOrder(ensureArray(sourceBodyOrder).map((key) => migratedIds[key] || key), bodyKeys);
  state.sidebarOrder = normalizedOrder(ensureArray(sourceSidebarOrder).map((key) => migratedIds[key] || key), sidebarKeys);
  normalizeAnonymizationState(state);

  delete state.experience.addExp;
  delete state.experience.projects;
  delete state.certs;
  delete state.design?.addExpColumns;
  delete state.skills;
  delete state.orderMain;
  delete state.orderSide;
  delete state.sectionPlacement;
}
