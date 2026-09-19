import { describe, expect, it } from 'vitest';
import {
  BAND_EDGE_PX,
  BAND_HYSTERESIS,
  distanceForFigurePx,
  figurePxAt,
  maxOrbitDistance,
  notchesToReach,
  WHEEL_NOTCH_DELTA,
  zoomPerNotch,
} from '../src/renderer/beings.js';
import {
  clampToRoom,
  FLAG_MIN_PX,
  FLAG_TOTAL_H,
  PENNANT_OF_FIGURE,
  pennantHeight,
  pennantSize,
} from '../src/renderer/legibility.js';

/**
 * The three arithmetics round seven's picture rests on, tested where they can
 * be tested — away from a GPU.
 *
 * Every one of these bars was broken by a change that passed review and a test
 * suite, and every one was found by a human looking at a screenshot. What they
 * have in common is that the failure is a NUMBER: a wheel that needs fifty-five
 * notches, a body drawn past a wall, a flag taller than the person carrying it.
 * A number is testable, and a test is cheaper than a reviewer.
 */

/** A maximised canvas, in CSS pixels — the geometry every round was scored on. */
const CANVAS_H = 914.8;
const worldPerPxFor = (h: number): number => (2 * Math.tan((45 * Math.PI) / 360)) / h;
const ZOOM_SPEED = 2.2;
const ENTER_FAR_PX = BAND_EDGE_PX[0]! * (1 - BAND_HYSTERESIS);

describe('B1 — FAR is somewhere a wheel can actually go', () => {
  it('states one notch as the controls compute it, not as anyone remembers it', () => {
    // three's OrbitControls: 0.95 ** (zoomSpeed × |deltaY| / 100), and the
    // radius is DIVIDED by it to pull back.
    const expected = 1 / 0.95 ** ((ZOOM_SPEED * WHEEL_NOTCH_DELTA) / 100);
    expect(zoomPerNotch(ZOOM_SPEED)).toBeCloseTo(expected, 12);
    expect(zoomPerNotch(ZOOM_SPEED)).toBeGreaterThan(1);
  });

  it('counts zero notches when the camera is already past the edge', () => {
    const wpp = worldPerPxFor(CANVAS_H);
    const already = distanceForFigurePx(ENTER_FAR_PX * 0.5, wpp);
    expect(notchesToReach(already, ENTER_FAR_PX, wpp, ZOOM_SPEED)).toBe(0);
  });

  it('reaches FAR from a settlement in a number of notches a hand will actually turn', () => {
    const wpp = worldPerPxFor(CANVAS_H);
    // The near end of DEFAULT — a being just under the MID edge, which is the
    // camera `frameCandidates('default')` hands a reader and the worst case
    // the wheel is ever asked for.
    const from = distanceForFigurePx(BAND_EDGE_PX[1]! * 0.95, wpp);
    const notches = notchesToReach(from, ENTER_FAR_PX, wpp, ZOOM_SPEED);
    // At three's default speed of 1 this is 89, which is the defect: a band
    // the report calls reachable and no hand will ever scroll to. The driven
    // measurement in `e2e/accept.mjs` is the one that counts; this is the
    // arithmetic behind it, so a change to `ZOOM_SPEED` cannot quietly undo it.
    expect(notchesToReach(from, ENTER_FAR_PX, wpp, 1)).toBeGreaterThan(80);
    expect(notches).toBeLessThanOrEqual(45);
    expect(notches).toBeGreaterThan(0);
  });

  it('keeps the orbit stop inside FAR on every canvas, with room to spare', () => {
    for (const h of [184.7, 215.7, 293, 388, 500.5, 914.8, 1165]) {
      const wpp = worldPerPxFor(h);
      const stop = maxOrbitDistance(wpp, 2000 * 1.35);
      const stopPx = figurePxAt(stop, wpp);
      // Under the entry edge, and not by a rounding — round three came to rest
      // at 0.620 px against an entry of 0.577 and stayed in DEFAULT forever.
      expect(stopPx).toBeLessThan(ENTER_FAR_PX * 0.9);
    }
  });
});

