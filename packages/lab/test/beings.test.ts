import { describe, expect, it } from 'vitest';
import {
  activityWord,
  badgeMetres,
  BAND_EDGE_PX,
  BAND_ORDER,
  bandCountsBeings,
  bandForPixels,
  bandPromise,
  bandShowsBodies,
  bandShowsDetail,
  DETAIL_MIN_PX,
  distanceForFigurePx,
  GHOST_NOTE,
  maxOrbitDistance,
  ADULT_M,
  annotationOpacity,
  annotationRadius,
  ANNOTATION_MIN_M,
  bodyTint,
  CHILD_M,
  CLUSTER_SPLIT_AT,
  clusterBeings,
  clusterHierarchy,
  conditionHue,
  conditionWord,
  COUNT_NOTE,
  INSIDE_NOTE,
  describeState,
  designationFor,
  displayName,
  focusShiftPx,
  FPS_ACTIVE,
  FPS_HIDDEN,
  FPS_IDLE,
  headingOctant,
  hex,
  HUE_DANGER,
  HUE_SICK,
  HUE_STARVING,
  HUE_WELL,
  labelBudgetFor,
  labelClearanceFor,
  LABEL_BUDGET_MAX,
  labelWidth,
  ELDER_M,
  figurePxAt,
  figureSpread,
  FIGURE_HALF_W,
  LEGEND_EXTRA,
  legendFor,
  maxLeaderFor,
  movingFor,
  nameClaimFor,
  namePlan,
  NAME_NOTE,
  NEAR_LABEL_M,
  PICTO_MAX_OF_FIGURE,
  nextFrameAt,
  octantDistance,
  placeCountChip,
  regionOf,
  scaleBarFor,
  PICTO_ALARM,
  PICTO_COUNT,
  PICTO_EAT,
  PICTO_GRID,
  PICTO_NONE,
  PICTO_REST,
  PICTO_SPEAK,
  PICTO_WORK,
  pictogramFor,
  placeLabels,
  planCount,
  readableActivity,
  RING_DASHED,
  RING_DOUBLE,
  RING_NOTCHED,
  RING_SOLID,
  RING_STYLE_COUNT,
  ringStyleFor,
  SCALE_NOTE,
  stageFootprint,
  stageForm,
  STAGE_FORM,
  stageCore,
  stageWord,
  targetFps,
  type LabelCandidate,
  type LegendItem,
  type ScreenPoint,
  type ZoomBand,
} from '../src/renderer/beings.js';
import { PICTO_SVG } from '../src/renderer/glyphs.js';
import {
  doorwayClear,
  insideParts,
  isSpecimenId,
  packSubjects,
  READABLE_MARK_PX,
  SHELTER,
  SHELTER_FOOTPRINT,
  SHELTER_PARTS,
  shelterMeasure,
  specimenPlan,
  SPECIMEN_COLS,
  SPECIMEN_GRID_ROWS,
  SPECIMEN_ID_BASE,
  SPECIMEN_KNOTS,
  SPECIMEN_REQUIRED,
  SPECIMEN_ROWS,
  SPECIMEN_SPACING,
  subjectCovers,
  SUBJECT_R,
  SUBJECT_SLOTS,
  XRAY_MIN_BODY_PX,
  type Subject,
} from '../src/renderer/legibility.js';
import {
  ACT_COUNT,
  ACT_DANGER,
  ACT_DRINKING,
  ACT_EATING,
  ACT_IDLE,
  ACT_RESTING,
  ACT_SOCIAL,
  ACT_WALKING,
  ACT_WORKING,
  COND_HURT,
  COND_SICK,
  COND_STARVING,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
} from '../src/renderer/sim/protocol.js';

/**
 * The continent's span, the camera the app opens on, and the projection the
 * view actually runs at — a 45 degree field over an 837 px canvas.
 */
const WORLD = 2000;
const OPENING_DISTANCE = Math.hypot(WORLD * 0.26, WORLD * 0.5 - 40, WORLD * 0.47);
const WORLD_PER_PX = (2 * Math.tan((45 * Math.PI) / 360)) / 630;

// ── Colour vision ────────────────────────────────────────────────────────────

/**
 * Viénot–Brettel–Mollon dichromat simulation, applied in linear RGB, plus CIE
 * L*a*b* so two colours can be compared the way an eye compares them.
 *
 * This is here because round one of this view failed exactly this check in the
 * field and not in the build: a reviewer simulated the screenshots and found
 * the "in danger" rose and the "starving" amber landing on the same olive. A
 * palette claim that only a human with the right eyes can falsify is not a
 * claim, so the matrices live in the test suite and the build fails if any two
 * conditions come close under either deficiency.
 */
const PROTANOPIA = [0.11238, 0.88762, 0, 0.11238, 0.88762, 0, 0.00401, -0.00401, 1];
const DEUTERANOPIA = [0.29275, 0.70725, 0, 0.29275, 0.70725, 0, -0.02234, 0.02234, 1];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgbOf = (h: number): number[] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

function simulate(hexColor: number, m: number[] | null): number[] {
  const [r, g, b] = rgbOf(hexColor).map(toLinear) as [number, number, number];
  if (!m) return [r, g, b];
  return [
    m[0]! * r + m[1]! * g + m[2]! * b,
    m[3]! * r + m[4]! * g + m[5]! * b,
    m[6]! * r + m[7]! * g + m[8]! * b,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

/** CIE L*a*b* from LINEAR rgb. */
function lab(linear: number[]): [number, number, number] {
  const [r, g, b] = linear as [number, number, number];
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i]!, xs[j]!]);
  return out;
}

describe('condition survives a colour-blind reader', () => {
  const CONDITIONS = [HUE_WELL, HUE_STARVING, HUE_SICK, HUE_DANGER];

  it('keeps every pair of ring colours apart under deuteranopia and protanopia', () => {
    for (const m of [null, DEUTERANOPIA, PROTANOPIA]) {
      for (const [a, b] of pairs(CONDITIONS)) {
        const la = lab(simulate(a, m));
        const lb = lab(simulate(b, m));
        expect(deltaE(la, lb)).toBeGreaterThan(45);
        // Lightness is the channel no deficiency touches, so it carries the
        // pair that fused in round one — amber against blood — on its own.
        expect(Math.abs(la[0] - lb[0])).toBeGreaterThan(12);
      }
    }
  });

  it('keeps the four BODY colours apart, and none of them dark enough to vanish at night', () => {
    const bodies = CONDITIONS.map(bodyTint);
    expect(new Set(bodies).size).toBe(4);
    for (const body of bodies) expect(lab(simulate(body, null))[0]).toBeGreaterThan(45);
    for (const m of [DEUTERANOPIA, PROTANOPIA]) {
      for (const [a, b] of pairs(bodies)) {
        const la = lab(simulate(a, m));
        const lb = lab(simulate(b, m));
        expect(deltaE(la, lb)).toBeGreaterThan(30);
        expect(Math.abs(la[0] - lb[0])).toBeGreaterThan(9);
      }
    }
  });

  it('gives every condition its own ring shape, so colour is never the only channel', () => {
    const styles = [
      ringStyleFor(0, ACT_IDLE),
      ringStyleFor(COND_STARVING, ACT_IDLE),
      ringStyleFor(COND_SICK, ACT_IDLE),
      ringStyleFor(COND_HURT, ACT_IDLE),
    ];
    expect(styles).toEqual([RING_SOLID, RING_DASHED, RING_DOUBLE, RING_NOTCHED]);
    expect(new Set(styles).size).toBe(RING_STYLE_COUNT);
    expect(ringStyleFor(0, ACT_DANGER)).toBe(RING_NOTCHED);
  });

  it('agrees with itself: one precedence for the colour, the ring and the word', () => {
    const cond = COND_SICK | COND_STARVING;
    expect(conditionHue(cond, ACT_IDLE)).toBe(HUE_SICK);
    expect(ringStyleFor(cond, ACT_IDLE)).toBe(RING_DOUBLE);
    expect(conditionWord(cond, ACT_IDLE)).toBe('sick');
  });
});

// ── Semantic zoom ────────────────────────────────────────────────────────────

describe('the world is life-size, and the bands are read off how big a being IS', () => {
  it('draws a being the size of a being, and nothing else', () => {
    expect(ADULT_M).toBeGreaterThanOrEqual(1.6);
    expect(ADULT_M).toBeLessThanOrEqual(1.9);
    expect(CHILD_M).toBeGreaterThanOrEqual(0.95);
    expect(CHILD_M).toBeLessThanOrEqual(1.25);
    expect(ELDER_M).toBeLessThan(ADULT_M);
    expect(ELDER_M).toBeGreaterThan(1.4);
    expect(stageForm(STAGE_ADULT).scale).toBe(ADULT_M);
    expect(stageForm(STAGE_CHILD).scale).toBe(CHILD_M);
    expect(stageForm(STAGE_ELDER).scale).toBe(ELDER_M);
  });

  it('shrinks with distance exactly the way a real thing does', () => {
    // Twice as far, half as tall. No curve, no floor, no ceiling: this is the
    // projection, and rounds one and two broke it on purpose to be legible.
    expect(figurePxAt(40, WORLD_PER_PX)).toBeCloseTo(figurePxAt(80, WORLD_PER_PX) * 2, 6);
    expect(figurePxAt(1454, WORLD_PER_PX)).toBeLessThan(2);
    expect(figurePxAt(2700, WORLD_PER_PX)).toBeLessThan(1);
  });

  it('puts the camera the app opens on in DEFAULT, and the whole continent in FAR', () => {
    expect(bandForPixels(figurePxAt(OPENING_DISTANCE, WORLD_PER_PX))).toBe('default');
    expect(bandForPixels(figurePxAt(WORLD * 1.35, WORLD_PER_PX))).toBe('far');
  });

  it('reaches MID and NEAR by bringing the camera in, not by growing anyone', () => {
    // A village from a rooftop, and then the street.
    expect(bandForPixels(figurePxAt(30, WORLD_PER_PX))).toBe('mid');
    expect(bandForPixels(figurePxAt(8, WORLD_PER_PX))).toBe('near');
    // Thirty-odd metres up and eleven metres out: a roof, and a conversation.
    expect(1.75 / (BAND_EDGE_PX[1]! * WORLD_PER_PX)).toBeGreaterThan(20);
    expect(1.75 / (BAND_EDGE_PX[1]! * WORLD_PER_PX)).toBeLessThan(60);
    expect(1.75 / (BAND_EDGE_PX[2]! * WORLD_PER_PX)).toBeLessThan(15);
    // Whatever distance MID starts at, a being really is forty pixels there.
    for (let d = 3; d <= WORLD * 1.35; d += 1) {
      const px = figurePxAt(d, WORLD_PER_PX);
      if (bandShowsDetail(bandForPixels(px))) expect(px).toBeGreaterThanOrEqual(BAND_EDGE_PX[1]!);
    }
  });

  it('reaches every band inside the orbit the view allows', () => {
    const reached = new Set<ZoomBand>();
    const stop = maxOrbitDistance(WORLD_PER_PX, WORLD * 1.35);
    for (let d = 3; d <= stop; d += 3) reached.add(bandForPixels(figurePxAt(d, WORLD_PER_PX)));
    expect(reached).toEqual(new Set(BAND_ORDER));
  });

  /**
   * Round four could not enter FAR at all on a maximized window, and the cause
   * was a unit mismatch and nothing else: the bands are stated in pixels of
   * being, which depend on the canvas, and the orbit's stop was 1.35 world
   * spans, which does not. Making the window bigger deleted a contract.
   */
  it('reaches FAR on every window this view can be opened at', () => {
    for (const height of [400, 630, 837, 1000, 1164.75, 1440, 2000]) {
      const perPx = (2 * Math.tan((45 * Math.PI) / 360)) / height;
      const stop = maxOrbitDistance(perPx, WORLD * 1.35);
      // Not merely reachable AT the stop — reachable with the hysteresis
      // crossed, from the band next door, which is how a camera arrives.
      expect(bandForPixels(figurePxAt(stop, perPx), 'default')).toBe('far');
      expect(bandForPixels(figurePxAt(stop, perPx))).toBe('far');
      // And every other band still exists inside the same orbit.
      const reached = new Set<ZoomBand>();
      for (let d = 3; d <= stop; d += Math.max(1, stop / 900)) {
        reached.add(bandForPixels(figurePxAt(d, perPx)));
      }
      expect(reached).toEqual(new Set(BAND_ORDER));
      // A tall window pulls further back; it never pulls IN, or the wide shot
      // would get narrower the more screen you gave it.
      expect(stop).toBeGreaterThanOrEqual(WORLD * 1.35);
    }
  });

  /**
   * The wheel, simulated: OrbitControls multiplies the orbit radius per notch
   * and clamps it to `maxDistance`, and the band walks with hysteresis from
   * wherever the camera already was. Round seven wheeled 120 notches into the
   * stop on a maximized window and came to rest at 0.620 px — the FAR edge
   * itself — with the strip still reading DEFAULT, so the band existed and no
   * mouse could enter it. This is that test, at every window and aspect this
   * view opens at: turn the wheel until it stops, and be in FAR, and STAY in
   * FAR for another hundred notches against the stop.
   */
  it('reaches FAR with the WHEEL — and stays there — on every window', () => {
    // Every shape a window is opened at, as width × height in CSS pixels —
    // 4:3, 16:9, ultrawide, and the maximized canvas a reviewer measured.
    const canvases: [number, number][] = [
      [1024, 768], [1280, 720], [1366, 630], [1600, 837], [1920, 1080],
      [2188, 914.8], [2560, 1080], [3440, 1164.75], [3840, 2160],
    ];
    for (const [w, h] of canvases) {
      // The projection is a fact about the HEIGHT: a being's size on screen is
      // its height in metres over the height of the frustum. The width is in
      // here only to show that it never enters.
      const perPx = (2 * Math.tan((45 * Math.PI) / 360)) / h;
      const stop = maxOrbitDistance(perPx, WORLD * 1.35);
      // The default camera: about seven tenths of a world span out.
      let d = Math.min(stop, WORLD * 0.72);
      let band = bandForPixels(figurePxAt(d, perPx));
      let entered = -1;
      for (let notch = 0; notch < 220; notch++) {
        // three's `_getZoomScale`: 0.95 ^ |deltaY × 0.01| per notch, deltaY 100.
        d = Math.min(stop, d / 0.95);
        band = bandForPixels(figurePxAt(d, perPx), band);
        if (band === 'far' && entered < 0) entered = notch;
      }
      // Entered, well before the wheel gives up — and still there at the stop,
      // which is the half of it that the hysteresis breaks if the stop is sized
      // for the edge rather than for the crossing.
      expect({ w, h, band }).toEqual({ w, h, band: 'far' });
      expect(entered).toBeGreaterThanOrEqual(0);
      expect(entered).toBeLessThan(160);
      expect(d).toBeCloseTo(stop, 6);
    }
  });

  it('states the orbit stop in the same unit as the band it is there to reach', () => {
    const perPx = (2 * Math.tan((45 * Math.PI) / 360)) / 1164.75;
    const stop = maxOrbitDistance(perPx, 0);
    // The stop IS a statement about how big a being is, with headroom past the
    // edge — not a number of world spans that happens to work on one canvas.
    expect(figurePxAt(stop, perPx)).toBeLessThan(BAND_EDGE_PX[0]! * (1 - 0.07));
    expect(distanceForFigurePx(figurePxAt(stop, perPx), perPx)).toBeCloseTo(stop, 6);
  });

  it('orders the bands wide-to-close, once each', () => {
    expect(BAND_ORDER).toEqual(['far', 'default', 'mid', 'near']);
    expect(BAND_EDGE_PX).toHaveLength(BAND_ORDER.length - 1);
    for (let i = 1; i < BAND_EDGE_PX.length; i++) expect(BAND_EDGE_PX[i]!).toBeGreaterThan(BAND_EDGE_PX[i - 1]!);
  });
});

