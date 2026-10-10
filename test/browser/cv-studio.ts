// Full application layout fixture. Use the isolated test/e2e Vite configuration.
// All browser storage is synthetic; no saved CVs, files or sessions are read.
import { createSampleDocument, SAMPLE_DOCUMENT_ID } from '../../src/composables/builtinConfigurations';
import { indexedDocumentStorage } from '../../src/composables/localDocuments';
import { createAttachmentFixture } from '../attachmentFixture';

const sample = createSampleDocument();
sample.lang = 'en';
sample.contact.name = 'Synthetic Elena';
sample.anonymization.excludedSections = ['jobs'];
// Opt-in stress data for keyboard, wrapping, and translated control checks.
const stress = new URLSearchParams(location.search).has('stress');
if (stress) {
  sample.lang = 'de';
  sample.sectionNames = { ...sample.sectionNames, jobs: 'InterdisziplinäreForschungserfahrungen'.repeat(4) };
  sample.contact.name = 'Éléonore · 山田 · الباحثة';
  sample.customSections[0].name = 'ForschungsprojekteUndWissenschaftlicheVeröffentlichungen'.repeat(3);
}
const values = new Map<string, string>([
  ['CV_CONF_ACTIVE_ID', SAMPLE_DOCUMENT_ID],
  [`CV_CONF_DATA:${SAMPLE_DOCUMENT_ID}`, JSON.stringify({ __meta: { id: SAMPLE_DOCUMENT_ID, name: 'Synthetic CV' }, data: sample })],
  ['CV_WORKSPACE_NAV', JSON.stringify({ workspace: 'cv-studio', cvTab: stress ? 'content' : 'templates' })],
]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });
Object.assign(indexedDocumentStorage, createAttachmentFixture().storage);
await import('../../src/main');
