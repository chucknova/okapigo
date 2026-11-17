// @ts-check
/**
 * Grey placeholder bars while something loads (designs: "A · Loading (3G can take seconds)").
 * Hidden from screen readers; the surrounding region says "Loading…" instead.
 * @param {{ width?: string | number, height?: number, pill?: boolean }} props
 */
export function Bar({ width = '100%', height = 12, pill = false }) {
  return (
    <span
      className="okg-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: pill ? 'var(--radius-pill)' : 6 }}
    />
  );
}
