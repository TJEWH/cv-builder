import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import { createTestState } from './helpers';
import { CV_STATE_VERSION } from '../src/types';
import { readCvState } from '../src/composables/cvStateValidation';
import {
  CV_JSON_FORMAT, CV_JSON_FORMAT_VERSION, createCvJsonBackup, parseCvJsonBackup, parseStoredCvState,
} from '../src/composables/cvJsonBackup';

const sampleCv = createTestState();
sampleCv.contact.name = 'Ada Lovelace';

test('exports and imports the current portable format without changing data', () => {
  const backup = createCvJsonBackup(sampleCv, new Date('2026-09-17T12:00:00.000Z'));
  assert.deepEqual(backup, {
    format: CV_JSON_FORMAT, formatVersion: CV_JSON_FORMAT_VERSION,
    cvVersion: CV_STATE_VERSION, exportedAt: '2026-09-17T12:00:00.000Z', data: sampleCv,
  });
  assert.deepEqual(parseCvJsonBackup(JSON.stringify(backup)), sampleCv);
});

test('rejects raw documents, browser wrappers and unsupported file or data versions', () => {
  assert.throws(() => parseCvJsonBackup('{'), /not valid JSON/);
  const backup = createCvJsonBackup(sampleCv);
  for (const data of [
    sampleCv,
    { __meta: { id: 'saved-cv' }, data: sampleCv },
    { ...backup, formatVersion: 2 },
    { ...backup, format: 'unknown' },
  ]) {
    assert.throws(() => parseCvJsonBackup(JSON.stringify(data)), /unsupported CV export format/);
  }
  for (const version of [undefined, '7', 1, 5, 6, 8]) {
    assert.throws(() => readCvState({ ...sampleCv, version }), /Unsupported CV data version/);
    assert.throws(() => parseCvJsonBackup(JSON.stringify({ ...backup, cvVersion: version })), /Unsupported CV data version/);
    assert.throws(() => parseCvJsonBackup(JSON.stringify({ ...backup, data: { ...sampleCv, version } })), /Unsupported CV data version/);
  }
});

test('named browser configurations retain their current storage wrapper', () => {
  const stored = JSON.stringify({ __meta: { id: 'saved-cv', name: 'Ada', updatedAt: 42 }, data: sampleCv });
  assert.deepEqual(parseStoredCvState(stored), sampleCv);
  assert.throws(() => parseStoredCvState(JSON.stringify(sampleCv)), /Invalid saved configuration/);
  assert.throws(() => parseStoredCvState(JSON.stringify({ __meta: {}, data: { ...sampleCv, version: 6 } })), /Unsupported CV data version/);
});

test('drops prototype-changing keys from imported JSON', () => {
  const backup = createCvJsonBackup(sampleCv);
  const data = JSON.parse('{"__proto__":{"polluted":true},"constructor":"discard","prototype":{}}');
  Object.assign(data, sampleCv);
  const imported = parseCvJsonBackup(JSON.stringify({ ...backup, data }));
  for (const key of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(imported, key), false);
});

test('rejects missing required fields, invalid nested types and former data shapes', () => {
  const malformed = [
    { contact: { ...sampleCv.contact, name: 42 } },
    { experience: 'invalid' },
    { education: [null] },
    { education: [{ title: 'Missing ID' }] },
    { education: [{ id: 'item', title: {} }] },
    { experience: { jobs: [{ id: 'job', bullets: ['Old bullet list'] }] } },
    { hobbies: { first: 'Music' } },
    { customSections: [{ id: 'section', name: 'Section', fields: ['tools'], entries: [] }] },
    { design: { graphicOpacity: 'opaque' } },
    { sidebarSections: [{ id: 'skills', name: 'Skills', levelType: null, items: [{ id: 'item', levelValue: '4' }] }] },
    { anonymization: { excludedItems: [false], excludedSections: [] } },
    { sectionNames: { jobs: 42 } },
    { bodyOrder: undefined },
  ];
  for (const fields of malformed) {
    const data = { ...sampleCv, ...fields };
    assert.throws(() => readCvState(data), /invalid or missing fields/, JSON.stringify(fields));
    assert.throws(() => parseCvJsonBackup(JSON.stringify({ ...createCvJsonBackup(sampleCv), data })), /invalid or missing fields/);
  }
});

test('bundled defaults and exports satisfy the current schema', () => {
  const state = readCvState(createSampleDocument());
  assert.deepEqual(parseCvJsonBackup(JSON.stringify(createCvJsonBackup(state))), state);
});

test('optional current fields may be omitted', () => {
  const state = createTestState({
    design: {},
    education: [{ id: 'education' }],
    customSections: [{ id: 'custom', name: 'Custom', entries: [] }],
  });
  assert.equal(readCvState(state), state);
});

test('custom font families and sources survive portable and browser backups', () => {
  const state = createTestState({ design: {
    fontBody: 'Open Sans', fontHead: 'Century Gothic',
    customFonts: [{ name: 'Open Sans', source: 'bunny' }, { name: 'Century Gothic', source: 'google' }],
  } });
  assert.deepEqual(parseCvJsonBackup(JSON.stringify(createCvJsonBackup(state))), state);
  assert.deepEqual(parseStoredCvState(JSON.stringify({ __meta: {}, data: state })), state);
  for (const customFonts of [[{ name: 'Inter', source: 'other' }], [{ name: '', source: 'google' }], [{ name: 'Inter' }], ['Inter']]) {
    assert.throws(() => readCvState({ ...state, design: { customFonts } }), /invalid or missing fields/);
  }
});
