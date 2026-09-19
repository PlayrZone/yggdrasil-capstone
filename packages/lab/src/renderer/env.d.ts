/// <reference types="vite/client" />
import type { LabApi } from '../preload/index.js';
import type { BandPromise, FrameCandidate, ZoomBand } from './beings.js';
import type { MatchCount, FilterState } from './filters.js';
import type { RosterRow } from './roster.js';
import type { MixSegment } from './crowd.js';
import type { HealthReport } from './health.js';

/**
 * A read-only handle on the 3D view, for automated drivers and for scoring a
 * screenshot against what the view believes it drew. Nothing here changes
 * anything: a reviewer can count beings in a picture and then ask the view what
 * was actually there, and the two either agree or the view is lying.
 *
 * The `…ShownOf` reads are the ones a stranger test must be scored against.
 * The view draws different things at different zooms and says so; asking it
 * what a being IS gets the sim's answer, and asking what the picture SAYS gets
 * `null` wherever the current band promises nothing. Scoring a reader against
 * a distinction the frame never drew is marking them wrong for the view's
 * honesty.
 *
 * ## One coordinate frame
 *
 * **Every screen coordinate in this namespace is a CLIENT coordinate** — the
 * frame a `PointerEvent` carries, `document.elementFromPoint` takes and
 * `getBoundingClientRect` returns. That holds for `screenPositionOf`,
 * `markScreenPositionOf`, `bodyScreenPositionOf`, `pickAtScreen`,
 * `markGeometry`, `chipsOnScreen`, `clustersShown`, `countAudit().chips` and
 * `hoverCardFor().mark`. A driver may take any point from any of them and send
 * the mouse straight to it.
 *
 * Round eight had two frames in one namespace: the being probes in client
 * coordinates and the chip probes in canvas-local ones. A reviewer drove the
 * real mouse to a chip's own reported point, landed 113 px away — exactly the
 * canvas origin — and opened nothing at all.
 */
