import Link from "next/link";
import type { Metadata } from "next";
import Board, { type Rails } from "@/components/Board";
import Nav, { Footer } from "@/components/Nav";
import PrivyClientProvider from "@/components/PrivyClientProvider";
import { str } from "@/lib/campaign";
import { mode, stripeConfigured, usdcConfigured } from "@/lib/server/env";
import { SITE_NAME } from "@/lib/site";
import { store } from "@/lib/store";
import { usdcChainKey } from "@/lib/usdc";

/* The public campaign page. A server component: it reads the store on
   every request (holds expire, sales land from the webhook) and hands
   the board a plain snapshot. The Privy bundle is mounted only when USDC
   is actually on for this campaign. */

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await store().getCampaign(slug);
  const title = campaign ? `${campaign.athlete} · ${SITE_NAME}` : SITE_NAME;
  return { title, robots: { index: false } };
}

export default async function CampaignPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const q = await searchParams;
  const m = mode();
  const campaign = await store().getCampaign(slug);

  if (!campaign) {
    return (
      <>
        <Nav />
        <div className="narrow empty">
          <h1>No campaign here.</h1>
          <p>The link may be wrong, or the campaign was taken down.</p>
          <p style={{ marginTop: 22 }}>
            <Link className="btn ghost" href="/create">
              Create your own
            </Link>
          </p>
        </div>
        <Footer mode={m} />
      </>
    );
  }

  const positions = await store().getPositions(campaign.id);
  const usdcOn = m === "live" && usdcConfigured() && Boolean(campaign.payoutAddress);
  const rails: Rails = {
    mode: m,
    card: m === "live" && stripeConfigured() && Boolean(campaign.stripeAccountId),
    usdc: usdcOn ? { chainKey: usdcChainKey() } : null,
  };
  const flags = {
    isNew: str(q.new) === "1",
    paid: str(q.paid),
    cancelled: str(q.cancelled),
    connected: str(q.connected) === "1",
  };

  const board = <Board campaign={campaign} positions={positions} rails={rails} flags={flags} />;

  return (
    <>
      <Nav
        right={
          <>
            <Link href={`/c/${campaign.slug}/connect`}>Athlete payouts</Link>
            <Link href="/create">Create yours</Link>
          </>
        }
      />
      {rails.usdc ? (
        <PrivyClientProvider appId={process.env.PRIVY_APP_ID as string} chainKey={rails.usdc.chainKey}>
          {board}
        </PrivyClientProvider>
      ) : (
        board
      )}
      <Footer mode={m} />
    </>
  );
}
