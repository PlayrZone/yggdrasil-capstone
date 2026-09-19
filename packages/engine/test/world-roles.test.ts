import { describe, expect, it } from 'vitest';
import { CraftObservationMiner } from '../src/learning/CraftObservationMiner.js';
import { SocialMiner } from '../src/learning/SocialMiner.js';
import { importanceOf } from '../src/memory/importance.js';
import type { MemoryRecord } from '../src/contract/types.js';
import type { SimEventType } from '../src/worlds/forager/types.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import {
  EVENT_IDS,
  WasCraftObservationMiner,
  WasSocialMiner,
} from './fixtures/foragerTablesBefore.js';

function mem(tick: number, type: SimEventType): MemoryRecord {
  return {
    id: tick * 100 + EVENT_IDS.indexOf(type),
    tick,
    type,
    subjects: [],
    context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
    needDeltas: {},
    outcome: 'neutral',
    summaryText: type,
    importance: importanceOf(foragerAdapter, type, {}),
    origin: 'experience',
  };
}

/**
 * W1-B2: the two miners that used to switch on this world's event NAMES now
 * read the roles the adapter declares. Both halves are pinned — the tag data
 * (so changing one reddens a test) and the BEHAVIOUR, by running the verbatim
 * "before" miner and the new one over the same memories, across every event id
 * the world has, and demanding identical reports.
 */
describe('the miners read roles, and the roles say what the names said', () => {
  it('tags exactly the events the social miner switched on, in declaration order', () => {
    expect(foragerAdapter.events.filter((e) => e.social).map((e) => [e.id, e.social])).toEqual([
      ['ReceivedItem', 'received'],
      ['GaveItem', 'gave'],
      ['WasAttacked', 'harmed'],
      ['AttackedAgent', 'harmedOther'],
      ['UtteranceSpoken', 'engaged'],
    ]);
  });

  it('marks exactly the one event that shows a making, and where to read it', () => {
    expect(foragerAdapter.events.filter((e) => e.demonstrates).map((e) => e.id)).toEqual(['Crafted']);
    expect(foragerAdapter.eventById.get('Crafted')!.demonstrates).toEqual({
      output: 'objectKind',
      inputs: 'craftInputs',
    });
  });

  /**
   * Two partners, so the per-partner tallies are exercised separately: a gift
   * answered inside the reciprocation window, one answered outside it, one
   * never answered, blows in both directions, words, and every other event id
   * the world has — which must all fall through to nothing.
   */
  function socialStream(): MemoryRecord[] {
    const out: MemoryRecord[] = [];
    let id = 1;
    const at = (tick: number, type: SimEventType, subjects: number[]): MemoryRecord => ({
      ...mem(tick, type),
      id: id++,
      tick,
      subjects,
    });
    out.push(at(0, 'GaveItem', [7]), at(100, 'ReceivedItem', [7])); // answered in the window
    out.push(at(200, 'GaveItem', [7]), at(3000, 'ReceivedItem', [7])); // answered too late
    out.push(at(3100, 'GaveItem', [7])); // never answered
    out.push(at(3200, 'UtteranceSpoken', [7]), at(3300, 'AttackedAgent', [7]));
    out.push(at(3400, 'WasAttacked', [8]), at(3500, 'ReceivedItem', [8]), at(3600, 'ReceivedItem', [8]));
    out.push(at(3700, 'GaveItem', [7, 8])); // one act, two partners
    let tick = 4000;
    for (const type of EVENT_IDS) out.push(at((tick += 10), type, [7, 8]));
    return out;
  }

  it('mines the same social contingencies the name switch mined', () => {
    for (const level of ['off', 'compact', 'full'] as const) {
      const was = new WasSocialMiner(level);
      const now = new SocialMiner(foragerAdapter, level);
      for (const memory of socialStream()) {
        was.observe(memory);
        now.observe(memory);
      }
      expect(now.consolidate(), level).toEqual(was.consolidate());
    }
  });

  it('mines the same recipes the `type === Crafted` guard mined', () => {
    for (const level of ['off', 'compact', 'full'] as const) {
      const was = new WasCraftObservationMiner(level);
      const now = new CraftObservationMiner(foragerAdapter, level);
      let id = 1;
      const stream: MemoryRecord[] = [];
      for (let i = 0; i < 4; i++) {
        for (const origin of ['experience', 'observation', 'testimony'] as const) {
          // A making, and — the point of the guard — every other event id
          // carrying the very same payload, which must teach nothing.
          for (const type of EVENT_IDS) {
            stream.push({
              ...mem(i * 100, type),
              id: id++,
              objectKind: 'spear',
              craftInputs: { wood: 1, stone: i + 1 },
              origin,
            });
          }
        }
      }
      // …and a making with nothing shown going in.
      stream.push({ ...mem(900, 'Crafted'), id: id++, objectKind: 'club' });
      for (const memory of stream) {
        was.observe(memory);
        now.observe(memory);
      }
      expect(now.consolidate(), level).toEqual(was.consolidate());
      expect(was.consolidate().length, level).toBeGreaterThan(0); // not vacuous
    }
  });

  it('is a comparison that can fail', () => {
    // The new miner reads the tag; a memory the world tags with nothing teaches
    // it nothing, which is exactly how the old `!== 'Crafted'` guard behaved.
    const now = new CraftObservationMiner(foragerAdapter);
    for (let i = 0; i < 6; i++) {
      now.observe({ ...mem(i * 10, 'GatherSucceeded'), objectKind: 'spear', craftInputs: { wood: 1 } });
    }
    expect(now.consolidate()).toEqual([]);
    const social = new SocialMiner(foragerAdapter);
    for (let i = 0; i < 6; i++) social.observe({ ...mem(i * 10, 'GatherSucceeded'), subjects: [7] });
    expect(social.consolidate()).toEqual([]);
  });
});
