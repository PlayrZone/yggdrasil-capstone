import { Experiment, TICKS_PER_DAY } from '@yggdrasil/engine';

/**
 * Wall-clock time model. At 1× one sim-day takes 2 real hours — a calm,
 * watch-it-live pace — and faster rates fast-forward from there. Movement is
 * interpolated between ticks so agents glide instead of teleporting even when
 * a tick is several seconds long.
 */
export const REAL_SECONDS_PER_DAY_AT_1X = 2 * 3600; // 2 hours
export const TICKS_PER_SECOND_AT_1X = TICKS_PER_DAY / REAL_SECONDS_PER_DAY_AT_1X; // ~0.333

export interface SpeedPreset {
  mult: number;
  label: string;
  rate: string;
}

// Each preset shows how long a day takes at that rate.
export const SPEED_PRESETS: SpeedPreset[] = [
  { mult: 1, label: '1×', rate: '2h / day' },
  { mult: 2, label: '2×', rate: '1h / day' },
  { mult: 6, label: '6×', rate: '20m / day' },
  { mult: 30, label: '30×', rate: '4m / day' },
  { mult: 120, label: '120×', rate: '1m / day' },
  { mult: 600, label: '600×', rate: '12s / day' },
  { mult: 2400, label: '2400×', rate: '3s / day' },
];

const MAX_TICKS_PER_FRAME = 4000; // safety cap at extreme speeds

export interface Pos {
  x: number;
  y: number;
}

/**
 * Drives an Experiment against the wall clock and keeps the previous + current
 * tick positions for interpolation. The renderer calls `frameProgress()` to
 * blend them so motion is smooth between (possibly seconds-apart) ticks.
 */
export class SimClock {
  private prev = new Map<number, Pos>();
  private cur = new Map<number, Pos>();
  private lastStepWall = 0;
  private stepDurationMs = 0;
  private accumulator = 0;

  constructor(
    public exp: Experiment,
    private nowMs: () => number,
  ) {
    this.snapshotPositions(this.prev);
    this.snapshotPositions(this.cur);
    this.lastStepWall = nowMs();
  }

  /** Advance by elapsed wall time × rate. Returns ticks advanced this frame. */
  tickFrame(dtMs: number, speedMult: number): number {
    const ticksPerMs = (TICKS_PER_SECOND_AT_1X * speedMult) / 1000;
    this.accumulator += dtMs * ticksPerMs;
    let n = Math.floor(this.accumulator);
    if (n <= 0) return 0;
    this.accumulator -= n;
    if (n > MAX_TICKS_PER_FRAME) n = MAX_TICKS_PER_FRAME;

    // Roll current → previous, advance, capture new current.
    this.prev = this.cur;
    this.cur = new Map();
    this.exp.advance(n);
    this.snapshotPositions(this.cur);

    const now = this.nowMs();
    this.stepDurationMs = Math.max(16, now - this.lastStepWall);
    this.lastStepWall = now;
    return n;
  }

  /** 0..1 progress from the previous tick-state toward the current one. */
  frameProgress(): number {
    if (this.stepDurationMs <= 0) return 1;
    return Math.min(1, (this.nowMs() - this.lastStepWall) / this.stepDurationMs);
  }

  interpolated(): { id: number; x: number; y: number }[] {
    const t = this.frameProgress();
    const out: { id: number; x: number; y: number }[] = [];
    for (const [id, c] of this.cur) {
      const p = this.prev.get(id) ?? c;
      out.push({ id, x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t });
    }
    return out;
  }

  private snapshotPositions(into: Map<number, Pos>): void {
    for (const a of this.exp.agentInfos()) {
      if (a.alive) into.set(a.id, { x: a.x, y: a.y });
    }
  }
}
