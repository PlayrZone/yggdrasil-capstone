import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, NODE_YIELD, NUTRITIOUS_FOODS, regionAt, SICKENING_FOODS, WORLD } from '@yggdrasil/engine';
import type { ObjectKind, Region, ResourceNodeKind } from '@yggdrasil/engine';
import {
  ACT_DANGER,
  ACT_DRINKING,
  ACT_EATING,
  ACT_RESTING,
  ACT_SOCIAL,
  ACT_WALKING,
  ACT_WORKING,
  GOAL_NONE,
  goalWord,
  KIND_UNKNOWN,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
  type FrameMessage,
  type ResourcePayload,
  type StructureUpdate,
} from './sim/protocol.js';
import {
  conditionMix,
  groupByActivity,
  offeredUnderPointer,
  OFFER_MARGIN_PX,
  orderCandidates,
  steadyWinner,
  suppressOverlaps,
  type BodyBox,
  PICK_BODY,
  PICK_FIGURE,
  PICK_HIDDEN,
  PICK_MARK,
  type MarkPoint,
  type MixSegment,
  type PickCandidate,
} from './crowd.js';
import type { RosterRow } from './roster.js';
import {
  activityWord,
  ADULT_M,
  annotationOpacity,
  annotationRadius,
  BAND_EDGE_PX,
  BAND_HYSTERESIS,
  bandCountsBeings,
  bandForPixels,
  bandPromise,
  bandShowsBodies,
  badgeMetres,
  bandShowsDetail,
  bodyTint,
  DETAIL_MIN_PX,
  CLUSTER_BUDGET,
  clusterHierarchy,
  conditionHue,
  conditionWord,
  describeState,
  displayName,
  figurePose,
  figureSpread,
  poseLean,
  focusShiftPx,
  headingOctant,
  HUE_WELL,
  labelBudgetFor,
  labelClearanceFor,
  LABEL_BUDGET_MAX,
  LABEL_HEIGHT_PX,
  figurePxAt,
  maxOrbitDistance,
  notchesToReach,
  maxLeaderFor,
  movingFor,
  nameClaimFor,
  namePlan,
  NEAR_LABEL_M,
  octantDistance,
  placeCountChip,
  regionOf,
  PICTO_GRID,
  PICTO_NONE,
  PICTO_SPEAK,
  pictogramFor,
  placeLabels,
  planCount,
  readableActivity,
  scaleBarFor,
  RING_DASHED,
  RING_DOUBLE,
  RING_NOTCHED,
  RING_STYLE_COUNT,
  ringStyleFor,
  stageCore,
  stageFootprint,
  stageForm,
  stageWord,
  FAMILY_RGB,
  type Family,
  type Cluster,
  type FrameCandidate,
  type LabelCandidate,
  type LabelObstacle,
  type NameSubject,
  type ScreenPoint,
  type ZoomBand,
} from './beings.js';
import {
  doorwayClear,
  isSpecimenId,
  packSubjects,
  READABLE_MARK_PX,
  SHELTER,
  SHELTER_FOOTPRINT,
  clampToRoom,
  pennantSize,
  SHELTER_PARTS,
  shelterMeasure,
  specimenPlan,
  SPECIMEN_COLS,
  SPECIMEN_ID_BASE,
  SPECIMEN_ROWS,
  SPECIMEN_SPACING,
  SUBJECT_R,
  SUBJECT_SLOTS,
  XRAY_MIN_BODY_PX,
  OUTLINE_MIN_BODY_PX,
  FLAG_MIN_PX,
  type Subject,
} from './legibility.js';
import { buildGlyphAtlas, PICTO_STUB_AT } from './glyphs.js';
import { ghostCommonChunk, ghostFragmentChunk, ghostVertexChunk } from './shading.js';
import { createHealth, onConsoleError, onWindowError, type Health, type HealthReport } from './health.js';

// ── The world's own scale ────────────────────────────────────────────────────

/**
 * Metres per unit of the sim's height INDEX.
 *
 * The horizontal world is already metres (`beings.ts` says why). The vertical
 * one is not: `heightAt` returns a dimensionless index the engine cuts at 4 and
 * 8 to name lowland, midland and highland, so the view has to choose what an
 * index unit is worth. At fourteen metres the plains sit about twenty above the
 * sea, the foothills climb to a hundred, and the range tops out near three
 * hundred — hills in tens, mountains in hundreds, and a 1.75 m person is the
 * hundred-and-seventieth part of the ridge behind them, which is what a person
 * standing in front of a mountain actually is.
 */
const HSCALE = 14;
const SEA = 0.85; // sea level, in the same height index
const HALF = WORLD / 2;

/**
 * The drawn ground: how finely it is tessellated, and how far it is smoothed
 * against the sim's own height samples.
 *
 * The sim's mountain field is built out of `|sin|` ridges, and an absolute
 * value has a CUSP at every zero — a sharp crease, not a valley. Sampled on a
 * 200-square grid and drawn as flat triangles, an eighty-metre ridge repeating
 * down a two-kilometre range came out as a comb of forty identical spikes: a
 * reviewer looking at the east of the map saw a saw blade, and the owner is
 * right that mountains have to read as mountains.
 *
 * Two changes, and neither of them touches what the sim reads. The mesh is
 * twice as fine, so a slope is a slope rather than a staircase. And the heights
 * the MESH is built from are the sim's own samples passed through a separable
 * blur about forty metres wide — which rounds every cusp, takes two thirds off
 * the eighty-metre teeth, and leaves the three-hundred-metre massif and the
 * inland ramp that make the range a range. `heightAt` is untouched; `surfaceAt`
 * reads the mesh, so everything the view stands on the ground stands on the
 * ground it can see.
 */
const GRID = 320;
const RELIEF_SMOOTH_M = 42;

/** Bare rock above this height index, pale scree and snow above this one. */
const ROCK_AT = 8.5;
const SNOW_AT = 13.5;
const ROCK_RGB: readonly [number, number, number] = [0.47, 0.46, 0.49];
const SNOW_RGB: readonly [number, number, number] = [0.84, 0.86, 0.90];

/**
 * How far the sea floor is carried past the playable bounds, and how deep it
 * settles — the horizon, instead of the black wall that used to fill it.
 */
const SHELF_FALL = WORLD * 0.35;
const SHELF_OUT = WORLD * 8;
const SHELF_DROP = SEA - 2.2;
const SEA_SPAN = WORLD * 16;

/**
 * Aerial perspective: how thickly the air stands between the eye and the range.
 *
 * Distance haze is the only cue that says a mountain is FAR rather than small,
 * and round three had none worth the name — linear fog starting at 1900 m, by
 * which point the whole continent is behind you. This is exponential-squared
 * and it is tuned for the eye's own distance: standing in the street, the range
 * twelve hundred metres east should be half dissolved in air, and from a
 * kilometre and a half up the same range is most of what you came to look at
 * and must stay countable. So the density falls as the camera pulls back, which
 * is not a physical claim — it is the instrument saying that at map scale the
 * air is not the subject.
 */
const HAZE_NEAR = 0.00065;
const HAZE_FLOOR = 0.00013;

/**
 * Two layers, and the whole view turns on keeping them apart.
 *
 * THE WORLD is life-size and never anything else: a being is 1.75 m, a hut
 * comes to twice their head, a pine is fifteen metres and the range behind them
 * is three hundred. Nothing in it is ever resized to be seen.
 *
 * THE MAP is drawn over it — a ground ring per being, a pointer, a count chip,
 * a name — and it is the map that holds a readable size on screen. Out where a
 * person is one pixel the map is the whole picture; come closer and it settles
 * to the size of the ground a person stands on, fades back, and the world takes
 * over. `annotationRadius` in `beings.ts` is that one rule.
 *
 * Round two had it backwards: it cut the huts to two-thirds and grew the people
 * until they read, and produced a person taller than their own house.
 */


/**
 * Ring radius as a fraction of the annotation's own unit — the number every
 * other mark on the ground is measured in.
 *
 * Where stage is promised the footprint varies with age; wider out it does not,
 * because out there the contract is countability and a settlement whose
 * children are harder to see miscounts.
 */
const RING_R = 0.40;
/** The ring's outermost radius, as a multiple of `RING_R` — its real footprint. */
const RING_OUTER = 1.16;
/**
 * How much of a mark survives while it is NOT one of the beings the filter is
 * asking about. Low enough that a match is found without hunting, high enough
 * that the frame still contains — and still counts — everybody.
 */
const DIM = 0.20;
/** The body's own colour, dimmed. Bodies are lit, so this multiplies the tint. */
const DIM_BODY = 0.34;
/**
 * How much wider than its ring a being's marks reach.
 *
 * The pictogram is welded to the RIM — that is what `PICTO_RIM` buys — so the
 * ring's own outer edge is the right threshold: two rings that touch have
 * pictograms in each other's territory, and two that clear each other do not.
 * Round one of this item used 1.35 and withheld 31 marks of 32 in an ordinary
 * settlement, which is truthful and useless: a rule that fires on everything
 * is not telling a reader anything about the frame they are looking at.
 */
const MARK_CLEARANCE = 1.0;
/**
 * The smallest a hover target is ever allowed to be, in CSS pixels. Out wide a
 * map pin is about twenty-four across; this keeps the thing under the cursor
 * reachable without swallowing the neighbour, and everything it does swallow is
 * offered in the disambiguation list rather than chosen silently.
 */
const HOVER_MIN_PX = 10;
/**
 * The longest the scale bar may be drawn, in CSS pixels. The 1–2–5 series steps
 * by at most 2.5, so taking the largest round span that fits this also
 * guarantees the bar is never drawn shorter than 80 px — a ruler nobody can
 * read against the frame is not a ruler.
 */
const SCALE_BAR_MAX_PX = 200;
/** Four conditions, each with or without the elder's outer ring. */
/**
 * Four condition shapes × adult-or-elder centre × arrow-or-none. The arrow is
 * baked into the ring's geometry rather than drawn as a second instance, so
 * "this being's mark carries no facing" has to be a different bucket; sixteen
 * instanced meshes is the price of being able to withhold a claim per being.
 */
const RING_BUCKETS = RING_STYLE_COUNT * 4;

/** style × core × arrow → which ring mesh this being's mark belongs in. */
function ringBucket(style: number, core: boolean, arrow: boolean): number {
  return style * 4 + (core ? 2 : 0) + (arrow ? 1 : 0);
}

/** A presence dot at FAR, as a fraction of the marker height. */
const DOT_R = 0.30;

/**
 * The order the layers are painted in, and it carries two rules that the
 * picture depends on.
 *
 * The scenery ghosts, which makes it blended, which puts it and everything
 * after it in three's transparent queue — where `renderOrder` decides. So the
 * order is stated once, here, instead of being an accident of which material
 * happened to be transparent.
 *
 * Rule one: the X-RAY goes between the scenery and the bodies, so the depth it
 * tests against is the land, the trees and the walls, and NOT the other
 * beings. A being behind another being is further away, not hidden, and
 * x-raying that turns a crowd into a heap of ghosts.
 *
 * Rule two: annotation is last and depth-tested against nothing. A map pin a
 * building can eat is not a map pin.
 */
const RENDER_SCENERY = 0;
const RENDER_FOOT = 3;
const RENDER_XRAY = 4;
/** The dark keyline around a figure, immediately under the figure itself. */
const RENDER_OUTLINE = 5;
const RENDER_BODY = 6;
/**
 * Rule three, and it is what turns a crowded shelter back into people.
 *
 * A hut is GLASS: the ghost rule opens it precisely so the reader can see who
 * is inside. Painted before the bodies — which is where it sat for five rounds,
 * at `RENDER_SCENERY` — its walls still wrote DEPTH, so every occupant failed
 * the depth test, no body was drawn at all, and what the reader saw was the
 * x-ray pass: fifteen to thirty-seven flat near-white silhouettes at 0.52 alpha
 * painted over each other until the alpha saturated. A reviewer photographed it
 * and said a stranger would call the renderer broken, and he was right about the
 * renderer: those were not people fusing, they were not people.
 *
 * Painted AFTER them, a wall does what glass does — it tints what is behind it
 * and hides nothing — while an un-ghosted hut, still at full alpha, covers its
 * occupants exactly as a wall should.
 */
const RENDER_STRUCTURE = 7;
/** The lit pane, over its own wall. */
const RENDER_WINDOW = 8;

/**
 * How much of the orbit one wheel notch crosses.
 *
 * Three's default of 1 moves the radius 5% a notch, which puts the FAR band
 * fifty-five notches from a settlement — reachable in the sense that a
 * marathon is walkable. At 2.2 it is a quarter of that, and the near end is
 * unaffected because `minDistance` is what stops the camera there, not the
 * step size.
 */
const ZOOM_SPEED = 2.2;

/** How far off a hut's inside wall a body must be drawn, in metres. */
const ROOM_MARGIN_M = 0.32;

/**
 * The widest a death cairn or a speech ripple may ever be drawn, in metres.
 *
 * Belt as well as braces: the size is measured at the mark now, but a mark on
 * the far side of a continent at FAR still scales with distance, and a ring
 * that can grow without limit is a ring that will eventually be the whole
 * frame. An utterance is at most a few metres of ground.
 */
const TRANSIENT_MAX_M = 3.2;

/**
 * How brightly the OTHER people in an open room are drawn.
 *
 * Well under one, on purpose. They are context for the being the reader is
 * following, and a value that lifts them toward bone is a value that adds
 * coincident figures together until the room is a white mass — which is
 * exactly what three rounds of reviewers photographed.
 */
const INSIDE_BODY_VALUE = 0.55;

/** How far a window's light reaches across the ground, in metres. */
const POOL_R_M = 2.4;
/**
 * And how small it is ever allowed to get on screen.
 *
 * A settlement at night has to be visibly inhabited from the band that looks
 * at settlements. Below this the pool stops being a light and starts being a
 * rounding error.
 */
const POOL_MIN_PX = 3.2;
const RENDER_TRAIL = 10;
/** Under the ring, so a match's halo frames the mark rather than covering it. */
const RENDER_HALO = 11;
const RENDER_RING = 12;
const RENDER_PICTO = 14;

/**
 * The pictogram chip's height, as a fraction of the marker, and where its quad
 * sits relative to the ring it belongs to.
 *
 * The offsets are chosen so the stub drawn into the lower-left of every atlas
 * cell lands on the upper-right rim of this being's own ring — which is the
 * whole answer to "whose badge is that". Round two put the mark on a stem above
 * the head and a reviewer's every activity miss was a badge given to the body
 * one row down.
 */
const PICTO_H = 0.64;
const PICTO_RIM = RING_R * RING_OUTER * 0.72;

/**
 * How much of that the chip keeps down in the street.
 *
 * At NEAR the annotation stops holding a screen size and becomes the FOOTPRINT
 * a being stands on — which is right for a ring on the ground and wrong for a
 * symbol, because a symbol scaled to a person's footprint is a symbol the size
 * of their torso. Ninety-six of them at full strength was a wall of badges with
 * a village somewhere behind it. The chip stays a readable fifty-odd pixels
 * instead, and the weld to the ring's rim is recomputed so it still lands where
 * it belongs — see `uOffset`.
 */
const PICTO_NEAR_SCALE = 0.58;

/**
 * The floor under a badge — the ceiling is `badgeMetres`.
 *
 * Below this a pictogram is a smudge with an explanation: the band already
 * says it draws no detail for a being this small (`DETAIL_MIN_PX`), and
 * drawing one anyway is the picture claiming something its own probes
 * correctly refuse to.
 */
const PICTO_MIN_BODY_PX = DETAIL_MIN_PX;

/**
 * A crowd is a group of beings closer together than this many marker-widths,
 * and it earns a number once this many are in it. Both are in screen space:
 * crowding is a property of the picture, not of the continent.
 */
/** Four conditions, so four segments is the whole of a chip's mix bar. */
const MIX_SEGMENTS = 4;
const CLUSTER_CELL_MARKERS = 1.25;
const CLUSTER_MIN = 3;

/**
 * How many people have to be piled inside one building before the building
 * speaks for them — and how many buildings may do so in one frame.
 *
 * Three is where a hut stops being a picture of people and becomes a knot: two
 * overlapping rings are still two rings. The cap is there because every chip
 * costs an outline node, and a frame that spent all of them on huts would have
 * none left for the crowds outside. See `planInside`.
 */
const INSIDE_MIN = 3;
const INSIDE_CHIPS_MAX = 8;

/** Half the height of a count chip, in CSS pixels, and the air around it. */
const CHIP_HALF_H = 9;
const CHIP_GAP = 6;
/** How far a chip with nowhere free to stand pulls itself in. */
const CHIP_SHY_SCALE = 0.74;

/** How many relationships may be drawn at once, and how finely an arc is cut. */
const TIE_LINKS = 14;
const ARC_SEGMENTS = 9;

/** Real seconds a death mark and an utterance stay on the map. */
const DEATH_FADE_S = 7;
const SPEECH_FADE_S = 1.6;
const DEATH_SLOTS = 32;
const SPEECH_SLOTS = 28;

/** How long a being keeps the "speaking" glyph after it says something. */
const SPEAKING_MS = 1400;

// ── Palettes ─────────────────────────────────────────────────────────────────

/**
 * Terrain. Calmer and less saturated than the regions' own debug colours: the
 * ground is the page, not the writing. Greens are separated by value rather
 * than hue so forest and plains stay distinct in greyscale.
 */
const REGION_RGB: Record<Region, [number, number, number]> = {
  river: [0.27, 0.40, 0.33],
  coast: [0.68, 0.62, 0.46],
  lake: [0.17, 0.30, 0.37],
  wetland: [0.30, 0.38, 0.30],
  forest: [0.17, 0.30, 0.19],
  mountain: [0.44, 0.43, 0.45],
  hills: [0.42, 0.40, 0.29],
  plains: [0.38, 0.46, 0.30],
};

/**
 * Which family a resource node belongs to. The colours are in `beings.ts` with
 * the rest of the legend; three of the five families are read off the engine's
 * own tables rather than guessed at here, so this cannot drift from what the
 * sim means.
 *
 * Metals, coal and gems — the engine draws no line here, so the lab does, openly.
 */
const SMELTABLE = new Set<ObjectKind>(['copperOre', 'tinOre', 'ironOre', 'coal', 'silver', 'gold', 'gemstone']);

function familyOf(kind: string): Family | null {
  const yielded = NODE_YIELD[kind as ResourceNodeKind] as ObjectKind | undefined;
  if (!yielded) return null;
  if (yielded === 'water') return 'water';
  if (SICKENING_FOODS.has(yielded)) return 'hazard';
  if (NUTRITIOUS_FOODS.has(yielded)) return 'food';
  if (SMELTABLE.has(yielded)) return 'ore';
  if (yielded === 'wood' || yielded === 'meat') return null; // trees and game are drawn as themselves
  return 'material';
}

const ANIMAL_RGB: Record<string, THREE.Color> = {
  deer: new THREE.Color(0.52, 0.38, 0.25),
  hare: new THREE.Color(0.62, 0.58, 0.51),
  boar: new THREE.Color(0.30, 0.25, 0.22),
  fish: new THREE.Color(0.38, 0.55, 0.70),
  wolf: new THREE.Color(0.46, 0.46, 0.50),
  bear: new THREE.Color(0.32, 0.21, 0.16),
  crocodile: new THREE.Color(0.22, 0.33, 0.22),
};
const ANIMAL_SIZE: Record<string, number> = { hare: 0.7, deer: 1.1, boar: 1.2, fish: 0.6, wolf: 1.25, bear: 1.7, crocodile: 1.6 };
const DEFAULT_ANIMAL_RGB = ANIMAL_RGB['deer']!;

/** Sky, sun and haze at noon and at midnight; everything between is a lerp. */
const DAY_SKY_HI = new THREE.Color(0x2f6ea8);
const DAY_SKY_LO = new THREE.Color(0xa8c6d8);
const NIGHT_SKY_HI = new THREE.Color(0x05080f);
const NIGHT_SKY_LO = new THREE.Color(0x141d2c);
const DAY_SUN = new THREE.Color(0xfff1d6);
const NIGHT_SUN = new THREE.Color(0x7d93c8);
const DAY_HEMI_SKY = new THREE.Color(0xbcd6ff);
const NIGHT_HEMI_SKY = new THREE.Color(0x2a3a5c);
const DAY_HEMI_GROUND = new THREE.Color(0x3a3a28);
const NIGHT_HEMI_GROUND = new THREE.Color(0x10141c);

const SELECT_COLOR = 0xffd34d;
const KIN_COLOR = 0x59d8e0;
const BOND_COLOR = 0x9ed35e;

function hash2(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * One separable box pass over a square field, with a running sum so the cost
 * does not depend on the radius. `stride` is 1 along a row and `n` down a
 * column; edges hold their last value rather than darkening toward zero.
 */
function blurAxis(src: Float32Array, dst: Float32Array, n: number, radius: number, stride: number): void {
  const other = stride === 1 ? n : 1;
  const inv = 1 / (radius * 2 + 1);
  for (let line = 0; line < n; line++) {
    const base = line * other;
    const at = (k: number): number => src[base + Math.min(n - 1, Math.max(0, k)) * stride]!;
    let sum = 0;
    for (let d = -radius; d <= radius; d++) sum += at(d);
    for (let k = 0; k < n; k++) {
      dst[base + k * stride] = sum * inv;
      sum += at(k + radius + 1) - at(k - radius);
    }
  }
}

/**
 * The sim's height samples, rounded off for the eye.
 *
 * Two separable box passes are a near-Gaussian, and a Gaussian is exactly the
 * right tool here: it leaves the low frequencies that make a range a range and
 * takes the cusps that an `|sin|` ridge field puts at every zero crossing. The
 * sim reads `heightAt` and is not affected; this is the picture's copy.
 */
function smoothField(src: Float32Array<ArrayBuffer>, n: number, radius: number): Float32Array<ArrayBuffer> {
  if (radius < 1) return src;
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    blurAxis(a, b, n, radius, 1);
    blurAxis(b, a, n, radius, n);
  }
  return a;
}

/** The shortest and tallest pine the view plants, as a multiple of the base cone. */
const TREE_MIN_S = 0.55;
const TREE_MAX_S = 1.50;

/** Instance capacity for `n` things — grown with headroom, never shrunk. */
function capacityFor(n: number): number {
  return Math.max(64, Math.ceil(n * 1.5));
}

// ── Figures ──────────────────────────────────────────────────────────────────

/**
 * The three bodies, built once. Each stands with its feet at y=0, is exactly
 * one unit tall, and faces +Z, so an instance matrix is just "here, this tall,
 * turned this way".
 *
 * They are silhouettes first: a stranger has to read child, adult and elder
 * from the outline alone, at seventeen pixels, in a screenshot, without being
 * told. So the child is a head on short legs, the adult has shoulders, and the
 * elder stoops under a cloak and carries a staff.
 */
function figureGeometry(stage: number): THREE.BufferGeometry {
  const form = stageForm(stage);
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number): void => {
    g.translate(x, y, z);
    parts.push(g);
  };

  /** A limb: a tapered cylinder, leaned out from the body by `tilt`. */
  const limb = (rTop: number, rBot: number, len: number, x: number, y: number, z: number, tilt: number): void => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 6);
    if (tilt !== 0) g.rotateZ(tilt);
    g.translate(x, y, z);
    parts.push(g);
  };

  if (stage === STAGE_CHILD) {
    // Mostly head, on stumps. A child has to be callable with no adult beside
    // it to compare against, so the proportion does the work, not the height:
    // the head is nearly a third of the whole figure.
    limb(0.058, 0.075, 0.22, -0.095, 0.11, 0, 0.12);
    limb(0.058, 0.075, 0.22, 0.095, 0.11, 0, -0.12);
    add(new THREE.CylinderGeometry(0.155, 0.145, 0.24, 8), 0, 0.34, 0);
    limb(0.044, 0.038, 0.20, -0.196, 0.35, 0, 0.42);
    limb(0.044, 0.038, 0.20, 0.196, 0.35, 0, -0.42);
    add(new THREE.SphereGeometry(form.head, 12, 10), 0, 1 - form.head, 0);
    add(new THREE.ConeGeometry(0.075, 0.16, 6).rotateX(Math.PI / 2), 0, 1 - form.head, form.head * 0.86);
  } else if (stage === STAGE_ELDER) {
    // Bent over a staff. At a fifth shorter than an adult, with a back pitched
    // thirty-five degrees and a stick standing a head above it, the outline is
    // the age — which is what a reviewer who called none of four elders on a 3%
    // height difference was entitled to.
    limb(0.05, 0.065, 0.38, -0.066, 0.19, 0.01, 0.05);
    limb(0.05, 0.065, 0.38, 0.066, 0.19, -0.02, -0.05);
    const trunk = new THREE.CylinderGeometry(0.115, 0.15, 0.40, 8);
    trunk.rotateX(form.stoop);
    trunk.translate(0, 0.54, 0.115);
    parts.push(trunk);
    const cloak = new THREE.ConeGeometry(0.25, 0.40, 10, 1, true);
    cloak.rotateX(form.stoop * 0.8);
    cloak.translate(0, 0.545, 0.10);
    parts.push(cloak);
    // The arm that holds the staff, reaching down and out.
    limb(0.036, 0.030, 0.34, 0.168, 0.55, 0.10, 0.34);
    add(new THREE.SphereGeometry(form.head, 10, 8), 0, 0.80, 0.30);
    add(new THREE.ConeGeometry(0.05, 0.12, 6).rotateX(Math.PI / 2), 0, 0.80, 0.30 + form.head);
    // The staff stands a head TALLER than the elder does, and it is thick
    // enough to survive two pixels of width. A stoop alone is read as somebody
    // bending over their work; a stoop with a pole rising past the head is age,
    // and it is the one part of this outline that does not foreshorten when the
    // camera looks down on it.
    const staff = new THREE.CylinderGeometry(0.044, 0.044, 1.16, 6);
    staff.rotateZ(-0.06);
    staff.translate(0.255, 0.56, 0.06);
    parts.push(staff);
    const knob = new THREE.SphereGeometry(0.062, 8, 6);
    knob.translate(0.29, 1.14, 0.06);
    parts.push(knob);
  } else {
    // Upright, square at the shoulder, small-headed, and STANDING WIDE. At
    // twenty pixels a figure whose legs and arms are tucked against its trunk
    // is a pin with a ball on it — which is what round two drew. The stance and
    // the shoulder bar are the whole silhouette: they are what make the outline
    // read as a person rather than as a post.
    limb(0.055, 0.075, 0.40, -0.105, 0.20, 0, 0.13);
    limb(0.055, 0.075, 0.40, 0.105, 0.20, 0, -0.13);
    add(new THREE.CylinderGeometry(0.175, 0.125, 0.34, 8), 0, 0.56, 0);
    const shoulders = new THREE.CylinderGeometry(0.075, 0.075, 0.50, 6);
    shoulders.rotateZ(Math.PI / 2);
    add(shoulders, 0, 0.71, 0);
    limb(0.048, 0.040, 0.36, -0.248, 0.53, 0, 0.26);
    limb(0.048, 0.040, 0.36, 0.248, 0.53, 0, -0.26);
    add(new THREE.SphereGeometry(form.head, 10, 8), 0, 1 - form.head - 0.005, 0);
    add(new THREE.ConeGeometry(0.052, 0.13, 6).rotateX(Math.PI / 2), 0, 1 - form.head, form.head);
  }
  return mergeGeometries(parts, false) ?? parts[0]!;
}

/**
 * The ground ring: the one mark in this world that says "a being is here".
 *
 * Nothing else wears a ring, which is what makes that a matter of looking
 * rather than of remembering a colour — and the wedge is the heading, read from
 * directly above where a body's facing is hardest to see.
 *
 * The ring also carries the CONDITION, as a shape: solid for well, broken for
 * starving, doubled for sick, and spiked for a being in danger. That is the
 * channel that survives a colour-blind viewer, a night grade and a greyscale
 * print, and it is why there are four of these rather than one tinted four
 * ways.
 *
 * Every vertex carries three weights instead of a colour: how much of it is the
 * being's own condition colour, how much is dark ink, and how much is bone. One
 * instanced colour cannot draw a bright band, a dark rim and a pale spike, and
 * a ring that is only bright disappears on snow while a ring that is only dark
 * disappears in a forest.
 */
function ringGeometry(style: number, core: boolean, arrow: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const weigh = (g: THREE.BufferGeometry, w: [number, number, number]): THREE.BufferGeometry => {
    const count = g.attributes['position']!.count;
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = w[0];
      a[i * 3 + 1] = w[1];
      a[i * 3 + 2] = w[2];
    }
    g.setAttribute('aWeights', new THREE.BufferAttribute(a, 3));
    parts.push(g);
    return g;
  };
  const COND: [number, number, number] = [1, 0, 0];
  const INK: [number, number, number] = [0, 1, 0];
  const BONE: [number, number, number] = [0, 0, 1];

  if (style === RING_DASHED) {
    const step = (Math.PI * 2) / 6;
    for (let i = 0; i < 6; i++) weigh(new THREE.RingGeometry(0.70, 1.04, 6, 1, i * step, step * 0.56), COND);
    weigh(new THREE.RingGeometry(1.04, 1.16, 34), INK);
  } else if (style === RING_DOUBLE) {
    weigh(new THREE.RingGeometry(0.84, 1.04, 34), COND);
    // Pushed out from 0.40–0.60 to leave the middle of the mark empty: the
    // centre now belongs to the life stage, and an elder who is also sick must
    // still read as filled-in rather than as two marks fighting over one disc.
    weigh(new THREE.RingGeometry(0.54, 0.70, 28), COND);
    weigh(new THREE.RingGeometry(1.04, 1.16, 34), INK);
  } else if (style === RING_NOTCHED) {
    weigh(new THREE.RingGeometry(0.70, 1.00, 34), COND);
    weigh(new THREE.RingGeometry(1.00, 1.10, 34), INK);
    // Bone spikes outside the rim: an alarm has to carry on a dark forest floor
    // at midnight, and this condition's colour is deliberately the darkest one.
    const teeth = 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const half = 0.16;
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        Math.cos(a - half) * 1.06, Math.sin(a - half) * 1.06, 0,
        Math.cos(a + half) * 1.06, Math.sin(a + half) * 1.06, 0,
        Math.cos(a) * 1.46, Math.sin(a) * 1.46, 0,
      ]), 3));
      tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
      tri.setIndex([0, 1, 2]);
      tri.computeVertexNormals();
      weigh(tri, BONE);
    }
  } else {
    weigh(new THREE.RingGeometry(0.70, 1.02, 34), COND);
    weigh(new THREE.RingGeometry(1.02, 1.16, 34), INK);
  }

  // An elder's mark is FILLED IN, and that is the whole of the difference.
  //
  // Stage was the worst-read channel in all three earlier rounds. Round three
  // put a second hairline ring three pixels outside the rim and a stranger
  // still read stage at 40% at forty-four pixels, calling elders adults: at
  // that size a thin outer circle is not a second ring, it is a slightly
  // thicker one. So the cue is now a difference of AREA — a solid bone disc
  // filling the middle of the mark, with its own dark keyline. Nothing else in
  // the vocabulary fills the centre: the sick being's second ring is a band at
  // 0.54–0.70, outside this disc, and every other style leaves the middle open.
  if (core) {
    weigh(new THREE.RingGeometry(0.40, 0.48, 26).translate(0, 0, 0.002), INK);
    weigh(new THREE.CircleGeometry(0.42, 26).translate(0, 0, 0.003), BONE);
  }

  // The heading pointer, aimed along -Y here so that it points along +Z — the
  // being's own forward — once the ring is laid flat. Round one authored it at
  // +Y, so every wedge in every screenshot pointed at where the being had just
  // been.
  //
  // It is a true ARROW now, not a sliver. Round three drew a long isoceles
  // triangle tapering from the rim to a point, in a fill that was mostly the
  // being's own condition colour, and a stranger read the exact octant 40% of
  // the time — every single miss landing one octant out, which is a reader who
  // found the mark and could not resolve its axis. A shaft with a barbed head
  // on the end of it has an axis you can see at a glance, and drawing it in
  // BONE over a dark keyline means the arrow reads at the same strength against
  // every ring colour, every terrain and every hour: heading does not belong to
  // the condition channel and should not borrow its palette.
  const tri = (
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number, z: number,
  ): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([ax, ay, z, bx, by, z, cx, cy, z]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  };
  const bar = (half: number, y0: number, y1: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -half, y0, z, half, y0, z, half, y1, z, -half, y1, z,
    ]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  };
  // …and in a crowd, no arrow at all. An arrow whose tail sits inside the
  // neighbour's mark is read as the NEIGHBOUR's facing about as often as its
  // own, and a confident wrong answer is worse than a missing one. See
  // `suppressOverlaps`; the legend says so, per band, in as many words.
  if (arrow) {
    weigh(bar(0.26, -0.96, -1.66, 0.006), INK);
    weigh(tri(0.62, -1.50, -0.62, -1.50, 0, -2.86, 0.006), INK);
    weigh(bar(0.145, -1.02, -1.62, 0.012), BONE);
    weigh(tri(0.46, -1.56, -0.46, -1.56, 0, -2.70, 0.012), BONE);
  }

  const merged = mergeGeometries(parts, false) ?? parts[0]!;
  merged.rotateX(-Math.PI / 2); // the ring is authored in XY; the ground is XZ
  return merged;
}

/**
 * The streak a moving being leaves behind it.
 *
 * "Walking" and "standing" are the two commonest states in any frame and the
 * only two that wear no pictogram; a still screenshot has no motion in it, so
 * round two tried to carry the difference in the length of the heading wedge
 * and a reviewer misread it twice. A mark either exists or it does not, and
 * that is a thing a photograph can say.
 *
 * It is laid flat on the ground behind the ring, tapering and fading out over
 * four marker-widths, so it reads as a wake rather than as a second pointer.
 * It is one instanced mesh: one draw call for every moving being in the world,
 * and nothing allocated to draw it.
 */
function trailGeometry(): THREE.BufferGeometry {
  const steps = 6;
  const pos: number[] = [];
  const fade: number[] = [];
  const index: number[] = [];
  const at = (t: number): { w: number; y: number; a: number } => ({
    w: 0.50 * (1 - t) + 0.06,
    y: 1.22 + t * 1.93,
    a: (1 - t) * (1 - t),
  });
  for (let s = 0; s <= steps; s++) {
    const { w, y, a } = at(s / steps);
    pos.push(-w, y, 0, w, y, 0);
    fade.push(a, a);
  }
  for (let s = 0; s < steps; s++) {
    const b = s * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(fade), 1));
  geo.setIndex(index);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function trailMaterial(fade: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Annotation is not part of the world it annotates. See `ringMaterial`.
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: fade },
    vertexShader: `
      attribute float aFade;
      varying float vFade;
      varying vec3 vInk;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vFade = aFade;
        vInk = instanceColor;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vFade;
      varying vec3 vInk;
      void main() {
        gl_FragColor = vec4(vInk, vFade * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A presence dot: what a being is at FAR, where the contract is how many and
 * where and nothing else. A filled disc with a dark rim, so it holds on snow
 * and on a forest floor alike, and small enough that a hundred of them read as
 * a population rather than as a texture.
 */
function dotGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const weigh = (g: THREE.BufferGeometry, w: [number, number, number]): void => {
    const count = g.attributes['position']!.count;
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = w[0];
      a[i * 3 + 1] = w[1];
      a[i * 3 + 2] = w[2];
    }
    g.setAttribute('aWeights', new THREE.BufferAttribute(a, 3));
    parts.push(g);
  };
  weigh(new THREE.RingGeometry(0.98, 1.44, 16), [0, 1, 0]);
  weigh(new THREE.CircleGeometry(1.0, 16).translate(0, 0, 0.004), [0, 0, 1]);
  const merged = mergeGeometries(parts, false) ?? parts[0]!;
  merged.rotateX(-Math.PI / 2);
  return merged;
}

/**
 * The ring's shader. Three weights in, one unlit colour out — no lighting, no
 * tone mapping, because an instrument mark must arrive on screen as the colour
 * the legend names, not as the film curve's opinion of it.
 *
 * And no depth test. A map pin that a building can eat is not a map pin: round
 * four's DEFAULT frame had three pins reduced to a bare arrowhead by a hut
 * standing in front of them, two of which a reviewer could only find at 3–4×
 * magnification. The annotation layer is drawn OVER the world it annotates, in
 * every band, always — that is what makes it annotation and not scenery.
 *
 * `aDim` is the filter's only effect on a mark: 1 for a being that answers the
 * question, a fraction for one that does not. It touches ALPHA and nothing
 * else, so a dimmed mark is the same mark drawn faintly — never a different
 * colour, never a different shape, and never absent. A filter that deleted
 * beings from the picture would break the one claim this view is built on.
 */
function ringMaterial(fade: { value: number }): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: fade },
    vertexShader: `
      attribute vec3 aWeights;
      attribute float aDim;
      varying vec3 vInk;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vInk = aWeights.x * instanceColor
             + aWeights.y * vec3(0.012, 0.014, 0.016)
             + aWeights.z * vec3(0.94, 0.90, 0.82);
        vAlpha = (aWeights.x + aWeights.y * 0.9 + aWeights.z) * aDim;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vInk;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vInk, vAlpha * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  // A mark whose geometry has no strength lane is drawn at full strength —
  // which is what every mark is until something asks a question.
  mat.defaultAttributeValues = { aDim: [1] };
  return mat;
}

// ── Materials that fade ──────────────────────────────────────────────────────

