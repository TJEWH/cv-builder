import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue';
import type { Component } from 'vue';
import { createSampleDocument } from '../src/composables/builtinConfigurations';

interface Node { tag: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null }
const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [], parent: null });
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _old, value) { child.props[key] = value; }, parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const find = (root: Node, predicate: (value: Node) => boolean): Node[] => [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => find(child, predicate))];
const content = (root: Node): string => root.tag === '#comment' ? '' : root.text + root.children.map(content).join('');
function compile(filename: string, replacements: Record<string, unknown> = {}) {
  const url = new URL('../src/components/' + filename, import.meta.url);
  const script = compileScript(parse(readFileSync(url, 'utf8')).descriptor, { id: filename, inlineTemplate: true });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result: { default?: Component } = {};
  const require = createRequire(url);
  new Function('require', 'exports', code)((name: string) => replacements[name] ?? (name.endsWith('.vue') ? { default: { render: () => null } } : require(name)), result);
  return result.default!;
}
const Status = compile('RefinementPreviewStatus.vue', {
  './RefinementComparisonToggle.vue': { default: compile('RefinementComparisonToggle.vue') },
});
const surface = (name: string) => ({ default: defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) { return () => h('section', { 'data-surface': name, pages: attrs.pages }, slots.header?.()); },
}) });
const Preview = {
  useDocumentPdfPreview: () => ({ pages: ref([{ svg: 'current shared PDF' }]), page: ref(1), busy: ref(false), downloading: ref(false), error: ref(''), getPdfBlob: async () => new Blob(), download: async () => {} }),
};

for (const document of ['CV', 'letter'] as const) test(`${document} inline and expanded surfaces share reactive comparison labels and controls`, async t => {
  const Document = compile(document === 'CV' ? 'DocumentCvPreview.vue' : 'MotivationLetterPreview.vue', {
    './InlineDocumentPreview.vue': surface('inline'), './FullDocumentPreview.vue': surface('expanded'),
    '../composables/useDocumentPdfPreview': Preview,
    '../composables/useCvDesign': { applyCvDesign() {} },
  });
  const comparison = ref<'original' | 'proposed'>('proposed'), outdated = ref(false), reference = ref('proposal-one · saved timestamp');
  const state = createSampleDocument();
  const props = document === 'CV' ? { state, active: false } : { cvState: state, content: { subject: '', salutation: '', body: 'Proposed letter', closing: '' }, active: false };
  const root = node('root');
  const app = renderer.createApp({ render: () => h(Document, props, { default: () => h(Status, {
    modelValue: comparison.value, label: comparison.value === 'proposed' ? 'Proposed refinement — not yet accepted' : 'Original source snapshot',
    reference: reference.value, outdated: outdated.value, lang: 'en',
    'onUpdate:modelValue': (value: 'original' | 'proposed') => { comparison.value = value; },
  }) }) });
  app.mount(root); t.after(() => app.unmount());
  const surfaces = find(root, child => !!child.props['data-surface']);
  assert.equal(surfaces.length, 2);
  assert.equal(surfaces[0].props.pages, surfaces[1].props.pages, 'inline and expanded receive the same rendered pages');
  for (const element of surfaces) {
    assert.match(content(element), /Proposed refinement — not yet accepted/);
    assert.match(content(element), /proposal-one/);
  }
  const original = find(surfaces[1], child => child.tag === 'button' && content(child) === 'Original')[0];
  assert.ok(original, 'the expanded preview offers the Original toggle');
  (original.props.onClick as () => void)();
  await nextTick();
  for (const element of surfaces) {
    assert.match(content(element), /Original source snapshot/);
    assert.equal(find(element, child => child.tag === 'button' && content(child) === 'Original')[0].props['aria-pressed'], true);
  }
  comparison.value = 'proposed'; reference.value = 'proposal-two · later timestamp'; outdated.value = true;
  await nextTick();
  for (const element of surfaces) {
    assert.match(content(element), /proposal-two/);
    assert.doesNotMatch(content(element), /proposal-one/);
    assert.match(content(element), /Outdated — acceptance blocked/);
    assert.match(content(element), /Proposed refinement — not yet accepted/);
  }
});
