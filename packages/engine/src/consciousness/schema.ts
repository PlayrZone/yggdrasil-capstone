import { kindsFor, planArguments } from '../contract/actions.js';
import type { ParamSchema } from '../contract/actions.js';
import type { WorldAdapter } from '../contract/adapter.js';
import type { Goal, Intent, MindOutput, SpeechAct, Utterance } from '../contract/types.js';

/**
 * Parse + validate raw LLM output into a MindOutput. The contract is strict
 * JSON; anything off-shape is rejected so a hallucinating model can't push
 * an invalid plan into the world. The Body still validates each intent
 * against physics afterward — this is the structural gate before that.
 *
 * VALIDITY, stated once and enforced here (audit 03 §5, §8 item 6). An output
 * is VALID iff all three hold:
 *
 *   1. **The JSON object IS the reply.** Bare (whitespace aside), or the whole
 *      content of one ``` fence. An object fished out of surrounding prose
 *      is rejected: the old scan from the first `{` to the last `}` spliced
 *      across unrelated braces and silently rewarded a model that ignored
 *      "JSON only".
 *   2. **Every field present is schema-legal** — unknown intent kinds, unknown
 *      speech acts and non-array plans are rejected, as before.
 *   3. **It DECIDES something**: at least one intent in `plan`, or at least one
 *      utterance that carries something to say. An explicit, schema-legal
 *      do-nothing (`[{"kind":"Idle"}]`) is a decision. `{}` is not, and neither
 *      is goals-or-thought-only: a wish is not an act. `parseMindOutput('{}')`
 *      used to score VALID, which is why "100% schema validity" measured
 *      nothing at all.
 *
 * Every rejection carries a stable `reason` code, which rides onto the cognition
 * record through `CognitionAttempt.error` — so a corpus can be scored by WHY its
 * rows were refused, not just how many were. The five rules below are the
 * round-2 answers to a review that showed the gate could be walked through.
 *
 * **CAPS ARE A LIMIT, NOT A TRIM.** 8 intents / 4 utterances / 6 goals is what
 * the engine executes from one decision. The old parser sliced to those caps
 * BEFORE validating, so `[8× Idle, {"kind":"LaunchNuke"}]` scored valid and a
 * 500-intent plan was quietly cut to 8 while the recorded raw kept all 500 —
 * a training corpus of answers nobody acted on. Now every element is validated,
 * whatever its index, and an array longer than the limit is REFUSED
 * (`plan-too-long`, `utterances-too-long`, `goals-too-long`, each naming the
 * limit and the length): a model that emits 500 intents has not obeyed the
 * contract, and truncating hides that from the gate that exists to measure it.
 * Element legality is checked first, so an illegal verb is reported as
 * `bad-intent` even in an over-long plan — the stronger statement about the
 * reply wins.
 *
 * **FENCES.** The tag is a delimiter the model chose, not a promise about the
 * body: ```` ```json ````, ```` ```JSON ````, ```` ```js ````, ```` ```JSON5 ````
 * and ```` ``` json ```` are all fences (any tag is), and the body must still
 * parse as JSON — a JSON5 body with trailing commas is `malformed-json`, which
 * is the truth. EVERY fence is tried, not just the first: a junk first block
 * used to reject a legal second one, and a revised second block was ignored.
 * Exactly one legal body is accepted; two or more is `ambiguous-fences` (the
 * parser will not pick which decision the being takes). The whole reply is
 * tried as a bare object FIRST, so backticks inside a JSON string are not a
 * fence. An unclosed final fence runs to the end of the text — that is a reply
 * cut off after its JSON, not a reply without JSON.
 *
 * **NUMBERS ARE NEVER SILENTLY DROPPED.** `{"kind":"MoveTo","x":1e999,"y":5}`
 * became `MoveTo{y:5}` — a different act than the one the model chose. Any
 * field this parser would carry through as a number (`x`, `y`, `targetId`,
 * `durationTicks`, `ruleRef`, and a goal's stringified `description`) rejects
 * with `bad-number` NAMING THE FIELD when it is present as a number the engine
 * cannot use: `NaN`, `±Infinity` (what `1e999` parses to), or a magnitude past
 * `Number.MAX_SAFE_INTEGER`, where the parsed value is no longer the literal
 * the model wrote. Absent, `null`, or any NON-number type is treated as ABSENT
 * and ignored, exactly as before: the model offered no number there, and the
 * Body validates the act against physics regardless. `-0` is finite and exact,
 * so it is kept as written.
 *
 * **AN ARG IS AS CLOSED AS THE VERB.** `kind` was checked against the closed
 * intent vocabulary and its ARGS were not, so two whole classes walked through
 * the gate the caps were closed on: `{"kind":"Build","buildKind":"tower"}`
 * parsed as a legal Build with the field SILENTLY DROPPED and the Body then
 * built a shelter (the model asked for a tower, a shelter appeared, and `raw`
 * and `parsedOutput` disagreed about the decision), while
 * `{"kind":"Eat","objectKind":"plutonium"}` was carried through by an unchecked
 * cast into a world with no such thing in it. Every enumerated arg —
 * `objectKind`, `buildKind`, a goal's `need` — is now checked against the same
 * closed vocabulary the prompt advertises, and a value outside it is refused as
 * `bad-arg` naming the field and what was written. Absent and `null` still mean
 * "offered nothing", as for numbers; everything else is a decision the parser
 * will not make on the model's behalf.
 *
 * **AN EMPTY MOUTH IS NOT A DECISION.** `name` and `thought` were trimmed and
 * `text` was not, so `{"speechAct":"inform","text":"   "}` counted as speech.
 * `text` and `narrativeRef` are now trimmed the same way (zero-width characters
 * included), and an utterance with nothing in it — no text, no `ruleRef`, no
 * `narrativeRef` — does not satisfy rule 3, so a reply made only of empty
 * speech is `no-decision`. The utterance itself is KEPT in the output rather
 * than deleted: the speech act is the model's, the stores decide what is
 * actually transmitted (`AgentMind.resolveSpeech`), and a parser that deletes
 * what a model wrote is the same silent mutation as the one above.
 *
 * **DUPLICATE KEYS ARE REFUSED, NOT RESOLVED.** `JSON.parse` keeps the last of
 * `{"plan":[…],"plan":[…]}`, so the being acted on a plan nobody saw, and the
 * same trick hides a verb inside an intent (`{"kind":"Attack","kind":"Idle"}`).
 * A cheap string-aware scan of the already-parsed text finds a repeated key at
 * any depth and rejects it (`duplicate-key`); keys are decoded before
 * comparison, so `"pl\u0061n"` does not smuggle a second `plan` past it. This
 * costs one linear pass and needs no dependency — cheaper than a class of
 * output the gate cannot otherwise see.
 *
 * **A PLACE LEAVES HERE AS THE MODEL WROTE IT** (W1-B4 round 4). This file is
 * the model's edge and it lives in a mind directory, so it may not hold the
 * thing that turns `x,y` into a place — holding a bound `decode` was the last
 * door, and the expensive one, because a mind that can MINT a place of known
 * coordinates recovers any place it is given from three `distance` calls. So an
 * act comes out of here carrying the world's own fields, and
 * `contract/wire.ts`'s `liftPlan` — run where a plan enters the world
 * (`SimRuntime.applyPlan`), the first point that holds the world's edges — is
 * where it becomes a place.
 *
 * The cost is that a `MindOutput` from THIS function is wire-shaped in its
 * places while one from a reflex policy carries handles, and `Intent` names
 * only the handle. The two shapes meet at `liftPlan`, which is a no-op on the
 * second, and at `encodeIntent`, which is a no-op on the first; no reader
 * between them touches a place (`AgentMind.applyOutput` resolves speech; the
 * recorder stores the wire form either way). Naming the difference in the type
 * would mean a second `MindOutput` threaded through `IMind`, `LlmMind` and the
 * scheduler for one optional field — more surface than the honest comment.
 */

