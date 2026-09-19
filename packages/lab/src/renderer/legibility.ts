/**
 * What a reader can actually SEE — the three things round four proved the view
 * was not entitled to assume.
 *
 * Round four's stranger test scored 0–14% at MID and NEAR, and the cause was
 * not the marks: sixteen of twenty-nine targets had three body pixels or fewer
 * where the view's own probe said they were. The beings were inside huts and
 * behind trunks, the probes were band-aware and nothing else, and the hut the
 * report measured at 4.40 m was drawn at 2.5 m because the "step aside" rule
 * SCALED it. Three separate lies, one root: nothing here was ever checked
 * against the picture.
 *
 * So this module holds the parts of that check that are pure arithmetic, where
 * a test can hold them to it:
 *
 *   · what a hut IS, as a contract — ridge, eaves, footprint and a doorway a
 *     grown being walks through — expressed once, built from here, and measured
 *     from here, so the drawing and the report cannot drift apart again;
 *   · how the beings a reader is looking at are packed into the handful of
 *     spheres the scenery shader tests itself against, so that anything
 *     standing between the eye and one of them turns to a ghost;
 *   · how big a mark has to be drawn before the view is allowed to claim a
 *     reader can call it;
 *   · the LEGIBILITY SPECIMEN — a laid-out grid covering every stage, every
 *     condition, every activity and all eight headings, so the channels can be
 *     tested against a picture that actually contains them. The run round four
 *     reviewed had three unwell beings in two hundred and fifty-one, so
 *     condition was never tested at all; a hundred per cent on that frame and
 *     seven per cent both mean nothing.
 *
 * Pure: no DOM, no three, no engine. It runs in Node.
 */

import {
  ACT_DANGER,
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

// ── How big is big enough to be called ───────────────────────────────────────

/**
 * The smallest mark — the being's own body or its ground pin, whichever is
 * larger — the view will claim a reader can read, in CSS pixels.
 *
 * Under this the probes answer `visible: false` and the band's channels answer
 * nothing, because a stranger scored on a six-pixel smudge is being scored on
 * the view's optimism. Nine pixels is about where a bone figure separates from
 * the grass under it at this contrast; the DEFAULT pin is twenty-four and the
 * MID body is sixty-odd, so this only ever bites on the far side of a frame.
 */
export const READABLE_MARK_PX = 9;

/**
 * And how tall the BODY itself has to stand before the x-ray silhouette is
 * worth drawing. Below this a silhouette is a speck, and three hundred specks
 * showing through a mountain is noise with an explanation.
 */
export const XRAY_MIN_BODY_PX = 9;

/**
 * And how tall a body has to stand before it is given a dark keyline.
 *
 * Lower than the x-ray's floor on purpose: the keyline is what separates one
 * pale figure from the next, and a crowd at DEFAULT is exactly where that
 * separation is scarcest. Below this a body is a few pixels of bone and an
 * outline round it would be a dark speck rather than an edge.
 */
export const OUTLINE_MIN_BODY_PX = 6;

/**
 * The smallest an unwell being's flag is ever drawn, in CSS pixels of height.
 *
 * It is a FLOOR, not a size: the flag scales with its being like everything
 * else and then refuses to go under this, because the whole job of the mark is
 * to be findable in a frame a reader is scanning rather than studying. At
 * DEFAULT a being is fourteen pixels and two sick in a hundred and twenty-three
 * is what a reviewer missed four times running.
 */
export const FLAG_MIN_PX = 13;

/**
 * How tall the pennant stands above its anchor, per unit of instance scale.
 *
 * `flagGeometry`'s mast runs 0 → 1 with an 0.085 keyline grow, and the anchor
 * is lifted a fifth of the scale above the head. A magic 1.305 spread across
 * two files is how a mark ends up taller than the person carrying it.
 */
export const FLAG_TOTAL_H = 1.085 + 0.22;

/** And the most of a being's own height a mark ABOUT it may ever occupy. */
export const PENNANT_OF_FIGURE = 0.55;

/**
 * How big to draw one being's pennant, in world units of instance scale.
 *
 * Two rules, and the larger wins because they are about different failures.
 * The floor is in SCREEN pixels and exists so a starving being two pixels tall
 * is still findable — a reviewer found one from the flag alone, which is the
 * whole reason the mark exists. The cap is in the BEING's own height and exists
 * because the same reviewer measured a 115 px flag over a 100 px adult on the
 * specimen grid and called it "detached and oversized where it matters most".
 *
 * `metresPerPx` is `worldPerPx × distance` — how much world one screen pixel
 * covers at this being.
 */
export function pennantSize(figureHeightM: number, metresPerPx: number): number {
  return Math.max(FLAG_MIN_PX * metresPerPx, (figureHeightM * PENNANT_OF_FIGURE) / FLAG_TOTAL_H);
}

/** How tall that pennant then stands, in world units — what the cap is about. */
export function pennantHeight(figureHeightM: number, metresPerPx: number): number {
  return pennantSize(figureHeightM, metresPerPx) * FLAG_TOTAL_H;
}

/**
 * Pull a point into a hut's floor plan, in the hut's own rotated frame.
 *
 * `dx`/`dz` are the offset from the hut's centre in world axes, `yaw` is how
 * far the building is turned, and `half` is the half-width of the space a body
 * may stand in. The picture is not allowed to draw somebody through a wall
 * however the sim placed them: a reviewer's NEAR crop of a sixty-three-person
 * shelter is a picket of bodies pushing out through both side walls, and
 * nobody reads that as a crowded room.
 */
export function clampToRoom(dx: number, dz: number, yaw: number, half: number): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const lx = Math.min(Math.max(dx * cos - dz * sin, -half), half);
  const lz = Math.min(Math.max(dx * sin + dz * cos, -half), half);
  return { x: lx * cos + lz * sin, z: -lx * sin + lz * cos };
}

