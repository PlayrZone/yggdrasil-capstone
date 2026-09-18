import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  RunManifest,
  RunSummary,
} from '@yggdrasil/engine';
import { corpusV2Root } from './paths.js';
import { isSafeSlug } from './reports.js';

/**
 * The file side of the lossless cognition record. The engine emits through
 * `ICognitionSink` and never touches a filesystem; this is the one place a
 * record becomes bytes.
 *
 *   <home>/corpus/v2/<runId>/run.json         manifest, rewritten with totals at close
 *   <home>/corpus/v2/<runId>/cognition.jsonl  one record per line, append-only
 *   <home>/corpus/v2/<runId>/outcomes.jsonl   one outcome per line, append-only
 *
 * Every write is a single complete line, so a crash truncates at a line
 * boundary at worst and the reader drops the partial tail. Nothing is ever
 * rewritten in place, and nothing is ever deleted.
 */

const MANIFEST = 'run.json';
const COGNITION = 'cognition.jsonl';
const OUTCOMES = 'outcomes.jsonl';

/** The one place a runId becomes a path. Same gate as report slugs. */
export function corpusRunDir(runId: string, root = corpusV2Root()): string {
  if (!isSafeSlug(runId)) throw new Error('corpus: unsafe runId');
  const base = resolve(root);
  const dir = resolve(base, runId);
  const rel = relative(base, dir);
  if (rel !== runId || isAbsolute(rel) || rel.startsWith('..')) throw new Error('corpus: runId escapes the corpus directory');
  return dir;
}

export interface StoredRun {
  runId: string;
  manifest: RunManifest | null;
  summary: RunSummary | null;
  records: CognitionRecordV2[];
  outcomes: CognitionOutcome[];
  /** Lines that did not parse or carried an unknown schema — never silently zero. */
  skipped: number;
}

export class JsonlCognitionSink implements ICognitionSink {
  private readonly dir: string;
  private manifest: RunManifest | null = null;

  constructor(
    readonly runId: string,
    root?: string,
  ) {
    this.dir = corpusRunDir(runId, root ?? corpusV2Root());
    mkdirSync(this.dir, { recursive: true });
  }

  openRun(manifest: RunManifest): void {
    this.manifest = manifest;
    // Written up front so a crashed run still has a readable, honest header.
    writeFileSync(join(this.dir, MANIFEST), JSON.stringify({ manifest, summary: null }, null, 2));
  }

  cognition(record: CognitionRecordV2): void {
    this.appendLine(COGNITION, record);
  }

  outcome(outcome: CognitionOutcome): void {
    this.appendLine(OUTCOMES, outcome);
  }

  closeRun(summary: RunSummary): void {
    writeFileSync(join(this.dir, MANIFEST), JSON.stringify({ manifest: this.manifest, summary }, null, 2));
  }

  private appendLine(file: string, value: unknown): void {
    appendFileSync(join(this.dir, file), `${JSON.stringify(value)}\n`);
  }
}

/** Run directories, newest first. */
export function listCorpusRuns(root = corpusV2Root()): { runId: string; updatedAt: number }[] {
  if (!existsSync(root)) return [];
  const out: { runId: string; updatedAt: number }[] = [];
  for (const name of readdirSync(root)) {
    if (!isSafeSlug(name)) continue;
    try {
      const dir = corpusRunDir(name, root);
      if (!statSync(dir).isDirectory()) continue;
      out.push({ runId: name, updatedAt: statSync(dir).mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Read one run back. `schemaVersion` gates every row: a reader that does not
 * know a version must drop the row and say so, never guess at it.
 */
export function readCorpusRun(runId: string, schemaVersion: number, root = corpusV2Root()): StoredRun {
  const dir = corpusRunDir(runId, root);
  const head = readJson<{ manifest: RunManifest | null; summary: RunSummary | null }>(join(dir, MANIFEST));
  const records: CognitionRecordV2[] = [];
  const outcomes: CognitionOutcome[] = [];
  let skipped = 0;

  for (const row of readLines<CognitionRecordV2>(join(dir, COGNITION))) {
    if (row === null || row.schemaVersion !== schemaVersion) skipped++;
    else records.push(row);
  }
  for (const row of readLines<CognitionOutcome>(join(dir, OUTCOMES))) {
    if (row === null || row.schemaVersion !== schemaVersion) skipped++;
    else outcomes.push(row);
  }
  return { runId, manifest: head?.manifest ?? null, summary: head?.summary ?? null, records, outcomes, skipped };
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Parsed lines, with `null` for any line that did not survive (a crash tail). */
function readLines<T>(path: string): (T | null)[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: (T | null)[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      out.push(null);
    }
  }
  return out;
}
