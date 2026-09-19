# W1-B3 — hostile verifier: **FAIL** (one behavioural divergence; everything else holds)

Verified 2026-09-19, `8a607d0` against `01a23d2`, both as commits in two temp worktrees (junctioned `node_modules`, removed junction-first; shared pnpm vitest store 114 files before and after). No game running. **Every probe ran inside a worktree — the main checkout was never edited**, and no scratch file survives. The other engineer's lab-renderer WIP was never touched; the lab suite was run from the committed tree.

## THE FAIL — rejections moved from the body to the edge

`Runtime.applyPlan` now filters each step through `gate.admitIntent` → `checkIntent`, which refuses any intent carrying an argument **that action** does not declare, irrespective of `required`. At `01a23d2` such a step reached the BODY, which either executed it (ignoring the extra field) or refused it as physics — and a physics refusal is an `IntentRejected` event the being **remembers**. That memory is now gone.

Minimal repro, one conscious being, one scripted decision, `forager-classic` (9 of 12 probes change; controls identical):

| decision the model emits | `01a23d2` | `8a607d0` |
|---|---|---|
| `{kind:"Eat",targetId:4}` | body → 5× `IntentRejected(not-in-inventory)` | plan empty, 0 events |
| `{kind:"MoveTo",x,y,targetId,objectKind,buildKind,durationTicks}` | body **executed** the move | dropped; the being never moves |
| `{kind:"Sleep",objectKind:"berry"}` | body slept | dropped |
| `{kind:"Gather",x,y}` | `IntentRejected(out-of-range)` ×5 | dropped, silent |
| `{kind:"Attack",objectKind:"club"}` / `Craft{targetId}` / `Speak{x}` / `Dig{x,y}` / `Idle{buildKind}` | body event each time | dropped |
| `{kind:"MoveTo",x:120,y:140}`, `{kind:"Eat",objectKind:"berry"}` (controls) | identical | identical |

At scale, on my byte-dump: `conscious-classic` diverges at **corpus record #0, field `resolvedOutput`, tick 7**; the ordered event log diverges at **index 0**; `IntentRejected` 281 → **315**; `totalKnowledge` 419 → **452**; both checkpoint fingerprints move. `conscious-continent`: first record diff at index 4 (tick 65), event log 379 → **356**, `IntentRejected` 84 → **64**. Prompts and the run manifest are byte-identical; what changed is what was *decided*.

This is reachable by any model that adds a stray field — the commonest LLM failure mode, and one the old parser deliberately tolerated. `resolvedOutput` is corpus data and `COGNITION_SCHEMA_VERSION` is still **3**, so v3 rows recorded before and after this commit are no longer comparable. The gate does count it (`badParam: 3` in my probe), but nothing asserts it and `admitIntent`'s own comment claims "Zero on every count in the forager world".

**Smallest neutral fix:** at this step the edge should refuse only `undeclared-action` (unreachable from both the parser and the reflex policy, hence provably neutral) and leave per-action argument checking to an opt-in a world sets — exactly the reasoning `actions.ts` already gives for not marking forager params `required`.

## What did hold

