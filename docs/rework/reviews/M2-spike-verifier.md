# M2 edit-index spike — hostile verification

**PASS** (with backlog). Bit-identity holds under an independent fuzzer, index==rebuild holds, benchmarks reproduce. No break reachable with finite in-world coordinates.

Worktree `agent-acd23fd9c51fdc00b` @ `ce76fef` only; scratch deleted, `git status` clean. My reference is the **real pre-spike class** from `git show 71a55ed:…/VoxelStream.ts`, not the spike's copy — though I diffed that too: `editInfluence`, `distToPolyline`, `cellDither`, all three `stamp*` helpers and both fold bodies are verbatim. The "verbatim" claim is honest.

## 1. Bit-identity — 0 mismatches

`Object.is` on density AND material, both classes in one process on identical inputs. 50 random histories × all 10 verbs; sub-voxel → world-spanning; zero-volume, inverted (negative extent), empty/1-point polylines, unresolved stamps, all 4 rotations, repeated identical edits, negative / beyond-world / far-outside coords. Probes on every AABB face and corner ±1–2 ulp, index-cell planes at levels 0/1/2/4 and chunk planes ±ulp, cluster interiors, far, and out-of-bounds (which `materialAt` does *not* guard). **>50,000 probes, 0 mismatches.** Plus 20 undo/redo/multi-undo/full-unwind/reload histories (index ends exactly empty), `surfaceY` over 2,400 columns, the dig↔build ordering trap, and **non-power-of-two `voxelSize`** (0.3/0.7/1.25/3 — production uses 0.75) where `1/cell` is inexact: still exact, because `1/(cell·2ᵏ) == (1/cell)/2ᵏ` bit-for-bit, so `floor(x·inv₀)>>k == floor(x·invₖ)` always. **Meshed geometry compared buffer-for-buffer** (position, `aMaterial`, index) over 6 histories with mid-history undos — identical.

## 2. The 1 µm PAD — the brief's premise is wrong, the pad is fine

Bit-level binary search for the exact double where each verb's own coverage test flips, vs the padded and unpadded face; 24,300 boundary probes per verb per scale, 1e0…1e12.

- **Not demonstrably necessary below ~1e10 m**: 0 unpadded misses at 1e0–1e9. Round-to-nearest plus Sterbenz-exact differencing leaves no double in the gap between real `x−s` and `fl(x−s)`. Cheap insurance, not load-bearing — keep it, but the comment overstates the risk.
- **Sufficient at 1e5–1e6 with ~5 orders of margin.** "One ulp exceeds 1 µm at 1e5–1e6" is a *float32* fact: `ulp(1e6)=1.16e-10`, `ulp(1e7)=1.86e-9` in float64. But it is **absolute, not relative**: first misses appear at 1e10 (worst 9.5e-7, just inside) and it becomes **insufficient at 1e12** (`pathdig`, 8 breaks, worst overshoot 1.2e-4 — projection error scales with magnitude). Unreachable: a world is `dims·voxelSize`, and end-to-end runs at 1e3/1e5/1e6/1e7 m origins were exact. Backlog: document the ~1e10 m ceiling or scale the pad (`1e-6 + |c|·2⁻⁴⁰`).

## 3. Incremental maintenance — exact

10,000 mixed apply / stroke-sized multi-undo / multi-redo ops, snapshotted at 10 checkpoints against a from-scratch rebuild: every level's cell→id map, the `active` list, the whole packed bounds table and `stats()` deep-equal; full unwind returns it pristine. Cursor candidates vs brute force at 6,000 points over 300-edit histories: **exactly** the AABB-covering set in ascending global edit order — set *and* order, nothing stale, nothing dropped; still exact after popping 400 edits one at a time.

## 4. Benchmarks — reproduce; harness is honest

"Before" really is the un-indexed class (at `f49972d` the report drove `StreamingVoxelWorld` itself). Sample points are randomised over a disc and consecutive points land in different cells, so the cursor memo is **not** exploited by the density bench. Mesh timing runs `applyEdit`→`remeshAround` and includes surface-nets, per-vertex `effectiveMaterial` and normals — a full re-mesh. My re-run, both paths in one process:

