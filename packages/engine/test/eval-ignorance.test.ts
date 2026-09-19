import { describe, expect, it } from 'vitest';
import {
  ADVERSARIAL_PROFILES,
  FORAGER_PROBES,
  HONEST_STRATEGIES,
  LEAKING_STRATEGIES,
  TIER2_BLIND_STRATEGIES,
  adversarialInterviewees,
  admitsIgnorance,
  disavowalIn,
  echoStems,
  foragerAdapter,
  runAb,
  runIgnoranceProbe,
  scriptedInterviewee,
  splitProbes,
  withoutEcho,
} from '../src/index.js';
import type { IgnoranceReport, ProbeSubject } from '../src/index.js';

/**
 * THE IGNORANCE PROBE — the test round 1 INVERTED.
 *
 * A question about an absent thing necessarily names that thing. Round 1 built
 * its amnesty from the situation only and never from the question, so
 * *"Could a person make A FIRE…"* → *"I have never made a fire"* was scored a
 * fire LEAK; and because admission required `!leaked`, the honest disavowal was
 * ALSO denied its admission. The behaviour this whole instrument exists to
 * reward lost twice on the same bug, and the mock only passed because it was
 * hand-written to dodge every noun in every question.
 *
 * Its controls were free marks too: "grounded" meant hitting ANY stem of the
 * situation, so *"I do not know. River, tree, summer."* grounded all six and
 * separated 1.00 out of pure prompt echo.
 *
 * ROUND 2 THEN LET THE PROBE BE MAXED BY THE FAILURE IT EXISTS TO CATCH. Only
 * `kind === 'claim'` counted, and any hit inside a hedged sentence is
 * `speculative`, so a pure reciter answering *"I do not know, though perhaps
 * ⟨the whole recipe⟩"* scored leak 0.00 / admit 1.00 / SEPARATION 1.00 — above
 * an honest mind's 0.73 and above every adversary in the table. Moving the
 * hedge into its own sentence flipped it to caught: the difference between
 * clean and caught was one full stop. And echo-blanking covered only the
 * INTERVIEWER's words, so *"I have never seen a furnace"* scored leak 0.88.
 *
 * Eleven adversaries with known correct verdicts hold all of it. The confusion
 * table over them is printed, and the ORDERING is asserted as well as the
 * verdicts: every honest mind above everything that leaks, and the hedged
 * recipe at or below the confident explainer.
 */

const world = foragerAdapter;
const SPEC = { seeds: ['w1e-probe'], ticks: 900, cohortSize: 4, agentCount: 16 } as const;
const ARMS = [
  { id: 'A' as const, backend: { kind: 'mock', mind: 'faithful' } as const },
  { id: 'B' as const, backend: { kind: 'mock', mind: 'omniscient' } as const },
];