describe('the map over the world holds its own size, and then gets out of the way', () => {
  const ringPx = (d: number): number => (annotationRadius(d, WORLD_PER_PX) / (d * WORLD_PER_PX)) * 2;

  it('is a constant-size pin wherever a being is too small to be a picture', () => {
    for (const d of [400, 900, 1454, 2000, 2700]) {
      expect(figurePxAt(d, WORLD_PER_PX)).toBeLessThan(BAND_EDGE_PX[1]!);
      expect(ringPx(d)).toBeCloseTo(ringPx(1454), 4);
    }
    // ...and that pin is big enough to count and to click.
    expect(ringPx(1454)).toBeGreaterThan(16);
  });

  it('stops growing in metres once it is the size of the ground a being stands on', () => {
    expect(annotationRadius(20, WORLD_PER_PX)).toBe(ANNOTATION_MIN_M);
    expect(annotationRadius(5, WORLD_PER_PX)).toBe(ANNOTATION_MIN_M);
    expect(ANNOTATION_MIN_M).toBeLessThan(ADULT_M); // never wider than the being is tall
  });

  it('never jumps: the two rules meet at the same number', () => {
    let previous = 0;
    for (let d = 3; d <= 2700; d += 1) {
      const r = annotationRadius(d, WORLD_PER_PX);
      expect(r).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = r;
    }
    const knee = ANNOTATION_MIN_M / (10.5 * WORLD_PER_PX);
    expect(annotationRadius(knee - 0.02, WORLD_PER_PX)).toBeCloseTo(annotationRadius(knee + 0.02, WORLD_PER_PX), 3);
  });

  it('fades back as the real scene takes over', () => {
    expect(annotationOpacity('far')).toBeGreaterThan(annotationOpacity('mid'));
    expect(annotationOpacity('mid')).toBeGreaterThan(annotationOpacity('near'));
    expect(annotationOpacity('near')).toBeGreaterThan(0.2); // faded, never gone
    expect(annotationOpacity('far')).toBe(annotationOpacity('default'));
  });
});

describe('the band does not flicker', () => {
  it('holds its band while the camera hovers on an edge', () => {
    for (const edge of BAND_EDGE_PX) {
      for (const start of ['far', 'default', 'mid', 'near'] as ZoomBand[]) {
        let band = start;
        const seen = new Set<ZoomBand>([band]);
        // Twenty frames of a hand resting on a scroll wheel, a couple of
        // percent either side of the edge. Without hysteresis this rewrites
        // the legend and the whole vocabulary twenty times.
        for (let n = 0; n < 20; n++) {
          band = bandForPixels(edge * (n % 2 === 0 ? 0.98 : 1.02), band);
          seen.add(band);
        }
        expect(seen.size).toBeLessThanOrEqual(2);
      }
    }
  });

  it('settles, once moved, rather than oscillating', () => {
    let band = bandForPixels(20);
    for (let n = 0; n < 40; n++) band = bandForPixels(60, band);
    expect(band).toBe('mid');
    for (let n = 0; n < 40; n++) band = bandForPixels(60, band);
    expect(band).toBe('mid');
  });

  it('still crosses when the camera really moves, in one step', () => {
    expect(bandForPixels(300, 'far')).toBe('near');
    expect(bandForPixels(0.3, 'near')).toBe('far');
  });

  it('agrees with a cold start once it is clear of the edges', () => {
    for (const px of [0.3, 2, 13, 25, 34, 55, 100, 150, 400]) {
      for (const start of BAND_ORDER) expect(bandForPixels(px, start)).toBe(bandForPixels(px));
    }
  });
});

describe('a band promises only what it draws', () => {
  it('promises a count only where every being in frame is actually drawn', () => {
    for (const band of BAND_ORDER) {
      const p = bandPromise(band);
      expect(p.band).toBe(band);
      // Close in, the far side of the valley is in frame and is half a pixel
      // wide. A count there would be a count of things the view is not drawing.
      expect(p.count === null).toBe(bandShowsDetail(band));
      expect(p.selected).toBe(1);
      expect(p.condition === null).toBe(!bandShowsBodies(band));
      for (const channel of [p.stage, p.activity, p.heading]) {
        expect(channel === null).toBe(!bandShowsDetail(band));
      }
      expect(p.says.length).toBeGreaterThan(0);
    }
  });

  it('asks more of itself the closer it gets', () => {
    expect(bandPromise('mid').condition!).toBeGreaterThan(bandPromise('default').condition!);
    expect(bandPromise('near').stage!).toBeGreaterThan(bandPromise('mid').stage!);
    // There is no `all`: "every being on screen is named" was never true on a
    // frame with more beings in it than the budget has nodes.
    expect(bandPromise('near').names).toBe('within');
    expect(bandPromise('far').names).toBe('found');
  });

  it('answers nothing about a channel it does not draw', () => {
    for (const band of BAND_ORDER) {
      for (let act = 0; act < ACT_COUNT; act++) {
        expect(readableActivity(act, band) === null).toBe(!bandShowsDetail(band));
      }
      expect(stageCore(STAGE_ELDER, band)).toBe(bandShowsDetail(band));
      expect(stageFootprint(STAGE_CHILD, band) < 1).toBe(bandShowsDetail(band));
    }
  });

  it('spends more names the fewer beings there are to name', () => {
    const budgets = BAND_ORDER.map(labelBudgetFor);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]!).toBeGreaterThan(budgets[i - 1]!);
    for (const b of budgets) expect(b).toBeLessThanOrEqual(LABEL_BUDGET_MAX);
  });
});

describe('the pictogram vocabulary', () => {
  it('is six marks, and every one of them means exactly one thing', () => {
    expect(PICTO_COUNT).toBe(6);
    expect(PICTO_COUNT).toBeLessThanOrEqual(PICTO_GRID * PICTO_GRID);
    const byMark = new Map<number, string[]>();
    for (let act = 0; act < ACT_COUNT; act++) {
      const p = pictogramFor(act);
      const word = readableActivity(act, 'mid')!;
      const list = byMark.get(p);
      if (list) list.push(word);
      else byMark.set(p, [word]);
    }
    // Every mark maps to one word, except the blank, which is the two states
    // the streak tells apart.
    for (const [p, words] of byMark) {
      expect(new Set(words).size).toBe(p === PICTO_NONE ? 2 : 1);
    }
    expect(new Set(byMark.get(PICTO_NONE))).toEqual(new Set(['standing', 'walking']));
  });

  it('leaves the ordinary unmarked, so a hundred beings stay calm enough to count', () => {
    expect(pictogramFor(ACT_IDLE)).toBe(PICTO_NONE);
    expect(pictogramFor(ACT_WALKING)).toBe(PICTO_NONE);
    expect(conditionHue(0, ACT_WALKING)).toBe(HUE_WELL);
    expect(ringStyleFor(0, ACT_WALKING)).toBe(RING_SOLID);
  });

  it('reads eating and drinking as one mark, and says so', () => {
    expect(pictogramFor(ACT_EATING)).toBe(PICTO_EAT);
    expect(pictogramFor(ACT_DRINKING)).toBe(PICTO_EAT);
    expect(readableActivity(ACT_EATING, 'mid')).toBe(readableActivity(ACT_DRINKING, 'mid'));
    // …and the sim still knows the difference, which is why the two reads exist.
    expect(activityWord(ACT_EATING)).not.toBe(activityWord(ACT_DRINKING));
  });

  it('never lets one mark mean two things — the triangle is fleeing, and hurt is a ring', () => {
    expect(pictogramFor(ACT_DANGER)).toBe(PICTO_ALARM);
    // A being that is hurt but walking is NOT drawn as fleeing: its ring is
    // notched and its mark is the blank one, which is what "walking" looks like.
    expect(pictogramFor(ACT_WALKING)).toBe(PICTO_NONE);
    expect(ringStyleFor(COND_HURT, ACT_WALKING)).toBe(RING_NOTCHED);
    expect(readableActivity(ACT_WALKING, 'mid')).toBe('walking');
    expect(conditionWord(COND_HURT, ACT_WALKING)).toBe('in danger');
  });

  it('never lets a condition take the activity mark', () => {
    for (const cond of [COND_SICK, COND_STARVING, COND_HURT]) {
      expect(pictogramFor(ACT_WORKING)).toBe(PICTO_WORK);
      expect(conditionHue(cond, ACT_WORKING)).not.toBe(HUE_WELL);
      expect(ringStyleFor(cond, ACT_WORKING)).not.toBe(RING_SOLID);
    }
  });

  it('draws a symbol for every mark that is not the blank one', () => {
    for (const p of [PICTO_REST, PICTO_EAT, PICTO_WORK, PICTO_SPEAK, PICTO_ALARM]) {
      expect(PICTO_SVG[p]).toBeTruthy();
    }
    expect(PICTO_SVG[PICTO_NONE]).toBeUndefined();
    expect(new Set(Object.values(PICTO_SVG)).size).toBe(PICTO_COUNT - 1);
  });

  it('says what a being is doing in words a stranger can read', () => {
    expect(describeState(ACT_RESTING, 0)).toBe('asleep');
    expect(describeState(ACT_WORKING, COND_STARVING)).toBe('gathering or building · starving');
    expect(describeState(ACT_WALKING, COND_SICK | COND_HURT)).toBe('walking · sick, hurt');
    for (let act = 0; act < ACT_COUNT; act++) {
      expect(describeState(act, 0).length).toBeGreaterThan(0);
      expect(activityWord(act).length).toBeGreaterThan(0);
      expect(readableActivity(act, 'near')!.length).toBeGreaterThan(0);
    }
  });

  it('names the three life stages', () => {
    expect(stageWord(STAGE_CHILD)).toBe('child');
    expect(stageWord(STAGE_ELDER)).toBe('elder');
  });
});

