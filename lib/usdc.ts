import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";

/* ============================================================
   USDC CHAIN CONFIG

   Safe for the client. Addresses are Circle's published USDC contracts;
   take them from Circle's list, never from a search result. The chain is
   chosen by NEXT_PUBLIC_USDC_CHAIN so the browser and the server agree.
   ============================================================ */

export type UsdcChainKey = "base" | "base-sepolia";

export const USDC_CHAINS: Record<UsdcChainKey, { chain: Chain; usdc: `0x${string}`; explorer: string }> = {
  base: {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org/tx/",
  },
  "base-sepolia": {
    chain: baseSepolia,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org/tx/",
  },
};

export function usdcChainKey(): UsdcChainKey {
  const raw = process.env.NEXT_PUBLIC_USDC_CHAIN || "base-sepolia";
  if (raw !== "base" && raw !== "base-sepolia") {
    throw new Error(`NEXT_PUBLIC_USDC_CHAIN must be "base" or "base-sepolia", got "${raw}"`);
  }
  return raw;
}

export function usdcChain() {
  return USDC_CHAINS[usdcChainKey()];
}

export const USDC_DECIMALS = 6;

export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/** What the buyer's wallet has to send. Built on the server from the
 *  reservation and handed to the client as strings (bigint does not
 *  survive JSON). */
export type UsdcInstructions = {
  reference: string;
  chain: UsdcChainKey;
  chainId: number;
  usdc: `0x${string}`;
  payer: `0x${string}`;
  legs: { to: `0x${string}`; units: string; label: "athlete" | "course fee" }[];
  expiresAt: string;
};
