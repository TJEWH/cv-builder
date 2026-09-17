export const CV_JSON_FORMAT = 'cv-builder/cv';
export const CV_JSON_FORMAT_VERSION = 1;
export const MAX_CV_JSON_FILE_BYTES = 5 * 1024 * 1024;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CV_STATE_KEYS = [
  'contact',
  'about',
  'education',
  'experience',
  'languages',
  'hobbies',
  'customSections',
  'sidebarSections',
  'design',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCvStateShape(value) {
  return isRecord(value) && CV_STATE_KEYS.some((key) => Object.hasOwn(value, key));
}

function parseJson(text) {
  try {
    return JSON.parse(text, (key, value) => (RESERVED_KEYS.has(key) ? undefined : value));
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
}

/** Create the portable, versioned JSON file format for the current CV state. */
export function createCvJsonBackup(state, exportedAt = new Date()) {
  const data = JSON.parse(JSON.stringify(state));
  return {
    format: CV_JSON_FORMAT,
    formatVersion: CV_JSON_FORMAT_VERSION,
    cvVersion: Number.isFinite(Number(data?.version)) ? Number(data.version) : null,
    exportedAt: exportedAt.toISOString(),
    data,
  };
}

/**
 * Read the current portable format as well as prior raw CV-state files.
 * Reserved object keys are removed during parsing so imported JSON cannot
 * alter application prototypes when it is later merged into reactive state.
 */
export function parseCvJsonBackup(text) {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) throw new Error('The selected file does not contain a CV.');

  let data = parsed;
  if (Object.hasOwn(parsed, 'format')) {
    if (parsed.format !== CV_JSON_FORMAT || parsed.formatVersion !== CV_JSON_FORMAT_VERSION) {
      throw new Error('This file uses an unsupported CV export format.');
    }
    data = parsed.data;
  } else if (isRecord(parsed.__meta) && isRecord(parsed.data)) {
    // Named browser backups use this wrapper. Supporting it makes recovery
    // possible after someone exports an existing LocalStorage value manually.
    data = parsed.data;
  }

  if (!hasCvStateShape(data)) throw new Error('The selected file does not contain a CV.');
  return data;
}
