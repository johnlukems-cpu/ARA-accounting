import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { createHash } from "node:crypto";
import { buildReports, recordRun } from "@/modules/reporting/service";
import { ledgerFingerprint } from "@/modules/reporting/statements";
import { proposeDepreciation, registerAsset } from "@/modules/assets/service";
import { assignCompany, createAdministration, createCompany, inviteMember } from "@/modules/organization/service";
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
  const journal = async (code: string) => (await systemDb.journal.findFirstOrThrow({ where: { administrationId: administration.id, code } })).id;
  const post = async (date: string, lines: [string, "d" | "c", string][], opts: { journal?: string; source?: "MANUAL" | "BANK" } = {}) =>
    withTenant(access, async (tx) => engine.createAndPost(tx, access, {
      administrationId: administration.id, journalId: await journal(opts.journal ?? "MEM"), entryDate: date, description: "Boeking", sourceType: opts.source ?? "MANUAL",
      lines: lines.map(([n, side, amount]): LineInput => ({ accountId: acc(n), ...(side === "d" ? { debit: amount } : { credit: amount }) })),
    }));
  return { access, controller, adminId: administration.id, fyId: fiscalYear.id, acc, journal, post };
}

describe("Phase 8: financial statements", () => {
  it("balance sheet, P&L, cash flow, equity and KPIs from posted entries, consistent with each other", async () => {
    const b = await books();
    // Opening balance: capital 10,000 in cash (approved by the controller).
    const opening = await withTenant(b.access, async (tx) => engine.createEntry(tx, b.access, { administrationId: b.adminId, journalId: await b.journal("OPN"), entryDate: "2026-01-01", description: "Openingsbalans", lines: [{ accountId: b.acc("1010"), debit: "10000" }, { accountId: b.acc("0610"), credit: "10000" }] }));
    await withTenant(b.controller, (tx) => engine.approveEntry(tx, b.controller, opening.id));
    await withTenant(b.access, (tx) => engine.postEntry(tx, b.access, opening.id));

    await b.post("2026-01-10", [["1340", "d", "5000"], ["8010", "c", "5000"]]); // revenue (other receivable)
    await b.post("2026-01-12", [["7010", "d", "2000"], ["1620", "c", "2000"]]); // cost of sales, accrued
    await b.post("2026-01-31", [["4010", "d", "1000"], ["1010", "c", "1000"]], { journal: "KAS", source: "BANK" }); // salaries in cash
    await b.post("2026-02-05", [["1010", "d", "50"], ["9010", "c", "50"]], { journal: "KAS", source: "BANK" }); // interest
    await b.post("2026-02-06", [["1010", "d", "5000"], ["0710", "c", "5000"]], { journal: "KAS", source: "BANK" }); // loan
    await b.post("2026-02-28", [["4950", "d", "300"], ["1440", "c", "300"]]); // income tax
    const cat = await systemDb.assetCategory.findFirstOrThrow({ where: { administrationId: b.adminId, code: "COMP" } });
    await registerAsset(b.access, { administrationId: b.adminId, categoryId: cat.id, number: "C1", name: "Server", acquisitionDate: "2026-01-20", acquisitionCost: "3600", residualValue: undefined, usefulLifeMonths: 36, method: "STRAIGHT_LINE", decliningRatePct: undefined, depreciationStart: undefined, location: undefined, costCenterId: undefined, counterAccountId: b.acc("0090") });
    await b.post("2026-01-21", [["0090", "d", "3600"], ["1010", "c", "3600"]], { journal: "KAS", source: "BANK" });
    const dep = await proposeDepreciation(b.access, { administrationId: b.adminId, year: 2026, month: 2 });
    await withTenant(b.controller, (tx) => engine.approveEntry(tx, b.controller, dep.id));
    await withTenant(b.access, (tx) => engine.postEntry(tx, b.access, dep.id));
    await b.post("2026-03-15", [["4100", "d", "999"], ["1620", "c", "999"]]); // March: outside the range

    const r = await withTenant(b.access, (tx) => buildReports(tx, { administrationId: b.adminId, fiscalYearId: b.fyId, fromPeriod: 1, toPeriod: 2 }));
    expect(r.pl.totals).toEqual({ revenue: "5000.00", grossMargin: "3000.00", operatingResult: "1900.00", resultBeforeTax: "1950.00", netResult: "1650.00" });
    const line = (rows: { code: string; amount: string }[], code: string) => rows.find((x) => x.code === code)!.amount;
    expect([line(r.pl.lines, "PERSONNEL"), line(r.pl.lines, "DEPRECIATION"), line(r.pl.lines, "FINANCIAL"), line(r.pl.lines, "INCOME_TAX")]).toEqual(["1000.00", "100.00", "50.00", "300.00"]);

    expect(r.bs.balanced).toBe(true);
    expect([line(r.bs.assets, "FIXED_ASSETS"), line(r.bs.assets, "RECEIVABLES"), line(r.bs.assets, "CASH")]).toEqual(["3500.00", "5000.00", "10450.00"]);
    expect([line(r.bs.liabilities, "EQUITY"), line(r.bs.liabilities, "LONG_TERM_LIABILITIES"), line(r.bs.liabilities, "CURRENT_LIABILITIES"), line(r.bs.liabilities, "TAX_LIABILITIES")]).toEqual(["10000.00", "5000.00", "2000.00", "300.00"]);
    expect(r.bs.totals).toEqual({ assets: "18950.00", liabilitiesAndEquity: "18950.00", equity: "11650.00" });

    expect(r.cashflow).toMatchObject({ netResult: "1650.00", depreciation: "100.00", workingCapitalChange: "-2700.00", operating: "-950.00", investing: "-3600.00", financing: "5000.00", total: "450.00", cashChange: "450.00", openingCash: "10000.00", closingCash: "10450.00", reconciles: true });
    expect(r.equity.totals).toEqual({ opening: "10000.00", movement: "0.00", closing: "11650.00" });

    const kpi = Object.fromEntries(r.kpis.map((k) => [k.code, k.value]));
    expect(kpi).toMatchObject({ grossMargin: "60.0", netMargin: "33.0", currentRatio: "6.72", quickRatio: "6.72", solvency: "61.5", personnelCostRatio: "20.0", revenueGrowth: null, inventoryTurnover: null });
    expect(r.priorPl).toBeNull();
  });

  it("fingerprint: identical for the same ledger and parameters, different after a new posting (R1); exports are archived", async () => {
    const b = await books();
    await b.post("2026-01-10", [["1340", "d", "100"], ["8010", "c", "100"]]);
    const build = (to = 1) => withTenant(b.access, (tx) => buildReports(tx, { administrationId: b.adminId, fiscalYearId: b.fyId, fromPeriod: 1, toPeriod: to }));
    const a1 = await build();
    const a2 = await build();
    expect(a2.fingerprint).toBe(a1.fingerprint);
    expect(a1.entryCount).toBe(1);
    expect((await build(2)).fingerprint).not.toBe(a1.fingerprint); // other parameters
    await withTenant(b.access, async (tx) => engine.createEntry(tx, b.access, { administrationId: b.adminId, journalId: await b.journal("MEM"), entryDate: "2026-01-11", description: "Concept", lines: [{ accountId: b.acc("1340"), debit: "1" }, { accountId: b.acc("8010"), credit: "1" }] }));
    expect((await build()).fingerprint).toBe(a1.fingerprint); // drafts do not count
    await b.post("2026-01-12", [["1340", "d", "1"], ["8010", "c", "1"]]);
    expect((await build()).fingerprint).not.toBe(a1.fingerprint);
    // Computed in SQL; must equal SHA-256 over `params|sorted ids` as computed in the application before Phase 12.
    const params = { kind: "check", toPeriod: 1 };
    const sql = await withTenant(b.access, (tx) => ledgerFingerprint(tx, { administrationId: b.adminId, fiscalYearId: b.fyId, toPeriod: 1, params }));
    const ids = (await systemDb.journalEntry.findMany({ where: { administrationId: b.adminId, status: "POSTED" }, select: { id: true } })).map((e) => e.id).sort();
    expect(sql).toEqual({ entryCount: 2, fingerprint: createHash("sha256").update(JSON.stringify(params)).update("|").update(ids.join(",")).digest("hex") });

    const run = await withTenant(b.access, (tx) => recordRun(tx, b.access, { administrationId: b.adminId, kind: "pl", format: "PDF", params: { fromPeriod: 1, toPeriod: 1 }, fingerprint: a1.fingerprint, entryCount: a1.entryCount }));
    await expect(systemDb.reportRun.update({ where: { id: run.id }, data: { fingerprint: "x" } })).rejects.toThrow(/append-only|immutable/i);
  });
});
