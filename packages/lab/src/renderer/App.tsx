import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimClient, type SimFault } from './sim/client.js';
import { SPEED_PRESETS, type SpeedPreset } from './sim/presets.js';
import type { AgentDetail, FeedItem, QueryRequest, QueryResults, StatsMessage, WorldMessage } from './sim/protocol.js';
import { World3D } from './World3D.js';
import { Legend } from './Legend.js';
import { ActivityView } from './ActivityView.js';
import { ReportsView } from './ReportsView.js';
import { AnalysisView } from './AnalysisView.js';
import { SocietyView } from './SocietyView.js';
import { CultureView } from './CultureView.js';
import { displayName, nextFrameAt, targetFps, type ZoomBand } from './beings.js';
import { ChipCard, HoverCard, type HoverCardData } from './HoverCard.js';
import { RosterDock } from './RosterDock.js';
import {
  countMatches,
  emptyFilter,
  matchesFilter,
  isEmptyFilter,
  type FilterState,
} from './filters.js';
import { brushReduce, NO_BRUSH, shouldScrollToBrush, type Brush } from './roster.js';
import type { RosterRow } from './roster.js';
import { cycleCandidate, type PickCandidate } from './crowd.js';
import { isSpecimenId } from './legibility.js';

type Tab = 'world' | 'activity' | 'analysis' | 'society' | 'culture' | 'reports';

const FEED_CAP = 50;

/**
 * Whether two pick results name the same beings in the same order.
 *
 * The canvas re-picks a dozen times a second while the pointer moves, and over
 * a settlement it returns the same four beings nearly every time. Replacing the
 * array anyway would re-render the card, the disambiguation list and the key
 * binding on every one of those — for a list that has not changed.
 */
/**
 * How long a shelter's card survives the pointer leaving the chip.
 *
 * Long enough for a hand to travel the eighteen pixels from the number to the
 * list of names under it, and no longer. The card is the only way to reach the
 * people that chip is speaking for; a card that closes on the way to it is a
 * dead end with a list in it.
 */
const CHIP_CARD_GRACE_MS = 320;

function sameIds(a: readonly PickCandidate[], b: readonly PickCandidate[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.id !== b[i]!.id) return false;
  return true;
}

/**
 * Poll one of the worker's heavy read-outs while its tab is open. Never two in
 * flight at once, never computed on this thread, and never at all while nobody
 * is looking at it.
 */
function usePolled<K extends 'analysis' | 'society' | 'culture'>(
  client: SimClient,
  active: boolean,
  name: K,
  intervalMs: number,
): QueryResults[K] | null {
  const [value, setValue] = useState<QueryResults[K] | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let inFlight = false;
    const run = (): void => {
      if (inFlight) return;
      inFlight = true;
      // `{ name }` is a QueryRequest by construction; TS can't narrow a generic
      // key to its union member on its own.
      void client.query({ name } as QueryRequest).then(
        (result) => {
          inFlight = false;
          if (live) setValue(result as QueryResults[K]);
        },
        () => {
          inFlight = false; // no world to ask; the next tick tries again
        },
      );
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [client, active, name, intervalMs]);
  return value;
}

/**
 * The speed read-out. A preset is a promise about wall-clock time per sim day,
 * and a saturated CPU cannot keep it, so when the sim is well off the rate the
 * button sells, both numbers are shown.
 *
 * It appears at a 14% miss and disappears again only below 6%. A single
 * threshold puts every world that runs near its limit on the boundary, where
 * the warning flickers on and off several times a second — which reads as a
 * broken interface rather than as a world under load, and is the fastest way to
 * teach someone to ignore a true warning. The gap between the two numbers is
 * the hysteresis; the worker's own averaging does the rest.
 */
const SHOW_MISS = 0.14;
const HIDE_MISS = 0.06;

function SpeedLabel({ client, preset, running }: { client: SimClient; preset: SpeedPreset; running: boolean }): React.ReactElement {
  const [achieved, setAchieved] = useState(0);
  const [off, setOff] = useState(false);
  const offRef = useRef(false);
  useEffect(() => {
    offRef.current = false;
    setOff(false);
  }, [preset.mult]);
  // A paused world achieves nothing, and saying so is not a warning about the
  // machine — it is a warning about the pause button, which the reader just
  // pressed. Round one printed "2400× asked · 0× achieved" over a stopped sim.
  useEffect(() => {
    if (running) return;
    offRef.current = false;
    setOff(false);
  }, [running]);
  useEffect(
    () =>
      client.onStats((s) => {
        // Coarse so the label does not churn, and so this component re-renders
        // far less often than the 4 Hz it is fed at.
        const rounded = s.achievedMult >= 100 ? Math.round(s.achievedMult / 10) * 10 : Math.round(s.achievedMult * 10) / 10;
        setAchieved((prev) => (prev === rounded ? prev : rounded));
        if (!running) return; // a stopped world is not a world falling behind
        if (s.achievedMult <= 0) return; // no measurement yet — say nothing
        const miss = Math.abs(s.achievedMult - preset.mult) / preset.mult;
        const next = offRef.current ? miss > HIDE_MISS : miss > SHOW_MISS;
        if (next !== offRef.current) {
          offRef.current = next;
          setOff(next);
        }
      }),
    [client, preset.mult, running],
  );
  return (
    <label>
      Speed — {preset.rate}
      {/* Guarded at the render, not only at the listener: a stats tick that
          crosses a pause click can still set the flag, and a stopped world
          that reports "0× achieved" is a warning about nothing. */}
      {running && off && <span className="achieved"> · {preset.mult}× asked · {achieved}× achieved</span>}
    </label>
  );
}

