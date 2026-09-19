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

---

# Round 4 (semantic zoom + true scale, WIP `ff18a33`+`14b94a1`) — **FAIL**

Built `@yggdrasil/lab` once, first action, with `git status --short -- packages/engine packages/lab` clean
(HEAD `02f0c89`); by the end of this review the engine directories carry another engineer's in-flight work
and `packages/lab` is still untouched. Three Electron sessions, one at a time: **A PID 175244 (+122168,
170816, 180880, 170536)** — my own PID-tree helper deadlocked PowerShell before the world ever ran, killed
by PID, nothing produced, and I am counting it; **B PID 191440 (+190620, 103036, 192188, 192360)** — the
stranger test; **C PID 44380 (+195544, 77888, 185196, 197260)** — perf, limiter, FAR, L2c. All 15 verified
gone by id; no `electron.exe` from this lab remains. Shots + per-frame ground truth in
`~/.yggdrasil-lab/rework/shots/L3-critic-r4/`. My readings were written to
`shots/L3-critic-r4/MY-READINGS.md` and the `truth/` directory was not opened until after that file existed.
Lab tests **258/258**. Window maximized (canvas 2188 × 1164.75 CSS px, dpr 1.5); world paused before every
shot; seed `genesis-01`, 150 beings run 62 s at 2400× (213 alive, day 21).

## 2 — the stranger test

| band | attribute | bar | mine | |
|---|---|---|---|---|
| FAR | count | ±10% | **could not enter the band** | BLOCKED |
| DEFAULT (`default.png`, 68 in frustum, being 14.1 px, pin 24.4 px) | count in frame | ±10% | 67 (**−1.5%**) | **pass** |
| | count, TL / TR / BL / BR (13 / 29 / 2 / 25) | ±10% each | 13 / 27 / 2 / 25 (0 / **−6.9%** / 0 / 0) | **pass** |
| | condition, 15 readable picks | ≥70% | 15/15 = **100%** | pass, but see below |
| | selected | 100% | **1/1** — gold double ring, beam, gold pill | **pass** |
| MID (`mid-a` + `mid-b`, n=15, band px 62.7) | stage | ≥80% | 2/15 = **13%** | FAIL |
| | activity | ≥80% | 1/15 = **7%** | FAIL |
| | condition | ≥80% | 1/15 read = **7%** | FAIL |
| | heading, ±1 octant | ≥90% | 1/15 = **7%** | FAIL |
| | heading, exact | ≥50% | 1/15 = **7%** | FAIL |
| NEAR (`near-a` + `near-b`, n=14, band px 169.6) | stage | ≥90% | 1/14 = **7%** | FAIL |
| | activity | ≥90% | 0/14 = **0%** | FAIL |
| | condition | ≥90% | 2/14 = **14%** | FAIL |

The DEFAULT count is a genuine, large win over round 1 (−44% → −1.5%), and I found the seven labels the view
said it drew, and the elder disc, and the selected being, without being told. Everything after that collapses,
and **it collapses for one reason: the view reports marks it is not drawing.** Both `stageShownOf` and
`conditionShownOf` were non-null for all 29 MID/NEAR targets. Counting near-white pixels in a generous box
around each target's own reported screen position (`visible.mjs`, ±40 CSS px at MID, ±70 at NEAR):

```
mid-a   Neviath 2 | Yrlul 134 | Ashoamar 0 | Galeil 0 | Toroden 973
mid-b   Quenoam 262 | Quenindra 0 | Toraeden 0 | Vashiavik 41 | Eskiandra 0 |
        Asheiden 58 | Ristush 17 | Galoask 394 | Yrlask 0 | Queneil 0
near-a  Coroara 602 | Belir 190 | Itheir 3551 | Vashovik 0 | Corera 4344 | Neviath 0 | Joruvik 111
near-b  Belir 0 | Wrenemar 0 | Praluamar 0 | Joruvik 0 | Yrlul 0 | Kelaeth 0 | Lumeir 112
```

**16 of 29 have three pixels or fewer — nothing is drawn there at all.** In `near-b` that is six of seven:
`crops/near-b-sheet0.png` is three tiles of a blank hut wall, one tile of a tree and two of empty grass,
while the probe reports stage, condition, activity and heading for every one of them. This is round 1's
defect 1 (`labelsShown()` reports names nobody can see) with the frustum test added and the occlusion test
still missing — and it has moved from the label layer, where it was cosmetic, into the channels the band
contract is made of. The single MID target I could read is the *selected* being, whose own pill prints
"Toroden · adult · standing", so the stage and activity were given to me in words.

