import type { Transform2D } from '../core/Transform2D.js';
import type { Animal } from './../body/animals.js';
import { homePosition } from '../body/animals.js';
import type { ResourceNode } from '../body/ResourceNodeSystem.js';
import { regrowthCount } from '../body/ResourceNodeSystem.js';
import type { ActivityRegions } from '../world/activity.js';
import type { ObservedEntity, SettledView } from './RuntimeView.js';

/**
 * THE WORLD AS IT WOULD BE, FOR A READER WHO IS NOT STANDING IN IT.
 *
 * Activity regions are honest about beings: nothing a being can perceive
 * depends on which tiles were stepped (`world/activity.ts`). They were NOT
 * honest about instruments. `resourceNodes()`, the lab's world view and the
 * continent golden all read the raw components, so a bush in a tile nobody had
 * visited for a season showed the stock it had a season ago — and the golden
 * therefore locked the activation SCHEDULE rather than the behaviour.
 *
 * This applies the same closed forms the tile itself would apply on waking —
 * `regrowthCount` for a node, the home-range loop for an animal — WITHOUT
 * activating anything and without writing a single field. Two runs at
 * different activation radii present the same settled world, which is what
 * `test/continent-golden.test.ts` records at two radii and compares.
 *
 * It speaks for the LAST TICK SIMULATED, not the next one: a tile stepped on
 * tick T holds exactly what this returns for T, so an active tile reads back
 * unchanged and only a dormant one is caught up.
 */
export class SettledWorld implements SettledView {
  constructor(
    private readonly tiles: ActivityRegions,
    private readonly clock: { readonly tick: number },
  ) {}

  get tick(): number {
    return Math.max(0, this.clock.tick - 1);
  }

  stockOf(entity: ObservedEntity): number {
    const node = entity.components['ResourceNode'] as ResourceNode | undefined;
    if (!node) return 0;
    const deficit = node.maxStock - node.stock;
    if (node.regrowEvery <= 0 || deficit <= 0) return node.stock;
    const t = entity.components['Transform2D'] as Transform2D | undefined;
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return node.stock;
    const from = this.tiles.lastStepped(this.tiles.tileOf(t.x, t.y));
    return node.stock + regrowthCount(node.kind, node.regrowEvery, from, this.tick, deficit);
  }

  positionOf(entity: ObservedEntity): { x: number; y: number } | undefined {
    const t = entity.components['Transform2D'] as Transform2D | undefined;
    if (!t) return undefined;
    const animal = entity.components['Animal'] as Animal | undefined;
    // A predator with quarry is legitimately off its loop; its stored position
    // is the true one, and it is in a tile a being is standing in anyway.
    if (animal?.home && animal.targetId === 0) return homePosition(animal.home, this.tick);
    return { x: t.x, y: t.y };
  }
}
