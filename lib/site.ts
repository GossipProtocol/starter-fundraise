/** Name shown in the header, titles and the Stripe line item. Safe for the
 *  client: NEXT_PUBLIC_ values are inlined at build time. */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "starter-fundraise";

const FALLBACK_SITE_URL = "http://localhost:3000";

/** A missing scheme in NEXT_PUBLIC_SITE_URL used to throw inside new URL()
 *  and take the whole build down. A config typo should not be able to do
 *  that, so tolerate it and fall back rather than fail. */
export function resolveSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!raw) return FALLBACK_SITE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return FALLBACK_SITE_URL;
  }
}