// ── The subjects the scenery has to step aside for ───────────────────────────

/**
 * A being the reader is looking at, as the scenery shader needs it: a sphere in
 * VIEW space, because "between the camera and this being" is a statement about
 * the eye and not about the continent.
 */
export interface Subject {
  x: number;
  y: number;
  /** View-space z — negative in front of the camera, as three has it. */
  z: number;
  /** Radius in metres, wide enough to hold the whole figure. */
  r: number;
}

/** How many of them the shader carries. Must match `uSubject[N]` in the shader. */
export const SUBJECT_SLOTS = 24;

/** How wide a being's own sphere is: shoulders, plus room for the head. */
export const SUBJECT_R = 1.35;

/**
 * Pack the beings on screen into at most `max` spheres, losing none of them.
 *
 * The scenery tests every trunk and every wall against this list once per
 * vertex, so the list has to be short and it has to be complete: a being left
 * out is a being a hut is still allowed to stand in front of, which is the
 * whole defect. Nearest first — what is close is what is being read — and
 * anything that will not fit in its own slot is absorbed into the sphere whose
 * centre it is closest to, which GROWS to hold it. The result covers every
 * input, always; `packSubjects` is tested on exactly that.
 *
 * Growing rather than dropping costs a little precision — a swollen sphere
 * ghosts a tree that was only beside the crowd rather than in front of it — and
 * that is the right way to be wrong. An extra ghost is a frame you can still
 * read; a missed one is a being nobody can find.
 */
export function packSubjects(src: readonly Subject[], out: Float32Array, max = SUBJECT_SLOTS): number {
  const cap = Math.min(max, Math.floor(out.length / 4));
  if (cap <= 0) return 0;
  let n = 0;
  for (const s of src) {
    let merged = false;
    // Into an existing sphere, if it is close enough that holding both barely
    // grows it. Depth matters as much as position: two beings on the same line
    // of sight twenty metres apart are not one subject.
    for (let k = 0; k < n; k++) {
      const dx = out[k * 4]! - s.x;
      const dy = out[k * 4 + 1]! - s.y;
      const dz = out[k * 4 + 2]! - s.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d + s.r > out[k * 4 + 3]! + SUBJECT_R * 1.6) continue;
      // The margin is not cosmetic: `out` is a Float32Array, and a radius that
      // rounds DOWN by a ten-thousandth is a being outside the sphere that was
      // grown to hold it.
      out[k * 4 + 3] = Math.max(out[k * 4 + 3]!, d + s.r + COVER_SLACK);
      merged = true;
      break;
    }
    if (merged) continue;
    if (n < cap) {
      out[n * 4] = s.x;
      out[n * 4 + 1] = s.y;
      out[n * 4 + 2] = s.z;
      out[n * 4 + 3] = s.r;
      n++;
      continue;
    }
    // Full. Absorb into the nearest sphere, which swells to cover it — nothing
    // is ever dropped.
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const dx = out[k * 4]! - s.x;
      const dy = out[k * 4 + 1]! - s.y;
      const dz = out[k * 4 + 2]! - s.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    out[best * 4 + 3] = Math.max(out[best * 4 + 3]!, bestD + s.r + COVER_SLACK);
  }
  return n;
}