const SPEECH_ACTS = new Set<SpeechAct>(['share-knowledge', 'share-episode', 'inform', 'request']);

/**
 * THE CLOSED VOCABULARIES AN INTENT ARG MAY DRAW ON — READ OFF THE WORLD
 * (W1-B3). `kind` was checked and its ARGS were not:
 * `{"kind":"Build","buildKind":"tower"}` parsed as a legal Build with the field
 * dropped, and the Body then built a shelter — the model asked for one thing, a
 * different thing happened, and `raw` and `parsedOutput` disagreed about what
 * had been decided. `objectKind` was worse: an unchecked cast carried
 * `"plutonium"` straight through into the world.
 *
 * The lists that closed those holes used to be typed out here, against one
 * world's unions. They are now the adapter's: which verbs exist is
 * `world.actions`, what an arg may name is the tag its `ParamSchema` filters on,
 * and which drives a goal may serve is `world.drives`. Same decisions, same
 * reason codes, same bytes — and a second world gets its own vocabulary for
 * free instead of being parsed against the forager continent's.
 *
 * DERIVED ONCE PER WORLD. A parse is on the hot path of every completion, and a
 * world is frozen, so the derivation is cached against the adapter identity.
 */
interface PlanArg {
  readonly id: string;
  /** Present for an enumerated arg; absent means it is read as a number. */
  readonly allowed?: ReadonlySet<string>;
  /** The clause a refusal ends with, after the action's own name. */
  readonly hint?: string;
  /**
   * Present for a PLACE (W1-B4): the wire fields this world writes one as, in
   * the order written, each read exactly as an argument of its own type would
   * be — so `x` then `y` on the forager plane, with the same `bad-number`
   * naming the same field.
   *
   * WHAT IS BUILT FROM THEM IS NOTHING, HERE (round 4). The parser used to hold
   * a bound `codec.decode` and hand back one opaque handle — the last door a
   * mind directory had onto a world's geometry, and the expensive one: a mind
   * that can MINT a place of known coordinates can triangulate any place it is
   * given out of three `distance` calls. So an act leaves this file carrying
   * the fields exactly as the model wrote them, and `contract/wire.ts`'s
   * `liftPlan` — called where a plan enters the world, which is the first point
   * that holds the world's edges — turns them into a place. Same numbers, same
   * refusals, same key order, same bytes.
   */
  readonly fields?: readonly PlanArg[];
}

