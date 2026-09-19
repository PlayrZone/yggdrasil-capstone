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