/** Float32 headroom, in metres — see `packSubjects`. */
const COVER_SLACK = 0.01;

/** Whether a packed sphere really does hold this being — what the test asks. */
export function subjectCovers(out: Float32Array, n: number, s: Subject): boolean {
  for (let k = 0; k < n; k++) {
    const dx = out[k * 4]! - s.x;
    const dy = out[k * 4 + 1]! - s.y;
    const dz = out[k * 4 + 2]! - s.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) + s.r <= out[k * 4 + 3]! + COVER_SLACK) return true;
  }
  return false;
}

// ── A hut, as a contract ─────────────────────────────────────────────────────

/** One box of a building, in metres, with its centre where it stands. */
export interface BoxPart {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
}

/**
 * What a shelter IS. Not a description of what happens to be drawn — the source
 * the geometry is built from and the report is measured against.
 *
 * Round four found `scaleReport().hut` claiming 4.40 m over a hut that measured
 * 2.43–2.56 m in two independent frames. The geometry was right and the REPORT
 * was right; what was wrong was that the "get out of the way" rule shrank the
 * instance in the vertex shader, so the thing on screen was 55% of the thing
 * both numbers described. Ghosting is now a matter of opacity and never of
 * size, and these numbers are therefore what a reviewer's ruler finds.
 *
 * A one-room house: five metres square inside, walls to the eaves at 2.4 m, a
 * pyramid roof whose ridge stands at 4.4 m and whose eaves overhang to a 6.08 m
 * footprint. The doorway is a real opening two metres tall — a 1.75 m adult
 * walks through it with clear air over their head, and a being standing in it
 * is a being you can see.
 */
export const SHELTER = {
  /** Inside wall square, metres. */
  room: 5,
  wallThickness: 0.28,
  /** Top of the walls. */
  eaves: 2.4,
  /** Top of the roof. */
  ridge: 4.4,
  /** Roof pyramid: base radius and height, set on top of the walls. */
  roofRadius: 4.3,
  roofHeight: 2.0,
  /** The opening in the front wall. */
  doorWidth: 1.1,
  doorHeight: 2.0,
} as const;

/** The eaves-to-eaves footprint — a square pyramid's corners at 45°. */
export const SHELTER_FOOTPRINT = (SHELTER.roofRadius / Math.SQRT2) * 2;

/**
 * The walls, as boxes. Four of them, with the front one split into two piers
 * and a lintel so the doorway is a HOLE rather than a plank nailed to the wall
 * — which is what round four drew, and why a being inside a hut was a being
 * nobody could see.
 */
export const SHELTER_PARTS: readonly BoxPart[] = (() => {
  const half = SHELTER.room / 2;
  const t = SHELTER.wallThickness;
  const wall = half - t / 2;
  const pier = (SHELTER.room - SHELTER.doorWidth) / 2;
  const pierX = SHELTER.doorWidth / 2 + pier / 2;
  return [
    { w: SHELTER.room, h: SHELTER.eaves, d: t, x: 0, y: SHELTER.eaves / 2, z: -wall },
    { w: t, h: SHELTER.eaves, d: SHELTER.room, x: -wall, y: SHELTER.eaves / 2, z: 0 },
    { w: t, h: SHELTER.eaves, d: SHELTER.room, x: wall, y: SHELTER.eaves / 2, z: 0 },
    { w: pier, h: SHELTER.eaves, d: t, x: -pierX, y: SHELTER.eaves / 2, z: wall },
    { w: pier, h: SHELTER.eaves, d: t, x: pierX, y: SHELTER.eaves / 2, z: wall },
    {
      w: SHELTER.doorWidth,
      h: SHELTER.eaves - SHELTER.doorHeight,
      d: t,
      x: 0,
      y: (SHELTER.eaves + SHELTER.doorHeight) / 2,
      z: wall,
    },
  ];
})();

/** Whether a point in metres is inside any of these boxes. */
export function insideParts(parts: readonly BoxPart[], x: number, y: number, z: number): boolean {
  for (const p of parts) {
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2 && Math.abs(z - p.z) <= p.d / 2) return true;
  }
  return false;
}

export interface ShelterMeasure {
  ridge: number;
  eaves: number;
  footprint: number;
  doorWidth: number;
  doorHeight: number;
}

