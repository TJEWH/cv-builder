import type { RefinementRequest } from '../refinementTypes';

/** Stable database contract shared by copied tasks, protocol documents and regression checks. */
export const REFINEMENT_COMMANDS = {
  resolve: { name: 'private.resolve_application_reference', types: ['text'] },
  protocol: { name: 'private.read_refinement_protocol', types: ['uuid', 'text'] },
  request: { name: 'private.read_refinement_request', types: ['uuid'] },
  save: { name: 'private.save_refinement_proposal', types: ['uuid', 'uuid', 'jsonb'] },
} as const;
export type RefinementCommand = keyof typeof REFINEMENT_COMMANDS;

/** Loading the known connector capability is distinct from exploring database contents. */
export const REFINEMENT_SQL_CAPABILITY_GUIDANCE = `This connected task requires Supabase execute_sql; its exposed name may include a namespace prefix. If it is not currently loaded, use available app/tool discovery once, targeted only at "Supabase execute_sql" on this same connector, before declaring it unavailable. A partial tool listing is not proof of absence. This loads the tool definition; it does not authorize database/schema discovery or another access path. If the definition disappears after a successful call, allow one targeted rediscovery of that same capability and resume the next exact supplied SQL statement, preserving any pending proposal UUID and payload.
Only declare a missing capability after this bounded discovery, or when no discovery facility is exposed. If execute_sql is unavailable, report a missing capability (not an execution or security error), explain that the connected SQL tool is required, and stop. query_logs only reads logs and cannot run this workflow. An actual permission, security or approval denial must stop the workflow immediately; do not rediscover or retry to bypass it. Report the last step verified by a returned tool result and the actual discovery result or tool error; never infer successful execution from earlier conversation summaries.`;

export function sqlText(value: string): string {
  if (value.includes('\0')) throw new Error('SQL text cannot contain a null character.');
  return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
export function refinementSql(command: RefinementCommand, values: string[], alias?: string): string {
  const definition = REFINEMENT_COMMANDS[command];
  if (values.length !== definition.types.length) throw new Error('Incorrect refinement SQL argument count.');
  if (alias && !/^[a-z_]+$/.test(alias)) throw new Error('Invalid SQL alias.');
  const args = values.map((value, i) => {
    const type = definition.types[i];
    if (type === 'uuid' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) throw new Error('Invalid refinement UUID.');
    return type === 'uuid' ? `'${value}'::uuid` : `${sqlText(value)}${type === 'jsonb' ? '::jsonb' : ''}`;
  });
  return `SELECT ${definition.name}(${args.join(', ')})${alias ? ` AS ${alias}` : ''};`;
}
export function proposalContractExample(request: RefinementRequest, summary: string) {
  return { schemaVersion: 2, requestId: request.requestId, summary, cvOperations: [], cvComments: [], annotations: [], letterText: 'complete letter text' };
}
