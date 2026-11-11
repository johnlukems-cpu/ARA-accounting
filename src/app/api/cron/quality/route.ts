import { timingSafeEqual } from "node:crypto";
import { systemDb } from "@/core/db/client";
import { runScan } from "@/modules/quality/service";
import { verifyAuditChain } from "@/core/audit/audit";

/**
 * Scheduled quality scan (Vercel Cron, see vercel.json). Authorised by CRON_SECRET (Vercel sends it as a Bearer token).
 * Runs as trusted system code for every active administration, one transaction each, and then re-verifies the audit
 * hash chain of every organisation. A broken chain is logged as an error (ids only) for the operator's log alerting.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response("Unauthorized", { status: 401 });
  const admins = await systemDb.administration.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let scanned = 0;
  let failed = 0;
  for (const a of admins) {
    try {
      await systemDb.$transaction((tx) => runScan(tx, { administrationId: a.id, today: new Date(), trigger: "SCHEDULED" }), { timeout: 60_000 });
      scanned++;
    } catch {
      failed++;
    }
  }
  const orgs = await systemDb.organization.findMany({ select: { id: true } });
  const brokenChains: string[] = [];
  for (const o of orgs) {
    const check = await verifyAuditChain(systemDb, o.id);
    if (!check.ok) brokenChains.push(o.id);
    if (!check.ok) console.error(JSON.stringify({ event: "audit.chainBroken", organizationId: o.id, firstBrokenSeq: check.firstBrokenSeq }));
  }
  return Response.json({ scanned, failed, auditChainsChecked: orgs.length, brokenChains: brokenChains.length });
}
