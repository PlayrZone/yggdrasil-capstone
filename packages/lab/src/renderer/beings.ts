/**
 * How a being is drawn, as data — and how that changes with the zoom.
 *
 * The governing idea here is SEMANTIC ZOOM. Rounds one and two drew a being at
 * one constant ~19 px size at every camera distance and tried to hang stage,
 * heading, activity and condition on it; a stranger read stage at 60% and
 * heading at 55%, because no 19 px mark carries four channels. Serious map and
 * robotics views do not try. They change WHAT is drawn with the zoom and say so.
 *
 * So there are four bands, each with a contract it keeps and nothing it does
 * not promise:
 *
 *   FAR      how many, where, which is selected.
 *   DEFAULT  every being individually countable; condition on the marker.
 *   MID      heading, stage, activity and condition all readable.
 *   NEAR     the whole figure, everything, names on all of them.
 *
 * Every channel the world view spends on beings is declared here, once: which
 * colour and which ring a condition takes, which pictogram an act takes, how a
 * life stage changes the footprint, how a crowd is counted and split, where a
 * name is allowed to sit, and what the legend is allowed to claim in each band.
 * The 3D view reads this to draw, the legend reads this to explain, and the
 * tests read this to check that the two agree — a legend that drifts from the
 * render is worse than none.
 *
 * Pure: no DOM, no three, no engine. It runs in Node.
 */

import { SHELTER } from './legibility.js';
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
} from './sim/protocol.js';

// ── The world is life-size ───────────────────────────────────────────────────

/**
 * ONE world unit is ONE METRE, horizontally, everywhere.
 *
 * The sim's own numbers are what settle it, not a preference: a being can see
 * 92 units by day and 38 at night, it counts itself "in shelter" within 4 units
 * of one, and "near water" within 12. Read as metres those are a person's
 * sight-line, a hut, and a walk to the river. Read as anything else they are
 * not: at ten metres to the unit a being recognises faces a kilometre away and
 * lives in a forty-metre hall. So: metres, and the continent is 2 km across.
 *
 * The one thing that is NOT a length is the sim's height field. `heightAt`
 * returns an index — the engine's own `elevationBand` cuts it at 4 and 8 — so
 * the view multiplies it to get metres, and `HSCALE` in `World3D` is that
 * conversion and nothing else.
 *
 * Everything with a body obeys this. Round two went the other way: it shrank
 * the huts to two-thirds and grew the people until they read, and the result
 * was a person taller than the house they built. A view where the world is the
 * wrong size to make the subject visible has stopped being a view of the world.
 * Legibility is the ANNOTATION layer's job — see `annotationRadius`.
 */
export const ADULT_M = 1.75;
export const CHILD_M = 1.08;
export const ELDER_M = 1.60;

// ── Zoom bands ───────────────────────────────────────────────────────────────

export type ZoomBand = 'far' | 'default' | 'mid' | 'near';

/** Wide to close. The index into this is what the hysteresis walks. */
export const BAND_ORDER: readonly ZoomBand[] = ['far', 'default', 'mid', 'near'];

/**
 * Where one band ends and the next begins, measured in the only unit that
 * matters to a reader: how many CSS pixels tall a grown being STANDS on screen.
 *
 * Distance is the wrong unit to state a contract in — it depends on the field
 * of view and the size of the canvas. "A being is forty pixels" is a fact about
 * the picture, and it is the fact the promises are made of. What buys those
 * forty pixels is the CAMERA COMING CLOSER, never a figure drawn bigger than
 * its own house: MID is a village from a rooftop, about forty metres out, and
 * NEAR is standing in the street with them.
 *
 * Under a pixel — a whole continent in one frame — a person is not a picture at
 * all, and the view stops pretending: out there it draws map annotation.
 */
export const BAND_EDGE_PX: readonly number[] = [0.62, 40, 120];

/**
 * How tall a being's BODY has to stand before the detail bands claim anything
 * about it.
 *
 * It is the MID edge, and that is not a coincidence — it is the definition.
 * Forty pixels is the size at which this view says stage, activity, condition
 * and heading become readable, so a being drawn smaller than that is a being no
 * band promises those channels about, whichever band the camera is in.
 *
 * Round five's first MID frame is what this is for. The camera stood in a
 * settlement, and `visibleIds()` answered one hundred — because out on the far
 * side of the valley a being is ten pixels tall but its PIN still holds
 * twenty-four, and the size test was asking about the pin. The band's contract
 * there is the body. Every one of those ninety extra "visible" beings was
 * round four's defect with a different number in front of it.
 */
export const DETAIL_MIN_PX = BAND_EDGE_PX[1]!;

/**
 * How far past an edge the view must travel before it admits the band changed.
 *
 * Without this a camera resting a pixel from an edge flips the whole vocabulary
 * back and forth every frame — the legend rewrites itself, badges appear and
 * vanish, and the view looks broken rather than adaptive.
 */
export const BAND_HYSTERESIS = 0.07;

/**
 * How tall a grown being stands on screen, in CSS pixels, at this distance.
 *
 * `worldPerPx` is the view's own number: world units per pixel at one unit of
 * distance, which is `2·tan(fov/2) / canvasHeight`. Nothing here is a choice —
 * it is the projection, and it is what decides which band the camera is in.
 */
export function figurePxAt(distance: number, worldPerPx: number): number {
  return ADULT_M / Math.max(1e-9, distance * worldPerPx);
}

/** The inverse: how far back the camera has to stand for a being this tall. */
export function distanceForFigurePx(px: number, worldPerPx: number): number {
  return ADULT_M / Math.max(1e-9, px * worldPerPx);
}

/** Room past the FAR edge, so the band is somewhere to BE and not a hairline. */
const FAR_HEADROOM = 1.3;

/**
 * How far the orbit is allowed to pull back — stated in the same terms as the
 * bands, because the alternative is a band that does not exist.
 *
 * Round four could not enter FAR at all on a maximized window. The reason was
 * a unit mismatch and nothing else: the band edges are in CSS pixels of BEING,
 * which depend on the height of the canvas, while the orbit limit was a fixed
 * 1.35 world-spans. On a 630 px canvas 2700 m put a being at 0.49 px and FAR
 * opened; on an 1165 px canvas the same 2700 m is 0.91 px, the camera hit the
 * stop still in DEFAULT, and a whole contract became unreachable by making the
 * window bigger.
 *
 * So the limit is now derived from the table: far enough that a being is
 * comfortably under the FAR edge INCLUDING the hysteresis it has to cross, with
 * headroom, and never nearer than the old span-based reach on a small window.
 * `floor` keeps the wide shot at least as wide as it has always been.
 */
export function maxOrbitDistance(worldPerPx: number, floor: number): number {
  const enterFar = distanceForFigurePx(BAND_EDGE_PX[0]! * (1 - BAND_HYSTERESIS), worldPerPx);
  return Math.max(floor, enterFar * FAR_HEADROOM);
}

/**
 * How big the ground ANNOTATION is, in metres, at this distance — the ring, the
 * pointer, the streak and the pictogram chip are all sized from it.
 *
 * This is the whole separation the view rests on. A being is always 1.75 m and
 * is therefore a pixel across the continent and two hundred in the street. That
 * is true and it is useless on its own, so out where the body is too small to
 * be a picture the view draws a MAP over it: a mark that holds its own size on
 * screen, like a pin, and says how many and where and how each one is. Come
 * closer and the pin stops growing in metres — it settles at the size of the
 * ground a person stands on — and the real scene takes over from it.
 *
 * `max` of the two rules is what makes the changeover seamless: the screen-held
 * radius falls below a person's own footprint at about seventy metres out, and
 * from there in the annotation simply IS the footprint.
 */
export const ANNOTATION_MIN_M = 0.75;
const ANNOTATION_R_PX = 10.5;

export function annotationRadius(distance: number, worldPerPx: number): number {
  return Math.max(ANNOTATION_MIN_M, ANNOTATION_R_PX * distance * worldPerPx);
}

/**
 * How strongly the annotation is drawn. Full out where it is the only thing
 * carrying meaning; faded down close in, where it would be graffiti over a
 * scene that is already saying it.
 */
export function annotationOpacity(band: ZoomBand): number {
  return band === 'near' ? 0.42 : band === 'mid' ? 0.80 : 0.94;
}

/**
 * Which band a being of this many screen pixels belongs to, given the band the
 * view is already in. Passing `undefined` asks for the band with no memory —
 * what a cold start or a test wants.
 */
export function bandForPixels(px: number, previous?: ZoomBand): ZoomBand {
  let raw = 0;
  while (raw < BAND_EDGE_PX.length && px >= BAND_EDGE_PX[raw]!) raw++;
  if (previous === undefined) return BAND_ORDER[raw]!;
  let at = BAND_ORDER.indexOf(previous);
  if (at < 0) return BAND_ORDER[raw]!;
  while (at < raw && px >= BAND_EDGE_PX[at]! * (1 + BAND_HYSTERESIS)) at++;
  while (at > raw && px <= BAND_EDGE_PX[at - 1]! * (1 - BAND_HYSTERESIS)) at--;
  return BAND_ORDER[at]!;
}

