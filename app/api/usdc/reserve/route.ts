import { str } from "@/lib/campaign";
import { HOLD_SECONDS, assertLiveConfig, usdcConfigured } from "@/lib/server/env";
import { viewerFrom } from "@/lib/server/privy";
import { usdcInstructions } from "@/lib/server/usdc";
import { StoreError, store } from "@/lib/store";

/* ============================================================
   USDC, STEP ONE: RESERVE

   POST { positionId, brand }  with  Authorization: Bearer <privy token>

   The payer is the embedded wallet on the verified Privy user, never an
   address from the body. The reservation stores it, and the confirm
   step only counts transfers from that wallet. The response is the pay
   sheet: which chain, which USDC contract, and the two legs to send.
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
  if (!viewer) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!viewer.wallet) return Response.json({ error: "Your account has no embedded wallet yet." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const positionId = str(body.positionId).trim();
  const brand = str(body.brand).trim().slice(0, 80);
  if (!positionId) return Response.json({ error: "Which position?" }, { status: 400 });
  if (!brand) return Response.json({ error: "Add your brand or company." }, { status: 400 });

  const position = await store().getPosition(positionId);
  if (!position) return Response.json({ error: "No such position." }, { status: 404 });
  const campaign = await store().getCampaignById(position.campaignId);
  if (!campaign) return Response.json({ error: "No such campaign." }, { status: 404 });
  if (!campaign.payoutAddress) {
    return Response.json({ error: "This athlete has not set a USDC payout address, so USDC is off for now." }, { status: 409 });
  }

  try {
    const reservation = await store().reserve({
      positionId,
      provider: "usdc",
      payer: viewer.wallet,
      brand,
      holdSeconds: HOLD_SECONDS.usdc,
    });
    return Response.json(usdcInstructions(campaign, reservation));
  } catch (err) {
    if (err instanceof StoreError && err.code === "sold") {
      return Response.json({ error: "Someone got there first. That position has sold." }, { status: 409 });
    }
    if (err instanceof StoreError && err.code === "held") {
      return Response.json({ error: "Someone is paying for that position right now." }, { status: 409 });
    }
    console.error("[usdc/reserve] failed:", err);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
