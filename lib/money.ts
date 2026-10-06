/** Whole dollars from cents, grouped. Every price on a board is a round
 *  dollar amount, so cents are only ever shown when a fee split leaves some. */
export function money(cents: number): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return (
    "$" +
    dollars.toLocaleString("en-US", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** USDC base units (6 decimals) from cents. Exact: 1 cent = 10,000 units. */
export function centsToUsdcUnits(cents: number): bigint {
  return BigInt(cents) * 10_000n;
}

/** Human USDC amount from base units, for the pay screen. */
export function usdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  const fracStr = frac === 0n ? "" : "." + frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fracStr} USDC`;
}

/** Percentage of a goal, clamped to the width of a track. */
export const pct = (part: number, whole: number): number =>
  whole <= 0 ? 0 : Math.max(0, Math.min(100, (part / whole) * 100));