interface FadeUniforms {
  uFadeNear: { value: number };
  uFadeFar: { value: number };
  uSel: { value: THREE.Vector3 };
  uSelR: { value: number };
  /** How much of the thing survives when it is pressed against the lens. */
  uFadeFloor: { value: number };
  /** How much of it survives when it is standing in front of somebody. */
  uGhostFloor: { value: number };
  /** This mesh's own radius across and up, in metres, at instance scale 1. */
  uThick: { value: number };
  uThickY: { value: number };
  /** Where the THING's middle is above this mesh's own instance anchor. */
  uCentreY: { value: number };
  /** How much opacity a ghosted surface keeps where it turns away from the eye. */
  uRim: { value: number };
  /** How many of `uSubject` are live this frame. */
  uSubjectN: { value: number };
  /** View-space x, y, z, radius per being the reader is looking at. */
  uSubject: { value: Float32Array };
}

/**
 * Scenery that gets out of the way — and stays its own size while it does it.
 *
 * Six thousand trees and a thousand huts will hide beings, and a view of a
 * village whose people are behind the village is not a view of anything. Round
 * four's legend said "trees and huts step aside"; what it actually did was
 * aim a narrow cone down the camera's own axis, which cleared the middle of the
 * frame and nothing else — sixteen of twenty-nine reviewed beings had three
 * body pixels or fewer, inside huts and behind trunks.
 *
 * Two changes, and the second one matters more than it looks.
 *
 * WHAT steps aside is now decided by where the BEINGS are. Every being the
 * reader can read is packed into a handful of spheres in view space
 * (`packSubjects`), and any instance that is nearer to the eye than one of them
 * and overlaps it on screen ghosts out. That is the literal statement of
 * "between the camera and a being", so a trunk at the edge of the frame in
 * front of somebody clears, and a trunk in the middle of the frame in front of
 * nobody does not.
 *
 * HOW it steps aside is opacity, never size. Round four shrank the instance —
 * and that is why `scaleReport().hut` said 4.40 m over a hut a reviewer
 * measured at 2.43–2.56 m in two independent frames. The instrument was not
 * lying about the geometry; the renderer was quietly redrawing the world at 55%
 * to make room. A view whose scale contract is its whole subject may not resize
 * the world for legibility, ever. So a ghost keeps its footprint, its height
 * and its place, and loses only its opacity — and a structure leaves an outline
 * on the ground where it stands, so the village still reads as a village.
 *
 * Nothing is discarded and nothing is stippled: round one's 4×4 screen door
 * read as dead pixels under magnification, and it deserved to.
 *
 * The GLSL itself lives in `shading.ts`, and the reason is round eight's worst
 * defect. The rim term was written inline here, guarded by `uRim > 0.0`, and
 * reached for `transformedNormal` — which only a LIT material's vertex program
 * declares. GLSL compiles both arms of an `if`, so the lit-windows material (a
 * `MeshBasicMaterial`, rim permanently zero) failed to compile on every boot for
 * four rounds and every hut was a black box at midnight. Nobody saw it because
 * three writes a compile failure to `console.error`, which `pageerror` does not
 * raise. The rim is now a BUILD-time choice, its normal comes from `normal` and
 * `normalMatrix`, and `window.__ygg.health()` counts what `onShaderError` sees.
 */
function applyGhostFade(
  material: THREE.Material,
  out: FadeUniforms[],
  subjects: Float32Array,
  near = 110,
  far = 320,
  floor = 0,
  ghost = 0.2,
  thick = 3.3,
  thickY = 4.6,
  centreY = 0,
  rim = 0,
): void {
  // Mostly-opaque instances that occasionally blend. depthWrite stays ON: each
  // mesh is one object to the sorter, so the trees behind a tree are settled by
  // the depth buffer exactly as they were when this was opaque, and only the
  // few ghosted instances blend at all.
  material.transparent = true;
  material.onBeforeCompile = (shader) => {
    const u: FadeUniforms = {
      uFadeNear: { value: near },
      uFadeFar: { value: far },
      uSel: { value: new THREE.Vector3(0, -1e6, 0) },
      uSelR: { value: 0 },
      uFadeFloor: { value: floor },
      uGhostFloor: { value: ghost },
      uThick: { value: thick },
      uThickY: { value: thickY },
      uCentreY: { value: centreY },
      uRim: { value: rim },
      uSubjectN: { value: 0 },
      uSubject: { value: subjects },
    };
    Object.assign(shader.uniforms, u);
    out.push(u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ghostCommonChunk(SUBJECT_SLOTS))
      // Off for foliage: a tree's edge is not a frame, it is more tree — and
      // off for anything unlit, which has no normal to take a rim from.
      .replace('#include <begin_vertex>', ghostVertexChunk(SUBJECT_SLOTS, rim > 0));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGhostA;')
      .replace('#include <color_fragment>', ghostFragmentChunk());
  };
}

/**
 * The x-ray pass: a being that something is standing in front of keeps a pale
 * outline of itself, drawn only in the pixels where it is hidden.
 *
 * This is the backstop under the ghosting, and it is what makes "a being is
 * never invisible because of scenery" a property of the frame rather than a
 * hope about the ghost rule. Terrain folds, a rock, a hut the ghost rule has
 * not reached yet, another being — any of them, and the figure still reads.
 *
 * `depthFunc: GreaterDepth` is the whole trick: the body's own depth test,
 * inverted, so the silhouette appears exactly where the body FAILED and nowhere
 * else. Over open ground it draws nothing at all. The hull is pushed out a
 * couple of screen pixels along the view-space normal so the shape carries an
 * edge rather than sitting flush inside its own missing body, and anything too
 * small to be a picture is collapsed off-screen: three hundred specks showing
 * through a mountain is noise with an explanation.
 *
 * WHEN it is drawn matters as much as how. It goes in after the scenery and
 * before the bodies (`RENDER_XRAY` between `RENDER_SCENERY` and `RENDER_BODY`),
 * so the depth buffer it tests against holds the land, the trees and the walls
 * — and not the other beings. A being standing behind another being is not
 * hidden by scenery, it is simply further away, and x-raying that turned a
 * crowd into a heap of overlapping ghosts in round five's first NEAR frame.
 */
function xrayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.GreaterDepth,
    side: THREE.FrontSide,
    uniforms: {
      uOpacity: { value: 0.52 },
      uGrowPx: { value: 2.2 },
      uMinPx: { value: XRAY_MIN_BODY_PX },
      uWorldPerPx: { value: 0.002 },
    },
    vertexShader: `
      uniform float uGrowPx;
      uniform float uMinPx;
      uniform float uWorldPerPx;
      varying vec3 vTint;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        float depth = max(0.001, -mv.z);
        float tall = length(instanceMatrix[0].xyz);
        if (tall / (depth * uWorldPerPx) < uMinPx) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 n = normalMatrix * (mat3(instanceMatrix) * normal);
        vec2 outward = length(n.xy) > 1e-4 ? normalize(n.xy) : vec2(0.0);
        mv.xy += outward * (uGrowPx * depth * uWorldPerPx);
        gl_Position = projectionMatrix * mv;
        vTint = instanceColor;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vTint;
      void main() {
        gl_FragColor = vec4(mix(vTint, vec3(0.93, 0.95, 0.99), 0.55), uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * The dark keyline around every figure — an inverted hull, and the cheapest
 * honest answer to "how many people are in there".
 *
 * Bodies are pale by design: the condition palette is chosen on LIGHTNESS, so
 * four bone-to-amber figures overlapping at a metre's spacing have no edge
 * between them. Fifteen of them in a shelter were one shape, and a reviewer
 * counting from the picture resolved seven. A one-pixel dark line does what no
 * amount of shading does: it gives every silhouette a boundary that survives
 * overlap, at any light, in any condition, without touching the encoding.
 *
 * Back faces only, drawn opaque just before the bodies, with every vertex
 * pushed radially away from the figure's own middle IN THE SCREEN PLANE by a
 * fixed number of pixels. Radially and not along the normal: these bodies are
 * merged BOXES, and a box face square to the camera has a normal with no screen
 * component at all, so a normal-expanded hull leaves exactly the faces a reader
 * is looking straight at without a line. Photographed and confirmed — the first
 * cut drew a clean halo on the ground beside a figure and nothing between two
 * overlapping ones, which is the only place it is needed.
 *
 * Because it writes depth at the silhouette, the figure in front keeps its line
 * against the figure behind; because the hull's back faces sit behind the body's
 * front faces, the body always wins its own interior. Anything drawn too small
 * to be a picture is pushed off-screen instead — a keyline round a four-pixel
 * speck is a dark speck.
 */
function outlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uGrowPx: { value: 2.1 },
      uMinPx: { value: OUTLINE_MIN_BODY_PX },
      uWorldPerPx: { value: 0.002 },
      uInk: { value: new THREE.Color(0x090c11) },
    },
    vertexShader: `
      uniform float uGrowPx;
      uniform float uMinPx;
      uniform float uWorldPerPx;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        float depth = max(0.001, -mv.z);
        float tall = length(instanceMatrix[0].xyz);
        if (tall / (depth * uWorldPerPx) < uMinPx) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // The figure's own middle, not the instance origin — which is at the
        // FEET, and would have fattened a head upward and nothing sideways.
        vec4 mid = modelViewMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0);
        vec2 away = mv.xy - mid.xy;
        float len = max(1e-4, length(away));
        mv.xy += (away / len) * (uGrowPx * depth * uWorldPerPx);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uInk;
      void main() {
        gl_FragColor = vec4(uInk, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A pennant on a short mast: the flag an unwell being flies.
 *
 * Built by hand, in two layers — a dark keyline first and the coloured shape
 * over it, distinguished by `aInk` — because the mark has to hold against
 * sunlit grass, snow and midnight without carrying a second colour of its own.
 * The keyline layer is written into the buffer first and the material does not
 * depth-test, so the fill lands on top of it in one draw call.
 */
function flagGeometry(): THREE.BufferGeometry {
  const shape = [
    [-0.05, 0], [0.05, 0], [0.05, 1],
    [-0.05, 0], [0.05, 1], [-0.05, 1],
    [0.05, 1.0], [0.80, 0.74], [0.05, 0.46],
  ] as const;
  const pos: number[] = [];
  const ink: number[] = [];
  for (const layer of [1, 0]) {
    for (const [x, y] of shape) {
      const grow = layer === 1 ? 0.085 : 0;
      pos.push(x + (x >= 0 ? grow : -grow), y + (y > 0.5 ? grow : -grow), 0);
      ink.push(layer);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aInk', new THREE.BufferAttribute(new Float32Array(ink), 1));
  return geo;
}

/**
 * The mark that finds an unwell being COLD.
 *
 * Condition already has three channels — the ring's shape, the ring's hue and
 * the body's tint — and a reviewer shown four fresh frames holding seven unwell
 * beings wrote "everybody is well" on all four. Two sick in a hundred and
 * twenty-three, at sixty-two pixels each, is a needle in a field of bone: every
 * one of those channels asks the reader to compare this being against its
 * neighbours, and nobody compares a hundred and twenty-three of anything.
 *
 * So the unwell get something no well being has at all. It is drawn only for
 * them — two to seven marks in a frame, never a wall of badges — through
 * everything, at a floor of screen pixels so it does not shrink out of reach at
 * DEFAULT, in the condition's own colour on a dark keyline so it holds against
 * grass, snow and night alike.
 */
function flagMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: `
      attribute float aInk;
      varying vec3 vTint;
      void main() {
        vec4 anchor = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        vec4 mv = modelViewMatrix * anchor;
        // A billboard in view space: the flag never turns away from the reader,
        // and its size is the instance's own scale, which writeMarkers has
        // already floored in screen pixels.
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
        vTint = mix(instanceColor, vec3(0.02, 0.024, 0.030), aInk);
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vTint;
      void main() {
        gl_FragColor = vec4(vTint, uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Firelight — the pane in a wall, and the pool it throws on the ground.
 *
 * One shader for both, because they are one light. `uPool` picks which: the
 * pane is a hot core inside a warm frame, the pool is a soft disc that fades
 * to nothing at its rim. Both are ADDITIVE and untone-mapped, which is the
 * whole difference between light and a sticker — round six's pane averaged
 * with the wall at 62% alpha and sampled (155,145,130) against a wall of
 * (37,24,15): a grey rectangle. Adding (255,185,90) to that wall cannot come
 * out grey whatever it is drawn over.
 *
 * `uNight` is the only animation: full after dark, nothing by day, and it does
 * not consult the ghost rule — the lamp belongs to the house, so a hut that
 * steps aside for the being you are following keeps its window lit.
 */
export function emberMaterial(night: { value: number }, pool: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: pool ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: { uNight: night, uPool: { value: pool ? 1 : 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uNight;
      uniform float uPool;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        // The pane: a hot core out to a third of the way, then a shoulder to
        // the frame. The pool: a soft disc, brightest under the sill.
        float pane = smoothstep(1.15, 0.30, max(abs(p.x), abs(p.y))) * 0.75
                   + smoothstep(0.75, 0.0, d) * 0.55;
        float glow = smoothstep(1.0, 0.0, d);
        float a = mix(pane, glow * glow * 0.42, uPool) * uNight;
        if (a <= 0.004) discard;
        // 255/185/90 — hearth, not lamp cream. The core runs toward white
        // because a flame's middle is hotter than its edge.
        vec3 warm = mix(vec3(1.0, 0.725, 0.353), vec3(1.0, 0.94, 0.80), (1.0 - uPool) * smoothstep(0.6, 0.0, d));
        gl_FragColor = vec4(warm * a, a);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A view of the same continent the sim runs on, with the beings drawn as the
 * subject rather than as scatter.
 *
 * Everything that repeats is instanced and everything per-frame is written into
 * arrays that already exist: a frame writes matrices and colours, and allocates
 * nothing. Labels are DOM, because text in a canvas is text you cannot select
 * or read at a small size, but they are budgeted to a handful of nodes that are
 * reused rather than one node per being.
 */
export class World3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();

  // Beings, split by life stage so each can have its own body.
  private figures: THREE.InstancedMesh[] = [];
  private figureCount = [0, 0, 0];
  private stageIds: Int32Array[] = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
  /** One mesh per ring style × elder, so condition and age are shapes. */
  private ringMeshes: THREE.InstancedMesh[] = [];
  private ringCount = new Array<number>(RING_BUCKETS).fill(0);
  /** Per ring bucket: how strongly each drawn mark is painted. See `ringMaterial`. */
  private ringDim: (THREE.InstancedBufferAttribute | null)[] = new Array<null>(RING_BUCKETS).fill(null);
  private dotDim: THREE.InstancedBufferAttribute | null = null;
  private pictos: THREE.InstancedMesh | null = null;
  private pictoCell: THREE.InstancedBufferAttribute | null = null;
  /** Per badge: the marker unit its stub is welded to the ring with. */
  private pictoRim: THREE.InstancedBufferAttribute | null = null;
  /** The streak behind a being that is on the move. */
  private trails: THREE.InstancedMesh | null = null;
  /** What a being is at FAR: a dot on the ground, and nothing claimed about it. */
  private dots: THREE.InstancedMesh | null = null;

  /** Per-being, in draw order — everything the probes, labels and picking need. */
  private ids = new Int32Array(0);
  private beingPos = new Float32Array(0); // scene-space feet
  private beingNormal = new Float32Array(0); // the drawn ground's normal under it
  private beingTop = new Float32Array(0); // scene-space head height
  private beingMark = new Float32Array(0); // marker height (the ring's own scale)
  private beingAct = new Uint8Array(0);
  private beingCond = new Uint8Array(0);
  private beingStage = new Uint8Array(0);
  private beingHeading = new Float32Array(0);
  /** Need pressure in [0, 100], straight off the wire. 0 is satisfied. */
  private beingHunger = new Uint8Array(0);
  private beingRest = new Uint8Array(0);
  /** The engine's current plan step, by `GOAL_WORDS` code, and where in the plan. */
  private beingGoal = new Uint8Array(0);
  private beingPlanAt = new Uint8Array(0);
  private beingPlanOf = new Uint8Array(0);
  /** 1 while this being is inside a crowd that carries its own number. */
  private beingCrowded = new Uint8Array(0);
  /** 1 while this being projected inside the canvas on the last frame. */
  private beingOnScreen = new Uint8Array(0);
  /**
   * 1 while this being's mark stands clear of every neighbour's, and may
   * therefore carry a pictogram and a heading arrow without the reader having
   * to guess whose they are. See `suppressOverlaps` — this is the whole of
   * item L4's fifth promise, and `markAudit()` reports it.
   */
  private beingMarkClear = new Uint8Array(0);
  /**
   * 1 while this being's BADGE also stands clear of every other badge.
   *
   * A second pass over the same rule, on the discs' own geometry rather than on
   * the rings they are welded to: a badge is drawn out past the rim, so two
   * beings whose rings clear each other can still have discs in a stack. The
   * one that made a reviewer call the close bands a sticker sheet was four
   * badges in a vertical column over three bodies.
   */
  private beingPictoClear = new Uint8Array(0);
  /**
   * 1 while this being is standing inside a structure whose OCCUPANTS chip is
   * carrying its ring — see `planInside`. Its body is still drawn, through the
   * ghost; what it loses is the ring, the badge and the arrow that turned six
   * people in a hut into one scribble of tangled hoops.
   */
  private beingInside = new Uint8Array(0);
  /**
   * Whose room is OPEN — the hut holding the being the reader is following.
   *
   * Per occupant, but decided per HUT: a door opens for a room, not for a
   * person. See `planInside`.
   */
  private insideOpen = new Uint8Array(0);
  /** Where an occupant may be drawn: inside its own floor plan. */
  private insideAt = new Float32Array(0);
  /** The forward pitch `writeMarkers` actually drew this being at, in radians. */
  private beingLean = new Float32Array(0);
  /**
   * The widest pitch this being's act can reach — the UN-animated silhouette,
   * and the only pitch the picker's box is allowed to read. See `poseLean`.
   */
  private beingPose = new Float32Array(0);
  /**
   * How deep into its shelter this being stands, 0 at the near wall and 1 at
   * the far one — the depth cue that separates a packed room into people.
   */
  /** How many beings in frame drew a mark of their own — the countable term. */
  private pinsDrawn = 0;
  private instanceCount = 0;

  /**
   * Which contract the picture is currently keeping, and the marker size that
   * decided it. Held across frames so the hysteresis has something to hold on
   * to: a camera resting on a band edge must not rewrite the legend every frame.
   */
  private band: ZoomBand = 'default';
  /** How tall a grown being stands on screen right now, in CSS pixels. */
  private bandPx = 2;
  /** How wide the map's ring is on screen right now, in CSS pixels. */
  private annotPx = 12;
  /** Handles on how strongly the map is drawn over the world. */
  private readonly ringFade = { value: 0.94 };
  private readonly trailFade = { value: 0.80 };
  private readonly pictoFade = { value: 0.94 };
  /** How much of its normal size the activity chip keeps in this band. */
  private pictoScale = 1;

  private readonly names = new Map<number, string>();
  private readonly speakingUntil = new Map<number, number>();

  /** Kept only so `scaleReport` can measure a real tree rather than quote one. */
  private treeFoliage: THREE.InstancedMesh | null = null;
  private resourceMeshes: THREE.InstancedMesh[] = [];
  private animalMesh: THREE.InstancedMesh | null = null;
  private animalKinds: string[] = [];

  private readonly structureMeshes = new Map<string, THREE.InstancedMesh>();
  private windows: THREE.InstancedMesh;
  /** The light each lit window throws on the ground outside it. */
  private windowPool: THREE.InstancedMesh;
  /** Where each pool stands, so its screen-pixel floor can be held per frame. */
  private poolAt = new Float32Array(0);
  private poolCount = 0;
  /** 1 after dark, 0 by day — the only thing the firelight shader animates. */
  private readonly emberFade = { value: 0 };
  private readonly structures: StructureUpdate[] = [];
  private readonly seenStructures = new Set<number>();

  private readonly deaths: THREE.InstancedMesh;
  private readonly deathAt = new Float32Array(DEATH_SLOTS * 3);
  private readonly deathBorn = new Float32Array(DEATH_SLOTS);
  private deathNext = 0;

  private readonly ripples: THREE.InstancedMesh;
  private readonly rippleAt = new Float32Array(SPEECH_SLOTS * 3);
  private readonly rippleBorn = new Float32Array(SPEECH_SLOTS);
  private readonly threads: THREE.LineSegments;
  private readonly threadPos: Float32Array;
  private readonly threadCol: Float32Array;
  private readonly threadTo = new Float32Array(SPEECH_SLOTS * 3);
  private readonly threadHas = new Uint8Array(SPEECH_SLOTS);
  private rippleNext = 0;

  private readonly ties: THREE.LineSegments;
  private readonly tiePos: Float32Array;
  private readonly tieColor: Float32Array;
  private tieKin: number[] = [];
  private tieBonded: number[] = [];
  private readonly kinSet = new Set<number>();
  private readonly bondSet = new Set<number>();
  private tiesOn = false;

  private readonly selRing: THREE.Mesh;
  private readonly selBeam: THREE.Mesh;
  /** The ring under whoever the hover card is describing. See `setHover`. */
  private readonly hoverRing: THREE.Mesh;
  private selectedId: number | null = null;
  private hoveredId: number | null = null;
  private following = false;
  private focusUntil = 0;

  /**
   * The beings that answer the question the filter bar is asking, or `null`
   * while it is asking nothing.
   *
   * The view's job with a filter is not to hide anything — a being removed from
   * the picture cannot be counted, and this instrument's whole claim is that
   * what you see is what is there. Matches are emphasised with a halo and full
   * colour; everyone else stays exactly where they are, dimmed. The population
   * on screen never changes, and `countAudit` still closes.
   */
  private highlight: ReadonlySet<number> | null = null;
  private halos: THREE.InstancedMesh | null = null;
  /** How many beings had their pictogram and arrow withheld this frame. */
  private marksHeld = 0;

  /** Per-material handles on how much of a body's colour survives the dark. */
  private readonly bodyNight: { value: number }[] = [];

  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly headlight: THREE.DirectionalLight;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly foliageFades: FadeUniforms[] = [];
  private daylight = 1;

  /**
   * The beings the scenery has to step aside for, in VIEW space — one shared
   * buffer, uploaded to every scenery material. See `packSubjects`.
   */
  private readonly subjects = new Float32Array(SUBJECT_SLOTS * 4);
  private subjectCount = 0;
  /** Reused scratch for the pack; never grown inside a frame. */
  private readonly subjectPool: Subject[] = [];
  private readonly subjectSeen: Subject[] = [];
  /** The pale outline a hidden being keeps — one per life stage. */
  private xrays: THREE.InstancedMesh[] = [];
  private xrayMat: THREE.ShaderMaterial | null = null;
  /** The dark keyline every figure carries — one per life stage. */
  private outlines: THREE.InstancedMesh[] = [];
  private outlineMat: THREE.ShaderMaterial | null = null;
  /** The pennant only an unwell being flies. */
  private flags: THREE.InstancedMesh | null = null;
  /**
   * Whether the WORLD is advancing.
   *
   * A paused instrument is a frozen frame. Round five paused the sim, settled
   * the camera, and the idle lean kept breathing — which moved the body boxes,
   * which flipped the depth order at a pixel between a reviewer reading an
   * offer and pressing on it. Nothing here animates while this is false; the
   * camera is allowed to finish coming to rest, because that is the reader's
   * own hand and not the world.
   */
  private simRunning = false;
  /** The animation clock, held still while the world is paused. */
  private animT = 0;
  /** Where a ghosted building stood, so the village still reads as a village. */
  private footprints: THREE.InstancedMesh | null = null;
  /** Per structure: scene x, z and the ground under it, for the footprint ring. */
  private structureAt = new Float32Array(0);

  /** The legibility specimen: dev-only, display-only, never sent anywhere. */
  private specimenOn = false;
  private specimenCount = 0;
  /** How many of `instanceCount` are the world's own beings. */
  private simCount = 0;
  private specimenBase = new THREE.Vector3();
  private specimenYaw = 0;
  private specimenGround: THREE.Mesh | null = null;

  /**
   * How far the furthest name reached this frame, in metres from the ground the
   * camera is looking at. Measured from the placement, never assumed — see
   * `auditNames`.
   */
  private namedWithin = 0;
  /** How many names the budgeter placed this frame — the same list the DOM got. */
  private namesExpected = 0;
  /** How many READABLE beings stand inside `namedWithin` — every one of them named. */
  private namesWithin = 0;
  /** Nameable beings left unnamed while somebody further away was named. Zero at NEAR. */
  private nameViolations = 0;
  /** The same count without the band's promise applied — the raw measurement. */
  private namesOutOfOrder = 0;
  /** Readable beings a building's chip is the label for. */
  private namesCarried = 0;
  /**
   * How many of those are NOT well.
   *
   * The count the strip has to print out loud. A frame that withholds an unwell
   * being inside a shelter is behaving correctly; a frame that withholds one
   * silently has told the reader everybody is fine.
   */
  private namesCarriedUnwell = 0;
  /** Reused: whose name went up this frame, for the audit above. */
  private readonly placedIds = new Set<number>();
  /** Reused: the frame's beings as the naming rule sees them. */
  private readonly nameSubjects: NameSubject[] = [];

  /** Drawn bodies as screen boxes, rebuilt at most once per frame. */
  private boxes: BodyBox[] = [];
  private readonly boxById = new Map<number, BodyBox>();
  private boxFrame = -1;

  /** The scale bar, as last measured off the ground under the view centre. */
  private scaleMetres = 0;
  private scalePx = 0;
  private scaleLabel = '';

  private readonly labelLayer: HTMLElement | null;
  private readonly labelNodes: HTMLElement[] = [];
  private readonly leaderNodes: HTMLElement[] = [];
  private labelShown: string[] = [];
  private labelCandidates: LabelCandidate[] = [];
  private lastLabelPick = 0;
  private labelPicked: number[] = [];
  /** The quiet chip that says which band the view is in and how big a mark is. */
  private bandNode: HTMLElement | null = null;
  /** Its box, measured when its caption changes — names are kept off it. */
  private bandW = 0;
  private bandH = 0;
  /** Reused so a label can be told to keep off the beings around it. */
  private readonly bodyRects: LabelObstacle[] = [];

  /** Crowds: an outline round the group and the number of beings inside it. */
  private readonly hullNodes: HTMLElement[] = [];
  private readonly countNodes: HTMLElement[] = [];
  /** The parts inside one chip: the number, the match badge, the mix bar. */
  private readonly countParts: { num: HTMLElement; ill: HTMLElement; badge: HTMLElement; mix: HTMLElement; seg: HTMLElement[] }[] = [];
  private readonly screenPoints: ScreenPoint[] = [];
  /** `screenPoints[k]` is being `screenIndex[k]` in the per-frame arrays. */
  private readonly screenIndex: number[] = [];
  /** Where the same being's FEET landed, so a body box is measured, not inferred. */
  private readonly screenFootY: number[] = [];
  /** Whether any being's mark is being carried by a structure's chip this frame. */
  private insideAny = false;
  /** How many of the leading clusters are OCCUPANTS chips — see `planInside`. */
  private insideCount = 0;
  /** Where each of those hangs, in scene units: on its own building's roof apex. */
  private readonly insideAnchors: number[] = [];
  /** And where its leader runs to: the middle of that building's doorway. */
  private readonly insideDoors: number[] = [];
  /** Which occupants chip is a being's label, by id — `visibilityOf` reports it. */
  private readonly insideChipOf = new Map<number, number>();
  private clusters: Cluster[] = [];
  /** The leader from a chip back to the outline it counts. */
  private readonly chipLeadNodes: HTMLElement[] = [];
  /** Where the count chips are sitting, so names can be placed around them. */
  private readonly chipRects: LabelObstacle[] = [];
  /** Every mark drawn this frame, as a box — what a chip has to keep off. */
  private readonly pinRects: LabelObstacle[] = [];
  /** Per cluster: where its chip landed on the canvas, for hover and for probes. */
  private readonly chipAt = new Float32Array(CLUSTER_BUDGET * 2);
  /** Per cluster: the chip's half width and half height as drawn. */
  private readonly chipHalf = new Float32Array(CLUSTER_BUDGET * 2);
  /** Per cluster: 1 while the chip found a spot covering nothing. */
  private readonly chipClear = new Uint8Array(CLUSTER_BUDGET);
  /** Per cluster: world centre x, y, z, and the camera distance it was found at. */
  private readonly clusterWorld = new Float32Array(CLUSTER_BUDGET * 4);
  /**
   * Per cluster: who it counts, by id, as of the grouping it was planned in.
   *
   * The grouping is redone ten times a second and the beings keep walking, so
   * "every member of this chip is in this quarter of the frame" is a fact about
   * the plan, not about this frame. These ids are what `crowdsStrayed` checks
   * the live positions against, so the fact is re-established the instant it
   * stops being true rather than a tenth of a second later.
   */
  private clusterIds: number[][] = [];
  private lastCluster = 0;
  /** How wide the panel floating over the right of the canvas is, in pixels. */
  private panelWidth = 0;

  /** Heights at the terrain mesh's own grid points — what `surfaceAt` reads. */
  private gridHeight = new Float32Array(0);

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly raycaster = new THREE.Raycaster();
  /** A throwaway eye, for scoring a camera placement without moving the real one. */
  private readonly scout = new THREE.PerspectiveCamera(45, 1, 0.25, 1);
  private readonly ndc = new THREE.Vector2();
  private readonly probe = new THREE.Vector3();
  /** The ground under the camera's target — the one point distances are quoted from. */
  private readonly aimPoint = new THREE.Vector3();
  private readonly focusTarget = new THREE.Vector3();
  private ro: ResizeObserver | null = null;
  private downX = 0;
  private downY = 0;
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private pointerMoved = false;
  private lastHoverPick = 0;
  private hiddenBeings = 0;
  private hiddenWildlife = 0;
  /** World units per CSS pixel at one unit of distance — the marker-size maths. */
  private worldPerPx = 0.002;
  /** The canvas size the projection above was derived from — see `syncProjection`. */
  private viewW = 0;
  private viewH = 0;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerLeave: () => void;
  private readonly onWheel: () => void;
  /** Shader compiles, console errors and lost contexts — see `health.ts`. */
  private readonly health: Health = createHealth();
  private readonly dropHealthTap: () => void;
  /** The page's own faults — see `onWindowError`, and `HealthReport.windowErrors`. */
  private readonly dropWindowTap: () => void;
  private readonly onContextLost: (e: Event) => void;
  /**
   * The canvas rectangle, read once a frame.
   *
   * Everything that converts between canvas and CLIENT coordinates needs it,
   * and the cover rule now asks the picker about every readable being in the
   * frame — which, with a `getBoundingClientRect` per ask, is a hundred forced
   * layouts inside one probe call.
   */
  private rect: DOMRect | null = null;
  private rectFrame = -1;
  /**
   * Per frame: what the picker hands back at each drawn being's own point.
   *
   * The whole of "who can a reader point at" — see `offersAtOwnPoint`. Cached
   * against `rendered` because `visibleIds()` and `rosterRows()` both walk the
   * population and neither may pay for the picker twice in one frame.
   */
  private readonly offerFirst = new Map<number, number | null>();
  private offerFrame = -1;
  /**
   * When the camera was last driven, and where it stood at the last drawn
   * frame. Between them they answer "is anything about to look different?",
   * which is what decides whether this view is allowed a full-rate frame.
   */
  private lastInput = 0;
  private readonly camWas = new THREE.Vector3(NaN, NaN, NaN);
  private camMoving = true;

  /** Told when the pointer moves over a being, a crowd chip, or off both. */
  private readonly onHover?: (candidates: PickCandidate[], x: number, y: number) => void;
  private readonly onChip?: (cluster: number | null, x: number, y: number) => void;
  private readonly onChipClick?: (cluster: number) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect?: (id: number | null) => void,
    hooks?: {
      onHover?: (candidates: PickCandidate[], x: number, y: number) => void;
      onChip?: (cluster: number | null, x: number, y: number) => void;
      onChipClick?: (cluster: number) => void;
    },
  ) {
    this.onHover = hooks?.onHover;
    this.onChip = hooks?.onChip;
    this.onChipClick = hooks?.onChipClick;
    // The label layer is this view's own: it has to exist before the first
    // frame, and a React ref on a sibling element is not guaranteed to have
    // attached by the time the canvas ref fires.
    const layer = document.createElement('div');
    layer.className = 'wlabels';
    canvas.parentElement?.appendChild(layer);
    this.labelLayer = layer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Health, before anything is built: the materials compile on the first
    // frame, and a program that fails then has to be counted then. See
    // `health.ts` — three writes a compile failure to `console.error`, which no
    // page-level error handler ever sees, and four rounds shipped one.
    this.renderer.debug.onShaderError = (gl, program, vs, fs): void => {
      const shaderLog = (s: WebGLShader | null): string => (s ? gl.getShaderInfoLog(s) ?? '' : '');
      const text = `${gl.getProgramInfoLog(program) ?? ''} ${shaderLog(vs)} ${shaderLog(fs)}`.replace(/\s+/g, ' ').trim();
      this.health.noteShaderError(text || 'a program failed to compile');
      // Loud as well as counted: a reader with devtools open should see it, and
      // the console tap below turns that into a second non-zero count. Both
      // have to be zero, so raising both is not double-reporting a fault — it
      // is the fault being visible from both directions.
      console.error('THREE.WebGLProgram: shader error (see __ygg.health())');
    };
    this.dropHealthTap = onConsoleError(console, (text) => this.health.noteConsoleError(text));
    // The fourth door. A reviewer raised `ResizeObserver loop completed with
    // undelivered notifications` on a live resize and every count stayed at
    // zero, because a `window.onerror` is not a `console.error` and nobody was
    // listening at that door at all.
    this.dropWindowTap = onWindowError(window, (text) => this.health.noteWindowError(text));
    this.onContextLost = (e: Event): void => {
      e.preventDefault();
      this.health.noteContextLost('webglcontextlost');
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    // Without tone mapping, sunlight plus sky light drives the ground past 1.0
    // and the whole continent clips to a pale wash — and a bone-white being on
    // washed-out grass is two blown-out whites. ACES keeps the highlights and
    // gives the land its colour back.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Aerial perspective, tinted to the horizon — see HAZE_NEAR. The density is
    // re-set every frame from where the camera is standing.
    this.scene.fog = new THREE.FogExp2(DAY_SKY_LO.getHex(), HAZE_NEAR);

    // A near plane of a quarter-metre, because the camera is allowed into the
    // street with them and a one-metre plane clips a being's knees off; far
    // enough back to hold the sea out to where the haze has closed it.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.25, SEA_SPAN * 0.62);
    // Higher and closer than a horizon shot: the land is the subject, and a
    // third of the frame spent on empty sky is a third of the instrument wasted.
    this.camera.position.set(-WORLD * 0.26, WORLD * 0.5, WORLD * 0.42);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Nearly horizontal, because street level means looking AT them and not
    // down on them.
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 3;
    // Far enough out that the whole two kilometres is in one frame, and no
    // further: past this the map is drawing pins over ground nobody is on.
    this.controls.maxDistance = WORLD * 1.35;
    // A notch that crosses a useful amount of a two-kilometre continent.
    //
    // At the default speed a hardware notch moves the radius by 5%, so getting
    // from a settlement at DEFAULT out to FAR is fifty-five of them — a band
    // that exists, that the report calls reachable, and that nobody will ever
    // scroll to. `cameraReport().notchesToFar` is the number this is tuned
    // against, and the acceptance harness drives a real wheel and counts them.
    this.controls.zoomSpeed = ZOOM_SPEED;
    this.controls.target.set(0, 40, -WORLD * 0.05);

    this.hemi = new THREE.HemisphereLight(DAY_HEMI_SKY.getHex(), DAY_HEMI_GROUND.getHex(), 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY_SUN.getHex(), 1.15);
    this.sun.position.set(WORLD * 0.35, WORLD * 0.7, WORLD * 0.15);
    this.scene.add(this.sun);
    // A weak light riding the camera. Night has to be visibly night without
    // becoming a black frame in which nothing can be counted.
    this.headlight = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.scene.add(this.headlight, this.headlight.target);

    this.skyMat = World3D.skyMaterial();
    // Drawn first and without a depth test, so the shell only has to contain
    // the CAMERA rather than the whole sea: the sky fills the background
    // unconditionally and everything else paints over it. A sphere large
    // enough to hold a twelve-kilometre ocean would otherwise have to fit
    // inside the far plane too, and the depth buffer pays for that.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(WORLD * 3, 24, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    this.scene.add(sky);

    this.buildTerrain();
    this.buildSurround();
    this.buildWater();
    this.buildTrees();
    this.buildRocks();

    // Firelight, and it has to LOOK like fire.
    //
    // Round six shipped this as a flat cream `MeshBasicMaterial` pane at 0.62
    // alpha, which over a wall of (37,24,15) composites to (155,145,130): a
    // grey rectangle taped to a brown box. Three things were wrong and all
    // three are fixed here. The colour is warm (255,185,90) rather than pale
    // lamp cream. The blending is ADDITIVE and `toneMapped` is off, so the pane
    // adds light to the wall instead of averaging with it — a lit window is
    // brighter than what is around it or it is a sticker. And the shader gives
    // it a hot core with a soft falloff to the frame, so it reads as a source
    // rather than as a filled rectangle.
    //
    // It no longer takes `applyGhostFade`. A hut that steps aside for the being
    // you are following switched its own light off precisely when the room
    // became the subject; the lamp belongs to the house, not to the wall's
    // opacity.
    this.windows = this.instanced('lit windows', new THREE.PlaneGeometry(1.15, 0.95), emberMaterial(this.emberFade, false), 64);
    this.windows.renderOrder = RENDER_WINDOW;
    this.scene.add(this.windows);

    // And the light it throws on the ground outside.
    //
    // This is what makes a settlement at night read as inhabited from DEFAULT,
    // where a 1.15 m pane is a third of a pixel: the pool holds a floor in
    // SCREEN pixels, the way the pins do, so a village after dark is a
    // scattering of warm points on dark ground rather than a field of black
    // boxes. Flat on the ground and additive, so it washes the grass at the
    // wall foot at NEAR and is a point of light at DEFAULT — one object doing
    // both jobs, because they are the same light.
    this.windowPool = this.instanced(
      'window light pools',
      new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
      emberMaterial(this.emberFade, true),
      64,
    );
    this.windowPool.renderOrder = RENDER_WINDOW - 1;
    this.scene.add(this.windowPool);

    // A low cairn of stones, not a bright marker. Seen from above a pale cone
    // is a sheet of white paper, and at two hundred deaths a day the map filled
    // with litter; a dark rounded heap reads as something left behind.
    this.deaths = this.instanced(
      'death cairns',
      new THREE.SphereGeometry(0.55, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1),
      new THREE.MeshStandardMaterial({ color: 0x6d6459, roughness: 1, flatShading: true }),
      DEATH_SLOTS,
    );
    this.deaths.count = DEATH_SLOTS;
    this.scene.add(this.deaths);

    this.ripples = this.instanced(
      'speech ripples',
      new THREE.RingGeometry(0.84, 1, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }),
      SPEECH_SLOTS,
    );
    this.ripples.count = SPEECH_SLOTS;
    this.scene.add(this.ripples);

    this.threadPos = new Float32Array(SPEECH_SLOTS * ARC_SEGMENTS * 6);
    this.threadCol = new Float32Array(SPEECH_SLOTS * ARC_SEGMENTS * 6);
    this.threads = World3D.lineSegments(this.threadPos, this.threadCol, true);
    this.scene.add(this.threads);

    this.tiePos = new Float32Array(TIE_LINKS * ARC_SEGMENTS * 6);
    this.tieColor = new Float32Array(TIE_LINKS * ARC_SEGMENTS * 6);
    this.ties = World3D.lineSegments(this.tiePos, this.tieColor, false);
    this.ties.visible = false;
    this.scene.add(this.ties);

    // Two rings on the ground and a spike above the head, all drawn through
    // whatever is in front of them. The point is not decoration: with three
    // hundred beings on a continent, "which one is selected" has to be
    // answerable from the far side of the map, over a mountain, at a glance.
    this.selRing = new THREE.Mesh(
      mergeGeometries([
        new THREE.RingGeometry(1.1, 1.42, 44),
        new THREE.RingGeometry(2.5, 2.72, 52),
      ], false)?.rotateX(-Math.PI / 2) ?? new THREE.RingGeometry(1.1, 1.42, 44).rotateX(-Math.PI / 2),
      // A ground DECAL, and it obeys the depth buffer.
      //
      // Round six's version was `depthTest: false` at 0.95 opacity with tone
      // mapping off, which drew a pure-white band THROUGH the hut it was
      // standing beside and across the bodies inside it — a reviewer's crop of
      // a NEAR frame is a blown-out crescent sweeping over a wall. A mark that
      // paints over the thing it is marking is not a mark. The spike above the
      // head keeps its see-through-anything property, because "which one is
      // selected, from across the map" is a real requirement and the spike is
      // where it belongs; the ring lies on the ground like the ring it is.
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.68, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: true }),
    );
    this.selRing.renderOrder = 20;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    // The spike starts above the head on purpose: a marker that covers the
    // thing it marks is not a marker.
    this.selBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.5, 1, 7, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffa81f, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.selBeam.renderOrder = 21;
    this.selBeam.visible = false;
    this.scene.add(this.selBeam);

    // The being the card is describing. A name alone is not a highlight: in a
    // crowd of fourteen the reader has to be able to see WHICH body the card
    // belongs to, from across the frame, without reading anything. Bone, like
    // the filter's halo and the lit chips — "found" is one channel everywhere.
    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(1.52, 1.86, 40).rotateX(-Math.PI / 2),
      // Same ruling as the selection ring: on the ground, under the walls,
      // and not bright enough to be the brightest thing in a night frame.
      new THREE.MeshBasicMaterial({
        color: 0xf2f7fa, transparent: true, opacity: 0.7, depthTest: true, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: true,
      }),
    );
    this.hoverRing.renderOrder = 19;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    this.buildFigures();
    this.buildLabels();

    this.onPointerDown = (e: PointerEvent): void => {
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.lastInput = performance.now();
    };
    this.onPointerUp = (e: PointerEvent): void => {
      this.lastInput = performance.now();
      this.handleClick(e);
    };
    this.onPointerMove = (e: PointerEvent): void => {
      if (e.clientX !== this.pointerX || e.clientY !== this.pointerY) {
        this.pointerMoved = true;
        this.lastInput = performance.now();
      }
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerInside = true;
    };
    this.onPointerLeave = (): void => {
      this.pointerInside = false;
      this.onHover?.([], -1, -1);
    };
    this.onWheel = (): void => {
      this.lastInput = performance.now();
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  // ── Static scenery ─────────────────────────────────────────────────────────

  private static skyMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uHigh: { value: DAY_SKY_HI.clone() },
        uLow: { value: DAY_SKY_LO.clone() },
        uNight: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uHigh;
        uniform vec3 uLow;
        uniform float uNight;
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
          vec3 col = mix(uLow, uHigh, h);
          // Stars, only once it is actually dark, and only above the horizon.
          vec3 g = floor(vDir * 340.0);
          float n = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float star = step(0.9985, n) * uNight * smoothstep(0.02, 0.2, vDir.y);
          gl_FragColor = vec4(col + star, 1.0);
        }`,
    });
  }

  private static lineSegments(pos: Float32Array, col: Float32Array, additive: boolean): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Ties keep their own hue: added to bright grass, cyan and green both
      // wash out to the same white line and stop meaning anything.
      ...(additive ? { blending: THREE.AdditiveBlending } : {}),
      depthWrite: false,
      toneMapped: false,
    }));
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * One relationship, drawn as an arc that lifts off the ground between two
   * beings. A straight chord across half a continent reads as a laser; a curve
   * reads as a link, and it stays legible where several of them fan out from
   * the same being.
   */
  private writeArc(
    pos: Float32Array, col: Float32Array, link: number, segments: number,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r: number, g: number, b: number,
  ): void {
    const base = link * segments * 6;
    const dx = bx - ax;
    const dz = bz - az;
    const lift = Math.sqrt(dx * dx + dz * dz) * 0.22 + 6;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + lift;
    const mz = (az + bz) / 2;
    const px = (t: number): number => (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
    const py = (t: number): number => (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
    const pz = (t: number): number => (1 - t) * (1 - t) * az + 2 * (1 - t) * t * mz + t * t * bz;
    for (let s = 0; s < segments; s++) {
      const k = base + s * 6;
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      pos[k] = px(t0); pos[k + 1] = py(t0); pos[k + 2] = pz(t0);
      pos[k + 3] = px(t1); pos[k + 4] = py(t1); pos[k + 5] = pz(t1);
      for (let v = 0; v < 2; v++) {
        col[k + v * 3] = r;
        col[k + v * 3 + 1] = g;
        col[k + v * 3 + 2] = b;
      }
    }
  }

  private static clearLinks(pos: Float32Array, from: number, to: number, segments: number): void {
    pos.fill(0, from * segments * 6, to * segments * 6);
  }

  /**
   * Where the ground actually IS, in scene units, at any point.
   *
   * `heightAt` is the sim's continuous field; the terrain is a 200×200 mesh of
   * flat triangles through it, and between the grid points the two disagree by
   * metres. Anything placed by the field rather than by the mesh floats above a
   * ridge and sinks into a hollow — which is exactly what turned a ring under a
   * being into a crescent cut in half by its own hill. So everything that
   * stands on the ground is placed on the ground that is drawn.
   */
  private surfaceAt(wx: number, wy: number): number {
    const n = GRID;
    const step = WORLD / n;
    const gx = Math.min(n - 1e-6, Math.max(0, wx / step));
    const gy = Math.min(n - 1e-6, Math.max(0, wy / step));
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    const h = this.gridHeight;
    const at = (i: number, j: number): number => h[j * (n + 1) + i]!;
    // The same two triangles buildTerrain indexes: (0,0)(0,1)(1,0) and (1,0)(0,1)(1,1).
    const height = fx + fy <= 1
      ? at(i0, j0) * (1 - fx - fy) + at(i0, j0 + 1) * fy + at(i0 + 1, j0) * fx
      : at(i0 + 1, j0) * (1 - fy) + at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * (fx + fy - 1);
    return height * HSCALE;
  }

  /** The drawn ground's normal here, so a marker lying on it lies flush. */
  private surfaceNormal(wx: number, wy: number, out: THREE.Vector3): THREE.Vector3 {
    const step = WORLD / GRID;
    const dx = (this.surfaceAt(wx + step, wy) - this.surfaceAt(wx - step, wy)) / (2 * step);
    const dz = (this.surfaceAt(wx, wy + step) - this.surfaceAt(wx, wy - step)) / (2 * step);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** The ground's colour at a point, from its region and how high it stands. */
  private static groundColor(wx: number, wy: number, h: number, out: [number, number, number]): void {
    const [r, g, b] = REGION_RGB[regionAt(wx, wy)];
    const shade = 0.82 + Math.min(0.5, h / 18) * 0.45;
    out[0] = r * shade;
    out[1] = g * shade;
    out[2] = b * shade;
    // Above the treeline the ground stops being ground: bare rock, then pale
    // scree on the tops. Without it the range is one flat grey mass and reads
    // as a wall rather than as height — the tops have to catch the light.
    const rock = Math.min(1, Math.max(0, (h - ROCK_AT) / 5)) * 0.78;
    const snow = Math.min(1, Math.max(0, (h - SNOW_AT) / 3.5)) ** 1.3 * 0.88;
    for (let c = 0; c < 3; c++) {
      out[c] = out[c]! + (ROCK_RGB[c]! - out[c]!) * rock;
      out[c] = out[c]! + (SNOW_RGB[c]! - out[c]!) * snow;
    }
  }

  private buildTerrain(): void {
    const n = GRID;
    const step = WORLD / n;
    const side = n + 1;
    const raw = new Float32Array(side * side);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) raw[j * side + i] = heightAt(i * step, j * step);
    }
    // The MESH is smoothed; `heightAt` is not, and the sim never sees this.
    this.gridHeight = smoothField(raw, side, Math.max(1, Math.round(RELIEF_SMOOTH_M / step)));

    const positions = new Float32Array(side * side * 3);
    const colors = new Float32Array(side * side * 3);
    const rgb: [number, number, number] = [0, 0, 0];
    let p = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const wx = i * step;
        const wy = j * step;
        const h = this.gridHeight[j * side + i]!;
        positions[p] = wx - HALF;
        positions[p + 1] = h * HSCALE;
        positions[p + 2] = wy - HALF;
        World3D.groundColor(wx, wy, h, rgb);
        colors[p] = rgb[0];
        colors[p + 1] = rgb[1];
        colors[p + 2] = rgb[2];
        p += 3;
      }
    }
    const indices = new Uint32Array(n * n * 6);
    let q = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * side + i;
        indices[q] = a;
        indices[q + 1] = a + side;
        indices[q + 2] = a + 1;
        indices[q + 3] = a + 1;
        indices[q + 4] = a + side;
        indices[q + 5] = a + side + 1;
        q += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })));
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(SEA_SPAN, SEA_SPAN);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1d5b7d, transparent: true, opacity: 0.74, roughness: 0.12, metalness: 0.35 }));
    mesh.position.y = SEA * HSCALE;
    this.scene.add(mesh);
  }

  /**
   * What is beyond the world — and why it is no longer a wall.
   *
   * The sim's continent stops dead at two kilometres, and round three closed it
   * with four three-hundred-metre boxes in near-black. From a kilometre up that
   * was a picture frame; at street level it was a matte black band filling the
   * upper half of the frame, with a strip of sky above it. An instrument whose
   * horizon is a wall is an instrument that has told you the world is a diorama.
   *
   * So the ground carries on instead. The terrain's own boundary is continued
   * outward — dropping below the waterline over the first few hundred metres,
   * then running flat for a dozen kilometres as a sea floor — and the open sea
   * is drawn over the whole of it. Nothing marks the edge: the haze closes the
   * distance long before the geometry runs out, and what a reader sees at the
   * end of the land is sea going into air, which is what a horizon is.
   */
  private buildSurround(): void {
    const n = GRID;
    const step = WORLD / n;
    const side = n + 1;
    const at = (i: number, j: number): number => this.gridHeight[j * side + i]!;

    const edge: number[] = []; // wx, wy around the boundary, in order
    for (let i = 0; i <= n; i++) edge.push(i * step, 0);
    for (let j = 1; j <= n; j++) edge.push(WORLD, j * step);
    for (let i = n - 1; i >= 0; i--) edge.push(i * step, WORLD);
    for (let j = n - 1; j >= 1; j--) edge.push(0, j * step);
    const ring = edge.length / 2;

    // Three rings of vertices: the terrain's own edge, the foot of the drop,
    // and the far sea floor. Pushed straight out from the centre, so the strip
    // closes round the corners without a fan and without a crack.
    const positions = new Float32Array(ring * 3 * 3);
    const colors = new Float32Array(ring * 3 * 3);
    const rgb: [number, number, number] = [0, 0, 0];
    const FLOOR: readonly [number, number, number] = [0.13, 0.19, 0.23];
    for (let k = 0; k < ring; k++) {
      const wx = edge[k * 2]!;
      const wy = edge[k * 2 + 1]!;
      const i = Math.round(wx / step);
      const j = Math.round(wy / step);
      const h = at(Math.min(n, i), Math.min(n, j));
      const sx = wx - HALF;
      const sz = wy - HALF;
      const len = Math.max(1e-6, Math.hypot(sx, sz));
      const ux = sx / len;
      const uz = sz / len;
      World3D.groundColor(wx, wy, h, rgb);
      const write = (row: number, x: number, y: number, z: number, mix: number): void => {
        const o = (row * ring + k) * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        for (let c = 0; c < 3; c++) colors[o + c] = rgb[c]! + (FLOOR[c]! - rgb[c]!) * mix;
      };
      write(0, sx, h * HSCALE, sz, 0);
      write(1, sx + ux * SHELF_FALL, SHELF_DROP * HSCALE, sz + uz * SHELF_FALL, 0.85);
      write(2, sx + ux * SHELF_OUT, (SHELF_DROP - 0.4) * HSCALE, sz + uz * SHELF_OUT, 1);
    }

    const indices = new Uint32Array(ring * 2 * 6);
    let q = 0;
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < ring; k++) {
        const k1 = (k + 1) % ring;
        const a = row * ring + k;
        const b = row * ring + k1;
        const c = (row + 1) * ring + k;
        const d = (row + 1) * ring + k1;
        indices[q] = a;
        indices[q + 1] = c;
        indices[q + 2] = b;
        indices[q + 3] = b;
        indices[q + 4] = c;
        indices[q + 5] = d;
        q += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildTrees(): void {
    const step = 22;
    const places: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        const region = regionAt(wx, wy);
        const density = region === 'forest' ? 0.8 : region === 'hills' ? 0.12 : 0;
        if (density === 0) continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i, j) > density) continue;
        // Six metres to twenty, and a real spread between them: a forest of
        // one tree repeated is the thing that makes a render look like a map
        // of a forest rather than a forest.
        places.push({ x: wx + (hash2(i + 7, j) - 0.5) * step, y: wy + (hash2(i, j + 7) - 0.5) * step, s: TREE_MIN_S + hash2(i + 3, j + 3) ** 1.6 * (TREE_MAX_S - TREE_MIN_S) });
        if (places.length >= 6000) break;
      }
    }
    // Darker and squatter than round one, with the trunk mostly buried in the
    // skirt of the cone. A pale trunk under a bright crown is a vertical light
    // shape on a dark ground — which is exactly what a being is, and a reviewer
    // counting people should never have to rule out a tree.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x33230f, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1e4423, roughness: 0.96 });
    // Only what is pressed against the lens. Round three's first cut faded
    // anything within fourteen metres, which at street level is the whole
    // street: the camera came down among them and the world went out.
    // Trunk and crown are one tree. Their anchors sit five metres apart, so
    // each is told where the tree's middle is relative to its own origin and
    // both then ghost together — see `applyGhostFade`.
    applyGhostFade(trunkMat, this.foliageFades, this.subjects, 3.5, 12, 0, 0.18, 3.3, 4.6, 3.8);
    applyGhostFade(foliageMat, this.foliageFades, this.subjects, 3.5, 12, 0, 0.18, 3.3, 4.6, -1.0);
    const trunks = this.instanced('tree trunks', new THREE.CylinderGeometry(0.22, 0.42, 4.4, 5), trunkMat, places.length);
    const foliage = this.instanced('tree crowns', new THREE.ConeGeometry(3.3, 9, 6), foliageMat, places.length);
    trunks.count = places.length;
    foliage.count = places.length;
    trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    foliage.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    places.forEach((pl, k) => {
      const base = this.surfaceAt(pl.x, pl.y);
      const px = pl.x - HALF;
      const pz = pl.y - HALF;
      this.dummy.scale.set(pl.s, pl.s, pl.s);
      this.dummy.rotation.set(0, hash2(k, k) * Math.PI, 0);
      this.dummy.position.set(px, base + 2.2 * pl.s, pz);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(k, this.dummy.matrix);
      this.dummy.position.set(px, base + 7 * pl.s, pz);
      this.dummy.updateMatrix();
      foliage.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.treeFoliage = foliage;
    this.scene.add(trunks, foliage);
  }

  private buildRocks(): void {
    const step = 36;
    const places: { x: number; y: number; s: number }[] = [];
    for (let wy = 0; wy < WORLD; wy += step) {
      for (let wx = 0; wx < WORLD; wx += step) {
        if (regionAt(wx, wy) !== 'mountain') continue;
        const i = Math.round(wx / step);
        const j = Math.round(wy / step);
        if (hash2(i + 11, j + 5) > 0.32) continue;
        places.push({ x: wx, y: wy, s: 1.5 + hash2(i, j + 2) * 3.4 });
        if (places.length >= 1400) break;
      }
    }
    // Close to the stone they sit on. Round one's near-black boulders read as a
    // field of dark markers across the whole mountain range — the strongest
    // thing in the frame, and about nothing.
    const rocks = this.instanced('boulders', new THREE.IcosahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: 0x7d7b80, roughness: 1, flatShading: true }), Math.max(1, places.length));
    rocks.count = places.length;
    rocks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    places.forEach((pl, k) => {
      this.dummy.scale.set(pl.s, pl.s * 0.8, pl.s);
      this.dummy.rotation.set(hash2(k, 1), hash2(k, 2) * Math.PI, hash2(k, 3));
      this.dummy.position.set(pl.x - HALF, this.surfaceAt(pl.x, pl.y) + pl.s * 0.6, pl.y - HALF);
      this.dummy.updateMatrix();
      rocks.setMatrixAt(k, this.dummy.matrix);
    });
    this.dummy.scale.set(1, 1, 1);
    this.dummy.rotation.set(0, 0, 0);
    this.scene.add(rocks);
  }

  /**
   * Give a mark geometry its per-instance strength lane, sized for `cap`.
   *
   * It lives on the GEOMETRY because `regrow` keeps the geometry and swaps the
   * mesh, so a lane held on the mesh would silently lose its buffer the first
   * time a world grew past sixty-four beings — which is every world.
   */
  private static dimLane(geo: THREE.BufferGeometry, cap: number): THREE.InstancedBufferAttribute {
    const held = geo.getAttribute('aDim') as THREE.InstancedBufferAttribute | undefined;
    if (held && held.count >= cap) return held;
    const lane = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
    lane.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDim', lane);
    return lane;
  }

  /**
   * Every instanced mesh this view creates goes through here, and here is where
   * it is made undroppable.
   *
   * Three caches an `InstancedMesh`'s bounding sphere on its first frustum test
   * and recomputes it only when something sets `boundingSphere = null`. A mesh
   * built with `count = 0` — which every mesh here is, because the count is
   * written per frame — caches an EMPTY sphere, and an empty sphere intersects
   * no frustum, ever. That is not a subtle failure mode: it is invisible from
   * every direction a test can look from. `shaderErrors` 0, `consoleErrors` 0,
   * `pageerror` 0, the program links, `updateLight` sets the opacity, the
   * matrices are written and uploaded — and the object is never drawn again for
   * the life of the view. It shipped for a round exactly that way: the lit
   * windows, `this.windows`, the one mesh in this file that did not turn
   * culling off.
   *
   * So culling is off by construction rather than by remembering, the mesh
   * carries a name, and `cullAudit` walks the scene for anything that got in
   * another way. See `HealthReport.cullRisks`.
   */
  private instanced(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Which instanced meshes in the scene three may still drop on a stale sphere.
   *
   * The scene, not a registry of what this file remembers creating: the guard
   * has to catch the mesh somebody adds in a year's time without reading this
   * comment. A mesh is safe when culling is off, or when its bounds are null —
   * which is how `writeMarkers` keeps the raycast honest — and nothing else
   * counts as safe.
   */
  cullAudit(): string[] {
    const risks: string[] = [];
    this.scene.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || !mesh.frustumCulled) return;
      if (mesh.boundingSphere === null) return;
      risks.push(mesh.name || 'an unnamed instanced mesh');
    });
    return risks;
  }

  private buildFigures(): void {
    const ringMat = ringMaterial(this.ringFade);
    // Four conditions × adult or elder × whether this mark is allowed to claim
    // a facing. Sixteen draw calls buy three whole encodings that need no
    // colour and no badge, and the ability to say nothing about a third.
    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = this.instanced(
        `condition rings ${bucket}`,
        ringGeometry(bucket >> 2, ((bucket >> 1) & 1) === 1, (bucket & 1) === 1),
        ringMat,
        64,
      );
      // The shader reads `instanceColor`, and three only declares that
      // attribute for a mesh that already has one.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
      mesh.renderOrder = RENDER_RING;
      this.ringMeshes[bucket] = mesh;
      this.ringDim[bucket] = World3D.dimLane(mesh.geometry, 64);
      this.scene.add(mesh);
    }

    const trails = this.instanced('walk trails', trailGeometry(), trailMaterial(this.trailFade), 64);
    trails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    trails.renderOrder = RENDER_TRAIL;
    this.trails = trails;
    this.scene.add(trails);

    // The halo a being wears while it answers the question the filter is
    // asking. A wide, soft bone annulus OUTSIDE the condition ring, drawn
    // through the world like every other annotation — so a match on the far
    // side of a hill is still a match you can see. It carries no hue of its
    // own: "found" is not a condition, and giving it a colour would put a
    // fifth swatch into a palette chosen on lightness for four.
    const halos = this.instanced(
      'filter halos',
      new THREE.RingGeometry(1.30, 1.92, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xf6efdc, transparent: true, opacity: 0.72, depthWrite: false, depthTest: false,
        side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
      }),
      64,
    );
    halos.renderOrder = RENDER_HALO;
    this.halos = halos;
    this.scene.add(halos);

    const dots = this.instanced('presence dots', dotGeometry(), ringMat, 64);
    dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    dots.renderOrder = RENDER_RING;
    dots.visible = false;
    this.dots = dots;
    this.dotDim = World3D.dimLane(dots.geometry, 64);
    this.scene.add(dots);

    this.xrayMat = xrayMaterial();
    this.outlineMat = outlineMaterial();
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.instanced(`bodies ${stage}`, figureGeometry(stage), this.figureMaterial(), 64);
      mesh.renderOrder = RENDER_BODY;
      // A body needs a colour before three will declare `instanceColor`, and
      // the silhouette that shares this buffer reads it.
      mesh.setColorAt(0, this.color.setHex(HUE_WELL));
      this.figures[stage] = mesh;
      this.scene.add(mesh);

      const ghost = this.instanced(`x-ray ${stage}`, mesh.geometry, this.xrayMat, 64);
      ghost.renderOrder = RENDER_XRAY;
      this.xrays[stage] = ghost;
      this.scene.add(ghost);

      const edge = this.instanced(`outlines ${stage}`, mesh.geometry, this.outlineMat, 64);
      edge.renderOrder = RENDER_OUTLINE;
      this.outlines[stage] = edge;
      this.scene.add(edge);
    }
    this.linkXrays();
    this.growBeingCapacity(64);

    // The outline a ghosted building leaves behind. Flat on the ground, drawn
    // through whatever is over it, and exactly the size of the thing that
    // stood there — a village of ghosts still has to read as a village.
    const foot = this.instanced(
      'building footprints',
      new THREE.RingGeometry(0.88, 1, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xbfc9cf, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
      64,
    );
    foot.renderOrder = RENDER_FOOT;
    foot.visible = false;
    this.footprints = foot;
    this.scene.add(foot);

    const atlas = buildGlyphAtlas();
    const pictoGeo = new THREE.PlaneGeometry(1, 1);
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    cell.setUsage(THREE.DynamicDrawUsage);
    pictoGeo.setAttribute('aCell', cell);
    this.pictoCell = cell;
    const rim = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    rim.setUsage(THREE.DynamicDrawUsage);
    pictoGeo.setAttribute('aRim', rim);
    this.pictoRim = rim;
    this.pictos = this.instanced('activity badges', pictoGeo, World3D.pictoMaterial(atlas, this.pictoFade), 64);
    // The pictogram shader reads `instanceColor`, and three only declares that
    // attribute for a mesh that already has one.
    this.pictos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    this.pictos.renderOrder = RENDER_PICTO;
    this.scene.add(this.pictos);

    // The unwell flag. See `flagMaterial`: the one mark in this view that is
    // about a CONDITION rather than an activity, drawn only for the few beings
    // who are not well, over everything, at a size that does not shrink out of
    // reach.
    const flags = this.instanced('unwell flags', flagGeometry(), flagMaterial(), 64);
    flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    flags.renderOrder = RENDER_PICTO;
    this.flags = flags;
    this.scene.add(flags);
  }

  /**
   * The x-ray silhouettes ride on the bodies' own instance buffers — the same
   * matrices, the same colours, uploaded once. A silhouette that could drift
   * from the body it belongs to would be worse than none, and this makes that
   * impossible rather than unlikely.
   */
  private linkXrays(): void {
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const body = this.figures[stage];
      for (const rider of [this.xrays[stage], this.outlines[stage]]) {
        if (!body || !rider) continue;
        rider.geometry = body.geometry;
        rider.instanceMatrix = body.instanceMatrix;
        if (body.instanceColor) rider.instanceColor = body.instanceColor;
      }
    }
  }

  /**
   * Pictograms are billboards cut from one atlas: the quad is built in view
   * space from the instance's position, so it always faces the camera, and the
   * atlas cell rides along as a per-instance attribute. One draw call for every
   * mark in the world.
   *
   * The instance is anchored at the being's own RING, not over its head, and
   * the quad is pushed up and to the right by a fixed fraction of the marker —
   * exactly far enough that the stub drawn into the lower-left of every cell
   * ends on that ring's rim. In a crowd that is the whole answer to whose mark
   * this is, and it is an answer a still screenshot can give.
   */
  private static pictoMaterial(map: THREE.Texture, fade: { value: number }): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uMap: { value: map },
        uGrid: { value: PICTO_GRID },
        // The weld is measured off the RING and the quad is sized off the
        // FIGURE, so the two cannot be one offset in quad-units any more: a
        // badge capped to its being's height would have dragged its own stub
        // in off the rim with it. `uRim` is where the ring's edge is per
        // marker-unit, `aRim` is this being's marker, and `uStub` is where the
        // stub sits inside the cell — so the chip keeps landing on its own
        // ring at any size.
        uRim: { value: PICTO_RIM },
        uStub: { value: new THREE.Vector2(PICTO_STUB_AT[0], PICTO_STUB_AT[1]) },
        // The chip is annotation and fades back with the rest of it. Round
        // five's first NEAR frame had ninety-six chips at full strength over
        // rings at 0.42 and a scene at 1.0: a wall of badges with a village
        // somewhere behind it.
        uOpacity: { value: fade.value },
      },
      vertexShader: `
        uniform float uGrid;
        uniform float uRim;
        uniform vec2 uStub;
        attribute float aCell;
        attribute float aRim;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vec4 world = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec4 mv = modelViewMatrix * world;
          mv.xy += position.xy * s + vec2(uRim * aRim) - uStub * s;
          gl_Position = projectionMatrix * mv;
          // The atlas is drawn with a canvas, whose rows run DOWN, and uploaded
          // with three's default flip, so texture rows run UP. Round one read
          // the cell index straight off the canvas layout and got both the row
          // and the cell's own vertical orientation mirrored: every being that
          // was sick wore the "asleep" Z and every being in danger wore the
          // BLANK cell. The row is counted from the far side and the cell is
          // read upright.
          float g = uGrid;
          vec2 cellXY = vec2(mod(aCell, g), g - 1.0 - floor(aCell / g));
          vUv = (cellXY + uv) / g;
          vTint = instanceColor;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.04) discard;
          // The atlas is a mask: white is the chip, black is its keyline and
          // the symbol punched into it. The chip takes the tint, the ink stays
          // dark, so the mark holds against grass, snow, water and night alike.
          gl_FragColor = vec4(mix(vec3(0.02, 0.022, 0.026), vTint, t.r), t.a * uOpacity);
          #include <colorspace_fragment>
        }`,
    });
  }

  /**
   * A body, lit — with a floor under how dark it is allowed to get.
   *
   * At midnight the sun is off and a standard material multiplies every being
   * down to the same grey, so a reviewer at daylight 0.00 read "amber beings"
   * off warm window light and counted 30 of 46. Condition is the thing a
   * researcher scans for; it cannot be a property of the hour. So a share of
   * the body's own colour is added back as emission as the light goes, which
   * leaves the LAND to darken — night still reads as night — while the people
   * in it stay the colour the legend says they are.
   */
  private figureMaterial(): THREE.MeshStandardMaterial {
    // Opaque in every way that shows — alpha is 1 and depth is written — but
    // BLENDED, which is what puts it in three's transparent queue where
    // `renderOrder` decides. The bodies have to be painted after the x-ray
    // silhouettes so a being standing behind another one is covered by it
    // rather than showing through it. See RENDER_BODY.
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, transparent: true, depthWrite: true });
    mat.onBeforeCompile = (shader) => {
      const lift = { value: 0 };
      shader.uniforms['uNightLift'] = lift;
      this.bodyNight.push(lift);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNightLift;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNightLift;',
        );
    };
    return mat;
  }

  private buildLabels(): void {
    const layer = this.labelLayer;
    if (!layer) return;
    const band = document.createElement('div');
    band.className = 'wband';
    const bar = document.createElement('i');
    bar.className = 'wbar';
    // The span is measured off the ground every frame — see `updateScaleBar`.
    // It was a hard-coded '200 units' under a bar clamped to 190 px, which at
    // NEAR was a ruler claiming two hundred over 1.9 m of grass.
    bar.dataset['span'] = '';
    const words = document.createElement('span');
    band.append(bar, words);
    layer.appendChild(band);
    this.bandNode = band;
    // Crowd outlines and their numbers go in FIRST, so names land on top of
    // them: the number belongs to a group, and a name belongs to one being in
    // it, and where they meet the name has to win.
    for (let i = 0; i < CLUSTER_BUDGET; i++) {
      const hull = document.createElement('div');
      hull.className = 'whull';
      hull.style.display = 'none';
      layer.appendChild(hull);
      this.hullNodes.push(hull);
    }
    // A chip is a number, a stacked bar of what the crowd is made of, and a
    // badge for how many of them answer the current filter. The parts are
    // built once and moved; a chip that rebuilt its own markup ten times a
    // second would be the most expensive thing in the frame.
    for (let i = 0; i < CLUSTER_BUDGET; i++) {
      const count = document.createElement('div');
      count.className = 'wcount';
      count.style.display = 'none';
      const num = document.createElement('i');
      num.className = 'wnum';
      const badge = document.createElement('i');
      badge.className = 'wmatch';
      badge.style.display = 'none';
      const mix = document.createElement('i');
      mix.className = 'wmix';
      const seg: HTMLElement[] = [];
      for (let s = 0; s < MIX_SEGMENTS; s++) {
        const bar = document.createElement('i');
        bar.style.display = 'none';
        mix.appendChild(bar);
        seg.push(bar);
      }
      // How many of this crowd are NOT well, in the worst condition's own
      // colour. The mix bar underneath is thirty pixels by four and a reviewer
      // did not notice it at all — he read four frames holding seven unwell
      // beings as "everybody is well". A number is not a bar: this one is the
      // size of the count beside it and it is absent for a crowd that is fine,
      // so its presence alone is the signal.
      const ill = document.createElement('i');
      ill.className = 'will';
      ill.style.display = 'none';
      count.append(num, ill, badge, mix);
      // Chips are the one thing in the annotation layer you can point at, so
      // they take the pointer back — `.wlabels` turns it off for everything.
      count.style.pointerEvents = 'auto';
      const cluster = i;
      // Client coordinates, because the card that opens is positioned in them —
      // the chip's own canvas-space position is recorded separately, for probes.
      count.addEventListener('pointerenter', (e) => this.onChip?.(cluster, e.clientX, e.clientY));
      count.addEventListener('pointerleave', () => this.onChip?.(null, -1, -1));
      count.addEventListener('click', () => this.onChipClick?.(cluster));
      layer.appendChild(count);
      this.countNodes.push(count);
      this.countParts.push({ num, ill, badge, mix, seg });
      // The number sits outside its own ring now, so it carries a line home:
      // without one, a chip pushed clear of a dense settlement is a number
      // floating over open ground.
      const lead = document.createElement('div');
      lead.className = 'wleader chiplead';
      lead.style.display = 'none';
      layer.appendChild(lead);
      this.chipLeadNodes.push(lead);
    }
    for (let i = 0; i < LABEL_BUDGET_MAX; i++) {
      const leader = document.createElement('div');
      leader.className = 'wleader';
      leader.style.display = 'none';
      layer.appendChild(leader);
      this.leaderNodes.push(leader);
    }
    for (let i = 0; i < LABEL_BUDGET_MAX; i++) {
      const node = document.createElement('div');
      node.className = 'wlabel';
      node.style.display = 'none';
      layer.appendChild(node);
      this.labelNodes.push(node);
    }
  }

  // ── Capacity ───────────────────────────────────────────────────────────────

  private growBeingCapacity(n: number): void {
    const cap = capacityFor(n);
    if (this.ids.length >= cap) return;
    this.ids = new Int32Array(cap);
    this.beingPos = new Float32Array(cap * 3);
    this.beingNormal = new Float32Array(cap * 3);
    this.beingTop = new Float32Array(cap);
    this.beingMark = new Float32Array(cap);
    this.beingAct = new Uint8Array(cap);
    this.beingCond = new Uint8Array(cap);
    this.beingStage = new Uint8Array(cap);
    this.beingHeading = new Float32Array(cap);
    this.beingHunger = new Uint8Array(cap);
    this.beingRest = new Uint8Array(cap);
    this.beingGoal = new Uint8Array(cap);
    this.beingPlanAt = new Uint8Array(cap);
    this.beingPlanOf = new Uint8Array(cap);
    this.beingCrowded = new Uint8Array(cap);
    this.beingOnScreen = new Uint8Array(cap);
    this.beingMarkClear = new Uint8Array(cap);
    this.beingPictoClear = new Uint8Array(cap);
    this.beingInside = new Uint8Array(cap);
    this.insideOpen = new Uint8Array(cap);
    this.insideAt = new Float32Array(cap * 3);
    this.beingLean = new Float32Array(cap);
    this.beingPose = new Float32Array(cap);
    this.stageIds = [new Int32Array(cap), new Int32Array(cap), new Int32Array(cap)];
    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = this.ringMeshes[bucket];
      if (!mesh) continue;
      this.ringMeshes[bucket] = regrow(this.scene, mesh, cap);
      this.ringDim[bucket] = World3D.dimLane(this.ringMeshes[bucket]!.geometry, cap);
    }
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.figures[stage];
      if (mesh) this.figures[stage] = regrow(this.scene, mesh, cap);
    }
    if (this.trails) this.trails = regrow(this.scene, this.trails, cap);
    if (this.halos) this.halos = regrow(this.scene, this.halos, cap);
    if (this.dots) {
      this.dots = regrow(this.scene, this.dots, cap);
      this.dotDim = World3D.dimLane(this.dots.geometry, cap);
      this.dots.visible = this.band === 'far';
    }
    if (this.pictos) {
      this.pictos = regrow(this.scene, this.pictos, cap);
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      cell.setUsage(THREE.DynamicDrawUsage);
      this.pictos.geometry.setAttribute('aCell', cell);
      this.pictoCell = cell;
      const rim = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      rim.setUsage(THREE.DynamicDrawUsage);
      this.pictos.geometry.setAttribute('aRim', rim);
      this.pictoRim = rim;
    }
    if (this.flags) this.flags = regrow(this.scene, this.flags, cap);
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const ghost = this.xrays[stage];
      if (ghost) this.xrays[stage] = regrow(this.scene, ghost, cap);
      const edge = this.outlines[stage];
      if (edge) this.outlines[stage] = regrow(this.scene, edge, cap);
    }
    this.linkXrays();
  }

  // ── World lifecycle ────────────────────────────────────────────────────────

  /** Forget the previous world's beings and buildings (a new world was created). */
  resetWorld(): void {
    for (const mesh of this.figures) if (mesh) mesh.count = 0;
    for (const mesh of this.ringMeshes) if (mesh) mesh.count = 0;
    if (this.pictos) this.pictos.count = 0;
    if (this.trails) this.trails.count = 0;
    if (this.dots) this.dots.count = 0;
    if (this.halos) this.halos.count = 0;
    this.figureCount = [0, 0, 0];
    this.ringCount.fill(0);
    this.marksHeld = 0;
    this.specimen(false);
    this.simCount = 0;
    this.instanceCount = 0;
    this.hiddenBeings = 0;
    this.hiddenWildlife = 0;
    this.selectedId = null;
    this.hoveredId = null;
    this.following = false;
    this.tiesOn = false;
    this.ties.visible = false;
    this.selRing.visible = false;
    this.selBeam.visible = false;
    this.names.clear();
    this.speakingUntil.clear();
    // The worker builds a fresh kind codec for every world, so a table carried
    // over from the last one would map wildlife to the wrong species.
    this.animalKinds = [];
    if (this.animalMesh) this.animalMesh.count = 0;
    this.structures.length = 0;
    this.seenStructures.clear();
    for (const mesh of this.structureMeshes.values()) mesh.count = 0;
    this.windows.count = 0;
    this.deathBorn.fill(0);
    this.rippleBorn.fill(0);
    this.deathNext = 0;
    this.rippleNext = 0;
    this.labelPicked = [];
    this.labelShown = [];
    this.clusters = [];
    this.clusterIds = [];
    for (const node of this.labelNodes) node.style.display = 'none';
    for (const node of this.leaderNodes) node.style.display = 'none';
    for (const node of this.hullNodes) node.style.display = 'none';
    for (const node of this.countNodes) node.style.display = 'none';
  }

  /** Build the static resource-node markers (call once per world). */
  setResources(res: ResourcePayload): void {
    for (const mesh of this.resourceMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.resourceMeshes = [];

    const familyByCode = res.kinds.map(familyOf);
    const counts = new Map<Family, number>();
    for (let i = 0; i < res.count; i++) {
      const f = familyByCode[res.kind[i]!];
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const written = new Map<Family, number>();
    const meshes = new Map<Family, THREE.InstancedMesh>();
    for (const [family, n] of counts) {
      const mesh = this.instanced(`resource ${family}`, resourceGeometry(family), new THREE.MeshStandardMaterial({ color: FAMILY_RGB[family], roughness: 0.85, flatShading: true }), n);
      mesh.count = n;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      meshes.set(family, mesh);
      written.set(family, 0);
      this.resourceMeshes.push(mesh);
      this.scene.add(mesh);
    }
    this.dummy.scale.set(1, 1, 1);
    this.dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < res.count; i++) {
      const family = familyByCode[res.kind[i]!];
      if (!family) continue;
      const mesh = meshes.get(family)!;
      const at = written.get(family)!;
      written.set(family, at + 1);
      const x = res.pos[i * 2]!;
      const y = res.pos[i * 2 + 1]!;
      this.dummy.rotation.set(0, hash2(i, i + 3) * Math.PI, 0);
      this.dummy.position.set(x - HALF, this.surfaceAt(x, y) + 0.22, y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
    }
    this.dummy.rotation.set(0, 0, 0);
  }

  // ── The legibility specimen ────────────────────────────────────────────────

  /**
   * Lay out — or clear — a grid of synthetic beings on flat ground in front of
   * the camera, covering every stage, every condition, every act and all eight
   * headings.
   *
   * Dev-only and display-only: it never touches the sim, it is never sent
   * anywhere, and it wears no name, so the only way to find out what one of
   * these is, is to look at it and then ask the probe. The point is not the
   * grid — it is that these beings go through the SAME writeMarkers, the same
   * ring buckets, the same pictogram atlas, the same x-ray pass and the same
   * probes as the real ones. A separate drawing routine would be testing a
   * drawing routine nobody uses.
   *
   * Round four's reviewed run held three unwell beings in two hundred and
   * fifty-one, and every one of them was off-frame or inside a hut. A condition
   * channel scored 100% at one band and 7% at another in the same review, and
   * neither number was about the condition channel. With ninety-six specimens
   * there is no hiding: a quarter of them are unwell, in every act, at every
   * age, facing every way.
   */
  specimen(on: boolean): { ids: number[]; count: number; centre: { x: number; y: number; z: number } } | null {
    if (!on) {
      this.specimenOn = false;
      this.specimenCount = 0;
      this.instanceCount = this.simCount;
      if (this.specimenGround) {
        this.scene.remove(this.specimenGround);
        this.specimenGround.geometry.dispose();
        (this.specimenGround.material as THREE.Material).dispose();
        this.specimenGround = null;
      }
      return null;
    }

    // In front of the camera, on the level. The grid is laid at the HIGHEST
    // ground it covers and given its own floor, because a stranger test of the
    // channels should not also be a test of whether a hillside cut a ring in
    // half — that is what the real settlement frames are for.
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
    const reach = Math.min(
      this.camera.position.distanceTo(this.controls.target),
      Math.max(26, (SPECIMEN_ROWS * SPECIMEN_SPACING) * 1.2),
    );
    const w = (SPECIMEN_COLS - 1) * SPECIMEN_SPACING;
    const h = (SPECIMEN_ROWS - 1) * SPECIMEN_SPACING;
    const edge = Math.max(w, h) * 0.5 + 12;
    const cx = Math.max(-HALF + edge, Math.min(HALF - edge, this.camera.position.x + this.fwd.x * reach));
    const cz = Math.max(-HALF + edge, Math.min(HALF - edge, this.camera.position.z + this.fwd.z * reach));
    this.specimenYaw = Math.atan2(this.fwd.x, this.fwd.z);
    let top = -Infinity;
    for (let r = -1; r <= SPECIMEN_ROWS; r++) {
      for (let c = -1; c <= SPECIMEN_COLS; c++) {
        const p = this.specimenPlaceAt(cx, cz, c, r);
        top = Math.max(top, this.surfaceAt(p.x + HALF, p.z + HALF));
      }
    }
    this.specimenBase.set(cx, top + 0.05, cz);

    if (!this.specimenGround) {
      const geo = new THREE.PlaneGeometry(w + 9, h + 9).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a6b45, roughness: 0.98, metalness: 0 });
      this.specimenGround = new THREE.Mesh(geo, mat);
      this.scene.add(this.specimenGround);
    }
    this.specimenGround.position.copy(this.specimenBase);
    this.specimenGround.rotation.set(0, this.specimenYaw, 0);

    this.specimenOn = true;
    this.appendSpecimen();
    return {
      ids: this.specimenIds(),
      count: this.specimenCount,
      centre: { x: this.specimenBase.x, y: this.specimenBase.y, z: this.specimenBase.z },
    };
  }

  /** Where cell (col, row) stands, in scene units. */
  private specimenPlaceAt(cx: number, cz: number, col: number, row: number): { x: number; z: number } {
    const ox = (col - (SPECIMEN_COLS - 1) / 2) * SPECIMEN_SPACING;
    const oz = (row - (SPECIMEN_ROWS - 1) / 2) * SPECIMEN_SPACING;
    const s = Math.sin(this.specimenYaw);
    const c = Math.cos(this.specimenYaw);
    return { x: cx + ox * c + oz * s, z: cz - ox * s + oz * c };
  }

  /**
   * Write the specimen into the per-being arrays, straight after the world's
   * own beings — from here on it is indistinguishable from them to every line
   * of code that draws, sizes, labels, projects or probes.
   */
  private appendSpecimen(): void {
    if (!this.specimenOn) {
      this.specimenCount = 0;
      this.instanceCount = this.simCount;
      return;
    }
    const plan = specimenPlan();
    this.growBeingCapacity(this.simCount + plan.length);
    const y = this.specimenBase.y;
    for (let n = 0; n < plan.length; n++) {
      const cell = plan[n]!;
      const i = this.simCount + n;
      const at = this.specimenPlaceAt(this.specimenBase.x, this.specimenBase.z, cell.col, cell.row);
      this.ids[i] = SPECIMEN_ID_BASE - n;
      this.beingPos[i * 3] = at.x;
      this.beingPos[i * 3 + 1] = y;
      this.beingPos[i * 3 + 2] = at.z;
      this.beingNormal[i * 3] = 0;
      this.beingNormal[i * 3 + 1] = 1;
      this.beingNormal[i * 3 + 2] = 0;
      this.beingAct[i] = cell.act;
      this.beingCond[i] = cell.cond;
      this.beingStage[i] = cell.stage;
      this.beingHeading[i] = (cell.octant * Math.PI) / 4;
      // The specimen is a display of the vocabulary, not a being with a life:
      // its needs are flat and it has no plan, and the hover card says so
      // rather than inventing numbers to fill its columns.
      this.beingHunger[i] = 0;
      this.beingRest[i] = 0;
      this.beingGoal[i] = GOAL_NONE;
      this.beingPlanAt[i] = 0;
      this.beingPlanOf[i] = 0;
      this.beingCrowded[i] = 0;
      this.beingMarkClear[i] = 1;
    }
    this.specimenCount = plan.length;
    this.instanceCount = this.simCount + plan.length;
  }

  /** The ids of the synthetic beings, in layout order. */
  specimenIds(): number[] {
    const out: number[] = [];
    for (let n = 0; n < this.specimenCount; n++) out.push(SPECIMEN_ID_BASE - n);
    return out;
  }

  // ── Per frame ──────────────────────────────────────────────────────────────

  /**
   * Take one frame from the worker. The arrays are transferred and go straight
   * back, so everything needed later (the ids behind a click) is copied here.
   *
   * This writes DATA and nothing else. What a being looks like is decided in
   * `writeMarkers`, once per rendered frame, because how big a marker is and
   * what it carries are properties of the CAMERA, not of the sim: round two
   * sized markers here, so with the world paused — which is exactly how a
   * stranger test is run — zooming in left every mark frozen at the size it had
   * when the last frame arrived.
   */
  applyFrame(f: FrameMessage): void {
    if (f.animalKinds.length) this.animalKinds = this.animalKinds.concat(f.animalKinds);
    for (const n of f.names) this.names.set(n.id, n.name);
    if (f.structures.length) this.addStructures(f.structures);
    for (const d of f.deaths) this.markDeath(d.x, d.y);
    for (const s of f.speech) this.markSpeech(s.id, s.x, s.y, s.to);
    this.daylight = f.daylight;

    this.growBeingCapacity(f.beings + this.specimenCount);
    for (let i = 0; i < f.beings; i++) {
      const x = f.arrays.pos[i * 2]!;
      const y = f.arrays.pos[i * 2 + 1]!;
      const sx = x - HALF;
      const sz = y - HALF;
      const surface = this.surfaceAt(x, y);
      this.ids[i] = f.arrays.ids[i]!;
      this.beingPos[i * 3] = sx;
      this.beingPos[i * 3 + 1] = surface;
      this.beingPos[i * 3 + 2] = sz;
      // The ground's normal only changes when the being moves, so it is taken
      // here rather than four height lookups per being per rendered frame.
      this.surfaceNormal(x, y, this.up);
      this.beingNormal[i * 3] = this.up.x;
      this.beingNormal[i * 3 + 1] = this.up.y;
      this.beingNormal[i * 3 + 2] = this.up.z;
      this.beingAct[i] = f.arrays.act[i]!;
      this.beingCond[i] = f.arrays.cond[i]!;
      this.beingStage[i] = f.arrays.stage[i]!;
      this.beingHeading[i] = f.arrays.heading[i]!;
      this.beingHunger[i] = f.arrays.hunger[i]!;
      this.beingRest[i] = f.arrays.rest[i]!;
      this.beingGoal[i] = f.arrays.goal[i]!;
      this.beingPlanAt[i] = f.arrays.planAt[i]!;
      this.beingPlanOf[i] = f.arrays.planOf[i]!;
      this.beingCrowded[i] = 0;
      this.beingMarkClear[i] = 1;
    }
    this.simCount = f.beings;
    this.instanceCount = f.beings;
    // The specimen, if one is laid out, lives straight after the world's own
    // beings and goes through everything they go through.
    this.appendSpecimen();

    this.hiddenBeings = Math.max(0, f.beingsAlive - f.beings);
    this.hiddenWildlife = Math.max(0, f.wildlifeTotal - f.wildlife);

    const animals = this.ensureAnimalCapacity(f.wildlife);
    this.dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < f.wildlife; i++) {
      const code = f.arrays.wildKind[i]!;
      const name = code === KIND_UNKNOWN ? undefined : this.animalKinds[code];
      const sz = (name === undefined ? undefined : ANIMAL_SIZE[name]) ?? 1;
      const rgb = (name === undefined ? undefined : ANIMAL_RGB[name]) ?? DEFAULT_ANIMAL_RGB;
      const x = f.arrays.wildPos[i * 2]!;
      const y = f.arrays.wildPos[i * 2 + 1]!;
      this.dummy.scale.set(sz, sz, sz);
      this.dummy.position.set(x - HALF, this.surfaceAt(x, y) + 0.55 * sz, y - HALF);
      this.dummy.updateMatrix();
      animals.setMatrixAt(i, this.dummy.matrix);
      animals.setColorAt(i, rgb);
    }
    animals.count = f.wildlife;
    animals.instanceMatrix.needsUpdate = true;
    if (animals.instanceColor) animals.instanceColor.needsUpdate = true;
    this.dummy.scale.set(1, 1, 1);
  }

  /**
   * How big the MAP's marks are here, in metres — the ring, the pointer, the
   * streak, the chip.
   *
   * One rule, per being, from that being's own distance: the ring holds a fixed
   * size on screen while the camera is far enough that a person is not yet a
   * picture, and settles onto the ground a person actually stands on once it
   * is. Nothing about the being's own SIZE is in here. The being is 1.75 m.
   */
  private annotationAt(x: number, y: number, z: number): number {
    const dx = x - this.camera.position.x;
    const dy = y - this.camera.position.y;
    const dz = z - this.camera.position.z;
    return annotationRadius(Math.sqrt(dx * dx + dy * dy + dz * dz), this.worldPerPx);
  }

  /**
   * Pick the band for where the camera is standing, and size the map over the
   * world for it. Cheap: one distance per being.
   */
  private sizeMarkers(): void {
    // The orbit's far stop, re-derived from the projection being drawn with
    // RIGHT NOW. It used to be set on resize, which is one frame's worth of
    // truth about a number that has to hold for every frame after it: a
    // reviewer wheeled 120 notches into a stop sized for a canvas that was no
    // longer there and came to rest at 0.620 px — the FAR edge itself — with
    // the band still reading DEFAULT. Two lines a frame, and the widest
    // contract this view has is reachable by mouse on any window.
    this.controls.maxDistance = maxOrbitDistance(this.worldPerPx, WORLD * 1.35);
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.bandPx = figurePxAt(distance, this.worldPerPx);
    this.band = bandForPixels(this.bandPx, this.band);
    this.annotPx = annotationRadius(distance, this.worldPerPx) / (distance * this.worldPerPx);
    const fade = annotationOpacity(this.band);
    if (this.ringFade.value !== fade) {
      this.ringFade.value = fade;
      this.trailFade.value = fade * 0.85;
      this.pictoFade.value = fade;
      const mat = this.pictos?.material as THREE.ShaderMaterial | undefined;
      if (mat) mat.uniforms['uOpacity']!.value = fade;
    }
    // The weld is a per-instance term now (`aRim`), so the band's chip scale is
    // just a scale: nothing has to be re-derived when it changes.
    this.pictoScale = this.band === 'near' ? PICTO_NEAR_SCALE : 1;
    for (let i = 0; i < this.instanceCount; i++) {
      const annot = this.annotationAt(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]!, this.beingPos[i * 3 + 2]!);
      this.beingMark[i] = annot / RING_R;
      this.beingTop[i] = this.beingPos[i * 3 + 1]! + stageForm(this.beingStage[i]!).scale;
    }
  }

  /**
   * Which beings are standing clear enough of their neighbours to be allowed a
   * mark of their own — the fifth promise of item L4, and the one that makes
   * the other four necessary.
   *
   * Five rounds of work went into drawing a pictogram and a heading arrow a
   * stranger could read. On the legibility specimen — where every being stands
   * alone on flat ground — they worked. In a real settlement they did not: the
   * final score was activity 38%, and the engineer's own note on nearly every
   * miss was that the reader had found a mark and attached it to the body next
   * to the one it belonged to. That is not a mark that needs to be louder. It
   * is a claim the picture is not entitled to make, because at that density
   * the picture cannot say whose it is.
   *
   * So it is withheld. Two beings whose marks would touch on screen BOTH lose
   * their pictogram and their arrow; an isolated being keeps both. What is
   * lost is answered by hovering, by the roster, and by a filter — by asking,
   * which is how every serious instrument answers a question about one
   * element out of three hundred.
   */
  private planMarks(): void {
    this.beingMarkClear.fill(1, 0, this.instanceCount);
    this.beingPictoClear.fill(1, 0, this.instanceCount);
    this.marksHeld = 0;
    if (this.screenPoints.length < 2) return;
    const points: MarkPoint[] = [];
    const index: number[] = [];
    const slots: number[] = [];
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      // A being a crowd chip has already counted draws nothing at all, so it
      // cannot have a mark misattributed to it and must not suppress its
      // neighbours' either. Nor can a being whose mark its building is
      // carrying — and it must not be counted among the marks "too close to
      // mark", which is a statement about marks that were drawn.
      if (this.isCollapsed(i) || this.beingInside[i] === 1) continue;
      const p = this.screenPoints[k]!;
      points.push({ x: p.x, y: p.y, r: this.markRadiusOf(i) });
      index.push(i);
      slots.push(k);
    }
    const clear = suppressOverlaps(points);
    for (let n = 0; n < index.length; n++) {
      if (clear[n]) continue;
      this.beingMarkClear[index[n]!] = 0;
      this.marksHeld++;
    }
    this.planBadges(index, slots);
  }

  /**
   * And the same rule again, one layer out: which badges stand clear of each
   * other.
   *
   * The ring test is not enough for the disc welded outside it. A badge is
   * pushed past the rim and is drawn at up to four tenths of its being's own
   * height, so two beings a comfortable ring apart can still put their discs in
   * a column — which is exactly what a reviewer found, four of them stacked
   * over three bodies with the leaders crossing. Same rule, same reasoning:
   * both sides of a collision are dropped, because a badge that might be the
   * neighbour's is a confident wrong answer.
   */
  private planBadges(index: readonly number[], slots: readonly number[]): void {
    if (!bandShowsDetail(this.band)) return;
    const discs: MarkPoint[] = [];
    const who: number[] = [];
    for (let n = 0; n < index.length; n++) {
      const i = index[n]!;
      if (this.beingMarkClear[i] === 0 || !this.badgeDrawn(i)) continue;
      const at = this.badgeDiscOf(i, slots[n]!);
      if (!at) continue;
      discs.push(at);
      who.push(i);
    }
    const clear = suppressOverlaps(discs);
    for (let n = 0; n < who.length; n++) if (!clear[n]) this.beingPictoClear[who[n]!] = 0;
  }

  /** Whether this being's act HAS a badge, and whether it is drawn big enough to be one. */
  private badgeDrawn(i: number): boolean {
    return pictogramFor(this.beingAct[i]!) !== PICTO_NONE && this.bodyPixelsOf(i) >= PICTO_MIN_BODY_PX;
  }

  /** How big this being's badge is drawn, in metres — capped against its own figure. */
  private badgeSizeOf(i: number): number {
    return badgeMetres(this.beingMark[i]!, PICTO_H * this.pictoScale, stageForm(this.beingStage[i]!).scale);
  }

  /**
   * Where that badge lands on screen and how far it reaches — the same geometry
   * the shader builds it from: out along both axes to the ring's rim, then the
   * quad's own half-size past the stub in its lower-left corner.
   */
  private badgeDiscOf(i: number, k: number): MarkPoint | null {
    const p = this.screenPoints[k];
    if (!p) return null;
    const scale = this.distanceTo(i) * this.worldPerPx;
    if (scale <= 0) return null;
    const s = this.badgeSizeOf(i);
    const off = (PICTO_RIM * this.beingMark[i]! + s * (0.5 - PICTO_STUB_AT[0])) / scale;
    return { x: p.x + off, y: p.y - off, r: (s * 0.5) / scale };
  }

  /**
   * How far out from a being's centre its per-being marks reach, in CSS pixels.
   *
   * The ring's outer edge, widened by `MARK_CLEARANCE` — because the pictogram
   * sits ON the rim and the arrow runs out past it, so two rings that merely
   * come close already have marks in each other's territory. Measured from the
   * ring rather than the body: these marks are welded to the ring, and a body
   * two hundred pixels tall in the street is not two hundred pixels wide.
   */
  private markRadiusOf(i: number): number {
    const d = this.distanceTo(i);
    if (d <= 0) return 0;
    const markPx = this.beingMark[i]! / (d * this.worldPerPx);
    if (!bandShowsBodies(this.band)) return markPx * DOT_R * 1.44 * MARK_CLEARANCE;
    return markPx * RING_OUTER * RING_R * stageFootprint(this.beingStage[i]!, this.band) * MARK_CLEARANCE;
  }

  /**
   * Draw every being the way the current band promises, and no other way.
   *
   * FAR is a dot for anyone not inside a crowd that carries its own number —
   * the contract there is how many and where. DEFAULT adds the figure and the
   * ground ring, and the ring alone carries condition, so nothing a reader
   * needs is floating loose above a neighbour. MID and NEAR add the age forms,
   * the streak behind whoever is moving, and one pictogram welded to its own
   * ring.
   */
  private writeMarkers(t: number): void {
    const bodies = bandShowsBodies(this.band);
    const detail = bandShowsDetail(this.band);
    const collapses = bandCountsBeings(this.band);
    const pictos = this.pictos!;
    const cells = this.pictoCell!;
    const rims = this.pictoRim!;
    const trails = this.trails!;
    const dots = this.dots!;
    const halos = this.halos!;
    const dotDim = this.dotDim;
    const flags = this.flags!;
    const filtering = this.highlight !== null;
    this.figureCount = [0, 0, 0];
    this.ringCount.fill(0);
    let pictoAt = 0;
    let trailAt = 0;
    let dotAt = 0;
    let haloAt = 0;
    let flagAt = 0;
    this.pinsDrawn = 0;

    for (let i = 0; i < this.instanceCount; i++) {
      const id = this.ids[i]!;
      const act = this.beingAct[i]!;
      const cond = this.beingCond[i]!;
      const stage = this.beingStage[i]!;
      const heading = this.beingHeading[i]!;
      const sx = this.beingPos[i * 3]!;
      const surface = this.beingPos[i * 3 + 1]!;
      const sz = this.beingPos[i * 3 + 2]!;
      const mark = this.beingMark[i]!;
      this.beingLean[i] = 0;
      // `mark` is the MAP's unit here, not a size for the being: everything
      // drawn on the ground is measured in it, and the being itself is
      // measured in metres and never in this.
      const deco = mark;
      // While relationships are being shown, kin and bonds wear the tie colour
      // on the RING only. Painting the body too would mean a bonded being that
      // is sick or starving stops saying so — the encoding that matters most
      // must not be overwritten by a temporary overlay.
      const hue = conditionHue(cond, act);
      const ringHue = this.kinSet.has(id) ? KIN_COLOR : this.bondSet.has(id) ? BOND_COLOR : hue;

      // The mark lies flush on the ground that is actually DRAWN, so a hillside
      // never cuts a ring in half.
      this.up.set(this.beingNormal[i * 3]!, this.beingNormal[i * 3 + 1]!, this.beingNormal[i * 3 + 2]!);
      this.fwd.set(Math.sin(heading), 0, Math.cos(heading));
      this.fwd.addScaledVector(this.up, -this.up.dot(this.fwd)).normalize();
      this.right.crossVectors(this.up, this.fwd);

      // A being the chip over its head has already counted draws NOTHING —
      // not a pin, not a dot, not a body. Round three drew the pins anyway and
      // asked the reader to add a number to the marks printed underneath it,
      // which is the one arithmetic this view must never invite, and a stranger
      // duly came out 11.6% low over the frame and 12.9% high in a quadrant.
      // `pinsDrawn + Σ chips = beings in frame`, exactly, or the count is a
      // guess with a legend next to it.
      if (collapses && this.beingCrowded[i] === 1 && id !== this.selectedId) continue;
      if (this.beingOnScreen[i] === 1) this.pinsDrawn++;

      // Does this being answer the question the filter bar is asking? A match
      // keeps everything; everyone else keeps their mark at a fraction of its
      // strength, so the frame still contains — and `countAudit` still counts —
      // the whole population.
      const match = !filtering || this.highlight!.has(id);
      const dim = match ? 1 : DIM;

      // The halo: the "found" channel, and the only thing a filter ADDS to the
      // picture. Drawn wherever the being drew a mark of its own, in every
      // band, so a search at FAR is as findable as one in the street.
      if (filtering && match && this.beingOnScreen[i] === 1) {
        const hr = deco * RING_R * (bodies ? stageFootprint(stage, this.band) : DOT_R * 2.4);
        this.basis.makeBasis(this.right, this.up, this.fwd);
        this.basis.scale(this.dummy.scale.setScalar(hr));
        this.basis.setPosition(sx + this.up.x * hr * 0.06, surface + this.up.y * hr * 0.06, sz + this.up.z * hr * 0.06);
        halos.setMatrixAt(haloAt, this.basis);
        haloAt++;
      }

      if (!bodies) {
        const rd = deco * DOT_R;
        this.basis.makeBasis(this.right, this.up, this.fwd);
        this.basis.scale(this.dummy.scale.setScalar(rd));
        this.basis.setPosition(sx + this.up.x * rd * 0.2, surface + this.up.y * rd * 0.2, sz + this.up.z * rd * 0.2);
        dots.setMatrixAt(dotAt, this.basis);
        dots.setColorAt(dotAt, this.color.setHex(ringHue));
        if (dotDim) dotDim.setX(dotAt, dim);
        dotAt++;
        continue;
      }

      // Whether this mark is allowed to claim a FACING. In a crowd it is not:
      // the arrow is dropped from the geometry rather than drawn where a reader
      // would have to guess whose it is.
      const clear = this.beingMarkClear[i] === 1;
      // Indoors.
      //
      // The building draws them now: an occupied shelter is SOLID, its
      // occupants are behind its walls, and the chip on its roof carries the
      // count, the condition mix, the unwell notch and every one of their
      // names. Four rounds of shading, x-ray and interior light could not make
      // thirty-four coincident bodies separable, because they are coincident.
      // See the ruling on `planInside`.
      //
      // The room the reader's own subject is standing in is the exception, and
      // it OPENS: the walls ghost for the selected being (which is a subject,
      // so `updateSubjects` already clears them), that being is drawn normally,
      // and everybody else in the room is a dim flat silhouette — present, so
      // the room reads as occupied, and never bright enough to blow out.
      const inside = this.beingInside[i] === 1;
      if (inside && this.insideOpen[i] !== 1) continue;
      if (!inside) {
        const bucket = ringBucket(ringStyleFor(cond, act), stageCore(stage, this.band), clear);
        const ringMesh = this.ringMeshes[bucket]!;
        const ringAt = this.ringCount[bucket]!;
        this.ringCount[bucket] = ringAt + 1;
        const r = deco * RING_R * stageFootprint(stage, this.band);
        this.basis.makeBasis(this.right, this.up, this.fwd);
        this.basis.scale(this.dummy.scale.setScalar(r));
        this.basis.setPosition(sx + this.up.x * r * 0.09, surface + this.up.y * r * 0.09, sz + this.up.z * r * 0.09);
        ringMesh.setMatrixAt(ringAt, this.basis);
        ringMesh.setColorAt(ringAt, this.color.setHex(ringHue));
        this.ringDim[bucket]?.setX(ringAt, dim);

        if (detail && movingFor(act)) {
          trails.setMatrixAt(trailAt, this.basis);
          trails.setColorAt(trailAt, this.color.setHex(ringHue).multiplyScalar(dim));
          trailAt++;
        }
      }

      // Bodies move, and the movement is a second reading of the act: walking
      // bobs, working swings, eating and drinking crouch, sleeping lies down,
      // danger leans and shakes.
      const form = stageForm(stage);
      // Life-size. A grown being is 1.75 m whether the camera is in the street
      // or over the sea, and nothing in this view may make it anything else.
      const height = form.scale;
      const mesh = this.figures[stage]!;
      const at = this.figureCount[stage]!;
      this.figureCount[stage] = at + 1;
      this.stageIds[stage]![at] = id;
      const phase = t * 6 + id * 0.7;
      const pose = figurePose(act, form.stoop, height, phase);
      // The pitch as DRAWN, and the widest pitch this act can reach. The picker
      // reads the second one and never the first: a box that breathes is a box
      // whose answer changes between a reader looking and a reader pressing.
      this.beingLean[i] = pose.lean;
      this.beingPose[i] = poseLean(act, form.stoop);
      // Inside an OPEN room, the body is drawn where the floor plan allows and
      // not where the sim happens to have put it — see `clampIntoRoom`.
      const bx = inside ? this.insideAt[i * 3]! : sx;
      const bz = inside ? this.insideAt[i * 3 + 2]! : sz;
      this.dummy.position.set(bx, surface + pose.bob, bz);
      this.dummy.rotation.set(pose.lean, heading, pose.roll);
      this.dummy.scale.setScalar(height);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      // The body carries the condition colour pulled toward bone, so it is a
      // pale figure by day and still a pale figure at night; the ring beside it
      // carries the colour at full strength. Pushed well past its own value: a
      // lit body next to an unlit ring reads as a grey pin inside a white hoop
      // unless it is lifted to meet it.
      //
      // Except in an open room, where the only body that is the subject is the
      // SELECTED one — and it is not `inside`, so it takes the ordinary lift.
      // The others are the room's furniture: drawn flat and dark so the space
      // reads as occupied without competing with the person you came to watch,
      // and low enough that they cannot blow out to white however many of them
      // share a pixel. That last property is the whole point; a lift of 1.32
      // over thirty-four overlapping figures is how the white cloud was made.
      const lift = inside ? INSIDE_BODY_VALUE : 1.45;
      mesh.setColorAt(at, this.color.setHex(bodyTint(hue)).multiplyScalar(match ? lift : lift * DIM_BODY));

      // The unwell flag. Drawn wherever this being is drawn at all — inside a
      // shelter included, because "who in here is ill" is the question a chip's
      // number cannot answer — and for nobody who is well. See `flagMaterial`.
      if (flagAt < flags.instanceMatrix.count && conditionWord(cond, act) !== 'well') {
        // Scaled to the PERSON carrying it, with a floor in screen pixels.
        //
        // `flagGeometry` reaches 1.085 above its anchor and the anchor sits a
        // fifth of the size above the head, so the mark's whole height is
        // 1.305 × `size`. Round six set `size` from `height × 0.52`, which is
        // 0.68 of a figure, and a reviewer measured a 115 px flag over a 100 px
        // adult on the specimen grid. `PENNANT_OF_FIGURE` is the cap this
        // obeys now, and the 13 px floor still wins out where a being is two
        // pixels tall — which is the case the pennant exists for.
        const size = pennantSize(height, this.worldPerPx * this.distanceTo(i));
        this.dummy.position.set(sx, this.beingTop[i]! + size * 0.22, sz);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(size);
        this.dummy.updateMatrix();
        flags.setMatrixAt(flagAt, this.dummy.matrix);
        flags.setColorAt(flagAt, this.color.setHex(hue).multiplyScalar(match ? 1 : DIM));
        flagAt++;
      }

      if (!detail || inside) continue;
      // In a crowd, no pictogram either — and for the same reason as the
      // arrow. Round five's activity score was 38% and nearly every miss was a
      // chip read off the wrong body. The roster and the hover card answer
      // "what is this one doing" now; the picture only claims it where the
      // claim cannot be misattributed.
      if (!clear) continue;
      // Exactly what this being is doing NOW, and nothing it was doing a
      // second ago. Round two let a recent utterance keep the speech badge
      // alive for a second and a half, so a reader called a walking being
      // "speaking" and a probe that said "walking" marked it wrong. The
      // ripple on the ground is what remembers an utterance; the chip is the
      // present tense.
      const picto = pictogramFor(act);
      if (picto === PICTO_NONE) continue;
      // Withheld for the same reason the arrow is, one layer further out: a
      // badge in a stack belongs to whichever body the reader picks. And not
      // drawn at all under a being too small for the band to claim detail
      // about — `visibilityOf` already says nothing is readable there.
      if (this.beingPictoClear[i] === 0 || !this.badgeDrawn(i)) continue;
      this.dummy.position.set(sx, surface + deco * 0.10, sz);
      this.dummy.rotation.set(0, 0, 0);
      // Capped against this being's own figure, so an annotation can never be
      // the largest thing in the picture of a person; the stub still finds the
      // rim, which is `aRim`'s whole job.
      this.dummy.scale.setScalar(this.badgeSizeOf(i));
      this.dummy.updateMatrix();
      pictos.setMatrixAt(pictoAt, this.dummy.matrix);
      rims.array[pictoAt] = deco;
      // Bone, for every condition and every band. Condition already has a
      // shape, a lightness and a body tint; a chip that also carried a hue
      // would be a second, weaker answer to a question already answered. The
      // one exception is volume: at 2400× nearly everyone is talking, so the
      // speech chip is drawn quieter than the rest.
      cells.array[pictoAt] = picto;
      pictos.setColorAt(
        pictoAt,
        this.color.setHex(HUE_WELL).multiplyScalar((picto === PICTO_SPEAK ? 0.74 : 1) * (match ? 1 : DIM)),
      );
      pictoAt++;
    }

    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = this.ringMeshes[bucket]!;
      mesh.count = bodies ? this.ringCount[bucket]! : 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const lane = this.ringDim[bucket];
      if (lane) lane.needsUpdate = true;
      mesh.boundingSphere = null;
    }
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.figures[stage]!;
      mesh.count = bodies ? this.figureCount[stage]! : 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Every instance moved, so the cached sphere `InstancedMesh.raycast` culls
      // against is stale — and three only ever computes it when it is null.
      mesh.boundingSphere = null;
      // The x-ray draws the same instances, only where they are hidden. Out
      // wide there is nothing to x-ray: a pin already carries the being, and it
      // is drawn over everything.
      const ghost = this.xrays[stage];
      if (ghost) {
        ghost.visible = detail;
        ghost.count = detail ? mesh.count : 0;
        ghost.boundingSphere = null;
      }
      // The keyline rides the same instances wherever a body is drawn at all —
      // a crowd at DEFAULT needs separating quite as much as one in the street.
      const edge = this.outlines[stage];
      if (edge) {
        edge.visible = bodies;
        edge.count = mesh.count;
        edge.boundingSphere = null;
      }
    }
    flags.count = flagAt;
    flags.visible = flagAt > 0;
    flags.instanceMatrix.needsUpdate = true;
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    dots.visible = !bodies;
    dots.count = dotAt;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    if (dotDim) dotDim.needsUpdate = true;
    halos.count = haloAt;
    halos.visible = haloAt > 0;
    halos.instanceMatrix.needsUpdate = true;
    halos.boundingSphere = null;
    trails.count = trailAt;
    trails.instanceMatrix.needsUpdate = true;
    if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    pictos.count = pictoAt;
    pictos.instanceMatrix.needsUpdate = true;
    if (pictos.instanceColor) pictos.instanceColor.needsUpdate = true;
    cells.needsUpdate = true;
    rims.needsUpdate = true;
    this.dummy.scale.setScalar(1);
  }

  /**
   * Who the scenery has to get out of the way for, this frame.
   *
   * Every being big enough to be read, in view space, packed into at most
   * `SUBJECT_SLOTS` spheres and handed to every scenery material. That list is
   * the literal subject of the promise "a being is never invisible because of
   * scenery": a trunk is ghosted if and only if it is nearer to the eye than
   * one of these and covers it on screen.
   *
   * Out wide the list is empty and nothing ghosts — a pin is already drawn over
   * the world there, and dissolving a forest to show a map pin would be
   * vandalism for no gain.
   */
  private updateSubjects(): void {
    // Everything below reads view space, so the camera's own matrices have to
    // be this frame's — the renderer would not refresh them until after.
    this.camera.updateMatrixWorld();
    const want = bandShowsDetail(this.band);
    this.subjectSeen.length = 0;
    if (want) {
      for (let k = 0; k < this.screenPoints.length; k++) {
        const i = this.screenIndex[k]!;
        // The same size rule the probes answer by. A frame with a hundred
        // ten-pixel beings scattered across a valley would otherwise ghost
        // every tree in it, and the picture goes to fog for nobody's benefit.
        if (this.bodyPixelsOf(i) < DETAIL_MIN_PX) continue;
        // Somebody indoors is not a subject anything has to step aside for —
        // they are indoors, which is a place the picture is now allowed to put
        // people. It is this one line that makes an occupied hut SOLID: its
        // own occupants were what asked it to dissolve. See `planInside`.
        if (this.beingInside[i] === 1) continue;
        // The middle of the figure, not its feet: a wall that hides a being
        // from the knees up is hiding the being.
        const mid = this.beingPos[i * 3 + 1]! + (this.beingTop[i]! - this.beingPos[i * 3 + 1]!) * 0.55;
        this.probe.set(this.beingPos[i * 3]!, mid, this.beingPos[i * 3 + 2]!).applyMatrix4(this.camera.matrixWorldInverse);
        const slot = this.subjectPool[this.subjectSeen.length] ?? { x: 0, y: 0, z: 0, r: SUBJECT_R };
        this.subjectPool[this.subjectSeen.length] = slot;
        slot.x = this.probe.x;
        slot.y = this.probe.y;
        slot.z = this.probe.z;
        slot.r = SUBJECT_R;
        this.subjectSeen.push(slot);
      }
      // Nearest first: what is close is what is being read, and the pack grows
      // whatever it cannot give a slot of its own into the sphere next door.
      this.subjectSeen.sort((a, b) => b.z - a.z);
    }
    this.subjectCount = want ? packSubjects(this.subjectSeen, this.subjects) : 0;
    for (const u of this.foliageFades) u.uSubjectN.value = this.subjectCount;
  }

  /**
   * The outline a ghosted building leaves on the ground.
   *
   * The same arithmetic the shader does, on the few hundred structures rather
   * than the six thousand trees — a hut that is dissolving has to leave a plan
   * of itself behind or the settlement stops being one. Trees get none: a
   * forest floor stencilled with six thousand circles is not a forest floor.
   */
  private updateFootprints(): void {
    const mesh = this.footprints;
    if (!mesh) return;
    const shelters = this.structures.length;
    if (!bandShowsDetail(this.band) || this.subjectCount === 0 || shelters === 0) {
      mesh.visible = false;
      mesh.count = 0;
      return;
    }
    let out = mesh;
    if (out.instanceMatrix.count < shelters) {
      out = regrow(this.scene, out, capacityFor(shelters));
      this.footprints = out;
    }
    const inv = this.camera.matrixWorldInverse;
    let at = 0;
    for (let s = 0; s < shelters; s++) {
      if (this.structures[s]!.kind !== 'shelter') continue;
      const x = this.structureAt[s * 3]!;
      const y = this.structureAt[s * 3 + 1]!;
      const z = this.structureAt[s * 3 + 2]!;
      const g = this.ghostAmountAt(x, y + 2.2, z, 3.1, 2.3, inv);
      if (g < 0.25) continue;
      const r = (SHELTER_FOOTPRINT / 2) * (0.86 + g * 0.14);
      this.dummy.position.set(x, y + 0.06, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(r);
      this.dummy.updateMatrix();
      out.setMatrixAt(at, this.dummy.matrix);
      at++;
    }
    this.dummy.scale.setScalar(1);
    out.count = at;
    out.visible = at > 0;
    out.instanceMatrix.needsUpdate = true;
  }

  /**
   * How much a thing standing here is in somebody's way — the shader's own
   * test, in TypeScript, so the footprint outlines and the probes agree with
   * the picture instead of guessing at it.
   */
  private ghostAmountAt(x: number, y: number, z: number, rx: number, ry: number, inv: THREE.Matrix4): number {
    this.probe.set(x, y, z).applyMatrix4(inv);
    const depth = -this.probe.z;
    if (depth <= 0.05) return 0;
    const ox = this.probe.x / depth;
    const oy = this.probe.y / depth;
    let block = 0;
    for (let k = 0; k < this.subjectCount; k++) {
      const sd = -this.subjects[k * 4 + 2]!;
      if (sd <= 0.05 || depth - Math.max(rx, ry) >= sd - 0.2) continue;
      const sx = this.subjects[k * 4]! / sd;
      const sy = this.subjects[k * 4 + 1]! / sd;
      const r = this.subjects[k * 4 + 3]! / sd;
      const d = Math.hypot((ox - sx) / (rx / depth + r), (oy - sy) / (ry / depth + r));
      const t = d <= 0.62 ? 0 : d >= 1.02 ? 1 : (d - 0.62) / 0.4;
      block = Math.max(block, 1 - t * t * (3 - 2 * t));
      if (block >= 0.999) break;
    }
    return block;
  }

  private ensureAnimalCapacity(n: number): THREE.InstancedMesh {
    const existing = this.animalMesh;
    if (existing && existing.instanceMatrix.count >= n) return existing;
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
    }
    // A deer is about 1.7 m nose to tail and a metre at the shoulder, and the
    // per-kind multipliers move it from a hare to a bear from there.
    const body = mergeGeometries([
      new THREE.BoxGeometry(0.62, 0.72, 1.55),
      new THREE.BoxGeometry(0.4, 0.4, 0.5).translate(0, 0.3, 0.9),
    ], false) ?? new THREE.BoxGeometry(0.62, 0.72, 1.55);
    const mesh = this.instanced('wildlife', body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), capacityFor(n));
    this.scene.add(mesh);
    this.animalMesh = mesh;
    return mesh;
  }

  // ── Structures ─────────────────────────────────────────────────────────────

  private addStructures(list: StructureUpdate[]): void {
    let added = false;
    for (const s of list) {
      if (this.seenStructures.has(s.id)) continue;
      this.seenStructures.add(s.id);
      this.structures.push(s);
      added = true;
    }
    if (added) this.rebuildStructures();
  }

  /**
   * Everything they build, in three instanced meshes plus the lit windows.
   * A group per hut was a draw call per hut, and by the second week of a run
   * that is a thousand of them.
   */
  private rebuildStructures(): void {
    const byKind = new Map<string, number>();
    for (const s of this.structures) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    for (const [kind, n] of byKind) {
      const existing = this.structureMeshes.get(kind);
      if (!existing || existing.instanceMatrix.count < n) {
        if (existing) {
          this.scene.remove(existing);
          existing.geometry.dispose();
        }
        // A shelter somebody is standing in, or behind, is as much of a wall as
        // a tree is, and it clears on the same rule — at exactly the size it
        // has always been, with its footprint left drawn on the ground. Two
        // fifths rather than a fifth, and its edges kept (`uRim`), because a
        // building that ghosts to a featureless pane stops reading as a
        // building — see the rim term in `applyGhostFade`.
        const material = structureMaterial(kind);
        applyGhostFade(material, this.foliageFades, this.subjects, 3.5, 11, 0.25, 0.38, 3.1, 2.3, 2.2, 0.45);
        const mesh = this.instanced(`structures ${kind}`, structureGeometry(kind), material, capacityFor(n));
        // After the bodies, not before them — see RENDER_STRUCTURE. This one
        // line is the difference between a crowded shelter that reads as people
        // and one that reads as a rendering fault.
        mesh.renderOrder = RENDER_STRUCTURE;
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        this.structureMeshes.set(kind, mesh);
        this.scene.add(mesh);
      }
    }
    const shelters = byKind.get('shelter') ?? 0;
    if (this.windows.instanceMatrix.count < shelters) {
      const mat = this.windows.material as THREE.Material;
      this.scene.remove(this.windows);
      this.windows.geometry.dispose();
      const grown = this.instanced('lit windows', new THREE.PlaneGeometry(1.15, 0.95), mat, capacityFor(shelters));
      grown.renderOrder = RENDER_WINDOW;
      grown.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      this.scene.add(grown);
      this.windows = grown;
    }
    if (this.windowPool.instanceMatrix.count < shelters) {
      const mat = this.windowPool.material as THREE.Material;
      this.scene.remove(this.windowPool);
      this.windowPool.geometry.dispose();
      const grown = this.instanced(
        'window light pools',
        new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
        mat,
        capacityFor(shelters),
      );
      grown.renderOrder = RENDER_WINDOW - 1;
      this.scene.add(grown);
      this.windowPool = grown;
    }
    if (this.poolAt.length < capacityFor(shelters) * 3) this.poolAt = new Float32Array(capacityFor(shelters) * 3);

    if (this.structureAt.length < this.structures.length * 3) {
      this.structureAt = new Float32Array(capacityFor(this.structures.length) * 3);
    }
    const written = new Map<string, number>();
    let windowAt = 0;
    this.dummy.scale.set(1, 1, 1);
    for (let s = 0; s < this.structures.length; s++) {
      const st = this.structures[s]!;
      const mesh = this.structureMeshes.get(st.kind)!;
      const at = written.get(st.kind) ?? 0;
      written.set(st.kind, at + 1);
      const base = this.surfaceAt(st.x, st.y);
      // Kept so the ghost rule and the footprint outline can find the building
      // without walking three instanced meshes to work out where it stands.
      this.structureAt[s * 3] = st.x - HALF;
      this.structureAt[s * 3 + 1] = base;
      this.structureAt[s * 3 + 2] = st.y - HALF;
      // Turned by who built it, so a settlement has the slight disorder of
      // something raised by hand rather than a grid stamped on the ground.
      const yaw = hash2(st.id, st.builtBy) * Math.PI * 2;
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.position.set(st.x - HALF, base, st.y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      if (st.kind === 'shelter') {
        // On a SIDE wall: the front one is where the doorway is now, and a
        // lit pane hanging in the middle of a doorway is a bug with a glow.
        this.dummy.rotation.set(0, yaw + Math.PI / 2, 0);
        const wx = st.x - HALF + Math.cos(yaw) * (SHELTER.room / 2 + 0.06);
        const wz = st.y - HALF - Math.sin(yaw) * (SHELTER.room / 2 + 0.06);
        this.dummy.position.set(wx, base + 1.35, wz);
        this.dummy.updateMatrix();
        this.windows.setMatrixAt(windowAt, this.dummy.matrix);
        // The pool stands a little further out than the pane, on the ground —
        // light falls away from a window, not straight down through the wall.
        this.poolAt[windowAt * 3] = wx + Math.cos(yaw) * 0.5;
        this.poolAt[windowAt * 3 + 1] = base + 0.07;
        this.poolAt[windowAt * 3 + 2] = wz - Math.sin(yaw) * 0.5;
        windowAt++;
      }
    }
    for (const [kind, mesh] of this.structureMeshes) {
      mesh.count = written.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.windows.count = windowAt;
    this.windows.instanceMatrix.needsUpdate = true;
    this.poolCount = windowAt;
    this.dummy.rotation.set(0, 0, 0);
  }

  /**
   * Hold each light pool at a readable size on screen.
   *
   * 2.4 m of lit grass is the truth of it at NEAR and a third of a pixel at
   * DEFAULT, and a settlement after dark that draws nothing at DEFAULT is a
   * settlement a reader cannot tell from empty ground. So the pool takes the
   * same treatment the pins take: a floor in SCREEN pixels. It is the only
   * thing in this view that grows in metres to stay the same size, and it is
   * allowed to because it is a MAP mark for "somebody is home", exactly like
   * the ring a being gets when it is too small to be a picture.
   */
  private updatePools(night: number): void {
    const mesh = this.windowPool;
    if (night < 0.02 || this.poolCount === 0) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    const cam = this.camera.position;
    let at = 0;
    for (let s = 0; s < this.poolCount; s++) {
      const x = this.poolAt[s * 3]!;
      const y = this.poolAt[s * 3 + 1]!;
      const z = this.poolAt[s * 3 + 2]!;
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      const r = Math.max(POOL_R_M, POOL_MIN_PX * this.worldPerPx * d);
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(r);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      at++;
    }
    this.dummy.scale.setScalar(1);
    mesh.count = at;
    mesh.visible = at > 0;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ── Transients ─────────────────────────────────────────────────────────────

  private markDeath(x: number, y: number): void {
    const slot = this.deathNext;
    this.deathNext = (this.deathNext + 1) % DEATH_SLOTS;
    this.deathAt[slot * 3] = x - HALF;
    this.deathAt[slot * 3 + 1] = this.surfaceAt(x, y);
    this.deathAt[slot * 3 + 2] = y - HALF;
    this.deathBorn[slot] = this.animT;
  }

  private markSpeech(id: number, x: number, y: number, to: { x: number; y: number } | null): void {
    this.speakingUntil.set(id, performance.now() + SPEAKING_MS);
    const slot = this.rippleNext;
    this.rippleNext = (this.rippleNext + 1) % SPEECH_SLOTS;
    this.rippleAt[slot * 3] = x - HALF;
    this.rippleAt[slot * 3 + 1] = this.surfaceAt(x, y) + 1;
    this.rippleAt[slot * 3 + 2] = y - HALF;
    this.rippleBorn[slot] = this.animT;
    this.threadHas[slot] = to ? 1 : 0;
    if (to) {
      this.threadTo[slot * 3] = to.x - HALF;
      this.threadTo[slot * 3 + 1] = this.surfaceAt(to.x, to.y) + 1;
      this.threadTo[slot * 3 + 2] = to.y - HALF;
    }
  }

  private updateTransients(t: number): void {
    // Deaths and utterances are map marks too, so they take the map's unit —
    // a cairn the size of the ring a being stood in, not the size of a being.
    //
    // Measured at the MARK, not at the world origin. `annotationAt(0, 0, 0)`
    // is the annotation radius for something standing at the middle of the
    // continent, and from a settlement on the coast that is most of a
    // kilometre away: the unit came out at nine metres instead of three
    // quarters of one, and an utterance drew a thirty-metre white ring through
    // the hut beside it. That is the "giant white cluster ring blowing out to
    // pure white" in a reviewer's NEAR crop, and the soap-bubble discs in his
    // MID one. It is one wrong argument, and it has been in every round.
    const markScale = (x: number, y: number, z: number): number =>
      Math.min(this.annotationAt(x, y, z) / RING_R * 0.42, TRANSIENT_MAX_M);
    for (let i = 0; i < DEATH_SLOTS; i++) {
      const born = this.deathBorn[i]!;
      const age = born === 0 ? 2 : (t - born) / DEATH_FADE_S;
      if (age >= 1 || age < 0) {
        this.dummy.scale.setScalar(0);
      } else {
        const s = markScale(this.deathAt[i * 3]!, this.deathAt[i * 3 + 1]!, this.deathAt[i * 3 + 2]!);
        this.dummy.scale.setScalar(s * 0.8 * (1 - age * age));
      }
      this.dummy.position.set(this.deathAt[i * 3]!, this.deathAt[i * 3 + 1]!, this.deathAt[i * 3 + 2]!);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.deaths.setMatrixAt(i, this.dummy.matrix);
    }
    this.deaths.instanceMatrix.needsUpdate = true;

    const pos = this.threadPos;
    const col = this.threadCol;
    for (let i = 0; i < SPEECH_SLOTS; i++) {
      const born = this.rippleBorn[i]!;
      const age = born === 0 ? 2 : (t - born) / SPEECH_FADE_S;
      const live = age >= 0 && age < 1;
      const fade = live ? 1 - age : 0;
      const rs = markScale(this.rippleAt[i * 3]!, this.rippleAt[i * 3 + 1]!, this.rippleAt[i * 3 + 2]!);
      this.dummy.position.set(this.rippleAt[i * 3]!, this.rippleAt[i * 3 + 1]!, this.rippleAt[i * 3 + 2]!);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(live ? rs * (0.5 + age * 2.6) : 0);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
      // Faded well down as well as sized properly: additive white at 0.9 over
      // a night frame is the brightest thing on the screen, and an utterance
      // is not the subject of any frame.
      this.ripples.setColorAt(i, this.color.setRGB(0.28 * fade, 0.48 * fade, 0.35 * fade));
      if (live && this.threadHas[i] === 1) {
        this.writeArc(
          pos, col, i, ARC_SEGMENTS,
          this.rippleAt[i * 3]!, this.rippleAt[i * 3 + 1]! + rs, this.rippleAt[i * 3 + 2]!,
          this.threadTo[i * 3]!, this.threadTo[i * 3 + 1]! + rs, this.threadTo[i * 3 + 2]!,
          0.34 * fade, 0.82 * fade, 0.58 * fade,
        );
      } else {
        World3D.clearLinks(pos, i, i + 1, ARC_SEGMENTS);
      }
    }
    this.ripples.instanceMatrix.needsUpdate = true;
    if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
    this.threads.geometry.attributes['position']!.needsUpdate = true;
    this.threads.geometry.attributes['color']!.needsUpdate = true;
  }

  // ── Light ──────────────────────────────────────────────────────────────────

  private updateLight(): void {
    const d = this.daylight;
    const night = 1 - d;
    this.sun.intensity = 0.14 + d * 0.92;
    this.sun.color.copy(NIGHT_SUN).lerp(DAY_SUN, d);
    this.hemi.intensity = 0.5 + d * 0.3;
    this.hemi.color.copy(NIGHT_HEMI_SKY).lerp(DAY_HEMI_SKY, d);
    this.hemi.groundColor.copy(NIGHT_HEMI_GROUND).lerp(DAY_HEMI_GROUND, d);
    // The instrument light: off by day, just enough after dark that forms stay
    // readable. Night should read as night, not as a failure to render.
    this.headlight.intensity = night * 0.5;
    this.headlight.position.copy(this.camera.position);
    this.headlight.target.position.copy(this.controls.target);
    const sky = this.skyMat.uniforms;
    (sky['uHigh']!.value as THREE.Color).copy(NIGHT_SKY_HI).lerp(DAY_SKY_HI, d);
    (sky['uLow']!.value as THREE.Color).copy(NIGHT_SKY_LO).lerp(DAY_SKY_LO, d);
    sky['uNight']!.value = night;
    // Exactly the colour the horizon is, or the haze reads as smoke rather than
    // as air: what makes a far mountain look far is that it is turning INTO the
    // sky, not that it is going grey.
    const haze = this.scene.fog as THREE.FogExp2;
    haze.color.copy(NIGHT_SKY_LO).lerp(DAY_SKY_LO, d);
    // Thick at eye level, thin at map scale. Standing in the street the range
    // is twelve hundred metres off and should be half air; from a kilometre and
    // a half up it is the subject and has to stay countable.
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const scale = (200 / Math.max(200, camDist)) ** 0.85;
    haze.density = Math.max(HAZE_FLOOR, HAZE_NEAR * scale);
    // Firelight, in one number, for the pane and the pool alike. Not routed
    // through the ghost rule: a hut that steps aside keeps its lamp lit.
    this.emberFade.value = night;
    this.updatePools(night);
    // Bodies keep their own colour as the light goes. The land does not.
    for (const lift of this.bodyNight) lift.value = night * 0.62;
  }

  // ── Selection, focus, ties ─────────────────────────────────────────────────

  /**
   * Who the reader is currently pointing at — from the canvas, from a roster
   * row, or from a driver.
   *
   * The view does not decide this for itself any more. The shell owns the
   * brush (see `brushReduce`) because two things can point at once: the mouse
   * over the world and the mouse over the table are the same question asked
   * from two places, and whichever asked last must win without the other
   * stamping on it a twelfth of a second later.
   */
  setHover(id: number | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    // The name over a newly hovered being should appear now, not at the next
    // quarter-second label refresh.
    this.lastLabelPick = 0;
  }

  get hovered(): number | null {
    return this.hoveredId;
  }

  /**
   * The beings that answer the filter's question — emphasised, with everyone
   * else dimmed. `null` turns the whole effect off.
   *
   * Nothing is removed from the picture and no count changes: `countAudit`
   * closes over the same population with a filter on as with it off. A view
   * that quietly deleted the beings you had not asked about would answer "how
   * many are there" with "how many did you ask for", which is the one way an
   * instrument can be wrong that a reader cannot detect.
   */
  setHighlight(ids: ReadonlySet<number> | null): void {
    this.highlight = ids;
  }

  highlightedIds(): number[] {
    if (this.highlight === null) return [];
    const out: number[] = [];
    for (let i = 0; i < this.instanceCount; i++) {
      const id = this.ids[i]!;
      if (this.highlight.has(id)) out.push(id);
    }
    return out;
  }

  /**
   * How many beings had their pictogram and heading arrow withheld this frame
   * because a neighbour's mark was close enough that a reader could not tell
   * whose was whose — and how many kept them.
   */
  markAudit(): { drawn: number; held: number; clear: number } {
    let drawn = 0;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (!this.isCollapsed(i) && this.beingInside[i] !== 1) drawn++;
    }
    return { drawn, held: this.marksHeld, clear: drawn - this.marksHeld };
  }

  /**
   * Where every drawn mark is and how far it reaches, so the suppression rule
   * can be checked against the picture rather than taken on trust: no two
   * beings that BOTH still show a facing may have overlapping marks.
   *
   * CLIENT coordinates, like everything else in this namespace — `x`, `y` is
   * the same point `screenPositionOf` returns and `pickAtScreen` takes.
   */
  markGeometry(): { id: number; x: number; y: number; r: number; clear: boolean }[] {
    const out: { id: number; x: number; y: number; r: number; clear: boolean }[] = [];
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      // Only marks that were DRAWN: a being inside a building has none — its
      // count is in the chip over the roof — and listing one here would be the
      // array claiming ink that is not on the screen.
      if (this.isCollapsed(i) || this.beingInside[i] === 1) continue;
      const p = this.screenPoints[k]!;
      const at = this.toClient(p.x, p.y);
      out.push({ id: p.id, x: at.x, y: at.y, r: this.markRadiusOf(i), clear: this.beingMarkClear[i] === 1 });
    }
    return out;
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    if (id === null) {
      this.selRing.visible = false;
      this.selBeam.visible = false;
      this.following = false;
      this.setTies(null);
    }
  }

  /** Glide the camera onto the selected being. One-shot unless `follow` is on. */
  focusSelected(): void {
    this.focusUntil = performance.now() + 1400;
  }

  /**
   * How much of the right-hand side of the canvas is covered by a floating
   * panel. Centring on a being aims to the right of it by half of this, so
   * "Centre on them" does not put them under the inspector that opened because
   * you selected them.
   */
  setPanelWidth(px: number): void {
    this.panelWidth = Math.max(0, px);
  }

  setFollow(on: boolean): void {
    this.following = on;
    if (on) this.focusUntil = performance.now() + 1400;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** Light up who this being is related to and who it is close to. */
  setTies(ties: { kin: number[]; bonded: number[] } | null): void {
    this.tieKin = ties ? ties.kin : [];
    this.tieBonded = ties ? ties.bonded : [];
    this.kinSet.clear();
    this.bondSet.clear();
    for (const id of this.tieKin) this.kinSet.add(id);
    for (const id of this.tieBonded) if (!this.kinSet.has(id)) this.bondSet.add(id);
    this.tiesOn = ties !== null;
    this.ties.visible = this.tiesOn;
  }

  get tiesShown(): boolean {
    return this.tiesOn;
  }

  private indexOf(id: number): number {
    for (let i = 0; i < this.instanceCount; i++) if (this.ids[i] === id) return i;
    return -1;
  }

  /**
   * Put the bone ring under whoever the card is describing.
   *
   * Drawn through the world, like every other annotation, so the answer to
   * "which one is it?" does not depend on the being being in front of the hut
   * rather than behind it.
   */
  private updateHoverRing(t: number): void {
    const i = this.hoveredId === null ? -1 : this.indexOf(this.hoveredId);
    if (i < 0) {
      this.hoverRing.visible = false;
      return;
    }
    const h = this.beingMark[i]!;
    this.hoverRing.visible = true;
    this.hoverRing.position.set(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]! + h * 0.06, this.beingPos[i * 3 + 2]!);
    this.hoverRing.scale.setScalar(h * RING_R * (1 + Math.sin(t * 5.2) * 0.045));
  }

  private updateSelection(t: number): void {
    const i = this.selectedId === null ? -1 : this.indexOf(this.selectedId);
    if (i < 0) {
      this.selRing.visible = false;
      this.selBeam.visible = false;
      this.ties.visible = false;
      // Nothing is selected, so nothing is standing in the selection's way.
      // What is standing in a BEING's way is `updateSubjects`, and it is not a
      // property of the selection: every being on screen is somebody's subject.
      for (const u of this.foliageFades) u.uSelR.value = 0;
      return;
    }
    const x = this.beingPos[i * 3]!;
    const y = this.beingPos[i * 3 + 1]!;
    const z = this.beingPos[i * 3 + 2]!;
    const top = this.beingTop[i]!;
    const h = this.beingMark[i]!;
    const pulse = 1 + Math.sin(t * 3.4) * 0.07;
    const deco = h;
    this.selRing.visible = true;
    this.selRing.position.set(x, y + deco * 0.05, z);
    this.selRing.scale.setScalar(deco * RING_R * pulse);
    this.selBeam.visible = true;
    this.selBeam.position.set(x, top + deco * 2.6, z);
    this.selBeam.scale.set(deco * 0.62, deco * 3.4, deco * 0.62);

    if (this.focusUntil > performance.now() || this.following) {
      // Centred means centred in the part of the canvas you can see. The
      // inspector floats over the right of the view, so the camera aims to the
      // right of the being by half that panel — which puts the being, and the
      // ground around it, in the clear.
      const shiftPx = focusShiftPx(this.canvas.clientWidth, this.panelWidth);
      const d = this.camera.position.distanceTo(this.focusTarget.set(x, y + h, z));
      const shift = shiftPx * d * this.worldPerPx;
      this.camera.getWorldDirection(this.fwd);
      this.right.crossVectors(this.fwd, this.camera.up).normalize();
      this.focusTarget.addScaledVector(this.right, shift);
      this.controls.target.lerp(this.focusTarget, this.following ? 0.09 : 0.055);
    }

    if (this.tiesOn) {
      let link = 0;
      const draw = (other: number, r: number, g: number, b: number): void => {
        if (link >= TIE_LINKS) return;
        const j = this.indexOf(other);
        if (j < 0) return; // bonded to someone who is no longer alive to draw
        const oy = this.beingPos[j * 3 + 1]!;
        this.writeArc(
          this.tiePos, this.tieColor, link, ARC_SEGMENTS,
          x, y + h * 0.75, z,
          this.beingPos[j * 3]!, oy + (this.beingTop[j]! - oy) * 0.75, this.beingPos[j * 3 + 2]!,
          r, g, b,
        );
        link++;
      };
      for (const other of this.tieKin) draw(other, 0.12, 0.86, 0.92);
      for (const other of this.tieBonded) draw(other, 0.44, 0.94, 0.16);
      World3D.clearLinks(this.tiePos, link, TIE_LINKS, ARC_SEGMENTS);
      (this.ties.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
      (this.ties.geometry.attributes['color'] as THREE.BufferAttribute).needsUpdate = true;
      this.ties.visible = link > 0;
    }

    // Scenery standing ON the selected being clears a little further than the
    // occlusion rule asks, because the selected being is the one the whole
    // frame is about. Not at MID and NEAR: there the subject rule already
    // clears whatever is in front of it, and widening it into a bubble would
    // delete the house somebody is standing beside in order to show you the
    // person standing beside a house.
    const clear = bandShowsDetail(this.band) ? 0 : Math.max(6, h * 1.4);
    for (const u of this.foliageFades) {
      u.uSel.value.set(x, y, z);
      u.uSelR.value = clear;
    }
  }

  // ── Picking + labels ───────────────────────────────────────────────────────

  /**
   * EVERY being under the cursor, in the order a disambiguation list should
   * offer them — not the nearest one.
   *
   * Two sources, and the distinction between them is the whole point. A ray
   * that strikes a BODY is an exact hit on an exact instance: `instanceId` →
   * `stageIds` → the being's own id, never a nearest-by-accident. Beings whose
   * bodies the ray missed but whose MARK the cursor is inside come second,
   * because a twenty-pixel figure is mostly gaps and at FAR there are no bodies
   * to hit at all — a reviewer's eight blind clicks into a populated DEFAULT
   * frame once hit nothing whatsoever.
   *
   * `intersectObject` is asked for all hits rather than the first, so four
   * people standing in a doorway come back as four candidates and the card can
   * say "4 here" instead of quietly choosing one of them.
   */
  pickAt(clientX: number, clientY: number): PickCandidate[] {
    const rect = this.canvasRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return [];
    this.ndc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const found = new Map<number, PickCandidate>();
    const offer = (id: number, layer: number, distPx: number, depth: number): void => {
      const held = found.get(id);
      if (held === undefined) {
        found.set(id, { id, onBody: layer === PICK_BODY, layer, distPx, depth });
        return;
      }
      // The best layer this being was found in wins, and the measurements come
      // with it — a body hit knows its own depth exactly.
      if (layer < (held.layer ?? PICK_MARK)) {
        held.layer = layer;
        held.onBody = layer === PICK_BODY;
        held.depth = depth;
      }
      if (distPx < held.distPx) held.distPx = distPx;
    };
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.figures[stage];
      if (!mesh || mesh.count === 0) continue;
      for (const hit of this.raycaster.intersectObject(mesh, false)) {
        if (hit.instanceId === undefined) continue;
        const id = this.stageIds[stage]![hit.instanceId];
        if (id === undefined) continue;
        // A shelter's occupants are reached through the CHIP that is already
        // speaking for them — see `offeredUnderPointer`. Their rings, badges,
        // arrows and names have been taken away and one number stands for all
        // of them; handing one back under the pointer as well is the view
        // running two contradictory promises at once, and it is where both of
        // round five's mispicks came from.
        if (!offeredUnderPointer(this.insideChipOf.get(id) ?? null)) continue;
        offer(id, PICK_BODY, 0, hit.distance);
      }
    }
    // What is DRAWN at this pixel, when the ray went through it. A figure is
    // mostly gaps — between the arm and the trunk, over the head of a being
    // lying down — and round six's fallback from a missed ray was "whose PIN
    // is nearest", which in a crowd is the neighbour's: the pin sits at the
    // feet and the cursor is usually on the body, forty pixels above it. So
    // the drawn footprint is its own layer, under the exact hit and over the
    // mark.
    for (let k = 0; k < this.screenPoints.length; k++) {
      const p = this.screenPoints[k]!;
      const i = this.screenIndex[k]!;
      if (this.isCollapsed(i)) continue; // nothing is drawn for it; it is in a chip's number
      if (!offeredUnderPointer(this.insideChipOf.get(p.id) ?? null)) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const distPx = Math.hypot(dx, dy);
      const depth = this.distanceTo(i);
      const markR = Math.max(HOVER_MIN_PX, this.markRadiusOf(i));
      const box = bandShowsBodies(this.band) ? this.boxOf(p.id) : undefined;
      if (box && px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) {
        offer(p.id, PICK_FIGURE, distPx, depth);
        continue;
      }
      if (distPx <= markR) offer(p.id, PICK_MARK, distPx, depth);
    }
    // Ghosting and the x-ray, respected: a being you can only see THROUGH a
    // hill is drawn as a pale outline, and an outline does not outrank somebody
    // standing in the open at the same pixel.
    for (const cand of found.values()) {
      const i = this.indexOf(cand.id);
      if (i < 0) continue;
      const top = this.beingTop[i]!;
      if (this.terrainHides(this.beingPos[i * 3]!, (this.beingPos[i * 3 + 1]! + top) * 0.5, this.beingPos[i * 3 + 2]!)) {
        cand.layer = (cand.layer ?? PICK_MARK) + PICK_HIDDEN;
      }
    }
    return orderCandidates([...found.values()]);
  }

  /** The box this being's figure covers — the same one the probes read. */
  private boxOf(id: number): BodyBox | undefined {
    this.bodyBoxes();
    return this.boxById.get(id);
  }

  /**
   * The pick the MOUSE would make at this screen point, through the same code
   * path as the pointer handler — not a parallel implementation of it.
   *
   * Round six's engineer verified identification 15/15 through `ui.hover(id)`,
   * which is the one route that never touches picking, and a reviewer with a
   * real mouse got 3/10 in a crowd. Takes client coordinates: exactly what
   * `screenPositionOf` returns and what a pointer event carries.
   */
  pickAtScreen(clientX: number, clientY: number): { id: number; layer: number; onBody: boolean; distPx: number; depth: number }[] {
    return this.pickAt(clientX, clientY).map((c) => ({
      id: c.id,
      layer: c.layer ?? (c.onBody ? PICK_BODY : PICK_MARK),
      onBody: c.onBody,
      distPx: c.distPx,
      depth: c.depth,
    }));
  }

  /** The one being a click means: the first candidate, or nothing. */
  private pick(clientX: number, clientY: number): number | null {
    return this.pickAt(clientX, clientY)[0]?.id ?? null;
  }

  private handleClick(e: PointerEvent): void {
    // Ignore drags (orbit); only near-stationary taps are clicks.
    if (Math.abs(e.clientX - this.downX) > 5 || Math.abs(e.clientY - this.downY) > 5) return;
    // A hovered being wins over a fresh pick: what the card is describing is
    // what the reader believes they are about to click, and after arrowing
    // through a disambiguation list those two are deliberately different.
    const id = this.hoveredId !== null && this.indexOf(this.hoveredId) >= 0
      ? this.hoveredId
      : this.pick(e.clientX, e.clientY);
    this.choose(id);
  }

  /**
   * Choosing a being, in the two lines a CLICK runs — the view marks it and the
   * shell is told, in that order.
   *
   * `ui.select` goes through here rather than reassembling the same steps
   * beside it. Round seven's driver did the latter and ended with the inspector
   * open on a specimen and no row marked in the roster, while a real click on
   * the same being kept both: two spellings of one action, and only one of them
   * tested. A driver surface that does not exercise the real path is a surface
   * that can pass while the product is broken.
   */
  choose(id: number | null): void {
    this.setSelected(id);
    this.onSelect?.(id);
  }

  /**
   * Is the land itself standing between the camera and this point?
   *
   * A label over a being behind a mountain is a label pointing at a mountain.
   * Marching the height field is exact enough and costs nothing at the rate
   * this is asked: the terrain is the only thing in the scene big enough to
   * hide a being from a camera that is always above it.
   */
  private terrainHides(x: number, y: number, z: number): boolean {
    return this.terrainHidesFrom(this.camera.position, x, y, z);
  }

  private terrainHidesFrom(cam: THREE.Vector3, x: number, y: number, z: number): boolean {
    const steps = 14;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = cam.x + (x - cam.x) * t;
      const py = cam.y + (y - cam.y) * t;
      const pz = cam.z + (z - cam.z) * t;
      if (this.surfaceAt(px + HALF, pz + HALF) > py + 1) return true;
    }
    return false;
  }

  /**
   * How far this point is inside a building's footprint, in metres — 0 when it
   * is outside every one of them.
   *
   * Used to keep a proposed camera, and the point it aims at, out of the inside
   * of a hut. Round four's `frameCandidates` put both there.
   */
  private insideStructure(x: number, y: number, z: number, clearance: number): number {
    let worst = 0;
    const reach = SHELTER_FOOTPRINT / 2 + clearance;
    for (let s = 0; s < this.structures.length; s++) {
      if (this.structures[s]!.kind !== 'shelter') continue;
      const base = this.structureAt[s * 3 + 1]!;
      if (y < base - 1 || y > base + SHELTER.ridge + clearance) continue;
      const d = Math.hypot(x - this.structureAt[s * 3]!, z - this.structureAt[s * 3 + 2]!);
      if (d < reach) worst = Math.max(worst, reach - d);
    }
    return worst;
  }

  /**
   * Where this being's ground MARK is centred, in scene units — the exact point
   * `writeMarkers` puts the ring or the dot at, lift along the ground's own
   * normal included.
   *
   * One point, written once. Round seven had three of them: the probe projected
   * the body's mid-height, the audit binned a point half a mark-radius above the
   * ground, and the ink was drawn at the ground itself — 11.3 px apart on
   * average, enough to file 8.6% of a frame's beings in the wrong quadrant from
   * the very probe the docs point a driver at.
   */
  private markAnchor(i: number, out: THREE.Vector3): THREE.Vector3 {
    const mark = this.beingMark[i]!;
    const lift = bandShowsBodies(this.band)
      ? mark * RING_R * stageFootprint(this.beingStage[i]!, this.band) * 0.09
      : mark * DOT_R * 0.2;
    return out.set(
      this.beingPos[i * 3]! + this.beingNormal[i * 3]! * lift,
      this.beingPos[i * 3 + 1]! + this.beingNormal[i * 3 + 1]! * lift,
      this.beingPos[i * 3 + 2]! + this.beingNormal[i * 3 + 2]! * lift,
    );
  }

  /**
   * Project every drawn being to the canvas, keeping the ones actually in
   * frame. Everything that ranks, counts or labels a being reads this, so the
   * view can never report something it did not draw where it says it drew it.
   *
   * The point is the MARK's, because the mark is what is drawn for a being in
   * every band that draws one, and `screenPositionOf` returns this same array
   * entry. Where a hut's chip has taken a being's ring away, `reprojectInside`
   * moves that entry onto the body instead — the drawn thing, whichever it is.
   * The feet are kept beside it: a body box is measured up from the ground, and
   * deriving the ground back out of the mark by arithmetic is how two of these
   * points drifted apart in the first place.
   */
  private projectBeings(): void {
    this.screenPoints.length = 0;
    this.screenIndex.length = 0;
    this.screenFootY.length = 0;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.beingOnScreen.fill(0, 0, this.instanceCount);
    for (let i = 0; i < this.instanceCount; i++) {
      this.markAnchor(i, this.probe).project(this.camera);
      if (this.probe.z > 1) continue; // behind the camera
      const px = ((this.probe.x + 1) / 2) * w;
      const py = ((1 - this.probe.y) / 2) * h;
      if (px < 0 || px > w || py < 0 || py > h) continue;
      this.probe.set(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]!, this.beingPos[i * 3 + 2]!).project(this.camera);
      this.beingOnScreen[i] = 1;
      this.screenPoints.push({ id: this.ids[i]!, x: px, y: py });
      this.screenFootY.push(((1 - this.probe.y) / 2) * h);
      this.screenIndex.push(i);
    }
    // The points the last plan moved onto bodies stay on bodies until the plan
    // changes — the flags here are the ones `writeMarkers` is about to draw by.
    this.reprojectInside();
  }

  /**
   * Move the reported point onto the BODY for every being whose mark a hut's
   * chip is now carrying — run once the inside groups are known, before
   * anything reads the points.
   */
  private reprojectInside(): void {
    if (!this.insideAny) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (this.beingInside[i] !== 1) continue;
      // The CLAMPED body, because that is the one that gets drawn — see
      // `clampIntoRoom`. Reporting the sim's position for a body the picture
      // has moved inside a wall is the oldest defect in this file wearing a
      // different hat.
      const mid = (this.beingPos[i * 3 + 1]! + this.beingTop[i]!) * 0.5;
      this.probe.set(this.insideAt[i * 3]!, mid, this.insideAt[i * 3 + 2]!).project(this.camera);
      if (this.probe.z > 1) continue;
      this.screenPoints[k]!.x = ((this.probe.x + 1) / 2) * w;
      this.screenPoints[k]!.y = ((1 - this.probe.y) / 2) * h;
    }
  }

  /**
   * Where the crowd is, and how many are in it.
   *
   * Beings gather — that is the whole subject — and a settlement of thirty
   * inside a hundred pixels cannot be counted by looking however well each
   * marker is drawn. So the groups are found in screen space and each one is
   * given an outline and its own total. The individuals are still drawn inside
   * it: the number says how many are there, including the ones standing behind
   * the ones you can see, and the group splits into smaller ones as you zoom in
   * until, close enough, there are no groups at all and you are counting people.
   */
  /**
   * Where the crowds are, how many are in each, and — in the bands that promise
   * a count — which beings the numbers have already counted.
   *
   * Round three drew every pin AND a number beside the group, and a stranger
   * counting a default-camera frame came out 11.6% low over the whole picture
   * and 12.9% high in one quadrant. That is not a reader being careless; it is a
   * picture asking to be counted two ways at once. So where the band promises a
   * count, the rule is now absolute: **a being is a pin or it is part of a
   * number, and never both.** Pins that would overlap collapse into the chip
   * that counts them and are not drawn at all, and `countAudit()` reports the
   * two terms so the arithmetic can be checked against the picture.
   *
   * At NEAR there are no crowd chips. Standing in the street, a number floating
   * over six visible people is answering a question nobody at that distance is
   * asking, and the band's own contract says to pull back to count. The one
   * exception is a chip that is not about a crowd at all: the people INSIDE a
   * building, whose rings a ghosted wall turns into a scribble in both close
   * bands — see `planInside`.
   */
  private updateCrowds(now: number): void {
    if (this.hullNodes.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const collapses = bandCountsBeings(this.band);
    // Ten times a second is enough while the camera is still; while it is NOT,
    // the grouping has to be redone in the same frame as the projection it is
    // built from, or for a tenth of a second the view draws pins inside hulls
    // that were computed for where the beings used to be — and `countAudit`
    // would report an arithmetic that does not close.
    if (now - this.lastCluster > 90 || (collapses && (this.camMoving || this.crowdsStrayed(w, h)))) {
      this.lastCluster = now;
      // The huts first: whoever they take is out of the crowd grouping below,
      // and their chips are the ones that must survive the budget, because a
      // being whose ring has been taken away and whose chip was dropped is a
      // being in neither term.
      const housed = this.planInside();
      if (collapses) {
        // One PIN wide, so two marks that could touch are always in the same
        // group — that is what makes "no two pins a reader counts separately
        // ever overlap" a property of the geometry rather than a hope. And the
        // FRAME is passed in, so no chip spans the lines a reader counts
        // across: a quadrant count is the same arithmetic as a whole-frame one.
        this.clusters = planCount(this.screenPoints, this.annotationPixels(), CLUSTER_BUDGET, { w, h }).chips;
      } else if (this.band === 'near') {
        // No crowd grouping in the street — only the huts.
        this.clusters = [];
      } else {
        this.clusters = clusterHierarchy(
          this.screenPoints,
          Math.max(14, this.bandPx * CLUSTER_CELL_MARKERS),
          CLUSTER_MIN,
          CLUSTER_BUDGET,
          Math.min(w, h) / 6,
        );
      }
      // A being the hut's chip is already speaking for is not also a member of
      // a crowd: two chips over one knot was exactly what a reviewer found.
      if (housed.length > 0) {
        for (const cl of this.clusters) {
          const keep = cl.members.filter((m) => this.beingInside[this.screenIndex[m]!] !== 1);
          if (keep.length !== cl.members.length) {
            cl.count -= cl.members.length - keep.length;
            cl.members = keep;
          }
        }
        this.clusters = housed.concat(this.clusters.filter((cl) => cl.count >= 2));
      }
      // Never more groups than there are outlines to draw them with. A cluster
      // past the last node would suppress its members' pins and then draw no
      // number for them — beings in neither term of the count.
      if (this.clusters.length > this.hullNodes.length) {
        for (let c = this.hullNodes.length; c < this.clusters.length; c++) {
          for (const m of this.clusters[c]!.members) this.beingInside[this.screenIndex[m]!] = 0;
        }
        this.clusters.length = this.hullNodes.length;
      }
      // Each group is anchored in the WORLD, so its outline follows the orbit
      // smoothly between the ten times a second the grouping itself is redone.
      this.beingCrowded.fill(0, 0, this.instanceCount);
      this.insideChipOf.clear();
      this.clusterIds = [];
      for (let c = 0; c < this.clusters.length; c++) {
        const cl = this.clusters[c]!;
        // The selected being is never swallowed by a number. It is the one
        // promise every band makes, so it leaves the group — and the group's
        // total goes down by one, because the total has to keep counting
        // exactly the beings the chip is standing in for.
        if (collapses && this.selectedId !== null) {
          const drop = cl.members.findIndex((m) => this.ids[this.screenIndex[m]!] === this.selectedId);
          if (drop >= 0) {
            cl.members.splice(drop, 1);
            cl.count -= 1;
          }
        }
        // A chip reading "1" over a being with no pin under it is a worse
        // answer than the pin would have been. Whatever is left dissolves and
        // draws itself — `beingCrowded` is only set below, so it does.
        if (cl.count < 2) {
          this.clusters.splice(c, 1);
          c--;
          continue;
        }
        let cx = 0;
        let cy = 0;
        let cz = 0;
        const ids: number[] = [];
        for (const m of cl.members) {
          const i = this.screenIndex[m]!;
          this.beingCrowded[i] = 1;
          ids.push(this.ids[i]!);
          // Which chip is speaking for this being — the one a reader has to
          // hover to learn its name.
          if (c < this.insideCount) this.insideChipOf.set(this.ids[i]!, c);
          cx += this.beingPos[i * 3]!;
          cy += this.beingPos[i * 3 + 1]!;
          cz += this.beingPos[i * 3 + 2]!;
        }
        this.clusterIds[c] = ids;
        const n = cl.members.length;
        // An occupants chip hangs on the BUILDING — over its ridge, where a
        // reader is already looking — not on the centroid of the people inside
        // it, which is the middle of the hut and under the roof.
        const house = c < this.insideCount ? c * 3 : -1;
        const ax = house >= 0 ? this.insideAnchors[house]! : cx / n;
        const ay = house >= 0 ? this.insideAnchors[house + 1]! : cy / n;
        const az = house >= 0 ? this.insideAnchors[house + 2]! : cz / n;
        this.clusterWorld[c * 4] = ax;
        this.clusterWorld[c * 4 + 1] = ay;
        this.clusterWorld[c * 4 + 2] = az;
        this.clusterWorld[c * 4 + 3] = this.camera.position.distanceTo(this.probe.set(ax, ay, az));
      }
      this.clusterIds.length = this.clusters.length;
      this.insideAny = this.insideCount > 0;
      this.reprojectInside();
    }

    this.chipRects.length = 0;
    this.collectPinRects(collapses);
    for (let c = 0; c < this.hullNodes.length; c++) {
      const hull = this.hullNodes[c]!;
      const count = this.countNodes[c]!;
      const lead = this.chipLeadNodes[c]!;
      const cl = this.clusters[c];
      if (!cl) {
        if (hull.style.display !== 'none') hull.style.display = 'none';
        if (count.style.display !== 'none') count.style.display = 'none';
        if (lead.style.display !== 'none') lead.style.display = 'none';
        continue;
      }
      const housed = c < this.insideCount;
      this.probe.set(this.clusterWorld[c * 4]!, this.clusterWorld[c * 4 + 1]!, this.clusterWorld[c * 4 + 2]!);
      const dNow = this.camera.position.distanceTo(this.probe);
      this.probe.project(this.camera);
      const behind = this.probe.z > 1;
      let px = ((this.probe.x + 1) / 2) * w;
      let py = ((1 - this.probe.y) / 2) * h;
      const zoom = dNow > 0 ? this.clusterWorld[c * 4 + 3]! / dNow : 1;
      // An ellipse drawn on a bounding box leaves the corners of the group
      // outside itself, and a being outside the outline that counts it is a
      // being the reader counts twice. An OCCUPANTS chip has no ellipse at all:
      // the building is its outline, already drawn, with a footprint on the
      // ground — and the dashed hull round the people inside it was the thing
      // whose lower arc crossed the roof.
      const rx = housed ? 7 : Math.max(14, cl.rx * zoom * 1.22);
      const ry = housed ? 7 : Math.max(12, cl.ry * zoom * 1.22);
      if (behind || (!housed && (px < -rx || px > w + rx || py < -ry || py > h + ry))) {
        hull.style.display = 'none';
        count.style.display = 'none';
        lead.style.display = 'none';
        continue;
      }
      // A roof apex a little above the top of the frame is still a hut full of
      // people standing in it, so the number is held on screen rather than
      // dropped — the beings it counts have had their own marks taken away and
      // would be in neither term of the count.
      if (housed) {
        px = Math.min(Math.max(px, 4), w - 4);
        py = Math.min(Math.max(py, 4), h - 4);
      }
      // The outline is drawn only where it IS the group.
      //
      // In a band that collapses the pins into a number there is nothing
      // inside the shape to look at, so the shape has to carry everybody it
      // stands in for. In a band that draws all of them as themselves it
      // carries nothing — and a reviewer measured exactly that: perfect
      // screen-space circles 140 px across for knots of two and three,
      // overlapping four deep over a ground plane seen at a grazing angle,
      // "the most conspicuous thing in a MID frame and the least informative".
      if (housed || !collapses) {
        if (hull.style.display !== 'none') hull.style.display = 'none';
      } else {
        hull.style.display = 'block';
        const cls = 'whull full';
        if (hull.className !== cls) hull.className = cls;
        hull.style.width = `${Math.round(rx * 2)}px`;
        hull.style.height = `${Math.round(ry * 2)}px`;
        hull.style.transform = `translate(-50%, -50%) translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      }
      const text = String(cl.count);
      const parts = this.countParts[c];
      if (parts && parts.num.textContent !== text) parts.num.textContent = text;
      count.style.display = 'block';
      if (parts) this.paintChip(parts, cl, housed);
      // The leader home: to the DOORWAY for a shelter, to the outline for a
      // crowd on open ground.
      let door: { x: number; y: number } | null = null;
      if (housed) {
        this.probe.set(this.insideDoors[c * 3]!, this.insideDoors[c * 3 + 1]!, this.insideDoors[c * 3 + 2]!);
        this.probe.project(this.camera);
        if (this.probe.z <= 1) {
          door = {
            x: Math.min(Math.max(((this.probe.x + 1) / 2) * w, 0), w),
            y: Math.min(Math.max(((1 - this.probe.y) / 2) * h, 0), h),
          };
        }
      }
      // Brushing, the third direction: a roster row for somebody inside a hut
      // has no mark in the picture to light up, so the chip that speaks for
      // them lights up instead.
      const brushed = housed && this.hoveredId !== null
        && cl.members.some((m) => this.ids[this.screenIndex[m]!] === this.hoveredId);
      this.placeChip(c, count, lead, px, py, rx, ry, this.chipHalfWidth(text, housed), w, h, cl.region, door, brushed);
    }
  }

  /**
   * The people INSIDE a building, as one chip on the building.
   *
   * A hut with six to eleven beings in it is the worst object this view draws.
   * The walls ghost out so nobody is hidden — that promise holds and must keep
   * holding — but what is left is six cream rings, six badges and six arrows
   * threaded through each other and through a translucent roof, which a
   * reviewer called "one white cloud of tangled rings" and could neither count
   * nor separate. Nothing was hidden and nothing was legible either.
   *
   * So a structure that is holding a pile of people speaks for them: their
   * rings, badges and arrows come off, their BODIES stay exactly where they are
   * (visible through the ghost, which is the promise), and one chip sits over
   * the ridge with the count and the same condition-mix bar every crowd chip
   * carries. Hovering it lists the occupants; clicking it frames them. The
   * chips are ordinary clusters, so `chipSummary`, `chipsOnScreen` and
   * `zoomToCluster` all answer about them without a second code path.
   *
   * Only where the pile is real: at least `INSIDE_MIN` of the occupants have a
   * neighbour whose mark overlaps theirs. Three people standing apart in a big
   * hut are three readable beings and keep their marks. The selected being
   * always keeps its own — it is the one promise every band makes.
   *
   * ## The ruling, after four rounds of losing to the same picture
   *
   * Rounds four, five and six each tried to make a crowd inside a hut
   * READABLE through a ghosted wall — x-ray, depth shading, a keyline, an
   * interior light — and each time a reviewer looked at the result and said
   * the same thing: a white cloud, a bone-pile, "a picket of bollards bursting
   * through the walls". That was never going to work, and the reason is
   * arithmetic rather than shading. Thirty-four people occupy a few square
   * metres of floor; at any camera that can see the hut, their bodies are the
   * same pixels. No amount of light separates coincident objects.
   *
   * So the picture stops trying. **An occupied shelter is SOLID.** Its
   * occupants are hidden by the building, exactly as in life, and the chip on
   * its roof is the instrument reading: the exact count, the condition mix,
   * the unwell notch, every occupant's name on hover, each name a button that
   * frames and selects that being. Nothing is lost — everything the bodies
   * could not say, the chip says exactly — and what a reader sees instead of a
   * white mass is a village of closed huts with numbers on them, which is what
   * a village of closed huts looks like.
   *
   * The one exception is the being you are FOLLOWING. Lose sight of your own
   * subject when it walks through a door and the instrument has taken
   * something away, so the hut holding the selected being OPENS: its walls
   * ghost, that being is drawn normally, and the others in the room are drawn
   * as dim flat silhouettes that cannot blow out to white. `insideOpen` is
   * that flag, and it is per HUT rather than per being, because a door is.
   */
  private planInside(): Cluster[] {
    this.insideCount = 0;
    this.beingInside.fill(0, 0, this.instanceCount);
    this.insideOpen.fill(0, 0, this.instanceCount);
    this.insideAny = false;
    // The close bands only. Out where a being is a pin, the crowd chips already
    // own this problem and a hut is a few pixels of roof.
    if (!bandShowsDetail(this.band)) return [];
    const out: Cluster[] = [];
    const reach = SHELTER_FOOTPRINT / 2 + 0.5;
    const measure = shelterMeasure();
    // The doorway's own middle, in the hut's local frame: the front wall is at
    // +z, and `rebuildStructures` turns the whole building by `yaw` about y.
    const doorZ = SHELTER.room / 2 - SHELTER.wallThickness / 2;
    for (let s = 0; s < this.structures.length && out.length < INSIDE_CHIPS_MAX; s++) {
      if (this.structures[s]!.kind !== 'shelter') continue;
      const hx = this.structureAt[s * 3]!;
      const hy = this.structureAt[s * 3 + 1]!;
      const hz = this.structureAt[s * 3 + 2]!;
      const members: number[] = [];
      // Is the reader's own subject in this room? Asked before the selected
      // being is skipped below, because the answer is about the HUT.
      let open = false;
      for (let k = 0; k < this.screenPoints.length; k++) {
        const i = this.screenIndex[k]!;
        const id = this.ids[i]!;
        if (isSpecimenId(id)) continue;
        const by = this.beingPos[i * 3 + 1]!;
        if (by < hy - 1.5 || by > hy + SHELTER.ridge) continue;
        const dx = this.beingPos[i * 3]! - hx;
        const dz = this.beingPos[i * 3 + 2]! - hz;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (id === this.selectedId) { open = true; continue; }
        members.push(k);
      }
      if (members.length < INSIDE_MIN) continue;
      let piled = 0;
      for (let a = 0; a < members.length; a++) {
        const pa = this.screenPoints[members[a]!]!;
        const ra = this.markRadiusOf(this.screenIndex[members[a]!]!);
        for (let b = 0; b < members.length; b++) {
          if (a === b) continue;
          const pb = this.screenPoints[members[b]!]!;
          const rb = this.markRadiusOf(this.screenIndex[members[b]!]!);
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < (ra + rb) * 0.95) { piled++; break; }
        }
      }
      if (piled < INSIDE_MIN) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const yawNow = hash2(this.structures[s]!.id, this.structures[s]!.builtBy) * Math.PI * 2;
      for (const m of members) {
        const p = this.screenPoints[m]!;
        const i = this.screenIndex[m]!;
        const r = this.markRadiusOf(i);
        x0 = Math.min(x0, p.x - r);
        y0 = Math.min(y0, p.y - r);
        x1 = Math.max(x1, p.x + r);
        y1 = Math.max(y1, p.y + r);
        this.beingInside[i] = 1;
        if (open) this.insideOpen[i] = 1;
        // Where this body may be DRAWN, if the room is open: inside the floor
        // plan and nowhere else. The sim is entitled to put a being on the
        // wall line — `reach` deliberately takes half a metre past the
        // footprint — but a body standing through a wall reads as a broken
        // renderer, which is precisely what a reviewer called it.
        this.clampIntoRoom(i, hx, hz, yawNow);
      }
      // The ROOF APEX, exactly — not nine tenths of the way up it. Round eight
      // hung the number off the top of an ellipse drawn round the people's own
      // screen positions, which put it in empty sky with the ellipse's lower arc
      // crossing the roof and its leader running into the tree behind: a
      // reviewer's first blind reading was "a crowd of 18 somewhere behind that
      // tree". The number belongs to the BUILDING, so it hangs on the building.
      const yaw = yawNow;
      const at = out.length;
      this.insideAnchors[at * 3] = hx;
      this.insideAnchors[at * 3 + 1] = hy + measure.ridge;
      this.insideAnchors[at * 3 + 2] = hz;
      // And the leader runs to the DOOR, which is the one part of a hut that
      // says "people go in here".
      this.insideDoors[at * 3] = hx + Math.sin(yaw) * doorZ;
      this.insideDoors[at * 3 + 1] = hy + SHELTER.doorHeight / 2;
      this.insideDoors[at * 3 + 2] = hz + Math.cos(yaw) * doorZ;
      out.push({
        count: members.length,
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        rx: Math.max(14, (x1 - x0) / 2),
        ry: Math.max(12, (y1 - y0) / 2),
        members,
        depth: 0,
      });
    }
    this.insideCount = out.length;
    this.insideAny = out.length > 0;
    return out;
  }

  /**
   * Pull an occupant's DISPLAY position inside its own hut's floor plan.
   *
   * The sim is allowed to stand somebody on the wall line — `reach` counts
   * anyone within half a metre of the footprint as indoors, which is right,
   * because they are. What the picture may not do is DRAW them there: a
   * reviewer's NEAR crop of a sixty-three-person shelter is a picket of bodies
   * pushing straight through both side walls, and no reading of that image
   * ends anywhere but "the renderer is broken".
   *
   * So the drawn position is clamped into the room, in the hut's own rotated
   * frame, with a body's half-width of margin off each wall. `worldPositionOf`
   * still answers where the sim put them; everything about the PICTURE — the
   * body, the screen point, the picker's box — uses this.
   */
  private clampIntoRoom(i: number, hx: number, hz: number, yaw: number): void {
    const half = Math.max(0.1, SHELTER.room / 2 - SHELTER.wallThickness - ROOM_MARGIN_M);
    const at = clampToRoom(this.beingPos[i * 3]! - hx, this.beingPos[i * 3 + 2]! - hz, yaw, half);
    this.insideAt[i * 3] = hx + at.x;
    this.insideAt[i * 3 + 1] = this.beingPos[i * 3 + 1]!;
    this.insideAt[i * 3 + 2] = hz + at.z;
  }

  /**
   * Whether any crowd's people have walked out of the quarter of the frame its
   * number is being drawn in — or out of the frame altogether.
   *
   * The grouping is a tenth of a second old at worst and the world runs at up
   * to 2400×, so "every member of this chip is in this quadrant" is a claim
   * with a shelf life. Rather than let the arithmetic be approximately true
   * between plans, the plan is redone the frame it stops being exactly true:
   * this walks the members once — three hundred integers — and any mismatch,
   * including an index that no longer belongs to the being it was planned for,
   * asks for a regrouping.
   */
  private crowdsStrayed(w: number, h: number): boolean {
    if (this.clusterIds.length !== this.clusters.length) return true;
    const view = { w, h };
    for (let c = 0; c < this.clusters.length; c++) {
      const cl = this.clusters[c]!;
      const ids = this.clusterIds[c];
      if (!ids || ids.length !== cl.members.length) return true;
      const home = cl.region;
      for (let j = 0; j < ids.length; j++) {
        const p = this.screenPoints[cl.members[j]!];
        if (!p || p.id !== ids[j]) return true;
        if (home !== undefined && regionOf(p.x, p.y, view) !== home) return true;
      }
    }
    return false;
  }

  /**
   * Where a crowd's number goes: outside its own outline, off every pin, on a
   * short line home.
   *
   * Round six put it at 0.72 of the hull's extent, which for anything but a
   * small group is INSIDE the crowd, and tested it only against other chips. A
   * reviewer found a "24" nine pixels from a pinned being, covering it
   * completely, directly under a legend line promising that no pin is drawn
   * inside a chip — and read that target as "no pin at all". A count that hides
   * one of the people it counts is not a count.
   *
   * So the slots start at the ellipse's own boundary and step out by the chip's
   * half-size; every candidate is tested against every pin drawn this frame and
   * every chip already placed; and when the frame really has no free spot, the
   * chip shrinks and fades rather than covering a being — the one thing it may
   * never do. `chipsOnScreen()` reports the box and whether it landed clear, so
   * the invariant is checkable against `markGeometry()`.
   */
  /**
   * How wide a chip is drawn, in half-pixels — the box the placement search
   * keeps off the people and the box `chipsOnScreen` reports.
   *
   * An occupants chip is drawn bigger, because it is the ONLY thing said about
   * everyone inside that building: a reviewer read three people out of twelve,
   * two out of eighteen and three out of twenty-two off the bodies, and the
   * number is what has to carry them.
   */
  private chipHalfWidth(text: string, housed: boolean): number {
    return housed ? text.length * 5.4 + 11 : text.length * 3.5 + 7;
  }

  private placeChip(
    c: number, count: HTMLElement, lead: HTMLElement,
    px: number, py: number, rx: number, ry: number, halfW: number, w: number, h: number,
    region: number | undefined,
    leadTo: { x: number; y: number } | null = null,
    brushed = false,
  ): void {
    const housed = c < this.insideCount;
    const halfH = housed ? CHIP_HALF_H + 5 : CHIP_HALF_H;
    // The crowd's OWN quarter of the frame, not the quarter its projected
    // centre happens to land in: the hull follows the orbit between plans and
    // the number must not drift across a line its people are not on.
    const at = placeCountChip(
      { x: px, y: py, rx, ry, region }, halfW, halfH, this.pinRects, this.chipRects, { w, h }, CHIP_GAP,
    );
    // Nothing free: the number gets out of the way of the people instead of the
    // other way round.
    const shrink = at.clear ? 1 : CHIP_SHY_SCALE;
    count.style.transform = `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`
      + (at.clear ? '' : ` scale(${CHIP_SHY_SCALE})`);
    // An occupants chip is a different object from a crowd chip and says so:
    // bigger, with a roof drawn over the number, because it is the only thing
    // the picture says about everybody inside that building.
    const cls = `wcount${housed ? ' inside' : ''}${at.clear ? '' : ' shy'}${brushed ? ' brush' : ''}`;
    if (count.className !== cls) count.className = cls;
    this.chipAt[c * 2] = at.x;
    this.chipAt[c * 2 + 1] = at.y;
    this.chipHalf[c * 2] = halfW * shrink;
    this.chipHalf[c * 2 + 1] = halfH * shrink;
    this.chipClear[c] = at.clear ? 1 : 0;
    // Names are placed around these, not on top of them.
    this.chipRects.push({
      x0: at.x - halfW * shrink, y0: at.y - halfH * shrink,
      x1: at.x + halfW * shrink, y1: at.y + halfH * shrink,
    });
    // A short line home, so a number sitting outside its ring still obviously
    // belongs to it — and for a shelter, a line to the DOOR, which is the one
    // part of a hut that says people go in here.
    const dx = (leadTo?.x ?? at.anchorX) - at.x;
    const dy = (leadTo?.y ?? at.anchorY) - at.y;
    const run = Math.hypot(dx, dy);
    if (run > 3) {
      lead.style.display = 'block';
      lead.style.width = `${Math.round(run)}px`;
      lead.style.transform = `translate(${at.x}px, ${at.y}px) rotate(${Math.atan2(dy, dx)}rad)`;
    } else if (lead.style.display !== 'none') {
      lead.style.display = 'none';
    }
  }

  /**
   * Every mark a reader is being asked to count, as a box — the obstacles a
   * chip has to keep off. Only beings that actually DREW something: a being a
   * chip has already counted draws nothing and cannot be covered.
   */
  private collectPinRects(collapses: boolean): void {
    this.pinRects.length = 0;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (collapses && this.beingCrowded[i] === 1 && this.ids[i] !== this.selectedId) continue;
      const p = this.screenPoints[k]!;
      const r = Math.max(5, this.markerPixelsOf(i) * 0.5);
      this.pinRects.push({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
    }
  }

  /**
   * The bar under a chip's number: what this crowd is MADE of.
   *
   * A number over a settlement answers one question and refuses the rest. Four
   * segments in the legend's own order, widths in percent, colours from the
   * condition palette that was chosen on lightness — so two chips can be
   * compared at a glance and a reader with any colour vision still sees
   * light-to-dark. With a filter on, the badge says how many of this crowd
   * answer it, which is the only way a count out at FAR can mean anything
   * while most of the frame is dimmed.
   *
   * The bar is ALWAYS drawn. Round eight hid it whenever the crowd was of one
   * condition, on the reasoning that a flat bar says nothing a reader needs —
   * and a reviewer measured both shelter chips' bars at 0 × 0 px and recorded
   * that the chip "says how many and nothing about how they are". A flat cream
   * bar says twenty-two people and every one of them well, which is a fact
   * about a hut, and a bar that is sometimes there and sometimes not is a
   * channel a reader cannot rely on at all.
   */
  private paintChip(parts: { num: HTMLElement; ill: HTMLElement; badge: HTMLElement; mix: HTMLElement; seg: HTMLElement[] }, cl: Cluster, housed = false): void {
    const members: { cond: number; act: number }[] = [];
    let matched = 0;
    for (const m of cl.members) {
      const i = this.screenIndex[m];
      if (i === undefined) continue;
      members.push({ cond: this.beingCond[i]!, act: this.beingAct[i]! });
      if (this.highlight?.has(this.ids[i]!)) matched++;
    }
    const mix = conditionMix(members);
    const total = members.length || 1;
    for (let s = 0; s < parts.seg.length; s++) {
      const bar = parts.seg[s]!;
      const seg = mix[s];
      if (!seg) {
        if (bar.style.display !== 'none') bar.style.display = 'none';
        continue;
      }
      bar.style.display = 'block';
      bar.style.width = `${(seg.count / total) * 100}%`;
      if (bar.style.background !== seg.color) bar.style.background = seg.color;
    }
    parts.mix.style.display = 'flex';
    // The unwell count, in the worst condition's own colour. `conditionMix`
    // already orders the segments by the legend, which puts `well` first, so
    // everything after it is what this chip is withholding.
    const unwell = mix.filter((m) => m.word !== 'well');
    const ills = unwell.reduce((n, m) => n + m.count, 0);
    if (ills === 0) {
      if (parts.ill.style.display !== 'none') parts.ill.style.display = 'none';
    } else {
      parts.ill.style.display = 'inline';
      const worst = unwell[unwell.length - 1]!;
      const text = `${ills}`;
      if (parts.ill.textContent !== text) parts.ill.textContent = text;
      if (parts.ill.style.color !== worst.color) parts.ill.style.color = worst.color;
      parts.ill.title = unwell.map((m) => `${m.count} ${m.word}`).join(' · ');
    }
    const chip = parts.num.parentElement;
    if (this.highlight === null) {
      if (parts.badge.style.display !== 'none') parts.badge.style.display = 'none';
      if (chip && chip.style.opacity !== '') chip.style.opacity = '';
      return;
    }
    // A crowd with nothing in it recedes with the rest of the frame and drops
    // the badge entirely: a hollow "0" welded to the right of "17" reads as the
    // number one hundred and seventy at a glance, which is the one thing a
    // count chip may never be misread as.
    if (chip) chip.style.opacity = matched > 0 ? '1' : '0.42';
    if (matched === 0) {
      if (parts.badge.style.display !== 'none') parts.badge.style.display = 'none';
      return;
    }
    parts.badge.style.display = 'inline';
    const text = `${matched}`;
    if (parts.badge.textContent !== text) parts.badge.textContent = text;
  }

  private updateLabels(now: number): void {
    if (this.labelNodes.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const budget = labelBudgetFor(this.band);

    // NEAR is re-chosen every frame and every other band a few times a second.
    // A set that churns at 60 Hz is a set nobody can read — but NEAR's claim is
    // now "the k NEAREST readable beings", and a claim measured from a list
    // that is a quarter of a second out of date is a claim about where people
    // used to be. At NEAR there are at most a few score beings in frame and the
    // list is a sort; everywhere else the old cadence stands.
    const nearest = this.band === 'near';
    if (nearest || now - this.lastLabelPick > 240 || (this.hoveredId !== null && !this.labelPicked.includes(this.hoveredId))) {
      this.lastLabelPick = now;
      // Nearest to WHAT THE VIEW IS LOOKING AT, which is the distance the card,
      // the roster and the printed radius are all in. Ranking by the eye and
      // measuring the claim from the target put eight names outside their own
      // radius in three of five NEAR frames.
      const aim = this.aimGround();
      const near: { k: number; d: number }[] = [];
      for (let k = 0; k < this.screenPoints.length; k++) {
        const i = this.screenIndex[k]!;
        const dx = this.beingPos[i * 3]! - aim.x;
        const dy = this.beingPos[i * 3 + 1]! - aim.y;
        const dz = this.beingPos[i * 3 + 2]! - aim.z;
        near.push({ k, d: dx * dx + dy * dy + dz * dz });
      }
      this.labelCandidates = [];
      if (nearest) {
        // NEAR's whole rule, and there is nothing else in it: the k nearest
        // READABLE beings, in order, out to the furthest the band ever looks.
        // No rank, no exceptions — not the selected being, not the hovered one,
        // not a filter match. Every exception was a name drawn past a nearer
        // person who had none, and five of those in one frame is what made
        // round eight's naming strip a lie. The selected being has a gold ring,
        // a beam, the selection bar and its own row; it does not also need to
        // break the one sentence this band prints.
        const reach = NEAR_LABEL_M * NEAR_LABEL_M;
        near.sort((a, b) => a.d - b.d || this.ids[this.screenIndex[a.k]!]! - this.ids[this.screenIndex[b.k]!]!);
        for (const { k, d } of near) {
          if (this.labelCandidates.length >= budget) break;
          if (d > reach) break;
          const i = this.screenIndex[k]!;
          if (!this.nameReadable(i) || this.nameCarried(i)) continue;
          const id = this.ids[i]!;
          this.labelCandidates.push({
            id, x: this.screenPoints[k]!.x, y: this.screenPoints[k]!.y,
            rank: this.labelCandidates.length, text: this.labelTextFor(i, id),
          });
        }
      } else {
        // Rank first, distance second. Sorting by distance alone and then
        // taking the head of the list loses the selected being the moment it is
        // not one of the nearest — which is most of the time, and is the one
        // name that must never be missing out here, where the band promises
        // names "where there is room" and says so.
        // A being that answers the filter's question outranks the rest of the
        // frame: "find the elder who is speaking" is answered by a halo you can
        // see and a name you can read, not by a halo you then have to hover.
        const rankOf = (id: number): number => (id === this.selectedId ? 0
          : id === this.hoveredId ? 1
            : this.kinSet.has(id) || this.bondSet.has(id) ? 2
              : this.highlight?.has(id) ? 3 : 4);
        near.sort((a, b) => {
          const ra = rankOf(this.ids[this.screenIndex[a.k]!]!);
          const rb = rankOf(this.ids[this.screenIndex[b.k]!]!);
          return ra === rb ? a.d - b.d : ra - rb;
        });
        for (const { k } of near) {
          if (this.labelCandidates.length >= budget * 2 + 6) break;
          const i = this.screenIndex[k]!;
          const id = this.ids[i]!;
          // The specimen is read with the probes and nothing else. A name over
          // a synthetic being would hand the reader the answer to the question
          // the specimen exists to ask.
          if (isSpecimenId(id)) continue;
          const rank = rankOf(id);
          // At FAR the contract is how many, where, and which one is selected.
          // A handful of names scattered over a continent is not an answer to
          // any of those, and the legend out there does not offer one.
          if (this.band === 'far' && rank > 1) continue;
          // A name over a being the view has folded into a crowd's number
          // points at ground where nothing is drawn — and that stays true of a
          // match, which draws no halo inside a chip either.
          if (rank >= 3 && bandCountsBeings(this.band) && this.beingCrowded[i] === 1) continue;
          // And a being whose ring a shelter's chip is carrying has no mark of
          // its own to point at: the chip over the roof is its one label.
          if (this.beingInside[i] === 1 && rank > 1) continue;
          const top = this.beingTop[i]!;
          if (rank === 4 && this.terrainHides(this.beingPos[i * 3]!, top, this.beingPos[i * 3 + 2]!)) continue;
          this.labelCandidates.push({ id, x: this.screenPoints[k]!.x, y: this.screenPoints[k]!.y, rank, text: this.labelTextFor(i, id) });
        }
      }
      this.labelPicked = this.labelCandidates.map((c) => c.id);
    }

    // Positions are refreshed every frame — the SET is what is held steady, not
    // where the names sit, or they would drift off their beings while orbiting.
    // A being that has died since the set was chosen drops out here rather than
    // leaving its name hanging over the ground for a quarter of a second.
    let live = 0;
    for (const c of this.labelCandidates) {
      const i = this.indexOf(c.id);
      if (i < 0) continue;
      this.probe.set(this.beingPos[i * 3]!, this.beingTop[i]!, this.beingPos[i * 3 + 2]!);
      this.probe.project(this.camera);
      if (this.probe.z > 1) continue;
      c.x = ((this.probe.x + 1) / 2) * w;
      c.y = ((1 - this.probe.y) / 2) * h;
      c.text = this.labelTextFor(i, c.id);
      this.labelCandidates[live++] = c;
    }
    this.labelCandidates.length = live;

    // Close in, a name may not land on anybody — not on its own being, and not
    // on the neighbour it would then appear to belong to. The beings themselves
    // become obstacles, which is only affordable once there are few enough of
    // them on screen to matter, which is exactly the band where it matters.
    this.bodyRects.length = 0;
    for (const rect of this.chipRects) this.bodyRects.push(rect);
    // The band strip is chrome, and a name that lands on it reads as part of
    // the caption — a reviewer found a "Selar" pill sitting in the middle of
    // one. Its box is measured when its text changes, not every frame.
    if (this.bandW > 0) {
      this.bodyRects.push({ x0: 8, y0: h - 14 - this.bandH, x1: 16 + this.bandW, y1: h - 6 });
    }
    if (bandShowsDetail(this.band) && this.screenPoints.length <= 140) {
      for (let k = 0; k < this.screenPoints.length; k++) {
        const p = this.screenPoints[k]!;
        const i = this.screenIndex[k]!;
        // A PERSON's box, not a square of their own height. Round five's first
        // NEAR frame reserved a 170 × 170 px block around every being, which
        // covered the air over its head, so eighteen names competed for the
        // slots between bodies and three of them landed. A being is about a
        // fifth as wide as it is tall, and its name goes ABOVE it — so the box
        // stops at the head and the slots over it are free.
        const tall = Math.max(this.markerPixelsOf(i), 8);
        const half = Math.max(5, tall * 0.22);
        this.bodyRects.push({ x0: p.x - half, y0: p.y - tall * 0.58, x1: p.x + half, y1: p.y + tall * 0.55 });
      }
    }
    const placed = placeLabels(
      this.labelCandidates, w, h, budget, this.bodyRects,
      labelClearanceFor(this.band, this.bandPx),
      maxLeaderFor(this.band),
      nearest,
    );
    this.labelShown.length = 0;
    this.placedIds.clear();
    for (let n = 0; n < this.labelNodes.length; n++) {
      const node = this.labelNodes[n]!;
      const leader = this.leaderNodes[n]!;
      const lab = placed[n];
      if (!lab) {
        if (node.style.display !== 'none') node.style.display = 'none';
        if (leader.style.display !== 'none') leader.style.display = 'none';
        continue;
      }
      const name = displayName(lab.id, this.names.get(lab.id));
      if (node.textContent !== lab.text) node.textContent = lab.text;
      const cls = `wlabel${name.selfChosen ? ' named' : ''}${lab.id === this.selectedId ? ' sel' : ''}`;
      if (node.className !== cls) node.className = cls;
      node.style.display = 'block';
      node.style.transform = `translate(-50%, -100%) translate(${Math.round(lab.x)}px, ${Math.round(lab.y)}px)`;
      // A name that had to move to find room says where it came from.
      if (lab.leader) {
        const dx = lab.ax - lab.x;
        const dy = lab.ay - lab.y;
        leader.style.display = 'block';
        leader.style.width = `${Math.round(Math.hypot(dx, dy))}px`;
        leader.style.transform = `translate(${Math.round(lab.x)}px, ${Math.round(lab.y)}px) rotate(${Math.atan2(dy, dx)}rad)`;
      } else if (leader.style.display !== 'none') {
        leader.style.display = 'none';
      }
      this.labelShown.push(name.text);
      this.placedIds.add(lab.id);
    }
    this.auditNames();
  }

  /**
   * Whether a reader could READ this being off the frame well enough for the
   * naming rule to owe it a name.
   *
   * One definition, used by the rule that CHOOSES the names and by the audit
   * that scores them — which is the whole point. Round eight chose candidates
   * by rank and audited them against a cheaper readability test, and the two
   * populations disagreed so badly that a frame could name four people while
   * reporting that its radius contained none of them.
   *
   * A being whose ring a shelter's chip is carrying is not readable HERE, on
   * purpose: it has no mark of its own, the chip over the roof is its one
   * label, and a name pointing into a hut full of people names nobody.
   */
  private nameReadable(i: number): boolean {
    if (this.beingOnScreen[i] !== 1) return false;
    if (isSpecimenId(this.ids[i]!)) return false;
    if (this.isCollapsed(i)) return false;
    if (this.markerPixelsOf(i) < READABLE_MARK_PX) return false;
    if (this.terrainHides(this.beingPos[i * 3]!, this.beingTop[i]!, this.beingPos[i * 3 + 2]!)) return false;
    return this.nameAnchorRoom(i);
  }

  /**
   * Whether there is anywhere on the canvas to PUT this being's name.
   *
   * A name hangs off the head, and at NEAR a being is two hundred pixels tall —
   * the one standing closest to the camera often has its head above the top
   * edge, or its feet below the bottom one. With "nearest first, and the first
   * one that cannot be labelled ends the list", such a being would end every
   * list at zero: seven NEAR frames in eight came back with no names at all.
   *
   * That is not the collision the rule is about. A being whose name has nowhere
   * on the frame to go is not one this frame can name, so it is not one the
   * frame OWES a name — and the being behind it is named instead. A collision
   * with another label or another body still stops the list, which is the rule.
   */
  private nameAnchorRoom(i: number): boolean {
    this.probe.set(this.beingPos[i * 3]!, this.beingTop[i]!, this.beingPos[i * 3 + 2]!).project(this.camera);
    if (this.probe.z > 1) return false;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const x = ((this.probe.x + 1) / 2) * w;
    const y = ((1 - this.probe.y) / 2) * h;
    // One label's height plus the band's own clearance above the head, and a
    // name's half-width to either side.
    const up = labelClearanceFor(this.band, this.bandPx) + LABEL_HEIGHT_PX;
    return x > 30 && x < w - 30 && y > up + 2 && y < h - 2;
  }

  /** Whether a BUILDING's chip is this being's label this frame. */
  private nameCarried(i: number): boolean {
    return this.beingInside[i] === 1;
  }

  /**
   * What the naming actually did this frame — see `namePlan`.
   *
   * Nothing here decides anything. The rule is in `updateLabels`, the
   * invariant is `violations`, and this reads the result off the DOM list the
   * budgeter produced, so the strip, the probe and the picture are three
   * readings of one act rather than three claims about it.
   */
  private auditNames(): void {
    this.namesExpected = this.placedIds.size;
    this.nameSubjects.length = 0;
    this.namesCarriedUnwell = 0;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      const id = this.ids[i]!;
      if (isSpecimenId(id)) continue;
      if (this.nameCarried(i) && conditionWord(this.beingCond[i]!, this.beingAct[i]!) !== 'well') {
        this.namesCarriedUnwell++;
      }
      this.nameSubjects.push({
        // From the ground the camera is LOOKING at — the same metres the card
        // and the roster print, and the same ones `updateLabels` orders the
        // candidates by. One metric, everywhere.
        distance: this.aimDistanceTo(i),
        readable: this.nameReadable(i),
        carried: this.nameCarried(i),
        named: this.placedIds.has(id),
      });
    }
    const plan = namePlan(this.nameSubjects, this.band === 'near');
    this.namedWithin = plan.withinM;
    this.namesWithin = plan.within;
    this.nameViolations = plan.violations;
    this.namesOutOfOrder = plan.outOfOrder;
    this.namesCarried = plan.carried;
  }

  /**
   * The one sentence the view makes about names — and the exact words the band
   * chip prints, so the chip, the probe and the legend cannot say three
   * different things.
   */
  private nameClaim(): string {
    return nameClaimFor(this.band, this.namedWithin, this.labelShown.length, this.namesCarried, this.namesCarriedUnwell);
  }

  /**
   * The naming, measured. `claim` is the band chip's own words, letter for
   * letter; `expected` is how many names the budgeter placed and `shown` is how
   * many are on screen — they are the same number or the view is lying.
   * `withinM` is how far the furthest name reached, in the metres the strip
   * prints, and `within` is how many READABLE beings that covers — the same
   * number as `shown` at NEAR, because at NEAR the names go to the nearest
   * readable beings and stop. `violations` is the invariant itself: readable
   * beings left unnamed while somebody further away was named.
   */
  labelAudit(): {
    claim: string; withinM: number; expected: number; shown: number; within: number;
    violations: number; outOfOrder: number; carried: number; carriedUnwell: number;
  } {
    return {
      claim: this.nameClaim(),
      withinM: this.namedWithin,
      expected: this.namesExpected,
      shown: this.labelShown.length,
      within: this.namesWithin,
      violations: this.nameViolations,
      outOfOrder: this.namesOutOfOrder,
      carried: this.namesCarried,
      carriedUnwell: this.namesCarriedUnwell,
    };
  }

  private labelTextFor(i: number, id: number): string {
    const name = displayName(id, this.names.get(id));
    return id === this.selectedId || id === this.hoveredId
      ? `${name.text} · ${stageWord(this.beingStage[i]!)} · ${describeState(this.beingAct[i]!, this.beingCond[i]!)}`
      : name.text;
  }

  // ── Comprehension: the table, the card, the crowd ──────────────────────────

  /**
   * Every being the view is holding, as a table row.
   *
   * One pass, no queries, nothing allocated per being beyond the row itself —
   * the shell asks for this a few times a second and hands it straight to a
   * virtualized table, so it has to be cheap enough to be uninteresting.
   *
   * `distance` is measured from the GROUND THE CAMERA IS LOOKING AT rather than
   * from the eye — see `aimDistanceTo`. "How far is this one from where I am"
   * is the question a researcher orbiting a settlement is actually asking, the
   * eye is often a kilometre behind the thing it is pointed at, and this is the
   * same number the card prints and the naming radius is measured in.
   */
  rosterRows(): RosterRow[] {
    const out: RosterRow[] = new Array<RosterRow>(this.instanceCount);
    const aim = this.aimGround();
    const ax = aim.x;
    const ay = aim.y;
    const az = aim.z;
    for (let i = 0; i < this.instanceCount; i++) {
      const id = this.ids[i]!;
      const act = this.beingAct[i]!;
      const cond = this.beingCond[i]!;
      const stage = this.beingStage[i]!;
      const name = displayName(id, this.names.get(id));
      const on = this.headingOnScreenAt(i);
      const dx = this.beingPos[i * 3]! - ax;
      const dy = this.beingPos[i * 3 + 1]! - ay;
      const dz = this.beingPos[i * 3 + 2]! - az;
      out[i] = {
        id,
        name: name.text,
        selfChosen: name.selfChosen,
        stage,
        stageWord: stageWord(stage),
        cond,
        condWord: conditionWord(cond, act),
        act,
        actWord: activityWord(act),
        headingDeg: on.deg,
        headingWord: on.word,
        hunger: this.beingHunger[i]!,
        rest: this.beingRest[i]!,
        distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
        inFrame: this.beingOnScreen[i] === 1,
        visible: this.isVisible(id),
      };
    }
    return out;
  }

  /**
   * Everything the hover card shows about one being — what it is, what it is
   * doing, what it is TRYING to do, and how readable the frame is for it.
   *
   * The goal is the engine's own plan step rather than an inference from the
   * activity: "walking" and "walking to the river to drink" are answers to
   * different questions, and the second is the one an agent-based model is for.
   */
  hoverCardFor(id: number): {
    id: number; name: string; selfChosen: boolean;
    stage: string; condition: string; activity: string;
    heading: string; headingDeg: number;
    goal: string | null; planAt: number; planOf: number;
    hunger: number; rest: number;
    distance: number; inFrame: boolean; visible: boolean; crowded: boolean;
    marksHeld: boolean; specimen: boolean;
    mark: { x: number; y: number; r: number } | null;
  } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const act = this.beingAct[i]!;
    const cond = this.beingCond[i]!;
    const name = displayName(id, this.names.get(id));
    const on = this.headingOnScreenAt(i);
    const specimen = isSpecimenId(id);
    return {
      id,
      name: name.text,
      selfChosen: name.selfChosen,
      stage: stageWord(this.beingStage[i]!),
      condition: conditionWord(cond, act),
      activity: activityWord(act),
      heading: on.word,
      headingDeg: on.deg,
      goal: specimen ? null : goalWord(this.beingGoal[i]!),
      planAt: this.beingPlanAt[i]!,
      planOf: this.beingPlanOf[i]!,
      hunger: this.beingHunger[i]!,
      rest: this.beingRest[i]!,
      // The same metres the roster prints and the naming radius is measured in
      // — from the ground the view is looking at. See `aimDistanceTo`.
      distance: this.aimDistanceTo(i),
      inFrame: this.beingOnScreen[i] === 1,
      visible: this.isVisible(id),
      crowded: this.isCollapsed(i),
      marksHeld: this.beingMarkClear[i] === 0,
      specimen,
      // Where this being is on the screen, and how much room it takes — so the
      // card can sit beside its subject instead of on top of it.
      mark: this.markBoxOf(i),
    };
  }

  /**
   * The being's own patch of screen, in client coordinates.
   *
   * The BODY's middle, deliberately — this is what the hover card sits clear
   * of, and a card placed off the mark at the feet would sit over the figure it
   * is describing. `screenPositionOf` answers the other question ("where do I
   * point") and the two are different points in the close bands.
   */
  private markBoxOf(i: number): { x: number; y: number; r: number } | null {
    if (this.beingOnScreen[i] !== 1) return null;
    const at = this.bodyScreenPositionOf(this.ids[i]!) ?? this.screenPositionOf(this.ids[i]!);
    if (!at) return null;
    return { x: at.x, y: at.y, r: Math.max(8, this.markerPixelsOf(i) * 0.5) };
  }

  /**
   * What is inside one crowd chip: how many, of what condition, doing what.
   *
   * A number over a settlement answers "how many" and refuses every other
   * question. The stacked bar under it answers "in what state", the hover list
   * answers "doing what", and clicking it takes you there — so a crowd stops
   * being the place where this instrument gives up.
   */
  chipSummary(cluster: number): {
    cluster: number; count: number; matched: number; inside: boolean; unwell: number;
    mix: MixSegment[]; activities: { word: string; count: number }[]; ids: number[];
    names: { id: number; name: string; condition: string }[];
  } | null {
    const cl = this.clusters[cluster];
    if (!cl) return null;
    const members: { cond: number; act: number; actWord: string }[] = [];
    const ids: number[] = [];
    const names: { id: number; name: string; condition: string }[] = [];
    let matched = 0;
    let unwell = 0;
    for (const m of cl.members) {
      const i = this.screenIndex[m];
      if (i === undefined) continue;
      const act = this.beingAct[i]!;
      const id = this.ids[i]!;
      const condition = conditionWord(this.beingCond[i]!, act);
      members.push({ cond: this.beingCond[i]!, act, actWord: activityWord(act) });
      ids.push(id);
      // With the condition beside it: the occupants of a shelter are not drawn
      // with rings of their own, so this list is the only place a reader can
      // find out WHICH of them is the one the chip's notch is counting.
      names.push({ id, name: displayName(id, this.names.get(id)).text, condition });
      if (condition !== 'well') unwell++;
      if (this.highlight?.has(id)) matched++;
    }
    return {
      cluster,
      count: cl.count,
      matched,
      unwell,
      // Who they are, in the order the chip counts them — the occupants of a
      // shelter have no name drawn over them, so this is where their names are.
      names,
      // Whether this chip is a crowd on open ground or the people inside a
      // building — the card says which, because "6 together" and "6 in this
      // shelter" are different facts about the same picture.
      inside: cluster < this.insideCount,
      mix: conditionMix(members),
      activities: groupByActivity(members),
      ids,
    };
  }

  /** Pull the camera back to frame one crowd, whole, with a margin around it. */
  zoomToCluster(cluster: number): boolean {
    const cl = this.clusters[cluster];
    if (!cl) return false;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    let spread = 0;
    for (const m of cl.members) {
      const i = this.screenIndex[m];
      if (i === undefined) continue;
      x += this.beingPos[i * 3]!;
      y += this.beingPos[i * 3 + 1]!;
      z += this.beingPos[i * 3 + 2]!;
      n++;
    }
    if (n === 0) return false;
    x /= n;
    y /= n;
    z /= n;
    for (const m of cl.members) {
      const i = this.screenIndex[m];
      if (i === undefined) continue;
      spread = Math.max(spread, Math.hypot(this.beingPos[i * 3]! - x, this.beingPos[i * 3 + 2]! - z));
    }
    // Far enough out that the whole gathering fits with room around it, and
    // never closer than the orbit's own floor.
    const back = Math.max(this.controls.minDistance * 2, (spread + 6) / Math.tan((this.camera.fov * Math.PI) / 360) * 1.25);
    this.camera.getWorldDirection(this.fwd);
    this.controls.target.set(x, y + 1.2, z);
    this.camera.position.set(x - this.fwd.x * back, y + back * 0.52, z - this.fwd.z * back);
    this.keepAboveGround();
    this.lastInput = performance.now();
    return true;
  }

  /** Glide the camera onto one being without changing what is selected. */
  centreOn(id: number): boolean {
    if (this.indexOf(id) < 0) return false;
    this.focusUntil = performance.now() + 1400;
    this.lastInput = performance.now();
    return true;
  }

  /**
   * Where the chips are on screen right now, with enough on each to draw a
   * badge beside it — what the shell needs to put a hover target over one.
   *
   * CLIENT coordinates: this point is where a mouse has to go to open the
   * chip's card. Round eight returned canvas-local ones from here while
   * `pickAtScreen` and `screenPositionOf` were client, and a reviewer driving
   * the real mouse to the chip's own reported point landed 113 px away — the
   * canvas origin — and opened nothing at all.
   */
  chipsOnScreen(): { cluster: number; x: number; y: number; count: number; halfW: number; halfH: number; clear: boolean; inside: boolean }[] {
    const out: { cluster: number; x: number; y: number; count: number; halfW: number; halfH: number; clear: boolean; inside: boolean }[] = [];
    for (let c = 0; c < this.clusters.length; c++) {
      const node = this.countNodes[c];
      if (!node || node.style.display === 'none') continue;
      const at = this.toClient(this.chipAt[c * 2]!, this.chipAt[c * 2 + 1]!);
      out.push({
        cluster: c,
        x: at.x,
        y: at.y,
        count: this.clusters[c]!.count,
        halfW: this.chipHalf[c * 2]!,
        halfH: this.chipHalf[c * 2 + 1]!,
        clear: this.chipClear[c] === 1,
        inside: c < this.insideCount,
      });
    }
    return out;
  }

  // ── Probes (read-only, for drivers) ────────────────────────────────────────

  get notDrawn(): { beings: number; wildlife: number } {
    return { beings: this.hiddenBeings, wildlife: this.hiddenWildlife };
  }

  drawnIds(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.instanceCount; i++) out.push(this.ids[i]!);
    return out;
  }

  /**
   * Whether a human being could actually READ this being off the frame, and
   * why not when they could not.
   *
   * This is the probe round four was missing, and the missing probe is what
   * every MID and NEAR failure came down to: sixteen of twenty-nine targets had
   * three body pixels or fewer where `screenPositionOf` said they were, while
   * `stageShownOf` and `conditionShownOf` answered for all twenty-nine. The
   * view was scoring a reader against marks that were not in the picture.
   *
   * Four ways to be unreadable, and the view names which one:
   *   · not in the frustum at all;
   *   · a crowd's number is standing in for it (the band said it would);
   *   · drawn smaller than `READABLE_MARK_PX`, the far side of the valley;
   *   · behind the land, in a band whose x-ray is too coarse to carry it.
   *
   * Scenery is deliberately absent from that list, and that is a claim, not an
   * omission: every being on this list is a SUBJECT, so a tree or a hut in
   * front of one is ghosted by construction (`updateSubjects`), and whatever
   * the ghosting misses the x-ray silhouette carries. If a reviewer finds a
   * being on this list with no pixels, the bug is here and the probe is wrong —
   * which is exactly the failure this is built to make visible.
   *
   * The fifth way is no longer a RULE. `coveredBy` used to come from a second
   * geometry — boxes, depth order, an overlap fraction — run beside the picker
   * and asked the same question in different words. It disagreed with the
   * picker about four beings on one pixel in round six, two in a hundred in
   * round seven and four in a hundred and forty-eight in round eight, and every
   * tightening left a smaller residue rather than none. So the picker IS the
   * answer now: this being is offered if and only if `pickAtScreen` at the
   * point this view reports it at hands back this being. See `offersAtOwnPoint`.
   */
  visibilityOf(id: number): {
    visible: boolean; markPx: number; bodyPx: number; inFrame: boolean; collapsed: boolean;
    behindLand: boolean; coveredBy: number | null; carriedBy: number | null; reason: string;
  } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const inFrame = this.beingOnScreen[i] === 1;
    const markPx = this.markerPixelsOf(i);
    const bodyPx = this.bodyPixelsOf(i);
    const collapsed = this.isCollapsed(i);
    // A shelter's occupant is not offered under the pointer at all — the chip
    // on its roof is, and the chip's card names every one of them and selects
    // the one a reader clicks. See `offeredUnderPointer`.
    const chip = this.insideChipOf.get(id) ?? null;
    // In a band that promises stage, activity, condition and heading, the
    // channel is carried by the BODY. A pin holds its size on screen forever;
    // a body does not, and the far side of the valley is ten pixels of person
    // under a twenty-four pixel pin. See DETAIL_MIN_PX.
    const tooSmallForDetail = bandShowsDetail(this.band) && bodyPx < DETAIL_MIN_PX;
    const behindLand = inFrame
      && this.terrainHides(this.beingPos[i * 3]!, (this.beingPos[i * 3 + 1]! + this.beingTop[i]!) * 0.5, this.beingPos[i * 3 + 2]!);
    // The x-ray only draws where a body is big enough to be a picture; out
    // wide the pin carries the being instead, and the pin is drawn over the
    // world rather than inside it.
    const carried = !bandShowsDetail(this.band) || bodyPx >= XRAY_MIN_BODY_PX;
    const drawnReason = !inFrame ? 'out of frame'
      : collapsed ? 'counted by a crowd chip'
        // Indoors, and hidden by the building it is indoors in. Reachable —
        // the roof chip's card names every occupant and a click on a name
        // selects that one — but not pointable in the picture, because there
        // is nothing of it in the picture to point at. See `planInside`.
        : chip !== null ? 'indoors, counted on its shelter’s roof'
          : markPx < READABLE_MARK_PX ? 'drawn too small to read'
            : tooSmallForDetail ? 'smaller than the band draws detail at'
              : behindLand && !carried ? 'behind the land, too small to x-ray'
                : null;
    // And then the picker, which is the last word. `null` here means it handed
    // back this being; a number means it handed back somebody else first; and a
    // being the picker finds nothing at is not offered either, whatever the
    // view believes it drew.
    let coveredBy: number | null = null;
    let unpointable = false;
    if (drawnReason === null) {
      const first = this.offersAtOwnPoint().get(id);
      if (first === undefined || first === null) unpointable = true;
      else if (first !== id) coveredBy = first;
    }
    const reason = drawnReason
      ?? (coveredBy !== null ? 'behind another being'
        : unpointable ? 'nothing is drawn where the view reports it'
          : 'visible');
    // Not owed a name: a building's chip is this being's label, and the naming
    // rule's "nearest first" is over the beings that are not on one. A reader
    // checking that invariant has to be able to tell which those are, and the
    // band strip prints how many there are.
    return { visible: reason === 'visible', markPx, bodyPx, inFrame, collapsed, behindLand, coveredBy, carriedBy: chip, reason };
  }

  /**
   * What the PICKER answers at every drawn being's own reported point — one
   * pass, cached for the frame it was measured in.
   *
   * This is the definition of "offered", not a check on it. A driver asks
   * `visibleIds()` for targets and then drives the mouse to `screenPositionOf`
   * of each; both ends of that sentence are now the same call, so the two
   * cannot disagree.
   *
   * Only beings the frame already says it DREW are probed — a being folded into
   * a chip or drawn at four pixels is refused before the picker is bothered, so
   * the cost is the readable population and not the frustum.
   */
  private offersAtOwnPoint(): Map<number, number | null> {
    if (this.offerFrame === this.rendered) return this.offerFirst;
    this.offerFrame = this.rendered;
    this.offerFirst.clear();
    const boxes = this.bodyBoxes();
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (this.isCollapsed(i)) continue;
      if (this.markerPixelsOf(i) < READABLE_MARK_PX) continue;
      if (bandShowsDetail(this.band) && this.bodyPixelsOf(i) < DETAIL_MIN_PX) continue;
      const p = this.screenPoints[k]!;
      if (!offeredUnderPointer(this.insideChipOf.get(p.id) ?? null)) continue;
      const at = this.toClient(p.x, p.y);
      const own = this.pickAt(at.x, at.y)[0]?.id ?? null;
      // A press is a neighbourhood, not a pixel. Where somebody ELSE's drawn
      // body reaches this point, the winner has to hold for a couple of pixels
      // either side of it or this being is not offered at all: round five's two
      // mispicks in 389 were both beings whose winner flipped between a reader
      // reading the offer and pressing the mouse on it.
      //
      // Only where there is a competitor. In the open — which is most of every
      // frame — one pick is the whole cost, and the margin is four more raycasts
      // for the handful of beings standing in a pile.
      let contested = false;
      for (const box of boxes) {
        if (box.id === p.id) continue;
        if (p.x >= box.x0 - OFFER_MARGIN_PX && p.x <= box.x1 + OFFER_MARGIN_PX
          && p.y >= box.y0 - OFFER_MARGIN_PX && p.y <= box.y1 + OFFER_MARGIN_PX) { contested = true; break; }
      }
      if (!contested || own === null) {
        this.offerFirst.set(p.id, own);
        continue;
      }
      const m = OFFER_MARGIN_PX;
      this.offerFirst.set(p.id, steadyWinner([
        own,
        this.pickAt(at.x - m, at.y)[0]?.id ?? null,
        this.pickAt(at.x + m, at.y)[0]?.id ?? null,
        this.pickAt(at.x, at.y - m)[0]?.id ?? null,
        this.pickAt(at.x, at.y + m)[0]?.id ?? null,
      ]));
    }
    return this.offerFirst;
  }

  /**
   * Every drawn being's patch of screen, in canvas pixels, rebuilt once per
   * frame however many times it is asked for — `visibleIds()` asks once per
   * being, and three hundred rebuilds of three hundred boxes is the kind of
   * quadratic a probe has no business being.
   */
  private bodyBoxes(): BodyBox[] {
    if (this.boxFrame === this.rendered) return this.boxes;
    this.boxFrame = this.rendered;
    this.boxes = [];
    this.boxById.clear();
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (this.isCollapsed(i)) continue;
      const p = this.screenPoints[k]!;
      const depth = this.distanceTo(i);
      const scale = depth * this.worldPerPx;
      if (scale <= 0) continue;
      const bodyPx = stageForm(this.beingStage[i]!).scale / scale;
      // Measured, not inferred: `screenFootY` is the ground point this being
      // stands on, projected in the same pass as its mark.
      const feet = this.screenFootY[k]!;
      const lying = this.beingAct[i] === ACT_RESTING;
      // The figure at the WIDEST its act can be posed — never the pitch drawn
      // this instant. A box narrower than the silhouette is a box the picker's
      // ray reaches outside of; a box that follows the animation is a box that
      // moves while a reader aims at it, which is the round-five defect. The
      // widest pose is both: it always contains the drawn figure, and it does
      // not change until the being changes what it is doing. See `poseLean`.
      const halfW = Math.max(3, bodyPx * figureSpread(this.beingPose[i]!, lying));
      const high = lying ? bodyPx * 0.34 : bodyPx;
      // Too small to be a figure: the mark is all there is of it, and the box
      // is empty so nothing claims a body was drawn here.
      const hasBody = bodyPx >= 4;
      const box = {
        id: p.id,
        // The point the view reports for this being — the same one
        // `screenPositionOf` returns, which is the entry above.
        x: p.x,
        y: p.y,
        x0: hasBody ? p.x - halfW : p.x,
        y0: hasBody ? feet - high : feet,
        x1: hasBody ? p.x + halfW : p.x,
        y1: hasBody ? feet + bodyPx * 0.06 : feet,
        depth,
      };
      this.boxes.push(box);
      this.boxById.set(box.id, box);
    }
    return this.boxes;
  }

  /** How tall this being's own body stands on screen, in CSS pixels. */
  private bodyPixelsOf(i: number): number {
    return stageForm(this.beingStage[i]!).scale / Math.max(1e-6, this.distanceTo(i) * this.worldPerPx);
  }

  /** Distance from the eye to this being's middle, in metres. */
  private distanceTo(i: number): number {
    const dx = this.beingPos[i * 3]! - this.camera.position.x;
    const dy = (this.beingPos[i * 3 + 1]! + this.beingTop[i]!) * 0.5 - this.camera.position.y;
    const dz = this.beingPos[i * 3 + 2]! - this.camera.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * How far this being is from WHERE THE VIEW IS LOOKING, in metres — the
   * ground under the camera's target.
   *
   * The one distance this view quotes. Round seven had two: the hover card and
   * the roster measured from the target, and the naming rule measured from the
   * EYE, which on an orbit is most of a kilometre further back. The two
   * populations that came out of that disagreed so badly that three NEAR frames
   * printed a radius with nothing readable inside it above eight drawn names —
   * every one of those names true, and the sentence under them false.
   *
   * The target's own `y` is not it either: the aim rides above the ground while
   * the camera pitches, and "how far is that person from what I am looking at"
   * is a question about the ground. So the ground under the aim, always.
   */
  private aimDistanceTo(i: number): number {
    const aim = this.aimGround();
    const dx = this.beingPos[i * 3]! - aim.x;
    const dy = this.beingPos[i * 3 + 1]! - aim.y;
    const dz = this.beingPos[i * 3 + 2]! - aim.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** The ground point the camera is aiming at — one per frame, reused. */
  private aimGround(): THREE.Vector3 {
    const aim = this.controls.target;
    return this.aimPoint.set(aim.x, this.surfaceAt(aim.x + HALF, aim.z + HALF), aim.z);
  }

  /**
   * Every being a reader could actually find in this frame — the only honest
   * population for a stranger test to draw its targets from.
   *
   * On demand, never per frame: it costs a terrain march per candidate, which
   * is nothing when a driver asks for it once and would be silly sixty times a
   * second.
   */
  visibleIds(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.screenPoints.length; k++) {
      const id = this.screenPoints[k]!.id;
      if (this.visibilityOf(id)?.visible) out.push(id);
    }
    return out;
  }

  private isVisible(id: number): boolean {
    return this.visibilityOf(id)?.visible === true;
  }

  /**
   * Where a reader could aim, this frame — the cheap answer, for the one caller
   * that must not pay for the expensive one.
   *
   * `visibleIds` is DEFINED by the picker and costs a raycast per candidate.
   * An open hover card wants to know which points it must not sit on, and it
   * asks on every pointer move: calling the picker there turned fourteen
   * hover-picks a second into fourteen full offer audits a second, and the view
   * stopped responding to the mouse altogether — measured, in a session whose
   * every reading after camera 27 was of a stranded app.
   *
   * So this is the drawn geometry and nothing else: every being with a mark of
   * its own big enough to read, which is a superset of what is offered and
   * exactly the right answer for "do not cover that".
   */
  aimPoints(): { id: number; x: number; y: number }[] {
    const out: { id: number; x: number; y: number }[] = [];
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (this.isCollapsed(i)) continue;
      if (this.insideChipOf.has(this.ids[i]!)) continue;
      if (this.markerPixelsOf(i) < READABLE_MARK_PX) continue;
      const p = this.screenPoints[k]!;
      const at = this.toClient(p.x, p.y);
      out.push({ id: p.id, x: at.x, y: at.y });
    }
    return out;
  }

  /** What this being is doing and how it is, exactly as the view encoded it. */
  stateOf(id: number): { act: number; cond: number; picto: number; hue: number; ring: number; core: boolean; visible: boolean } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const act = this.beingAct[i]!;
    const cond = this.beingCond[i]!;
    return {
      act,
      cond,
      picto: bandShowsDetail(this.band) ? pictogramFor(act) : PICTO_NONE,
      hue: conditionHue(cond, act),
      ring: ringStyleFor(cond, act),
      core: stageCore(this.beingStage[i]!, this.band),
      visible: this.isVisible(id),
    };
  }

  /**
   * Whether this being has a mark of its own on screen right now — or whether a
   * crowd's number is standing in for it.
   *
   * Everything the picture claims about ONE being is claimed only about the
   * ones that are drawn. A stranger test that picks a being folded into a chip
   * and scores the reader on its condition is scoring them on a mark the frame
   * does not contain.
   */
  private isCollapsed(i: number): boolean {
    return bandCountsBeings(this.band)
      && this.beingCrowded[i] === 1
      && this.ids[i] !== this.selectedId;
  }

  /**
   * The SIM's answers, each one carrying whether the picture could be read for
   * it. The value is the ground truth a score is graded against; `visible` is
   * whether this being belonged in the sample at all.
   */
  stageOf(id: number): { stage: number; word: string; visible: boolean } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { stage: this.beingStage[i]!, word: stageWord(this.beingStage[i]!), visible: this.isVisible(id) };
  }

  /** How this being is — `well`, `starving`, `sick`, `in danger`. */
  conditionOf(id: number): { word: string; visible: boolean } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { word: conditionWord(this.beingCond[i]!, this.beingAct[i]!), visible: this.isVisible(id) };
  }

  /** What this being is doing, as the SIM means it. */
  activityOf(id: number): { word: string; visible: boolean } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { word: activityWord(this.beingAct[i]!), visible: this.isVisible(id) };
  }

  /**
   * What the PICTURE currently says this being is doing — the band's own
   * vocabulary, or `null` where the band promises nothing.
   *
   * This is what a stranger test must be scored against. The sim knows eating
   * from drinking; at forty pixels the view does not, and says so with one mark
   * for both. Scoring a reader against a distinction the picture never drew is
   * marking them wrong for the view's honesty.
   */
  activityShownOf(id: number): string | null {
    const i = this.indexOf(id);
    if (i < 0 || !this.isVisible(id)) return null;
    // In a crowd the pictogram is withheld, so the picture no longer says what
    // this being is doing and must not be scored as though it did. Standing and
    // walking survive: they were never carried by a chip, only by the streak on
    // the ground behind the being, which cannot point at a neighbour.
    //
    // Three ways it can be withheld — a crowded ring, a stack of badges, a
    // figure too small for the band to draw detail on — and all three have to
    // be here, or the probe answers for a mark that is not in the frame.
    if (pictogramFor(this.beingAct[i]!) !== PICTO_NONE
      && (this.beingMarkClear[i] === 0 || this.beingPictoClear[i] === 0 || !this.badgeDrawn(i))) return null;
    return readableActivity(this.beingAct[i]!, this.band);
  }

  /** The life stage the picture claims, or `null` where the band draws none. */
  stageShownOf(id: number): string | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsDetail(this.band) || !this.isVisible(id)) return null;
    return stageWord(this.beingStage[i]!);
  }

  /**
   * The condition the picture claims, or `null` at FAR, where it claims none —
   * and `null` for anything a reader could not find: a being inside a crowd's
   * number, off the edge of the frame, or drawn too small to carry a ring.
   */
  conditionShownOf(id: number): string | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsBodies(this.band) || !this.isVisible(id)) return null;
    return conditionWord(this.beingCond[i]!, this.beingAct[i]!);
  }

  /** Whether the picture says this being is on the move — the streak channel. */
  movingShownOf(id: number): boolean | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsDetail(this.band) || !this.isVisible(id)) return null;
    return movingFor(this.beingAct[i]!);
  }

  /** Which way this being is facing in the world, in radians, as drawn. */
  headingOf(id: number): { rad: number; visible: boolean } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { rad: this.beingHeading[i]!, visible: this.isVisible(id) };
  }

  /**
   * Which way the wedge under this being POINTS ON SCREEN: degrees clockwise
   * from straight up, and the eight-point name for it.
   *
   * This is the scoreable form of heading. A reader of a screenshot can only
   * say "up and to the left"; whether that is north-west on the continent
   * depends on where the camera is standing, which is not something the picture
   * says. So the view answers in the reader's frame, by projecting the being
   * and a point one marker ahead of it and measuring between them.
   */
  headingOnScreen(id: number): { deg: number; word: string } | null {
    const i = this.indexOf(id);
    // The PICTURE only claims a facing where the band draws one AND the mark
    // was allowed to carry it — in a crowd the arrow is withheld, so the
    // picture says nothing and this must say nothing either. The roster and
    // the hover card still answer, from `headingOnScreenAt`: that is what
    // asking is for.
    if (i < 0 || !bandShowsDetail(this.band) || !this.isVisible(id) || this.beingMarkClear[i] === 0) return null;
    return this.headingOnScreenAt(i);
  }

  /** The facing, measured, whatever the picture is currently willing to claim. */
  private headingOnScreenAt(i: number): { deg: number; word: string } {
    const h = this.beingHeading[i]!;
    const step = this.beingMark[i]! * 0.7;
    const x = this.beingPos[i * 3]!;
    const y = this.beingPos[i * 3 + 1]!;
    const z = this.beingPos[i * 3 + 2]!;
    this.probe.set(x, y, z).project(this.camera);
    const ax = this.probe.x;
    const ay = this.probe.y;
    this.probe.set(x + Math.sin(h) * step, y, z + Math.cos(h) * step).project(this.camera);
    const dx = this.probe.x - ax;
    // Clip space runs up the screen; pixels run down it.
    const dy = -(this.probe.y - ay) * (this.canvas.clientHeight / Math.max(1, this.canvas.clientWidth));
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    return { deg, word: headingOctant(deg) };
  }

  /**
   * How this frame asks to be counted, and whether the arithmetic closes.
   *
   * `pinsDrawn` is how many beings in frame drew a mark of their own; `chips`
   * are the numbers over the crowds that stand in for the rest. The whole
   * countability claim is that `pinsDrawn + Σ chips.n === beingsInFrustum`,
   * and every term here is measured from what the renderer actually wrote this
   * frame, not recomputed from the plan — so a bug that drew a pin under a chip
   * shows up as a mismatch rather than as a reader's error.
   */
  countAudit(): {
    pinsDrawn: number; chips: { n: number; x: number; y: number }[]; beingsInFrustum: number;
    counts: boolean;
    quadrants: { region: number; pins: number; chips: number; counted: number; beings: number; reconciles: boolean }[];
  } {
    const chips: { n: number; x: number; y: number }[] = [];
    for (let c = 0; c < this.clusters.length; c++) {
      const cl = this.clusters[c]!;
      if (this.countNodes[c]?.style.display === 'none') continue;
      // Where the NUMBER sits, in client coordinates — the point a reader reads
      // it at and the point `quadrantAudit` bins it by. Round eight reported the
      // outline's centre here and binned by the disc, so a reviewer checking the
      // quadrant arithmetic with this array was reconciling two different
      // placements.
      const at = this.toClient(this.chipAt[c * 2]!, this.chipAt[c * 2 + 1]!);
      chips.push({ n: cl.count, x: at.x, y: at.y });
    }
    return {
      pinsDrawn: this.pinsDrawn,
      chips,
      beingsInFrustum: this.screenPoints.length,
      counts: bandCountsBeings(this.band),
      quadrants: this.quadrantAudit(),
    };
  }

  /**
   * The same arithmetic, one quarter of the frame at a time.
   *
   * The whole-frame count closed to 0.5% for three rounds while a quadrant
   * count ran −88% to +45%, and the legend grew a clause — "a number only ever
   * counts people in its own part of the frame" — that the placement search was
   * free to break: a disc pushed off a pin walked across a mid-line and carried
   * twenty beings with it. So the clause is a measurement now. `pins` is the
   * beings that drew their own mark in this quadrant, `counted` is the sum of
   * the chips whose DISC sits in it — where a reader reads the number — and
   * `beings` is how many are actually standing there. The three reconcile
   * exactly, in every quadrant, wherever the band promises a count at all.
   */
  private quadrantAudit(): { region: number; pins: number; chips: number; counted: number; beings: number; reconciles: boolean }[] {
    const view = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
    const collapses = bandCountsBeings(this.band);
    const out = [0, 1, 2, 3].map((region) => ({ region, pins: 0, chips: 0, counted: 0, beings: 0, reconciles: false }));
    for (let k = 0; k < this.screenPoints.length; k++) {
      const p = this.screenPoints[k]!;
      const q = out[regionOf(p.x, p.y, view)]!;
      q.beings++;
      const i = this.screenIndex[k]!;
      if (collapses && this.beingCrowded[i] === 1 && p.id !== this.selectedId) continue;
      q.pins++;
    }
    for (let c = 0; c < this.clusters.length; c++) {
      if (this.countNodes[c]?.style.display === 'none') continue;
      const q = out[regionOf(this.chipAt[c * 2]!, this.chipAt[c * 2 + 1]!, view)]!;
      q.chips++;
      q.counted += this.clusters[c]!.count;
    }
    for (const q of out) q.reconciles = q.pins + q.counted === q.beings;
    return out;
  }

  /**
   * Score one reading of a heading against what the dart actually points at.
   *
   * `exact` is the eight-point call; `within1` allows a neighbouring octant,
   * which is the difference between a reader who could not find the mark and
   * one who found it and rounded. Round three's heading misses were ALL exactly
   * one octant out, and with no way to say so the channel could only be scored
   * as a flat 40%.
   */
  headingCheck(id: number, said: string): { truth: string; deg: number; off: number; exact: boolean; within1: boolean } | null {
    const on = this.headingOnScreen(id);
    if (!on) return null;
    const off = octantDistance(said, on.word);
    return { truth: on.word, deg: on.deg, off, exact: off === 0, within1: off >= 0 && off <= 1 };
  }

  /**
   * Somewhere worth standing — the places on this continent where enough beings
   * are together to read a frame's worth of them.
   *
   * A stranger test at MID or NEAR needs ten readable beings in one frame, and
   * finding ten by orbiting a two-kilometre continent by hand is most of the
   * afternoon: round three's MID frames held two. So the view offers the
   * settlements it can see, biggest first, each with the camera placement that
   * puts that settlement at the size the band promises.
   */
  frameCandidates(band: ZoomBand = 'mid'): FrameCandidate[] {
    // Group in the WORLD, not on screen: where a reviewer should GO cannot
    // depend on where the camera happens to be pointing now. The clustering is
    // the same code the crowds use — x and y here are scene x and scene z.
    const flat: ScreenPoint[] = [];
    for (let i = 0; i < this.instanceCount; i++) {
      flat.push({ id: this.ids[i]!, x: this.beingPos[i * 3]!, y: this.beingPos[i * 3 + 2]! });
    }
    // Grouped tight. Round five's first MID candidate was the centroid of a
    // gathering spread over three hundred metres: the camera stood forty
    // metres from the middle of it, and most of "its" eighty-eight beings were
    // a quarter of the band's own size on the far side of a valley. A MID
    // frame is a village from a rooftop, so the groups are village-sized.
    const groups = clusterHierarchy(flat, band === 'near' ? 9 : 18, 4, 14);
    // The distance at which a grown being stands the size this band is about.
    const px = band === 'near' ? 170 : band === 'mid' ? 62 : band === 'default' ? 14 : 0.5;
    const dist = ADULT_M / Math.max(1e-6, px * this.worldPerPx);
    // A three-quarter view, high enough to see into the settlement and low
    // enough that a being is a figure rather than a footprint. Two of them and
    // eight ways round, because the ONE placement round four offered was
    // whatever the arithmetic produced, and what it produced was the inside of
    // a hut three times out of three.
    const pitches = band === 'near' ? [0.10, 0.20, 0.30] : band === 'mid' ? [0.30, 0.42, 0.54] : [0.78, 0.9];
    const eye = band === 'near' ? 1.6 : 0;
    const aim = band === 'near' ? 1.2 : 0;
    const scout = this.scout;
    scout.fov = this.camera.fov;
    scout.aspect = this.camera.aspect;
    scout.near = this.camera.near;
    scout.far = this.camera.far;
    scout.updateProjectionMatrix();
    const out: FrameCandidate[] = [];
    for (const g of groups) {
      const ground = this.surfaceAt(g.x + HALF, g.y + HALF);
      const centre = { x: g.x, y: ground, z: g.y };
      // Aim at open ground. If the centroid of the gathering is inside a
      // building — which is where a gathering of six usually is — the aim is
      // pushed out through the nearest wall rather than planted in it.
      let aimX = centre.x;
      let aimZ = centre.z;
      for (let push = 0; push < 4; push++) {
        if (this.insideStructure(aimX, ground + aim + 1, aimZ, 0.4) <= 0) break;
        const nudge = this.nudgeClear(aimX, ground + aim + 1, aimZ);
        aimX = nudge.x;
        aimZ = nudge.z;
      }
      const target = { x: aimX, y: this.surfaceAt(aimX + HALF, aimZ + HALF) + aim, z: aimZ };
      let best: { cam: { x: number; y: number; z: number }; seen: number } | null = null;
      for (const pitch of pitches) {
        const flatR = dist * Math.cos(pitch);
        const lift = dist * Math.sin(pitch);
        for (let a = 0; a < 8; a++) {
          const theta = (a / 8) * Math.PI * 2;
          const cx = target.x + Math.cos(theta) * flatR;
          const cz = target.z + Math.sin(theta) * flatR;
          const floor = this.surfaceAt(cx + HALF, cz + HALF) + 1.7;
          const cy = Math.max(floor, target.y + lift + eye);
          // Never inside or against a building, and never with its nose in a
          // wall: a camera standing in a hut sees the inside of a hut.
          if (this.insideStructure(cx, cy, cz, 2.2) > 0) continue;
          this.probe.set(cx, cy, cz);
          if (this.terrainHidesFrom(this.probe, target.x, target.y + 1, target.z)) continue;
          scout.position.set(cx, cy, cz);
          scout.up.set(0, 1, 0);
          scout.lookAt(target.x, target.y, target.z);
          scout.updateMatrixWorld(true);
          const seen = this.countVisibleFrom(scout, g.members, px);
          if (!best || seen > best.seen) best = { cam: { x: cx, y: cy, z: cz }, seen };
        }
      }
      if (!best) continue;
      out.push({ count: g.count, visible: best.seen, centre, camera: best.cam, target });
    }
    // Best VIEW first, not biggest crowd first: a gathering of thirty nobody
    // can see is not a better place to stand than a gathering of nine you can.
    out.sort((a, b) => (b.visible === a.visible ? b.count - a.count : b.visible - a.visible));
    return out;
  }

  /** Step a point out of the building it is standing in, through the nearest wall. */
  private nudgeClear(x: number, y: number, z: number): { x: number; z: number } {
    let bx = x;
    let bz = z;
    let worst = 0;
    const reach = SHELTER_FOOTPRINT / 2 + 1.4;
    for (let s = 0; s < this.structures.length; s++) {
      if (this.structures[s]!.kind !== 'shelter') continue;
      const base = this.structureAt[s * 3 + 1]!;
      if (y < base - 1 || y > base + SHELTER.ridge) continue;
      const sx = this.structureAt[s * 3]!;
      const sz = this.structureAt[s * 3 + 2]!;
      const d = Math.hypot(x - sx, z - sz);
      if (d >= reach || reach - d <= worst) continue;
      worst = reach - d;
      const ux = d < 1e-4 ? 1 : (x - sx) / d;
      const uz = d < 1e-4 ? 0 : (z - sz) / d;
      bx = sx + ux * reach;
      bz = sz + uz * reach;
    }
    return { x: bx, z: bz };
  }

  /**
   * How many of these beings a reader would find from that camera: inside the
   * frame, drawn big enough to call, and with neither the land nor a building
   * between the eye and them.
   *
   * Trees are left out on purpose — they ghost — and buildings are counted
   * because a camera placement that has to dissolve half a settlement to work
   * is a worse placement than one that does not.
   */
  private countVisibleFrom(scout: THREE.PerspectiveCamera, members: readonly number[], wantPx: number): number {
    let seen = 0;
    // `members` index the array the grouping was handed, which is the per-frame
    // being arrays in order — so a member IS an instance index.
    for (const i of members) {
      if (i >= this.instanceCount) continue;
      const x = this.beingPos[i * 3]!;
      const foot = this.beingPos[i * 3 + 1]!;
      const z = this.beingPos[i * 3 + 2]!;
      const mid = foot + stageForm(this.beingStage[i]!).scale * 0.55;
      this.probe.set(x, mid, z).project(scout);
      if (this.probe.z > 1 || Math.abs(this.probe.x) > 0.92 || Math.abs(this.probe.y) > 0.92) continue;
      const d = scout.position.distanceTo(this.focusTarget.set(x, mid, z));
      const bodyPx = stageForm(this.beingStage[i]!).scale / Math.max(1e-6, d * this.worldPerPx);
      // AT THE BAND'S OWN SIZE, not merely present. A being a quarter of the
      // size the band promises is a being the band is not keeping its contract
      // about, and counting it rewards exactly the sprawling candidate that
      // has to be rejected.
      if (bodyPx < Math.max(DETAIL_MIN_PX, wantPx * 0.45) || bodyPx > wantPx * 2.6) continue;
      if (this.terrainHidesFrom(scout.position, x, mid, z)) continue;
      // A wall between the eye and them, sampled along the line. The ghost rule
      // would clear it, but a frame that needs less clearing is a better frame.
      let walled = false;
      for (let s = 1; s < 8 && !walled; s++) {
        const t = s / 8;
        const px = scout.position.x + (x - scout.position.x) * t;
        const py = scout.position.y + (mid - scout.position.y) * t;
        const pz = scout.position.z + (z - scout.position.z) * t;
        if (Math.hypot(px - x, pz - z) < 2.6) break; // its own hut does not count against it
        walled = this.insideStructure(px, py, pz, -0.6) > 0;
      }
      if (!walled) seen++;
    }
    return seen;
  }

  /**
   * Put the camera somewhere. The ONE probe that changes anything, and all it
   * changes is where you are standing — which the mouse can do anyway. Nothing
   * about the world, the data or what the view claims goes through here.
   */
  placeCamera(camera: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void {
    this.following = false;
    this.focusUntil = 0;
    this.camera.position.set(camera.x, camera.y, camera.z);
    this.controls.target.set(target.x, target.y, target.z);
    this.controls.update();
  }

  /**
   * Where the buildings are and which way they face — so a reviewer can put a
   * ruler on one, stand a being in its doorway, or check that the camera they
   * were offered is not inside it.
   */
  structuresShown(): { kind: string; x: number; y: number; z: number; yaw: number }[] {
    const out: { kind: string; x: number; y: number; z: number; yaw: number }[] = [];
    for (let s = 0; s < this.structures.length; s++) {
      const st = this.structures[s]!;
      out.push({
        kind: st.kind,
        x: this.structureAt[s * 3]!,
        y: this.structureAt[s * 3 + 1]!,
        z: this.structureAt[s * 3 + 2]!,
        yaw: hash2(st.id, st.builtBy) * Math.PI * 2,
      });
    }
    return out;
  }

  /**
   * The crowds the view has put a number on, what those numbers say, and where
   * the number is — client coordinates, the same point `chipsOnScreen` gives.
   */
  clustersShown(): { count: number; x: number; y: number }[] {
    const out: { count: number; x: number; y: number }[] = [];
    for (let c = 0; c < this.clusters.length; c++) {
      const cl = this.clusters[c]!;
      if (this.countNodes[c]?.style.display === 'none') continue;
      const at = this.toClient(this.chipAt[c * 2]!, this.chipAt[c * 2 + 1]!);
      out.push({ count: cl.count, x: at.x, y: at.y });
    }
    return out;
  }

  nameOf(id: number): string {
    return displayName(id, this.names.get(id)).text;
  }

  /** The names currently drawn over the world — the label budget, made checkable. */
  labelsShown(): string[] {
    return [...this.labelShown];
  }

  /** 1 in full daylight, 0 in the dark — what the view is currently lighting by. */
  daylightNow(): number {
    return this.daylight;
  }

  /**
   * The SMALLEST marker on screen, in CSS pixels — the footprint of the figure
   * and its ring together, whichever of the two is larger.
   *
   * This is the countability claim, made checkable, and it is deliberately the
   * worst case rather than the nearest being: a floor that holds for the
   * closest marker and not for the furthest is not a floor. Whatever the camera
   * is doing inside the orbit this view allows, every being has to be big
   * enough to see and to point at.
   */
  beingPixels(): number {
    let worst = Infinity;
    for (let i = 0; i < this.instanceCount; i++) {
      const foot = this.markerPixelsOf(i);
      if (foot > 0 && foot < worst) worst = foot;
    }
    return worst === Infinity ? 0 : worst;
  }

  /** The footprint of one drawn being, in CSS pixels — ring or body, whichever is wider. */
  private markerPixelsOf(i: number): number {
    const dx = this.beingPos[i * 3]! - this.camera.position.x;
    const dy = this.beingPos[i * 3 + 1]! - this.camera.position.y;
    const dz = this.beingPos[i * 3 + 2]! - this.camera.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= 0) return 0;
    const markPx = this.beingMark[i]! / (d * this.worldPerPx);
    const stage = this.beingStage[i]!;
    const annotPx = markPx * RING_OUTER * RING_R * 2 * stageFootprint(stage, this.band);
    if (!bandShowsBodies(this.band)) return markPx * DOT_R * 2.88;
    // Whichever a reader can actually point at: the map pin out here, the
    // being itself once the camera is close enough for it to be the bigger of
    // the two.
    return Math.max(stageForm(stage).scale / (d * this.worldPerPx), annotPx);
  }

  /**
   * Which contract the picture is keeping — `far`, `default`, `mid` or `near`
   * — and, with it, exactly what a reader is entitled to get off the frame.
   *
   * The band is the honest form of this view's claim. Every earlier round made
   * one claim at every zoom and broke it at most of them; this one says which
   * claim is in force, draws only that, and answers `null` from the probes for
   * everything it is not promising.
   */
  zoomBand(): ZoomBand {
    return this.band;
  }

  /** How tall a grown being stands on screen right now, in CSS pixels. */
  bandPixels(): number {
    return this.bandPx;
  }

  /** How wide the map's ring is drawn on screen right now, in CSS pixels. */
  annotationPixels(): number {
    return this.annotPx * RING_OUTER * 2;
  }

  /**
   * The world, measured — so a reviewer can check the proportions with
   * arithmetic instead of an opinion.
   *
   * Every number is read out of the geometry the view actually builds, at the
   * moment it is asked, in world units. The unit is a metre, horizontally and
   * after `HSCALE` vertically, and if any of these ever stops being the size of
   * the thing it is named after, this is where it shows.
   */
  scaleReport(): {
    unit: string;
    adult: number; child: number; elder: number;
    hut: number; hutFootprint: number; hutDoorway: number; hutFrom: 'mesh' | 'contract';
    tree: number; treeShortest: number;
    peak: number; seaLevel: number; worldSpan: number;
    annotationRing: number; adultOnScreenPx: number;
  } {
    const measure = (mesh: THREE.Object3D | null | undefined): number => {
      const geo = (mesh as THREE.Mesh | undefined)?.geometry;
      if (!geo) return 0;
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      return box ? box.max.y - box.min.y : 0;
    };
    let peak = 0;
    for (let i = 0; i < this.gridHeight.length; i++) {
      const h = this.gridHeight[i]!;
      if (h > peak) peak = h;
    }
    // The hut is measured off the bounding box of the mesh that is IN THE
    // SCENE, and nothing rescales an instance any more, so this is what a
    // reviewer's ruler finds on the screenshot. Before the first hut is built
    // there is no mesh to measure and the report says so rather than quietly
    // answering 0 — or, worse, quoting a number nothing has checked.
    const shelter = this.structureMeshes.get('shelter');
    const shelterGeo = shelter?.geometry;
    if (shelterGeo) shelterGeo.computeBoundingBox();
    const hutBox = shelterGeo?.boundingBox ?? null;
    const contract = shelterMeasure();
    const distance = this.camera.position.distanceTo(this.controls.target);
    return {
      unit: 'metre — 1 world unit = 1 m horizontally; the sim height index is drawn at 14 m per unit',
      adult: stageForm(STAGE_ADULT).scale,
      child: stageForm(STAGE_CHILD).scale,
      elder: stageForm(STAGE_ELDER).scale,
      hut: hutBox ? hutBox.max.y - hutBox.min.y : contract.ridge,
      hutFootprint: hutBox ? hutBox.max.x - hutBox.min.x : contract.footprint,
      hutDoorway: contract.doorHeight,
      hutFrom: hutBox ? 'mesh' : 'contract',
      // The tallest and the shortest pine the view actually planted.
      tree: measure(this.treeFoliage) * TREE_MAX_S + 4.5 * TREE_MAX_S,
      treeShortest: measure(this.treeFoliage) * TREE_MIN_S + 4.5 * TREE_MIN_S,
      peak: peak * HSCALE,
      seaLevel: SEA * HSCALE,
      worldSpan: WORLD,
      annotationRing: annotationRadius(distance, this.worldPerPx) * RING_OUTER * 2,
      adultOnScreenPx: this.bandPx,
    };
  }

  /** What the current band claims, and the accuracy it holds itself to. */
  promises(): ReturnType<typeof bandPromise> {
    return bandPromise(this.band);
  }

  /**
   * Where the camera is standing and how far it is ALLOWED to stand — the two
   * numbers behind "can a mouse reach this band", printed rather than argued
   * about.
   *
   * `stopFigurePx` is how tall a grown being stands when the orbit is at its
   * far stop: it has to be under `BAND_EDGE_PX[0] × (1 − BAND_HYSTERESIS)` or
   * FAR is a band the wheel cannot enter, whatever the band table says. Every
   * term is measured off the live projection, so a stop derived from a canvas
   * that has since changed shows up here as a mismatch.
   */
  cameraReport(): {
    distance: number; minDistance: number; maxDistance: number;
    worldPerPx: number; figurePx: number; stopFigurePx: number; enterFarPx: number;
    band: ZoomBand; canvasW: number; canvasH: number; projectionH: number;
    atStop: boolean; farReachable: boolean;
    zoomSpeed: number; notchesToFar: number;
  } {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const stop = this.controls.maxDistance;
    const stopPx = figurePxAt(stop, this.worldPerPx);
    const enterFarPx = BAND_EDGE_PX[0]! * (1 - BAND_HYSTERESIS);
    return {
      // What the WHEEL would have to do, in the controls' own arithmetic.
      //
      // `farReachable` has always answered a question about the orbit's STOP,
      // and a reviewer who drove eighty notches and stayed in DEFAULT read it
      // as a claim about the mouse. Both are now printed: the stop is in FAR,
      // AND this is how many notches of a real wheel it takes to get there
      // from here — computed from `zoomSpeed` and three's own zoom scale, so
      // it is the same number the camera moves by rather than a second model
      // of it. A bar that says "reachable" over a figure of 90 is a bar a
      // reader can argue with; one that says 26 is one they can check.
      zoomSpeed: this.controls.zoomSpeed,
      notchesToFar: notchesToReach(distance, enterFarPx, this.worldPerPx, this.controls.zoomSpeed),
      distance,
      minDistance: this.controls.minDistance,
      maxDistance: stop,
      worldPerPx: this.worldPerPx,
      figurePx: this.bandPx,
      stopFigurePx: stopPx,
      enterFarPx,
      band: this.band,
      canvasW: this.canvas.clientWidth,
      canvasH: this.canvas.clientHeight,
      // The canvas the projection was derived from. It is `canvasH` or the view
      // is drawing one picture and measuring another — see `syncProjection`.
      projectionH: this.viewH,
      atStop: distance >= stop - 1,
      farReachable: bandForPixels(stopPx, 'default') === 'far',
    };
  }

  /** Where this being stands, in scene units — the same frame `placeCamera` takes. */
  worldPositionOf(id: number): { x: number; y: number; z: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { x: this.beingPos[i * 3]!, y: this.beingPos[i * 3 + 1]!, z: this.beingPos[i * 3 + 2]! };
  }

  /**
   * Where the thing DRAWN for this being is, in client coordinates — the point
   * a reader would put a finger on, and the point everything else in this file
   * bins, groups and covers by.
   *
   * There is exactly one of these per being per frame and it is the entry in
   * `screenPoints`: the centre of its ground mark, or — where a structure's
   * chip has taken that mark away — the middle of its body, which is then the
   * only thing of it in the picture. `markScreenPositionOf` and
   * `bodyScreenPositionOf` answer the two halves for a caller that needs a
   * specific one; this answers "point at it", and `countAudit()`,
   * `markGeometry()` and the cover rule all use the same answer.
   */
  screenPositionOf(id: number): { x: number; y: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const k = this.screenSlotOf(i);
    if (k >= 0) return this.toClient(this.screenPoints[k]!.x, this.screenPoints[k]!.y);
    return this.beingInside[i] === 1 ? this.bodyScreenPositionOf(id) : this.markScreenPositionOf(id);
  }

  /** The centre of this being's ground mark, drawn or not. */
  markScreenPositionOf(id: number): { x: number; y: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const k = this.screenSlotOf(i);
    if (k >= 0 && this.beingInside[i] !== 1) {
      return this.toClient(this.screenPoints[k]!.x, this.screenPoints[k]!.y);
    }
    this.markAnchor(i, this.probe).project(this.camera);
    if (this.probe.z > 1) return null; // behind the camera
    return this.toNdcClient();
  }

  /** The middle of this being's figure — what a hover card places itself clear of. */
  bodyScreenPositionOf(id: number): { x: number; y: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    this.probe.set(this.beingPos[i * 3]!, (this.beingPos[i * 3 + 1]! + this.beingTop[i]!) / 2, this.beingPos[i * 3 + 2]!);
    this.probe.project(this.camera);
    if (this.probe.z > 1) return null; // behind the camera
    return this.toNdcClient();
  }

  /** Which screen-point slot holds this being this frame, or -1. */
  private screenSlotOf(i: number): number {
    if (this.beingOnScreen[i] !== 1) return -1;
    const id = this.ids[i]!;
    for (let k = 0; k < this.screenPoints.length; k++) if (this.screenPoints[k]!.id === id) return k;
    return -1;
  }

  /**
   * The canvas's rectangle, read at most once per drawn frame.
   *
   * Every probe here answers in CLIENT coordinates — the ones a pointer event
   * carries and `document.elementFromPoint` takes — and the conversion needs
   * this rectangle. Round eight had two frames in one namespace: `pickAtScreen`
   * and `screenPositionOf` in client coordinates, `chipsOnScreen` and
   * `markGeometry` in canvas-local ones, and a reviewer who drove the mouse to a
   * chip's own reported point landed 113 px below it and opened nothing.
   *
   * Cached because the cover rule now asks the PICKER about every readable
   * being in the frame, and `getBoundingClientRect` per ask is a hundred forced
   * layouts inside one probe call.
   */
  private canvasRect(): DOMRect {
    if (this.rect === null || this.rectFrame !== this.rendered) {
      this.rect = this.canvas.getBoundingClientRect();
      this.rectFrame = this.rendered;
    }
    return this.rect;
  }

  /** Canvas pixels to CLIENT pixels — the one conversion in this file. */
  private toClient(x: number, y: number): { x: number; y: number } {
    const rect = this.canvasRect();
    return {
      x: rect.left + x * (rect.width / Math.max(1, this.canvas.clientWidth)),
      y: rect.top + y * (rect.height / Math.max(1, this.canvas.clientHeight)),
    };
  }

  private toNdcClient(): { x: number; y: number } {
    const rect = this.canvasRect();
    return {
      x: rect.left + ((this.probe.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.probe.y) / 2) * rect.height,
    };
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  /**
   * How many frames this view has actually DRAWN.
   *
   * The only honest fps measurement here. Counting `requestAnimationFrame`
   * callbacks measures the display — on this machine 144 Hz — while the frame
   * limiter is deliberately holding the world to sixty, ten or two. Sampling
   * this over a window says what the limiter did, not what the panel can do.
   */
  renderCount(): number {
    return this.rendered;
  }

  private rendered = 0;

  /**
   * Whether the WORLD is advancing — not whether this view is drawing.
   *
   * A paused instrument is a frozen frame: the idle lean stops, the selection
   * ring stops pulsing, the ripples and the cairns stop fading. The camera is
   * still allowed to come to rest, because that is the reader's own hand.
   */
  setRunning(on: boolean): void {
    this.simRunning = on;
  }

  render(): void {
    this.rendered++;
    // Held still while the world is. Every animation in this view reads this
    // and not the clock, so "paused" means the picture a reader measures is the
    // picture they aimed at. See `setRunning`.
    if (this.simRunning) this.animT = this.clock.getElapsedTime();
    const t = this.animT;
    const now = performance.now();
    // Before anything is sized or clamped: the projection has to be about the
    // canvas this frame is going onto. See `syncProjection`.
    this.syncProjection();
    this.controls.update();
    this.keepAboveGround();
    this.updateLight();
    // Size first, then project, then group, then draw: how big a mark is
    // decides which beings overlap, which decides which crowds carry a number,
    // which decides (at FAR) which beings are drawn as themselves at all. Doing
    // this in the frame rather than when a sim frame lands is also what lets a
    // PAUSED world be zoomed — which is how every stranger test is run.
    this.sizeMarkers();
    this.projectBeings();
    // Who the scenery must step aside for is decided from where the beings
    // landed on screen, and before anything is drawn.
    this.updateSubjects();
    this.updateCrowds(now);
    // Who is standing clear enough to be allowed a mark of their own. After the
    // crowds, because a being a chip has already counted is not drawn and can
    // neither be misread nor cause a misreading.
    this.planMarks();
    this.writeMarkers(t);
    this.updateFootprints();
    this.updateSelection(t);
    this.updateHoverRing(t);
    this.updateTransients(t);
    // Hover costs a raycast against every drawn body, so it is paid only when
    // the pointer has actually moved, and at most a dozen times a second. A
    // still pointer — every screenshot, and most of the time — costs nothing.
    //
    // What comes back is the whole list of beings under the cursor, not the
    // nearest one: in a settlement four bodies can share a dozen pixels, and a
    // card that silently picks one of them is the "mark attributed to the wrong
    // body" failure with a name and a stage on it. The list goes up to the
    // shell, which decides what to show and tells this view who to highlight.
    if (this.pointerInside && this.pointerMoved && now - this.lastHoverPick > 70) {
      this.lastHoverPick = now;
      this.pointerMoved = false;
      this.onHover?.(this.pickAt(this.pointerX, this.pointerY), this.pointerX, this.pointerY);
    }
    this.updateLabels(now);
    this.updateBandChip();
    // Whether the picture is still settling. `enableDamping` keeps the camera
    // drifting for the better part of a second after the hand comes off it, and
    // a view that dropped to ten frames a second in the middle of that would
    // read as a stutter rather than as thrift.
    this.camMoving = !(this.camera.position.distanceToSquared(this.camWas) < 1e-6)
      || this.following
      || this.focusUntil > now;
    this.camWas.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Is this view about to look different? Drives the frame limiter: the camera
   * being driven, or still coming to rest, is the one thing that has to be
   * drawn at full rate whatever else the world is doing.
   */
  isInteracting(): boolean {
    return performance.now() - this.lastInput < 450 || this.camMoving;
  }

  /**
   * Keep the camera, and what it is aiming at, out of the ground.
   *
   * Orbiting to a low angle a kilometre out is harmless; doing it three metres
   * from a being puts the eye inside a hill and the frame goes to the inside of
   * a triangle. The camera is allowed into the street with them, so the street
   * has to have a floor. Raising the position here is absorbed by the controls
   * on the next `update()` — the orbit simply flattens out rather than digging.
   */
  private keepAboveGround(): void {
    const eye = this.camera.position;
    const floor = this.surfaceAt(eye.x + HALF, eye.z + HALF) + 1.7;
    if (eye.y < floor) eye.y = floor;
    const aim = this.controls.target;
    const aimFloor = this.surfaceAt(aim.x + HALF, aim.z + HALF) + 0.8;
    if (aim.y < aimFloor) aim.y = aimFloor;
  }

  /**
   * The one line of chrome that says which band the view is in.
   *
   * A view that silently changes what it draws is a view a reader cannot trust,
   * because the frame where the pictograms vanished looks exactly like the
   * frame where nobody was doing anything. So the band says its own name, the
   * size it is holding, and the scale of the ground under it.
   */
  private updateBandChip(): void {
    const node = this.bandNode;
    if (!node) return;
    const bar = node.firstElementChild as HTMLElement | null;
    const words = node.lastElementChild as HTMLElement | null;
    if (!bar || !words) return;
    this.updateScaleBar(bar);
    const px = this.bandPx;
    const size = px >= 10 ? `a being is ${Math.round(px)} px` : `a being is under a pixel · pins are ${Math.round(this.annotPx * RING_OUTER * 2)} px`;
    // The naming claim is whatever the budgeter actually did, in the budgeter's
    // own words — `labelAudit().claim` IS this string, so the chip, the probe
    // and the legend cannot drift into three different promises. In EVERY band
    // that draws a name: round eight printed it at NEAR only, so a reviewer
    // reading `labelAudit()` at MID was handed a `claim` the frame never made.
    const reach = ` · ${this.nameClaim()}`;
    // Exactly how many beings are standing too close together for the picture
    // to say what they are doing or which way they face. It is the one number
    // that tells a reader when to stop reading and start asking, and it is
    // measured from what was drawn — see `planMarks`.
    const held = this.marksHeld > 0 ? ` · ${this.marksHeld} too close to mark` : '';
    const text = `${this.band} · ${size} · ${bandPromise(this.band).says}${reach}${held}${this.specimenOn ? ' · SPECIMEN' : ''}`;
    if (words.textContent !== text) {
      words.textContent = text;
      // One layout read, when the caption actually changes, so names can be
      // kept off it without paying for `offsetWidth` sixty times a second.
      this.bandW = node.offsetWidth;
      this.bandH = node.offsetHeight;
    }
  }

  /**
   * The ruler, measured off the ground the reader is looking at.
   *
   * `worldPerPx` is world units per pixel at one unit of distance, so the
   * metres a pixel covers is that times the distance to the GROUND under the
   * view centre — not to the orbit target, which floats above it, and not to
   * the camera's own near plane. The span is then snapped to the 1–2–5 series
   * and the label says what the line measures. Nothing here is clamped: a bar
   * whose pixel width is decided separately from its caption is the defect.
   */
  private updateScaleBar(bar: HTMLElement): void {
    const aim = this.controls.target;
    const ground = this.surfaceAt(aim.x + HALF, aim.z + HALF);
    const distance = this.camera.position.distanceTo(this.probe.set(aim.x, ground, aim.z));
    const scale = scaleBarFor(Math.max(1e-9, distance * this.worldPerPx), SCALE_BAR_MAX_PX);
    this.scaleMetres = scale.metres;
    this.scalePx = scale.px;
    this.scaleLabel = scale.label;
    const width = `${Math.round(scale.px)}px`;
    if (bar.style.width !== width) bar.style.width = width;
    if (bar.dataset['span'] !== scale.label) bar.dataset['span'] = scale.label;
  }

  /**
   * What the bar says, and what it measures — so a reviewer can check that the
   * line on screen really is `metres / metresPerPx` pixels long.
   */
  scaleBar(): { metres: number; px: number; label: string; metresPerPx: number } {
    return {
      metres: this.scaleMetres,
      px: this.scalePx,
      label: this.scaleLabel,
      metresPerPx: this.scalePx > 0 ? this.scaleMetres / this.scalePx : 0,
    };
  }

  /**
   * Make the projection agree with the canvas that is actually on screen —
   * every frame, cheaply, instead of trusting a notification.
   *
   * This is the whole of round seven's first defect. `worldPerPx` is the number
   * every band edge, every mark size and the orbit's far stop are stated in,
   * and it was computed once per `ResizeObserver` callback. Measured live, the
   * view was drawing a 359 px canvas with a `worldPerPx` derived from a 385 px
   * one — a notification that never arrived, or arrived before the last layout
   * settled, and nothing ever checked. On a window that had been maximized the
   * gap was 40%, which put the orbit's stop a hysteresis step short of the band
   * it was sized for: FAR existed, `placeCamera` could reach it, and the wheel
   * could not.
   *
   * The canvas's own size is read here every frame anyway — `projectBeings`,
   * `updateCrowds` and `updateLabels` all read it — so this costs a comparison,
   * and the projection can never be a frame behind the picture again.
   */
  private syncProjection(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden — keep the last good size
    if (w === this.viewW && h === this.viewH) return;
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden — keep the last good size
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    // The name layer is the canvas's own rectangle, so a label that leaves the
    // view is clipped by the view rather than landing on the legend below it.
    if (this.labelLayer) {
      this.labelLayer.style.left = `${this.canvas.offsetLeft}px`;
      this.labelLayer.style.top = `${this.canvas.offsetTop}px`;
      this.labelLayer.style.width = `${w}px`;
      this.labelLayer.style.height = `${h}px`;
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.worldPerPx = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    // The bands are stated in pixels of BEING, so the orbit's far stop has to
    // be too, or the widest contract exists on a small window and not on a
    // maximized one — which is exactly what round four found.
    this.controls.maxDistance = maxOrbitDistance(this.worldPerPx, WORLD * 1.35);
    if (this.xrayMat) this.xrayMat.uniforms['uWorldPerPx']!.value = this.worldPerPx;
    if (this.outlineMat) this.outlineMat.uniforms['uWorldPerPx']!.value = this.worldPerPx;
  }

  /**
   * Whether this renderer is WELL — and the only read-out that has to be zero
   * before any other number here means anything. See `health.ts`.
   */
  healthReport(): HealthReport {
    // Measured on demand, not cached from boot: a mesh can be replaced at any
    // time — `regrow` does it whenever a world grows past its capacity — and a
    // guard that only ran once would have nothing to say about the mesh that
    // actually shipped.
    this.health.setCullRisks(this.cullAudit());
    return this.health.report();
  }

  dispose(): void {
    this.dropWindowTap();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.dropHealthTap();
    this.ro?.disconnect();
    this.ro = null;
    this.controls.dispose();
    this.labelNodes.length = 0;
    this.leaderNodes.length = 0;
    this.hullNodes.length = 0;
    this.countNodes.length = 0;
    this.labelLayer?.remove();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      const withGeo = obj as Partial<THREE.Mesh>;
      if (withGeo.geometry) geometries.add(withGeo.geometry);
      const mat = withGeo.material;
      if (Array.isArray(mat)) for (const m of mat) materials.add(m);
      else if (mat) materials.add(mat);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) disposeMaterial(m);
    this.scene.clear();
    this.figures = [];
    this.ringMeshes = [];
    this.pictos = null;
    this.trails = null;
    this.dots = null;
    this.bandNode = null;
    this.animalMesh = null;
    this.resourceMeshes = [];
    this.structureMeshes.clear();
    this.ids = new Int32Array(0);
    this.instanceCount = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/**
 * A resource node: a low pebble on the ground, and nothing more. Small and
 * flat on purpose — this is the page the beings are written on.
 */
function resourceGeometry(family: Family): THREE.BufferGeometry {
  if (family === 'water') return new THREE.CylinderGeometry(0.85, 0.7, 0.16, 10);
  if (family === 'ore' || family === 'material') {
    const g = new THREE.OctahedronGeometry(0.6, 0);
    g.scale(1, 0.42, 1);
    return g;
  }
  const g = new THREE.IcosahedronGeometry(0.6, 0);
  g.scale(1, 0.48, 1);
  return g;
}

/**
 * What they build, at the size they build it — and with a way in.
 *
 * Round four drew the shelter as a SOLID five-metre box with a plank glued to
 * the front where a door should be. Beings walk to within four units of a
 * shelter and stop, so a settlement's people spend most of their day inside
 * one, and inside a solid box is where a reviewer found them: six of seven
 * targets in one frame were three tiles of blank hut wall.
 *
 * So the walls are walls. Four of them, the front one split into two piers and
 * a lintel, leaving a real two-metre opening a 1.75 m adult walks through with
 * clear air over their head — and leaving the inside of the hut somewhere a
 * camera can see into. The numbers come from `SHELTER`, which is also what
 * `scaleReport` is measured against, so the report and the ruler cannot part
 * company again.
 */
function structureGeometry(kind: string): THREE.BufferGeometry {
  if (kind === 'shelter') {
    const parts: THREE.BufferGeometry[] = SHELTER_PARTS.map(
      (p) => new THREE.BoxGeometry(p.w, p.h, p.d).translate(p.x, p.y, p.z),
    );
    parts.push(
      new THREE.ConeGeometry(SHELTER.roofRadius, SHELTER.roofHeight, 4)
        .rotateY(Math.PI / 4)
        .translate(0, SHELTER.eaves + SHELTER.roofHeight / 2, 0),
    );
    return mergeGeometries(parts, false) ?? parts[0]!;
  }
  if (kind === 'wall') return new THREE.BoxGeometry(4, 2.2, 1.1).translate(0, 1.1, 0);
  const lid = new THREE.BoxGeometry(2.0, 0.28, 2.0).translate(0, 1.28, 0);
  const box = new THREE.BoxGeometry(1.8, 1.2, 1.8).translate(0, 0.6, 0);
  return mergeGeometries([box, lid], false) ?? box;
}

function structureMaterial(kind: string): THREE.Material {
  // A hut is hollow now, so the camera looks through the doorway at the INSIDE
  // of the far wall. Single-sided walls would show it the landscape instead.
  if (kind === 'shelter') return new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.88, side: THREE.DoubleSide });
  if (kind === 'wall') return new THREE.MeshStandardMaterial({ color: 0x6f6f77, roughness: 1 });
  return new THREE.MeshStandardMaterial({ color: 0xb5945f, roughness: 0.8 });
}

/**
 * Swap an instanced mesh for a larger one, keeping its geometry and material.
 * The per-instance colour buffer is recreated rather than dropped: a shader
 * that declares `instanceColor` stops compiling the moment the mesh has none.
 */
function regrow(scene: THREE.Scene, mesh: THREE.InstancedMesh, cap: number): THREE.InstancedMesh {
  if (mesh.instanceMatrix.count >= cap) return mesh;
  scene.remove(mesh);
  const grown = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
  grown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grown.count = 0;
  // Name, culling and order all carry over: a mesh that grows must not lose the
  // property that keeps it on the screen. See `World3D.instanced`.
  grown.name = mesh.name;
  grown.frustumCulled = mesh.frustumCulled;
  grown.renderOrder = mesh.renderOrder;
  if (mesh.instanceColor) grown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  scene.add(grown);
  return grown;
}

function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) (value as THREE.Texture).dispose();
  }
  m.dispose();
}
