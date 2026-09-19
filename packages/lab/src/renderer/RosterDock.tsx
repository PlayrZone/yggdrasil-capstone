import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVITY_OPTIONS,
  CONDITION_OPTIONS,
  STAGE_OPTIONS,
  chipCount,
  countMatches,
  describeCount,
  filterRows,
  isEmptyFilter,
  toggleActivity,
  toggleCondition,
  toggleStage,
  withText,
  type FilterState,
} from './filters.js';
import {
  applyOrder,
  FREE_ORDER,
  indexOfRow,
  moveFocus,
  nextSort,
  orderReduce,
  scrollToRow,
  sortRows,
  windowFor,
  type OrderState,
  type RosterRow,
  type Sort,
  type SortKey,
} from './roster.js';

/**
 * The roster — every being as a row, docked under the world.
 *
 * It is here because reading three hundred beings off a picture does not work
 * and never will. Rerun, Foxglove and every agent-based-model viewer worth the
 * name answer questions the same way: a linked table beside the scene, brushed
 * both directions, with a filter that drives both. Hovering a row lights the
 * being; hovering the being scrolls to the row; clicking either selects and
 * centres. The picture stops having to carry what a table carries better.
 *
 * It is virtualized and it is fed at 4 Hz. Three hundred and twenty rows of
 * seven columns and two bars, re-rendered on every sim frame, is the long task
 * this whole item is forbidden from introducing.
 */

/** Row height in pixels — the one number the windowing maths and the CSS share. */
const ROW_H = 24;

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'name', className: 'c-name' },
  { key: 'stage', label: 'stage', className: 'c-stage' },
  { key: 'condition', label: 'condition', className: 'c-cond' },
  { key: 'activity', label: 'activity', className: 'c-act' },
  { key: 'heading', label: 'facing', className: 'c-head' },
  { key: 'hunger', label: 'hunger', className: 'c-need' },
  { key: 'rest', label: 'rest', className: 'c-need' },
  { key: 'distance', label: 'distance', className: 'c-dist' },
];

function Bar({ value }: { value: number }): React.ReactElement {
  const tone = value >= 85 ? '#e0524d' : value >= 60 ? '#e09a3a' : '#43d18a';
  return (
    <span className="rbar" title={`${value} of 100`}>
      <i style={{ width: `${Math.max(2, value)}%`, background: tone }} />
    </span>
  );
}

