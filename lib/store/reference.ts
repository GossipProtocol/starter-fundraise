import { randomBytes } from "node:crypto";

/** Crockford base32 without the ambiguous letters. 10 characters is 50 bits
 *  of randomness, which is plenty for a code that is also protected by a
 *  database uniqueness constraint. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A short public code for a reservation, like `FR-7K3Q9M2XWD`. It is what
 *  a payment carries back to the position: Stripe metadata on cards, the
 *  confirm call on USDC. */
export function newReference(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % 32];
  return `FR-${out}`;
}

export const REFERENCE_RE = /^FR-[0-9A-HJKMNP-TV-Z]{10}$/;
