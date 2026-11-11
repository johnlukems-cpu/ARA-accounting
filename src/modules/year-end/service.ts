import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { controlAccountCheck } from "@/modules/invoicing/reports";
import { depreciationSchedule } from "@/modules/assets/schedule";
import { insertFiscalYear } from "@/modules/organization/service";
import { fiscalYearRange } from "@/modules/organization/periods";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Year-end checklist (24 items). `auto` items are verified from the ledger; the user still completes them (with the
 * check passing) so every item has a responsible person. Optional items may be marked not applicable.
 */
export const CHECKLIST = [
  { code: "NO_DRAFTS", mandatory: true, auto: true },
  { code: "PERIODS_CLOSED", mandatory: true, auto: true },
  { code: "BANK_RECONCILED", mandatory: true, auto: true },
  { code: "CASH_COUNTED", mandatory: true, auto: false },
  { code: "RECEIVABLES_RECONCILED", mandatory: true, auto: true },
  { code: "PAYABLES_RECONCILED", mandatory: true, auto: true },
  { code: "DOUBTFUL_DEBTS", mandatory: true, auto: false },
  { code: "INVENTORY_COUNTED", mandatory: false, auto: false },
  { code: "DEPRECIATION_POSTED", mandatory: true, auto: true },
  { code: "FIXED_ASSET_REGISTER", mandatory: true, auto: false },
  { code: "ACCRUALS", mandatory: true, auto: false },
  { code: "PREPAYMENTS", mandatory: true, auto: false },
  { code: "FX_REVALUATION", mandatory: true, auto: true },
  { code: "CURRENT_ACCOUNTS_CONFIRMED", mandatory: false, auto: false },
  { code: "LOANS_RECONCILED", mandatory: true, auto: false },
  { code: "PAYROLL_RECONCILED", mandatory: true, auto: false },
  { code: "BTW_RECONCILED", mandatory: true, auto: false },
  { code: "INCOME_TAX_PROVISION", mandatory: true, auto: false },
  { code: "SUSPENSE_CLEARED", mandatory: true, auto: true },
  { code: "TRIAL_BALANCE_BALANCED", mandatory: true, auto: true },
  { code: "EQUITY_MOVEMENTS", mandatory: true, auto: false },
  { code: "OPENING_BALANCES_AGREED", mandatory: true, auto: false },
  { code: "ANNUAL_ACCOUNTS_DRAFTED", mandatory: false, auto: false },
  { code: "MANAGEMENT_REVIEW", mandatory: true, auto: false },
] as const;
export type CheckCode = (typeof CHECKLIST)[number]["code"];

async function loadClosing(tx: Tx, id: string) {
  const c = await tx.yearEndClosing.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!c) throw new UserError("errors.notFound");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: c.administrationId } });
  const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: c.fiscalYearId }, include: { periods: { orderBy: { number: "asc" } } } });
  return { c, admin, fy };
}

