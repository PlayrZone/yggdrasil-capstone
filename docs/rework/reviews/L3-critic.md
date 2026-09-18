# L3 — beings you can read — **FAIL**

Built `@yggdrasil/lab` from the working tree (build OK); drove the real app three times (`_electron.launch`,
isolated `YGG_HOME`, no key, reflex). Shots `~/.yggdrasil-lab/rework/shots/L3-critic/`. PIDs A 110484+4,
B 97772+4, C 106744+4 — `app.close()`, all 15 verified gone by id. No source edits; `packages/lab` is as I
found it; tests **135/135**. Ground truth was written to disk by the driver and not opened until my
readings were filed; the engineer's own `L3/*.png` were not scored.

## 2 — the stranger test (my screenshots, my picks, then `window.__ygg`)

| framing | attribute | bar | mine | |
|---|---|---|---|---|
| default cam (180 in frame, 17 px) | count in frame | ±10% | 100 (**−44%**) | FAIL |
| | count, top-left quadrant (132) | ±10% | 57 (**−57%**) | FAIL |
| | condition, 12 picks | ≥70% | 9/12 = **75%** | pass |
| | selected | 100% | none was selectable to find | n/a |
| mid zoom (73 in frame, 39.5 px) | stage | ≥80% | 8/12 = **67%** | FAIL |
| | condition | ≥80% | 11/12 = **92%** | pass |
| | activity | ≥80% | 9/12 = **75%** | FAIL |
| | heading (8-way) | ≥80% | **unscoreable** — no `headingOf` | FAIL |
| night, daylight 0.00 (46) | count | — | 30 (−35%); I read amber beings in a frame with **zero** starving | |
| wide, day 29 (293 in frame, 4.0 px) | count | — | ~10 (**−97%**) | FAIL |

Picking works: a click on a being's own screen position selected **10/10**, **3/10 taking a neighbour**; eight blind clicks near canvas centre at default camera hit nothing — 17 px targets.

## 3 — colour-blind (Viénot matrices, applied in linear RGB; deuteranopia + protanopia)

7 beings re-read, 6 named. **`HUE_DANGER` #ff5f7a and `HUE_STARVING` #f0a63c become the same olive in both
sims** (`crops/cvd-deut-A.png`, `cvd-prot-A.png`: the hurt being at (215,465) is indistinguishable from the
starving ones at (98,465)/(223,492)). Sick violet survives. The claimed rescue — "each also has its own
badge" — does not exist at default camera: at 9× of native pixels (`crops/g-starving.png`, `g-danger.png`)
the starving badge is a **5×4 px solid orange lozenge with no bowl in it**, and the hurt being carries no
resolvable badge at all.

## Defects, ranked

1. **HIGH — the label budget is spent off-screen; `labelsShown()` reports names nobody can see.** A1:
   7 claimed, all 7 of those beings project to y≈1130–1310 on a canvas ending at y=905 → **zero visible**.
   A2: 6 of 7 off-frame (one at x=−372); only "Halira" renders. `labelBudget` (`beings.ts:197`) ranks by
   camera distance with no frustum test. Rank only candidates that project inside the canvas rect.
2. **HIGH — three scroll-notches out from default, beings are 4 px while the legend claims constant size.**
   A4: 293 drawn, `beingPixels()` **4.0**, ~10 visible. `markerHeight` (`World3D.ts:1226`) clamps at
   `BEING_MIN_H = 9` world units, abandoning the 17 px target in exactly the whole-continent view the
   comment says the clamp is for. Hold the target, or stop printing the claim.
3. **HIGH — condition rests on colour after all** (§3). Make the badge a shape at 17 px, or separate
   starving from danger on a channel that is not hue.
4. **HIGH — labels collide into a stack.** A4: three labels within **1 px** of each other at (446,837),
   four more within 23 px at (546–569,804). Seven names, two legible positions, no de-collision.
5. **MED — elder is not separable from adult.** 26% of the frame are elders; I called 0 of 4.
   `STAGE_SCALE = [0.62, 1, 0.97]`: an elder is 3% shorter than an adult, and the legend's staff has no
   counterpart on the 3D form.
6. **MED — badge ownership is ambiguous in a crowd**, which is where activity must be read. All three
   activity misses were badges I gave to the wrong body (`crops/A2-c4.png`: a sick cross reading as the
   well being one row down). At default camera I found 14 beings within 18 px of one pick.
7. **MED — the cut-away near the selection is a raw 1-px screen-door dither.** `crops/C5-artifact.png` at
   8×: trees and huts dissolve into a dark checkerboard which at real size (C5-effects, (440,400),
   (645,440), (695,390)) reads as speckle or dead pixels, not as "hidden". Unlisted in the legend.
8. **MED — the inspector covers ~30% of the world canvas** (C1: x≈1040–1460 of a canvas ending at 1470),
   opaque and immovable; select a being on the right and the panel hides it.
9. **MED — condition hue does not survive night.** A3 at daylight 0.00 (`crops/A3-c1.png`): bodies are
   multiplied down to grey while badges and lit windows stay warm, so warm chrome reads as amber beings.
10. **LOW — the lean tips the whole marker, ring included.** A2 (190,655) (`crops/A2-c5.png`): the ground
    ring is a slanted arc off the slope and the being reads as fallen, not fleeing.
11. **LOW — the achieved-speed warning fires on a paused world** (A4: "2400× ASKED · 0× ACHIEVED" with the
    button reading Run); **the side feed still says `Gahallian #2448` while the world says Ashiden** (A1).
12. **LOW (instrument) — the probe has no heading read**, so the channel hardest to read cannot be scored;
    add `headingOf(id)`. Nit: `188 / 362 alive` means "188 alive, 362 ever born" (pre-existing).

## 5 + 6 — performance and the step-0 follow-ups — all bars met

At 256 → 353 alive, 2400×: fps **avg 71.8** (bar ≥55), p50 13.7 / p95 18.4 / p99 20.8 / worst 25.3 ms;
**0 long tasks** (bar 0); pause click 11 ms, New world 45 ms, select round trip < 20 ms; no page errors.
Tab RSS **120 MB boot → 483 MB at max population → 132 MB after New world** (+13 MB vs boot): the recycle
holds, L2-D2 is gone. Speed label sampled 20× over 40 s at max population: **20/20 identical**, no flicker,
and truthful — I measured 2.87 s/day = **2507× achieved** vs 2400× asked (+4.5%), so silence is correct.
Wildlife after New world: no colour or size regression; animals no longer compete with beings.

## 4 — craft, before vs after

The after is better by a wide margin and it is not close: in `02-running-world.png` / `03-world-closeup.png`
a being is a pellet among pellets of berry and ore under a legend of four coloured dots. Now a being is an
upright figure in a ground ring and nothing else in the scene has that silhouette; resource dots recede;
selection is fine work — gold double ring, beam, "Beloath · adult · standing" pill, kin cyan / bonded green
arcs terminating in a coloured ring under the other being, an inspector with needs and learned rules at
confidence. Wedges are crisp on an isolated being (`crops/C3-d.png`); lit hut windows at night are a real
touch. But a robotics or interpretability researcher would not yet call this a serious instrument: the name
layer reports seven labels and draws none, so the view's own read-out contradicts the picture; the legend's
countability claim is false at the zoom you reach in three scrolls; and condition — the thing you scan for —
is hue-only in practice, the two exceptions that matter fusing into one colour for a deuteranope. Fix 1–4
and this comes back a contender.
