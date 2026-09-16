import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CV_JSON_FORMAT,
  CV_JSON_FORMAT_VERSION,
  createCvJsonBackup,
  parseCvJsonBackup,
} from '../src/composables/cvJsonBackup.js';

const sampleCv = {
  version: 7,
  contact: { name: 'Ada Lovelace' },
  experience: { jobs: [] },
};

test('creates a portable, versioned JSON CV export', () => {
  const backup = createCvJsonBackup(sampleCv, new Date('2026-09-17T12:00:00.000Z'));

  assert.deepEqual(backup, {
    format: CV_JSON_FORMAT,
    formatVersion: CV_JSON_FORMAT_VERSION,
    cvVersion: 7,
    exportedAt: '2026-09-17T12:00:00.000Z',
    data: sampleCv,
  });
});

test('imports the portable format and legacy raw CV state', () => {
  const portable = JSON.stringify(createCvJsonBackup(sampleCv));

  assert.deepEqual(parseCvJsonBackup(portable), sampleCv);
  assert.deepEqual(parseCvJsonBackup(JSON.stringify(sampleCv)), sampleCv);
  assert.deepEqual(parseCvJsonBackup(JSON.stringify({ __meta: { id: 'saved-cv' }, data: sampleCv })), sampleCv);
});

test('rejects malformed, unsupported, and non-CV JSON files', () => {
  assert.throws(() => parseCvJsonBackup('{'), /not valid JSON/);
  assert.throws(
    () => parseCvJsonBackup(JSON.stringify({ format: CV_JSON_FORMAT, formatVersion: 2, data: sampleCv })),
    /unsupported CV export format/,
  );
  assert.throws(() => parseCvJsonBackup(JSON.stringify({ note: 'not a CV' })), /does not contain a CV/);
});

test('drops prototype-changing keys from imported JSON', () => {
  const imported = parseCvJsonBackup(`{
    "format": "${CV_JSON_FORMAT}",
    "formatVersion": ${CV_JSON_FORMAT_VERSION},
    "data": {
      "version": 7,
      "__proto__": { "polluted": true },
      "contact": { "name": "Ada Lovelace", "constructor": "discard" }
    }
  }`);

  assert.equal(Object.hasOwn(imported, '__proto__'), false);
  assert.equal(Object.hasOwn(imported.contact, 'constructor'), false);
});
