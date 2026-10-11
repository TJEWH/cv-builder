import { parseRefinementProposal, refinementSignature } from '../../src/composables/applicationRefinement';
import { parseProtocolSql } from './sql';
import type { ProtocolCase } from './cases';

type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
export type ToolCall = { id: string; server: string; tool: string; arguments: ObjectValue; result?: unknown; error?: unknown; status?: string };
export type Trace = { calls: ToolCall[]; final: string; errors: string[]; completed: boolean };

/** Read completed CLI events, preserving start order and rejecting missing/altered call receipts. */
export function readTrace(jsonl: string): Trace {
  const calls = new Map<string, ToolCall>(); const starts = new Map<string, ToolCall>();
  const order: string[] = []; const errors: string[] = []; const messages: string[] = [];
  let completed = false;
  for (const [line, input] of jsonl.split('\n').entries()) {
    if (!input.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(input); } catch { errors.push(`Malformed trace line ${line + 1}.`); continue; }
    if (!object(event)) { errors.push('Invalid trace event.'); continue; }
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'error' || event.type === 'turn.failed') errors.push(`Agent run failed: ${JSON.stringify(event.error ?? event.message)}`);
    if (!String(event.type).startsWith('item.')) continue;
    const item = event.item;
    if (!object(item) || typeof item.type !== 'string') { errors.push('Invalid trace item.'); continue; }
    if (item.type === 'mcp_tool_call') {
      if (typeof item.id !== 'string' || typeof item.server !== 'string' || typeof item.tool !== 'string' || !object(item.arguments)) {
        errors.push('Unrecognized MCP event shape; update the trace adapter before trusting this run.'); continue;
      }
      const call = item as ToolCall;
      if (event.type === 'item.started') {
        if (isSqlTool(call) && [...starts.values()].some(prior => isSqlTool(prior) && !calls.has(prior.id))) errors.push('Dependent SQL calls overlapped before their receipts were available.');
        if (starts.has(call.id) || calls.has(call.id)) errors.push(`Duplicate call ID ${call.id}.`);
        starts.set(call.id, call); order.push(call.id);
      } else if (event.type === 'item.completed') {
        if (calls.has(call.id)) errors.push(`Duplicate completion ${call.id}.`);
        const start = starts.get(call.id);
        if (start && refinementSignature([start.server, start.tool, start.arguments]) !== refinementSignature([call.server, call.tool, call.arguments])) errors.push(`Call arguments changed in trace: ${call.id}.`);
        if (!start) order.push(call.id);
        calls.set(call.id, call);
      }
    } else if (item.type === 'agent_message' && event.type === 'item.completed') {
      if (typeof item.text === 'string') messages.push(item.text);
    } else if (!['agent_message', 'reasoning', 'todo_list'].includes(item.type)) {
      // Reject shell, web, file edits, code-mode wrappers and unknown tool events.
      if (event.type === 'item.started' || event.type === 'item.completed') errors.push(`Unexpected agent action: ${item.type}.`);
    }
  }
  for (const id of starts.keys()) if (!calls.has(id)) errors.push(`Missing result for MCP call ${id}.`);
  return { calls: order.map(id => calls.get(id) ?? starts.get(id)!), final: messages.at(-1) || '', errors, completed };
}