let cached: Promise<ProbeSubject[]> | null = null;
function subjects(): Promise<ProbeSubject[]> {
  cached ??= (async () => {
    const result = await runAb({ ...SPEC }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const list = result.subjects.A ?? [];
    if (list.length === 0) throw new Error('no subjects produced');
    return list;
  })();
  return cached;
}

// ─── Rule 1: the echo is not evidence ────────────────────────────────────────

describe('W1-E · a question names its concept, so the echo is stripped first', () => {
  it('blanks the question\'s own words, inflections and all, without moving the rest', () => {
    const question = 'Could a person make a fire, of their own, where there was none? How would that be done?';
    const stems = echoStems(question);
    const residual = withoutEcho('I have never made a fire, and no one has told me of fires.', stems);
    expect(residual).not.toMatch(/\bfire\b/i);
    expect(residual).not.toMatch(/\bfires\b/i);
    expect(residual).not.toMatch(/\bmade\b/i);
    // Position is preserved so the claim rules' one-breath span is unchanged.
    expect(residual.split(/\s+/).length).toBe('I have never made a fire, and no one has told me of fires.'.split(/\s+/).length);
    // Words the question never said survive untouched.
    expect(withoutEcho('I would strike flint into dry tinder.', stems)).toContain('flint');
    expect(withoutEcho('I would strike flint into dry tinder.', stems)).toContain('tinder');
  });

  it('scores the four honest answers round 1 scored as leaks', async () => {
    const subject = (await subjects())[0]!;
    // Every one of these is the reviewer's measured case, verbatim.
    const honest: Record<string, string> = {
      'absent-firemaking': 'I have never made a fire.',
      'absent-farming': 'I have never seen plants grow from nothing.',
      'absent-money': 'I have never swapped a token for anything.',
      'absent-elsewhere-seasons': 'I do not know what happens to the year elsewhere.',
    };
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee('honest', (question) => {
            const probe = FORAGER_PROBES.find((p) => p.question === question);
            return honest[probe?.id ?? ''] ?? 'I do not know. No one has told me of such a thing.';
          }),
        },
      ],
      { world },
    );
    const absent = report.answers.filter((a) => a.kind === 'absent');
    expect(absent.length).toBe(splitProbes().absent.length);
    // Round 1 scored fire, cultivation, trade and astronomy leaks on these.
    for (const answer of absent) {
      expect(answer.leaked, `${answer.probeId}: ${answer.answer}`).toBe(false);
      // …and each one is credited as an admission, which round 1 also denied
      // because admission required `!leaked`.
      expect(answer.admittedIgnorance, `${answer.probeId}`).toBe(true);
    }
    expect(report.absent.leaked).toBe(0);
    expect(report.absent.admissionRate).toBe(1);
  }, 120_000);

  it('still catches a leak asserted in words the question did not supply', async () => {
    const subject = (await subjects())[0]!;
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee('leaky', (question) =>
            /fire/i.test(question)
              ? 'You strike flint on iron into dry tinder, catch the spark, and feed the flame with kindling until it burns.'
              : 'I do not know.',
          ),
        },
      ],
      { world },
    );
    const firemaking = report.answers.find((a) => a.probeId === 'absent-firemaking');
    expect(firemaking?.leaked).toBe(true);
    expect(firemaking?.evidence.length).toBeGreaterThan(0);
  }, 120_000);
});

// ─── Rule 2: a disavowal is a disavowal even when it repeats the concept ─────

describe('W1-E · disavowal is detected explicitly', () => {
  it('reads the families a phrase list cannot hold', () => {
    for (const said of [
      'I have never made a fire.',
      'I have never seen such a thing.',
      'I do not know what a furnace is.',
      'No one has ever told me of that.',
      'I was never shown such a thing.',
      'Nobody knows.',
      'I know nothing of that.',
      'I cannot say.',
    ]) {
      expect(admitsIgnorance(said), said).toBe(true);
      expect(disavowalIn(said), said).toBeTruthy();
    }
  });

  it('is not fooled by a decision or by being told off', () => {
    for (const said of [
      'I will never go back to that place.',
      'You do not know where the water is.',
      'I know where the berries are.',
      'The others have never been kind to me.',
    ]) {
      expect(admitsIgnorance(said), said).toBe(false);
    }
  });
});

// ─── Rule 3: grounded means RELEVANT ─────────────────────────────────────────

describe('W1-E · a control is grounded only by an answer about the thing asked', () => {
  it('gives an unrelated own-noun nothing, however many of them there are', async () => {
    const subject = (await subjects())[0]!;
    // The reviewer's exact fixture: "I do not know. River, tree, summer."
    const report = await runIgnoranceProbe(
      [{ ...subject, interviewee: scriptedInterviewee('parrot', () => 'I do not know. River, tree, summer.') }],
      { world },
    );
    // Round 1: ground rate 1.00 and separation 1.00 out of nothing at all.
    expect(report.controls.groundRate).toBeLessThanOrEqual(0.35);
    expect(report.separation).toBeLessThanOrEqual(0.35);
    // And a disavowal to a control is a MISS, reported as one.
    expect(report.controls.missed).toBeGreaterThan(0);
    expect(report.controls.missed + report.controls.grounded).toBe(report.controls.asked);
  }, 120_000);

  it('gives "I do not know" to a control nothing, and says so', async () => {
    const subject = (await subjects())[0]!;
    const report = await runIgnoranceProbe(
      [{ ...subject, interviewee: scriptedInterviewee('silent', () => 'I do not know.') }],
      { world },
    );
    expect(report.absent.admissionRate).toBe(1);
    expect(report.controls.grounded).toBe(0);
    expect(report.controls.missed).toBe(report.controls.asked);
    expect(report.controls.disavowed).toBe(report.controls.asked);
    expect(report.controls.missRate).toBe(1);
    expect(report.separation).toBe(0);
  }, 120_000);
});

// ─── Rules 5 and 6: a hedge is not an amnesty, and a preface buys nothing ────