Two more things the numbers hide. **The condition scores are meaningless in both directions**: every one of
the 69 beings in the DEFAULT frame, all 11 + 13 at MID and all 19 at NEAR were `well`, so a stranger who
wrote "well" 44 times without looking scores 100%, and my 7% at MID is only the honest cost of refusing to
guess at a mark I cannot see. Over both sessions the world produced **three** non-well beings out of 251
(`{well:248, starving:1, sick:2}`) and **every one of them was off-frame or inside a hut** — see
`crops/cond-near-box-940-680.png`, where the sick being's position is the front wall of a hut. I never saw a
coloured condition ring on a being in this entire review. **And heading is not scoreable at MID from the
picture**: at 62.7 band px the two beings actually drawn at band size carry a legible barb
(`crops/mid-a-box-170-780.png` — Keluash, adult, walking, well, SW, read cold and correct), but the other
thirteen carry nothing.

## 3 — true scale

`scaleReport()`: adult 1.75 · child 1.08 · elder 1.60 · hut **4.40** · hutFootprint **6.08** · tree 20.25
(shortest 7.43) · peak 227.8 · sea 11.9 · span 2000 · annotation ring 3.03 m · adult on screen 14.07 px,
with the honest note that 1 unit = 1 m horizontally while the sim's height index is drawn at 14 m per unit.

Does anything read as giant people? **No.** In `near-scale.png` two beings stand beside a hut with the range
behind and the proportions are believable; trees tower correctly; at FAR nothing about a person competes with
a mountain. The owner's hard rule is not broken and the round-3 gain holds.

But the instrument lies about the size of the one object the rule is about. Solving the horizon from the
camera itself (fov 45°, canvas 1164.75 CSS px, pitch 0.505° down ⇒ horizon at device y 1024) and measuring
pixel bounding boxes against the probe's own screen midpoints:

| | measured | `scaleReport()` |
|---|---|---|
| adult (Eskom/Fenumar) | **1.79 m** | 1.75 |
| adult (Beloar) | **1.69 m** | 1.75 |
| hut, `near-scale.png` | **2.56 m** tall, 3.27 m wide | 4.40 / 6.08 |
| hut, `near-scale-b.png` (independent camera, pitch 1.845°) | **2.43 m** | 4.40 |

The method reproduces the adults to within 2–3%, which is what makes the hut number trustworthy: the hut is
drawn at about **55% of the height and width the probe reports**, so the NEAR legend's "a hut comes to twice
their head" is false as drawn — the drawn ratio is about 1.4 : 1, and in
`crops/near-scale-box-1620-950.png` the beings' heads clear the eaves. Mountains: no spikes, haze reads as
distance, and `near-scale-b.png` gives a proper snow ridge with scree; at FAR the range flattens into a pale
plateau that reads more like cloud than relief, which I would call acceptable, not good. The world edge at
street level is haze and sea — the black wall is gone, and that is a clean fix.

## 4 — colour-blind

Viénot deuteranopia and protanopia, applied in linear light. On the legend key at 24× (`crops/cvd-deut-default-2005-1932.png`,
`cvd-prot-…`): well = thin cream ring, starving = **bright yellow dashed** ring, sick = **blue thick** ring,
in danger = **dark olive spiked** ring. **No two collapse under either simulation** — they separate on ring
shape and again on lightness, and round 1's starving/danger fusion is genuinely fixed. In-frame the test
could not be run at all, for the reason in §2: no unwell being was ever drawn where a camera could see it.
Passing on the key while the channel has never once been observed on a body is not evidence the channel works.

## 6 — performance