/**
 * How many names a band is willing to float over the world at once.
 *
 * NEAR spends every node it has. Its contract is that everyone close enough to
 * walk to is named, and a budget that runs out before the radius does turns
 * that into a claim the picture cannot keep — which is exactly what round four
 * found: nineteen beings in frame, four names, and a legend saying "every being
 * in frame is named". The view now shrinks the RADIUS until the names it can
 * actually place cover everyone inside it, and prints the radius it reached.
 */
export function labelBudgetFor(band: ZoomBand): number {
  return band === 'near' ? LABEL_BUDGET_MAX : band === 'mid' ? 10 : band === 'default' ? 7 : 2;
}

/**
 * How far a name may sit from the being it belongs to, and how long a leader
 * line home is allowed to be.
 *
 * Round three scaled both with the FIGURE, reasoning that a twelve-pixel gap
 * over a two-hundred-pixel body is a name written on its face. But the name is
 * anchored to the being's HEAD, not its feet, so the gap over the head never
 * needed to grow at all — and at NEAR the offsets became three hundred pixels,
 * producing the label web a reviewer found: fifteen names on metre-long leader
 * lines crossing each other and the frame.
 */
export function labelClearanceFor(band: ZoomBand, bandPx: number): number {
  return Math.min(band === 'near' ? 20 : 30, Math.max(11, bandPx * 0.26));
}

/**
 * The longest leader line a band will draw before it drops the name instead.
 *
 * NEAR's was 52 px, which refused every slot past the second one — and with
 * eighteen beings in the street competing for the air over each other's heads,
 * refusing the third slot is refusing the name. Eighty is still well short of
 * the metre-long leaders that made round three's label web.
 */
export function maxLeaderFor(band: ZoomBand): number {
  return band === 'near' ? 80 : 150;
}

/**
 * At NEAR, how close a being has to be before the view offers it a name.
 *
 * Standing in the street, every being on the far side of the valley is still in
 * frame and still has a name — and a name for each of them is a page of text
 * over a picture of six people. The selected being, the hovered one and anyone
 * they are related to are named wherever they are; everybody else has to be
 * close enough to walk to.
 */
export const NEAR_LABEL_M = 25;

export const LABEL_BUDGET_MAX = 18;
export const CLUSTER_BUDGET = 24;

/**
 * Exactly what a band claims a reader can get off the picture, and the accuracy
 * a stranger test holds it to. Anything false here must not appear in the
 * legend, must not be drawn, and must be reported as `null` by the probes: a
 * view that half-draws a channel is a view that gets scored on it.
 */
export interface BandPromise {
  band: ZoomBand;
  /** How many beings are in the frame, and in any quadrant of it. */
  count: number | null;
  /** well · starving · sick · in danger. */
  condition: number | null;
  /** child · adult · elder. */
  stage: number | null;
  /** The six-word activity vocabulary, split by the streak into seven readings. */
  activity: number | null;
  /** Which of eight compass points the pointer aims at, on screen. */
  heading: number | null;
  /** Finding the selected being. */
  selected: number | null;
  /**
   * Whether only the found being is named, some are, or everyone inside a
   * measured radius is.
   *
   * There is no `all`. "Every being on screen is named" was false in every
   * frame that had more beings in it than the budget has nodes, and a promise
   * that is true only on a quiet frame is not a promise.
   */
  names: 'found' | 'some' | 'within';
  /**
   * Where `names` is `within`, the furthest the naming rule ever LOOKS, in
   * metres — a being past this is not a candidate for a name at all.
   *
   * It is not the claim. The claim is the radius the frame actually reached,
   * which is measured every frame and printed by the band chip; `labelAudit()`
   * reports that radius, how many names the budgeter placed, and how many are
   * on screen, and those last two are the same number or the view is lying.
   */
  namesWithinM: number | null;
  /** One line, for the band indicator over the canvas. */
  says: string;
}

const PROMISES: Record<ZoomBand, BandPromise> = {
  far: {
    band: 'far', count: 0.10, condition: null, stage: null, activity: null, heading: null,
    selected: 1, names: 'found', namesWithinM: null, says: 'how many · where · which is selected',
  },
  default: {
    band: 'default', count: 0.10, condition: 0.70, stage: null, activity: null, heading: null,
    selected: 1, names: 'some', namesWithinM: null, says: 'every being countable · how it is',
  },
  // MID and NEAR promise no COUNT, and that is the world being life-size
  // rather than a retreat. Thirty metres from a being, the far side of the
  // valley is still in frame and the people on it are half a pixel — real, and
  // not a picture of anything. A band that promised a count here would be
  // promising one for beings it is honestly not drawing. Counting is what you
  // pull back for, and that is what the chip over the canvas says.
  mid: {
    band: 'mid', count: null, condition: 0.80, stage: 0.80, activity: 0.80, heading: 0.80,
    selected: 1, names: 'some', namesWithinM: null,
    says: 'facing · age · doing · how it is · nothing hides · pull back to count',
  },
  near: {
    band: 'near', count: null, condition: 0.90, stage: 0.90, activity: 0.90, heading: 0.90,
    selected: 1, names: 'within', namesWithinM: NEAR_LABEL_M,
    says: 'the whole figure · everything it is doing',
  },
};

export function bandPromise(band: ZoomBand): BandPromise {
  return PROMISES[band];
}

/** Bands that draw the marker's pointer, pictogram, streak and stage forms. */
export function bandShowsDetail(band: ZoomBand): boolean {
  return band === 'mid' || band === 'near';
}

/** Bands that draw a being as a figure in a ring rather than as a presence dot. */
export function bandShowsBodies(band: ZoomBand): boolean {
  return band !== 'far';
}

// ── The ruler ────────────────────────────────────────────────────────────────

/**
 * The scale bar: a round number of METRES and the pixels it spans in this
 * frame.
 *
 * Round six printed `200 units` under a bar clamped to at most 190 px in every
 * band — so at NEAR the bar spanned 1.9 m of ground while claiming two hundred,
 * wrong by a hundred times on the one piece of chrome whose entire job is that
 * one unit is one metre. A scale bar is not a decoration with a caption: it is
 * the only thing in the frame a reader can measure the world against, so it is
 * computed from the ground the camera is actually looking at and labelled with
 * what it measured.
 *
 * The span is snapped to the cartographic 1–2–5 series (1 m, 2 m, 5 m, 10 m …
 * 2 km), because a bar reading "137 m" is a number a reader has to do
 * arithmetic with. Taking the largest step that fits `maxPx` guarantees the bar
 * is never shorter than `maxPx / 2.5` — the ratio between neighbouring steps —
 * so with the default 200 it is always at least 80 px of drawn line.
 */
const SCALE_STEPS: readonly number[] = [1, 2, 5];

export interface ScaleBar {
  /** The span the bar stands for, in metres. */
  metres: number;
  /** How wide it is drawn, in CSS pixels. `px ≈ metres / metresPerPx`. */
  px: number;
  /** What is printed over it — metres up to a kilometre, then km. */
  label: string;
}

export function scaleBarFor(metresPerPx: number, maxPx = 200): ScaleBar {
  const mpp = Number.isFinite(metresPerPx) && metresPerPx > 0 ? metresPerPx : 1;
  const cap = Math.max(12, maxPx);
  let metres = 1e-4;
  // Largest round span that still fits the pixel budget. The series is walked
  // rather than derived from a logarithm so the value is exactly 1, 2 or 5
  // times a power of ten and the label carries no floating-point dust.
  for (let e = -4; e <= 7; e++) {
    for (const step of SCALE_STEPS) {
      const span = e < 0 ? step / 10 ** -e : step * 10 ** e;
      if (span / mpp > cap) continue;
      if (span > metres) metres = span;
    }
  }
  return { metres, px: metres / mpp, label: scaleBarLabel(metres) };
}

function scaleBarLabel(metres: number): string {
  if (metres >= 1000) {
    const km = metres / 1000;
    return `${Number(km.toFixed(3))} km`;
  }
  return `${Number(metres.toFixed(4))} m`;
}

// ── How often the view is allowed to redraw ──────────────────────────────────

/**
 * An observatory is not a game, and it shares a machine.
 *
 * The loop this view runs in is a bare `requestAnimationFrame`, which on a
 * 144 Hz panel means a hundred and forty-four full WebGL frames a second — a
 * continent, six thousand trees and three hundred instanced beings — for a
 * picture that, with the world paused, is identical every time. On a shared GPU
 * that is simply taken from whatever else the machine is doing.
 *
 * So the view draws at the rate the PICTURE needs, and nothing above it: sixty
 * while something is actually changing, ten while it is not, two while nobody
 * is looking at it. Orbiting counts as changing — a camera that damps to a stop
 * at ten frames a second feels broken — and so does a running world, because
 * every being in it is moving.
 */
export const FPS_ACTIVE = 60;
export const FPS_IDLE = 10;
export const FPS_HIDDEN = 2;

export interface FrameNeed {
  /** The document is on screen at all. */
  visible: boolean;
  /** The window has focus — somebody is looking at this and not at something else. */
  focused: boolean;
  /** The world is advancing, so every being in the frame is in a new place. */
  running: boolean;
  /** The camera is being driven, or is still coming to rest. */
  interacting: boolean;
}

