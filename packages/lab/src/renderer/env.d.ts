/// <reference types="vite/client" />
import type { LabApi } from '../preload/index.js';
import type { BandPromise, FrameCandidate, ZoomBand } from './beings.js';

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
  screenPositionOf(id: number): { x: number; y: number } | null;
  /** What this being is doing, how it is, and the marks that say so. */
  stateOf(id: number): { act: number; cond: number; picto: number; hue: number; ring: number; core: boolean } | null;
  /** 0 child, 1 adult, 2 elder — the form it was drawn with. */
  stageOf(id: number): number | null;
  /** The one word for how it is: `well`, `starving`, `sick`, `in danger`. */
  conditionOf(id: number): string | null;
  /** The one word for what it is doing: `walking`, `asleep`, `eating`, … */
  activityOf(id: number): string | null;
  /** Which way it faces in the world, in radians, exactly as drawn. */
  headingOf(id: number): number | null;
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
  /** The crowd counts drawn over the world, and where each one sits. */
  clustersShown(): { count: number; x: number; y: number }[];
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
    hut: number; hutFootprint: number; tree: number; treeShortest: number;
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
}

declare global {
  interface Window {
    lab?: LabApi;
    __ygg?: WorldProbe;
  }
}

export {};
