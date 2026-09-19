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
  annotationOpacity,
  annotationRadius,
  bandForPixels,
  bandPromise,
  bandShowsBodies,
  bandShowsDetail,
  bodyTint,
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
  LABEL_BUDGET_MAX,
  figurePxAt,
  movingFor,
  PICTO_GRID,
  PICTO_NONE,
  PICTO_SPEAK,
  pictogramFor,
  placeLabels,
  readableActivity,
  RING_DASHED,
  RING_DOUBLE,
  RING_NOTCHED,
  RING_STYLE_COUNT,
  ringStyleFor,
  stageFootprint,
  stageForm,
  stageHalo,
  stageWord,
  FAMILY_RGB,
  type Family,
  type Cluster,
  type LabelCandidate,
  type LabelObstacle,
  type ScreenPoint,
  type ZoomBand,
} from './beings.js';
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
const GRID = 200; // terrain resolution
const HALF = WORLD / 2;

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
 * A crowd is a group of beings closer together than this many marker-widths,
 * and it earns a number once this many are in it. Both are in screen space:
 * crowding is a property of the picture, not of the continent.
 */
const CLUSTER_CELL_MARKERS = 1.25;
const CLUSTER_MIN = 3;

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
function ringGeometry(style: number, halo: boolean): THREE.BufferGeometry {
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
    weigh(new THREE.RingGeometry(0.40, 0.60, 28), COND);
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

  // An elder's mark is ringed twice, and the second ring is OUTSIDE the rim.
  //
  // Stage was the worst-read channel in both earlier rounds, because from an
  // oblique-top camera a body foreshortens and a stoop reads as somebody
  // bending over their work. The ground does not foreshorten. This is the one
  // outer band in the vocabulary — the sick being's second ring is a small disc
  // INSIDE the rim, and a being in danger wears eight separate spikes — so it
  // cannot be confused with a condition.
  if (halo) {
    weigh(new THREE.RingGeometry(1.30, 1.38, 40), INK);
    weigh(new THREE.RingGeometry(1.22, 1.30, 40), BONE);
  }

  // The heading pointer, aimed along -Y here so that it points along +Z — the
  // being's own forward — once the ring is laid flat. Round one authored it at
  // +Y, so every wedge in every screenshot pointed at where the being had just
  // been.
  //
  // It is long on purpose and it is ALWAYS long: two fifths of the whole mark,
  // which is what it takes to call one of eight directions off a still frame.
  // Round two spent this length on a second meaning — short for standing, long
  // for walking — and got both wrong at once, reading heading at 55%. Motion
  // now has a channel of its own (the streak), and the pointer has one job.
  //
  // It is a DART, not a flag: narrow, with a dark keyline under it and a
  // fraction of ink mixed into its fill. Drawn at full strength and full width
  // it was the loudest thing in the frame — a field of white kites with people
  // somewhere underneath them — and the subject of this view is the people.
  const keyline = new THREE.BufferGeometry();
  keyline.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0.37, -1.02, 0.006, -0.37, -1.02, 0.006, 0, -2.62, 0.006,
  ]), 3));
  keyline.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  keyline.setIndex([0, 1, 2]);
  keyline.computeVertexNormals();
  weigh(keyline, INK);
  const wedge = new THREE.BufferGeometry();
  wedge.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0.25, -1.10, 0.012, -0.25, -1.10, 0.012, 0, -2.46, 0.012,
  ]), 3));
  wedge.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  wedge.setIndex([0, 1, 2]);
  wedge.computeVertexNormals();
  weigh(wedge, [0.86, 0.14, 0]);

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
 */
function ringMaterial(fade: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
  /** How much of the thing survives at full fade. Foliage goes; a building ghosts. */
  uFadeFloor: { value: number };
}

/**
 * Scenery that gets out of the way.
 *
 * Six thousand trees and a thousand huts will hide beings — the ones between
 * the camera and the world, and the ones standing over whoever you are
 * watching. Both have to clear out, and how they clear out is the whole point:
 * round one discarded fragments against a 4×4 screen-door, and a reviewer
 * magnified it and found "trees and huts dissolving into a dark checkerboard
 * which at real size reads as speckle or dead pixels". A one-pixel chequer is
 * not a dissolve, it is a rendering fault with an explanation.
 *
 * So nothing is discarded. The whole instance SHRINKS toward its own footing
 * and sinks into the ground, computed once per instance in the vertex shader
 * from a smooth distance falloff. No stipple, no transparency sorting, no
 * second pass — and the motion reads as deliberate, which a dither never can.
 */
