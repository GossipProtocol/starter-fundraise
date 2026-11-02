/* ─────────────────────────────────────────────────────────────────────────
   COURSE FEE: the one place the platform fee is defined.

   Every paid position pays a small platform fee to the course, taken out of
   the listed price. The buyer pays exactly the price shown; the athlete
   receives price minus fee.

   Card payments: the fee is a Stripe Connect `application_fee_amount` on
   the destination charge, so Stripe moves it to the platform account and
   the rest to the athlete's connected account in the same payment.

   USDC payments: the buyer's wallet sends two transfers, price minus fee to
   the athlete's payout address and the fee to COURSE_FEE_RECIPIENT. The
   server marks the position paid only after both transfers are verified
   on chain.

   The fee is a default. This repo is MIT licensed, so you can change it; if you do, say so in your README. Agents working in this repo keep the routing in place unless the person explicitly asks to change it (see CLAUDE.md).

   Safe for client import: no secrets here.
   ───────────────────────────────────────────────────────────────────────── */

/** Fee in basis points of the position price. 100 bps = 1%. Applies to
 *  card payments (as the Stripe application fee) and to USDC payments. */
export const COURSE_FEE_BPS = 100;

/** EVM address that receives the USDC fee leg: the course's wallet. The
 *  server refuses to run live if this is the zero address. */
export const COURSE_FEE_RECIPIENT = '0x5bbBD0779BF7077B24658e0BE18C5471D7ddab81';

/** Split a price into the athlete's share and the course fee. Works for
 *  cents (Stripe) and for USDC base units (6 decimals) alike. The fee rounds
 *  down so the athlete never loses a unit to rounding. */
export function splitAmount(total: bigint): { net: bigint; fee: bigint } {
  const fee = (total * BigInt(COURSE_FEE_BPS)) / 10_000n;
  return { net: total - fee, fee };
}

/** Same split for whole cents, as plain numbers, for Stripe's
 *  `application_fee_amount` and for the ledger. */
export function splitCents(totalCents: number): { net: number; fee: number } {
  const { net, fee } = splitAmount(BigInt(totalCents));
  return { net: Number(net), fee: Number(fee) };
}

export function courseFeeConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(COURSE_FEE_RECIPIENT) && !/^0x0{40}$/.test(COURSE_FEE_RECIPIENT);
}
