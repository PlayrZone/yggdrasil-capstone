import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReport, reportsDir, writeReport } from '@yggdrasil/home';

/**
 * The lab's `reports:read` / `reports:write` IPC handlers hand the renderer's
 * slug straight to these two functions (main/index.ts). Electron's main cannot
 * be booted in a unit test, so this covers the lab side of the traversal hole
 * at the exact seam the handlers use — the MCP side is covered in
 * packages/mcp/test/reports.test.ts.
 */
describe('lab reports IPC seam', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-lab-'));
    process.env['YGG_HOME'] = home;
  });
  afterEach(() => {
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  it('cannot read a file outside <home>/reports', () => {
    writeFileSync(join(home, 'settings.json'), '{"fireworksKey":"fw_not_a_real_key"}');
    for (const slug of ['../settings', '..\\settings', '../../../../etc/passwd', 'C:\\Windows\\win.ini', '/etc/passwd', 'a\u0000', '']) {
      expect(readReport(slug), slug).toBeNull();
    }
  });

  it('cannot write a file outside <home>/reports', () => {
    for (const slug of ['../pwned', '..\\pwned', 'sub/pwned', '/tmp/pwned', 'C:\\pwned']) {
      expect(() => writeReport('Pwned', 'x', 'you', slug)).toThrow();
    }
    expect(readdirSync(reportsDir())).toEqual([]);
    expect(existsSync(join(home, 'pwned.md'))).toBe(false);
  });

  it('still round-trips a legitimate report', () => {
    const slug = writeReport('Cycle 15 notes', '# findings', 'you');
    expect(readReport(slug)).toMatchObject({ meta: { slug, title: 'Cycle 15 notes', author: 'you' } });
  });
});
