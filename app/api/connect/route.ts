import { revalidatePath } from "next/cache";
import { str } from "@/lib/campaign";
import { assertLiveConfig, stripeConfigured } from "@/lib/server/env";
import { privyConfigured, viewerFrom } from "@/lib/server/privy";
import { createConnectOnboarding } from "@/lib/server/stripe";
import { store } from "@/lib/store";

/* ============================================================
   ATHLETE PAYOUTS

   POST { slug, action: "stripe" }                       -> { url }
   POST { slug, action: "usdc", payoutAddress: "0x..." } -> { ok }

   The athlete proves they own the campaign by signing in with Privy
   using the email they published with. Stripe Connect onboarding is
   hosted by Stripe; the USDC payout address is a plain EVM address.
   ============================================================ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLiveConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!privyConfigured()) {
    return Response.json({ error: "Sign in is not switched on for this site, so payouts cannot be set here." }, { status: 503 });
  }

  const viewer = await viewerFrom(req);
  if (!viewer?.email) return Response.json({ error: "Sign in with the email you published with." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = str(body.slug).trim();
  const campaign = await store().getCampaign(slug);
  if (!campaign) return Response.json({ error: "No such campaign." }, { status: 404 });

  const owner = await store().getCampaignEmail(campaign.id);
  if (!owner || owner !== viewer.email) {
    return Response.json({ error: "That email did not publish this campaign." }, { status: 403 });
  }

  const action = str(body.action);

  if (action === "stripe") {
    if (!stripeConfigured()) return Response.json({ error: "Stripe is not configured." }, { status: 503 });
    try {
      const { accountId, url } = await createConnectOnboarding(campaign, owner);
      if (accountId !== campaign.stripeAccountId) {
        await store().setPayout(campaign.id, { stripeAccountId: accountId });
      }
      revalidatePath(`/c/${campaign.slug}`);
      return Response.json({ url });
    } catch (err) {
      console.error("[connect] stripe onboarding failed:", err);
      return Response.json({ error: "Could not start Stripe onboarding." }, { status: 502 });
    }
  }

  if (action === "usdc") {
    const address = str(body.payoutAddress).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) {
      return Response.json({ error: "That does not look like an EVM address." }, { status: 400 });
    }
    await store().setPayout(campaign.id, { payoutAddress: address });
    revalidatePath(`/c/${campaign.slug}`);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
