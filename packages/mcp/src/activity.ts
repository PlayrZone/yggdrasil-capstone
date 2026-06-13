import { appendFileSync } from 'node:fs';
import { activityPath } from './home.js';

/**
 * One line of the shared activity feed. The lab tails this file so the human
 * sees, live, whatever a client (the AI engineer over MCP) is doing — runs
 * created, ticks advanced, ideas given, reports written. `agents` is an
 * optional compact position list so the lab can mirror the run on a minimap.
 */
export interface ActivityLine {
  at: number;
  actor: string;
  kind: string;
  runId?: number;
  summary: string;
  data?: Record<string, unknown>;
  agents?: { id: number; x: number; y: number; state: number }[];
}

// `at` is supplied by the caller (sim tick or a wall clock) to stay
// deterministic-friendly and avoid Date in pure layers.
export function appendActivity(line: ActivityLine): void {
  try {
    appendFileSync(activityPath(), JSON.stringify(line) + '\n');
  } catch {
    // The feed is best-effort telemetry; never let it break a tool call.
  }
}