export interface WorldProbe {
  /**
   * Whether this renderer is WELL, and the first read a session should make.
   *
   * All three counts must be zero. A shipped shader failed to compile on every
   * boot for four rounds and no round caught it, because three writes a compile
   * failure to `console.error`, which `pageerror` does not raise, and the frame
   * then draws without that program — every hut a black box at midnight, and
   * nothing anywhere saying so. Any non-zero count means every other number
   * here is a measurement of a broken instrument.
   */
  health(): HealthReport;
  drawnIds(): number[];
  /**
   * The beings a reader could actually FIND in this frame — and "find" is
   * DEFINED by the picker, not argued for beside it: `id` is here if and only
   * if `pickAtScreen(screenPositionOf(id))` hands back `id`.
   *
   * The cheap conditions still come first (in the frustum, big enough to call,
   * not folded into a crowd's number, not lost behind the land), because a
   * being drawn at three pixels is not a target however pointable it is. But
   * the last word is the picker's, so "offered" and "the mouse picks it" are
   * one statement rather than two implementations that agreed most of the time.
   * Round eight ran a second geometry here and handed a reviewer four beings in
   * a hundred and forty-eight that the real mouse picked somebody else at.
   */
  visibleIds(): number[];
  /**
   * Whether this being is readable, and which of the ways it is not.
   *
   * `coveredBy` is the picker's answer and nothing else: whoever
   * `pickAtScreen` puts first at this being's own reported point, when that is
   * not this being. `reason` names the case — `"behind another being"` when
   * somebody else is drawn there, and `"nothing is drawn where the view reports
   * it"` in the case that should never happen and is now reported rather than
   * silently offered.
   */
  visibilityOf(id: number): {
    visible: boolean; markPx: number; bodyPx: number; inFrame: boolean; collapsed: boolean;
    behindLand: boolean; coveredBy: number | null;
    /**
     * The cluster whose chip is this being's LABEL — the occupants of a hut
     * have their rings, badges, arrows and names taken off so the building is
     * not a scribble, and the number on its roof speaks for all of them. Still
     * pointable, still `visible`; simply not owed a name of its own, which is
     * the one exception to NEAR's "nearest first" and is printed on the strip.
     */
    carriedBy: number | null;
    reason: string;
  } | null;
  /**
   * Where the thing DRAWN for this being is, in client coordinates — the point
   * to put a cursor on, and the point the view itself bins by.
   *
   * One point, and it is the mark's: the centre of the ground ring or the pin,
   * which is what a reader sees in every band that draws one. Where a
   * building's occupants chip has taken a being's mark away, this is the middle
   * of its body instead, because that is then the only thing of it in the
   * picture. `countAudit()`'s quadrants, `markGeometry()` and the cover rule
   * behind `visibleIds()` all use this same point — round seven had the probe
   * 11.3 px from the audit's own binning, enough to file 8.6% of a frame in a
   * different quarter than the picture did.
   */
  screenPositionOf(id: number): { x: number; y: number } | null;
  /** Just the ground mark's centre, drawn or not. */
  markScreenPositionOf(id: number): { x: number; y: number } | null;
  /** Just the figure's middle — what the hover card places itself clear of. */
  bodyScreenPositionOf(id: number): { x: number; y: number } | null;
  /** Where it stands, in scene units — the frame `placeCamera` takes. */
  worldPositionOf(id: number): { x: number; y: number; z: number } | null;
  /** What this being is doing, how it is, the marks that say so — and whether they can be read. */
  stateOf(id: number): {
    act: number; cond: number; picto: number; hue: number; ring: number; core: boolean; visible: boolean;
  } | null;
  /** 0 child, 1 adult, 2 elder — the form it was drawn with. */
  stageOf(id: number): { stage: number; word: string; visible: boolean } | null;
  /** How it is: `well`, `starving`, `sick`, `in danger`. */
  conditionOf(id: number): { word: string; visible: boolean } | null;
  /** What it is doing: `walking`, `asleep`, `eating`, … */
  activityOf(id: number): { word: string; visible: boolean } | null;
  /** Which way it faces in the world, in radians, exactly as drawn. */
  headingOf(id: number): { rad: number; visible: boolean } | null;
  /** Which way its pointer aims ON SCREEN — degrees clockwise from up, and N/NE/E/… */
  headingOnScreen(id: number): { deg: number; word: string } | null;
  /**
   * Score a reading of the heading arrow: `exact` is the eight-point call,
   * `within1` allows a neighbouring octant, and `off` is how many apart they
   * are. Heading is the one channel where nearly-right is a different kind of
   * answer from wrong, and a score that cannot tell them apart cannot say
   * whether the mark needs to be louder or merely sharper.
   */
  headingCheck(id: number, said: string): { truth: string; deg: number; off: number; exact: boolean; within1: boolean } | null;
  /** What this being is called in the world view. */
  nameOf(id: number): string;
  /** The names floating over the world right now — only ones actually drawn. */
  labelsShown(): string[];
  /**
   * The naming, measured rather than asserted.
   *
   * At NEAR the rule is one sentence: the names go to the k NEAREST nameable
   * beings, in order, and the first one that cannot be labelled ends the list —
   * a nearer being keeps its priority and the one behind it loses its name. So
   * `claim` is the strip's own text letter for letter, `withinM` is how far the
   * furthest name reached (the number printed in it), `expected` and `shown`
   * are the placed and the drawn names and are equal, `within` is how many
   * nameable beings that reach covers and is also equal, and `violations` — a
   * nameable being left unnamed while somebody further away was named — is 0.
   *
   * "Nameable" is readable AND not `carriedBy` a building's chip. The occupants
   * of a hut are labelled by the number on its roof and by nothing else, which
   * is what stops a shelter filling with a scribble; `carried` is how many of
   * them there are, and the strip prints it ("… · 71 more counted on their
   * huts") so the exception is on the screen rather than in a doc.
   *
   * Outside NEAR the band promises names "found and selected first, then
   * nearest" and says so, which owes nobody a name: `violations` is 0 there by
   * definition and `outOfOrder` — the same measurement without the promise
   * applied — says what the weaker promise actually costs.
   */
  labelAudit(): {
    claim: string; withinM: number; expected: number; shown: number; within: number;
    violations: number; outOfOrder: number; carried: number;
  };
  /**
   * The scale bar, as drawn: a round span in METRES, the pixels it covers, the
   * words printed over it, and the metres-per-pixel it was measured from at the
   * ground under the view centre. `px ≈ metres / metresPerPx`, in every band —
   * round six printed "200 UNITS" under 1.9 m of ground.
   */
  scaleBar(): { metres: number; px: number; label: string; metresPerPx: number };
  /** The crowd counts drawn over the world, and where each one sits. */
  clustersShown(): { count: number; x: number; y: number }[];
  /**
   * Where the buildings stand and which way each one faces, in scene units —
   * enough to put a ruler on a hut, stand in its doorway, or check that a
   * camera you were offered is not inside one.
   */
  structuresShown(): { kind: string; x: number; y: number; z: number; yaw: number }[];
  /**
   * How this frame asks to be counted. Every being in the frustum is either a
   * pin drawn for itself or part of exactly one chip's number, so
   * `pinsDrawn + Σ chips.n === beingsInFrustum` — the countability claim, made
   * checkable against the picture rather than argued about.
   *
   * `quadrants` is the same arithmetic one quarter of the frame at a time,
   * which is how every reviewer has actually been asked to check a count:
   * `pins + counted === beings` in each, where `counted` sums the chips whose
   * DISC sits in that quadrant — where a reader reads a number. It holds
   * wherever `counts` is true; MID and NEAR promise no count and draw pins
   * inside their outlines, so there is nothing there to reconcile.
   */
  countAudit(): {
    pinsDrawn: number; chips: { n: number; x: number; y: number }[]; beingsInFrustum: number;
    counts: boolean;
    quadrants: { region: number; pins: number; chips: number; counted: number; beings: number; reconciles: boolean }[];
  };
  /**
   * Places on the continent worth pointing a camera at, biggest gathering
   * first, each with the camera and target that frame it at the size the band
   * is about. Read-only — `placeCamera` is what actually moves.
   */
  frameCandidates(band?: ZoomBand): FrameCandidate[];
  /**
   * The one call here that changes anything, and all it changes is where you
   * are standing — which the mouse can do too. Nothing about the world, the
   * data, or what the view claims passes through it.
   */
  placeCamera(camera: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void;
  /** Screen size, in CSS pixels, of the SMALLEST drawn marker. */
  beingPixels(): number;
  /** 1 in full daylight, 0 in the dark. */
  daylight(): number;
  /** Which contract the picture is keeping: `far`, `default`, `mid` or `near`. */
  zoomBand(): ZoomBand;
  /**
   * Where the camera stands and how far it is ALLOWED to stand — the numbers
   * behind "can a mouse reach this band".
   *
   * `stopFigurePx` is how tall a grown being stands at the orbit's far stop and
   * `enterFarPx` is what entering FAR from DEFAULT costs; `farReachable` is the
   * comparison, made by the band table rather than by eye. A reviewer wheeled
   * 120 notches into a stop that was one hysteresis step short and stayed in
   * DEFAULT at the edge itself, so the stop is now re-derived every frame from
   * the live projection and printed here.
   */
  cameraReport(): {
    distance: number; minDistance: number; maxDistance: number;
    worldPerPx: number; figurePx: number; stopFigurePx: number; enterFarPx: number;
    band: ZoomBand;
    /** The canvas on screen, and the canvas the projection was derived from. */
    canvasW: number; canvasH: number; projectionH: number;
    atStop: boolean; farReachable: boolean;
  };
  /** How tall a grown being stands on screen right now, in CSS pixels. */
  bandPixels(): number;
  /** How wide the map's ring is drawn on screen right now, in CSS pixels. */
  annotationPixels(): number;
  /**
   * The world, measured, in world units — so proportions can be checked with
   * arithmetic rather than argued about. One unit is one metre.
   */
  scaleReport(): {
    unit: string;
    adult: number; child: number; elder: number;
    /** Measured off the bounding box of the mesh in the scene, in metres. */
    hut: number; hutFootprint: number; hutDoorway: number;
    /** `mesh` once a hut exists to measure; `contract` before the first is built. */
    hutFrom: 'mesh' | 'contract';
    tree: number; treeShortest: number;
    peak: number; seaLevel: number; worldSpan: number;
    annotationRing: number; adultOnScreenPx: number;
  };
  /** What the band claims, and the accuracy it holds itself to. */
  promises(): BandPromise;
  /** What the PICTURE says it is doing — the band's vocabulary, or null. */
  activityShownOf(id: number): string | null;
  /** The life stage the picture claims, or null where the band draws none. */
  stageShownOf(id: number): string | null;
  /** The condition the picture claims, or null at FAR. */
  conditionShownOf(id: number): string | null;
  /** Whether the picture says it is on the move — the streak channel. */
  movingShownOf(id: number): boolean | null;
  /**
   * Lay out (or clear) the LEGIBILITY SPECIMEN: a grid of synthetic beings on
   * flat ground in front of the camera covering every life stage, every
   * condition, every activity and all eight headings, drawn by the same code
   * path as the world's own beings and readable only through these probes —
   * they carry no names.
   *
   * Dev-only and display-only. Nothing here reaches the sim, and the grid
   * disappears with `specimen(false)` or a new world. It exists because a run
   * with three unwell beings in two hundred and fifty-one cannot test the
   * condition channel however carefully it is scored.
   */
  specimen(on: boolean): { ids: number[]; count: number; centre: { x: number; y: number; z: number } } | null;
  /** The ids of the specimen beings, in layout order. */
  specimenIds(): number[];

  // ── Comprehension by interaction (item L4) ─────────────────────────────────
  //
  // Per-being glyph reading is not a thing this view asks of anyone any more —
  // it topped out at 38% for activity in a crowd, with nearly every miss a mark
  // attributed to the wrong body. These probes are the ground truth behind the
  // things that replaced it, so a driver can run a real task and score it.

  /** Everything the hover card shows about one being, whether or not it is open. */
  hoverCardFor(id: number): {
    id: number; name: string; selfChosen: boolean;
    stage: string; condition: string; activity: string;
    heading: string; headingDeg: number;
    /** The engine's own plan step — what this being is TRYING to do. */
    goal: string | null; planAt: number; planOf: number;
    hunger: number; rest: number;
    distance: number; inFrame: boolean; visible: boolean; crowded: boolean;
    /** True while this being's pictogram and arrow are withheld as unattributable. */
    marksHeld: boolean; specimen: boolean;
    /** Where the subject is on screen — what the card places itself clear of. */
    mark: { x: number; y: number; r: number } | null;
  } | null;
  /** Every being the view holds, exactly as the roster lists it. */
  rosterRows(): RosterRow[];
  /** The question the chips are currently asking. */
  activeFilters(): FilterState;
  /** How many beings answer it, of how many, and how many of those are in frame. */
  matchCount(): MatchCount;
  /** Who the view is emphasising right now — empty while nothing is filtered. */
  highlightedIds(): number[];
  /**
   * What one chip is made of: how many, in what state, doing what — and
   * whether it is a crowd on open ground or the people INSIDE a building,
   * whose individual rings that building is carrying for them.
   */
  chipSummary(cluster: number): {
    cluster: number; count: number; matched: number; inside: boolean;
    mix: MixSegment[]; activities: { word: string; count: number }[]; ids: number[];
    /** Who they are. A shelter's occupants have no name drawn, so this is where theirs are. */
    names: { id: number; name: string }[];
  } | null;
  /**
   * Where the crowd chips are, how big each is drawn, and whether it found a
   * spot covering nothing — a chip may never sit on a pin, and `clear: false`
   * is the view admitting it had to shrink and fade one instead.
   *
   * CLIENT coordinates: `x`, `y` is where the mouse has to go to open this
   * chip's card. `inside` marks the chips that are a BUILDING speaking for the
   * people in it rather than a crowd on open ground.
   */
  chipsOnScreen(): { cluster: number; x: number; y: number; count: number; halfW: number; halfH: number; clear: boolean; inside: boolean }[];
  /** Every being under the cursor, in the order the disambiguation list offers them. */
  hoverCandidates(): number[];
  /**
   * What the MOUSE would pick at this screen point — the pointer handler's own
   * code path, not a second implementation of it. Client coordinates, the ones
   * `screenPositionOf` returns. `layer` is 0 for a body the ray struck, 1 for
   * the drawn figure's footprint, 2 for the ground mark, plus 3 for anything
   * only visible through the land.
   */
  pickAtScreen(x: number, y: number): { id: number; layer: number; onBody: boolean; distPx: number; depth: number }[];
  /** The one being the card is describing and the view is highlighting. */
  hoveredId(): number | null;
  /**
   * Where every drawn mark is and how far it reaches, with whether it was
   * allowed to keep its pictogram and arrow — so the suppression rule can be
   * checked against the picture instead of taken on trust. CLIENT coordinates:
   * `x`, `y` is the same point `screenPositionOf` returns.
   */
  markGeometry(): { id: number; x: number; y: number; r: number; clear: boolean }[];
  /**
   * Frames this view has DRAWN. Sample it over a window for the real frame
   * rate: counting rAF callbacks measures the display, not the limiter.
   */
  renderCount(): number;
  /**
   * How many beings kept a pictogram and a heading arrow, and how many had
   * both withheld because a neighbour's mark was close enough that a reader
   * could not tell whose was whose.
   */
  markAudit(): { drawn: number; held: number; clear: number };

  /**
   * The one namespaced set of ACTIONS, so a driver can run a task the way a
   * person would. Everything above is read-only; everything here changes only
   * what a mouse could change.
   */
  ui: {
    setFilter(next: Partial<FilterState>): void;
    clearFilters(): void;
    hover(id: number | null): void;
    /**
     * Choose a being, through the code path a CLICK runs and no other. It does
     * not move the camera — that is the selbar's own button, and it is
     * `centreOn` here. Round seven's driver select did both at once and lost
     * the roster row that a real click keeps.
     */
    select(id: number | null): void;
    /** The selbar's "Centre on it" button. */
    centreOn(id: number): void;
    roster(open: boolean): void;
    zoomToCluster(cluster: number): void;
  };
}

/**
 * THE BRIDGE, for a reviewer re-testing its refusals from the page.
 *
 * `window.lab.llmComplete(prompt, input, worldId)` is guarded in main, in this
 * order: rate limit, PROMPT shape, INPUT shape, then the world. So a garbage or
 * legacy prompt is refused before the world is ever looked at, and an unknown
 * `worldId` can only be reached with a well-formed pair — which is why the
 * refusal could not be re-tested from the page without one. No engine import is
 * needed to build it; both shapes are structural, and this is the whole call:
 *
 * ```js
 * await window.lab.llmComplete(
 *   { system: 's', user: 'u' },
 *   {
 *     // Where a being is: two finite numbers on this build. (The engine is
 *     // moving to an opaque `place`; if the refusal says `snapshot.place`,
 *     // that has landed and it takes whatever the world calls a place.)
 *     snapshot: { id: 1, name: 'x', traits: {}, needs: {}, inventory: {}, health: 1, x: 120, y: 88 },
 *     worldView: { tick: 0, season: 'spring', agents: [], resources: [], structures: [] },
 *     recalledMemories: [], knowledge: [], goals: [], trigger: 'periodic',
 *   },
 *   'nope',
 * );
 * // rejects: BAD_THINK_PROMPT: unknown world — never defaulted to a world
 * ```
 *
 * With a real `worldId` the same call is refused for the other reason — the
 * prompt is not the one that world's own builder renders from that input —
 * which is the binding this bridge exists for. Neither path sends anything, and
 * every refusal names the field it tripped on, so the shape above can be walked
 * in from any starting point.
 */

declare global {
  interface Window {
    lab?: LabApi;
    __ygg?: WorldProbe;
  }
}

export {};
