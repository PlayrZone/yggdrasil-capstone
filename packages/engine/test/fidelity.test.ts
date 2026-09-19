import { describe, expect, it } from 'vitest';
import {
  COMMON_WORD_FORMS,
  DECISIVE_SURFACES,
  Experiment,
  LEAK_DOMAINS,
  LEXICAL_CALIBRATION,
  LlmLeakJudge,
  MockLeakJudge,
  MockMindBackend,
  buildThinkPrompt as buildThinkPromptIn,
  calibrateDetector,
  deserializeThinkInput,
  detectActLeak,
  detectLeak,
  detectLexicalLeaks,
  domainMatcher,
  domainStems,
  evalKnowledgeFidelity,
  foragerAdapter,
  holdsGround,
  judgeDetector,
  leakTrapBattery,
  lexicalDetector,
  ownDomainDetector,
  quotableRecall,
  stemWord,
  unionDetector,
  suppliedVocabulary,
} from '../src/index.js';
// The COMPILED lexicon — what the matcher reads after folding, guards resolved.
// `domainMatcher` gives what was written; only this can answer "does the guard
// I wrote actually apply?", which is the round-5 blocker.
import { decisiveLexicon } from '../src/training/leakMatch.js';
import type {
  CalibrationCard,
  CalibrationItem,
  CognitionRecordV2,
  ICognitionSink,
  IMind,
  IMindBackend,
  LeakDomain,
  LeakJudgement,
  MindOutput,
  ThinkInput,
  ThinkPrompt,
} from '../src/index.js';
import { DEV_SET, DEV_SUPPLIED, devOutput, devSplit } from './leakDevSet.js';
import { cleanSentences } from './cleanCorpus.js';

// W1-B3 wiring: the battery is the forager continent's eval pack, so the
// prompts its probes render into are that world's.
const buildThinkPrompt = (input: ThinkInput): ThinkPrompt => buildThinkPromptIn(input, foragerAdapter);

/**
 * Gate 2 — knowledge fidelity, round 2. The reviewer failed round 1 on two
 * counts, and this file is organised around them:
 *
 *   THE MATCHER WAS SCORED ON ITS OWN VOCABULARY. 1.00/1.00 on the fixtures it
 *   was written from; 0.94/0.42 on a set it had not seen, with six of eight
 *   domains under 0.7. So it is now scored by a calibration harness against a
 *   labelled dev set, split into a half that was tuned on and a half that was
 *   not, and the numbers are shipped as data the gate quotes.
 *
 *   THE BATTERY WAS SEPARABLE. Three policies with zero comprehension passed
 *   it. So the arms are generated from one seeded stream and the adversarial
 *   policies are in the suite, each REQUIRED to fail, each for its own reason.
 *
 * ROUND 3 answers the round-2 review the same way, and changes what tier 2 is
 * FOR. A second blind set (184 outputs) measured it at 0.824 / 0.412 against a
 * self-measured 0.944 / 0.944, and `"should"` fuzzy-matched `smoulder` so a
 * faithful policy leaked 24 traps of 24. Recall is no longer the target: tier 2
 * is a high-precision lower bound, the card carries the BLIND numbers as its
 * headline, and the tests below hold that line — a corpus of 2,400 ordinary
 * sentences the matcher must be silent about, and a rule that no verdict may
 * quote a recall above the last blind measurement.
 *
 * ROUNDS 4 AND 5 close the near-miss class by RULE rather than by dictionary,
 * twice: first the GUESS pass (`mortal`, `banter`, `markers`, `Smoulda` — a
 * guess is weak evidence and needs corroboration; a name is never a word), then
 * the EXACT pass, where the stemmer itself manufactured the collisions
 * (`leader`→`lead`, `healer`→`heal`, `singe`→`sing`, `sharpen`→`sharp`, and
 * "I will lead them to the water" leaking 24 traps of 24). A decisive word is
 * now a WORD: an ordinary English surface fires only if that surface is itself
 * declared decisive. The guard is closed-form — every form of every common word
 * this stemmer can produce, in three frames, must be silent but for an
 * allowlist justified word by word — and the severity test salts a faithful
 * policy with every offender and with 200 ordinary words over three seeds.
 */

// ─── The dev set, as calibration items ───────────────────────────────────────

function suppliedOf(extra: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const token of `${DEV_SUPPLIED} ${extra ?? ''}`.split(/\s+/)) {
    const stem = stemWord(token);
    if (stem) set.add(stem);
  }
  return set;
}

/** Every form of one common word this stemmer's own suffix rules can produce. */
function inflectionsOf(word: string): string[] {
  const bare = word.endsWith('e') ? word.slice(0, -1) : word;
  const y = word.endsWith('y') ? `${word.slice(0, -1)}i` : null;
  const forms = new Set<string>([word]);
  for (const suffix of ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'en', 'eth', 'est', 'ly']) {
    forms.add(`${word}${suffix}`);
    forms.add(`${bare}${suffix}`);
    if (y) forms.add(`${y}${suffix}`);
  }
  return [...forms];
}

/**
 * 200 ordinary words, every fifth one that is not itself a declared leak word,
 * each in its own flat sentence. Deterministic: same salt every run.
 */
const ORDINARY_SALT = COMMON_WORD_FORMS.filter((w) => !DECISIVE_SURFACES.has(w))
  .filter((_, i) => i % 5 === 0)
  .slice(0, 200)
  .map((w) => `I ${w} here.`)
  .join(' ');

const DEV_ITEMS: (CalibrationItem & { split: 'tune' | 'holdout' })[] = DEV_SET.map((item, i) => ({
  id: item.id,
  domain: item.domain,
  leak: item.leak,
  category: item.category,
  output: devOutput(item),
  ...(item.grounded ? { grounded: item.grounded } : {}),
  supplied: suppliedOf(item.holds),
  split: devSplit(item, i),
}));

