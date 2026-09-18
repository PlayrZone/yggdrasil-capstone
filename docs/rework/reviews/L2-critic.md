# L2 — sim off the UI thread — Round 1 **FAIL** · Round 2 **PASS** (with nits)

Built `@yggdrasil/lab` from the working tree, drove the real Electron app twice via `_electron.launch`,
isolated `YGG_HOME`, no key, reflex. Shots `~/.yggdrasil-lab/rework/shots/L2/`. PIDs: A=6680 (killed,
gone); B=70348 + 72188/69676/68956/67932 (app.close, all gone). No source edits; `packages/lab` status
byte-identical to how I found it; build output is gitignored.

## Defects

**D1 — HIGH — the sim can die and the UI says nothing.** Repro: session B, kill the worker
(`worker.evaluate(() => close())`) while running at 2400×. Result: `workers 1 → 0`, day frozen at 3,
world frozen, **button still reads "Pause"**, no banner, `/worker|error|failed|disconnect/` absent from
`document.body.innerText`; pause still answered in 19.8 ms — the UI happily animates a corpse
(`B09-after-worker-killed.png`). Cause: `SimClient.onError` (`client.ts:65`) is emitted to from three
places (`:42` worker onerror, `:157` version mismatch, `:162` worker `error`) and **has zero subscribers
anywhere in the renderer** (`grep -rn onError src/renderer | grep -v sim/client.ts` is empty). Riders:
(a) the protocol-version check (`client.ts:155-159`) is decorative — it reports into the void, and both
chunks are built from one `protocol.ts` in one build so it can never differ anyway; (b) a worker
`{kind:'error'}` never rejects the pending `reqId` (`client.ts:119-163`), so `usePolled`'s `inFlight`
latch (`App.tsx:33-45`) sticks `true` forever and that tab stops updating permanently.

**D2 — HIGH — memory climbs without bound and never comes back.** Tab-process working set
(`app.getAppMetrics()`, KB→MB): **123 MB at boot → 2177 MB** after ~80 s at population 256 / 2400×
→ **2657 MB** after 5× "New world" (each a fresh Day-1 world). Page JS heap is **flat at 28 MB**
throughout, so this is not the UI thread. `win.reload()` drops it to **226 MB**, proving it is
page-lifetime memory, not OS noise: world #6 is a 332-agent Day-3 world sitting behind 2.6 GB of RSS.
Mechanism (code read): `pump()` calls `snapshot()` once per **pump**, not per emitted frame
(`host.ts:246`), and `snapshot()` calls `exp.agentInfos()` (`Experiment.ts:633`, fresh array of N
objects) and `exp.animals()` (`Experiment.ts:693`, same) every time (`host.ts:334,353`). At 2400× that
is ~690 pumps/s × 869 agents ≈ 600k throwaway objects/second — ~10× what the 66 Hz frame cadence
(`FRAME_INTERVAL_MS = 15`) consumes — and the MessageChannel loop (`worker.ts:210-221`) never idles,
so V8 gets no idle GC.

**D3 — MEDIUM — the speed label overstates by up to ~24% at max population.** 2400× promises 3 s/day.
Measured (256 pop, day-vs-wall-clock, session A): day 2 @ 5 s → day 32 @ 110 s = **3.50 s/day**
(≈686 ticks/s vs the 800 the label sells); first half 3.13 s/day, **second half 3.93 s/day** — 24% slow
and degrading as the population reaches 863. `advanceTicks` (`host.ts:309-320`) computes exactly how
many ticks it dropped (`due - done`) and discards it. The coder surfaced `beingsAlive - beings` as
"N not drawn"; the same honesty is missing for time.

**D4 — LOW (latent) — click-to-select rides a bounding sphere computed once, never invalidated.**
`InstancedMesh.raycast` computes `boundingSphere` only when `null` (three.core.js:15041); nothing
invalidates it as matrices change. The old code got a fresh mesh per world (`setPopulation`); the new
one keeps it across `resetWorld()` (`World3D.ts:284-296`), rebuilding only on capacity growth. Worst
case: a click after `resetWorld()` sets `agents.count = 0` but before the first frame caches an
**empty** sphere (radius −1) → selection silently dead for the life of that mesh.

