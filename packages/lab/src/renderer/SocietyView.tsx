import React from 'react';
import type { SocietyReport } from '@yggdrasil/engine';

/**
 * The Influence layer: the observatory's detection of POSSIBLE institutions —
 * mentors, innovators, leaders, families, tribes, resource-holders. It only
 * labels patterns in the data; the simulation never contains these things.
 */
export function SocietyView({ society }: { society: SocietyReport | null }): React.ReactElement {
  if (!society) {
    return <div className="analysis"><div className="aempty">Run the world a while — institutions need repeated social interaction to form before they can be detected.</div></div>;
  }
  const { influence, mentors, innovators, families, tribes, propertyHolders, specialists, trustedSources, knowledgeLineages, labels } = society;

  return (
    <div className="analysis society">
      <section className="detections">
        <label>What the observatory detects (never asserts, never creates)</label>
        {labels.length ? (
          <ul>{labels.map((l, i) => <li key={i}>{l}</li>)}</ul>
        ) : (
          <p className="empty">No social structure has formed yet.</p>
        )}
      </section>

      <div className="acols">
        <section className="abeliefs">
          <label>Most influential (knowledge reach + teaching + social ties)</label>
          <ul>
            {influence.slice(0, 10).map((p) => (
              <li key={p.id}>
                <div className="brow"><span className="bstmt">{p.name}</span><span className="bcount">{p.score}</span></div>
                <div className="bmeta"><span>reach {p.reach}</span><span>taught {p.taught}</span><span>bonds {p.bonds}</span></div>
              </li>
            ))}
            {influence.length === 0 && <li className="empty">no influence signal yet</li>}
          </ul>
        </section>

        <section className="aarche">
          <label>Possible mentors (taught repeatedly)</label>
          <ul>
            {mentors.map((m) => <li key={m.id}><span className="aname">{m.name}</span><span className="anum">{m.lessons}L · {m.students}s</span></li>)}
            {mentors.length === 0 && <li className="empty">none yet</li>}
          </ul>

          <label style={{ marginTop: 14 }}>Possible innovators (discoveries that spread)</label>
          <ul>
            {innovators.map((i) => <li key={i.id}><span className="aname">{i.name}</span><span className="anum">{i.beliefs}b · {i.reach}</span></li>)}
            {innovators.length === 0 && <li className="empty">none yet</li>}
          </ul>

          <label style={{ marginTop: 14 }}>Possible trusted sources</label>
          <ul>
            {trustedSources.slice(0, 6).map((t) => <li key={t.id}><span className="aname">{t.name}</span><span className="anum">{t.trusters} trust</span></li>)}
            {trustedSources.length === 0 && <li className="empty">none yet</li>}
          </ul>

          <label style={{ marginTop: 14 }}>Possible specialists</label>
          <ul>
            {specialists.slice(0, 6).map((s) => <li key={s.id}><span className="aname">{s.name}</span><span className="anum">{s.archetype}</span></li>)}
            {specialists.length === 0 && <li className="empty">none yet</li>}
          </ul>
        </section>
      </div>

      <div className="acards" style={{ marginTop: 16 }}>
        <div className="acard"><b>{families.length}</b><span>possible families {families[0] ? `(largest ${families[0].size})` : ''}</span></div>
        <div className="acard"><b>{tribes.length}</b><span>possible tribes {tribes[0] ? `(largest ${tribes[0].size})` : ''}</span></div>
        <div className="acard"><b>{knowledgeLineages}</b><span>knowledge lineages (taught down a family line)</span></div>
        <div className="acard culture"><b>{influence[0]?.name ?? '—'}</b><span>most influential</span></div>
      </div>
    </div>
  );
}