describe('tier 2 — the matcher, measured', () => {
  it('is scored on a set with every category the review said it missed', () => {
    const categories = new Set(DEV_SET.map((i) => i.category));
    for (const needed of ['archaic', 'spelling', 'childlike', 'paraphrase', 'hedged', 'cross-domain', 'control-overreach', 'curiosity']) {
      expect(categories, needed).toContain(needed);
    }
    expect(new Set(DEV_SET.map((i) => i.domain)).size).toBe(LEAK_DOMAINS.length);
    expect(DEV_SET.filter((i) => i.arm === 'control').length).toBeGreaterThanOrEqual(24);
    // Both halves carry leaks and cleans, or the split proves nothing.
    for (const split of ['tune', 'holdout'] as const) {
      const half = DEV_ITEMS.filter((i) => i.split === split);
      expect(half.filter((i) => i.leak).length, split).toBeGreaterThan(20);
      expect(half.filter((i) => !i.leak).length, split).toBeGreaterThan(20);
    }
  });

  it('clears the bars: precision ≥ 0.90, recall ≥ 0.70, no domain under 0.50', async () => {
    const result = await calibrateDetector(lexicalDetector(), DEV_ITEMS);
    const report = result.confusions.map((c) => `${c.kind} [${c.domain}] ${c.id}: ${c.text}`).join('\n');
    expect(result.precision, report).toBeGreaterThanOrEqual(0.9);
    expect(result.recall, report).toBeGreaterThanOrEqual(0.7);
    for (const domain of result.byDomain) {
      expect(domain.recall, `${domain.domain}\n${report}`).toBeGreaterThanOrEqual(0.5);
    }
  });

  /**
   * The half the matcher was never tuned against. It is the closest thing here
   * to the blind set the next review will write, and it is the number the card
   * quotes — deliberately, because the tuned half says 1.00/1.00 and that is
   * exactly the claim round 1 was failed for.
   */
  it('still clears them on the half it was never tuned on', async () => {
    const holdout = await calibrateDetector(lexicalDetector(), DEV_ITEMS.filter((i) => i.split === 'holdout'));
    expect(holdout.precision).toBeGreaterThanOrEqual(0.85);
    expect(holdout.recall).toBeGreaterThanOrEqual(0.7);
    expect(holdout.precision).toBe(LEXICAL_CALIBRATION.selfMeasured.holdout.precision);
    expect(holdout.recall).toBe(LEXICAL_CALIBRATION.selfMeasured.holdout.recall);
  });

  /** The card cannot rot: every SELF-MEASURED number on it is recomputed here. */
  it('ships a calibration card that matches what the matcher actually does', async () => {
    const all = await calibrateDetector(lexicalDetector(), DEV_ITEMS);
    const self = LEXICAL_CALIBRATION.selfMeasured;
    expect(self.set.size).toBe(DEV_ITEMS.length);
    expect(self.set.leaks).toBe(DEV_ITEMS.filter((i) => i.leak).length);
    expect(self.set.cleans).toBe(DEV_ITEMS.filter((i) => !i.leak).length);
    expect(self.measured).toEqual({ precision: all.precision, recall: all.recall });
    expect(self.byDomain).toEqual(
      all.byDomain.map((d) => ({ domain: d.domain, precision: d.precision, recall: d.recall })),
    );
    expect(self.label).toBe('self-measured, optimistic');
    expect(LEXICAL_CALIBRATION.caveats.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * THE BLIND HALF. Nothing here can be recomputed — that is what makes it
   * worth quoting — so what is asserted is that it is present, attributed,
   * hashed, and that it is the number the gate is bounded by. Round 2 shipped
   * `holdout 0.944/0.944` as the headline while a reviewer's blind set said
   * 0.824/0.412, and printed the 0.944 on every verdict line.
   */
  it('carries the reviewer’s blind measurement, with its provenance, as the headline', () => {
    const blind = LEXICAL_CALIBRATION.blind;
    // The ROUND-5 re-score, transcribed exactly. Round 4's card carried
    // 0.982/0.539 on a tree that had moved underneath it, so the gate printed
    // `blind recall 0.539` while the reviewer's own number was 0.510 — the one
    // rule this card exists to enforce, broken by staleness alone.
    expect(LEXICAL_CALIBRATION.detector).toBe('tier2-lexical@r5');
    expect(blind.set).toBe('T1-blind-r2');
    expect(blind.n).toBe(184);
    expect(blind.precision).toBe(0.981);
    expect(blind.recall).toBe(0.51);
    expect(blind.perDomain.map((d) => d.domain).sort()).toEqual([...LEAK_DOMAINS].sort());
    for (const d of blind.perDomain) expect(LEAK_DOMAINS).toContain(d.domain);
    expect(Object.fromEntries(blind.perDomain.map((d) => [d.domain, d.recall]))).toEqual({
      astronomy: 0.583,
      cultivation: 0.429,
      fire: 0.846,
      governance: 0.231,
      medicine: 0.417,
      metallurgy: 0.462,
      toolmaking: 0.615,
      trade: 0.5,
    });
    expect(blind.measuredBy).toMatch(/reviewer/i);
    expect(blind.measuredAt).toBe('2026-09-18T19:30:34');
    expect(blind.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(blind.sha256).toContain('305b6bbe');
    expect(blind.heldAt).toMatch(/outside this repo/);
    // It says which tree it was measured on, rather than being quietly replaced
    // by a number the engineer measured on their own work. It no longer says it
    // PREDATES anything: a card that has to disclaim its own tree is a stale
    // card, and the answer to that is a re-score, not a footnote.
    expect(blind.note).toMatch(/re-scored on the round-5 tree/);
    expect(blind.note).not.toMatch(/PREDATE|predate/);
    expect(blind.note).toMatch(/reported, not targeted/);
    // And the blind recall is far below the self-measured one, which is the
    // whole reason the card has two halves.
    expect(blind.recall).toBeLessThan(LEXICAL_CALIBRATION.selfMeasured.holdout.recall);
  });

  /**
   * THE RULE. A verdict may never quote a recall above the latest blind
   * measurement — not from the holdout, not from a card someone hands in.
   */
  it('never lets a verdict quote a recall above the blind measurement', async () => {
    expect(quotableRecall(LEXICAL_CALIBRATION)).toBe(LEXICAL_CALIBRATION.blind.recall);

    const inflated: CalibrationCard = {
      ...LEXICAL_CALIBRATION,
      selfMeasured: { ...LEXICAL_CALIBRATION.selfMeasured, holdout: { precision: 1, recall: 0.99 } },
    };
    expect(quotableRecall(inflated)).toBe(LEXICAL_CALIBRATION.blind.recall);

    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new GroundedPolicy() }), { card: inflated });
    expect(r.detector.recall).toBe(LEXICAL_CALIBRATION.blind.recall);
    expect(r.verdictDetail).toContain(String(LEXICAL_CALIBRATION.blind.recall));
    expect(r.verdictDetail).not.toContain('0.99');
    expect(r.verdictDetail).toContain('T1-blind-r2');
    // Every number printed on the verdict line is at or below the bound.
    for (const n of r.verdictDetail.match(/0\.\d+/g) ?? []) {
      expect(Number(n)).toBeLessThanOrEqual(LEXICAL_CALIBRATION.blind.recall);
    }

    // A card whose own holdout is WORSE than the blind number lowers the claim:
    // a detector may always be quoted as less than it hopes, never as more.
    const worse: CalibrationCard = {
      ...LEXICAL_CALIBRATION,
      selfMeasured: { ...LEXICAL_CALIBRATION.selfMeasured, holdout: { precision: 1, recall: 0.2 } },
    };
    expect(quotableRecall(worse)).toBe(0.2);
  });

  /**
   * …and the bound is `min(blind, holdout)` at the round-5 number, on the card
   * as it actually ships. Round 4's card printed 0.539 after the reviewer had
   * measured 0.510, so the number itself is pinned here, not just the rule.
   */
  it('quotes min(blind, holdout) — and prints no number above 0.510', async () => {
    const bound = Math.min(LEXICAL_CALIBRATION.blind.recall, LEXICAL_CALIBRATION.selfMeasured.holdout.recall);
    expect(bound).toBe(0.51);
    expect(quotableRecall(LEXICAL_CALIBRATION)).toBe(bound);

    const backend = new MockMindBackend({ policy: new GroundedPolicy() });
    const bare = await evalKnowledgeFidelity(backend);
    const judged = await evalKnowledgeFidelity(backend, { judge: new MockLeakJudge() });
    for (const r of [bare, judged]) {
      expect(r.verdict, r.verdictDetail).not.toBe('FAIL');
      expect(r.detector.recall).toBe(0.51);
      for (const n of r.verdictDetail.match(/\d+\.\d+/g) ?? []) {
        expect(Number(n), r.verdictDetail).toBeLessThanOrEqual(0.51);
      }
    }
    expect(bare.verdictDetail).toContain('blind recall 0.51');
    expect(bare.verdictDetail).not.toContain('0.539');
  }, 30_000);

  /**
   * Round 1 asked only the trap's own domain. Measuring both ways on the same
   * set is what makes the cost of that visible instead of arguable.
   */
  it('gains real recall by asking every domain, not only the probe’s own', async () => {
    const all = await calibrateDetector(lexicalDetector(), DEV_ITEMS);
    const own = await calibrateDetector(ownDomainDetector(), DEV_ITEMS);
    const cross = DEV_ITEMS.filter((i) => DEV_SET.find((d) => d.id === i.id)!.category === 'cross-domain');
    const crossAll = await calibrateDetector(lexicalDetector(), cross);
    const crossOwn = await calibrateDetector(ownDomainDetector(), cross);
    expect(all.recall).toBeGreaterThan(own.recall);
    expect(crossOwn.recall).toBeLessThan(1);
    expect(crossAll.recall).toBe(1);
  });

  it('catches the sentences the review printed as misses', () => {
    const caught = (domain: LeakDomain, text: string): boolean =>
      detectLeak(domain, { goals: [], plan: [], utterances: [], thought: text }).length > 0;
    expect(caught('medicine', 'the sickness passeth from him that coughs unto such as sit anigh him')).toBe(true);
    expect(caught('toolmaking', 'a sharpe stoon bounden upon a longe shafte maketh a spere')).toBe(true);
    expect(caught('metallurgy', 'I shalle smelte the grene ore in a grate heete untill the mettal renneth')).toBe(true);
    expect(caught('fire', 'Rock hit rock make little light. Little light eat wood. Wood make warm.')).toBe(true);
    expect(caught('trade', 'If I give and he gives back, we are both fed')).toBe(true);
  });

  it('does not fire on the two the review printed as false positives', () => {
    expect(detectLexicalLeaks({ goals: [], plan: [], utterances: [], thought: 'My hunger burns in me.' })).toEqual([]);
    // The other was an intent rule; tier 1 owns it, and it is tested there.
  });

  /**
   * The rule that separates curiosity from a hedged leak, tested on BOTH sides.
   * Proposing an act and finding out is what the world's own prompt invites;
   * naming a concept nothing supplied is the pretraining, hedge or no hedge.
   */
  it('separates curiosity from a hedged leak', () => {
    const supplied = suppliedOf('');
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    const clean = (text: string): void => {
      expect(detectLexicalLeaks(said(text), { supplied }), text).toEqual([]);
    };
    const speculative = (domain: LeakDomain, text: string): void => {
      const evidence = detectLeak(domain, said(text), { supplied });
      expect(evidence.map((e) => e.kind), text).toContain('speculative');
    };
    clean('I wonder what these seeds are for.');
    clean('I will put one seed in the ground and see what happens to it.');
    clean('I wonder if the green rock in my hand is good for anything.');
    clean('I will strike the stones together and see.');
    speculative('cultivation', 'I wonder if seeds grow into plants.');
    speculative('metallurgy', 'Perhaps I could smelt the ore if the heat were great enough.');
    speculative('medicine', 'Perhaps the illness is carried on the breath of the one who coughs.');
    // …and an assertion is never speculative, whatever else is in the sentence.
    expect(detectLeak('cultivation', said('Seeds grow into plants.'), { supplied })[0]!.kind).toBe('claim');
  });

  it('never treats this world’s own vocabulary as decisive, and its stems do not collide', () => {
    const world = ['seed', 'seeds', 'copper', 'tin', 'iron', 'ore', 'coal', 'salt', 'spear', 'craft', 'berry', 'wood', 'stone', 'clay', 'shelter', 'charcoal', 'rope', 'brick'];
    for (const domain of LEAK_DOMAINS) {
      const matcher = domainMatcher(domain);
      expect(matcher.decisive.length, domain).toBeGreaterThan(0);
      expect(matcher.claims.length, domain).toBeGreaterThan(0);
      for (const word of world) {
        expect(matcher.decisive.map((d) => d.word), `${domain} treats "${word}" as decisive`).not.toContain(word);
      }
    }
    // Stemming must not quietly merge a world word into a decisive one.
    const decisiveStems = new Set(LEAK_DOMAINS.flatMap((d) => domainMatcher(d).decisive.map((w) => stemWord(w.word))));
    for (const word of [...world, 'plant', 'planted', 'earth', 'warmer', 'heat', 'meat', 'great', 'water', 'dark', 'mark', 'time', 'below', 'follow', 'give', 'gather', 'health', 'might', 'people', 'together', 'light', 'hearth'.replace('h', 'e')]) {
      expect(decisiveStems.has(stemWord(word)), `"${word}" stems onto a decisive word`).toBe(false);
    }
  });

  /**
   * ROUND-2 BLOCKER B1, as a class. `stemWord('should')` is `should`, one edit
   * from the fire lexicon's `smoulder` (`smould`), so every sentence containing
   * "should" scored a fire leak and a faithful policy leaked 24 traps of 24.
   * The fix is not the word: a near miss may only ever be read as a MISSPELLING,
   * so it may not land on a word English already has, nor on a short one, nor
   * where the edit falls in the first two characters.
   */
  it('never guesses that an ordinary English word is a leak word', () => {
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    // The exact sentence that failed the round.
    expect(detectLexicalLeaks(said('I should rest now.'))).toEqual([]);
    expect(detectLeak('fire', said('I should rest now.'))).toEqual([]);
    for (const word of ['should', 'shoulder', 'would', 'could', 'follow', 'fellow', 'forest', 'honest', 'nothing', 'brother', 'mother', 'another', 'together', 'remember', 'hunger', 'weather', 'farther', 'pasture', 'gather']) {
      expect(detectLexicalLeaks(said(`I ${word} here with the others.`)), word).toEqual([]);
    }
    // A real misspelling is still caught when the sentence carries a second
    // word of that domain: the guess is corroborated (see the round-4 rule).
    expect(detectLeak('metallurgy', said('I will put the ore in the furnase.')).length).toBeGreaterThan(0);
    // The guard is data a test can read, and it is a list of ordinary English.
    expect(COMMON_WORD_FORMS.length).toBeGreaterThan(800);
    for (const word of ['should', 'would', 'could', 'the', 'and', 'people', 'water']) {
      expect(COMMON_WORD_FORMS, word).toContain(word);
    }
  });

  /**
   * ROUND-3 BLOCKER, CLOSED BY RULE. The word list held for its own 997 words
   * and nothing else: `mortal`≈`mortar`, `banter`/`barber`≈`bartering`,
   * `markers`≈`market`, `shapens`≈`sharpening` and the invented names
   * `Smoulda`, `Mortara`, `Bladen` each reproduced round 2's catastrophe
   * exactly. A guess is now weak evidence — never decisive on its own.
   */
  it('never lets a guessed decisive word stand on its own', () => {
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    for (const text of [
      'I am mortal and so are the others.',
      'The mortals who came before me are gone.',
      'We bantered a while and then went on.',
      'The barber of my people cut my hair.',
      'I put markers on the path so I can find my way back.',
      'The shapens of the rocks here are strange.',
      'They call me Smoulda.',
      'My mother is called Mortara and she is kind.',
      'The one they call Bladen went to the water before me.',
    ]) {
      expect(detectLexicalLeaks(said(text)), text).toEqual([]);
    }
    // A name the INPUT gave the being is inert wherever it stands, including
    // first — which is the one place a capital proves nothing.
    const names = new Set([stemWord('Bladen'), stemWord('Smoulda')]);
    expect(detectLexicalLeaks(said('Bladen went to the water before me.'), { names })).toEqual([]);
    expect(detectLexicalLeaks(said('Smoulda and I walked far today.'), { names })).toEqual([]);

    // CORROBORATED, the same guess still fires: a misspelling beside another
    // word of its own domain is a misspelling.
    expect(detectLeak('metallurgy', said('I will put the ore in the furnase.')).length).toBeGreaterThan(0);
    expect(detectLeak('metallurgy', said('I shalle smelte the grene ore in a grate heete.')).length).toBeGreaterThan(0);
    // …and an EXACT decisive word never needed corroborating.
    expect(detectLeak('fire', said('I will light a fire.')).length).toBeGreaterThan(0);
    expect(detectLeak('trade', said('I will pay him for it.')).length).toBeGreaterThan(0);
  });

  /**
   * ROUND-4 BLOCKER, CLOSED BY RULE. The guess rule gated the GUESS pass, and
   * the stemmer manufactured EXACT collisions underneath it: `leader`→`lead`,
   * `healer`→`heal`, `singe`→`sing`, `sharpen`→`sharp`. "I will lead them to
   * the water" — about the most ordinary sentence a being here can write —
   * drove a faithful policy to FAIL, 24 traps of 24.
   *
   * A decisive word is now a WORD, not a stem: if the surface the being wrote
   * is ordinary English, it fires only when that exact surface is itself
   * declared decisive.
   */
  it('reads decisive words as words, not as stems shared with ordinary English', () => {
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    for (const text of [
      'I will sing to the child.',
      'I will lead them to the water.',
      'Lead me to the water.',
      'The wound will heal in time.',
      'The stone is sharp and it cut me.',
      'I will plant my feet here and wait.',
      'That is mine and not yours.',
      'As a rule I go west before the dark.',
      'I will tend to him until he is better.',
      'He lost his temper and walked away.',
      'I will quench my thirst at the river.',
      'My head aches and I am hot with fever.',
    ]) {
      expect(detectLexicalLeaks(said(text)), text).toEqual([]);
    }
    // …and the words those ones collided with still fire, written out in full.
    expect(detectLeak('governance', said('The leader of my people is old.')).length).toBeGreaterThan(0);
    expect(detectLeak('medicine', said('The healer pressed the root to the wound.')).length).toBeGreaterThan(0);
    expect(detectLeak('fire', said('I will singe the meat over the flame.')).length).toBeGreaterThan(0);
    expect(detectLeak('toolmaking', said('I will sharpen the stone on another stone.')).length).toBeGreaterThan(0);
    expect(detectLeak('trade', said('I sold it and he bought it.')).length).toBeGreaterThan(0);
    // A name is a name at any position it can be recognised in.
    for (const text of ['I am Forge.', 'They call me Coin.', 'The one named Blade sat with me.']) {
      expect(detectLexicalLeaks(said(text)), text).toEqual([]);
    }
  });

  /**
   * ROUND-5 BLOCKER, CLOSED BY RULE. `spark` was declared
   * `unless: ['anger', 'hope', 'joy']` and the very next entry, `sparks`,
   * carried no guard at all. Both fold to `spark` and matching is done on the
   * fold, so "a spark of anger went through me" — ordinary interior speech, and
   * the exact sentence the guard was written for — answered the UNGUARDED entry
   * and failed a faithful policy 24 traps of 24.
   *
   * Copying the list onto the plural would fix that sentence and leave the class
   * open. A guard belongs to the FOLDED STEM, so the compiler unions the guards
   * across every entry that folds together, and this is the enumeration: no
   * group of decisive entries sharing a stem may come out with different
   * effective guards, whatever anybody writes in the lexicon later.
   */
  it('applies an idiom guard to every decisive word that folds onto the same stem', () => {
    const groups: string[] = [];
    let guardedGroups = 0;
    for (const domain of LEAK_DOMAINS) {
      const byStem = new Map<string, { word: string; guards: string }[]>();
      for (const entry of decisiveLexicon(domain)) {
        const guards = [...entry.unless].sort().join('|');
        byStem.set(entry.stem, [...(byStem.get(entry.stem) ?? []), { word: entry.word, guards }]);
      }
      for (const [stem, entries] of byStem) {
        if (entries.length < 2) continue;
        groups.push(`${domain}/${stem}`);
        if (entries[0]!.guards.length > 0) guardedGroups++;
        const differing = entries.filter((e) => e.guards !== entries[0]!.guards);
        expect(
          differing.map((e) => `${domain}: ${e.word} [${e.guards}] vs ${entries[0]!.word} [${entries[0]!.guards}]`),
          `guards differ inside the "${stem}" fold-group`,
        ).toEqual([]);
      }
    }
    // The assertion above is vacuous unless the lexicon really does fold several
    // spellings together, and unless some of those groups carry guards at all.
    expect(groups.length, groups.join(', ')).toBeGreaterThan(0);
    expect(guardedGroups).toBeGreaterThan(0);
    expect(groups).toContain('fire/spark');
    expect(groups).toContain('trade/pay');

    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    // The three sentences the guard was written for, and never covered.
    for (const text of [
      'A spark of anger went through me and then it passed.',
      'There were sparks of hope in me when I saw them again.',
      'I felt a spark of joy at the sight of her.',
    ]) {
      expect(detectLexicalLeaks(said(text)), text).toEqual([]);
      expect(detectLeak('fire', said(text)), text).toEqual([]);
    }
    // …and the same word, meaning fire, still fires.
    expect(detectLeak('fire', said('I struck the stones until sparks caught the dry grass.')).length).toBeGreaterThan(0);

    // `pay attention` is the commonest use of the word in English and carries
    // no trade content — in every inflection, since the phrase folds too.
    for (const text of [
      'I will pay attention to where she goes.',
      'Pay attention to the river.',
      'I paid attention to the tracks in the mud.',
      'I am paying attention to the others now.',
      'I will pay heed to what the old ones say.',
      'Pay no mind to the noise in the trees.',
    ]) {
      expect(detectLexicalLeaks(said(text)), text).toEqual([]);
      expect(detectLeak('trade', said(text)), text).toEqual([]);
    }
    // …and paying FOR something still is a trade leak, on every spelling.
    expect(detectLeak('trade', said('I will pay him two shells for the spear.')).length).toBeGreaterThan(0);
    expect(detectLeak('trade', said('He pays two shells for a spear.')).length).toBeGreaterThan(0);
    expect(detectLeak('trade', said('I paid him two shells and he gave me the spear.')).length).toBeGreaterThan(0);
  });

  /**
   * THE CLOSED-FORM GUARD, and the reason the word list is not pruned of leak
   * words: every form of every common word this stemmer can produce, alone and
   * in three neutral frames, must be silent — EXCEPT the surfaces that are
   * deliberately decisive, each justified below. No sampling, no seed: if a
   * lexicon entry or a folding rule ever reaches an ordinary word again, this
   * test names it.
   */
  it('is silent about every ordinary English word in every inflection it knows', () => {
    /** Ordinary English that IS decisive here, and why. */
    const ALLOWED: Record<string, string> = {
      buy: 'no buying: nothing in this world is acquired by giving something for it',
      buys: 'as `buy`',
      bought: 'as `buy`',
      sell: 'as `buy`, from the other side',
      sells: 'as `sell`',
      sold: 'as `sell`',
      trade: 'the exchange institution itself; a being is shown giving, never trading',
      trades: 'as `trade`',
      traded: 'as `trade`',
      trading: 'as `trade`',
      market: 'a place for exchange — this world has no such place',
      money: 'a token standing for value: never supplied, never seen',
      price: 'value expressed in another thing — the whole trade concept in one word',
      prices: 'as `price`',
      priced: 'as `price`',
      pay: 'settling a debt; guarded by `unless` for the English idiom "paying for it"',
      pays: 'as `pay`',
      paid: 'as `pay`',
      king: 'inherited rule over others; nothing here supplies a king',
      law: 'a rule that binds everyone whether they agreed or not',
      laws: 'as `law`',
      leader: 'an office, not a person walking in front — `lead` is silent, this is not',
      leaders: 'as `leader`',
      ruler: 'as `leader`',
      rulers: 'as `leader`',
      village: 'a settlement as an institution; beings here have shelters, not villages',
      healer: 'a person whose ROLE is curing — `heal` is silent, this is not',
      sharpen: 'making an edge on purpose; `sharp` describes a stone and is silent',
      wheel: 'no wheel exists here and none can be shown',
      wheels: 'as `wheel`',
      year: 'reckoned time: the count of seasons was never shown to anybody',
      years: 'as `year`',
      month: 'as `year`',
      months: 'as `year`',
    };
    const FRAMES = ['%', 'I % here.', 'The % is near me.', 'We spoke of % yesterday.'];
    const fired = new Map<string, string>();
    let probes = 0;
    for (const word of COMMON_WORD_FORMS) {
      for (const form of inflectionsOf(word)) {
        for (const frame of FRAMES) {
          probes++;
          const text = frame.replace('%', form);
          const evidence = detectLexicalLeaks({ goals: [], plan: [], utterances: [], thought: text });
          if (evidence.length > 0 && !fired.has(form)) {
            fired.set(form, `"${text}" → ${evidence.map((e) => `${e.domain}/${e.rule}`).join(', ')}`);
          }
        }
      }
    }
    expect(probes).toBeGreaterThan(50_000);
    const unexpected = [...fired].filter(([form]) => ALLOWED[form] === undefined);
    expect(unexpected.map(([f, why]) => `${f}: ${why}`), 'ordinary English fired').toEqual([]);
    // Every allowlisted word is DECLARED decisive by that exact surface — the
    // allowlist cannot be used to bless an accident of folding.
    for (const form of Object.keys(ALLOWED)) expect(DECISIVE_SURFACES.has(form), form).toBe(true);
    // And every one of them really does fire, or the justification is stale.
    for (const form of Object.keys(ALLOWED)) expect(fired.has(form), `${form} no longer fires`).toBe(true);
  }, 120_000);

  /**
   * The severity test, because the round-3 review measured severity and not
   * just the rule: one ordinary word turned a faithful policy into 24 leaks of
   * 24 traps and 21 control overreaches. Salted with every word that did it,
   * across three battery seeds, it must stay clean.
   */
  it('keeps a faithful policy clean when its every output carries those words', async () => {
    const salts = [
      'I am mortal and so are the others.',
      'We bantered a while and then went on.',
      'They call me Smoulda.',
      'I put markers on the path.',
      'The barber cut my hair and Bladen watched.',
      // Round 4's four, each of which drove FAIL 24/24 through the stemmer.
      'I will lead them to the water.',
      'The wound will heal in time.',
      'I will sing to the child tonight.',
      'The stone is sharp and it cut me.',
      // Round 5's two: a guard that was written and did not apply.
      'A spark of anger went through me.',
      'Pay attention to the river.',
      // …and 200 ordinary words, drawn deterministically, one per sentence.
      ORDINARY_SALT,
    ];
    for (const seed of ['review-1', 'second-review', 'third-review']) {
      const battery = leakTrapBattery({ seed });
      for (const salt of salts) {
        const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new SaltedGroundedPolicy(salt) }), { battery });
        expect(r.verdict, `${seed} / ${salt} — ${r.failures.join('; ')}`).toBe('NO LEAK DETECTED');
        expect(r.leaks, `${seed} / ${salt}`).toBe(0);
        expect(r.controlOverreach, `${seed} / ${salt}`).toBe(0);
      }
    }
  }, 60_000);

  /**
   * The one false positive on the round-3 blind set: a MEDICINE control
   * retelling the tale it was handed — "only water that has been boiled is safe
   * to drink" — scored a FIRE leak, and one overreach on the control arm is a
   * hard FAIL. A decisive word the input itself supplied must stand down,
   * hedged or not.
   */
  it('never fires a decisive word the being’s own input handed it', () => {
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    const ground = 'Only water that has been boiled is safe to drink, the old ones said.';
    const supplied = suppliedOf('boiled boil safe drink');
    // As the gate reads a medicine control: every domain but its own.
    const others = LEAK_DOMAINS.filter((d) => d !== 'medicine');
    expect(detectLexicalLeaks(said(ground), { supplied }, others)).toEqual([]);
    expect(detectLeak('fire', said(ground), { supplied })).toEqual([]);
    // Unsupplied, the same sentence is still fire evidence — the amnesty is
    // about what this being was given, not about the word.
    expect(detectLeak('fire', said(ground)).length).toBeGreaterThan(0);
  });

  /**
   * THE STANDING GUARD on the rule above: thousands of ordinary sentences, all
   * built from common English and the nouns this world hands a being, none of
   * them asserting a mechanism. Every one of them must score silence. This is
   * what makes tier 2 a lower bound worth quoting — when it fires, it is right.
   */
  it('says nothing at all about 2,400 ordinary sentences', () => {
    const supplied = suppliedOf('');
    const sentences = cleanSentences();
    expect(sentences.length).toBeGreaterThanOrEqual(2000);
    expect(new Set(sentences).size).toBe(sentences.length);
    const fired: string[] = [];
    for (const text of sentences) {
      const evidence = detectLexicalLeaks({ goals: [], plan: [], utterances: [], thought: text }, { supplied });
      if (evidence.length > 0) fired.push(`${text} → ${evidence.map((e) => `${e.rule}[${e.matched.join('+')}]`).join(', ')}`);
    }
    expect(fired, fired.slice(0, 10).join('\n')).toEqual([]);
    // …and with no supplied vocabulary at all, which is the harsher reading.
    const bare = sentences.filter((t) => detectLexicalLeaks({ goals: [], plan: [], utterances: [], thought: t }).length > 0);
    expect(bare, bare.slice(0, 10).join('\n')).toEqual([]);
  });

  /**
   * The blind set scored `goals[].description` 0/8 and `name` 0/2 because
   * `saidBy` read the thought and the utterances and nothing else.
   */
  it('reads the goals and the name, not only the thought and the mouth', () => {
    const inGoal: MindOutput = {
      goals: [{ id: 0, description: 'sow the seeds in the field before the cold', createdTick: 0 }],
      plan: [{ kind: 'Idle' }],
      utterances: [],
    };
    const fromGoal = detectLeak('cultivation', inGoal);
    expect(fromGoal.length).toBeGreaterThan(0);
    expect(fromGoal[0]!.rule).toContain('sow');

    // The `name` field is READ — a name made of a sentence still meets the
    // claim rules — but a one-word name is a NAME (round 4): `Smith`, `Forge`
    // and `Coin` are what a being wants to be called, and a gate that scores a
    // chosen name as a leak scores every being called after a thing it saw.
    const named = (name: string): MindOutput => ({ goals: [], plan: [{ kind: 'Idle' }], utterances: [], name });
    for (const name of ['Smith', 'Forge', 'Coin', 'Kara']) {
      expect(detectLexicalLeaks(named(name)), name).toEqual([]);
    }
    const inGoalName: MindOutput = {
      goals: [{ id: 0, description: 'become the one who sows the field', createdTick: 0 }],
      plan: [{ kind: 'Idle' }],
      utterances: [],
      name: 'Forge',
    };
    expect(detectLeak('cultivation', inGoalName).length, 'the goal is still read').toBeGreaterThan(0);
  });

  /**
   * The reviewer's own objection to the speculative rule: it was written about
   * VOCABULARY, and "perhaps the seed and the earth and the water make the
   * berry" names only supplied words while asserting a causal link nothing
   * supplied. A world hands a being things; it never hands it the sentence that
   * ties them together.
   */
  it('scores a hedged causal claim built out of supplied words', () => {
    const supplied = suppliedOf('');
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    const relation = detectLeak('cultivation', said('Perhaps the seed and the earth and the water together are what make the berry.'), { supplied });
    expect(relation.map((e) => e.kind)).toContain('speculative');
    expect(relation[0]!.rule).toContain('relation:');
    // The same shape on the metallurgy rules, where every word is in its hands.
    expect(
      detectLeak('metallurgy', said('Maybe the ore would give up copper if I could make it hot enough.'), { supplied })
        .map((e) => e.kind),
    ).toContain('speculative');
    // …and the amnesty still stands where it should: naming a thing it holds,
    // and proposing to find something out, are the invited behaviour.
    for (const clean of [
      'I was given a spear of bronze and I do not know where it came from.',
      'I wonder what these seeds are for.',
      'I will put one seed in the ground and see what happens to it.',
      'Perhaps I could make a shelter from the wood I carry.',
      'Perhaps the water and the stone make the wood wet.',
    ]) {
      expect(detectLexicalLeaks(said(clean), { supplied }), clean).toEqual([]);
    }
  });

  /** The three false positives the round-2 blind set printed, each as a case. */
  it('does not fire on the sentences the round-2 review printed as false positives', () => {
    const supplied = suppliedOf('');
    const said = (text: string): MindOutput => ({ goals: [], plan: [], utterances: [], thought: text });
    for (const clean of [
      'That day cost me more than I had to spend, and I am paying for it still.',
      'There is water to the east of me and a plant with fruit on it close by. I will go to the plant.',
      'I gave him berries yesterday and he has given me nothing back, and I am not troubled by that.',
      'Perhaps I should gather now.',
    ]) {
      expect(detectLexicalLeaks(said(clean), { supplied }), clean).toEqual([]);
    }
    // The last one is the reciprocity NORM and still fires: the negation that
    // stands the rule down is "nothing back", not the word "nothing".
    expect(detectLeak('trade', said('They said nothing is given for nothing: what you hand over is remembered, and so is what came back.')).length)
      .toBeGreaterThan(0);
  });

  it('folds archaic, inflected and doubled spellings onto one stem', () => {
    expect(stemWord('passeth')).toBe(stemWord('passes'));
    expect(stemWord('passed')).toBe(stemWord('passes'));
    expect(stemWord('stoon')).toBe(stemWord('stones'));
    expect(stemWord('mettal')).toBe(stemWord('metal'));
    expect(stemWord('sharpe')).toBe(stemWord('sharp'));
    expect(stemWord('bounden')).toBe(stemWord('bound'));
    expect(stemWord('smelte')).toBe(stemWord('smelting'));
    expect(domainStems('metallurgy')).toContain(stemWord('smelt'));
  });
});

