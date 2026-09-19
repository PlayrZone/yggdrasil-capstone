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
