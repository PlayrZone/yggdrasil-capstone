import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SimClient, type SimFault } from './sim/client.js';
import { SPEED_PRESETS, type SpeedPreset } from './sim/presets.js';
import type { AgentDetail, FeedItem, QueryRequest, QueryResults, StatsMessage, WorldMessage } from './sim/protocol.js';
import { World3D } from './World3D.js';
import { ActivityView } from './ActivityView.js';
import { ReportsView } from './ReportsView.js';
import { AnalysisView } from './AnalysisView.js';
import { SocietyView } from './SocietyView.js';
import { CultureView } from './CultureView.js';

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
 * and a saturated CPU cannot keep it — so whenever the sim is more than 5% off
 * the rate the button sells, both numbers are shown. Never advertise a speed
 * the world is not doing.
 */
function SpeedLabel({ client, preset }: { client: SimClient; preset: SpeedPreset }): React.ReactElement {
  const [achieved, setAchieved] = useState(0);
  useEffect(
    () =>
      client.onStats((s) => {
        // Coarse so the label does not flicker, and so this component re-renders
        // far less often than the 4 Hz it is fed at.
        const rounded = s.achievedMult >= 100 ? Math.round(s.achievedMult / 10) * 10 : Math.round(s.achievedMult);
        setAchieved((prev) => (prev === rounded ? prev : rounded));
      }),
    [client],
  );
  const off = achieved > 0 && Math.abs(achieved - preset.mult) / preset.mult > 0.05;
  return (
    <label>
      Speed — {preset.rate}
      {off && <span className="achieved"> · {preset.mult}× asked · {achieved}× achieved</span>}
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
        {feed.map((e) => (
          <li key={e.seq} className={e.kind}>
            <span className="t">d{e.day}</span>{' '}
            {e.kind === 'speech'
              ? <span key="speech"><b>{e.who}</b>: “{e.text}”</span>
              : <span key="event" className="ev">{e.who} · {e.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The selected being. Its own subscriber, so the stats cadence never touches it. */
function Inspector({ client, onClose }: { client: SimClient; onClose: () => void }): React.ReactElement | null {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  useEffect(() => client.onDetail(setDetail), [client]);
  if (!detail) return null;
  return (
    <div className="inspector">
      <div className="ihead">
        <b>{detail.name}</b>
        <span>{detail.alive ? detail.region : 'dead'}{detail.archetype ? ` · ${detail.archetype}` : ''}</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="ineeds">
        {Object.entries(detail.needs).map(([k, v]) => (
          <div key={k} className="nrow"><span>{k}</span><span className="nbar"><i style={{ width: `${v}%`, background: v >= 75 ? '#e0524d' : v >= 50 ? '#e09a3a' : '#43d18a' }} /></span></div>
        ))}
      </div>
      <div className="iknow">
        <label>What {detail.name.split(' ')[0]} has learned ({detail.knowledge.length})</label>
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

  const analysis = usePolled(client, tab === 'analysis', 'analysis', 2500);
  const society = usePolled(client, tab === 'society', 'society', 3000);
  const culture = usePolled(client, tab === 'culture', 'culture', 3500);

  useEffect(() => () => client.dispose(), [client]);

  // Callback ref: spin up / tear down the WebGL world with the canvas element.
  const canvasCb = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (el) {
        const world = new World3D(el, (id) => client.select(id));
        world3dRef.current = world;
        // A deterministic handle for drivers: a being is ~2 px at the default
        // camera, so a test that wants to click one has to be told where it is.
        window.__ygg = { drawnIds: () => world.drawnIds(), screenPositionOf: (id) => world.screenPositionOf(id) };
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

  const newWorld = useCallback(() => {
    setRunning(false);
    setSelected(null);
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
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      if (tabRef.current === 'world') world3dRef.current?.render();
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

  const clearSelection = useCallback(() => {
    client.select(null);
    world3dRef.current?.setSelected(null);
    setSelected(null);
  }, [client]);

  const sendIdea = useCallback(() => {
    const clean = idea.trim();
    if (!clean || !selected) return;
    client.giveIdea(clean, selected.id); // a thought lands in ONE head — the selected one
    setIdea('');
  }, [client, idea, selected]);

  const preset = SPEED_PRESETS[speedIdx]!;

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
          <div className="legend">
            <span><i style={{ background: '#43d18a' }} /> active</span>
            <span><i style={{ background: '#e09a3a' }} /> hungry</span>
            <span><i style={{ background: '#5b8bd0' }} /> sleeping</span>
            <span><i style={{ background: '#e0524d' }} /> sick</span>
            {notDrawn.beings > 0 && <span className="warn">{notDrawn.beings} Gahallians not drawn</span>}
            {notDrawn.wildlife > 0 && <span className="warn">{notDrawn.wildlife} animals not drawn</span>}
            <span className="orbit">drag to orbit · scroll to zoom · click a Gahallian</span>
          </div>

          <Inspector client={client} onClose={clearSelection} />
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
            <SpeedLabel client={client} preset={preset} />
            <div className="speeds">
              {SPEED_PRESETS.map((p, i) => (
                <button key={p.mult} className={i === speedIdx ? 'sel' : ''} onClick={() => setSpeedIdx(i)}>{p.label}</button>
              ))}
            </div>
          </section>

          <LiveStats client={client} />

          <section className="idea">
            <label>Give a thought to {selected ? selected.name : 'one Gahallian'} (only you can)</label>
            <div className="row">
              <input
                value={idea}
                placeholder={selected ? `whisper to ${selected.name}…` : 'click a Gahallian first'}
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
