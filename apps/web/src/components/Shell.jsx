// @ts-check
/**
 * The page frame every guest screen sits in: the operator's header, then the content.
 *
 * The letter mark is the first letter of the business name ("Ì" for Ìrìn) until logos
 * arrive with uploads (session 18). It's decorative: screen readers read the name next to it.
 *
 * @param {{ operatorName: string, children: import('react').ReactNode }} props
 */
export function Shell({ operatorName, children }) {
  return (
    <>
      <header className="okg-header">
        <span className="okg-mark" aria-hidden="true">
          {firstLetter(operatorName)}
        </span>
        <span className="okg-header__name">{operatorName}</span>
      </header>
      <main className="okg-page">{children}</main>
    </>
  );
}

/**
 * The first LETTER as people see it, tone marks included: "Ìrìn" → "Ì", "Ọ̀ṣun" → "Ọ̀".
 * Splitting a string into characters isn't enough: "Ọ̀" is two code points (Ọ plus a
 * combining grave accent) even after normalising. Intl.Segmenter splits by "grapheme",
 * meaning what a reader counts as one letter.
 * @param {string} name
 */
export function firstLetter(name) {
  const segments = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(
    name.trim().normalize('NFC'),
  );
  const first = segments[Symbol.iterator]().next().value?.segment ?? '?';
  return first.toLocaleUpperCase('en');
}
