import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { trialBalance } from "@/modules/ledger/reports";
import { autoChecks, closeYear, postAdjustment, reopenYear, reviewYearEnd, setItem, startYearEnd, submitYearEnd } from "@/modules/year-end/service";
import { createRate, decideRate, postRevaluation, proposeRevaluation, setPolicy } from "@/modules/currency/service";
import { assignCompany, createAdministration, createCompany, inviteMember, setPeriodStatus } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, access.organizationId))!;
  const mem = (await systemDb.journal.findFirstOrThrow({ where: { administrationId: administration.id, code: "MEM" } })).id;
  const post = (date: string, d: string, c: string, amount: string, extra: { currency?: string; rate?: string } = {}) =>
    withTenant(access, (tx) => engine.createAndPost(tx, access, { administrationId: administration.id, journalId: mem, entryDate: date, description: "Boeking", lines: [{ accountId: acc(d), debit: amount, ...extra }, { accountId: acc(c), credit: extra.rate ? new Decimal(amount).times(extra.rate).toFixed(2) : amount }] }));
  return { access, controller, adminId: administration.id, fy: fiscalYear, acc, post };
}

/** Completes every checklist item (auto items need their check to pass) and has the controller approve. */
async function completeAndApprove(b: Awaited<ReturnType<typeof books>>, closingId: string) {
  const items = await systemDb.yearEndChecklistItem.findMany({ where: { closingId } });
  for (const i of items) {
    if (i.status !== "OPEN") continue;
    if (!i.mandatory) await setItem(b.access, i.id, "NOT_APPLICABLE", "Niet van toepassing in deze test");
    else await setItem(b.access, i.id, "COMPLETED", "Gecontroleerd");
  }
  await submitYearEnd(b.access, closingId);
  await expect(reviewYearEnd(b.access, closingId, "APPROVE")).rejects.toMatchObject({ key: "ledger.segregation" });
  await reviewYearEnd(b.controller, closingId, "APPROVE");
}

async function closeAllPeriods(b: Awaited<ReturnType<typeof books>>) {
  const periods = await systemDb.accountingPeriod.findMany({ where: { fiscalYearId: b.fy.id, number: { gte: 1, lte: 12 } } });
  for (const p of periods) await setPeriodStatus(b.access, { periodId: p.id, status: "CLOSED", reason: "Jaarafsluiting" });
}

