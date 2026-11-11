import Decimal from "decimal.js";
import type { Administration, IssueSeverity } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { controlAccountCheck } from "@/modules/invoicing/reports";
import { depreciationSchedule } from "@/modules/assets/schedule";

export type Finding = { checkCode: CheckCode; severity: IssueSeverity; subjectType?: string; subjectId?: string; key?: string; params: Record<string, string | number> };
export type CheckContext = { tx: Tx; admin: Administration; today: Date };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const CHECK_CODES = [
  "SUSPENSE_BALANCE", "CONTROL_MISMATCH", "BANK_UNMATCHED", "OVERDUE_RECEIVABLE", "OVERDUE_PAYABLE", "OLD_DRAFTS",
  "NEGATIVE_CASH", "MISSING_DEPRECIATION", "MISSING_TAX_CODE", "STALE_FX_RATE", "BTW_RETURN_MISSING", "PERIOD_NOT_CLOSED",
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

/** Posted balance per account (all years: balances are cumulative until year-end carry-forward replaces them). */
async function balancesBy(tx: Tx, administrationId: string, where: { controlType?: string; category?: string }) {
  return tx.$queryRaw<{ id: string; number: string; name: string; balance: string }[]>`
    SELECT a.id, a.number, a.name, COALESCE(SUM(l."debitBase" - l."creditBase"), 0)::text AS balance
      FROM "Account" a
      LEFT JOIN "JournalLine" l ON l."accountId" = a.id
      LEFT JOIN "JournalEntry" e ON e.id = l."entryId" AND e.status = 'POSTED'
      LEFT JOIN "FiscalYear" f ON f.id = e."fiscalYearId"
      LEFT JOIN "Journal" j ON j.id = e."journalId"
     WHERE a."administrationId" = ${administrationId} AND a.type = 'DETAIL'
       AND (${where.controlType ?? null}::text IS NULL OR a."controlType"::text = ${where.controlType ?? null})
       AND (${where.category ?? null}::text IS NULL OR a.category::text = ${where.category ?? null})
       AND (e.id IS NULL OR f.status <> 'CLOSED' OR j.type = 'OPENING')
     GROUP BY a.id ORDER BY a.number`;
}

export const CHECKS: Record<CheckCode, (c: CheckContext) => Promise<Finding[]>> = {
  /** Suspense (vraagposten) must be cleared. */
  async SUSPENSE_BALANCE({ tx, admin }) {
    const rows = await balancesBy(tx, admin.id, { category: "SUSPENSE" });
    return rows.filter((r) => !new Decimal(r.balance).isZero()).map((r) => ({ checkCode: "SUSPENSE_BALANCE", severity: "WARNING", subjectType: "Account", subjectId: r.id, params: { account: `${r.number} ${r.name}`, amount: new Decimal(r.balance).toFixed(2) } }));
  },
  /** Sub-ledger (open items) must equal the receivable/payable control account. */
  async CONTROL_MISMATCH({ tx, admin }) {
    return (await controlAccountCheck(tx, admin.id)).filter((r) => r.difference !== "0.00").map((r) => ({ checkCode: "CONTROL_MISMATCH", severity: "ERROR", subjectType: "Account", subjectId: r.accountId, params: { account: `${r.number} ${r.name}`, difference: r.difference } }));
  },
  /** Bank lines older than 30 days that are still unmatched. */
  async BANK_UNMATCHED({ tx, admin, today }) {
    const accounts = await tx.financialAccount.findMany({ where: { administrationId: admin.id } });
    const out: Finding[] = [];
    for (const fa of accounts) {
      const count = await tx.bankTransaction.count({ where: { financialAccountId: fa.id, status: { in: ["UNMATCHED", "PARTIAL"] }, bookingDate: { lt: new Date(today.getTime() - 30 * DAY) } } });
      if (count) out.push({ checkCode: "BANK_UNMATCHED", severity: "WARNING", subjectType: "FinancialAccount", subjectId: fa.id, params: { account: fa.name, count } });
    }
    return out;
  },
  async OVERDUE_RECEIVABLE({ tx, admin, today }) {
    return overdue(tx, admin.id, "RECEIVABLE", new Date(today.getTime() - 90 * DAY), "OVERDUE_RECEIVABLE", "WARNING");
  },
  async OVERDUE_PAYABLE({ tx, admin, today }) {
    return overdue(tx, admin.id, "PAYABLE", new Date(today.getTime() - 30 * DAY), "OVERDUE_PAYABLE", "INFO");
  },
  /** Unposted entries dated more than 30 days ago. */
  async OLD_DRAFTS({ tx, admin, today }) {
    const n = await tx.journalEntry.count({ where: { administrationId: admin.id, status: { not: "POSTED" }, entryDate: { lt: new Date(today.getTime() - 30 * DAY) } } });
    return n ? [{ checkCode: "OLD_DRAFTS", severity: "WARNING", params: { count: n } }] : [];
  },
  /** A cash box can never be negative. */
  async NEGATIVE_CASH({ tx, admin }) {
    const rows = await balancesBy(tx, admin.id, { controlType: "CASH" });
    return rows.filter((r) => new Decimal(r.balance).lt(0)).map((r) => ({ checkCode: "NEGATIVE_CASH", severity: "ERROR", subjectType: "Account", subjectId: r.id, params: { account: `${r.number} ${r.name}`, amount: new Decimal(r.balance).toFixed(2) } }));
  },
  /** Active assets with scheduled months before the current month that have no posted depreciation. */
  async MISSING_DEPRECIATION({ tx, admin, today }) {
    const assets = await tx.asset.findMany({ where: { administrationId: admin.id, status: "ACTIVE" }, include: { depreciation: true } });
    const posted = new Set((await tx.journalEntry.findMany({ where: { administrationId: admin.id, sourceType: "DEPRECIATION", status: "POSTED" }, select: { id: true } })).map((e) => e.id));
    const monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const out: Finding[] = [];
    for (const a of assets) {
      const due = depreciationSchedule({ cost: a.acquisitionCost.toString(), residual: a.residualValue.toString(), usefulLifeMonths: a.usefulLifeMonths, method: a.method, decliningRatePct: a.decliningRatePct?.toString(), start: a.depreciationStart })
        .filter((l) => Date.UTC(l.year, l.month - 1, 1) < monthStart && !a.depreciation.some((d) => d.year === l.year && d.month === l.month && posted.has(d.entryId)));
      if (due.length) out.push({ checkCode: "MISSING_DEPRECIATION", severity: "WARNING", subjectType: "Asset", subjectId: a.id, params: { asset: `${a.number} ${a.name}`, months: due.length } });
    }
    return out;
  },
  /** A BTW-registered company must put a BTW code on every sales invoice line. */
  async MISSING_TAX_CODE({ tx, admin }) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: admin.companyId } });
    if (!company.isBtwRegistered) return [];
    const invoices = await tx.invoice.findMany({ where: { administrationId: admin.id, type: "SALES", status: { not: "DRAFT" }, lines: { some: { taxCodeId: null } } }, select: { id: true, number: true } });
    return invoices.map((i) => ({ checkCode: "MISSING_TAX_CODE", severity: "WARNING", subjectType: "Invoice", subjectId: i.id, params: { invoice: i.number ?? "" } }));
  },
  /** Foreign-currency balances without a rate in the last 7 days (revaluation and invoices need current rates). */
  async STALE_FX_RATE({ tx, admin, today }) {
    const cur = await tx.$queryRaw<{ currency: string }[]>`
      SELECT l."txCurrency" AS currency FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
       WHERE e."administrationId" = ${admin.id} AND e.status = 'POSTED' AND l."txCurrency" <> ${admin.baseCurrency}
       GROUP BY 1 HAVING SUM(l."txAmount") <> 0`;
    const out: Finding[] = [];
    for (const { currency } of cur) {
      const recent = await tx.exchangeRate.count({ where: { baseCurrency: admin.baseCurrency, currency, status: { not: "REJECTED" }, effectiveDate: { gte: new Date(today.getTime() - 7 * DAY), lte: today } } });
      if (!recent) out.push({ checkCode: "STALE_FX_RATE", severity: "INFO", key: currency, params: { currency } });
    }
    return out;
  },
  /** Every completed month with posted invoices needs an approved or filed BTW return. */
  async BTW_RETURN_MISSING({ tx, admin, today }) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: admin.companyId } });
    if (!company.isBtwRegistered) return [];
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const months = await tx.$queryRaw<{ month: string }[]>`
      SELECT to_char(date_trunc('month', "invoiceDate"), 'YYYY-MM') AS month FROM "Invoice"
       WHERE "administrationId" = ${admin.id} AND status <> 'DRAFT' AND "invoiceDate" < ${monthStart} GROUP BY 1 ORDER BY 1`;
    const returns = await tx.taxReturn.findMany({ where: { administrationId: admin.id, taxType: "BTW", status: { in: ["APPROVED", "FILED"] } }, select: { periodFrom: true } });
    const done = new Set(returns.map((r) => iso(r.periodFrom).slice(0, 7)));
    return months.filter((m) => !done.has(m.month)).map((m) => ({ checkCode: "BTW_RETURN_MISSING", severity: "WARNING", key: m.month, params: { month: m.month } }));
  },
  /** Months that ended more than 45 days ago should be closed (soft or hard). */
  async PERIOD_NOT_CLOSED({ tx, admin, today }) {
    const periods = await tx.accountingPeriod.findMany({ where: { fiscalYear: { administrationId: admin.id }, number: { gte: 1, lte: 12 }, status: "OPEN", endDate: { lt: new Date(today.getTime() - 45 * DAY) } }, include: { fiscalYear: true }, orderBy: { endDate: "asc" } });
    return periods.map((p) => ({ checkCode: "PERIOD_NOT_CLOSED", severity: "INFO", subjectType: "AccountingPeriod", subjectId: p.id, params: { period: `${p.fiscalYear.code}-${String(p.number).padStart(2, "0")}` } }));
  },
};

