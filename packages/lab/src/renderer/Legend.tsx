import React, { useState } from 'react';
import {
  hex,
  HUE_WELL,
  LEGEND_EXTRA,
  legendFor,
  RING_DASHED,
  RING_DOUBLE,
  RING_NOTCHED,
  type LegendItem,
  type LegendSection,
  type ZoomBand,
} from './beings.js';
import { PICTO_SVG } from './glyphs.js';

/**
 * The key to the map — for the band the camera is actually in.
 *
 * Every mark the world view can make right now is here and nothing else is. A
 * legend that lists an encoding the render is not currently using is a lie with
 * a swatch next to it, and that was the shape of both earlier rounds' worst
 * failures: a claim of constant marker size that broke three scroll-notches
 * out, and a row of activity badges in a view whose badges a reader could not
 * attach to a body. So this is generated from `legendFor(band)`, which is
 * generated from the same tables the renderer draws from, and it changes under
 * the reader's hand as the zoom changes.
 *
 * It is also small. What is always shown is the band's own contract. The rows
 * that never change — kin, the land, what the ground cover means — open when
 * asked.
 */

function Picto({ picto }: { picto: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 64 64" width="15" height="15" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill={hex(HUE_WELL)} />
      <path d={PICTO_SVG[picto] ?? ''} fill="#0a0e12" stroke="#0a0e12" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A ground marker, as the renderer builds it: the condition ring, the elder's
 * second ring outside it, the heading pointer, and the streak of a being on the
 * move. Same shapes, same proportions, same order.
 */
function Marker({ item }: { item: Extract<LegendItem, { kind: 'marker' }> }): React.ReactElement {
  const color = hex(item.hue);
  const cx = 15;
  const cy = 13;
  const r = 7.2 * item.footprint;
  const spikes: React.ReactElement[] = [];
  if (item.ring === RING_NOTCHED) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spikes.push(
        <path
          key={i}
          d={`M${cx + Math.cos(a - 0.17) * (r + 1.2)} ${cy + Math.sin(a - 0.17) * (r + 1.2)} `
            + `L${cx + Math.cos(a + 0.17) * (r + 1.2)} ${cy + Math.sin(a + 0.17) * (r + 1.2)} `
            + `L${cx + Math.cos(a) * (r + 4)} ${cy + Math.sin(a) * (r + 4)} Z`}
          fill="#e8ddc9"
        />,
      );
    }
  }
  return (
    <svg viewBox="0 0 30 32" width="17" height="18" aria-hidden="true">
      {item.streak && <path d={`M${cx - 2.6} ${cy + r} L${cx + 2.6} ${cy + r} L${cx + 0.7} ${cy + r + 13} L${cx - 0.7} ${cy + r + 13} Z`} fill={color} opacity="0.5" />}
      {spikes}
      {item.halo && <circle cx={cx} cy={cy} r={r + 3.1} fill="none" stroke="#e8ddc9" strokeWidth="1.5" />}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2.6" strokeDasharray={item.ring === RING_DASHED ? '3.4 2.6' : undefined} />
      {item.ring === RING_DOUBLE && <circle cx={cx} cy={cy} r={r * 0.42} fill="none" stroke={color} strokeWidth="2" />}
      {item.pointer && <path d={`M${cx - 2.7} ${cy - r - 0.4} L${cx + 2.7} ${cy - r - 0.4} L${cx} ${cy - r - 8.4} Z`} fill={color} />}
    </svg>
  );
}

function Dot(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" fill="#0a0e12" />
      <circle cx="8" cy="8" r="4.4" fill={hex(HUE_WELL)} />
    </svg>
  );
}

function Item({ item }: { item: LegendItem }): React.ReactElement {
  switch (item.kind) {
    case 'marker':
      return (
        <span className="litem">
          <Marker item={item} /> {item.label}
          {item.note && <em>· {item.note}</em>}
        </span>
      );
    case 'picto':
      return <span className="litem"><Picto picto={item.picto} /> {item.label}</span>;
    case 'dot':
      return <span className="litem"><Dot /> {item.label}</span>;
    case 'chip':
      return <span className="litem"><i className="swcount">12</i> {item.label}</span>;
    case 'swatch':
      return (
        <span className="litem">
          <i className="sw" style={{ background: item.color, borderRadius: item.round ? '50%' : '2px' }} /> {item.label}
        </span>
      );
    default:
      return <span className="litem quiet">{item.label}</span>;
  }
}

function Row({ section }: { section: LegendSection }): React.ReactElement {
  return (
    <>
      {section.name !== '' && <span className="lname">{section.name}</span>}
      {section.items.map((item, k) => <Item key={`${item.kind}-${item.label}-${k}`} item={item} />)}
    </>
  );
}

export function Legend({ band }: { band: ZoomBand }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const sections = legendFor(band);
  const half = Math.ceil(sections.length / 2);
  return (
    <div className="legend">
      <div className="lrow">
        {sections.slice(0, half).map((s, k) => <Row key={`${s.name}-${k}`} section={s} />)}
      </div>
      <div className="lrow">
        {sections.slice(half).map((s, k) => <Row key={`${s.name}-${k}`} section={s} />)}
        <button className="lmore" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'less' : 'more'}
        </button>
      </div>
      {open && (
        <div className="lrow">
          {LEGEND_EXTRA.map((s, k) => <Row key={`${s.name}-${k}`} section={s} />)}
        </div>
      )}
    </div>
  );
}
