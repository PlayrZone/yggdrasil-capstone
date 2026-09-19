/**
 * SAYING YOU DO NOT KNOW, in the one language this world speaks.
 *
 * World data, not mechanism: a world whose lexicon is not English supplies its
 * own list. It sits in its own file because both the trace features and the
 * ignorance probe read it, and neither should own it.
 *
 * Matching is on a normalised sentence (lowercase, punctuation to spaces) so
 * that "I don't know." and "i do not know" are one thing, and it requires a
 * FIRST-PERSON or impersonal disavowal — "no one knows" counts, "you do not
 * know where the water is" is someone being told off and does not.
 */
export const DISAVOWALS: readonly string[] = [
  'i do not know',
  'i dont know',
  'i don t know',
  'i have never seen',
  'i have never heard',
  'i do not understand',
  'i dont understand',
  'i cannot say',
  'i cant say',
  'i have no idea',
  'i could not say',
  'i couldnt say',
  'no one knows',
  'nobody knows',
  'i know nothing',
  'i have never known',
  'i was never told',
  'that is not a word i know',
  'i do not know what that is',
];

export function normaliseSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Did this being say, in some form, that it does not know? */
export function admitsIgnorance(text: string, disavowals: readonly string[] = DISAVOWALS): boolean {
  const normal = normaliseSpeech(text);
  if (normal.length === 0) return false;
  return disavowals.some((phrase) => normal.includes(normaliseSpeech(phrase)));
}
