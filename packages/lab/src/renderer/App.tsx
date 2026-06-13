import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Experiment, regionAt, TICKS_PER_DAY, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';
import { SimClock, SPEED_PRESETS } from './sim.js';

const CANVAS = 640;
const SCALE = CANVAS / WORLD;

const REGION_COLOR: Record<Region, string> = {
  river: '#1c3a4f',
  coast: '#16313f',
  forest: '#16331f',
  mountain: '#3a3540',
  hills: '#34301f',
  plains: '#23301c',
};

interface FeedItem {
  tick: number;
  kind: 'speech' | 'event';
  who: string;
  text: string;
}

interface Stats {
  day: number;
  tick: number;
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
  feed: FeedItem[];
}

function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CANVAS;
  c.height = CANVAS;
  const ctx = c.getContext('2d')!;
  const step = 4;
  for (let wy = 0; wy < WORLD; wy += step) {
    for (let wx = 0; wx < WORLD; wx += step) {
      ctx.fillStyle = REGION_COLOR[regionAt(wx + step / 2, wy + step / 2)];
      ctx.fillRect(wx * SCALE, wy * SCALE, step * SCALE + 1, step * SCALE + 1);
    }
  }
  return c;
}

const dayOf = (tick: number): number => Math.floor(tick / TICKS_PER_DAY) + 1;

