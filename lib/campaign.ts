/* ============================================================
   CAMPAIGN TYPES AND VALIDATION

   Shared by the builder, the store and the API. Everything that leaves
   this module is normalised: ids are strings, money is integer cents,
   position numbers are integers. A store is never trusted to hand back
   the type it was given (see the first lesson in the README).
   ============================================================ */

import { MAX_POSITIONS, MAX_PRICE_DOLLARS, MIN_PRICE_DOLLARS, SPORTS } from "./presets";

export type PositionStatus = "open" | "held" | "sold";

export type Position = {
  id: string;
  campaignId: string;
  /** 1-based display number, unique within the campaign. */
  n: number;
  item: string;
  name: string;
  size: string;
  priceCents: number;
  status: PositionStatus;
  /** Set while a hold is live. ISO string. */
  holdExpiresAt: string | null;
};

export type Campaign = {
  id: string;
  slug: string;
  athlete: string;
  sport: string;
  event: string;
  city: string;
  story: string;
  /** Stripe Connect account that receives card payments. Null until the
   *  athlete finishes onboarding; card checkout is off until then. */
  stripeAccountId: string | null;
  /** EVM address that receives USDC payments. Null turns USDC off. */
  payoutAddress: string | null;
  createdAt: string;
};

export type Provider = "stripe" | "usdc" | "demo" | "manual";
export type ReservationStatus = "held" | "paid" | "expired" | "cancelled";

export type Reservation = {
  id: string;
  /** Short public code. Travels in Stripe metadata and in the USDC confirm
   *  call, and is how a payment finds its way back to a position. */
  reference: string;
  campaignId: string;
  positionId: string;
  provider: Provider;
  /** Email for card buyers, wallet address for USDC buyers. */
  payer: string;
  brand: string;
  amountCents: number;
  feeCents: number;
  status: ReservationStatus;
  /** Stripe session id, USDC tx hash, or the admin's note. Unique: the same
   *  payment can be delivered twice and must only count once. */
  providerRef: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
};

export type NewCampaign = {
  athlete: string;
  sport: string;
  event: string;
  city: string;
  story: string;
  email: string;
  positions: { item: string; name: string; size: string; priceDollars: number }[];
};

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Coerce whatever a store returns into a string id. Redis clients and
 *  loose JSON turn "11" into 11 and then a set lookup for "11" misses. */
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Coerce to a whole non-negative integer or throw. Money and counts only. */
export function int(v: unknown, label = "value"): number {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} is not a whole number: ${String(v)}`);
  return n;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "campaign";
}

/** Validate and normalise builder input. Throws with a short message the
 *  builder shows as is. Prices arrive in whole dollars and leave in cents. */
export function validateNewCampaign(raw: unknown): NewCampaign {
  const b = (raw ?? {}) as Record<string, unknown>;
  const athlete = str(b.athlete).trim().slice(0, 80);
  const sport = str(b.sport).trim();
  const email = str(b.email).trim().toLowerCase();
  if (!athlete) throw new Error("Add your name.");
  if (!(SPORTS as readonly string[]).includes(sport)) throw new Error("Pick a sport.");
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error("That email does not look right.");

  const list = Array.isArray(b.positions) ? b.positions : [];
  if (list.length === 0) throw new Error("Turn on an item and tick at least one position.");
  if (list.length > MAX_POSITIONS) throw new Error(`${MAX_POSITIONS} positions max across all items.`);

  const positions = list.map((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const priceDollars = Number(r.priceDollars ?? r.price);
    const name = str(r.name).trim().slice(0, 40);
    if (!name || !Number.isInteger(priceDollars) || priceDollars < MIN_PRICE_DOLLARS || priceDollars > MAX_PRICE_DOLLARS) {
      throw new Error(
        `Every ticked position needs a name and a whole-dollar price between $${MIN_PRICE_DOLLARS} and $${MAX_PRICE_DOLLARS.toLocaleString("en-US")}.`,
      );
    }
    return {
      item: str(r.item).trim().slice(0, 40),
      name,
      size: str(r.size).trim().slice(0, 40),
      priceDollars,
    };
  });

  return {
    athlete,
    sport,
    email,
    event: str(b.event).trim().slice(0, 120),
    city: str(b.city).trim().slice(0, 80),
    story: str(b.story).trim().slice(0, 600),
    positions,
  };
}

/* ---------- derived, never hand-typed ---------- */

export function raisedCents(positions: Position[]): number {
  return positions.filter((p) => p.status === "sold").reduce((s, p) => s + p.priceCents, 0);
}

export function totalCents(positions: Position[]): number {
  return positions.reduce((s, p) => s + p.priceCents, 0);
}

export function openCount(positions: Position[]): number {
  return positions.filter((p) => p.status === "open").length;
}

export const padN = (n: number): string => String(n).padStart(2, "0");
