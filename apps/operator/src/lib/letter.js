// @ts-check
/**
 * letter.js — a business's first letter, shown where it has no logo yet (stage 19b-2a).
 * "Ìrìn Lagos Tours" → "Ì": the first character as a person sees it (a grapheme), so an
 * accented letter or an emoji isn't split in half.
 * @param {string} name
 */
export function firstLetter(name) {
  const segments = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(
    name.trim().normalize('NFC'),
  );
  const first = segments[Symbol.iterator]().next().value?.segment ?? '?';
  return first.toLocaleUpperCase('en');
}
