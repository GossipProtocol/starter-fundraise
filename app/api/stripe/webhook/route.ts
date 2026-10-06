import Stripe from "stripe";
import { str } from "@/lib/campaign";
import { markPaid } from "@/lib/server/payments";
import { stripe } from "@/lib/server/stripe";
import { StoreError, store } from "@/lib/store";

/* ============================================================
   STRIPE WEBHOOK

   Stripe says a session has been paid, the reference in its metadata
   finds the reservation, and markPaid() turns the position sold.

   Three things matter here:
     - the raw body, not parsed JSON, or the signature will not verify
     - return 200 fast, and 500 on a failed write so Stripe retries
     - markPaid() is idempotent on the session id, so a retry after a
       success changes nothing
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !signingSecret) {
    console.error("[webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing");
    return new Response("stripe not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing stripe-signature", { status: 400 });

  // raw body. Do not req.json() this: the signature covers the exact bytes.
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(payload, signature, signingSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[webhook] signature verification failed:", message);
    return new Response(`signature verification failed: ${message}`, { status: 400 });
  }

  // the buyer closed the Stripe page or the session timed out: free the hold
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const reference = str(session.metadata?.reference);
    if (reference) await store().releaseHold(reference).catch(() => {});
    return new Response("released", { status: 200 });
  }

  // Cards clear inside checkout.session.completed. Slower methods clear
  // later, under async_payment_succeeded, and are just as paid.
  const relevant =
    event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  if (!relevant) return new Response("ignored", { status: 200 });

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status === "unpaid") return new Response("not paid yet", { status: 200 });

  const reference = str(session.metadata?.reference);
  const amountCents = Number(session.amount_total ?? 0);
  const payer = str(session.customer_details?.email);

  // A payment with no reference came from somewhere else: a manual link,
  // an invoice, an old session. Money changed hands, so keep it where the
  // admin can see it rather than acknowledging and forgetting.
  if (!reference) {
    await store().recordUnmatched({
      provider: "stripe",
      providerRef: session.id,
      payer,
      amountCents,
      reason: "no reference on the session",
      raw: session,
    });
    return new Response("recorded as unmatched", { status: 200 });
  }

  try {
    await markPaid({ reference, provider: "stripe", providerRef: session.id, amountCents, raw: session });
  } catch (err) {
    if (err instanceof StoreError) {
      // the reservation is gone, sold to someone else, or the amount is
      // off. Retrying will not change that; record it for a human.
      await store().recordUnmatched({
        provider: "stripe",
        providerRef: session.id,
        payer,
        amountCents,
        reason: `${err.code}: ${err.message}`,
        raw: session,
      });
      return new Response(`recorded as unmatched (${err.code})`, { status: 200 });
    }
    // 500 so Stripe retries. A position that stays available after
    // someone paid for it is the one bug worth a retry storm.
    console.error(`[webhook] could not mark ${reference} paid:`, err);
    return new Response("could not write sold state", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
