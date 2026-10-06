import Link from "next/link";
import Nav, { Footer } from "@/components/Nav";
import { COURSE_FEE_BPS } from "@/lib/course-fee";
import { mode } from "@/lib/server/env";
import { DEMO_SLUG } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function Home() {
  const m = mode();
  return (
    <>
      <Nav right={<Link href="/#how">How it works</Link>} />
      <div className="wrap hero">
        <h1>
          Your kit.
          <br />
          Their <b>logo</b>.
        </h1>
        <p className="tag">
          Sell sponsor positions on your race kit. <b>Numbered, priced, first come.</b> Paid by card or USDC, settled
          to you directly.
        </p>
        <div className="cta">
          <Link className="btn" href="/create">
            Create your campaign
          </Link>
          {m === "demo" ? (
            <Link className="btn ghost" href={`/c/${DEMO_SLUG}`}>
              Open the demo campaign
            </Link>
          ) : (
            <Link className="btn ghost" href="/#how">
              How it works
            </Link>
          )}
        </div>
      </div>

      <section className="wrap" id="how">
        <div className="label sec-label">How it works</div>
        <div className="rows">
          <div className="row">
            <span className="n">01</span>
            <h3>Pick your positions</h3>
            <p>
              Chest, back, shoulders, thighs, down tube, helmet. Each one gets a number, a size and a price. Pairs
              count as one position, so nobody buys half a panel.
            </p>
          </div>
          <div className="row">
            <span className="n">02</span>
            <h3>Brands claim them</h3>
            <p>
              Fixed price, first come. A brand picks a position and pays on the spot, by card through Stripe or in
              USDC from an embedded wallet. The position is held while they pay and sold the moment it clears.
            </p>
          </div>
          <div className="row">
            <span className="n">03</span>
            <h3>The money lands with you</h3>
            <p>
              Card payments settle to your own Stripe account. USDC lands in the wallet you name. Nothing sits in a
              platform balance waiting to be paid out.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap" id="fee">
        <div className="label sec-label">The fee</div>
        <p className="fee">
          Every paid position pays <b>{COURSE_FEE_BPS / 100}%</b> of its price to the course wallet. Cards: a Stripe
          application fee on the same payment. USDC: a second transfer in the same checkout. The buyer pays the listed
          price; the athlete receives the rest. The rate and the recipient live in one file,{" "}
          <code>lib/course-fee.ts</code>.
        </p>
      </section>

      <Footer mode={m} />
    </>
  );
}
