import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, type Component } from 'vue';
import type { CvState } from '../src/types';
import type { ApplicationLetter } from '../src/letterTypes';
import type { LocalRefinementRequest, RefinementFeedback, RefinementProposalRow, RefinementRequestRow } from '../src/refinementTypes';
import { type ApplicationCvRecord } from '../src/composables/applicationCv';
import { createSyntheticRefinementWorkspace } from './refinementFixture';

export const account = '90000000-0000-4000-8000-000000000001';
export const applicationId = '10000000-0000-4000-8000-000000000001';
export const refinementKey = `CV_REFINEMENT:1:${account}:${applicationId}`;
export interface Workspace {
  record: ApplicationCvRecord | null; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; error: string; saveError: string;
  selectedCvId: string; selectedTemplateId: string; selectedProposalId: string;
  importedProposals: RefinementProposalRow[];
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; localRequests: Record<string, LocalRefinementRequest>;
  selectedChangeIds: string[]; includeProposedLetter: boolean; reviewActive: boolean;
  previewCvState: CvState | null; previewLetterContent: ApplicationLetter['working'] | undefined;
  previewLetterCvState: CvState | null; reviewComparison: 'original' | 'proposed';
  temporaryReview: { error: string }; proposalAlreadyApplied: boolean; baselineSignature: string;
  preview: { getPdfBlob(): Promise<Blob> } | null; letterPreview: { getPdfBlob(): Promise<Blob> } | null;
  getCvPdf(): Promise<Blob>; getLetterPdf(): Promise<Blob>;
  saveAnnotation(id: string, status: 'open' | 'resolved' | 'dismissed', response: string, previousReviewId: string | null): Promise<boolean>;
  includeAnnotationFeedback(id: string): Promise<void>; feedbackHistory(): RefinementFeedback[];
  proposalAnnotations: { annotation: { id: string }; status: string; response: string | null; reviewId: string | null; included: boolean }[];
  reviewAcceptanceError: string; letterText: string;
  selectCv(id: string): Promise<void>; selectLetterTemplate(id: string): Promise<void>; publishSources(): Promise<void>; copyTask(): Promise<void>; connectedPrompt(): Promise<void>; checkProposals(): Promise<void>;
  openProposal(): void; discardReview(): void; acceptSelectedChanges(): Promise<void>;
  persist(): void;
  feedbackScope: 'cv' | 'letter' | 'both'; pane: 'cv' | 'letter'; tab: string; historyOpen: boolean;
  selectReviewProposal(id: string): void;
  approve(kind: 'cv' | 'letter', reopen?: boolean): Promise<void>;
  updateLetter(value: string): void; toggleProposedChange(id: string, included: boolean): void;
}

const filename = new URL('../src/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'refinement-workflow' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
  : path === '../lib/supabase' ? { supabaseConfiguration: { status: 'ready', url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }
    : requireComponent(path), componentExports);
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });

export async function idle(workspace: Workspace) {
  for (let index = 0; index < 40; index++) {
    await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
    if (!workspace.busy && !workspace.refreshing) return;
  }
  assert.fail('Refinement workspace did not become idle.');
}

export function mount(t: TestContext, source?: CvState) {
  let unmount = () => {};
  t.after(() => unmount());
  const fixture = createSyntheticRefinementWorkspace(source);
  const { storage, props } = fixture;
  for (const [key, value] of Object.entries({ localStorage: storage, sessionStorage: storage,
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard: { writeText: async () => {} } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const component = { ...componentExports.default, render: () => null };
  function open() {
    let mounted: unknown;
    const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
    app.mount({}); unmount = () => app.unmount();
    return (mounted as { $: { setupState: Workspace } }).$.setupState;
  }
  const setup = open();
  return { ...fixture, setup, close() { unmount(); }, reopen() { unmount(); return open(); } };
}

export async function prepare(fixture: ReturnType<typeof mount>, sourceId = 'base', options: { letterText?: string; scope?: 'cv' | 'letter' | 'both' } = {}) {
  const { setup } = fixture;
  await idle(setup);
  await setup.selectCv(sourceId); await idle(setup); await setup.selectLetterTemplate('research');
  setup.updateLetter(options.letterText ?? 'Original private working letter.');
  setup.feedbackScope = options.scope ?? 'both'; await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  return setup;
}
export const documents = (setup: Workspace) => JSON.stringify({ record: setup.record, letter: setup.letter });

// Existing local proposal records remain readable after the manual-import UI is removed.
export async function loadHistoricalProposal(setup: Workspace, row: RefinementProposalRow) {
  setup.importedProposals.push(row); setup.persist();
  await setup.checkProposals(); await idle(setup);
}