| | 0 | 1k | 10k | 100k |
|---|---|---|---|---|
| building density far | 43→49 ns (**0.88×**) | 12.7 µs→93 ns (137×) | 185 µs→74 ns (2,509×) | 2.03 ms→92 ns (22,029×) |
| building density settlement | 38→46 ns | 19.5 µs→141 ns (139×) | 204 µs→204 ns (1,001×) | 2.07 ms→549 ns (3,777×) |
| terraform density settlement | 59→79 ns | 46.9 µs→3.35 µs (14×) | 478 µs→15.0 µs (32×) | 4.16 ms→174 µs (24×) |
| building chunk mesh far | 7.7→5.4 ms | 370→2.4 ms (155×) | **6.85 s→7.2 ms (952×)** | — |
| building chunk mesh settlement | 2.3→1.1 ms | 140→1.9 ms (75×) | 2.46 s→2.7 ms (899×) | — |
| index build (`push` only) | — | 0.9 ms | 10.4 ms | **52 ms** (note said 89 — conservative) |

I also closed one number the note left open: **cold NavGrid page at 10k building edits 2.5–2.8 s → 1.3–2.2 ms (1,162–2,095×) — M2's "< 20 ms" met with 10× headroom** (terraform settlement 29.5 s → 585 ms, misses). Four caveats to record: (a) an edit-free world is **12–18 % slower** (43→49 ns) — real, small; (b) `mesh far < 5 ms` is base-field-bound, not index-bound — 7.2 ms at 10k but 5.4 ms at **zero** edits, so that target is machine-dependent and the index is no longer its dominant term; (c) the ns figures are steady-state — data-cold first touch is 1.5–3.5× worse (far 140–460 ns, settlement@100k 1.9 µs), still fine; (d) `stats().bytes` **understates heap by 1.3–2×** (10.7 MB reported vs 19.8 MB `heapUsed` at 100k), so the 10⁶-edit projection is ~200–300 MB, not 110–230 MB.

## 5. NavGrid.invalidateBox — correct

Vs full invalidate + rebuild over 10 trials: every surviving page is cell-for-cell identical to a freshly built one, and **440 A\* queries return identical waypoints and costs**. Non-vacuity checked (an un-invalidated grid *does* differ). Clearance growth is conservative and sound — columns sample at cell centres, so `clearance = 0` is already exact and NavGrid has no agent-radius concept yet. Page-boundary semantics correct; a world-spanning edit over 9 resident pages took 19 µs (cache-walk, not region-walk).

## 6. No regressions

engine **1127/1127**, worldgen **192/192**, validate 41, new-game 9, web 14, csharp 4; engine build clean; all four CI typechecks (engine / worldgen / playground / boot) exit 0.

## 7. Backlog before this leaves "spike"

1. **Must fix — a NaN coordinate now throws where it did not.** `levelFor` returns `NaN`, `levels[NaN]` is `undefined`, so `applyEdit` throws *before* `edits.push`. A `WorldEditSession`-shaped host has already done `_edits.push(op)` → session and terrain **desync**, and the next undo pops the wrong delta (reproduced). Pre-spike the same delta applied and NaN-poisoned density. Separately `pathdig` with a NaN point diverges silently. Guard `editAabb`/`levelFor` — better, reject non-finite deltas in `WorldEditSession.apply`, which fixes both eras.
2. **Measure at M2's stated scale.** M2 says a *2 km* world; the spike measured 512 m. Cell size is unchanged (the 2 m floor holds to 131 km) and sparser edits should help, but re-run it. The 300-agent tick is still unmeasured.
3. **Worker meshing will not inherit this index.** `Map<number, number[]>` is not structured-cloneable at any sane cost. Plan a flattened CSR snapshot (offsets + ids typed arrays + the existing bounds `Float64Array`) built once per publish — decide before worker meshing starts. LOD is unaffected: stride-2 rides the same `sampleDensity` and geometry was identical, so no new seam.
4. Wire `invalidateBox` to `WorldEditSession.onApply`. Watch the remap: it takes canonical z-up *horizontal* `(x, y)` while `editBounds` returns stream y-up — an easy silent swap.
5. Document `MAX_CELLS_PER_EDIT = 64` and `base = 2·voxelSize` as tuned on one box and two synthetic mixes; re-tune on a real being-built world.

