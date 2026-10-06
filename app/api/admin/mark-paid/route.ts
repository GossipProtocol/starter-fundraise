import { str } from "@/lib/campaign";
import { isAdmin } from "@/lib/server/admin";
import { HOLD_SECONDS, assertLiveConfig } from "@/lib/server/env";
import { markPaid } from "@/lib/server/payments";
import { StoreError, store } from "@/lib/store";

/* ============================================================
   MANUAL MARK

   POST { positionId, payer, brand, note }  with  x-admin-key

   For a position paid outside the site: a bank transfer, a trade, a
   dry run. It reserves and then calls the same markPaid() the webhook
   calls, one position per call, with the note as the providerRef so a
   repeated note cannot mark a second position. There is no route that
   marks a whole campaign sold, on purpose.
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: "not allowed" }, { status: 403 });
  try {
    assertLiveConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const positionId = str(body.positionId).trim();
  const note = str(body.note).trim();
  if (!positionId) return Response.json({ error: "positionId is required" }, { status: 400 });
  if (note.length < 4) return Response.json({ error: "note is required: say where the money came from" }, { status: 400 });

  try {
    const reservation = await store().reserve({
      positionId,
      provider: "manual",
      payer: str(body.payer).trim(),
      brand: str(body.brand).trim(),
      holdSeconds: HOLD_SECONDS.manual,
    });
    const result = await markPaid({
      reference: reservation.reference,
      provider: "manual",
      providerRef: `manual:${note}`,
      amountCents: reservation.amountCents,
      raw: { note, by: "admin" },
    });
    return Response.json({ ok: true, reference: reservation.reference, position: result.position.n });
  } catch (err) {
    if (err instanceof StoreError) return Response.json({ error: err.code }, { status: 409 });
    console.error("[admin/mark-paid]", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
