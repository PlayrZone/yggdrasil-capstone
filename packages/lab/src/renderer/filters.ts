/**
 * Filter algebra for the world view — the "show me only these" half of item L4.
 *
 * Five rounds tried to make every being's stage, condition and activity readable
 * from marks in a still frame, and per-being reading topped out at 38–71% in a
 * crowd because a reader cannot reliably attach a mark to a BODY when bodies
 * overlap. Serious instruments do not ask you to. They let you state a question
 * — *starving children*, *whoever is speaking* — and then answer it in the view.
 *
 * The algebra is deliberately the dullest possible one, because a filter a
 * researcher cannot predict is a filter they cannot trust:
 *
 *   · OR inside a group  — "child or elder" is two chips in the age group;
 *   · AND across groups  — age AND condition AND activity AND the name search;
 *   · an empty group constrains nothing.
 *
 * Pure: no DOM, no three, no renderer state. The view reads the result, the
 * roster reads the same result, and `matchCount` is the number both of them
 * print — one evaluation, so the picture and the number can never disagree.
 */

import {
  ACT_COUNT,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
} from './sim/protocol.js';
import { activityWord, stageWord } from './beings.js';

/** The four words `conditionWord` can produce, in the order the legend lists them. */
export const CONDITION_WORDS: readonly string[] = ['well', 'starving', 'sick', 'in danger'];

export const STAGES: readonly number[] = [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER];

/**
 * The activities a chip can select, as the ROSTER names them — the sim's own
 * vocabulary, not the band's coarser one. A filter is an interaction, and an
 * interaction is allowed to know things a still frame cannot show; what it must
 * never do is name them differently from the column beside it.
 */
export const ACTIVITIES: readonly number[] = Array.from({ length: ACT_COUNT }, (_, i) => i);

/**
 * A question, as chips. Arrays rather than Sets so the whole state serialises
 * straight into `window.__ygg.activeFilters()` and out of a driver's script.
 */
export interface FilterState {
  /** Life stages to keep. Empty means every stage. */
  stages: number[];
  /** Condition words to keep, from `CONDITION_WORDS`. Empty means every condition. */
  conditions: string[];
  /** Activity codes to keep. Empty means every activity. */
  activities: number[];
  /** Case-insensitive substring of the name. Empty means every name. */
  text: string;
}

/** Anything with the four axes a chip can test. The roster row is one of these. */
export interface Filterable {
  stage: number;
  condWord: string;
  act: number;
  name: string;
}

export function emptyFilter(): FilterState {
  return { stages: [], conditions: [], activities: [], text: '' };
}

/** True while the filter asks nothing — the state the view is in by default. */
export function isEmptyFilter(f: FilterState): boolean {
  return f.stages.length === 0 && f.conditions.length === 0 && f.activities.length === 0 && f.text.trim() === '';
}

/** How many chips are lit, for the "clear" affordance's badge. */
export function chipCount(f: FilterState): number {
  return f.stages.length + f.conditions.length + f.activities.length + (f.text.trim() === '' ? 0 : 1);
}

function toggleIn<T>(list: readonly T[], value: T): T[] {
  const at = list.indexOf(value);
  if (at < 0) return [...list, value];
  const out = list.slice();
  out.splice(at, 1);
  return out;
}

export function toggleStage(f: FilterState, stage: number): FilterState {
  return { ...f, stages: toggleIn(f.stages, stage) };
}

export function toggleCondition(f: FilterState, word: string): FilterState {
  return { ...f, conditions: toggleIn(f.conditions, word) };
}

export function toggleActivity(f: FilterState, act: number): FilterState {
  return { ...f, activities: toggleIn(f.activities, act) };
}

export function withText(f: FilterState, text: string): FilterState {
  return { ...f, text };
}

/**
 * Does this being answer the question?
 *
 * Each group is an OR over its own chips and the groups are ANDed, which is the
 * reading every table filter in every instrument has: ticking a second age does
 * not narrow the age group, it widens it.
 */
export function matchesFilter(row: Filterable, f: FilterState): boolean {
  if (f.stages.length > 0 && !f.stages.includes(row.stage)) return false;
  if (f.conditions.length > 0 && !f.conditions.includes(row.condWord)) return false;
  if (f.activities.length > 0 && !f.activities.includes(row.act)) return false;
  const needle = f.text.trim().toLowerCase();
  if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false;
  return true;
}

export function filterRows<T extends Filterable>(rows: readonly T[], f: FilterState): T[] {
  if (isEmptyFilter(f)) return rows.slice();
  return rows.filter((r) => matchesFilter(r, f));
}

export interface MatchCount {
  /** Beings answering the question, anywhere in the living population. */
  matched: number;
  /** Living beings the view knows about. */
  total: number;
  /** Of the matches, how many are projected inside the canvas right now. */
  inFrame: number;
  /** True while nothing is being asked — the caller prints no count at all. */
  filtering: boolean;
}

export function countMatches<T extends Filterable & { inFrame: boolean }>(
  rows: readonly T[],
  f: FilterState,
): MatchCount {
  let matched = 0;
  let inFrame = 0;
  const filtering = !isEmptyFilter(f);
  for (const r of rows) {
    if (filtering && !matchesFilter(r, f)) continue;
    matched++;
    if (r.inFrame) inFrame++;
  }
  return { matched, total: rows.length, inFrame, filtering };
}

/**
 * The count, in words, exactly as the bar prints it.
 *
 * Kept here rather than in the component because it is the sentence the whole
 * feature is judged on: a view that emphasises seven beings and says "8 match"
 * is worse than one that says nothing.
 */
export function describeCount(c: MatchCount): string {
  if (!c.filtering) return `${c.total} living · no filter`;
  if (c.matched === 0) return `no match · ${c.total} living`;
  return `${c.matched} of ${c.total} match · ${c.inFrame} in frame`;
}

/** The chips a group offers, each with the word the roster column uses. */
export interface ChipOption<T> {
  value: T;
  label: string;
}

export const STAGE_OPTIONS: readonly ChipOption<number>[] = STAGES.map((s) => ({ value: s, label: stageWord(s) }));

export const CONDITION_OPTIONS: readonly ChipOption<string>[] = CONDITION_WORDS.map((w) => ({ value: w, label: w }));

export const ACTIVITY_OPTIONS: readonly ChipOption<number>[] = ACTIVITIES.map((a) => ({ value: a, label: activityWord(a) }));
