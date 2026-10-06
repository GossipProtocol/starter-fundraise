"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { USDC_CHAINS, type UsdcChainKey } from "@/lib/usdc";

/* Mounted only on pages that need a wallet or a sign in: the campaign
   page when USDC is on, and the connect page. The landing and the
   builder never load the Privy bundle. */

export default function PrivyClientProvider({
  appId,
  chainKey,
  children,
}: {
  appId: string;
  chainKey: UsdcChainKey;
  children: ReactNode;
}) {
  const chain = USDC_CHAINS[chainKey].chain;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#EC008C" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
