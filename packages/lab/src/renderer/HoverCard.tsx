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
  /** Where the subject is on screen, and how much room it takes, in client px. */
  mark?: { x: number; y: number; r: number } | null;
}

const CARD_W = 252;

/**
 * Sit beside the cursor — and never on the being the card is about.
 *
 * Fixed positioning, in client coordinates, the same ones the pointer arrives
 * in. Two rules: the card stays inside the window, because a card clipped by
 * the edge of the screen has hidden the answer at the moment it was asked for;
 * and it keeps off its own subject, because a card that covers the being it
 * describes makes "which one is it?" unanswerable exactly when it matters.
 * Four placements are tried in order and the first that does both wins.
 */
export function placeCard(
  at: { x: number; y: number },
  h: number,
  avoid?: { x: number; y: number; r: number } | null,
  /**
   * The other beings this frame is offering, as the points a reader would aim
   * at. A card that covers them has taken them off the screen for as long as it
   * is open — in one measured MID frame it sat on 6 of 13 — and the mouse
   * cannot reach them without moving away first, which closes the card.
   */
  others?: readonly { x: number; y: number }[],
): React.CSSProperties {
  const w = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  const slots = [
    { left: at.x + 18, top: at.y + 16 },
    { left: at.x - 18 - CARD_W, top: at.y + 16 },
    { left: at.x + 18, top: at.y - 16 - h },
    { left: at.x - 18 - CARD_W, top: at.y - 16 - h },
    { left: at.x - CARD_W / 2, top: at.y - 24 - h },
    { left: at.x - CARD_W / 2, top: at.y + 24 },
  ];
  const clearsSubject = (slot: { left: number; top: number }): boolean => {
    if (!avoid) return true;
    const nearestX = Math.max(slot.left, Math.min(avoid.x, slot.left + CARD_W));
    const nearestY = Math.max(slot.top, Math.min(avoid.y, slot.top + h));
    const reach = avoid.r + 4;
    return (nearestX - avoid.x) ** 2 + (nearestY - avoid.y) ** 2 > reach * reach;
  };
  const covers = (slot: { left: number; top: number }): number => {
    if (!others) return 0;
    let n = 0;
    for (const p of others) {
      if (p.x >= slot.left && p.x <= slot.left + CARD_W && p.y >= slot.top && p.y <= slot.top + h) n++;
    }
    return n;
  };
  // The subject's own clearance is not negotiable — a card over the being it
  // describes makes "which one is it?" unanswerable exactly when it is asked.
  // Among the slots that clear it, the one that buries the fewest of its
  // neighbours wins; ties keep the order above, which is the reader's habit.
  let best: { left: number; top: number } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let anyInside: { left: number; top: number } | null = null;
  for (const slot of slots) {
    const inside = slot.left >= 8 && slot.left + CARD_W <= w - 8 && slot.top >= 8 && slot.top + h <= vh - 8;
    if (!inside) continue;
    if (!anyInside) anyInside = slot;
    if (!clearsSubject(slot)) continue;
    const score = covers(slot);
    if (score < bestScore) {
      bestScore = score;
      best = slot;
      if (score === 0) break;
    }
  }
  const chosen = best ?? anyInside ?? {
    left: Math.max(8, Math.min(w - 8 - CARD_W, at.x + 18)),
    top: Math.max(8, Math.min(vh - 8 - h, at.y + 16)),
  };
  return { position: 'fixed', left: chosen.left, top: chosen.top, width: CARD_W };
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
  offeredPoints,
}: {
  card: HoverCardData;
  /** Every being under the cursor, in offer order. One entry means no ambiguity. */
  others: { id: number; name: string; stage: string }[];
  at: { x: number; y: number };
  onPick: (id: number) => void;
  /** Where the frame's other offered beings are, so the card can miss them. */
  offeredPoints?: readonly { x: number; y: number }[];
}): React.ReactElement {
  const many = others.length > 1;
  return (
    <div
      className="hovercard"
      style={placeCard(at, many ? 330 : 190, card.mark, offeredPoints)}
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

/** How many occupants a shelter's card names before it stops listing. */
const CHIP_NAMES_MAX = 24;

/**
 * What a crowd chip is made of, shown where the chip is. The same three
 * answers the card gives for one being, for a group: how many, in what state,
 * doing what.
 *
 * A SHELTER's chip also names them. The people inside a building have had
 * their rings, badges and arrows taken away so the hut does not fill with a
 * scribble, and they are not given names over the world either — the chip is
 * their one label, so the chip has to be able to say who they are.
 */
export function ChipCard({
  summary,
  at,
  onPick,
  onHold,
}: {
  summary: {
    count: number;
    matched: number;
    filtering: boolean;
    /** True where the chip is a building speaking for the people inside it. */
    inside?: boolean;
    mix: { word: string; count: number; color: string }[];
    activities: { word: string; count: number }[];
    /** Who they are — listed only for a shelter, whose occupants have no names drawn. */
    names?: { id: number; name: string; condition?: string }[];
  };
  at: { x: number; y: number };
  /**
   * Selecting one of the people in here.
   *
   * The occupants of a shelter are not offered under the pointer — the chip is
   * what stands for them, and a chip that stands for somebody has to be the way
   * to reach them. This list is that way.
   */
  onPick?: (id: number) => void;
  /** The pointer is on the card: hold it open, whatever the chip says. */
  onHold?: (held: boolean) => void;
}): React.ReactElement {
  const names = summary.inside ? (summary.names ?? []).slice(0, CHIP_NAMES_MAX) : [];
  const more = summary.inside ? (summary.names ?? []).length - names.length : 0;
  return (
    <div
      className="hovercard chipcard"
      style={placeCard(at, 30 + summary.mix.length * 17 + summary.activities.length * 17 + (names.length > 0 ? 34 + Math.ceil(names.length / 2) * 15 : 0))}
      role="tooltip"
    >
      <div className="hhead">
        <b>{summary.count}{summary.inside ? ' inside this shelter' : ' together'}</b>
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
      {names.length > 0 && (
        <div
          className="hwho"
          onPointerEnter={() => onHold?.(true)}
          onPointerLeave={() => onHold?.(false)}
        >
          <label>who is in here — click a name to select</label>
          <ul>
            {names.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={n.condition && n.condition !== 'well' ? `c-${n.condition.replace(/\s+/g, '-')}` : ''}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onPick?.(n.id); }}
                >
                  {n.name}
                  {n.condition && n.condition !== 'well' && <em>{n.condition}</em>}
                </button>
              </li>
            ))}
            {more > 0 && <li className="hmore">+{more} more</li>}
          </ul>
        </div>
      )}
      <div className="hfoot"><span>click the number to frame them</span></div>
    </div>
  );
}