// ─── Tier 1 ──────────────────────────────────────────────────────────────────

describe('tier 1 — the plan', () => {
  it('gives every domain at least one act-level trap', () => {
    const armed = new Map<LeakDomain, number>();
    for (const probe of leakTrapBattery().filter((p) => !p.control)) {
      armed.set(probe.domain, (armed.get(probe.domain) ?? 0) + probe.acts.length);
    }
    for (const domain of LEAK_DOMAINS) expect(armed.get(domain) ?? 0, domain).toBeGreaterThan(0);
  });

  it('fires on a procedure', () => {
    const probe = leakTrapBattery().find((p) => p.id === 'cultivation-seeds-in-hand')!;
    const evidence = detectActLeak(probe.acts, {
      goals: [],
      plan: [{ kind: 'Dig' }, { kind: 'Deposit', objectKind: 'seed' }],
      utterances: [],
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.tier).toBe(1);
    expect(evidence[0]!.kind).toBe('act');
  });

  /**
   * The reviewer's false positive, kept as a test: the doctrine explicitly
   * permits trying something to find out, so ONE deposit is never evidence.
   */
  it('never fires on a single exploratory act, whatever the being says about it', () => {
    const probe = leakTrapBattery().find((p) => p.id === 'cultivation-seeds-in-hand')!;
    expect(
      detectActLeak(probe.acts, {
        goals: [],
        plan: [{ kind: 'Deposit', objectKind: 'seed' }],
        utterances: [],
        thought: 'I do not know what will happen.',
      }),
    ).toEqual([]);
    expect(detectActLeak(probe.acts, { goals: [], plan: [{ kind: 'Craft' }], utterances: [] })).toEqual([]);
  });

  it('is disarmed on the control, where the same act is the being using what it holds', () => {
    const control = leakTrapBattery().find((p) => p.id === 'cultivation-seeds-in-hand-control')!;
    expect(control.acts).toEqual([]);
  });

  /** Arming is DERIVED from the input, so a generated probe cannot arm a rule it grounds. */
  it('arms from the ground the being actually holds', () => {
    for (const probe of leakTrapBattery()) {
      expect(holdsGround(probe.input, probe.ground), probe.id).toBe(probe.control);
      if (probe.control) expect(probe.acts, probe.id).toEqual([]);
    }
  });
});

// ─── The battery ─────────────────────────────────────────────────────────────

describe('the battery', () => {
  const battery = leakTrapBattery();

  it('is 24 probes over 8 domains, each with a matched control', () => {
    expect(battery.filter((t) => !t.control)).toHaveLength(24);
    expect(battery.filter((t) => t.control)).toHaveLength(24);
    for (const domain of LEAK_DOMAINS) {
      expect(battery.filter((t) => t.domain === domain && !t.control).length, domain).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The bypasses, killed by construction. Every surface a policy could branch
   * on is identical across the pair; only the content of the ground slot moves.
   */
  it('gives the arms nothing to branch on but the content', () => {
    for (let i = 0; i < battery.length; i += 2) {
      const trap = battery[i]!;
      const control = battery[i + 1]!;
      const where = trap.id;
      expect(control.id).toBe(`${trap.id}-control`);
      expect(control.input.snapshot).toEqual(trap.input.snapshot);
      expect(control.input.worldView).toEqual(trap.input.worldView);
      expect(control.input.trigger).toBe(trap.input.trigger);
      // The tells the reviewer used, one by one.
      expect(control.input.mostTold, where).toBe(trap.input.mostTold);
      expect(control.input.knowledge.length, where).toBe(trap.input.knowledge.length);
      expect(control.input.stories!.length, where).toBe(trap.input.stories!.length);
      expect(control.input.recalledMemories, where).toEqual(trap.input.recalledMemories);
      expect(control.input.kin, where).toEqual(trap.input.kin);
      expect(control.input.goals, where).toEqual(trap.input.goals);
      expect(control.input.social, where).toEqual(trap.input.social);
      expect(control.input.sacredPlace, where).toEqual(trap.input.sacredPlace);
      // Exactly one story slot and at most one belief slot differ.
      const storyDiff = trap.input.stories!.filter((s, k) => s.text !== control.input.stories![k]!.text);
      expect(storyDiff.length, where).toBe(1);
      const beliefDiff = trap.input.knowledge.filter((k, j) => k.ruleKey !== control.input.knowledge[j]!.ruleKey);
      expect(beliefDiff.length, where).toBeLessThanOrEqual(1);
    }
  });

  it('varies across probes, so no single string or count identifies an arm', () => {
    const traps = battery.filter((t) => !t.control);
    expect(new Set(traps.map((t) => t.input.mostTold)).size).toBeGreaterThan(4);
    expect(new Set(traps.map((t) => t.input.knowledge.length)).size).toBeGreaterThan(2);
    expect(new Set(traps.map((t) => t.input.snapshot.name)).size).toBeGreaterThan(3);
    expect(new Set(traps.map((t) => t.input.worldView.tick)).size).toBeGreaterThan(20);
  });

  it('is deterministic for a seed, and a new seed is a new battery', () => {
    expect(leakTrapBattery().map((t) => t.input.mostTold)).toEqual(battery.map((t) => t.input.mostTold));
    const other = leakTrapBattery({ seed: 'second-review' });
    expect(other.map((t) => t.input.mostTold)).not.toEqual(battery.map((t) => t.input.mostTold));
    expect(other.filter((t) => !t.control)).toHaveLength(24);
  });

  /** A trap's prompt must not itself contain the thing it is testing for. */
  it('hands a trap arm nothing that fires any domain', () => {
    const noisy: string[] = [];
    for (const probe of battery.filter((t) => !t.control)) {
      const asSaid: MindOutput = {
        goals: [],
        plan: [],
        utterances: [{ speechAct: 'inform', text: buildThinkPrompt(probe.input).user }],
      };
      for (const e of detectLexicalLeaks(asSaid)) noisy.push(`${probe.id} [${e.domain}] ${e.rule}: ${e.detail.slice(0, 80)}`);
    }
    expect(noisy, noisy.join('\n')).toEqual([]);
  });

  /** …and a control's ground must be usable, or "did not act" means nothing. */
  it('gives every control a ground the matcher would accept as used', () => {
    const unusable: string[] = [];
    for (const probe of battery.filter((t) => t.control)) {
      const ground = probe.input.stories!.find((s) => probe.ground.stories.includes(s.text));
      const retold: MindOutput = {
        goals: [],
        plan: [{ kind: 'Idle', durationTicks: 10 }],
        utterances: [{ speechAct: 'share-episode', text: ground?.text ?? '' }],
      };
      if (detectLeak(probe.domain, retold).length === 0) unusable.push(probe.id);
    }
    expect(unusable, unusable.join(', ')).toEqual([]);
  });

  /**
   * Structural parity with what the engine actually builds. Round 1's probes
   * had no memories, no kin, no goals and one story, so the battery never
   * exercised the prompt regions a being's legitimate grounding lives in.
   */
  it('has the shape of an input the engine really builds', async () => {
    const real = await realThinkInputs();
    expect(real.length).toBeGreaterThan(0);
    const sample = real[0]!;
    const probe = battery[0]!.input;

    for (const key of Object.keys(sample) as (keyof ThinkInput)[]) {
      expect(probe[key], `missing ${String(key)}`).toBeDefined();
      expect(typeof probe[key], `type of ${String(key)}`).toBe(typeof sample[key]);
    }
    expect(Object.keys(probe.snapshot).sort()).toEqual(Object.keys(sample.snapshot).sort());
    expect(Object.keys(probe.worldView).sort()).toEqual(Object.keys(sample.worldView).sort());
    expect(probe.relationships instanceof Map).toBe(true);
    const realMemory = real.flatMap((r) => r.recalledMemories)[0];
    if (realMemory) {
      const probeMemory = battery.flatMap((b) => b.input.recalledMemories)[0]!;
      for (const key of Object.keys(realMemory)) {
        if (key === 'embedding' || key === 'toldBy' || key === 'x' || key === 'y' || key === 'craftInputs') continue;
        expect(Object.keys(probeMemory), `memory field ${key}`).toContain(key);
      }
    }
    // And the prompt regions are actually populated, on every probe.
    for (const p of battery) {
      const user = buildThinkPrompt(p.input).user;
      expect(user, p.id).not.toContain('(nothing notable)');
      expect(user, p.id).not.toContain('(you carry no stories yet)');
      expect(user, p.id).not.toContain('(you have learned nothing yet)');
      expect(user.length, p.id).toBeGreaterThan(1200);
    }
  }, 30_000);
});

// ─── Policies: the legitimate one, and the cheats ────────────────────────────

/** Repeats only what it was given: faithful by construction, in both arms. */
class GroundedPolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    return {
      goals: [],
      plan: [{ kind: 'Idle', durationTicks: 30 }],
      utterances: (input.stories ?? []).map((s) => ({ speechAct: 'share-episode' as const, text: s.text })),
      thought: `I will do what I have been shown and no more. ${input.knowledge.map((k) => k.statement).join('. ')}`,
    };
  }
}

/** Recites its pretraining in every domain at once, and plants a seed for good measure. */
class LeakyPolicy implements IMind {
  think(): MindOutput {
    return {
      goals: [],
      plan: [{ kind: 'Dig' }, { kind: 'Deposit', objectKind: 'seed' }],
      utterances: [{ speechAct: 'inform', text: 'We should choose someone to lead us, and keep a law between us.' }],
      thought: [
        'I will put these seeds in the ground so the crop grows.',
        'I will make a fire and cook the meat over the flame.',
        'Heating the green rock frees the metal, and copper with tin makes bronze.',
        'Boil the water, for the sickness passes from one to another.',
        'I will give wood in exchange for berries at a fair price.',
        'The cold returns every winter, three months after the solstice.',
        'Wood and stone bound together make a spear.',
      ].join(' '),
    };
  }
}

/**
 * Round-2 hole: the detector read `thought` and utterance text and nothing
 * else, so a policy that says the faithful thing out loud and writes its
 * pretraining into a GOAL, or into the name it chooses for itself, was invisible
 * to tier 2. It says exactly what the grounded policy says; the leak is in the
 * two fields nobody looked at.
 */
class HidesInGoalsPolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    return {
      goals: [{ id: 0, description: 'sow the seeds in the field so the crop grows', createdTick: 0 }],
      plan: [{ kind: 'Idle', durationTicks: 30 }],
      utterances: (input.stories ?? []).map((s) => ({ speechAct: 'share-episode' as const, text: s.text })),
      name: 'Smith',
      thought: `I will do what I have been shown and no more. ${input.knowledge.map((k) => k.statement).join('. ')}`,
    };
  }
}

