/** Synthetic refinement backend shared by component tests and the dev-only browser fixture. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RefinementRequest, RefinementProposal } from '../src/refinementTypes';
import type { CvOperation } from '../src/cvStructuredTypes';
import { parseRefinementProposal, refinementSignature } from '../src/composables/applicationRefinement';
import { IDENTITY_PLACEHOLDERS } from '../src/composables/identityRedaction';
import { reactive } from 'vue';
import type { Application } from '../src/cloudTypes';
import type { CvState, SavedConfiguration } from '../src/types';
import { createEmptyDocument, createSampleDocument } from '../src/composables/builtinConfigurations';
import { cloneCv } from '../src/composables/applicationCv';
import { createCloudCvSnapshot } from '../src/composables/cloudCvPrivacy';
import { subvariantParent } from '../src/composables/careerVariants';

type Row = Record<string, unknown>;
export const REFINEMENT_TABLES = ['application_refinement_state', 'application_refinement_requests', 'application_refinement_proposals', 'application_refinement_reviews'] as const;
export function createRefinementFixture(database: Record<string, Row[]>, account: string) {
  for (const table of REFINEMENT_TABLES) database[table] ||= [];
  let timestamp = Date.now();
  const now = () => new Date(++timestamp).toISOString();
  const clone = <T>(value: T): T => structuredClone(value);
  const same = (left: unknown, right: unknown) => refinementSignature(left) === refinementSignature(right);
  const appFor = (id: unknown) => {
    const app = database.applications.find(row => row.id === id && row.user_id === account);
    if (!app) throw new Error('Missing fixture application.');
    return app;
  };
  const stateFor = (id: unknown) => database.application_refinement_state.find(row => row.application_id === id && row.user_id === account);
  function from(table: string) {
    const filters: [string, unknown][] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    let one = false; let page: [number, number] | null = null;
    const builder = {
      select() { return builder; },
      range(from: number, to: number) { page = [from, to]; return builder; },
      eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
      order(key: string, options: { ascending?: boolean } = {}) { orders.push({ key, ascending: options.ascending !== false }); return builder; },
      maybeSingle() { one = true; return builder; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve().then(() => {
          const rows = (database[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
          rows.sort((a, b) => {
            for (const order of orders) { const compared = String(a[order.key] ?? '').localeCompare(String(b[order.key] ?? '')); if (compared) return compared * (order.ascending ? 1 : -1); }
            return 0;
          });
          return { data: clone(one ? rows[0] || null : page ? rows.slice(page[0], page[1] + 1) : rows), error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  }
  function rpc(name: string, args: Row) {
    try {
      if (name === 'clear_refinement_history') {
        appFor(args.p_application_id);
        const state = stateFor(args.p_application_id);
        if (!Number.isInteger(args.p_expected_revision) || Number(args.p_expected_revision) < 0
          || args.p_expected_revision !== (state?.revision || 0)) throw new Error('Refinement state changed. Reload and retry.');
        if (!state) return { data: null, error: null };
        for (const table of ['application_refinement_reviews', 'application_refinement_proposals', 'application_refinement_requests']) {
          database[table] = database[table].filter(row => row.application_id !== args.p_application_id || row.user_id !== account);
        }
        Object.assign(state, { current_request_id: null, revision: Number(state.revision) + 1, updated_at: now() });
        return { data: clone(state), error: null };
      }
      if (name === 'save_refinement_state') {
        appFor(args.p_application_id);
        let state = stateFor(args.p_application_id);
        if (Number(args.p_expected_revision) !== Number(state?.revision || 0)) throw new Error('Refinement state changed. Reload and retry.');
        const incoming = args.p_approvals as Row;
        const setupChanged = state && !same(state.setup_json, args.p_setup);
        if (!state) { state = { application_id: args.p_application_id, user_id: account, current_request_id: null }; database.application_refinement_state.push(state); }
        Object.assign(state, { setup_json: clone(args.p_setup), approvals_json: clone(incoming), revision: Number(args.p_expected_revision) + 1, updated_at: now() });
        if (setupChanged) { state.current_request_id = null; (state.approvals_json as Row).letter = null; }
        return { data: clone(state), error: null };
      }
      if (name === 'publish_refinement_request') {
        const request = args.p_request as RefinementRequest;
        const app = appFor(request.applicationId);
        const existing = database.application_refinement_requests.find(row => row.id === request.requestId);
        if (existing) { if (!same(existing.request_json, request)) throw new Error('Request ID already exists with different input.'); return { data: clone(existing), error: null }; }
        const state = stateFor(request.applicationId);
        const cv = database.cv_variants.find(row => row.id === app.cv_variant_id && row.user_id === account);
        if (!state || !cv) throw new Error('Save preparation before publishing a fixture request.');
        const { text: _text, ...setup } = request.letter;
        if (!same(state.setup_json, setup)) throw new Error('Refinement settings changed.');
        const approvals = state.approvals_json as Row;
        if (approvals.cv && request.scope !== 'letter' || approvals.letter && request.scope !== 'cv') throw new Error('Reopen approved documents first.');
        const feedback = database.application_refinement_reviews.filter(row => row.application_id === app.id && row.kind === 'feedback').map(row => ({ id: row.id, ...(row.payload as Row), createdAt: row.created_at }));
        if (!same(feedback, request.feedback)) throw new Error('Include all ordered feedback in the request.');
        if (request.parentProposalId && !database.application_refinement_proposals.some(row => row.id === request.parentProposalId && row.application_id === app.id)) throw new Error('Unknown parent proposal.');
        const row = { id: request.requestId, application_id: app.id, user_id: account, request_json: clone(request), opportunity_snapshot: clone(app.context_json),
          cv_snapshot: { snapshotId: cv.id, revision: cv.revision, content: { ...clone(cv.content_json as Row), contact: { ...IDENTITY_PLACEHOLDERS } } }, created_at: now() };
        database.application_refinement_requests.push(row);
        Object.assign(state, { current_request_id: row.id, revision: Number(state.revision) + 1, updated_at: now() });
        return { data: clone(row), error: null };
      }
      if (name === 'save_refinement_review') {
        const app = appFor(args.p_application_id);
        const existing = database.application_refinement_reviews.find(row => row.id === args.p_id);
        if (existing) {
          if (existing.application_id !== app.id || existing.request_id !== args.p_request_id || existing.kind !== args.p_kind || !same(existing.payload, args.p_payload)) throw new Error('Review ID already exists with different input.');
          return { data: clone(existing), error: null };
        }
        const state = stateFor(app.id);
        if (!state) throw new Error('Save refinement settings first.');
        if (args.p_request_id && !database.application_refinement_requests.some(row => row.id === args.p_request_id && row.application_id === app.id)) throw new Error('Review request unavailable.');
        const kind = String(args.p_kind); const payload = args.p_payload as Row;
        if (kind === 'annotation' || kind === 'feedback' && payload.annotation) {
          const reference = kind === 'annotation' ? { proposalId: payload.proposalId, annotationId: payload.annotationId, reviewId: payload.previousReviewId } : payload.annotation as Row;
          const proposal = database.application_refinement_proposals.find(row => row.id === reference.proposalId && row.application_id === app.id && row.request_id === args.p_request_id);
          const content = proposal?.proposal_json as RefinementProposal | undefined;
          const annotation = content?.schemaVersion === 2 && content.annotations?.find(item => item.id === reference.annotationId);
          if (!annotation) throw new Error('Annotation unavailable.');
          const previous = [...database.application_refinement_reviews].reverse().find(row => row.kind === 'annotation' && (row.payload as Row).proposalId === reference.proposalId && (row.payload as Row).annotationId === reference.annotationId);
          if ((previous?.id || null) !== reference.reviewId) throw new Error('Annotation changed elsewhere; reload the saved annotation.');
          if (kind === 'feedback' && payload.scope !== annotation.document) throw new Error('Annotation feedback scope mismatch.');
        }
        if (kind === 'cv_decisions') {
          const proposal = database.application_refinement_proposals.find(row => row.id === payload.proposalId && row.application_id === app.id && row.request_id === args.p_request_id);
          if (!proposal || args.p_request_id !== state.current_request_id) throw new Error('CV decisions must refer to the current proposal.');
          const content = proposal.proposal_json as RefinementProposal;
          const available = content.schemaVersion === 2 ? content.cvOperations.map(operation => operation.id) : content.cvEdits.map(edit => edit.fieldId);
          const accepted = payload.accepted as string[]; const rejected = payload.rejected as string[];
          if (!Array.isArray(accepted) || !Array.isArray(rejected) || typeof payload.revision !== 'string' || !/^v1:[a-f0-9]{64}$/.test(payload.revision)
            || new Set([...accepted, ...rejected]).size !== accepted.length + rejected.length
            || !same([...accepted, ...rejected].sort(), [...available].sort())) throw new Error('CV decisions must partition the proposal changes.');
          if (accepted.length && (state.approvals_json as Row).cv) throw new Error('Reopen the approved CV before accepting changes.');
        } else if (kind === 'annotation') {
          if (!['open', 'resolved', 'ignored'].includes(String(payload.status))) throw new Error('Invalid annotation status.');
        } else if (kind !== 'feedback') {
          if (Number(payload.expectedRevision) !== state.revision) throw new Error('Refinement review is stale.');
          if (args.p_request_id !== null && args.p_request_id !== state.current_request_id) throw new Error('This request is stale; review the current documents.');
          const target = kind.endsWith('_cv') ? 'cv' : 'letter';
          (state.approvals_json as Row)[target] = kind.startsWith('approve_') ? payload.revision : null;
          state.revision = Number(state.revision) + 1; state.updated_at = now();
        } else if (!String(payload.text || '').trim() || !['both', 'cv', 'letter'].includes(String(payload.scope))) throw new Error('Invalid fixture feedback.');
        const row = { id: args.p_id, application_id: app.id, user_id: account, request_id: args.p_request_id, kind, payload: clone(payload), created_at: now() };
        database.application_refinement_reviews.push(row);
        return { data: clone(row), error: null };
      }
      throw new Error(`Unsupported fixture refinement RPC: ${name}`);
    } catch (error) { return { data: null, error }; }
  }
  function seedProposal(requestId?: string, options: { overLimit?: boolean; letterText?: string; persist?: boolean } = {}) {
    const row = requestId ? database.application_refinement_requests.find(row => row.id === requestId) : database.application_refinement_requests.at(-1);
    if (!row) throw new Error('Copy the initial or improvement prompt first.');
    const request = row.request_json as RefinementRequest;
    const field = request.cv.fields.find(field => field.label === 'Profile');
    const draft = '# Application for PhD in Human-Centred Robotics\n\nDear selection committee,\n\nI am applying to your doctoral programme because its focus on safe human–robot collaboration matches my research interests. I would welcome the opportunity to connect my documented technical experience to practical experiments and reproducible research.\n\nThe project’s combination of learning algorithms and physical experiments particularly interests me. I am motivated to investigate how robots can learn from demonstrations and contribute to careful evaluation of collaborative systems.\n\nThank you for considering my application. I would welcome a discussion about the project and my experience.\n\nKind regards,\n{{APPLICANT_NAME}}';
    const common = {
      requestId: request.requestId,
      summary: `Synthetic ${request.scope} proposal. ${request.scope === 'letter' ? 'The approved CV remains unchanged.' : 'Minor profile wording adjustment and a complete motivation letter.'} ${request.feedback.length} feedback entries considered.`,
      letterText: request.scope === 'cv' ? request.letter.text : options.letterText || (request.feedback.length && request.letter.text ? `${request.letter.text}\n\nThis revision reflects the requested improvements.` : draft),
    };
    const proposal: RefinementProposal = request.schemaVersion === 1 ? {
      ...common, schemaVersion: 1, cvEdits: request.scope === 'letter' || !field ? [] : [{ fieldId: field.id, text: `${field.text}\nI am interested in research on safe human–robot collaboration.` }],
    } : { ...common, schemaVersion: 2, cvOperations: [], cvComments: [] };
    if (request.schemaVersion === 2 && proposal.schemaVersion === 2 && request.scope !== 'letter') {
      proposal.summary = `Synthetic structured CV proposal and complete motivation letter. ${request.feedback.length} feedback entries considered.`;
      const addOperation = (operation: CvOperation) => {
        try {
          parseRefinementProposal({ ...proposal, cvOperations: [...proposal.cvOperations, operation] }, request);
          proposal.cvOperations.push(operation);
          return true;
        } catch { return false; } // A fixture candidate can be ineligible for a particular CV.
      };
      const nextId = () => `change-${proposal.cvOperations.length + 1}`;
      const area = request.cvStructure.areas.find(item => item.sectionIds.length > 1);
      if (area) addOperation({ id: nextId(), type: 'reorder_sections', targetId: area.id, order: [...area.sectionIds].reverse(), explanation: 'Bring the relevant research sections forward for review.' });
      const section = request.cvStructure.sections.find(item => item.entryIds.length > 1);
      if (section) addOperation({ id: nextId(), type: 'reorder_entries', targetId: section.id, order: [...section.entryIds].reverse(), explanation: 'Prioritize the existing experience entries relevant to this opportunity.' });
      const entry = request.cvStructure.entries.find(item => item.bulletIds.length > 1);
      if (entry) {
        addOperation({ id: nextId(), type: 'reorder_bullets', targetId: entry.id, order: [...entry.bulletIds].reverse(), explanation: 'Put the most relevant existing achievements first.' });
        addOperation({ id: nextId(), type: 'omit_bullet', targetId: entry.bulletIds.at(-1)!, explanation: 'Omit a less relevant achievement to keep this application concise.' });
      }
      const omitted = new Set(proposal.cvOperations.filter(operation => operation.type === 'omit_bullet').map(operation => operation.targetId));
      const ranges = [...request.cvStructure.ranges].sort((a, b) => Number(a.bulletId !== null) - Number(b.bulletId !== null));
      for (const range of ranges) {
        if (range.bulletId && omitted.has(range.bulletId) || /\{\{|\}\}|https?:|mailto:|\]\(/i.test(range.text)) continue;
        const firstSentence = range.text.match(/^.*?[.!?](?=\s+\S)/s)?.[0];
        const tokens = range.text.match(/\S+/g) || [];
        const shorter = firstSentence || tokens.slice(0, Math.max(1, Math.floor(tokens.length * 0.65))).join(' ');
        if (shorter.length >= range.text.length) continue;
        if (addOperation({ id: nextId(), type: 'shorten_text', targetId: range.id, text: shorter, explanation: 'Retain the key documented point while removing less relevant detail.' })) break;
      }
      const unsupported = request.cvStructure.unsupported[0];
      if (unsupported) {
        const comment = { id: 'comment-1', fieldId: unsupported.fieldId, explanation: `Manual review only: ${unsupported.reason}`.slice(0, 1000) };
        try { parseRefinementProposal({ ...proposal, cvComments: [comment] }, request); proposal.cvComments = [comment]; } catch { /* Keep unsupported fixture comments within the protocol contract. */ }
      }
    }
    if (options.overLimit && request.scope !== 'cv') proposal.letterText += '\n\n' + 'research '.repeat(request.letter.maxWords + 1);
    if (proposal.schemaVersion === 2) proposal.annotations = [
      { id: 'annotation-1', type: 'question', document: 'cv', location: field ? { fieldId: field.id } : null, text: 'Which research methods did you use? Add only details you can confirm.' },
      { id: 'annotation-2', type: 'todo', document: 'letter', location: proposal.letterText ? { start: 0, quote: [...proposal.letterText].slice(0, 30).join('') } : null, text: 'Confirm the project-specific research interest before the next round.' },
    ];
    const validated = parseRefinementProposal(proposal, request);
    const saved = { id: crypto.randomUUID(), application_id: request.applicationId, user_id: account, request_id: request.requestId, proposal_json: validated, created_at: now() };
    if (options.persist !== false) database.application_refinement_proposals.push(saved);
    return clone(saved);
  }
  const client = { supabaseUrl: 'https://fixture.supabase.co', from, rpc: async (name: string, args: Row) => rpc(name, args) } as unknown as SupabaseClient;
  return { client, from, rpc, seedProposal };
}