export function targetFps(need: FrameNeed): number {
  if (!need.visible) return FPS_HIDDEN;
  if (need.interacting) return FPS_ACTIVE;
  if (!need.focused) return FPS_IDLE;
  return need.running ? FPS_ACTIVE : FPS_IDLE;
}

/**
 * Whether this animation-frame callback should draw, and the cadence mark to
 * carry forward if it does. `null` means skip — draw nothing, allocate nothing.
 *
 * The mark advances by exactly one interval rather than being set to `now`, so
 * a display running faster than the cap still averages the cap instead of
 * losing a whole frame to rounding every time: at 144 Hz a 60 fps cap that
 * simply compared timestamps would deliver 48. A stall longer than one interval
 * resets the cadence rather than trying to catch up, because catching up on a
 * shared GPU is the opposite of the point.
 */
export function nextFrameAt(now: number, last: number, fps: number): number | null {
  if (fps <= 0) return null;
  const interval = 1000 / fps;
  // A 60 Hz panel delivers 16.6 ms against a 16.667 ms interval; without a
  // little slack the cap would reject every other frame and halve the rate.
  if (now - last < interval - 1.5) return null;
  const stepped = last + interval;
  return now - stepped > interval ? now : stepped;
}

// ── Pictograms ───────────────────────────────────────────────────────────────

/**
 * What a being is DOING, in at most six marks.
 *
 * Round two had eight badges on one axis that also carried condition, and the
 * triangle meant BOTH "fleeing" and "hurt" — so a reader who called a wounded
 * walker "fleeing" was marked wrong by a probe that (correctly) said "walking".
 * A mark that means two things is not a mark.
 *
 * Here the pictogram is activity and only activity. Condition lives entirely on
 * the ring, where it has a shape, a lightness and a body tint of its own. Eating
 * and drinking are one mark, because at forty pixels they were never two.
 */
export const PICTO_NONE = 0;
export const PICTO_REST = 1;
export const PICTO_EAT = 2;
export const PICTO_WORK = 3;
export const PICTO_SPEAK = 4;
export const PICTO_ALARM = 5;
export const PICTO_COUNT = 6;
/** The atlas is a square grid of this many cells per side. */
export const PICTO_GRID = 3;

export function pictogramFor(act: number): number {
  switch (act) {
    case ACT_RESTING: return PICTO_REST;
    case ACT_EATING: return PICTO_EAT;
    case ACT_DRINKING: return PICTO_EAT;
    case ACT_WORKING: return PICTO_WORK;
    case ACT_SOCIAL: return PICTO_SPEAK;
    case ACT_DANGER: return PICTO_ALARM;
    default: return PICTO_NONE; // idle and walking wear nothing — the streak tells them apart
  }
}

/**
 * The word a reader is expected to produce for what a being is doing, in a band
 * that promises activity at all.
 *
 * This — not the sim's own eight-word act list — is what a stranger test scores
 * against, because it is what the picture actually says. Merging eating and
 * drinking into one reading is a promise kept; pretending the view separates
 * them is a promise broken.
 */
export function readableActivity(act: number, band: ZoomBand): string | null {
  if (!bandShowsDetail(band)) return null;
  switch (act) {
    case ACT_RESTING: return 'asleep';
    case ACT_EATING:
    case ACT_DRINKING: return 'eating or drinking';
    case ACT_WORKING: return 'working';
    case ACT_SOCIAL: return 'speaking';
    case ACT_DANGER: return 'fleeing';
    case ACT_WALKING: return 'walking';
    default: return 'standing';
  }
}

// ── Condition → colour, ring and word ────────────────────────────────────────

/**
 * Four colours, and only four — but colour is the last channel here, not the
 * first.
 *
 * Round one encoded condition as hue and claimed a badge made it redundant. It
 * did not: simulated for deuteranopia and protanopia, rose `#ff5f7a` and amber
 * `#f0a63c` landed on the same olive. So this palette is chosen on LIGHTNESS,
 * which no colour deficiency touches: bone 95, amber 75, violet 51, blood 33 in
 * L*. `test/beings.test.ts` runs the Viénot matrices over every pair and fails
 * the build if any two come within ΔE 45 or 12 points of L*.
 *
 * On top of that, condition owns a ring SHAPE (solid, dashed, double, notched)
 * and a body tint. Three channels, any one of which carries the meaning alone —
 * and from DEFAULT outward it is the only thing the marker promises, so nothing
 * about it depends on a badge that might belong to the neighbour.
 */
export const HUE_WELL = 0xf6efdc;
export const HUE_STARVING = 0xffa726;
export const HUE_SICK = 0x8a5cf0;
export const HUE_DANGER = 0x9c0b26;

/** The ring under a being says how it is, by shape as well as by colour. */
export const RING_SOLID = 0;
export const RING_DASHED = 1;
export const RING_DOUBLE = 2;
export const RING_NOTCHED = 3;
export const RING_STYLE_COUNT = 4;

/**
 * Whether a being is going somewhere.
 *
 * Walking and standing are the two commonest states in any frame and the only
 * two that wear no pictogram, so in a still screenshot round two left them a
 * coin flip — it misread them twice. Motion is not something a still picture
 * has, so it has to be drawn: a moving being trails a streak on the ground
 * behind it, and a standing one does not.
 */
export function movingFor(act: number): boolean {
  return act === ACT_WALKING || act === ACT_DANGER;
}

export function conditionHue(cond: number, act: number): number {
  if ((cond & COND_SICK) !== 0) return HUE_SICK;
  if ((cond & COND_HURT) !== 0 || act === ACT_DANGER) return HUE_DANGER;
  if ((cond & COND_STARVING) !== 0) return HUE_STARVING;
  return HUE_WELL;
}

/**
 * The ring shape for a condition. Same precedence as the hue, so both always
 * tell the same story: a dashed ring is a being running out of food whether or
 * not you can see that it is amber.
 */
export function ringStyleFor(cond: number, act: number): number {
  if ((cond & COND_SICK) !== 0) return RING_DOUBLE;
  if ((cond & COND_HURT) !== 0 || act === ACT_DANGER) return RING_NOTCHED;
  if ((cond & COND_STARVING) !== 0) return RING_DASHED;
  return RING_SOLID;
}

/** The one word for a condition — what a reader is asked to name it. */
export function conditionWord(cond: number, act: number): string {
  if ((cond & COND_SICK) !== 0) return 'sick';
  if ((cond & COND_HURT) !== 0 || act === ACT_DANGER) return 'in danger';
  if ((cond & COND_STARVING) !== 0) return 'starving';
  return 'well';
}

/**
 * The colour a BODY takes for a condition — the ring's colour pulled toward
 * bone.
 *
 * The ring can be blood-dark because it is drawn unlit and full strength. A
 * body cannot: at midnight a dark red figure is a hole in the ground. Mixing
 * 38% of bone into it keeps every body above L* 53, so all four read as pale
 * people after dark, while the ring beside them still carries the exact colour
 * the legend names.
 */
