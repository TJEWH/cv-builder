const BUILT_IN_BODY_SECTION_KEYS = ['about', 'education', 'jobs'];
const BUILT_IN_SIDEBAR_SECTION_KEYS = ['languages', 'hobbies'];

export const ANONYMIZED_CONTACT = Object.freeze({
  name: 'Alex Muster',
  location: 'Neustadt',
  role: 'Software Engineer',
  email: 'muster-ex@mp.le',
  phone: '+49 123 456789',
  website: 'https://alexmuster.dev',
  linkedin: 'https://linkedin.com/in/alexmuster',
  github: 'https://github.com/alexmuster',
});

function uniqueKnownIds(value, knownIds) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((id) => (
    typeof id === 'string' && knownIds.has(id) && !seen.has(id) && (seen.add(id), true)
  ));
}

function sectionKeys(state) {
  return [
    ...BUILT_IN_BODY_SECTION_KEYS,
    ...BUILT_IN_SIDEBAR_SECTION_KEYS,
    ...(state.customSections || []).map((section) => section.id),
    ...(state.sidebarSections || []).map((section) => section.id),
  ];
}

function itemIds(state) {
  return [
    ...(state.education || []).map((item) => item.id),
    ...(state.experience?.jobs || []).map((item) => item.id),
    ...(state.languages || []).map((item) => item.id),
    ...(state.hobbies || []).map((item) => item.id),
    ...(state.customSections || []).flatMap((section) => (section.entries || []).map((item) => item.id)),
    ...(state.sidebarSections || []).flatMap((section) => (section.items || []).map((item) => item.id)),
  ];
}

export function normalizeAnonymizationState(state) {
  const settings = state.anonymization || {};
  state.anonymization = {
    excludedSections: uniqueKnownIds(settings.excludedSections, new Set(sectionKeys(state))),
    excludedItems: uniqueKnownIds(settings.excludedItems, new Set(itemIds(state))),
  };
}

function clonedState(state) {
  return JSON.parse(JSON.stringify(state));
}

function hideMatchingItems(items, excludedItems) {
  return (items || []).map((item) => ({
    ...item,
    hidden: Boolean(item.hidden) || excludedItems.has(item.id),
  }));
}

export function createAnonymizedContact(contact = {}) {
  return Object.fromEntries(Object.entries(ANONYMIZED_CONTACT).map(([key, dummyValue]) => [
    key,
    contact?.[key] ? dummyValue : '',
  ]));
}

/**
 * Produce the isolated render state used by anonymous preview and export.
 * The editor state is never modified.
 */
export function createAnonymizedState(state) {
  const anonymized = clonedState(state || {});
  const settings = state?.anonymization || {};
  const excludedSections = new Set(settings.excludedSections || []);
  const excludedItems = new Set(settings.excludedItems || []);

  anonymized.contact = createAnonymizedContact(state?.contact);
  anonymized.disabled = [...new Set([...(anonymized.disabled || []), ...excludedSections])];
  anonymized.education = hideMatchingItems(anonymized.education, excludedItems);
  anonymized.experience ||= {};
  anonymized.experience.jobs = hideMatchingItems(anonymized.experience.jobs, excludedItems);
  anonymized.languages = hideMatchingItems(anonymized.languages, excludedItems);
  anonymized.hobbies = hideMatchingItems(anonymized.hobbies, excludedItems);
  anonymized.customSections = (anonymized.customSections || []).map((section) => ({
    ...section,
    entries: hideMatchingItems(section.entries, excludedItems),
  }));
  anonymized.sidebarSections = (anonymized.sidebarSections || []).map((section) => ({
    ...section,
    items: hideMatchingItems(section.items, excludedItems),
  }));

  return anonymized;
}
