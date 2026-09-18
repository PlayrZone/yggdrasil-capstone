import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSafeSlug, readReport, reportsDir, writeReport } from '@yggdrasil/home';

/**
 * `read_report` / `write_report` take a slug from any MCP client. This is the
 * MCP half of the traversal case (the lab half lives in
 * packages/lab/test/reportsIpc.test.ts) plus the schema the tool declares.
 */
const SlugSchema = z.string().refine(isSafeSlug);

const HOSTILE = ['../secret', '..\\secret', '../../../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', 'sub/secret', '..', 'a\u0000b', '', 'a'.repeat(81)];

describe('MCP shared reports', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-mcp-'));
    process.env['YGG_HOME'] = home;
  });
  afterEach(() => {
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  it('rejects a traversal slug at the tool schema', () => {
    for (const slug of HOSTILE) expect(SlugSchema.safeParse(slug).success, slug).toBe(false);
    for (const slug of ['cycle-14', 'exp_1', 'v0.3.6']) expect(SlugSchema.safeParse(slug).success, slug).toBe(true);
  });

  it('rejects a traversal slug at the filesystem seam too', () => {
    writeFileSync(join(home, 'secret.md'), 'top secret');
    for (const slug of HOSTILE) {
      expect(readReport(slug), slug).toBeNull();
      expect(() => writeReport('Pwned', 'x', 'ai-engineer', slug), slug).toThrow();
    }
    expect(readdirSync(reportsDir())).toEqual([]);
    expect(existsSync(join(home, 'Pwned.md'))).toBe(false);
  });

  it('writes and reads a report the AI engineer would produce', () => {
    const slug = writeReport('Phase 3 — Exp 2 First School', '## result\n\nstrong positive', 'ai-engineer');
    expect(slug).toBe('phase-3-exp-2-first-school');
    const r = readReport(slug)!;
    expect(r.meta.author).toBe('ai-engineer');
    expect(r.body.trim()).toBe('## result\n\nstrong positive');
  });
});