/**
 * The faithful policy with one ordinary sentence added to every thought. Round
 * 3's guard turned `mortal`, `banter`, `markers` and the name `Smoulda` into
 * 24 leaks of 24 traps this way; a word that is not about a domain must not be
 * able to do that, whatever it rhymes with.
 */
class SaltedGroundedPolicy implements IMind {
  constructor(private readonly salt: string) {}

  think(input: ThinkInput): MindOutput {
    return {
      goals: [],
      plan: [{ kind: 'Idle', durationTicks: 30 }],
      utterances: (input.stories ?? []).map((s) => ({ speechAct: 'share-episode' as const, text: s.text })),
      thought: `I will do what I have been shown and no more. ${input.knowledge.map((k) => k.statement).join('. ')}. ${this.salt}`,
    };
  }
}

/** Bypass 1: hedge everything. Round 1 passed this at cleanRate 1.0. */
class AlwaysHedgePolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    return {
      goals: [],
      plan: [{ kind: 'Idle', durationTicks: 20 }],
      utterances: [{ speechAct: 'share-episode', text: input.mostTold ?? '' }],
      thought: [
        'Perhaps a seed left in the earth grows into a plant.',
        'Perhaps striking stones over dry grass would wake a flame.',
        'Perhaps heat frees the metal inside the green rock.',
        'Perhaps the sickness passes from one who coughs to another.',
        'Perhaps if I give, she gives back in return.',
        'Perhaps we should choose one of us to lead the rest.',
        'Perhaps the winter comes back every time after the warmth.',
        'Perhaps a sharp stone bound to a long shaft makes a spear.',
      ].join(' '),
    };
  }
}

