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
      getCvPdf: async () => generated, getLetterPdf: async () => generated, onOpenLibrary: () => { view.value = 'library'; },
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
  control.value = id; control.dispatchEvent(new Event('change', { bubbles: true })); await settle(); await click('Add'); assert(!documents.error, documents.error);
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
    stage('Preparation selects reusable attachments and retains both descriptions');
    await click('PDF review', root); await click('Preview complete PDF'); assert(!documents.error, documents.error);
    const frame = current().querySelector<HTMLIFrameElement>('iframe.package-inline-pdf'); assert(frame?.src, 'Combined PDF preview missing');
    assert(documents.composition?.blob, 'Composed PDF bytes missing');
    const composed = await PDFDocument.load(await documents.composition.blob.arrayBuffer());
    assert(composed.getPageCount() === 4 && composed.getPages().slice(-2).map(page => page.getWidth()).join(',') === '510,610', 'Export did not use the exact two selected local PDFs');
    stage('The existing renderer composes selected original PDFs in package order');
    await local.removeDocument(first.id); window.dispatchEvent(new Event('cv-local-documents-updated')); await settle();
    assert(current().textContent?.includes('unavailable on this device'), 'Missing selected file was not reported');
    const previewButton = [...current().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Preview complete PDF');
    assert(previewButton?.disabled, 'Missing file did not block package export');
    await click('CV Studio · Local attachments', root);
    assert(current().textContent?.includes('File missing on this device') && fixture.rows.length === 2, 'Missing local file incorrectly removed its cloud metadata');
    stage('Missing files remain explicit and block export while metadata stays available');
    status.textContent = '4/4 attachment checks passed'; document.body.dataset.result = 'passed';
  } catch (reason) {
    const item = document.createElement('li'); item.dataset.result = 'fail'; item.textContent = `FAIL: ${reason instanceof Error ? reason.message : String(reason)}`; results.append(item);
    status.textContent = 'Attachment workflow failed'; document.body.dataset.result = 'failed';
  } finally { runButton.disabled = false; }
});