export function bodyTint(hue: number): number {
  const bone = HUE_WELL;
  const mix = (shift: number): number => {
    const a = (hue >> shift) & 0xff;
    const b = (bone >> shift) & 0xff;
    return Math.round(a * 0.62 + b * 0.38) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

// ── Life stage → a footprint and a silhouette ────────────────────────────────

/**
 * What separates a child, an adult and an elder.
 *
 * Round one gave an elder 97% of an adult's height and a cloak, and a reviewer
 * called none of four. Round two fixed the bodies and still scored 60%, because
 * from an oblique-top camera a body foreshortens and a stoop reads as somebody
 * bending over their work. Round three moved the cue to the ground and gave the
 * elder a second ring OUTSIDE the rim — and a stranger still read stage at 40%,
 * because a hairline circle three pixels out from a bright ring is not a second
 * ring at forty pixels, it is a slightly thicker one.
 *
 * So the stage is now the bluntest difference the mark can carry: a child's pin
 * is plainly SMALLER and empty in the middle, an adult's is full size and empty
 * in the middle, and an elder's is full size with a SOLID DISC filling its
 * centre. Filled against hollow is a difference of area, not of line weight,
 * and it is the one kind of difference that survives twenty-four pixels. The
 * bodies keep their silhouettes on top of it — a head that is far too big,
 * square shoulders, or a stoop with a staff.
 */
export interface StageForm {
  stage: number;
  /** How tall this being stands, IN METRES. Never anything else. */
  scale: number;
  /** Head radius against the body's height — a child is mostly head. */
  head: number;
  /** Forward pitch of the trunk, in radians. An elder is bent. */
  stoop: number;
  /** The one extra thing in the outline, if any. */
  prop: 'none' | 'staff';
  /** The ground marker's size against an adult's, where the band draws stage. */
  footprint: number;
  /** Whether the ground marker is filled by a solid disc — the elder's mark. */
  core: boolean;
  label: string;
  note: string;
}

export const STAGE_FORM: StageForm[] = [
  { stage: STAGE_CHILD, scale: CHILD_M, head: 0.30, stoop: 0, prop: 'none', footprint: 0.56, core: false, label: 'child', note: 'a small empty pin · big head' },
  { stage: STAGE_ADULT, scale: ADULT_M, head: 0.15, stoop: 0, prop: 'none', footprint: 1, core: false, label: 'adult', note: 'a full-size empty pin · square shoulders' },
  { stage: STAGE_ELDER, scale: ELDER_M, head: 0.14, stoop: 0.62, prop: 'staff', footprint: 1, core: true, label: 'elder', note: 'a full-size pin FILLED IN · stooped on a staff' },
];

export function stageForm(stage: number): StageForm {
  return STAGE_FORM[stage] ?? STAGE_FORM[STAGE_ADULT]!;
}

/**
 * How big this being's ground marker is drawn, against an adult's.
 *
 * Only where stage is promised. Wider out, every marker is the same size on
 * purpose: the band's contract there is that beings are COUNTABLE, and a
 * settlement whose children are harder to see than their parents is a
 * settlement that miscounts.
 */
export function stageFootprint(stage: number, band: ZoomBand): number {
  return bandShowsDetail(band) ? stageForm(stage).footprint : 1;
}

/** Whether this being's marker is filled in — the elder's mark, in this band. */
export function stageCore(stage: number, band: ZoomBand): boolean {
  return bandShowsDetail(band) && stageForm(stage).core;
}

// ── Words ────────────────────────────────────────────────────────────────────

const ACT_WORDS: string[] = new Array<string>(ACT_COUNT);
ACT_WORDS[ACT_IDLE] = 'standing';
ACT_WORDS[ACT_WALKING] = 'walking';
ACT_WORDS[ACT_RESTING] = 'asleep';
ACT_WORDS[ACT_EATING] = 'eating';
ACT_WORDS[ACT_DRINKING] = 'drinking';
ACT_WORDS[ACT_WORKING] = 'gathering or building';
ACT_WORDS[ACT_DANGER] = 'fleeing';
ACT_WORDS[ACT_SOCIAL] = 'speaking';

const STAGE_WORDS = ['child', 'adult', 'elder'];

export function stageWord(stage: number): string {
  return STAGE_WORDS[stage] ?? 'adult';
}

/** The one word for what a being is doing, as the SIM means it. */
export function activityWord(act: number): string {
  return ACT_WORDS[act] ?? 'standing';
}

/** One plain clause for a hover label: what this being is doing, and how it is. */
export function describeState(act: number, cond: number): string {
  const doing = activityWord(act);
  const ails: string[] = [];
  if ((cond & COND_SICK) !== 0) ails.push('sick');
  if ((cond & COND_STARVING) !== 0) ails.push('starving');
  if ((cond & COND_HURT) !== 0) ails.push('hurt');
  return ails.length === 0 ? doing : `${doing} · ${ails.join(', ')}`;
}

// ── Heading ──────────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Which of eight directions the pointer aims at, as a reader would call it off
 * the screen: 0° is up the screen, degrees run clockwise. The view turns a
 * being's world heading into a screen angle before asking, because "north-east"
 * in a screenshot means up-and-right, not a fact about the continent's grid.
 */
export function headingOctant(screenDeg: number): string {
  const wrapped = ((screenDeg % 360) + 360) % 360;
  return COMPASS[Math.round(wrapped / 45) % 8]!;
}

/**
 * How many of the eight points apart two readings are — 0 for the same, 1 for
 * neighbours, 4 for opposite. `-1` if either word is not a compass point.
 *
 * Heading is the one channel where being NEARLY right is a different kind of
 * answer from being wrong: every one of a reviewer's heading misses in round
 * three was off by exactly one octant, which is a reader who saw the dart and
 * rounded it, not one who could not find it. A score that cannot tell those
 * apart cannot tell whether the mark needs to be clearer or merely sharper, so
 * the view hands the reviewer both numbers.
 */
export function octantDistance(a: string, b: string): number {
  const ia = COMPASS.indexOf(a.trim().toUpperCase());
  const ib = COMPASS.indexOf(b.trim().toUpperCase());
  if (ia < 0 || ib < 0) return -1;
  const d = Math.abs(ia - ib);
  return Math.min(d, 8 - d);
}

// ── Designations ─────────────────────────────────────────────────────────────

/**
 * Beings are born unnamed in this engine; only a conscious mind ever chooses a
 * name for itself. A researcher cannot hold `#1830` in working memory, so the
 * lab gives every unnamed being a designation instead — deterministic from its
 * id, so the same being is the same word in every screenshot and every session,
 * and never confusable with a name it chose (the label shows those differently).
 *
 * The syllables are the lab's own, deliberately unlike the engine's identity
 * roster: a designation must not read as something the world handed out.
 */
const D_A = ['Ash', 'Bel', 'Cor', 'Dun', 'Esk', 'Fen', 'Gal', 'Hal', 'Ith', 'Jor', 'Kel', 'Lum', 'Mar', 'Nev', 'Oss', 'Pral', 'Quen', 'Rist', 'Sel', 'Tor', 'Umb', 'Vash', 'Wren', 'Yrl'];
const D_B = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ia', 'oa', 'ua'];
const D_C = ['th', 'n', 'r', 'sk', 'l', 'm', 'ndra', 'vik', 'ra', 'den', 'mar', 'sh'];
const D_SPAN = D_A.length * D_B.length * D_C.length; // 2880 distinct designations

/**
 * Coprime with the span, so multiplying by it permutes the designations rather
 * than colliding any. Without it, ids are handed out in order and so are the
 * syllables: a whole settlement born in the same minute ends up called Nevara,
 * Nevira, Nevora — which is worse than numbers, because it looks like a name
 * and reads like noise.
 */
const D_MIX = 1201;

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * A stable, human-readable designation for an id. Collision-free: the id is
 * permuted and then read off as digits in mixed radix, and a generation suffix
 * carries ids past the span rather than letting two beings share a word.
 */
export function designationFor(id: number): string {
  const n = Math.abs(Math.trunc(id));
  const within = ((n % D_SPAN) * D_MIX) % D_SPAN;
  const generation = Math.floor(n / D_SPAN);
  const a = D_A[within % D_A.length]!;
  const b = D_B[Math.floor(within / D_A.length) % D_B.length]!;
  const c = D_C[Math.floor(within / (D_A.length * D_B.length)) % D_C.length]!;
  const stem = a + b + c;
  if (generation === 0) return stem;
  return `${stem} ${ROMAN[generation % ROMAN.length] || `x${generation}`}`;
}

export interface DisplayName {
  text: string;
  /** True when the being chose this name itself. The label says which. */
  selfChosen: boolean;
}

/**
 * What to call a being. `raw` is the engine's own name field — empty until a
 * conscious mind names itself. The engine's fallback (`Gahallian #1830`) is
 * treated as unnamed too, because it is an id wearing a word.
 *
 * EVERY surface in the renderer goes through this — the world labels, the
 * selection bar, the inspector and the side feed. Round one left the feed on
 * the engine's raw string, so the same being was Ashiden in the world and
 * `Gahallian #1972` in the log beside it.
 */
export function displayName(id: number, raw: string | undefined): DisplayName {
  const clean = (raw ?? '').trim();
  if (clean === '' || /^Gahallian\s*#/i.test(clean)) return { text: designationFor(id), selfChosen: false };
  return { text: clean, selfChosen: true };
}

// ── Counting a crowd ─────────────────────────────────────────────────────────

export interface ScreenPoint {
  id: number;
  x: number;
  y: number;
}

export interface Cluster {
  /** How many beings are in here — including the ones hidden behind the others. */
  count: number;
  /** Centre of the group, in canvas pixels. */
  x: number;
  y: number;
  /** Half-extent of the group, for the outline drawn around it. */
  rx: number;
  ry: number;
  /** Indices into the points that were passed in — who is in this group. */
  members: number[];
  /** 0 is a whole settlement; 1 and 2 are the parts it was split into. */
  depth: number;
}

/**
 * Where beings are too close together to be counted, and how many are there.
 *
 * Occupied cells of a screen-space grid are merged into connected groups (eight
 * neighbours, so a settlement is one group and not nine), and any group holding
 * `minCount` or more is reported with its total and its extent.
 */
export function clusterBeings(points: readonly ScreenPoint[], cellPx: number, minCount: number): Cluster[] {
  const cell = Math.max(1, cellPx);
  const cells = new Map<string, number[]>();
  const key = (i: number, j: number): string => `${i},${j}`;
  for (let k = 0; k < points.length; k++) {
    const p = points[k]!;
    const id = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const bucket = cells.get(id);
    if (bucket) bucket.push(k);
    else cells.set(id, [k]);
  }

  const seen = new Set<string>();
  const out: Cluster[] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const members: number[] = [];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]!;
      const comma = at.indexOf(',');
      const ci = Number(at.slice(0, comma));
      const cj = Number(at.slice(comma + 1));
      for (const k of cells.get(at)!) members.push(k);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const near = key(ci + di, cj + dj);
          if (!cells.has(near) || seen.has(near)) continue;
          seen.add(near);
          queue.push(near);
        }
      }
    }
    if (members.length < minCount) continue;
    out.push(extentOf(points, members, cell, 0));
  }
  // Two groups whose outlines overlap are one group as far as a reader is
  // concerned: a small ring drawn inside a big one reads as a subset, and the
  // reader adds its number twice. So anything that would be drawn on top of
  // something else is absorbed into it, repeatedly, until the outlines are
  // separate shapes on the page.
  mergeOverlaps(out);
  out.sort((a, b) => (b.count === a.count ? a.x - b.x : b.count - a.count));
  return out;
}

