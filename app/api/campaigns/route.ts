import { validateNewCampaign } from "@/lib/campaign";
import { assertLiveConfig } from "@/lib/server/env";
import { store } from "@/lib/store";

/* Publish a campaign. No account: the athlete's email goes into the
   private table and is how they later prove ownership at /c/<slug>/connect. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertLiveConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  let input;
  try {
    input = validateNewCampaign(await req.json());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const campaign = await store().createCampaign(input);
    return Response.json({ slug: campaign.slug });
  } catch (err) {
    console.error("[campaigns] create failed:", err);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