interface Vocabulary {
  readonly actions: ReadonlySet<string>;
  /**
   * ORDER IS OBSERVABLE. Two illegal args in one intent produce two possible
   * refusals and the model is told about exactly one, so the order is the
   * world's stated rule (`planArguments`), not this file's habit.
   */
  readonly args: readonly PlanArg[];
  readonly needs: ReadonlySet<string>;
  readonly needHint: string;
}

const VOCABULARIES = new WeakMap<WorldAdapter, Vocabulary>();

function vocabularyOf(world: WorldAdapter): Vocabulary {
  const cached = VOCABULARIES.get(world);
  if (cached) return cached;
  const built: Vocabulary = {
    actions: new Set(world.actions.map((action) => action.id)),
    args: planArguments(world).map((param) => planArg(world, param)),
    needs: new Set(world.drives.map((drive) => drive.id)),
    needHint: `a goal serves one of ${world.drives.map((drive) => drive.id).join(', ')}`,
  };
  VOCABULARIES.set(world, built);
  return built;
}

function planArg(world: WorldAdapter, param: ParamSchema): PlanArg {
  if (param.type === 'place') {
    // The world DECLARES the fields a place is written as, beside the act that
    // takes one (`PlaceParam.fields`) — so the parser reads them without ever
    // holding the thing that turns them into a place.
    return { id: param.id, fields: param.fields.map((field) => planArg(world, field)) };
  }
  if (param.type === 'kind' || param.type === 'enum') {
    const values = param.type === 'kind' ? kindsFor(world, param) : [...param.values];
    return {
      id: param.id,
      allowed: new Set(values),
      hint: param.hint ?? `takes one of ${values.join(', ')}`,
    };
  }
  return { id: param.id };
}

