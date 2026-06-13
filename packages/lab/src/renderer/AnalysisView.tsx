import React from 'react';
import type { BeliefCluster, BeliefAccuracy, Archetype } from '@yggdrasil/engine';

export interface AnalysisSnapshot {
  diffusion: BeliefCluster[];
  accuracy: BeliefAccuracy;
  archetypes: { archetype: Archetype; count: number }[];
  cultureCount: number;
}

const ORIGIN = (c: BeliefCluster): string =>
  `${c.byExperience} learned · ${c.byObservation} saw · ${c.byTestimony} were told`;

/**
 * The research read-out: how knowledge has SPREAD across the population
 * (diffusion), how much of it is TRUE vs superstition (accuracy), which beliefs
 * have outlived their discoverer (culture), and what the population has DRIFTED
 * into behaviorally (archetypes). All post-hoc — never read back into the sim.
 */
export function AnalysisView({ snap }: { snap: AnalysisSnapshot | null }): React.ReactElement {
  if (!snap) {
    return <div className="analysis"><div className="aempty">Run the world a while, then come back — knowledge takes time to form and spread.</div></div>;
  }
  const { diffusion, accuracy, archetypes, cultureCount } = snap;
  const acc = accuracy.accuracy === null ? '—' : `${Math.round(accuracy.accuracy * 100)}%`;
  const maxArche = Math.max(1, ...archetypes.map((a) => a.count));
  const topBeliefs = diffusion.slice(0, 18);

  return (
    <div className="analysis">
      <div className="acards">
        <div className="acard"><b>{diffusion.length}</b><span>distinct beliefs held</span></div>
        <div className="acard"><b>{acc}</b><span>true (of verifiable)</span></div>
        <div className="acard"><b>{accuracy.falseBeliefs.length}</b><span>superstitions</span></div>
        <div className="acard culture"><b>{cultureCount}</b><span>cultural (outlived discoverer)</span></div>
      </div>

      <div className="acols">
        <section className="abeliefs">
          <label>Knowledge diffusion — what has spread, and how</label>
          <ul>
            {topBeliefs.map((c) => (
              <li key={c.ruleKey}>
                <div className="brow">
                  <span className="bstmt">{c.statement}</span>
                  <span className={`btruth ${c.truth}`}>{c.truth === 'true' ? '✓' : c.truth === 'false' ? '✗' : '?'}</span>
                </div>
                <div className="bmeta">
                  <span className="bcount">{c.livingHolders} hold it</span>
                  <span className="borigin">{ORIGIN(c)}</span>
                  {c.outlivedOriginator && <span className="bculture">culture</span>}
                </div>
              </li>
            ))}
            {topBeliefs.length === 0 && <li className="empty">No held beliefs yet.</li>}
          </ul>
        </section>

        <section className="aarche">
          <label>Behavioral archetypes (emergent — never assigned)</label>
          <ul>
            {archetypes.map((a) => (
              <li key={a.archetype}>
                <span className="aname">{a.archetype}</span>
                <span className="abar"><i style={{ width: `${(a.count / maxArche) * 100}%` }} /></span>
                <span className="anum">{a.count}</span>
              </li>
            ))}
            {archetypes.length === 0 && <li className="empty">Too little behavior to classify yet.</li>}
          </ul>

          {accuracy.falseBeliefs.length > 0 && (
            <>
              <label style={{ marginTop: 16 }}>Superstitions (false, yet believed)</label>
              <ul className="asuper">
                {accuracy.falseBeliefs.slice(0, 8).map((c) => (
                  <li key={c.ruleKey}><span>{c.statement}</span><b>{c.livingHolders}</b></li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
