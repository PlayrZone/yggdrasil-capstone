import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_OPTIONS,
  CONDITION_OPTIONS,
  CONDITION_WORDS,
  STAGE_OPTIONS,
  chipCount,
  countMatches,
  describeCount,
  emptyFilter,
  filterRows,
  isEmptyFilter,
  matchesFilter,
  toggleActivity,
  toggleCondition,
  toggleStage,
  withText,
} from '../src/renderer/filters.js';
import {
  applyOrder,
  brushReduce,
  FREE_ORDER,
  indexOfRow,
  moveFocus,
  nextSort,
  NO_BRUSH,
  orderReduce,
  scrollToRow,
  shouldScrollToBrush,
  sortRows,
  windowFor,
  type Brush,
  type RosterRow,
} from '../src/renderer/roster.js';
import {
  conditionMix,
  coveringBodies,
  coveringBody,
  cycleCandidate,
  groupByActivity,
  orderCandidates,
  type BodyBox,
  PICK_BODY,
  PICK_FIGURE,
  PICK_HIDDEN,
  PICK_MARK,
  pickLayerOf,
  suppressOverlaps,
  type MarkPoint,
  type PickCandidate,
} from '../src/renderer/crowd.js';
import { CROWD_NOTE, LEGEND_EXTRA, legendFor } from '../src/renderer/beings.js';
import {
  ACT_COUNT,
  ACT_IDLE,
  ACT_RESTING,
  ACT_SOCIAL,
  ACT_WALKING,
  ACT_WORKING,
  COND_SICK,
  COND_STARVING,
  GOAL_NONE,
  GOAL_WORDS,
  goalWord,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
} from '../src/renderer/sim/protocol.js';

/**
 * Item L4 replaced per-being glyph reading with hover, a roster, filters and
 * crowd summaries. These are the pure halves of all four: the algebra a
 * researcher's question is evaluated with, the order a table is put in and the
 * slice of it that is mounted, the rule that decides when the picture must stop
 * claiming things, and the arithmetic behind a crowd's summary.
 *
 * Everything that touches three, the DOM or React is deliberately NOT here —
 * it is checked in the booted app against the probes. What is here is what can
 * be wrong silently.
 */

function row(over: Partial<RosterRow> & { id: number }): RosterRow {
  return {
    name: `Being ${over.id}`,
    selfChosen: false,
    stage: STAGE_ADULT,
    stageWord: 'adult',
    cond: 0,
    condWord: 'well',
    act: ACT_IDLE,
    actWord: 'standing',
    headingDeg: 0,
    headingWord: 'N',
    hunger: 10,
    rest: 10,
    distance: 100,
    inFrame: true,
    visible: true,
    ...over,
  };
}

