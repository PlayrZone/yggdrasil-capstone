import { defineWorld } from '../../contract/adapter.js';
import type {
  ContextSchema,
  DriveSchema,
  EventRoleSchema,
  EventSchema,
  WorldAdapter,
  WorldSpec,
} from '../../contract/adapter.js';
import type { ActionBinding, KindSchema } from '../../contract/actions.js';
import type {
  ContextFeatureKey,
  ContextFeatures,
  ForagerKind,
  IntentKind,
  NeedKey,
  SimEventType,
} from './types.js';

/**
 * THE TYPO CHECK THE PLAIN-STRING IDS COST US, BOUGHT BACK (W1-B2 verifier §4).
 *
 * `EventId` and friends are plain `string` so that a world's literals flow into
 * the mind for free. The price was real: at `1df1842` a typo inside this
 * world's OWN table (`'AteFood'` → `'AtFood'`) failed `tsc`; afterwards only a
 * test caught it, and a second world would have had no test at all.
 *
 * This is where a world narrows its ids back to its own unions, at its own edge,
 * where a reader can see it. Every id the forager tables write — an event and
 * the event a ROLE records instead, a drive, a context feature and the slot it
 * reads, an action, a kind — is checked against the union it belongs to, and a
 * misspelling is a compile error again.
 */

type ForagerRole = Omit<EventRoleSchema, 'recordsAs'> & { readonly recordsAs?: SimEventType };

type ForagerEvent = Omit<EventSchema, 'id' | 'roles'> & {
  readonly id: SimEventType;
  readonly roles?: {
    readonly actor?: ForagerRole;
    readonly target?: ForagerRole;
    readonly bystander?: ForagerRole;
  };
};

type ForagerDrive = Omit<DriveSchema, 'id'> & { readonly id: NeedKey };

type ForagerContext = Omit<ContextSchema, 'id' | 'source'> & {
  readonly id: ContextFeatureKey;
  readonly source: keyof ContextFeatures;
};

type ForagerAction = Omit<ActionBinding, 'id'> & { readonly id: IntentKind };

type ForagerKindSchema = Omit<KindSchema, 'id'> & { readonly id: ForagerKind };

export type ForagerWorldSpec = Omit<WorldSpec, 'drives' | 'context' | 'events' | 'actions' | 'kinds'> & {
  readonly drives: readonly ForagerDrive[];
  readonly context: readonly ForagerContext[];
  readonly events: readonly ForagerEvent[];
  readonly actions: readonly ForagerAction[];
  readonly kinds: readonly ForagerKindSchema[];
};

/** `defineWorld`, with this world's own vocabulary enforced by the compiler. */
export function defineForagerWorld(spec: ForagerWorldSpec): WorldAdapter {
  return defineWorld(spec);
}