**Nits.** "N not drawn" sums beings *and* wildlife but sits in the being-state legend. The equivalence
test cannot fail on the interesting path: `fakeClock` (`simHost.test.ts:29-38`) never advances during a
pump, so `ADVANCE_BUDGET_MS` never trips; what is left asserts `advance()×N == advance(N)`.

## What held

- **No engine value on the UI thread.** `index-qNuWBWuM.js`: 0 hits for `class Experiment|AgentMind|
  ReflexMind|KnowledgeStore|NarrativeStore|SpatialIndex`; all of them in `worker-Bf7OBMG9.js`.
- **Zero UI long tasks.** PerformanceObserver(`longtask`): **0 entries in every window** — 6613 frames
  on the world tab at 256 pop/2400×, plus Analysis/Society/Culture/Activity/Reports/World-return.
- **Frame pacing.** World tab p50 16.7 / p95 17.7 / p99 18.5 / worst 22.6 ms; every other tab p99 ≤ 17.3,
  worst ≤ 19.6 ms — no hitching in any shot.
- **Latency at 256 pop / 2400× — all ≪ 100 ms.** pause 27.4, resume 28.6, speeds 20.5–32.0 (all seven),
  tabs 19.3–32.6 (all six), **New world 26.4 / 34.3 / 42.0 / 46.3 / 29.7 ms** over five rebuilds.
- **No silent truncation.** "N not drawn" never appeared, at 256 pop or after 33 days / 869 agents.
- **Lifecycle.** Exactly **1 worker** at boot and after each of 5 rebuilds; page heap flat at 28 MB;
  rebuilds deterministic (306/318 alive, Day 2, every time). Close took **87 ms**, no orphan PIDs.
- **No blank-window crash.** ~7 min runtime, 11 tab switches, 5 rebuilds, day 33: zero page errors bar
  the ones my own synthetic PointerEvents caused in OrbitControls. The `removeChild NotFoundError` the
  coder says HEAD hits never reproduced.
- **No visual regression** (World vs baseline `07`, Analysis vs `08`): identical layout, type, colour;
  only sim data differs. `STATE_RGB` matches the legend hexes. The diff's only style change is
  `+.legend .warn`, which renders only when beings are dropped.
- **LLM proxy fails soft.** Reflex never builds a `ProxyMindBackend` (`host.ts:267`, `llm: null`), so no
  worker hang is reachable; the no-key path returns main's `NO_LLM_KEY` (`main/index.ts:193` →
  `client.ts:172-179` → `host.ts:89-95`), covered by `simHost.test.ts:306`. Lab tests 80/80 in 5 files;
  `tsc -p tsconfig.node.json` and `-p tsconfig.web.json` both clean.

## Not verified — the coder must demonstrate
**Selecting a being, selection-tracking across births/deaths, give-idea.** 384 synthetic canvas clicks
across both sessions (104 unzoomed, 280 zoomed on a 20×14 grid) landed on **no** being, so the inspector
never opened and the idea box stayed disabled. That world held only ~6 visible capsules in frame
(`B01-inspector.png`), so I will **not** call selection broken — but with D4 open it is unproven.

---

# Round 2 — **PASS** (with nits)

One Electron session, 180 s, PID **82904** + children 57156/83100/44732/71088 — all exited on
`app.close()` (110 ms), every PID verified gone. Isolated `YGG_HOME`, no key, reflex, population 256.
No source edits; scratch outside the repo. Shots `R2-01`…`R2-07`.

**D1 — FIXED, and it survived every attack.** Three different deaths, all caught:
- *wedged* (alive, 14 s busy-loop): banner in **6 s** — "The simulation stopped — the simulation stopped
  responding (6s without an update). The world is frozen at Day 7; nothing you see below is advancing."
- *throwing* (`setTimeout(() => { throw })` inside the worker, worker stays alive): banner names it —
  "the simulation worker crashed: Uncaught Error: L2R2 injected worker throw … frozen at Day 4".
