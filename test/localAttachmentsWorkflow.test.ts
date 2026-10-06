import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, ref, type Component } from 'vue';
import { PDFDocument } from 'pdf-lib';
import type { ApplicationPackageManifest, AttachmentMetadata, LocalDocumentMetadata } from '../src/documentTypes';
import { LocalDocumentRepository, type LocalDocumentStorage } from '../src/composables/localDocuments';
import { attachmentAccount, createAttachmentFixture } from './attachmentFixture';

function component(name: string) {
  const filename = new URL(`../src/components/${name}.vue`, import.meta.url);
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const compiled = compileScript(descriptor, { id: `local-attachment-${name}` });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: Component } = {}; const requireComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), exports);
  return { ...exports.default, render: () => null };
}
const Library = component('LocalAttachments');
const Application = component('ApplicationDocuments');
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
type Entry = AttachmentMetadata & { local?: LocalDocumentMetadata };
interface LibraryState {
  loading: boolean; busy: boolean; error: string; name: string; description: string; file: File | null;
  entries: Entry[]; localDocuments: LocalDocumentMetadata[]; sharedDocuments: AttachmentMetadata[]; editingId: string;
  edit(entry?: Entry): void; chooseFile(event: Event): void; save(): Promise<void>; load(): Promise<void>;
}
interface ApplicationState {
  loading: boolean; busy: boolean; error: string; selectedLibraryId: string; canAttach: boolean;
  manifest: ApplicationPackageManifest; libraryOptions: Entry[];
  composition: unknown; previewUrl: string; buildPreview(): Promise<void>;
  attachLibraryDocument(): void; removeItem(id: string): void; load(): Promise<void>;
}
const pdf = () => new File(['%PDF-1.4\nSynthetic document bytes.'], 'PRIVATE-original-file-name.pdf', { type: 'application/pdf' });
function fileEvent(file: File) { return { target: { files: [file], value: file.name } } as unknown as Event; }
async function idle(setup: { loading: boolean; busy: boolean }) {
  for (let i = 0; i < 30; i++) { await nextTick(); await new Promise<void>(resolve => setImmediate(resolve)); if (!setup.loading && !setup.busy) return; }
  assert.fail('Attachment component did not become idle.');
}
function mount<T extends LibraryState | ApplicationState>(t: TestContext, view: Component, fixture = createAttachmentFixture(), storage: LocalDocumentStorage = fixture.storage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget(); Object.assign(target, { confirm: () => true, setTimeout: () => 1 });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  const owner = ref(attachmentAccount); let mounted: unknown;
  const app = renderer.createApp({ render: () => h(view, {
    userId: owner.value, client: fixture.client, storage, lang: 'en', applicationId: 'synthetic-application',
    cvState: null, letterReady: false, getCvPdf: async () => pdf(), getLetterPdf: async () => pdf(),
    ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount({}); t.after(() => {
    try { app.unmount(); }
    finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
  });
  return { fixture, setup: (mounted as { $: { setupState: T } }).$.setupState, switchAccount(value: string) { fixture.setOwner(value); owner.value = value; } };
}

test('attachment creation requires manual metadata, never derives it from the filename, and uploads only those fields', async t => {
  const { setup, fixture } = mount<LibraryState>(t, Library); await idle(setup);
  setup.edit(); setup.chooseFile(fileEvent(pdf()));
  assert.equal(setup.name, ''); assert.equal(setup.description, '');
  await setup.save(); assert.match(setup.error, /Enter a name and description yourself/);
  assert.equal(fixture.local.size, 0); assert.equal(fixture.rows.length, 0);
  setup.name = 'Transcript of records'; await setup.save(); assert.equal(fixture.local.size, 0);
  setup.description = 'Academic modules and grades for application preparation.'; await setup.save();
  assert.equal(setup.error, ''); assert.equal(setup.entries.length, 1); assert.equal(fixture.rows.length, 1);
  const saved = fixture.calls.find(call => call.name === 'save_local_attachment_metadata')!;
  assert.deepEqual(Object.keys(saved.args).sort(), ['p_description', 'p_id', 'p_name']);
  assert.equal(saved.args.p_name, 'Transcript of records');
  assert.doesNotMatch(JSON.stringify(fixture.calls), /PRIVATE-original-file-name|Synthetic document bytes|blob|mimeType/);
  const original = await new LocalDocumentRepository(attachmentAccount, fixture.storage).getDocument(String(saved.args.p_id));
  assert.equal(await original!.blob.text(), await pdf().text());
});

test('failed metadata syncing preserves local bytes and retries the same attachment ID, including later edits', async t => {
  const { setup, fixture } = mount<LibraryState>(t, Library); await idle(setup); fixture.failSave(true);
  setup.edit(); setup.name = 'Recommendation'; setup.description = 'A reference describing research collaboration.'; setup.chooseFile(fileEvent(pdf()));
  await setup.save(); assert.match(setup.error, /saved locally.*sync failed/); assert.equal(setup.localDocuments.length, 1);
  const id = setup.editingId; assert.ok(id); assert.equal(setup.file, null); assert.equal(fixture.rows.length, 0);
  fixture.failSave(false); await setup.save(); assert.equal(setup.error, ''); assert.equal(setup.localDocuments.length, 1);
  assert.equal(fixture.rows.length, 1); assert.equal(fixture.rows[0].id, id);
  const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage); const original = await repo.getDocument(id);
  assert.equal(await original!.blob.text(), await pdf().text());
  setup.edit(setup.entries[0]); setup.description = 'The approved reference from a research supervisor.'; fixture.failSave(true);
  await setup.save(); assert.match(setup.error, /saved locally/); assert.equal((await repo.getDocument(id))?.description, setup.description);
  await setup.load(); assert.equal(setup.entries[0].description, setup.description, 'a cloud read cannot overwrite unsynced local metadata');
  fixture.failSave(false); await setup.save(); assert.equal(setup.error, ''); assert.equal(fixture.rows[0].description, 'The approved reference from a research supervisor.');
  assert.equal(fixture.rows.length, 1); assert.equal((await repo.listDocuments()).length, 1);
});

test('legacy files do not sync automatically and cloud metadata can be relinked to a local file without a duplicate', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const legacy = await repo.addDocument(pdf(), 'Old transcript');
  const remoteId = '90000000-0000-4000-8000-000000000091';
  fixture.rows.push({ id: remoteId, user_id: attachmentAccount, name: 'Reference', description: 'A manually entered reference description.' });
  const { setup } = mount<LibraryState>(t, Library, fixture); await idle(setup);
  assert.equal(setup.entries.length, 2); assert.equal(fixture.calls.filter(call => call.name.startsWith('save')).length, 0);
  setup.edit(setup.entries.find(entry => entry.id === legacy.id)); assert.equal(setup.name, ''); assert.equal(setup.description, '');
  await setup.save(); assert.match(setup.error, /Enter a name and description yourself/);
  setup.description = 'A manually reviewed academic record.'; await setup.save(); assert.equal(fixture.rows.length, 1, 'the legacy filename is not an approved attachment name');
  setup.name = 'Manually named academic record'; await setup.save(); assert.equal(fixture.rows.length, 2);
  setup.edit(setup.entries.find(entry => entry.id === remoteId)); setup.chooseFile(fileEvent(pdf())); await setup.save();
  assert.equal(setup.error, ''); assert.equal(fixture.rows.length, 2); assert.ok(await repo.getDocument(remoteId));
  assert.equal((await repo.listDocuments()).length, 2);
});

test('switching accounts ignores a delayed local read from the previous account', async t => {
  const fixture = createAttachmentFixture();
  await new LocalDocumentRepository(attachmentAccount, fixture.storage).addDocument(pdf(), 'Old account attachment', 'Old account description.');
  const nextOwner = '90000000-0000-4000-8000-000000000092';
  await new LocalDocumentRepository(nextOwner, fixture.storage).addDocument(pdf(), 'New account attachment', 'New account description.');
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...fixture.storage, async list(scope: string, collection: Parameters<LocalDocumentStorage['list']>[1]) {
    const result = await fixture.storage.list(scope, collection); if (scope === `account:${attachmentAccount}`) await blocked; return result;
  } };
  const { setup, switchAccount } = mount<LibraryState>(t, Library, fixture, storage);
  await nextTick(); switchAccount(nextOwner); await idle(setup);
  assert.equal(setup.entries[0].name, 'New account attachment'); release(); await idle(setup);
  assert.equal(setup.entries.length, 1); assert.equal(setup.entries[0].name, 'New account attachment');
});

test('switching accounts during a local save does not publish metadata to the next account', async t => {
  const fixture = createAttachmentFixture(); let blockWrites = false;
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const storage = { ...fixture.storage, async write(...args: Parameters<LocalDocumentStorage['write']>) {
    await fixture.storage.write(...args); if (blockWrites) await blocked;
  } };
  const { setup, switchAccount } = mount<LibraryState>(t, Library, fixture, storage); await idle(setup);
  setup.edit(); setup.name = 'Old account file'; setup.description = 'Old account private description.'; setup.chooseFile(fileEvent(pdf()));
  blockWrites = true; const save = setup.save(); await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
  switchAccount('90000000-0000-4000-8000-000000000092'); await idle(setup); release(); await save;
  assert.equal(setup.entries.length, 0); assert.equal(setup.name, '');
  assert.equal(fixture.calls.filter(call => call.name === 'save_local_attachment_metadata').length, 0);
  assert.equal((await new LocalDocumentRepository(attachmentAccount, fixture.storage).listDocuments()).length, 1);
});

test('applications select reusable files once, remove only the package reference, and block unavailable or undescribed entries', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const saved = await repo.addDocument(pdf(), 'Transcript', 'Academic record.'), legacy = await repo.addDocument(pdf(), 'Legacy reference');
  const missingId = '90000000-0000-4000-8000-000000000093';
  fixture.rows.push({ id: missingId, user_id: attachmentAccount, name: 'Missing local file', description: 'A known file on another device.' });
  const { setup } = mount<ApplicationState>(t, Application, fixture); await idle(setup);
  setup.selectedLibraryId = missingId; assert.equal(setup.canAttach, false); setup.attachLibraryDocument();
  setup.selectedLibraryId = legacy.id; assert.equal(setup.canAttach, false); setup.attachLibraryDocument();
  assert.equal(setup.manifest.items.length, 2);
  setup.selectedLibraryId = saved.id; assert.equal(setup.canAttach, true); setup.attachLibraryDocument(); await idle(setup);
  assert.equal(setup.manifest.items.length, 3); assert.equal(setup.libraryOptions.some(entry => entry.id === saved.id), false);
  setup.selectedLibraryId = saved.id; setup.attachLibraryDocument(); await idle(setup); assert.equal(setup.manifest.items.length, 3);
  const item = setup.manifest.items.find(item => item.documentId === saved.id)!; setup.removeItem(item.id); await idle(setup);
  assert.equal(setup.manifest.items.length, 2); assert.ok(await repo.getDocument(saved.id)); assert.equal(fixture.rows.length, 1);
});