describe('a life stage is a footprint as well as a silhouette', () => {
  it('keeps a child unmistakable, and does NOT fake an elder by shrinking them', () => {
    // A child is two-thirds of an adult, which is true of children. An elder
    // is a hand shorter, which is true of elders and is nowhere near enough to
    // read - which is exactly why the stoop, the staff and the filled centre
    // on the ground exist. Round two's answer was to make people the size of
    // houses; a real elder is 1.6 m and stays 1.6 m.
    expect(CHILD_M / ADULT_M).toBeLessThan(0.7);
    expect(ADULT_M - ELDER_M).toBeLessThan(0.3);
    expect(stageForm(STAGE_ELDER).stoop).toBeGreaterThan(0.4);
    expect(stageForm(STAGE_ELDER).core).toBe(true);
  });

  it('gives a child and an elder a second cue that is not height', () => {
    const child = stageForm(STAGE_CHILD);
    const adult = stageForm(STAGE_ADULT);
    const elder = stageForm(STAGE_ELDER);
    expect(child.head).toBeGreaterThan(adult.head * 1.5);
    expect(elder.stoop).toBeGreaterThan(0.4);
    expect(elder.prop).toBe('staff');
    expect(adult.stoop).toBe(0);
    expect(adult.prop).toBe('none');
  });

  it('puts the stage on the GROUND too, where nothing foreshortens', () => {
    // A body seen from an oblique-top camera is mostly hidden behind its own
    // head; the mark it stands in is not. Three forms, all different.
    // A child's pin is PLAINLY smaller, not marginally: round three's 0.68
    // against an adult was a difference a stranger had to be looking for.
    expect(stageFootprint(STAGE_CHILD, 'mid')).toBeLessThanOrEqual(0.6);
    expect(stageFootprint(STAGE_ADULT, 'mid')).toBe(1);
    expect(stageFootprint(STAGE_ELDER, 'mid')).toBe(1);
    expect(stageCore(STAGE_ELDER, 'mid')).toBe(true);
    expect(stageCore(STAGE_ADULT, 'mid')).toBe(false);
    expect(stageCore(STAGE_CHILD, 'mid')).toBe(false);
    // The adult and the elder share a size, so the FILLED CENTRE is the whole
    // of what tells them apart on the ground — and only one of the three has
    // it. Filled against hollow is a difference of area, which is the kind
    // that survives twenty-four pixels; round three's extra hairline ring
    // three pixels outside the rim was not, and stage read at 40%.
    expect(STAGE_FORM.filter((f) => f.core)).toHaveLength(1);
    expect(stageForm(STAGE_CHILD).core).toBe(false);
    expect(stageForm(STAGE_ADULT).core).toBe(false);
  });

  it('makes every mark the same size where the contract is countability', () => {
    for (const band of ['far', 'default'] as ZoomBand[]) {
      for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
        expect(stageFootprint(stage, band)).toBe(1);
        expect(stageCore(stage, band)).toBe(false);
      }
    }
  });

  it('is the same table the legend prints', () => {
    expect(STAGE_FORM.map((f) => f.label)).toEqual(['child', 'adult', 'elder']);
  });
});

// ── The legend ───────────────────────────────────────────────────────────────

function itemsOf(band: ZoomBand): LegendItem[] {
  return legendFor(band).flatMap((s) => s.items);
}

describe('the legend describes the band it is in, and nothing else', () => {
  it('lists pictograms only where pictograms are drawn', () => {
    for (const band of BAND_ORDER) {
      const pictos = itemsOf(band).filter((i) => i.kind === 'picto');
      expect(pictos.length > 0).toBe(bandShowsDetail(band));
    }
  });

  it('explains every pictogram the view can draw, exactly once, where it draws them', () => {
    const drawn = new Set<number>();
    for (let act = 0; act < ACT_COUNT; act++) {
      const p = pictogramFor(act);
      if (p !== PICTO_NONE) drawn.add(p);
    }
    for (const band of ['mid', 'near'] as ZoomBand[]) {
      const listed = itemsOf(band).filter((i) => i.kind === 'picto').map((i) => i.picto);
      expect(new Set(listed)).toEqual(drawn);
      expect(listed).toHaveLength(drawn.size);
      expect(listed).not.toContain(PICTO_NONE);
    }
  });

  it('lists every colour and ring the view can give a being, and nothing else', () => {
    const painted = new Set<number>([
      conditionHue(0, ACT_IDLE), conditionHue(COND_SICK, ACT_IDLE),
      conditionHue(COND_STARVING, ACT_IDLE), conditionHue(COND_HURT, ACT_IDLE),
    ]);
    for (const band of ['default', 'mid', 'near'] as ZoomBand[]) {
      const markers = itemsOf(band).filter((i) => i.kind === 'marker');
      const conditionRows = markers.filter((m) => m.hue !== HUE_WELL || m.ring === RING_SOLID);
      expect(new Set(conditionRows.map((m) => m.hue))).toEqual(painted);
      expect(new Set(markers.map((m) => m.ring))).toEqual(
        new Set([RING_SOLID, RING_DASHED, RING_DOUBLE, RING_NOTCHED]),
      );
    }
  });

  it('claims no condition at FAR, where a dot carries none', () => {
    const far = itemsOf('far');
    expect(far.filter((i) => i.kind === 'marker')).toHaveLength(0);
    expect(far.some((i) => i.kind === 'dot')).toBe(true);
    expect(far.some((i) => i.kind === 'chip')).toBe(true);
  });

  it('shows the age forms and the streak only where they are drawn', () => {
    for (const band of BAND_ORDER) {
      const markers = itemsOf(band).filter((i) => i.kind === 'marker');
      expect(markers.some((m) => m.core)).toBe(bandShowsDetail(band));
      expect(markers.some((m) => m.footprint < 1)).toBe(bandShowsDetail(band));
      expect(markers.some((m) => m.streak)).toBe(bandShowsDetail(band));
    }
  });

  it('never promises names on everyone except where it means it', () => {
    const near = legendFor('near').flatMap((s) => s.items).filter((i) => i.kind === 'note');
    expect(near.some((n) => n.label.includes('named'))).toBe(true);
    for (const band of ['far', 'default', 'mid'] as ZoomBand[]) {
      expect(itemsOf(band).filter((i) => i.kind === 'note').some((n) => n.label.includes('named'))).toBe(false);
    }
  });

  /**
   * "Every being in frame is named" could not be made true — at NEAR the far
   * side of the valley is in frame and half a pixel wide — and round four
   * printed it over nineteen beings and four names. Round eight replaced it
   * with a measured RADIUS, which was true and useless: the budgeter still
   * chose by rank, so the radius collapsed to nothing under four drawn names
   * and a reviewer read "NAMES WITHIN 0 M · 4 SHOWN". The RULE is the claim
   * now — nearest first, and nobody named past somebody nearer who is not.
   */
  it('scopes the NEAR naming claim to something the picture can keep', () => {
    expect(bandPromise('near').namesWithinM).toBe(NEAR_LABEL_M);
    for (const band of ['far', 'default', 'mid'] as ZoomBand[]) {
      expect(bandPromise(band).namesWithinM).toBeNull();
    }
    const note = legendFor('near').flatMap((s) => s.items)
      .filter((i) => i.kind === 'note').map((n) => n.label).join(' ');
    expect(note).toContain(NAME_NOTE);
    // The legend states the ORDER, which is the whole of what the band
    // promises, and the chip prints what that order reached.
    expect(NAME_NOTE).toContain('nobody is named while somebody nearer is not');
    expect(note).not.toContain('every being in frame is named');
    expect(note).not.toContain('everyone you could walk to');
    // And it no longer describes a radius, which is the thing three rounds of
    // wording could not keep true.
    expect(NAME_NOTE).not.toContain('radius');
    expect(bandPromise('near').says).not.toContain('named');
    expect(bandPromise('near').says).not.toContain('every name');
  });

  /**
   * The claim round four caught the view making and not keeping. It is now made
   * in exactly the two bands that implement it, and it says what actually
   * happens — a ghost with a footprint, and an outline on whoever is behind it
   * — rather than the unfalsifiable "step aside".
   */
  it('promises the ghosting only where the ghosting happens', () => {
    for (const band of BAND_ORDER) {
      const notes = itemsOf(band).filter((i) => i.kind === 'note').map((n) => n.label);
      expect(notes.includes(GHOST_NOTE)).toBe(bandShowsDetail(band));
    }
    expect(GHOST_NOTE).toContain('ghost');
    expect(GHOST_NOTE).toContain('outline');
    // It must not say "step aside", which described nothing a reader could check.
    expect(GHOST_NOTE).not.toContain('step aside');
  });

  it('says something in every band, and never an empty row', () => {
    for (const band of [...BAND_ORDER]) {
      const sections = legendFor(band);
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) expect(s.items.length).toBeGreaterThan(0);
    }
    for (const s of LEGEND_EXTRA) expect(s.items.length).toBeGreaterThan(0);
  });

  it('tells a reader the scale, in every band', () => {
    for (const band of BAND_ORDER) {
      const notes = itemsOf(band).filter((i) => i.kind === 'note').map((n) => n.label).join(' ');
      expect(notes).toContain(SCALE_NOTE);
    }
    expect(SCALE_NOTE).toContain('metre');
    expect(SCALE_NOTE).toContain(String(ADULT_M));
  });

  it('renders a colour as css', () => {
    expect(hex(HUE_WELL)).toMatch(/^#[0-9a-f]{6}$/);
    expect(hex(0x0a0b0c)).toBe('#0a0b0c');
  });
});

// ── A hut, at the size the instrument says it is ─────────────────────────────

/**
 * Round four measured the drawn hut at 2.43–2.56 m in two independent frames,
 * against a `scaleReport()` claiming 4.40, with the same method reproducing the
 * adults to within 2–3%. The geometry and the report agreed; the RENDERER was
 * quietly redrawing the instance at 55% to get it out of the way. On an item
 * whose whole subject is that the world is true scale, the probe is the one
 * thing that may not be wrong — so the contract lives in one place, the
 * geometry is built from it, the report is measured off the built mesh, and
 * nothing rescales an instance for legibility ever again.
 */