/** What the engine executes from one decision. Past these the reply is refused. */
const PLAN_LIMIT = 8;
const UTTERANCE_LIMIT = 4;
const GOAL_LIMIT = 6;

/** Why an output was refused. Stable strings — corpora are scored on them. */
export type MindOutputRejection =
  | 'not-json'
  | 'truncated-json'
  | 'json-in-prose'
  | 'malformed-json'
  | 'not-an-object'
  | 'ambiguous-fences'
  | 'duplicate-key'
  | 'bad-goals'
  | 'bad-plan'
  | 'bad-intent'
  | 'bad-utterances'
  | 'bad-speech-act'
  | 'bad-number'
  | 'bad-arg'
  | 'plan-too-long'
  | 'utterances-too-long'
  | 'goals-too-long'
  | 'no-decision';

export class MindOutputError extends Error {
  constructor(
    readonly reason: MindOutputRejection,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'MindOutputError';
  }
}

/** How the JSON was recovered. `fenced` is a salvage: it is counted, not hidden. */
export type JsonSalvage = 'bare' | 'fenced';

export interface ParsedMindOutput {
  output: MindOutput;
  salvage: JsonSalvage;
}

/** Throws MindOutputError on any structural problem. */
export function parseMindOutput(raw: string, world: WorldAdapter): MindOutput {
  return parseMindOutputDetailed(raw, world).output;
}

/** As `parseMindOutput`, and says which acceptance path the text took. */
export function parseMindOutputDetailed(raw: string, world: WorldAdapter): ParsedMindOutput {
  const vocab = vocabularyOf(world);
  const bare = attempt(raw, vocab);
  if (bare.ok) return { output: bare.output, salvage: 'bare' };

  const bodies = fenceBodies(raw);
  if (bodies.length === 0) throw bare.error;

  const legal: MindOutput[] = [];
  const refused: MindOutputError[] = [];
  for (const body of bodies) {
    const tried = attempt(body, vocab);
    if (tried.ok) legal.push(tried.output);
    else refused.push(tried.error);
  }
  if (legal.length === 1) return { output: legal[0]!, salvage: 'fenced' };
  if (legal.length > 1) {
    throw new MindOutputError(
      'ambiguous-fences',
      `${legal.length} fenced blocks each hold a legal reply — send exactly one, so the decision is yours and not the parser's`,
    );
  }
  // The bare reading is in the running too: when the object sits OUTSIDE the
  // fence, "you buried it in prose" is the truth and "not-json" is not.
  throw deepest([...refused, bare.error]) ?? bare.error;
}

/** Does this utterance carry anything? Empty speech is not a decision (rule 3). */
export function utteranceHasContent(u: Utterance): boolean {
  return u.text !== undefined || u.ruleRef !== undefined || u.narrativeRef !== undefined;
}

type Attempt = { ok: true; output: MindOutput } | { ok: false; error: MindOutputError };

function attempt(text: string, vocab: Vocabulary): Attempt {
  try {
    return { ok: true, output: parseReply(text, vocab) };
  } catch (err) {
    if (err instanceof MindOutputError) return { ok: false, error: err };
    throw err;
  }
}

