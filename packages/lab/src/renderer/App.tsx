import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { displayName, type ZoomBand } from './beings.js';

type Tab = 'world' | 'activity' | 'analysis' | 'society' | 'culture' | 'reports';

const FEED_CAP = 50;

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

/** The counters. Subscribes on its own so a stats tick never re-renders the canvas. */
function LiveStats({ client }: { client: SimClient }): React.ReactElement | null {
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
}

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
function LiveFeed({ client }: { client: SimClient }): React.ReactElement | null {
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
}

/**
 * The selected being. Its own subscriber, so the stats cadence never touches it.
 *
 * It reports its own width up to the world view, which aims the camera clear of
 * it: a panel that opens because you clicked a being must not then be sitting
 * on that being.
 */
function Inspector({ client, onClose, onWidth }: { client: SimClient; onClose: () => void; onWidth: (px: number) => void }): React.ReactElement | null {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => client.onDetail(setDetail), [client]);
  const open = detail !== null;
  useEffect(() => {
    const el = box.current;
    onWidth(open && el ? el.offsetWidth + 28 : 0);
    return () => onWidth(0);
  }, [open, onWidth]);
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
}

export function App(): React.ReactElement {
  const [client] = useState(() => new SimClient());
  const world3dRef = useRef<World3D | null>(null);
  const worldPayloadRef = useRef<WorldMessage | null>(null);
  const tabRef = useRef<Tab>('world');
  const hiddenRef = useRef({ beings: 0, wildlife: 0 });
  const bandRef = useRef<ZoomBand>('default');

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

  const analysis = usePolled(client, tab === 'analysis', 'analysis', 2500);
  const society = usePolled(client, tab === 'society', 'society', 3000);
  const culture = usePolled(client, tab === 'culture', 'culture', 3500);

  useEffect(() => () => client.dispose(), [client]);

  // Callback ref: spin up / tear down the WebGL world with the canvas element.
  const canvasCb = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (el) {
        const world = new World3D(el, (id) => {
          client.select(id);
          if (id === null) {
            setFollowing(false);
            setTiesOn(false);
          }
        });
        world3dRef.current = world;
        // A read-only handle for drivers and reviewers: what the view drew, so a
        // screenshot can be scored against the ground truth behind it.
        window.__ygg = {
          drawnIds: () => world.drawnIds(),
          screenPositionOf: (id) => world.screenPositionOf(id),
          stateOf: (id) => world.stateOf(id),
          stageOf: (id) => world.stageOf(id),
          conditionOf: (id) => world.conditionOf(id),
          activityOf: (id) => world.activityOf(id),
          headingOf: (id) => world.headingOf(id),
          headingOnScreen: (id) => world.headingOnScreen(id),
          nameOf: (id) => world.nameOf(id),
          labelsShown: () => world.labelsShown(),
          clustersShown: () => world.clustersShown(),
          beingPixels: () => world.beingPixels(),
          daylight: () => world.daylightNow(),
          zoomBand: () => world.zoomBand(),
          bandPixels: () => world.bandPixels(),
          annotationPixels: () => world.annotationPixels(),
          scaleReport: () => world.scaleReport(),
          promises: () => world.promises(),
          activityShownOf: (id) => world.activityShownOf(id),
          stageShownOf: (id) => world.stageShownOf(id),
          conditionShownOf: (id) => world.conditionShownOf(id),
          movingShownOf: (id) => world.movingShownOf(id),
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
    [client],
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

  useEffect(() => { client.setRunning(running); }, [client, running]);
  useEffect(() => { client.setSpeed(SPEED_PRESETS[speedIdx]!.mult); }, [client, speedIdx]);
  useEffect(() => {
    tabRef.current = tab;
    client.setFrames(tab === 'world'); // don't pay for frames nobody is drawing
  }, [client, tab]);

  // One persistent rAF: orbit damping + draw. The sim is not in this loop.
  //
  // The legend is the one thing outside the canvas that has to follow the zoom,
  // because what the view draws changes with it. React is told only when the
  // BAND changes — a `setState` per frame would re-render the whole shell sixty
  // times a second to say the same word.
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      const world = world3dRef.current;
      if (world && tabRef.current === 'world') {
        world.render();
        const now = world.zoomBand();
        if (now !== bandRef.current) {
          bandRef.current = now;
          setBand(now);
        }
      }
      raf = requestAnimationFrame(loop);
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
    client.select(null);
    world3dRef.current?.setSelected(null);
    setSelected(null);
    setFollowing(false);
    setTiesOn(false);
  }, [client]);

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
        <div className="stage">
          <canvas ref={canvasCb} className="world3d" />

          <div className="selbar">
            {selected && selectedName ? (
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
          <Inspector client={client} onClose={clearSelection} onWidth={setPanelWidth} />
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
