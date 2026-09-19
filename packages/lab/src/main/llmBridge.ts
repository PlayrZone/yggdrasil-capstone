import { buildThinkPrompt, decodeThinkInputPlaces, foragerEdges, retryPrompt } from '@yggdrasil/engine';
import type { SpaceCodec, ThinkInput, ThinkPrompt, WorldEdges } from '@yggdrasil/engine';
import { guardLlmComplete, type Check, type PlacePredicate, type RateLimiter, type ThinkPromptShape } from './ipcGuards.js';

const OK: Check = { ok: true };
const fail = (reason: string): Check => ({ ok: false, reason });

/**
 * THE WORLDS MAIN CAN REBUILD A PROMPT FOR.
 *
 * Since engine W1-B3 a prompt's verb list is the ADAPTER's, so rebuilding one
 * requires knowing which world it was composed for. The renderer says which
 * (`llm-request.worldId`), and a renderer-supplied id is exactly the kind of
 * thing that must not become a free parameter: an unknown one is REFUSED, never
 * defaulted, because defaulting would let a compromised renderer name a world
 * whose prompt happens to match whatever text it wants billed.
 *
 * Both lab scenarios (`forager-classic`, `forager-continent`) run the forager
 * continent, so there is one entry today. A second world adds a line here and
 * cannot reach this endpoint until it does.
 */
const WORLDS: ReadonlyMap<string, WorldEdges> = new Map([[foragerEdges.adapter.id, foragerEdges]]);

/** The one place a renderer-supplied id becomes a world, or stays nothing. */
function resolveWorld(worldId: unknown): WorldEdges | undefined {
  return typeof worldId === 'string' ? WORLDS.get(worldId) : undefined;
}

const hasOwn = Object.prototype.hasOwnProperty;

/** The two things about a world's space this edge needs. */
type PlaceSpace = Pick<SpaceCodec, 'fields' | 'isPlace'>;

/**
 * IS THIS A PLACE A BEING IS AT — which is a STRICTER question than the one
 * the world answers, and the difference is deliberate.
 *
 * `space.isPlace` accepts a HALF-WRITTEN place on purpose: a model can write
 * `{"kind":"MoveTo","x":5}`, and the body's refusal of that half-written act is
 * an event the being remembers. That permissiveness is right for an INTENT
 * ARGUMENT and wrong for a ThinkInput — a being is never half-somewhere. Its
 * position, the site a story pulls it toward, the places a tragedy makes it
 * shun: each is written with every field the world declares it writes a place
 * with. So the edge asks the world its own question AND requires the world's
 * own `fields` to all be there.
 *
 * World-agnostic in shape: a world whose place is one named `spot` gets
 * `spot` required, for free, the day it registers above. The field reads are
 * own-property only — an inherited `x` is not a coordinate this being has —
 * and wrapped, so a trapping object is a refusal rather than an exception.
 */
export function placeAt(space: PlaceSpace): PlacePredicate {
  return (value: unknown): boolean => {
    try {
      if (!space.isPlace(value)) return false;
      const held = value as Record<string, unknown>;
      return space.fields.every((field) => hasOwn.call(held, field.id) && held[field.id] !== undefined);
    } catch {
      return false;
    }
  };
}

/**
 * The slice of `IMindBackend` this bridge uses — so a test can hand it a fake
 * and assert what was forwarded without a network call or an API key.
 */
export interface CompletionBackend {
  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string>;
}

/**
 * UTF-8 bytes of rejection feedback a retry may carry. Real ones are a line:
 * the engine's schema errors are fixed sentences, and the few that quote the
 * model back (`invalid intent kind: …`) quote one field. A pathological reply
 * that pushed one past this is refused here, which `LlmMind` sees as a failed
 * second attempt and answers with reflex for that tick — degraded, never a
 * crash and never a charge.
 */
export const RETRY_ERROR_MAX = 2 * 1024;

/**
 * The fixed text `retryPrompt` wraps a rejection reason in, recovered from the
 * engine's own function rather than copied: a sentinel goes in where the error
 * belongs and the two halves fall out either side. So a reworded retry keeps
 * working here by construction — and a test pins the literal wording, so if the
 * engine ever stops embedding the error verbatim (sentinel not found, halves
 * wrong) that breaks loudly instead of silently refusing every retry.
 */
/**
 * WRITTEN AS AN ESCAPE, NOT AS A RAW BYTE (W1-B4 verifier, round 2, attack 9).
 * The two U+0000 below were literal NULs in the source from `427573f` until
 * round 3. The runtime value is identical either way and `tsc` passed them
 * through verbatim, so nothing ever broke — but git treats a file with a NUL in
 * it as BINARY, so every change to this file, the paid-call edge, showed as
 * `Bin 7128 -> 9701 bytes` with no diff, no blame and nothing `git log -S`
 * could find. A test pins the bytes so it cannot quietly come back.
 *
 * The character itself is deliberate: it cannot occur in a rejection reason
 * (JSON text, and the engine's own error strings), so the two halves of the
 * wrapper can never be found inside the thing they wrap.
 */
const RETRY_SENTINEL = '\u0000<retry-error>\u0000';
const [RETRY_HEAD, RETRY_TAIL] = ((): [string, string] => {
  const framed = retryPrompt({ system: '', user: '' }, RETRY_SENTINEL).user;
  const at = framed.indexOf(RETRY_SENTINEL);
  return at < 0 ? [framed, ''] : [framed.slice(0, at), framed.slice(at + RETRY_SENTINEL.length)];
})();