function parseReply(raw: string, vocab: Vocabulary): MindOutput {
  const text = jsonSpan(raw.trim());
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MindOutputError('malformed-json', 'JSON.parse refused it (a trailing comma, a quote style, a stray token)');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new MindOutputError('not-an-object', 'the reply is not a JSON object');
  }
  const repeated = repeatedKey(text);
  if (repeated !== null) {
    throw new MindOutputError(
      'duplicate-key',
      `"${repeated}" is given twice — JSON.parse keeps only the last, so the other would be acted on unseen`,
    );
  }
  const obj = data as Record<string, unknown>;

  const goals = parseGoals(obj['goals'], vocab);
  const plan = parsePlan(obj['plan'], vocab);
  const utterances = parseUtterances(obj['utterances']);
  if (plan.length === 0 && !utterances.some(utteranceHasContent)) {
    throw new MindOutputError(
      'no-decision',
      'chose no intent and said nothing — an empty reply is not a decision (Idle is one, and so is speech with something in it)',
    );
  }
  const name = readText(obj['name'], 24);
  const thought = readText(obj['thought'], 600);
  const out: MindOutput = { goals, plan, utterances };
  if (name !== undefined) out.name = name;
  if (thought !== undefined) out.thought = thought;
  return out;
}

/**
 * The one acceptance decision about the text itself: the trimmed text must BE
 * one JSON value, start to end. A top-level array is located only when it is
 * the whole reply — a `[` in prose is prose, and saying `not-json` about it is
 * more honest than pretending an object was buried there.
 */
function jsonSpan(body: string): string {
  const start = body.startsWith('[') ? 0 : body.indexOf('{');
  if (start < 0) throw new MindOutputError('not-json', 'no JSON object anywhere in the reply');
  const end = closingBracket(body, start);
  if (end < 0) throw new MindOutputError('truncated-json', 'the value is never closed — the reply was cut off mid-JSON');
  if (start !== 0 || end !== body.length - 1) {
    throw new MindOutputError('json-in-prose', 'the object is buried in prose — reply with JSON only, or a single ``` block');
  }
  return body.slice(start, end + 1);
}