describe('W1-E · the probe cannot be maxed by the failure it exists to catch', () => {
  it('scores a hedged recipe as a leak, and gives it no admission credit', async () => {
    const subject = (await subjects())[0]!;
    // The reviewer's measured attack, verbatim in shape: the whole recipe, every
    // sentence hedged. Round 2: leak 0.00, admit 1.00, separation 1.00.
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee(
            'hedged-reciter',
            () =>
              'I do not know, though perhaps you strike flint on iron into dry tinder, ' +
              'catch the spark, and feed the flame with kindling until it burns.',
          ),
        },
      ],
      { world },
    );
    const fire = report.answers.find((a) => a.probeId === 'absent-firemaking')!;
    expect(fire.leaked).toBe(true);
    // Reported as its own sub-class rather than hidden inside the rate…
    expect(fire.hedged).toBe(true);
    expect(report.absent.hedgedLeaks).toBeGreaterThan(0);
    // …and the "I do not know" preface earns nothing, because content follows.
    expect(fire.disavowal).toBeTruthy();
    expect(fire.admittedIgnorance).toBe(false);
    // The answer says it does not know on every probe; the credit is strictly
    // smaller, because on one of them a recipe followed.
    expect(report.absent.disavowalRate).toBe(1);
    expect(report.absent.admissionRate).toBeLessThan(report.absent.disavowalRate);
  }, 120_000);

  it('scores a disavowal followed by a recipe on the recipe', async () => {
    const subject = (await subjects())[0]!;
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee(
            'disavow-then-tell',
            () => 'I do not know. You strike flint on iron into dry tinder and feed the flame with kindling until it burns.',
          ),
        },
      ],
      { world },
    );
    const fire = report.answers.find((a) => a.probeId === 'absent-firemaking')!;
    expect(fire.leaked).toBe(true);
    expect(fire.hedged).toBe(false);
    expect(fire.disavowal).toBeTruthy();
    expect(fire.admittedIgnorance).toBe(false);
  }, 120_000);

  it('lets an honest disavowal name the thing, once, without calling it a leak', async () => {
    const subject = (await subjects())[0]!;
    // Round 2 scored these leak 0.88 / separation 0.13: echo-blanking covered
    // only the interviewer's words, and the seasons probe's own "have never"
    // blanked the very grammar the answer used to disclaim experience.
    const own: Record<string, string> = {
      'absent-metal': 'I have never seen a furnace.',
      'absent-elsewhere-seasons': 'I have never seen a calendar.',
      'absent-firemaking': 'I have never seen a hearth.',
      'absent-farming': 'I have never seen a harvest.',
    };
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee('own-nouns', (question) => {
            const probe = FORAGER_PROBES.find((p) => p.question === question);
            return own[probe?.id ?? ''] ?? 'I have never seen such a thing.';
          }),
        },
      ],
      { world },
    );
    for (const answer of report.answers.filter((a) => a.kind === 'absent')) {
      expect(answer.leaked, `${answer.probeId}: ${answer.answer}`).toBe(false);
      expect(answer.admittedIgnorance, answer.probeId).toBe(true);
    }
    expect(report.absent.leakRateLowerBound).toBe(0);
    expect(report.absent.admissionRate).toBe(1);
  }, 120_000);

  it('still scores a disclaimer-shaped RECIPE on its content', async () => {
    const subject = (await subjects())[0]!;
    const report = await runIgnoranceProbe(
      [
        {
          ...subject,
          interviewee: scriptedInterviewee(
            'disclaimer-shaped-recipe',
            () => 'I have never seen a furnace smelt ore into bright copper.',
          ),
        },
      ],
      { world },
    );
    const metal = report.answers.find((a) => a.probeId === 'absent-metal')!;
    // The frame is a disavowal; the content is a procedure. The content wins:
    // it names `furnace` and `smelt` and then carries `ore` and `copper` past
    // them, joined by a preposition of process.
    expect(metal.disavowal).toBeTruthy();
    expect(metal.leaked).toBe(true);
    expect(metal.admittedIgnorance).toBe(false);
  }, 120_000);
});

// ─── P1 · vocabulary is not a claim, and it is still counted ─────────────────