- *`close()`*: banner in **5 s**, `workers 0`.
Run reads `Run(disabled)` in all three; New world disabled; the bar is a full-width red band with a
Restart button and is visible over the Analysis tab, so the frozen numbers under it are disclaimed,
not sold as live (`R2-03`). **Restart** cleared the fault, spawned one worker, rebuilt, and the world
advanced (Day 1→2); Analysis went live again with *different* figures (187 → 154 beliefs) — proof the
old round-1 `inFlight` latch no longer sticks. **No false positives**: 55 s slow-but-alive at 256 pop /
2400× (no banner), 14 s **minimised** with timers throttled (no banner, day still advancing on restore),
11 s **paused** (no banner), five max-pop `New world` builds (no banner).

**D2 — host contribution is gone; the residual is not the host's.** `snapshot()` now runs inside
`capture()` only when a frame goes out (`host.ts` pump/capture), and `simHost.test.ts:266` is a test that
can actually fail — 2000 pumps, `infoCalls <= frames + 1`. Measured RSS (Tab process): boot **119 MB**
→ **1028 MB** over the 55 s run → 1456 MB by t=90 s. Across 5× New world: **1848 → 1700 → 1697 → 1697 →
1695 MB — flat**, i.e. no per-rebuild leak. `restart()` (terminate + fresh worker) drops it to **248 MB**.
That pattern — grows with sim time, flat across rebuilds, released only when the worker dies — is
consistent with the coder's attribution to engine-side retention, and I am not failing L2 for it.
**But New world does not release**: a fresh Day-1 world sits behind ~1.7 GB until the app restarts,
and `restart()` already proves the cheap fix (recycle the worker on New world) reclaims 1.4 GB in ~2 s.
Paused CPU: Tab `percentCPUUsage` **3.8 → 0.6** after 11 s paused (running ≈4.4); page heap flat at 17 MB.

**D3 — honest, but the indicator blinks.** Measured myself: Day 2 @ 11 s → Day 17 @ 61 s = 15 days /
50 s = **3.33 s/day ⇒ ~2160× achieved** against the 2400× asked. The label read `2400× asked · 1970× /
1850× / 1860× / 2090× achieved` — within ~3% of my rate over the matching window, ~10% over the whole
run, and always on the conservative side. It correctly vanished at 30×. **Defect:** it was *absent in 6
of 11 five-second samples*, including at Day 17 where the run-average was 10% below the asked rate
(`R2-01` shows a bare "SPEED — 3S / DAY" at that moment). Cause: `updateAchieved` resamples over a
window as short as 400 ms and `SpeedLabel` applies a hard 5% threshold to it, so a rate hovering near
2280× flips the label on and off at up to 4 Hz. Needs a longer window and/or hysteresis. LOW-MEDIUM.

**D4 — FIXED and now provable.** `window.__ygg` exposes exactly `["drawnIds","screenPositionOf"]`, both
pure reads — no sim mutation, no client handle, no IPC reach; it is not a privilege surface. 228 drawn
ids at 226 alive. Clicked `screenPositionOf(1830)` with a real mouse: inspector opened first try
(≤196 ms incl. a 180 ms driver sleep) on *Gahallian #2551*. After 9 s of births/deaths that being was
still drawn and still selected, with the panel live (region Plains→Forest, confidence 99→100%).
`mesh.boundingSphere = null` per frame (`World3D.ts:412`) is the right fix. Give-idea: 17.1 ms, input
cleared; delivery itself is not observable in the UI (an idea lands in memory, not knowledge) and rests
on `simHost.test.ts` — the one part of D4 still taken on trust.

**Budget 8 → 16 ms: no regression.** pause 19.0, resume 17.6, speeds 19.6–20.4 (five), tabs 12.4–17.7
(six), New world 20.1–48.0 (five), give idea 17.1 ms — all better than round 1. **0 long tasks** in both
windows (4822 + 935 frames); rAF p99 15.7 / worst 21.5 running, p99 15.4 / worst 30.3 through the
control sweep. Throughput improved too: 3.33 s/day vs round 1's 3.50. Visual parity intact (`R2-01` vs
baseline `07`); the only new chrome is the fault bar and the achieved suffix, both conditional.
Lab tests **103/103** in 6 files; both typechecks clean; UI chunk still holds 0 engine classes.

**Nits.** `World3D.animalKinds` is append-only and never cleared (`World3D.ts:86,380`), but
`client.restart()` gives the worker a fresh `KindCodec` that re-assigns codes from 0 — after a restart
wildlife can take the previous table's colour and size. Cosmetic, post-restart only.