describe('a hut is the size the instrument says it is', () => {
  const m = shelterMeasure();

  it('stands to its stated ridge, eaves and footprint', () => {
    expect(m.ridge).toBeCloseTo(4.4, 6);
    expect(m.eaves).toBeCloseTo(2.4, 6);
    expect(m.footprint).toBeCloseTo(6.08, 2);
    // Measured off the parts rather than quoted at them, so the last bit of a
    // double is the honest cost of adding a lintel's half-height back on.
    expect(m.ridge).toBeCloseTo(SHELTER.ridge, 9);
    expect(m.eaves).toBeCloseTo(SHELTER.eaves, 9);
    expect(m.footprint).toBeCloseTo(SHELTER_FOOTPRINT, 9);
  });

  it('is measured off the parts the renderer builds from, not quoted at them', () => {
    // The walls' own bounding box, computed here the way three computes it off
    // the merged geometry. If a part moves, this moves; there is no second
    // number to forget to update.
    let maxY = -Infinity;
    let maxX = -Infinity;
    let minX = Infinity;
    for (const p of SHELTER_PARTS) {
      maxY = Math.max(maxY, p.y + p.h / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      minX = Math.min(minX, p.x - p.w / 2);
    }
    expect(maxY).toBeCloseTo(m.eaves, 9);
    expect(maxX - minX).toBeCloseTo(SHELTER.room, 9);
    // The roof overhangs the walls — that is what makes the footprint bigger
    // than the room, and it is why a reviewer's ruler finds 6.08 and not 5.
    expect(m.footprint).toBeGreaterThan(SHELTER.room);
  });

  it('has a doorway a grown being walks through, and it is a HOLE', () => {
    expect(m.doorHeight).toBeGreaterThanOrEqual(ADULT_M + 0.2);
    expect(m.doorWidth).toBeGreaterThan(0.8);
    // Round four's "door" was a solid box glued to a solid wall, so a being
    // inside a hut was a being nobody could see. Sampled through the opening,
    // floor to lintel, nothing may be in the way.
    expect(doorwayClear()).toBe(true);
    // And the wall it is cut into is still a wall on either side of it.
    expect(insideParts(SHELTER_PARTS, 0, 1, SHELTER.room / 2 - SHELTER.wallThickness / 2)).toBe(false);
    expect(insideParts(SHELTER_PARTS, 2.0, 1, SHELTER.room / 2 - SHELTER.wallThickness / 2)).toBe(true);
    expect(insideParts(SHELTER_PARTS, -2.0, 1, SHELTER.room / 2 - SHELTER.wallThickness / 2)).toBe(true);
    // The lintel is over the opening, not in it.
    expect(insideParts(SHELTER_PARTS, 0, m.doorHeight + 0.15, SHELTER.room / 2 - SHELTER.wallThickness / 2)).toBe(true);
  });

  it('is hollow, so a being standing in one is a being you can see', () => {
    for (const [x, z] of [[0, 0], [1.4, -1.4], [-1.6, 1.2]] as [number, number][]) {
      expect(insideParts(SHELTER_PARTS, x, ADULT_M / 2, z)).toBe(false);
    }
  });

  it('says the same thing in the legend as it does in the geometry', () => {
    expect(SCALE_NOTE).toContain(`${SHELTER.ridge} m`);
    expect(SCALE_NOTE).toContain(`${SHELTER.doorHeight} m`);
    // A ridge two and a half times an adult: the proportion the note claims is
    // the proportion the mesh has.
    expect(m.ridge / ADULT_M).toBeGreaterThan(2.4);
    expect(m.ridge / ADULT_M).toBeLessThan(2.6);
  });
});

// ── Nothing stands in front of a being ───────────────────────────────────────

describe('the beings the scenery has to step aside for', () => {
  const subject = (x: number, y: number, z: number): Subject => ({ x, y, z, r: SUBJECT_R });

  it('never loses one, however many are on screen', () => {
    const out = new Float32Array(SUBJECT_SLOTS * 4);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const n of [1, 5, 24, 25, 60, 300]) {
      const src: Subject[] = [];
      for (let i = 0; i < n; i++) src.push(subject((rnd() - 0.5) * 80, (rnd() - 0.5) * 20, -(2 + rnd() * 300)));
      const count = packSubjects(src, out);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(SUBJECT_SLOTS);
      // The whole promise: a being left out of this list is a being a hut is
      // still allowed to stand in front of.
      for (const s of src) expect(subjectCovers(out, count, s)).toBe(true);
    }
  });

  it('gives a lone being a sphere of its own, at its own size', () => {
    const out = new Float32Array(SUBJECT_SLOTS * 4);
    expect(packSubjects([subject(1, 2, -30)], out)).toBe(1);
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(2, 4);
    expect(out[2]).toBeCloseTo(-30, 4);
    expect(out[3]).toBeCloseTo(SUBJECT_R, 4);
  });

  it('keeps two beings on the same line of sight apart, not merged into one', () => {
    const out = new Float32Array(SUBJECT_SLOTS * 4);
    // Twenty metres apart in depth is two subjects, and a tree between them is
    // in front of one and behind the other.
    const n = packSubjects([subject(0, 0, -20), subject(0, 0, -40)], out);
    expect(n).toBe(2);
  });

  it('answers nothing when there is nobody to protect', () => {
    const out = new Float32Array(SUBJECT_SLOTS * 4);
    expect(packSubjects([], out)).toBe(0);
  });

  it('only ever claims a mark big enough to be called', () => {
    expect(READABLE_MARK_PX).toBeGreaterThanOrEqual(8);
    expect(XRAY_MIN_BODY_PX).toBeGreaterThanOrEqual(READABLE_MARK_PX - 1);
    // A pin holds its size on screen; a body does not. Where the band promises
    // the body's own channels, the body is what has to be big enough — and the
    // size it has to reach is the size that DEFINES the band that draws them.
    expect(DETAIL_MIN_PX).toBe(BAND_EDGE_PX[1]);
    expect(DETAIL_MIN_PX).toBeGreaterThan(READABLE_MARK_PX * 3);
    for (const band of BAND_ORDER) {
      if (!bandShowsDetail(band)) continue;
      // Every being the band's own contract covers clears the bar by definition.
      expect(DETAIL_MIN_PX).toBeLessThanOrEqual(BAND_EDGE_PX[1]!);
    }
    // And a DEFAULT pin clears it comfortably, or the band that promises a
    // count would be dropping beings out of its own population.
    const ringPx = (d: number): number => (annotationRadius(d, WORLD_PER_PX) / (d * WORLD_PER_PX)) * 2;
    expect(ringPx(1454)).toBeGreaterThan(READABLE_MARK_PX * 1.5);
  });
});

// ── The legibility specimen ──────────────────────────────────────────────────

/**
 * The run round four reviewed produced three unwell beings out of two hundred
 * and fifty-one, and every one of them was off-frame or inside a hut. The
 * condition channel scored 100% at DEFAULT and 7% at MID in the same review and
 * neither number was about the channel. A specimen is the only way to test an
 * encoding: put one of everything in front of the camera and look.
 */
describe('the legibility specimen', () => {
  const plan = specimenPlan();

  const vocabulary = plan.filter((c) => c.knot === 0);

  it('fills the grid exactly once, with nobody standing on anybody', () => {
    expect(vocabulary).toHaveLength(SPECIMEN_COLS * SPECIMEN_GRID_ROWS);
    const seen = new Set<string>();
    for (const c of vocabulary) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeLessThan(SPECIMEN_COLS);
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(SPECIMEN_ROWS);
      seen.add(`${c.col},${c.row}`);
    }
    expect(seen.size).toBe(vocabulary.length);
    // Two paces apart: far enough that no figure hides the one behind it.
    expect(SPECIMEN_SPACING).toBeGreaterThan(2.2);
  });

  /**
   * L4's "find X in three interactions" and "read a crowd of 2–12" could not be
   * scored at all in round six: a day-nine world of three hundred held no
   * speaking elder, no starving child and nobody fleeing, and the only crowd
   * any camera could reach held three hundred and two. An untestable task is an
   * unscored one, so the specimen carries both.
   */
  it('carries the rare combinations a real run may simply not contain', () => {
    for (const want of SPECIMEN_REQUIRED) {
      const found = plan.filter((c) => c.stage === want.stage && c.cond === want.cond && c.act === want.act);
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it('stands people in knots of two to twelve, so a chip has a crowd to count', () => {
    const sizes = SPECIMEN_KNOTS.map((k) => k.size);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(12);
    for (let k = 0; k < SPECIMEN_KNOTS.length; k++) {
      const members = plan.filter((c) => c.knot === k + 1);
      expect(members).toHaveLength(SPECIMEN_KNOTS[k]!.size);
      // Close enough that their pins overlap and a chip forms, and inside the
      // ground the specimen lays for itself.
      for (const m of members) {
        expect(Math.hypot(m.col - SPECIMEN_KNOTS[k]!.col, m.row - SPECIMEN_KNOTS[k]!.row)).toBeLessThan(0.75);
        expect(m.col).toBeGreaterThanOrEqual(0);
        expect(m.col).toBeLessThan(SPECIMEN_COLS);
        expect(m.row).toBeGreaterThanOrEqual(0);
        expect(m.row).toBeLessThan(SPECIMEN_ROWS);
      }
    }
    // A knot big enough to have a mix shows one: a chip's stacked bar has
    // something to say about every crowd worth reading.
    const biggest = plan.filter((c) => c.knot === 1);
    expect(new Set(biggest.map((c) => c.cond)).size).toBe(4);
  });

  it('covers every stage, every condition, every act and all eight headings', () => {
    expect(new Set(plan.map((c) => c.stage))).toEqual(new Set([STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]));
    expect(new Set(plan.map((c) => c.cond))).toEqual(new Set([0, COND_STARVING, COND_SICK, COND_HURT]));
    expect(new Set(plan.map((c) => c.act)).size).toBe(ACT_COUNT);
    expect(new Set(plan.map((c) => c.octant)).size).toBe(8);
    // Every condition gets every act and every stage, so no channel can be
    // read off another one.
    for (const cond of [0, COND_STARVING, COND_SICK, COND_HURT]) {
      const rows = plan.filter((c) => c.cond === cond);
      expect(new Set(rows.map((c) => c.act)).size).toBe(ACT_COUNT);
      expect(new Set(rows.map((c) => c.stage)).size).toBe(3);
      expect(new Set(rows.map((c) => c.octant)).size).toBe(8);
    }
    // And every stage gets every act.
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      expect(new Set(plan.filter((c) => c.stage === stage).map((c) => c.act)).size).toBe(ACT_COUNT);
    }
  });

  it('puts unwell beings where a NEAR camera can actually see them', () => {
    // Dealt across the grid rather than in blocks: any three rows a close
    // camera can hold still contain all four conditions.
    for (let row = 0; row + 3 <= SPECIMEN_ROWS; row++) {
      const band = plan.filter((c) => c.row >= row && c.row < row + 3);
      expect(new Set(band.map((c) => c.cond)).size).toBe(4);
    }
  });

  it('gives every mover a streak and every stayer none', () => {
    const movers = plan.filter((c) => movingFor(c.act));
    expect(movers.length).toBeGreaterThan(plan.length / 8);
    for (const c of movers) expect([ACT_WALKING, ACT_DANGER]).toContain(c.act);
  });

  it('carries ids nothing in the world can collide with', () => {
    const ids = plan.map((_, n) => SPECIMEN_ID_BASE - n);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isSpecimenId(id)).toBe(true);
    for (const real of [0, 1, 1830, 999999, -1, -12]) expect(isSpecimenId(real)).toBe(false);
  });
});

// ── Designations ─────────────────────────────────────────────────────────────

describe('designations', () => {
  it('is the same word for the same being, every run', () => {
    expect(designationFor(1830)).toBe(designationFor(1830));
    expect(designationFor(1830)).not.toBe(designationFor(1831));
  });

  it('never collides, and never falls back to a number', () => {
    const seen = new Set<string>();
    for (let id = 0; id < 4000; id++) {
      const d = designationFor(id);
      expect(d).not.toMatch(/\d/);
      expect(seen.has(d)).toBe(false);
      seen.add(d);
    }
    expect(seen.size).toBe(4000);
  });

  it('carries past the syllable span with a readable suffix rather than repeating', () => {
    expect(designationFor(2900)).toMatch(/^[A-Z][a-z]+ (II|III|IV|V|VI|VII|VIII|IX|X)$/);
  });

  it('marks a chosen name as chosen and an engine placeholder as not', () => {
    expect(displayName(12, 'Karin')).toEqual({ text: 'Karin', selfChosen: true });
    expect(displayName(12, '')).toEqual({ text: designationFor(12), selfChosen: false });
    expect(displayName(12, undefined).selfChosen).toBe(false);
    expect(displayName(1830, 'Gahallian #1830')).toEqual({ text: designationFor(1830), selfChosen: false });
  });

  it('shows no id anywhere in what it returns', () => {
    for (const raw of ['', 'Gahallian #77', undefined]) {
      expect(displayName(77, raw).text).not.toContain('#');
      expect(displayName(77, raw).text).not.toContain('77');
    }
  });
});

// ── Crowds ───────────────────────────────────────────────────────────────────

const grid = (n: number, x0: number, y0: number, spread: number, id0 = 1): ScreenPoint[] =>
  Array.from({ length: n }, (_, i) => ({ id: id0 + i, x: x0 + (i % 6) * spread, y: y0 + Math.floor(i / 6) * spread }));