/**
 * Bind the billed prompt back to the situation it claims to come from.
 *
 * Validation alone only says the prompt is WELL-FORMED. Main used to compose
 * the prompt itself, so the renderer could never choose what the key paid for;
 * now the renderer supplies the text, and a well-formed `{system, user}` of any
 * content up to the caps would turn the bridge into a general-purpose LLM proxy
 * on our key. So main rebuilds the prompt from the input with the engine's own
 * builder — the same pure function the worker called — and requires a match.
 *
 * `buildThinkPrompt` is reproducible here: it is a pure render of `input`, and
 * the only non-local thing it touches, `narrativeRefOf`, is a hash of a story
 * id with no store behind it. It reads no `relationships`, so the Map that
 * survives structured clone is not involved; every field it does read is one
 * `validateThinkInput` has already bounded.
 *
 * A retry is the one legal divergence: the engine appends its rejection feedback
 * to `prompt.user`, so a user string that is the built one plus exactly that
 * wrapper, around a bounded reason, is accepted too.
 */
export function bindPromptToInput(prompt: ThinkPromptShape, input: unknown, worldId: unknown): Check {
  const world = resolveWorld(worldId);
  // Said plainly, and differently from a mismatch: a world this build does not
  // have is a wiring fault, not an attempt to smuggle a prompt through.
  if (!world) return fail('unknown world');
  let built: ThinkPrompt;
  try {
    // THE PLACES IN THIS INPUT ARE WIRE DATA, AND HAVE TO BECOME THIS WORLD'S
    // OWN BEFORE THE PROMPT CAN BE REBUILT (W1-B4 round 3). A place is an opaque
    // handle whose whole state is private, so it does not survive the structured
    // clone that carried this input out of the sim worker and across IPC — what
    // arrives is the fields the world writes one as, which is exactly what
    // arrived before this step, when a place WAS those fields. `buildThinkPrompt`
    // asks `space.distance`/`direction`/`label`, and a world now refuses a place
    // it did not mint, so the decode is what keeps the rebuild possible at all —
    // and a field the world cannot read as a place yields no place, a prompt
    // that does not match, and a refusal, which is the right answer.
    built = buildThinkPrompt(decodeThinkInputPlaces(world.codec, input), world.adapter);
  } catch {
    // An input the structural validator tolerates but the builder cannot render
    // is one no legitimate prompt could have come from — the same refusal, and
    // deliberately the same words: the renderer learns nothing about why.
    return fail('prompt does not match input');
  }
  if (prompt.system !== built.system) return fail('prompt does not match input');
  if (prompt.user === built.user) return OK;

  const head = built.user + RETRY_HEAD;
  if (prompt.user.length < head.length + RETRY_TAIL.length) return fail('prompt does not match input');
  if (!prompt.user.startsWith(head) || !prompt.user.endsWith(RETRY_TAIL)) return fail('prompt does not match input');
  const reason = prompt.user.slice(head.length, prompt.user.length - RETRY_TAIL.length);
  // `retryPrompt` returns the base untouched for an empty reason, so a retry
  // wrapper around nothing is a shape the engine never emits.
  if (reason.length === 0 || Buffer.byteLength(reason, 'utf8') > RETRY_ERROR_MAX) return fail('prompt does not match input');
  return OK;
}

/**
 * The body of the `llm:complete` handler, lifted out of the Electron wiring so
 * it can be tested without an app instance.
 *
 * The key never appears here: the backend is built in main from the effective
 * key and handed over already armed, so nothing about it crosses IPC in either
 * direction. The thrown messages are a wire contract — the worker's LlmMind
 * reads `NO_LLM_KEY` / `RATE_LIMITED` / `BAD_THINK_PROMPT` / `BAD_THINK_INPUT`
 * verbatim after they round-trip through `llm-result` — so they are thrown as
 * written, with the guard's reason appended and nothing else.
 *
 * The binding step lives here rather than in `ipcGuards`, which stays pure and
 * engine-free; this module is where main is allowed to know what a prompt for a
 * given situation should say — and, since engine W1-B4, what a PLACE is. A
 * being's position is an opaque `PlaceRef` the guard cannot read, so the
 * world's own question, sharpened into the edge's by `placeAt`, is resolved
 * here and handed to the gate.
 *
 * THE WORLD IS RESOLVED FIRST, BUT REFUSED IN ITS OLD PLACE. The gate still
 * runs in the same order for the same reasons — token, prompt, input — so an
 * unknown world changes no code and no ordering: it reaches `bindPromptToInput`
 * exactly as before and is refused there, `BAD_THINK_PROMPT: unknown world`,
 * before a backend is ever asked for. What it cannot do is let a place through
 * unasked: with no world there is nobody to ask, and the call dies anyway.
 */
export async function llmComplete(
  rate: RateLimiter,
  getBackend: () => CompletionBackend | null,
  prompt: unknown,
  input: unknown,
  worldId: unknown,
): Promise<string> {
  const world = resolveWorld(worldId);
  const gate = guardLlmComplete(rate, prompt, input, { isPlace: world && placeAt(world.codec) });
  if (!gate.ok) throw new Error(gate.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : `${gate.code}: ${gate.reason}`);
  const bound = bindPromptToInput(gate.prompt, input, worldId);
  if (!bound.ok) throw new Error(`BAD_THINK_PROMPT: ${bound.reason}`);
  const backend = getBackend();
  if (!backend) throw new Error('NO_LLM_KEY');
  // `gate.prompt` rather than the caller's object: the copy the guard measured
  // and the binding checked is the one that gets billed. `input` is passed
  // through as validated — it is never re-composed into a prompt, by contract,
  // only read by backends that reason instead of transport.
  return backend.complete(gate.prompt, input as ThinkInput);
}
