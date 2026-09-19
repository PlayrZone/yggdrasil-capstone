/**
 * THE NEGATIVE CONTROL for `test/mind-type-graph.test.ts`. This file DOES reach
 * the forager world, so compiling it with `src/worlds/` stubbed out must fail —
 * which is what proves the stubbing works at all, rather than the proof merely
 * compiling a file that would compile anyway.
 */
import { foragerAdapter } from '../../src/worlds/forager/adapter.js';
import type { SimEventType } from '../../src/worlds/forager/types.js';

export function salienceOf(type: SimEventType): number {
  return foragerAdapter.eventById.get(type)?.salience ?? 0;
}