describe('counting a crowd', () => {
  it('leaves beings that stand apart alone', () => {
    const spread = [{ id: 1, x: 40, y: 40 }, { id: 2, x: 300, y: 90 }, { id: 3, x: 600, y: 400 }];
    expect(clusterBeings(spread, 25, 3)).toEqual([]);
  });

  it('counts a settlement as ONE group, including the ones standing behind', () => {
    const settlement = grid(30, 400, 300, 9);
    const found = clusterBeings(settlement, 25, 3);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(30);
    expect(found[0]!.members).toHaveLength(30);
    expect(found[0]!.x).toBeGreaterThan(400);
    expect(found[0]!.x).toBeLessThan(400 + 6 * 9);
  });

  it('splits two settlements into two numbers', () => {
    const found = clusterBeings([...grid(12, 100, 100, 8), ...grid(7, 600, 420, 8, 100)], 22, 3);
    expect(found.map((c) => c.count)).toEqual([12, 7]);
  });

  it('splits a group apart as the view zooms in — a smaller cell finds smaller groups', () => {
    const two = [...grid(6, 100, 100, 10), ...grid(6, 220, 100, 10, 100)];
    expect(clusterBeings(two, 90, 3)).toHaveLength(1); // far out: one crowd
    expect(clusterBeings(two, 14, 3)).toHaveLength(2); // closer in: two
    expect(clusterBeings(two, 2, 3)).toHaveLength(0); // close enough to count people
  });

  it('reports the biggest crowd first, so a short budget spends itself where it matters', () => {
    const found = clusterBeings([...grid(4, 60, 60, 8), ...grid(21, 500, 300, 8, 100)], 22, 3);
    expect(found[0]!.count).toBe(21);
  });

  it('never draws one group inside another, because a reader counts that twice', () => {
    const close = [...grid(10, 300, 300, 8), ...grid(6, 360, 330, 8, 100)];
    const found = clusterBeings(close, 20, 3);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(16);
  });

  it('never loses or invents a being', () => {
    const all = [...grid(15, 80, 80, 7), ...grid(9, 500, 400, 7, 100), { id: 99, x: 900, y: 40 }];
    const found = clusterBeings(all, 20, 3);
    expect(found.reduce((n, c) => n + c.count, 0)).toBe(24);
    expect(new Set(found.flatMap((c) => c.members)).size).toBe(24);
  });
});

describe('a crowd shows its own structure, not just its total', () => {
  /**
   * Three dense neighbourhoods with open ground between them, near enough that
   * a coarse pass reads them as one settlement of ninety — which is the exact
   * shape of the frame a reviewer called "a white blob inside one giant hull".
   */
  const settlement = [
    ...grid(30, 300, 300, 3),
    ...grid(30, 380, 300, 3, 100),
    ...grid(30, 440, 300, 3, 200),
  ];
  const CELL = 45;
  /** A split may hand a reader a handful of neighbourhoods, never a spray of them. */
  const SPLIT_PARTS_MAX = 5;

  it('splits a settlement past the threshold into parts a reader can see', () => {
    const flat = clusterBeings(settlement, CELL, 3);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.count).toBe(90);
    const split = clusterHierarchy(settlement, CELL, 3, 18);
    expect(split.length).toBeGreaterThan(1);
    for (const part of split) {
      expect(part.count).toBeLessThan(flat[0]!.count);
      expect(part.depth).toBeGreaterThan(0);
    }
  });

  it('still counts every being exactly once across the parts', () => {
    const split = clusterHierarchy(settlement, CELL, 3, 18);
    expect(split.reduce((n, c) => n + c.count, 0)).toBe(90);
    expect(new Set(split.flatMap((c) => c.members)).size).toBe(90);
  });

  it('reports its parts against the ORIGINAL points, not the subset it split', () => {
    const split = clusterHierarchy(settlement, CELL, 3, 18);
    for (const part of split) {
      for (const k of part.members) {
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(settlement.length);
      }
      // The outline the view draws sits over the beings it says are inside it.
      const xs = part.members.map((k) => settlement[k]!.x);
      expect(part.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1);
      expect(part.x).toBeLessThanOrEqual(Math.max(...xs) + 1);
    }
  });

  it('leaves a group that is already small enough alone', () => {
    const small = grid(8, 200, 200, 8);
    expect(small.length).toBeLessThan(CLUSTER_SPLIT_AT);
    const split = clusterHierarchy(small, 26, 3, 18);
    expect(split).toHaveLength(1);
    expect(split[0]!.depth).toBe(0);
    expect(split[0]!.count).toBe(8);
  });

  it('refuses a split that would redraw the same outline one level down', () => {
    // A knot with no structure in it: every finer pass finds the same one
    // group, and claiming to have looked would be worse than saying so.
    const knot = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, x: 300 + (i % 8), y: 300 + Math.floor(i / 8) }));
    const split = clusterHierarchy(knot, CELL, 3, 18);
    expect(split).toHaveLength(1);
    expect(split[0]!.count).toBe(40);
    expect(split[0]!.depth).toBe(0);
  });

  it('never draws one part inside another', () => {
    const split = clusterHierarchy(settlement, CELL, 3, 18);
    for (let i = 0; i < split.length; i++) {
      for (let j = i + 1; j < split.length; j++) {
        const a = split[i]!;
        const b = split[j]!;
        const apart = Math.abs(a.x - b.x) > (a.rx + b.rx) * 0.9 || Math.abs(a.y - b.y) > (a.ry + b.ry) * 0.9;
        expect(apart).toBe(true);
      }
    }
  });

  it('refuses a split into confetti — many parts, or parts smaller than the markers under them', () => {
    // Nine tiny knots of three. Splitting turns one honest number into nine
    // outlines saying less than the markers already drawn inside them.
    const speckle = Array.from({ length: 9 }, (_, k) => grid(3, 300 + (k % 3) * 60, 300 + Math.floor(k / 3) * 60, 3, k * 100 + 1)).flat();
    const split = clusterHierarchy(speckle, CELL, 3, 18);
    expect(split.length).toBeLessThanOrEqual(SPLIT_PARTS_MAX);
    for (const part of split) if (part.depth > 0) expect(part.count).toBeGreaterThanOrEqual(6);
  });

  it('keeps inside the budget it is given, biggest first', () => {
    const many = Array.from({ length: 12 }, (_, k) => grid(9, 60 + k * 90, 60 + (k % 3) * 200, 6, k * 100 + 1)).flat();
    const split = clusterHierarchy(many, 20, 3, 5);
    expect(split.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < split.length; i++) expect(split[i - 1]!.count).toBeGreaterThanOrEqual(split[i]!.count);
  });
});

// ── Names over the world ─────────────────────────────────────────────────────

describe('names over the world', () => {
  const sized = (text: string): number => labelWidth(text);
  const at = (id: number, x: number, y: number, rank: number, text = 'Ashiden'): LabelCandidate => ({ id, x, y, rank, text });

  it('places a name near its being', () => {
    const [placed] = placeLabels([at(1, 400, 300, 3)], 1200, 800, 7);
    expect(placed).toBeDefined();
    expect(Math.abs(placed!.x - 400)).toBeLessThan(40);
    expect(placed!.y).toBeLessThan(300);
    expect(placed!.ax).toBe(400);
  });

  it('stands further off a being the bigger that being is drawn', () => {
    const [small] = placeLabels([at(1, 400, 300, 3)], 1200, 800, 7, [], 12);
    const [large] = placeLabels([at(1, 400, 300, 3)], 1200, 800, 7, [], 70);
    expect(300 - large!.y).toBeGreaterThan((300 - small!.y) * 3);
  });

  it('never draws a name outside the canvas — the whole reason round one lied', () => {
    const off = [at(1, -80, 300, 3), at(2, 1400, 300, 3), at(3, 400, 1100, 3), at(4, 400, 4, 3)];
    for (const c of off) {
      for (const p of placeLabels([c], 1200, 800, 7)) {
        expect(p.x - sized(p.text) / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + sized(p.text) / 2).toBeLessThanOrEqual(1200);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThanOrEqual(800);
      }
    }
  });

  it('keeps off the bodies it is told about, so a name never covers a being', () => {
    const body = { x0: 380, y0: 240, x1: 420, y1: 300 };
    const placed = placeLabels([at(1, 400, 300, 3)], 1200, 800, 7, [body], 12);
    for (const p of placed) {
      const x0 = p.x - sized(p.text) / 2;
      const x1 = p.x + sized(p.text) / 2;
      const overlaps = x0 < body.x1 && x1 > body.x0 && p.y - 17 < body.y1 && p.y > body.y0;
      expect(overlaps).toBe(false);
    }
  });

  it('spends its first slots on the selected being and the one under the pointer', () => {
    const placed = placeLabels([at(5, 100, 400, 3), at(9, 900, 400, 0), at(8, 500, 400, 1)], 1200, 800, 2);
    expect(placed.map((p) => p.id)).toEqual([9, 8]);
  });

  it('resolves a stack rather than printing three names in one place', () => {
    const crowd = [at(1, 500, 400, 3), at(2, 502, 401, 3), at(3, 498, 399, 3)];
    const placed = placeLabels(crowd, 1200, 800, 7);
    expect(placed.length).toBeGreaterThan(1);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const apart = Math.abs(a.x - b.x) > (sized(a.text) + sized(b.text)) / 2 || Math.abs(a.y - b.y) >= 17;
        expect(apart).toBe(true);
      }
    }
  });

  it('asks for a leader line when a name had to leave its being to find room', () => {
    const crowd = Array.from({ length: 5 }, (_, i) => at(i + 1, 500 + i, 400 + i, 3));
    const placed = placeLabels(crowd, 1200, 800, 7);
    expect(placed.some((p) => p.leader)).toBe(true);
    for (const p of placed) {
      if (p.leader) expect(Math.hypot(p.x - p.ax, p.y - p.ay)).toBeGreaterThan(8);
    }
  });

  it('drops what it cannot fit instead of claiming it', () => {
    const many = Array.from({ length: 7 }, (_, i) => at(i + 1, 60, 760 - i, 3, 'Averyverylongname'));
    const placed = placeLabels(many, 240, 800, 7);
    expect(placed.length).toBeLessThan(7);
  });

  it('is stable: the same world labels the same beings in the same order', () => {
    const c = [at(3, 300, 300, 3), at(1, 300, 300, 3), at(2, 300, 300, 3)];
    expect(placeLabels(c, 1200, 800, 2).map((p) => p.id)).toEqual([1, 2]);
  });
});

// ── Heading and motion ───────────────────────────────────────────────────────

describe('heading, as a reader of a screenshot would say it', () => {
  it('names the eight directions from straight up, clockwise', () => {
    expect(headingOctant(0)).toBe('N');
    expect(headingOctant(45)).toBe('NE');
    expect(headingOctant(90)).toBe('E');
    expect(headingOctant(179)).toBe('S');
    expect(headingOctant(270)).toBe('W');
    expect(headingOctant(316)).toBe('NW');
  });

  it('gives the streak to exactly the beings that are going somewhere', () => {
    expect(movingFor(ACT_WALKING)).toBe(true);
    expect(movingFor(ACT_DANGER)).toBe(true);
    expect(movingFor(ACT_IDLE)).toBe(false);
    expect(movingFor(ACT_RESTING)).toBe(false);
    expect(movingFor(ACT_WORKING)).toBe(false);
    expect(movingFor(ACT_SOCIAL)).toBe(false);
    // The streak is the ONLY thing separating the two states that wear no
    // pictogram, so it has to agree with the word the probe scores against.
    for (let act = 0; act < ACT_COUNT; act++) {
      if (pictogramFor(act) !== PICTO_NONE) continue;
      expect(readableActivity(act, 'mid')).toBe(movingFor(act) ? 'walking' : 'standing');
    }
  });

  it('wraps, so no angle is unnameable', () => {
    expect(headingOctant(360)).toBe('N');
    expect(headingOctant(-90)).toBe('W');
    expect(headingOctant(725)).toBe('N');
  });
});

describe('centring on a being that a panel is sitting on', () => {
  it('shifts by half the panel, so the being lands in the middle of what you can see', () => {
    expect(focusShiftPx(1200, 240)).toBe(120);
    expect(focusShiftPx(1200, 0)).toBe(0);
  });

  it('never shifts a being off the free part of the canvas', () => {
    for (const panel of [0, 100, 240, 400]) {
      const shift = focusShiftPx(1200, panel);
      expect(shift).toBeLessThanOrEqual((1200 - panel) / 2);
    }
  });
});

// ── Counting, made mechanical ────────────────────────────────────────────────