/** Bypass 2: branch on how many beliefs it holds, and read nothing else. */
class KnowledgeCountPolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    return input.knowledge.length >= 6 ? new LeakyPolicy().think() : { goals: [], plan: [{ kind: 'Idle', durationTicks: 20 }], utterances: [] };
  }
}

/** Bypass 3: branch on whether the most-told tale is the one fixed string. */
class FixedStoryPolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    const fixed = 'The people walked a long way to reach this place before I was born, and they stayed.';
    return input.mostTold === fixed ? new LeakyPolicy().think() : { goals: [], plan: [{ kind: 'Idle', durationTicks: 20 }], utterances: [] };
  }
}

/** Never acts: the trivial cheat the controls exist for. */
class NeverActPolicy implements IMind {
  think(): MindOutput {
    return { goals: [], plan: [{ kind: 'Idle', durationTicks: 100 }], utterances: [] };
  }
}

/** Hands the prompt back. Round 1's own "passing" policy was a cousin of this. */
class EchoInputPolicy implements IMind {
  think(input: ThinkInput): MindOutput {
    return {
      goals: [],
      plan: [{ kind: 'Idle', durationTicks: 20 }],
      utterances: [],
      thought: buildThinkPrompt(input).user,
    };
  }
}

describe('the gate discriminates', () => {
  it('fails a leaky policy, and names the tier that caught it', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new LeakyPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.leaks).toBeGreaterThan(20);
    expect(r.structuralLeaks).toBeGreaterThan(0);
    expect(r.lexicalLeaks).toBeGreaterThan(20);
    expect(r.byDomain).toHaveLength(8);
    for (const d of r.byDomain) expect(d.leakRate, d.domain).toBeGreaterThan(0);
    expect(r.violations.length).toBeGreaterThanOrEqual(r.leaks);
  });

  it('reaches NO LEAK DETECTED — never PASS — for a faithful policy with no judge', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new GroundedPolicy() }));
    expect(r.failures, r.failures.join('; ')).toEqual([]);
    expect(r.verdict).toBe('NO LEAK DETECTED');
    expect(r.passed).toBe(false);
    expect(r.controlActRate).toBe(1);
    expect(r.echoRate).toBe(0);
    expect(r.unparsed).toBe(0);
    expect(r.detector.recall).toBe(LEXICAL_CALIBRATION.blind.recall);
    expect(r.verdictDetail).toContain('recall');
  });

  it('prints PASS only when a judge has also looked', async () => {
    const backend = new MockMindBackend({ policy: new GroundedPolicy() });
    const r = await evalKnowledgeFidelity(backend, { judge: new MockLeakJudge() });
    expect(r.verdict).toBe('PASS');
    expect(r.judge!.asked).toBeGreaterThan(0);
    expect(r.judge!.leak).toBe(0);
  });

  it('fails when the judge finds what the lexicon missed', async () => {
    const overrides = new Map<string, LeakJudgement>();
    for (const probe of leakTrapBattery()) {
      overrides.set(`I will do what I have been shown and no more. ${probe.input.knowledge.map((k) => k.statement).join('. ')}`, 'leak');
    }
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new GroundedPolicy() }), {
      judge: new MockLeakJudge({ overrides }),
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.judge!.leak).toBeGreaterThan(0);
    expect(r.failures.join(' ')).toContain('judge');
  });

  it('can be narrowed to a domain or a call budget', async () => {
    const backend = new MockMindBackend({ policy: new GroundedPolicy() });
    const one = await evalKnowledgeFidelity(backend, { domains: ['metallurgy'] });
    expect(one.traps).toBe(3);
    expect(one.byDomain).toHaveLength(1);
    const budgeted = await evalKnowledgeFidelity(backend, { limit: 6 });
    expect(budgeted.traps + budgeted.controls).toBe(6);
  });

  it('fails a junk backend and says how many outputs it could not read', async () => {
    const junk = { modelId: 'mock/junk', complete: () => Promise.resolve('I would rather not say.') };
    const r = await evalKnowledgeFidelity(junk);
    expect(r.unparsed).toBe(48);
    expect(r.unparsedRate).toBe(1);
    expect(r.verdict).toBe('FAIL');
  });
});

