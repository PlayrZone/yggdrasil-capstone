# W1-B — The WorldAdapter seam (design brief, 2026-09-18)

Design authority for Wave 1 items W1-B1…B6 and W1-C. Read with `ARCHITECTURE.md` §2–§3, audit 01 §4, audit 04 §3–§4, and the nine-item leak list in `reviews/W1-A1-verifier.md` §5.

## Goal and the one test that decides it

One unchanged brain lives in any world. The brain is `agent/ memory/ learning/ knowledge/ relationships/ narrative/ consciousness/` (collectively **the mind**). A world is everything else. The seam between them is a single object of DATA + a few pure functions, supplied by the host: the `WorldAdapter`.

**Acceptance (W1-C):** a second world — a modern town with different drives, affordances, actions, events and geometry — runs end to end with `git diff --stat` EMPTY over the mind directories, a critic reading 20 behaviour traces cannot tell the world from the mechanism, and no world noun appears in mind code or in the prompt skeleton (enforced by a test that greps the mind for every id declared by every adapter).

## Principles

1. **Data, not English, not coordinates.** The mind sees opaque ids, typed features, magnitudes and refs. Every word a being could say or read comes from the adapter's lexicon. Every distance comes from `space`.
2. **The adapter declares; the body enforces; the mind discovers.** The adapter lists which actions exist, not what they achieve. Consequences stay physical (the body + world systems); beings learn them through outcomes. Nothing in the adapter may be shown to a mind as a fact.
3. **Reflex policy is world-side for now.** `ReflexMind` is a hand-written survival policy full of this world's nouns. It moves to the forager world as that world's `reflexPolicy`. W1-D replaces hand-written policies with drive arbitration over LEARNED affordances and skills; until then a world without a reflex policy simply runs its minds on the slow path / idle.
4. **Every step is behaviour-neutral until it cannot be**, and says which it is. Table extraction and retyping keep goldens bit-identical. The first deliberate behaviour change is the core action vocabulary (B3), and it only changes what an LLM mind is offered — reflex goldens still hold.
5. **The instrument is per-world too.** Ground truth (`mechanics`), region names, sacred-place radii etc. are adapter data read by the instrument, never by the mind.

## The contract (sketch — names may improve, the shape may not)

```ts
interface WorldAdapter {
  id: string; version: string;
  drives: DriveSchema[];            // {id, pressingAt, criticalAt, decays: boolean}
  context: ContextSchema[];         // {id, type: 'boolean'|'band', bands?: string[]}
  events: EventSchema[];            // {id, roles, salience, relationshipDeltas?, observerDeltas?, narratable?}
  actions: ActionBinding[];         // {core: CoreVerb, id, params: ParamSchema[]}  world verb bound to a core verb
  kinds: KindSchema[];              // {id, tags: AffordanceTag[]}  e.g. {id:'berry', tags:['consumable','gatherable']}
  space: SpaceOps;                  // distance(a,b), direction(a,b) -> DirectionId, within(a,r), sample(rng)
  time: TimeOps;                    // ticksPerDay, phaseAt(tick) -> ContextFeature values, ageBands
  lexicon: Lexicon;                 // phraseFor(id, slots), kindNoun(id), directionWord(id), felt phrases, locale
  cognitionDefaults: {...};         // think/consolidate cadence, memory capacity curves (today: magic numbers in Runtime)
  reflexPolicy?: ReflexPolicyFactory;   // world-side stopgap (principle 3)
  mechanics: MechanicsOracle;       // INSTRUMENT ONLY: declared regularities for ground-truth grading
}
type CoreVerb = 'Move'|'Take'|'Use'|'Combine'|'Give'|'Say'|'Attend'|'Rest'|'Build'|'Contest'|'Flee'|'Wait';
```
The mind's own types become id-based: `DriveId`, `KindId`, `EventId`, `ContextFeatureId`, `ActionId`, `PlaceRef` (opaque, comparable only through `space`). Literal unions (`ObjectKind`, `SimEventType`, `NeedKey`, `ResourceNodeKind`, `IntentKind`) live in the forager world and nowhere else.

## Steps (each = coder → senior review → hostile verifier → local commit)

