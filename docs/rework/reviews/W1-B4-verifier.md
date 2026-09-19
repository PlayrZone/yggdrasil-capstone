# W1-B4 — hostile verifier: **FAIL** (one behavioural divergence on the mock-LLM path; one route to coordinates no guard closes)

Verified 2026-09-19, `c3ed8d1` against `c727af7`, in two PERMANENT clean worktrees — `C:\dev\YggdrasilLab-vbase` / `-vnew` — each with its OWN `pnpm install --frozen-lockfile --prefer-offline` (3.7 s each). Every `packages/*/node_modules/@yggdrasil/*` link resolves inside its own checkout; `packages/mcp` now resolves `@yggdrasil/engine` to `…-vnew/packages/engine/src/index.ts` (`import.meta.resolve` printed), so B3's junction trap is closed. No game running. The main checkout, `-verify` and `-critic` were never touched; both worktrees end with `git diff` empty and no scratch. The other engineer's `src/eval/**` + mcp eval tools + lab renderer WIP are out of scope and reach the sim through nothing (`eval/trace.ts` reads only needs/inventory/counts).

## THE FAIL — a reflex plan stops surviving the mock backend

`MockMindBackend.complete` still does `JSON.stringify(this.policy.think(input))`. Its policy is the WORLD's (`policyFor(world)`), and since B4 that policy emits `place: PlaceRef`. So the mock now writes **`{"kind":"MoveTo","place":{"x":900,"y":120}}`** where it used to write `{"kind":"MoveTo","x":900,"y":120}` — and `parseMindOutput`, which reads `SpaceOps.fields` at the TOP level, drops it. The being is handed `{"kind":"MoveTo"}` with no destination. `wire.ts` names its two seams (parser edge, body edge) and this is a third the codec never reached.

| | `c727af7` | `c3ed8d1` |
|---|---|---|
| mock writes | `{"kind":"MoveTo","x":900,"y":120}` | `{"kind":"MoveTo","place":{"x":900,"y":120}}` |
| parses to | `{kind:'MoveTo',x:900,y:120}` | `{kind:'MoveTo'}` |

At scale, on my byte-dump. `mock-reflexpolicy-classic` (20 agents, 6 conscious, seeded myth): first divergence at corpus record **`vb4-F:7:1833`, tick 7**, fields `attempts[0].raw`, `parsedOutput` and `resolvedOutput` — and the act destroyed is the **pilgrimage** `MoveTo(900,120)`, the belief-steering behaviour the sacred-place machinery exists to measure. By tick 1200 the run has moved: `eventCount` 359 → **429**, `birthCount` 0 → **1**, `buildCount` 0 → **1**, two extra entities. `mock-reflexpolicy-continent` (`{world: foragerAdapter}`): first diff at **`vb4-G:5:18913`, tick 5** (a `wander`), `eventCount` 122 → **177**.

**This is not test-only.** `packages/mcp/src/llm.ts:50` makes `new MockMindBackend({ world: foragerAdapter })` the **unpaid default backend of the MCP server**, and `eval/door.ts:101` is the eval harness's mock arm. Every offline conscious cohort since this commit has been recording destination-less movement into v3 rows that claim to be comparable with every row before it.

Nothing caught it because nothing could: the goldens run no backend at all; `thinkInputCohort` deliberately emits place-free acts (`Idle`/`Dig`); `strayArgCohort` writes its JSON from a raw backend.

**The fix is the codec that already exists.** I patched `complete` to `JSON.stringify(encodeOutput(world, out))` and re-ran both configs: all four dumps are **sha256-identical to base** (`CA76566426BBFB55`, `6627B398BFE0C705`, `E3E96B0F4C0A4AB5`, `139E9750CD44962B`), then reverted byte-exact. The real change must thread the world through `MockMindBackendOptions` (the `{policy}` branch currently forbids `world`), because writing a decision down is a world question — plus a regression test that a cohort driven by its own world's reflex policy decides what the reflex path decides.

## THE SECOND FAIL — a mind can read coordinates past both guards

`PlaceRef` has no readable member, so `place.x` will not compile, and `mind-no-geometry.test.ts` does catch every cast (`as any`, `as unknown as {x:number}`, destructuring, `JSON.parse(JSON.stringify(p)).x`) — because it matches the NAME, not the type. The hole is everything that never spells `x`:

```ts
const u = Object.values(a), v = Object.values(b);          // compiles
return Math.sqrt((u[0]-v[0])**2 + (u[1]-v[1])**2);         // full Euclidean distance
```
compiles, passes `geometryIn`, passes `mind-type-graph`, passes `world-tables-out`. So do `Object.keys/entries`, `{...p}`, `structuredClone`, `Reflect.ownKeys`, `for…in`, and `const K='x'; q[K]`. `GEOMETRY` is `hypot`/`atan2` only — `Math.sqrt`, `**` and `Math.pow` are unpoliced. A mind can also MINT a place: `const p: PlaceRef = {}` compiles with **no cast at all**.

## What held — and it is most of the step