async function overdue(tx: Tx, administrationId: string, side: "RECEIVABLE" | "PAYABLE", before: Date, checkCode: CheckCode, severity: IssueSeverity): Promise<Finding[]> {
  const rows = await tx.openItem.groupBy({ by: ["partyId"], where: { administrationId, side, status: "OPEN", dueDate: { lt: before }, remainingAmount: { gt: 0 } }, _count: { _all: true }, _sum: { remainingAmount: true } });
  const parties = new Map((await tx.party.findMany({ where: { id: { in: rows.map((r) => r.partyId).filter(Boolean) as string[] } } })).map((p) => [p.id, p.name]));
  return rows.filter((r) => r.partyId).map((r) => ({ checkCode, severity, subjectType: "Party", subjectId: r.partyId!, params: { party: parties.get(r.partyId!) ?? "", count: r._count._all, amount: new Decimal(r._sum.remainingAmount?.toString() ?? 0).toFixed(2) } }));
}

/** Score 0–100: each open ERROR −10, WARNING −3, INFO −1. */
export function qualityScore(open: { severity: IssueSeverity }[]): number {
  const penalty = open.reduce((s, i) => s + (i.severity === "ERROR" ? 10 : i.severity === "WARNING" ? 3 : 1), 0);
  return Math.max(0, 100 - penalty);
}