- **Reflex path: byte-identical.** Seven configs the engineer did not use (classic + continent, leadership off, craft learning at provenance off/full, myth off, a 10,200-tick season+year crossing), each dumped at two checkpoints — fingerprint, every entity, every mind's memories (incl. `context`/`needDeltas`/`craftInputs`), knowledge, relationships, narratives, goals, memory stats, body plans, ordered event log, 16 analysis facades — **all seven identical**. Goldens pass untouched; `golden-state.test.ts` and `fingerprint.ts` are unchanged vs `01a23d2`.
- **Parser: no decision changed.** Differential fuzz of `01a23d2`'s `parseMindOutput` against the new one: **72,000** generated replies over three seeds (11,641 accepted / 60,359 rejected across all 6 reason codes) plus **689** hand-built adversarial cases — every action × every arg present/absent/mistyped/out-of-vocab/duplicated, two illegal args at once in both orders, permuted key order, unknown and case-variant verbs, over-long plans and goals, every `need` value, fenced/bare/prose/double-fence forms. **Zero divergences** in verdict, reason code, message and serialised output — key order included (`kind,x,y,targetId,objectKind,buildKind,durationTicks`).
- **Transcription: correct.** All 16 actions' ids, order and arg shapes = `IntentKind` and what `YggdrasilSystem` reads; 55 kinds = `ObjectKind` (35) + `ResourceNodeKind` (20); every tag checked against its witness — `object`=`ObjectKind`, `source`=`NODE_YIELD` keys, `nourishing`/`sickening`=`NUTRITIOUS_FOODS`/`SICKENING_FOODS`, `edible`/`diggable`/`foodSource`= the old reflex sets, `material`/`tool`=`CRAFT_RECIPES` in/out, `structure`=`BuildKind`, `container`={container}. `objectKind` and `buildKind` vocabularies equal the old `OBJECT_KIND_LIST`/`BUILD_KIND_LIST` **in order**; `planArguments` reproduces the old read order exactly. Mutations bite: swapped actions, swapped kinds, a dropped tag, a changed arg shape, a re-ordered param list and a re-bound core verb each redden the suite.
- **`defineForagerWorld` buys back the B2 typo check.** Ten typo classes — event id, `recordsAs`, drive, context feature, context slot, action id, kind id, source kind, core verb, affordance tag — are all `tsc` errors again.
- **The reflex move is verbatim.** `consciousness/ReflexMind.ts@01a23d2` vs `worlds/forager/reflexPolicy.ts`: four hunks, all declared — import paths, the header comment, `implements ReflexPolicy`, and the added `foragerReflexPolicy` factory. With comments, imports and the factory removed the two files are character-identical.
- **Nothing in the mind reaches a world.** My own grep of the seven mind directories finds no `worlds/`, no `../index`, no dynamic `import(`. The compile proof now goes RED from `schema.ts`, `LlmMind.ts`, `MockMindBackend.ts`, `policy.ts`, `prompt.ts`, `AgentMind.ts`, `templates.ts`, `NarrativeStore.ts`; the guard and the proof each catch the barrel and dynamic routes from `LlmMind`/`MockMindBackend`. **All three B2 backlog items are closed.** The guard also now catches `String.fromCharCode`, `.join('')`, regex source, and a table two modules away.
- **`WaitingMind`.** Emits the `Wait`-bound action, a fresh plan object per call; a world with no `Wait` binding and a world with no actions at all both get an empty plan and never throw; forager gets its own policy, the toy world gets waiting. No cross-talk with three adapters live in one process.
- **`importanceOf` is total.** Ten junk slot values (`undefined`, `NaN`, `±Infinity`, `'5'`, `{}`, `[]`, `true`, a function, `null`) all give a finite, unchanged result; well-formed deltas weigh exactly what they always did. My B2 NaN reproduction is gone.
- **Lab bridge.** Nine bad `worldId` forms — absent (the legacy 2-arg call), `null`, number, object, array, empty string, unknown world, near-miss with a trailing space, and the *scenario* id mistaken for the world id — all refused with **zero** backend calls; the engine-built forager pair and its retry variant both reach the backend; a prompt built from a different action vocabulary carrying the forager id is refused. The mcp/lab edits are minimal and forced by the new required options.
- **Suites:** engine **587/587**, `tsc --noEmit` exit 0, mcp **13/13**, lab **338/338** — all single-worker, heap-capped.

## Backlog
1. **The fix above**, plus a regression test that a stray argument still produces the body's `IntentRejected`; and bump `COGNITION_SCHEMA_VERSION` if the edge is kept as it is, because v3 rows now mean two different things.
2. **`prompt.ts:54–57` is not prose.** The whole argument-shape paragraph — `MoveTo{x,y|targetId}, Gather{targetId}, Eat{objectKind}, Build{buildKind,x,y}, …` — is one world's `ActionBinding.params` rendered by hand inside the mind. B3 declared that data and did not use it: only the verb list is adapter-driven, so a second world is told the forager's arg shapes. It is pinned as "B5 — prose", which understates it; render it from `world.actions` at B3.
3. `schema.ts:160`'s refusal message names the forager action `Idle`; `NarrativeStore.ts:36` carries `'made the first spear'`. Both are seen by a model. B5.
4. **The guard cannot police verbs or kinds at all** — not just the admitted `Give`/`Build`/`Flee` and `stone`/`water`/`game` collisions: `MoveTo`, `nightshade`, `berryBush` collide with nothing and still pass. The stated substitute (the compile proof) is genuine, but the non-colliding subset could be policed cheaply.
5. `authorEvent`'s clamp is **completely silent** — no counter anywhere, and every gate count stays zero while a payload is rewritten in place. Give it a counter beside `badParam`.
6. Source kinds are ordered by `NODE_YIELD` rather than `ResourceNodeKind` (documented; harmless today because no param carries `tag:'source'`, but a future one's refusal hint would follow that order). `kinds.ts`'s header says "34 `ObjectKind`s"; there are 35.

## What B4 (`space`) and B5 (`lexicon`) inherit
**B4:** `X`/`Y` params on `MoveTo`/`Build`/`Flee` and `ParamType 'number'` carrying coordinates; `targetId` as a raw entity handle (`ref`); memory `x`/`y`; `WorldView.agents[].x/y`, `night` and `season` (pinned in `IMPORTED_STILL_LEAKING`); `SuccessionMiner`'s `radius: 8` and `windowTicks: 600`; `RelationshipStore.DECAY_INTERVAL = 2400` — a forager day sitting in the mind; `sacredPlace`/`tragedyPlaces`; `Interventions.relocate` + `geography.clamp`.
**B5:** `prompt.ts` (after item 2, the remaining world prose and the needs paragraph); `learning/templates.ts`; `describeEpisode`; `Narration`'s English; knowledge `statement` stored as English rather than rendered; the `hint` strings on `KindParam` (already world-side, which is the right shape for the rest to follow).
