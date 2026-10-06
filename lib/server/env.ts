import { courseFeeConfigured } from "../course-fee";

/* ============================================================
   MODE

   Demo mode is the default and needs no env. Live mode switches on
   with SUPABASE_URL. Each payment rail then switches on with its own
   group: Stripe keys for cards, Privy plus an RPC URL for USDC.

   Live mode refuses to run while the course fee recipient is still the
   placeholder. instrumentation.ts calls assertLiveConfig() at boot, and
   every money route calls it again, so a deploy with the fee unset fails
   loudly instead of quietly taking payments without it.
   ============================================================ */

export type Mode = "demo" | "live";

export function mode(): Mode {
  return process.env.SUPABASE_URL ? "live" : "demo";
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function usdcConfigured(): boolean {
  return Boolean(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET && process.env.USDC_RPC_URL);
}

export function assertLiveConfig(): void {
  if (mode() !== "live") return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Live mode: SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
  if (!courseFeeConfigured()) {
    throw new Error(
      "Live mode: COURSE_FEE_RECIPIENT in lib/course-fee.ts is still the placeholder. Set the course fee wallet before taking payments.",
    );
  }
}

/** How long a position is held while the buyer pays. Stripe Checkout
 *  sessions cannot expire sooner than 30 minutes, so the card hold matches
 *  that; the USDC hold is shorter because the buyer is already signed in
 *  with a funded wallet. */
export const HOLD_SECONDS = { stripe: 30 * 60, usdc: 15 * 60, demo: 5 * 60, manual: 24 * 60 * 60 } as const;
