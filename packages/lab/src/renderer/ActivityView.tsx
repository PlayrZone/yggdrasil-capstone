import React, { useEffect, useRef, useState } from 'react';
import { WORLD } from '@yggdrasil/engine';
import type { ActivityLine } from '../preload/index.js';

const MINI = 360;
const SCALE = MINI / WORLD;
const STATE_COLOR = ['#43d18a', '#e09a3a', '#5b8bd0', '#e0524d'];

/**
 * The live window into what the AI engineer (over MCP) is doing right now:
 * a streaming feed of every run/advance/idea/report, plus a minimap that
 * mirrors the latest agent-position snapshot the AI's run emitted.
 */
export function ActivityView(): React.ReactElement {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const lab = window.lab;
    if (!lab) return;
    void lab.recentActivity(150).then(setLines);
    return lab.onActivity((incoming) => setLines((prev) => [...prev, ...incoming].slice(-400)));
  }, []);

  // Draw the most recent snapshot that carried agent positions.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, MINI, MINI);
    const withAgents = [...lines].reverse().find((l) => l.agents && l.agents.length);
    if (!withAgents?.agents) return;
    for (const a of withAgents.agents) {
      ctx.fillStyle = STATE_COLOR[a.state] ?? STATE_COLOR[0]!;
      ctx.beginPath();
      ctx.arc(a.x * SCALE, a.y * SCALE, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [lines]);

  const live = lines.length > 0;

  return (
    <div className="activity">
      <div className="actmap">
        <canvas ref={canvasRef} width={MINI} height={MINI} className="world" />
        <p className="hint">
          {live ? "Mirroring the AI engineer's latest run snapshot." : 'No activity yet. When the AI engineer runs experiments, they appear here live.'}
        </p>
      </div>
      <div className="actfeed">
        <label>Live activity — what the AI engineer is doing</label>
        <ul>
          {[...lines].reverse().map((l, i) => (
            <li key={i} className={`act-${l.kind}`}>
              <span className="who">{l.actor}</span>
              <span className="sum">{l.summary}</span>
              {l.runId !== undefined && <span className="rid">run {l.runId}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
