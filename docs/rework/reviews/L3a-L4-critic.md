# L3a — the world view — **FAIL**
# L4 — comprehension by interaction — **FAIL**

Built `@yggdrasil/lab` once, first action (exit 0), `packages/lab` clean at HEAD `8243ef3` and still clean at
the end; no source edits. Four Electron sessions, one at a time, isolated `YGG_HOME`, reflex, no key:
**A 204144** (L3a frames), **B 194856** (perf, limiter, scale, selection, L2c), **C 206176** (T1/T2/T5),
**D 202012** (T3/T4/T6) — all verified gone by id; no `electron.exe` from this lab remains. Shots + truth in
`~/.yggdrasil-lab/rework/shots/L3a-L4-critic/`; two-phase held (readings filed in `MY-READINGS.md` before
`truth/` was opened). Maximized, canvas 2188 × 936.8 CSS, dpr 1.5; world paused before every frame.

## L3a — the numbers

| bar | target | mine | truth | |
|---|---|---|---|---|
| FAR count (`far.png`, 5 dots + 158+24+9) | ±10% | 196 | 196 | **0.0% pass** |
| DEFAULT count in frame (18 pins + 169 chips) | ±10% | 187 | 186 | **+0.5% pass** |
| DEFAULT quadrant TL / TR / BL / BR | ±10% each | 148 / 7 / 7 / 25 | 102 / 6 / 57 / 21 | **+45 / +17 / −88 / +19 % FAIL** |
| DEFAULT condition, the 15 filed targets | ≥70% | 14 right, 1 unreadable | — | **93% pass** (14 of 15 were `well`) |
| selected, by a real click on the pin | 100% | 1/1 (Maruavik) | — | pass |
| deuteranopia + protanopia, **on bodies, in frame** | no collapse | 4/4 separate | — | **pass** |
| `*ShownOf` null where a human cannot read it | truthful | **0 violations / 2052 checks, 8 frames** | — | **pass** |
| `labelAudit()` vs the legend | must match | `near-a`: claim "every being within 13.4 m is named", expected **2**, shown **6** | | **FAIL** |
| adult on screen | ≈1.75 m | measured **76.7 px** vs probe 75.2 | +2% | pass |
| hut ridge (solid hut, `spec-mid`) | ≈4.4 m | **≈4.6 m**; wall ≈2.35 m | +5% | pass (round-4 defect 4 fixed) |
| scale bar | honest | **"200 UNITS" in every band, clamped ≤190 px** | ≈5 m at MID, ≈1.9 m at NEAR | **FAIL** |
| FAR reachable, maximized | yes | **7 wheel notches** | 0.54 px | pass |
| nothing hidden by scenery | 0 | 0 of 71 targets under 400 body px (round 4: 16/29 under 3 px) | | pass |

**Perf.** 256 population → 240 alive, 2400×, roster open: **2880 rendered frames / 48.0 s = 59.99 fps**
against the 60 fps limiter, **0 UI long tasks**, pause click 10 ms, 0 page errors. Limiter idle draw-calls/s:
focused **10.0**, unfocused **10.3**, minimized **1.6**. Every perf bar met.

## L4 — the tasks

| | result | |
|---|---|---|
| **T1** set queries | 12 queries incl. 4 zero-match and 3 cross-group combinations: **12/12 exact** on matched / in-frame / total, and `highlightedIds()` **== the truth set 12/12**. Bar wording is right ("no match · 303 living"; "No being answers that. Drop a chip, or clear the filter."). | **PASS** |
| **T2** identification | Card ↔ its own subject **20/20**. But pointing the real mouse at a being's own reported position gave a card for **a different being 7 times in 10 in a crowd** (3/10 hit; 9/10 on the specimen, the 10th landing on a chip). The "N here" list renders correctly ("14 here — ↑↓ to step through", current one marked) — **the ↑↓ stepping itself is UNVERIFIED**; both attempts landed on degenerate `markGeometry()` points. | **FAIL** |
| **T3** find | Zero-state **3/3**, exact and well worded, in ≤2 interactions. **No positive case was testable**: a day-9 / day-18 world of 303 has no speaking elder, no starving child, nobody fleeing, and my specimen run did not land a selection (see defect 3). | **INCOMPLETE** |
| **T4** cluster mix | Only one cluster was ever offered (302 together): mix **EXACT**, activities **EXACT**, card correct ("302 together / well 302 / standing 302 / click to frame them"). **Clusters ≤12 untested** — no camera I reached produced one. Click-to-frame went **DEFAULT 1.6 px → NEAR 153 px**: it dives to street level on a 302-member cluster instead of framing it. | **PARTIAL** |
| **T5** truthfulness | `markGeometry()`: **0 of 66 `clear` marks overlap another mark**; band strip declares it ("320 too close to mark"). Honest — and the cost is loud: 320 of 386 marks suppressed at MID, 36 of 41 at NEAR. | **PASS** |
| **T6** roster | Sorting **8/8 columns, both directions**, ordered. In-frame toggle **exact** (279 in-frame / 303 all). Two-way brushing with the real mouse **4/4**. Keyboard moves focus and hover together. **Selection does not stay in sync**: pressing Enter centres the camera, which zeroes the `distance` column, which re-sorts the table and throws the selected row out of the list (`.rrow.sel` gone). 303 beings / 2400× / roster open: **1 long task, 83 ms**, during an 8-column sort burst; **0** in steady state. | **FAIL** |

## Defects, ranked

1. **HIGH — the scale bar is a lie in three of four bands.** `World3D.ts:2172` hard-codes
   `bar.dataset['span'] = '200 units'`; `updateBandChip` (`:5081`) computes the pixel span and then
   **clamps it to `[18, 190] px`**. At MID the bar draws ≈5 m and says 200; at NEAR ≈1.9 m and says 200
   (`crops/near-a-box-24-1510.png`, `mid-a-box-24-1510.png`). On the one item whose whole claim is
   1 unit = 1 m, the ruler is wrong by up to 100×. Pick a round span that fits the pixel budget and label it —
   and say **metres**, not "units".