test('attachment changes during PDF composition invalidate the pending preview before it can be downloaded', async t => {
  const fixture = createAttachmentFixture(); const repo = new LocalDocumentRepository(attachmentAccount, fixture.storage);
  const document = await PDFDocument.create(); document.addPage();
  const saved = await repo.addDocument(new Blob([new Uint8Array(await document.save())], { type: 'application/pdf' }), 'Transcript', 'Approved academic record.');
  await repo.saveManifest({ applicationId: 'synthetic-application', updatedAt: new Date().toISOString(), items: [{ id: 'selected-attachment', kind: 'attachment', documentId: saved.id, label: saved.name, included: true }] });
  let release!: () => void, reading!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reading = resolve; });
  const storage = { ...fixture.storage, async get(...args: Parameters<LocalDocumentStorage['get']>) {
    const result = await fixture.storage.get(...args); if (args[1] === 'documents') { reading(); await blocked; } return result;
  } };
  const { setup } = mount<ApplicationState>(t, Application, fixture, storage); await idle(setup);
  const building = setup.buildPreview(); await started;
  await repo.removeDocument(saved.id); window.dispatchEvent(new Event('cv-local-documents-updated')); release();
  await building; await idle(setup);
  assert.equal(setup.composition, null); assert.equal(setup.previewUrl, '');
  assert.equal(setup.manifest.items.length, 1, 'the manifest keeps the missing attachment reference');
  assert.equal(setup.libraryOptions.length, 0);
});