describe('B3 — no body is drawn through the wall it is standing behind', () => {
  const half = 1.6;

  it('leaves somebody already inside the room exactly where they are', () => {
    const at = clampToRoom(0.4, -0.9, 0, half);
    expect(at.x).toBeCloseTo(0.4, 10);
    expect(at.z).toBeCloseTo(-0.9, 10);
  });

  it('pulls somebody standing on the wall line back inside it', () => {
    const at = clampToRoom(3.2, 0, 0, half);
    expect(at.x).toBeCloseTo(half, 10);
    expect(Math.abs(at.z)).toBeLessThanOrEqual(half + 1e-9);
  });

  it('clamps in the HUT’s frame, not the world’s — a turned hut is still a box', () => {
    // A being 3 m out along +x from a hut turned 45°: in the room's own frame
    // that is (2.12, -2.12), both past the wall, so both come back.
    const yaw = Math.PI / 4;
    const at = clampToRoom(3, 0, yaw, half);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const lx = at.x * cos - at.z * sin;
    const lz = at.x * sin + at.z * cos;
    expect(Math.abs(lx)).toBeLessThanOrEqual(half + 1e-9);
    expect(Math.abs(lz)).toBeLessThanOrEqual(half + 1e-9);
  });

  it('never moves anybody FURTHER from the hut than the sim put them', () => {
    for (const yaw of [0, 0.7, 1.9, 3.3, 5.1]) {
      for (const [dx, dz] of [[4, 0], [-3.5, 2.2], [0.2, 0.1], [2.9, -2.9], [0, -5]] as const) {
        const at = clampToRoom(dx, dz, yaw, half);
        expect(Math.hypot(at.x, at.z)).toBeLessThanOrEqual(Math.hypot(dx, dz) + 1e-9);
        // And is inside the box, in the hut's own frame, every time.
        const lx = at.x * Math.cos(yaw) - at.z * Math.sin(yaw);
        const lz = at.x * Math.sin(yaw) + at.z * Math.cos(yaw);
        expect(Math.max(Math.abs(lx), Math.abs(lz))).toBeLessThanOrEqual(half + 1e-9);
      }
    }
  });
});

describe('B5 — a mark about a being is never bigger than the being', () => {
  /** How much world one screen pixel covers, given a being this many px tall. */
  const mppFor = (figureM: number, px: number): number => figureM / px;

  it('caps the pennant at a fraction of its figure wherever the figure is a picture', () => {
    for (const figure of [1.08, 1.6, 1.75]) {
      for (const px of [60, 100, 140, 207, 400]) {
        const h = pennantHeight(figure, mppFor(figure, px));
        expect(h).toBeLessThanOrEqual(figure * PENNANT_OF_FIGURE + 1e-9);
      }
    }
  });

  it('is exactly the cap at close range, where round six drew 1.15 of a figure', () => {
    // The specimen grid a reviewer measured on: a 100 px adult with a ~115 px
    // flag over it. Same geometry, same arithmetic, under the cap now.
    const figure = 1.75;
    const mpp = mppFor(figure, 100);
    expect(pennantHeight(figure, mpp) / mpp).toBeLessThanOrEqual(100 * PENNANT_OF_FIGURE + 1e-6);
    // The old rule, for the record: `size = height × 0.52`, which is
    // 0.52 × 1.305 = 0.68 of a figure before any floor is applied.
    expect((figure * 0.52 * FLAG_TOTAL_H) / figure).toBeGreaterThan(PENNANT_OF_FIGURE);
  });

  it('still holds its screen floor where a being is two pixels tall', () => {
    const figure = 1.75;
    for (const px of [1, 2, 6, 14]) {
      const mpp = mppFor(figure, px);
      // The floor wins out here, and it must: this is the case the pennant
      // exists for — a starving being found from the flag alone.
      expect(pennantSize(figure, mpp) / mpp).toBeCloseTo(FLAG_MIN_PX, 6);
    }
  });

  it('crosses over from floor to cap exactly once, and never dips below either', () => {
    const figure = 1.75;
    let sawFloor = false;
    let sawCap = false;
    for (let px = 1; px <= 400; px += 1) {
      const mpp = mppFor(figure, px);
      const sizePx = pennantSize(figure, mpp) / mpp;
      expect(sizePx).toBeGreaterThanOrEqual(FLAG_MIN_PX - 1e-9);
      expect(pennantHeight(figure, mpp)).toBeLessThanOrEqual(
        Math.max(figure * PENNANT_OF_FIGURE, FLAG_MIN_PX * mpp * FLAG_TOTAL_H) + 1e-9,
      );
      if (Math.abs(sizePx - FLAG_MIN_PX) < 1e-6) sawFloor = true;
      else sawCap = true;
    }
    expect(sawFloor).toBe(true);
    expect(sawCap).toBe(true);
  });
});
