/**
 * Indian-style counts. Small numbers keep lakh/crore grouping (12,34,567 is
 * still exact under a lakh); bigger ones are shortened to lakh (L) and crore
 * (Cr) so the UI reads naturally at national scale.
 */
const exact = new Intl.NumberFormat("en-IN");
const oneDecimal = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function formatCount(n: number) {
  if (n >= 1e7) return `${oneDecimal.format(n / 1e7)} Cr`;
  if (n >= 1e5) return `${oneDecimal.format(n / 1e5)} L`;
  return exact.format(n);
}

/** Rounded down, for claims like "1.2 Cr+ buildings" that must stay true. */
export function formatAtLeast(n: number) {
  const floor = (x: number) => Math.floor(x * 10) / 10;
  if (n >= 1e7) return `${oneDecimal.format(floor(n / 1e7))} Cr+`;
  if (n >= 1e5) return `${oneDecimal.format(floor(n / 1e5))} L+`;
  return exact.format(n);
}

/** Map cluster bubbles have room for about four characters. */
export function formatShort(n: number) {
  if (n >= 1e7) return `${Math.floor(n / 1e6) / 10}Cr`;
  if (n >= 1e5) return `${Math.floor(n / 1e4) / 10}L`;
  if (n >= 1e3) return `${Math.floor(n / 100) / 10}k`;
  return String(n);
}

/**
 * A lower bound for a count known to be incomplete, as a round number with "+":
 * 7 → "7+", 57 → "50+", 373 → "300+", 1,234 → "1.2k+". Never overstates.
 */
export function formatShortAtLeast(n: number) {
  if (n < 10) return `${n}+`;
  if (n < 1000) {
    const step = n < 100 ? 10 : 100;
    return `${Math.floor(n / step) * step}+`;
  }
  return `${formatShort(n)}+`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
