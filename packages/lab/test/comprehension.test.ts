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
  cycleCandidate,
  groupByActivity,
  offerAudit,
  offeredUnderPointer,
  OFFER_MARGIN_PX,
  orderCandidates,
  PICK_BODY,
  PICK_FIGURE,
  PICK_HIDDEN,
  PICK_MARK,
  pickLayerOf,
  steadyWinner,
  suppressOverlaps,
  type MarkPoint,
  type PickCandidate,
} from '../src/renderer/crowd.js';
import {
  CROWD_NOTE,
  figurePose,
  figureSpread,
  LEGEND_EXTRA,
  legendFor,
  nameClaimFor,
  poseLean,
  stageForm,
} from '../src/renderer/beings.js';
import {
  ACT_COUNT,
  ACT_DANGER,
  ACT_DRINKING,
  ACT_EATING,
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

/** A deterministic stream, so a property test fails the same way twice. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

/**
 * Round eight: a real mouse selected one row and then no other — three clicks
 * in four left `.rrow.sel` and the selection bar reading the FIRST being, and a
 * fourth left nothing selected at all. `ui.select` passed four times out of
 * four, so it was never the selection: it was the pointer.
 *
 * The cause is two things that only fail together. A `click` is dispatched only
 * on the element that saw both the press and the release — anywhere else it
 * lands on their common ancestor, which here is the table body and selects
 * nobody. And the table was moving under the pointer: picking a row centres the
 * camera on that being, beings walk out of the frame the "in frame" box scopes
 * the table to, the freeze held their ORDER but let them leave the SET, and
 * everything below slid up one row per departure.
 *
 * So the order is sealed while the pointer is inside the table — nothing
 * appears, departs or moves — and a row is picked on POINTERDOWN, which is one
 * event on one element.
 */
describe('the table holds still while a hand is on it', () => {
  const four = [
    row({ id: 1, distance: 10 }),
    row({ id: 2, distance: 20 }),
    row({ id: 3, distance: 30 }),
    row({ id: 4, distance: 40 }),
  ];

  it('seals on the pointer entering, and holds every row in place', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    expect(sealed.sealed).toBe(true);
    expect(sealed.frozen).toEqual([1, 2, 3, 4]);
    expect(sealed.anchor).toBeNull();
  });

  /**
   * The defect itself, as arithmetic. Two beings leave the frame; the reader is
   * pressing on row 4. Frozen-only, row 4 becomes row 2 — a 48 px jump under a
   * pointer that has not moved. Sealed, it is still row 4.
   */
  it('does not slide a row up when a being ahead of it leaves the frame', () => {
    const inFrame = four.filter((r) => r.id === 3 || r.id === 4);
    const frozen = orderReduce(FREE_ORDER, { kind: 'pick', id: 4, order: [1, 2, 3, 4] });
    expect(indexOfRow(applyOrder(inFrame, frozen, four), 4)).toBe(1);
    const sealed = orderReduce(frozen, { kind: 'enter', order: [1, 2, 3, 4] });
    const held = applyOrder(inFrame, sealed, four);
    expect(held.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(indexOfRow(held, 4)).toBe(3);
  });

  it('holds through a re-sort the camera caused, which is the sort that moves under a hand', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    // Centring drives the picked being's distance to zero and a live sort takes
    // it to the top of three hundred rows.
    const moved = four.map((r) => (r.id === 3 ? row({ id: 3, distance: 0 }) : r));
    const resorted = sortRows(moved, { key: 'distance', dir: 1 });
    expect(resorted.map((r) => r.id)).toEqual([3, 1, 2, 4]);
    expect(applyOrder(resorted, sealed, moved).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('lets nothing NEW in either, so a row never appears under the cursor', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3] });
    const arrived = [...four, row({ id: 9, distance: 1 })];
    expect(applyOrder(sortRows(arrived, { key: 'distance', dir: 1 }), sealed, arrived).map((r) => r.id))
      .toEqual([1, 2, 3]);
  });

  it('drops a dead being only when nothing is remembering it', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    const alive = four.filter((r) => r.id !== 2);
    expect(applyOrder(alive, sealed, alive).map((r) => r.id)).toEqual([1, 3, 4]);
  });

  /**
   * Round five's LOW defect, and it is the same 24 px as the HIGH one.
   *
   * The reviewer rested the pointer on the table at 2400× for twelve seconds
   * and the rendered rows changed. Nothing stale was ever listed and the order
   * released correctly when he left — the dangerous half was handled — but
   * "stands still for as long as the pointer is on it" was not what he
   * measured, because at that speed beings die while a reader is aiming and
   * every death compacts the list upward under their hand.
   */
  it('marks a being that dies IN PLACE rather than closing the gap under a hand', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    const memory = new Map<number, RosterRow>();
    // The first pass is what fills the memory: these are the rows on screen.
    expect(applyOrder(four, sealed, four, memory).map((r) => r.id)).toEqual([1, 2, 3, 4]);
    const alive = four.filter((r) => r.id !== 2);
    const held = applyOrder(alive, sealed, alive, memory);
    expect(held.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(indexOfRow(held, 4)).toBe(3);
    expect(held[1]!.gone).toBe(true);
    expect(held[0]!.gone).toBeUndefined();
    // And the marked row keeps its identity across renders, so React does not
    // remount the row the pointer is resting on.
    expect(applyOrder(alive, sealed, alive, memory)[1]).toBe(held[1]);
  });

  it('keeps updating the VALUES in the rows that are still there', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    const memory = new Map<number, RosterRow>();
    applyOrder(four, sealed, four, memory);
    const moved = four.map((r) => (r.id === 3 ? row({ id: 3, distance: 999 }) : r));
    const held = applyOrder(moved, sealed, moved, memory);
    expect(held.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(held[2]!.distance).toBe(999);
  });

  /**
   * The 32-of-33, as arithmetic.
   *
   * The reviewer read `c-name|Wreniash` with `elementFromPoint`, pressed, and
   * got Fenush — both at index 4. The table re-sorted in the ~60 ms between
   * aiming and pressing, at 2400×, right after a pick had re-centred the
   * camera. The seal existed and it engaged a frame too late, in an effect.
   * `sealing` is that effect brought forward into the handler the press runs.
   */
  it('seals synchronously on a pick made with the pointer on the table', () => {
    const thawed = orderReduce(FREE_ORDER, { kind: 'sort' });
    expect(thawed.sealed).toBe(false);
    const sealed = orderReduce(thawed, { kind: 'pick', id: 7, order: [5, 6, 7, 8], sealing: true });
    expect(sealed.sealed).toBe(true);
    expect(sealed.frozen).toEqual([5, 6, 7, 8]);
    expect(sealed.anchor).toBe(7);
  });

  it('re-snapshots the order the PRESS saw, not the one a stale freeze held', () => {
    const stale = orderReduce(FREE_ORDER, { kind: 'pick', id: 1, order: [1, 2, 3, 4] });
    // The reader sorted by name; the table on screen is now a different order.
    const onScreen = [4, 3, 2, 1];
    const sealed = orderReduce(stale, { kind: 'pick', id: 3, order: onScreen, sealing: true });
    expect(sealed.frozen).toEqual(onScreen);
    expect(applyOrder(four, sealed, four).map((r) => r.id)).toEqual(onScreen);
  });

  it('leaves a pick made from the WORLD unsealed — the pointer is on the canvas', () => {
    const state = orderReduce(FREE_ORDER, { kind: 'pick', id: 3, order: [1, 2, 3, 4] });
    expect(state.sealed).toBe(false);
    expect(state.frozen).toEqual([1, 2, 3, 4]);
  });

  it('picking inside a seal keeps the seal, so the next click is on a still table', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    const first = orderReduce(sealed, { kind: 'pick', id: 2, order: [1, 2, 3, 4] });
    const second = orderReduce(first, { kind: 'pick', id: 4, order: [4, 3, 2, 1] });
    expect(second.sealed).toBe(true);
    expect(second.frozen).toEqual([1, 2, 3, 4]);
    expect(second.anchor).toBe(4);
  });

  it('thaws on the pointer leaving, unless a pick is holding a row', () => {
    const browsing = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    expect(orderReduce(browsing, { kind: 'leave' })).toBe(FREE_ORDER);
    const picked = orderReduce(browsing, { kind: 'pick', id: 2, order: [1, 2, 3, 4] });
    const left = orderReduce(picked, { kind: 'leave' });
    expect(left.sealed).toBe(false);
    expect(left.anchor).toBe(2); // the row somebody chose stays where they can see it
    expect(left.frozen).toEqual([1, 2, 3, 4]);
  });

  it('thaws for anything the reader deliberately asked for, seal and all', () => {
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2, 3, 4] });
    for (const kind of ['sort', 'scroll', 'filter', 'clear'] as const) {
      expect(orderReduce(sealed, { kind })).toBe(FREE_ORDER);
    }
  });

  it('does not seal an empty table, which would then never fill', () => {
    expect(orderReduce(FREE_ORDER, { kind: 'enter', order: [] })).toBe(FREE_ORDER);
  });

  it('is a no-op on a free table, so a pointer crossing it re-renders nothing twice', () => {
    expect(orderReduce(FREE_ORDER, { kind: 'leave' })).toBe(FREE_ORDER);
    const sealed = orderReduce(FREE_ORDER, { kind: 'enter', order: [1, 2] });
    expect(orderReduce(sealed, { kind: 'enter', order: [2, 1] })).toBe(sealed);
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

// ── What the view OFFERS is what the picker answers ──────────────────────────

/**
 * Three rounds ran a second geometry beside the picker — boxes, depth order, an
 * overlap fraction — and asked it "is anybody standing in front of this being".
 * It was wrong about four beings sharing one pixel in round six, two in a
 * hundred in round seven, and four in a hundred and forty-eight in round eight.
 * Each tightening left a smaller residue and never none, because two
 * implementations of one question is a bug with a maintenance schedule.
 *
 * `offerAudit` is not a better rule. It is the definition: a being is offered
 * if and only if the picker, asked at the point the view reports it at, hands
 * back that being. The test a reviewer runs is the rule the view is using, so a
 * mispick is not unlikely — it is not expressible.
 */
describe('a being is offered exactly when the picker returns it', () => {
  it('offers the being the picker returns, and nobody else', () => {
    const audit = offerAudit([
      { id: 1, first: 1 },
      { id: 2, first: 1 },
      { id: 3, first: 3 },
    ]);
    expect(audit.offered).toEqual([1, 3]);
    expect(audit.coveredBy.get(2)).toBe(1);
    expect(audit.coveredBy.has(1)).toBe(false);
  });

  it('does not offer a being the picker finds nothing at', () => {
    // The case no earlier rule had a word for: the view believes it drew
    // something there and the mouse lands on empty air. Round eight would have
    // offered it, because its cover rule only knew about other beings.
    const audit = offerAudit([{ id: 7, first: null }]);
    expect(audit.offered).toEqual([]);
    expect(audit.coveredBy.get(7)).toBeNull();
  });

  it('cannot produce a mispick, over four hundred random frames', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const next = rng(seed);
      const ids: number[] = [];
      for (let i = 0; i < 40; i++) ids.push(100 + i);
      // An arbitrary, adversarial picker: sometimes itself, sometimes a
      // neighbour, sometimes nothing at all.
      const first = (id: number): number | null => {
        const roll = next();
        return roll < 0.45 ? id : roll < 0.9 ? ids[Math.floor(next() * ids.length)]! : null;
      };
      const answers = ids.map((id) => ({ id, first: first(id) }));
      const audit = offerAudit(answers);
      const byId = new Map(answers.map((a) => [a.id, a.first]));
      // The whole property: every offered being is one the picker returns at
      // its own point, and every being the picker returns at its own point is
      // offered. No sampling, no threshold, no residue.
      for (const id of audit.offered) expect(byId.get(id)).toBe(id);
      for (const a of answers) expect(audit.offered.includes(a.id)).toBe(a.first === a.id);
      expect(audit.offered.length + audit.coveredBy.size).toBe(answers.length);
    }
  });

  it('names whoever the picker put there instead, so the reader can be sent to them', () => {
    // The reviewer's four: 1846 offered, 1977 picked. The view now says so
    // rather than offering 1846 and letting the mouse discover it.
    const audit = offerAudit([{ id: 1846, first: 1977 }, { id: 1977, first: 1977 }]);
    expect(audit.offered).toEqual([1977]);
    expect(audit.coveredBy.get(1846)).toBe(1977);
  });
});