function extentOf(points: readonly ScreenPoint[], members: number[], cell: number, depth: number): Cluster {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const k of members) {
    const p = points[k]!;
    sx += p.x;
    sy += p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    count: members.length,
    x: sx / members.length,
    y: sy / members.length,
    rx: (maxX - minX) / 2 + cell * 0.55,
    ry: (maxY - minY) / 2 + cell * 0.55,
    members,
    depth,
  };
}

function mergeOverlaps(out: Cluster[]): void {
  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (Math.abs(a.x - b.x) > (a.rx + b.rx) * 0.9 || Math.abs(a.y - b.y) > (a.ry + b.ry) * 0.9) continue;
        const total = a.count + b.count;
        const ax0 = a.x - a.rx;
        const ax1 = a.x + a.rx;
        const ay0 = a.y - a.ry;
        const ay1 = a.y + a.ry;
        const bx0 = b.x - b.rx;
        const bx1 = b.x + b.rx;
        const by0 = b.y - b.ry;
        const by1 = b.y + b.ry;
        a.x = (a.x * a.count + b.x * b.count) / total;
        a.y = (a.y * a.count + b.y * b.count) / total;
        a.rx = (Math.max(ax1, bx1) - Math.min(ax0, bx0)) / 2;
        a.ry = (Math.max(ay1, by1) - Math.min(ay0, by0)) / 2;
        a.count = total;
        a.members = a.members.concat(b.members);
        out.splice(j, 1);
        j--;
        merged = true;
      }
    }
    if (!merged) break;
  }
}

/** A group bigger than this is asked to show its own structure, not just its total. */
export const CLUSTER_SPLIT_AT = 26;
/** How much finer the grid goes on each split. */
const SPLIT_CELL = 0.46;
/** Two levels down and no further: past that the parts are smaller than a marker. */
const SPLIT_DEPTH = 2;
/**
 * A split has to leave a reader better off. Fourteen outlines over one
 * settlement is not structure, it is confetti — and a part holding three
 * beings says less than the three markers already drawn underneath it. So a
 * split is taken only when it finds a handful of real neighbourhoods.
 */
const SPLIT_MAX_PARTS = 5;
const SPLIT_MIN_PART = 6;

/**
 * The crowds a reader is shown — split until the structure inside them is
 * visible.
 *
 * A reviewer looking at a settlement of 166 saw "a white blob inside one giant
 * hull": one outline and one number over half a continent's people says how
 * many and nothing about how they are arranged. So any group past
 * `CLUSTER_SPLIT_AT` is re-grouped on a finer grid, twice, and only the LEAVES
 * are drawn. Two neighbourhoods of eighty are two numbers and two shapes; one
 * of a hundred and sixty is a fact with no picture attached.
 *
 * A split that finds only one part is refused — the group really is that
 * shapeless, and redrawing the same outline one level down would be a lie about
 * having looked.
 */
export function clusterHierarchy(
  points: readonly ScreenPoint[],
  cellPx: number,
  minCount: number,
  budget: number,
  maxExtentPx = Number.POSITIVE_INFINITY,
): Cluster[] {
  const out: Cluster[] = [];
  const scratch: ScreenPoint[] = [];
  const split = (group: Cluster, cell: number): void => {
    if (group.depth >= SPLIT_DEPTH || group.count <= CLUSTER_SPLIT_AT) {
      out.push(group);
      return;
    }
    scratch.length = 0;
    for (const k of group.members) scratch.push(points[k]!);
    const finer = clusterBeings(scratch, cell * SPLIT_CELL, minCount);
    let held = 0;
    let smallest = Infinity;
    for (const part of finer) {
      held += part.count;
      if (part.count < smallest) smallest = part.count;
    }
    if (
      finer.length < 2 || finer.length > SPLIT_MAX_PARTS
      || held < group.count * 0.55
      || smallest < SPLIT_MIN_PART
      || finer[0]!.count > group.count * 0.92
    ) {
      out.push(group);
      return;
    }
    // The finer pass indexes into `scratch`; translate back to the caller's own
    // indices before anything downstream reads `members`.
    const parent = group.members;
    for (const part of finer) {
      const mapped = part.members.map((k) => parent[k]!);
      const child = extentOf(points, mapped, cell * SPLIT_CELL, group.depth + 1);
      split(child, cell * SPLIT_CELL);
    }
  };
  for (const group of clusterBeings(points, cellPx, minCount)) split(group, cellPx);
  mergeOverlaps(out);
  const compact = capExtent(out, points, cellPx, maxExtentPx);
  compact.sort((a, b) => (b.count === a.count ? a.x - b.x : b.count - a.count));
  return compact.length > budget ? compact.slice(0, budget) : compact;
}

/**
 * Keep a chip's people together — no group may be wider than `maxPx` on screen.
 *
 * A reviewer counting one QUADRANT of a default frame came out −88% in the
 * bottom-left and +45% in the top-left, while the whole-frame count was exact
 * to 0.5%. Nothing was miscounted: one chip had folded ninety-two beings whose
 * outline straddled the boundary between the two, and a chip is read where its
 * number sits. "Count the pins, add the numbers" was only ever valid frame-wide.
 *
 * So a group that spans more of the view than a reader would take in as one
 * place is bisected at the median of its longer axis until every part is
 * compact. Bisection is used rather than another grid pass because it always
 * terminates and always leaves both halves non-empty — the grid refused to
 * split exactly the shapeless, sprawling groups this is for. Every being stays
 * in exactly one part, so the count arithmetic is untouched.
 */
function capExtent(
  groups: readonly Cluster[],
  points: readonly ScreenPoint[],
  cell: number,
  maxPx: number,
): Cluster[] {
  if (!(maxPx > 0) || !Number.isFinite(maxPx)) return groups.slice();
  const out: Cluster[] = [];
  const queue = groups.slice();
  while (queue.length > 0) {
    const group = queue.pop()!;
    const overWide = group.rx * 2 > maxPx;
    const overTall = group.ry * 2 > maxPx;
    if ((!overWide && !overTall) || group.members.length < 2) {
      out.push(group);
      continue;
    }
    const byX = group.rx >= group.ry;
    const sorted = group.members.slice().sort((a, b) => {
      const pa = points[a]!;
      const pb = points[b]!;
      return byX ? pa.x - pb.x || pa.y - pb.y : pa.y - pb.y || pa.x - pb.x;
    });
    const mid = sorted.length >> 1;
    const lower = sorted.slice(0, mid);
    const upper = sorted.slice(mid);
    if (lower.length === 0 || upper.length === 0) {
      out.push(group);
      continue;
    }
    queue.push(
      extentOf(points, lower, cell, group.depth + 1),
      extentOf(points, upper, cell, group.depth + 1),
    );
  }
  return out;
}

// ── Counting, made mechanical ────────────────────────────────────────────────

/** Whether this band promises that every being in the frame can be counted. */
export function bandCountsBeings(band: ZoomBand): boolean {
  return bandPromise(band).count !== null;
}

/**
 * Two pins that overlap are one group. Not three, not "a crowd" — two.
 *
 * Round three only put a number on groups of three or more and drew every pin
 * anyway, so a settlement was a pile of overlapping rings with numbers floating
 * beside it and a reader had to guess which rings the numbers had already
 * counted. They guessed low in the frame (−11.6%) and high in a quadrant
 * (+12.9%), which is exactly what guessing looks like.
 */
const COLLAPSE_MIN = 2;

export interface CountPlan {
  /** Indices into the points that draw their own pin — one mark, one being. */
  singles: number[];
  /** Groups that collapse into one number. Nothing is drawn inside them. */
  chips: Cluster[];
}

/**
 * Split what is on screen into pins a reader counts one by one and chips that
 * count for them — with nothing left in between.
 *
 * The rule the whole thing turns on: **a being is either a pin or part of a
 * number, never both, and never neither.** `singles.length + Σ chips.count`
 * is exactly how many beings were passed in, and the test asserts it over
 * random layouts. Counting the frame then stops being an estimate and becomes
 * arithmetic: count the pins, add the numbers.
 *
 * Two things make that arithmetic honest in the picture as well as in the data.
 * The grid is one PIN WIDE, so any two pins close enough to overlap land in the
 * same or a neighbouring cell and are therefore in the same group — which means
 * no two pins a reader is asked to count separately can ever touch. And any pin
 * that survives the grid but still falls under a chip's outline is absorbed into
 * it, because a half-visible ring beside a number is the one thing a reader
 * cannot resolve.
 */