/** Automatic checks: true = passes, otherwise a short reason key. */
export async function autoChecks(tx: Tx, administrationId: string, fiscalYearId: string): Promise<Partial<Record<CheckCode, true | string>>> {
  const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId }, include: { periods: true } });
  const out: Partial<Record<CheckCode, true | string>> = {};
  const drafts = await tx.journalEntry.count({ where: { fiscalYearId, status: { not: "POSTED" } } });
  out.NO_DRAFTS = drafts === 0 || `drafts:${drafts}`;
  const open = fy.periods.filter((p) => p.number >= 1 && p.number <= 12 && p.status !== "CLOSED").length;
  out.PERIODS_CLOSED = open === 0 || `open:${open}`;
  const banks = await tx.financialAccount.findMany({ where: { administrationId, status: "ACTIVE", kind: "BANK" } });
  let unreconciled = 0;
  for (const b of banks) {
    const ok = await tx.bankReconciliation.findFirst({ where: { financialAccountId: b.id, status: "APPROVED", periodEnd: { gte: fy.endDate } } });
    if (!ok) unreconciled++;
  }
  out.BANK_RECONCILED = unreconciled === 0 || `unreconciled:${unreconciled}`;
  const control = await controlAccountCheck(tx, administrationId);
  const types = new Map((await tx.account.findMany({ where: { id: { in: control.map((r) => r.accountId) } }, select: { id: true, controlType: true } })).map((a) => [a.id, a.controlType]));
  const diff = (type: "RECEIVABLE" | "PAYABLE") => control.filter((r) => types.get(r.accountId) === type && r.difference !== "0.00").length;
  out.RECEIVABLES_RECONCILED = diff("RECEIVABLE") === 0 || "difference";
  out.PAYABLES_RECONCILED = diff("PAYABLE") === 0 || "difference";
  // Depreciation: every scheduled month up to the year end is posted for active assets.
  const assets = await tx.asset.findMany({ where: { administrationId, status: "ACTIVE", acquisitionDate: { lte: fy.endDate } }, include: { depreciation: true } });
  const posted = new Set((await tx.journalEntry.findMany({ where: { administrationId, sourceType: "DEPRECIATION", status: "POSTED" }, select: { id: true } })).map((e) => e.id));
  let missing = 0;
  for (const a of assets) {
    const schedule = depreciationSchedule({ cost: a.acquisitionCost.toString(), residual: a.residualValue.toString(), usefulLifeMonths: a.usefulLifeMonths, method: a.method, decliningRatePct: a.decliningRatePct?.toString(), start: a.depreciationStart });
    for (const l of schedule) {
      if (Date.UTC(l.year, l.month - 1, 1) > fy.endDate.getTime()) break;
      if (!a.depreciation.some((d) => d.year === l.year && d.month === l.month && posted.has(d.entryId))) missing++;
    }
  }
  out.DEPRECIATION_POSTED = missing === 0 || `missing:${missing}`;
  // FX: a posted revaluation for period 12, unless there are no foreign-currency balances.
  const p12 = fy.periods.find((p) => p.number === 12);
  const foreign = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (SELECT l."accountId", l."txCurrency" FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Administration" ad ON ad.id = e."administrationId"
     WHERE e."fiscalYearId" = ${fiscalYearId} AND e.status = 'POSTED' AND l."txCurrency" <> ad."baseCurrency" GROUP BY 1, 2 HAVING SUM(l."txAmount") <> 0) x`;
  const reval = p12 ? await tx.currencyRevaluation.findFirst({ where: { periodId: p12.id, status: "POSTED" } }) : null;
  out.FX_REVALUATION = Number(foreign[0]?.n ?? 0) === 0 || !!reval || "notRevalued";
  const suspense = await tx.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(ABS(t.v))::text AS total FROM (SELECT SUM(l."debitBase" - l."creditBase") AS v FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."fiscalYearId" = ${fiscalYearId} AND e.status = 'POSTED' AND a.category = 'SUSPENSE' GROUP BY l."accountId") t`;
  out.SUSPENSE_CLEARED = new Decimal(suspense[0]?.total ?? 0).isZero() || "balance";
  const tb = await tx.$queryRaw<{ d: string | null; c: string | null }[]>`
    SELECT SUM(l."debitBase")::text AS d, SUM(l."creditBase")::text AS c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
     WHERE e."fiscalYearId" = ${fiscalYearId} AND e.status = 'POSTED'`;
  out.TRIAL_BALANCE_BALANCED = new Decimal(tb[0]?.d ?? 0).eq(tb[0]?.c ?? 0) || "unbalanced";
  return out;
}

