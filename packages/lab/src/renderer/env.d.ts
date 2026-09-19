/// <reference types="vite/client" />
import type { LabApi } from '../preload/index.js';
import type { BandPromise, FrameCandidate, ZoomBand } from './beings.js';
import type { MatchCount, FilterState } from './filters.js';
import type { RosterRow } from './roster.js';
import type { MixSegment } from './crowd.js';

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
 */
export interface WorldProbe {
  drawnIds(): number[];
  /**
   * The beings a reader could actually FIND in this frame: in the frustum,
   * drawn big enough to call, not folded into a crowd's number, and not lost
   * behind the land. The only honest population for a stranger test to draw
   * targets from — round four drew them from `drawnIds()` and sixteen of
   * twenty-nine targets turned out to have three body pixels or fewer.
   */
  visibleIds(): number[];
  /** Whether this being is readable, and which of the four ways it is not. */
  visibilityOf(id: number): {
    visible: boolean; markPx: number; bodyPx: number; inFrame: boolean; collapsed: boolean; behindLand: boolean; reason: string;
  } | null;
  screenPositionOf(id: number): { x: number; y: number } | null;
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
   * The naming claim, measured rather than asserted: how far out every readable
   * being got a name this frame, how many that was, and how many are drawn.
   * NEAR's legend points at this number, so the claim can never outrun it.
   */
  labelAudit(): { claim: string; withinM: number; expected: number; shown: number };
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
   */
  countAudit(): { pinsDrawn: number; chips: { n: number; x: number; y: number }[]; beingsInFrustum: number };
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
  } | null;
  /** Every being the view holds, exactly as the roster lists it. */
  rosterRows(): RosterRow[];
  /** The question the chips are currently asking. */
  activeFilters(): FilterState;
  /** How many beings answer it, of how many, and how many of those are in frame. */
  matchCount(): MatchCount;
  /** Who the view is emphasising right now — empty while nothing is filtered. */
  highlightedIds(): number[];
  /** What one crowd chip is made of: how many, in what state, doing what. */
  chipSummary(cluster: number): {
    cluster: number; count: number; matched: number;
    mix: MixSegment[]; activities: { word: string; count: number }[]; ids: number[];
  } | null;
  /** Where the crowd chips are on the canvas, so one can be pointed at. */
  chipsOnScreen(): { cluster: number; x: number; y: number; count: number }[];
  /** Every being under the cursor, in the order the disambiguation list offers them. */
  hoverCandidates(): number[];
  /** The one being the card is describing and the view is highlighting. */
  hoveredId(): number | null;
  /**
   * Where every drawn mark is and how far it reaches, with whether it was
   * allowed to keep its pictogram and arrow — so the suppression rule can be
   * checked against the picture instead of taken on trust.
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
    select(id: number | null): void;
    roster(open: boolean): void;
    zoomToCluster(cluster: number): void;
  };
}

declare global {
  interface Window {
    lab?: LabApi;
    __ygg?: WorldProbe;
  }
}

export {};
