import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { annualStep, generateAnnualAccount, saveDisclosure } from "@/modules/annual-accounts/service";
import { closeYear, reopenYear, reviewYearEnd, setItem, startYearEnd, submitYearEnd } from "@/modules/year-end/service";
import { registerAsset } from "@/modules/assets/service";
import { assignCompany, createAdministration, createCompany, inviteMember, setPeriodStatus } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function closedYear() {
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
  const post = (date: string, d: string, c: string, amount: string) =>
    withTenant(access, (tx) => engine.createAndPost(tx, access, { administrationId: administration.id, journalId: mem, entryDate: date, description: "Boeking", lines: [{ accountId: acc(d), debit: amount }, { accountId: acc(c), credit: amount }] }));
  await post("2026-02-10", "1340", "0610", "20000");
  await post("2026-03-10", "1340", "8010", "15000");
  await post("2026-04-10", "4100", "1620", "6000");
  const cat = await systemDb.assetCategory.findFirstOrThrow({ where: { administrationId: administration.id, code: "INV" } });
  await registerAsset(access, { administrationId: administration.id, categoryId: cat.id, number: "I1", name: "Meubilair", acquisitionDate: "2026-06-15", acquisitionCost: "6000", residualValue: undefined, usefulLifeMonths: 60, method: "STRAIGHT_LINE", decliningRatePct: undefined, depreciationStart: "2027-01-01", location: undefined, costCenterId: undefined, counterAccountId: acc("0090") });
  await post("2026-06-16", "0090", "1340", "6000");
  const c = await startYearEnd(access, fiscalYear.id);
  for (const p of await systemDb.accountingPeriod.findMany({ where: { fiscalYearId: fiscalYear.id, number: { gte: 1, lte: 12 } } })) await setPeriodStatus(access, { periodId: p.id, status: "CLOSED", reason: "Jaarafsluiting" });
  const close = async () => {
    for (const i of await systemDb.yearEndChecklistItem.findMany({ where: { closingId: c.id, status: "OPEN" } })) await setItem(access, i.id, i.mandatory ? "COMPLETED" : "NOT_APPLICABLE", "test");
    await submitYearEnd(access, c.id);
    await reviewYearEnd(controller, c.id, "APPROVE");
    await closeYear(access, c.id);
  };
  await close();
  return { access, controller, adminId: administration.id, fy: fiscalYear, closingId: c.id, close };
}

describe("Phase 9C: annual accounts (workflow 9)", () => {
  it("generates statements with notes and asset schedule from the closed year; approval by another user; final only with an unchanged ledger", async () => {
    const b = await closedYear();
    const aa = await generateAnnualAccount(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id, framework: "NV_IFRS_SME" });
    const snap = aa.snapshot as { pl: { totals: { netResult: string } }; bs: { balanced: boolean; result: string; totals: { assets: string } }; assets: { category: string; additions: string; bookValue: string }[] };
    expect(snap.pl.totals.netResult).toBe("9000.00"); // closed year still shows its result
    expect(snap.bs).toMatchObject({ balanced: true, result: "9000.00", totals: { assets: "35000.00" } });
    expect(snap.assets).toEqual([expect.objectContaining({ category: "Inventaris", additions: "6000.00", bookValue: "6000.00" })]);
    const notes = await systemDb.financialDisclosure.findMany({ where: { annualAccountId: aa.id }, orderBy: { sortOrder: "asc" } });
    expect(notes.map((n) => n.code)).toEqual(["GENERAL", "BASIS", "VALUATION", "FIXED_ASSETS", "EQUITY", "SUBSEQUENT_EVENTS"]);
    expect(notes.find((n) => n.code === "BASIS")!.body).toMatch(/S\.B\. 2017 no\. 84.*CONCEPT/);

    await saveDisclosure(b.access, { annualAccountId: aa.id, code: "BASIS", title: "Grondslagen", body: "Door de accountant vastgestelde grondslagen." });
    await generateAnnualAccount(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id, framework: "NV_IFRS_SME" }); // regenerate keeps the edited note
    expect((await systemDb.financialDisclosure.findFirstOrThrow({ where: { annualAccountId: aa.id, code: "BASIS" } })).body).toBe("Door de accountant vastgestelde grondslagen.");

    await annualStep(b.access, aa.id, "submit");
    await expect(annualStep(b.access, aa.id, "approve")).rejects.toMatchObject({ key: "ledger.segregation" });
    await annualStep(b.controller, aa.id, "approve");
    await expect(saveDisclosure(b.access, { annualAccountId: aa.id, code: "X", title: "x", body: "x" })).rejects.toMatchObject({ key: "annual.notDraft" });
    await expect(systemDb.financialDisclosure.updateMany({ where: { annualAccountId: aa.id }, data: { body: "x" } })).rejects.toThrow(/immutable/);
    await annualStep(b.controller, aa.id, "finalize");
    const final = await systemDb.annualAccount.findUniqueOrThrow({ where: { id: aa.id } });
    expect(final.status).toBe("FINAL");
    await expect(systemDb.annualAccount.update({ where: { id: aa.id }, data: { framework: "FOUNDATION" } })).rejects.toThrow(/immutable/);
  });

  it("cannot be finalized when the year is open or the ledger changed after generation", async () => {
    const b = await closedYear();
    const aa = await generateAnnualAccount(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id, framework: "SOLE_PROPRIETOR" });
    expect(await systemDb.financialDisclosure.count({ where: { annualAccountId: aa.id, code: "COMPILATION" } })).toBe(1);
    await annualStep(b.access, aa.id, "submit");
    await annualStep(b.controller, aa.id, "approve");
    await reopenYear(b.access, b.closingId, "Correctie na goedkeuring jaarrekening");
    await expect(annualStep(b.controller, aa.id, "finalize")).rejects.toMatchObject({ key: "annual.yearNotClosed" });
    await b.close();
    await expect(annualStep(b.controller, aa.id, "finalize")).rejects.toMatchObject({ key: "annual.ledgerChanged" });
    // Back to draft, regenerate on the new ledger, approve and finalise.
    await annualStep(b.controller, aa.id, "return");
    await generateAnnualAccount(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id, framework: "SOLE_PROPRIETOR" });
    await annualStep(b.access, aa.id, "submit");
    await annualStep(b.controller, aa.id, "approve");
    await annualStep(b.controller, aa.id, "finalize");
    expect((await systemDb.annualAccount.findUniqueOrThrow({ where: { id: aa.id } })).status).toBe("FINAL");
  });
});
