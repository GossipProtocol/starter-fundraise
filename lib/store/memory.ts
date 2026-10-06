import { randomUUID } from "node:crypto";
import type { Campaign, NewCampaign, Position, Reservation } from "../campaign";
import { slugify } from "../campaign";
import { splitCents } from "../course-fee";
import { ITEMS, SPORT_DEFAULTS } from "../presets";
import { newReference } from "./reference";
import { StoreError } from "./types";
import type { CommitInput, CommitResult, ReserveInput, Store, UnmatchedPayment } from "./types";

/* ============================================================
   MEMORY STORE (demo mode)

   Lives for the life of the dev server. Seeded with one campaign built
   from the Triathlon preset so the campaign page has something to show.
   The same invariants as the SQL hold here, written out in plain code
   so you can read the rules without reading Postgres:

     - a position is sold only through commitPayment, and only once
     - a sold position always points at the reservation that paid for it
     - a hold has an expiry and an expired hold is an open position
   ============================================================ */

type Row = Position & { soldReservationId: string | null; holdReservationId: string | null };

const campaigns = new Map<string, Campaign>();
const emails = new Map<string, string>();
const positions = new Map<string, Row>();
const reservations = new Map<string, Reservation>();
const unmatched: UnmatchedPayment[] = [];

const now = () => new Date();
const iso = (d: Date) => d.toISOString();

function expireHolds(): void {
  const t = now().getTime();
  for (const p of positions.values()) {
    if (p.status === "held" && p.holdExpiresAt && Date.parse(p.holdExpiresAt) <= t) {
      p.status = "open";
      p.holdExpiresAt = null;
      const r = p.holdReservationId ? reservations.get(p.holdReservationId) : null;
      if (r && r.status === "held") r.status = "expired";
      p.holdReservationId = null;
    }
  }
}

function publicPosition(p: Row): Position {
  const { soldReservationId: _s, holdReservationId: _h, ...rest } = p;
  return { ...rest };
}

function uniqueSlug(base: string): string {
  let slug = base;
  let i = 2;
  while ([...campaigns.values()].some((c) => c.slug === slug)) slug = `${base}-${i++}`;
  return slug;
}

export const DEMO_SLUG = "demo";

function seed(): void {
  if (campaigns.size) return;
  const id = randomUUID();
  const campaign: Campaign = {
    id,
    slug: DEMO_SLUG,
    athlete: "Demo Athlete",
    sport: "Triathlon",
    event: "A half distance race, next season",
    city: "Your city",
    story:
      "This is the demo campaign. Every claim here is free and marks the position sold through the same code path the live site uses, minus the payment.",
    stripeAccountId: null,
    payoutAddress: null,
    createdAt: iso(now()),
  };
  campaigns.set(id, campaign);
  emails.set(id, "demo@example.com");
  let n = 1;
  for (const key of SPORT_DEFAULTS.Triathlon) {
    const item = ITEMS.find((i) => i.key === key);
    if (!item) continue;
    for (const p of item.positions) {
      positions.set(randomUUID(), {
        id: "",
        campaignId: id,
        n: n++,
        item: item.name,
        name: p.name,
        size: p.size,
        priceCents: p.price * 100,
        status: "open",
        holdExpiresAt: null,
        soldReservationId: null,
        holdReservationId: null,
      });
    }
  }
  for (const [pid, p] of positions) p.id = pid;
}

