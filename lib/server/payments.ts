import { revalidatePath } from "next/cache";
import type { Provider } from "../campaign";
import { REFERENCE_RE } from "../store/reference";
import { store, StoreError } from "../store";
import type { CommitResult } from "../store";

/* ============================================================
   MARK PAID: the only writer.

   Every rail ends here: the Stripe webhook, the USDC confirm route, the
   demo button and the admin's manual mark. Nothing else may turn a
   position sold, and this function turns exactly one position sold per
   call, the one the reservation names. There is no "mark everything"
   path, because the last time one existed it marked a whole board sold
   with nothing behind it.

   Idempotent: the same providerRef (Stripe session id, tx hash) committed
   twice returns the first result and writes nothing. Stripe retries, RPC
   nodes hiccup, buyers double-click; none of that can sell a position
   twice or count a payment twice.
   ============================================================ */

export type MarkPaidInput = {
  reference: string;
  provider: Provider;
  providerRef: string;
  amountCents: number;
  raw?: unknown;
};

export async function markPaid(input: MarkPaidInput): Promise<CommitResult> {
  if (!REFERENCE_RE.test(input.reference)) {
    throw new StoreError("not_found", `malformed reference ${input.reference}`);
  }
  if (!input.providerRef) throw new Error("markPaid needs a providerRef");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new StoreError("amount_mismatch", `bad amount ${input.amountCents}`);
  }

  const result = await store().commitPayment({
    reference: input.reference,
    provider: input.provider,
    providerRef: input.providerRef,
    amountCents: input.amountCents,
    raw: input.raw ?? null,
  });

  if (!result.alreadyPaid) {
    const campaign = await store().getCampaignById(result.position.campaignId);
    if (campaign) revalidatePath(`/c/${campaign.slug}`);
    console.log(
      `[paid] ${input.provider} ${input.reference} position ${result.position.n} for ${input.amountCents} cents (${input.providerRef})`,
    );
  }
  return result;
}