function Chip<T>({
  on, label, onClick,
}: { on: boolean; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className={on ? 'fchip on' : 'fchip'} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

export function RosterDock({
  rows,
  filter,
  onFilter,
  brushId,
  brushFromWorld,
  onHoverRow,
  onLeave,
  selectedId,
  onPick,
  open,
  onOpen,
}: {
  rows: RosterRow[];
  filter: FilterState;
  onFilter: (next: FilterState) => void;
  /** The being the pointer is on, wherever the pointer is. */
  brushId: number | null;
  /** True while the CANVAS owns the brush — the only case the table scrolls itself. */
  brushFromWorld: boolean;
  onHoverRow: (id: number) => void;
  onLeave: () => void;
  selectedId: number | null;
  onPick: (id: number) => void;
  open: boolean;
  onOpen: (next: boolean) => void;
}): React.ReactElement {
  const [sort, setSort] = useState<Sort>({ key: 'distance', dir: 1 });
  const [inFrameOnly, setInFrameOnly] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [focus, setFocus] = useState(-1);
  const body = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(180);
  // The order holds still while a row is being read. See `orderReduce`.
  const [order, setOrder] = useState<OrderState>(FREE_ORDER);
  /** Set while THIS component scrolls the table, so it does not thaw its own freeze. */
  const selfScroll = useRef(false);

  const scoped = useMemo(() => (inFrameOnly ? rows.filter((r) => r.inFrame) : rows), [rows, inFrameOnly]);
  const count = useMemo(() => countMatches(rows, filter), [rows, filter]);
  const sorted = useMemo(() => sortRows(filterRows(scoped, filter), sort), [scoped, filter, sort]);
  // `rows` — every being, not the scoped slice — is what a SEALED order looks
  // its frozen ids up in, so a being walking out of frame cannot pull the row
  // under the pointer up by twenty-four pixels mid-click. See `applyOrder`.
  const shown = useMemo(() => applyOrder(sorted, order, rows), [sorted, order, rows]);
  const win = useMemo(
    () => windowFor(scrollTop, viewportH, ROW_H, shown.length),
    [scrollTop, viewportH, shown.length],
  );
  const shownRef = useRef(shown);
  useEffect(() => { shownRef.current = shown; }, [shown]);

  // A new question is a new table: the freeze exists to stop a row moving under
  // the reader, not to outlive what they were reading.
  useEffect(() => { setOrder((o) => orderReduce(o, { kind: 'filter' })); }, [filter, inFrameOnly]);
  // Clicking a being in the WORLD centres the camera just as a row click does,
  // so it freezes the order too — otherwise the being you just clicked is the
  // one row that moves.
  useEffect(() => {
    setOrder((o) => (selectedId === null
      ? orderReduce(o, { kind: 'clear' })
      : orderReduce(o, { kind: 'pick', id: selectedId, order: shownRef.current.map((r) => r.id) })));
  }, [selectedId]);

  /** Pick a row, and hold the order it was picked in. */
  const pick = useCallback(
    (id: number) => {
      setOrder((o) => orderReduce(o, { kind: 'pick', id, order: shownRef.current.map((r) => r.id) }));
      onPick(id);
    },
    [onPick],
  );

  // The pointer being over the table is what seals it. Sealing on ENTER rather
  // than on the first press is deliberate: the press is already too late — the
  // row has to have been standing still since before the reader aimed at it.
  const [pointerIn, setPointerIn] = useState(false);
  const enter = useCallback(() => setPointerIn(true), []);
  const leave = useCallback(() => {
    setPointerIn(false);
    setOrder((o) => orderReduce(o, { kind: 'leave' }));
    onLeave();
  }, [onLeave]);
  // Re-sealed after anything the reader asked for — a header, a scroll, a new
  // question — thaws it, on whatever order that request produced. The table
  // re-sorts once, deliberately, and then stands still again for as long as the
  // pointer is on it.
  useEffect(() => {
    if (!pointerIn || order.sealed) return;
    setOrder((o) => orderReduce(o, { kind: 'enter', order: shownRef.current.map((r) => r.id) }));
  }, [pointerIn, order, shown]);

  // The selected row stays where the reader can see it — the other half of
  // freezing the order. A selection made from the WORLD scrolls the table to
  // it too; the pointer is on the canvas, so nothing moves under it.
  useEffect(() => {
    const el = body.current;
    if (!el || selectedId === null) return;
    const at = indexOfRow(shownRef.current, selectedId);
    const next = scrollToRow(at, el.scrollTop, el.clientHeight, ROW_H);
    if (next === null) return;
    selfScroll.current = true;
    el.scrollTop = next;
  }, [selectedId, order]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, [open]);

  // Brushing, the other way round: the canvas says who the pointer is on and
  // the table brings that row into view. Only when the CANVAS owns the brush —
  // scrolling the table under the pointer that is hovering it makes a table
  // that runs away from the mouse.
  useEffect(() => {
    const el = body.current;
    if (!el || !brushFromWorld || brushId === null) return;
    const at = indexOfRow(shown, brushId);
    const next = scrollToRow(at, el.scrollTop, el.clientHeight, ROW_H);
    if (next === null) return;
    selfScroll.current = true;
    el.scrollTop = next;
  }, [brushId, brushFromWorld, shown]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = moveFocus(focus, shown.length, e.key === 'ArrowDown' ? 1 : -1);
        setFocus(next);
        const row = shown[next];
        if (row) {
          onHoverRow(row.id);
          const el = body.current;
          if (el) {
            const to = scrollToRow(next, el.scrollTop, el.clientHeight, ROW_H);
            if (to !== null) el.scrollTop = to;
          }
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const row = shown[focus];
        if (row) {
          e.preventDefault();
          pick(row.id);
        }
        return;
      }
      if (e.key === 'Escape' && !isEmptyFilter(filter)) {
        e.preventDefault();
        onFilter({ stages: [], conditions: [], activities: [], text: '' });
      }
    },
    [focus, shown, onHoverRow, pick, filter, onFilter],
  );

  const lit = chipCount(filter);

  if (!open) {
    return (
      <div className="roster closed">
        <button type="button" className="rtoggle" onClick={() => onOpen(true)} aria-expanded={false}>
          Roster
          <span>{describeCount(count)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="roster" onPointerEnter={enter} onPointerLeave={leave}>
      <div className="rbar-top">
        <button type="button" className="rtoggle" onClick={() => onOpen(false)} aria-expanded>
          Roster
        </button>
        <div className="fgroup" role="group" aria-label="life stage">
          {STAGE_OPTIONS.map((o) => (
            <Chip key={o.value} on={filter.stages.includes(o.value)} label={o.label} onClick={() => onFilter(toggleStage(filter, o.value))} />
          ))}
        </div>
        <div className="fgroup" role="group" aria-label="condition">
          {CONDITION_OPTIONS.map((o) => (
            <Chip key={o.value} on={filter.conditions.includes(o.value)} label={o.label} onClick={() => onFilter(toggleCondition(filter, o.value))} />
          ))}
        </div>
        <div className="fgroup wrap" role="group" aria-label="activity">
          {ACTIVITY_OPTIONS.map((o) => (
            <Chip key={o.value} on={filter.activities.includes(o.value)} label={o.label} onClick={() => onFilter(toggleActivity(filter, o.value))} />
          ))}
        </div>
        <input
          className="fsearch"
          value={filter.text}
          placeholder="name…"
          aria-label="search by name"
          onChange={(e) => onFilter(withText(filter, e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Escape') onFilter(withText(filter, '')); }}
        />
        <span className={count.filtering && count.matched === 0 ? 'fcount none' : 'fcount'}>{describeCount(count)}</span>
        {lit > 0 && (
          <button type="button" className="fclear" onClick={() => onFilter({ stages: [], conditions: [], activities: [], text: '' })}>
            Clear {lit}
          </button>
        )}
        <label className="fscope">
          <input type="checkbox" checked={inFrameOnly} onChange={(e) => setInFrameOnly(e.target.checked)} />
          in frame
        </label>
      </div>

      <div className="rhead" role="row">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="columnheader"
            className={`${c.className}${sort.key === c.key ? ' sorted' : ''}`}
            aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => {
              // Asking for an order is the one thing that thaws a frozen one.
              setOrder((o) => orderReduce(o, { kind: 'sort' }));
              setSort((s) => nextSort(s, c.key));
            }}
          >
            {c.label}
            {sort.key === c.key && <i>{sort.dir === 1 ? '▲' : '▼'}</i>}
          </button>
        ))}
      </div>

      <div
        className="rbody"
        ref={body}
        tabIndex={0}
        role="grid"
        aria-rowcount={shown.length}
        onKeyDown={onKey}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          // The reader scrolling is the reader done with the row they froze;
          // the table scrolling itself to show them that row is not.
          if (selfScroll.current) selfScroll.current = false;
          else setOrder((o) => orderReduce(o, { kind: 'scroll' }));
        }}
      >
        {shown.length === 0 ? (
          <p className="rempty">
            {count.filtering
              ? 'No being answers that. Drop a chip, or clear the filter.'
              : inFrameOnly
                ? 'Nobody is in frame. Pull back, or untick “in frame”.'
                : 'No beings yet — the world is still being built.'}
          </p>
        ) : (
          <>
            <div style={{ height: win.padTop }} />
            {shown.slice(win.start, win.end).map((r, k) => {
              const at = win.start + k;
              const cls = `rrow${r.id === selectedId ? ' sel' : ''}${r.id === brushId ? ' brush' : ''}${at === focus ? ' focus' : ''}`;
              return (
                <div
                  key={r.id}
                  className={cls}
                  role="row"
                  aria-rowindex={at + 1}
                  aria-selected={r.id === selectedId}
                  onMouseEnter={() => { setFocus(at); onHoverRow(r.id); }}
                  // POINTERDOWN, not click. A `click` is only dispatched on the
                  // element that saw both the press and the release, and on
                  // anything else it lands on their common ancestor — this
                  // table body, which selects nobody. A row is picked the
                  // instant the reader presses it, on the row they pressed.
                  onPointerDown={(e) => { if (e.button === 0) pick(r.id); }}
                >
                  <span className={`c-name${r.selfChosen ? ' named' : ''}`}>{r.name}</span>
                  <span className="c-stage">{r.stageWord}</span>
                  <span className={`c-cond c-${r.condWord.replace(/\s+/g, '-')}`}>{r.condWord}</span>
                  <span className="c-act">{r.actWord}</span>
                  <span className="c-head">{r.headingWord}</span>
                  <span className="c-need"><Bar value={r.hunger} /></span>
                  <span className="c-need"><Bar value={r.rest} /></span>
                  <span className="c-dist">{r.distance < 1000 ? `${r.distance.toFixed(0)} m` : `${(r.distance / 1000).toFixed(1)} km`}</span>
                </div>
              );
            })}
            <div style={{ height: win.padBottom }} />
          </>
        )}
      </div>
    </div>
  );
}
