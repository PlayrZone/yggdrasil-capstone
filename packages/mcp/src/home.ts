import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * The shared lab home. The MCP server (Node) and the Electron lab both read
 * and write here, so it must resolve to the SAME absolute path from either
 * process regardless of cwd. Default: ~/.yggdrasil-lab. Override with YGG_HOME.
 *
 *   <home>/research.db      — the research database (MCP-owned; Node 22+)
 *   <home>/activity.jsonl   — append-only live activity feed (shared)
 *   <home>/reports/*.md     — shared reports the user and the AI both edit
 */
export function yggHome(): string {
  const home = process.env['YGG_HOME'] ? resolve(process.env['YGG_HOME']) : join(homedir(), '.yggdrasil-lab');
  mkdirSync(home, { recursive: true });
  return home;
}

export function dbPath(): string {
  return process.env['YGG_DB'] ? resolve(process.env['YGG_DB']) : join(yggHome(), 'research.db');
}

export function activityPath(): string {
  return join(yggHome(), 'activity.jsonl');
}

export function reportsDir(): string {
  const dir = join(yggHome(), 'reports');
  mkdirSync(dir, { recursive: true });
  return dir;
}
