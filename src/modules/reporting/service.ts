import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import type { Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { balanceSheet, cashFlow, computeKpis, equityStatement, ledgerFingerprint, loadBalances, profitAndLoss } from "./statements";

export const REPORT_KINDS = ["balance", "pl", "cashflow", "equity", "kpis", "pack"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Same period range in the previous fiscal year (by period number), when that year exists. */
async function priorYear(tx: Tx, administrationId: string, fiscalYearId: string) {
  const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
  return tx.fiscalYear.findFirst({ where: { administrationId, endDate: { lt: fy.startDate } }, orderBy: { endDate: "desc" } });
}

/**
 * Builds every statement for a fiscal year and period range, with comparatives for the same periods of the prior year,
 * KPIs (R2) and the ledger fingerprint (R1). Only posted entries count.
 */
export async function buildReports(tx: Tx, q: { administrationId: string; fiscalYearId: string; fromPeriod: number; toPeriod: number }) {
  const fy = await tx.fiscalYear.findUnique({ where: { id: q.fiscalYearId }, include: { periods: { orderBy: { number: "asc" } } } });
  if (!fy || fy.administrationId !== q.administrationId) throw new UserError("errors.notFound");
  const from = Math.max(0, Math.min(13, q.fromPeriod));
  const to = Math.max(from, Math.min(13, q.toPeriod));
  const balances = await loadBalances(tx, { administrationId: q.administrationId, fiscalYearId: fy.id, fromPeriod: from, toPeriod: to });
  const prior = await priorYear(tx, q.administrationId, fy.id);
  const priorBalances = prior ? await loadBalances(tx, { administrationId: q.administrationId, fiscalYearId: prior.id, fromPeriod: from, toPeriod: to }) : null;
  const pl = profitAndLoss(balances);
  const bs = balanceSheet(balances);
  const priorPl = priorBalances ? profitAndLoss(priorBalances) : null;
  const priorBs = priorBalances ? balanceSheet(priorBalances) : null;
  const periodStart = fy.periods.find((p) => p.number === Math.max(1, from))?.startDate ?? fy.startDate;
  const periodEnd = fy.periods.find((p) => p.number === Math.min(12, to))?.endDate ?? fy.endDate;
  const days = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1);
  const funds = balances.filter((b) => b.category === "EQUITY" && /bestemming/i.test(b.name)).reduce((s, b) => s.plus(b.closing.negated()), new Decimal(0));
  const kpis = computeKpis({ pl, bs, days, priorRevenue: priorPl?.totals.revenue ?? null, fundBalance: funds.isZero() ? undefined : funds.toFixed(2) });
  const params = { administrationId: q.administrationId, fiscalYearId: fy.id, fromPeriod: from, toPeriod: to };
  const fp = await ledgerFingerprint(tx, { ...q, fiscalYearId: fy.id, toPeriod: to, params });
  return {
    fiscalYear: { id: fy.id, code: fy.code }, priorYear: prior ? { id: prior.id, code: prior.code } : null, fromPeriod: from, toPeriod: to, periodStart, periodEnd, days,
    pl, bs, priorPl, priorBs, cashflow: cashFlow(balances), equity: equityStatement(balances), kpis, ...fp,
  };
}

/** R1: archive the parameters and fingerprint of an exported report. */
export async function recordRun(tx: Tx, access: Access, q: { administrationId: string; kind: string; format: "PDF" | "CSV"; params: Record<string, unknown>; fingerprint: string; entryCount: number }) {
  const run = await tx.reportRun.create({ data: { organizationId: access.organizationId, administrationId: q.administrationId, kind: q.kind, format: q.format, params: q.params as Prisma.InputJsonValue, fingerprint: q.fingerprint, entryCount: q.entryCount, createdById: access.userId } });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "report.exported", entity: "ReportRun", entityId: run.id, details: { kind: q.kind, format: q.format, fingerprint: q.fingerprint } });
  return run;
}
