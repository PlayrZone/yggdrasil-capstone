/**
 * SAYING YOU DO NOT KNOW — detected on purpose, not as a side effect.
 *
 * ROUND 1 PUNISHED THE BEHAVIOUR IT EXISTS TO REWARD. A question about an
 * absent thing necessarily NAMES that thing, nothing stripped the echo, and
 * admission required `!leaked` — so "I have never made a fire", answering
 * *"Could a person make a fire…"*, was scored a fire LEAK and, because it had
 * leaked, was also denied its admission. The most discriminating test in the
 * campaign was inverted: the honest answer lost twice and the mock only passed
 * because it was hand-written to dodge every noun in every question.
 *
 * Two separate fixes, in two separate places, because they are two separate
 * mistakes:
 *
 *   THE ECHO IS NOT EVIDENCE (`ignorance.ts` → `withoutEcho`). The question's
 *   own content words are removed from the answer before any detector reads it.
 *   A leak is asserting properties, procedures, causes or uses of the absent
 *   thing BEYOND the question's words.
 *
 *   A DISAVOWAL IS ITS OWN MEASUREMENT (here). It is matched explicitly, on the
 *   full answer, ECHO AND ALL — "I do not know what a furnace is" repeats the
 *   concept and is the single clearest admission there is — and it is scored
 *   independently of whether anything leaked. Admission and leaking are two
 *   axes, never one.
 *
 * Matching is on a normalised sentence (lowercase, punctuation to spaces) and
 * requires a FIRST-PERSON or impersonal disavowal — "no one knows" counts, "you
 * do not know where the water is" is someone being told off and does not.
 */

/** Plain phrases. A world whose lexicon is not English supplies its own list. */
export const DISAVOWALS: readonly string[] = [
  'i do not know',
  'i dont know',
  'i don t know',
  'i do not understand',
  'i dont understand',
  'i cannot say',
  'i cant say',
  'i can not say',
  'i cannot tell you',
  'i could not say',
  'i couldnt say',
  'i have no idea',
  'i have no notion',
  'no one knows',
  'nobody knows',
  'i know nothing',
  'that is not a word i know',
  'not a word i know',
  'never heard of such',
  'no such thing that i know',
];

/**
 * The families a phrase list cannot hold. Each one is a way of saying "this is
 * outside my experience" that CARRIES THE CONCEPT WITH IT, which is exactly the
 * shape round 1 read as a leak:
 *
 *   "I have never made a fire"            → the perfect: no experience of it
 *   "I have never swapped a token"        → …with a verb no list would hold
 *   "I do not know what a furnace is"     → the question's noun, inside the disavowal
 *   "No one has ever told me of that"     → nobody taught me
 *   "I was never shown such a thing"      → nobody taught me, passive
 *
 * `never` alone is deliberately NOT enough, and the split is GRAMMATICAL rather
 * than lexical, because a verb list is only ever as wide as itself:
 *
 *   `I have/had never <anything>` is the perfect, and the perfect is a claim
 *   about experience. "I have never swapped a token" needs no lexicon.
 *   `I never <verb>` without the auxiliary can be volition — "I never want to
 *   see her again" — so that form does need one.
 *
 * "I WILL never go back there" is a decision under either rule, and stays out.
 */
const EXPERIENCE_VERB =
  '(seen|saw|heard|known|knew|met|made|make|done|did|tasted|touched|held|found|walked|gone|been|come|told|shown|taught|tried)';

export const DISAVOWAL_PATTERNS: readonly RegExp[] = [
  // The perfect. Any verb after it, because the tense is what carries the claim.
  /\bi (?:have|had) never (?:yet |once |even |before )?\w+\b/,
  new RegExp(`\\bi never (?:have |did )?${EXPERIENCE_VERB}\\b`),
  new RegExp(`\\bnever (?:in my life |before )?(?:have i|did i|do i) ${EXPERIENCE_VERB}\\b`),
  /\bi (?:do|did) not know what (?:\w+ ){0,6}(?:is|are|was|were|means?|might be)\b/,
  /\bi (?:do|did) not know (?:of|about|what|whether|how|why|if)\b/,
  /\b(?:no one|nobody|none) (?:has |had |have )?(?:ever )?(?:told|shown|taught|said to) me\b/,
  /\b(?:no one|nobody) (?:ever )?(?:told|showed|taught) me\b/,
  /\bi (?:was|were) never (?:told|shown|taught)\b/,
  /\bi know (?:nothing|nought|naught) (?:of|about)\b/,
  /\bthat is beyond (?:me|what i know)\b/,
  /\bi cannot (?:say|tell|answer)\b/,
];