describe('filter algebra', () => {
  const people = [
    row({ id: 1, stage: STAGE_CHILD, stageWord: 'child', condWord: 'starving', cond: COND_STARVING, act: ACT_WALKING, actWord: 'walking', name: 'Ashen' }),
    row({ id: 2, stage: STAGE_ELDER, stageWord: 'elder', condWord: 'well', act: ACT_SOCIAL, actWord: 'speaking', name: 'Belira' }),
    row({ id: 3, stage: STAGE_ADULT, condWord: 'sick', cond: COND_SICK, act: ACT_WORKING, actWord: 'gathering or building', name: 'Corvash', inFrame: false }),
    row({ id: 4, stage: STAGE_CHILD, stageWord: 'child', condWord: 'well', act: ACT_SOCIAL, actWord: 'speaking', name: 'Ashira' }),
  ];

  it('asks nothing until a chip is lit', () => {
    const f = emptyFilter();
    expect(isEmptyFilter(f)).toBe(true);
    expect(chipCount(f)).toBe(0);
    expect(filterRows(people, f)).toHaveLength(people.length);
  });

  it('ORs within a group: a second age WIDENS the age question', () => {
    const one = toggleStage(emptyFilter(), STAGE_CHILD);
    expect(filterRows(people, one).map((r) => r.id)).toEqual([1, 4]);
    const two = toggleStage(one, STAGE_ELDER);
    expect(filterRows(people, two).map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it('ANDs across groups: age AND condition AND activity AND the name', () => {
    let f = toggleStage(emptyFilter(), STAGE_CHILD);
    f = toggleCondition(f, 'well');
    expect(filterRows(people, f).map((r) => r.id)).toEqual([4]);
    f = toggleActivity(f, ACT_SOCIAL);
    expect(filterRows(people, f).map((r) => r.id)).toEqual([4]);
    expect(filterRows(people, withText(f, 'ashir')).map((r) => r.id)).toEqual([4]);
    expect(filterRows(people, withText(f, 'belira'))).toHaveLength(0);
  });

  it('searches names without regard to case, and on a substring', () => {
    // Corvash is in there too — a substring search means substrings, anywhere.
    expect(filterRows(people, withText(emptyFilter(), 'ASH')).map((r) => r.id)).toEqual([1, 3, 4]);
    expect(filterRows(people, withText(emptyFilter(), 'ashe')).map((r) => r.id)).toEqual([1]);
    expect(filterRows(people, withText(emptyFilter(), '  ')).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('toggling the same chip twice restores the question exactly', () => {
    const f = toggleStage(emptyFilter(), STAGE_ELDER);
    expect(toggleStage(f, STAGE_ELDER)).toEqual(emptyFilter());
  });

  it('never mutates the state it is given', () => {
    const f = emptyFilter();
    toggleStage(f, STAGE_CHILD);
    toggleCondition(f, 'sick');
    toggleActivity(f, ACT_IDLE);
    expect(f).toEqual(emptyFilter());
  });

  it('counts matches, the whole population, and how many are in frame', () => {
    const f = toggleCondition(emptyFilter(), 'sick');
    const c = countMatches(people, f);
    expect(c).toEqual({ matched: 1, total: 4, inFrame: 0, filtering: true });
    expect(describeCount(c)).toBe('1 of 4 match · 0 in frame');
  });

  it('says so plainly when nothing answers — a zero-match is an answer', () => {
    let f = toggleCondition(emptyFilter(), 'sick');
    f = toggleStage(f, STAGE_CHILD);
    const c = countMatches(people, f);
    expect(c.matched).toBe(0);
    expect(describeCount(c)).toBe('no match · 4 living');
  });

  it('prints the population and no claim while nothing is asked', () => {
    expect(describeCount(countMatches(people, emptyFilter()))).toBe('4 living · no filter');
  });

  it('offers a chip for every value the roster can print, and no others', () => {
    expect(STAGE_OPTIONS.map((o) => o.label)).toEqual(['child', 'adult', 'elder']);
    expect(CONDITION_OPTIONS.map((o) => o.value)).toEqual([...CONDITION_WORDS]);
    expect(ACTIVITY_OPTIONS).toHaveLength(ACT_COUNT);
    // The chip and the column must use the SAME word, or a reader filters for
    // one thing and reads another.
    const working = ACTIVITY_OPTIONS.find((o) => o.value === ACT_WORKING);
    expect(working?.label).toBe('gathering or building');
  });

  it('matches a row the same way whether asked one at a time or in bulk', () => {
    const f = toggleActivity(emptyFilter(), ACT_SOCIAL);
    for (const r of people) expect(matchesFilter(r, f)).toBe(filterRows(people, f).includes(r));
  });
});

describe('roster order', () => {
  const people = [
    row({ id: 7, name: 'Zeph', distance: 40, hunger: 90, condWord: 'well', stage: STAGE_ELDER }),
    row({ id: 3, name: 'ashen', distance: 12, hunger: 20, condWord: 'in danger', stage: STAGE_CHILD }),
    row({ id: 5, name: 'Mira', distance: 40, hunger: 55, condWord: 'starving', stage: STAGE_ADULT }),
  ];

  it('sorts by distance ascending by default and breaks every tie on id', () => {
    const out = sortRows(people, { key: 'distance', dir: 1 });
    expect(out.map((r) => r.id)).toEqual([3, 5, 7]);
  });

  it('is stable under a re-sort of identical rows — a table must not shuffle itself', () => {
    const flat = [row({ id: 9 }), row({ id: 2 }), row({ id: 5 })];
    const once = sortRows(flat, { key: 'activity', dir: 1 });
    const twice = sortRows(once, { key: 'activity', dir: 1 });
    expect(once.map((r) => r.id)).toEqual([2, 5, 9]);
    expect(twice.map((r) => r.id)).toEqual(once.map((r) => r.id));
  });

  it('sorts names without regard to case', () => {
    expect(sortRows(people, { key: 'name', dir: 1 }).map((r) => r.name)).toEqual(['ashen', 'Mira', 'Zeph']);
  });

  it('puts the beings in trouble on top when sorting by condition', () => {
    expect(sortRows(people, { key: 'condition', dir: 1 }).map((r) => r.condWord))
      .toEqual(['in danger', 'starving', 'well']);
  });

  it('sorts a need by pressure, worst first — the reading a researcher wants', () => {
    expect(sortRows(people, { key: 'hunger', dir: 1 }).map((r) => r.hunger)).toEqual([90, 55, 20]);
  });

  it('flips a column that is already sorted and starts a new one ascending', () => {
    expect(nextSort({ key: 'name', dir: 1 }, 'name')).toEqual({ key: 'name', dir: -1 });
    expect(nextSort({ key: 'name', dir: -1 }, 'name')).toEqual({ key: 'name', dir: 1 });
    expect(nextSort({ key: 'name', dir: -1 }, 'stage')).toEqual({ key: 'stage', dir: 1 });
  });

  it('never mutates the array it sorts', () => {
    const before = people.map((r) => r.id);
    sortRows(people, { key: 'name', dir: -1 });
    expect(people.map((r) => r.id)).toEqual(before);
  });
});

describe('roster windowing', () => {
  it('mounts only the visible slice, and the spacers add up to the whole table', () => {
    const w = windowFor(0, 240, 24, 320, 6);
    expect(w.start).toBe(0);
    expect(w.end).toBeLessThan(40);
    expect(w.padTop + (w.end - w.start) * 24 + w.padBottom).toBe(320 * 24);
  });

  it('keeps the arithmetic exact anywhere in the scroll', () => {
    for (const top of [0, 37, 500, 2400, 7670]) {
      const w = windowFor(top, 200, 24, 320, 6);
      expect(w.padTop + (w.end - w.start) * 24 + w.padBottom).toBe(320 * 24);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(320);
    }
  });

  it('covers the viewport with overscan on both sides', () => {
    const w = windowFor(24 * 50, 240, 24, 320, 6);
    // Everything a reader can see is mounted…
    expect(w.start).toBeLessThanOrEqual(50);
    expect(w.end).toBeGreaterThanOrEqual(50 + Math.ceil(240 / 24));
    // …and not much else.
    expect(w.end - w.start).toBeLessThan(30);
  });

  it('mounts nothing for an empty table', () => {
    expect(windowFor(0, 240, 24, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('scrolls a row into view only when it is out of it', () => {
    expect(scrollToRow(4, 0, 240, 24)).toBeNull();
    expect(scrollToRow(0, 100, 240, 24)).toBe(0);
    expect(scrollToRow(20, 0, 240, 24)).toBe(20 * 24 + 24 - 240);
    expect(scrollToRow(-1, 0, 240, 24)).toBeNull();
  });

  it('moves keyboard focus without wrapping off either end', () => {
    expect(moveFocus(-1, 5, 1)).toBe(0);
    expect(moveFocus(-1, 5, -1)).toBe(4);
    expect(moveFocus(0, 5, -1)).toBe(0);
    expect(moveFocus(4, 5, 1)).toBe(4);
    expect(moveFocus(0, 0, 1)).toBe(-1);
  });

  it('finds a row by id, and says -1 rather than 0 for nothing', () => {
    const rows = [row({ id: 4 }), row({ id: 9 })];
    expect(indexOfRow(rows, 9)).toBe(1);
    expect(indexOfRow(rows, 5)).toBe(-1);
    expect(indexOfRow(rows, null)).toBe(-1);
  });
});

describe('brushing', () => {
  it('lights the row the canvas is pointing at', () => {
    const b = brushReduce(NO_BRUSH, { kind: 'world-hover', id: 12 });
    expect(b).toEqual({ id: 12, source: 'world' });
    expect(shouldScrollToBrush(b)).toBe(true);
  });

  it('lets the table win while the pointer is on it, and does not scroll under it', () => {
    const b = brushReduce({ id: 12, source: 'world' }, { kind: 'roster-hover', id: 4 });
    expect(b).toEqual({ id: 4, source: 'roster' });
    expect(shouldScrollToBrush(b)).toBe(false);
  });

  it('refuses the canvas the right to stamp on a row the reader is reading', () => {
    // The 3D view re-picks a dozen times a second whether or not anyone is
    // looking at it. This is the bug that rule exists for.
    const held: Brush = { id: 4, source: 'roster' };
    expect(brushReduce(held, { kind: 'world-hover', id: 12 })).toBe(held);
    expect(brushReduce(held, { kind: 'world-hover', id: null })).toBe(held);
    expect(brushReduce(held, { kind: 'world-leave' })).toBe(held);
  });

  it('only the owner may clear', () => {
    expect(brushReduce({ id: 4, source: 'roster' }, { kind: 'roster-leave' })).toEqual(NO_BRUSH);
    expect(brushReduce({ id: 4, source: 'world' }, { kind: 'roster-leave' })).toEqual({ id: 4, source: 'world' });
    expect(brushReduce({ id: 4, source: 'world' }, { kind: 'world-hover', id: null })).toEqual(NO_BRUSH);
  });

  it('returns the same object when nothing changed, so React re-renders nothing', () => {
    const held: Brush = { id: 7, source: 'world' };
    expect(brushReduce(held, { kind: 'world-hover', id: 7 })).toBe(held);
    expect(brushReduce(NO_BRUSH, { kind: 'world-hover', id: null })).toBe(NO_BRUSH);
  });
});

describe('crowd suppression', () => {
  it('lets a being standing alone keep its pictogram and its arrow', () => {
    const points: MarkPoint[] = [{ x: 0, y: 0, r: 10 }, { x: 200, y: 0, r: 10 }, { x: 0, y: 200, r: 10 }];
    expect(suppressOverlaps(points)).toEqual([true, true, true]);
  });

  it('withholds BOTH marks when two would touch — never just the smaller one', () => {
    // Suppressing one side leaves a mark sitting on a boundary a reader has no
    // way to resolve, which is the exact failure this rule exists to remove.
    const flags = suppressOverlaps([{ x: 0, y: 0, r: 10 }, { x: 15, y: 0, r: 10 }]);
    expect(flags).toEqual([false, false]);
  });

  it('is exact at the boundary: marks that just touch collide, marks that just clear do not', () => {
    expect(suppressOverlaps([{ x: 0, y: 0, r: 10 }, { x: 19.9, y: 0, r: 10 }])).toEqual([false, false]);
    expect(suppressOverlaps([{ x: 0, y: 0, r: 10 }, { x: 20.1, y: 0, r: 10 }])).toEqual([true, true]);
  });

  it('respects each mark’s own size — a child’s pin is smaller and clears sooner', () => {
    expect(suppressOverlaps([{ x: 0, y: 0, r: 20 }, { x: 25, y: 0, r: 10 }])).toEqual([false, false]);
    expect(suppressOverlaps([{ x: 0, y: 0, r: 8 }, { x: 25, y: 0, r: 10 }])).toEqual([true, true]);
  });

  it('is symmetric and order-independent', () => {
    const a: MarkPoint[] = [{ x: 0, y: 0, r: 12 }, { x: 18, y: 4, r: 9 }, { x: 400, y: 400, r: 30 }];
    const forward = suppressOverlaps(a);
    const back = suppressOverlaps([...a].reverse()).reverse();
    expect(forward).toEqual(back);
  });

  it('agrees with the brute-force rule over a random settlement', () => {
    let seed = 20260918;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + Math.floor(rnd() * 60);
      const pts: MarkPoint[] = [];
      for (let i = 0; i < n; i++) pts.push({ x: rnd() * 600, y: rnd() * 400, r: 4 + rnd() * 26 });
      const fast = suppressOverlaps(pts);
      const slow = pts.map((p, i) => !pts.some((q, j) => {
        if (i === j) return false;
        const reach = p.r + q.r;
        return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < reach * reach;
      }));
      expect(fast).toEqual(slow);
    }
  });

  it('says nothing about a single being, or none at all', () => {
    expect(suppressOverlaps([])).toEqual([]);
    expect(suppressOverlaps([{ x: 3, y: 3, r: 40 }])).toEqual([true]);
  });
});

describe('disambiguation order', () => {
  const body = (id: number, depth: number): PickCandidate => ({ id, onBody: true, distPx: 0, depth });
  const near = (id: number, distPx: number, depth = 50): PickCandidate => ({ id, onBody: false, distPx, depth });

  it('offers the body the ray actually struck before anything merely nearby', () => {
    expect(orderCandidates([near(1, 2), body(2, 90)]).map((c) => c.id)).toEqual([2, 1]);
  });

  it('offers the nearest body first when several were struck', () => {
    expect(orderCandidates([body(1, 90), body(2, 12), body(3, 40)]).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('orders the rest by how close the cursor is to their mark', () => {
    expect(orderCandidates([near(1, 9), near(2, 2), near(3, 5)]).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it('is deterministic under an exact tie, so the arrow keys walk a stable list', () => {
    const tied = [near(9, 4), near(2, 4), near(5, 4)];
    expect(orderCandidates(tied).map((c) => c.id)).toEqual([2, 5, 9]);
    expect(orderCandidates([...tied].reverse()).map((c) => c.id)).toEqual([2, 5, 9]);
  });

  it('never mutates the list it is given', () => {
    const given = [near(3, 9), near(1, 1)];
    orderCandidates(given);
    expect(given.map((c) => c.id)).toEqual([3, 1]);
  });

  it('steps through the list and wraps at both ends', () => {
    expect(cycleCandidate(4, 0, 1)).toBe(1);
    expect(cycleCandidate(4, 3, 1)).toBe(0);
    expect(cycleCandidate(4, 0, -1)).toBe(3);
    expect(cycleCandidate(0, 0, 1)).toBe(0);
  });
});

describe('crowd summary', () => {
  const crowd = [
    { cond: 0, act: ACT_IDLE },
    { cond: 0, act: ACT_WALKING },
    { cond: COND_STARVING, act: ACT_WALKING },
    { cond: COND_SICK, act: ACT_RESTING },
    { cond: 0, act: ACT_SOCIAL },
  ];

  it('counts each condition exactly, and the segments add up to the crowd', () => {
    const mix = conditionMix(crowd);
    expect(mix.map((m) => [m.word, m.count])).toEqual([['well', 3], ['starving', 1], ['sick', 1]]);
    expect(mix.reduce((n, m) => n + m.count, 0)).toBe(crowd.length);
  });

  it('keeps the legend’s own order, so two chips can be compared without reading them', () => {
    const shuffled = conditionMix([...crowd].reverse());
    expect(shuffled.map((m) => m.word)).toEqual(['well', 'starving', 'sick']);
  });

  it('drops empty segments rather than drawing a zero-width one', () => {
    expect(conditionMix([{ cond: 0, act: ACT_IDLE }]).map((m) => m.word)).toEqual(['well']);
    expect(conditionMix([])).toEqual([]);
  });

  it('gives every segment a colour from the condition palette', () => {
    for (const seg of conditionMix(crowd)) expect(seg.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(conditionMix(crowd).map((m) => m.color)).size).toBe(3);
  });

  it('groups a crowd by what it is doing, biggest first, ties alphabetical', () => {
    const acts = groupByActivity([
      { actWord: 'walking' }, { actWord: 'standing' }, { actWord: 'walking' },
      { actWord: 'asleep' }, { actWord: 'standing' },
    ]);
    expect(acts).toEqual([
      { word: 'standing', count: 2 },
      { word: 'walking', count: 2 },
      { word: 'asleep', count: 1 },
    ]);
  });
});

describe('the legend tells the truth about what is withheld', () => {
  // The picture may refuse to say what a being is doing. What it may NOT do is
  // refuse silently: a key that lists a pictogram in a frame that is not
  // drawing it is the failure every earlier round of this work ended in.
  const inline = (band: Parameters<typeof legendFor>[0]): string[] =>
    legendFor(band)
      .flatMap((s) => s.items)
      .filter((i): i is Extract<typeof i, { kind: 'note' }> => i.kind === 'note' && i.quiet !== true)
      .map((i) => i.label);

  for (const band of ['default', 'mid', 'near'] as const) {
    it(`says it at ${band}, in the key itself and not behind "more"`, () => {
      const notes = inline(band).join(' ');
      expect(notes).toContain(CROWD_NOTE);
      expect(CROWD_NOTE).toMatch(/BOTH dropped/);
    });
  }

  it('does not claim it at FAR, where no being wears a pictogram or an arrow', () => {
    // FAR draws a dot and a number. There is no per-being mark to withhold, so
    // a note about withholding one would be noise about nothing.
    expect(inline('far').join(' ')).not.toContain(CROWD_NOTE);
  });

  it('keeps the inline key short enough to sit under the canvas', () => {
    // Prose costs world. Every band keeps at most two inline sentences; the
    // rest opens with the key, and the live count is on the canvas itself.
    for (const band of ['far', 'default', 'mid', 'near'] as const) {
      expect(inline(band).length).toBeLessThanOrEqual(2);
    }
  });

  it('points a reader at the interaction that does answer it', () => {
    const prose = [...legendFor('mid'), ...LEGEND_EXTRA].flatMap((s) => s.items).map((i) => i.label).join(' ');
    expect(prose).toContain('roster');
  });
});

describe('the goal lane', () => {
  it('names every intent the engine can plan, and nothing it cannot', () => {
    expect(GOAL_WORDS).toHaveLength(16);
    expect(new Set(GOAL_WORDS).size).toBe(16);
    expect(goalWord(0)).toBe('move to');
    expect(goalWord(15)).toBe('idle');
  });

  it('answers null for a being with no plan rather than inventing one', () => {
    expect(goalWord(GOAL_NONE)).toBeNull();
    expect(goalWord(200)).toBeNull();
  });
});

// ── The table holds still while somebody is reading it ───────────────────────

/**
 * Round six: click a roster row → the camera centres on that being → its
 * `distance` goes to zero → the distance sort re-runs → the row you clicked
 * lands at the far end of three hundred. The inspector filled with the right
 * being and the table had lost it: `.rrow.sel` was not in the list at all.
 *
 * A sort order is a reading aid, not a live read-out, so it freezes under a
 * selection and thaws only on something the reader did on purpose.
 */
describe('a selected row stays where the reader put it', () => {
  const table = [
    row({ id: 1, distance: 10 }),
    row({ id: 2, distance: 20 }),
    row({ id: 3, distance: 30 }),
    row({ id: 4, distance: 40 }),
  ];

  it('freezes the order the moment a row is picked', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 3, order: [1, 2, 3, 4] });
    expect(state.frozen).toEqual([1, 2, 3, 4]);
    expect(state.anchor).toBe(3);
  });

  it('keeps the picked row in place when centring zeroes its distance', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 3, order: [1, 2, 3, 4] });
    // The camera arrives: #3 is now nearest, and a live sort would move it to
    // the top — or, sorted the other way, off the end of the list.
    const moved = table.map((r) => (r.id === 3 ? row({ id: 3, distance: 0 }) : r));
    const resorted = sortRows(moved, { key: 'distance', dir: 1 });
    expect(resorted.map((r) => r.id)).toEqual([3, 1, 2, 4]);
    expect(applyOrder(resorted, state).map((r) => r.id)).toEqual([1, 2, 3, 4]);
    // And the row is still THERE, which is the actual defect.
    expect(indexOfRow(applyOrder(resorted, state), 3)).toBe(2);
  });

  it('thaws on a header click, a scroll, a new question, or dropping the selection', () => {
    const frozen = orderReduce(FREE_ORDER, { kind: 'pick', id: 2, order: [1, 2, 3, 4] });
    for (const kind of ['sort', 'scroll', 'filter', 'clear'] as const) {
      expect(orderReduce(frozen, { kind }).frozen).toBeNull();
    }
  });

  it('does not re-snapshot the order when the selection moves inside a freeze', () => {
    const first = orderReduce(FREE_ORDER, { kind: 'pick', id: 2, order: [1, 2, 3, 4] });
    const second = orderReduce(first, { kind: 'pick', id: 4, order: [4, 3, 2, 1] });
    expect(second.frozen).toEqual([1, 2, 3, 4]);
    expect(second.anchor).toBe(4);
  });

  it('is a no-op when nothing is frozen, so a free table never re-renders for this', () => {
    for (const kind of ['sort', 'scroll', 'filter', 'clear'] as const) {
      expect(orderReduce(FREE_ORDER, { kind })).toBe(FREE_ORDER);
    }
    expect(applyOrder(table, FREE_ORDER).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('lets a being that has just walked into frame in, at the end, rather than hiding it', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 2, order: [1, 2, 3] });
    const withNewcomer = [...table, row({ id: 9, distance: 5 })];
    const out = applyOrder(sortRows(withNewcomer, { key: 'distance', dir: 1 }), state);
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 9, 4]);
  });

  it('drops a being that has died without disturbing the rest', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 3, order: [1, 2, 3, 4] });
    const alive = table.filter((r) => r.id !== 2);
    expect(applyOrder(alive, state).map((r) => r.id)).toEqual([1, 3, 4]);
  });

  it('never mutates the rows it orders', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 1, order: [4, 3, 2, 1] });
    const before = table.map((r) => r.id);
    applyOrder(table, state);
    expect(table.map((r) => r.id)).toEqual(before);
  });
});

// ── Picking is about what is DRAWN at that pixel ─────────────────────────────

/**
 * Round six verified identification 15/15 through `ui.hover(id)` — the one
 * route that never touches picking — and a reviewer with a real mouse, aiming
 * at each being's own reported position, got a card for somebody else seven
 * times in ten in a crowd. The cause was the ordering: any body the ray struck
 * outranked everything, and a body the ray MISSED (through the gap between an
 * arm and a trunk, or over a being lying down) fell all the way back to "whose
 * PIN is nearest" — and a pin is at the feet, forty pixels below the cursor.
 */
describe('a pick offers what is drawn at that pixel', () => {
  const at = (id: number, layer: number, depth: number, distPx = 0): PickCandidate =>
    ({ id, onBody: layer === PICK_BODY, layer, distPx, depth });

  it('offers an exact body hit before the same crowd’s footprints and pins', () => {
    const list = [at(1, PICK_MARK, 10, 2), at(2, PICK_FIGURE, 40), at(3, PICK_BODY, 90)];
    expect(orderCandidates(list).map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it('offers the figure the ray slipped through before a neighbour’s pin', () => {
    // The exact shape of the defect: the target's own body box against a
    // neighbour whose pin happens to be nearer the cursor.
    const target = at(7, PICK_FIGURE, 30, 26);
    const neighbour = at(8, PICK_MARK, 28, 3);
    expect(orderCandidates([neighbour, target])[0]!.id).toBe(7);
  });

  it('breaks a tie within a layer by nearest to the camera, then nearest to the cursor', () => {
    expect(orderCandidates([at(1, PICK_BODY, 90), at(2, PICK_BODY, 12), at(3, PICK_BODY, 40)]).map((c) => c.id))
      .toEqual([2, 3, 1]);
    expect(orderCandidates([at(1, PICK_MARK, 20, 9), at(2, PICK_MARK, 20, 2)]).map((c) => c.id)).toEqual([2, 1]);
  });

  it('puts a being you can only see through a hill after anyone standing in the open', () => {
    const ghosted = at(4, PICK_BODY + PICK_HIDDEN, 5);
    const plain = at(5, PICK_MARK, 400, 8);
    expect(orderCandidates([ghosted, plain]).map((c) => c.id)).toEqual([5, 4]);
  });

  it('reads a candidate that only knows body-or-not, so nothing has to be rewritten at once', () => {
    expect(pickLayerOf({ id: 1, onBody: true, distPx: 0, depth: 1 })).toBe(PICK_BODY);
    expect(pickLayerOf({ id: 2, onBody: false, distPx: 4, depth: 1 })).toBe(PICK_MARK);
  });

  it('is still deterministic under an exact tie, so the arrow keys walk a stable list', () => {
    const tied = [at(9, PICK_MARK, 20, 4), at(2, PICK_MARK, 20, 4), at(5, PICK_MARK, 20, 4)];
    expect(orderCandidates(tied).map((c) => c.id)).toEqual([2, 5, 9]);
    expect(orderCandidates([...tied].reverse()).map((c) => c.id)).toEqual([2, 5, 9]);
  });
});

// ── A being standing behind a being is not in the picture ────────────────────

/**
 * The other half of round six's 3/10 identification score, and the half that
 * was not the picking. `visibleIds()` offered beings whose reported position
 * belonged to somebody standing in front of them; a reviewer pointed a real
 * mouse at each one and got a card about the being that WAS drawn there —
 * correctly. Bodies are opaque and drawn in depth order, so the probe has to
 * say so.
 */
describe('the probes do not offer a being somebody else is standing in front of', () => {
  const box = (id: number, x: number, y: number, depth: number, w = 20, h = 60): BodyBox =>
    ({ id, x, y, x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2, depth });

  it('names whoever is in front at the very point the view reports', () => {
    const boxes = [box(1, 100, 100, 30), box(2, 104, 104, 12)];
    expect(coveringBody(boxes, 1)).toBe(2);
    expect(coveringBody(boxes, 2)).toBeNull();
  });

  it('leaves a being standing in the open alone', () => {
    expect(coveringBody([box(1, 100, 100, 30), box(2, 400, 100, 12)], 1)).toBeNull();
  });

  it('resolves two beings at the same depth to exactly one, rather than to neither', () => {
    // Round two's rule gave the pair a half-metre of depth slack and left BOTH
    // reporting `coveredBy: null` — which is how a reviewer found four beings
    // sharing one pixel, all four still offered by `visibleIds()` while the
    // picker correctly returned one of them. Two figures three pixels apart are
    // one drawn body and one behind it, whatever the depths say; the nearer one
    // is visible and the other names it.
    const boxes = [box(1, 100, 100, 30), box(2, 103, 101, 29.8)];
    expect(coveringBody(boxes, 2)).toBeNull();
    expect(coveringBody(boxes, 1)).toBe(2);
  });

  it('leaves exactly one being visible out of a stack of 2, 4 or 10', () => {
    for (const n of [2, 4, 10]) {
      const boxes = [];
      for (let i = 0; i < n; i++) boxes.push(box(i + 1, 100 + i * 0.5, 100 + i * 0.4, 20 + i * 0.1));
      const cover = coveringBodies(boxes);
      const visible = boxes.filter((b) => !cover.has(b.id));
      expect(visible).toHaveLength(1);
      expect(visible[0]!.id).toBe(1); // nearest to the eye — the picker's own order
      // …and nobody is covered by somebody who is themselves covered.
      for (const b of boxes) {
        if (!cover.has(b.id)) continue;
        expect(cover.get(b.id)).toBe(1);
      }
    }
  });

  it('breaks an exact depth tie the way the picker does — by id', () => {
    const boxes = [box(9, 100, 100, 20), box(2, 100, 100, 20), box(5, 100, 100, 20)];
    const cover = coveringBodies(boxes);
    expect(cover.get(2)).toBeUndefined();
    expect(cover.get(5)).toBe(2);
    expect(cover.get(9)).toBe(2);
  });

  it('is a threshold, not a touch: a shoulder-clip is still two beings', () => {
    // 20 × 60 boxes, side by side, the front one's edge just clear of the back
    // one's own reported point — so only the area rule can fire. Overlap is
    // measured as a fraction of the BACK being's figure: how much of IT is
    // hidden.
    const under = [box(1, 100, 100, 30), box(2, 111, 100, 10)]; // 45% of #1 covered
    expect(coveringBodies(under).get(1)).toBeUndefined();
    const over = [box(1, 100, 100, 30), box(2, 110.3, 100, 10)]; // 48.5%, point still clear
    expect(coveringBodies(over).get(1)).toBe(2);
    // Vertically, for the same reason: a head over a shoulder is two people.
    expect(coveringBodies([box(1, 100, 100, 30), box(2, 100, 132, 10, 20, 60)]).get(1)).toBeUndefined();
  });

  it('says nothing about scenery: a being behind a ghosted hut is still visible', () => {
    // Only BEINGS are in this list — `bodyBoxes()` builds it from the drawn
    // figures and nothing else — because anything else standing in front of a
    // being is ghosted by construction and the being is drawn through it. A
    // hut's box would have hidden a being the picture does show.
    const alone = [box(1, 100, 100, 30)];
    expect(coveringBodies(alone).size).toBe(0);
    expect(coveringBody(alone, 1)).toBeNull();
  });

  it('names the NEAREST of several in front, which is the one actually drawn', () => {
    const boxes = [box(1, 100, 100, 30), box(2, 100, 100, 20), box(3, 100, 100, 9)];
    expect(coveringBody(boxes, 1)).toBe(3);
  });

  it('says nothing about a being that is not in the frame at all', () => {
    expect(coveringBody([box(2, 100, 100, 10)], 99)).toBeNull();
  });

  it('is exact at the edge of a body — a point on the boundary is covered', () => {
    const boxes = [box(1, 100, 100, 30), box(2, 110, 100, 10, 20, 60)];
    expect(coveringBody(boxes, 1)).toBe(2); // 100 is the left edge of #2
    expect(coveringBody([box(1, 100, 100, 30), box(2, 111, 100, 10, 20, 60)], 1)).toBeNull();
  });
});