/** Index of the bracket that closes the value opened at `start`, or -1. String-aware. */
function closingBracket(s: string, start: number): number {
  const open = s[start]!;
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

const TAG_CHAR = /[A-Za-z0-9_+.#-]/;

/**
 * The body of every ``` block, in the order written. Bodies are taken between
 * CONSECUTIVE delimiters rather than in disjoint pairs, so the json block of a
 * reply wrapped in an outer ```markdown fence is still offered; a final
 * unclosed fence runs to the end of the text. Junk bodies cost one failed parse
 * each — the caller decides which (if any) is the reply.
 */
function fenceBodies(raw: string): string[] {
  const delimiters: number[] = [];
  const bodyStarts: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const at = raw.indexOf('```', i);
    if (at < 0) break;
    delimiters.push(at);
    let j = at + 3;
    while (raw[j] === '`') j++;
    while (raw[j] === ' ' || raw[j] === '\t') j++;
    while (j < raw.length && TAG_CHAR.test(raw[j]!)) j++;
    while (raw[j] === ' ' || raw[j] === '\t') j++;
    if (raw[j] === '\r') j++;
    if (raw[j] === '\n') j++;
    bodyStarts.push(j);
    i = Math.max(j, at + 3);
  }
  const bodies: string[] = [];
  for (let k = 0; k + 1 < delimiters.length; k++) bodies.push(raw.slice(bodyStarts[k]!, delimiters[k + 1]!));
  if (delimiters.length % 2 === 1) bodies.push(raw.slice(bodyStarts[delimiters.length - 1]!));
  // A reply whose own text contains ``` (inside a `thought`, say) splits into
  // fragments above, so the span from the first delimiter to the last is
  // offered too — the block as the model fenced it. Only when no other
  // candidate already covers that text, so one block is never counted twice
  // and a single fenced reply can never read as ambiguous.
  if (delimiters.length > 2) {
    const outermost = raw.slice(bodyStarts[0]!, delimiters[delimiters.length - 1]!);
    if (!bodies.some((body) => body.trim() === outermost.trim())) bodies.push(outermost);
  }
  return bodies;
}

/**
 * The most informative refusal among several fence bodies: the one that got
 * furthest through the pipeline. The reason code is handed back to the model on
 * the retry, and "not-json" about a junk block teaches it nothing when its real
 * block was rejected for deciding nothing.
 */
const DEPTH: Record<MindOutputRejection, number> = {
  'not-json': 0,
  'truncated-json': 1,
  'json-in-prose': 2,
  'malformed-json': 3,
  'not-an-object': 4,
  'duplicate-key': 5,
  'bad-goals': 6,
  'bad-plan': 6,
  'bad-utterances': 6,
  'bad-intent': 7,
  'bad-speech-act': 7,
  'bad-number': 7,
  'bad-arg': 7,
  'plan-too-long': 8,
  'utterances-too-long': 8,
  'goals-too-long': 8,
  'no-decision': 9,
  'ambiguous-fences': 10,
};

function deepest(errors: MindOutputError[]): MindOutputError | null {
  let best: MindOutputError | null = null;
  for (const err of errors) {
    if (!best || DEPTH[err.reason] > DEPTH[best.reason]) best = err;
  }
  return best;
}

function parseGoals(value: unknown, vocab: Vocabulary): Goal[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MindOutputError('bad-goals', 'goals must be an array');
  const goals = value.map((g, i) => {
    const o = asObject(g, 'bad-goals', 'goal');
    const description = o['description'];
    if (typeof description === 'number') assertUsableNumber(description, 'description');
    const goal: Goal = {
      id: i,
      description: String(description ?? 'goal').slice(0, 120),
      createdTick: 0,
    };
    const need = readEnum(o, 'need', vocab.needs, vocab.needHint);
    if (need !== undefined) goal.need = need;
    return goal;
  });
  if (goals.length > GOAL_LIMIT) throw tooLong('goals-too-long', 'goals', goals.length, GOAL_LIMIT);
  return goals;
}

function parsePlan(value: unknown, vocab: Vocabulary): Intent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MindOutputError('bad-plan', 'plan must be an array');
  const plan: Intent[] = [];
  for (const item of value) {
    const o = asObject(item, 'bad-intent', 'intent');
    const kind = o['kind'];
    if (typeof kind !== 'string' || !vocab.actions.has(kind)) {
      throw new MindOutputError('bad-intent', `invalid intent kind: ${String(kind)}`);
    }
    // Written key by key in the world's argument order, so a recorded plan
    // keeps the field order it has always had on the wire.
    const intent = { kind } as Intent & Record<string, unknown>;
    for (const arg of vocab.args) {
      // A PLACE IS ITS OWN FIELDS, AND STAYS THEM (round 4). They are written
      // at the position the place param occupies, in the world's own order, so
      // the act reads `{kind,x,y,targetId}` — which is what the model wrote,
      // what the body has always been handed, and what a row stores.
      if (arg.fields) {
        for (const field of arg.fields) {
          const read = readArg(o, field, kind);
          if (read !== undefined) intent[field.id] = read;
        }
        continue;
      }
      const read = readArg(o, arg, kind);
      if (read !== undefined) intent[arg.id] = read;
    }
    plan.push(intent);
  }
  if (plan.length > PLAN_LIMIT) throw tooLong('plan-too-long', 'plan', plan.length, PLAN_LIMIT);
  return plan;
}

/**
 * ONE ARGUMENT, READ THE WAY THIS WORLD WRITES IT. A place's fields are read
 * one at a time by the loop above, in the world's order: the same numbers,
 * refused for the same reasons, naming the same field — and a HALF of one is
 * kept, because `{"kind":"MoveTo","x":5}` with no `y` is a thing a model writes
 * and the body has always been the one to answer for it.
 */
function readArg(o: Record<string, unknown>, arg: PlanArg, kind: string): unknown {
  return arg.allowed ? readEnum(o, arg.id, arg.allowed, `${kind} ${arg.hint}`) : readNumber(o, arg.id);
}

