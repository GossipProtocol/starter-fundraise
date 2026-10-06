import Link from "next/link";
import ConnectPanel from "@/components/ConnectPanel";
import Nav, { Footer } from "@/components/Nav";
import PrivyClientProvider from "@/components/PrivyClientProvider";
import { mode, stripeConfigured, usdcConfigured } from "@/lib/server/env";
import { privyConfigured } from "@/lib/server/privy";
import { store } from "@/lib/store";
import { usdcChainKey } from "@/lib/usdc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Athlete payouts", robots: { index: false } };

export default async function ConnectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = mode();
  const campaign = await store().getCampaign(slug);

  if (!campaign) {
    return (
      <>
        <Nav />
        <div className="narrow empty">
          <h1>No campaign here.</h1>
        </div>
        <Footer mode={m} />
      </>
    );
  }

  const canSignIn = m === "live" && privyConfigured();

  return (
    <>
      <Nav right={<Link href={`/c/${campaign.slug}`}>Back to the campaign</Link>} />
      <div className="narrow head">
        <h1>Payouts for {campaign.athlete}</h1>
        <p>
          Where the money goes. Card payments settle to a Stripe account you connect here; USDC lands in an address
          you name. Brands cannot pay until at least one is set.
        </p>
      </div>
      <div className="narrow">
        {canSignIn ? (
          <PrivyClientProvider appId={process.env.PRIVY_APP_ID as string} chainKey={usdcChainKey()}>
            <ConnectPanel
              slug={campaign.slug}
              stripeOn={stripeConfigured()}
              usdcOn={usdcConfigured()}
              stripeAccountId={campaign.stripeAccountId}
              payoutAddress={campaign.payoutAddress}
            />
          </PrivyClientProvider>
        ) : (
          <div className="payout">
            <h2>{m === "demo" ? "Demo mode" : "Sign in is not configured"}</h2>
            <p>
              {m === "demo"
                ? "Claims are free in demo mode, so there is nothing to connect. Set the Supabase, Privy and Stripe groups in .env.local to go live; this page then lets the athlete sign in and connect payouts."
                : "Set PRIVY_APP_ID and PRIVY_APP_SECRET so athletes can prove they own a campaign."}
            </p>
          </div>
        )}
      </div>
      <Footer mode={m} />
    </>
  );
}