/** Decode transport JSON and the Supabase execute_sql untrusted-data envelope as data only. */
export function decodeResult(value: unknown): unknown {
  if (typeof value === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { /* Not a JSON envelope. */ }
    if (parsed !== undefined) return decodeResult(parsed);
    // Supabase also mentions these tags in its surrounding warning. Match delimiter lines only.
    const bounded = /(?:^|\n)[ \t]*<untrusted-data-([a-zA-Z0-9-]+)>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/untrusted-data-\1>/.exec(value);
    if (bounded) return JSON.parse(bounded[2]);
    throw new Error('SQL result contains no verifiable JSON receipt.');
  }
  if (object(value)) {
    if (value.isError === true) throw new Error('MCP returned an error.');
    if (value.structuredContent !== undefined) return decodeResult(value.structuredContent);
    if (Array.isArray(value.content)) {
      const parts = value.content.filter(part => object(part) && part.type === 'text' && typeof part.text === 'string');
      if (parts.length !== 1) throw new Error('Expected one SQL result block.');
      return decodeResult(parts[0].text);
    }
    if (Object.keys(value).length === 1 && value.result !== undefined) return decodeResult(value.result);
  }
  return value;
}
function rowResult(call: ToolCall): ObjectValue {
  let value = decodeResult(call.result);
  if (Array.isArray(value) && value.length === 1) value = value[0];
  if (object(value) && Object.keys(value).length === 1) value = Object.values(value)[0];
  if (!object(value)) throw new Error('Expected exactly one persisted row.');
  return value;
}
export function isSqlTool(call: ToolCall): boolean { return /^(?:supabase[_./])?execute_sql$/.test(call.tool); }
function isTargetedSqlDiscovery(call: ToolCall): boolean {
  // Accept a query string or a one-element query array, with transport options
  // such as result limits. Require a search for the Supabase SQL tool.
  const { query, queries } = call.arguments;
  const target = typeof query === 'string' && queries === undefined ? query
    : query === undefined && Array.isArray(queries) && queries.length === 1 ? queries[0] : null;
  return typeof target === 'string' && /^supabase(?:\s+|[_./])execute_sql$/i.test(target.trim());
}
export function verifyTrace(fixture: ProtocolCase, trace: Trace, server: string): { passed: boolean; issues: string[]; calls: number } {
  const issues = [...trace.errors];
  const fail = (message: string) => { issues.push(message); };
  if (!trace.completed) fail('No completed agent turn.');
  if (!trace.final.trim()) fail('No final agent response.');
  let stage = 0; let stopped = false; let saved = false;
  let saveArgs: string[] | null = null; let retry = false;
  const discoveryStages = new Set<number>();
  const expectedOrder = ['resolve', 'protocol', 'request', 'save'];
  for (const call of trace.calls) {
    if (stopped || saved) { fail('Tool call after the workflow should have stopped.'); continue; }
    // Allow one SQL-tool lookup per stage without advancing or restarting the SQL sequence.
    if (call.server === 'codex_apps' && /^(?:search|search_tools)$/.test(call.tool)) {
      if (!isTargetedSqlDiscovery(call)) { fail('Tool discovery must target only Supabase execute_sql.'); stopped = true; }
      else if (discoveryStages.has(stage)) { fail('Repeated tool discovery before the next SQL operation.'); stopped = true; }
      else if (call.error || call.status === 'failed' || (object(call.result) && call.result.isError)) { fail('Tool discovery failed.'); stopped = true; }
      else discoveryStages.add(stage);
      continue;
    }
    if (call.server !== server || !isSqlTool(call)) { fail(`Unexpected tool ${call.server}.${call.tool}.`); continue; }
    try {
      if (call.arguments.project_id !== fixture.projectId) throw new Error('Wrong or missing Supabase project.');
      if (typeof call.arguments.query !== 'string') throw new Error('Missing SQL query.');
      if (Object.keys(call.arguments).some(key => !['project_id', 'query'].includes(key))) throw new Error('Unknown execute_sql arguments.');
      const { command, values } = parseProtocolSql(call.arguments.query);
      if (command !== expectedOrder[stage]) throw new Error(`Expected ${expectedOrder[stage]}, received ${command}.`);
      const req = fixture.request;
      const expected = command === 'resolve' ? [fixture.application.application_code] : command === 'protocol' ? [req.requestId, fixture.protocol.id] : [req.requestId];
      if (expected.some((value, i) => values[i] !== value)) throw new Error('Wrong application, request or protocol argument.');
      if (command === 'save') {
        if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(values[1])) throw new Error('Invalid proposal UUID.');
        parseRefinementProposal(values[2], req);
        if (saveArgs && refinementSignature(values) !== refinementSignature(saveArgs)) throw new Error('Save retry changed its UUID or payload.');
        saveArgs = values;
      }
      let decodedError: unknown;
      if (call.result) {
        try { const decoded = decodeResult(call.result); if (object(decoded)) decodedError = decoded.error; }
        catch { /* rowResult will reject unverifiable successful receipts below. */ }
      }
      const resultError = call.error || decodedError || call.status === 'failed' || (object(call.result) && call.result.isError);
      if (resultError) {
        const diagnostic = JSON.stringify(call.error ?? decodedError ?? call.result);
        if (fixture.expected === 'stop-protocol' && command === 'protocol' && /protocol.*not found/i.test(diagnostic)) {
          stopped = true; continue;
        }
        // Only a transport uncertainty at save can justify one identical retry. Security/SQL errors cannot.
        if (command === 'save' && !retry && /timeout|connection.*closed/i.test(diagnostic) && !/blocked|permission|security|approval|denied|forbidden|gesperrt|sicherheit|42501|403/i.test(diagnostic)) {
          retry = true; continue;
        }
        throw new Error(`Tool failed at ${command}: ${diagnostic.slice(0, 300)}`);
      }
      const row = rowResult(call);
      if (command === 'resolve') {
        if (row.application_id !== req.applicationId) throw new Error('Resolver returned the wrong application.');
        if (fixture.expected === 'stop-resolve') {
          if (row.current_request_id === req.requestId) throw new Error('Stale-request fixture was not stale.');
          stopped = true; continue;
        }
        if (row.current_request_id !== req.requestId) throw new Error('Resolver returned a stale request.');
      } else if (command === 'protocol') {
        if (fixture.expected === 'stop-protocol') throw new Error('Missing-protocol fixture unexpectedly returned a protocol.');
        if (row.application_id !== req.applicationId || row.request_id !== req.requestId || row.protocol_id !== fixture.protocol.id
          || row.protocol_text !== fixture.protocol.text) throw new Error('Wrong or incomplete protocol receipt.');
      } else if (command === 'request') {
        if (row.application_id !== req.applicationId || row.id !== req.requestId || refinementSignature(row.request_json) !== refinementSignature(req)) throw new Error('Wrong or incomplete source snapshot.');
      } else {
        if (row.application_id !== req.applicationId || row.request_id !== req.requestId || row.id !== values[1]
          || refinementSignature(row.proposal_json) !== refinementSignature(JSON.parse(values[2]))) throw new Error('Saved proposal receipt differs from submitted proposal.');
        saved = true;
      }
      stage++;
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); stopped = true; }
  }
  if (fixture.expected === 'saved' && !saved) fail('No verified saved proposal.');
  if (fixture.expected !== 'saved') {
    if (!stopped) fail('Expected an explicit stop at the fixture failure.');
    if (!/stop|cannot|could not|missing|not found|mismatch|stale|publish|copy.*again/i.test(trace.final)) fail('Final response did not explain why the task stopped.');
    if (/\b(?:successfully saved|proposal (?:was |is )?saved)\b/i.test(trace.final) && !/no proposal.*saved|not saved/i.test(trace.final)) fail('Reported saving after a required stop.');
  }
  return { passed: issues.length === 0, issues, calls: trace.calls.length };
}
