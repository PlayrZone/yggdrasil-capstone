# `runner/` — the experiment host

`Experiment` used to be 1,400 lines: world generation, the tick loop, the
event→memory pipeline, narrative authoring, reproduction, bonding, culture
assembly for prompts, the interventions, the recorder, ten analysis facades and
four A/B switches. The simulation and the research instrument were one object,
and audit 01 §3 traces every "the measurement is the mechanism" finding back to
exactly that. W1-A split it. Nothing about the simulation changed — the golden
fingerprints are bit-identical.

## Modules

| Module | Owns |
|---|---|
| `Experiment.ts` | **The facade.** Composition and delegation only; its public surface is unchanged, because `packages/lab`, `packages/mcp`, the bench and the goldens all speak it. |
| `Scenario.ts` | **What world exists.** `Scenario` (the interface) + `ForagerScenario` (the one implementation): terrain, the resource-scatter tables, the founders, the wildlife, the demography, this world's narrator. |
| `Runtime.ts` | **The simulation.** `SimRuntime`: the world, the body systems, the bus, the mind registry, the tick loop and its order, the scheduling glue, the roster, the clock. |
| `EventPipeline.ts` | One global event → N partial views: counters, story, each witness's memory / narrative / respect. **Owns the listener order.** |
| `RunCounters.ts` | Cumulative tallies + the capped tail of the event stream. |
| `society/` | Population-level processes as explicit systems: `CoPresence`, `Reproduction`, `Narration`. Each has its own file, its own cadence, its own RNG, and its own tests. |
| `Interventions.ts` | The sanctioned, ledger-written ways a driver may intrude on a run. |
| `recording.ts` | The lossless cognition recorder's construction and its read-only window on the world. |
| `promptCulture.ts`, `kinship.ts` | The stories / kin / felt-relationships a being's prompt is given. |
| `RuntimeView.ts` | **The seam.** The read-only interface the instrument — and only the instrument — sees the runtime through. |
| `instrument/` | Every analysis facade and observatory accessor, as functions over a `RuntimeView`. |
| `options.ts` | `ExperimentOptions`, `RecordingOptions`, the A/B `RunFlags`. |

## Direction of dependency

```
Experiment ──> Scenario ──> society/Narration
     │
     ├──────> SimRuntime ──> EventPipeline · society/* · recording · promptCulture
     │              │
     │              └── (implements) ──> RuntimeView
     ├──────> Interventions ──> SimRuntime
     └──────> instrument/  ──> RuntimeView          ← reads, and is read by nothing
```

**Nothing in the runtime may import `analysis/` or `instrument/`, and nothing
but the facade may publish the instrument.** `test/runner-layering.test.ts`
reads the import graph and fails if any of that reverses. A measurement that
cannot be read back cannot become the mechanism.

## Per-tick order (`SimRuntime.advance`)

Load bearing; `test/golden-state.test.ts` locks it.

1. `world.spatial.reconcile()` — re-home anything a host moved between ticks.
2. `ResourceNodeSystem.step`
3. `WildlifeSystem.step`
4. `WorldRegularitiesSystem.step`
5. `YggdrasilSystem.step` — per living being: needs, afflictions, death, one intent.
6. `recorder.tick(tick)` — sampled **here**, before reflex takes a finished plan away.
7. society systems, in array order, each on `tick % intervalTicks === 0 && tick > 0`:
   `CoPresence` (150) then `Reproduction` (300).
8. per mind, in registry (birth) order: maybe consolidate → if `planDone`, reflex
   `think` → on the think cadence, submit to the slow mind (applies whenever it lands).

## Listener order (`installEventPipeline`)

Registration order is firing order. `test/runner-listener-order.test.ts` asserts it.

1. `recorder.observeBefore` — "who already knew this?" is only answerable before
   the witnesses hear an utterance.
2. the world's own pass — counters, then the story, then every witness.
3. `recorder.observeAfter` — "who took it in?" is only answerable after.
4. `entomb` — **last**, so every other reader of a being that just died has
   already run.

## RNG streams

Four, independent, each keyed off the run seed and consumed in exactly one place:
`<seed>:world` (scatter, in `ForagerScenario.build`) · `<seed>:genesis` (founder
placement, in `spawnGahallians`) · `<seed>:wildlife` (`WildlifeSystem`) ·
`<seed>:repro` (`ReproductionSystem`, pairing + trait blending + birth position).

## Which side of the future `WorldAdapter` line

W1-B turns `Scenario` into adapter #1. Sorting for that:

**World side — goes behind the adapter.** Everything in `Scenario.ts`; the
narrator in `society/Narration.ts` (it decides which deeds can be stories at
all, and writes English); `promptCulture.ts`'s phrasing (becomes `lexicon`);
the geography still reached directly by `society/Reproduction.ts`
(`clampToWorld`/`isDeepWater`) and `Interventions.ts` (`WORLD`, `clampToWorld`)
— inherited leakage, flagged in audit 01 §4, deliberately left in place here
because moving it would move where children are born.

**Host side — stays.** `Runtime.ts`, `EventPipeline.ts`, `RunCounters.ts`,
`recording.ts`, the cadence machinery in `society/SocietySystem.ts`,
`Interventions.ts` (minus the geography), `RuntimeView.ts`, `options.ts`.

**Instrument side — stays, and stays unreachable from the other two.**
`instrument/**` and `analysis/**`.