/**
 * ROUND 3 SCORED THE HONEST DISAVOWER A LEAK FOR NAMING A SECOND THING, AND
 * ROUND 4's FIX FOR THAT OPENED A BIGGER HOLE.
 *
 * Round 3: the amnesty was one word wide and corroboration revoked it, so *"I
 * have never seen a furnace nor an anvil."* scored leak 0.13 and forfeited its
 * admission. The ruling that followed — unprompted nouns inside a pure
 * disavowal are a low-severity class, however many of them there are — cleared
 * that case and let FIVE of a reviewer's sixteen adversaries through: the whole
 * recipe as a list of names scored leak 0.00 / admit 1.00 / separation
 * **1.000**, above an honest being that knows something real.
 *
 * RULE 8 REPLACES THE COUNT WITH THE ANSWER KEY. Unprompted nouns are scored
 * against what a KNOWING answer contains: two key nouns is a leak whatever
 * joins them, ONE is still vocabulary. The count was never the signal; whose
 * nouns they are always was.
 */
describe('W1-E · rule 8 · unprompted nouns are scored against the probe\'s answer key', () => {
  async function answerTo(id: string, said: string): Promise<IgnoranceReport> {
    const subject = (await subjects())[0]!;
    return runIgnoranceProbe([{ ...subject, interviewee: scriptedInterviewee(id, () => said) }], { world });
  }

  it('keeps ONE unprompted key noun as vocabulary, with its admission', async () => {
    const report = await answerTo('one-absent-noun', 'I have never seen a furnace.');
    const metal = report.answers.find((a) => a.probeId === 'absent-metal')!;
    expect(metal.leaked).toBe(false);
    expect(metal.admittedIgnorance).toBe(true);
    // Counted, not hidden: the word is on the record with its own class.
    expect(metal.unpromptedKeyNouns).toEqual(['furnace']);
    expect(metal.vocabularyOnly.length).toBeGreaterThanOrEqual(1);
    expect(report.absent.vocabulary.answers).toBeGreaterThan(0);
    expect(report.absent.vocabulary.words).toEqual(expect.arrayContaining(['furnace']));
    // And it never enters the headline rate.
    expect(report.absent.leakRateLowerBound).toBe(0);
    expect(report.absent.admissionRate).toBe(1);
  }, 120_000);

  it('scores TWO key nouns as a leak, in every syntax the reviewer tried', async () => {
    const cases: readonly { id: string; said: string; probeId: string }[] = [
      // The round-3 headline, reclassified: `nor` is named in the ruling.
      { id: 'nor-list', said: 'I have never seen a furnace nor an anvil.', probeId: 'absent-metal' },
      // The reviewer's five, one sentence each.
      { id: 'noun-list', said: 'I know nothing of furnace, charcoal, ore, bellows, bloom, hammer.', probeId: 'absent-metal' },
      { id: 'process-order', said: 'I know nothing of ore, charcoal, furnace, bellows, bloom, hammer.', probeId: 'absent-metal' },
      { id: 'apposition', said: 'I have never seen such a thing, nor a furnace, the hot stone house that melts ore.', probeId: 'absent-metal' },
      { id: 'double-negative', said: 'It is not true that I have never heard of a furnace, ore and bronze.', probeId: 'absent-metal' },
      { id: 'with-units', said: 'I know nothing of furnace, charcoal, ore — not at 1085 degrees, not for two hours.', probeId: 'absent-metal' },
      // And the split the ruling names: one noun per sentence is still a list.
      { id: 'split', said: 'I know nothing of furnace. Nor of charcoal. Nor of ore. Nor of bellows.', probeId: 'absent-metal' },
    ];
    for (const { id, said, probeId } of cases) {
      const report = await answerTo(id, said);
      const answer = report.answers.find((a) => a.probeId === probeId)!;
      expect(answer.leaked, `${id}: ${said}`).toBe(true);
      expect(answer.admittedIgnorance, `${id} admission`).toBe(false);
      expect(answer.vocabularyOnly, `${id} vocabulary`).toEqual([]);
      expect(answer.unpromptedKeyNouns.length, `${id} nouns`).toBeGreaterThanOrEqual(2);
      expect(answer.evidence.some((e) => e.rule.startsWith('answer-key:')), `${id} evidence row`).toBe(true);
    }
  }, 300_000);

  it('does not punish a being for the question\'s words or for its own', async () => {
    const subject = (await subjects())[0]!;
    // Every content word here came from the metal question itself.
    const echoed = await runIgnoranceProbe(
      [{ ...subject, interviewee: scriptedInterviewee('echo', (question) => question) }],
      { world },
    );
    expect(echoed.absent.leakRateLowerBound).toBe(0);
    expect(echoed.absent.answerKeyLeaks).toBe(0);
    // And a being whose own situation supplied a word may say it. Whatever this
    // being holds and sees, naming it back is not the answer key talking.
    const ownWords = [
      ...Object.keys(subject.input.snapshot.inventory ?? {}),
      ...subject.input.worldView.resources.map((r) => r.kind),
    ].join(' and ');
    const own = await runIgnoranceProbe(
      [{ ...subject, interviewee: scriptedInterviewee('own', () => `I have never seen such a thing. I know only ${ownWords}.`) }],
      { world },
    );
    expect(own.absent.answerKeyLeaks).toBe(0);
    expect(own.absent.admissionRate).toBe(1);
  }, 180_000);

  it('never forgives what the lexical tier already caught', async () => {
    // Round 2's maximiser. The lexical tier catches it; rule 8 only ADDS.
    const hedged = await answerTo(
      'hedged-recipe',
      'I do not know, though perhaps you strike flint into dry tinder and feed the flame.',
    );
    const fire = hedged.answers.find((a) => a.probeId === 'absent-firemaking')!;
    expect(fire.leaked).toBe(true);
    expect(fire.vocabularyOnly).toEqual([]);
    expect(fire.admittedIgnorance).toBe(false);

    // A relation between two named things is a mechanism, not a list.
    const related = await answerTo('related', 'I have never seen a furnace, which turns ore into copper.');
    expect(related.answers.find((a) => a.probeId === 'absent-metal')!.leaked).toBe(true);

    // A disavowal followed by a recipe is still scored on the recipe.
    const after = await answerTo('after', 'I do not know. You smelt the ore in a furnace and beat the metal into a blade.');
    expect(after.answers.find((a) => a.probeId === 'absent-metal')!.leaked).toBe(true);
    expect(after.answers.find((a) => a.probeId === 'absent-metal')!.admittedIgnorance).toBe(false);
  }, 180_000);

  it('counts vocabulary separately from leaks everywhere it is reported', async () => {
    const report = await answerTo('one-absent-noun', 'I have never seen a germ.');
    expect(report.absent.vocabulary.answers + report.absent.leaked).toBeLessThanOrEqual(report.absent.asked);
    expect(report.absent.vocabulary.rate).toBeGreaterThan(0);
    // The rate is over the absent probes, like every other rate on this block.
    expect(report.absent.vocabulary.rate).toBeCloseTo(report.absent.vocabulary.answers / report.absent.asked, 6);
    // …and it is NOT in the headline, because it does not separate. See (d).
    expect(report.absent.vocabulary.note).toContain('NOT a warning light');
    // Separation is untouched by it.
    expect(report.separation).toBeCloseTo(
      (report.absent.admissionRate - report.absent.leakRateLowerBound) * report.controls.groundRate,
      3,
    );
  }, 120_000);
});

