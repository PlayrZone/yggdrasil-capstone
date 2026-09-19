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
 * How far past an edge the view must travel before it admits the band changed.
 *
 * Without this a camera resting a pixel from an edge flips the whole vocabulary
 * back and forth every frame — the legend rewrites itself, badges appear and
 * vanish, and the view looks broken rather than adaptive.
 */
const BAND_HYSTERESIS = 0.07;

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

/** How many names a band is willing to float over the world at once. */
export function labelBudgetFor(band: ZoomBand): number {
  return band === 'near' ? LABEL_BUDGET_MAX : band === 'mid' ? 10 : band === 'default' ? 7 : 2;
}


export const LABEL_BUDGET_MAX = 18;
export const CLUSTER_BUDGET = 18;

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
  /** Whether every being on screen gets a name, some do, or only the found one. */
  names: 'found' | 'some' | 'all';
  /** One line, for the band indicator over the canvas. */
  says: string;
}

const PROMISES: Record<ZoomBand, BandPromise> = {
  far: {
    band: 'far', count: 0.10, condition: null, stage: null, activity: null, heading: null,
    selected: 1, names: 'found', says: 'how many · where · which is selected',
  },
  default: {
    band: 'default', count: 0.10, condition: 0.70, stage: null, activity: null, heading: null,
    selected: 1, names: 'some', says: 'every being countable · how it is',
  },
  // MID and NEAR promise no COUNT, and that is the world being life-size
  // rather than a retreat. Thirty metres from a being, the far side of the
  // valley is still in frame and the people on it are half a pixel — real, and
  // not a picture of anything. A band that promised a count here would be
  // promising one for beings it is honestly not drawing. Counting is what you
  // pull back for, and that is what the chip over the canvas says.
  mid: {
    band: 'mid', count: null, condition: 0.80, stage: 0.80, activity: 0.80, heading: 0.80,
    selected: 1, names: 'some', says: 'facing · age · doing · how it is · pull back to count',
  },
  near: {
    band: 'near', count: null, condition: 0.90, stage: 0.90, activity: 0.90, heading: 0.90,
    selected: 1, names: 'all', says: 'the whole figure, and every name',
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
 * bending over their work.
 *
 * So the stage is now on the GROUND as well as in the air, where nothing
 * foreshortens: a child's whole marker is smaller, an elder's carries a second
 * ring outside the rim, and an adult's is the plain full-size one. The bodies
 * keep their silhouettes on top of that — a head that is far too big, square
 * shoulders, or a stoop with a staff.
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
  /** Whether the ground marker carries a second ring outside its rim. */
  halo: boolean;
  label: string;
  note: string;
}

export const STAGE_FORM: StageForm[] = [
  { stage: STAGE_CHILD, scale: CHILD_M, head: 0.30, stoop: 0, prop: 'none', footprint: 0.68, halo: false, label: 'child', note: 'a metre tall · big head' },
  { stage: STAGE_ADULT, scale: ADULT_M, head: 0.15, stoop: 0, prop: 'none', footprint: 1, halo: false, label: 'adult', note: '1.75 m · square shoulders' },
  { stage: STAGE_ELDER, scale: ELDER_M, head: 0.14, stoop: 0.62, prop: 'staff', footprint: 1, halo: true, label: 'elder', note: 'stooped on a staff · mark ringed twice' },
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

/** Whether this being's marker carries the elder's outer ring, in this band. */
export function stageHalo(stage: number, band: ZoomBand): boolean {
  return bandShowsDetail(band) && stageForm(stage).halo;
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
  out.sort((a, b) => (b.count === a.count ? a.x - b.x : b.count - a.count));
  return out.length > budget ? out.slice(0, budget) : out;
}

// ── Names over the world ─────────────────────────────────────────────────────

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
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  width: number,
  height: number,
  budget: number,
  obstacles: readonly LabelObstacle[] = [],
  clearance = 12,
): PlacedLabel[] {
  const ordered = [...candidates].sort((a, b) => (a.rank === b.rank ? a.id - b.id : a.rank - b.rank));
  const taken: LabelObstacle[] = [...obstacles];
  const out: PlacedLabel[] = [];
  const pad = 3;
  const unit = Math.max(11, clearance);
  for (const c of ordered) {
    if (out.length >= budget) break;
    const w = labelWidth(c.text);
    let placed: PlacedLabel | null = null;
    for (const [mx, my] of LABEL_SLOTS) {
      const dx = mx * unit;
      const dy = my * unit;
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
      taken.push({ x0, y0, x1, y1 });
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
  | { kind: 'marker'; ring: number; hue: number; halo: boolean; footprint: number; pointer: boolean; streak: boolean; label: string; note?: string }
  | { kind: 'picto'; picto: number; label: string }
  | { kind: 'dot'; label: string }
  | { kind: 'chip'; label: string }
  | { kind: 'swatch'; color: string; round: boolean; label: string }
  | { kind: 'note'; label: string };

export interface LegendSection {
  name: string;
  items: LegendItem[];
}

const SELECT_HEX = '#ffd34d';

/** The one sentence a reader needs to trust anything they measure off the frame. */
export const SCALE_NOTE = 'everything with a body is life-size — one unit is one metre, an adult is 1.75 m, a hut comes to twice their head';

function marker(over: Partial<Extract<LegendItem, { kind: 'marker' }>> & { label: string }): LegendItem {
  return {
    kind: 'marker', ring: RING_SOLID, hue: HUE_WELL, halo: false, footprint: 1,
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
          { kind: 'dot', label: 'one being' },
          { kind: 'chip', label: 'how many are in that group, behind ones included' },
          { kind: 'swatch', color: SELECT_HEX, round: true, label: 'the one you selected — the only being named out here' },
          { kind: 'note', label: SCALE_NOTE },
          { kind: 'note', label: 'a whole being is under a pixel from here, so these marks are map pins, not people — zoom in for who and what' },
        ],
      },
    ];
  }
  if (band === 'default') {
    return [
      {
        name: 'the map',
        items: [
          marker({ label: 'one pin on the ground is one being', note: 'the point is its facing' }),
          { kind: 'chip', label: 'a crowd, and how many are in it — the ones behind included' },
          { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
        ],
      },
      { name: 'how it is', items: CONDITION_ITEMS },
      {
        name: '',
        items: [
          { kind: 'note', label: 'ring shape says it too, so nothing rests on colour' },
          { kind: 'note', label: `${SCALE_NOTE} · a pin holds its size on screen; the being under it does not. Come closer and the pin becomes their footprint and the world takes over` },
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
        marker({ footprint: stageForm(STAGE_CHILD).footprint, label: 'child' }),
        marker({ label: 'adult' }),
        marker({ halo: true, label: 'elder', note: 'ringed twice' }),
      ],
    },
    { name: 'how it is', items: CONDITION_ITEMS },
    {
      name: 'doing',
      items: [...ACTIVITY_ITEMS, { kind: 'note', label: 'no mark = standing or walking' }],
    },
  ];
  if (band === 'near') {
    detail.push({
      name: '',
      items: [
        { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
        { kind: 'note', label: `every being in frame is named · trees and huts step aside · ${SCALE_NOTE}` },
      ],
    });
  } else {
    detail.push({
      name: '',
      items: [
        { kind: 'chip', label: 'a crowd, and how many are in it' },
        { kind: 'swatch', color: SELECT_HEX, round: true, label: 'selected' },
        { kind: 'note', label: SCALE_NOTE },
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