/**
 * The counters. Subscribes on its own so a stats tick never re-renders the
 * canvas — and memoized, so the roster's own 4 Hz refresh of the shell does not
 * re-render IT either.
 */
const LiveStats = React.memo(function LiveStats({ client }: { client: SimClient }): React.ReactElement | null {
  const [stats, setStats] = useState<StatsMessage | null>(null);
  useEffect(() => client.onStats(setStats), [client]);
  if (!stats) return null;
  return (
    <section className="stats">
      <div className="big">
        <div><b>{stats.alive}</b><span>/ {stats.total} alive</span></div>
        <div><b>Day {stats.day}</b><span>{stats.pending > 0 ? `${stats.pending} thinking` : 'reflex idle'}</span></div>
        <div><b>{stats.knowledge}</b><span>knowledge</span></div>
      </div>
      <div className="mind">mind: {stats.backend}</div>
      <table><tbody>
        <tr><td>Exchanges</td><td>{stats.exchanges}</td><td>Conflicts</td><td>{stats.conflicts}</td></tr>
        <tr><td>Sickness</td><td>{stats.sickness}</td><td>Shares</td><td>{stats.shares}</td></tr>
        <tr><td>Seeds sown</td><td>{stats.seedPlants}</td><td>Sprouts</td><td>{stats.sprouts}</td></tr>
        <tr><td>Builds</td><td>{stats.builds}</td><td>Deaths</td><td>{stats.deaths}</td></tr>
      </tbody></table>
    </section>
  );
});

/**
 * What they're doing & saying — a bounded tail, newest first, appended from
 * each stats tick.
 *
 * Rows are keyed by the line's own `seq`, and the two shapes a line can take
 * carry different keys. With index keys (and one `<span>` morphing between
 * `<b>…</b>: “text”` and plain text) React rewrites every row on every tick and
 * eventually commits a deletion against a parent that no longer holds the node:
 * `NotFoundError: Failed to execute 'removeChild'`, which takes the whole app
 * down. That is a pre-existing fault — HEAD reproduces it on a tab switch after
 * ~10 s of running — not something the worker introduced.
 */
