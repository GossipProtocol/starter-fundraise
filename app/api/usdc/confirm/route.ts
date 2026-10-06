import { str } from "@/lib/campaign";
import { assertLiveConfig, usdcConfigured } from "@/lib/server/env";
import { markPaid } from "@/lib/server/payments";
import { viewerFrom } from "@/lib/server/privy";
import { matchLegs, transfersFrom, usdcLegs } from "@/lib/server/usdc";
import { REFERENCE_RE } from "@/lib/store/reference";
import { StoreError, store } from "@/lib/store";

/* ============================================================
   USDC, STEP TWO: CONFIRM

   POST { reference, txHashes: string[] }  with  Authorization: Bearer <privy token>

   Reads the receipts, matches the USDC Transfer logs against the two
   legs the reservation requires, and calls markPaid() with the athlete
   leg's hash as the providerRef. A second confirm with the same hashes
   returns the same answer and writes nothing.
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLiveConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!usdcConfigured()) {
    return Response.json({ error: "USDC payments are not switched on for this site." }, { status: 503 });
  }

  const viewer = await viewerFrom(req);
  if (!viewer?.wallet) return Response.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reference = str(body.reference).trim().toUpperCase();
  const txHashes = Array.isArray(body.txHashes) ? body.txHashes.map(str).slice(0, 4) : [];
  if (!REFERENCE_RE.test(reference)) return Response.json({ error: "Bad reference." }, { status: 400 });
  if (txHashes.length === 0) return Response.json({ error: "No transaction hashes." }, { status: 400 });

  const reservation = await store().getReservation(reference);
  if (!reservation || reservation.provider !== "usdc") {
    return Response.json({ error: "No such reservation." }, { status: 404 });
  }
  // only the wallet that reserved can confirm, and only its transfers count
  if (reservation.payer.toLowerCase() !== viewer.wallet.toLowerCase()) {
    return Response.json({ error: "That reservation belongs to a different wallet." }, { status: 403 });
  }
  if (reservation.status === "paid") {
    return Response.json({ ok: true, reference, alreadyPaid: true });
  }

  const campaign = await store().getCampaignById(reservation.campaignId);
  if (!campaign) return Response.json({ error: "No such campaign." }, { status: 404 });

  let transfers;
  try {
    transfers = await transfersFrom(txHashes, viewer.wallet);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const { legs } = usdcLegs(campaign, reservation);
  const match = matchLegs(transfers, legs);
  if (!match.ok) {
    return Response.json(
      { error: `The ${match.missing} transfer was not found in those transactions. Send it and confirm again.` },
      { status: 402 },
    );
  }

  try {
    const result = await markPaid({
      reference,
      provider: "usdc",
      providerRef: match.primary,
      amountCents: reservation.amountCents,
      raw: { txHashes, transfers: transfers.map((t) => ({ ...t, value: t.value.toString(), blockNumber: t.blockNumber.toString() })) },
    });
    return Response.json({ ok: true, reference, alreadyPaid: result.alreadyPaid, slug: campaign.slug });
  } catch (err) {
    if (err instanceof StoreError) {
      await store().recordUnmatched({
        provider: "usdc",
        providerRef: match.primary,
        payer: viewer.wallet,
        amountCents: reservation.amountCents,
        reason: `${err.code}: ${err.message}`,
        raw: { txHashes },
      });
      return Response.json(
        { error: "The payment went through but the position could not be assigned. The athlete has been told; you will be contacted." },
        { status: 409 },
      );
    }
    console.error("[usdc/confirm] failed:", err);
    return Response.json({ error: "Could not record the payment. Confirm again in a moment." }, { status: 500 });
  }
}