// ── A being standing behind a being is not in the picture ────────────────────

// ── An offer has to hold for the length of a press ───────────────────────────

/**
 * Round five: 389 offered beings, 2 mispicks, and both of them hut occupants.
 *
 * The reviewer's own diagnosis, from `truth/f-claim1.json`: `visibleIds()`
 * offered id 2338 at (976, 603), and by the time the mouse arrived
 * `visibilityOf` said `coveredBy: 2359, reason: "behind another being"` — in a
 * PAUSED world with a settled camera. The probe and the picker agreed at every
 * instant. What moved was the idle animation.
 *
 * Three rules answer it, and they are tested here as the pure statements they
 * are: nothing animates while the world is paused (`figurePose` is read at a
 * frozen clock), the picker's box is built on the widest pose rather than the
 * drawn one, and an offer needs a margin.
 */
describe('the offered set holds still', () => {
  const ACTS = [ACT_IDLE, ACT_WALKING, ACT_WORKING, ACT_RESTING, ACT_SOCIAL, ACT_EATING, ACT_DRINKING, ACT_DANGER];

  it('bounds every pose the animation can reach, for every act and every stage', () => {
    for (const act of ACTS) {
      for (const stage of [STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]) {
        const stoop = stageForm(stage).stoop;
        const lying = act === ACT_RESTING;
        const box = figureSpread(poseLean(act, stoop), lying);
        for (let k = 0; k < 400; k++) {
          const phase = (k / 400) * 40;
          const drawn = figureSpread(figurePose(act, stoop, 1.75, phase).lean, lying);
          // A box narrower than the silhouette is a box the picker's ray
          // reaches outside of. It may be wider; it may never be narrower.
          expect(drawn).toBeLessThanOrEqual(box + 1e-9);
        }
      }
    }
  });

  it('is a CONSTANT for an act, so the box does not breathe while a reader aims', () => {
    for (const act of ACTS) {
      const a = poseLean(act, 0.62);
      const b = poseLean(act, 0.62);
      expect(a).toBe(b);
    }
    // And the swinging act, which is the one with a real amplitude, really is
    // bounded at the top of its swing rather than at its mean.
    const swinging = poseLean(ACT_WORKING, 0);
    expect(swinging).toBeGreaterThan(0.5);
    expect(swinging).toBeCloseTo(0.52, 2);
  });

  it('freezes the pose when the clock does not move', () => {
    const still = figurePose(ACT_WORKING, 0, 1.75, 12.5);
    expect(figurePose(ACT_WORKING, 0, 1.75, 12.5)).toEqual(still);
  });

  it('refuses an offer whose winner changes within a couple of pixels', () => {
    expect(steadyWinner([2338, 2338, 2338, 2338, 2338])).toBe(2338);
    // The reviewer's own case: itself at the exact point, the neighbour two
    // pixels away. Not offered at all, rather than offered and then wrong.
    expect(steadyWinner([2338, 2338, 2359, 2338, 2338])).toBeNull();
    expect(steadyWinner([2338, null, 2338, 2338, 2338])).toBeNull();
    expect(steadyWinner([null, null, null, null, null])).toBeNull();
    expect(steadyWinner([])).toBeNull();
  });

  it('measures the margin in pixels a hand actually moves', () => {
    expect(OFFER_MARGIN_PX).toBeGreaterThanOrEqual(2);
  });

  /**
   * The occupants of a shelter have had their rings, badges, arrows and names
   * taken off so the hut is not a scribble, and one number on the roof stands
   * for all of them. Offering them under the pointer as well is two
   * contradictory promises at once — and both of round five's mispicks were
   * beings the chip was already speaking for.
   */
  it('offers a shelter s occupants through their chip and not under the pointer', () => {
    expect(offeredUnderPointer(null)).toBe(true);
    expect(offeredUnderPointer(0)).toBe(false);
    expect(offeredUnderPointer(7)).toBe(false);
  });
});

