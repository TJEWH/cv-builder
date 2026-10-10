import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { createSampleDocument } from '../src/composables/builtinConfigurations';
import type { CustomSection } from '../src/types';

function loadComponent(name: string, inlineTemplate = false): Component {
  const filename = new URL(`../src/components/${name}.vue`, import.meta.url);
  const script = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: name, inlineTemplate });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: Component } = {};
  const requireComponent = createRequire(filename);
  new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), exports);
  return inlineTemplate ? exports.default! : { ...exports.default, render: () => null };
}

type Node = { tag?: string; text?: string; props: Record<string, unknown>; children: Node[]; parent?: Node };
const node = (tag?: string, text?: string): Node => ({ tag, text, props: {}, children: [] });
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: () => node(),
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(node, value) { node.text = value; }, setElementText(node, value) { node.text = value; },
  patchProp(node, key, _previous, value) { node.props[key] = value; },
  parentNode: node => node.parent || null, nextSibling: () => null,
});
const FormBuilder = loadComponent('FormBuilder');
const SectionHeading = loadComponent('SectionHeading', true);
const SectionList = loadComponent('SectionList');

interface EditorSetup {
  activeContentTab: string;
  reorderMode: boolean;
  configMode: boolean;
  editingSection: { id: string | null; value: string };
  fieldConfigSectionId: string | null;
  fieldConfigDialog: { open: boolean; showModal(): void; close(): void } | null;
  onContentTabKeydown(event: KeyboardEvent, tab: string): void;
  toggleCollapsed(key: string): void;
  isCollapsed(key: string): boolean;
  openFieldConfig(section: CustomSection): void;
  closeFieldConfig(): void;
  startEditSectionName(key: string): void;
  finishEditSectionName(key: string, restoreFocus?: boolean): void;
  cancelEditSectionName(restoreFocus?: boolean): void;
  getSectionDisplayName(key: string): string;
  sectionContentId(key: string): string;
}
function mountEditor(t: TestContext) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  let mounted: unknown;
  const state = createSampleDocument();
  const app = renderer.createApp({ render: () => h(FormBuilder, {
    state, readVersion: () => null, saveVersion: () => true,
    ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount(node('root'));
  t.after(() => {
    app.unmount();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return (mounted as { $: { setupState: EditorSetup } }).$.setupState;
}

test('content tabs support arrow wrapping and Home/End without changing document data', t => {
  const editor = mountEditor(t);
  const focused: string[] = [];
  let prevented = 0;
  const press = (key: string) => editor.onContentTabKeydown({
    key, preventDefault() { prevented++; },
    currentTarget: { parentElement: { querySelector: (selector: string) => ({ focus() { focused.push(selector); } }) } },
  } as unknown as KeyboardEvent, editor.activeContentTab);
  assert.equal(editor.activeContentTab, 'body');
  press('ArrowRight'); assert.equal(editor.activeContentTab, 'sidebar');
  editor.reorderMode = true;
  press('ArrowRight'); assert.equal(editor.activeContentTab, 'header');
  assert.equal(editor.reorderMode, false, 'header has no sortable sections');
  press('ArrowLeft'); assert.equal(editor.activeContentTab, 'sidebar');
  press('Home'); assert.equal(editor.activeContentTab, 'header');
  press('End'); assert.equal(editor.activeContentTab, 'sidebar');
  press('Tab'); assert.equal(editor.activeContentTab, 'sidebar');
  assert.equal(prevented, 5, 'ordinary Tab navigation is not intercepted');
  assert.deepEqual(focused, ['sidebar', 'header', 'sidebar', 'header', 'sidebar'].map(value => `[data-content-tab="${value}"]`));
});

test('section activation expands normally and does not collapse sortable items during reorder', t => {
  const editor = mountEditor(t);
  assert.equal(editor.isCollapsed('education'), true);
  editor.toggleCollapsed('education'); assert.equal(editor.isCollapsed('education'), false);
  editor.toggleCollapsed('education'); assert.equal(editor.isCollapsed('education'), true);
  editor.reorderMode = true;
  assert.equal(editor.isCollapsed('education'), false);
  editor.toggleCollapsed('education');
  editor.reorderMode = false;
  assert.equal(editor.isCollapsed('education'), true, 'reordering preserves the previous collapsed state');
});

test('field configuration uses native modal lifecycle and a cancelled opening never reopens it', async t => {
  const editor = mountEditor(t);
  let opened = 0;
  let closed = 0;
  const dialog = { open: false, showModal() { this.open = true; opened++; }, close() { this.open = false; closed++; } };
  editor.fieldConfigDialog = dialog;
  const section: CustomSection = { id: 'custom', name: 'Research', fields: ['title'], entries: [], entryMode: 'fields' };
  editor.openFieldConfig(section);
  await nextTick(); await nextTick();
  assert.equal(opened, 1);
  assert.equal(dialog.open, true);
  editor.closeFieldConfig();
  assert.equal(closed, 1);
  assert.equal(editor.fieldConfigSectionId, null);
  await nextTick();
  editor.openFieldConfig(section);
  editor.closeFieldConfig();
  await nextTick(); await nextTick();
  assert.equal(opened, 1, 'a pending open cannot defeat a close');
});

test('keyboard rename focuses its input, restores the heading, and Escape preserves saved text', async t => {
  const editor = mountEditor(t);
  const focused: string[] = [];
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: (selector: string) => ({ focus() { focused.push(selector); } }),
    getElementById: (id: string) => ({ focus() { focused.push(id); } }),
  } });
  t.after(() => previousDocument ? Object.defineProperty(globalThis, 'document', previousDocument) : Reflect.deleteProperty(globalThis, 'document'));
  editor.configMode = true;
  editor.startEditSectionName('about');
  await nextTick(); await nextTick();
  assert.equal(focused.at(-1), '.section-name-input');
  const title = 'Research 研究 🔬 '.repeat(12);
  editor.editingSection.value = title;
  editor.finishEditSectionName('about', true);
  await nextTick();
  assert.equal(editor.getSectionDisplayName('about'), title.trim());
  assert.equal(focused.at(-1), `${editor.sectionContentId('about')}-heading`);
  editor.startEditSectionName('about');
  await nextTick(); await nextTick();
  editor.editingSection.value = 'Discard this title';
  editor.cancelEditSectionName(true);
  await nextTick();
  assert.equal(editor.getSectionDisplayName('about'), title.trim());
  assert.equal(focused.at(-1), `${editor.sectionContentId('about')}-heading`);
});

test('section headings expose native collapse buttons and separate rename from expansion in Config', async t => {
  const root = node('root');
  const events: string[] = [];
  const props = reactive({ title: 'Research 研究 🔬', collapsed: true, controls: 'research-content', editing: false, editLabel: 'Rename section', disabled: false });
  const app = renderer.createApp({ render: () => h(SectionHeading, {
    ...props, onActivate: () => events.push('activate'), onToggleCollapse: () => events.push('collapse'),
  }) });
  app.component('font-awesome-icon', { render: () => h('svg') });
  app.mount(root); t.after(() => app.unmount());
  const buttons = () => root.children.find(child => child.tag === 'h3')!.children.filter(child => child.tag === 'button');
  assert.equal(buttons().length, 1);
  assert.equal(buttons()[0]!.props.type, 'button');
  assert.equal(buttons()[0]!.props['aria-expanded'], false);
  assert.equal(buttons()[0]!.props['aria-controls'], 'research-content');
  const activate = (button: Node) => (button.props.onClick as (event: unknown) => void)({ stopPropagation() {} });
  activate(buttons()[0]!); assert.deepEqual(events, ['activate']);
  props.editing = true; props.collapsed = false; await nextTick();
  const collapse = buttons().find(button => button.props['aria-controls'] === 'research-content')!;
  const rename = buttons().find(button => button.props['aria-label'] === 'Rename section: Research 研究 🔬')!;
  assert.equal(collapse.props['aria-expanded'], true);
  assert.equal(rename.props['aria-expanded'], undefined);
  activate(collapse); activate(rename);
  assert.deepEqual(events, ['activate', 'collapse', 'activate']);
  props.disabled = true; await nextTick();
  assert.equal(buttons().length, 0, 'reorder mode exposes only its dedicated move control');
});

test('adding to an empty section focuses its first field and respects reduced motion', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: true }) } });
  const props = reactive({ modelValue: [] as Record<string, unknown>[], schema: [{ key: 'title', type: 'text', label: 'Title' }, { key: 'desc', type: 'textarea', label: 'Description' }], lang: 'en', sectionKey: 'research' });
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(SectionList, {
    ...props, 'onUpdate:modelValue': (items: Record<string, unknown>[]) => { props.modelValue = items; },
    ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount(node('root'));
  t.after(() => {
    app.unmount();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  let focused = 0;
  const scrolls: ScrollIntoViewOptions[] = [];
  const setup = (mounted as { $: { setupState: { root: unknown; add(): void } } }).$.setupState;
  setup.root = { querySelector: () => ({ querySelector: () => ({ focus() { focused++; } }), scrollIntoView(options: ScrollIntoViewOptions) { scrolls.push(options); } }) };
  setup.add(); await nextTick();
  assert.equal(props.modelValue.length, 1);
  assert.equal(props.modelValue[0]!.title, '');
  assert.equal(props.modelValue[0]!.desc, '');
  assert.equal(focused, 1);
  assert.deepEqual(scrolls, [{ behavior: 'auto', block: 'nearest' }]);
});
