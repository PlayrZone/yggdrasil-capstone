import React from 'react';
import type { CultureReport, MythReport } from '@yggdrasil/engine';

/**
 * Culture: not how MUCH a tribe knows, but WHAT — its shared beliefs, its
 * superstitions, and its stories. Two tribes in one world, believing different
 * things. Analysis only; the simulation never contains a "culture".
 */
export function CultureView({ culture, myth }: { culture: CultureReport | null; myth: MythReport | null }): React.ReactElement {
  if (!culture) {
    return <div className="analysis"><div className="aempty">Culture needs tribes that have lived and learned a while — run the world, then return.</div></div>;
  }
  const { tribes, divergence, mostDivergent, tribeStories, topStory, labels } = culture;

  return (
    <div className="analysis society">
      <section className="detections">
        <label>What the observatory detects</label>
        {labels.length ? <ul>{labels.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="empty">No distinct cultures yet.</p>}
      </section>

      <div className="acards">
        <div className="acard"><b>{Math.round(divergence * 100)}%</b><span>cultural divergence between tribes</span></div>
        <div className="acard"><b>{tribes.filter((t) => t.falseCount > 0).length}</b><span>tribes holding superstitions</span></div>
        <div className="acard"><b>{tribeStories.filter((t) => t.stories.length).length}</b><span>tribes with shared stories</span></div>
        <div className="acard culture"><b>{topStory?.holders ?? 0}</b><span>carry the most-told story</span></div>
      </div>

      {mostDivergent && (
        <section style={{ marginTop: 16 }}>
          <label>Two cultures, one world (most-divergent tribes)</label>
          <div className="acols">
            <div style={{ flex: 1 }}>
              <div className="aname">A tribe of {mostDivergent.aSize} believes:</div>
              <ul className="culture-list">{mostDivergent.aOnly.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div style={{ flex: 1 }}>
              <div className="aname">Another of {mostDivergent.bSize} instead believes:</div>
              <ul className="culture-list">{mostDivergent.bOnly.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          </div>
        </section>
      )}

      <div className="acols" style={{ marginTop: 16 }}>
        <section className="abeliefs">
          <label>Tribe beliefs (true vs superstition)</label>
          <ul>
            {tribes.slice(0, 8).map((t, i) => (
              <li key={i}>
                <div className="brow"><span className="bstmt">tribe of {t.size}</span><span className="bcount">{t.trueCount}✓ {t.falseCount}✗</span></div>
                {t.superstitions.length > 0 && <div className="bmeta"><span style={{ color: '#e0524d' }}>superstition: “{t.superstitions[0]}”</span></div>}
              </li>
            ))}
          </ul>
        </section>

        <section className="aarche">
          <label>Shared stories (narrative identity)</label>
          {topStory && <p style={{ color: '#e6c98a', fontSize: 13, margin: '0 0 10px' }}>Most-told: “{topStory.text}” — {topStory.holders} carry it</p>}
          <ul>
            {tribeStories.filter((t) => t.stories.length).slice(0, 8).map((t, i) => (
              <li key={i}><span className="aname">tribe of {t.size}</span><span className="anum">“{t.stories[0]}”</span></li>
            ))}
            {tribeStories.filter((t) => t.stories.length).length === 0 && <li className="empty">no shared stories yet</li>}
          </ul>
        </section>
      </div>

      {myth && (
        <>
          <section className="detections" style={{ marginTop: 16 }}>
            <label>Myth formation — how stories distort as they spread</label>
            {myth.labels.length ? <ul>{myth.labels.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="empty">Stories are still told faithfully.</p>}
          </section>
          <div className="acols">
            <section className="abeliefs">
              <label>One event, many versions {myth.mostVaried ? `(${myth.mostVaried.variants})` : ''}</label>
              <ul className="culture-list">
                {myth.mostVaried?.examples.map((e, i) => <li key={i}>“{e}”</li>)}
                {!myth.mostVaried && <li>no drift yet</li>}
              </ul>
              {myth.tribeVersions && (
                <>
                  <label style={{ marginTop: 12 }}>Tribes remember it differently</label>
                  <ul className="culture-list">{myth.tribeVersions.versions.map((v, i) => <li key={i}><b>tribe of {v.tribeSize}:</b> “{v.text}”</li>)}</ul>
                </>
              )}
            </section>
            <section className="aarche">
              <label>Heroes (deeds retold)</label>
              <ul>
                {myth.heroes.slice(0, 5).map((h, i) => <li key={i}><span className="aname">{h.name}</span><span className="anum">{h.mentions}</span></li>)}
                {myth.heroes.length === 0 && <li className="empty">none yet</li>}
              </ul>
              <label style={{ marginTop: 12 }}>Villains (attacks remembered)</label>
              <ul>
                {myth.villains.slice(0, 5).map((v, i) => <li key={i}><span className="aname" style={{ color: '#e0524d' }}>{v.name}</span><span className="anum">{v.mentions}</span></li>)}
                {myth.villains.length === 0 && <li className="empty">none yet</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
