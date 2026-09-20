import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';

const filename = new URL('../src/components/OpportunityContext.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'opportunity-context-labels', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), exports);

type HostNode = { tag?: string; text?: string; props: Record<string, unknown>; parent?: HostNode; children: HostNode[] };
function mountContext() {
  const nodes: HostNode[] = [];
  const createNode = (tag?: string, text?: string): HostNode => {
    const node: HostNode = { tag, text, props: {}, children: [] };
    nodes.push(node);
    return node;
  };
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: (tag) => createNode(tag), createText: (text) => createNode(undefined, text), createComment: () => createNode(),
    insert(node, parent) { node.parent = parent; parent.children.push(node); },
    remove(node) { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); },
    setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    parentNode: (node) => node.parent || null, nextSibling: () => null,
  });
  const context = { requirements: ['Relevant MSc', { requirement: 'Programming', details: ['Python', 'C++'], url: 'https://example.org/requirements' }], required_documents: ['CV', 'https://example.org/transcript-template'] };
  const changes: { key: string; completed: boolean }[] = [];
  const props = reactive({ context, lang: 'en', checklist: true, completedKeys: [] as string[], saving: false });
  const app = renderer.createApp({ render: () => h('main', [
    h(exports.default!, { ...props, onToggleChecklist: (key: string, completed: boolean) => changes.push({ key, completed }) }),
    h(exports.default!, { ...props }),
  ]) });
  app.mount(createNode('root'));
  return { nodes, changes, props, unmount: () => app.unmount() };
}

test('checklist labels identify their own inputs across repeated contexts and preserve external links', async (t) => {
  const context = mountContext();
  t.after(context.unmount);
  const inputs = context.nodes.filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
  const labels = context.nodes.filter((node) => node.tag === 'label');
  assert.equal(inputs.length, 8);
  assert.equal(new Set(inputs.map((node) => node.props.id)).size, inputs.length, 'duplicate displayed contexts must not share control IDs');
  assert.ok(labels.length > inputs.length, 'nested requirement details also label the parent checkbox');
  for (const label of labels) assert.equal(inputs.filter((node) => node.props.id === label.props.for).length, 1);
  for (const input of inputs) assert.ok(labels.some((node) => node.props.for === input.props.id), 'every checkbox has an associated visible label, including link-only entries');
  const mscLabel = labels.find((node) => node.text === 'Relevant MSc')!;
  const mscInput = inputs.find((node) => node.props.id === mscLabel.props.for)!;
  const programmingLabel = labels.find((node) => node.text === 'Programming: ')!;
  assert.equal(labels.find((node) => node.text === 'Python')?.props.for, programmingLabel.props.for);
  assert.equal(labels.find((node) => node.text === 'C++')?.props.for, programmingLabel.props.for);

  for (const link of context.nodes.filter((node) => node.tag === 'a')) {
    assert.ok(['https://example.org/requirements', 'https://example.org/transcript-template'].includes(String(link.props.href)));
    assert.equal(link.props.target, '_blank');
    for (let ancestor: HostNode | undefined = link; ancestor; ancestor = ancestor.parent) {
      assert.notEqual(ancestor.tag, 'label', 'links are independent interactive elements');
      assert.equal(ancestor.props.onClick, undefined, 'checklist row does not intercept external-link clicks');
    }
  }
  const target = { checked: true };
  (mscInput.props.onChange as (event: unknown) => void)({ target });
  assert.equal(context.changes.length, 1);
  assert.equal(context.changes[0].completed, true);
  assert.equal(target.checked, false, 'checkbox keeps saved state until the parent acknowledges the change');
  context.props.completedKeys = [context.changes[0].key];
  context.props.saving = true;
  await nextTick();
  assert.equal(mscInput.props.checked, true);
  assert.equal(mscInput.props.disabled, true);
});