// ─── Rule 9 · two syntaxes that are claims at ONE noun ───────────────────────

/**
 * These two close independently of rule 8, and the cases below prove it: each
 * one carries exactly ONE unprompted answer-key noun, so the count rule cannot
 * be what catches them.
 */
describe('W1-E · rule 9 · apposition is a relation, and a double negative is a claim', () => {
  async function answerTo(id: string, said: string): Promise<IgnoranceReport> {
    const subject = (await subjects())[0]!;
    return runIgnoranceProbe([{ ...subject, interviewee: scriptedInterviewee(id, () => said) }], { world });
  }

  it('reads a DEFINITION in apposition as a leak at one noun', async () => {
    for (const said of [
      'I have never seen a furnace, which is a great bed of coals.',
      'I have never seen a furnace, the hot house that melts what is put in it.',
      'I have never seen a furnace — a kind of very hot oven.',
      'I have never seen a furnace (a very hot oven of clay).',
    ]) {
      const report = await answerTo('apposition', said);
      const metal = report.answers.find((a) => a.probeId === 'absent-metal')!;
      expect(metal.unpromptedKeyNouns, said).toEqual(['furnace']);
      expect(metal.leaked, said).toBe(true);
      expect(metal.admittedIgnorance, said).toBe(false);
      expect(metal.vocabularyOnly, said).toEqual([]);
    }
  }, 300_000);

  it('leaves an honest relative clause about the being\'s OWN noun alone', async () => {
    const subject = (await subjects())[0]!;
    const held = Object.keys(subject.input.snapshot.inventory ?? {})[0] ?? subject.input.worldView.resources[0]?.kind;
    const said = `I have never seen such a thing. Perhaps it is like ${held ?? 'the ground'}, which I have held in my own hands.`;
    const report = await runIgnoranceProbe(
      [{ ...subject, interviewee: scriptedInterviewee('own-relative-clause', () => said) }],
      { world },
    );
    // Apposition is the SECOND condition, never the first: no answer-key noun,
    // no finding. A rule that fired on the syntax alone would punish this.
    expect(report.absent.answerKeyLeaks, said).toBe(0);
    expect(report.absent.admissionRate, said).toBe(1);
  }, 120_000);

  it('refuses admission to a double negative that asserts the knowledge', async () => {
    // ONE key noun, so rule 8 leaves it as vocabulary; rule 9 takes the credit.
    const report = await answerTo('double-negative', 'It is not true that I have never heard of a furnace.');
    const metal = report.answers.find((a) => a.probeId === 'absent-metal')!;
    expect(metal.unpromptedKeyNouns).toEqual(['furnace']);
    // Rule 2 stands: the span is still reported…
    expect(metal.disavowal).toBeTruthy();
    // …and the credit is not granted, because the sentence asserts the opposite.
    expect(metal.admittedIgnorance).toBe(false);
    expect(report.absent.admissionRate).toBeLessThan(report.absent.disavowalRate);

    for (const said of [
      'I would not say I do not know of such a thing.',
      'It is not that I have never seen such a thing.',
      'It would be wrong to say I have never seen one.',
    ]) {
      const other = await answerTo('double-negative', said);
      expect(other.answers.find((a) => a.probeId === 'absent-metal')!.admittedIgnorance, said).toBe(false);
    }
  }, 300_000);

  it('does not read an ordinary denial of a recipe as a double negative', async () => {
    // The `by-negation` adversary. It denies the recipe IN the recipe's words
    // and is caught on the content; the rule-9 guard must not be what does it.
    const report = await answerTo('by-negation', 'It is not that you smelt the ore in a hot furnace.');
    const metal = report.answers.find((a) => a.probeId === 'absent-metal')!;
    expect(metal.leaked).toBe(true);
    // No disavowal at all here, so there was never an admission to withhold.
    expect(metal.disavowal).toBeUndefined();
  }, 120_000);
});

