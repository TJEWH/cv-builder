import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// No connection URL, environment snapshot or remote database override. Both
// suites reset only this labelled, network-disabled disposable Docker fixture.
export const container = 'cv-opportunity-merge-test';
export const database = 'opportunity_merge_test';
const inspect = spawnSync('docker', ['inspect', container], { encoding: 'utf8' });
if (inspect.status !== 0) throw new Error('Start the isolated opportunity merge fixture described in docs/opportunity-merge.md.');
const configuration = JSON.parse(inspect.stdout)[0];
if (configuration?.Config?.Labels?.['cv-builder.test-suite'] !== 'opportunity-merge'
  || configuration?.HostConfig?.NetworkMode !== 'none'
  || configuration?.Mounts?.some((mount: { Type: string }) => mount.Type === 'bind')
  || configuration?.HostConfig?.PortBindings && Object.keys(configuration.HostConfig.PortBindings).length) {
  throw new Error('Refusing to reset an unlabelled, networked, bind-mounted or port-published database.');
}
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'];
// A second test invocation must never reset a database while this suite uses it.
const lock = '/tmp/cv-opportunity-merge-test.lock';
function acquireSuiteLock() {
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(previous, 0); alive = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') alive = true; }
    if (alive) throw new Error(`Opportunity merge suite already running (PID ${previous}); wait before resetting its database.`);
    unlinkSync(lock); writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  }
  process.once('exit', () => { try { unlinkSync(lock); } catch { /* already removed during process cleanup */ } });
}
acquireSuiteLock();
export function sql(text: string): string {
  const r = spawnSync('docker', args, { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'isolated psql failed');
  return r.stdout.trim();
}
export function sqlAsync(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args); let out = ''; let err = '';
    p.stdout.on('data', (x) => { out += x; }); p.stderr.on('data', (x) => { err += x; });
    p.on('error', reject); p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    p.stdin.end(text);
  });
}
export const literal = (x: unknown) => `'${JSON.stringify(x).replaceAll("'", "''")}'::jsonb`;
export function json<T = any>(query: string): T { return JSON.parse(sql(query)); }
export function file(path: string): string { return readFileSync(new URL(path, import.meta.url), 'utf8'); }
export function reset() {
  if (sql('SELECT current_database();') !== database) throw new Error('Unexpected opportunity fixture database.');
  sql('DROP SCHEMA IF EXISTS private CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  sql(file('./fixtures/installed-baseline.sql'));
}
export function upgrade() { sql(file('../../supabase/opportunity_merge_v4.sql')); }
export const owner = '00000000-0000-4000-8000-000000000001';
export const search = '00000000-0000-4000-8000-000000000002';
export const run = '00000000-0000-4000-8000-000000000003';
export function seedRun(id = run) {
  sql(`INSERT INTO public.opportunity_search_runs(id,search_id,user_id,template_revision,protocol_version,definition,queries)
    VALUES('${id}','${search}','${owner}',1,(SELECT active_protocol_version FROM private.opportunity_search_settings), '{}','[]');`);
}
export function insertOpportunity(record: Record<string, unknown>) {
  const cols = Object.keys(record).map((x) => `"${x.replaceAll('"', '""')}"`).join(',');
  return json(`INSERT INTO public.opportunities(${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public.opportunities,${literal(record)}) RETURNING to_jsonb(opportunities);`);
}
export function submit(payload: unknown, item: string, runId = run) {
  return json(`SELECT private.submit_opportunity_search_result('${runId}','${item}',${literal(payload)});`);
}
