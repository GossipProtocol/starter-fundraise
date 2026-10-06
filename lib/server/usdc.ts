import { createPublicClient, http, parseEventLogs, type Hex } from "viem";
import type { Campaign, Reservation } from "../campaign";
import { COURSE_FEE_RECIPIENT, splitAmount } from "../course-fee";
import { centsToUsdcUnits } from "../money";
import { ERC20_TRANSFER_ABI, usdcChain, usdcChainKey, type UsdcInstructions } from "../usdc";

/* ============================================================
   USDC VERIFICATION

   The buyer pays from their Privy embedded wallet with two plain ERC-20
   transfers: the athlete's share to the campaign payout address and the
   course fee to COURSE_FEE_RECIPIENT. The client then posts the tx
   hashes with the reservation reference. This module reads the receipts
   from the chain and checks, for each leg, that a Transfer log on the
   USDC contract went from the reserved wallet to the right address for
   at least the right amount.

   What makes the match safe:
     - the payer address was taken from the verified Privy token at
       reserve time, so a transfer from any other wallet does not count
     - the amount is derived from the reservation, never from the request
     - the tx hash becomes the providerRef, so one transfer can only ever
       pay one reservation
   ============================================================ */

export function publicClient() {
  const rpc = process.env.USDC_RPC_URL;
  if (!rpc) throw new Error("USDC_RPC_URL is not set");
  return createPublicClient({ chain: usdcChain().chain, transport: http(rpc) });
}

/** The two legs for a reservation, in base units. */
export function usdcLegs(campaign: Campaign, reservation: Reservation) {
  if (!campaign.payoutAddress) throw new Error("this campaign has no USDC payout address");
  const total = centsToUsdcUnits(reservation.amountCents);
  const { net, fee } = splitAmount(total);
  return {
    total,
    legs: [
      { to: campaign.payoutAddress as `0x${string}`, units: net, label: "athlete" as const },
      { to: COURSE_FEE_RECIPIENT as `0x${string}`, units: fee, label: "course fee" as const },
    ].filter((l) => l.units > 0n),
  };
}

export function usdcInstructions(campaign: Campaign, reservation: Reservation): UsdcInstructions {
  const { chain, usdc } = usdcChain();
  const { legs } = usdcLegs(campaign, reservation);
  return {
    reference: reservation.reference,
    chain: usdcChainKey(),
    chainId: chain.id,
    usdc,
    payer: reservation.payer as `0x${string}`,
    legs: legs.map((l) => ({ to: l.to, units: l.units.toString(), label: l.label })),
    expiresAt: reservation.expiresAt,
  };
}

export type VerifiedTransfer = { hash: Hex; to: `0x${string}`; value: bigint; blockNumber: bigint };

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Read the receipts and return every USDC Transfer from `payer` they
 *  contain. Throws if a hash is malformed, missing, pending or reverted. */
export async function transfersFrom(hashes: string[], payer: `0x${string}`): Promise<VerifiedTransfer[]> {
  const client = publicClient();
  const { usdc } = usdcChain();
  const out: VerifiedTransfer[] = [];
  for (const raw of hashes) {
    if (!HASH_RE.test(raw)) throw new Error(`malformed tx hash ${raw}`);
    const hash = raw as Hex;
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} did not succeed`);
    const logs = parseEventLogs({
      abi: ERC20_TRANSFER_ABI,
      eventName: "Transfer",
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === usdc.toLowerCase()),
    });
    for (const log of logs) {
      if (log.args.from.toLowerCase() !== payer.toLowerCase()) continue;
      out.push({ hash, to: log.args.to, value: log.args.value, blockNumber: receipt.blockNumber });
    }
  }
  return out;
}

/** Check that the verified transfers cover every leg. Returns the hash
 *  of the athlete leg, which becomes the providerRef. */
export function matchLegs(
  transfers: VerifiedTransfer[],
  legs: { to: `0x${string}`; units: bigint; label: string }[],
): { ok: true; primary: Hex } | { ok: false; missing: string } {
  const unused = [...transfers];
  let primary: Hex | null = null;
  for (const leg of legs) {
    const i = unused.findIndex((t) => t.to.toLowerCase() === leg.to.toLowerCase() && t.value >= leg.units);
    if (i < 0) return { ok: false, missing: leg.label };
    const [hit] = unused.splice(i, 1);
    if (leg.label === "athlete") primary = hit.hash;
  }
  return { ok: true, primary: primary ?? transfers[0].hash };
}