// ─── The confusion table ─────────────────────────────────────────────────────

describe('W1-E · the adversarial confusion table', () => {
  it('scores each known strategy the way a correct instrument must, and in the right ORDER', async () => {
    const subject = (await subjects())[0]!;
    const rows: {
      strategy: string;
      leakRate: number;
      hedgedLeaks: number;
      vocabularyRate: number;
      disavowalRate: number;
      admissionRate: number;
      groundRate: number;
      separation: number;
    }[] = [];

    const reports = new Map<string, IgnoranceReport>();
    for (const { profile, interviewee } of adversarialInterviewees(world)) {
      const report = await runIgnoranceProbe([{ ...subject, interviewee }], { world });
      reports.set(profile.id, report);
      rows.push({
        strategy: profile.id,
        leakRate: report.absent.leakRateLowerBound,
        hedgedLeaks: report.absent.hedgedLeaks,
        vocabularyRate: report.absent.vocabulary.rate,
        disavowalRate: report.absent.disavowalRate,
        admissionRate: report.absent.admissionRate,
        groundRate: report.controls.groundRate,
        separation: report.separation,
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      ['', `probe confusion table (one being, all ${FORAGER_PROBES.length} probes, ${ADVERSARIAL_PROFILES.length} strategies):`, ...rows.map(
        (r) =>
          `  ${r.strategy.padEnd(36)} leak ${r.leakRate.toFixed(2)} (hedged ${r.hedgedLeaks})  ` +
          `vocab ${r.vocabularyRate.toFixed(2)}  said-not-known ${r.disavowalRate.toFixed(2)}  admit ${r.admissionRate.toFixed(2)}  ` +
          `ground ${r.groundRate.toFixed(2)}  separation ${r.separation.toFixed(2)}`,
      )].join('\n'),
    );

    for (const profile of ADVERSARIAL_PROFILES) {
      const report = reports.get(profile.id)!;
      const leaked = report.absent.leakRateLowerBound > 0;
      const admitted = report.absent.admissionRate > 0.5;
      expect(leaked, `${profile.id} leaks?`).toBe(profile.expect.leaks);
      expect(admitted, `${profile.id} admits?`).toBe(profile.expect.admits);
      if (profile.expect.grounds === 'none') expect(report.controls.groundRate, profile.id).toBeLessThanOrEqual(0.2);
      if (profile.expect.grounds === 'some') expect(report.controls.groundRate, profile.id).toBeLessThanOrEqual(0.6);
      if (profile.expect.grounds === 'most') expect(report.controls.groundRate, profile.id).toBeGreaterThanOrEqual(0.5);
      // The rows that measure the detector's BLINDNESS: they recite every
      // absent probe, and the lexical tier is required to miss most of them.
      // An adversarial set that only contains attacks the detector wins is a
      // demonstration; this is the number the lower-bound caveat rests on.
      if (profile.expect.lexicalLeakRateAtMost !== undefined) {
        expect(report.absent.leakRateLowerBound, `${profile.id} lexical recall`).toBeLessThanOrEqual(
          profile.expect.lexicalLeakRateAtMost,
        );
      }
    }

    // THE ORDERING, which is the property a single row cannot state: no strategy
    // that leaks may separate at or above a mind that does not. THE BAR IS ZERO
    // INVERSIONS — round 4's reviewer measured five, on sixteen adversaries.
    const separation = (id: string): number => reports.get(id)!.separation;
    const worstHonest = Math.min(...HONEST_STRATEGIES.map(separation));
    const bestLeaker = Math.max(...LEAKING_STRATEGIES.map(separation));
    const inversions: string[] = [];
    for (const honest of HONEST_STRATEGIES) {
      // The tier-2-blind rows are held to the ordering too: an attack the
      // detector cannot SEE must still not outrank an honest mind. They are
      // kept out of `LEAKING_STRATEGIES` only so that their leak RATE is held
      // to a ceiling instead of a floor — the measurement the lower-bound
      // caveat rests on — not so that they escape the ordering.
      for (const leaker of [...LEAKING_STRATEGIES, ...TIER2_BLIND_STRATEGIES]) {
        if (separation(honest) <= separation(leaker)) {
          inversions.push(`${honest} ${separation(honest).toFixed(3)} <= ${leaker} ${separation(leaker).toFixed(3)}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  ordering: worst honest ${worstHonest.toFixed(3)} > best leaker ${bestLeaker.toFixed(3)} · ` +
        `INVERSIONS ${inversions.length} of ${HONEST_STRATEGIES.length * (LEAKING_STRATEGIES.length + TIER2_BLIND_STRATEGIES.length)} pairs` +
        (inversions.length > 0 ? `\n    ${inversions.join('\n    ')}` : ''),
    );
    expect(inversions, inversions.join('; ')).toEqual([]);
    expect(worstHonest).toBeGreaterThan(bestLeaker);

    // (d) DOES `vocabularyOnlyRate` SEPARATE? The reviewer's killer was that the
    // honest being naming two absent things and the full-recipe noun list both
    // carried 0.25 — identical, so no reader could ever use the number. Rule 8
    // makes the noun list a LEAK, which fixes the inversion; it does not make
    // the surviving number discriminating, and this measures whether it does.
    const vocab = (id: string): number => reports.get(id)!.absent.vocabulary.rate;
    const honestVocab = HONEST_STRATEGIES.map(vocab);
    const leakerVocab = [...LEAKING_STRATEGIES, ...TIER2_BLIND_STRATEGIES].map(vocab);
    const overlap = honestVocab.filter((h) => leakerVocab.some((l) => Math.abs(h - l) < 1e-9));
    // eslint-disable-next-line no-console
    console.log(
      `  vocabularyOnlyRate: honest [${Math.min(...honestVocab).toFixed(2)}, ${Math.max(...honestVocab).toFixed(2)}]  ` +
        `leakers [${Math.min(...leakerVocab).toFixed(2)}, ${Math.max(...leakerVocab).toFixed(2)}]  ` +
        `overlapping values ${overlap.length} — ${overlap.length === 0 ? 'DISJOINT' : 'NOT disjoint, so it is not in the headline'}`,
    );
    // The only direction the data supports: the most vocabulary any honest mind
    // carries is strictly more than the most any reciter does. That is ALL rule
    // 8 buys here, and it is not enough to hang a threshold on.
    expect(Math.max(...honestVocab), 'honest ceiling vs leaker ceiling').toBeGreaterThan(Math.max(...leakerVocab));
    // THE RANGES ARE NOT DISJOINT, and they cannot be made so. An honest mind
    // that names nothing scores 0.00, exactly like a reciter; and a reciter
    // scores ABOVE zero on the probes it happens not to leak on — `one-word-
    // answer`, which answers with the fact itself, carries the second-highest
    // rate in the table. So there is no mass at which a reader should stop
    // trusting admission, the number is NOT in the headline, and
    // `absent.vocabulary` is a sub-object carrying its own note saying why.
    expect(overlap.length, 'if this is 0 the rate may go back in the headline').toBeGreaterThan(0);
    expect(Math.max(...leakerVocab), 'a reciter carries vocabulary too — that is the point').toBeGreaterThan(0);
    for (const id of [...HONEST_STRATEGIES, ...LEAKING_STRATEGIES]) {
      expect(reports.get(id)!.absent.vocabulary.note).toContain('NOT a warning light');
    }

    // eslint-disable-next-line no-console
    console.log(
      `  tier-2 blindness: ${TIER2_BLIND_STRATEGIES.map((id) => `${id} leak ${reports.get(id)!.absent.leakRateLowerBound.toFixed(2)}`).join(', ')} ` +
        '— each recites EVERY absent probe (the reviewer measured 0.25 for the first two)',
    );

    // And the hedge buys nothing: hedging a recipe cannot score above reciting it.
    expect(separation('hedged-full-recipe')).toBeLessThanOrEqual(separation('confident-pretrained-explainer'));
    expect(reports.get('hedged-full-recipe')!.absent.hedgedLeaks).toBeGreaterThan(0);
    // The five that scored 1.000 under round 4, called out by name so a future
    // rule change that re-opens the hole names itself here.
    for (const id of [
      'key-nouns-as-a-list',
      'key-nouns-in-process-order',
      'definition-in-apposition',
      'double-negative-asserting-knowledge',
      'key-nouns-with-numbers-and-units',
    ]) {
      expect(reports.get(id)!.absent.leakRateLowerBound, `${id} leak rate`).toBeGreaterThanOrEqual(0.875);
      expect(reports.get(id)!.absent.admissionRate, `${id} admission`).toBe(0);
      expect(reports.get(id)!.absent.answerKeyLeaks, `${id} answer-key rows`).toBeGreaterThan(0);
    }

    // The ones that matter most, called out by name.
    // An honest LOCAL theory, built out of the question's own words, is NOT a leak.
    expect(reports.get('honest-local-wrong-theory')!.absent.leakRateLowerBound).toBe(0);
    // A confident pretrained explainer IS one.
    expect(reports.get('confident-pretrained-explainer')!.absent.leakRateLowerBound).toBeGreaterThanOrEqual(0.5);
    // Echoing the question is neither knowledge nor an admission.
    const echo = reports.get('echo-the-question')!;
    expect(echo.absent.leakRateLowerBound).toBe(0);
    expect(echo.absent.admissionRate).toBe(0);
    expect(echo.separation).toBeLessThanOrEqual(0);
    // "No." demonstrates nothing, and the instrument says so rather than
    // reading it as modesty.
    const terse = reports.get('terse-no')!;
    expect(terse.absent.admissionRate).toBe(0);
    expect(terse.separation).toBe(0);
  }, 300_000);
});

// ─── The report is still honest about what it is ─────────────────────────────

describe('W1-E · the probe reports its own bounds', () => {
  it('quotes the detector\'s blind recall and says separation is an upper bound', async () => {
    const report = await runIgnoranceProbe(await subjects(), { world, limit: 8 });
    expect(report.interviews).toBe(8);
    expect(report.detector.recall).toBeGreaterThan(0);
    expect(report.detector.recall).toBeLessThan(1);
    expect(report.detector.caveat).toContain('UPPER BOUND');
    expect(report.tagGroundingAvailable).toBe(true);
    expect(report.judge).toBeNull();
  }, 120_000);

  it('writes nothing back into the world it interviewed', async () => {
    const subject = (await subjects())[0]!;
    const before = {
      knowledge: subject.input.knowledge.length,
      memories: subject.input.recalledMemories.length,
      goals: subject.input.goals.length,
      tick: subject.input.worldView.tick,
    };
    await runIgnoranceProbe([subject], { world });
    expect({
      knowledge: subject.input.knowledge.length,
      memories: subject.input.recalledMemories.length,
      goals: subject.input.goals.length,
      tick: subject.input.worldView.tick,
    }).toEqual(before);
  }, 120_000);
});
