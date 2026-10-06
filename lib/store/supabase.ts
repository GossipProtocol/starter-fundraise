import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Campaign, NewCampaign, Position, Reservation } from "../campaign";
import { int, slugify, str } from "../campaign";
import { splitCents } from "../course-fee";
import { newReference } from "./reference";
import { StoreError } from "./types";
import type { CommitInput, CommitResult, ReserveInput, Store, UnmatchedPayment } from "./types";

/* ============================================================
   SUPABASE STORE (live mode)

   Server only: this file holds the service role key. Reads are plain
   selects. Every write that touches money state goes through one of the
   SQL functions in docs/schema.sql, so the row lock and the invariants
   live next to the data and not in five places in TypeScript.

   Every row that comes back is passed through a normaliser. The database
   client is not trusted to return the types the schema promises, because
   the last store this code lived on turned "11" into 11 and a sold
   position stayed on sale.
   ============================================================ */

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in live mode");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

/* ---------- normalisers ---------- */

function campaignRow(r: Record<string, unknown>): Campaign {
  return {
    id: str(r.id),
    slug: str(r.slug),
    athlete: str(r.athlete),
    sport: str(r.sport),
    event: str(r.event),
    city: str(r.city),
    story: str(r.story),
    stripeAccountId: r.stripe_account_id ? str(r.stripe_account_id) : null,
    payoutAddress: r.payout_address ? str(r.payout_address) : null,
    createdAt: str(r.created_at),
  };
}

function positionRow(r: Record<string, unknown>): Position {
  const status = str(r.status);
  if (status !== "open" && status !== "held" && status !== "sold") {
    throw new Error(`position ${str(r.id)} has an unknown status ${status}`);
  }
  return {
    id: str(r.id),
    campaignId: str(r.campaign_id),
    n: int(r.n, "position n"),
    item: str(r.item),
    name: str(r.name),
    size: str(r.size),
    priceCents: int(r.price_cents, "price_cents"),
    status,
    holdExpiresAt: r.hold_expires_at ? str(r.hold_expires_at) : null,
  };
}

function reservationRow(r: Record<string, unknown>): Reservation {
  return {
    id: str(r.id),
    reference: str(r.reference),
    campaignId: str(r.campaign_id),
    positionId: str(r.position_id),
    provider: str(r.provider) as Reservation["provider"],
    payer: str(r.payer),
    brand: str(r.brand),
    amountCents: int(r.amount_cents, "amount_cents"),
    feeCents: int(r.fee_cents, "fee_cents"),
    status: str(r.status) as Reservation["status"],
    providerRef: r.provider_ref ? str(r.provider_ref) : null,
    expiresAt: str(r.expires_at),
    paidAt: r.paid_at ? str(r.paid_at) : null,
    createdAt: str(r.created_at),
  };
}

/** Map a `raise exception 'code'` from SQL onto a StoreError. */
function storeError(message: string): StoreError | null {
  const codes: StoreError["code"][] = ["sold", "held", "not_found", "already_paid_elsewhere", "amount_mismatch"];
  const hit = codes.find((c) => message.includes(c));
  return hit ? new StoreError(hit, message) : null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw storeError(error.message) ?? new Error(`${fn}: ${error.message}`);
  return data as T;
}

/* ---------- the store ---------- */

export const supabaseStore: Store = {
  kind: "supabase",

  async getCampaign(slug) {
    const { data, error } = await db().from("campaigns").select("*").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return data ? campaignRow(data) : null;
  },

  async getCampaignById(id) {
    const { data, error } = await db().from("campaigns").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? campaignRow(data) : null;
  },

  async getPositions(campaignId) {
    await rpc("release_expired_holds", {});
    const { data, error } = await db()
      .from("positions")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("n", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(positionRow);
  },

  async getPosition(id) {
    await rpc("release_expired_holds", {});
    const { data, error } = await db().from("positions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? positionRow(data) : null;
  },

  async createCampaign(input: NewCampaign) {
    const row = await rpc<Record<string, unknown>>("create_campaign", {
      p: {
        slug: slugify(input.athlete),
        athlete: input.athlete,
        sport: input.sport,
        event: input.event,
        city: input.city,
        story: input.story,
        email: input.email,
        positions: input.positions.map((p) => ({
          item: p.item,
          name: p.name,
          size: p.size,
          priceCents: p.priceDollars * 100,
        })),
      },
    });
    return campaignRow(row);
  },

  async setPayout(campaignId, payout) {
    const patch: Record<string, unknown> = {};
    if (payout.stripeAccountId !== undefined) patch.stripe_account_id = payout.stripeAccountId;
    if (payout.payoutAddress !== undefined) patch.payout_address = payout.payoutAddress;
    const { error } = await db().from("campaigns").update(patch).eq("id", campaignId);
    if (error) throw error;
  },

  async getCampaignEmail(campaignId) {
    const { data, error } = await db()
      .from("campaign_private")
      .select("email")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (error) throw error;
    return data ? str(data.email) : null;
  },

  async reserve(input: ReserveInput) {
    const position = await this.getPosition(input.positionId);
    if (!position) throw new StoreError("not_found");
    const { fee } = splitCents(position.priceCents);
    const row = await rpc<Record<string, unknown>>("reserve_position", {
      p_position: input.positionId,
      p_provider: input.provider,
      p_payer: input.payer,
      p_brand: input.brand,
      p_reference: newReference(),
      p_fee_cents: fee,
      p_hold_seconds: input.holdSeconds,
    });
    return reservationRow(row);
  },

  async getReservation(reference) {
    const { data, error } = await db().from("reservations").select("*").eq("reference", reference).maybeSingle();
    if (error) throw error;
    return data ? reservationRow(data) : null;
  },

  async commitPayment(input: CommitInput): Promise<CommitResult> {
    const before = await this.getReservation(input.reference);
    const row = await rpc<Record<string, unknown>>("mark_position_paid", {
      p_reference: input.reference,
      p_provider: input.provider,
      p_provider_ref: input.providerRef,
      p_amount_cents: input.amountCents,
      p_raw: input.raw ?? null,
    });
    const reservation = reservationRow(row);
    const position = await this.getPosition(reservation.positionId);
    if (!position) throw new StoreError("not_found");
    return {
      reservation,
      position,
      alreadyPaid: before?.status === "paid" && before.providerRef === input.providerRef,
    };
  },

  async releaseHold(reference) {
    await rpc("release_hold", { p_reference: reference });
  },

  async recordUnmatched(input: UnmatchedPayment) {
    const { error } = await db().from("unmatched_payments").upsert(
      {
        provider: input.provider,
        provider_ref: input.providerRef,
        payer: input.payer,
        amount_cents: input.amountCents,
        reason: input.reason,
        raw: input.raw ?? null,
      },
      { onConflict: "provider_ref" },
    );
    if (error) throw error;
  },
};
