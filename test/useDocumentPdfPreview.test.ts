import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createRenderer, nextTick, ref } from 'vue';
import type { PreviewPage, RenderOptions } from '../src/pdfTypes';
import type { useDocumentPdfPreview } from '../src/composables/useDocumentPdfPreview';

type Preview = ReturnType<typeof useDocumentPdfPreview>;
const filename = new URL('../src/composables/useDocumentPdfPreview.ts', import.meta.url);
const sourceCode = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireFromSource = createRequire(filename);
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 190));
const samplePage = (svg: string): PreviewPage => ({ svg, sourceTop: 0, sourceBottom: 100, canvasWidth: 100, contentWidth: 100, leftOffset: 0, topOffset: 0 });
function mountPreview(mock: {
  renderPreview: (_element: HTMLElement, options: RenderOptions) => Promise<{ pages: PreviewPage[] }>;
  renderPdfBlob?: (_element: HTMLElement, options: RenderOptions) => Promise<Blob>;
}) {
  let revoked = 0;
  const exports: { useDocumentPdfPreview?: typeof useDocumentPdfPreview } = {};
  new Function('require', 'exports', sourceCode)((path: string) => path === './usePdfExport' ? {
    usePdfExport: () => ({ ...mock, revokeDownloads: () => { revoked++; }, exportToPdf: async () => {} }),
  } : requireFromSource(path), exports);
  const active = ref(false);
  const version = ref(1);
  let sourceReads = 0;
  let preview!: Preview;
  const app = renderer.createApp({
    setup() {
      preview = exports.useDocumentPdfPreview!({
        source: async () => { sourceReads++; return {} as HTMLElement; }, options: () => ({ margin: [10, 10, 10, 10] }),
        signature: () => version.value, active: () => active.value,
      });
      return () => null;
    },
  });
  app.mount({});
  return { preview, active, version, unmount: () => app.unmount(), sourceReads: () => sourceReads, revoked: () => revoked };
}

test('document previews cancel stale renders and stop work when their tab is hidden', async (t) => {
  const renders: { signal: AbortSignal; finish: (value: { pages: PreviewPage[] }) => void }[] = [];
  const fixture = mountPreview({ renderPreview: (_element, { signal }) => new Promise((finish) => { renders.push({ signal: signal!, finish }); }) });
  t.after(fixture.unmount);
  await settle();
  assert.equal(fixture.sourceReads(), 0, 'hidden documents keep their source but do not render previews');
  fixture.active.value = true;
  await nextTick(); await settle();
  assert.equal(renders.length, 1);
  fixture.version.value++;
  await nextTick();
  assert.equal(renders[0].signal.aborted, true);
  renders[0].finish({ pages: [samplePage('stale')] });
  await settle();
  assert.equal(renders.length, 2);
  assert.deepEqual(fixture.preview.pages.value, [], 'a canceled render cannot publish private stale pages');
  renders[1].finish({ pages: [samplePage('current')] });
  await Promise.resolve(); await nextTick();
  assert.equal((fixture.preview.pages.value as PreviewPage[])[0].svg, 'current');
  assert.equal(fixture.preview.busy.value, false);
  fixture.version.value++;
  await nextTick(); await settle();
  fixture.active.value = false;
  await nextTick();
  assert.equal(renders[2].signal.aborted, true);
  assert.equal(fixture.preview.busy.value, false);
});

test('hidden document sources still export for a package and dispose pending exports on unmount', async () => {
  const pending: { signal: AbortSignal; finish: (value: Blob) => void }[] = [];
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: (_element, { signal }) => new Promise((finish, reject) => {
      pending.push({ signal: signal!, finish });
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }),
  });
  const exported = fixture.preview.getPdfBlob();
  await Promise.resolve();
  assert.equal(pending.length, 1);
  const pdf = new Blob(['pdf']);
  pending[0].finish(pdf);
  assert.equal(await exported, pdf);
  const canceled = fixture.preview.getPdfBlob();
  await Promise.resolve();
  fixture.unmount();
  await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(pending[0].signal.aborted, false, 'completed exports release their controller');
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(fixture.revoked(), 1);
});
