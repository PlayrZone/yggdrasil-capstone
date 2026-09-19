import { describe, expect, it } from 'vitest';
import {
  activityWord,
  BAND_EDGE_PX,
  BAND_ORDER,
  bandCountsBeings,
  bandForPixels,
  bandPromise,
  bandShowsBodies,
  bandShowsDetail,
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
  LEGEND_EXTRA,
  legendFor,
  maxLeaderFor,
  movingFor,
  NEAR_LABEL_M,
  nextFrameAt,
  octantDistance,
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
    for (let d = 3; d <= WORLD * 1.35; d += 3) reached.add(bandForPixels(figurePxAt(d, WORLD_PER_PX)));
    expect(reached).toEqual(new Set(BAND_ORDER));
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
    expect(bandPromise('near').names).toBe('all');
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
    }
    // NEAR draws no chips at all, so it must not print one in the key.
    expect(legendFor('near').flatMap((s) => s.items).some((i) => i.kind === 'chip')).toBe(false);
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
