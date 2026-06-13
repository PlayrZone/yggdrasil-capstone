import type { Traits } from './contract.js';
import { hashSeed, mulberry32 } from './prng.js';

/**
 * The canonical Gahallians. The same individuals, with the same names and the
 * same personalities, in EVERY run — they are not re-rolled per world. A run's
 * world seed decides where they are born and what they find; it never decides
 * WHO they are. Identity i is always the same person.
 *
 * Names + traits are pure functions of the index, so the roster is identical
 * across processes and runs without hand-maintaining a giant literal list.
 */
export interface Identity {
  /** Stable index — identity 0 is always the same individual. */
  readonly index: number;
  readonly name: string;
  readonly traits: Traits;
}

const A = ['Ka', 'Mi', 'To', 'Sa', 'El', 'Ru', 'Ha', 'Ny', 'Or', 'Ve', 'Ja', 'Li', 'Da', 'Fe', 'Go', 'Su', 'Ti', 'Bo', 'Ae', 'Wu'];
const B = ['ra', 'len', 'do', 'mir', 'sha', 'nu', 'vek', 'ti', 'gan', 'la', 'rin', 'os', 'mar', 'di', 'wen', 'kor', 'sel', 'pa', 'tha', 'vor'];
const C = ['', '', 'a', 'is', 'or', 'en', 'ka', 'we', 'in', 'us'];

/** Deterministic, collision-resistant name for a given identity index. */
function nameForIndex(i: number): string {
  // Spread the index across the three syllable tables with coprime strides so
  // distinct indices rarely collide; mix in a hash to break residual patterns.
  const h = hashSeed(`identity:${i}`);
  const a = A[(i * 7 + (h & 0xff)) % A.length]!;
  const b = B[(i * 13 + ((h >>> 8) & 0xff)) % B.length]!;
  const c = C[(i * 5 + ((h >>> 16) & 0xff)) % C.length]!;
  return a + b + c;
}

function traitsForName(name: string): Traits {
  const rng = mulberry32(hashSeed(`traits:${name}`));
  return {
    curiosity: Math.floor(rng() * 101),
    aggression: Math.floor(rng() * 101),
    compassion: Math.floor(rng() * 101),
    ambition: Math.floor(rng() * 101),
    loyalty: Math.floor(rng() * 101),
    riskTolerance: Math.floor(rng() * 101),
  };
}

/** Build the canonical roster, de-duplicating names with a numeral suffix. */
function buildRoster(size: number): Identity[] {
  const seen = new Map<string, number>();
  const out: Identity[] = [];
  for (let i = 0; i < size; i++) {
    let name = nameForIndex(i);
    const prior = seen.get(name);
    if (prior !== undefined) {
      seen.set(name, prior + 1);
      name = `${name} ${toRoman(prior + 1)}`;
    } else {
      seen.set(name, 1);
    }
    out.push({ index: i, name, traits: traitsForName(name) });
  }
  return out;
}

function toRoman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n] ?? String(n);
}

/** 256 canonical Gahallians — enough for any population the lab spawns. */
export const CANONICAL_IDENTITIES: readonly Identity[] = buildRoster(256);

/** Identity for a slot, wrapping if a run somehow exceeds the roster. */
export function identityAt(slot: number): Identity {
  return CANONICAL_IDENTITIES[slot % CANONICAL_IDENTITIES.length]!;
}