Renderer frames counted directly by instrumenting the WebGL draw entry points, so this is the renderer's own
rate and not the display's. **256 population → 251 alive, 2400×, 70.2 s: 4209 rendered frames = 59.96 fps**
against a 60 fps limiter; frame intervals p50 **13.9 ms** / p95 **20.9** / p99 **21.0** / worst **76.4 ms**
(the 13.9/20.9 alternation is the limiter beating against a 144 Hz panel, which is correct). **UI long tasks: 0.**
Control latency: pause **12 ms** and **14 ms**, New world **61 ms**. No page errors in either session.
Limiter: draw-call rate paused+focused **239.2/s**, paused+blurred **239.5/s** (identical, as `targetFps`
promises), minimized **24.0/s** — an order of magnitude down, i.e. ~10 fps idle and ~1 fps hidden at the
scene's ~24 draw calls per frame; the direct frame count was only taken while running, so the 10 is an
inference from the call rate, but the claim that matters — it stops taking the GPU the moment you look away —
is measured and true. Speed label sampled 14× over 70 s: **14/14 identical**, no flicker, no warning, and
truthful (22 days in 70.2 s = 3.19 s/day = 2257× achieved vs 2400× asked, −6%). **§6 passes on every bar.**

## 5 — craft, before and after

Against `02-running-world.png` and `04-being-inspector.png` this is not the same instrument, and against
round 3's `default.png` / `near-scale.png` it is still a clear step. The wide frame (`far.png`,
`far-smallwindow.png`) is the best thing in the build: a continent with rivers, lakes, shore fringe, forest
stipple and a snow plateau, with pins that hold 24 px, count chips, and a legend that says out loud "a whole
being is under a pixel from here, so these marks are map pins, not people". The band legends are the second
best thing — they are specific, they name the encodings, and at DEFAULT the countability instruction ("count
the pins, add the numbers — every being is one or the other, never both") is a real contract that I checked
and that held to 1.5%. The condition ring now carries shape as well as hue and survives both CVD
simulations. The elder's filled centre disc is legible at 14 px. The inspector is down to ~2.7% of the
canvas. The pause/achieved-speed lie is gone, the feed uses names, and `headingCheck` exists.

What still looks amateur, and I would defend every item of this to a hostile room:

- **Nothing occludes correctly.** Tree trunks and hut walls are drawn opaque in front of the subjects at
  every band (`crops/near-a-box-1940-860.png`: a pure-black trunk cut straight through two beings), while
  the NEAR legend prints "trees and huts step aside". Trunks and canopies are flat #05 black that take no
  light at all, so they read as holes punched in the frame rather than as trees.
- **Annotation is depth-tested against the world it annotates.** Three pins in the DEFAULT frame are a bare
  white arrowhead with no ring because a 2.5 m hut is in front of them (`crops/default-box-1270-310.png`);
  two I only found at 3–4× magnification. A map pin that a building can eat is not a map pin.
- **Labels stack.** At MID, "Queneil" and "Yrlask" (whose beings are 1.4 px apart) are drawn as two pills one
  under the other with their leaders converging into the same hut roof, plus "Toraeden" and "Asheiden" beside
  them — four names and no visible bodies, `crops/mid-b-sheet0.png`.
- **A count chip is drawn on the application chrome.** In `default.png` the "4" chip lands inside the dark
  selection toolbar next to the Follow button and reads as a UI badge (`crops/default-box-250-200.png`).
- **Cluster hulls read as terrain.** They are pale translucent discs lying on the ground; in
  `crops/far-box-1200-840.png` the 48- and 101-discs read as lakes or fog and overlap each other.
- **The band indicator contradicts itself**: "DEFAULT · A BEING IS UNDER A PIXEL".
- **The figures** — not gold-plated, as instructed, and I am not scoring them; but the white mannequin is the
  same value as the cream annotation ring it stands in, so at MID the mark and the body merge.

## Defects, ranked

1. **CRITICAL — `stageShownOf` / `conditionShownOf` / `activityShownOf` / `headingOnScreen` are band-aware
   and nothing else.** 16 of 29 MID/NEAR targets have ≤3 body pixels within ±40–70 CSS px of their own
   reported position (`near-b`: 6 of 7, `crops/near-b-sheet0.png`). They must return `null` when the being is
   occluded or too far to carry the mark — a depth/size test, not a band lookup. Until they do, every MID and
   NEAR bar is being scored against marks that do not exist, and the view's read-out contradicts its picture
   exactly as it did in round 1.
2. **CRITICAL — beings are occluded by trees and huts at every band, and the NEAR legend claims they are
   not.** Either implement the "step aside" the legend promises (fade/cut the occluder within the subject's
   silhouette, as the round-1 selection cut-away already does) or delete the claim. Evidence:
   `crops/near-a-box-1940-860.png`, `crops/mid-b-sheet0.png`, `crops/near-b-sheet0.png`,
   `crops/cond-near-box-940-680.png`.
3. **HIGH — `frameCandidates()` aims the camera at the inside of a hut.** Its top MID candidate framed a
   6-being gathering that was entirely inside a building, and its top two NEAR candidates likewise. The
   candidate must be scored on how many of its beings are actually *visible* from the proposed camera, not on
   how many are near the centroid. This is what made every MID/NEAR bar unmeasurable.
4. **HIGH — `scaleReport().hut` (4.40 m) and `.hutFootprint` (6.08 m) are ~1.8× the hut that is drawn**
   (measured 2.43–2.56 m in two independent frames whose adults measure 1.69–1.79 m). On an item whose whole
   point is that the world is true scale, the probe is the one thing that may not be wrong. Either the mesh is
   scaled after the report is computed, or the report reads an unscaled source.
5. **HIGH — the NEAR band promises `names: 'all'` and the legend prints "every being in frame is named",
   and it is false.** `near-a`: 19 beings in frame, **4** labels. `near-b`: 31 in frame, **2** labels.
   (`labelsShown()` itself is honest — the promise and the legend are not.)
6. **MED — the FAR band is unreachable on a large window.** Maximized (canvas 1164.75 CSS px), 45
   wheel-outs to the dolly limit leave `zoomBand() === 'default'` at `bandPixels 0.91`, with the chip reading
   "DEFAULT · A BEING IS UNDER A PIXEL"; at the shipped 1360×900 the same gesture reaches `far` at 0.48 px.
   The band edge is in screen pixels and `controls.maxDistance` is in world units, so the widest contract and
   its legend are dead on exactly the window a researcher will use. Tie the dolly limit to the band edge.
7. **MED — count chips and hulls collide with the application chrome and with each other** (defect list in
   §5). Chips must be clipped to the canvas rect and pushed off the selbar/inspector; overlapping hulls need a
   containment rule a reader can see.
8. **MED — label de-collision does not run at MID/NEAR.** It clearly works at DEFAULT (7 labels, all legible,
   all found); the same declutter must apply to the close bands, where the leaders are longer and the pills
   are larger.
9. **LOW — badge/figure ownership in a crowd.** My one wrong NEAR stage call was a neighbour's figure read
   for the target's, two beings 25 px apart (`near-a` i2, `crops/near-a-sheet0.png`). Round 1's defect 6,
   unchanged.
10. **LOW (instrument) — the stranger test cannot exercise condition at all in a day-21 forager world**
    (3 unwell out of 251, all hidden). Give the harness a sanctioned way to stage a mixed-condition cohort, or
    the condition bars will keep passing on a single class.

Fix 1–3 and this becomes measurable; fix 4–5 and the instrument stops contradicting itself. The wide view and
the DEFAULT contract are already good work — the close bands are currently promising four channels and
drawing, in more than half of the cases I sampled, nothing at all.

## L2c runtime smoke — **PASS** (reported separately)

Same boot, `window.lab.llmComplete(prompt, input)` called from the page context, no API key:

| case | result | ms |
|---|---|---|
| (a) garbage prompt `'not a prompt at all'`, `{nope:1}` | rejects `BAD_THINK_PROMPT: prompt must be a plain object` | 2 |
| (b) legacy `(input, retryError)` shape | rejects `BAD_THINK_PROMPT: unexpected key "snapshot"` | 1 |
| (c) well-formed `{system,user}` that does not match its input | rejects `BAD_THINK_PROMPT: prompt does not match input` | 1 |
| (d) genuine engine-built pair | rejects **`NO_LLM_KEY`** | 1 |
| (e) genuine pair with the engine's retry wrapper | rejects **`NO_LLM_KEY`** | 1 |

(d)/(e) used a real `buildThinkPrompt(input)` / `retryPrompt(...)` produced by running the engine source
through `tsx` **before** this review touched anything, so the binding check is proved against the engine's own
builder, including the one legal retry divergence. Nothing hung — worst case 2 ms. In the renderer
`typeof process`, `typeof require` and `typeof module` are all `undefined` and `window.lab` is present. The
sim kept running through and after the calls (day 23 → 25, 725 ever-born) and the tab reported no page errors.
