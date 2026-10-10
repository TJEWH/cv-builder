import { CASE_NAMES, createCase, stableId } from './cases';
import { seedSql, inspectSql } from './fixtures';
import { refinementSql, sqlText } from '../../src/composables/refinementProtocolContract';
import { createHash, randomUUID } from 'node:crypto';

/** Run this SQL through the existing MCP execute_sql tool as postgres. Everything rolls back. */
export function preflightSql(projectId: string) {
  const statements = ['BEGIN;'];
  for (const name of CASE_NAMES) {
    const fixture = createCase(name, projectId, randomUUID());
    statements.push(seedSql(fixture).replace(/^BEGIN;\n/, '').replace(inspectSql(fixture), '').replace(/COMMIT;$/, ''));
    const reqId = `'${fixture.request.requestId}'::uuid`;
    const protocolId = sqlText(fixture.protocol.id);
    statements.push(`DO $check$\nDECLARE result jsonb;\nBEGIN\n` +
      `result := private.resolve_application_reference('${fixture.application.id}');\n` +
      `IF result->>'application_id' <> '${fixture.application.id}' THEN RAISE EXCEPTION 'Fixture resolver mismatch'; END IF;\n` +
      (fixture.expected === 'stop-resolve'
        ? `IF result->>'current_request_id' IS NOT NULL THEN RAISE EXCEPTION 'Fixture must be stale'; END IF;\n`
        : `IF result->>'current_request_id' <> '${fixture.request.requestId}' THEN RAISE EXCEPTION 'Fixture request mismatch'; END IF;\n`) +
      (fixture.expected === 'stop-protocol'
        ? `BEGIN PERFORM private.read_refinement_protocol(${reqId},${protocolId}); RAISE EXCEPTION 'Missing protocol unexpectedly exists'; EXCEPTION WHEN no_data_found THEN NULL; END;\n`
        : `result := private.read_refinement_protocol(${reqId},${protocolId});\nIF md5(result->>'protocol_text') IS DISTINCT FROM '${createHash('md5').update(fixture.protocol.text).digest('hex')}' THEN RAISE EXCEPTION 'Protocol differs'; END IF;\n`) +
      `PERFORM private.read_refinement_request(${reqId});\nEND;\n$check$;`);
    if (fixture.expected === 'saved') {
      const proposal = { schemaVersion: 2, requestId: fixture.request.requestId, summary: 'Synthetic protocol validation.',
        cvOperations: [], cvComments: [], annotations: [], letterText: fixture.request.letter.text || 'Dear committee,\nI built Python measurement tools.\n{{APPLICANT_NAME}}' };
      const save = refinementSql('save', [fixture.request.requestId, stableId(fixture.namespace + 'proposal'), JSON.stringify(proposal)]);
      statements.push(`DO $save$ BEGIN ${save.replace(/^SELECT/, 'PERFORM')} ${save.replace(/^SELECT/, 'PERFORM')} END; $save$;`);
    }
  }
  statements.push("SELECT 'All synthetic protocol SQL cases passed; transaction rolled back.' AS result;", 'ROLLBACK;');
  return statements.join('\n');
}