/** A deterministic little PRNG, so a failing layout can be reproduced exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function scatter(seed: number, n: number, w: number, h: number): ScreenPoint[] {
  const next = rng(seed);
  const out: ScreenPoint[] = [];
  // Half uniform, half piled into three settlements — which is what a frame of
  // this world actually looks like, and the case round three got wrong.
  const hubs = [[w * 0.25, h * 0.3], [w * 0.7, h * 0.6], [w * 0.5, h * 0.85]];
  for (let i = 0; i < n; i++) {
    if (next() < 0.55) {
      const hub = hubs[Math.floor(next() * hubs.length)]!;
      const spread = 12 + next() * 70;
      out.push({ id: i, x: hub[0]! + (next() - 0.5) * spread, y: hub[1]! + (next() - 0.5) * spread });
    } else {
      out.push({ id: i, x: next() * w, y: next() * h });
    }
  }
  return out;
}

describe('every being in the frame is a pin or part of a number, never both', () => {
  const PIN = 24;

  it('closes the arithmetic on every random layout', () => {
    let chipsSeen = 0;
    let singlesSeen = 0;
    let inChips = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = 3 + (seed * 7) % 160;
      const points = scatter(seed, n, 1400, 900);
      const plan = planCount(points, PIN, 64);
      const counted = plan.chips.reduce((sum, c) => sum + c.count, 0);
      expect(plan.singles.length + counted).toBe(points.length);
      // And the two terms are disjoint sets of the SAME beings, not two
      // numbers that happen to add up.
      const seen = new Set<number>(plan.singles);
      for (const chip of plan.chips) for (const k of chip.members) seen.add(k);
      expect(seen.size).toBe(points.length);
      for (const chip of plan.chips) expect(chip.count).toBe(chip.members.length);
      chipsSeen += plan.chips.length;
      singlesSeen += plan.singles.length;
      inChips += counted;
    }
    // An identity that holds because nothing ever collapses is not the
    // identity this view needs. These layouts are settlements: most beings
    // must end up inside a number, and plenty must not.
    expect(chipsSeen).toBeGreaterThan(40);
    expect(singlesSeen).toBeGreaterThan(200);
    expect(inChips).toBeGreaterThan(singlesSeen);
  });

  it('never leaves two pins a reader must count separately touching', () => {
    let checked = 0;
    for (let seed = 101; seed <= 130; seed++) {
      const points = scatter(seed, 60 + seed % 40, 1400, 900);
      const plan = planCount(points, PIN, 64);
      checked += plan.singles.length;
      for (let a = 0; a < plan.singles.length; a++) {
        for (let b = a + 1; b < plan.singles.length; b++) {
          const p = points[plan.singles[a]!]!;
          const q = points[plan.singles[b]!]!;
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(PIN);
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('never leaves a pin half-visible under a number it is not part of', () => {
    let chips = 0;
    for (let seed = 201; seed <= 230; seed++) {
      const points = scatter(seed, 90, 1400, 900);
      const plan = planCount(points, PIN, 64);
      chips += plan.chips.length;
      for (const k of plan.singles) {
        const p = points[k]!;
        for (const chip of plan.chips) {
          const dx = (p.x - chip.x) / (chip.rx + PIN * 0.6);
          const dy = (p.y - chip.y) / (chip.ry + PIN * 0.6);
          expect(dx * dx + dy * dy).toBeGreaterThan(1);
        }
      }
    }
    expect(chips).toBeGreaterThan(30);
  });

  /**
   * Round six's whole-frame count was exact to 0.5% and its QUADRANT counts ran
   * −88% to +45%. Nothing was miscounted: one chip had folded ninety-two beings
   * whose outline straddled two quadrants, and a chip is read where its number
   * sits. "Count the pins, add the numbers" was valid frame-wide and nowhere
   * else, which is not a counting rule — it is a counting rule with an
   * exception a reader cannot see.
   */
  const VIEW = { w: 1400, h: 900 };

  /**
   * What a reader gets against what is there, one quarter of the frame at a
   * time — `countAudit().quadrants` in pure form, with the chips placed by the
   * same call the renderer makes so the DISC's quadrant is the one counted.
   * `pins` says whether the frame's own marks are in the way, which is when the
   * placement search has to choose between covering a being and leaving home.
   */
  const readQuadrants = (points: readonly ScreenPoint[], withPins = false): { read: number[]; truth: number[] } => {
    const plan = planCount(points, PIN, 64, VIEW);
    const truth = [0, 0, 0, 0];
    for (const p of points) truth[regionOf(p.x, p.y, VIEW)]! += 1;
    const read = [0, 0, 0, 0];
    const pins: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const k of plan.singles) {
      const p = points[k]!;
      read[regionOf(p.x, p.y, VIEW)]! += 1;
      if (withPins) pins.push({ x0: p.x - PIN / 2, y0: p.y - PIN / 2, x1: p.x + PIN / 2, y1: p.y + PIN / 2 });
    }
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const chip of plan.chips) {
      const halfW = String(chip.count).length * 3.5 + 7;
      const at = placeCountChip(
        { x: chip.x, y: chip.y, rx: chip.rx, ry: chip.ry, region: chip.region }, halfW, 9, pins, placed, VIEW,
      );
      placed.push({ x0: at.x - halfW, y0: at.y - 9, x1: at.x + halfW, y1: at.y + 9 });
      read[regionOf(at.x, at.y, VIEW)]! += chip.count;
    }
    return { read, truth };
  };

  it('gives a quadrant the same arithmetic as the whole frame — exactly, not nearly', () => {
    // Round two of this item left the bar at ±10% and shipped the defect
    // inside it: the split was right, the PLACEMENT was not, and a disc pushed
    // off a pin walked across a mid-line carrying twenty beings with it. There
    // is no approximation in "count the pins, add the numbers", so there is
    // none here either.
    let layouts = 0;
    for (let seed = 301; seed <= 620; seed++) {
      const { read, truth } = readQuadrants(scatter(seed, 40 + (seed * 11) % 180, VIEW.w, VIEW.h));
      expect(read).toEqual(truth);
      layouts++;
    }
    expect(layouts).toBe(320);
  });

  it('is still exact with a pin under every slot the chip would like', () => {
    // A chip may lose a fight with a being and shrink; it may not solve the
    // fight by being read somewhere else.
    for (let seed = 701; seed <= 730; seed++) {
      const { read, truth } = readQuadrants(scatter(seed, 60 + seed % 120, VIEW.w, VIEW.h), true);
      expect(read).toEqual(truth);
    }
  });

  it('is exact on a blob sitting exactly on the mid-point', () => {
    // The adversarial case the ±10% bar could never have caught: one gathering
    // centred on the crossing of both lines, with members in all four
    // quadrants and a hull centred on nothing.
    for (const spread of [6, 18, 44, 90]) {
      const points: ScreenPoint[] = [];
      const next = rng(spread);
      for (let i = 0; i < 80; i++) {
        points.push({
          id: i,
          x: VIEW.w / 2 + (next() - 0.5) * spread,
          y: VIEW.h / 2 + (next() - 0.5) * spread,
        });
      }
      const { read, truth } = readQuadrants(points);
      expect(read).toEqual(truth);
      expect(truth.filter((n) => n > 0).length).toBeGreaterThan(1);
    }
  });

  it('is exact on a line of beings standing along a mid-line', () => {
    // Every being on the boundary itself, where `regionOf`'s own tie-break is
    // the only thing deciding which side they are counted on.
    const down: ScreenPoint[] = [];
    for (let i = 0; i < 60; i++) down.push({ id: i, x: VIEW.w / 2, y: 40 + i * 13 });
    const across: ScreenPoint[] = [];
    for (let i = 0; i < 60; i++) across.push({ id: i, x: 40 + i * 21, y: VIEW.h / 2 });
    const both = [...down, ...across.map((p, i) => ({ ...p, id: 1000 + i }))];
    for (const points of [down, across, both]) {
      const { read, truth } = readQuadrants(points);
      expect(read).toEqual(truth);
    }
  });

  it('never lets one chip stand for two places at once', () => {
    for (let seed = 401; seed <= 430; seed++) {
      const points = scatter(seed, 120, VIEW.w, VIEW.h);
      const plan = planCount(points, PIN, 64, VIEW);
      for (const chip of plan.chips) {
        // Every member in the chip's own region…
        const regions = new Set(chip.members.map((k) => regionOf(points[k]!.x, points[k]!.y, VIEW)));
        expect(regions.size).toBe(1);
        // …and compact enough to read as one gathering.
        expect(chip.rx * 2).toBeLessThanOrEqual(Math.min(VIEW.w, VIEW.h) / 6 + PIN * 2);
        expect(chip.ry * 2).toBeLessThanOrEqual(Math.min(VIEW.w, VIEW.h) / 6 + PIN * 2);
      }
    }
  });

  it('still closes the whole-frame arithmetic with the frame split in four', () => {
    for (let seed = 501; seed <= 530; seed++) {
      const points = scatter(seed, 30 + seed % 140, VIEW.w, VIEW.h);
      const plan = planCount(points, PIN, 64, VIEW);
      const counted = plan.chips.reduce((sum, c) => sum + c.count, 0);
      expect(plan.singles.length + counted).toBe(points.length);
      const seen = new Set<number>(plan.singles);
      for (const chip of plan.chips) for (const k of chip.members) seen.add(k);
      expect(seen.size).toBe(points.length);
      // And nothing stands for one being: that is what its own pin is for.
      for (const chip of plan.chips) expect(chip.count).toBeGreaterThanOrEqual(2);
    }
  });

  it('collapses a PAIR, not only a crowd — two overlapping rings are already unreadable', () => {
    const plan = planCount([{ id: 1, x: 100, y: 100 }, { id: 2, x: 108, y: 103 }], 24, 8);
    expect(plan.singles).toHaveLength(0);
    expect(plan.chips).toHaveLength(1);
    expect(plan.chips[0]!.count).toBe(2);
  });

  it('leaves beings that are genuinely apart alone', () => {
    const far: ScreenPoint[] = [
      { id: 1, x: 100, y: 100 }, { id: 2, x: 400, y: 120 }, { id: 3, x: 800, y: 600 },
    ];
    const plan = planCount(far, 24, 8);
    expect(plan.singles).toHaveLength(3);
    expect(plan.chips).toHaveLength(0);
  });

  it('is asked for by exactly the bands that promise a count', () => {
    for (const band of BAND_ORDER) {
      expect(bandCountsBeings(band)).toBe(bandPromise(band).count !== null);
    }
    expect(bandCountsBeings('far')).toBe(true);
    expect(bandCountsBeings('default')).toBe(true);
    expect(bandCountsBeings('mid')).toBe(false);
    expect(bandCountsBeings('near')).toBe(false);
  });

  it('says so in the legend of every band that does it', () => {
    for (const band of ['far', 'default'] as ZoomBand[]) {
      const items = legendFor(band).flatMap((s) => s.items);
      expect(items.filter((i) => i.kind === 'note').some((n) => n.label === COUNT_NOTE)).toBe(true);
      const chips = items.filter((i) => i.kind === 'chip');
      expect(chips).toHaveLength(1);
      expect(chips[0]!.label).toMatch(/no (pin|dot) is drawn inside/);
      // A building's occupants chip is only drawn where the band draws detail,
      // so out here it must not be in the key either.
      expect(chips.some((c) => c.label.includes(INSIDE_NOTE))).toBe(false);
    }
    // MID and NEAR draw no CROWD chips — the band promises no count and says
    // to pull back for one. They DO draw a shelter's occupants chip, which is
    // not a count of the frame, and round eight drew it in both bands with
    // nothing in either key saying what it was: a reviewer met an unexplained
    // number over a roof and read it as "a crowd of 18 behind that tree".
    for (const band of ['mid', 'near'] as ZoomBand[]) {
      const chips = legendFor(band).flatMap((s) => s.items).filter((i) => i.kind === 'chip');
      expect(chips.some((c) => c.label.includes(INSIDE_NOTE))).toBe(true);
      expect(chips.some((c) => /no (pin|dot) is drawn inside/.test(c.label))).toBe(band === 'mid');
    }
    expect(legendFor('near').flatMap((s) => s.items).filter((i) => i.kind === 'chip')).toHaveLength(1);
  });
});

// ── Heading, scored two ways ─────────────────────────────────────────────────

