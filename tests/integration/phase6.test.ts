import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import {
  approveVersion, budgetVsActual, createBudget, distributeYear, importLines, newVersion, returnToDraft, rollingForecast, saveCells, submitVersion,
} from "@/modules/budgets/service";
import { assignCompany, createAdministration, createCompany, createNextFiscalYear, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, access.organizationId))!;
  const mem = await systemDb.journal.findFirstOrThrow({ where: { administrationId: administration.id, code: "MEM" } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const book = (date: string, debit: string, credit: string, amount: string, post = true) =>
    withTenant(access, (tx) => (post ? engine.createAndPost : engine.createEntry)(tx, access, { administrationId: administration.id, journalId: mem.id, entryDate: date, description: "Boeking", lines: [{ accountId: acc(debit), debit: amount }, { accountId: acc(credit), credit: amount }] }));
  return { access, controller, adminId: administration.id, fyId: fiscalYear.id, acc, book };
}

describe("Phase 6: budgets", () => {
  it("budget versus actual uses posted entries only (B1) with correct variances (B2), totals and alerts", async () => {
    const b = await books();
    const { budget, version } = await createBudget(b.access, { administrationId: b.adminId, fiscalYearId: b.fyId, name: "Budget 2026", alertThresholdPct: "10" });
    await distributeYear(b.access, { versionId: version.id, accountId: b.acc("8010"), amount: "120000", method: "EVEN" });
    await saveCells(b.access, version.id, [{ accountId: b.acc("4100"), period: 1, amount: "2000" }, { accountId: b.acc("4100"), period: 2, amount: "2000" }]);
    // Actuals: revenue Jan 9,000 (credit 8010), rent Jan 2,500 (debit 4100), a draft that must not count.
    await b.book("2026-01-15", "1910", "8010", "9000");
    await b.book("2026-01-31", "4100", "1910", "2500");
    await b.book("2026-01-20", "4100", "1910", "99999", false);

    const r = await withTenant(b.access, (tx) => budgetVsActual(tx, { budgetId: budget.id, fromPeriod: 1, toPeriod: 1 }));
    const rent = r.rows.find((x) => x.number === "4100")!;
    expect(rent).toMatchObject({ budget: "2000.00", actual: "2500.00", variance: "500.00", pct: "25.0", favourable: false, alert: true });
    const revenue = r.rows.find((x) => x.number === "8010")!;
    expect(revenue).toMatchObject({ budget: "10000.00", actual: "9000.00", variance: "-1000.00", pct: "-10.0", favourable: false, alert: true });
    expect(r.result).toMatchObject({ budget: "8000.00", actual: "6500.00" });
    expect(r.alerts.map((a) => a.number).sort()).toEqual(["4100", "8010"]);
    // Full year
    const year = await withTenant(b.access, (tx) => budgetVsActual(tx, { budgetId: budget.id, fromPeriod: 1, toPeriod: 12 }));
    expect(year.rows.find((x) => x.number === "8010")!.budget).toBe("120000.00");
  });

  it("submitted and approved versions are immutable (B3); approval needs another user; a new version supersedes", async () => {
    const b = await books();
    const { budget, version } = await createBudget(b.access, { administrationId: b.adminId, fiscalYearId: b.fyId, name: "Kosten" });
    await importLines(b.access, version.id, "rekening;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec\n4100;2.000;2.000;2.000;2.000;2.000;2.000;2.000;2.000;2.000;2.000;2.000;2.000\n4110;1;500,00\n");
    await expect(importLines(b.access, version.id, "9999;1;10")).rejects.toMatchObject({ key: "budgets.csvUnknownAccounts" });
    await submitVersion(b.access, version.id);
    await expect(saveCells(b.access, version.id, [{ accountId: b.acc("4100"), period: 1, amount: "1" }])).rejects.toMatchObject({ key: "budgets.notDraft" });
    await expect(systemDb.budgetLine.updateMany({ where: { versionId: version.id }, data: { amount: "1" } })).rejects.toThrow(/immutable/);
    await expect(approveVersion(b.access, version.id)).rejects.toMatchObject({ key: "ledger.segregation" });
    await returnToDraft(b.controller, version.id, "Huur is te laag");
    await saveCells(b.access, version.id, [{ accountId: b.acc("4100"), period: 1, amount: "2200" }]);
    await submitVersion(b.access, version.id);
    await approveVersion(b.controller, version.id);
    await expect(systemDb.budgetVersion.update({ where: { id: version.id }, data: { adjustmentPct: "5" } })).rejects.toThrow(/immutable/);
    await expect(systemDb.budgetLine.deleteMany({ where: { versionId: version.id } })).rejects.toThrow(/immutable/);

    const v2 = await newVersion(b.access, budget.id, "Huurverhoging");
    await expect(newVersion(b.access, budget.id)).rejects.toMatchObject({ key: "budgets.openVersionExists" });
    expect(await systemDb.budgetLine.count({ where: { versionId: v2.id } })).toBe(13);
    await saveCells(b.access, v2.id, [{ accountId: b.acc("4100"), period: 12, amount: "3000" }]);
    // Reports use the approved version until v2 is approved.
    const before = await withTenant(b.access, (tx) => budgetVsActual(tx, { budgetId: budget.id, fromPeriod: 12, toPeriod: 12 }));
    expect(before.version!.id).toBe(version.id);
    expect(before.rows.find((x) => x.number === "4100")!.budget).toBe("2000.00");
    await submitVersion(b.access, v2.id);
    await approveVersion(b.controller, v2.id);
    expect((await systemDb.budgetVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("SUPERSEDED");
    const after = await withTenant(b.access, (tx) => budgetVsActual(tx, { budgetId: budget.id, fromPeriod: 12, toPeriod: 12 }));
    expect(after.rows.find((x) => x.number === "4100")!.budget).toBe("3000.00");
  });

  it("builds next year's budget from last year's actuals (+5%), distributes by last year's pattern, and forecasts", async () => {
    const b = await books();
    await b.book("2026-03-10", "1910", "8010", "1000");
    await b.book("2026-11-10", "1910", "8010", "3000");
    await b.book("2026-06-10", "4100", "1910", "400");
    const fy2027 = await createNextFiscalYear(b.access, b.adminId);
    const { budget, version } = await createBudget(b.access, { administrationId: b.adminId, fiscalYearId: fy2027.id, name: "Budget 2027", basis: "PRIOR_ACTUALS", adjustmentPct: "5" });
    const lines = await systemDb.budgetLine.findMany({ where: { versionId: version.id }, orderBy: [{ period: "asc" }] });
    expect(lines.map((l) => [l.period, l.amount.toString()])).toEqual([[3, "1050"], [6, "420"], [11, "3150"]]);
    await expect(createBudget(b.access, { administrationId: b.adminId, fiscalYearId: b.fyId, name: "Geen basis", basis: "PRIOR_ACTUALS" })).rejects.toMatchObject({ key: "budgets.noPriorYear" });

    // Seasonal distribution: 8,000 revenue follows last year's March/November pattern (1:3).
    await distributeYear(b.access, { versionId: version.id, accountId: b.acc("8010"), amount: "8000", method: "PRIOR_YEAR" });
    const rev = await systemDb.budgetLine.findMany({ where: { versionId: version.id, accountId: b.acc("8010") }, orderBy: { period: "asc" } });
    expect(rev.map((l) => [l.period, l.amount.toString()])).toEqual([[3, "2000"], [11, "6000"]]);

    // Forecast after March 2027 with actual March revenue of 2,500: 2,500 + remaining budget 6,000.
    await b.book("2027-03-15", "1910", "8010", "2500");
    const f = await withTenant(b.access, (tx) => rollingForecast(tx, { budgetId: budget.id, asOfPeriod: 3 }));
    expect(f.rows.find((r) => r.number === "8010")).toMatchObject({ actualToDate: "2500.00", remainingBudget: "6000.00", forecast: "8500.00", yearBudget: "8000.00", variance: "500.00", favourable: true });
    expect(f.result).toEqual({ forecast: "8080.00", yearBudget: "7580.00" }); // revenue − rent 420

    // Copying an approved budget of the prior year.
    const prior = await createBudget(b.access, { administrationId: b.adminId, fiscalYearId: b.fyId, name: "Budget 2026" });
    await saveCells(b.access, prior.version.id, [{ accountId: b.acc("4200"), period: 2, amount: "100" }]);
    await submitVersion(b.access, prior.version.id);
    await approveVersion(b.controller, prior.version.id);
    const copy = await createBudget(b.access, { administrationId: b.adminId, fiscalYearId: fy2027.id, name: "Kopie", basis: "PRIOR_BUDGET", adjustmentPct: "-10" });
    expect((await systemDb.budgetLine.findMany({ where: { versionId: copy.version.id } })).map((l) => [l.period, l.amount.toString()])).toEqual([[2, "90"]]);
  });

  it("budgets of another organisation are invisible", async () => {
    const a = await books();
    const other = await books();
    const { budget, version } = await createBudget(other.access, { administrationId: other.adminId, fiscalYearId: other.fyId, name: "Geheim" });
    await withTenant(a.access, async (tx) => {
      expect(await tx.budget.count({ where: { id: budget.id } })).toBe(0);
      expect(await tx.budgetVersion.count({ where: { id: version.id } })).toBe(0);
    });
    await expect(saveCells(a.access, version.id, [])).rejects.toMatchObject({ key: "errors.notFound" });
  });
});
