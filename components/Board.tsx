"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_RE, padN, type Campaign, type Position } from "@/lib/campaign";
import { money } from "@/lib/money";
import UsdcPay from "./UsdcPay";
import type { UsdcChainKey } from "@/lib/usdc";

/* ============================================================
   THE BOARD

   Positions grouped by item, one claim panel open at a time. The panel
   offers whichever rails the page says are on: cards (Stripe Checkout)
   and USDC (Privy embedded wallet). Demo mode shows a single "claim for
   free" button that runs the same reserve-then-mark-paid path.
   ============================================================ */

export type Rails = {
  mode: "demo" | "live";
  card: boolean;
  usdc: null | { chainKey: UsdcChainKey };
};

export default function Board({
  campaign,
  positions,
  rails,
  flags,
}: {
  campaign: Campaign;
  positions: Position[];
  rails: Rails;
  flags: { isNew: boolean; paid: string; cancelled: string; connected: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [email, setEmail] = useState("");
  const [rail, setRail] = useState<"card" | "usdc">(rails.card || rails.mode === "demo" ? "card" : "usdc");
  const [msg, setMsg] = useState<{ text: string; kind: string }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paidNow, setPaidNow] = useState<string>("");

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/c/${campaign.slug}` : `/c/${campaign.slug}`;

  // a hold expires on its own; refresh the board when the soonest one lapses
  useEffect(() => {
    const soonest = positions
      .map((p) => (p.holdExpiresAt ? Date.parse(p.holdExpiresAt) - Date.now() : Infinity))
      .reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(soonest)) return;
    const t = window.setTimeout(() => router.refresh(), Math.max(1000, soonest + 500));
    return () => window.clearTimeout(t);
  }, [positions, router]);

  const say = (text: string, kind = "") => setMsg({ text, kind });

  async function claimCard(p: Position) {
    if (!brand.trim()) return say("Add your brand or company.", "err");
    if (!EMAIL_RE.test(email.trim())) return say("That email does not look right.", "err");
    setBusy(true);
    say(rails.mode === "demo" ? "Claiming..." : "Holding the position and opening checkout...", "note");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionId: p.id, brand: brand.trim(), email: email.trim() }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || "Something went wrong. Try again.");
      window.location.assign(json.url);
    } catch (err) {
      say((err as Error).message, "err");
      setBusy(false);
      router.refresh();
    }
  }

  function onUsdcPaid(reference: string) {
    setPaidNow(reference);
    setOpen(null);
    router.refresh();
  }

  const sold = positions.filter((p) => p.status === "sold");
  const raised = sold.reduce((s, p) => s + p.priceCents, 0);
  const total = positions.reduce((s, p) => s + p.priceCents, 0);
  const openN = positions.filter((p) => p.status === "open").length;
  const anyRail = rails.mode === "demo" || rails.card || rails.usdc;

  let lastItem = "";

  return (
    <div className="narrow">
      {flags.isNew && (
        <div className="share">
          <div className="lab">Your campaign is live</div>
          <div className="url">
            <code>{shareUrl}</code>
            <button
              type="button"
              className="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                } catch {}
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="fine">
            Post it. Then{" "}
            <a href={`/c/${campaign.slug}/connect`}>connect your payouts</a> so brands can pay: card payments need your
            Stripe account, USDC needs a wallet address.
          </div>
        </div>
      )}
      {(flags.paid || paidNow) && (
        <div className="banner ok">
          <b>Paid.</b> Reference <code>{flags.paid || paidNow}</code>. The position is yours; keep the reference for your
          records. The athlete will be in touch about artwork.
        </div>
      )}
      {flags.cancelled && (
        <div className="banner">
          Checkout was cancelled. The position goes back on sale when the hold lapses, or sooner if Stripe tells us
          the session expired.
        </div>
      )}
      {flags.connected && (
        <div className="banner ok">
          <b>Stripe connected.</b> Card payments on this campaign now settle to your account.
        </div>
      )}

      <div className="head" style={{ paddingBottom: 0 }}>
        <h1>{campaign.athlete}</h1>
        <div className="meta">
          {[campaign.sport, campaign.event, campaign.city].filter(Boolean).map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        {campaign.story && <p className="story">{campaign.story}</p>}
      </div>

      <div className="stats">
        <div className="st">
          <div className="v">{money(raised)}</div>
          <div className="k">Paid so far</div>
        </div>
        <div className="st">
          <div className="v">{openN}</div>
          <div className="k">Positions open</div>
        </div>
        <div className="st">
          <div className="v">{money(total)}</div>
          <div className="k">Fully sold</div>
        </div>
      </div>

      <div className="label" style={{ margin: "44px 0 12px" }} id="positions">
        Positions
      </div>
      <div className="plist">
        {positions.map((p) => {
          const header = p.item && p.item !== lastItem ? <div className="p-item">{p.item}</div> : null;
          lastItem = p.item;
          const cls = p.status === "sold" ? "p done" : p.status === "held" ? "p held" : "p";
          return (
            <div key={p.id}>
              {header}
              <div className={cls}>
                <div className="p-row">
                  <div className="n">{padN(p.n)}</div>
                  <div>
                    <div className="name">{p.name}</div>
                    {p.size && <span className="size">{p.size}</span>}
                  </div>
                  <div className="price">{money(p.priceCents)}</div>
                  <div className="act">
                    {p.status === "sold" ? (
                      <span className="tag">Sold</span>
                    ) : p.status === "held" ? (
                      <span className="tag">Being paid for</span>
                    ) : anyRail ? (
                      <button type="button" className="sm" onClick={() => { setOpen(open === p.id ? null : p.id); say(""); }}>
                        Claim
                      </button>
                    ) : (
                      <span className="tag">Payouts not set</span>
                    )}
                  </div>
                </div>

                {open === p.id && p.status === "open" && (
                  <div className="claim">
                    <div className="grid2">
                      <div className="f">
                        <label htmlFor={`brand-${p.id}`}>Brand or company</label>
                        <input id={`brand-${p.id}`} maxLength={80} placeholder="Acme Running Co" value={brand} onChange={(e) => setBrand(e.target.value)} />
                      </div>
                      {(rail === "card" || rails.mode === "demo") && (
                        <div className="f">
                          <label htmlFor={`email-${p.id}`}>Email</label>
                          <input id={`email-${p.id}`} type="email" maxLength={254} placeholder="you@brand.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>
                      )}
                    </div>

                    {rails.mode === "live" && rails.card && rails.usdc && (
                      <div className="rail">
                        <button type="button" className="ghost" aria-pressed={rail === "card"} onClick={() => setRail("card")}>
                          Card
                        </button>
                        <button type="button" className="ghost" aria-pressed={rail === "usdc"} onClick={() => setRail("usdc")}>
                          USDC
                        </button>
                      </div>
                    )}

                    {rails.mode === "demo" || (rail === "card" && rails.card) ? (
                      <div className="actions">
                        <button type="button" disabled={busy} onClick={() => claimCard(p)}>
                          {rails.mode === "demo"
                            ? `Claim ${padN(p.n)} for free (demo)`
                            : `Pay ${money(p.priceCents)} by card`}
                        </button>
                        <button type="button" className="ghost" onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : rails.usdc ? (
                      <UsdcPay positionId={p.id} brand={brand} chainKey={rails.usdc.chainKey} onPaid={onUsdcPaid} />
                    ) : null}

                    <div className={`msg ${msg.kind}`} role="status">
                      {msg.text}
                    </div>
                    <div className="fine">
                      {rails.mode === "demo"
                        ? "Demo mode: no payment. The claim runs the same reserve and mark-paid code the live site uses."
                        : "The position is held for you while you pay and is yours the moment the payment clears. Fixed price, first come."}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
