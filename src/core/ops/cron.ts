import { timingSafeEqual } from "node:crypto";

/**
 * Authorises Vercel Cron calls: `Authorization: Bearer $CRON_SECRET`, compared in constant time.
 * Refuses everything when CRON_SECRET is missing or shorter than 32 characters (fail closed).
 */
export function isAuthorizedCron(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
