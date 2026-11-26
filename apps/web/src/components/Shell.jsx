// @ts-check
/**
 * The page frame every guest screen sits in: the operator's header, then the content.
 *
 * The mark is the business's logo (19b-2b), or the first letter of its name ("Ì" for Ìrìn)
 * when it has none. It's decorative: screen readers read the name next to it.
 *
 * @param {{ operatorName: string, logo?: Logo | null, aside?: string, children: import('react').ReactNode }} props
 *   operatorName: '' while loading · aside: small words on the right ("Your trip")
 */
export function Shell({ operatorName, logo = null, aside, children }) {
  return (
    <>
      <header className="okg-header">
        {operatorName ? (
          <>
            <Mark name={operatorName} logo={logo} />
            <span className="okg-header__name">{operatorName}</span>
            {aside && <span className="okg-header__aside">{aside}</span>}
          </>
        ) : (
          // Name not known yet (still loading): a placeholder, not "?".
          <span className="okg-skeleton" aria-hidden="true" style={{ width: 160, height: 32 }} />
        )}
      </header>
      <main className="okg-page">{children}</main>
    </>
  );
}

/** @typedef {{ url: string, small: string }} Logo */

/**
 * The business's mark: its logo (the 128 px copy), else its first letter. Decorative (alt="",
 * aria-hidden): the name is always written beside it.
 * @param {{ name: string, logo?: Logo | null, className?: string }} props
 */
export function Mark({ name, logo = null, className = '' }) {
  const cls = `okg-mark${className ? ` ${className}` : ''}`;
  if (logo) return <img className={`${cls} okg-mark--logo`} src={logo.small} alt="" />;
  return (
    <span className={cls} aria-hidden="true">
      {firstLetter(name)}
    </span>
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
