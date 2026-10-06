"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

/* The athlete signs in with the email they published with and either
   starts Stripe Connect onboarding or saves a USDC payout address. The
   server checks the email against the campaign's private row. */

export default function ConnectPanel({
  slug,
  stripeOn,
  usdcOn,
  stripeAccountId,
  payoutAddress,
}: {
  slug: string;
  stripeOn: boolean;
  usdcOn: boolean;
  stripeAccountId: string | null;
  payoutAddress: string | null;
}) {
  const router = useRouter();
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const [address, setAddress] = useState(payoutAddress ?? "");
  const [msg, setMsg] = useState<{ text: string; kind: string }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  async function call(body: unknown) {
    setBusy(true);
    setMsg({ text: "Working...", kind: "note" });
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ slug, ...(body as object) }),
      });
      const json = (await res.json()) as { url?: string; ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Something went wrong.");
      if (json.url) {
        window.location.assign(json.url);
        return;
      }
      setMsg({ text: "Saved.", kind: "ok" });
      router.refresh();
    } catch (err) {
      setMsg({ text: (err as Error).message, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  if (!authenticated) {
    return (
      <div className="payout">
        <h2>Sign in</h2>
        <p>Use the email you published the campaign with. Nobody else can change where the money goes.</p>
        <button type="button" onClick={login}>
          Sign in with email
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="fine" style={{ color: "var(--dim)", fontSize: 14 }}>
        Signed in as {user?.email?.address ?? "unknown"}.{" "}
        <button type="button" className="ghost sm" onClick={logout}>
          Sign out
        </button>
      </p>

      <div className="payout">
        <h2>Card payments (Stripe)</h2>
        <p>
          {stripeAccountId
            ? "A Stripe account is connected. Open onboarding again if Stripe still needs details from you."
            : "Brands pay by card through Stripe Checkout and the money settles to your own Stripe account. Onboarding takes a few minutes."}
        </p>
        <button type="button" disabled={!stripeOn || busy} onClick={() => call({ action: "stripe" })}>
          {stripeAccountId ? "Open Stripe onboarding" : "Connect with Stripe"}
        </button>
        {!stripeOn && <div className="hint">Stripe is not configured on this site.</div>}
      </div>

      <div className="payout">
        <h2>USDC payments</h2>
        <p>
          Brands can pay in USDC from an embedded wallet. Enter the EVM address the USDC should land in. Use an
          address you control on the chain this site is set to.
        </p>
        <div className="grid2">
          <div className="f">
            <label htmlFor="addr">Payout address</label>
            <input id="addr" placeholder="0x..." value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
          </div>
          <div className="f">
            <button type="button" disabled={!usdcOn || busy} onClick={() => call({ action: "usdc", payoutAddress: address.trim() })}>
              Save address
            </button>
          </div>
        </div>
        {!usdcOn && <div className="hint">USDC is not configured on this site.</div>}
      </div>

      <div className={`msg ${msg.kind}`} role="status">
        {msg.text}
      </div>
    </>
  );
}
