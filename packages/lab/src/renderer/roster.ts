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
  /**
   * This being has died while the table was held still for a reader.
   *
   * A sealed table may not lose a row: everything under the departure slides up
   * by twenty-four pixels and the row somebody is aiming at is no longer the row
   * they press. So the row stays exactly where it was, marked, with the last
   * values the world gave it, until the pointer leaves.
   */
  gone?: boolean;
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

// ── Holding still while somebody is reading ──────────────────────────────────

/**
 * Whether the table is allowed to re-sort itself right now.
 *
 * Selecting a being centres the camera on it, which drives its `distance` to
 * zero, which — with the table sorted by distance, as it is by default —
 * re-sorts three hundred rows and throws the row you just clicked to the far
 * end of the list. A reviewer clicked a row, watched the inspector fill with
 * the right being, and found `.rrow.sel` gone from the table entirely.
 *
 * A sort order is a reading aid, not a live read-out. So the order is FROZEN
 * the moment a row is picked, and thaws only on something the reader did
 * deliberately: clicking a header, scrolling, or changing the question. The
 * values inside the rows keep updating — only their order is held.
 */
export interface OrderState {
  /** The id order the table is pinned to, newest first, or null to sort freely. */
  frozen: number[] | null;
  /** The row the freeze exists to protect. */
  anchor: number | null;
  /**
   * SEALED: the frozen list is the whole table — no row appears in it, leaves
   * it, or moves within it.
   *
   * A freeze alone holds the ORDER and still lets rows drop out of the set,
   * which is what round eight's roster did: the camera glides onto the being
   * you just picked, beings walk out of the frame the "in frame" box scopes the
   * table to, `applyOrder` compacts them out, and everything below slides up a
   * row per departure. A reader pressing the mouse on row six let it go over
   * row five, and a `click` whose down and up land on different elements is
   * dispatched on their common ancestor — the table body, which selects
   * nothing. Three real clicks in four selected nobody at all.
   *
   * So while the pointer is inside the table, the table holds absolutely still.
   * The values in the rows keep updating; the rows themselves do not move.
   */
  sealed: boolean;
}

export const FREE_ORDER: OrderState = { frozen: null, anchor: null, sealed: false };

export type OrderEvent =
  /**
   * A row was chosen — by click, by Enter, or by the world. `order` is what is
   * on screen now.
   *
   * `sealing` is set when the pointer is inside the table, and it re-seals the
   * order SYNCHRONOUSLY, on the order the press saw. Round five re-sealed in an
   * effect: a pick re-centres the camera, which drives every distance, and in
   * the ~60 ms before the effect ran the table re-sorted under a reviewer's
   * cursor. He read `c-name|Wreniash` at the press point and the press selected
   * Fenush. A seal that engages a frame after the event it protects against is
   * not a seal.
   */
  | { kind: 'pick'; id: number; order: readonly number[]; sealing?: boolean }
  /** The pointer entered the table. `order` is what is on screen now. */
  | { kind: 'enter'; order: readonly number[] }
  /** The pointer left it. */
  | { kind: 'leave' }
  /** A column header was clicked: the reader asked for a new order. */
  | { kind: 'sort' }
  /** The reader scrolled the table themselves. */
  | { kind: 'scroll' }
  /** The question changed, so the set of rows did. */
  | { kind: 'filter' }
  /** Nothing is selected any more. */
  | { kind: 'clear' };

export function orderReduce(state: OrderState, event: OrderEvent): OrderState {
  switch (event.kind) {
    case 'pick':
      // The pointer is on the table: seal it here and now, on the order this
      // press was aimed at, whatever state the table was in a moment ago.
      if (event.sealing) return { frozen: [...event.order], anchor: event.id, sealed: true };
      // Re-picking inside an existing freeze keeps the order that is on screen;
      // re-snapshotting it would be harmless but pointless churn.
      if (state.frozen !== null) {
        return state.anchor === event.id ? state : { frozen: state.frozen, anchor: event.id, sealed: state.sealed };
      }
      return { frozen: [...event.order], anchor: event.id, sealed: state.sealed };
    case 'enter':
      if (state.sealed) return state;
      // An empty table has nothing to hold still, and sealing one would keep it
      // empty for as long as the pointer stayed on it.
      if (state.frozen === null && event.order.length === 0) return state;
      return { frozen: state.frozen ?? [...event.order], anchor: state.anchor, sealed: true };
    case 'leave':
      if (!state.sealed) return state;
      // The seal was the pointer's, and the pointer has gone. A freeze a PICK
      // put there outlives it — the row somebody chose still has to stay where
      // they can see it.
      return state.anchor === null ? FREE_ORDER : { frozen: state.frozen, anchor: state.anchor, sealed: false };
    case 'sort':
    case 'scroll':
    case 'filter':
    case 'clear':
      // Everything here is the reader asking for something new, and a reader
      // who has asked is a reader who is no longer mid-click. A seal is broken
      // by an intention, never by the table changing under one.
      return state.frozen === null && !state.sealed ? state : FREE_ORDER;
    default:
      return state;
  }
}

/**
 * The rows in the order the reader is looking at.
 *
 * Frozen ids keep the position they had when the freeze began; anything that
 * has appeared since — a being that walked into frame, or one a filter let back
 * in — follows in the order the sort put it, so new rows are never hidden and
 * old ones never jump.
 *
 * SEALED is the stronger promise, and it is the one a mouse needs: the table is
 * exactly the frozen list, looked up in `all` — every being the view holds,
 * whatever the current scope and sort would do to it. Nothing appears, nothing
 * departs, nothing moves. Not even a death moves a row: pass `memory` and a
 * being that dies keeps its place, marked, with the last values it had. Round
 * five measured a "sealed" table whose rendered rows changed over twelve
 * seconds with the pointer resting on it, and every one of those changes was a
 * departure at 2400×.
 */
export function applyOrder(
  rows: readonly RosterRow[],
  state: OrderState,
  all: readonly RosterRow[] = rows,
  memory?: Map<number, RosterRow>,
): RosterRow[] {
  if (state.frozen === null) return rows.slice();
  if (state.sealed) return sealedRows(state.frozen, all, memory);
  const at = new Map<number, number>();
  for (let i = 0; i < state.frozen.length; i++) at.set(state.frozen[i]!, i);
  const held: RosterRow[] = [];
  const fresh: RosterRow[] = [];
  for (const row of rows) (at.has(row.id) ? held : fresh).push(row);
  held.sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return held.concat(fresh);
}

/**
 * The sealed table: the frozen ids, in their frozen places.
 *
 * Live values where the being is still there, and — when a `memory` is handed
 * in — the last row it had, marked `gone`, where it is not. The marked row is
 * cached in the memory rather than rebuilt, so its object identity is stable
 * and React does not remount the row under the pointer.
 */
export function sealedRows(
  frozen: readonly number[],
  all: readonly RosterRow[],
  memory?: Map<number, RosterRow>,
): RosterRow[] {
  const byId = new Map<number, RosterRow>();
  for (const row of all) byId.set(row.id, row);
  const out: RosterRow[] = [];
  for (const id of frozen) {
    const live = byId.get(id);
    if (live) {
      memory?.set(id, live);
      out.push(live);
      continue;
    }
    const last = memory?.get(id);
    if (!last) continue;
    const marked = last.gone === true ? last : { ...last, gone: true, inFrame: false, visible: false };
    memory?.set(id, marked);
    out.push(marked);
  }
  return out;
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