export function planCount(
  points: readonly ScreenPoint[],
  pinPx: number,
  budget: number,
  view?: CountView,
): CountPlan {
  const cell = Math.max(6, pinPx);
  const maxExtent = view ? Math.min(view.w, view.h) / COMPACT_VIEW_FRACTION : Number.POSITIVE_INFINITY;
  const chips = clusterHierarchy(points, cell, COLLAPSE_MIN, budget, maxExtent);
  const taken = new Uint8Array(points.length);
  for (const chip of chips) for (const k of chip.members) taken[k] = 1;

  for (let pass = 0; pass < 3; pass++) {
    let absorbed = false;
    for (let k = 0; k < points.length; k++) {
      if (taken[k] === 1) continue;
      const p = points[k]!;
      for (const chip of chips) {
        const dx = (p.x - chip.x) / (chip.rx + cell * 0.6);
        const dy = (p.y - chip.y) / (chip.ry + cell * 0.6);
        if (dx * dx + dy * dy > 1) continue;
        chip.members.push(k);
        taken[k] = 1;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) break;
    for (let c = 0; c < chips.length; c++) {
      const chip = chips[c]!;
      chips[c] = extentOf(points, chip.members, cell, chip.depth);
    }
    mergeOverlaps(chips);
  }

  // The absorb pass merges overlapping outlines, which can put a group back
  // together that the extent cap had just taken apart — so the cap is applied
  // again, LAST, and nothing merges after it.
  const compact = capExtent(chips, points, cell, maxExtent);
  const regioned = view ? splitByRegion(compact, points, cell, view) : compact;
  // A chip standing in for ONE being says less than that being's own pin does,
  // so whatever a split leaves alone goes back to being a pin.
  const final: Cluster[] = [];
  for (const chip of regioned) {
    if (chip.members.length >= COLLAPSE_MIN) {
      final.push(chip);
      continue;
    }
    for (const k of chip.members) taken[k] = 0;
  }

  const singles: number[] = [];
  for (let k = 0; k < points.length; k++) if (taken[k] === 0) singles.push(k);
  final.sort((a, b) => (b.count === a.count ? a.x - b.x : b.count - a.count));
  return { singles, chips: final };
}

/** The canvas a count is being read off, in CSS pixels. */
export interface CountView {
  w: number;
  h: number;
}

/**
 * How much of the shorter side of the view one chip is allowed to span. A sixth
 * is about what a reader takes in as "over there together"; past that the chip
 * is summarising two places at once.
 */
const COMPACT_VIEW_FRACTION = 6;

/**
 * Which region of the frame a point is in. The frame is read in quadrants —
 * that is how every reviewer has been asked to check a count — so a chip may
 * not span the lines a reader counts across.
 */
export function regionOf(x: number, y: number, view: CountView): number {
  return (x < view.w / 2 ? 0 : 1) + (y < view.h / 2 ? 0 : 2);
}

/**
 * Cut every chip at the frame's own dividing lines.
 *
 * With this, a quadrant count is arithmetic again: every being a chip stands in
 * for is in the chip's own quadrant, so counting the pins in a quadrant and
 * adding the numbers whose chips sit in it gives the quadrant's population
 * exactly, the way the whole-frame count already did.
 */
function splitByRegion(
  chips: readonly Cluster[],
  points: readonly ScreenPoint[],
  cell: number,
  view: CountView,
): Cluster[] {
  const out: Cluster[] = [];
  for (const chip of chips) {
    const parts = new Map<number, number[]>();
    for (const k of chip.members) {
      const p = points[k]!;
      const region = regionOf(p.x, p.y, view);
      const bucket = parts.get(region);
      if (bucket) bucket.push(k);
      else parts.set(region, [k]);
    }
    if (parts.size <= 1) {
      out.push(chip);
      continue;
    }
    for (const members of parts.values()) out.push(extentOf(points, members, cell, chip.depth + 1));
  }
  return out;
}

// ── Where a crowd's number goes ──────────────────────────────────────────────

/**
 * Where a count chip is allowed to sit, relative to its own outline — tried in
 * order: up-right first, then the other corners, then the sides.
 */
const CHIP_SLOTS: readonly (readonly [number, number])[] = [
  [1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1.15], [0, 1.15], [1.25, 0], [-1.25, 0],
];

export interface ChipPlacement {
  /** Centre of the chip, in canvas pixels. */
  x: number;
  y: number;
  /** The point on the outline the leader line runs back to. */
  anchorX: number;
  anchorY: number;
  /** True when it covers nothing — no pin, no name, no other chip. */
  clear: boolean;
  /** How many marks it would cover where it landed. Zero, or the chip is shy. */
  covers: number;
}

/**
 * Put a crowd's number outside its own ring and off every being.
 *
 * Round six offset the chip by 0.72 of the hull's extent, which for any group
 * bigger than a doorway is INSIDE the crowd, and tested the result against
 * other chips only. A reviewer found a "24" sitting on a pinned being, hiding
 * it completely, nine pixels from an outline whose legend line promised that no
 * pin is drawn inside a chip; they recorded that target as "no pin at all".
 *
 * So the slots start at the ellipse's own boundary, step out by the chip's half
 * size, and are scored against every mark drawn in the frame. `clear` says
 * whether the winner covers nothing; when nothing is free the caller shrinks
 * and fades the chip instead, because a number may lose a fight with a being
 * and a being may never lose one with a number.
 */
export function placeCountChip(
  hull: { x: number; y: number; rx: number; ry: number },
  halfW: number,
  halfH: number,
  pins: readonly LabelObstacle[],
  chips: readonly LabelObstacle[],
  view: CountView,
  gap = 6,
): ChipPlacement {
  // The number is read where it SITS, so it has to sit in the part of the
  // frame its people are in. Splitting the crowds at the quadrant lines is only
  // half the job: a disc pushed up and to the right of a hull near the middle
  // of the frame carries its twenty beings across the line with it, which is
  // how a settled world still came out +36% in one quadrant and −29% in
  // another with every chip's members in one place.
  const home = regionOf(hull.x, hull.y, view);
  let best: ChipPlacement | null = null;
  let bestScore = Infinity;
  for (const [sx, sy] of CHIP_SLOTS) {
    const len = Math.hypot(sx, sy) || 1;
    const ux = sx / len;
    const uy = sy / len;
    const anchorX = hull.x + hull.rx * ux;
    const anchorY = hull.y + hull.ry * uy;
    const x = Math.round(Math.min(view.w - halfW - 3, Math.max(halfW + 3, anchorX + ux * (halfW + gap))));
    const y = Math.round(Math.min(view.h - halfH - 3, Math.max(halfH + 3, anchorY + uy * (halfH + gap))));
    const covers = chipCoverage(x, y, halfW, halfH, pins, chips);
    // Being in the wrong quarter of the frame is not something the chip can
    // apologise for by shrinking, so it steers the choice without ever making
    // a chip that covers nothing call itself unclear.
    const score = covers + (regionOf(x, y, view) === home ? 0 : CHIP_WRONG_REGION);
    if (score < bestScore) {
      bestScore = score;
      best = { x, y, anchorX, anchorY, clear: covers === 0, covers };
    }
    if (score === 0) break;
  }
  return best ?? { x: hull.x, y: hull.y, anchorX: hull.x, anchorY: hull.y, clear: false, covers: 1 };
}

/**
 * What each thing a chip could land on costs it. A pin is a BEING and weighs
 * most; carrying a number out of its own quarter of the frame is next, because
 * that is a count a reader gets wrong rather than a mark they cannot see; a
 * name or another chip is chrome.
 */
const CHIP_ON_PIN = 100;
const CHIP_WRONG_REGION = 30;
const CHIP_ON_CHIP = 10;

/** What this position would cover, weighed by what a reader can least afford to lose. */
function chipCoverage(
  x: number, y: number, halfW: number, halfH: number,
  pins: readonly LabelObstacle[],
  chips: readonly LabelObstacle[],
): number {
  let cost = 0;
  const x0 = x - halfW;
  const x1 = x + halfW;
  const y0 = y - halfH;
  const y1 = y + halfH;
  for (const t of pins) {
    if (x0 < t.x1 && x1 > t.x0 && y0 < t.y1 && y1 > t.y0) cost += CHIP_ON_PIN;
  }
  for (const t of chips) {
    if (x0 < t.x1 + 4 && x1 > t.x0 - 4 && y0 < t.y1 + 4 && y1 > t.y0 - 4) cost += CHIP_ON_CHIP;
  }
  return cost;
}

// ── Names over the world ─────────────────────────────────────────────────────

/**
 * The one sentence the view makes about names — the words the band chip prints
 * and the words `labelAudit()` reports, generated here so they cannot be two
 * different sentences.
 *
 * Round six had three: a legend promising names for everyone you could walk to,
 * a chip printing a radius, and an audit reporting a radius, a population
 * inside it and a different number of names drawn. No two were about the same
 * thing, and a reviewer called it — correctly — three statements that cannot
 * all be true.
 */
export function nameClaimFor(band: ZoomBand, withinM: number, shown: number): string {
  if (band === 'near') return `names within ${withinM.toFixed(0)} m · ${shown} shown`;
  if (bandPromise(band).names === 'found') return `only the selected being is named · ${shown} shown`;
  return `names where there is room, nearest first · ${shown} shown`;
}

export interface LabelCandidate {
  id: number;
  /** Where the name wants to sit, in canvas pixels. */
  x: number;
  y: number;
  /**
   * Lower wins. The selected being, then the hovered one, then its kin and
   * bonds, then whoever is nearest the camera.
   */
  rank: number;
  text: string;
}

/** A box a label must keep out of — a crowd's count chip, or another being. */
export interface LabelObstacle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedLabel {
  id: number;
  text: string;
  /** Where the label is drawn. */
  x: number;
  y: number;
  /** Where its being is — the foot of the leader line. */
  ax: number;
  ay: number;
  /** True when the label had to move far enough that it needs a line home. */
  leader: boolean;
}

/** Roughly how wide this text will render, in pixels, at the label's size. */
export function labelWidth(text: string): number {
  return Math.round(text.length * 6.1) + 16;
}

const LABEL_H = 17;
/**
 * Tried in order: straight up, higher, then out to the sides — in multiples of
 * the clearance the band asks for. At NEAR a being is two hundred pixels tall
 * and a name twelve pixels over its head is a name written on its face, so the
 * offsets grow with the marker instead of being baked in pixels.
 */
const LABEL_SLOTS: readonly (readonly [number, number])[] = [
  [0, -1], [0, -2.3], [0, -3.6], [2.6, -1.7], [-2.6, -1.7], [4.0, -0.4], [-4.0, -0.4], [0, 1.9],
];

/** Whether two line segments properly cross. Touching at an endpoint does not. */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => {
    const v = (qx - px) * (ry - py) - (qy - py) * (rx - px);
    return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
  };
  const d1 = side(ax, ay, bx, by, cx, cy);
  const d2 = side(ax, ay, bx, by, dx, dy);
  const d3 = side(cx, cy, dx, dy, ax, ay);
  const d4 = side(cx, cy, dx, dy, bx, by);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Place as many names as will fit without lying.
 *
 * Round one ranked by camera distance with no frustum test at all: in one
 * screenshot the view reported seven names and drew none of them, because all
 * seven beings were below the bottom of the canvas. The read-out contradicting
 * the picture is the worst failure an instrument can have, so this takes only
 * candidates the view has already confirmed are on screen and unoccluded, and
 * returns only the ones it actually found room for — `labelsShown()` reports
 * this list, so it cannot claim a name that was not drawn.
 *
 * `obstacles` carries the crowd chips AND, where the band draws few enough of
 * them, the beings themselves: a name may cover empty ground, never a body.
 *
 * Two rules keep the leader lines from becoming the web a reviewer found at
 * NEAR. A slot whose line home is longer than `maxLeader` is refused outright —
 * a name that has to travel that far to find room is a name this frame does not
 * have room for, and no name is better than a name pointing across the picture.
 * And a slot whose line would CROSS one already drawn is refused too: the
 * moment two leaders cross, which name belongs to which being stops being
 * something the picture says.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  width: number,
  height: number,
  budget: number,
  obstacles: readonly LabelObstacle[] = [],
  clearance = 12,
  maxLeader = Number.POSITIVE_INFINITY,
): PlacedLabel[] {
  const ordered = [...candidates].sort((a, b) => (a.rank === b.rank ? a.id - b.id : a.rank - b.rank));
  const taken: LabelObstacle[] = [...obstacles];
  const out: PlacedLabel[] = [];
  const leaders: number[] = []; // ax, ay, x, y per placed leader
  const pad = 3;
  const unit = Math.max(11, clearance);
  for (const c of ordered) {
    if (out.length >= budget) break;
    const w = labelWidth(c.text);
    let placed: PlacedLabel | null = null;
    for (const [mx, my] of LABEL_SLOTS) {
      const dx = mx * unit;
      const dy = my * unit;
      if (Math.hypot(dx, dy) > maxLeader) continue;
      const cx = c.x + dx;
      const cy = c.y + dy;
      const x0 = cx - w / 2;
      const x1 = cx + w / 2;
      const y0 = cy - LABEL_H;
      const y1 = cy;
      if (x0 < 2 || x1 > width - 2 || y0 < 2 || y1 > height - 2) continue;
      let clear = true;
      for (const t of taken) {
        if (x0 < t.x1 + pad && x1 > t.x0 - pad && y0 < t.y1 + pad && y1 > t.y0 - pad) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      for (let k = 0; k < leaders.length; k += 4) {
        if (segmentsCross(c.x, c.y, cx, cy, leaders[k]!, leaders[k + 1]!, leaders[k + 2]!, leaders[k + 3]!)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      taken.push({ x0, y0, x1, y1 });
      leaders.push(c.x, c.y, cx, cy);
      placed = {
        id: c.id,
        text: c.text,
        x: cx,
        y: cy,
        ax: c.x,
        ay: c.y,
        leader: Math.abs(dx) > unit * 0.7 || dy < -unit * 2.1,
      };
      break;
    }
    if (placed) out.push(placed);
  }
  return out;
}

/**
 * Somewhere worth standing: a place on the continent where enough beings are
 * together to fill a frame, and the camera placement that frames them at the
 * size a given band is about. Scene units throughout — y is up.
 */
export interface FrameCandidate {
  /** How many beings are in this gathering. */
  count: number;
  /**
   * How many of them a reader would actually be able to find from the camera
   * offered below — in frame, big enough, and with nothing solid in the way.
   *
   * Round four's candidates were scored on how many beings were near the
   * centroid, which put the top MID candidate and the top two NEAR candidates
   * INSIDE a building. Proximity to a crowd is not a view of it.
   */
  visible: number;
  centre: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

// ── Where the camera should put the selected being ───────────────────────────

/**
 * How far to push the world left so the panel over the right of the canvas is
 * not sitting on whoever was just selected. In pixels, at the canvas's own
 * scale; the view turns it into a world offset along the camera's right.
 */
export function focusShiftPx(canvasWidth: number, panelWidth: number): number {
  if (panelWidth <= 0 || canvasWidth <= 0) return 0;
  // The clear part of the canvas is centred half a panel to the left of the
  // canvas itself, so that is how far the aim moves right.
  const free = Math.max(0, canvasWidth - panelWidth);
  return Math.round(Math.min(panelWidth / 2, free / 2));
}

// ── What the land is made of ─────────────────────────────────────────────────

/**
 * Resource families. Five, not seventeen: what a being can eat, what will make
 * it sick, what it can build with, what it can smelt, and where it can drink.
 *
 * Deliberately muted. These are ground cover — a few thousand pellets scattered
 * over the continent — and a reviewer counting beings should never have to ask
 * whether one of them is a person. Anything in this table must stay quieter
 * than a being's ring, and none of it wears a ring.
 */
export type Family = 'food' | 'hazard' | 'material' | 'ore' | 'water';

export const FAMILY_RGB: Record<Family, number> = {
  food: 0x4f7b48,
  hazard: 0x7b5486,
  material: 0x86765a,
  ore: 0x6f7682,
  water: 0x487a94,
};

export const LAND_LEGEND: { family: Family; label: string }[] = [
  { family: 'food', label: 'food' },
  { family: 'hazard', label: 'poisonous' },
  { family: 'material', label: 'materials' },
  { family: 'ore', label: 'ore' },
  { family: 'water', label: 'water' },
];

// ── Legend ───────────────────────────────────────────────────────────────────

/**
 * One row of the key. Every variant here is something the renderer can actually
 * draw, and `legendFor` is forbidden from returning one the current band does
 * not draw — the test asserts exactly that, band by band.
 */
export type LegendItem =
  | { kind: 'marker'; ring: number; hue: number; core: boolean; footprint: number; pointer: boolean; streak: boolean; label: string; note?: string }
  | { kind: 'picto'; picto: number; label: string }
  | { kind: 'dot'; label: string }
  | { kind: 'chip'; label: string }
  | { kind: 'swatch'; color: string; round: boolean; label: string }
  /**
   * A sentence rather than a mark. `quiet` ones open with the key instead of
   * standing in it: five prose lines under the canvas cost two hundred pixels
   * of the world, which is the instrument. What stays inline is only what a
   * reader needs to avoid MISREADING the frame in front of them — above all,
   * that a mark can be withheld.
   */
  | { kind: 'note'; label: string; quiet?: boolean };

export interface LegendSection {
  name: string;
  items: LegendItem[];
}

const SELECT_HEX = '#ffd34d';
/**
 * The ripple a being leaves when it speaks, and the thread to whoever heard it.
 *
 * It is drawn in EVERY band — a hundred-pixel mint arc at DEFAULT, four times
 * the size of a pin — and until round six it was listed only in the key that
 * opens on request, where a reviewer reading the frame never saw it and took
 * several of them for pins. Anything the view draws that large belongs in the
 * inline key of the band that draws it.
 */
const SPEECH_HEX = '#7fd8a8';

/**
 * The one sentence a reader needs to trust anything they measure off the frame.
 *
 * The hut's numbers come from the shelter's own contract rather than from a
 * memory of it. Round four's version said "a hut comes to twice their head"
 * over a hut that was drawn at 2.5 m and a probe that reported 4.4 — a sentence
 * that was wrong about the picture, wrong about the report, and impossible to
 * check without a ruler. Ridge and doorway are numbers; a reviewer can measure
 * both, and a 1.75 m adult standing in the doorway settles it at a glance.
 */
export const SCALE_NOTE = 'everything with a body is life-size — one unit is one metre, an adult is 1.75 m, '
  + `a hut's ridge stands at ${SHELTER.ridge} m over a ${SHELTER.doorHeight} m doorway they walk through`;

/**
 * What the view does about the fact that a village is full of things taller
 * than the people in it. Stated where a reader can check it, because round four
 * printed the promise and did not keep it.
 */
export const GHOST_NOTE = 'anything standing between you and a being turns to a ghost, footprint left on the ground · '
  + 'and nobody hides: a being behind a tree, a wall or a hill keeps a pale outline';

/**
 * The counting rule, stated as arithmetic rather than as an invitation to
 * estimate. Every being in the frame is in exactly one of the two terms.
 */
export const COUNT_NOTE = 'to count the frame — or any quarter of it: count the pins, add the numbers — every being is one or the other, never both, '
  + 'and a number only ever counts people in its own part of the frame';

/**
 * What a count chip is, stated so a reader can check it against the frame.
 *
 * Both halves of this were false in round six. A chip disc was drawn ON TOP of
 * a pinned being — one hid a target completely, nine pixels from the outline
 * whose legend line said no pin is drawn inside it — and a chip's people could
 * be spread over a third of the view, so the number was read in a quadrant its
 * members were not in. The disc now sits outside its own outline, clear of
 * every pin and every name, on a leader line home; and a chip never spans the
 * lines a reader counts across.
 */
export const CHIP_NOTE = 'the number is ALL of them, including the ones behind the others · no pin is drawn inside the ring, '
  + 'and the number itself sits outside it, never on a being';

/**
 * The truth about what a mark does NOT say, per band, and it is a promise about
 * the picture rather than an apology for it.
 *
 * Five rounds tried to make a pictogram and a heading arrow readable in a
 * crowd. On the specimen — one being per square of flat ground — they read. In
 * a settlement they did not: activity scored 38%, and nearly every miss was a
 * reader finding a mark and attaching it to the body beside the one it belonged
 * to. So in a crowd the marks are WITHHELD, and this says so, because a legend
 * that lists a pictogram the frame is not drawing is the one failure a reader
 * cannot recover from. The chip over the canvas prints how many were held.
 */
export const CROWD_NOTE = 'two marks close enough to touch are BOTH dropped rather than point at the wrong person — the chip says how many';

/**
 * What NEAR says about names, pointing at the one place the answer is measured.
 *
 * The band used to promise names for everyone you could walk to while the audit
 * behind it reported a radius, a count of who was inside it, and a different
 * count of what was drawn — three statements that could not all be true. There
 * is now one source: the budgeter places the names, the view measures how far
 * out it got every readable being named, and the chip over the frame prints
 * that radius and the number of names on screen. This sentence points there
 * and claims nothing of its own.
 */
export const NAME_NOTE = 'every being nearer than the radius the chip over the frame prints is named — '
  + 'the chip prints that radius, and how many names are on screen';

/** What the reader should do instead, out where marks say least. */
export const ASK_NOTE ='hover any pin for name, age, condition, activity and plan · the roster below lists everyone, and the chips filter them';

function marker(over: Partial<Extract<LegendItem, { kind: 'marker' }>> & { label: string }): LegendItem {
  return {
    kind: 'marker', ring: RING_SOLID, hue: HUE_WELL, core: false, footprint: 1,
    pointer: true, streak: false, ...over,
  };
}

const CONDITION_ITEMS: LegendItem[] = [
  marker({ ring: RING_SOLID, hue: HUE_WELL, label: 'well' }),
  marker({ ring: RING_DASHED, hue: HUE_STARVING, label: 'starving' }),
  marker({ ring: RING_DOUBLE, hue: HUE_SICK, label: 'sick' }),
  marker({ ring: RING_NOTCHED, hue: HUE_DANGER, label: 'in danger · hurt or fleeing' }),
];

/**
 * The ALARM pictogram is listed under doing, once, as the act it always is.
 * Round two listed the triangle as "fleeing" while also putting it on anyone
 * who was hurt, so a reader called a wounded walker "fleeing" and was marked
 * wrong by a probe that said "walking". Now the ring says hurt and the triangle
 * says fleeing, and neither says both.
 */
const ACTIVITY_ITEMS: LegendItem[] = [
  { kind: 'picto', picto: PICTO_REST, label: 'asleep' },
  { kind: 'picto', picto: PICTO_EAT, label: 'eating · drinking' },
  { kind: 'picto', picto: PICTO_WORK, label: 'gathering · building' },
  { kind: 'picto', picto: PICTO_SPEAK, label: 'speaking' },
  { kind: 'picto', picto: PICTO_ALARM, label: 'fleeing' },
];

/**
 * The key to the map, for the band the camera is actually in.
 *
 * It changes with the zoom because the picture does. A legend that lists
 * pictograms in a view that draws none, or promises an age you cannot see, is
 * an instrument contradicting itself — which is the one failure a reader cannot
 * recover from.
 */
export function legendFor(band: ZoomBand): LegendSection[] {
  if (band === 'far') {
    return [
      {
        name: 'the map',
        items: [
          { kind: 'dot', label: 'one dot is one being' },
          { kind: 'chip', label: `a ring of people — ${CHIP_NOTE}` },
          { kind: 'swatch', color: SELECT_HEX, round: true, label: 'the one you selected — the only being named out here' },
          { kind: 'swatch', color: SPEECH_HEX, round: true, label: 'spoke, threaded to who heard' },
          { kind: 'note', label: COUNT_NOTE },
          { kind: 'note', label: SCALE_NOTE, quiet: true },
          { kind: 'note', label: 'a whole being is under a pixel from here, so these marks are map pins, not people — zoom in for who and what', quiet: true },
        ],
      },
    ];
  }
  if (band === 'default') {
    return [
      {
        name: 'the map',
        items: [
          marker({ label: 'one pin is one being', note: 'the point is its facing' }),
          { kind: 'chip', label: `a ring of people — ${CHIP_NOTE}` },
          { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
          { kind: 'swatch', color: SPEECH_HEX, round: true, label: 'spoke, threaded to who heard' },
          { kind: 'note', label: COUNT_NOTE },
        ],
      },
      { name: 'how it is', items: CONDITION_ITEMS },
      {
        name: '',
        items: [
          { kind: 'note', label: 'ring shape says it too, so nothing rests on colour', quiet: true },
          { kind: 'note', label: CROWD_NOTE },
          { kind: 'note', label: `${SCALE_NOTE} · a pin holds its size on screen; the being under it does not. Come closer and the pin becomes their footprint and the world takes over`, quiet: true },
        ],
      },
    ];
  }
  const detail: LegendSection[] = [
    {
      name: 'a being',
      items: [
        marker({ label: 'standing', note: 'the point is its facing' }),
        marker({ streak: true, label: 'walking', note: 'the streak trails behind it' }),
      ],
    },
    {
      name: 'how old',
      items: [
        marker({ footprint: stageForm(STAGE_CHILD).footprint, label: 'child', note: 'a small pin' }),
        marker({ label: 'adult', note: 'full size, hollow' }),
        marker({ core: true, label: 'elder', note: 'full size, FILLED IN' }),
      ],
    },
    { name: 'how it is', items: CONDITION_ITEMS },
    {
      name: 'doing',
      items: [
        ...ACTIVITY_ITEMS,
        { kind: 'note', label: 'no mark = standing or walking, OR too close to a neighbour to say' },
        { kind: 'note', label: CROWD_NOTE },
      ],
    },
  ];
  if (band === 'near') {
    detail.push({
      name: '',
      items: [
        { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
        { kind: 'swatch', color: SPEECH_HEX, round: true, label: 'spoke, threaded to who heard' },
        { kind: 'note', label: NAME_NOTE, quiet: true },
        { kind: 'note', label: GHOST_NOTE, quiet: true },
        { kind: 'note', label: SCALE_NOTE, quiet: true },
      ],
    });
  } else {
    detail.push({
      name: '',
      items: [
        { kind: 'chip', label: `a crowd, and how many are in it — ${CHIP_NOTE}` },
        { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
        { kind: 'swatch', color: SPEECH_HEX, round: true, label: 'spoke, threaded to who heard' },
        { kind: 'note', label: GHOST_NOTE, quiet: true },
        { kind: 'note', label: SCALE_NOTE, quiet: true },
      ],
    });
  }
  return detail;
}

/** The rows that are the same in every band, shown only when the key is opened. */
export const LEGEND_EXTRA: LegendSection[] = [
  {
    name: 'found',
    items: [
      { kind: 'swatch', color: '#59d8e0', round: true, label: 'kin' },
      { kind: 'swatch', color: '#9ed35e', round: true, label: 'bonded' },
    ],
  },
  {
    name: 'the land',
    items: [
      ...LAND_LEGEND.map((m): LegendItem => ({ kind: 'swatch', color: hex(FAMILY_RGB[m.family]), round: false, label: m.label })),
      { kind: 'swatch', color: '#6d6459', round: false, label: 'a death, fading' },
      { kind: 'swatch', color: '#7fd8a8', round: true, label: 'spoke, threaded to who heard' },
    ],
  },
  {
    name: 'ask',
    items: [{ kind: 'note', label: ASK_NOTE }],
  },
  {
    name: '',
    items: [
      {
        kind: 'note',
        label: 'a dotted name is the lab’s designation, not one it chose · the marker grows as the camera comes in, '
          + 'and what it carries grows with it — the key above is always the band you are in',
      },
    ],
  },
];

/** `0x43d18a` → `#43d18a`, for the legend swatches and the label chrome. */
export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