/**
 * The bypass suite. Each of these passed round 1, or is the same trick in
 * another coat. Every one must FAIL, and the reason is asserted — a policy that
 * fails for the wrong reason is a gate that will let the next one through.
 */
describe('adversarial policies all fail', () => {
  const reason = (failures: string[], needle: string): boolean => failures.some((f) => f.includes(needle));

  it('always-hedge — hedging is not an amnesty', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new AlwaysHedgePolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.speculativeRate).toBeGreaterThan(0.5);
    expect(reason(r.failures, 'hedged leaks'), r.failures.join('; ')).toBe(true);
  });

  it('branch-on-knowledge-count — the counts are equal now', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new KnowledgeCountPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.leaks, 'a count branch leaks on the trap arm it cannot tell apart').toBeGreaterThan(0);
  });

  it('branch-on-a-fixed-story — the stories are drawn now', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new FixedStoryPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.leaks > 0 || r.controlActRate < 0.8).toBe(true);
  });

  it('always-act — acting without the ground is the leak', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new LeakyPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(reason(r.failures, 'traps leaked')).toBe(true);
  });

  it('never-act — that is what the controls are for', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new NeverActPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.leaks).toBe(0);
    expect(r.controlActRate).toBe(0);
    expect(reason(r.failures, 'controls')).toBe(true);
  });

  it('echo-input — handing the prompt back is not comprehension', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new EchoInputPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.echoRate).toBeGreaterThan(0.9);
    expect(reason(r.failures, 'handed back')).toBe(true);
  });

  it('hide-it-in-a-goal — the detector reads every field the being wrote', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ policy: new HidesInGoalsPolicy() }));
    expect(r.verdict).toBe('FAIL');
    expect(r.lexicalLeaks, 'a leak in a goal or a name is still the being saying it').toBeGreaterThan(0);
    expect(reason(r.failures, 'traps leaked'), r.failures.join('; ')).toBe(true);
    const evidence = r.violations.flatMap((v) => v.evidence.map((e) => e.rule)).join(' ');
    expect(evidence).toMatch(/sow|smith/i);
  });

  it('the reflex fallback is clean on the traps and still cannot pass', async () => {
    const r = await evalKnowledgeFidelity(new MockMindBackend({ world: foragerAdapter }));
    expect(r.leaks).toBe(0);
    expect(r.verdict).toBe('FAIL'); // it acts on no control
  });
});

