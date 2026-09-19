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
  KIND_UNKNOWN,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
  type FrameMessage,
  type ResourcePayload,
  type StructureUpdate,
} from './sim/protocol.js';
import {
  activityWord,
  ADULT_M,
  annotationOpacity,
  annotationRadius,
  bandCountsBeings,
  bandForPixels,
  bandPromise,
  bandShowsBodies,
  bandShowsDetail,
  bodyTint,
  DETAIL_MIN_PX,
  CLUSTER_BUDGET,
  clusterHierarchy,
  conditionHue,
  conditionWord,
  describeState,
  displayName,
  focusShiftPx,
  headingOctant,
  HUE_WELL,
  labelBudgetFor,
  labelClearanceFor,
  LABEL_BUDGET_MAX,
  figurePxAt,
  maxOrbitDistance,
  maxLeaderFor,
  movingFor,
  NEAR_LABEL_M,
  octantDistance,
  PICTO_GRID,
  PICTO_NONE,
  PICTO_SPEAK,
  pictogramFor,
  placeLabels,
  planCount,
  readableActivity,
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
  type Subject,
} from './legibility.js';
import { buildGlyphAtlas, PICTO_STUB_AT } from './glyphs.js';

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
/** Four conditions, each with or without the elder's outer ring. */
const RING_BUCKETS = RING_STYLE_COUNT * 2;

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
const RENDER_BODY = 6;
const RENDER_TRAIL = 10;
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
 * A crowd is a group of beings closer together than this many marker-widths,
 * and it earns a number once this many are in it. Both are in screen space:
 * crowding is a property of the picture, not of the continent.
 */
const CLUSTER_CELL_MARKERS = 1.25;
const CLUSTER_MIN = 3;

/**
 * Where a crowd's number is allowed to sit relative to its outline, tried in
 * order: up-right first, then round the other corners and the sides. Always
 * outside the ellipse, never on another group's number.
 */