/**
 * The hut, measured off the parts the renderer builds from — never quoted.
 *
 * `World3D.scaleReport()` measures the same thing off the three.js bounding box
 * of the mesh it actually put in the scene; the two agreeing is what the test
 * asserts, and is why the number in the report cannot drift from the number on
 * the ruler again.
 */
export function shelterMeasure(): ShelterMeasure {
  let eaves = 0;
  for (const p of SHELTER_PARTS) eaves = Math.max(eaves, p.y + p.h / 2);
  return {
    ridge: eaves + SHELTER.roofHeight,
    eaves,
    footprint: SHELTER_FOOTPRINT,
    doorWidth: SHELTER.doorWidth,
    doorHeight: SHELTER.doorHeight,
  };
}

/**
 * Is the doorway actually open? Sampled, rather than reasoned about: a grid of
 * points through the opening from the floor to the lintel, none of which may
 * land inside a wall. A doorway that is a contract and not a hole is exactly
 * the defect this replaces.
 */
export function doorwayClear(headroom = 0.05): boolean {
  const z = SHELTER.room / 2 - SHELTER.wallThickness / 2;
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = 0; iy <= 12; iy++) {
      const x = (ix / 3) * (SHELTER.doorWidth / 2 - 0.02);
      const y = headroom + (iy / 12) * (SHELTER.doorHeight - 2 * headroom);
      for (let iz = -1; iz <= 1; iz++) {
        if (insideParts(SHELTER_PARTS, x, y, z + (iz * SHELTER.wallThickness) / 2)) return false;
      }
    }
  }
  return true;
}

// ── The legibility specimen ──────────────────────────────────────────────────

/**
 * One synthetic being in the specimen grid: everything the view encodes, laid
 * out so the encodings can be tested against a picture that contains them all.
 */
export interface SpecimenCell {
  stage: number;
  cond: number;
  act: number;
  /** Which of the eight compass octants it faces, 0 = +Z. */
  octant: number;
  /** Grid coordinates — fractional inside a knot, where beings stand close. */
  col: number;
  row: number;
  /** 0 for the vocabulary grid; 1… for the beings standing in knot n. */
  knot: number;
}

export const SPECIMEN_COLS = 12;
/** Rows of the vocabulary grid — one being per cell, nobody touching anybody. */
export const SPECIMEN_GRID_ROWS = 8;
/** Rows of knots below it — see `SPECIMEN_KNOTS`. */
export const SPECIMEN_KNOT_ROWS = 2;
export const SPECIMEN_ROWS = SPECIMEN_GRID_ROWS + SPECIMEN_KNOT_ROWS;
/**
 * Metres between neighbours.
 *
 * Set by the closest band that has to read it: at NEAR a being stands 170 px
 * tall and its ground ring is a metre and a half across, so at three metres
 * apart the rings overlap and the row behind stands between the shoulders of
 * the row in front. Four and a bit metres leaves every figure, every ring and
 * every chip clear of its neighbours at NEAR, and still puts the whole grid
 * inside a MID frame.
 */
export const SPECIMEN_SPACING = 4.3;
const SPECIMEN_N = SPECIMEN_COLS * SPECIMEN_GRID_ROWS;

/**
 * The combinations a real run may simply not contain, and a reviewer therefore
 * cannot test.
 *
 * Round six's L4 could not score "find the elder who is speaking", "find the
 * starving child" or "find whoever is fleeing" at all: a day-nine world of
 * three hundred held none of them, and an untestable task is an unscored one.
 * These three — plus a sick elder asleep, the pair a reader most often
 * confuses — are placed explicitly, inside the knots, so each is findable by
 * filter, by roster, by hovering and inside a chip, exactly like a real being.
 */
export const SPECIMEN_REQUIRED: readonly { stage: number; cond: number; act: number }[] = [
  { stage: STAGE_ELDER, cond: 0, act: ACT_SOCIAL },
  { stage: STAGE_CHILD, cond: COND_STARVING, act: ACT_IDLE },
  { stage: STAGE_ADULT, cond: COND_HURT, act: ACT_DANGER },
  { stage: STAGE_ELDER, cond: COND_SICK, act: ACT_RESTING },
];

/**
 * Knots: two to twelve beings standing together, the size of crowd a chip is
 * actually about.
 *
 * The vocabulary grid is one being per four metres of flat ground, which is the
 * right picture for reading a mark and the wrong one for everything a count
 * chip claims: a reviewer could only ever reach one chip, holding 302 beings,
 * and "a crowd of 2–12, read its mix" went untested for want of a crowd. The
 * knots sit below the grid, are laid out from their own sizes, and go through
 * the same clustering, the same chips and the same probes as a settlement.
 */
