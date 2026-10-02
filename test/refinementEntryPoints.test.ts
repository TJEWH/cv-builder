import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer } from 'vue';
import type { Component } from 'vue';

for (const [name, scope] of [['CvAdjustmentWorkflow', 'cv'], ['MotivationLetterEditor', 'letter']]) {
  test(`${name} routes into shared refinement without forms, storage or publication`, () => {
    const filename = new URL(`../src/components/${name}.vue`, import.meta.url);
    const { descriptor } = parse(readFileSync(filename, 'utf8'));
    assert.doesNotMatch(descriptor.template!.content, /<(?:input|select|textarea|form)\b/);
    const compiled = compileScript(descriptor, { id: name, inlineTemplate: true });
    const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: { default?: Component } = {};
    new Function('require', 'exports', code)(createRequire(filename), exports);
    type Node = { props: Record<string, unknown> };
    let button: Node | undefined;
    const renderer = createRenderer<Node, Node>({ createElement: () => button = { props: {} }, createText: () => ({ props: {} }), createComment: () => ({ props: {} }), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp(node, key, _previous, value) { node.props[key] = value; }, parentNode: () => null, nextSibling: () => null });
    const scopes: string[] = [];
    const app = renderer.createApp(exports.default!, { lang: 'en', disabled: false, onRefine: (scope: string) => scopes.push(scope) });
    app.mount({ props: {} });
    assert.deepEqual(scopes, []);
    (button!.props.onClick as () => void)();
    assert.deepEqual(scopes, [scope]);
    app.unmount();
  });
}
