import { PrivyClient } from "@privy-io/server-auth";

/* ============================================================
   WHO IS ASKING

   USDC buyers and athletes sign in with Privy. The client sends its
   Privy access token in the Authorization header; the server resolves
   it to a verified email and the embedded wallet address. Nothing about
   identity is ever taken from the request body.
   ============================================================ */

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;

export function privyConfigured(): boolean {
  return Boolean(APP_ID && APP_SECRET);
}

let client: PrivyClient | null = null;
function privy(): PrivyClient {
  if (!client) client = new PrivyClient(APP_ID as string, APP_SECRET as string);
  return client;
}

export type Viewer = {
  userId: string;
  email: string;
  /** The Privy embedded Ethereum wallet, lowercased. Empty if none. */
  wallet: `0x${string}` | "";
};

/** Verify the bearer token and resolve it to a viewer. Returns null for
 *  anything that does not check out. */
export async function viewerFrom(req: Request): Promise<Viewer | null> {
  if (!privyConfigured()) return null;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  try {
    const claims = await privy().verifyAuthToken(token);
    const user = await privy().getUser(claims.userId);
    const email = (user.email?.address ?? "").trim().toLowerCase();
    const embedded = user.linkedAccounts.find(
      (a) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
    );
    const address = embedded && "address" in embedded ? embedded.address : user.wallet?.address ?? "";
    const wallet = /^0x[0-9a-fA-F]{40}$/.test(address) ? (address.toLowerCase() as `0x${string}`) : "";
    return { userId: claims.userId, email, wallet };
  } catch {
    return null;
  }
}