**Per-region baking:** not needed for the beings' workload — building at 100k edits samples at 549 ns, meshes in ~11 ms, cover depth 5.5. It is needed only for deep terraforming overlap (150–1,535 brushes per point; a genuine ~10 µs floor the spike sits within 1.2× of). The driver toward baking *for beings* is **memory**, not speed: ~200–300 MB of index at 10⁶ edits on top of the delta list. Merge as is.

---

# Round 2 — hardening at `1e97116` + `d15fd5b`

**PASS.** Every must-fix from Round 1 is closed. Bit-identity survives the relative pad; the rejection
contract is atomic; `.gvoxworld` data compatibility is safe; `stats()` is now honest. Two one-line call-site
gaps remain (below). Worktree only; scratch deleted, `git status` clean.

## 1. Bit-identity after the PAD change — still exact

Same independent fuzzer vs the real `71a55ed` fold. >50,000 probes over 50 histories × 10 verbs; **production
`voxelSize 0.75`** plus 0.3 / 1.25 / 3; 90-step undo/redo/multi-undo runs ending with the index exactly empty;
world origins **1e3 / 1e5 / 1e6 / 1e7**; and meshed geometry compared buffer-for-buffer (position,
`aMaterial`, index) with mid-history undos. **0 mismatches.** A wider pad can only widen the superset, and it
does — confirmed, not assumed.

## 2. The PAD dispute — you are both right, about different things

Reproduced, with a witness. At 1e12 m I bisect a point the fold's own `covers` test returns **true** for,
sitting **6.10e-5 m below** the old absolute-pad `minX` face. That is by definition an escape from the padded
AABB: the index would not have offered that edit, the fold would have folded it. So the engineer is right
that it is *the fold's flip point drifting* — and that drift is exactly what made a geometry-derived AABB stop
being a superset of the fold's **computed** coverage. The new relative pad contains the same witness with
**1.27 m to spare**. Separately, his ~10⁸-probe sweep finding **zero UNPADDED escapes** agrees with my Round-1
and Round-2 data (0 in 6,000 fresh trials below 1e10) — that is the pad's *necessity*, a different question
from the absolute pad's *sufficiency*. Both measurements stand; the fix is right.

New pad measured: 1.00e-6 @1m, 1.91e-6 @1e6 (still sub-2µm in-world), 0.91 m @1e12 — **≥7,000 ulps at every
scale from 1 m to 1e15 m.** Finding closed.

## 3. The rejection contract — atomic, and it is a value

Full matrix: 10 verbs × every numeric field × {NaN, +Inf, −Inf, non-number, null, missing} =
**276 rejections, 0 throws, 0 state mutations.** After each refusal the whole snapshot — `_edits`, `units`,
open `strokeStart`/label, `redoUnits`, the sink's applied list and removal count, `serialize()`, `unitSizes()`,
`canRedo` — is byte-identical, and the next `undo`/`redo` pops exactly what it would have. `validateEditDelta`
and `apply` never disagree. Legal no-ops stay legal (radius 0, negative radius, empty `points`, unknown
material id, 1e300 coordinates). A refusal **inside an open stroke** leaves the group usable: the two good
deltas still close as one unit of size 2 and undo/redo as one. `onReject` fires with the field; `onApply` does
not. Structural garbage (unknown verb, `points` not an array, empty stamp id, `rotate: 45`, `null`) all refuse
cleanly.

