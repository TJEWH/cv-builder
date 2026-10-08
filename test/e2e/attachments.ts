import { createApp, h, nextTick, ref, type App, type Component } from 'vue';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import LocalAttachments from '../../src/components/LocalAttachments.vue';
import ApplicationDocuments from '../../src/components/ApplicationDocuments.vue';
import { LocalDocumentRepository } from '../../src/composables/localDocuments';
import { createAttachmentFixture, attachmentAccount } from '../attachmentFixture';
import '../../src/assets/cv.css';
import './style.css';

const root = document.querySelector<HTMLElement>('#workspace')!;
const status = document.querySelector<HTMLElement>('#test-status')!;
const results = document.querySelector<HTMLOListElement>('#test-results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-tests')!;
// Capture the real URL-to-Blob association without requiring the test host to render native PDFs.
const previewBlobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = value => { const url = createObjectURL(value); if (value instanceof Blob) previewBlobs.set(url, value); return url; };
URL.revokeObjectURL = url => { previewBlobs.delete(url); revokeObjectURL(url); };
const applicationId = '10000000-0000-4000-8000-000000000090';
const view = ref<'library' | 'prepare' | 'review'>('library');
let app: App | undefined, fixture = createAttachmentFixture();
let library: { loading: boolean; busy: boolean; error: string }, documents: typeof library & { composition: { blob: Blob } | null };
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
async function pdf(width: number, secret: string) {
  const output = await PDFDocument.create(), font = await output.embedFont(StandardFonts.Helvetica);
  output.addPage([width, 600]).drawText(secret, { x: 20, y: 500, font, size: 12 });
  return new Blob([new Uint8Array(await output.save())], { type: 'application/pdf' });
}
async function settle() {
  await nextTick();
  const deadline = performance.now() + 20000;
  while (library?.loading || library?.busy || documents?.loading || documents?.busy) {
    if (performance.now() > deadline) throw new Error('Attachment operation timed out.');
    await new Promise(resolve => setTimeout(resolve, 20)); await nextTick();
  }
  await new Promise(requestAnimationFrame); await nextTick();
}
const current = () => root.querySelector<HTMLElement>(view.value === 'library' ? '.local-attachments' : '.application-documents')!;
async function click(name: string, parent: ParentNode = current()) {
  const button = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name);
  assert(button && !button.disabled, `Missing or disabled button: ${name}`);
  button.click(); await settle();
}
async function fill(name: string, value: string) {
  const label = [...current().querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === name);
  const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  assert(input, `Missing field: ${name}`); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
}
async function chooseFile(blob: Blob, filename: string) {
  const input = current().querySelector<HTMLInputElement>('form input[type=file]'); assert(input, 'Missing local file selector');
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], filename, { type: blob.type })); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true })); await settle();
}
async function mount() {
  app?.unmount(); root.replaceChildren(); fixture = createAttachmentFixture(); view.value = 'library';
  const generated = await pdf(400, 'Synthetic accepted generated document.');
  app = createApp({ render: () => h('div', { style: 'display:flex;flex-direction:column;min-height:0;flex:1;width:100%' }, [
    h('nav', { style: 'display:flex;gap:8px;margin-bottom:16px' }, [
      h('button', { class: 'btn', onClick: () => { view.value = 'library'; } }, 'CV Studio · Local attachments'),
      h('button', { class: 'btn', onClick: () => { view.value = 'prepare'; } }, 'Application preparation'),
      h('button', { class: 'btn', onClick: () => { view.value = 'review'; } }, 'PDF review'),
    ]),
    h(LocalAttachments as Component, { userId: attachmentAccount, client: fixture.client, storage: fixture.storage, lang: 'en', active: view.value === 'library',
      style: view.value === 'library' ? 'flex:1;min-height:0' : 'display:none',
      ref: (instance: unknown) => { if (instance) library = (instance as { $: { setupState: typeof library } }).$.setupState; } }),
    h(ApplicationDocuments as Component, { userId: attachmentAccount, client: fixture.client, storage: fixture.storage, applicationId, lang: 'en',
      active: view.value !== 'library', mode: view.value === 'review' ? 'review' : 'prepare', cvState: null, cvReady: true, letterReady: true, exportReady: true,
      getCvPdf: async () => generated, getLetterPdf: async () => generated,
      style: view.value === 'library' ? 'display:none' : 'flex:1;min-height:0',
      ref: (instance: unknown) => { if (instance) documents = (instance as { $: { setupState: typeof documents } }).$.setupState; } }),
  ]) });
  app.mount(root); await settle();
}
async function add(blob: Blob, filename: string, name: string, description: string) {
  await click('New attachment'); await chooseFile(blob, filename);
  const inputs = current().querySelector('form')!;
  assert(inputs.querySelector<HTMLInputElement>('input:not([type=file])')!.value === '' && inputs.querySelector<HTMLTextAreaElement>('textarea')!.value === '', 'Choosing a file generated a name or description');
  await fill('Attachment name', name); await fill('Description', description); await click('Save attachment');
  assert(!library.error, library.error);
  assert(current().textContent?.includes(name) && current().textContent?.includes(description), 'Library entry lost its manual name or description');
}
async function select(id: string) {
  const control = current().querySelector<HTMLSelectElement>('select[aria-label="Choose an existing document"]'); assert(control, 'Existing attachment picker unavailable');
  assert(!control.closest('.library-picker')?.querySelector('button'), 'Attachment selection still requires a manual Add button');
  control.value = id; control.dispatchEvent(new Event('change', { bubbles: true })); await settle(); assert(!documents.error, documents.error);
  const remainingControl = current().querySelector<HTMLSelectElement>('select[aria-label="Choose an existing document"]');
  assert(!remainingControl || remainingControl.value === '', 'Attachment picker did not reset after automatically adding the selection');
}
const rawPreviewUrl = (url: string) => url.split('#')[0]!;
async function renderedPreview(selector = '.package-inline-pdf') {
  const deadline = performance.now() + 20000;
  for (;;) {
    const viewer = current().querySelector<HTMLIFrameElement>(`iframe${selector}`);
    if (viewer?.src.startsWith('blob:') && documents.composition) return viewer;
    assert(!documents.error, documents.error);
    if (performance.now() > deadline) throw new Error('Native PDF preview did not receive the composed PDF');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
runButton.addEventListener('click', async () => {
  runButton.disabled = true; results.replaceChildren(); status.textContent = 'Running'; document.body.dataset.result = 'running';
  const stage = (text: string) => { const item = document.createElement('li'); item.textContent = `PASS: ${text}`; results.append(item); };
  try {
    await mount();
    const transcript = await pdf(510, 'PRIVATE_TRANSCRIPT_CONTENT_83'), recommendation = await pdf(610, 'PRIVATE_RECOMMENDATION_CONTENT_97');
    await add(transcript, 'PRIVATE-original-transcript.pdf', 'Transcript of records', 'Course list and grades for my engineering degree.');
    await add(recommendation, 'PRIVATE-original-recommendation.pdf', 'Letter of recommendation', 'Academic recommendation describing my research work.');
    assert(fixture.rows.length === 2, 'Manual metadata was not saved to Supabase');
    const sent = JSON.stringify(fixture.calls);
    for (const secret of ['PRIVATE_', 'mimeType', 'size', 'blob', 'bytes', 'filename', 'application/pdf']) assert(!sent.includes(secret), `Cloud request included private file data: ${secret}`);
    const local = new LocalDocumentRepository(attachmentAccount, fixture.storage);
    const first = fixture.rows.find(row => row.name === 'Transcript of records')!, second = fixture.rows.find(row => row.name === 'Letter of recommendation')!;
    assert(await (await local.getDocument(first.id))!.blob.text() === await transcript.text(), 'Saving metadata changed the original file');
    stage('Manual names/descriptions sync; file bytes and filenames remain local');
    await click('Application preparation', root);
    assert(!current().querySelector('input[accept*="application/pdf"]'), 'Application preparation still has an independent upload form');
    await select(first.id); await select(second.id);
    assert(current().textContent?.includes(first.description) && current().textContent?.includes(second.description), 'Selected attachments do not show their descriptions');
    const selected = await local.getManifest(applicationId);
    assert(selected.items.filter(item => item.kind === 'attachment').length === 2, 'Application selection did not persist');
    stage('Selecting reusable attachments adds them automatically and retains both descriptions');
    await click('PDF review', root); assert(!documents.error, documents.error);
    for (const removed of ['Preview complete PDF', 'Manage attachments in CV Studio', 'Refresh attachments', 'Supporting documents & export', 'Package order', 'Frozen package archive']) {
      assert(!current().textContent?.includes(removed), `Redundant PDF review control remains: ${removed}`);
    }
    const inline = await renderedPreview();
    assert(inline.getBoundingClientRect().height > 0, 'Native inline PDF preview is hidden');
    assert(!current().querySelector('.simple-pdf-viewer'), 'Custom PDF viewer is still mounted');
    assert(documents.composition?.blob, 'Composed PDF bytes missing');
    assert(new URL(inline.src).hash === '#toolbar=0&navpanes=0', 'Native PDF preview must request hidden viewer tools');
    const previewBlob = previewBlobs.get(rawPreviewUrl(inline.src));
    assert(previewBlob, 'Native preview URL has no live PDF blob');
    const previewBytes = await previewBlob.arrayBuffer();
    const compositionBytes = new Uint8Array(await documents.composition.blob.arrayBuffer());
    assert(previewBytes.byteLength === compositionBytes.length && new Uint8Array(previewBytes).every((byte, index) => byte === compositionBytes[index]), 'Native preview URL does not contain the composed PDF');
    const composed = await PDFDocument.load(previewBytes);
    assert(composed.getPageCount() === 4 && composed.getPages().every(page => page.getWidth() === 400 && page.getHeight() === 600), 'Attachment pages did not match CV and letter size');
    const actions = current().querySelector<HTMLElement>('.package-preview-actions');
    assert(actions?.querySelector('.page-map-summary summary')?.textContent?.trim() === 'Document order', 'Document order must appear in the PDF footer');
    const openPreview = [...actions!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Open preview');
    assert(openPreview, 'Open preview must appear in the PDF footer');
    assert(actions!.getBoundingClientRect().top >= inline.getBoundingClientRect().bottom - 1, 'Document order and Open preview must sit below the package PDF');
    const originalBlob = documents.composition.blob;
    const originalUrl = inline.src;
    await click('↑', current().querySelectorAll('.package-items li')[3]!);
    const reordered = await renderedPreview();
    assert(documents.composition?.blob !== originalBlob, 'Reordering did not automatically update the preview');
    assert(reordered.src !== originalUrl, 'Reordering retained the stale PDF URL');
    assert(!previewBlobs.has(rawPreviewUrl(originalUrl)), 'Reordering did not release the old PDF URL');
    await click('Open preview');
    const full = await renderedPreview('.package-full-pdf');
    assert(full.src === reordered.src, 'Expanded preview must use the same composed PDF URL');
    assert(full.getBoundingClientRect().height > 0, 'Expanded native PDF preview is hidden');
    await click('Close preview'); await renderedPreview();
    await click('Download PDF'); assert((await local.listArchives(applicationId)).length === 0, 'Downloading unexpectedly created a frozen archive');
    stage('Package bytes, native PDF URLs and controls below the preview stay in sync');
    const backup = await local.exportBackup();
    await local.removeDocument(first.id); window.dispatchEvent(new Event('cv-local-documents-updated')); await settle();
    assert(current().textContent?.includes('unavailable on this device'), 'Missing selected file was not reported');
    const downloadButton = [...current().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Download PDF');
    assert(downloadButton?.disabled && !documents.composition, 'Missing file did not block package export');
    assert(!current().querySelector('.package-inline-pdf'), 'Missing file retained the stale PDF iframe');
    await click('CV Studio · Local attachments', root);
    assert(current().querySelector('[role="img"][aria-label="File missing on this device"]') && fixture.rows.length === 2, 'Missing local file incorrectly removed its cloud metadata');
    stage('Missing files remain explicit and block export while metadata stays available');
    await local.importBackup(backup); window.dispatchEvent(new Event('cv-local-documents-updated')); await settle();
    await click('PDF review', root); assert(documents.composition, 'Restored files did not restore the automatic preview'); await renderedPreview();
    status.textContent = '4/4 attachment checks passed'; document.body.dataset.result = 'passed';
  } catch (reason) {
    const item = document.createElement('li'); item.dataset.result = 'fail'; item.textContent = `FAIL: ${reason instanceof Error ? reason.message : String(reason)}`; results.append(item);
    status.textContent = 'Attachment workflow failed'; document.body.dataset.result = 'failed';
  } finally { runButton.disabled = false; }
});
