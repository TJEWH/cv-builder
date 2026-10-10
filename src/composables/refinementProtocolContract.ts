import type { RefinementRequest } from '../refinementTypes';

/** Stable database contract shared by copied tasks, protocol documents and regression checks. */
export const REFINEMENT_COMMANDS = {
  resolve: { name: 'private.resolve_application_reference', types: ['text'] },
  protocol: { name: 'private.read_refinement_protocol', types: ['uuid', 'text'] },
  request: { name: 'private.read_refinement_request', types: ['uuid'] },
  save: { name: 'private.save_refinement_proposal', types: ['uuid', 'uuid', 'jsonb'] },
} as const;
export type RefinementCommand = keyof typeof REFINEMENT_COMMANDS;

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
  return request.schemaVersion === 1
    ? { schemaVersion: 1, requestId: request.requestId, summary, cvEdits: [{ fieldId: 'field-1', text: 'complete replacement text' }], letterText: 'complete letter text' }
    : { schemaVersion: 2, requestId: request.requestId, summary, cvOperations: [], cvComments: [], annotations: [], letterText: 'complete letter text' };
}