// ── The unwell are not withheld in silence ───────────────────────────────────

/**
 * Round five, the blind reading: four fresh frames, seven unwell beings among
 * them, and the reviewer wrote "everyone is well" on all four. Some of those
 * seven were inside shelters, which the view is entitled to withhold — but
 * nothing in the frame said which, and a frame that withholds in silence has
 * told the reader something false.
 *
 * The naming rule already prints its own exception out loud. This is the same
 * sentence, for the same reason.
 */
describe('the strip counts the unwell it is withholding', () => {
  it('says how many of the people on their huts are not well', () => {
    const claim = nameClaimFor('near', 12.34, 5, 55, 7);
    expect(claim).toContain('55 indoors, counted on their roofs');
    expect(claim).toContain('7 of them unwell');
  });

  it('says nothing when there is nothing to say', () => {
    expect(nameClaimFor('near', 12.34, 5, 55, 0)).not.toContain('unwell');
    expect(nameClaimFor('near', 12.34, 5, 0, 0)).toBe('5 named · nearest first · out to 12.34 m');
  });

  it('prints it at MID too, where most of a settlement is on a chip', () => {
    expect(nameClaimFor('mid', 200, 10, 55, 4)).toContain('4 of them unwell');
  });

  it('keeps the clause even when nobody is named at all', () => {
    expect(nameClaimFor('near', 0, 0, 12, 2))
      .toBe('0 named · nearest first · 12 indoors, counted on their roofs · 2 of them unwell');
  });
});
