import Stripe from "stripe";
import type { Campaign, Position, Reservation } from "../campaign";
import { padN } from "../campaign";
import { COURSE_FEE_BPS } from "../course-fee";
import { SITE_NAME, resolveSiteUrl } from "../site";

/* ============================================================
   STRIPE, ON DEMAND

   Nothing exists in the Stripe dashboard ahead of time: no products, no
   prices, no payment links. A Checkout Session is built from the
   reservation at the moment the buyer clicks, and the session carries
   the reservation reference in its metadata so the webhook can find its
   way back.

   The charge is a Stripe Connect destination charge: the buyer pays the
   platform account, Stripe transfers the athlete's share to their
   connected account, and `application_fee_amount` keeps the course fee
   on the platform. One payment, one split, no second transfer to
   reconcile.
   ============================================================ */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

export async function createCheckoutSession(
  campaign: Campaign,
  position: Position,
  reservation: Reservation,
): Promise<Stripe.Checkout.Session> {
  if (!campaign.stripeAccountId) {
    throw new Error("this campaign has not connected a Stripe account yet");
  }
  const site = resolveSiteUrl();
  const back = `${site}/c/${campaign.slug}`;

  return stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: reservation.amountCents,
          product_data: {
            name: `${padN(position.n)} · ${position.name}`,
            description: `${position.item ? position.item + ", " : ""}${campaign.athlete}'s ${campaign.sport.toLowerCase()} campaign`,
          },
        },
      },
    ],
    payment_intent_data: {
      // the course fee, stated in lib/course-fee.ts. Stripe keeps it on
      // the platform account and sends the rest to the athlete.
      application_fee_amount: reservation.feeCents,
      transfer_data: { destination: campaign.stripeAccountId },
      description: `${SITE_NAME} ${reservation.reference}`,
    },
    // the webhook reads this to find the reservation. Stripe stores
    // metadata as strings, which is also how the reference is typed.
    metadata: { reference: reservation.reference, position: position.id, feeBps: String(COURSE_FEE_BPS) },
    client_reference_id: reservation.reference,
    customer_email: reservation.payer || undefined,
    custom_fields: [
      { key: "brand", label: { type: "custom", custom: "Brand name" }, type: "text" },
      { key: "contact", label: { type: "custom", custom: "Best email or X handle" }, type: "text" },
    ],
    // the hold and the session lapse together
    expires_at: Math.floor(Date.parse(reservation.expiresAt) / 1000),
    success_url: `${back}?paid=${reservation.reference}`,
    cancel_url: `${back}?cancelled=${reservation.reference}#positions`,
  });
}

/** Stripe Connect onboarding for an athlete. Creates an Express account
 *  the first time and returns a hosted onboarding link. */
export async function createConnectOnboarding(
  campaign: Campaign,
  email: string | null,
): Promise<{ accountId: string; url: string }> {
  const site = resolveSiteUrl();
  let accountId = campaign.stripeAccountId;
  if (!accountId) {
    const account = await stripe().accounts.create({
      type: "express",
      email: email ?? undefined,
      metadata: { campaign: campaign.id },
    });
    accountId = account.id;
  }
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${site}/c/${campaign.slug}/connect?refresh=1`,
    return_url: `${site}/c/${campaign.slug}?connected=1`,
  });
  return { accountId, url: link.url };
}
