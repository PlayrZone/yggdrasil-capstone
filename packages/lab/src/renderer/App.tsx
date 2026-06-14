import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Experiment, TICKS_PER_DAY } from '@yggdrasil/engine';
import { SimClock, SPEED_PRESETS } from './sim.js';
import { BridgeBackend } from './bridgeBackend.js';
import { World3D, type Agent3D } from './World3D.js';
import { ActivityView } from './ActivityView.js';
import { ReportsView } from './ReportsView.js';
import { AnalysisView, type AnalysisSnapshot } from './AnalysisView.js';
import { SocietyView } from './SocietyView.js';
import type { SocietyReport } from '@yggdrasil/engine';

type Tab = 'world' | 'activity' | 'analysis' | 'society' | 'reports';

interface FeedItem {
  tick: number;
  kind: 'speech' | 'event';
  who: string;
  text: string;
}

interface Stats {
  day: number;
  alive: number;
  total: number;
  knowledge: number;
  exchanges: number;
  conflicts: number;
  sickness: number;
  shares: number;
  seedPlants: number;
  sprouts: number;
  builds: number;
  backend: string;
  deaths: number;
  pending: number;
  feed: FeedItem[];
}

const dayOf = (tick: number): number => Math.floor(tick / TICKS_PER_DAY) + 1;

// Humanize raw event types for the feed.
function eventPhrase(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'GatherSucceeded': return payload['dug'] ? `dug ${payload['objectKind']}` : `gathered ${payload['objectKind'] ?? 'something'}`;
    case 'GatherFailed': return 'found nothing to gather';
    case 'AteFood': return `ate ${payload['objectKind'] ?? 'food'}`;
    case 'BecameSick': return 'fell sick';
    case 'Recovered': return 'recovered';
    case 'AgentDied': return `died (${payload['cause'] ?? 'unknown'})`;
    case 'BuiltStructure': return `built a ${payload['buildKind'] ?? 'structure'}`;
    case 'SeedDeposited': return 'planted a seed';
    case 'PlantSprouted': return 'watched a seed sprout';
    case 'GaveItem': return `shared ${payload['objectKind'] ?? 'an item'}`;
    case 'AttackedAgent': return 'attacked another';
    case 'AttackedByPredator': return `was attacked by a ${payload['predator'] ?? 'predator'}!`;
    case 'FoughtPredator': return `fought off a ${payload['predator'] ?? 'predator'}`;
    case 'KilledPredator': return `KILLED a ${payload['predator'] ?? 'predator'}!`;
    case 'Crafted': return `crafted a ${payload['made'] ?? 'tool'}`;
    case 'ChildBorn': return 'a child was born';
    case 'SleptInShelter': case 'Slept': return 'slept';
    // "IntentRejected" = a plan step the world wouldn't allow (e.g. out of range,
    // no wood) — the agent just tries something else. Normal, not an error.
    case 'IntentRejected': return `couldn't ${payload['intentKind'] ?? 'act'} (${payload['reason'] ?? '—'})`;
    default: return type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  }
}

