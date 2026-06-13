// Boots the MCP server over stdio, runs initialize + tools/list, prints the
// tool names, then exits. Run: node smoke.mjs  (uses tsx to load TS source)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, 'src/index.ts');

const child = spawn(process.execPath, ['--import', 'tsx', entry], {
  cwd: here,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, YGG_DB: resolve(here, '.smoke/research.db') },
});

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

const send = (id, method, params) =>
  new Promise((res) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

const fail = (m) => { console.error('SMOKE FAIL:', m); child.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), 15000);

const init = await send(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
if (!init.result) fail('no initialize result');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await send(2, 'tools/list', {});
const names = (list.result?.tools ?? []).map((t) => t.name).sort();
console.log(`OK — ${names.length} tools:`, names.join(', '));

// Exercise one read tool end-to-end.
const desc = await send(3, 'tools/call', { name: 'describe_lab', arguments: {} });
if (!desc.result?.content?.[0]?.text?.includes('YGGDRASIL LAB')) fail('describe_lab content unexpected');
console.log('OK — describe_lab responded');

// Exercise the shared-file pipeline the lab tails: run a tiny batch + write a report.
const run = await send(4, 'tools/call', { name: 'run_experiment', arguments: { seed: 'smoke', ticks: 300, agentCount: 20 } });
if (!run.result) fail('run_experiment failed');
console.log('OK — run_experiment recorded');

const rep = await send(5, 'tools/call', { name: 'write_report', arguments: { title: 'Smoke note', body: 'hello from smoke' } });
if (!rep.result) fail('write_report failed');

const reps = await send(6, 'tools/call', { name: 'list_reports', arguments: {} });
const txt = reps.result?.content?.[0]?.text ?? '';
if (!txt.includes('Smoke note')) fail('list_reports missing the written report');
console.log('OK — write_report + list_reports round-trip');

child.kill();
process.exit(0);