const CHIP_SLOTS: readonly (readonly [number, number])[] = [
  [1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1.15], [0, 1.15], [1.25, 0], [-1.25, 0],
];

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
function ringGeometry(style: number, core: boolean): THREE.BufferGeometry {
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
  weigh(bar(0.26, -0.96, -1.66, 0.006), INK);
  weigh(tri(0.62, -1.50, -0.62, -1.50, 0, -2.86, 0.006), INK);
  weigh(bar(0.145, -1.02, -1.62, 0.012), BONE);
  weigh(tri(0.46, -1.56, -0.46, -1.56, 0, -2.70, 0.012), BONE);

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
 */
function ringMaterial(fade: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: fade },
    vertexShader: `
      attribute vec3 aWeights;
      varying vec3 vInk;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vInk = aWeights.x * instanceColor
             + aWeights.y * vec3(0.012, 0.014, 0.016)
             + aWeights.z * vec3(0.94, 0.90, 0.82);
        vAlpha = aWeights.x + aWeights.y * 0.9 + aWeights.z;
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
      uSubjectN: { value: 0 },
      uSubject: { value: subjects },
    };
    Object.assign(shader.uniforms, u);
    out.push(u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFadeNear;
        uniform float uFadeFar;
        uniform vec3 uSel;
        uniform float uSelR;
        uniform float uFadeFloor;
        uniform float uGhostFloor;
        uniform float uThick;
        uniform float uThickY;
        uniform float uCentreY;
        uniform int uSubjectN;
        uniform vec4 uSubject[${SUBJECT_SLOTS}];
        varying float vGhostA;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 fadeAnchor = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 fadeWorld = (modelMatrix * fadeAnchor).xyz;
          float scale = length(instanceMatrix[0].xyz);
          // The THING's middle, not this mesh's own origin. A tree is two
          // meshes with two anchors five metres apart, and testing each where
          // it happens to be pinned ghosts the crown and leaves the trunk — a
          // black bar standing in front of somebody with a ghost over it.
          vec3 fadeUp = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          vec3 fadeView = (modelViewMatrix * fadeAnchor).xyz + fadeUp * (uCentreY * scale);
          float fadeDepth = -fadeView.z;
          // Pressed against the lens: a trunk eleven metres off the glass is a
          // black bar across a third of the frame whoever is behind it.
          float lens = smoothstep(uFadeNear, uFadeFar, fadeDepth);
          float block = 0.0;
          float rx = uThick * scale;
          float ry = uThickY * scale;
          if (fadeDepth > 0.05) {
            for (int k = 0; k < ${SUBJECT_SLOTS}; k++) {
              if (k >= uSubjectN) break;
              vec4 sj = uSubject[k];
              float sd = -sj.z;
              // Its NEAR FACE, not its middle: a being standing inside a hut is
              // behind the hut's front wall and in front of its back one, and
              // the middle of the hut says neither.
              if (sd <= 0.05 || fadeDepth - max(rx, ry) >= sd - 0.2) continue;
              // Screen overlap, done as the projection does it: x over depth.
              vec2 o = fadeView.xy / fadeDepth;
              vec2 s = sj.xy / sd;
              vec2 reach = vec2(rx, ry) / fadeDepth + vec2(sj.w / sd);
              float d = length((o - s) / reach);
              block = max(block, 1.0 - smoothstep(0.62, 1.02, d));
            }
          }
          float sel = uSelR > 0.0 ? 1.0 - smoothstep(uSelR * 0.55, uSelR * 1.6, distance(fadeWorld, uSel)) : 0.0;
          float g = max(block, sel);
          vGhostA = min(mix(uFadeFloor, 1.0, lens), mix(1.0, uGhostFloor, g));
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGhostA;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vGhostA < 0.015) discard;
        // A ghost is not a faint tree, it is a tree drawn as vapour: pulled
        // toward the pale end so its edges still describe the shape at a fifth
        // of the opacity, which a merely dimmed dark green does not.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.76, 0.80), (1.0 - vGhostA) * 0.55);
        diffuseColor.a *= vGhostA;`,
      );
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
  private pictos: THREE.InstancedMesh | null = null;
  private pictoCell: THREE.InstancedBufferAttribute | null = null;
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
  /** 1 while this being is inside a crowd that carries its own number. */
  private beingCrowded = new Uint8Array(0);
  /** 1 while this being projected inside the canvas on the last frame. */
  private beingOnScreen = new Uint8Array(0);
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
  private selectedId: number | null = null;
  private hoveredId: number | null = null;
  private following = false;
  private focusUntil = 0;

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
   * How far out the view managed to keep the NEAR naming promise this frame:
   * every VISIBLE being nearer than this has a name drawn. Measured from the
   * placement, never assumed — see `updateLabels`.
   */
  private namedWithin = 0;
  private namesExpected = 0;
  /** Reused: whose name went up this frame, for the audit above. */
  private readonly placedIds = new Set<number>();

  private readonly labelLayer: HTMLElement | null;
  private readonly labelNodes: HTMLElement[] = [];
  private readonly leaderNodes: HTMLElement[] = [];
  private labelShown: string[] = [];
  private labelCandidates: LabelCandidate[] = [];
  private lastLabelPick = 0;
  private labelPicked: number[] = [];
  /** The quiet chip that says which band the view is in and how big a mark is. */
  private bandNode: HTMLElement | null = null;
  /** Reused so a label can be told to keep off the beings around it. */
  private readonly bodyRects: LabelObstacle[] = [];

  /** Crowds: an outline round the group and the number of beings inside it. */
  private readonly hullNodes: HTMLElement[] = [];
  private readonly countNodes: HTMLElement[] = [];
  private readonly screenPoints: ScreenPoint[] = [];
  /** `screenPoints[k]` is being `screenIndex[k]` in the per-frame arrays. */
  private readonly screenIndex: number[] = [];
  private clusters: Cluster[] = [];
  /** Where the count chips are sitting, so names can be placed around them. */
  private readonly chipRects: LabelObstacle[] = [];
  /** Per cluster: world centre x, y, z, and the camera distance it was found at. */
  private readonly clusterWorld = new Float32Array(CLUSTER_BUDGET * 4);
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
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerLeave: () => void;
  private readonly onWheel: () => void;
  /**
   * When the camera was last driven, and where it stood at the last drawn
   * frame. Between them they answer "is anything about to look different?",
   * which is what decides whether this view is allowed a full-rate frame.
   */
  private lastInput = 0;
  private readonly camWas = new THREE.Vector3(NaN, NaN, NaN);
  private camMoving = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect?: (id: number | null) => void,
  ) {
    // The label layer is this view's own: it has to exist before the first
    // frame, and a React ref on a sibling element is not guaranteed to have
    // attached by the time the canvas ref fires.
    const layer = document.createElement('div');
    layer.className = 'wlabels';
    canvas.parentElement?.appendChild(layer);
    this.labelLayer = layer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

    // Lit windows follow their hut out of the way, or they hang in the air over
    // a shelter that has stepped aside.
    // Pale lamp cream, not amber: a reviewer at midnight read warm window light
    // as starving beings, and #ffc46b is very nearly the starving colour.
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xf2dcae, transparent: true, opacity: 0, depthWrite: false });
    applyGhostFade(windowMat, this.foliageFades, this.subjects, 3.5, 11, 0.25, 0.05, 3.1, 2.3, 0.8);
    this.windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.7), windowMat, 64);
    this.windows.count = 0;
    this.windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.windows);

    // A low cairn of stones, not a bright marker. Seen from above a pale cone
    // is a sheet of white paper, and at two hundred deaths a day the map filled
    // with litter; a dark rounded heap reads as something left behind.
    this.deaths = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1),
      new THREE.MeshStandardMaterial({ color: 0x6d6459, roughness: 1, flatShading: true }),
      DEATH_SLOTS,
    );
    this.deaths.count = DEATH_SLOTS;
    this.deaths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.deaths);

    this.ripples = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.84, 1, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }),
      SPEECH_SLOTS,
    );
    this.ripples.count = SPEECH_SLOTS;
    this.ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
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
      this.hoveredId = null;
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
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.42, 4.4, 5), trunkMat, places.length);
    const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(3.3, 9, 6), foliageMat, places.length);
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
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: 0x7d7b80, roughness: 1, flatShading: true }), Math.max(1, places.length));
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

  private buildFigures(): void {
    const ringMat = ringMaterial(this.ringFade);
    // Four conditions × adult or elder. Eight draw calls buy two whole
    // encodings that need no colour and no badge.
    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = new THREE.InstancedMesh(ringGeometry(bucket >> 1, (bucket & 1) === 1), ringMat, 64);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The shader reads `instanceColor`, and three only declares that
      // attribute for a mesh that already has one.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.renderOrder = RENDER_RING;
      this.ringMeshes[bucket] = mesh;
      this.scene.add(mesh);
    }

    const trails = new THREE.InstancedMesh(trailGeometry(), trailMaterial(this.trailFade), 64);
    trails.count = 0;
    trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    trails.frustumCulled = false;
    trails.renderOrder = RENDER_TRAIL;
    this.trails = trails;
    this.scene.add(trails);

    const dots = new THREE.InstancedMesh(dotGeometry(), ringMat, 64);
    dots.count = 0;
    dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    dots.frustumCulled = false;
    dots.renderOrder = RENDER_RING;
    dots.visible = false;
    this.dots = dots;
    this.scene.add(dots);

    this.xrayMat = xrayMaterial();
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = new THREE.InstancedMesh(figureGeometry(stage), this.figureMaterial(), 64);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = RENDER_BODY;
      // A body needs a colour before three will declare `instanceColor`, and
      // the silhouette that shares this buffer reads it.
      mesh.setColorAt(0, this.color.setHex(HUE_WELL));
      this.figures[stage] = mesh;
      this.scene.add(mesh);

      const ghost = new THREE.InstancedMesh(mesh.geometry, this.xrayMat, 64);
      ghost.count = 0;
      ghost.frustumCulled = false;
      ghost.renderOrder = RENDER_XRAY;
      this.xrays[stage] = ghost;
      this.scene.add(ghost);
    }
    this.linkXrays();
    this.growBeingCapacity(64);

    // The outline a ghosted building leaves behind. Flat on the ground, drawn
    // through whatever is over it, and exactly the size of the thing that
    // stood there — a village of ghosts still has to read as a village.
    const foot = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.88, 1, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xbfc9cf, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
      64,
    );
    foot.count = 0;
    foot.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    foot.frustumCulled = false;
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
    this.pictos = new THREE.InstancedMesh(pictoGeo, World3D.pictoMaterial(atlas, this.pictoFade), 64);
    // The pictogram shader reads `instanceColor`, and three only declares that
    // attribute for a mesh that already has one.
    this.pictos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    this.pictos.count = 0;
    this.pictos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pictos.frustumCulled = false;
    this.pictos.renderOrder = RENDER_PICTO;
    // Push the quad up and right by exactly enough that the stub drawn into
    // the lower-left of every cell ends on the rim of the ring the instance is
    // anchored to. Read off the atlas's own numbers, so moving the chip in the
    // drawing moves it in the world.
    const offset = (this.pictos.material as THREE.ShaderMaterial).uniforms['uOffset']!.value as THREE.Vector2;
    offset.set(PICTO_RIM / PICTO_H - PICTO_STUB_AT[0], PICTO_RIM / PICTO_H - PICTO_STUB_AT[1]);
    this.scene.add(this.pictos);
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
      const ghost = this.xrays[stage];
      if (!body || !ghost) continue;
      ghost.geometry = body.geometry;
      ghost.instanceMatrix = body.instanceMatrix;
      if (body.instanceColor) ghost.instanceColor = body.instanceColor;
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
        uOffset: { value: new THREE.Vector2(0, 0) },
        // The chip is annotation and fades back with the rest of it. Round
        // five's first NEAR frame had ninety-six chips at full strength over
        // rings at 0.42 and a scene at 1.0: a wall of badges with a village
        // somewhere behind it.
        uOpacity: { value: fade.value },
      },
      vertexShader: `
        uniform float uGrid;
        uniform vec2 uOffset;
        attribute float aCell;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vec4 world = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec4 mv = modelViewMatrix * world;
          mv.xy += position.xy * s + uOffset * s;
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
    bar.dataset['span'] = '200 units';
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
    for (let i = 0; i < CLUSTER_BUDGET; i++) {
      const count = document.createElement('div');
      count.className = 'wcount';
      count.style.display = 'none';
      layer.appendChild(count);
      this.countNodes.push(count);
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
    this.beingCrowded = new Uint8Array(cap);
    this.beingOnScreen = new Uint8Array(cap);
    this.stageIds = [new Int32Array(cap), new Int32Array(cap), new Int32Array(cap)];
    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = this.ringMeshes[bucket];
      if (mesh) this.ringMeshes[bucket] = regrow(this.scene, mesh, cap);
    }
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.figures[stage];
      if (mesh) this.figures[stage] = regrow(this.scene, mesh, cap);
    }
    if (this.trails) this.trails = regrow(this.scene, this.trails, cap);
    if (this.dots) {
      this.dots = regrow(this.scene, this.dots, cap);
      this.dots.visible = this.band === 'far';
    }
    if (this.pictos) {
      this.pictos = regrow(this.scene, this.pictos, cap);
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      cell.setUsage(THREE.DynamicDrawUsage);
      this.pictos.geometry.setAttribute('aCell', cell);
      this.pictoCell = cell;
    }
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const ghost = this.xrays[stage];
      if (ghost) this.xrays[stage] = regrow(this.scene, ghost, cap);
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
    this.figureCount = [0, 0, 0];
    this.ringCount.fill(0);
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
      const mesh = new THREE.InstancedMesh(resourceGeometry(family), new THREE.MeshStandardMaterial({ color: FAMILY_RGB[family], roughness: 0.85, flatShading: true }), n);
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
      this.beingCrowded[i] = 0;
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
      this.beingCrowded[i] = 0;
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
    const pf = this.band === 'near' ? PICTO_NEAR_SCALE : 1;
    if (pf !== this.pictoScale) {
      this.pictoScale = pf;
      // The stub has to keep landing on the ring's rim, and the rim is a
      // fraction of the MARKER while the quad is now a fraction of the chip —
      // so the offset is re-derived rather than left to drift.
      const mat = this.pictos?.material as THREE.ShaderMaterial | undefined;
      const off = mat?.uniforms['uOffset']?.value as THREE.Vector2 | undefined;
      if (off) {
        off.set(
          PICTO_RIM / (PICTO_H * pf) - PICTO_STUB_AT[0],
          PICTO_RIM / (PICTO_H * pf) - PICTO_STUB_AT[1],
        );
      }
    }
    for (let i = 0; i < this.instanceCount; i++) {
      const annot = this.annotationAt(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]!, this.beingPos[i * 3 + 2]!);
      this.beingMark[i] = annot / RING_R;
      this.beingTop[i] = this.beingPos[i * 3 + 1]! + stageForm(this.beingStage[i]!).scale;
    }
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
    const trails = this.trails!;
    const dots = this.dots!;
    this.figureCount = [0, 0, 0];
    this.ringCount.fill(0);
    let pictoAt = 0;
    let trailAt = 0;
    let dotAt = 0;
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

      if (!bodies) {
        const rd = deco * DOT_R;
        this.basis.makeBasis(this.right, this.up, this.fwd);
        this.basis.scale(this.dummy.scale.setScalar(rd));
        this.basis.setPosition(sx + this.up.x * rd * 0.2, surface + this.up.y * rd * 0.2, sz + this.up.z * rd * 0.2);
        dots.setMatrixAt(dotAt, this.basis);
        dots.setColorAt(dotAt, this.color.setHex(ringHue));
        dotAt++;
        continue;
      }

      const bucket = ringStyleFor(cond, act) * 2 + (stageCore(stage, this.band) ? 1 : 0);
      const ringMesh = this.ringMeshes[bucket]!;
      const ringAt = this.ringCount[bucket]!;
      this.ringCount[bucket] = ringAt + 1;
      const r = deco * RING_R * stageFootprint(stage, this.band);
      this.basis.makeBasis(this.right, this.up, this.fwd);
      this.basis.scale(this.dummy.scale.setScalar(r));
      this.basis.setPosition(sx + this.up.x * r * 0.09, surface + this.up.y * r * 0.09, sz + this.up.z * r * 0.09);
      ringMesh.setMatrixAt(ringAt, this.basis);
      ringMesh.setColorAt(ringAt, this.color.setHex(ringHue));

      if (detail && movingFor(act)) {
        trails.setMatrixAt(trailAt, this.basis);
        trails.setColorAt(trailAt, this.color.setHex(ringHue));
        trailAt++;
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
      let bob = 0;
      let lean = form.stoop * 0.12;
      let roll = 0;
      if (act === ACT_RESTING) {
        lean = Math.PI * 0.46; // laid out on the ground
        bob = -height * 0.06;
      } else if (act === ACT_DANGER) {
        bob = Math.abs(Math.sin(phase * 2.2)) * height * 0.13;
        lean = 0.24;
        roll = Math.sin(phase * 3.4) * 0.13;
      } else if (act === ACT_WALKING) {
        bob = Math.abs(Math.sin(phase)) * height * 0.055;
        lean += 0.07;
      } else if (act === ACT_WORKING) {
        lean += 0.30 + Math.sin(phase * 0.9) * 0.22; // swinging at something
      } else if (act === ACT_EATING || act === ACT_DRINKING) {
        lean += act === ACT_DRINKING ? 0.42 : 0.24; // stooped over it
        bob = -height * 0.07;
      } else if (act === ACT_SOCIAL) {
        roll = Math.sin(phase * 0.7) * 0.05; // turned toward whoever is listening
      }
      this.dummy.position.set(sx, surface + bob, sz);
      this.dummy.rotation.set(lean, heading, roll);
      this.dummy.scale.setScalar(height);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      // The body carries the condition colour pulled toward bone, so it is a
      // pale figure by day and still a pale figure at night; the ring beside it
      // carries the colour at full strength. Pushed well past its own value: a
      // lit body next to an unlit ring reads as a grey pin inside a white hoop
      // unless it is lifted to meet it.
      mesh.setColorAt(at, this.color.setHex(bodyTint(hue)).multiplyScalar(1.45));

      if (!detail) continue;
      // Exactly what this being is doing NOW, and nothing it was doing a
      // second ago. Round two let a recent utterance keep the speech badge
      // alive for a second and a half, so a reader called a walking being
      // "speaking" and a probe that said "walking" marked it wrong. The
      // ripple on the ground is what remembers an utterance; the chip is the
      // present tense.
      const picto = pictogramFor(act);
      if (picto === PICTO_NONE) continue;
      this.dummy.position.set(sx, surface + deco * 0.10, sz);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(deco * PICTO_H * this.pictoScale);
      this.dummy.updateMatrix();
      pictos.setMatrixAt(pictoAt, this.dummy.matrix);
      // Bone, for every condition and every band. Condition already has a
      // shape, a lightness and a body tint; a chip that also carried a hue
      // would be a second, weaker answer to a question already answered. The
      // one exception is volume: at 2400× nearly everyone is talking, so the
      // speech chip is drawn quieter than the rest.
      cells.array[pictoAt] = picto;
      pictos.setColorAt(pictoAt, this.color.setHex(HUE_WELL).multiplyScalar(picto === PICTO_SPEAK ? 0.74 : 1));
      pictoAt++;
    }

    for (let bucket = 0; bucket < RING_BUCKETS; bucket++) {
      const mesh = this.ringMeshes[bucket]!;
      mesh.count = bodies ? this.ringCount[bucket]! : 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    }
    dots.visible = !bodies;
    dots.count = dotAt;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    trails.count = trailAt;
    trails.instanceMatrix.needsUpdate = true;
    if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    pictos.count = pictoAt;
    pictos.instanceMatrix.needsUpdate = true;
    if (pictos.instanceColor) pictos.instanceColor.needsUpdate = true;
    cells.needsUpdate = true;
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
    const mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), capacityFor(n));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
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
        // a tree is, and it clears on the same rule — by going to a fifth of
        // its opacity, at exactly the size it has always been, with its
        // footprint left drawn on the ground.
        const material = structureMaterial(kind);
        applyGhostFade(material, this.foliageFades, this.subjects, 3.5, 11, 0.25, 0.22, 3.1, 2.3, 2.2);
        const mesh = new THREE.InstancedMesh(structureGeometry(kind), material, capacityFor(n));
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
      const grown = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.7), mat, capacityFor(shelters));
      grown.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      this.scene.add(grown);
      this.windows = grown;
    }

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
        this.dummy.position.set(
          st.x - HALF + Math.cos(yaw) * (SHELTER.room / 2 + 0.02),
          base + 1.4,
          st.y - HALF - Math.sin(yaw) * (SHELTER.room / 2 + 0.02),
        );
        this.dummy.updateMatrix();
        this.windows.setMatrixAt(windowAt++, this.dummy.matrix);
      }
    }
    for (const [kind, mesh] of this.structureMeshes) {
      mesh.count = written.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.windows.count = windowAt;
    this.windows.instanceMatrix.needsUpdate = true;
    this.dummy.rotation.set(0, 0, 0);
  }

  // ── Transients ─────────────────────────────────────────────────────────────

  private markDeath(x: number, y: number): void {
    const slot = this.deathNext;
    this.deathNext = (this.deathNext + 1) % DEATH_SLOTS;
    this.deathAt[slot * 3] = x - HALF;
    this.deathAt[slot * 3 + 1] = this.surfaceAt(x, y);
    this.deathAt[slot * 3 + 2] = y - HALF;
    this.deathBorn[slot] = this.clock.getElapsedTime();
  }

  private markSpeech(id: number, x: number, y: number, to: { x: number; y: number } | null): void {
    this.speakingUntil.set(id, performance.now() + SPEAKING_MS);
    const slot = this.rippleNext;
    this.rippleNext = (this.rippleNext + 1) % SPEECH_SLOTS;
    this.rippleAt[slot * 3] = x - HALF;
    this.rippleAt[slot * 3 + 1] = this.surfaceAt(x, y) + 1;
    this.rippleAt[slot * 3 + 2] = y - HALF;
    this.rippleBorn[slot] = this.clock.getElapsedTime();
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
    const scale = this.annotationAt(0, 0, 0) / RING_R * 0.42;
    for (let i = 0; i < DEATH_SLOTS; i++) {
      const born = this.deathBorn[i]!;
      const age = born === 0 ? 2 : (t - born) / DEATH_FADE_S;
      if (age >= 1 || age < 0) {
        this.dummy.scale.setScalar(0);
      } else {
        this.dummy.scale.setScalar(scale * 0.8 * (1 - age * age));
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
      this.dummy.position.set(this.rippleAt[i * 3]!, this.rippleAt[i * 3 + 1]!, this.rippleAt[i * 3 + 2]!);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(live ? scale * (0.5 + age * 2.6) : 0);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
      this.ripples.setColorAt(i, this.color.setRGB(0.5 * fade, 0.85 * fade, 0.62 * fade));
      if (live && this.threadHas[i] === 1) {
        this.writeArc(
          pos, col, i, ARC_SEGMENTS,
          this.rippleAt[i * 3]!, this.rippleAt[i * 3 + 1]! + scale, this.rippleAt[i * 3 + 2]!,
          this.threadTo[i * 3]!, this.threadTo[i * 3 + 1]! + scale, this.threadTo[i * 3 + 2]!,
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
    (this.windows.material as THREE.MeshBasicMaterial).opacity = night * 0.62;
    // Bodies keep their own colour as the light goes. The land does not.
    for (const lift of this.bodyNight) lift.value = night * 0.62;
  }

  // ── Selection, focus, ties ─────────────────────────────────────────────────

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

  private pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    let best: { d: number; id: number } | null = null;
    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = this.figures[stage];
      if (!mesh || mesh.count === 0) continue;
      const hits = this.raycaster.intersectObject(mesh, false);
      const hit = hits[0];
      if (hit?.instanceId === undefined) continue;
      if (!best || hit.distance < best.d) best = { d: hit.distance, id: this.stageIds[stage]![hit.instanceId]! };
    }
    if (best) return best.id;
    // The ray missed every body. That is not the same as missing every being:
    // a reviewer's eight blind clicks near the centre of a default-camera frame
    // hit nothing at all, because a twenty-pixel figure is a twenty-pixel
    // target and the gaps between its limbs are most of it — and at FAR there
    // are no bodies to hit. So fall back to the nearest marker on screen,
    // inside its own footprint.
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let nearest = -1;
    let nearestD = Infinity;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const p = this.screenPoints[k]!;
      const dx = p.x - px;
      const dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < nearestD) {
        nearestD = d;
        nearest = k;
      }
    }
    if (nearest < 0) return null;
    const reach = Math.max(11, this.markerPixelsOf(this.screenIndex[nearest]!) * 0.7);
    return nearestD <= reach * reach ? this.screenPoints[nearest]!.id : null;
  }

  private handleClick(e: PointerEvent): void {
    // Ignore drags (orbit); only near-stationary taps are clicks.
    if (Math.abs(e.clientX - this.downX) > 5 || Math.abs(e.clientY - this.downY) > 5) return;
    const id = this.pick(e.clientX, e.clientY);
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
   * Project every drawn being to the canvas, keeping the ones actually in
   * frame. Everything that ranks, counts or labels a being reads this, so the
   * view can never report something it did not draw where it says it drew it.
   */
  private projectBeings(): void {
    this.screenPoints.length = 0;
    this.screenIndex.length = 0;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.beingOnScreen.fill(0, 0, this.instanceCount);
    for (let i = 0; i < this.instanceCount; i++) {
      this.probe.set(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]! + this.beingMark[i]! * 0.5, this.beingPos[i * 3 + 2]!);
      this.probe.project(this.camera);
      if (this.probe.z > 1) continue; // behind the camera
      const px = ((this.probe.x + 1) / 2) * w;
      const py = ((1 - this.probe.y) / 2) * h;
      if (px < 0 || px > w || py < 0 || py > h) continue;
      this.beingOnScreen[i] = 1;
      this.screenPoints.push({ id: this.ids[i]!, x: px, y: py });
      this.screenIndex.push(i);
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
   * At NEAR there are no chips. Standing in the street, a number floating over
   * six visible people is answering a question nobody at that distance is
   * asking, and the band's own contract says to pull back to count.
   */
  private updateCrowds(now: number): void {
    if (this.hullNodes.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const collapses = bandCountsBeings(this.band);
    if (this.band === 'near') {
      if (this.clusters.length > 0) {
        this.clusters = [];
        for (const node of this.hullNodes) node.style.display = 'none';
        for (const node of this.countNodes) node.style.display = 'none';
      }
      this.beingCrowded.fill(0, 0, this.instanceCount);
      this.chipRects.length = 0;
      return;
    }
    // Ten times a second is enough while the camera is still; while it is NOT,
    // the grouping has to be redone in the same frame as the projection it is
    // built from, or for a tenth of a second the view draws pins inside hulls
    // that were computed for where the beings used to be — and `countAudit`
    // would report an arithmetic that does not close.
    if (now - this.lastCluster > 90 || (collapses && this.camMoving)) {
      this.lastCluster = now;
      if (collapses) {
        // One PIN wide, so two marks that could touch are always in the same
        // group — that is what makes "no two pins a reader counts separately
        // ever overlap" a property of the geometry rather than a hope.
        this.clusters = planCount(this.screenPoints, this.annotationPixels(), CLUSTER_BUDGET).chips;
      } else {
        this.clusters = clusterHierarchy(
          this.screenPoints,
          Math.max(14, this.bandPx * CLUSTER_CELL_MARKERS),
          CLUSTER_MIN,
          CLUSTER_BUDGET,
        );
      }
      // Each group is anchored in the WORLD, so its outline follows the orbit
      // smoothly between the ten times a second the grouping itself is redone.
      this.beingCrowded.fill(0, 0, this.instanceCount);
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
        for (const m of cl.members) {
          const i = this.screenIndex[m]!;
          this.beingCrowded[i] = 1;
          cx += this.beingPos[i * 3]!;
          cy += this.beingPos[i * 3 + 1]!;
          cz += this.beingPos[i * 3 + 2]!;
        }
        const n = cl.members.length;
        this.clusterWorld[c * 4] = cx / n;
        this.clusterWorld[c * 4 + 1] = cy / n;
        this.clusterWorld[c * 4 + 2] = cz / n;
        this.clusterWorld[c * 4 + 3] = this.camera.position.distanceTo(
          this.probe.set(cx / n, cy / n, cz / n),
        );
      }
    }

    this.chipRects.length = 0;
    for (let c = 0; c < this.hullNodes.length; c++) {
      const hull = this.hullNodes[c]!;
      const count = this.countNodes[c]!;
      const cl = this.clusters[c];
      if (!cl) {
        if (hull.style.display !== 'none') hull.style.display = 'none';
        if (count.style.display !== 'none') count.style.display = 'none';
        continue;
      }
      this.probe.set(this.clusterWorld[c * 4]!, this.clusterWorld[c * 4 + 1]!, this.clusterWorld[c * 4 + 2]!);
      const dNow = this.camera.position.distanceTo(this.probe);
      this.probe.project(this.camera);
      const px = ((this.probe.x + 1) / 2) * w;
      const py = ((1 - this.probe.y) / 2) * h;
      const zoom = dNow > 0 ? this.clusterWorld[c * 4 + 3]! / dNow : 1;
      // An ellipse drawn on a bounding box leaves the corners of the group
      // outside itself, and a being outside the outline that counts it is a
      // being the reader counts twice.
      const rx = Math.max(14, cl.rx * zoom * 1.22);
      const ry = Math.max(12, cl.ry * zoom * 1.22);
      if (this.probe.z > 1 || px < -rx || px > w + rx || py < -ry || py > h + ry) {
        hull.style.display = 'none';
        count.style.display = 'none';
        continue;
      }
      hull.style.display = 'block';
      const cls = collapses ? 'whull full' : 'whull';
      if (hull.className !== cls) hull.className = cls;
      hull.style.width = `${Math.round(rx * 2)}px`;
      hull.style.height = `${Math.round(ry * 2)}px`;
      hull.style.transform = `translate(-50%, -50%) translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      const text = String(cl.count);
      if (count.textContent !== text) count.textContent = text;
      count.style.display = 'block';
      // OUTSIDE the outline, up and to the right, clear of the ellipse by the
      // chip's own radius. Round two put it on the boundary at 0.72 of the
      // extent, which is inside the crowd: a number printed over the people it
      // is counting hides two of them and makes the count it claims unverifiable.
      //
      // And clear of every chip already placed. A number sitting on another
      // group's outline belongs to whichever group the reader decides it
      // belongs to, which is the same ambiguity in a smaller place.
      const halfW = text.length * 3.5 + 7;
      let chipX = 0;
      let chipY = 0;
      for (let slot = 0; slot < CHIP_SLOTS.length; slot++) {
        const [sx, sy] = CHIP_SLOTS[slot]!;
        chipX = Math.round(Math.min(w - halfW - 3, Math.max(halfW + 3, px + sx * (rx * 0.72 + halfW + 5))));
        chipY = Math.round(Math.min(h - 11, Math.max(11, py + sy * (ry * 0.72 + 13))));
        let clear = true;
        for (const t of this.chipRects) {
          if (chipX - halfW < t.x1 + 4 && chipX + halfW > t.x0 - 4 && chipY - 9 < t.y1 + 4 && chipY + 9 > t.y0 - 4) {
            clear = false;
            break;
          }
        }
        if (clear) break;
      }
      count.style.transform = `translate(-50%, -50%) translate(${chipX}px, ${chipY}px)`;
      // Names are placed around these, not on top of them.
      this.chipRects.push({ x0: chipX - halfW, y0: chipY - 9, x1: chipX + halfW, y1: chipY + 9 });
    }
  }

  private updateLabels(now: number): void {
    if (this.labelNodes.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const budget = labelBudgetFor(this.band);

    // The candidate set is re-chosen a few times a second, not every frame: a
    // set that churns at 60 Hz is a set nobody can read. Only beings that are
    // ON SCREEN and not behind a hill are considered — round one ranked purely
    // by camera distance, reported seven names, and drew none of them.
    if (now - this.lastLabelPick > 240 || (this.hoveredId !== null && !this.labelPicked.includes(this.hoveredId))) {
      this.lastLabelPick = now;
      const cam = this.camera.position;
      const near: { k: number; d: number }[] = [];
      for (let k = 0; k < this.screenPoints.length; k++) {
        const i = this.screenIndex[k]!;
        const dx = this.beingPos[i * 3]! - cam.x;
        const dy = this.beingPos[i * 3 + 1]! - cam.y;
        const dz = this.beingPos[i * 3 + 2]! - cam.z;
        near.push({ k, d: dx * dx + dy * dy + dz * dz });
      }
      // Rank first, distance second. Sorting by distance alone and then taking
      // the head of the list loses the selected being the moment it is not one
      // of the nearest — which is most of the time, and is the one name that
      // must never be missing.
      const rankOf = (id: number): number => (id === this.selectedId ? 0
        : id === this.hoveredId ? 1
          : this.kinSet.has(id) || this.bondSet.has(id) ? 2 : 3);
      near.sort((a, b) => {
        const ra = rankOf(this.ids[this.screenIndex[a.k]!]!);
        const rb = rankOf(this.ids[this.screenIndex[b.k]!]!);
        return ra === rb ? a.d - b.d : ra - rb;
      });
      this.labelCandidates = [];
      // At NEAR, only the beings you are standing among. A reviewer's frame had
      // fifteen names in it, most of them belonging to people on the far side
      // of the valley — every one of them true, and together a web of leader
      // lines over a picture of six people. The selected being, the hovered one
      // and their kin keep their names wherever they are; everyone else has to
      // be within walking distance.
      const nearOnly = this.band === 'near' ? NEAR_LABEL_M * NEAR_LABEL_M : 0;
      for (const { k, d } of near) {
        if (this.labelCandidates.length >= budget * 2 + 6) break;
        const i = this.screenIndex[k]!;
        const id = this.ids[i]!;
        // The specimen is read with the probes and nothing else. A name over a
        // synthetic being would hand the reader the answer to the question the
        // specimen exists to ask.
        if (isSpecimenId(id)) continue;
        const rank = rankOf(id);
        // At FAR the contract is how many, where, and which one is selected.
        // A handful of names scattered over a continent is not an answer to
        // any of those, and the legend out there does not offer one.
        if (this.band === 'far' && rank > 1) continue;
        if (nearOnly > 0 && rank === 3 && d > nearOnly) continue;
        // A name over a being the view has folded into a crowd's number points
        // at ground where nothing is drawn.
        if (rank === 3 && bandCountsBeings(this.band) && this.beingCrowded[i] === 1) continue;
        const top = this.beingTop[i]!;
        if (rank === 3 && this.terrainHides(this.beingPos[i * 3]!, top, this.beingPos[i * 3 + 2]!)) continue;
        this.labelCandidates.push({ id, x: this.screenPoints[k]!.x, y: this.screenPoints[k]!.y, rank, text: this.labelTextFor(i, id) });
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
   * How far out the NEAR promise actually reached this frame.
   *
   * The band claims every being you could walk to is named. Round four printed
   * "every being in frame is named" over nineteen beings and four names, which
   * is the kind of claim that makes every other claim suspect. So the view
   * MEASURES it: find the nearest readable being that did NOT get a name, and
   * the promise is everything inside that. The chip over the canvas prints the
   * number, the legend points at the chip, and the claim is therefore true by
   * construction — and shrinks, visibly, when the frame is too crowded to keep
   * it.
   *
   * Readability here is the cheap test — on screen, not inside a chip, big
   * enough — because this runs every frame and the terrain march does not. A
   * being hidden by a hill that goes unnamed pulls the radius in, which is the
   * safe direction to be wrong in.
   */
  private auditNames(): void {
    if (this.band !== 'near') {
      this.namedWithin = 0;
      this.namesExpected = 0;
      return;
    }
    let cut = NEAR_LABEL_M;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      const id = this.ids[i]!;
      if (this.placedIds.has(id) || isSpecimenId(id)) continue;
      if (this.markerPixelsOf(i) < READABLE_MARK_PX || this.isCollapsed(i)) continue;
      const d = this.distanceTo(i);
      if (d < cut) cut = d;
    }
    let held = 0;
    for (let k = 0; k < this.screenPoints.length; k++) {
      const i = this.screenIndex[k]!;
      if (isSpecimenId(this.ids[i]!)) continue;
      if (this.markerPixelsOf(i) < READABLE_MARK_PX || this.isCollapsed(i)) continue;
      if (this.distanceTo(i) <= cut) held++;
    }
    this.namedWithin = cut;
    this.namesExpected = held;
  }

  /**
   * The naming claim, measured: how far out every readable being got a name,
   * and how many that was. `shown` is the list actually drawn, so a reviewer
   * can check all three against the picture.
   */
  labelAudit(): { claim: string; withinM: number; expected: number; shown: number } {
    const near = this.band === 'near';
    return {
      claim: near
        ? `every being within ${this.namedWithin.toFixed(1)} m is named`
        : bandPromise(this.band).names === 'found'
          ? 'only the selected being is named'
          : 'names for whoever there is room to name, nearest first',
      withinM: near ? this.namedWithin : 0,
      expected: near ? this.namesExpected : this.labelShown.length,
      shown: this.labelShown.length,
    };
  }

  private labelTextFor(i: number, id: number): string {
    const name = displayName(id, this.names.get(id));
    return id === this.selectedId || id === this.hoveredId
      ? `${name.text} · ${stageWord(this.beingStage[i]!)} · ${describeState(this.beingAct[i]!, this.beingCond[i]!)}`
      : name.text;
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
   */
  visibilityOf(id: number): {
    visible: boolean; markPx: number; bodyPx: number; inFrame: boolean; collapsed: boolean; behindLand: boolean; reason: string;
  } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const inFrame = this.beingOnScreen[i] === 1;
    const markPx = this.markerPixelsOf(i);
    const bodyPx = this.bodyPixelsOf(i);
    const collapsed = this.isCollapsed(i);
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
    const reason = !inFrame ? 'out of frame'
      : collapsed ? 'counted by a crowd chip'
        : markPx < READABLE_MARK_PX ? 'drawn too small to read'
          : tooSmallForDetail ? 'smaller than the band draws detail at'
            : behindLand && !carried ? 'behind the land, too small to x-ray'
              : 'visible';
    return { visible: reason === 'visible', markPx, bodyPx, inFrame, collapsed, behindLand, reason };
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
    if (i < 0 || !bandShowsDetail(this.band) || !this.isVisible(id)) return null;
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
  countAudit(): { pinsDrawn: number; chips: { n: number; x: number; y: number }[]; beingsInFrustum: number } {
    const rect = this.canvas.getBoundingClientRect();
    const chips: { n: number; x: number; y: number }[] = [];
    for (let c = 0; c < this.clusters.length; c++) {
      const cl = this.clusters[c]!;
      if (this.countNodes[c]?.style.display === 'none') continue;
      chips.push({ n: cl.count, x: rect.left + cl.x, y: rect.top + cl.y });
    }
    return { pinsDrawn: this.pinsDrawn, chips, beingsInFrustum: this.screenPoints.length };
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

  /** The crowds the view has put a number on, and what those numbers say. */
  clustersShown(): { count: number; x: number; y: number }[] {
    const rect = this.canvas.getBoundingClientRect();
    const out: { count: number; x: number; y: number }[] = [];
    for (let c = 0; c < this.clusters.length; c++) {
      const cl = this.clusters[c]!;
      if (this.hullNodes[c]?.style.display === 'none') continue;
      out.push({ count: cl.count, x: rect.left + cl.x, y: rect.top + cl.y });
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

  /** Where this being stands, in scene units — the same frame `placeCamera` takes. */
  worldPositionOf(id: number): { x: number; y: number; z: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    return { x: this.beingPos[i * 3]!, y: this.beingPos[i * 3 + 1]!, z: this.beingPos[i * 3 + 2]! };
  }

  screenPositionOf(id: number): { x: number; y: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    this.probe.set(this.beingPos[i * 3]!, (this.beingPos[i * 3 + 1]! + this.beingTop[i]!) / 2, this.beingPos[i * 3 + 2]!);
    this.probe.project(this.camera);
    if (this.probe.z > 1) return null; // behind the camera
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((this.probe.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.probe.y) / 2) * rect.height,
    };
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  render(): void {
    const t = this.clock.getElapsedTime();
    const now = performance.now();
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
    this.writeMarkers(t);
    this.updateFootprints();
    this.updateSelection(t);
    this.updateTransients(t);
    // Hover costs a raycast against every drawn body, so it is paid only when
    // the pointer has actually moved, and at most a dozen times a second. A
    // still pointer — every screenshot, and most of the time — costs nothing.
    if (this.pointerInside && this.pointerMoved && now - this.lastHoverPick > 80) {
      this.lastHoverPick = now;
      this.pointerMoved = false;
      this.hoveredId = this.pick(this.pointerX, this.pointerY);
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
    // Two hundred units of continent, measured where the camera is aiming, so
    // the bar is the scale of the ground a reader is actually looking at.
    const span = 200 / Math.max(1e-6, this.camera.position.distanceTo(this.controls.target) * this.worldPerPx);
    const width = `${Math.round(Math.max(18, Math.min(190, span)))}px`;
    if (bar.style.width !== width) bar.style.width = width;
    const px = this.bandPx;
    const size = px >= 10 ? `a being is ${Math.round(px)} px` : `a being is under a pixel · pins are ${Math.round(this.annotPx * RING_OUTER * 2)} px`;
    // At NEAR the naming promise carries the radius it actually reached this
    // frame, because "every being in frame is named" was neither true nor
    // makeable true, and a measured claim beats a brave one.
    const reach = this.band === 'near' ? ` · named within ${this.namedWithin.toFixed(0)} m` : '';
    const text = `${this.band} · ${size} · ${bandPromise(this.band).says}${reach}${this.specimenOn ? ' · SPECIMEN' : ''}`;
    if (words.textContent !== text) words.textContent = text;
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden — keep the last good size
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
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
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