export function App(): React.ReactElement {
  const clockRef = useRef<SimClock | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const runningRef = useRef(false);
  const speedRef = useRef(1);

  const [seed, setSeed] = useState('genesis-01');
  const [agentCount, setAgentCount] = useState(120);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [idea, setIdea] = useState('');
  const [version, setVersion] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');

  const sampleStats = useCallback((exp: Experiment): Stats => {
    const feed: FeedItem[] = exp.recentEvents(40).map((e) => {
      const utt = e.payload['utterance'] as { text?: string; speechAct?: string } | undefined;
      if (e.type === 'UtteranceSpoken' && utt?.text) {
        return { tick: e.tick, kind: 'speech', who: exp.nameOf(e.actorId), text: utt.text };
      }
      return { tick: e.tick, kind: 'event', who: exp.nameOf(e.actorId), text: e.type };
    });
    return {
      day: exp.day(),
      tick: exp.tick,
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
      feed,
    };
  }, []);

  const draw = useCallback((clock: SimClock) => {
    const canvas = canvasRef.current;
    const bg = bgRef.current;
    if (!canvas || !bg) return;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bg, 0, 0);
    const state = new Map(clock.exp.agentInfos().map((a) => [a.id, a]));
    for (const p of clock.interpolated()) {
      const a = state.get(p.id);
      if (!a) continue;
      ctx.fillStyle = a.sick ? '#e0524d' : a.sleeping ? '#5b8bd0' : a.hungerCritical ? '#e09a3a' : '#43d18a';
      ctx.beginPath();
      ctx.arc(p.x * SCALE, p.y * SCALE, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const newExperiment = useCallback(() => {
    const exp = new Experiment({ seed, agentCount });
    clockRef.current = new SimClock(exp, () => performance.now());
    bgRef.current = buildBackground();
    setStats(sampleStats(exp));
    draw(clockRef.current);
  }, [seed, agentCount, sampleStats, draw]);

  useEffect(() => {
    newExperiment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One persistent rAF loop; reads running/speed from refs so changing them
  // never tears down the loop.
  useEffect(() => {
    let statTick = 0;
    const loop = (now: number): void => {
      const clock = clockRef.current;
      if (clock) {
        const dt = lastFrameRef.current ? now - lastFrameRef.current : 16;
        lastFrameRef.current = now;
        if (runningRef.current) {
          clock.tickFrame(dt, SPEED_PRESETS[speedRef.current]!.mult);
          if (statTick++ % 8 === 0) setStats(sampleStats(clock.exp));
        }
        draw(clock); // always redraw for smooth interpolation
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, sampleStats]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    speedRef.current = speedIdx;
  }, [speedIdx]);

  useEffect(() => {
    const lab = window.lab;
    if (!lab) return;
    void lab.getVersion().then(setVersion);
    return lab.onUpdate((channel) => {
      if (channel === 'updater:checking') setUpdateMsg('Checking for updates…');
      else if (channel === 'updater:available') setUpdateMsg('Update available — downloading…');
      else if (channel === 'updater:none') setUpdateMsg('');
      else if (channel === 'updater:progress') setUpdateMsg('Downloading update…');
      else if (channel === 'updater:ready') setUpdateMsg('Update ready — installs on quit.');
      else if (channel === 'updater:error') setUpdateMsg('');
    });
  }, []);

  const sendIdea = useCallback(() => {
    const clock = clockRef.current;
    const clean = idea.trim();
    if (!clock || !clean) return;
    clock.exp.giveIdea(clean, 'all');
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
        {updateMsg && <div className="update">{updateMsg}</div>}
      </header>

      <div className="body">
        <div className="stage">
          <canvas ref={canvasRef} width={CANVAS} height={CANVAS} className="world" />
          <div className="legend">
            <span><i style={{ background: '#43d18a' }} /> active</span>
            <span><i style={{ background: '#e09a3a' }} /> hungry</span>
            <span><i style={{ background: '#5b8bd0' }} /> sleeping</span>
            <span><i style={{ background: '#e0524d' }} /> sick</span>
          </div>
        </div>

        <aside className="panel">
          <section className="controls">
            <div className="row">
              <button className={running ? 'danger' : 'go'} onClick={() => setRunning((r) => !r)}>
                {running ? 'Pause' : 'Run'}
              </button>
              <button onClick={() => { setRunning(false); newExperiment(); }}>New world</button>
            </div>
            <label>
              Seed
              <input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={running} />
            </label>
            <label>
              Population: {agentCount}
              <input type="range" min={20} max={256} step={4} value={agentCount} disabled={running} onChange={(e) => setAgentCount(Number(e.target.value))} />
            </label>
            <label>Speed — {preset.rate}</label>
            <div className="speeds">
              {SPEED_PRESETS.map((p, i) => (
                <button key={p.mult} className={i === speedIdx ? 'sel' : ''} onClick={() => setSpeedIdx(i)}>
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {stats && (
            <section className="stats">
              <div className="big">
                <div><b>{stats.alive}</b><span>/ {stats.total} alive</span></div>
                <div><b>Day {stats.day}</b><span>{stats.backend}</span></div>
                <div><b>{stats.knowledge}</b><span>knowledge</span></div>
              </div>
              <table>
                <tbody>
                  <tr><td>Exchanges</td><td>{stats.exchanges}</td><td>Conflicts</td><td>{stats.conflicts}</td></tr>
                  <tr><td>Sickness</td><td>{stats.sickness}</td><td>Shares</td><td>{stats.shares}</td></tr>
                  <tr><td>Seeds sown</td><td>{stats.seedPlants}</td><td>Sprouts</td><td>{stats.sprouts}</td></tr>
                  <tr><td>Builds</td><td>{stats.builds}</td><td>Deaths</td><td>{stats.deaths}</td></tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="idea">
            <label>Give them an idea (only you can)</label>
            <div className="row">
              <input value={idea} placeholder="e.g. water is by the river" onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendIdea()} />
              <button className="go" onClick={sendIdea}>Send</button>
            </div>
          </section>

          {stats && (
            <section className="feed">
              <label>What they're doing & saying</label>
              <ul>
                {stats.feed
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li key={i} className={e.kind}>
                      <span className="t">d{dayOf(e.tick)}</span>{' '}
                      {e.kind === 'speech' ? (
                        <span><b>{e.who}</b>: “{e.text}”</span>
                      ) : (
                        <span className="ev">{e.who} · {e.text}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