- **Byte-identity, six configs the engineer did not use, 92,094,947 bytes identical.** Whole-state dumps (every entity's components + settled position/stock, every mind's memories incl. places, knowledge incl. `provenance:'full'` evidence snapshots, relationships, narratives, goals, memory stats, the ORDERED event log, 14 analysis facades, 12 agent details/archetypes/conscious states) plus every corpus row raw. Configs: classic reflex 45→57 agents × **10,200 ticks** (19 births, 7 deaths, 822 tellings, 2,837 beliefs, seeded myth + recipe); continent reflex 80→113 × 3,600; classic reflex + `relocate` ×2 (one out-of-world) + 3 `authorEvent` (non-numeric deltas, NaN x, undefined y) + `giveIdea`; and three recording mock cohorts (5, 4 and 14 conscious, classic + continent, `provenance:'full'`, sacred + tragedy myths, `craftLearning`) whose policy writes `MoveTo`/`Build`/`Flee` with valid, half-written, non-numeric, NaN, out-of-world, stray, nested-`place` and foreign-field (`spot`) coordinates. All six identical, state and corpus.
- **Floats: the moved expressions are the same expressions.** `within` vs `dx*dx+dy*dy > r*r` over **8,125** pairs placed exactly at the radius on both axes and the diagonal and at ±1 ulp either side, across ten radii (0, `MIN_VALUE`, 1e-8, 8, 1e8, `MAX_SAFE_INTEGER`, NaN, ±Infinity, −8, −0) and nine bases: **0 divergences**, and symmetric in its arguments (the call site swapped them). `direction` over **289** pairs covering all eight octant boundaries, the ±1-ulp neighbours of ±4, the zero vector and the non-finites: **0 divergences**; all nine declared words are reachable and no undeclared word is ever produced. `distance`/`label` exact under `Object.is`; places round-trip bit-exact including `-0`, `5e-324` and `Number.MAX_VALUE`.
- **Parser and body: no decision changed.** Differential fuzz of **28,993** replies (three seeded phases, place-weighted) — accepted 9,611, rejected 19,363, 19 identical non-`MindOutputError` throws — with identical reason code **and full message** across all 18 codes, and identical `Object.keys()` on all **37,403** accepted intents (57 distinct wire orders, `-0` preserved in 74). **787** systematic two-illegal-arg cases report the SAME one in both trees in every case, independent of key order; the `PARAM_TYPE_ORDER` change is neutral because forager has no `number` param left and `MoveTo` was already `actions[0]`. Driving `applyPlan` directly (parser bypassed), 13 rows — `body.plan` bytes, per-intent key order, `planStep`, `planDone`, gate counts — identical, and 400 ticks on a handed plan land on the same float position. A negative control (skipping `encodeIntent`) reports 8,565 divergences, so the comparator is not vacuous. `world-stray-args` still matches the `01a23d2` fixture.
- **Corpus compatibility.** **378** v3 rows captured at `c727af7` by MY OWN cohorts (328 carrying a story's site, 262 with placed memories, 333 with stories) deserialize through the new code, rebuild to the **same prompt bytes**, re-serialize to the **same row bytes**, and leave the stored row unmutated. `COGNITION_SCHEMA_VERSION` is still 3 and now honestly so. The NEEDS paragraph rendered from `adapter.drives`/`promptLabel` is byte-identical across all 378.
- **The toy world earns its place.** A full mind — observe, consolidate, `injectIdea`, narratives, `buildThinkInput`, `buildThinkPrompt`, `MockMindBackend`+`LlmMind`, `parseMindOutput`, all five miners — runs green on a non-planar space with `worlds/forager/{adapter,space,reflexPolicy}` replaced by throwing Proxies. No mind path reaches the forager world at runtime.
- **Guard negative controls bite**, and it is genuinely data-driven for the world it reads: adding a third field `z` and a tenth direction to `foragerSpace` makes both policed for free.
- **Suites in vnew, once each:** engine **751/751**, `tsc --noEmit` exit 0; mcp **37/37**, tsc 0; lab **388/388**, typecheck 0 (`ipcGuards` 60, `llmBridge` 23, `simHost` 30, `protocol` 14). All three claimed counts reproduce exactly. `mind-no-geometry` scans `src/**` by glob, so a scratch `.ts` left in a mind directory reddens it — a hazard for the next verifier, not a defect.

## Backlog

1. **The fix above**, with the world threaded through `MockMindBackendOptions`, plus the regression test. Rows recorded from a mock cohort since `c3ed8d1` are not comparable with rows before it.
2. **Close the name-free route**: add `Object.keys/values/entries`, spread, `structuredClone`, `Reflect.ownKeys`, `for…in` and const-key element access to `geometryIn`, and `sqrt`/`pow`/`**` to `GEOMETRY`. Refuse a mind-side `PlaceRef` literal (`const p: PlaceRef = {}` compiles today).
3. **The guard's vocabulary is one world's.** `COORDS`/`DIRECTIONS` come from `foragerAdapter` at module load, so the toy world's `spot`/`ridge` are policed by nothing. B6 should make it the union over every registered world.
4. **Places from two worlds mix silently.** Only `isPlace`/`placeOf`/`decode` refuse. `equal` — "the only comparison a mind is allowed to make" — returns **true** for two different places; `distance` gives `0` or `NaN`; `label` gives `"NaN,NaN"` or `undefined`, and `label` is what `placeText` splices into a prompt. A place carries no world tag. Defined errors, or a tag, before W1-C puts two worlds in one process.
5. **"THE TWO CASTS IN THE REPOSITORY" is false.** `wire.ts:66` casts `value as PlaceRef`, and `wire.ts:99 inlinePlace` does `Object.assign(out, value)` — the contract layer opening a place with no adapter and no cast, on the unstated invariant that a place's runtime value IS its wire form. Say that invariant out loud or route it through `space.encode`.
6. **Out-of-fence, and the one place the step cost safety:** `ipcGuards` replaced `finite(snapshot.x)` with `isPlainObject(place)`, so `{}`, `{x:"120"}`, `{x:NaN,y:Infinity}`, a deleted `x`, a nested place, a bare `Object.create(null)` and a JSON-parsed own `__proto__` key are now **accepted** where base rejected them — and, because `snapshot.place` binds to the prompt only through `placeText` (which renders nothing without a `sacredPlace`), such a request is **paid for**. Three new paths make the guard THROW a raw error instead of returning a `Check`: `getPrototypeOf` on a revoked Proxy, a get-trap that throws, and a throwing getter. The size (512 KiB), depth (24), cycle and exotic caps all survive. The engine already ships the answer — `SpaceOps.isPlace`, documented as "the edge's question" — and `llmBridge.bindPromptToInput` holds the world and never calls it. One line closes all of it.
7. **`deserializeThinkInput(row)` without a world stopped checking.** Base always validated `snapshot.x`/`y` and the four needs; now both checks are skipped when no adapter is passed, so a row with `needs.hunger: null` or a missing `x` replays silently where it used to throw. `eval/trace.ts:93` is such a caller (harmless today — it reads no place — but it also loses the pull sentence if it ever rebuilds a prompt).
8. **Half a coordinate changes what is stored.** `memoryFromEvent` on `{x:5, y:undefined}` stored `"x":5` at base and stores nothing now (`placeOf` needs both), which would also move a golden digest. Reachable only by a host casting a partial `SimEvent` into `authorEvent` AND a witness forming a memory; I could not make it bite in two intervention configs. Pin it or type it away.
9. **Still geometric in the mind:** `prompt.ts:189` `Math.round(world.space.distance(...))` assumes distance is a printable finite scalar — an unreachable toy spot put "about Infinity away" into a real prompt. B5 owes distance a WORD.
10. **Forager constants B4 left behind** while `successionRadius`/`successionWindowTicks` moved out: `memory/MemoryStream.ts:13 RECENCY_HALF_LIFE=2000`, `learning/SocialMiner.ts:18 RECIPROCATION_WINDOW=1200`, `relationships/RelationshipStore.ts:6 DECAY_INTERVAL=2400`.
11. `consciousness/FireworksMindBackend.ts` is in no compile proof. And pre-existing in both trees: `parseGoals`'s `String(description ?? 'goal')` throws a raw `TypeError` on `{"description":{"toString":"x"}}`, escaping the reason-coded gate.
12. A future note on `PARAM_TYPE_ORDER`: leading with `place` is neutral only while no world declares a `number` param on an action ordered before its `place` one.

**What B5 and B6 inherit:** B5 — a word for distance and the `dir`/`away`/`toward` sentence (`prompt.ts:189-191`), the NEEDS labels now honestly declared as `promptLabel`, `label`'s rounded coordinate pair. B6 — `SimEvent.x/y` (`contract/types.ts:132-133`, pinned by the guard and correctly deferred), the per-world instrument, and the guard vocabulary in item 3.

---

# Round 2 — hostile verifier: **FAIL** (opacity is not enforced; two planar worlds are one world to the guard; −14% ticks/s)

Verified 2026-09-19, `48c9c46` against `c727af7`, in the two permanent checkouts `C:\dev\YggdrasilLab-vbase` / `-vnew` (re-pinned, own `pnpm install --frozen-lockfile`, both left clean). No game running. Configs, seeds and leak routes are mine — not round 1's, not the engineer's. Round 1's two FAILs are both genuinely fixed *at the seams round 1 named*; both classes are still open one step to the left.

## What HELD, and it is a lot

- **Byte-identity, 8 unseen configs, 26,385,847 bytes, BOTH paths.** Classic reflex 34×3,000 ticks; continent reflex 60×1,500; classic reflex + interventions (`relocate` in and out of world, `giveIdea`, 3 `authorEvent` carrying NaN / `undefined` / string-and-null coordinates); classic **and** continent **mock-LLM** cohorts on a scripted policy whose every act carries a place (`MoveTo`/`Build`/`Flee`/`Gather` — valid · half-written · out-of-world · NaN · `-0` · 1e6 · stray); and the **world's-own-reflex** mock (`new MockMindBackend({world})`, the eval door's `reflex` arm) on both scenarios, one with interventions. Each dump is whole state (every entity, every mind's memories/goals/knowledge/relationships, 12 agent details, conscious states, nodes/structures/animals, 16 counters), the ordered event log, and every corpus row plus its raw reply, prompt bytes and stored `thinkInput` hashed separately. **All 48 fingerprints identical.** Negative control: put `JSON.stringify(out)` back into `MockMindBackend` and D/E/G's `raw` and `rows` all diverge — the comparator is not vacuous.
- **The fixture is genuine.** I re-captured `mockCohortTrace.c727af7.json` myself in `-vbase` (the two mechanical edits, applied by me): **byte-identical, sha256 `0aa5e0bf…`, 56,542 bytes.** No golden, and neither `strayArgTrace.01a23d2.json` nor `thinkInputRows.c727af7.json`, was touched by `48c9c46`. `COGNITION_SCHEMA_VERSION` is 3.
- **431 v3 rows recorded at `c727af7` by my own cohorts** deserialize through the new code to the **same prompt bytes** and re-serialize to the **same row bytes** — 0 throws, 0 mutations of the stored row.
- **The lab edge is fixed.** Every one of round 1's accept-regressions is refused `BAD_THINK_INPUT` — `{}`, `{x:"120"}`, `{x:NaN,y:Infinity}`, a deleted `x` — and all three throw paths (revoked Proxy, get-trap, throwing getter) refuse instead of throwing. Of 21 hostile places (mine: a getter returning a number once then throwing, 10⁵ keys, 400-deep nesting, a `toJSON` trap, symbol keys, inherited `x`, `1e309`, BigInt, an array) **16 refused, 0 threw, the token was spent every time**; `sacredPlace` and `tragedyPlaces` (10⁴ entries; half-written) refuse too. **No false refusals: 200 live `ThinkInput`s from a real 10-being conscious run, gated on the object exactly as IPC would deliver it — 200/200 accepted.**
- **Every `SpaceOps` a mind can reach is the guarded one**: `planeSpace` is module-private, `foragerAdapter.space` is `guardPlaces(planeSpace)`, nothing exports the raw one. **0 `ForeignPlaceError` in live runs** — instrumented counter, all 8 configs, ~13,500 ticks.
- **All 42 `MockMindBackend` sites pass a real world**, none through `any` or a cast. **Suites once in `-vnew`: engine 782/782 + `tsc` 0; mcp 37/37 + `tsc` 0; lab 447/447 + both typechecks 0.**
- Module augmentation of `PlaceRef` from a mind directory **is** caught (guard red, and it breaks `place-refused.ts`'s compile proof). Planting the engineer's own `place-leaks.ts` into `memory/` turns the guard red with all 21 findings — it is live, not inert.

## FAIL 1 — the brand is nominal, and a nominal type is a name a mind need never say

**22 routes, written by me into `src/consciousness/zzr2leak.ts`, all compile under `tsc --noEmit` with zero errors, and ALL 22 pass `mind-no-geometry`, `world-tables-out` and `mind-type-graph`.** The guard reports a leak only where an expression's type *is* `PlaceRef`; every route makes sure it is not — without one cast of a place:

```ts
const openObject = (v: object): unknown[] => Object.values(v);       // no cast: a PlaceRef IS an object
const u = openObject(a) as number[], w = openObject(b) as number[];  // full Euclidean distance
return Math.sqrt((u[0]-w[0])**2 + (u[1]-w[1])**2);
```

The same hole wearing other clothes: a generic helper `<T>(v:T)=>Object.values(v as unknown as object)`; a parameter typed `unknown`; **an intermediate `const o: object = p`** — a variable declaration with an identifier name is never inspected — feeding `Object.entries` / `Array.from` / `new Map` / spread / `for…in` / `Object.assign` / `structuredClone` / `getOwnPropertyNames` / `Reflect.ownKeys`; an `any` alias read as `p?.[K]` with `const K='x'`; `JSON.parse(JSON.stringify(record))` on a record *containing* a place; `satisfies object`; a type predicate `(v: object): v is ArrayLike<number>`; `new Function` and `eval`; and `SimEvent`'s surviving `x`/`y` read as `e[K]`. Three need no reflection at all:

- **`space.label(p).split(',').map(Number)`** — the world hands the mind its coordinates as a string, by design, and `label` is on no opener list.
- **`world.space.encode(p)`** — the codec's own escape hatch, callable from any mind file, returning `{x, y}`.
- **`world.space.decode({[K]: n, [K2]: m})`** — a mind **MINTS** a place out of numbers it chose. The `unique symbol` brand stops `{} as PlaceRef`; it does not stop the world being asked politely. With minting back, `distance` to two minted probes triangulates the handle exactly (route 22).

**The allow-list can also be widened silently.** Its key is `file:fn:route`, and a function name is not unique within a file: I added a second local arrow named `asPlace` to `record/serialize.ts`, inside a different function, casting an arbitrary stored row to `PlaceRef` — **guard green, 48/48.**

*Repro:* copy `C:/tmp/r2/zzr2leak.ts` into `-vnew/packages/engine/src/consciousness/`, then `vitest run test/mind-no-geometry.test.ts` → 48 passed, and `tsc -p tsconfig.json --noEmit` → exit 0.

## FAIL 2 — `guardPlaces` asks "does it have an `x`", and W1-C's town will have one

Ownership is decided by "carries any of `space.fields`". **A second planar world's place is a forager place.** A town grid's `{x:3,y:9}` through `foragerAdapter.space`: `distance` → **1080.41**, `direction` → `"southeast"`, `within` → `false`, `label` → `"3,9"`, `encode` → `{"x":3,"y":9}`, and `equal` of two such → **true**. Every number is garbage and none of it is refused — which is exactly backlog 4, now with a `ForeignPlaceError` class that cannot fire for the case it was written for. Also accepted and answering: `{x:"120",y:"2"}` → `distance 0`, `label "1,2"`; `{x:1,y:2,z:3}`; an array carrying an `x`; a null-prototype object. Correctly refused: `{}`, `{spot:'ridge'}`, arrays, strings, numbers, `null`, `undefined`, `Date`. And the gate is **not unthrowable**: a place whose `x` is a throwing getter escapes `guardPlaces` as a raw `Error`, not a `ForeignPlaceError` (`isPlace` is called first, inside `minted`).

## FAIL 3 — cost: −8.7% at 256 beings, −14.4% at 1,000

Reflex cohort, single process, 3 runs, median ticks/s, nothing else running:

| beings | `c727af7` | `48c9c46` | Δ | `48c9c46`, guard bypassed |
|---|---|---|---|---|
| 256 (600 ticks) | **2187.2** | 1996.2 | **−8.7%** | 2085.6 |
| 1000 (200 ticks) | **218.7** | 187.2 | **−14.4%** | 187.0 |

Runs are tight and non-overlapping (base 217.8 / 218.7 / 220.3 against new 184.4 / 187.2 / 188.3). **`guardPlaces` is not the cost** — replacing `foragerSpace` with the raw `planeSpace` recovers 0.1%. The 14% is the `PlaceRef` indirection itself: `asPoint`/`fieldsOf` on every call, and a fresh `{x,y}` allocated by `placeOf` per memory. Heap is not a regression: RSS at 1,000 beings 262.3 MB → 250.4 MB; heapUsed at the same checkpoints 100.6 MB → 96.5 MB.

## FAIL 4 — world-less `deserializeThinkInput` is still weaker than base, in more ways than the engineer admits

Base always ran `num()` over `snapshot.x`/`y`, the four needs and `sacredPlace`. The restored world-less path asks only "is it `null`, or a number that was lost", so these **replay silently where `c727af7` threw** (17-case table, both modes):

| row | no world | with world | at `c727af7` |
|---|---|---|---|
| `snapshot.x: "120"` | **ACCEPTED** | refused | refused |
| `snapshot.x` missing | **ACCEPTED** | refused | refused |
| `needs.hunger` missing | **ACCEPTED** | refused | refused |
| `sacredPlace.x: "5"` / missing | **ACCEPTED** | refused | refused |
| `tragedyPlaces[0].x: null` | refused | **ACCEPTED** | (unchecked) |

A missing *need* is not "the world's to say which fields are a place": base named those four by hand, and the row names them too. And passing the world makes validation **weaker** for `tragedyPlaces`, which `assertReplayable` never checks on the world path — the opposite of the doc's claim that the world is what makes a replay sound. A consumer must therefore re-validate every number it renders, or pass the world *and* check `tragedyPlaces` itself. A toy-world row read with the forager world is correctly refused.

## FAIL 5 — the second model stand-in still loses the destination (confirmed, quantified)

`eval/mocks.ts:42` `JSON.stringify(this.decide(input))`, and `FaithfulMockBackend.decide:113` emits `place: source.place`. Forced onto the branch that has one:

```
raw    {"plan":[{"kind":"MoveTo","place":{"x":900,"y":120}},{"kind":"Gather","targetId":42}], …}
parsed [{"kind":"MoveTo"},{"kind":"Gather","targetId":42}]
```

Round 1's fail, verbatim, in the eval door's `mock`/`faithful` arm (`door.ts:111`). `OmniscientMockBackend` emits no place and is unaffected; `BaselineAgentBackend` and `lab/renderer/sim/host.ts` stringify no `MindOutput` — those are the only other stand-ins. One correction to round 1's framing: the mock is **not** the MCP server's `make_conscious` backend. `mcp/src/index.ts:48` passes `makeLlmBackend`, which is `null` without a key, so an unkeyed session gets no backend and no sink and records nothing at all. The mock's production reach is `evalBackend` (`llm.ts:50`) and the eval door.

## Attack 9 — the NUL bytes

Confirmed: 2 raw U+0000 in each file, inside `RETRY_SENTINEL` string literals. `lab/src/main/llmBridge.ts` since **`427573f`** (L2c); `engine/src/eval/baseline/BaselineAgentBackend.ts` since **`d8a4534`** (W1-E round 2) — not at the file's birth in `1680cde`. **Build output is unaffected**: `tsc` transpiles the NUL through verbatim, so the sentinel round-trip works. The cost is review. Git treats both as binary — `48c9c46` shows `packages/lab/src/main/llmBridge.ts | Bin 7128 -> 9701 bytes` — so the 2,573 bytes this fix round changed in the lab's paid-call edge have **no readable diff and no blame**, and `git log -S` cannot search them. There is no `.gitattributes`. A `\u0000` escape fixes it with no behaviour change.

## Blockers, ranked

1. **FAIL 1** — opacity is not enforced. 22 compiling routes, including a full Euclidean distance, `space.encode` from mind code, and a mind minting its own places through `space.decode`.
2. **FAIL 2** — `guardPlaces` cannot tell two planar worlds apart, and W1-C's town is planar.
3. **FAIL 5** — `eval/mocks.ts` still records destination-less movement.
4. **FAIL 3** — 14.4% ticks/s at 1,000 beings, and it is not the guard.
5. **FAIL 4** — four row shapes base refused and the world-less path now accepts.

## Backlog (not blocking)

1. **B5 (lexicon)** — `label` is a coordinate pair a mind can parse; give distance and place WORDS and route 19 closes itself. Round 1 item 9 (`Math.round` of a possibly non-finite distance) stands.
2. **B6 (instrument)** — `SimEvent.x/y` (route 18); the guard's vocabulary is still one world's (round 1 item 3); `guardPlaces` should return a reason-coded refusal rather than a raw `Error` on a trapping value.
3. **W1-C (town)** — nothing may put a second planar world in this process until FAIL 2 is closed: a world TAG on the handle, or a guard keyed on the space that minted it.
4. Lab, low severity: 5 of 21 places still accepted — a place with an extra key, `Object.create(null)`, a JSON-parsed own `__proto__`, symbol keys, and a `Proxy` whose `getOwnPropertyDescriptor` lies. All render consistently, all are bounded, none is a spend vector.
5. Round 1 items 10 (three forager constants left in mind directories), 11 and 12 are unchanged and unaddressed.

---

# Round 3 — hostile verifier: **FAIL** (the handle is opaque; the door beside it is not — 22 compiling routes hand over coordinates; −8% ticks/s at 1,000 beings)

Verified 2026-09-19, `f21ee83` against `c727af7`, in the two permanent checkouts `C:\dev\YggdrasilLab-vbase` / `-vnew`, each with its own `pnpm install --frozen-lockfile --prefer-offline`, both left clean and pinned. No game running. Configs, seeds, routes and both bench methods are mine. **The design change works where it was aimed and misses one module to the left.**

## What HELD — and it is most of round 3

- **The handle really is opaque at runtime.** 17 routes against a real forager place holding `748.25,-311.5`, and a record containing one: `Object.keys/values/entries`, `getOwnPropertyNames/Symbols/Descriptors`, `Reflect.ownKeys`, spread, `Object.assign`, `for…in`, `p?.['x']`, `JSON.stringify` → **`{}` or `[]`, every one**. `structuredClone` (and with `transfer`) → `{}`; `v8.serialize` → `ff0f6f7b00`, five bytes, an empty object; the same inside a record. `util.inspect(p,{showHidden,showProxy,getters,depth:10})` → `Place <[Object: null prototype] {}> {}` — the class NAME, no coordinate. `getPrototypeOf` → empty, `constructor` → `undefined`. `WeakRef.deref()` returns the same object with no keys. `${p}`, `String(p)`, `Math.round(p)`, `p+1`, `p*2` all throw `TypeError: Cannot convert object to primitive value`; `p.toString()` throws `p.toString is not a function`; **no error message anywhere carries a coordinate**, including `ForeignPlaceError.message` and the private-field `TypeError`. `Function.prototype.toString` of `distance`/`label`/`encode`/`xOf`/`pointOf`/`at`/`createPlaneSpace` — nothing.
- **Ownership is unforgeable.** Two `createPlaneSpace()` worlds: all five `SpaceOps` entry points × both argument positions × both directions = **11 calls, 11 `ForeignPlaceError`** — and the same forager↔second-plane, forager↔toy. A `Proxy` wrapping a real place and `Object.create(realPlace)` are both `owns === false` and refused (`#x in v` is not a trap and does not inherit). `codecFor` on an ops object `defineSpace` never built throws. **0 `ForeignPlaceError` in ~5,000 live ticks** (3,000 classic + 1,000 continent + 1,000 classic, with `relocate`/`giveIdea`/`authorEvent`), counted at the constructor.
- **Byte-identity, 7 unseen configs, 4,921,161 bytes per tree, BOTH paths, all identical.** Classic reflex 52×**1,800**; continent reflex 90×**1,500**; classic reflex + interventions (`relocate` in and out of world, `giveIdea`, four `authorEvent` carrying NaN / `undefined` / string-and-`null` / `-0`+1e6 coordinates, `grantItems`) ×1,500; classic **and** continent mock-LLM on a scripted policy whose nine-act cycle covers valid · half-written (`{x}` only) · out-of-world · NaN · `-0` · 1e6 · stray-place-on-a-place-free-verb · foreign key `spot`; and the **world's-own-reflex** mock on classic and on continent-with-interventions. Each dump is `fingerprintOf` at three checkpoints (every entity, settled position/stock, every mind's memories incl. places, knowledge, relationships, narratives, goals) + 11 counters + the whole ordered event log + every corpus row + its raw reply, prompt, `parsedOutput`, `resolvedOutput`, stored `sacredPlace`/`tragedyPlaces` + every agent detail + the sacred-places and myth reports. **Every sha256 equal.**
- **The `sacredPlace` fix is real, and I made the comparator prove it bites.** Putting `48c9c46`'s plain copy back into `withPlacesWritten` diverges all four mock configs: `sacredPlace` becomes **`{}` in all 69 rows of R4**, ROW and SACRED sections diverge — while **PROMPT, RAW, EV and FP stay identical**. That is why nothing caught it: the prompt is built in-process from the live handle, so only the STORED row was corrupted. At `f21ee83` the rows equal BASE.
- **Replay: 292 v3 rows recorded at `c727af7` by my own cohorts** (all 292 carrying a `sacredPlace`, 1,768 placed memories) deserialize through the new code to the **same prompt bytes** and re-serialize to the **same row bytes**, 0 throws, 0 mutations of the stored row.
- **Round 2's FAIL 4 is fixed, and the world path is now a strict superset of base.** 21-case table, three modes. Everything `c727af7` refused, `deserializeThinkInput(row, world)` refuses — `snapshot.x` `"120"`/missing/`null`, `y: NaN`, `needs.hunger` missing/`null`/`"20"`, `health: null`, `ageTicks` missing, `sacredPlace.x` `"5"`/missing, `sacredPlace: {}`, a toy-world row, a bad `nonFinite` path — **plus three base ACCEPTED**: `tragedyPlaces[0].x` `null`, missing, and `{}`. `-0` and a clean row pass both. `peekThinkInput` is weaker (7 of the 21) and **that is sound**, because `UnvalidatedThinkInput` is genuinely not a `ThinkInput`: five shapes — direct, via a typed variable, the conditional type `extends`, backwards, and a spread — every `@ts-expect-error` consumed, project `tsc` exit 0.
- **The allow-list cannot be widened by reusing a name.** Round 2's trick repeated verbatim — a second local arrow `asPlace` in a different function of `record/serialize.ts`, casting a stored row — compiles (`tsc` 0) and turns `mind-no-geometry` **red** on "every excused function name occurs exactly once in its file".
- **The lab edge** (unit-level, no Electron): 200 real `ThinkInput`s through `encodeThinkInputPlaces` → `structuredClone` → gate → `decodeThinkInputPlaces` → `buildThinkPrompt` = **200/200 byte-identical**; `sacredPlace` 200/200 and `tragedyPlaces` (2 each) 200/200 survive. 21 hostile shapes × 3 slots + 2 array cases = 65: **refused 53, accepted 12, THREW 0** — every refusal reason-coded `BAD_THINK_INPUT`, including revoked Proxy, throwing get-trap, lying `getOwnPropertyDescriptor`, getter-then-throw, `toJSON`, BigInt, 10⁵ keys, 400-deep. The 12 accepted (`Object.create(null)`, JSON-parsed `__proto__`, lying-gOPD Proxy, `{x,y,z}`, each in three slots) all decode to a place `space.equal` to the honest `{x:1,y:2}` with zero own keys — no escalation, and two of them cannot cross real IPC at all. **No false refusals: 200/200 accepted.**
- **Suites once in `-vnew`:** engine **852/852** + `tsc` 0; mcp **37/37** + `tsc` 0; lab **476/476** + `tsconfig.node` 0 + `tsconfig.web` 0. `COGNITION_SCHEMA_VERSION` 3. **`f21ee83` touched no `.json` fixture and no golden**; `mockCohortTrace.c727af7.json` is still sha `0aa5e0bf…`/56,542 bytes, `strayArgTrace.01a23d2.json` and `thinkInputRows.c727af7.json` unchanged since the commits that introduced them. **0 raw U+0000** in `lab/src/main/llmBridge.ts` and `eval/baseline/BaselineAgentBackend.ts`, sentinel values byte-for-byte what they were at `48c9c46`.
- **`SimEvent.x`/`y`: zero mind-directory reads today.** `SimEvent` appears in exactly one mind file (`memory/memoryFromEvent.ts`) and only as a TYPE. The B6 residual is a type surface, not a live channel. `space.label` is called from exactly two places in the repository — `consciousness/prompt.ts:191` and `eval/trace.ts:148` — so it is the only textual route.

## FAIL 1 — the handle is opaque; `codecFor` is a module import a mind file can make

`codecFor` lives in `contract/space.ts`. Mind files import from `contract/` constantly, `world-tables-out` bans only `worlds/**` and the barrel, and `placeLeaksIn`'s `codec` route asks whether an **expression's type is `SpaceCodec`**. Widen the FUNCTION instead of the result and no expression in the chain ever has that type:

```ts
import { codecFor } from '../contract/space.js';
const opener = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): Record<string, unknown> };
export const openIt = (space: SpaceOps, p: PlaceRef) => Object.values(opener(space).encode(p));   // [748.25, -311.5]
```

**22 routes, written by me into `src/consciousness/zzr3leak.ts` plus a 10-line relay in `src/contract/zzr3relay.ts`: project `tsc --noEmit` exit 0, and `mind-no-geometry` (50), `world-tables-out` (42) and `mind-type-graph` (3) all GREEN — 95/95.** Exactly **one** token in the first draft was caught, `Math.atan2`, by the old NAME guard; replacing it with `Math.asin(dy/len)` made the file green. `Math.sqrt`, `**` and `Math.pow` are still unpoliced (round 1, backlog 2, unaddressed).

Run against the real forager space the routes return: `openIt`/`openItAny`/`openByDestructure`/relay → **`[748.25, -311.5]`**; `euclid` → **825.7483348454298**, bit-equal to `Math.hypot` of the truth; `fields` → `["x","y"]`; **`placeOf(JSON.parse('{"\u0078":900,"\u0079":120}'))` MINTS a forager place** the world then accepts (`label` `"900,120"`, `distance` works, no `ForeignPlaceError`) — and with minting back, `triangulate` recovers **748.2500000000582 / −311.4999999998254** from three `distance` calls alone. Round 2's routes 20–22 are not gone by construction; they are gone by one cast.

Three sub-findings the same file proves:

1. **The relay needs no cast at all.** `POLICED_SEAMS` is `contract/wire.ts` and `record/serialize.ts`; a NEW file in `contract/` is scanned by nothing, and `export const openerFor = (s: SpaceOps) => (p: PlaceRef) => codecFor(s).encode(p)` exports a type that is already narrower than `SpaceCodec`. The mind imports it and calls it.
2. **The narrowed `label` guard does not bite.** It requires the callee to be a property access on a `SpaceOps`-typed expression. `const lab = space.label`, `const {label} = space`, `(0, space.label)(p)`, `Reflect.apply(space.label, space, [p])`, and a widened `space` **all evade it**, and all return `[748, -311]` after `.split(',').map(Number)`. The direct form IS caught — so the guard catches the spelling nobody attacking would use. `label` is the declared B5 residual, but the claim in `contract/space.ts` that it is *narrowed* is not true.
3. **`SimEvent`'s coordinates are still readable** from a mind file via `const k = String.fromCharCode(120); row[k]` → `[17, 23]`. Declared B6 residual; listed for completeness.

*Repro:* copy `C:/tmp/r3/repro/zzr3leak.ts` → `-vnew/packages/engine/src/consciousness/`, `zzr3relay.ts` → `src/contract/`, then `npx tsc -p tsconfig.json --noEmit` (exit 0) and `npx vitest run test/mind-no-geometry.test.ts test/world-tables-out.test.ts test/mind-type-graph.test.ts` (95 passed). `zzr3-routes.test.ts` runs them and prints the coordinates.

## FAIL 2 — the codec sits OUTSIDE `defineSpace`, and that is exactly where W1-C's cross-world values will go

`defineSpace` guards the five `SpaceOps` functions. It does not guard `SpaceCodec`, and `encode`/`pointOf`/`xOf`/`yOf` read `#x` directly. So a foreign place at a **serialisation** seam — `writeIntent`, `inlinePlace`, `encodeThinkInputPlaces`, `withPlacesWritten`, all of which call `codec.encode(place)` with no ownership check — throws `TypeError: Cannot read private member #x from an object whose class did not declare it`: no `op`, no `argument`, no mention of worlds, and **not** the `ForeignPlaceError` written for this case.

I put a second plane's place into a live conscious cohort (`plan: [{kind:'MoveTo', place: otherPlane.at(900,120)}]`, 3 conscious beings, 400 ticks). Result: **`ForeignPlaceError` constructed 0 times**, nothing propagated out of `advance`, and all 11 rows read `answered | TypeError: Cannot read private member #x … | plan:[{"kind":"Move…` — because `LlmMind.ts:126` and `:136` catch **any** error from the backend and the parser, record the string, retry once, and then silently fall back to reflex. A place from the wrong world produces a *plausible substituted decision* and a logged string, which is the outcome the `ForeignPlaceError` doc-comment says it exists to prevent. Nothing in the run stops.

## FAIL 3 — cost: the regression halved but did not go away, and the engineer's number does not reproduce

Reflex cohort, `craftLearning: true`, both trees built with their own `tsc` and imported as `dist/index.js`, nothing else running. **I ran BOTH methods.**

| | base `c727af7` | `f21ee83` | Δ | spread |
|---|---|---|---|---|
| **B — paired, interleaved, ONE process, 11 rounds**, 256×600 | **3310.6** | 3221.7 | **−2.7%** | base 3168.8–3470.0 · new 3116.9–3314.8 |
| **B**, 1000×200 | **376.9** | 346.1 | **−8.2%** | base 365.7–385.7 · new **329.5–361.1** |
| **A — separate processes**, 3 runs × 3 reps, 256×600 | 3104.6 | 3153.8 | +1.6% | heavily overlapping |
| **A**, 1000×200 | **405.9** | 370.1 | **−8.8%** | base 399.2–428.6 · new 328.1–372.5 |

**I trust method B**, and the engineer is right about the noise but wrong about the conclusion: within a single process my first run of three was routinely 20–25% below the next two (2569 vs 3413), which is what wrecks method A at 256. But at **1,000 beings both methods agree at −8%**, and B's distributions barely overlap — ten of eleven new rounds fall below every base round. **Round 2's −14.4% is now ≈−8%; it is not +0.2%/+1.1%.** Over the 3% budget at 1,000 beings; inside it at 256.

**Heap is not a regression.** `heapTotal` at the fixed end-of-run checkpoint, median of 3: 256 beings 90.4 → 89.9 MB; 1,000 beings 189.9 → 187.4 MB. RSS is too noisy at n=3 to call.

## Blockers, ranked

1. **FAIL 1** — 22 compiling routes out of the handle from a mind directory, `tsc` 0 and all three guards green: the full coordinate pair, a bit-exact Euclidean distance, `fields`, **minting** via `placeOf`/`decode`, and triangulation from three `distance` calls. The runtime defence is sound; the defence that `codecFor` is unreachable is a type check on the wrong expression. Close it where it cannot be widened — a module-level registry keyed to callers, or a `codecFor` that refuses a caller outside a declared seam list — not with another type rule.
2. **FAIL 2** — `SpaceCodec` is outside the ownership gate, so W1-C's first cross-world row gets a raw `TypeError` that `LlmMind` swallows into a reflex fallback. Guard `encode` (and `pointOf`/`xOf`/`yOf`) with `owns`, and stop `LlmMind`'s two catches from eating a `ForeignPlaceError`.
3. **FAIL 3** — −8.2% (B) / −8.8% (A) ticks/s at 1,000 beings, against a 3% budget.
4. **The `label` guard is decorative** — five evasions, no cast, `[748,-311]` from each. Inside the declared B5 residual, but the file claims it is narrowed and it is not.

## Backlog (not blocking)

1. **B5 (lexicon)** — give distance and place WORDS; blocker 4 closes itself. Round 1 item 9 (`Math.round` of a possibly non-finite `distance`, `prompt.ts:189`) still stands.
2. **B6 (instrument)** — `SimEvent.x/y` (no mind-dir READ today, so this is a type-surface cleanup); the guard's vocabulary is still one world's; and `codec.encode` should give a reason-coded refusal, not a V8 message.
3. **Round 1 item 8 is still open, now with a table.** `memoryFromEvent` on a host-authored `SimEvent`: base stored `{x:5}` / `{y:6}` / `{x:"5",y:6}` / `{x:5,y:null}`; `f21ee83` stores **nothing** for all four, because `placeOf` needs both fields to be `number`. `{x:NaN,y:6}` is identical in both. Reachable only through `authorEvent` plus a witness; it did not bite in either of my intervention configs, and it would move a golden if it ever did. Pin it or type it away.
4. **`peekThinkInput` accepts 7 of the 21** (`snapshot.x` missing, `needs.hunger` missing, `sacredPlace` `"5"`/missing/`{}`, `tragedyPlaces` missing-field/`{}`, a toy-world row). Sound, because the type refuses `buildThinkPrompt` — but any consumer rendering those numbers must re-validate, and `eval/trace.ts:103` correctly takes the world path.
5. `knowledge[*].confidence: null` replays at BOTH `c727af7` and `f21ee83` — pre-existing, not a regression.
6. **`node:inspector` reads `#x`/`#y` directly** (`Runtime.getProperties` → `privateProperties: [{name:'#x', value:748.25}, …]`, no flags). It is out of reach from `src/` only because the engine tsconfig ships no node types, so `import('node:inspector')` is TS2307. That is an accident, not a defence; if node types ever reach `src/`, the private-field guarantee is gone. Worth one sentence in `contract/space.ts`.
7. W1-C remains gated on blockers 1 and 2, not on round 2's FAIL 2, which **is** fixed.
