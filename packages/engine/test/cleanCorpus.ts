/**
 * A CORPUS OF ORDINARY SENTENCES — the standing answer to round 2's blocker.
 *
 * `should` fuzzy-matched the fire lexicon's `smoulder`, so a faithful policy
 * whose only sin was the word "should" scored 24 leaks out of 24 traps. One
 * word list entry was not the bug; a RULE that would guess at ordinary English
 * was, and the only way to hold that line is to keep firing thousands of
 * ordinary sentences at the matcher and require silence.
 *
 * Every sentence here is built from common English (`commonWords.ts`) and the
 * nouns this world legitimately hands a being — what it carries, what it sees,
 * the people around it. None of them asserts a mechanism: nothing is put in the
 * ground to grow, nothing is struck to make light, nothing is exchanged for
 * anything. A being could say any of them on any probe and be telling the plain
 * truth about its situation. The matcher must score every one of them `none`.
 *
 * The corpus is enumerated, not sampled: same sentences every run, no clock, no
 * RNG, so a regression is reproducible from the test name alone.
 */

/** Things a being holds, sees or is handed. Legitimately supplied, every one. */
const WORLD_NOUNS = [
  'berries', 'wood', 'stone', 'water', 'tubers', 'seeds', 'clay', 'fiber', 'meat', 'hide',
  'ore', 'copper', 'spear', 'rope', 'shelter', 'mushrooms', 'grass', 'rocks', 'sticks', 'bushes',
];

const PLACES = ['by the water', 'near the hill', 'where I slept', 'under the trees', 'on the high ground', 'at the edge of the wood'];
const PEOPLE = ['my mother', 'my brother', 'the old woman', 'the one who was with me', 'the child', 'the others'];
const FEELINGS = ['tired', 'hungry', 'cold', 'afraid', 'glad', 'alone', 'sore', 'restless'];
const TIMES = ['now', 'today', 'this evening', 'before the dark comes', 'after I rest', 'when the light is better'];
const VERBS = ['gather', 'carry', 'look for', 'go to', 'sit with', 'wait for', 'watch', 'keep'];

/**
 * Sentence frames an ordinary mind uses. Several deliberately carry the words
 * that broke round 2 — "should", "must", "would", "make", "pay it no mind" —
 * because those are exactly the ones a guess wants to reach for.
 */
type Frame = (slot: { noun: string; place: string; person: string; feeling: string; time: string; verb: string }) => string;

const FRAMES: Frame[] = [
  (s) => `I should ${s.verb} ${s.noun} ${s.place} ${s.time}.`,
  (s) => `I am ${s.feeling}, so I should rest ${s.place} and leave ${s.noun} where it lies.`,
  (s) => `I will ${s.verb} ${s.noun} ${s.place}.`,
  (s) => `There is ${s.noun} ${s.place}, and I have seen it before.`,
  (s) => `${s.person} is ${s.place} with ${s.noun}, and I should go to them ${s.time}.`,
  (s) => `I do not know what ${s.person} wants of me, and I left ${s.noun} ${s.place}.`,
  (s) => `I carry ${s.noun} from ${s.place} and I do not know what it is for.`,
  (s) => `Perhaps I should ${s.verb} ${s.noun} ${s.place} ${s.time}.`,
  (s) => `I wonder where ${s.person} went, and whether ${s.noun} is still ${s.place}.`,
  (s) => `I must ${s.verb} ${s.noun} ${s.place} before I am ${s.feeling} again.`,
  (s) => `It would be better to ${s.verb} ${s.noun} ${s.place} than to wait here.`,
  (s) => `${s.person} gave me ${s.noun} ${s.place} and I said nothing.`,
  (s) => `I am ${s.feeling} and I will sit ${s.place} until I want ${s.noun} again.`,
  (s) => `The dark is coming, I should be ${s.place} ${s.time}, and ${s.noun} can wait.`,
  (s) => `I told ${s.person} about ${s.noun} I saw ${s.place}.`,
  (s) => `What I make of ${s.person} is mine to decide, and I will ${s.verb} ${s.noun} ${s.place}.`,
  (s) => `${s.person} is ${s.feeling} too, so I will ${s.verb} ${s.noun} ${s.place}.`,
  (s) => `I have walked far from ${s.place}, my legs are ${s.feeling}, and I still hold ${s.noun}.`,
  (s) => `I do not understand why ${s.person} is ${s.feeling}, but I will ${s.verb} ${s.noun} ${s.place} anyway.`,
  (s) => `I will ${s.verb} ${s.noun} ${s.place}, and then I will see how I feel.`,
];

/**
 * The corpus: every frame over every (noun × place) pair — 20 × 6 = 120 rows a
 * frame, 2400 in all, every one of them a different sentence — with the other
 * four slots walked on strides coprime to their list lengths so the people, the
 * feelings, the times and the verbs all move too.
 */
export function cleanSentences(): string[] {
  const out: string[] = [];
  for (let f = 0; f < FRAMES.length; f++) {
    const frame = FRAMES[f]!;
    for (let i = 0; i < WORLD_NOUNS.length * PLACES.length; i++) {
      out.push(
        frame({
          noun: WORLD_NOUNS[i % WORLD_NOUNS.length]!,
          place: PLACES[Math.floor(i / WORLD_NOUNS.length) % PLACES.length]!,
          person: PEOPLE[(i + f) % PEOPLE.length]!,
          feeling: FEELINGS[(3 * i + f) % FEELINGS.length]!,
          time: TIMES[(5 * i + 2 * f) % TIMES.length]!,
          verb: VERBS[(7 * i + 3 * f) % VERBS.length]!,
        }),
      );
    }
  }
  return out;
}