export async function startYearEnd(access: Access, fiscalYearId: string) {
  return withTenant(scope(access), async (tx) => {
    const fy = await tx.fiscalYear.findUnique({ where: { id: fiscalYearId }, include: { administration: true } });
    if (!fy) throw new UserError("errors.notFound");
    assertCan(access, "yearEnd.edit", fy.administration.companyId);
    if (fy.status === "CLOSED") throw new UserError("errors.fiscalYearClosed");
    const existing = await tx.yearEndClosing.findUnique({ where: { fiscalYearId } });
    if (existing) return existing;
    const c = await tx.yearEndClosing.create({ data: { organizationId: access.organizationId, administrationId: fy.administrationId, fiscalYearId, createdById: access.userId } });
    await tx.yearEndChecklistItem.createMany({ data: CHECKLIST.map((i, n) => ({ organizationId: access.organizationId, closingId: c.id, code: i.code, sortOrder: n + 1, mandatory: i.mandatory })) });
    await tx.fiscalYear.update({ where: { id: fiscalYearId }, data: { status: "CLOSING" } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "yearEnd.started", entity: "FiscalYear", entityId: fiscalYearId, details: { code: fy.code } });
    return c;
  });
}

/** Complete (auto items only when their check passes) or mark an optional item not applicable; reopening an item sets it OPEN. */
export async function setItem(access: Access, itemId: string, status: "COMPLETED" | "NOT_APPLICABLE" | "OPEN", comment?: string) {
  return withTenant(scope(access), async (tx) => {
    const item = await tx.yearEndChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new UserError("errors.notFound");
    const { c, admin } = await loadClosing(tx, item.closingId);
    assertCan(access, "yearEnd.edit", admin.companyId);
    if (c.status !== "IN_PROGRESS") throw new UserError("yearEnd.notInProgress");
    const def = CHECKLIST.find((x) => x.code === item.code);
    if (status === "NOT_APPLICABLE" && item.mandatory) throw new UserError("yearEnd.mandatoryItem");
    if (status === "NOT_APPLICABLE" && !comment?.trim()) throw new UserError("yearEnd.commentRequired");
    if (status === "COMPLETED" && def?.auto) {
      const result = (await autoChecks(tx, c.administrationId, c.fiscalYearId))[item.code as CheckCode];
      if (result !== true) throw new UserError("yearEnd.checkFails", { reason: String(result) });
    }
    await tx.yearEndChecklistItem.update({ where: { id: itemId }, data: status === "OPEN" ? { status, completedById: null, completedAt: null, comment: comment?.trim() || item.comment } : { status, comment: comment?.trim() || null, completedById: access.userId, completedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "yearEnd.item", entity: "YearEndChecklistItem", entityId: itemId, details: { code: item.code, status } });
  });
}

export async function submitYearEnd(access: Access, closingId: string) {
  return withTenant(scope(access), async (tx) => {
    const { c, admin } = await loadClosing(tx, closingId);
    assertCan(access, "yearEnd.edit", admin.companyId);
    if (c.status !== "IN_PROGRESS") throw new UserError("yearEnd.notInProgress");
    const open = c.items.filter((i) => i.mandatory && i.status !== "COMPLETED");
    if (open.length) throw new UserError("yearEnd.itemsOpen", { count: open.length });
    await tx.yearEndClosing.update({ where: { id: c.id }, data: { status: "REVIEW", submittedById: access.userId } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "yearEnd.submitted", entity: "YearEndClosing", entityId: c.id });
  });
}

/** F4: approval by another user; returning sends it back to IN_PROGRESS. */
export async function reviewYearEnd(access: Access, closingId: string, decision: "APPROVE" | "RETURN", reason?: string) {
  return withTenant(scope(access), async (tx) => {
    const { c, admin } = await loadClosing(tx, closingId);
    assertCan(access, "yearEnd.approve", admin.companyId);
    if (c.status !== "REVIEW") throw new UserError("ledger.wrongStatus");
    if (decision === "APPROVE") {
      if (c.submittedById === access.userId) throw new UserError("ledger.segregation");
      await tx.yearEndClosing.update({ where: { id: c.id }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
    } else {
      await tx.yearEndClosing.update({ where: { id: c.id }, data: { status: "IN_PROGRESS", submittedById: null } });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: decision === "APPROVE" ? "yearEnd.approved" : "yearEnd.returned", entity: "YearEndClosing", entityId: c.id, details: { reason: reason ?? null } });
  });
}

type Group = { accountId: string; number: string; category: string; controlType: string; currency: string; tx: string; base: string };

async function balances(tx: Tx, fiscalYearId: string, baseCurrency: string) {
  return tx.$queryRaw<Group[]>`
    SELECT l."accountId", a.number, a.category::text AS category, a."controlType"::text AS "controlType",
           CASE WHEN l."txCurrency" = ${baseCurrency} THEN ${baseCurrency} ELSE l."txCurrency" END AS currency,
           SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."fiscalYearId" = ${fiscalYearId} AND e.status = 'POSTED'
     GROUP BY l."accountId", a.number, a.category, a."controlType", 5
     ORDER BY a.number, 5`;
}

const PL = ["REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE"];
const side = (v: Decimal) => (v.gt(0) ? { debit: v.toFixed(2) } : { credit: v.abs().toFixed(2) });

/**
 * F5: closes P&L accounts to retained earnings in period 13 (closing journal), creates the next fiscal year if needed,
 * carries every balance-sheet balance (per account and currency, exact base amounts) to period 0 of the next year,
 * verifies opening = closing, and closes all periods and the year.
 */
export async function closeYear(access: Access, closingId: string) {
  return withTenant(scope(access), async (tx) => {
    const { c, admin, fy } = await loadClosing(tx, closingId);
    assertCan(access, "yearEnd.close", admin.companyId);
    if (c.status !== "APPROVED" || !c.approvedById) throw new UserError("yearEnd.notApproved");
    const journal = async (type: "CLOSING" | "OPENING") => {
      const j = await tx.journal.findFirst({ where: { administrationId: admin.id, type, status: "ACTIVE" } });
      if (!j) throw new UserError("ledger.invalidJournal");
      return j.id;
    };
    const retained = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: "RETAINED_EARNINGS", type: "DETAIL", status: "ACTIVE" } });
    if (!retained) throw new UserError("yearEnd.noRetainedEarnings");
    // Period 13 must accept the closing entry.
    await tx.accountingPeriod.updateMany({ where: { fiscalYearId: fy.id, number: 13 }, data: { status: "OPEN" } });

    const before = await balances(tx, fy.id, admin.baseCurrency);
    const plByAccount = new Map<string, Decimal>();
    for (const g of before.filter((x) => PL.includes(x.category))) plByAccount.set(g.accountId, (plByAccount.get(g.accountId) ?? new Decimal(0)).plus(g.base));
    const closingLines: LineInput[] = [];
    let result = new Decimal(0);
    for (const [accountId, base] of plByAccount) {
      if (base.isZero()) continue;
      closingLines.push({ accountId, ...side(base.negated()), description: "Afsluiting resultaatrekening" });
      result = result.plus(base);
    }
    let closingEntryId: string | null = null;
    if (!result.isZero() || closingLines.length) {
      if (!result.isZero()) closingLines.push({ accountId: retained.id, ...side(result), description: `Resultaat ${fy.code} naar ingehouden winsten` });
      const entry = await engine.createAndPostYearEnd(tx, access, {
        administrationId: admin.id, journalId: await journal("CLOSING"), entryDate: iso(fy.endDate), kind: "CLOSING", description: `Jaarafsluiting ${fy.code}`,
        lines: closingLines, sourceType: "YEAR_END", sourceId: c.id, idempotencyKey: `year-end-close:${c.id}:${c.reopenCount}`,
      }, c.approvedById);
      closingEntryId = entry.id;
    }

    // Next fiscal year (created when missing, F5) and the opening entry — all in this one transaction.
    let next = await tx.fiscalYear.findFirst({ where: { administrationId: admin.id, startDate: { gt: fy.endDate } }, orderBy: { startDate: "asc" } });
    if (!next) {
      const start = new Date(fy.endDate.getTime() + 86_400_000);
      const { endDate } = fiscalYearRange(start.getUTCFullYear(), start.getUTCMonth() + 1);
      await insertFiscalYear(tx, access.organizationId, admin.id, start, endDate);
      next = await tx.fiscalYear.findFirstOrThrow({ where: { administrationId: admin.id, startDate: start } });
    }
    if (next.status === "CLOSED") throw new UserError("errors.fiscalYearClosed");
    const after = await balances(tx, fy.id, admin.baseCurrency);
    const openingLines: LineInput[] = [];
    for (const g of after.filter((x) => !PL.includes(x.category))) {
      const base = new Decimal(g.base);
      const t = new Decimal(g.tx);
      if (base.isZero() && t.isZero()) continue;
      if (g.currency === admin.baseCurrency) {
        if (!base.isZero()) openingLines.push({ accountId: g.accountId, ...side(base), description: "Beginbalans" });
        continue;
      }
      // Foreign currency: the transaction amount at its average rate; a cent difference goes into a base-only line.
      if (!t.isZero() && !base.isZero() && base.gt(0) === t.gt(0)) {
        const rate = base.dividedBy(t).toDecimalPlaces(10);
        const converted = t.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        openingLines.push({ accountId: g.accountId, currency: g.currency, rate: rate.toString(), ...(t.gt(0) ? { debit: t.toFixed(2) } : { credit: t.abs().toFixed(2) }), description: "Beginbalans" });
        const rest = base.minus(converted);
        if (!rest.isZero()) openingLines.push({ accountId: g.accountId, currency: g.currency, rate: rate.toString(), fxAdjustment: true, ...side(rest), description: "Beginbalans (afronding koers)" });
      } else {
        // Only a base value left (e.g. after revaluation), or tx and base with opposite signs: carry both parts separately.
        if (!t.isZero()) openingLines.push({ accountId: g.accountId, currency: g.currency, rate: "1", fxAdjustment: true, ...side(new Decimal(0).plus(base)), description: "Beginbalans" });
        else openingLines.push({ accountId: g.accountId, currency: g.currency, rate: "1", fxAdjustment: true, ...side(base), description: "Beginbalans (herwaardering)" });
      }
    }
    if (openingLines.length < 2) throw new UserError("yearEnd.nothingToCarry");
    const opn = await journal("OPENING");
    const opening = await engine.createAndPostYearEnd(tx, access, {
      administrationId: admin.id, journalId: opn, entryDate: iso(next.startDate), kind: "OPENING", description: `Beginbalans ${next.code} (overboeking ${fy.code})`,
      lines: openingLines, sourceType: "YEAR_END", sourceId: c.id, idempotencyKey: `year-end-open:${c.id}:${c.reopenCount}`,
    }, c.approvedById);

    // Verification: every balance-sheet account opens next year exactly as it closes this year; P&L accounts are zero.
    const closing = await balances(tx, fy.id, admin.baseCurrency);
    const opened = await tx.$queryRaw<{ accountId: string; base: string }[]>`
      SELECT l."accountId", SUM(l."debitBase" - l."creditBase")::text AS base FROM "JournalLine" l WHERE l."entryId" = ${opening.id} GROUP BY 1`;
    const om = new Map(opened.map((o) => [o.accountId, new Decimal(o.base)]));
    const cm = new Map<string, Decimal>();
    for (const g of closing.filter((x) => !PL.includes(x.category))) cm.set(g.accountId, (cm.get(g.accountId) ?? new Decimal(0)).plus(g.base));
    for (const [id, v] of cm) if (!v.eq(om.get(id) ?? 0)) throw new UserError("yearEnd.openingMismatch");
    for (const g of closing.filter((x) => PL.includes(x.category))) if (!new Decimal(g.base).isZero()) throw new UserError("yearEnd.plNotClosed");

    await tx.accountingPeriod.updateMany({ where: { fiscalYearId: fy.id }, data: { status: "CLOSED", closedById: access.userId, closedAt: new Date() } });
    await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: "CLOSED" } });
    const updated = await tx.yearEndClosing.update({ where: { id: c.id }, data: { status: "CLOSED", closedById: access.userId, closedAt: new Date(), closingEntryId: closingEntryId ?? opening.id, openingEntryId: opening.id } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "yearEnd.closed", entity: "FiscalYear", entityId: fy.id, details: { result: result.negated().toFixed(2), closingEntryId, openingEntryId: opening.id, nextYear: next.code } });
    return updated;
  });
}

