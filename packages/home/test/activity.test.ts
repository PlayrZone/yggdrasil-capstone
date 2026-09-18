import { appendFileSync, existsSync, mkdtempSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ACTIVITY_BYTES,
  MAX_PENDING_CHARS,
  appendActivity,
  activityPath,
  parseActivityLine,
  recentActivity,
  tailActivity,
  type ActivityLine,
  type ActivityTail,
} from '../src/index.js';

describe('activity feed', () => {
  let home: string;
  let tails: ActivityTail[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-act-'));
    process.env['YGG_HOME'] = home;
    tails = [];
  });
  afterEach(() => {
    for (const t of tails) t.stop();
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  const tail = (sink: ActivityLine[]): ActivityTail => {
    // A long poll: every test drives the drain explicitly via poll().
    const t = tailActivity((lines) => sink.push(...lines), { pollMs: 60_000 });
    tails.push(t);
    return t;
  };

  const raw = (line: string): void => appendFileSync(activityPath(), line);

  it('stamps wall-clock time on append and keeps the sim tick separate', () => {
    appendActivity({ actor: 'ai-engineer', kind: 'advance', summary: 'Day 3', runId: 7, tick: 288 }, 1_700_000_000_000);
    const [line] = recentActivity();
    expect(line).toMatchObject({ wallMs: 1_700_000_000_000, tick: 288, runId: 7, kind: 'advance' });
  });

  it('reads a legacy `at` line as a sim tick, never as a clock', () => {
    raw(`${JSON.stringify({ at: 4321, actor: 'ai-engineer', kind: 'advance', runId: 2, summary: 'Day 12' })}\n`);
    // ...and a legacy line about no run carried a meaningless `at: 0`.
    raw(`${JSON.stringify({ at: 0, actor: 'ai-engineer', kind: 'report', summary: 'Wrote report' })}\n`);
    const [advance, report] = recentActivity();
    expect(advance).toMatchObject({ tick: 4321, runId: 2 });
    expect(advance!.wallMs).toBeUndefined();
    expect(report!.tick).toBeUndefined();
    expect(report!.wallMs).toBeUndefined();
  });

  it('drops malformed lines instead of casting them', () => {
    for (const bad of ['not json', 'null', '123', '"a string"', '[1,2]', '{}', '{"actor":1,"kind":"x","summary":"y"}', '   ']) raw(`${bad}\n`);
    appendActivity({ actor: 'me', kind: 'ok', summary: 'good' });
    expect(recentActivity().map((l) => l.summary)).toEqual(['good']);
    expect(parseActivityLine('{"actor":"a","kind":"b"}')).toBeNull();
  });

  it('keeps only well-formed agent dots', () => {
    raw(`${JSON.stringify({ wallMs: 1, actor: 'a', kind: 'k', summary: 's', agents: [{ id: 1, x: 2, y: 3, state: 0 }, { id: 2 }, null, 'x'] })}\n`);
    expect(recentActivity()[0]!.agents).toEqual([{ id: 1, x: 2, y: 3, state: 0 }]);
  });

  it('tails only the bytes appended since it started', () => {
    for (let i = 0; i < 50; i++) appendActivity({ actor: 'a', kind: 'k', summary: `old ${i}` });
    const before = statSync(activityPath()).size;
    expect(before).toBeGreaterThan(1000);

    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();
    expect(seen).toHaveLength(0);
    expect(t.bytesRead).toBe(0);

    appendActivity({ actor: 'a', kind: 'k', summary: 'new' });
    const appended = statSync(activityPath()).size - before;
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['new']);
    expect(t.bytesRead).toBe(appended);
    expect(t.bytesRead).toBeLessThan(before);
  });

  it('emits a line split across two writes exactly once', () => {
    appendActivity({ actor: 'a', kind: 'k', summary: 'seed' });
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();

    const line = JSON.stringify({ wallMs: 1, actor: 'a', kind: 'k', summary: 'halves' });
    raw(line.slice(0, 12));
    t.poll();
    expect(seen).toHaveLength(0);
    raw(`${line.slice(12)}\n`);
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['halves']);
    t.poll();
    expect(seen).toHaveLength(1);
  });

  it('survives a multi-byte character split across two reads', () => {
    appendActivity({ actor: 'a', kind: 'k', summary: 'seed' });
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();

    const line = Buffer.from(`${JSON.stringify({ wallMs: 1, actor: 'a', kind: 'k', summary: 'héllo — 🌍' })}\n`, 'utf8');
    // Cut inside the 4-byte emoji near the end of the line.
    const cut = line.length - 4;
    appendFileSync(activityPath(), line.subarray(0, cut));
    t.poll();
    appendFileSync(activityPath(), line.subarray(cut));
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['héllo — 🌍']);
  });

  it('recovers when the file is truncated (the old watcher went deaf forever)', () => {
    for (let i = 0; i < 20; i++) appendActivity({ actor: 'a', kind: 'k', summary: `old ${i}` });
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();

    truncateSync(activityPath(), 0);
    t.poll();
    appendActivity({ actor: 'a', kind: 'k', summary: 'after truncate' });
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['after truncate']);
  });

  it('recovers when the file is rotated away', () => {
    for (let i = 0; i < 20; i++) appendActivity({ actor: 'a', kind: 'k', summary: `old ${i}` });
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();

    renameSync(activityPath(), `${activityPath()}.1`);
    appendActivity({ actor: 'a', kind: 'k', summary: 'first of the new file' });
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['first of the new file']);
  });

  it('rotates the feed once it passes the cap and keeps tailing', () => {
    writeFileSync(activityPath(), 'x'.repeat(MAX_ACTIVITY_BYTES));
    const seen: ActivityLine[] = [];
    const t = tail(seen);

    appendActivity({ actor: 'a', kind: 'k', summary: 'after rotation' });
    expect(existsSync(`${activityPath()}.1`)).toBe(true);
    expect(statSync(activityPath()).size).toBeLessThan(MAX_ACTIVITY_BYTES);

    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['after rotation']);
    expect(t.bytesRead).toBeLessThan(1024);
  });

  it('recentActivity reads only the tail of a large file and honours the limit', () => {
    for (let i = 0; i < 500; i++) appendActivity({ actor: 'a', kind: 'k', summary: `line ${i}` });
    expect(recentActivity(10).map((l) => l.summary)).toEqual(Array.from({ length: 10 }, (_, i) => `line ${490 + i}`));
    expect(recentActivity()).toHaveLength(100);
  });

  /**
   * A foreign or crashed writer can leave a huge unterminated line, and
   * `rotateIfLarge` only fires from our own append. The cap used to be applied
   * after the whole unread region had been concatenated, so one poll over 48 MB
   * of it cost ~100 MB of heap. The buffer must stay bounded by the cap plus one
   * read chunk, whatever is on disk.
   */
  it('keeps the partial-line buffer bounded against a huge unterminated line', () => {
    appendActivity({ actor: 'a', kind: 'k', summary: 'seed' });
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();

    const GARBAGE = 16 * 1024 * 1024;
    appendFileSync(activityPath(), 'x'.repeat(GARBAGE));
    t.poll();

    expect(t.bytesRead).toBeGreaterThanOrEqual(GARBAGE);
    expect(t.peakPendingChars).toBeLessThanOrEqual(MAX_PENDING_CHARS);
    expect(t.droppedLines).toBeGreaterThan(0);
    expect(seen).toHaveLength(0);

    // ...and it resyncs at the next newline instead of going deaf.
    appendFileSync(activityPath(), '\n');
    appendActivity({ actor: 'a', kind: 'k', summary: 'back in sync' });
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['back in sync']);
  });

  it('drops an over-long line but keeps the good lines around it', () => {
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    appendActivity({ actor: 'a', kind: 'k', summary: 'before' });
    appendFileSync(activityPath(), `${'y'.repeat(MAX_PENDING_CHARS + 10)}\n`);
    appendActivity({ actor: 'a', kind: 'k', summary: 'after' });
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['before', 'after']);
    expect(t.droppedLines).toBe(1);
    expect(t.peakPendingChars).toBeLessThanOrEqual(MAX_PENDING_CHARS);
  });

  it('returns nothing when the feed does not exist yet', () => {
    expect(recentActivity()).toEqual([]);
    const seen: ActivityLine[] = [];
    const t = tail(seen);
    t.poll();
    expect(seen).toEqual([]);
    appendActivity({ actor: 'a', kind: 'k', summary: 'first ever' });
    t.poll();
    expect(seen.map((l) => l.summary)).toEqual(['first ever']);
  });
});