describe('scoring a heading, exactly and to within one octant', () => {
  it('counts the steps round the compass the short way', () => {
    expect(octantDistance('N', 'N')).toBe(0);
    expect(octantDistance('N', 'NE')).toBe(1);
    expect(octantDistance('N', 'NW')).toBe(1);
    expect(octantDistance('N', 'S')).toBe(4);
    expect(octantDistance('NW', 'N')).toBe(1);
    expect(octantDistance('E', 'W')).toBe(4);
    expect(octantDistance('se', ' SE ')).toBe(0);
  });

  it('refuses a word that is not a compass point rather than scoring it 0', () => {
    expect(octantDistance('up', 'N')).toBe(-1);
    expect(octantDistance('N', '')).toBe(-1);
  });

  it('is symmetric and never more than four', () => {
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (const a of points) {
      for (const b of points) {
        expect(octantDistance(a, b)).toBe(octantDistance(b, a));
        expect(octantDistance(a, b)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('agrees with the angle the view reads off the screen', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      expect(octantDistance(headingOctant(deg), headingOctant(deg + 45))).toBeLessThanOrEqual(1);
    }
  });
});

// ── Names that do not become a web ───────────────────────────────────────────

describe('a name stays with its being', () => {
  const near = (id: number, x: number, y: number, rank = 3, text = 'Nevara'): LabelCandidate => ({ id, x, y, rank, text });
  const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => {
    const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
  };

  it('never draws two leader lines that cross', () => {
    // Beings in a tight row: with no crossing rule, the names shuffle sideways
    // to find room and the lines home braid over each other.
    const row = Array.from({ length: 10 }, (_, i) => near(i + 1, 300 + i * 26, 400));
    const placed = placeLabels(row, 1400, 900, 10, [], 20, 52);
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const p = placed[a]!;
        const q = placed[b]!;
        const crosses = side(p.ax, p.ay, p.x, p.y, q.ax, q.ay) * side(p.ax, p.ay, p.x, p.y, q.x, q.y) < 0
          && side(q.ax, q.ay, q.x, q.y, p.ax, p.ay) * side(q.ax, q.ay, q.x, q.y, p.x, p.y) < 0;
        expect(crosses).toBe(false);
      }
    }
  });

  it('drops a name rather than running a line across the frame for it', () => {
    const row = Array.from({ length: 14 }, (_, i) => near(i + 1, 400 + i * 14, 500));
    const placed = placeLabels(row, 1400, 900, 14, [], 20, 52);
    for (const p of placed) expect(Math.hypot(p.x - p.ax, p.y - p.ay)).toBeLessThanOrEqual(52);
    // Refusing a slot has to cost names, or the cap is not doing anything.
    expect(placed.length).toBeLessThan(14);
  });

  it('does not grow the gap over a head with the height of the body under it', () => {
    // At NEAR a being is ~150 px tall, and the name is anchored to its HEAD.
    // Round three scaled the offsets by the figure and produced 300 px leaders.
    expect(labelClearanceFor('near', 150)).toBeLessThanOrEqual(20);
    expect(labelClearanceFor('mid', 45)).toBeLessThanOrEqual(30);
    expect(labelClearanceFor('default', 6)).toBeGreaterThanOrEqual(11);
    for (const band of BAND_ORDER) {
      for (const px of [1, 6, 45, 150, 400]) {
        expect(labelClearanceFor(band, px)).toBeLessThanOrEqual(30);
        expect(labelClearanceFor(band, px)).toBeGreaterThanOrEqual(11);
      }
    }
    expect(maxLeaderFor('near')).toBeLessThan(maxLeaderFor('mid'));
  });

  it('only offers a name to a being you could walk to, at NEAR', () => {
    // The rule itself lives in the view (it needs world distances); this is the
    // number it is spending, and it has to be a street rather than a valley.
    expect(NEAR_LABEL_M).toBeGreaterThan(8);
    expect(NEAR_LABEL_M).toBeLessThanOrEqual(30);
  });
});

// ── How often the view is allowed to redraw ──────────────────────────────────

describe('the observatory does not hog a shared GPU', () => {
  it('draws at full rate only when the picture is actually changing', () => {
    const base = { visible: true, focused: true, running: false, interacting: false };
    expect(targetFps({ ...base, running: true })).toBe(FPS_ACTIVE);
    expect(targetFps({ ...base, interacting: true })).toBe(FPS_ACTIVE);
    expect(targetFps(base)).toBe(FPS_IDLE);
    expect(targetFps({ ...base, focused: false })).toBe(FPS_IDLE);
    expect(targetFps({ ...base, focused: false, running: true })).toBe(FPS_IDLE);
    expect(targetFps({ ...base, visible: false, running: true })).toBe(FPS_HIDDEN);
  });

  it('keeps orbiting smooth even with the world paused and the window unfocused', () => {
    // The camera damps to a stop over the better part of a second; a view that
    // dropped to ten frames in the middle of that reads as a stutter.
    expect(targetFps({ visible: true, focused: false, running: false, interacting: true })).toBe(FPS_ACTIVE);
  });

  it('is an order of magnitude cheaper when nothing is happening', () => {
    expect(FPS_ACTIVE / FPS_IDLE).toBeGreaterThanOrEqual(5);
    expect(FPS_HIDDEN).toBeLessThan(FPS_IDLE);
    expect(FPS_ACTIVE).toBeLessThanOrEqual(60);
  });

  it('holds the capped rate on a display that runs faster than the cap', () => {
    // 144 Hz panel, 60 fps cap. Comparing timestamps naively renders every
    // third callback and delivers 48; the cadence has to be carried forward.
    let last = Number.NEGATIVE_INFINITY;
    let drawn = 0;
    const step = 1000 / 144;
    for (let f = 0; f < 144; f++) {
      const tick = nextFrameAt(f * step, last, FPS_ACTIVE);
      if (tick !== null) {
        last = tick;
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(58);
    expect(drawn).toBeLessThanOrEqual(61);
  });

  it('does not reject every other frame on a display that matches the cap', () => {
    let last = Number.NEGATIVE_INFINITY;
    let drawn = 0;
    for (let f = 0; f < 60; f++) {
      // A real 60 Hz panel delivers a hair under the nominal interval.
      const tick = nextFrameAt(f * 16.6, last, FPS_ACTIVE);
      if (tick !== null) {
        last = tick;
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(58);
  });

  it('idles at the rate it says it does', () => {
    let last = Number.NEGATIVE_INFINITY;
    let drawn = 0;
    const step = 1000 / 144;
    for (let f = 0; f < 144; f++) {
      const tick = nextFrameAt(f * step, last, FPS_IDLE);
      if (tick !== null) {
        last = tick;
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(9);
    expect(drawn).toBeLessThanOrEqual(11);
  });

  it('starts drawing immediately and never tries to catch up after a stall', () => {
    expect(nextFrameAt(0, Number.NEGATIVE_INFINITY, FPS_ACTIVE)).toBe(0);
    // Five seconds hidden behind another window: the next frame resets the
    // cadence rather than firing three hundred frames to make up the debt.
    expect(nextFrameAt(5000, 0, FPS_ACTIVE)).toBe(5000);
    expect(nextFrameAt(5, 0, FPS_ACTIVE)).toBeNull();
    expect(nextFrameAt(100, 0, 0)).toBeNull();
  });
});

// ── The ruler ────────────────────────────────────────────────────────────────

/**
 * Round six drew a scale bar that printed `200 UNITS` in every band under a
 * line clamped to at most 190 px — so at MID it spanned about five metres and
 * at NEAR about 1.9, claiming two hundred of an unnamed unit both times. On the
 * one instrument whose entire subject is that one unit is one metre, the ruler
 * was wrong by up to a hundred times, and a reviewer said so first.
 */
describe('the scale bar measures the ground it is drawn over', () => {
  it('snaps to the 1–2–5 series, in metres', () => {
    const spans = [];
    for (let e = -2; e <= 4; e++) {
      for (const m of [1, 1.3, 2.7, 6, 9.4]) {
        const mpp = (m * 10 ** e) / 140;
        spans.push(scaleBarFor(mpp).metres);
      }
    }
    for (const metres of spans) {
      const decade = 10 ** Math.floor(Math.log10(metres));
      expect([1, 2, 5]).toContain(Math.round(metres / decade));
    }
  });

  it('draws the span it prints — the bar IS metres ÷ metres-per-pixel', () => {
    for (const mpp of [0.004, 0.01, 0.05, 0.33, 1, 4.7, 19, 140]) {
      const bar = scaleBarFor(mpp);
      expect(bar.px).toBeCloseTo(bar.metres / mpp, 6);
    }
  });

  it('is always long enough to measure against, and never longer than its budget', () => {
    // The series steps by at most 2.5, so the largest span under 200 px is
    // never under 80 — that is why the bar needs no clamp, and a clamp is
    // exactly what made the old one a lie.
    for (let i = 0; i < 400; i++) {
      const mpp = 0.002 * 1.05 ** i;
      const bar = scaleBarFor(mpp);
      expect(bar.px).toBeLessThanOrEqual(200);
      expect(bar.px).toBeGreaterThanOrEqual(80);
    }
  });

  it('says metres up to a kilometre and kilometres past it, and never says "units"', () => {
    expect(scaleBarFor(2 / 140).label).toBe('2 m');
    expect(scaleBarFor(0.014).label).toBe('2 m');
    expect(scaleBarFor(1).label).toBe('200 m');
    expect(scaleBarFor(10).label).toBe('2 km');
    expect(scaleBarFor(4).label).toBe('500 m');
    for (const mpp of [0.001, 0.02, 0.7, 3, 40]) {
      expect(scaleBarFor(mpp).label).toMatch(/^[\d.]+ (m|km)$/);
      expect(scaleBarFor(mpp).label).not.toContain('unit');
    }
  });

  it('holds at a NEAR camera, where the old bar was a hundred times out', () => {
    // A 1.75 m adult standing 170 px tall is 0.0103 m per pixel.
    const bar = scaleBarFor(1.75 / 170);
    expect(bar.metres).toBeLessThanOrEqual(2);
    expect(bar.px).toBeCloseTo(bar.metres / (1.75 / 170), 6);
    expect(bar.label).toBe('2 m');
  });

  it('survives a camera that has not been placed yet', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bar = scaleBarFor(bad);
      expect(Number.isFinite(bar.px)).toBe(true);
      expect(bar.metres).toBeGreaterThan(0);
    }
  });
});

// ── A number that never covers a being ───────────────────────────────────────

/**
 * `default.png`, round six: a "24" chip sitting nine pixels from a pinned being
 * and hiding it completely, directly under a legend line reading "no pin is
 * drawn inside it". The reviewer's own note for that target was "no pin at
 * all". A count that hides one of the people it counts is not a count, and a
 * legend that promises otherwise is worse than no legend.
 */
describe('a crowd’s number sits outside its ring and off every being', () => {
  const VIEW = { w: 1400, h: 900 };

  const pinsAround = (seed: number, n: number): { x0: number; y0: number; x1: number; y1: number }[] =>
    scatter(seed, n, VIEW.w, VIEW.h).map((p) => ({ x0: p.x - 12, y0: p.y - 12, x1: p.x + 12, y1: p.y + 12 }));

  it('never lands on a pin when anywhere is free', () => {
    let clear = 0;
    for (let seed = 601; seed <= 640; seed++) {
      const hull = { x: 200 + (seed * 37) % 900, y: 150 + (seed * 53) % 600, rx: 30 + seed % 120, ry: 22 + seed % 90 };
      const pins = pinsAround(seed, 40);
      const at = placeCountChip(hull, 14, 9, pins, [], VIEW);
      if (!at.clear) continue;
      clear++;
      for (const pin of pins) {
        const hits = at.x - 14 < pin.x1 && at.x + 14 > pin.x0 && at.y - 9 < pin.y1 && at.y + 9 > pin.y0;
        expect(hits).toBe(false);
      }
    }
    expect(clear).toBeGreaterThan(30);
  });

  it('stands outside the outline it belongs to, not inside the crowd', () => {
    // The failure was arithmetic: the old offset was 0.72 of the extent, which
    // for any hull wider than the chip is inside it. The hulls here sit inside
    // one quarter of the frame, which is what `planCount` now produces.
    for (const rx of [20, 80, 200]) {
      const hull = { x: 350, y: 250, rx, ry: rx * 0.7 };
      const at = placeCountChip(hull, 14, 9, [], [], VIEW);
      const dx = (at.x - hull.x) / hull.rx;
      const dy = (at.y - hull.y) / hull.ry;
      expect(dx * dx + dy * dy).toBeGreaterThan(1);
    }
  });

  it('keeps its leader line home short — a number with no ring is not a count', () => {
    const hull = { x: 350, y: 250, rx: 120, ry: 90 };
    const at = placeCountChip(hull, 14, 9, [], [], VIEW);
    expect(Math.hypot(at.anchorX - at.x, at.anchorY - at.y)).toBeLessThan(40);
  });

  it('stays in its crowd’s own quarter of the frame, whatever that costs it', () => {
    // The constraint that replaced round two's thirty-point penalty. A hull
    // pressed against a mid-line with a wall of pins on the far side: the old
    // search bought its way across for less than a pin was worth, and the
    // twenty people it counted were read in the wrong corner.
    const wall = [{ x0: VIEW.w / 2 - 240, y0: 0, x1: VIEW.w / 2 + 240, y1: VIEW.h }];
    for (const region of [0, 1, 2, 3]) {
      const hull = {
        x: VIEW.w / 2 + ((region & 1) === 0 ? -30 : 30),
        y: VIEW.h / 2 + ((region & 2) === 0 ? -30 : 30),
        rx: 26, ry: 20, region,
      };
      const at = placeCountChip(hull, 14, 9, wall, [], VIEW);
      expect(regionOf(at.x, at.y, VIEW)).toBe(region);
      // …and it says out loud that it had to stand on somebody.
      expect(at.clear).toBe(false);
    }
  });

  it('keeps the whole disc inside its own quarter where the quarter has room', () => {
    for (const region of [0, 1, 2, 3]) {
      const hull = {
        x: VIEW.w / 2 + ((region & 1) === 0 ? -20 : 20),
        y: VIEW.h / 2 + ((region & 2) === 0 ? -20 : 20),
        rx: 40, ry: 30, region,
      };
      const at = placeCountChip(hull, 16, 9, [], [], VIEW);
      const x0 = (region & 1) === 0 ? 0 : VIEW.w / 2;
      const y0 = (region & 2) === 0 ? 0 : VIEW.h / 2;
      expect(at.x - 16).toBeGreaterThanOrEqual(x0);
      expect(at.x + 16).toBeLessThanOrEqual(x0 + VIEW.w / 2);
      expect(at.y - 9).toBeGreaterThanOrEqual(y0);
      expect(at.y + 9).toBeLessThanOrEqual(y0 + VIEW.h / 2);
    }
  });

  it('admits it when the frame has nowhere free — it does not pretend', () => {
    // A being under every slot: the chip has to shrink and fade, and `clear`
    // is the view saying so out loud rather than covering somebody quietly.
    const wall = [{ x0: 0, y0: 0, x1: VIEW.w, y1: VIEW.h }];
    const at = placeCountChip({ x: 700, y: 450, rx: 60, ry: 40 }, 14, 9, wall, [], VIEW);
    expect(at.clear).toBe(false);
    expect(at.covers).toBeGreaterThan(0);
  });

  it('stays inside the canvas', () => {
    for (const hull of [
      { x: 8, y: 8, rx: 60, ry: 40 },
      { x: VIEW.w - 6, y: VIEW.h - 6, rx: 90, ry: 70 },
      { x: VIEW.w / 2, y: 2, rx: 200, ry: 160 },
    ]) {
      const at = placeCountChip(hull, 18, 9, [], [], VIEW);
      expect(at.x - 18).toBeGreaterThanOrEqual(0);
      expect(at.x + 18).toBeLessThanOrEqual(VIEW.w);
      expect(at.y - 9).toBeGreaterThanOrEqual(0);
      expect(at.y + 9).toBeLessThanOrEqual(VIEW.h);
    }
  });
});

// ── One sentence about names ─────────────────────────────────────────────────

describe('the naming claim is one sentence, and it is the one the chip prints', () => {
  /**
   * Round eight printed "NAMES WITHIN 0 M · 4 SHOWN", and every word of it was
   * true. The radius was measured honestly — the distance to the nearest
   * readable being the frame had not named — while the budgeter chose who to
   * name by RANK, so it named people it called unreadable out at 13–17 m and
   * left a readable one unnamed at 4.12 m, which collapsed the radius to
   * nothing under four drawn names.
   *
   * So the rule changed rather than the sentence. The claim is now the true
   * one: the k nearest readable beings, nearest first, and how far that reached.
   */
  it('says how many were named, in what order, and how far that reached', () => {
    expect(nameClaimFor('near', 13.4, 6)).toBe('6 named · nearest first · out to 13.40 m');
    expect(nameClaimFor('near', 0, 0)).toBe('0 named · nearest first');
    // The exact sentence round eight printed, and can no longer: a radius is
    // not what this band claims any more, so there is no radius to collapse.
    for (const shown of [0, 4, 18]) expect(nameClaimFor('near', 0, shown)).not.toContain('within');
  });

  /**
   * The one exception to "nearest first", printed rather than documented: the
   * people inside a hut are labelled by the number on its roof and by nothing
   * else. A reader standing among seventy of them must not have to work out why
   * none of them has a name.
   */
  it('counts the people a hut is speaking for, out loud, in the strip', () => {
    expect(nameClaimFor('near', 21.54, 5, 71)).toBe('5 named · nearest first · out to 21.54 m · 71 more counted on their huts');
    expect(nameClaimFor('near', 0, 0, 12)).toBe('0 named · nearest first · 12 more counted on their huts');
    expect(nameClaimFor('near', 9, 3, 0)).not.toContain('huts');
    expect(nameClaimFor('mid', 0, 4, 22)).toContain('22 more counted on their huts');
  });

  it('does not owe a name to somebody their hut is already speaking for', () => {
    const housed = [
      { distance: 2.0, readable: true, carried: true, named: false },
      { distance: 3.0, readable: true, carried: true, named: false },
      { distance: 9.0, readable: true, carried: false, named: true },
    ];
    const plan = namePlan(housed);
    expect(plan.violations).toBe(0);
    expect(plan.outOfOrder).toBe(0);
    expect(plan.carried).toBe(2);
    expect(plan.within).toBe(1);
    // And an unhoused being nearer than a name is still the violation it was.
    expect(namePlan([...housed, { distance: 4.0, readable: true, carried: false, named: false }]).violations).toBe(1);
  });

  /**
   * MID and DEFAULT promise "found and selected first, then nearest, where
   * there is room", which owes nobody a name — so `violations` is 0 there by
   * definition, and `outOfOrder` reports the same measurement anyway rather
   * than hiding what the weaker promise costs.
   */
  it('separates the band s promise from the raw measurement', () => {
    const frame = [
      { distance: 4, readable: true, carried: false, named: false },
      { distance: 30, readable: true, carried: false, named: true },
    ];
    expect(namePlan(frame, true).violations).toBe(1);
    expect(namePlan(frame, false).violations).toBe(0);
    expect(namePlan(frame, false).outOfOrder).toBe(1);
    expect(namePlan(frame, true).outOfOrder).toBe(1);
  });

  it('never promises a radius in a band that does not name nearest-first', () => {
    expect(nameClaimFor('default', 0, 4)).not.toContain('out to');
    expect(nameClaimFor('mid', 0, 4)).toContain('then nearest');
    expect(nameClaimFor('far', 0, 1)).toContain('only the selected being');
  });

  it('reads the reach off the names that were actually drawn', () => {
    const subjects = [];
    for (let i = 0; i < 120; i++) {
      const distance = 0.4 + i * 0.35;
      subjects.push({ distance, readable: i % 9 !== 0, carried: false, named: false });
    }
    // The NEAR rule: the nearest readable beings, in order, and stop.
    let named = 0;
    for (const s of subjects.slice().sort((a, b) => a.distance - b.distance)) {
      if (!s.readable || named >= 14) continue;
      s.named = true;
      named++;
    }
    const plan = namePlan(subjects);
    expect(plan.violations).toBe(0);
    expect(plan.within).toBe(14);
    expect(plan.within).toBe(subjects.filter((s) => s.named).length);
    // The strip prints the audit's own number, to the digit.
    expect(nameClaimFor('near', plan.withinM, plan.within))
      .toBe(`14 named · nearest first · out to ${plan.withinM.toFixed(2)} m`);
  });

  /**
   * The invariant, as a property over three hundred crowded frames: no readable
   * being is left unnamed while somebody FURTHER AWAY has a name. That is the
   * whole of what NEAR claims, and `violations` is the view counting it against
   * itself rather than asserting it.
   */
  it('leaves nobody readable unnamed inside a name further out', () => {
    for (let seed = 1; seed <= 320; seed++) {
      const next = rng(seed);
      const people = [];
      // A quarter of the readable ones are inside a hut, so the exception the
      // shelter chips carve out is under the property too.
      for (let i = 0; i < 60; i++) people.push({ distance: next() * 40, readable: next() > 0.2, carried: next() < 0.25, named: false });
      const budget = 1 + Math.floor(next() * 17);
      // The rule, including the part that costs a name: the first candidate
      // that cannot be placed ENDS the list.
      let placed = 0;
      for (const p of people.slice().sort((a, b) => a.distance - b.distance)) {
        if (!p.readable || p.carried) continue;
        if (placed >= budget || next() < 0.08) break;
        p.named = true;
        placed++;
      }
      const plan = namePlan(people);
      expect(plan.violations).toBe(0);
      expect(plan.within).toBe(placed);
      expect(plan.carried).toBe(people.filter((p) => p.readable && p.carried).length);
      if (placed > 0) {
        // The printed number never understates the reach, so no being the frame
        // named stands outside the distance the strip quotes.
        for (const p of people) if (p.named) expect(p.distance).toBeLessThanOrEqual(plan.withinM);
      } else {
        expect(plan.withinM).toBe(0);
      }
    }
  });

  /**
   * And the failure the rule is against, stated directly: rank-first naming —
   * a selected being out at 13 m, a nearer readable one with nothing — is
   * exactly what `violations` counts, so the test that passes for the new rule
   * fails for the old one.
   */
  it('counts a name drawn past a nearer readable being as the violation it is', () => {
    const rankFirst = [
      { distance: 4.12, readable: true, carried: false, named: false }, // the reviewer's Marosh
      { distance: 13.14, readable: true, carried: false, named: true }, // the reviewer's Selur
    ];
    expect(namePlan(rankFirst).violations).toBe(1);
    const nearestFirst = [
      { distance: 4.12, readable: true, carried: false, named: true },
      { distance: 13.14, readable: true, carried: false, named: false },
    ];
    expect(namePlan(nearestFirst).violations).toBe(0);
    expect(namePlan(nearestFirst).withinM).toBeCloseTo(4.12, 6);
  });

  /**
   * The placement half of the same rule. `strict` takes the candidates in the
   * order they were handed over and stops at the first one it cannot place, so
   * a nearer being that loses a slot to a collision keeps its priority and the
   * being behind it loses its name instead of jumping the queue.
   */
  it('stops the list at the first name it cannot place, rather than skipping over it', () => {
    const cands = [0, 1, 2, 3].map((i) => ({ id: i + 1, x: 120 + i * 200, y: 300, rank: i, text: `B${i}` }));
    // A wall of obstacle across every slot the SECOND candidate could use.
    const wall = [{ x0: cands[1]!.x - 200, y0: 0, x1: cands[1]!.x + 200, y1: 600 }];
    const strict = placeLabels(cands, 1200, 700, 8, wall, 14, 200, true);
    expect(strict.map((p) => p.id)).toEqual([1]);
    // Without it, the frame happily labels the two behind the one it skipped —
    // which is a picture that names people past somebody it did not name.
    const loose = placeLabels(cands, 1200, 700, 8, wall, 14, 200, false);
    expect(loose.map((p) => p.id)).toEqual([1, 3, 4]);
  });

  it('bounds a figure by what was DRAWN, lean and all', () => {
    // The upright figure, and the poses the view actually puts them in: a
    // worker swinging at something is half a radian forward, and a box that
    // ignores it leaves a third of that body outside itself — which is where
    // two "visible" beings with somebody else drawn over them came from.
    expect(figureSpread(0, false)).toBeCloseTo(FIGURE_HALF_W, 6);
    expect(figureSpread(0.52, false)).toBeGreaterThan(figureSpread(0.07, false));
    expect(figureSpread(0.9, true)).toBe(0.52); // laid out flat: width is height
    // Monotone in the lean, and never narrower than standing straight.
    let last = 0;
    for (let lean = 0; lean <= 1.2; lean += 0.05) {
      const s = figureSpread(lean, false);
      expect(s).toBeGreaterThanOrEqual(FIGURE_HALF_W);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    // A lean back is as wide as a lean forward — the sign is a direction, not
    // a size.
    expect(figureSpread(-0.4, false)).toBeCloseTo(figureSpread(0.4, false), 6);
  });

  it('caps a badge against the figure it belongs to, at any marker size', () => {
    // The marker is a MAP unit and holds a screen size out wide, so a badge
    // sized purely from it outgrew the being it described — eight badges
    // outweighing fourteen people. Figure-relative, it cannot.
    for (const figure of [CHILD_M, ADULT_M, ELDER_M]) {
      for (const marker of [0.4, 1.875, 6, 40, 400]) {
        for (const share of [0.64, 0.64 * 0.58]) {
          const s = badgeMetres(marker, share, figure);
          expect(s).toBeLessThanOrEqual(figure * PICTO_MAX_OF_FIGURE + 1e-9);
          expect(s).toBeLessThanOrEqual(marker * share + 1e-9);
        }
      }
    }
    // Small markers are left alone: the cap is a ceiling, not a size.
    expect(badgeMetres(0.5, 0.64, ADULT_M)).toBeCloseTo(0.32, 6);
  });
});