/** F6: reopening reverses the next year's opening entry and this year's closing entry; nothing is edited. */
export async function reopenYear(access: Access, closingId: string, reason: string) {
  if (!reason?.trim() || reason.trim().length < 5) throw new UserError("errors.reasonRequired");
  return withTenant(scope(access), async (tx) => {
    const { c, admin, fy } = await loadClosing(tx, closingId);
    assertCan(access, "yearEnd.close", admin.companyId);
    if (c.status !== "CLOSED") throw new UserError("ledger.wrongStatus");
    const next = await tx.fiscalYear.findFirst({ where: { administrationId: admin.id, startDate: { gt: fy.endDate } }, orderBy: { startDate: "asc" } });
    if (next?.status === "CLOSED") throw new UserError("yearEnd.nextYearClosed");
    if (next && c.openingEntryId) {
      await tx.accountingPeriod.updateMany({ where: { fiscalYearId: next.id, number: 0 }, data: { status: "OPEN" } });
      await engine.reverseEntry(tx, access, c.openingEntryId, { entryDate: iso(next.startDate), reason: `Heropening ${fy.code}: ${reason.trim()}`, viaSource: true });
    }
    await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: "CLOSING" } });
    await tx.accountingPeriod.updateMany({ where: { fiscalYearId: fy.id, number: 13 }, data: { status: "OPEN", closedById: null, closedAt: null } });
    if (c.closingEntryId && c.closingEntryId !== c.openingEntryId) {
      await engine.reverseEntry(tx, access, c.closingEntryId, { entryDate: iso(fy.endDate), reason: `Heropening ${fy.code}: ${reason.trim()}`, viaSource: true });
    }
    await tx.yearEndClosing.update({ where: { id: c.id }, data: { status: "IN_PROGRESS", submittedById: null, approvedById: null, approvedAt: null, closedById: null, closedAt: null, closingEntryId: null, openingEntryId: null, reopenCount: { increment: 1 } } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "yearEnd.reopened", entity: "FiscalYear", entityId: fy.id, details: { reason: reason.trim() } });
  });
}

/** Year-end adjustment in period 13 (memorial journal, kind ADJUSTMENT). */
export async function postAdjustment(access: Access, input: { closingId: string; debitAccountId: string; creditAccountId: string; amount: string; description: string }) {
  return withTenant(scope(access), async (tx) => {
    const { c, admin, fy } = await loadClosing(tx, input.closingId);
    if (c.status !== "IN_PROGRESS") throw new UserError("yearEnd.notInProgress");
    const mem = await tx.journal.findFirst({ where: { administrationId: admin.id, type: "GENERAL", status: "ACTIVE" }, orderBy: { code: "asc" } });
    if (!mem) throw new UserError("ledger.invalidJournal");
    await tx.accountingPeriod.updateMany({ where: { fiscalYearId: fy.id, number: 13, status: { not: "OPEN" } }, data: { status: "OPEN" } });
    return engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: mem.id, entryDate: iso(fy.endDate), kind: "ADJUSTMENT", description: input.description,
      lines: [{ accountId: input.debitAccountId, debit: input.amount }, { accountId: input.creditAccountId, credit: input.amount }],
    });
  });
}
