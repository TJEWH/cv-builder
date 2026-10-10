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
  let typing = false;
  let commitInput = () => {};
  const exports: { useDocumentPdfPreview?: typeof useDocumentPdfPreview } = {};
  new Function('require', 'exports', sourceCode)((path: string) => path === './usePdfExport' ? {
    usePdfExport: () => ({ ...mock, revokeDownloads: () => { revoked++; }, exportToPdf: async () => {} }),
  } : path === './usePreviewInputCommit' ? {
    usePreviewInputCommit: (commit: () => void) => { commitInput = commit; return { defer: () => typing, reset() {} }; },
  } : requireFromSource(path), exports);
  const active = ref(false);
  const version = ref(1);
  const identity = ref('original');
  let sourceReads = 0;
  let preview!: Preview;
  const app = renderer.createApp({
    setup() {
      preview = exports.useDocumentPdfPreview!({
        source: async () => { sourceReads++; return {} as HTMLElement; }, options: () => ({ margin: [10, 10, 10, 10] }),
        signature: () => version.value, active: () => active.value,
        identity: () => [identity.value],
      });
      return () => null;
    },
  });
  app.mount({});
  return { preview, active, version, identity, setTyping: (value: boolean) => { typing = value; }, commitInput: () => commitInput(), unmount: () => app.unmount(), sourceReads: () => sourceReads, revoked: () => revoked };
}

test('typing preserves the current PDF until commit, while a source switch still clears it immediately', async t => {
  let renders = 0;
  const fixture = mountPreview({ renderPreview: async () => ({ pages: [samplePage(`render-${++renders}`)] }) });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  fixture.setTyping(true);
  fixture.version.value++;
  fixture.version.value++;
  await settle();
  assert.equal(renders, 1);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-1');
  assert.equal(fixture.preview.busy.value, false);
  fixture.commitInput();
  await settle();
  assert.equal(renders, 2);
  assert.equal(fixture.preview.pages.value[0]?.svg, 'render-2');
  fixture.identity.value = 'proposal';
  fixture.version.value++;
  assert.deepEqual(fixture.preview.pages.value, []);
  await settle();
  assert.equal(renders, 2, 'further typing still waits, but cannot retain a different source');
  fixture.commitInput();
  await settle();
  assert.equal(renders, 3);
});

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
  assert.deepEqual(fixture.preview.pages.value, [], 'switching sources immediately removes previously rendered pages from every surface');
  await nextTick(); await settle();
  fixture.active.value = false;
  await nextTick();
  assert.equal(renders[2].signal.aborted, true);
  assert.equal(fixture.preview.busy.value, false);
});

test('a failed replacement preview cannot display the previous document as the new source', async (t) => {
  let fail = false;
  const fixture = mountPreview({ renderPreview: async () => {
    if (fail) throw new Error('The proposed document cannot be rendered.');
    return { pages: [samplePage('original')] };
  } });
  t.after(fixture.unmount);
  fixture.active.value = true;
  await settle();
  assert.equal(fixture.preview.pages.value[0]?.svg, 'original');
  fail = true;
  fixture.version.value++;
  assert.deepEqual(fixture.preview.pages.value, []);
  await settle();
  assert.deepEqual(fixture.preview.pages.value, []);
  assert.match(fixture.preview.error.value, /proposed document cannot be rendered/);
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

test('opening then closing a proposal while an export awaits its DOM source permanently cancels that export', async t => {
  let finishSource!: (element: HTMLElement) => void;
  let renders = 0;
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: async () => { renders++; return new Blob(['unaccepted proposal']); },
  });
  t.after(fixture.unmount);
  const exported = fixture.preview.getPdfBlob(() => new Promise(resolve => { finishSource = resolve; }));
  fixture.version.value = 2;
  fixture.version.value = 1;
  finishSource({} as HTMLElement);
  await assert.rejects(exported, { name: 'AbortError' });
  assert.equal(renders, 0, 'the canceled export never renders the temporary proposal DOM');
});

for (const change of ['source', 'activation'] as const) test(`${change} changes cancel an in-flight PDF even when the renderer completes after cancellation`, async t => {
  let finishRender!: (blob: Blob) => void;
  let signal!: AbortSignal;
  const fixture = mountPreview({
    renderPreview: async () => ({ pages: [] }),
    renderPdfBlob: (_element, options) => new Promise(resolve => { signal = options.signal!; finishRender = resolve; }),
  });
  t.after(fixture.unmount);
  const exported = fixture.preview.getPdfBlob();
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  if (change === 'source') { fixture.version.value = 2; fixture.version.value = 1; }
  else { fixture.active.value = true; fixture.active.value = false; }
  assert.equal(signal.aborted, true, 'the source watcher invalidates exports synchronously');
  finishRender(new Blob(['stale PDF']));
  await assert.rejects(exported, { name: 'AbortError' });
});