const LiveFeed = React.memo(function LiveFeed({ client }: { client: SimClient }): React.ReactElement | null {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  useEffect(() => client.onWorld(() => setFeed([])), [client]); // a new world starts a new log
  useEffect(
    () =>
      client.onStats((s) => {
        if (s.newFeed.length === 0) return;
        setFeed((prev) => {
          const next = prev.slice();
          for (let i = s.newFeed.length - 1; i >= 0; i--) next.unshift(s.newFeed[i]!);
          return next.length > FEED_CAP ? next.slice(0, FEED_CAP) : next;
        });
      }),
    [client],
  );
  if (feed.length === 0) return null;
  return (
    <section className="feed">
      <label>What they're doing &amp; saying</label>
      <ul>
        {feed.map((e) => {
          // The same being is the same word everywhere in this renderer — in
          // the world, in the selection bar, in the inspector and here.
          const who = displayName(e.whoId, e.who).text;
          return (
            <li key={e.seq} className={e.kind}>
              <span className="t">d{e.day}</span>{' '}
              {e.kind === 'speech'
                ? <span key="speech"><b>{who}</b>: “{e.text}”</span>
                : <span key="event" className="ev">{who} · {e.text}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
});

/**
 * A selected SPECIMEN, in the inspector's own frame.
 *
 * The legibility specimen is display-only: it is drawn, hovered, filtered,
 * listed and selected exactly like a being, and the sim has never heard of it.
 * Round two's find → inspect loop landed the camera and the gold ring on the
 * right specimen and then showed an empty panel, which is the one place the
 * rare combinations live. So it answers here instead — from `hoverCardFor`,
 * the same read-out the hover card is built from, so the two can never
 * disagree — and says outright what it is rather than passing for a life.
 */
function SpecimenCard({ card, boxRef, onClose }: {
  card: HoverCardData;
  boxRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}): React.ReactElement {
  const name = displayName(card.id, undefined);
  const needs: [string, number][] = [['hunger', card.hunger], ['rest', card.rest]];
  return (
    <div className="inspector" ref={boxRef}>
      <div className="ihead">
        <b>{name.text}</b>
        <span>specimen — not in the simulation</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="ispec">
        <div className="srow"><span>stage</span><b>{card.stage}</b></div>
        <div className="srow"><span>condition</span><b>{card.condition}</b></div>
        <div className="srow"><span>doing</span><b>{card.activity}</b></div>
        <div className="srow"><span>facing</span><b>{card.heading}</b></div>
      </div>
      <div className="ineeds">
        {needs.map(([k, v]) => (
          <div key={k} className="nrow"><span>{k}</span><span className="nbar"><i style={{ width: `${v}%`, background: v >= 75 ? '#e0524d' : v >= 50 ? '#e09a3a' : '#43d18a' }} /></span></div>
        ))}
      </div>
      <div className="iknow">
        <label>Why there is nothing else here</label>
        <ul>
          <li className="empty">
            A specimen is a drawn example of everything the view encodes — every stage, condition,
            activity and heading, including combinations a young world may not contain. It has no
            life in the simulation, so it has learned nothing and can be given no thought.
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * The selected being. Its own subscriber, so the stats cadence never touches it.
 *
 * It reports its own width up to the world view, which aims the camera clear of
 * it: a panel that opens because you clicked a being must not then be sitting
 * on that being.
 */
const Inspector = React.memo(function Inspector(
  { client, specimen, onClose, onWidth }:
  { client: SimClient; specimen: HoverCardData | null; onClose: () => void; onWidth: (px: number) => void },
): React.ReactElement | null {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => client.onDetail(setDetail), [client]);
  const open = detail !== null || specimen !== null;
  useEffect(() => {
    const el = box.current;
    onWidth(open && el ? el.offsetWidth + 28 : 0);
    return () => onWidth(0);
  }, [open, onWidth]);
  // A specimen being is drawn, hoverable, filterable and on the roster, and it
  // is not in the simulation — so `client.select` has nothing to answer with.
  // The rare combinations only exist here (an elder speaking, a starving child,
  // somebody fleeing), which made this exactly where find → inspect broke. The
  // card is built from the same read-out the hover card uses, and says plainly
  // what it is.
  if (specimen) return <SpecimenCard card={specimen} boxRef={box} onClose={onClose} />;
  if (!detail) return null;
  const name = displayName(detail.id, detail.name);
  return (
    <div className="inspector" ref={box}>
      <div className="ihead">
        <b>{name.text}</b>
        <span>{detail.alive ? detail.region : 'dead'}{detail.archetype ? ` · ${detail.archetype}` : ''}</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="ineeds">
        {Object.entries(detail.needs).map(([k, v]) => (
          <div key={k} className="nrow"><span>{k}</span><span className="nbar"><i style={{ width: `${v}%`, background: v >= 75 ? '#e0524d' : v >= 50 ? '#e09a3a' : '#43d18a' }} /></span></div>
        ))}
      </div>
      <div className="iknow">
        <label>What {name.text} has learned ({detail.knowledge.length})</label>
        <ul>
          {detail.knowledge.slice(0, 12).map((k, i) => (
            <li key={i}>{k.statement} <em>{Math.round(k.confidence * 100)}%</em></li>
          ))}
          {detail.knowledge.length === 0 && <li className="empty">nothing learned yet</li>}
        </ul>
      </div>
    </div>
  );
});

export function App(): React.ReactElement {
  const [client] = useState(() => new SimClient());
  const world3dRef = useRef<World3D | null>(null);
  const worldPayloadRef = useRef<WorldMessage | null>(null);
  const tabRef = useRef<Tab>('world');
  const hiddenRef = useRef({ beings: 0, wildlife: 0 });
  const bandRef = useRef<ZoomBand>('default');
  /** The draw loop reads this rather than closing over `running`. */
  const runningRef = useRef(false);

  const [tab, setTab] = useState<Tab>('world');
  const [seed, setSeed] = useState('genesis-01');
  const [agentCount, setAgentCount] = useState(150);
  const [speedIdx, setSpeedIdx] = useState(3); // 30× (4 min/day) — motion is clearly visible; 1× stays for calm watching
  const [running, setRunning] = useState(false);
  const [idea, setIdea] = useState('');
  const [version, setVersion] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');
  const [llm, setLlm] = useState<{ hasKey: boolean; model: string }>({ hasKey: false, model: '' });
  const [keyInput, setKeyInput] = useState('');
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [notDrawn, setNotDrawn] = useState({ beings: 0, wildlife: 0 });
  const [fault, setFault] = useState<SimFault | null>(null);
  const [following, setFollowing] = useState(false);
  const [tiesOn, setTiesOn] = useState(false);
  const [band, setBand] = useState<ZoomBand>('default');

  // ── Comprehension by interaction (item L4) ─────────────────────────────────
  //
  // The picture no longer tries to answer "what is THIS one doing" by drawing a
  // mark small enough to be mistaken for the neighbour's. Four things answer it
  // instead, and they all read the same state: a hover card, a linked roster, a
  // filter that emphasises rather than hides, and a summary on every crowd.
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [brush, setBrush] = useState<Brush>(NO_BRUSH);
  const [candidates, setCandidates] = useState<PickCandidate[]>([]);
  const [pointerAt, setPointerAt] = useState({ x: 0, y: 0 });
  const [card, setCard] = useState<HoverCardData | null>(null);
  /**
   * Where the frame's other offered beings are, so an open card can miss them.
   *
   * Taken once, when the card opens, rather than per frame: the card is only up
   * while the pointer is still, and re-measuring the whole offered set sixty
   * times a second to place one tooltip would be the most expensive thing in
   * the frame.
   */
  const [offeredPoints, setOfferedPoints] = useState<{ x: number; y: number }[]>([]);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [chip, setChip] = useState<{ cluster: number; x: number; y: number } | null>(null);
  const [chipSum, setChipSum] = useState<ReturnType<World3D['chipSummary']>>(null);
  /** The selected specimen, if the selection is one — see `SpecimenCard`. */
  const [specimenId, setSpecimenId] = useState<number | null>(null);
  const [specimenCard, setSpecimenCard] = useState<HoverCardData | null>(null);
  const specimenRef = useRef<number | null>(null);
  const filterRef = useRef(filter);
  const rowsRef = useRef(rows);
  const brushRef = useRef(brush);
  const candRef = useRef(candidates);
  const chipRef = useRef<number | null>(null);
  /** The pending close of a chip's card — see `onChip`. */
  const chipClose = useRef<number | null>(null);

  const analysis = usePolled(client, tab === 'analysis', 'analysis', 2500);
  const society = usePolled(client, tab === 'society', 'society', 3000);
  const culture = usePolled(client, tab === 'culture', 'culture', 3500);

  useEffect(() => () => client.dispose(), [client]);

  /**
   * Choosing a being — the ONE route, whether the click came from the picture,
   * the roster or a driver.
   *
   * A specimen id is a display-only id: sending it to the sim asks a question
   * the sim cannot answer, and round two's selection therefore lit up the world
   * and left the inspector empty. So the two cases are split once, here, and
   * both of them end with something selected.
   */
  const chooseBeing = useCallback(
    (id: number | null) => {
      const spec = id !== null && isSpecimenId(id);
      setSpecimenId(spec ? id : null);
      specimenRef.current = spec ? id : null;
      if (!spec) setSpecimenCard(null);
      else setSpecimenCard(world3dRef.current?.hoverCardFor(id) ?? null);
      client.select(spec ? null : id);
    },
    [client],
  );

  // Callback ref: spin up / tear down the WebGL world with the canvas element.
  const canvasCb = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (el) {
        const world = new World3D(
          el,
          (id) => {
            chooseBeing(id);
            if (id === null) {
              setFollowing(false);
              setTiesOn(false);
            }
          },
          {
            // The view reports EVERY being under the cursor and decides
            // nothing. Which one the card describes — and which one the view
            // then highlights — is one piece of state, held here, so the two
            // can never disagree.
            onHover: (cands, x, y) => {
              setCandidates((prev) => (sameIds(prev, cands) ? prev : cands));
              if (cands.length > 0) {
                setPointerAt({ x, y });
                // `aimPoints`, not `visibleIds`: the latter is defined by the
                // picker and costs a raycast per candidate, and asking it on
                // every pointer move stalled the whole view. See `aimPoints`.
                const under = new Set(cands.map((c) => c.id));
                setOfferedPoints((world3dRef.current?.aimPoints() ?? []).filter((p) => !under.has(p.id)));
              }
              setBrush((b) => brushReduce(b, { kind: 'world-hover', id: cands[0]?.id ?? null }));
            },
            // A shelter's chip is the ONLY route to the people it is speaking
            // for — they are not offered under the pointer at all — so the card
            // it opens has to survive the pointer travelling to it. Closing on
            // the chip's own `pointerleave` made the names unreachable: the
            // list unmounted between the reader seeing a name and pressing it,
            // measured as a click that selected nobody. The close is deferred,
            // and the card cancels it by taking the pointer.
            onChip: (cluster, x, y) => {
              if (chipClose.current !== null) { clearTimeout(chipClose.current); chipClose.current = null; }
              if (cluster === null) chipClose.current = window.setTimeout(() => setChip(null), CHIP_CARD_GRACE_MS);
              else setChip({ cluster, x, y });
            },
            onChipClick: (cluster) => world3dRef.current?.zoomToCluster(cluster),
          },
        );
        world3dRef.current = world;
        world.setRunning(runningRef.current);
        // A read-only handle for drivers and reviewers: what the view drew, so a
        // screenshot can be scored against the ground truth behind it.
        window.__ygg = {
          // Before anything else here means anything: is this renderer WELL?
          // A shader that never compiled shipped for four rounds because the
          // three ways a WebGL view breaks are all silent to `pageerror`.
          health: () => world.healthReport(),
          // Which instanced meshes three may still drop on a stale bounding
          // sphere — the round-five defect, asked directly. See `cullAudit`.
          cullAudit: () => world.cullAudit(),
          aimPoints: () => world.aimPoints(),
          drawnIds: () => world.drawnIds(),
          visibleIds: () => world.visibleIds(),
          visibilityOf: (id) => world.visibilityOf(id),
          screenPositionOf: (id) => world.screenPositionOf(id),
          markScreenPositionOf: (id) => world.markScreenPositionOf(id),
          bodyScreenPositionOf: (id) => world.bodyScreenPositionOf(id),
          worldPositionOf: (id) => world.worldPositionOf(id),
          stateOf: (id) => world.stateOf(id),
          stageOf: (id) => world.stageOf(id),
          conditionOf: (id) => world.conditionOf(id),
          activityOf: (id) => world.activityOf(id),
          headingOf: (id) => world.headingOf(id),
          headingOnScreen: (id) => world.headingOnScreen(id),
          headingCheck: (id, said) => world.headingCheck(id, said),
          nameOf: (id) => world.nameOf(id),
          labelsShown: () => world.labelsShown(),
          labelAudit: () => world.labelAudit(),
          clustersShown: () => world.clustersShown(),
          structuresShown: () => world.structuresShown(),
          countAudit: () => world.countAudit(),
          frameCandidates: (band) => world.frameCandidates(band),
          placeCamera: (camera, target) => world.placeCamera(camera, target),
          beingPixels: () => world.beingPixels(),
          daylight: () => world.daylightNow(),
          zoomBand: () => world.zoomBand(),
          cameraReport: () => world.cameraReport(),
          bandPixels: () => world.bandPixels(),
          annotationPixels: () => world.annotationPixels(),
          scaleReport: () => world.scaleReport(),
          scaleBar: () => world.scaleBar(),
          promises: () => world.promises(),
          activityShownOf: (id) => world.activityShownOf(id),
          stageShownOf: (id) => world.stageShownOf(id),
          conditionShownOf: (id) => world.conditionShownOf(id),
          movingShownOf: (id) => world.movingShownOf(id),
          specimen: (on) => world.specimen(on),
          specimenIds: () => world.specimenIds(),
          // ── Comprehension by interaction ──────────────────────────────────
          hoverCardFor: (id) => world.hoverCardFor(id),
          rosterRows: () => world.rosterRows(),
          activeFilters: () => ({ ...filterRef.current }),
          matchCount: () => countMatches(rowsRef.current, filterRef.current),
          highlightedIds: () => world.highlightedIds(),
          chipSummary: (cluster) => world.chipSummary(cluster),
          chipsOnScreen: () => world.chipsOnScreen(),
          hoverCandidates: () => candRef.current.map((c) => c.id),
          // The mouse's own picking, through the mouse's own code path.
          pickAtScreen: (x, y) => world.pickAtScreen(x, y),
          hoveredId: () => world.hovered,
          markAudit: () => world.markAudit(),
          markGeometry: () => world.markGeometry(),
          renderCount: () => world.renderCount(),
          // One namespaced action set, so a driver can run a task the way a
          // person would and nothing read-only is ever mistaken for a lever.
          ui: {
            setFilter: (next) => setFilter({ ...emptyFilter(), ...next }),
            clearFilters: () => setFilter(emptyFilter()),
            hover: (id) => setBrush(id === null ? NO_BRUSH : { id, source: 'roster' }),
            // A CLICK, through the click's own code path — `World3D.choose` is
            // the line `handleClick` runs. Moving the camera is a separate act
            // with a separate button ("Centre on it"), and doing it inside the
            // selection is what lost the roster row a real click keeps.
            select: (id) => world.choose(id),
            centreOn: (id) => { world.centreOn(id); },
            roster: (open) => setRosterOpen(open),
            zoomToCluster: (cluster) => world.zoomToCluster(cluster),
          },
        };
        const payload = worldPayloadRef.current;
        if (payload) {
          world.resetWorld();
          world.setResources(payload.resources);
        }
      } else {
        world3dRef.current?.dispose();
        world3dRef.current = null;
        delete window.__ygg;
      }
    },
    [client, chooseBeing],
  );

  // A new world: terrain stays, everything living in it is replaced.
  useEffect(
    () =>
      client.onWorld((payload) => {
        worldPayloadRef.current = payload;
        const world = world3dRef.current;
        if (world) {
          world.resetWorld();
          world.setResources(payload.resources);
        }
        setSelected(null);
      }),
    [client],
  );

  // Frames go straight from the worker into instance matrices — no React here.
  useEffect(
    () =>
      client.onFrame((frame) => {
        const world = world3dRef.current;
        if (!world) return;
        world.applyFrame(frame);
        const missing = world.notDrawn;
        if (missing.beings !== hiddenRef.current.beings || missing.wildlife !== hiddenRef.current.wildlife) {
          hiddenRef.current = missing;
          setNotDrawn(missing);
        }
      }),
    [client],
  );

  // The sim died, wedged, or spoke the wrong protocol. Say so, stop pretending
  // to run, and offer the way back.
  useEffect(
    () =>
      client.onFault((f) => {
        setFault(f);
        if (f) setRunning(false); // the button must not read "Pause" over a dead world
      }),
    [client],
  );

  // Only the name/id is kept up here (the idea box needs it); the inspector
  // keeps the detail itself, so a 2 Hz detail push re-renders nothing else.
  useEffect(
    () =>
      client.onDetail((detail) => {
        setSelected((prev) => {
          if (!detail) return prev === null ? prev : null;
          return prev && prev.id === detail.id && prev.name === detail.name ? prev : { id: detail.id, name: detail.name };
        });
      }),
    [client],
  );

  // Kin and bonds, only while someone is looking at them. Relationships drift,
  // so the overlay is refreshed while it is on — and costs nothing while it is off.
  useEffect(() => {
    if (!tiesOn || !selected) {
      world3dRef.current?.setTies(null);
      return;
    }
    let live = true;
    const ask = (): void => {
      void client.query({ name: 'ties', id: selected.id }).then(
        (ties) => { if (live) world3dRef.current?.setTies(ties); },
        () => undefined, // no world to ask; the next tick tries again
      );
    };
    ask();
    const timer = setInterval(ask, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, tiesOn, selected]);

  useEffect(() => { world3dRef.current?.setFollow(following); }, [following]);

  // ── Comprehension wiring ───────────────────────────────────────────────────

  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { brushRef.current = brush; }, [brush]);
  useEffect(() => { candRef.current = candidates; }, [candidates]);

  /**
   * The table's own heartbeat. Four times a second, never per frame: a roster
   * fed from the render loop would re-render three hundred rows sixty times a
   * second to say the same words, and that is the long task this item must not
   * introduce. The 3D view keeps drawing at sixty either way — the two rates
   * are deliberately unrelated.
   */
  useEffect(() => {
    if (tab !== 'world') return;
    const tick = (): void => {
      const world = world3dRef.current;
      if (!world) return;
      setRows(world.rosterRows());
      const id = brushRef.current.id;
      setCard(id === null ? null : world.hoverCardFor(id));
      const at = chipRef.current;
      setChipSum(at === null ? null : world.chipSummary(at));
      // A specimen has no sim behind it to push detail, so its panel is kept
      // current on the same heartbeat the roster is — its facing changes with
      // the camera even though its life never does.
      const spec = specimenRef.current;
      if (spec !== null) setSpecimenCard(world.hoverCardFor(spec));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    chipRef.current = chip?.cluster ?? null;
    const world = world3dRef.current;
    setChipSum(chip === null || !world ? null : world.chipSummary(chip.cluster));
  }, [chip]);

  // Who the view highlights, and the card it is describing, follow the brush
  // immediately — a card that waited for the next 250 ms tick would arrive
  // after the pointer had moved on, and the promise is "within 100 ms".
  useEffect(() => {
    const world = world3dRef.current;
    if (!world) return;
    world.setHover(brush.id);
    setCard(brush.id === null ? null : world.hoverCardFor(brush.id));
  }, [brush]);

  /**
   * The filter's effect on the picture: emphasise the matches, dim the rest,
   * remove nobody. Recomputed only when the question or the population
   * changes, and handed to the view as a Set it reads per instance.
   */
  const matched = useMemo(() => {
    if (isEmptyFilter(filter)) return null;
    const set = new Set<number>();
    for (const r of rows) if (matchesFilter(r, filter)) set.add(r.id);
    return set;
  }, [rows, filter]);
  useEffect(() => { world3dRef.current?.setHighlight(matched); }, [matched]);

  /**
   * Stepping through the beings under the cursor.
   *
   * In a settlement the pointer is often over four people at once. The card
   * describes one of them and says how many there are; the arrow keys walk the
   * list, and the 3D view follows whichever the card is on. Bound while the
   * pointer is over the canvas and there is actually something to choose
   * between, so the roster's own arrow keys are never shadowed.
   */
  useEffect(() => {
    if (candidates.length < 2) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.closest('.roster'))) return;
      e.preventDefault();
      const at = candidates.findIndex((c) => c.id === brushRef.current.id);
      const next = candidates[cycleCandidate(candidates.length, at < 0 ? 0 : at, e.key === 'ArrowDown' ? 1 : -1)];
      if (next) setBrush({ id: next.id, source: 'roster' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [candidates]);

  const hoverRow = useCallback((id: number) => setBrush((b) => brushReduce(b, { kind: 'roster-hover', id })), []);
  const leaveRoster = useCallback(() => setBrush((b) => brushReduce(b, { kind: 'roster-leave' })), []);
  const pickRow = useCallback(
    (id: number) => {
      const world = world3dRef.current;
      chooseBeing(id);
      world?.setSelected(id);
      world?.centreOn(id);
    },
    [chooseBeing],
  );

  const newWorld = useCallback(() => {
    setRunning(false);
    setSelected(null);
    setFollowing(false);
    setTiesOn(false);
    client.setSpeed(SPEED_PRESETS[speedIdx]!.mult);
    client.createWorld(seed, agentCount, llm.hasKey ? { model: llm.model } : null);
  }, [client, seed, agentCount, llm, speedIdx]);

  const restart = useCallback(() => {
    client.restart();
    world3dRef.current?.resetWorld();
    hiddenRef.current = { beings: 0, wildlife: 0 };
    setNotDrawn({ beings: 0, wildlife: 0 });
    newWorld();
  }, [client, newWorld]);

  // Load app version + LLM status once.
  useEffect(() => {
    const lab = window.lab;
    if (!lab) return;
    void lab.getVersion().then(setVersion);
    void lab.llmStatus().then(setLlm);
    return lab.onUpdate((channel) => {
      if (channel === 'updater:checking') setUpdateMsg('Checking for updates…');
      else if (channel === 'updater:available') setUpdateMsg('Update available — downloading…');
      else if (channel === 'updater:none') setUpdateMsg('');
      else if (channel === 'updater:progress') setUpdateMsg('Downloading update…');
      else if (channel === 'updater:ready') setUpdateMsg('Update ready — installs on quit.');
      else if (channel === 'updater:error') setUpdateMsg('');
    });
  }, []);

  // Build the first world once we know the LLM status (so it uses the bridge
  // backend when a key is present), and rebuild if that status changes.
  useEffect(() => {
    newWorld();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.hasKey, llm.model]);

  useEffect(() => {
    client.setRunning(running);
    // The view animates only while the WORLD does — a paused instrument is a
    // frozen frame. See `World3D.setRunning`.
    world3dRef.current?.setRunning(running);
  }, [client, running]);
  useEffect(() => { client.setSpeed(SPEED_PRESETS[speedIdx]!.mult); }, [client, speedIdx]);
  useEffect(() => {
    tabRef.current = tab;
    client.setFrames(tab === 'world'); // don't pay for frames nobody is drawing
  }, [client, tab]);

  // A paused world is a still picture, and a still picture does not need sixty
  // frames a second of a shared GPU.
  useEffect(() => { runningRef.current = running; }, [running]);

  // One persistent rAF: orbit damping + draw. The sim is not in this loop.
  //
  // The legend is the one thing outside the canvas that has to follow the zoom,
  // because what the view draws changes with it. React is told only when the
  // BAND changes — a `setState` per frame would re-render the whole shell sixty
  // times a second to say the same word.
  //
  // And the loop is CAPPED. A bare `requestAnimationFrame` draws a continent,
  // six thousand trees and three hundred instanced beings as fast as the panel
  // will take them — a hundred and forty-four times a second on a fast display,
  // for a picture that is identical every time while the world is paused. This
  // is an observatory on a shared machine, not a game: it draws at sixty while
  // something is changing, ten while nothing is, and two while nobody is
  // looking. `targetFps` and `nextFrameAt` hold the whole policy and are unit
  // tested; everything here is the plumbing.
  useEffect(() => {
    let raf = 0;
    let last = Number.NEGATIVE_INFINITY;
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      const world = world3dRef.current;
      if (!world || tabRef.current !== 'world') return;
      const tick = nextFrameAt(now, last, targetFps({
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        running: runningRef.current,
        interacting: world.isInteracting(),
      }));
      if (tick === null) return;
      last = tick;
      world.render();
      const band = world.zoomBand();
      if (band !== bandRef.current) {
        bandRef.current = band;
        setBand(band);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const saveKey = useCallback(async () => {
    const lab = window.lab;
    if (!lab || !keyInput.trim()) return;
    const status = await lab.setKey(keyInput.trim());
    setLlm({ hasKey: status.hasKey, model: status.model });
    setKeyInput('');
  }, [keyInput]);

  const setPanelWidth = useCallback((px: number) => {
    world3dRef.current?.setPanelWidth(px);
  }, []);

  const clearSelection = useCallback(() => {
    chooseBeing(null);
    world3dRef.current?.setSelected(null);
    setSelected(null);
    setFollowing(false);
    setTiesOn(false);
  }, [chooseBeing]);

  const sendIdea = useCallback(() => {
    const clean = idea.trim();
    if (!clean || !selected) return;
    client.giveIdea(clean, selected.id); // a thought lands in ONE head — the selected one
    setIdea('');
  }, [client, idea, selected]);

  const preset = SPEED_PRESETS[speedIdx]!;
  // Beings are born unnamed here; only a conscious mind names itself. Everyone
  // else gets a designation the lab can say out loud, because `#1830` is not
  // something a researcher can hold in their head or narrate a civilization from.
  const selectedName = selected ? displayName(selected.id, selected.name) : null;

  return (
    <div className="lab">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Yggdrasil Lab
          {version && <span className="ver">v{version}</span>}
        </div>
        <nav className="tabs">
          {(['world', 'activity', 'analysis', 'society', 'culture', 'reports'] as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'sel' : ''} onClick={() => setTab(t)}>
              {t === 'world' ? 'World' : t === 'activity' ? 'Live Activity' : t === 'analysis' ? 'Analysis' : t === 'society' ? 'Society' : t === 'culture' ? 'Culture' : 'Reports'}
            </button>
          ))}
        </nav>
        {updateMsg && <div className="update">{updateMsg}</div>}
      </header>

      {!llm.hasKey && (
        <div className="keybar">
          <span>⚠ LLM minds need a Fireworks API key — this is the consciousness the lab trains.</span>
          <input type="password" value={keyInput} placeholder="fw_…" onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
          <button className="go" onClick={saveKey}>Save key</button>
        </div>
      )}

      {fault && (
        <div className="faultbar">
          <span>■ The simulation stopped — {fault.reason}. The world is frozen at Day {fault.day || 1}; nothing you see below is advancing.</span>
          <button className="go" onClick={restart}>Restart simulation</button>
        </div>
      )}

      {/* Kept mounted across tabs: rebuilding terrain + 6000 trees on every tab
          switch is a ~100 ms hitch for nothing. Hidden, it draws nothing. */}
      <div className="body" style={{ display: tab === 'world' ? 'flex' : 'none' }}>
        {/* The world and the table it is linked to are ONE column. The roster
            is docked under the view it brushes, not folded into the right rail
            beside the controls: a linked table belongs to the picture. */}
        <div className="worldcol">
        <div className="stage">
          <canvas ref={canvasCb} className="world3d" />

          {card && chip === null && (
            <HoverCard
              card={card}
              others={candidates.map((c) => ({
                id: c.id,
                name: rows.find((r) => r.id === c.id)?.name ?? `#${c.id}`,
                stage: rows.find((r) => r.id === c.id)?.stageWord ?? '',
              }))}
              at={pointerAt}
              onPick={(id) => setBrush({ id, source: 'roster' })}
              offeredPoints={offeredPoints}
            />
          )}
          {chip && chipSum && (
            <ChipCard
              summary={{ ...chipSum, filtering: matched !== null }}
              at={{ x: chip.x, y: chip.y }}
              // The occupants of a shelter are reached through their chip and
              // nowhere else — see `offeredUnderPointer`. This is that route.
              onPick={(id) => {
                if (chipClose.current !== null) { clearTimeout(chipClose.current); chipClose.current = null; }
                world3dRef.current?.choose(id);
                setChip(null);
              }}
              onHold={(held) => {
                if (chipClose.current !== null) { clearTimeout(chipClose.current); chipClose.current = null; }
                if (!held) chipClose.current = window.setTimeout(() => setChip(null), CHIP_CARD_GRACE_MS);
              }}
            />
          )}

          <div className="selbar">
            {specimenCard ? (
              <>
                <b className="given">{displayName(specimenCard.id, undefined).text}</b>
                <span className="given-note">specimen — not in the simulation</span>
                <button onClick={() => world3dRef.current?.focusSelected()}>Centre on it</button>
                <button onClick={clearSelection}>Clear</button>
              </>
            ) : selected && selectedName ? (
              <>
                <b className={selectedName.selfChosen ? 'named' : 'given'}>{selectedName.text}</b>
                <span className="given-note">{selectedName.selfChosen ? 'named itself' : 'lab designation'}</span>
                <button onClick={() => world3dRef.current?.focusSelected()}>Centre on them</button>
                <button className={following ? 'sel' : ''} onClick={() => setFollowing((f) => !f)}>{following ? 'Following' : 'Follow'}</button>
                <button className={tiesOn ? 'sel' : ''} onClick={() => setTiesOn((t) => !t)}>{tiesOn ? 'Hide kin & bonds' : 'Show kin & bonds'}</button>
                <button onClick={clearSelection}>Clear</button>
              </>
            ) : (
              <span className="orbit">drag to orbit · scroll to zoom · click a being to follow it</span>
            )}
            {notDrawn.beings > 0 && <span className="warn">{notDrawn.beings} beings not drawn</span>}
            {notDrawn.wildlife > 0 && <span className="warn">{notDrawn.wildlife} animals not drawn</span>}
          </div>

          <Legend band={band} />
          <Inspector client={client} specimen={specimenCard} onClose={clearSelection} onWidth={setPanelWidth} />
        </div>

        <RosterDock
          rows={rows}
          filter={filter}
          onFilter={setFilter}
          brushId={brush.id}
          brushFromWorld={shouldScrollToBrush(brush)}
          onHoverRow={hoverRow}
          onLeave={leaveRoster}
          selectedId={specimenId ?? selected?.id ?? null}
          onPick={pickRow}
          open={rosterOpen}
          onOpen={setRosterOpen}
          speedMult={preset.mult}
          running={running}
        />
        </div>

        <aside className="panel">
          <section className="controls">
            <div className="row">
              <button className={running ? 'danger' : 'go'} disabled={!!fault} onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Run'}</button>
              <button onClick={newWorld} disabled={!!fault}>New world</button>
            </div>
            <label>Seed<input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={running} /></label>
            <label>Population: {agentCount}
              <input type="range" min={20} max={256} step={2} value={agentCount} disabled={running} onChange={(e) => setAgentCount(Number(e.target.value))} />
            </label>
            <SpeedLabel client={client} preset={preset} running={running} />
            <div className="speeds">
              {SPEED_PRESETS.map((p, i) => (
                <button key={p.mult} className={i === speedIdx ? 'sel' : ''} onClick={() => setSpeedIdx(i)}>{p.label}</button>
              ))}
            </div>
          </section>

          <LiveStats client={client} />

          <section className="idea">
            <label>Give a thought to {selectedName ? selectedName.text : 'one Gahallian'} (only you can)</label>
            <div className="row">
              <input
                value={idea}
                placeholder={selectedName ? `whisper to ${selectedName.text}…` : 'click a Gahallian first'}
                disabled={!selected}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendIdea()}
              />
              <button className="go" disabled={!selected} onClick={sendIdea}>Send</button>
            </div>
            {!selected && <p className="ideahint">A thought lands in one head, not the whole world — click a Gahallian to choose who hears it.</p>}
          </section>

          <LiveFeed client={client} />
        </aside>
      </div>

      {tab === 'activity' && <ActivityView />}
      {tab === 'analysis' && <AnalysisView snap={analysis} />}
      {tab === 'society' && <SocietyView society={society} />}
      {tab === 'culture' && <CultureView culture={culture?.culture ?? null} myth={culture?.myth ?? null} />}
      {tab === 'reports' && <ReportsView />}
    </div>
  );
}
