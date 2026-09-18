import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { reportsDir } from './paths.js';

/**
 * Shared reports: plain Markdown files in <home>/reports, with a tiny YAML-ish
 * header carrying title + author. Both the lab UI and the AI (over MCP) list,
 * read, and write them — the human-readable research channel between us.
 *
 * Slugs arrive from untrusted callers (the renderer over IPC, any MCP client),
 * so they are the security boundary of this module: nothing here builds a path
 * except `reportPath`, and that gate is total.
 */
export interface ReportMeta {
  slug: string;
  title: string;
  author: string;
  updatedAt: number;
}

const HEADER = /^---\n([\s\S]*?)\n---\n?/;

/**
 * A plain report name: one path segment, no separators, no drive letter, no
 * NUL, no leading dot, bounded length. JS `$` (without the `m` flag) matches
 * only at end-of-input, so a trailing newline cannot sneak past this.
 */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_RE.test(slug) && !slug.includes('..');
}

/**
 * The one spelling of a slug. NTFS is case-insensitive, so `Alpha` and `alpha`
 * are one file: without folding, `write_report` could overwrite the human's
 * report while `listReports` kept advertising the other name and both sides
 * saw a file they never wrote. Only ASCII reaches this (SLUG_RE), so
 * `toLowerCase` is locale-independent.
 */
export function canonicalSlug(slug: string): string {
  return slug.toLowerCase();
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

/**
 * The only place a slug becomes a filesystem path. Two independent gates: the
 * slug must be a plain name, and the resolved file must still be a direct child
 * of the reports directory. Throws rather than returning a fallback path — a
 * rejected slug must never touch the disk.
 *
 * Containment is lexical, not `realpath`: a symlink planted inside the reports
 * directory would still be followed. That is deliberate — writing one requires
 * write access to the user's own home, which already defeats any check here —
 * and `realpath` cannot be used on a file a write is about to create.
 */
export function reportPath(slug: string): string {
  if (!isSafeSlug(slug)) throw new Error('reports: unsafe slug');
  const canonical = canonicalSlug(slug);
  const dir = resolve(reportsDir());
  const file = resolve(dir, `${canonical}.md`);
  const rel = relative(dir, file);
  if (rel !== `${canonical}.md` || isAbsolute(rel) || rel.startsWith('..')) throw new Error('reports: slug escapes the reports directory');
  return file;
}

/** Header values are single-line; strip anything that could forge a header. */
function headerValue(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
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
    // A file we could not address by slug is one we must not advertise, and the
    // slug we advertise must be the one `readReport` would resolve to.
    if (!isSafeSlug(f.slice(0, -3))) continue;
    const slug = canonicalSlug(f.slice(0, -3));
    try {
      const path = reportPath(slug);
      const { title, author } = parse(readFileSync(path, 'utf8'));
      out.push({ slug, title: title || slug, author, updatedAt: statSync(path).mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Read one report. Returns null for an unsafe slug or a missing/unreadable
 * file. `meta.slug` is the canonical spelling, so it round-trips into a write.
 */
export function readReport(slug: string): { meta: ReportMeta; body: string } | null {
  try {
    const path = reportPath(slug);
    const canonical = canonicalSlug(slug);
    const { title, author, body } = parse(readFileSync(path, 'utf8'));
    return { meta: { slug: canonical, title: title || canonical, author, updatedAt: statSync(path).mtimeMs }, body };
  } catch {
    return null;
  }
}

/** Create or overwrite a report. Returns its canonical slug; throws on an unsafe slug. */
export function writeReport(title: string, body: string, author: string, slug?: string): string {
  const requested = slug ?? slugify(title);
  const path = reportPath(requested);
  writeFileSync(path, `---\ntitle: ${headerValue(title)}\nauthor: ${headerValue(author)}\n---\n\n${body}\n`);
  return canonicalSlug(requested);
}
