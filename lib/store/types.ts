import type { Campaign, NewCampaign, Position, Provider, Reservation } from "../campaign";

/* ============================================================
   THE STORE BOUNDARY

   Two implementations: memory (demo mode, no env) and Supabase (live).
   Both expose the same calls so routes never know which one they talk
   to. Three calls change money state, and each is atomic inside the
   store:

     reserve        open -> held, with an expiry. Throws "sold" or "held".
     commitPayment  held (or expired) -> sold, once. Idempotent on
                    providerRef. ONLY lib/server/payments.ts calls this.
     releaseHold    held -> open, for an expired or abandoned checkout.
   ============================================================ */

export type ReserveInput = {
  positionId: string;
  provider: Provider;
  payer: string;
  brand: string;
  holdSeconds: number;
};

export type CommitInput = {
  reference: string;
  provider: Provider;
  /** Stripe session id, USDC tx hash, or an admin note. Unique. */
  providerRef: string;
  amountCents: number;
  /** Anything worth keeping for the receipt: the Stripe session, the tx
   *  receipts, the admin's reason. */
  raw: unknown;
};

export type CommitResult = {
  reservation: Reservation;
  position: Position;
  /** True when this exact providerRef had already been committed. The
   *  caller treats it as success and does nothing else. */
  alreadyPaid: boolean;
};

export type UnmatchedPayment = {
  provider: Provider;
  providerRef: string;
  payer: string;
  amountCents: number;
  reason: string;
  raw: unknown;
};

export interface Store {
  readonly kind: "memory" | "supabase";
  getCampaign(slug: string): Promise<Campaign | null>;
  getCampaignById(id: string): Promise<Campaign | null>;
  /** Positions in display order. Expired holds read as open. */
  getPositions(campaignId: string): Promise<Position[]>;
  getPosition(id: string): Promise<Position | null>;
  createCampaign(input: NewCampaign): Promise<Campaign>;
  setPayout(campaignId: string, payout: { stripeAccountId?: string | null; payoutAddress?: string | null }): Promise<void>;
  getCampaignEmail(campaignId: string): Promise<string | null>;
  reserve(input: ReserveInput): Promise<Reservation>;
  getReservation(reference: string): Promise<Reservation | null>;
  commitPayment(input: CommitInput): Promise<CommitResult>;
  releaseHold(reference: string): Promise<void>;
  recordUnmatched(input: UnmatchedPayment): Promise<void>;
}

/** Store errors with a stable code the routes can map to a message. */
export class StoreError extends Error {
  constructor(
    public readonly code: "sold" | "held" | "not_found" | "already_paid_elsewhere" | "amount_mismatch",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "StoreError";
  }
}
