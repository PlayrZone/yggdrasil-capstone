import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSafeSlug, listReports, readReport, reportPath, slugify, writeReport, reportsDir, yggHome } from '../src/index.js';

/**
 * The slug is the only untrusted input that becomes a path. Every case below is
 * a real attempt to leave <home>/reports — the hole the audit found in both the
 * lab's `reports:read`/`reports:write` IPC and the MCP `read_report`/`write_report`
 * tools, which shared this code by copy-paste.
 */
const TRAVERSAL_SLUGS: [name: string, slug: string][] = [
  ['dot-dot-slash', '../secret'],
  ['deep dot-dot', '../../../../etc/passwd'],
  ['dot-dot-backslash', '..\\secret'],
  ['posix absolute', '/etc/passwd'],
  ['windows absolute', 'C:\\Windows\\System32\\drivers\\etc\\hosts'],
  ['drive relative', 'C:secret'],
  ['unc path', '\\\\server\\share\\secret'],
  ['forward slash', 'sub/secret'],
  ['backslash', 'sub\\secret'],
  ['bare dot-dot', '..'],
  ['single dot', '.'],
  ['embedded dot-dot', 'a/../../b'],
  ['NUL byte', 'ok\u0000/../../evil'],
  ['NUL suffix', 'ok\u0000'],
  ['trailing newline', 'ok\n'],
  ['leading newline', '\nok'],
  ['newline then traversal', 'ok\n../evil'],
  ['empty', ''],
  ['whitespace', '   '],
  ['leading dot', '.hidden'],
  ['leading dash', '-rf'],
  ['overlong', 'a'.repeat(81)],
  ['url encoded traversal', '%2e%2e%2fsecret'],
  ['tilde home', '~/secret'],
];

describe('report slugs', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-home-'));
    process.env['YGG_HOME'] = home;
  });
  afterEach(() => {
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  it('accepts plain slugs', () => {
    for (const ok of ['report', 'a', 'cycle-14', 'exp_1', 'v0.3.6', 'A1', 'a'.repeat(80)]) {
      expect(isSafeSlug(ok), ok).toBe(true);
      expect(() => reportPath(ok)).not.toThrow();
    }
  });

  it.each(TRAVERSAL_SLUGS)('rejects %s', (_name, slug) => {
    expect(isSafeSlug(slug)).toBe(false);
    expect(() => reportPath(slug)).toThrow();
  });

  it('rejects non-string slugs', () => {
    for (const bad of [undefined, null, 42, {}, [], Symbol('x')]) expect(isSafeSlug(bad)).toBe(false);
  });

  it('keeps every resolved path inside the reports directory', () => {
    const dir = reportsDir();
    for (const ok of ['a', 'exp_1', 'v0.3.6']) expect(reportPath(ok)).toBe(join(dir, `${ok}.md`));
  });

  it('never reads a file outside the reports directory', () => {
    writeFileSync(join(home, 'secret.md'), '---\ntitle: Secret\nauthor: nobody\n---\n\ntop secret\n');
    expect(readReport('../secret')).toBeNull();
    expect(readReport('..\\secret')).toBeNull();
    expect(readReport(join(home, 'secret'))).toBeNull();
    // ...and proves the file really was readable by the safe route.
    writeFileSync(join(reportsDir(), 'inside.md'), '---\ntitle: Inside\nauthor: me\n---\n\nbody\n');
    expect(readReport('inside')?.body.trim()).toBe('body');
  });

  it('never writes a file outside the reports directory', () => {
    for (const [, slug] of TRAVERSAL_SLUGS) {
      expect(() => writeReport('Pwned', 'x', 'attacker', slug)).toThrow();
    }
    expect(readdirSync(reportsDir())).toEqual([]);
    expect(existsSync(join(home, 'secret.md'))).toBe(false);
    expect(existsSync(join(home, 'Pwned.md'))).toBe(false);
  });

  it('round-trips a report and derives a safe slug from any title', () => {
    const slug = writeReport('  ../../Escape Attempt!! ', '# hi', 'ai-engineer');
    expect(isSafeSlug(slug)).toBe(true);
    expect(slug).toBe('escape-attempt');
    const r = readReport(slug);
    expect(r?.meta.title).toBe('../../Escape Attempt!!');
    expect(r?.meta.author).toBe('ai-engineer');
    expect(r?.body.trim()).toBe('# hi');
  });

  it('slugify never yields an unsafe slug', () => {
    for (const t of ['', '...', '../../x', '\u0000', '/', '-'.repeat(200), 'ünïcödé', 'a'.repeat(500)]) {
      expect(isSafeSlug(slugify(t)), JSON.stringify(t)).toBe(true);
    }
  });

  it('cannot forge the header through the title or author', () => {
    const slug = writeReport('Real\n---\ntitle: Fake', 'body', 'me\nauthor: root');
    const raw = readFileSync(join(reportsDir(), `${slug}.md`), 'utf8');
    expect(raw.split('\n').filter((l) => l === '---')).toHaveLength(2);
    expect(readReport(slug)?.meta.author).toBe('me author: root');
  });

  it('lists only files it can address by slug', () => {
    writeReport('Good One', 'x', 'me');
    writeFileSync(join(reportsDir(), '.hidden.md'), 'x');
    mkdirSync(join(reportsDir(), 'nested.md'), { recursive: true });
    expect(listReports().map((r) => r.slug)).toEqual(['good-one']);
  });

  /**
   * NTFS is case-insensitive: `Alpha.md` and `alpha.md` are one file. Without
   * folding, an MCP `write_report('alpha')` silently overwrote the human's
   * `Alpha` report while `listReports` kept advertising the other spelling —
   * invisible to both sides of the shared channel.
   */
  it('folds slug case so read, write and list cannot disagree', () => {
    expect(writeReport('Alpha', 'first', 'you', 'Alpha')).toBe('alpha');
    expect(writeReport('Alpha again', 'second', 'attacker', 'alpha')).toBe('alpha');
    expect(writeReport('Alpha yet again', 'third', 'someone', 'ALPHA')).toBe('alpha');

    expect(readdirSync(reportsDir())).toEqual(['alpha.md']);
    for (const spelling of ['Alpha', 'alpha', 'ALPHA', 'aLpHa']) {
      const r = readReport(spelling);
      expect(r?.body.trim(), spelling).toBe('third');
      expect(r?.meta.slug, spelling).toBe('alpha');
    }
    const list = listReports();
    expect(list).toHaveLength(1);
    expect(list[0]!.slug).toBe('alpha');
    expect(readReport(list[0]!.slug)?.body.trim()).toBe('third');
  });

  it('canonicalises a mixed-case file already on disk', () => {
    writeFileSync(join(reportsDir(), 'Legacy.md'), '---\ntitle: Legacy\nauthor: you\n---\n\nold\n');
    expect(listReports().map((r) => r.slug)).toEqual(['legacy']);
    expect(readReport('legacy')?.body.trim()).toBe('old');
  });

  it('resolves the home from YGG_HOME at call time', () => {
    expect(yggHome()).toBe(home);
  });
});