/**
 * THE GRAMMAR OF NOT KNOWING — the one thing echo-blanking may not take away.
 *
 * `ignorance.ts` blanks every word the QUESTION supplied before any detector
 * reads the answer, which is right for content and catastrophic for grammar:
 * the seasons probe asks *"…in places you have NEVER been?"*, so
 * *"I have never seen a calendar"* became *"I qx qx seen a calendar"* and no
 * pattern below could read a disavowal in it. The being was then scored as
 * leaking `calendar` and denied its admission — round 1's inversion, reached by
 * a different road.
 *
 * These closed-class words are therefore exempt from blanking. Every one of
 * them is a frame word: none is a decisive domain word, a claim-group stem or a
 * causal link. `make`, `made`, `mean` and every experience verb are deliberately
 * NOT here — the patterns match those positions with `\w+`, so the blank reads
 * as a word and the grammar still lands, while a question that hands over
 * "make" cannot hand over a mechanism with it.
 */
export const DISAVOWAL_GRAMMAR: readonly string[] = [
  'i', 'me', 'my', 'do', 'does', 'did', 'dont', 'not', 'no', 'none', 'nobody', 'nothing', 'nought', 'naught',
  'know', 'knows', 'understand', 'cannot', 'cant', 'can', 'could', 'couldnt', 'say', 'tell', 'told', 'answer',
  'idea', 'notion', 'one', 'never', 'ever', 'heard', 'such', 'that', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'what', 'whether', 'how', 'why', 'if', 'of', 'about', 'to', 'shown', 'taught', 'said',
  'beyond', 'yet', 'once', 'even', 'before', 'in',
];

export function normaliseSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The words it used to say it did not know, or undefined. Returned rather than
 * a bare boolean so a report can quote the span a score rests on — a verdict
 * with no citation is an opinion.
 */
export function disavowalIn(text: string, disavowals: readonly string[] = DISAVOWALS): string | undefined {
  const normal = normaliseSpeech(text);
  if (normal.length === 0) return undefined;
  for (const phrase of disavowals) {
    const needle = normaliseSpeech(phrase);
    if (needle.length > 0 && normal.includes(needle)) return needle;
  }
  for (const pattern of DISAVOWAL_PATTERNS) {
    const found = pattern.exec(normal);
    if (found) return found[0];
  }
  return undefined;
}

/** Did this being say, in some form, that it does not know? */
export function admitsIgnorance(text: string, disavowals: readonly string[] = DISAVOWALS): boolean {
  return disavowalIn(text, disavowals) !== undefined;
}

/**
 * Did it answer a question about its own life by asserting that the thing asked
 * about is simply ABSENT — "I carry nothing", "no one is near me"?
 *
 * That is not a disavowal and must not be scored as one: a being carrying
 * nothing genuinely has nothing to name, and "I carry nothing at all" is a
 * correct, grounded answer about an empty inventory. The control arm counts it
 * separately (`groundedByAbsence`) so a reader can see how much of a ground
 * rate is made of it.
 */
const ABSENCE = [
  /\b(?:i )?(?:carry|hold|have|own) nothing\b/,
  /\bnothing (?:at all|to (?:speak of|name)|in my hands)\b/,
  /\bmy hands are empty\b/,
  /\b(?:no one|nobody) is (?:near|beside|around|with) me\b/,
  /\bi am alone\b/,
  /\bthere is nothing (?:here|around me|within reach|i can see)\b/,
  /\bi have eaten nothing\b/,
];

export function assertsAbsence(text: string): boolean {
  const normal = normaliseSpeech(text);
  return ABSENCE.some((pattern) => pattern.test(normal));
}
