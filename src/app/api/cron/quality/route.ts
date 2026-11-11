import { systemDb } from "@/core/db/client";
import { runScan } from "@/modules/quality/service";
import { verifyAuditChain } from "@/core/audit/audit";
import { isAuthorizedCron } from "@/core/ops/cron";
import { log } from "@/core/ops/log";

/**
 * Scheduled quality scan (Vercel Cron, see vercel.json). Authorised by CRON_SECRET (Vercel sends it as a Bearer token).
 * Runs as trusted system code for every active administration, one transaction each, and then re-verifies the audit
 * hash chain of every organisation. A broken chain is logged as an error (ids only) for the operator's log alerting.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    log.warn("cron.unauthorized", { path: "/api/cron/quality" });
    return new Response("Unauthorized", { status: 401 });
  }
  const started = Date.now();
  const admins = await systemDb.administration.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let scanned = 0;
  let failed = 0;
  for (const a of admins) {
    try {
      await systemDb.$transaction((tx) => runScan(tx, { administrationId: a.id, today: new Date(), trigger: "SCHEDULED" }), { timeout: 60_000 });
      scanned++;
    } catch (err) {
      failed++;
      log.error("cron.qualityScanFailed", { administrationId: a.id, error: err });
    }
  }
  const orgs = await systemDb.organization.findMany({ select: { id: true } });
  const brokenChains: string[] = [];
  for (const o of orgs) {
    const check = await verifyAuditChain(systemDb, o.id);
    if (!check.ok) brokenChains.push(o.id);
    if (!check.ok) log.error("audit.chainBroken", { organizationId: o.id, firstBrokenSeq: check.firstBrokenSeq });
  }
  log.info("cron.qualityDone", { scanned, failed, count: orgs.length, durationMs: Date.now() - started });
  return Response.json({ scanned, failed, auditChainsChecked: orgs.length, brokenChains: brokenChains.length });
}
