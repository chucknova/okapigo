// @ts-check
/**
 * The few icons the guest web uses, drawn inline (no icon font, no extra download).
 * Decorative by default (aria-hidden): the text next to an icon says what it means. An
 * icon-only button must have its own aria-label.
 */
const PATHS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.8" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  share: (
    <>
      <path d="M12 3v12" />
      <path d="M7.5 7.5L12 3l4.5 4.5" />
      <path d="M5 13v6h14v-6" />
    </>
  ),
};

/**
 * @param {{ name: keyof typeof PATHS, size?: number }} props
 */
export function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
