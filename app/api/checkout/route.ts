import { EMAIL_RE, str } from "@/lib/campaign";
import { HOLD_SECONDS, assertLiveConfig, mode, stripeConfigured } from "@/lib/server/env";
import { markPaid } from "@/lib/server/payments";
import { createCheckoutSession } from "@/lib/server/stripe";
import { StoreError, store } from "@/lib/store";

/* ============================================================
   CARD CHECKOUT

   POST { positionId, email, brand }

   1. reserve the position (open -> held, 30 minutes)
   2. build a Stripe Checkout Session from the reservation
   3. send the buyer to it

   The hold is what stops two buyers paying for the same position while
   both are on the Stripe page. Before this hold existed, that happened.

   In demo mode there is no Stripe: the reservation is marked paid on
   the spot through the same markPaid() the webhook uses, so the demo
   exercises the real write path.
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLiveConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const positionId = str(body.positionId).trim();
  const email = str(body.email).trim().toLowerCase();
  const brand = str(body.brand).trim().slice(0, 80);
  if (!positionId) return Response.json({ error: "Which position?" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: "That email does not look right." }, { status: 400 });
  if (!brand) return Response.json({ error: "Add your brand or company." }, { status: 400 });

  const position = await store().getPosition(positionId);
  if (!position) return Response.json({ error: "No such position." }, { status: 404 });
  const campaign = await store().getCampaignById(position.campaignId);
  if (!campaign) return Response.json({ error: "No such campaign." }, { status: 404 });

  const demo = mode() === "demo";
  if (!demo && !stripeConfigured()) {
    return Response.json({ error: "Card payments are not switched on for this site." }, { status: 503 });
  }
  if (!demo && !campaign.stripeAccountId) {
    return Response.json(
      { error: "This athlete has not connected a Stripe account yet, so card payments are off for now." },
      { status: 409 },
    );
  }

  let reservation;
  try {
    reservation = await store().reserve({
      positionId,
      provider: demo ? "demo" : "stripe",
      payer: email,
      brand,
      holdSeconds: demo ? HOLD_SECONDS.demo : HOLD_SECONDS.stripe,
    });
  } catch (err) {
    if (err instanceof StoreError && err.code === "sold") {
      return Response.json({ error: "Someone got there first. That position has sold." }, { status: 409 });
    }
    if (err instanceof StoreError && err.code === "held") {
      return Response.json(
        { error: "Someone is paying for that position right now. Try again in a few minutes if it comes back." },
        { status: 409 },
      );
    }
    console.error("[checkout] reserve failed:", err);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  if (demo) {
    await markPaid({
      reference: reservation.reference,
      provider: "demo",
      providerRef: `demo:${reservation.reference}`,
      amountCents: reservation.amountCents,
      raw: { email, brand },
    });
    return Response.json({ url: `/c/${campaign.slug}?paid=${reservation.reference}` });
  }

  try {
    const session = await createCheckoutSession(campaign, position, reservation);
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    return Response.json({ url: session.url });
  } catch (err) {
    // no session, no hold: put the position straight back on sale
    await store().releaseHold(reservation.reference).catch(() => {});
    console.error(`[checkout] could not start checkout for ${reservation.reference}:`, err);
    return Response.json({ error: "Could not start checkout. Try again in a moment." }, { status: 502 });
  }
}
