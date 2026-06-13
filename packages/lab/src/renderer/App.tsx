import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Experiment, regionAt, WORLD } from '@yggdrasil/engine';
import type { Region } from '@yggdrasil/engine';

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
  deaths: Record<string, number>;
  events: { tick: number; type: string; actor: string }[];
}

function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CANVAS;
  c.height = CANVAS;
  const ctx = c.getContext('2d')!;
  const step = 4; // world units per sampled cell
  for (let wy = 0; wy < WORLD; wy += step) {
    for (let wx = 0; wx < WORLD; wx += step) {
      ctx.fillStyle = REGION_COLOR[regionAt(wx + step / 2, wy + step / 2)];
      ctx.fillRect(wx * SCALE, wy * SCALE, step * SCALE + 1, step * SCALE + 1);
    }
  }
  return c;
}

export function App(): React.ReactElement {
  const expRef = useRef<Experiment | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);

  const [seed, setSeed] = useState('genesis-01');
  const [agentCount, setAgentCount] = useState(120);
  const [speed, setSpeed] = useState(12); // ticks per animation frame
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [idea, setIdea] = useState('');
  const [version, setVersion] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');

  const sampleStats = useCallback((exp: Experiment): Stats => {
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
      deaths: { ...exp.deathsByCause },
      events: exp.recentEvents(14).map((e) => ({ tick: e.tick, type: e.type, actor: exp.nameOf(e.actorId) })),
    };
  }, []);

  const draw = useCallback((exp: Experiment) => {
    const canvas = canvasRef.current;
    const bg = bgRef.current;
    if (!canvas || !bg) return;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bg, 0, 0);
    for (const a of exp.agentInfos()) {
      if (!a.alive) continue;
      ctx.fillStyle = a.sick
        ? '#e0524d'
        : a.sleeping
          ? '#5b8bd0'
          : a.hungerCritical
            ? '#e09a3a'
            : '#43d18a';
      ctx.beginPath();
      ctx.arc(a.x * SCALE, a.y * SCALE, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const newExperiment = useCallback(() => {
    expRef.current = new Experiment({ seed, agentCount });
    bgRef.current = buildBackground();
    setStats(sampleStats(expRef.current));
    draw(expRef.current);
  }, [seed, agentCount, sampleStats, draw]);

  // Boot one experiment on mount.
  useEffect(() => {
    newExperiment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The run loop.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const loop = (): void => {
      const exp = expRef.current;
      if (exp) {
        exp.advance(speed);
        draw(exp);
        if (frame % 4 === 0) setStats(sampleStats(exp)); // throttle React updates
        frame++;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, speed, draw, sampleStats]);

  // App version + auto-update notifications (Electron only).
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
    const exp = expRef.current;
    const clean = idea.trim();
    if (!exp || !clean) return;
    exp.giveIdea(clean, 'all');
    setIdea('');
  }, [idea]);

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
              <button
                onClick={() => {
                  setRunning(false);
                  newExperiment();
                }}
              >
                New world
              </button>
            </div>
            <label>
              Seed
              <input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={running} />
            </label>
            <label>
              Population: {agentCount}
              <input type="range" min={20} max={300} step={10} value={agentCount} disabled={running} onChange={(e) => setAgentCount(Number(e.target.value))} />
            </label>
            <label>
              Speed: {speed} ticks/frame
              <input type="range" min={1} max={48} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
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
                  <tr><td>Builds</td><td>{stats.builds}</td><td>Deaths</td><td>{Object.values(stats.deaths).reduce((a, b) => a + b, 0)}</td></tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="idea">
            <label>Give them an idea (only you can)</label>
            <div className="row">
              <input
                value={idea}
                placeholder="e.g. water is by the river"
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendIdea()}
              />
              <button className="go" onClick={sendIdea}>Send</button>
            </div>
          </section>

          {stats && (
            <section className="feed">
              <label>Recent events</label>
              <ul>
                {stats.events
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li key={i}>
                      <span className="t">d{Math.floor(e.tick / 96) + 1}</span> {e.actor} · {e.type}
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
