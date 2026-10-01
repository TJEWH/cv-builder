/** Synthetic refinement backend shared by component tests and the dev-only browser fixture. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RefinementRequest, RefinementProposal } from '../src/refinementTypes';
import { parseRefinementProposal, refinementSignature } from '../src/composables/applicationRefinement';
import { IDENTITY_PLACEHOLDERS } from '../src/composables/identityRedaction';

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
    let one = false;
    const builder = {
      select() { return builder; },
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
          return { data: clone(one ? rows[0] || null : rows), error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  }
  function rpc(name: string, args: Row) {
    try {
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
        if (kind !== 'feedback') {
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
  function seedProposal(requestId?: string, options: { overLimit?: boolean; letterText?: string } = {}) {
    const row = requestId ? database.application_refinement_requests.find(row => row.id === requestId) : database.application_refinement_requests.at(-1);
    if (!row) throw new Error('Copy the initial or improvement prompt first.');
    const request = row.request_json as RefinementRequest;
    const field = request.cv.fields.find(field => field.label === 'Profile');
    const draft = '# Application for PhD in Human-Centred Robotics\n\nDear selection committee,\n\nI am applying to your doctoral programme because its focus on safe human–robot collaboration matches my research interests. I would welcome the opportunity to connect my documented technical experience to practical experiments and reproducible research.\n\nThe project’s combination of learning algorithms and physical experiments particularly interests me. I am motivated to investigate how robots can learn from demonstrations and contribute to careful evaluation of collaborative systems.\n\nThank you for considering my application. I would welcome a discussion about the project and my experience.\n\nKind regards,\n{{APPLICANT_NAME}}';
    const proposal: RefinementProposal = {
      schemaVersion: 1, requestId: request.requestId,
      summary: `Synthetic ${request.scope} proposal. ${request.scope === 'letter' ? 'The approved CV remains unchanged.' : 'Minor profile wording adjustment and a complete motivation letter.'} ${request.feedback.length} feedback entries considered.`,
      cvEdits: request.scope === 'letter' || !field ? [] : [{ fieldId: field.id, text: `${field.text}\nI am interested in research on safe human–robot collaboration.` }],
      letterText: request.scope === 'cv' ? request.letter.text : options.letterText || (request.feedback.length && request.letter.text ? `${request.letter.text}\n\nThis revision reflects the requested improvements.` : draft),
    };
    if (options.overLimit && request.scope !== 'cv') proposal.letterText += '\n\n' + 'research '.repeat(request.letter.maxWords + 1);
    const validated = parseRefinementProposal(proposal, request);
    const saved = { id: crypto.randomUUID(), application_id: row.application_id, user_id: row.user_id, request_id: row.id, proposal_json: validated, created_at: now() };
    database.application_refinement_proposals.push(saved); return clone(saved);
  }
  const client = { supabaseUrl: 'https://fixture.supabase.co', from, rpc: async (name: string, args: Row) => rpc(name, args) } as unknown as SupabaseClient;
  return { client, from, rpc, seedProposal };
}
