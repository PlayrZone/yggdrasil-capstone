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
