import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { reportsDir } from './home.js';

/**
 * Shared reports: plain Markdown files in <home>/reports, with a tiny YAML-ish
 * header carrying title + author. Both the lab UI and the AI (over MCP) list,
 * read, and write them — the human-readable research channel between us.
 */
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
      const raw = readFileSync(join(dir, f), 'utf8');
      const { title, author } = parse(raw);
      const slug = f.replace(/\.md$/, '');
      out.push({ slug, title: title || slug, author, updatedAt: statSync(join(dir, f)).mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readReport(slug: string): { meta: ReportMeta; body: string } | null {
  try {
    const path = join(reportsDir(), `${slug}.md`);
    const raw = readFileSync(path, 'utf8');
    const { title, author, body } = parse(raw);
    return { meta: { slug, title: title || slug, author, updatedAt: statSync(path).mtimeMs }, body };
  } catch {
    return null;
  }
}

/** Create or overwrite a report. Returns its slug. */
export function writeReport(title: string, body: string, author: string, slug?: string): string {
  const finalSlug = slug ?? slugify(title);
  const raw = `---\ntitle: ${title}\nauthor: ${author}\n---\n\n${body}\n`;
  writeFileSync(join(reportsDir(), `${finalSlug}.md`), raw);
  return finalSlug;
}
