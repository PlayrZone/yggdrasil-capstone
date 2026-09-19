import React from 'react';

/**
 * What the pointer is on — and, when several beings share those few pixels,
 * which of them.
 *
 * This is the replacement for five rounds of trying to make a pictogram
 * readable in a crowd. The card does not guess: the view hands up EVERY being
 * under the cursor, exactly identified by instance id, and if there is more
 * than one they are all listed with the current choice marked. The highlighted
 * being in the 3D view is always the one this card is describing — that is the
 * property the whole feature rests on, and the one a driver checks.
 */

export interface HoverCardData {
  id: number;
  name: string;
  /** False when the name is a lab designation — drawn with a dotted underline. */
  selfChosen: boolean;
  stage: string;
  condition: string;
  activity: string;
  heading: string;
  headingDeg: number;
  goal: string | null;
  planAt: number;
  planOf: number;
  hunger: number;
  rest: number;
  distance: number;
  inFrame: boolean;
  visible: boolean;
  crowded: boolean;
  /** True while this being's own pictogram and arrow are withheld as unsafe. */
  marksHeld: boolean;
  specimen: boolean;
}

const CARD_W = 252;

/**
 * Sit beside the cursor, and flip rather than leave the window.
 *
 * Fixed positioning, in client coordinates — the same coordinates the pointer
 * arrives in — so the card never has to know what it is floating over. A card
 * clipped by the edge of the screen is a card that has hidden the answer at
 * exactly the moment you asked for it.
 */
function place(at: { x: number; y: number }, h: number): React.CSSProperties {
  const w = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  const right = at.x + 18 + CARD_W < w - 8;
  const below = at.y + 16 + h < vh - 8;
  return {
    position: 'fixed',
    left: right ? at.x + 18 : Math.max(8, at.x - 18 - CARD_W),
    top: below ? at.y + 16 : Math.max(8, at.y - 16 - h),
    width: CARD_W,
  };
}

/**
 * Need pressure, drawn the way the inspector draws it — same axis, same
 * thresholds, same colours. A bar that meant the opposite thing in two panels
 * of one instrument would be worse than no bar.
 */
function Need({ label, value }: { label: string; value: number }): React.ReactElement {
  const tone = value >= 85 ? '#e0524d' : value >= 60 ? '#e09a3a' : '#43d18a';
  return (
    <div className="hneed">
      <span>{label}</span>
      <span className="hbar"><i style={{ width: `${Math.max(2, value)}%`, background: tone }} /></span>
      <b>{value}</b>
    </div>
  );
}

/** A compass rose the size of a word: which way it faces, on screen. */
function Facing({ deg, word }: { deg: number; word: string }): React.ReactElement {
  return (
    <span className="hfacing">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <g transform={`rotate(${deg} 8 8)`}>
          <path d="M8 1.6 L11.1 9.2 L8 7.4 L4.9 9.2 Z" fill="#e8ddc9" stroke="#0a0e12" strokeWidth="0.9" strokeLinejoin="round" />
        </g>
      </svg>
      {word}
    </span>
  );
}

export function HoverCard({
  card,
  others,
  at,
  onPick,
}: {
  card: HoverCardData;
  /** Every being under the cursor, in offer order. One entry means no ambiguity. */
  others: { id: number; name: string; stage: string }[];
  at: { x: number; y: number };
  onPick: (id: number) => void;
}): React.ReactElement {
  const many = others.length > 1;
  return (
    <div
      className="hovercard"
      style={place(at, many ? 330 : 190)}
      role="tooltip"
      aria-live="polite"
    >
      <div className="hhead">
        <b className={card.selfChosen ? 'named' : 'given'}>{card.name}</b>
        <span>{card.stage}</span>
      </div>
      <div className="hline">
        <span className={`hcond c-${card.condition.replace(/\s+/g, '-')}`}>{card.condition}</span>
        <span className="hact">{card.activity}</span>
        <Facing deg={card.headingDeg} word={card.heading} />
      </div>
      {card.goal !== null && (
        <div className="hgoal">
          plan <b>{card.goal}</b>
          {card.planOf > 0 && <span> · step {card.planAt} of {card.planOf}</span>}
        </div>
      )}
      {card.specimen && <div className="hnote">specimen · a display of the vocabulary, not a life</div>}
      <div className="hneeds">
        <Need label="hunger" value={card.hunger} />
        <Need label="rest" value={card.rest} />
      </div>
      <div className="hfoot">
        <span>{card.distance < 1000 ? `${card.distance.toFixed(0)} m` : `${(card.distance / 1000).toFixed(1)} km`} from centre</span>
        {card.crowded && <span className="hwarn">counted by a crowd chip</span>}
        {!card.crowded && card.marksHeld && <span className="hwarn">too close to a neighbour to mark</span>}
      </div>
      {many && (
        <div className="hstack">
          <label>{others.length} here — ↑↓ to step through</label>
          <ul>
            {others.map((o) => (
              <li key={o.id}>
                <button
                  className={o.id === card.id ? 'sel' : ''}
                  onMouseDown={(e) => { e.preventDefault(); onPick(o.id); }}
                  onMouseEnter={() => onPick(o.id)}
                >
                  {o.name}<em>{o.stage}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What a crowd chip is made of, shown where the chip is. The same three
 * answers the card gives for one being, for a group: how many, in what state,
 * doing what.
 */
export function ChipCard({
  summary,
  at,
}: {
  summary: {
    count: number;
    matched: number;
    filtering: boolean;
    mix: { word: string; count: number; color: string }[];
    activities: { word: string; count: number }[];
  };
  at: { x: number; y: number };
}): React.ReactElement {
  return (
    <div className="hovercard chipcard" style={place(at, 30 + summary.mix.length * 17 + summary.activities.length * 17)} role="tooltip">
      <div className="hhead">
        <b>{summary.count} together</b>
        {summary.filtering && <span>{summary.matched} match</span>}
      </div>
      <ul className="hmix">
        {summary.mix.map((m) => (
          <li key={m.word}><i style={{ background: m.color }} />{m.word}<b>{m.count}</b></li>
        ))}
      </ul>
      <ul className="hacts">
        {summary.activities.map((a) => (
          <li key={a.word}>{a.word}<b>{a.count}</b></li>
        ))}
      </ul>
      <div className="hfoot"><span>click to frame them</span></div>
    </div>
  );
}