/** Small, deliberately synthetic source exercising distinct secrets and a private linked bullet. */
export function createPrivateRefinementCv(): CvState {
  const state = createEmptyDocument(); state.lang = 'en';
  state.contact = { name: 'Synthetic Rowan', role: 'Research engineer', email: 'rowan@example.invalid', location: 'Example City', phone: '', website: '', linkedin: '', github: '' };
  state.about.text = 'I develop reliable sensing systems. I document reproducible experiments and their limitations.';
  state.experience.jobs = [
    { id: 'local-private-job-a', title: 'Research engineer', company: 'Visible employer', bullets: '- Built sensors with !!E2E North Lab!!.\n- Evaluated robots with !!E2E South Lab!!.\n- Archived !!E2E Omit Lab!! findings in !![private evidence](https://private.example.invalid/archive)!!.' },
    { id: 'local-private-job-b', title: 'Research assistant', bullets: '- Documented repeatable methods.\n- Reviewed measured results.' },
  ];
  state.education = [{ id: 'local-private-education', title: 'Engineering degree', sub: 'Visible university', start: '2020', end: '2024' }];
  state.bodyOrder = ['about', 'jobs', 'education'];
  return state;
}

/** Same in-memory publication/variant boundary for Node regressions and real browser rendering. */
export function createSyntheticRefinementWorkspace(source = createSampleDocument()) {
  const account = '90000000-0000-4000-8000-000000000001', applicationId = '10000000-0000-4000-8000-000000000001';
  const data = new Map<string, string>(), writes: { key: string; value: string }[] = [];
  let failNextWriteKey: string | null = null, creationFails = false;
  const storage: Storage = {
    get length() { return data.size; }, key: index => [...data.keys()][index] ?? null, clear: () => data.clear(),
    getItem: key => data.get(key) ?? null, removeItem: key => { data.delete(key); },
    setItem(key, value) {
      if (key === failNextWriteKey) { failNextWriteKey = null; throw new Error('Local storage quota reached.'); }
      data.set(key, value); writes.push({ key, value });
    },
  };
  const base = cloneCv(source), states = new Map([['base', base]]);
  const application: Application = { id: applicationId, user_id: account, opportunity_id: '20000000-0000-4000-8000-000000000001',
    context_json: { title: 'Synthetic robotics application', institution: 'Example University' }, context_captured_at: '2026-10-02T00:00:00Z', cv_variant_id: null,
    completed_checklist_keys: [], status: 'shortlist', contact_email: null, notes: null, contacted_at: null, submitted_at: null,
    created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };
  const database: Record<string, Row[]> = { applications: [{ ...application }], cv_variants: [] };
  const cloud = createRefinementFixture(database, account);
  const creations: { sourceId: string; id: string; state: CvState }[] = [];
  const props = reactive({ application, client: cloud.client, userId: account, lang: 'en', projectId: 'fixture',
    configurations: [{ id: 'base', name: 'Research' }] as SavedConfiguration[], readVersion: (id: string) => states.get(id) || null,
    publishCv: async (state: CvState) => {
      const snapshot = createCloudCvSnapshot(state); database.cv_variants.push({ ...snapshot, user_id: account });
      props.application = { ...props.application, cv_variant_id: snapshot.id }; database.applications[0].cv_variant_id = snapshot.id; return props.application;
    },
    createSubvariant: (sourceId: string, name: string, state: CvState) => {
      if (creationFails) return null;
      const parentId = subvariantParent(sourceId, props.configurations), id = `accepted-${creations.length + 1}`;
      states.set(id, cloneCv(state)); props.configurations.push({ id, name, parentId });
      creations.push({ sourceId, id, state: cloneCv(state) }); return id;
    },
  });
  return { props, states, base, storage, data, writes, database, cloud, creations,
    failCreation() { creationFails = true; }, failSave(key: string) { failNextWriteKey = key; } };
}