function parseUtterances(value: unknown): Utterance[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MindOutputError('bad-utterances', 'utterances must be an array');
  const out: Utterance[] = [];
  for (const item of value) {
    const o = asObject(item, 'bad-utterances', 'utterance');
    const speechAct = o['speechAct'];
    if (typeof speechAct !== 'string' || !SPEECH_ACTS.has(speechAct as SpeechAct)) {
      throw new MindOutputError('bad-speech-act', `invalid speechAct: ${String(speechAct)}`);
    }
    const u: Utterance = { speechAct: speechAct as SpeechAct };
    const targetId = readNumber(o, 'targetId');
    if (targetId !== undefined) u.targetId = targetId;
    const text = readText(o['text'], 240);
    if (text !== undefined) u.text = text;
    // Content is REFERENCED, never authored: the model may say WHICH belief or
    // story it is passing on, and the speaker's own stores then supply the
    // rule, the confidence and the words (AgentMind.resolveSpeech). A `rule`
    // or narrative text the model writes has no source and is not read here,
    // so an invented fact can never reach a listener.
    const ruleRef = readNumber(o, 'ruleRef');
    if (ruleRef !== undefined) u.ruleRef = ruleRef;
    const narrativeRef = readText(o['narrativeRef'], 64);
    if (narrativeRef !== undefined) u.narrativeRef = narrativeRef;
    out.push(u);
  }
  if (out.length > UTTERANCE_LIMIT) throw tooLong('utterances-too-long', 'utterances', out.length, UTTERANCE_LIMIT);
  return out;
}

function tooLong(reason: MindOutputRejection, what: string, length: number, limit: number): MindOutputError {
  return new MindOutputError(reason, `${what} holds ${length} entries; the engine runs ${limit} — decide ${limit} or fewer`);
}

function asObject(v: unknown, reason: MindOutputRejection, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new MindOutputError(reason, `${what} must be an object`);
  }
  return v as Record<string, unknown>;
}

/** Zero-width characters are blank to a reader; `trim` alone leaves them. */
const BLANK = /^[\s\u200B-\u200D\u2060\uFEFF]*$/;

function readText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string' || BLANK.test(v)) return undefined;
  return v.trim().slice(0, max);
}

/**
 * An enumerated arg, checked against the closed vocabulary the prompt
 * advertises. Absent or `null` means the model offered nothing and is ignored,
 * exactly as for numbers; ANYTHING ELSE — a word outside the list, or a value
 * that is not even a word — is a REJECTION (`bad-arg`) naming the field and the
 * value. Never a silent drop (`buildKind:"tower"` used to become a shelter),
 * and never a pass-through (`objectKind:"plutonium"` used to reach the Body).
 */
function readEnum(
  o: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
  hint: string,
): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' && allowed.has(v)) return v;
  throw new MindOutputError('bad-arg', `${key} is ${JSON.stringify(v)}, which is not a thing here — ${hint}`);
}

/** A number the parser would carry through, or `undefined` when none was offered. */
function readNumber(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  if (typeof v !== 'number') return undefined;
  assertUsableNumber(v, key);
  return v;
}

function assertUsableNumber(v: number, key: string): void {
  if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) {
    throw new MindOutputError('bad-number', `${key} is ${String(v)} — not a number the engine can act on`);
  }
}

/**
 * The first key given twice inside one object, at any depth, or null. Runs over
 * text `JSON.parse` already accepted, so every string token is well-formed and
 * a key is exactly a string followed by `:` inside an object.
 */
function repeatedKey(text: string): string | null {
  const seen: Set<string>[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end < 0) return null;
      let j = end + 1;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) j++;
      const scope = seen[seen.length - 1];
      if (text[j] === ':' && scope) {
        const key = decodeString(text.slice(i, end + 1));
        if (scope.has(key)) return key;
        scope.add(key);
      }
      i = end + 1;
      continue;
    }
    if (c === '{') seen.push(new Set());
    else if (c === '}') seen.pop();
    i++;
  }
  return null;
}

function stringEnd(s: string, start: number): number {
  let escaped = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]!;
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === '"') return i;
  }
  return -1;
}

/** `"plan"` and `"plan"` are the same key; compare what JSON says they are. */
function decodeString(token: string): string {
  try {
    return String(JSON.parse(token));
  } catch {
    return token;
  }
}