export const SPECIMEN_KNOTS: readonly { size: number; col: number; row: number }[] = [
  { size: 12, col: 2.6, row: 8.25 },
  { size: 3, col: 8.6, row: 8.25 },
  { size: 8, col: 1.6, row: 9.45 },
  { size: 5, col: 5.6, row: 9.45 },
  { size: 2, col: 9.6, row: 9.45 },
];

/** Knot acts, dealt in order — every act a pictogram exists for, and two without. */
const KNOT_ACTS = [ACT_IDLE, ACT_WORKING, ACT_SOCIAL, ACT_WALKING, ACT_EATING, ACT_RESTING, ACT_DANGER];
const KNOT_CONDS = [0, COND_STARVING, COND_SICK, COND_HURT];

/**
 * The grid: ninety-six beings covering every life stage, every condition, every
 * one of the eight acts and all eight headings — and every PAIR of stage and
 * act, and every pair of condition and act, so no channel can be read off
 * another one.
 *
 * Dev-only and display-only. It never touches the sim, never sends anything,
 * and wears no name: the whole point is that the only way to find out what one
 * of these is, is to look at it and then ask the probe.
 *
 * The conditions are dealt out across the grid on a stride coprime with its
 * size rather than in blocks, so any handful of rows a NEAR camera can see
 * still holds all four of them. Round four's world produced three unwell beings
 * in two hundred and fifty-one and every one of them was off-frame or inside a
 * hut, which is how a condition channel gets scored 100% and 7% in the same
 * review without either number meaning anything.
 */
export function specimenPlan(): SpecimenCell[] {
  const out: SpecimenCell[] = [];
  let i = 0;
  for (const cond of KNOT_CONDS) {
    for (let j = 0; j < 24; j++) {
      const slot = (i * 7) % SPECIMEN_N;
      out.push({
        stage: j % 3,
        cond,
        act: j % 8,
        octant: (j * 3) % 8,
        col: slot % SPECIMEN_COLS,
        row: Math.floor(slot / SPECIMEN_COLS),
        knot: 0,
      });
      i++;
    }
  }
  out.push(...knotPlan());
  return out;
}

/**
 * The beings standing in knots, laid out on rings from the knot's own size.
 *
 * Two rings past six, so a dozen people are a crowd rather than a fence: the
 * inner ones are partly behind the outer ones, which is what a crowd IS and
 * what the count chip exists to resolve. Every knot of four or more carries all
 * four conditions, so a chip's stacked bar has something to say and a NEAR
 * camera on any two rows still sees every condition.
 */
function knotPlan(): SpecimenCell[] {
  const out: SpecimenCell[] = [];
  let required = 0;
  for (let k = 0; k < SPECIMEN_KNOTS.length; k++) {
    const knot = SPECIMEN_KNOTS[k]!;
    // In grid cells: a knot of two stands a pace apart, a knot of twelve fills
    // about half a cell, which is the couple of metres a gathering occupies.
    const radius = 0.13 + knot.size * 0.031;
    for (let n = 0; n < knot.size; n++) {
      const ring = knot.size > 6 && n % 2 === 1 ? 0.55 : 1;
      const angle = (n / knot.size) * Math.PI * 2 + k * 0.7;
      const rare = required < SPECIMEN_REQUIRED.length && n === 0 && knot.size >= 2
        ? SPECIMEN_REQUIRED[required++]!
        : null;
      out.push({
        stage: rare ? rare.stage : (n + k) % 3,
        cond: rare ? rare.cond : KNOT_CONDS[n % KNOT_CONDS.length]!,
        act: rare ? rare.act : KNOT_ACTS[(n + k) % KNOT_ACTS.length]!,
        octant: (n * 3 + k) % 8,
        col: knot.col + Math.cos(angle) * radius * ring,
        row: knot.row + Math.sin(angle) * radius * ring * 0.8,
        knot: k + 1,
      });
    }
  }
  return out;
}

/**
 * Ids for the specimen. Negative and far from anything the engine hands out, so
 * a specimen being can never be mistaken for — or collide with — a real one.
 */
export const SPECIMEN_ID_BASE = -900000;

export function isSpecimenId(id: number): boolean {
  return id <= SPECIMEN_ID_BASE && id > SPECIMEN_ID_BASE - SPECIMEN_N * 4;
}