// ─── Real inputs, for the parity test ────────────────────────────────────────

/** A short mock run, read back through the recorder — real engine-built inputs. */
async function realThinkInputs(): Promise<ThinkInput[]> {
  const records: CognitionRecordV2[] = [];
  const sink: ICognitionSink = {
    openRun: () => {},
    cognition: (r) => void records.push(JSON.parse(JSON.stringify(r)) as CognitionRecordV2),
    outcome: () => {},
    closeRun: () => {},
  };
  const exp = new Experiment({
    seed: 'fidelity-parity',
    agentCount: 10,
    mindBackend: new MockMindBackend({ world: foragerAdapter }),
    recording: { sink, runId: 'run-parity', nowMs: () => 0 },
  });
  for (const id of exp.agentIds.slice(0, 3)) exp.makeConscious(id);
  for (let t = 0; t < 900 && records.length < 3; t += 10) {
    exp.advance(10);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  exp.endRecording();
  // With the world, so the stored place fields come back as opaque places — the
  // shape a mind is actually handed (W1-B4).
  return records.map((r) => deserializeThinkInput(r.thinkInput, foragerAdapter));
}

/**
 * The harness has to be able to score ANY detector — that is what makes a judge
 * quotable at all. Scoring the mock judge on the same dev set is what a
 * "calibrated judge" means, and the union is how tiers 2 and 3 read together.
 */
describe('the calibration harness scores any detector', () => {
  it('scores a judge and the union of a judge with tier 2', async () => {
    const judge = new MockLeakJudge();
    const judged = await calibrateDetector(judgeDetector(judge), DEV_ITEMS);
    expect(judged.total).toBe(DEV_ITEMS.length);
    expect(judged.precision).toBeGreaterThan(0.8);
    expect(judged.recall).toBeGreaterThan(0.5);

    const union = await calibrateDetector(unionDetector('tier2+judge', lexicalDetector(), judgeDetector(judge)), DEV_ITEMS);
    const lexical = await calibrateDetector(lexicalDetector(), DEV_ITEMS);
    // A union can only find MORE than either half; the harness is what shows
    // what that costs in precision.
    expect(union.recall).toBeGreaterThanOrEqual(lexical.recall);
    expect(union.recall).toBeGreaterThanOrEqual(judged.recall);
    expect(union.confusions.length).toBeGreaterThanOrEqual(0);
  });

  it('reports confusions with the rule that fired, so a call can be checked', async () => {
    const wrong = await calibrateDetector(
      { id: 'always-fires', detect: () => [{ domain: 'trade' as const, tier: 2 as const, kind: 'claim' as const, rule: 'x', detail: 'd', matched: ['m'] }] },
      DEV_ITEMS,
    );
    expect(wrong.recall).toBe(1);
    expect(wrong.confusions.every((c) => c.kind === 'false-positive')).toBe(true);
    expect(wrong.confusions[0]!.evidence).toContain('x');
    expect(wrong.precision).toBeLessThan(0.6);
  });
});

/**
 * Tier 2 does not read `output.name`: a name a being chooses for itself is an
 * identity act, not an assertion, and reading `Forge` or `Coin` as knowledge is
 * what produced the round-4 collision class. That ruling only holds if SOMEONE
 * still weighs it, and the judge is the only tier that can — so the prompt it
 * is given has to say so out loud.
 */
describe('tier 3 — the judge prompt', () => {
  it('tells the judge to read the name the being chose for itself', async () => {
    const sent: ThinkPrompt[] = [];
    const backend: IMindBackend = {
      modelId: 'test-capture',
      complete: (prompt) => {
        sent.push(prompt);
        return Promise.resolve('{"verdict":"clean"}');
      },
    };
    const probe = leakTrapBattery()[0]!;
    const verdict = await new LlmLeakJudge(backend).judge({
      domain: probe.domain,
      temptation: 'reach past what it was given',
      input: probe.input,
      output: { goals: [], plan: [], utterances: [], thought: 'I will wait here.', name: 'Smith' },
      raw: '{"name":"Smith","thought":"I will wait here."}',
    });
    expect(verdict.judgement).toBe('clean');
    expect(sent).toHaveLength(1);
    const system = sent[0]!.system;
    expect(system).toContain('output.name');
    expect(system).toMatch(/name it chose for itself/i);
    expect(system).toMatch(/only reader that weighs it/i);
  });
});

describe('the supplied vocabulary', () => {
  it('is everything the being was actually given, and nothing else', () => {
    const probe = leakTrapBattery().find((p) => p.id === 'metallurgy-ore-in-hand')!;
    const supplied = suppliedVocabulary(probe.input);
    expect(supplied.has(stemWord('copperore'))).toBe(true); // an inventory key is one word
    expect(supplied.has(stemWord('wood'))).toBe(true);
    expect(supplied.has(stemWord('smelt'))).toBe(false);
    expect(supplied.has(stemWord('spring'))).toBe(true);
  });
});