export const memoryStore: Store = {
  kind: "memory",

  async getCampaign(slug) {
    seed();
    return [...campaigns.values()].find((c) => c.slug === slug) ?? null;
  },

  async getCampaignById(id) {
    seed();
    return campaigns.get(id) ?? null;
  },

  async getPositions(campaignId) {
    seed();
    expireHolds();
    return [...positions.values()]
      .filter((p) => p.campaignId === campaignId)
      .sort((a, b) => a.n - b.n)
      .map(publicPosition);
  },

  async getPosition(id) {
    seed();
    expireHolds();
    const p = positions.get(id);
    return p ? publicPosition(p) : null;
  },

  async createCampaign(input: NewCampaign) {
    seed();
    const id = randomUUID();
    const campaign: Campaign = {
      id,
      slug: uniqueSlug(slugify(input.athlete)),
      athlete: input.athlete,
      sport: input.sport,
      event: input.event,
      city: input.city,
      story: input.story,
      stripeAccountId: null,
      payoutAddress: null,
      createdAt: iso(now()),
    };
    campaigns.set(id, campaign);
    emails.set(id, input.email);
    input.positions.forEach((p, i) => {
      const pid = randomUUID();
      positions.set(pid, {
        id: pid,
        campaignId: id,
        n: i + 1,
        item: p.item,
        name: p.name,
        size: p.size,
        priceCents: p.priceDollars * 100,
        status: "open",
        holdExpiresAt: null,
        soldReservationId: null,
        holdReservationId: null,
      });
    });
    return campaign;
  },

  async setPayout(campaignId, payout) {
    const c = campaigns.get(campaignId);
    if (!c) throw new StoreError("not_found");
    if (payout.stripeAccountId !== undefined) c.stripeAccountId = payout.stripeAccountId;
    if (payout.payoutAddress !== undefined) c.payoutAddress = payout.payoutAddress;
  },

  async getCampaignEmail(campaignId) {
    return emails.get(campaignId) ?? null;
  },

  async reserve(input: ReserveInput) {
    seed();
    expireHolds();
    const p = positions.get(input.positionId);
    if (!p) throw new StoreError("not_found");
    if (p.status === "sold") throw new StoreError("sold");
    if (p.status === "held") throw new StoreError("held");

    const { fee } = splitCents(p.priceCents);
    const expires = new Date(now().getTime() + input.holdSeconds * 1000);
    const r: Reservation = {
      id: randomUUID(),
      reference: newReference(),
      campaignId: p.campaignId,
      positionId: p.id,
      provider: input.provider,
      payer: input.payer,
      brand: input.brand,
      amountCents: p.priceCents,
      feeCents: fee,
      status: "held",
      providerRef: null,
      expiresAt: iso(expires),
      paidAt: null,
      createdAt: iso(now()),
    };
    reservations.set(r.id, r);
    p.status = "held";
    p.holdExpiresAt = r.expiresAt;
    p.holdReservationId = r.id;
    return { ...r };
  },

  async getReservation(reference) {
    const r = [...reservations.values()].find((x) => x.reference === reference);
    return r ? { ...r } : null;
  },

  async commitPayment(input: CommitInput): Promise<CommitResult> {
    const r = [...reservations.values()].find((x) => x.reference === input.reference);
    if (!r) throw new StoreError("not_found", `no reservation ${input.reference}`);
    const p = positions.get(r.positionId);
    if (!p) throw new StoreError("not_found");

    // the same payment delivered twice counts once
    if (r.status === "paid") {
      if (r.providerRef === input.providerRef) {
        return { reservation: { ...r }, position: publicPosition(p), alreadyPaid: true };
      }
      throw new StoreError("already_paid_elsewhere", `reservation ${r.reference} was paid by ${r.providerRef}`);
    }
    // a different providerRef already used on another reservation
    for (const other of reservations.values()) {
      if (other.id !== r.id && other.providerRef === input.providerRef) {
        throw new StoreError("already_paid_elsewhere", `${input.providerRef} already paid ${other.reference}`);
      }
    }
    if (input.amountCents !== r.amountCents) {
      throw new StoreError("amount_mismatch", `expected ${r.amountCents} cents, got ${input.amountCents}`);
    }
    // the hold may have lapsed while the buyer was at the checkout page.
    // Money arrived, so the position is theirs unless someone else paid.
    if (p.status === "sold" && p.soldReservationId !== r.id) throw new StoreError("sold");

    r.status = "paid";
    r.providerRef = input.providerRef;
    r.paidAt = iso(now());
    p.status = "sold";
    p.soldReservationId = r.id;
    p.holdReservationId = null;
    p.holdExpiresAt = null;
    return { reservation: { ...r }, position: publicPosition(p), alreadyPaid: false };
  },

  async releaseHold(reference) {
    const r = [...reservations.values()].find((x) => x.reference === reference);
    if (!r || r.status !== "held") return;
    r.status = "cancelled";
    const p = positions.get(r.positionId);
    if (p && p.status === "held" && p.holdReservationId === r.id) {
      p.status = "open";
      p.holdExpiresAt = null;
      p.holdReservationId = null;
    }
  },

  async recordUnmatched(input) {
    unmatched.push(input);
    console.warn("[unmatched payment]", input.provider, input.providerRef, input.reason);
  },
};
