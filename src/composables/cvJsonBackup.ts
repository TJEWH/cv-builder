import type { CvState } from '../types';
import { CV_STATE_VERSION } from '../types';
import { isRecord, readCvState } from './cvStateValidation';

export const CV_JSON_FORMAT = 'cv-builder/cv';
export const CV_JSON_FORMAT_VERSION = 1;
export const MAX_CV_JSON_FILE_BYTES = 5 * 1024 * 1024;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Create the current portable, versioned JSON file format. */
export function createCvJsonBackup(state: CvState, exportedAt = new Date()) {
  const data = readCvState(JSON.parse(JSON.stringify(state)));
  return {
    format: CV_JSON_FORMAT,
    formatVersion: CV_JSON_FORMAT_VERSION,
    cvVersion: CV_STATE_VERSION,
    exportedAt: exportedAt.toISOString(),
    data,
  };
}

/** Read current exports; reject unsupported wrappers and data versions. */
export function parseCvJsonBackup(text: string): CvState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (key, value) => (RESERVED_KEYS.has(key) ? undefined : value));
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== CV_JSON_FORMAT || parsed.formatVersion !== CV_JSON_FORMAT_VERSION) {
    throw new Error('This file uses an unsupported CV export format.');
  }
  if (parsed.cvVersion !== CV_STATE_VERSION) throw new Error('Unsupported CV data version.');
  return readCvState(parsed.data);
}

/** Named browser configurations use their own current metadata wrapper. */
export function parseStoredCvState(text: string): CvState {
  const stored: unknown = JSON.parse(text);
  if (!isRecord(stored) || !isRecord(stored.__meta)) throw new Error('Invalid saved configuration.');
  return readCvState(stored.data);
}
