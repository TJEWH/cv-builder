import type { CvContent, CvContentItem, CvState } from '../types';
import { createAnonymizedContact } from './anonymization';
import { renderConfidentialText } from './markdownText';

export interface ContentPrivacyOptions { bypassPrivacy?: boolean }

function protectedContent(state: CvState) {
  const sections = new Set(['header', ...state.disabled, ...state.anonymization.excludedSections]);
  const items = new Set(state.anonymization.excludedItems);
  const groups = [
    { id: 'education', items: state.education }, { id: 'jobs', items: state.experience.jobs },
    { id: 'languages', items: state.languages }, { id: 'hobbies', items: state.hobbies },
    ...state.customSections.map((section) => ({ id: section.id, items: section.entries })),
    ...state.sidebarSections,
  ];
  for (const group of groups) {
    for (const item of group.items) if (item.hidden || sections.has(group.id)) items.add(item.id);
  }
  return { sections, items };
}

function redactedText(value: string): string {
  // Redacting a link label must not leave its identifying destination behind.
  const withoutPrivateLinks = value.replace(/\[([^\]]*)\]\(([^\s)]+)\)/g, (link, label: string, href: string) => (
    /!![\s\S]*?!!/.test(label + href) ? label : link
  ));
  return renderConfidentialText(withoutPrivateLinks, { anonymized: true });
}

/** Mutate only the isolated content projection; never the editor's private state. */
export function anonymizeContentJson(content: CvContent, state: CvState): CvContent {
  const { sections, items } = protectedContent(state);
  const visible = (values: CvContentItem[]) => values.filter(({ id }) => !items.has(id)).map((item) => {
    for (const [key, value] of Object.entries(item)) {
      if (key !== 'id' && typeof value === 'string') Reflect.set(item, key, redactedText(value));
    }
    return item;
  });
  content.contact = createAnonymizedContact(content.contact);
  content.about.text = sections.has('about') ? '' : redactedText(content.about.text);
  content.education = visible(content.education);
  content.experience.jobs = visible(content.experience.jobs);
  content.languages = visible(content.languages);
  content.hobbies = visible(content.hobbies);
  content.customSections = content.customSections.filter(({ id }) => !sections.has(id)).map((section) => ({
    ...section, name: redactedText(section.name),
    ...(section.text !== undefined ? { text: redactedText(section.text) } : {}), entries: visible(section.entries),
  }));
  content.sidebarSections = content.sidebarSections.filter(({ id }) => !sections.has(id)).map((section) => ({
    ...section, name: redactedText(section.name), items: visible(section.items),
  }));
  content.sectionNames = Object.fromEntries(Object.entries(content.sectionNames)
    .filter(([id]) => !sections.has(id)).map(([id, name]) => [id, redactedText(name)]));
  return content;
}

function insertProtected<T>(previous: T[], imported: T[], isProtected: (item: T) => boolean): T[] {
  const result = [...imported];
  previous.forEach((item, index) => {
    if (isProtected(item)) result.splice(Math.min(index, result.length), 0, item);
  });
  return result;
}

/** Current privacy rules, not the incoming file, decide what may be overwritten. */
export function preservePrivateContent(current: CvContent, incoming: CvContent, state: CvState): CvContent {
  const { sections, items } = protectedContent(state);
  const mergeItems = (previous: CvContentItem[], imported: CvContentItem[]) => insertProtected(
    previous, imported.filter(({ id }) => !items.has(id)), ({ id }) => items.has(id),
  );
  incoming.contact = current.contact;
  if (sections.has('about')) incoming.about = current.about;
  incoming.education = mergeItems(current.education, sections.has('education') ? [] : incoming.education);
  incoming.experience.jobs = mergeItems(current.experience.jobs, sections.has('jobs') ? [] : incoming.experience.jobs);
  incoming.languages = mergeItems(current.languages, sections.has('languages') ? [] : incoming.languages);
  incoming.hobbies = mergeItems(current.hobbies, sections.has('hobbies') ? [] : incoming.hobbies);

  const previousBody = new Map(current.customSections.map((section) => [section.id, section]));
  incoming.customSections = insertProtected(current.customSections,
    incoming.customSections.filter(({ id }) => !sections.has(id)).map((section) => ({
      ...section, entries: mergeItems(previousBody.get(section.id)?.entries || [], section.entries),
    })), ({ id }) => sections.has(id));
  // If a file drops the entire container, retain the protected items in that
  // container instead of losing them along with the public entries.
  for (const section of current.customSections) {
    if (!incoming.customSections.some(({ id }) => id === section.id) && section.entries.some(({ id }) => items.has(id))) {
      incoming.customSections.push({ ...section, entries: mergeItems(section.entries, []) });
    }
  }
  const previousSidebar = new Map(current.sidebarSections.map((section) => [section.id, section]));
  incoming.sidebarSections = insertProtected(current.sidebarSections,
    incoming.sidebarSections.filter(({ id }) => !sections.has(id)).map((section) => ({
      ...section, items: mergeItems(previousSidebar.get(section.id)?.items || [], section.items),
    })), ({ id }) => sections.has(id));
  for (const section of current.sidebarSections) {
    if (!incoming.sidebarSections.some(({ id }) => id === section.id) && section.items.some(({ id }) => items.has(id))) {
      incoming.sidebarSections.push({ ...section, items: mergeItems(section.items, []) });
    }
  }
  for (const id of sections) {
    if (Object.hasOwn(current.sectionNames, id)) incoming.sectionNames[id] = current.sectionNames[id];
    else delete incoming.sectionNames[id];
  }
  // Textarea values (including !!confidential text!!) remain exactly as imported.
  // Matching or recovering inline secrets from edited prose is intentionally unsupported.
  return incoming;
}