describe("Phase 9A: year-end closing (workflow 7)", () => {
  it("F4: the checklist blocks until mandatory items pass; F5: P&L to retained earnings, balances carried forward and verified", async () => {
    const b = await books();
    await b.post("2026-03-10", "1340", "8010", "12000"); // revenue
    await b.post("2026-04-10", "4100", "1620", "4000"); // rent accrued
    await b.post("2026-05-10", "1340", "0610", "10000"); // capital paid in (receivable from shareholder)
    await b.post("2026-06-10", "1910", "8090", "250"); // suspense left open
    const c = await startYearEnd(b.access, b.fy.id);
    expect((await systemDb.yearEndChecklistItem.count({ where: { closingId: c.id } }))).toBe(24);
    const checks = await withTenant(b.access, (tx) => autoChecks(tx, b.adminId, b.fy.id));
    expect(checks).toMatchObject({ NO_DRAFTS: true, PERIODS_CLOSED: "open:12", SUSPENSE_CLEARED: "balance", TRIAL_BALANCE_BALANCED: true, BANK_RECONCILED: true, FX_REVALUATION: true });

    const item = async (code: string) => systemDb.yearEndChecklistItem.findFirstOrThrow({ where: { closingId: c.id, code } });
    await expect(setItem(b.access, (await item("SUSPENSE_CLEARED")).id, "COMPLETED")).rejects.toMatchObject({ key: "yearEnd.checkFails" });
    await expect(setItem(b.access, (await item("CASH_COUNTED")).id, "NOT_APPLICABLE", "x")).rejects.toMatchObject({ key: "yearEnd.mandatoryItem" });
    await expect(submitYearEnd(b.access, c.id)).rejects.toMatchObject({ key: "yearEnd.itemsOpen" });
    // Clear suspense with a year-end adjustment in period 13.
    const adj = await postAdjustment(b.access, { closingId: c.id, debitAccountId: b.acc("8090"), creditAccountId: b.acc("1910"), amount: "250", description: "Vraagpost opgelost" });
    expect(adj.kind).toBe("ADJUSTMENT");
    await closeAllPeriods(b);
    await completeAndApprove(b, c.id);
    await expect(closeYear(b.controller, c.id)).rejects.toMatchObject({ key: "errors.forbidden" });
    const closed = await closeYear(b.access, c.id);
    expect(closed.status).toBe("CLOSED");

    // Result 12,000 − 4,000 = 8,000 to retained earnings; P&L accounts zero after period 13.
    const tb = await withTenant(b.access, (tx) => trialBalance(tx, { administrationId: b.adminId, fiscalYearId: b.fy.id, fromPeriod: 0, toPeriod: 13, hideZero: true }));
    const net = (n: string) => { const r = tb.rows.find((x) => x.number === n); return r ? new Decimal(r.closingDebit).minus(r.closingCredit).toFixed(2) : "0.00"; };
    expect([net("8010"), net("4100"), net("0630")]).toEqual(["0.00", "0.00", "-8000.00"]);
    const next = await systemDb.fiscalYear.findFirstOrThrow({ where: { administrationId: b.adminId, code: "2027" } });
    const opening = await systemDb.journalLine.findMany({ where: { entryId: closed.openingEntryId! }, include: { account: { select: { number: true } } } });
    const o = Object.fromEntries(opening.map((l) => [l.account.number, l.debitBase.minus(l.creditBase).toFixed(2)]));
    expect(o).toEqual({ "1340": "22000.00", "1620": "-4000.00", "0610": "-10000.00", "0630": "-8000.00" });
    expect((await systemDb.journalEntry.findUniqueOrThrow({ where: { id: closed.openingEntryId! } })).approvedById).toBe(b.controller.userId);
    expect((await systemDb.fiscalYear.findUniqueOrThrow({ where: { id: b.fy.id } })).status).toBe("CLOSED");
    expect(next.status).toBe("OPEN");
    // The closed year accepts nothing.
    await expect(b.post("2026-12-15", "1340", "8010", "1")).rejects.toMatchObject({ key: "errors.fiscalYearClosed" });
    await expect(systemDb.yearEndChecklistItem.updateMany({ where: { closingId: c.id }, data: { comment: "x" } })).rejects.toThrow(/immutable/);
  });

  it("F6: reopening needs a reason, reverses opening and closing entries, and the year can be closed again", async () => {
    const b = await books();
    await b.post("2026-03-10", "1340", "8010", "5000");
    const c = await startYearEnd(b.access, b.fy.id);
    await closeAllPeriods(b);
    await completeAndApprove(b, c.id);
    const first = await closeYear(b.access, c.id);
    await expect(reopenYear(b.access, c.id, "")).rejects.toMatchObject({ key: "errors.reasonRequired" });
    await reopenYear(b.access, c.id, "Correctie omzet december");
    const [opening, closing] = await Promise.all([systemDb.journalEntry.findUniqueOrThrow({ where: { id: first.openingEntryId! } }), systemDb.journalEntry.findUniqueOrThrow({ where: { id: first.closingEntryId! } })]);
    expect(opening.reversedByEntryId).toBeTruthy();
    expect(closing.reversedByEntryId).toBeTruthy();
    const reopened = await systemDb.yearEndClosing.findUniqueOrThrow({ where: { id: c.id } });
    expect(reopened).toMatchObject({ status: "IN_PROGRESS", approvedById: null, reopenCount: 1 });
    expect((await systemDb.fiscalYear.findUniqueOrThrow({ where: { id: b.fy.id } })).status).toBe("CLOSING");

    // A correction in period 13, then approval and close again: the next year opens with the corrected figures.
    await postAdjustment(b.access, { closingId: c.id, debitAccountId: b.acc("1340"), creditAccountId: b.acc("8010"), amount: "500", description: "Nagekomen omzet" });
    await submitYearEnd(b.access, c.id);
    await reviewYearEnd(b.controller, c.id, "APPROVE");
    const second = await closeYear(b.access, c.id);
    const next = await systemDb.fiscalYear.findFirstOrThrow({ where: { administrationId: b.adminId, code: "2027" } });
    const tb = await withTenant(b.access, (tx) => trialBalance(tx, { administrationId: b.adminId, fiscalYearId: next.id, fromPeriod: 0, toPeriod: 0, hideZero: true }));
    const row = (n: string) => { const r = tb.rows.find((x) => x.number === n)!; return new Decimal(r.closingDebit).minus(r.closingCredit).toFixed(2); };
    expect([row("1340"), row("0630")]).toEqual(["5500.00", "-5500.00"]);
    expect(second.openingEntryId).not.toBe(first.openingEntryId);
    expect(await systemDb.auditLog.count({ where: { organizationId: b.access.organizationId, action: "yearEnd.reopened" } })).toBe(1);
  });

  it("carries foreign-currency balances forward with their transaction amounts and the revalued base", async () => {
    const b = await books();
    await b.post("2026-02-10", "1340", "0610", "1000", { currency: "USD", rate: "37.3333333333" }); // base 37,333.33
    await setPolicy(b.access, b.adminId, { monetaryAccounts: ["1340"] });
    const c = await startYearEnd(b.access, b.fy.id);
    expect((await withTenant(b.access, (tx) => autoChecks(tx, b.adminId, b.fy.id))).FX_REVALUATION).toBe("notRevalued");
    const rate = await createRate(b.access, { baseCurrency: "SRD", currency: "USD", rateType: "CLOSING", rate: "38", effectiveDate: "2026-12-31" });
    await decideRate(b.controller, rate.id, "APPROVED");
    const p12 = await systemDb.accountingPeriod.findFirstOrThrow({ where: { fiscalYearId: b.fy.id, number: 12 } });
    const reval = await proposeRevaluation(b.access, { administrationId: b.adminId, periodId: p12.id });
    expect(reval.total).toBe("666.67");
    await withTenant(b.controller, (tx) => engine.approveEntry(tx, b.controller, reval.entry.id));
    await postRevaluation(b.access, reval.revaluation.id); // reversal waits for 2027
    expect((await withTenant(b.access, (tx) => autoChecks(tx, b.adminId, b.fy.id))).FX_REVALUATION).toBe(true);
    await closeAllPeriods(b);
    await completeAndApprove(b, c.id);
    const closed = await closeYear(b.access, c.id);
    const lines = await systemDb.journalLine.findMany({ where: { entryId: closed.openingEntryId!, accountId: b.acc("1340") } });
    const tx = lines.reduce((s, l) => s.plus(l.txAmount.toString()), new Decimal(0));
    const base = lines.reduce((s, l) => s.plus(l.debitBase.toString()).minus(l.creditBase.toString()), new Decimal(0));
    expect([tx.toFixed(2), base.toFixed(2)]).toEqual(["1000.00", "38000.00"]);
    expect(lines.every((l) => l.txCurrency === "USD")).toBe(true);
  });
});