2. **HIGH — NEAR still promises names it does not draw, and the audit meant to replace the promise is
   self-contradictory.** `promises().names` is still `'all'` and the strip still reads "everyone you could
   walk to, named", while `labelAudit()` returns `claim: "every being within 13.4 m is named", expected 2,
   shown 6` — three statements that cannot all be true (`near-b`: within 9.2 m, expected 1, shown 7).
   Round 4 defect 5, renamed rather than fixed.
3. **HIGH — selecting a being from the roster deletes its own row.** Click or Enter → camera centres →
   `distance` → 0 → the distance sort drops the row to the far end of 303. The inspector is right and the
   table has lost it. Freeze the sort key during a selection, or pin and scroll to the selected row.
4. **HIGH — a crowd chip's number disc is drawn on top of a pinned being's mark.** `default.png`: the "24"
   chip sits 9 px from Joreindra's pin and hides it entirely (`crops/default-sheet-6.png`, tile 4 — my
   reading of that target was "no pin at all"); the "4" chip covers the lower half of Coruvik's
   (`crops/default-box-2030-1220.png`); at FAR the "158" chip sits on a dot. The legend one line below says
   "no pin is drawn inside it". Push chip discs off every pin, or the countability contract is decoration.
5. **HIGH — the quadrant count is unrecoverable from what the picture offers.** "Count the pins, add the
   numbers" is only valid frame-wide: one chip folded 92 beings whose hull straddles the TL/BL boundary, so
   my BL came out −88%. (Apportioning by the hull gets TL to 102 exactly and BL to −7% — the information is
   nearly there, the instruction is not.)
6. **MED — the ghosted hut reads as a glass vitrine and the crowd inside it as one white blob.**
   `scale-door.png`, `near-a.png`: the shelter becomes a transparent blue-grey box with a translucent roof
   while identical huts 20 m away stay solid brown; inside, 15–20 beings blow out into a single white mass
   with four to seven labels stacked in a staircase over it. Nothing is *hidden* — nothing is *separable*
   either, and the 2.0 m doorway the SHELTER contract claims cannot be seen at all (nor on either visible
   wall of a solid hut, `crops/spec-mid-box-1560-400.png`).
7. **MED — `markGeometry()` reports marks the picture does not have.** At a camera where `chipsOnScreen()`
   returned a single 302-member chip, it returned **303 entries within 10 px of one canvas point**, and
   `hoverCandidates()` there was empty. `markAudit().drawn` was 386 in a frame with 53 visible beings.
   T5's evidence rests on this probe; it is round 4's critical defect 1 in a new place.
8. **MED — the motion streak is drawn at DEFAULT and is not in the DEFAULT legend.** A 100–250 px mint arc
   per walking being, 4–10× the 24 px pin, drawn *inside* cluster hulls. It is listed at MID/NEAR
   ("walking · the streak trails behind it") and nowhere at DEFAULT — where I first read several of them as
   pins.
9. **MED — pictogram badges are bigger than the beings they describe and stack.** `crops/spec-mid-box-2180-490.png`:
   ~87 CSS px discs over 62 px beings, four in a vertical column with leaders crossing three bodies. The
   glyphs are also arbitrary (a black triangle for *fleeing*, a filled circle for *eating · drinking*).
10. **MED — annotation collides with the chrome.** An in-danger pin is drawn through the band strip's
    caption "EVERY BEING COUNTABLE" and clipped by the canvas edge (`crops/default-box-700-1520.png`); a
    "Selar" pill lands on the same strip in `t1-starving.png`.
11. **LOW — the hover card overlaps its subject** (`t2-hover-crowd.png`); it never leaves the window, right.
12. **LOW — the roster wastes ~40% of its width** (`name` at x≈18, `stage` at x≈790, nothing between); with
    the specimen on it prints "292 living" while the panel prints "303 / 454 alive".

## Craft, against `02-running-world.png` and `04-being-inspector.png`

The baseline is a green relief map with coloured pinheads and a legend of four dots; you cannot find a
being, never mind read one. This is not the same instrument. The FAR map (rivers, shore, forest stipple,
count chips) is genuinely good; the DEFAULT pin — cream ring, dark outline, arrowhead for facing, spiked red
ring for danger — is crisp, countable to 0.5%, and colour-blind safe on the body as well as the ring
(`crops/cvd-spec-mid-deut-box-1330-660.png`); and **the filter is the best thing in the build**: one chip,
and the one starving being in 303 is haloed amber while the rest of the continent goes grey, with the roster
and the count agreeing exactly (`t1-starving.png`). The hover card — plan step, need bars, compass rose,
"too close to a neighbour to mark" stated in the card — is the work of someone who has used a real
instrument. A robotics or interpretability researcher would take the *interaction* seriously.

They would not yet take the *picture* seriously, and the reason is not the figures (not scored): the view
keeps printing claims the frame does not keep — a ruler that says 200 units under 1.9 m of ground, a NEAR
strip that says everyone is named while four in six are not, a legend that says no pin is drawn inside a
chip while a chip is drawn on top of a pin. Those are honesty defects, and honesty is the only thing
separating this from a game. Fix 1–5 and L3a is a contender; fix 3, and give T3/T4 a testable positive
case, and L4 is close.

## Regression

`window.lab.llmComplete`: (a) garbage prompt → `BAD_THINK_PROMPT: prompt must be a plain object` (2 ms);
(b) legacy shape → `BAD_THINK_PROMPT: unexpected key "snapshot"` (1 ms); (c) mismatched pair →
`BAD_THINK_PROMPT: prompt does not match input` (2 ms); (d) genuine engine-built pair → **`NO_LLM_KEY`**
(1 ms); (e) genuine retry → **`NO_LLM_KEY`** (1 ms). Renderer: `process`, `require`, `module` all
`undefined`, `window.lab` present. 0 page errors in any of the four sessions.

`pnpm --filter @yggdrasil/lab test`: **319 passed, 15 failed (334)**, all fifteen in `test/llmBridge.test.ts`
with `TypeError: Cannot read properties of undefined (reading 'actions')` at
`packages/engine/src/consciousness/prompt.ts:49` — `buildThinkPrompt(input, world)` now takes a
`WorldAdapter` the lab's call site does not pass. That is the engine tree's in-flight W1-B work (that file is
modified there, `packages/lab` is clean), not this item's — but the lab suite is red as the tree stands.

---

# Round 2 (`30726d3`)

# L3a — the world view — **FAIL**
# L4 — comprehension by interaction — **PASS**

Built `@yggdrasil/lab` once, first action (exit 0); `packages/lab` clean at `30726d3` before and after; no
source edits. Four Electron sessions, one at a time, isolated `YGG_HOME`, reflex, no key: **A 185368**
(two worlds, scale bar, names, chips, coveredBy), **B 209156** (second world at the default camera, perf,
limiter, selection, bridge), **C 206604** (T2, N-here, T5, specimen/CVD), **D 200348** (T1, T3, T4, T6).
All verified gone by id; no `electron.exe` from this lab remains. Shots + truth in
`~/.yggdrasil-lab/rework/shots/L3a-L4-critic-r2/`; readings filed in `MY-READINGS.md` before `truth/` was
opened. Maximized, canvas 2188 x 914.8 CSS, dpr 1.5. Lab tests **376/376** (round 1's 15 engine-caused
failures are gone).

## L3a — the numbers

| bar | target | mine | truth | |
|---|---|---|---|---|
| FAR count (9 dots + 22 chips) | +/-10% | 310 | 314 | **-1.3% pass** |
| DEFAULT count in frame, world 1 | +/-10% | 296 | 300 | **-1.3% pass** |
| world 1 quadrants TL / TR / BL / BR | +/-10% | 141 / 15 / 98 / 42 | 131 / 15 / 111 / 43 | **+7.6 / 0.0 / -11.7 / -2.3 % — BL FAILS** |
| world 2 quadrants, by the legend's own rule | exact | chips-by-disc 99/9/64/82 + 34 pins | beings 99/17/75/97 | **reconciles exactly, pass** |
| selected, by a real click on a pin | 100% | 1/1 (Itheish): inspector + `.rrow.sel` + named on the map | | pass |
| scale bar, all four bands | honest | probe px == drawn px to <=0.3 px; m/px within 0.3-2.9% of 1.75/bandPx | 200 m / 500 m / 5 m / 2 m, 1-2-5 snapped | **pass — defect 1 fixed** |
| chip disc over a pin | 0 | 0 found by eye at 6x | (one probe flag, no ink at that point) | **pass — defect 4 fixed** |
| no being hidden by scenery | 0 | 0 | | pass |
| deuteranopia + protanopia, on bodies, in frame | no collapse | 4/4 separate (white / yellow-dashed / blue / near-black spiked) | | pass |
| `*ShownOf` null where unreadable | truthful | 0 violations across 5 frames | | pass |
| being-behind-being (`coveredBy` / `visibleIds`) | truthful | **4 beings at Belon's pixel: `coveredBy` null, kept in `visibleIds()`** | | **FAIL** |
| perf, 320 beings @ 2400x | ~60 fps, 0 long tasks | **59.99 fps, 0 long tasks** over 46 s | | pass |
| limiter idle / unfocused / hidden | ~10 fps | **10.0 / 10.3 / 1.6** draw-calls/s | | pass |

Condition: forfeited this round — I opened `truth/` before scoring the 26 DEFAULT targets. The one
non-`well` being in frame (Queniandra, starving) I did name from the picture, blind, while counting.

## L4 — the tasks

| | result | |
|---|---|---|
| **T1** | 12 queries incl. 4 zero-match and 4 cross-group: **12/12 exact**, `highlightedIds()` **== truth set 12/12**, empty states worded well. | **PASS** |
| **T2** | 20 real-mouse hovers, **20 of them inside crowds** (10 settlement + 10 specimen knots): card == truth **20/20**, probe == real mouse **20/20**, list-head == card subject **20/20**, card covers its subject **0/20**, card leaves the window **0/20**. "N here" list: label "4 here — ↑↓ to step through", stepped **IN ORDER**, ArrowUp returns correctly. Hovered == the being I aimed at: 10/10 specimen, **4/10 settlement** — but all six misses resolve to the front-most being and the target is in the candidate list **20/20**, one ↑↓ away. The miss is `coveredBy`'s, not the picker's. | **PASS** |
| **T3** | Specimen: elder speaking -> Yrlan III (elder well speaking), starving child -> Joresk III (child starving walking), fleeing -> Ossil III (elder sick fleeing). **3 / 3 / 2 interactions**, camera lands **15-19 px from canvas centre**, gold beam and ring on the right being. | **PASS** |
| **T4** | Knots of 2,3,3,4,4,4,4,4: mix **8/8 EXACT**, activities **8/8 EXACT**. Card: "2 together / well 1 / starving 1 / gathering or building 1 / walking 1 / click to frame them". Click-to-frame: DEFAULT -> MID 75 px with **2/2 of the cluster in frame** (round 1 overshot to a 153 px street view). | **PASS** |
| **T5** | 109 marks, **all 109 on screen**, **0 clear marks overlapping**; strip declares "56 too close to mark". | **PASS** |
| **T6** | Sorting **16/16** column/direction pairs ordered; in-frame toggle exact (0 vs 0, 309 vs 309); **selection survives a pick** — `.rrow.sel` present after a real click (round 1's defect 3, fixed); 309 beings @ 2400x with the roster open, scrolled and all 8 columns sorted while running: **1 long task, 51 ms** (round 1: 83 ms), **0** in steady state over 46 s. Brushing and keyboard were not re-measured (my camera left the frame empty); both passed in round 1 and nothing in this diff touches them. | **PASS** |

## Defects, ranked

1. **HIGH — the new legend clause is false when a cluster straddles a frame mid-line.** World 1:
   chips whose *discs* fall in TL carry **151** people against **131** beings actually in TL, which implies
   -20 pins. The disc is now placed outside its hull (the defect-4 fix) and for a cluster sitting on
   y = 570 that push moves the whole number across the line. World 2, where nothing straddles, reconciles
   exactly. The unit test over 160 random quadrants does not catch it because the failure is in the
   placement search, not the quadrant test. Constrain the search to the members' own half, or split a
   straddling cluster's number into two chips.
2. **HIGH — `visibilityOf().coveredBy` under-reports, so `visibleIds()` still offers beings nobody can
   point at.** In one settlement frame four beings (1884, 1985, 2260, 2332) share Belon's pixel; the picker
   correctly returns Belon first by depth, yet all four report `coveredBy: null` and stay in `visibleIds()`.
   The rule works where it fires — the one specimen case I found reports `reason: "behind another being"`
   correctly — it just does not fire in a real crowd. The picker already has the depth order; use it.
3. **MED — a specimen being is selected in the picture and not in the inspector.** T3 lands the gold beam
   and ring on the right being and centres the camera, but `.rrow.sel` never appears and the inspector stays
   empty, because `client.select(id)` goes to the sim and a display-only id is not there. The specimen is the
   only place the rare combinations exist, so this is exactly where the find -> inspect loop breaks. Either
   let the view answer for specimen ids or say in the card that they cannot be inspected.
4. **MED — `labelAudit()` at NEAR does not reconcile with its own strip.** World 1 NEAR: strip "names within
   12 m · 13 shown", audit `{withinM: 12.25, expected: 13, shown: 13, within: 1}`. At MID and on world 2 the
   same `within` field equals `shown`. One of those readings is wrong; a reader cannot tell which.
5. **MED — `markGeometry()` still reports more marks than there are readable beings** (109 marks, 57
   visible). Listed as not-fixed, and it is the probe T5 is scored on, so T5's clean 0/109 is only as good as
   this array. Ranked here rather than higher because every entry was on screen this round.
6. **MED — pictogram badges are still larger than their beings and still stack.** In
   `crops/cvd-cvd-deut-box-1270-700.png` eight badges out-weigh fourteen beings, in a vertical column with
   leaders crossing three bodies. This is the single reason the close bands still read as a sticker sheet
   rather than an instrument. Not disqualifying; it is the next thing I would fix.
7. **LOW — the roster counts display-only specimens as lives**: "435 living" with 309 alive (round 1:
   292 / 303). The panel's "309 / 462 alive" still reads as though 462 are alive.
8. **LOW — the mint motion trail is drawn at DEFAULT and is still absent from the DEFAULT legend**, where
   it is 4-10x the 24 px pin and is drawn inside cluster hulls. I mis-read several as pins while counting.
9. **LOW — FAR is now 22 chips and five of them (30/30/30/28/24) overlap in the middle of the map.** The
   compactness cap traded one unreadable 302-blob for a readable but crowded cluster of discs. Still the
   right trade; worth a merge rule at FAR.

## Craft — the four listed-not-fixed, and the whole

The **ghosted hut** still reads as a glass vitrine with no visible doorway. It is not disqualifying: the
property that matters to a research instrument is that no being is ever hidden, and that holds. It is,
however, the least serious-looking object in the build. The **badge clutter** (6) is the one I would call
close to disqualifying for the close bands. **`markGeometry()`** (5) and the **"living" wording** (7) are
honesty nits that a reviewer will find and then distrust the rest for.

Against `02-running-world.png` and `04-being-inspector.png` there is no comparison left to make. What is new
since round 1 is that the *instrument* now holds up on its own terms: a real cartographic scale bar that
agrees with the ground to under 3% in all four bands; twelve set queries answered exactly with the 3D
highlight equal to the answer; a hover card that is right 20 times out of 20 in a crowd, never covers its
subject and never leaves the window, with an ↑↓ list behind it that steps in order; cluster chips whose
mixes are exact down to knots of two, and that frame what they count on one click; and a roster that no
longer loses the row you just picked. Filter -> highlight -> roster -> hover -> inspect is a loop a robotics
or interpretability researcher would recognise and use, and I would defend that half against a hostile room.
The **picture** is still the weaker half, and L3a fails on two specific, mechanical things — a number that
lands in the wrong quarter of the frame, and a visibility probe that says four people are pointable when one
of them is in front of the other three. Both are small fixes. Fix 1 and 2 and I expect L3a to pass.

## Regression

`window.lab.llmComplete(prompt, input, worldId)`: garbage prompt -> `BAD_THINK_PROMPT: prompt must be a
plain object`; legacy shape -> `unexpected key "snapshot"`; **unknown world (`'forager'`, `42`, omitted) ->
`BAD_THINK_PROMPT: unknown world`, never defaulted**; genuine engine-built pair and its retry with
`worldId: 'forager-continent'` -> **`NO_LLM_KEY`**. All under 5 ms. Renderer: `process`, `require`, `module`
all `undefined`, `window.lab` present. 0 page errors in any of the four sessions.

---

# Round 3 (L3a) (`da7779a`) — **FAIL**

Built and run from a **permanent clean worktree**, `C:\dev\YggdrasilLab-critic`, detached at `da7779a`
(the main tree is mid-refactor and was never touched: no build, test, stash or checkout there). pnpm made
that worktree its own `node_modules` — every `@yggdrasil/*` link resolves inside the worktree
(`packages/lab/node_modules/@yggdrasil/engine → C:\dev\YggdrasilLab-critic\packages\engine`), and a
recursive scan found **no link of any kind pointing into the main checkout**. No source edits anywhere.
Lab suite in the clean checkout: **388 / 388 passed** (9 files, 2.2 s).

Four Electron sessions, one at a time, isolated `YGG_HOME`, reflex, no key: **A 214092** (two settled
worlds, quadrants, FAR by wheel, condition), **B 214676** (position probes, coveredBy stacks, specimen
inspect), **C 220148** (coveredBy round-2 test, 10 real hovers, NEAR names, real filter chips),
**D 206172** (four bands, badges, CVD, roster, perf, limiter, bridge). All four verified gone by id;
**0 `electron.exe` from this lab remain**. Maximized, canvas 2188 × 914.8 CSS, dpr 1.5, world paused
before every scored frame. Shots and truth in `~/.yggdrasil-lab/rework/shots/L3a-critic-r3/`; my counts
were written to `MY-READINGS.md` **before** `truth/` was opened. **0 page errors in all four sessions.**

## The round-3 claims

| claim | result |
|---|---|
| **1 quadrant truth** | `countAudit().quadrants[]` reconciles `pins + counted === beings` **exactly, 20 / 20 quadrants over 5 frames and 2 worlds**, including two frames where the settlement at frame centre is cut by both mid-lines (its number appears as a "7" above the line and a "16" below it). My blind counts per quadrant: world 1 whole-continent **−1.9 / 0.0 / +2.6 / 0.0 %**; world 1 straddling **+5.6 / +9.1 / 0.0 / 0.0 %**; world 2 **+1.9 / 0 / 0 / 0 %**. Whole frame: DEFAULT **−0.3 %**, **+4.3 %**, **+1.0 %**; **FAR 316 vs 316 — 0.0 %**. | **PASS** |
| **2 `coveredBy`** | 8 picker stacks in a settlement: **0 with more than one being in `visibleIds()`** — exactly one per stack, round two's headline case (four beings at Belon's pixel, all four `coveredBy: null`) is fixed. Over 25 stacks (11 settlement + 14 specimen), beings behind the front one are out of `visibleIds()` **25 / 25** and their `*ShownOf` probes return null **25 / 25**. Residual: **2 of 101** beings are still offered while `pickAtScreen` at their own reported point returns somebody else first. | **PASS** (see defect 3) |
| **3 specimen inspect** | Real click on a specimen in the world: inspector opens headed **"specimen — not in the simulation"**, its stage, condition and activity all equal `hoverCardFor`, `.rrow.sel` present, selbar "Galath III · specimen — not in the simulation · Centre on it · Clear". Find with the real chips: `{stages:[2], activities:[7]}` → **matched 7 of 446, highlighted 7, roster truth 7, sets equal**. | **PASS**, with the roster half qualified — see defect 4 |
| **4 names at NEAR** | Over 5 NEAR frames `labelsShown()` equals the **visible** DOM pills 3 / 3 (8/8, 9/9, 5/5), the strip text equals `labelAudit().claim`, and `promises().names` is `within`, not `'all'`. The radius is **true**: every "visible and unnamed" being I flagged inside it is, converted to EYE distance off its own mark geometry (ring 1.74 m, `worldPerPx = 2·tan 22.5° / 914.8`), just outside — Ristuden **14.12 m** under a 14 m claim, Joram **14.35 m** under 14 m, Lumul 15.21 m, Jorondra 39.4 m under 21 m. `nameRadius` floors to the metre strictly inside the nearest readable unnamed being and 14.12 → 14 exactly. | **PASS** |
| **5 badges** | Measured on the specimen grid at MID: badge disc **33.3 CSS px against a 134 px figure (24.8 %)** and **26 px against 75 px (35 %)** — both under the 40 % cap, against round two's 87 px discs over 62 px beings. No stacked or overlapping badges in either the specimen or the settlement frame. Withheld badges whose activity carries a pictogram report `activityShownOf === null` **1 / 1**; the two that still answer are `standing` / `walking`, which the code documents as carried by the ground streak. | **PASS** |
| **6 no regression** | Scale bar **exact in all four bands**; chips **never** over pins; roster selection survives a real pick; condition **24 / 24**; CVD 4 / 4; true scale +1.4 %; nothing hidden by scenery; 60.01 fps / 0 long tasks; limiter 10.0 / 10.0. **But FAR is no longer reachable with the mouse** — defect 1. | **FAIL** |

## The numbers

| bar | target | mine | truth | |
|---|---|---|---|---|
| FAR whole frame (17 chips + 4 dots) | ±10% | 316 | 316 | **0.0% pass** |
| DEFAULT whole frame, world 1 | ±10% | 301 | 302 | **−0.3% pass** |
| world 1 quadrants TL / TR / BL / BR | ±10% each | 157 / 15 / 80 / 49 | 160 / 15 / 78 / 49 | **−1.9 / 0.0 / +2.6 / 0.0 % pass** |
| world 1, settlement ON both mid-lines | ±10% each | 19 / 24 / 1 / 28 | 18 / 22 / 1 / 28 | **+5.6 / +9.1 / 0 / 0 % pass** |
| world 2 quadrants | ±10% each | 54 / 20 / 20 / 3 | 53 / 20 / 20 / 3 | **+1.9 / 0 / 0 / 0 % pass** |
| `quadrants[].reconciles` | exact | — | **20 of 20**, 5 frames | **pass** |
| chip disc over a pin (box test AND `.wcount` rect) | 0 | 0 by eye at 4× | **0 in all 5 frames** | **pass** |
| condition at DEFAULT, 24 filed targets | ≥70% | 24 `well` | 24 `well` | **100% pass** |
| the two non-`well` beings in that frame | — | found both, blind, while counting (amber dashed = starving; red spiked = in danger) | Beliask starving, Vashual in danger | **pass** |
| scale bar, four bands | honest | 500 m / 145 px · 20 m / 158 · 5 m / 197 · 2 m / 189 | `metres / metresPerPx` == probe px to **0.00 px**, drawn bar within **0.4 px** | **pass** |
| true scale | 1 unit = 1 m | bar says 1.75 m = 69.1 px at MID; probe says the adult is **70.1 px** | +1.4% | **pass** |
| `scaleReport()` | — | adult 1.75 · child 1.08 · elder 1.6 · **hut 4.400 (from the MESH)** · doorway 2.0 · footprint 6.08 · tree 20.25 | | pass |
| deuteranopia + protanopia, on bodies, in frame | no collapse | **4/4 separate** — plain cream / yellow dashed / blue concentric / spiked, and the bodies differ in lightness too | | **pass** |
| nothing hidden by scenery | 0 | **0** beings under 3 body px at DEFAULT, MID and NEAR | | pass |
| T2, 10 real-mouse hovers in a crowd | card == truth | **10/10** card == truth · **10/10** picker == card subject · **10/10** ringed instance is the card's subject · 8/10 hit the one I aimed at, and the other 2 are in the ↑↓ list · card covers its subject **0/10** · leaves the window **0/10** | | **pass** |
| perf, 316 @ 2400×, roster open (271 rows) | ~60 fps, 0 long tasks | **2401 frames / 40.0 s = 60.01 fps, 0 long tasks** | | pass |
| limiter idle focused / unfocused | ~10 fps | **10.0 / 10.0** draws/s | | pass |
| **FAR reachable with the wheel, maximized** | yes | **120 notches → 0.620 px, still DEFAULT** | round 1: 7 notches | **FAIL** |

## Defects, ranked

1. **HIGH — the FAR band cannot be reached with the mouse.** Two independent runs from the default
   camera on a maximized window — 70 notches at Δ260 and **120 notches at Δ300** — both asymptote at a
   figure of **0.620 px** with the strip still reading DEFAULT. Entering FAR from DEFAULT needs
   `BAND_EDGE_PX[0] × (1 − BAND_HYSTERESIS)` = **0.577 px**, so the orbit's far stop lands exactly one
   hysteresis step short of the band it was sized for: `maxOrbitDistance` is computed from the edge with
   `FAR_HEADROOM = 1.3`, and the distance actually in force corresponds to 0.620 = `BAND_EDGE_PX[0]`
   itself. The band is alive — `placeCamera` with `frameCandidates('far')` lands in it at 0.51 px, and
   the picture there is the best thing in the build (`d-far.png`: 17 chips and 4 dots, 316 counted from
   the picture against 316 in the frustum, **0.0 %**). A human simply cannot get to it. Round 1 passed
   this bar in 7 notches and round 2 filed a FAR frame; this is a regression of something that passed.
2. **MED — two probes answer "where is this being in the picture" differently, and the docs point a
   driver at the wrong one.** `screenPositionOf` projects the body's mid-height and returns client
   coordinates; `screenPoints` — what `quadrantAudit`, `markGeometry`, `planMarks` and the chip split all
   use — projects `groundY + markRadius/2` in canvas-local coordinates. Measured over 47 pins in one
   DEFAULT frame: **mean 11.3 px apart, max 14.3 px**. That is enough to put **26 of 302 beings (8.6 %)**
   in a different quadrant in the world-1 frame, and it is why a reviewer checking "a cluster's members
   all lie in one quadrant" with the documented probe finds 2–5 chips per frame that appear to straddle
   a line. The picture and the audit agree; the probe a driver is told to aim with does not. Either
   project both from the same point or say in `screenPositionOf`'s doc which mark it is not.
3. **MED — `coveredBy` still under-reports at the margin.** Of 101 beings standing at their own reported
   point, **2** (1956 behind 2331, 2490 behind 2272, both ~75 body px) are kept in `visibleIds()` with
   `coveredBy: null` and `reason: "visible"` while `pickAtScreen` at that point returns the other one
   first. Much smaller than round two's four-at-one-pixel, and partly an artefact of defect 2 — the
   cover rule tests the box centre, the driver aims at `screenPositionOf` — but a reader cannot tell
   those apart, and `visibleIds()` is the population a stranger test draws from.
4. **MED — selecting a specimen through `ui.select` loses its roster row.** Inspector correct and headed
   "specimen"; `.rrow.sel` absent, because the same call centres the camera, which zeroes `distance` and
   re-sorts the table. A real mouse click on a roster row keeps it (clicked "Galir … 206 m", row still
   marked at "14 m" after the camera moved), so the fix that landed for the pointer path never reached
   the programmatic one — which is the path a find → inspect driver uses.
5. **MED — the NEAR strip's radius and the card's distance are measured from different points.**
   `hoverCardFor().distance` and the roster's `distance` column are metres from the camera's **target**;
   the strip's "names within N m" is metres from the **eye**. In three of five NEAR frames the printed
   radius contains **zero** readable beings (`labelAudit().within` = 0) while 8, 5 and 8 names are drawn,
   every one of them outside it. The audit is honest and says `within: 0`; the strip reads as a claim
   about the people you can see, and it is not one. A reader holding a card that says "3.4 m" under a
   strip that says "names within 14 m" has been told two different things in the same units.
6. **MED — the ghosted hut is unchanged and is the worst object in the build.**
   `crops/badges-box-1140-980.png`: a translucent glass vitrine with grey slabs, and inside it six to
   eleven beings blown into one white cloud whose cream rings tangle into a scribble, with three name
   leaders pointing into the mass and two chips ("6" and "5") overlapping the same knot. Nothing is
   *hidden* — 0 beings under 3 body px in every band that draws bodies — and nothing is *separable*
   either. Listed not-fixed in round 2; still the single thing that most makes the close bands look
   unserious.
7. **LOW — the roster still counts display-only specimens as lives**: "442 living" beside a panel
   reading "316 / 511 alive". Round-2 defect 7, unchanged.
8. **LOW — the mint motion streak is still drawn at DEFAULT and still absent from the DEFAULT legend**,
   where it is several times the 24 px pin. Round-2 defect 8, unchanged; I again mis-read one as a pin
   while counting.
9. **NOT RE-TESTED, flagged so the next critic does not assume it.** (a) The bridge's unknown-`worldId`
   refusal and the `NO_LLM_KEY` path for a genuine engine-built pair: my probes were rejected on prompt
   shape first (`BAD_THINK_PROMPT: unexpected key "a"`) and the preload exposes no `buildThinkPrompt`
   (`getVersion, checkForUpdates, installUpdate, quit, onUpdate, llmComplete, llmStatus, setKey,
   getSettings, recentActivity, onActivity, listReports, readReport, writeReport`) — round 2's result
   stands unrefuted but unconfirmed. What I did confirm: garbage prompt → `BAD_THINK_PROMPT: prompt must
   be a plain object`, legacy shape → `unexpected key "snapshot"`, all under 2 ms, and the renderer has
   `process`, `require` and `module` all `undefined` with `window.lab` present. (b) "A being behind a
   ghosted hut is still visible" was not isolated — my probe caught only specimen beings; what supports
   it is 0 beings under 3 body px in all three body-drawing bands. (c) The hut ridge was not re-measured
   in pixels (my NEAR hut frame landed on empty sea); `scaleReport()` now measures it **from the mesh**
   at 4.400 m.

## Craft, against `02-running-world.png` and `04-being-inspector.png`

The baseline is a green relief map with coloured pinheads and a four-dot legend; this is not the same
instrument and has not been for two rounds. What is new in round 3 is that the **picture's own claims now
survive being attacked from outside**. A quadrant count is arithmetic: I counted four quarters of a
settled continent off a PNG, by the legend's own sentence, and came within 2.6 % of the view's number in
every one — including a frame where I deliberately drove the camera until a settlement sat across both
mid-lines and watched it split into a "7" above the line and a "16" below it. The scale bar is a real
cartographic ruler in four bands, agreeing with its own metres-per-pixel to the second decimal. The
condition channel read 24 for 24 at one pixel per being, and the two unwell people in three hundred
turned up in my notes before I opened the truth. Ten real-mouse hovers in a crowd produced ten correct
cards, ten correct highlights, no card over its own subject and no card off the window. Badges have
stopped being stickers. That half I would defend in a hostile room.

Two things stop it being an instrument a robotics or interpretability lab would adopt as it stands, and
neither is the figure art. The first is that **the widest contract is unreachable**: the FAR map is the
most convincing single view in the build and the scroll wheel stops one hysteresis step short of it
forever, so the thing the legend is proudest of exists only for a driver. The second is that the view
still answers the same question twice in different units — where a being is (11 px apart, 8.6 % of the
population in the wrong quarter), and how far away it is (eye versus target, under a strip that promises
a radius containing nobody). Round 2 failed on a number landing in the wrong quarter of the frame and a
visibility probe that lied; both are fixed, and I checked both against the picture rather than against
the probe that asserts them. What replaced them is smaller and more ordinary — a clamp that is off by a
hysteresis margin, and two measurements that disagree by eleven pixels. Fix defect 1 and I expect L3a to
pass; fix 2 and 5 and the honesty argument is over.

---

# Round 4 (L3a) (`09fa64b`) — **FAIL**

Built and run from the permanent clean checkout `C:\dev\YggdrasilLab-critic`, re-pinned
`git checkout --detach 09fa64b` from a clean tree, `pnpm install --frozen-lockfile --prefer-offline`
(already up to date), `pnpm --filter @yggdrasil/lab build` (exit 0). Lab suite **394 / 394 passed**
(9 files, 2.2 s). The main tree was never built, tested or checked out; only this review file was
edited there. Six Electron sessions, one at a time, isolated `YGG_HOME`, no key, launched with
`--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows
--disable-renderer-backgrounding --disable-background-timer-throttling` plus
`setBackgroundThrottling(false)`; every session proved it was drawing (12 frames / 1.2 s) before it
measured anything. **A 179416** (wheel→FAR on four geometries), **B 221072** (first pass, night),
**C 229584** (items 2–3 at scale, daylight, two worlds), **D 229980** (NEAR radius, the piled hut),
**E 217184** (chip interaction, regression sweep), **F 225532** (roster clicks, chip mix, NEAR strip).
All six verified gone by id; **0 `electron.exe` remain**. Maximised, canvas 2188 × 914.8 CSS, dpr 1.5,
world paused before every scored frame. Shots in `~/.yggdrasil-lab/rework/shots/L3a-r4-critic/`;
counts filed in `MY-READINGS.md` **before** `truth/` was opened.

## The round-4 claims

| | claim | my measurement | |
|---|---|---|---|
| **1** | FAR reachable by the wheel | From DEFAULT, real wheel events at Δ300: **30 notches → `far`** on maximised (2188 × 914.8), **30** on a small canvas (674 × 184.7), **30** after a live resize (1334 × 500.5), **20** on a short one (1114 × 215.7). Holds: 0.384 px at the stop, `atStop`, still `far` after two more notches and 1.5 s. After a live resize *while in FAR* the band stayed `far` at 0.390 px with `canvasH === projectionH`. | **PASS** |
| **2** | one screen point per being | 104 beings, 2 bands, 2 worlds, 10 cameras, measured against the PIXELS (hover draws a ring concentric with the being's ground point; centroid of the diff in a masked box). Of the **92 whose mark is drawn**, `screenPositionOf` equals `markScreenPositionOf` to **0.00 px, 92/92**, and the drawn ink is **mean 2.38 px, max 13.43 px** away (4 over 8 px). Quadrant split **0 of 56**. Round three's 11.3 px / 8.6 % is gone. | **PASS**, see defect 4 |
| **3** | nobody offered while covered | **148 offered beings** over 10 cameras: **4 mispicks (2.70 %)** against round three's 2/101 (1.98 %). Three of the four hand you a being the view itself calls `"behind another being"` and keeps out of `visibleIds()`. | **FAIL** |
| **4** | `ui.select` keeps the roster row | `.rrow.sel` present **3/3** after `select`, **3/3** after `centreOn`, inspector and selbar correct. | **PASS** |
| **5** | NEAR radius, one metric | 7 real settlement frames (67–138 beings in frame). Strip text **equals** `labelAudit().claim` 3/3 exactly — that half is fixed. But `within` = **2, 1, 0, 1, 0, 0, 0** against `shown` = 10, 6, 7, 6, 2, 10, 5: the printed radius contains almost nobody. In 2 of 4 measured frames **5 names each are drawn beyond a nearer readable unnamed being** (Marosh readable at 4.12 m, unnamed; Keloan 4.15, Eskaem 4.20, Joram 4.21, Umbor 4.26, Selur 13.14 m, all named). `e-hut-near.png` prints **"NAMES WITHIN 0 M · 4 SHOWN"**. | **FAIL** |
| **6** | the piled hut | Found 12-, 18- and 22-occupant shelters. Rings/badges/arrows **are** off (`marksKept` 0/18, 0/22) and the ghosted hut **does** read as a building — roof, eaves, corner posts, footprint, doorway. Everything else fails: see below. | **FAIL** |
| **7** | no regression | Everything round three passed still passes **except the roster, clicked with a real mouse** — defect 2. | **FAIL** |

## The numbers

| bar | target | mine | truth | |
|---|---|---|---|---|
| FAR whole frame (10 chips + pins) | ±10% | **267** | 268 | **−0.37% pass** |
| DEFAULT whole frame (8 chips + pins) | ±10% | **59** | 60 | **−1.67% pass** |
| condition at DEFAULT, every pin I resolved | ≥70% | 14 well + 3 starving | 15 well + 3 starving | **17/17 right, all 3 starving found, pass** |
| **people inside the hut, read from the picture** | ±10% | **3** (MID), **1–2** (night), **2–3** (NEAR) | 12, 18, 22 | **−75% / −92% / −89% FAIL** |
| scale bar, four bands | `px == metres/mPerPx` | 500 m/144.9 · 20 m/157.8 · 5 m/178.1 · 2 m/187.9 | error **0.000 px in all four** | pass |
| true scale | 1 unit = 1 m | +0.01 / +0.40 / +0.73 / **+2.90 %** (far/default/mid/near) | adult 1.75, hut **4.400 from the mesh**, doorway 2.0 | pass |
| quadrants reconcile / chip over a pin / clear marks overlapping | exact / 0 / 0 | **4 of 4 · 0 · 0** | | pass |
| pointable but NOT offered | 0 | **0 of 18** | | pass |
| 12 real-mouse hovers in a crowd | card == truth | **12/12 hit · 12/12 card == truth · 0 covering its subject · 0 off-window** | | pass |
| perf, 290 beings @ 2400×, roster open | ~60 fps, 0 long tasks | **2400 frames / 40.0 s = 60.00 fps, 0 long tasks** | | pass |
| limiter focused / unfocused / minimised | ~60/10/2 | **60 / 10.0 / 1.0** draws per second | `document.hidden` stayed **false** while minimised | pass |
| deuteranopia, on bodies and rings | no collapse | **4/4 separable** (cream plain · yellow dashed · olive **spiked** · blue concentric) | | pass |
| badges vs their being | ≤40% | 46–56 CSS px discs against 114 CSS px at frame centre (**~40–49 %**) and 250+ px in the foreground (~20 %); none stacked | eyeballed off a crop, no probe exists | pass, at the edge |
| bridge | refuses | garbage → `prompt must be a plain object` (2 ms); legacy → `unexpected key "snapshot"`; renderer `process`/`require`/`module` **undefined**, `window.lab` present | unknown-world refusal **unreachable**: every well-formed pair now trips `BAD_THINK_INPUT: snapshot.place must be an object` (the engine moved to the opaque `place`, as `env.d.ts` predicted) | pass, one path untestable |

## Defects, ranked

1. **HIGH — a shipped shader does not compile, in every session.** `applyGhostFade` injects
   `normalize(transformedNormal)` at `World3D.ts:1035` into `#include <begin_vertex>`. GLSL compiles
   both branches of `if (uRim > 0.0)`, and `windowMat` (`:1549`) is a **`MeshBasicMaterial`**, whose
   vertex shader declares no normals. Result, six times out of six:
   `THREE.WebGLProgram: Shader Error … 'transformedNormal' : undeclared identifier … Vertex shader is
   not compiled.` The **lit windows never draw**, which is why every hut in `d-hut-mid.png` is a black
   box at midnight. Structure materials are `MeshStandardMaterial` and survive; the rim term itself is
   fine. A renderer that logs a compile failure on boot is not an instrument anyone should trust, and
   no round has caught it because `pageerror` does not see `console.error`.
2. **HIGH — you can pick one being off the roster with the mouse and then no other.** Real clicks on
   `.rrow` 2, 6 and 11: the first selects Kelith; the next two leave `.rrow.sel` **and the selbar still
   reading "Kelith"**, at 500 ms and at 1.9 s. A fourth click in session E left **no** selected row at
   all. The programmatic `ui.select` path is fine (4 passes), so the fix that landed for the driver
   never reached the pointer — the mirror image of round three's defect 4.
3. **HIGH — eighteen people in a hut read as one or two.** `crops-hut-night.png`: the bodies are drawn
   through the ghost at full white with no shading, and fuse into a single blown-out mass; I resolved
   **two heads out of eighteen**. Meanwhile **seven of the eighteen are still NAMED**, with seven
   leaders converging into that same mass — the building was supposed to speak for them. The count disc
   is drawn in empty sky at the top of a dashed hull whose lower arc crosses the roof, and its leader
   runs into the tree behind: my first blind reading was "a crowd of 18 somewhere behind that tree".
   The `.wmix` bar on both shelter chips measures **0 × 0 px** — no condition mix is drawn, so the
   chip says how many and nothing about how they are. (Ordinary chips do draw it when the mix has two
   segments: the `5` chip, `well:2 starving:3`, is 10.2 × 3 px. Single-segment chips draw it
   inconsistently — 5 of 24 at MID, 1 of 24 at DEFAULT.)
4. **MED — two coordinate systems, and the mouse lands 113 px away.** `chipsOnScreen()` returns
   **canvas-local** coordinates; `screenPositionOf` and `pickAtScreen` return **client** ones. Measured
   on the same chip: probe (1290, 306), DOM rect (1306.0, 418.8) — off by exactly the canvas origin
   (16, 112.8). Driving the real mouse to the probe's point opened **no card at all** (session D);
   driving it to the DOM rect opened the right one — "22 inside this shelter · well 22 · standing 21 ·
   asleep 1 · click to frame them" — and the click framed **22 of 22**. Round three's defect 2 was
   closed for beings and left open for chips. The 12 housed beings are the same story:
   `screenPositionOf` and `markScreenPositionOf` sit **28.5–37.1 px** apart there, documented but
   invisible to a driver that does not know which regime it is in.
5. **MED — the NEAR radius is honest and useless.** `nameRadius` floors the radius strictly inside the
   nearest readable unnamed being, so "names within 3 m" is literally true and the strip, the claim and
   the DOM are one number — that is a real fix. But the rule then names people it calls *unreadable*
   out to 13–17 m while leaving a *readable* one at 4.12 m unnamed, so the printed radius contains
   **zero** of the names drawn over it in 4 of 7 frames, and collapses to **0 m** in one. A reader is
   told "NAMES WITHIN 0 M · 4 SHOWN".
6. **MED — four mispicks in 148.** 1846/1977, 2276/2070, 2768/2598, 1986/2420→2541. In three of four,
   `pickAtScreen` at the offered being's own point returns, first, a being whose `visibilityOf` says
   `coveredBy` and `reason: "behind another being"`. The picker has the depth order and the cover rule
   disagrees with it; `visibleIds()` is the population a stranger test draws from.
7. **LOW — `visibleIds()` offers 5 of 115 at MID.** In `c-mid.png`, 115 beings stand in frame, ten or
   more with their own ground ring and name, and the view will let you point at five. Nothing here is
   *wrong* — every offered being is pointable and `pointableNotOffered` is 0 — but the honest
   population a reviewer is told to sample from is now a twentieth of the picture.

## Craft

Two things in this round are genuinely better than round three, and I would defend both. The FAR map
is reachable with a scroll wheel on every window shape I could produce, and it counts: 267 from the
picture against 268 in the frustum, by adding ten numbers and eight dots. And "where is this being"
is finally one question with one answer — ninety-two marks, two worlds, two bands, and the probe and
the pixels agree to 2.4 px with the quadrant split at zero. That was round three's headline defect and
it is closed properly, against the screenshot rather than against the probe that asserts it.

What has not moved is the thing the round was mostly about. A hut with twenty-two people in it is
still, at every band, a white cloud — and this time the cloud has no rings to blame. The marks came
off exactly as promised, and what is left underneath is a shape nobody can count, under a number
drawn in the sky, beside four names pointing into fog. `NEAR · A BEING IS 207 PX · THE WHOLE FIGURE ·
EVERYTHING IT IS DOING` is printed under it. Fixing the annotation was the easy half; the bodies were
always the hard half, and they are unchanged. Add to that a shader that has never compiled, a roster
you can only pick from once, and a probe that aims the mouse 113 pixels below the thing it describes,
and this is not yet an instrument — it is an instrument with three loose wires and a lens cap on.