| Step | What | Gate |
|---|---|---|
| **B1 — tables out** | Create `contract/adapter.ts` + `worlds/forager/adapter.ts` describing TODAY's world exactly. Mind modules stop owning world tables and read them from the adapter: `memory/importance.ts` BASE → `events[].salience`; `RelationshipStore.EVENT_DELTAS` + `OBSERVER_APPLICABLE` + the prestige rule in `runner/EventPipeline.ts:72-74` → `events[].relationshipDeltas/observerDeltas`; miners' `FEATURES` → `context`; need thresholds → `drives`; `memoryFromEvent`'s perspective switch → `events[].roles`; cognition magic numbers in `Runtime.mindOptions` → `cognitionDefaults`; `TICKS_PER_DAY/YEAR`, `seasonAt` → `time`. | Goldens bit-identical. New test: the listed mind files contain no literal from the forager unions. |
| **B2 — ids, not unions** | Retype the mind against id types; forager literal unions move to `worlds/forager/`. Boundary validation: an id the adapter did not declare is rejected at the edge (body → mind events, mind → body intents). | Goldens bit-identical; `tsc` proves the mind no longer imports forager types. |
| **B3 — core verbs** | `Intent` = `{core, action: ActionId, args}`; `schema.ts` validates against `actions`; `prompt.ts` offers the world's bound actions from the adapter. `ReflexMind` moves to `worlds/forager/reflexPolicy.ts` (verbatim) and emits the same bound actions. | Reflex goldens bit-identical. LLM path changes deliberately → corpus schema bump; T1 battery + parser tests updated; mock-LLM equivalence on plan semantics. |
| **B4 — space** | Remove every `x`, `y`, `Math.hypot`, compass word and `{x,y}` place from the mind; `PlaceRef` + `space` ops. `sacredPlace`/`tragedyPlaces`, narrative locations, `nearest`/`wander` go through `space`. | Goldens bit-identical (forager `space` = today's Euclidean plane). Test greps the mind for coordinate access. |
| **B5 — lexicon** | Prompt skeleton with slots; ALL world prose (`prompt.ts` world paragraphs, `learning/templates.ts`, reflex greetings, `promptCulture` felt phrases, `Narration` English, region names) → forager `lexicon`. Knowledge statements are rendered from rule structure + lexicon at display/prompt time, not stored as English. | Prompt bytes identical for the forager world (replay tests prove it); goldens bit-identical. |
| **B6 — instrument per world** | `analysis/groundTruth.ts` derives from `mechanics`; `beliefBehavior` radii, `regionAt`, the public `AgentDetail` lose forager types; `RuntimeView.agentBody` stops being `GahallianBody`-shaped. Directory move: `src/mind/**`, `src/worlds/forager/**`, `src/host/**`; an import-graph test enforces mind -/-> worlds. | All analysis outputs identical on existing tests. |
| **W1-C — second world** | `worlds/town/`: drives hunger / rest / money / belonging; kinds flat, shop, job-site, vending machine, bus stop; events paid, hired, evicted, bought; actions bound to the same core verbs; graph-shaped `space` (streets), not a plane. Minimal body systems for it. No reflex policy at first (proves principle 3). | THE test above. Plus the cross-world transplant eval from audit 04 §5 (#6) wired for mock; real run needs budget. |

## Decisions taken (senior engineer)

- Forager world stays the default and keeps its results reproducible at every step up to B3.
- Stored knowledge keeps its machine-comparable `rule` structure; English `statement` becomes a rendering, not data (B5). Existing corpora keep their schema version; B3 and B5 each bump it.
- `WitnessedDeath`-style derived memory types become adapter `roles` data, not code.
- Narrative CONTENT (which events are narratable, how a telling is worded, any drift model) is world/culture data. The authored escalation ladder is deleted in W1-D, not ported.
- Separate npm packages for mind vs worlds are deferred until B6 proves the import direction with a test; the directory move comes first.

## Risks

- B1–B2 touch nearly every mind file; they must land while no other engine item is in flight in those directories. One engineer at a time on the mind.
- The prompt is a behavioural surface: B5 must be byte-identical for the forager world or every LLM-path comparison made so far loses its baseline.
- A too-clever adapter becomes a second engine. Keep it declarative; if a world needs code, that code is a body system on the world side, not a callback the mind invokes.