function applyFoliageFade(material: THREE.Material, out: FadeUniforms[], near = 110, far = 320, floor = 0, sink = 9): void {
  material.onBeforeCompile = (shader) => {
    const u: FadeUniforms = {
      uFadeNear: { value: near },
      uFadeFar: { value: far },
      uSel: { value: new THREE.Vector3(0, -1e6, 0) },
      uSelR: { value: 0 },
      uFadeFloor: { value: floor },
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
        uniform float uFadeFloor;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 fadeAnchor = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 fadeWorld = (modelMatrix * fadeAnchor).xyz;
          float fadeDepth = -(modelViewMatrix * fadeAnchor).z;
          float fadeCam = smoothstep(uFadeNear, uFadeFar, fadeDepth);
          float fadeSel = uSelR > 0.0 ? smoothstep(uSelR * 0.55, uSelR * 1.6, distance(fadeWorld, uSel)) : 1.0;
          float fadeA = max(uFadeFloor, min(fadeCam, fadeSel));
          transformed *= fadeA;
          transformed.y -= (1.0 - fadeA) * ${sink.toFixed(1)};
        }`,
      );
  };
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
    // Far enough back that haze belongs to the mountains and not to the ground a
    // being is standing on.
    this.scene.fog = new THREE.Fog(0x9db6c6, WORLD * 0.95, WORLD * 2.8);

    // A near plane of a quarter-metre, because the camera is allowed into the
    // street with them and a one-metre plane clips a being's knees off.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.25, WORLD * 8);
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
    const sky = new THREE.Mesh(new THREE.SphereGeometry(WORLD * 3, 24, 16), this.skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.buildTerrain();
    this.buildWater();
    this.buildWall();
    this.buildTrees();
    this.buildRocks();

    // Lit windows follow their hut out of the way, or they hang in the air over
    // a shelter that has stepped aside.
    // Pale lamp cream, not amber: a reviewer at midnight read warm window light
    // as starving beings, and #ffc46b is very nearly the starving colour.
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xf2dcae, transparent: true, opacity: 0, depthWrite: false });
    applyFoliageFade(windowMat, this.foliageFades, 3.5, 11, 0.45, 0);
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
    };
    this.onPointerUp = (e: PointerEvent): void => this.handleClick(e);
    this.onPointerMove = (e: PointerEvent): void => {
      if (e.clientX !== this.pointerX || e.clientY !== this.pointerY) this.pointerMoved = true;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerInside = true;
    };
    this.onPointerLeave = (): void => {
      this.pointerInside = false;
      this.hoveredId = null;
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  // ── Static scenery ─────────────────────────────────────────────────────────

  private static skyMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
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

  private buildTerrain(): void {
    const n = GRID;
    const step = WORLD / n;
    const positions = new Float32Array((n + 1) * (n + 1) * 3);
    const colors = new Float32Array((n + 1) * (n + 1) * 3);
    this.gridHeight = new Float32Array((n + 1) * (n + 1));
    let p = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const wx = i * step;
        const wy = j * step;
        const h = heightAt(wx, wy);
        this.gridHeight[j * (n + 1) + i] = h;
        positions[p] = wx - HALF;
        positions[p + 1] = h * HSCALE;
        positions[p + 2] = wy - HALF;
        const [r, g, b] = REGION_RGB[regionAt(wx, wy)];
        const shade = 0.82 + Math.min(0.5, h / 18) * 0.45;
        colors[p] = r * shade;
        colors[p + 1] = g * shade;
        colors[p + 2] = b * shade;
        p += 3;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        indices.push(a, a + (n + 1), a + 1, a + 1, a + (n + 1), a + (n + 1) + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })));
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(WORLD, WORLD);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1d5b7d, transparent: true, opacity: 0.74, roughness: 0.12, metalness: 0.35 }));
    mesh.position.y = SEA * HSCALE;
    this.scene.add(mesh);
  }

  private buildWall(): void {
    const H = 300;
    const TH = 14;
    const make = (w: number, d: number, x: number, z: number): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(w, H, d);
      g.translate(x, H / 2 - 30, z);
      return g;
    };
    const merged = mergeGeometries([
      make(WORLD + TH, TH, 0, -HALF), make(WORLD + TH, TH, 0, HALF),
      make(TH, WORLD + TH, -HALF, 0), make(TH, WORLD + TH, HALF, 0),
    ], false);
    if (merged) this.scene.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x413d38, roughness: 1 })));
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
    applyFoliageFade(trunkMat, this.foliageFades, 3.5, 12, 0, 6);
    applyFoliageFade(foliageMat, this.foliageFades, 3.5, 12, 0, 10);
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
      mesh.renderOrder = 2;
      this.ringMeshes[bucket] = mesh;
      this.scene.add(mesh);
    }

    const trails = new THREE.InstancedMesh(trailGeometry(), trailMaterial(this.trailFade), 64);
    trails.count = 0;
    trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    trails.frustumCulled = false;
    trails.renderOrder = 1;
    this.trails = trails;
    this.scene.add(trails);

    const dots = new THREE.InstancedMesh(dotGeometry(), ringMat, 64);
    dots.count = 0;
    dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    dots.frustumCulled = false;
    dots.renderOrder = 2;
    dots.visible = false;
    this.dots = dots;
    this.scene.add(dots);

    for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
      const mesh = new THREE.InstancedMesh(figureGeometry(stage), this.figureMaterial(), 64);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.figures[stage] = mesh;
      this.scene.add(mesh);
    }
    this.growBeingCapacity(64);

    const atlas = buildGlyphAtlas();
    const pictoGeo = new THREE.PlaneGeometry(1, 1);
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    cell.setUsage(THREE.DynamicDrawUsage);
    pictoGeo.setAttribute('aCell', cell);
    this.pictoCell = cell;
    this.pictos = new THREE.InstancedMesh(pictoGeo, World3D.pictoMaterial(atlas), 64);
    // The pictogram shader reads `instanceColor`, and three only declares that
    // attribute for a mesh that already has one.
    this.pictos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    this.pictos.count = 0;
    this.pictos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pictos.frustumCulled = false;
    this.pictos.renderOrder = 4;
    // Push the quad up and right by exactly enough that the stub drawn into
    // the lower-left of every cell ends on the rim of the ring the instance is
    // anchored to. Read off the atlas's own numbers, so moving the chip in the
    // drawing moves it in the world.
    const offset = (this.pictos.material as THREE.ShaderMaterial).uniforms['uOffset']!.value as THREE.Vector2;
    offset.set(PICTO_RIM / PICTO_H - PICTO_STUB_AT[0], PICTO_RIM / PICTO_H - PICTO_STUB_AT[1]);
    this.scene.add(this.pictos);
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
  private static pictoMaterial(map: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: map },
        uGrid: { value: PICTO_GRID },
        uOffset: { value: new THREE.Vector2(0, 0) },
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
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.04) discard;
          // The atlas is a mask: white is the chip, black is its keyline and
          // the symbol punched into it. The chip takes the tint, the ink stays
          // dark, so the mark holds against grass, snow, water and night alike.
          gl_FragColor = vec4(mix(vec3(0.02, 0.022, 0.026), vTint, t.r), t.a);
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
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
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

    this.growBeingCapacity(f.beings);
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
    this.instanceCount = f.beings;

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
    const pictos = this.pictos!;
    const cells = this.pictoCell!;
    const trails = this.trails!;
    const dots = this.dots!;
    this.figureCount = [0, 0, 0];
    this.ringCount.fill(0);
    let pictoAt = 0;
    let trailAt = 0;
    let dotAt = 0;

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

      if (!bodies) {
        // A dot for everyone the crowd numbers do not already account for.
        // Drawing both would ask a reader to add a number to the dots printed
        // underneath it, which is the one arithmetic this view must never
        // invite.
        if (this.beingCrowded[i] === 1) continue;
        const rd = deco * DOT_R;
        this.basis.makeBasis(this.right, this.up, this.fwd);
        this.basis.scale(this.dummy.scale.setScalar(rd));
        this.basis.setPosition(sx + this.up.x * rd * 0.2, surface + this.up.y * rd * 0.2, sz + this.up.z * rd * 0.2);
        dots.setMatrixAt(dotAt, this.basis);
        dots.setColorAt(dotAt, this.color.setHex(ringHue));
        dotAt++;
        continue;
      }

      const bucket = ringStyleFor(cond, act) * 2 + (stageHalo(stage, this.band) ? 1 : 0);
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
      this.dummy.scale.setScalar(deco * PICTO_H);
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
        // A shelter the selected being is standing in is as much of a wall as a
        // tree is; it clears out on the same rule. It shrinks in place rather
        // than sinking — a hut's geometry stands on its own origin, and it
        // keeps a sixth of its size so you can still see that a building is
        // there.
        const material = structureMaterial(kind);
        applyFoliageFade(material, this.foliageFades, 3.5, 11, 0.45, 0);
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

    const written = new Map<string, number>();
    let windowAt = 0;
    this.dummy.scale.set(1, 1, 1);
    for (const s of this.structures) {
      const mesh = this.structureMeshes.get(s.kind)!;
      const at = written.get(s.kind) ?? 0;
      written.set(s.kind, at + 1);
      const base = this.surfaceAt(s.x, s.y);
      // Turned by who built it, so a settlement has the slight disorder of
      // something raised by hand rather than a grid stamped on the ground.
      this.dummy.rotation.set(0, hash2(s.id, s.builtBy) * Math.PI * 2, 0);
      this.dummy.position.set(s.x - HALF, base, s.y - HALF);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(at, this.dummy.matrix);
      if (s.kind === 'shelter') {
        const yaw = hash2(s.id, s.builtBy) * Math.PI * 2;
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.position.set(s.x - HALF + Math.sin(yaw) * 2.55, base + 1.5, s.y - HALF + Math.cos(yaw) * 2.55);
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
    (this.scene.fog as THREE.Fog).color.copy(NIGHT_SKY_LO).lerp(DAY_SKY_LO, d);
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
      // Nothing is selected, so nothing is standing in the way of anything —
      // except at NEAR, where the camera is a few marker-widths off the ground
      // and a single hut is a wall across the frame. There the view clears the
      // ground it is AIMED at, which is the whole reason anyone is that close.
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

    // Foliage standing over the selected being gets out of the way — but not
    // at NEAR. Down in the street the scene IS the answer, and a view that
    // deletes the house someone is standing next to in order to show you the
    // person standing next to a house has misunderstood the question.
    const clear = this.band === 'near' ? 0 : Math.max(6, h * 1.4);
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
    const cam = this.camera.position;
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
   * Project every drawn being to the canvas, keeping the ones actually in
   * frame. Everything that ranks, counts or labels a being reads this, so the
   * view can never report something it did not draw where it says it drew it.
   */
  private projectBeings(): void {
    this.screenPoints.length = 0;
    this.screenIndex.length = 0;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (let i = 0; i < this.instanceCount; i++) {
      this.probe.set(this.beingPos[i * 3]!, this.beingPos[i * 3 + 1]! + this.beingMark[i]! * 0.5, this.beingPos[i * 3 + 2]!);
      this.probe.project(this.camera);
      if (this.probe.z > 1) continue; // behind the camera
      const px = ((this.probe.x + 1) / 2) * w;
      const py = ((1 - this.probe.y) / 2) * h;
      if (px < 0 || px > w || py < 0 || py > h) continue;
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
  private updateCrowds(now: number): void {
    if (this.hullNodes.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (now - this.lastCluster > 90) {
      this.lastCluster = now;
      const markerPx = this.bandPx;
      this.clusters = clusterHierarchy(
        this.screenPoints,
        Math.max(14, markerPx * CLUSTER_CELL_MARKERS),
        CLUSTER_MIN,
        CLUSTER_BUDGET,
      );
      // Each group is anchored in the WORLD, so its outline follows the orbit
      // smoothly between the ten times a second the grouping itself is redone.
      this.beingCrowded.fill(0, 0, this.instanceCount);
      for (let c = 0; c < this.clusters.length; c++) {
        const cl = this.clusters[c]!;
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
      const halfW = text.length * 3.5 + 7;
      const chipX = Math.round(Math.min(w - halfW - 3, px + rx * 0.72 + halfW + 5));
      const chipY = Math.round(Math.max(11, py - ry * 0.72 - 13));
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
      for (const { k } of near) {
        if (this.labelCandidates.length >= budget * 2 + 6) break;
        const i = this.screenIndex[k]!;
        const id = this.ids[i]!;
        const rank = rankOf(id);
        // At FAR the contract is how many, where, and which one is selected.
        // A handful of names scattered over a continent is not an answer to
        // any of those, and the legend out there does not offer one.
        if (this.band === 'far' && rank > 1) continue;
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
    if (bandShowsDetail(this.band) && this.screenPoints.length <= 90) {
      for (let k = 0; k < this.screenPoints.length; k++) {
        const p = this.screenPoints[k]!;
        const i = this.screenIndex[k]!;
        const half = this.markerPixelsOf(i) * 0.5;
        this.bodyRects.push({ x0: p.x - half, y0: p.y - half, x1: p.x + half, y1: p.y + half });
      }
    }
    const placed = placeLabels(this.labelCandidates, w, h, budget, this.bodyRects, this.bandPx * 0.55);
    this.labelShown.length = 0;
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
    }
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

  /** What this being is doing and how it is, exactly as the view encoded it. */
  stateOf(id: number): { act: number; cond: number; picto: number; hue: number; ring: number; halo: boolean } | null {
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
      halo: stageHalo(this.beingStage[i]!, this.band),
    };
  }

  stageOf(id: number): number | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.beingStage[i]!;
  }

  /** The one word for how this being is — `well`, `starving`, `sick`, `in danger`. */
  conditionOf(id: number): string | null {
    const i = this.indexOf(id);
    return i < 0 ? null : conditionWord(this.beingCond[i]!, this.beingAct[i]!);
  }

  /** The one word for what this being is doing, as the SIM means it. */
  activityOf(id: number): string | null {
    const i = this.indexOf(id);
    return i < 0 ? null : activityWord(this.beingAct[i]!);
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
    return i < 0 ? null : readableActivity(this.beingAct[i]!, this.band);
  }

  /** The life stage the picture claims, or `null` where the band draws none. */
  stageShownOf(id: number): string | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsDetail(this.band)) return null;
    return stageWord(this.beingStage[i]!);
  }

  /** The condition the picture claims, or `null` at FAR, where it claims none. */
  conditionShownOf(id: number): string | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsBodies(this.band)) return null;
    return conditionWord(this.beingCond[i]!, this.beingAct[i]!);
  }

  /** Whether the picture says this being is on the move — the streak channel. */
  movingShownOf(id: number): boolean | null {
    const i = this.indexOf(id);
    if (i < 0 || !bandShowsDetail(this.band)) return null;
    return movingFor(this.beingAct[i]!);
  }

  /** Which way this being is facing in the world, in radians, as drawn. */
  headingOf(id: number): number | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.beingHeading[i]!;
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
    if (i < 0 || !bandShowsDetail(this.band)) return null;
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
    hut: number; hutFootprint: number; tree: number; treeShortest: number;
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
    const shelter = this.structureMeshes.get('shelter');
    const shelterGeo = shelter?.geometry;
    if (shelterGeo) shelterGeo.computeBoundingBox();
    const hutBox = shelterGeo?.boundingBox ?? null;
    const distance = this.camera.position.distanceTo(this.controls.target);
    return {
      unit: 'metre — 1 world unit = 1 m horizontally; the sim height index is drawn at 14 m per unit',
      adult: stageForm(STAGE_ADULT).scale,
      child: stageForm(STAGE_CHILD).scale,
      elder: stageForm(STAGE_ELDER).scale,
      hut: hutBox ? hutBox.max.y - hutBox.min.y : 0,
      hutFootprint: hutBox ? hutBox.max.x - hutBox.min.x : 0,
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
    this.updateCrowds(now);
    this.writeMarkers(t);
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
    this.renderer.render(this.scene, this.camera);
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
    const text = `${this.band} · ${size} · ${bandPromise(this.band).says}`;
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
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
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
 * What they build — low, on purpose.
 *
 * A marker holds its size on SCREEN, which means that the closer the camera
 * gets the smaller a being is in world units, and at mid zoom round two's huts
 * stood taller than the people who built them: a reviewer's elder was a head
 * poking over a roof. Nothing in this world may hide a being, so the buildings
 * come up to about knee height on the marker and stay there.
 */
function structureGeometry(kind: string): THREE.BufferGeometry {
  if (kind === 'shelter') {
    // Five metres square, walls to 2.4 m, ridge at 4.4 m — a one-room house a
    // 1.75 m person walks into. The engine agrees: it counts a being as being
    // "in shelter" within four units of one.
    const body = new THREE.BoxGeometry(5, 2.4, 5).translate(0, 1.2, 0);
    const roof = new THREE.ConeGeometry(4.3, 2.0, 4).rotateY(Math.PI / 4).translate(0, 3.4, 0);
    const door = new THREE.BoxGeometry(0.9, 1.9, 0.25).translate(0, 0.95, 2.5);
    return mergeGeometries([body, roof, door], false) ?? body;
  }
  if (kind === 'wall') return new THREE.BoxGeometry(4, 2.2, 1.1).translate(0, 1.1, 0);
  const lid = new THREE.BoxGeometry(2.0, 0.28, 2.0).translate(0, 1.28, 0);
  const box = new THREE.BoxGeometry(1.8, 1.2, 1.8).translate(0, 0.6, 0);
  return mergeGeometries([box, lid], false) ?? box;
}

function structureMaterial(kind: string): THREE.Material {
  if (kind === 'shelter') return new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.88 });
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
