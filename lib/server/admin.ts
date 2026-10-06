import { timingSafeEqual } from "node:crypto";

/** Back-of-house routes take the admin password in the x-admin-key header.
 *  Compared in constant time; absent env means no admin at all. */
export function isAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  const given = req.headers.get("x-admin-key") ?? "";
  if (!expected || !given || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
