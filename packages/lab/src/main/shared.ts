import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  watch,
  type FSWatcher,
} from 'node:fs';

/**
 * The shared lab home — the SAME location the MCP server uses, so the lab and
 * the AI engineer read and write the same activity feed and reports. Default
 * ~/.yggdrasil-lab; override with YGG_HOME.
 */
export function yggHome(): string {
  const home = process.env['YGG_HOME'] ? resolve(process.env['YGG_HOME']) : join(homedir(), '.yggdrasil-lab');
  mkdirSync(home, { recursive: true });
  return home;
}

const activityPath = (): string => join(yggHome(), 'activity.jsonl');
function reportsDir(): string {
  const dir = join(yggHome(), 'reports');
  mkdirSync(dir, { recursive: true });
  return dir;
}
const settingsPath = (): string => join(yggHome(), 'settings.json');

// ── activity feed ───────────────────────────────────────────────────────────
export interface ActivityLine {
  at: number;
  actor: string;
  kind: string;
  runId?: number;
  summary: string;
  data?: Record<string, unknown>;
  agents?: { id: number; x: number; y: number; state: number }[];
}

function readLines(): ActivityLine[] {
  if (!existsSync(activityPath())) return [];
  const raw = readFileSync(activityPath(), 'utf8');
  const out: ActivityLine[] = [];
  for (const ln of raw.split('\n')) {
    if (!ln.trim()) continue;
    try {
      out.push(JSON.parse(ln) as ActivityLine);
    } catch {
      /* skip partial line */
    }
  }
  return out;
}

/** Most recent activity lines (for initial render). */
export function recentActivity(limit = 100): ActivityLine[] {
  return readLines().slice(-limit);
}

/** Append a line (the lab's own runs broadcast here too, for symmetry). */
export function appendActivity(line: ActivityLine): void {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    fs.appendFileSync(activityPath(), JSON.stringify(line) + '\n');
  } catch {
    /* best-effort */
  }
}

/**
 * Watch the activity file and call `onLines` with newly appended lines. Polls
 * file size and parses only the tail, so it's cheap and resilient to the file
 * being created after the watcher starts.
 */
export function watchActivity(onLines: (lines: ActivityLine[]) => void): () => void {
  let offset = existsSync(activityPath()) ? statSync(activityPath()).size : 0;
  let tail = '';
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;

  const drain = (): void => {
    try {
      if (!existsSync(activityPath())) return;
      const size = statSync(activityPath()).size;
      if (size <= offset) return;
      const fd = readFileSync(activityPath());
      const chunk = fd.subarray(offset).toString('utf8');
      offset = size;
      tail += chunk;
      const parts = tail.split('\n');
      tail = parts.pop() ?? '';
      const lines: ActivityLine[] = [];
      for (const p of parts) {
        if (!p.trim()) continue;
        try {
          lines.push(JSON.parse(p) as ActivityLine);
        } catch {
          /* skip */
        }
      }
      if (lines.length) onLines(lines);
    } catch {
      /* ignore transient read errors */
    }
  };

  // fs.watch can miss appends on some platforms; back it with a 1s poll.
  try {
    watcher = watch(yggHome(), (_e, file) => {
      if (file === 'activity.jsonl') drain();
    });
  } catch {
    /* dir watch unsupported */
  }
  timer = setInterval(drain, 1000);

  return () => {
    watcher?.close();
    if (timer) clearInterval(timer);
  };
}

// ── reports (shared markdown) ─────────────────────────────────────────────────
export interface ReportMeta {
  slug: string;
  title: string;
  author: string;
  updatedAt: number;
}

const HEADER = /^---\n([\s\S]*?)\n---\n?/;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

function parse(raw: string): { title: string; author: string; body: string } {
  const m = HEADER.exec(raw);
  let title = '';
  let author = 'unknown';
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const ln of m[1]!.split('\n')) {
      const i = ln.indexOf(':');
      if (i < 0) continue;
      const k = ln.slice(0, i).trim();
      const v = ln.slice(i + 1).trim();
      if (k === 'title') title = v;
      else if (k === 'author') author = v;
    }
  }
  return { title, author, body };
}

export function listReports(): ReportMeta[] {
  const dir = reportsDir();
  const out: ReportMeta[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const { title, author } = parse(readFileSync(join(dir, f), 'utf8'));
      const slug = f.replace(/\.md$/, '');
      out.push({ slug, title: title || slug, author, updatedAt: statSync(join(dir, f)).mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readReport(slug: string): { meta: ReportMeta; body: string } | null {
  try {
    const path = join(reportsDir(), `${slug}.md`);
    const { title, author, body } = parse(readFileSync(path, 'utf8'));
    return { meta: { slug, title: title || slug, author, updatedAt: statSync(path).mtimeMs }, body };
  } catch {
    return null;
  }
}

export function writeReport(title: string, body: string, author: string, slug?: string): string {
  const finalSlug = slug ?? slugify(title);
  writeFileSync(join(reportsDir(), `${finalSlug}.md`), `---\ntitle: ${title}\nauthor: ${author}\n---\n\n${body}\n`);
  return finalSlug;
}

// ── settings (Fireworks key lives here, never sent to the renderer) ────────────
interface Settings {
  fireworksKey?: string;
  model?: string;
}

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export function saveKey(key: string, model?: string): void {
  const s = loadSettings();
  s.fireworksKey = key.trim();
  if (model) s.model = model;
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

export const DEFAULT_MODEL = 'accounts/fireworks/models/gpt-oss-120b';

/** Effective key: env wins over the saved settings file. */
export function effectiveKey(): string | undefined {
  return process.env['FIREWORKS_API_KEY'] || loadSettings().fireworksKey || undefined;
}

export function effectiveModel(): string {
  return process.env['FIREWORKS_MODEL'] || loadSettings().model || DEFAULT_MODEL;
}
