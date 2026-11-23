// @ts-check
/**
 * PictureFields — the logo and the hero photo in Settings › Business details (stage 19b-2a;
 * designs: U1). Each picture uploads as soon as it's picked (usePicture, lib/uploads.js); it's
 * used once the business details are saved. The rules are in lib/pictures.js.
 *
 *   no logo yet       the first letter, "Add a logo"
 *   a logo            the logo, Replace logo, Remove
 *   no hero photo     a big "Add a hero photo" (the style's pattern until then)
 *   a hero photo      the photo, its description (needed) and credit, Replace photo, Remove
 *   uploading         the file's name, how far, Cancel
 *   a problem         the server's words ("That photo is 14 MB. Use one under 10 MB.")
 */
import { useRef } from 'react';
import { ACCEPTED_PICTURES } from '@okapigo/shared/uploads';

/**
 * A hidden file input and the button that opens it.
 * @param {{ label: string, className?: string, onPick: (file: File) => void, children?: any }} props
 */
function PickButton({ label, className = 'btn btn--outline btn--compact', onPick, children }) {
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {children ?? label}
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept={ACCEPTED_PICTURES}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={label}
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) onPick(file);
          ev.target.value = '';
        }}
      />
    </>
  );
}

/** "Uploading tinubu-square.jpg… 62%", a bar, Cancel. @param {{ upload: { name: string, progress: number }, onCancel: () => void }} props */
function Uploading({ upload, onCancel }) {
  return (
    <div className="stack-xs">
      <span>
        Uploading {upload.name}… {upload.progress}%
      </span>
      <span
        className="progress upload-progress"
        role="progressbar"
        aria-label={`Uploading ${upload.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={upload.progress}
      >
        <span className="progress-bar progress-bar--ink" style={{ width: `${upload.progress}%` }} />
      </span>
      <button type="button" className="text-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * @param {{ logo: ReturnType<typeof import('../lib/uploads.js').usePicture>, letter: string }} props
 */
export function LogoField({ logo, letter }) {
  return (
    <div className="stack-xs picture-field" role="group" aria-labelledby="logo-h">
      <h4 id="logo-h" className="h-sm">
        Logo
      </h4>
      <div className="row-wrap picture-field__row">
        {logo.picture ? (
          <img className="logo-preview" src={logo.picture.small} alt="Your logo" />
        ) : (
          <span className="logo-preview logo-preview--letter" aria-hidden="true">
            {letter}
          </span>
        )}
        <div className="stack-xs grow">
          <span className="small muted">
            {logo.picture
              ? 'Beside your name on your website, checkout, tickets, posters and link previews. Square works best: it’s shown small.'
              : 'Using your first letter.'}
          </span>
          {logo.upload ? (
            <Uploading upload={logo.upload} onCancel={logo.cancel} />
          ) : (
            <div className="row-wrap">
              <PickButton label={logo.picture ? 'Replace logo' : 'Add a logo'} onPick={logo.pick} />
              {logo.picture && (
                <button type="button" className="text-link" onClick={logo.remove}>
                  Remove
                </button>
              )}
            </div>
          )}
          {logo.error && (
            <p role="alert" className="field-error">
              {logo.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   hero: ReturnType<typeof import('../lib/uploads.js').usePicture>,
 *   alt: string, credit: string,
 *   onAlt: (v: string) => void, onCredit: (v: string) => void,
 *   errors: { heroAlt?: string, heroCredit?: string },
 * }} props
 */
export function HeroField({ hero, alt, credit, onAlt, onCredit, errors }) {
  return (
    <div className="stack-xs picture-field" role="group" aria-labelledby="hero-h">
      <h4 id="hero-h" className="h-sm">
        Hero photo
      </h4>
      {hero.upload && <Uploading upload={hero.upload} onCancel={hero.cancel} />}
      {!hero.upload && !hero.picture && (
        <PickButton
          label="Add a hero photo"
          className="drop-zone__button drop-zone"
          onPick={hero.pick}
        >
          <strong>Add a hero photo</strong>
          <span className="small muted">Using your style’s pattern until then</span>
        </PickButton>
      )}
      {hero.picture && (
        <div className="hero-field">
          <div className="stack-xs">
            <img className="hero-preview" src={hero.picture.small} alt="Your hero photo" />
            {!hero.upload && (
              <div className="row-wrap">
                <PickButton label="Replace photo" onPick={hero.pick} />
                <button type="button" className="text-link" onClick={hero.remove}>
                  Remove
                </button>
              </div>
            )}
          </div>
          <div className="stack-sm">
            <label className="field">
              Describe the photo
              <input
                className="input"
                type="text"
                value={alt}
                onChange={(e) => onAlt(e.target.value)}
                aria-invalid={Boolean(errors.heroAlt)}
              />
              <span className="small muted plain">
                Needed: screen readers read it to guests who can’t see the photo.
              </span>
              {errors.heroAlt && <span className="field-error plain">{errors.heroAlt}</span>}
            </label>
            <label className="field">
              Credit (optional)
              <input
                className="input"
                type="text"
                value={credit}
                onChange={(e) => onCredit(e.target.value)}
                aria-invalid={Boolean(errors.heroCredit)}
              />
              <span className="small muted plain">
                If someone else took it. Shown small under the photo.
              </span>
              {errors.heroCredit && <span className="field-error plain">{errors.heroCredit}</span>}
            </label>
          </div>
        </div>
      )}
      {hero.error && (
        <p role="alert" className="field-error">
          {hero.error}
        </p>
      )}
    </div>
  );
}
