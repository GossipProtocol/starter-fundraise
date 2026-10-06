"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, createWalletClient, custom, type Hex } from "viem";
import { usdc } from "@/lib/money";
import { ERC20_TRANSFER_ABI, USDC_CHAINS, type UsdcChainKey, type UsdcInstructions } from "@/lib/usdc";

/* ============================================================
   PAY IN USDC

   1. sign in with Privy (email), which creates an embedded wallet
   2. reserve: the server holds the position and returns the two legs
   3. send each leg as a plain ERC-20 transfer from the embedded wallet
   4. confirm: post the hashes, the server verifies them on chain and
      marks the position paid

   The amounts come from the server's instructions, never from props,
   so the price shown on the page cannot be edited into the transfer.
   ============================================================ */

type Step = "idle" | "reserving" | "sending" | "confirming" | "done" | "error";

export default function UsdcPay({
  positionId,
  brand,
  chainKey,
  onPaid,
}: {
  positionId: string;
  brand: string;
  chainKey: UsdcChainKey;
  onPaid: (reference: string) => void;
}) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<UsdcInstructions | null>(null);
  const [hashes, setHashes] = useState<Hex[]>([]);

  const embedded = wallets.find((w) => w.walletClientType === "privy");

  async function authed(path: string, body: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
    return json;
  }

  async function pay() {
    setError("");
    if (!brand.trim()) return setError("Add your brand or company first.");
    if (!authenticated) return login();
    if (!embedded) return setError("Your embedded wallet is still being created. Try again in a moment.");

    try {
      setStep("reserving");
      const s = (await authed("/api/usdc/reserve", { positionId, brand })) as unknown as UsdcInstructions;
      setSheet(s);
      if (embedded.address.toLowerCase() !== s.payer.toLowerCase()) {
        throw new Error("The signed-in wallet does not match the one on the reservation.");
      }

      setStep("sending");
      const { chain } = USDC_CHAINS[s.chain];
      await embedded.switchChain(s.chainId);
      const provider = await embedded.getEthereumProvider();
      const wallet = createWalletClient({ account: s.payer, chain, transport: custom(provider) });
      const reader = createPublicClient({ chain, transport: custom(provider) });

      const sent: Hex[] = [];
      for (const leg of s.legs) {
        const hash = await wallet.writeContract({
          address: s.usdc,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [leg.to, BigInt(leg.units)],
        });
        sent.push(hash);
        setHashes([...sent]);
        await reader.waitForTransactionReceipt({ hash });
      }

      setStep("confirming");
      await authed("/api/usdc/confirm", { reference: s.reference, txHashes: sent });
      setStep("done");
      onPaid(s.reference);
    } catch (err) {
      setStep("error");
      setError((err as Error).message);
    }
  }

  async function confirmAgain() {
    if (!sheet || hashes.length === 0) return;
    setError("");
    try {
      setStep("confirming");
      await authed("/api/usdc/confirm", { reference: sheet.reference, txHashes: hashes });
      setStep("done");
      onPaid(sheet.reference);
    } catch (err) {
      setStep("error");
      setError((err as Error).message);
    }
  }

  const busy = step === "reserving" || step === "sending" || step === "confirming";

  return (
    <div>
      {sheet && (
        <div className="legs">
          {sheet.legs.map((l) => (
            <div key={l.label}>
              {l.label}: <b>{usdc(BigInt(l.units))}</b> to <code>{l.to}</code>
            </div>
          ))}
          <div>
            reference <code>{sheet.reference}</code>
          </div>
        </div>
      )}
      <div className="actions">
        <button type="button" disabled={!ready || busy || step === "done"} onClick={pay}>
          {!authenticated
            ? "Sign in to pay in USDC"
            : step === "reserving"
              ? "Reserving..."
              : step === "sending"
                ? `Sending ${hashes.length + 1} of ${sheet?.legs.length ?? 2}...`
                : step === "confirming"
                  ? "Confirming..."
                  : step === "done"
                    ? "Paid"
                    : "Pay in USDC"}
        </button>
        {step === "error" && hashes.length > 0 && (
          <button type="button" className="ghost" onClick={confirmAgain}>
            Confirm again
          </button>
        )}
      </div>
      {error && <div className="msg err">{error}</div>}
      {authenticated && embedded && step === "idle" && (
        <div className="fine">
          Paying from <code>{embedded.address}</code>. Fund it with USDC on {USDC_CHAINS[chainKey].chain.name}{" "}
          before you pay; the transfer is sent from this wallet, so it needs the USDC and a little gas.
        </div>
      )}
    </div>
  );
}
