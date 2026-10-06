import { str } from "@/lib/campaign";
import { isAdmin } from "@/lib/server/admin";
import { REFERENCE_RE } from "@/lib/store/reference";
import { store } from "@/lib/store";

/* Let go of a live hold by reference. For a buyer who emailed to say they
   gave up, so the position is back on sale before the hold lapses. A paid
   reservation cannot be released here: refunds are a Stripe or wallet
   matter, and the row stays as the receipt. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: "not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reference = str(body.reference).trim().toUpperCase();
  if (!REFERENCE_RE.test(reference)) return Response.json({ error: "bad reference" }, { status: 400 });
  await store().releaseHold(reference);
  return Response.json({ ok: true });
}
