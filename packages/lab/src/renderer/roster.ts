/**
 * The roster: every being as a row, and the rules that keep a table of three
 * hundred rows honest, sorted and cheap.
 *
 * Pure. The view produces `RosterRow[]` from what it drew; this module decides
 * the order, which slice of it is on screen, and who the pointer is currently
 * talking about. Nothing here touches the DOM, three, or React — which is what
 * makes the brushing rules testable rather than a pile of `onMouseEnter`
 * handlers that fight each other.
 */

import type { Filterable } from './filters.js';

/**
 * One being, as the table shows it.
 *
 * Everything here is a value the view already has per frame, so building the
 * whole array costs one pass over the instance arrays and no queries. The two
 * needs are PRESSURE in [0, 100] exactly as the engine means them — 0 is
 * satisfied, 100 is desperate — because a bar that silently inverts its axis
 * between the inspector and the roster is the kind of detail that ends up in a
 * paper.
 */
export interface RosterRow extends Filterable {
  id: number;
  /** What the world view calls it — a chosen name or the lab's designation. */
  name: string;
  /** False when the name is a lab designation (drawn with a dotted underline). */
  selfChosen: boolean;
  stage: number;
  stageWord: string;
  cond: number;
  condWord: string;
  act: number;
  actWord: string;
  /** Which way it faces ON SCREEN: degrees clockwise from up, and the octant. */
  headingDeg: number;
  headingWord: string;
  /** Need pressure in [0, 100]; 0 satisfied. */
  hunger: number;
  rest: number;
  /** Metres from the camera's own target — "how far from where I am looking". */
  distance: number;
  /** Projected inside the canvas on the last frame. */
  inFrame: boolean;
  /** Readable in the frame: in view, big enough, not folded into a crowd chip. */
  visible: boolean;
}

export type SortKey = 'name' | 'stage' | 'condition' | 'activity' | 'heading' | 'hunger' | 'rest' | 'distance';

export interface Sort {
  key: SortKey;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}

/** Severity order, so sorting by condition puts the beings in trouble on top. */
const CONDITION_RANK: Record<string, number> = { 'in danger': 0, starving: 1, sick: 2, well: 3 };

function keyValue(row: RosterRow, key: SortKey): number | string {
  switch (key) {
    case 'name': return row.name.toLowerCase();
    case 'stage': return row.stage;
    case 'condition': return CONDITION_RANK[row.condWord] ?? 9;
    case 'activity': return row.actWord;
    case 'heading': return row.headingDeg;
    case 'hunger': return -row.hunger;
    case 'rest': return -row.rest;
    default: return row.distance;
  }
}

/**
 * Sort, deterministically.
 *
 * `id` breaks every tie. Without it a table of two hundred beings who are all
 * `adult · well · walking` reshuffles itself on every 4 Hz refresh, which reads
 * as a broken widget and makes a row impossible to point at.
 */
export function sortRows(rows: readonly RosterRow[], sort: Sort): RosterRow[] {
  const out = rows.slice();
  out.sort((a, b) => {
    const ka = keyValue(a, sort.key);
    const kb = keyValue(b, sort.key);
    if (ka < kb) return -sort.dir;
    if (ka > kb) return sort.dir;
    return a.id - b.id;
  });
  return out;
}

/** Sorting a column the table is already sorted by flips it; a new column starts ascending. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: 1 };
  return { key, dir: current.dir === 1 ? -1 : 1 };
}

// ── Virtualization ───────────────────────────────────────────────────────────

export interface RowWindow {
  /** First row to mount, inclusive. */
  start: number;
  /** Last row to mount, exclusive. */
  end: number;
  /** Spacer height above the mounted rows, in pixels. */
  padTop: number;
  /** Spacer height below them. */
  padBottom: number;
}

/**
 * Which rows are worth mounting.
 *
 * Three hundred and twenty `<tr>`s each carrying two bars is about eleven
 * hundred DOM nodes updating four times a second, which is exactly the long
 * task this item is not allowed to introduce. Only the visible slice plus an
 * overscan is mounted; the rest is two spacers, so the scrollbar still measures
 * the whole population.
 */
export function windowFor(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  total: number,
  overscan = 6,
): RowWindow {
  if (total <= 0 || rowH <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const visible = Math.ceil(Math.max(0, viewportH) / rowH) + overscan * 2 + 1;
  const start = Math.min(first, Math.max(0, total - 1));
  const end = Math.min(total, start + visible);
  return { start, end, padTop: start * rowH, padBottom: Math.max(0, (total - end) * rowH) };
}

/** The scroll offset that brings a row fully into view, or `null` if it already is. */
export function scrollToRow(
  index: number,
  scrollTop: number,
  viewportH: number,
  rowH: number,
): number | null {
  if (index < 0 || rowH <= 0) return null;
  const top = index * rowH;
  const bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportH) return bottom - viewportH;
  return null;
}

/** Keyboard movement within the table, clamped — never wraps, never goes out of range. */
export function moveFocus(index: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : total - 1;
  return Math.min(total - 1, Math.max(0, index + delta));
}

// ── Brushing ─────────────────────────────────────────────────────────────────

/**
 * Who is currently pointing, so hover can be two-way without the two directions
 * fighting.
 *
 * `world` is the pointer over the canvas; `roster` is the pointer over a row. A
 * roster hover must win while it lasts (you are reading the table, and the
 * mouse is not over the canvas at all), and the 3D view's own periodic re-pick
 * must not stamp on it. Equally, leaving the table must not clear a highlight
 * the canvas owns. Both are one-line rules here and were three subtle bugs when
 * they lived in event handlers.
 */
export type BrushSource = 'none' | 'world' | 'roster';

export interface Brush {
  id: number | null;
  source: BrushSource;
}

export type BrushEvent =
  | { kind: 'world-hover'; id: number | null }
  | { kind: 'roster-hover'; id: number }
  | { kind: 'roster-leave' }
  | { kind: 'world-leave' };

export const NO_BRUSH: Brush = { id: null, source: 'none' };

export function brushReduce(state: Brush, event: BrushEvent): Brush {
  switch (event.kind) {
    case 'roster-hover':
      return state.id === event.id && state.source === 'roster' ? state : { id: event.id, source: 'roster' };
    case 'roster-leave':
      // Only the owner may clear. Leaving the table while the canvas is still
      // under the pointer keeps the canvas's highlight.
      return state.source === 'roster' ? NO_BRUSH : state;
    case 'world-hover':
      // The canvas re-picks a dozen times a second whether or not anyone is
      // looking at it; it may not overwrite a row the reader is on.
      if (state.source === 'roster') return state;
      if (event.id === null) return state.source === 'world' ? NO_BRUSH : state;
      return state.id === event.id && state.source === 'world' ? state : { id: event.id, source: 'world' };
    default:
      return state.source === 'world' ? NO_BRUSH : state;
  }
}

/**
 * Should the table scroll itself to the brushed row?
 *
 * Only when the CANVAS owns the brush. Scrolling the table under the pointer
 * that is hovering it moves the row out from under the cursor, which hovers the
 * next row, which scrolls again — a table that runs away from the mouse.
 */
export function shouldScrollToBrush(state: Brush): boolean {
  return state.source === 'world' && state.id !== null;
}

export function indexOfRow(rows: readonly RosterRow[], id: number | null): number {
  if (id === null) return -1;
  for (let i = 0; i < rows.length; i++) if (rows[i]!.id === id) return i;
  return -1;
}