**API compatibility:** `apply` went `void` → `EditApplyResult`, so nothing breaks at compile time — and
nothing checks it either. The five production call sites (`ViewportScene` ×4 — brush, box tools, stamp paste,
`applyAtlasOps`; `WorldCreator:193`) all discard the result, and **no production site wires `onReject`**
(`WorldCreator` passes only `onApply`). Previously a bad delta was recorded and corrupted the world; now it
is silently dropped — strictly safer, but invisible. One real bug falls out: `applyAtlasOps` still
`return ops.length`, so Atlas/an agent is told "5 applied" when 5 were refused. That is precisely the M3
feedback channel.

## 4. `.gvoxworld` data compatibility — safe, and deliberately asymmetric

Validation is authoring-only; load and replay bypass it. Measured on a file mixing `rotate: 45`, a NaN `dig`
and an unknown verb between good deltas: the deltas are **kept, replayed in order, and round-trip through
`serialize()` unchanged**; `attach` does not throw; unit sizes stay 1-per-delta and undo/redo walks back over
the bad ones correctly. **No silent drop, no loud failure, no ordering corruption** — the third option, keep
and tolerate. The asymmetry is real and confirmed: the identical delta is accepted from a file and refused
from a brush. Defensible (the index is now robust either way) but it is a policy the owner should sign off,
because a future "re-author each delta through `apply()`" path — a migration, cross-world copy-paste — would
silently drop them.

## 5. "Covers everything" is not a DoS

`{op:'build', x:1e308, y:1e308, z:1e308, radius:1e308}` **passes `validateEditDelta`** yet overflows its AABB,
so `push` files it as whole-space. Cost of one such edit: a **constant +30–45 ns/sample**, not a return to the
linear scan — occupancy stays `cells:1, entries:1` at the top level. Worst case 1.97× (43.7→84 ns on an
otherwise-empty world), 1.38× at 10k building edits (144→199 ns), ~1.0× on terraform, and no measurable
chunk-mesh cost (3.26→3.23 ms at 10k). Bounded and mild. It does permanently defeat the `n === 0` fast path
world-wide, so the flat-50 ns property becomes flat-85 ns. Cheap fix if wanted: clamp unboundable bounds to
the world extent instead of ±Infinity, or refuse a delta whose AABB overflows.

## 6. `stats()` — Round-1 complaint closed

Measured with three forced GCs either side, bounds allocated outside the window: building 100k **16.7 MB
estimated vs 13.0 MB `heapUsed` (1.29× over)**; terraform 100k **45.8 vs 46.2 MB (0.99×)**. It now errs
high — the safe direction for a budget — where the old formula understated by 1.3–2×. The soft cap fires
**exactly once** crossing 200 kB over 20,000 edits and does not re-fire on the way down; at the 128 MB default
100k building edits (16.7 MB) correctly fire nothing. Budget placement checks out: 128 MB ≈ 770k building or
≈ 280k terraform edits.

## 7. No regressions

engine **1131/1131**, worldgen **198/198**, world-protocol 27, yggdrasil 55, validate 41, new-game 9, web 14,
csharp 4; engine build clean; all four CI typechecks (engine / worldgen / playground / boot) pass.

## MERGE RECOMMENDATION — **merge after two one-line call-site fixes**

The engine-side work is sound and I would not hold it: bit-identity, index/rebuild equivalence, rejection
atomicity and data compatibility are all verified independently, and the two numbers I disputed in Round 1
(the pad and `stats()`) are now correct. Before merging, fix in the same change:

1. `ViewportScene.applyAtlasOps` — count only `ok` results, so an agent is never told an op landed when it
   was refused.
2. Wire `onReject` at the two session construction sites (`ViewportScene`, `WorldCreator:163`) to the existing
   log/toast path, so a refusal is visible rather than a no-op brush stroke.

Then merge. File, do not block on: the whole-space fast-path degradation (§5); the file-vs-brush asymmetry
(§4 — owner's call, worth one line in the format doc); re-measuring at M2's stated **2 km** world and the
**300-agent tick**, both still unmeasured; and the worker-meshing snapshot representation from Round 1 §7.3,
which is the one that has to be decided before worker meshing starts rather than after.