export function App(): React.ReactElement {
  const clockRef = useRef<SimClock | null>(null);
  const world3dRef = useRef<World3D | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const runningRef = useRef(false);
  const speedRef = useRef(0);

  const [tab, setTab] = useState<Tab>('world');
  const [seed, setSeed] = useState('genesis-01');
  const [agentCount, setAgentCount] = useState(150);
  const [speedIdx, setSpeedIdx] = useState(3); // 30× (4 min/day) — motion is clearly visible; 1× stays for calm watching
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [idea, setIdea] = useState('');
  const [version, setVersion] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');
  const [llm, setLlm] = useState<{ hasKey: boolean; model: string }>({ hasKey: false, model: '' });
  const [keyInput, setKeyInput] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [society, setSociety] = useState<SocietyReport | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<ReturnType<Experiment['agentDetail']>>(null);

  const sampleStats = useCallback((exp: Experiment): Stats => {
    const feed: FeedItem[] = exp.recentEvents(50).map((e) => {
      const utt = e.payload['utterance'] as { text?: string } | undefined;
      if (e.type === 'UtteranceSpoken' && utt?.text) {
        return { tick: e.tick, kind: 'speech', who: exp.nameOf(e.actorId), text: utt.text };
      }
      return { tick: e.tick, kind: 'event', who: exp.nameOf(e.actorId), text: eventPhrase(e.type, e.payload) };
    });
    return {
      day: exp.day(),
      alive: exp.aliveCount(),
      total: exp.agentIds.length,
      knowledge: exp.totalKnowledge(),
      exchanges: exp.exchangeCount,
      conflicts: exp.conflictCount,
      sickness: exp.sicknessCount,
      shares: exp.shareCount,
      seedPlants: exp.seedPlantCount,
      sprouts: exp.sproutCount,
      builds: exp.buildCount,
      backend: exp.backendLabel,
      deaths: Object.values(exp.deathsByCause).reduce((a, b) => a + b, 0),
      pending: exp.cognitionPending(),
      feed,
    };
  }, []);

  // The 3D scene draws the interpolated agents standing on the terrain.
  const drawWorld = useCallback((clock: SimClock) => {
    const world = world3dRef.current;
    if (!world) return;
    const state = new Map(clock.exp.agentInfos().map((a) => [a.id, a]));
    const agents: Agent3D[] = [];
    for (const p of clock.interpolated()) {
      const a = state.get(p.id);
      const s = a ? (a.sick ? 3 : a.sleeping ? 2 : a.hungerCritical ? 1 : 0) : 0;
      agents.push({ id: p.id, x: p.x, y: p.y, state: s });
    }
    world.update(agents);
    world.updateAnimals(clock.exp.animals());
    world.render();
  }, []);

  // Callback ref: spin up / tear down the WebGL world with the canvas element.
  const canvasCb = useCallback((el: HTMLCanvasElement | null) => {
    if (el) {
      const world = new World3D(el, (id) => {
        selectedRef.current = id;
        setSelected(id !== null && clockRef.current ? clockRef.current.exp.agentDetail(id) : null);
      });
      const exp = clockRef.current?.exp;
      world.setPopulation(360); // capacity headroom — the population grows as children are born
      if (exp) {
        world.setResources(exp.resourceNodes());
        world.setAnimals(300);
      }
      world3dRef.current = world;
    } else {
      world3dRef.current?.dispose();
      world3dRef.current = null;
    }
  }, []);

  const newExperiment = useCallback(() => {
    const mindBackend = llm.hasKey ? new BridgeBackend(llm.model) : undefined;
    const exp = new Experiment({ seed, agentCount, mindBackend });
    clockRef.current = new SimClock(exp, () => performance.now());
    world3dRef.current?.setPopulation(360); // headroom for newborns
    world3dRef.current?.setResources(exp.resourceNodes());
    world3dRef.current?.setAnimals(300);
    world3dRef.current?.setSelected(null);
    selectedRef.current = null;
    setSelected(null);
    setStats(sampleStats(exp));
  }, [seed, agentCount, llm, sampleStats]);

  // Load app version + LLM status once.
  useEffect(() => {
    const lab = window.lab;
    if (!lab) {
      newExperiment();
      return;
    }
    void lab.getVersion().then(setVersion);
    void lab.llmStatus().then((s) => setLlm(s));
    const off = lab.onUpdate((channel) => {
      if (channel === 'updater:checking') setUpdateMsg('Checking for updates…');
      else if (channel === 'updater:available') setUpdateMsg('Update available — downloading…');
      else if (channel === 'updater:none') setUpdateMsg('');
      else if (channel === 'updater:progress') setUpdateMsg('Downloading update…');
      else if (channel === 'updater:ready') setUpdateMsg('Update ready — installs on quit.');
      else if (channel === 'updater:error') setUpdateMsg('');
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the first experiment once we know the LLM status (so it uses the
  // bridge backend when a key is present).
  useEffect(() => {
    newExperiment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.hasKey, llm.model]);

  // One persistent rAF loop reading running/speed from refs.
  useEffect(() => {
    let statTick = 0;
    const loop = (now: number): void => {
      const clock = clockRef.current;
      if (clock) {
        const dt = lastFrameRef.current ? now - lastFrameRef.current : 16;
        lastFrameRef.current = now;
        if (runningRef.current) {
          clock.tickFrame(dt, SPEED_PRESETS[speedRef.current]!.mult);
          if (statTick++ % 8 === 0) {
            setStats(sampleStats(clock.exp));
            world3dRef.current?.updateStructures(clock.exp.structures());
            if (selectedRef.current !== null) setSelected(clock.exp.agentDetail(selectedRef.current));
          }
        }
        drawWorld(clock); // smooth interpolation + orbit controls every frame
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawWorld, sampleStats]);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { speedRef.current = speedIdx; }, [speedIdx]);

  // Recompute the analysis snapshot while the Analysis tab is open (it walks
  // every agent's memory, so only do it when it's being looked at).
  useEffect(() => {
    if (tab !== 'analysis') return;
    const compute = (): void => {
      const exp = clockRef.current?.exp;
      if (exp) setAnalysis(exp.analysis());
    };
    compute();
    const id = setInterval(compute, 2500);
    return () => clearInterval(id);
  }, [tab]);

  // The society/influence read-out — also walks all agents, so compute it only
  // while its tab is open.
  useEffect(() => {
    if (tab !== 'society') return;
    const compute = (): void => {
      const exp = clockRef.current?.exp;
      if (exp) setSociety(exp.society());
    };
    compute();
    const id = setInterval(compute, 3000);
    return () => clearInterval(id);
  }, [tab]);

  const saveKey = useCallback(async () => {
    const lab = window.lab;
    if (!lab || !keyInput.trim()) return;
    const status = await lab.setKey(keyInput.trim());
    setLlm(status);
    setKeyInput('');
  }, [keyInput]);

  const sendIdea = useCallback(() => {
    const clock = clockRef.current;
    const clean = idea.trim();
    const target = selectedRef.current;
    if (!clock || !clean || target === null) return;
    clock.exp.giveIdea(clean, target); // a thought lands in ONE head — the selected one
    setIdea('');
  }, [idea]);

  const preset = SPEED_PRESETS[speedIdx]!;

  return (
    <div className="lab">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Yggdrasil Lab
          {version && <span className="ver">v{version}</span>}
        </div>
        <nav className="tabs">
          {(['world', 'activity', 'analysis', 'society', 'reports'] as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'sel' : ''} onClick={() => setTab(t)}>
              {t === 'world' ? 'World' : t === 'activity' ? 'Live Activity' : t === 'analysis' ? 'Analysis' : t === 'society' ? 'Society' : 'Reports'}
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

      {tab === 'world' && (
        <div className="body">
          <div className="stage">
            <canvas ref={canvasCb} className="world3d" />
            <div className="legend">
              <span><i style={{ background: '#43d18a' }} /> active</span>
              <span><i style={{ background: '#e09a3a' }} /> hungry</span>
              <span><i style={{ background: '#5b8bd0' }} /> sleeping</span>
              <span><i style={{ background: '#e0524d' }} /> sick</span>
              <span className="orbit">drag to orbit · scroll to zoom · click a Gahallian</span>
            </div>

            {selected && (
              <div className="inspector">
                <div className="ihead">
                  <b>{selected.name}</b>
                  <span>{selected.alive ? selected.region : 'dead'}{selected.archetype ? ` · ${selected.archetype}` : ''}</span>
                  <button onClick={() => { selectedRef.current = null; setSelected(null); world3dRef.current?.setSelected(null); }}>✕</button>
                </div>
                <div className="ineeds">
                  {Object.entries(selected.needs).map(([k, v]) => (
                    <div key={k} className="nrow"><span>{k}</span><span className="nbar"><i style={{ width: `${v}%`, background: v >= 75 ? '#e0524d' : v >= 50 ? '#e09a3a' : '#43d18a' }} /></span></div>
                  ))}
                </div>
                <div className="iknow">
                  <label>What {selected.name.split(' ')[0]} has learned ({selected.knowledge.length})</label>
                  <ul>
                    {selected.knowledge.slice(0, 12).map((k, i) => (
                      <li key={i}>{k.statement} <em>{Math.round(k.confidence * 100)}%</em></li>
                    ))}
                    {selected.knowledge.length === 0 && <li className="empty">nothing learned yet</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <aside className="panel">
            <section className="controls">
              <div className="row">
                <button className={running ? 'danger' : 'go'} onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Run'}</button>
                <button onClick={() => { setRunning(false); newExperiment(); }}>New world</button>
              </div>
              <label>Seed<input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={running} /></label>
              <label>Population: {agentCount}
                <input type="range" min={20} max={256} step={2} value={agentCount} disabled={running} onChange={(e) => setAgentCount(Number(e.target.value))} />
              </label>
              <label>Speed — {preset.rate}</label>
              <div className="speeds">
                {SPEED_PRESETS.map((p, i) => (
                  <button key={p.mult} className={i === speedIdx ? 'sel' : ''} onClick={() => setSpeedIdx(i)}>{p.label}</button>
                ))}
              </div>
            </section>

            {stats && (
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
            )}

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

            {stats && (
              <section className="feed">
                <label>What they're doing & saying</label>
                <ul>
                  {stats.feed.slice().reverse().map((e, i) => (
                    <li key={i} className={e.kind}>
                      <span className="t">d{dayOf(e.tick)}</span>{' '}
                      {e.kind === 'speech' ? <span><b>{e.who}</b>: “{e.text}”</span> : <span className="ev">{e.who} · {e.text}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {tab === 'activity' && <ActivityView />}
      {tab === 'analysis' && <AnalysisView snap={analysis} />}
      {tab === 'society' && <SocietyView society={society} />}
      {tab === 'reports' && <ReportsView />}
    </div>
  );
}
