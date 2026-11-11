import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { trialBalance } from "@/modules/ledger/reports";
import { assetRegister, cancelDepreciation, disposeAsset, proposeDepreciation, registerAsset, transferAsset } from "@/modules/assets/service";
import { confirmBalance, createCurrentAccount, recordMovement } from "@/modules/current-accounts/service";
import { assignCompany, createAdministration, createCompany, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function setup() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const categories = await systemDb.assetCategory.findMany({ where: { administrationId: administration.id } });
  const tb = () => withTenant(access, (tx) => trialBalance(tx, { administrationId: administration.id, fiscalYearId: fiscalYear.id, fromPeriod: 0, toPeriod: 13, hideZero: true }));
  const balanceOf = async (number: string) => {
    const r = (await tb()).rows.find((x) => x.number === number);
    return r ? new Decimal(r.closingDebit).minus(r.closingCredit).toFixed(2) : "0.00";
  };
  const controller = async () => {
    const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
    return (await resolveAccess(m.userId, access.organizationId))!;
  };
  return { access, companyId: company.id, adminId: administration.id, acc, cat: (code: string) => categories.find((c) => c.code === code)!.id, tb, balanceOf, controller };
}

type S = Awaited<ReturnType<typeof setup>>;
const laptop = (s: S, extra: Partial<Parameters<typeof registerAsset>[1]> = {}) =>
  registerAsset(s.access, {
    administrationId: s.adminId, categoryId: s.cat("COMP"), number: `A${uid().slice(0, 6)}`, name: "Laptops kantoor Paramaribo", acquisitionDate: "2026-01-15",
    acquisitionCost: "36000", residualValue: undefined, usefulLifeMonths: 36, method: "STRAIGHT_LINE", decliningRatePct: undefined, depreciationStart: undefined,
    location: "Paramaribo", costCenterId: undefined, counterAccountId: s.acc("0090"), ...extra,
  });

async function approveAndPost(s: S, entryId: string, fc: Awaited<ReturnType<S["controller"]>>) {
  await withTenant(fc, (tx) => engine.approveEntry(tx, fc, entryId));
  await withTenant(s.access, (tx) => engine.postEntry(tx, s.access, entryId));
}

describe("Phase 3C: fixed assets", () => {
  it("registers an asset with its acquisition entry and depreciates month by month, never twice", async () => {
    const s = await setup();
    const fc = await s.controller();
    const asset = await laptop(s);
    expect(asset.depreciationStart.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(await s.balanceOf("0500")).toBe("36000.00");
    expect(await s.balanceOf("0090")).toBe("-36000.00");

    // January: nothing (depreciation starts in February).
    await expect(proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 1 })).rejects.toMatchObject({ key: "assets.nothingToDepreciate" });
    const feb = await proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 2 });
    expect(feb.status).toBe("DRAFT");
    await expect(proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 2 })).rejects.toMatchObject({ key: "assets.nothingToDepreciate" });
    // A proposal is not yet in the books; it can be withdrawn and made again.
    expect(await s.balanceOf("4800")).toBe("0.00");
    await cancelDepreciation(s.access, feb.id);
    expect(await systemDb.journalEntry.count({ where: { id: feb.id } })).toBe(0);
    const feb2 = await proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 2 });
    // The depreciation journal requires approval by someone else.
    await expect(withTenant(s.access, (tx) => engine.postEntry(tx, s.access, feb2.id))).rejects.toMatchObject({ key: "ledger.approvalRequired" });
    await approveAndPost(s, feb2.id, fc);
    expect(await s.balanceOf("4800")).toBe("1000.00");
    expect(await s.balanceOf("0505")).toBe("-1000.00");
    // Posted depreciation is permanent: no withdrawal, no deleting its lines.
    await expect(cancelDepreciation(s.access, feb2.id)).rejects.toMatchObject({ key: "ledger.postedImmutable" });
    await expect(systemDb.depreciationLine.deleteMany({ where: { entryId: feb2.id } })).rejects.toThrow(/cannot be changed/);
    // Nor can it be reversed from the ledger: depreciation is corrected through the module.
    await expect(withTenant(s.access, (tx) => engine.reverseEntry(tx, s.access, feb2.id, { entryDate: "2026-02-28", reason: "test reversal" }))).rejects.toBeTruthy();

    const reg = await withTenant(s.access, (tx) => assetRegister(tx, s.adminId, new Date("2026-02-28")));
    expect(reg.find((a) => a.id === asset.id)).toMatchObject({ accumulated: "1000.00", bookValue: "35000.00" });
    expect((await s.tb()).balanced).toBe(true);
  });

  it("disposes with a loss only after depreciation is up to date, and keeps the history", async () => {
    const s = await setup();
    const fc = await s.controller();
    const asset = await laptop(s);
    for (const month of [2, 3]) {
      const e = await proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month });
      if (month === 2) await approveAndPost(s, e.id, fc);
      else {
        await expect(disposeAsset(s.access, { assetId: asset.id, date: "2026-04-10", proceeds: "30000", counterAccountId: s.acc("1010") })).rejects.toMatchObject({ key: "assets.pendingDepreciation" });
        await cancelDepreciation(s.access, e.id);
        await expect(disposeAsset(s.access, { assetId: asset.id, date: "2026-04-10", proceeds: "30000", counterAccountId: s.acc("1010") })).rejects.toMatchObject({ key: "assets.depreciationBehind" });
        await approveAndPost(s, (await proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 3 })).id, fc);
      }
    }
    await transferAsset(s.access, { assetId: asset.id, date: "2026-04-01", location: "Nieuw Nickerie" });
    const r = await disposeAsset(s.access, { assetId: asset.id, date: "2026-04-10", proceeds: "30000", counterAccountId: s.acc("1010") });
    expect(r).toMatchObject({ bookValue: "34000.00", result: "-4000.00" });
    expect(await s.balanceOf("0500")).toBe("0.00");
    expect(await s.balanceOf("0505")).toBe("0.00");
    expect(await s.balanceOf("4810")).toBe("4000.00");
    expect(await s.balanceOf("1010")).toBe("30000.00");
    await expect(disposeAsset(s.access, { assetId: asset.id, date: "2026-04-11", proceeds: "0" })).rejects.toMatchObject({ key: "assets.alreadyDisposed" });
    const history = await systemDb.assetTransaction.findMany({ where: { assetId: asset.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.type)).toEqual(["ACQUISITION", "TRANSFER", "DISPOSAL"]);
    await expect(systemDb.assetTransaction.delete({ where: { id: history[0]!.id } })).rejects.toThrow(/append-only|immutable/i);
    // A disposed asset is out of later depreciation runs.
    await expect(proposeDepreciation(s.access, { administrationId: s.adminId, year: 2026, month: 4 })).rejects.toMatchObject({ key: "assets.nothingToDepreciate" });
    expect((await s.tb()).balanced).toBe(true);
  });

  it("sells with a gain and validates input", async () => {
    const s = await setup();
    const asset = await laptop(s, { counterAccountId: "NONE", depreciationStart: "2026-01-01" });
    expect(asset.acquisitionEntryId).toBeNull();
    await expect(laptop(s, { residualValue: "36000" })).rejects.toMatchObject({ key: "assets.residualTooHigh" });
    await expect(laptop(s, { method: "DECLINING_BALANCE" })).rejects.toMatchObject({ key: "assets.rateRequired" });
    await expect(laptop(s, { depreciationStart: "2026-02-15" })).rejects.toMatchObject({ key: "assets.startFirstOfMonth" });
    await expect(laptop(s, { counterAccountId: s.acc("1310") })).rejects.toMatchObject({ key: "assets.invalidCounterAccount" });
    // Sold in the first depreciation month: book value is the full cost.
    const r = await disposeAsset(s.access, { assetId: asset.id, date: "2026-01-20", proceeds: "40000", counterAccountId: s.acc("1010") });
    expect(r.result).toBe("4000.00");
    expect(await s.balanceOf("8095")).toBe("-4000.00");
  });

  it("asset data of another organisation is invisible", async () => {
    const a = await setup();
    const b = await setup();
    const asset = await laptop(b);
    await withTenant(a.access, async (tx) => {
      expect(await tx.asset.count({ where: { id: asset.id } })).toBe(0);
      expect(await tx.assetCategory.count({ where: { administrationId: b.adminId } })).toBe(0);
    });
    await expect(disposeAsset(a.access, { assetId: asset.id, date: "2026-02-01", proceeds: "0" })).rejects.toMatchObject({ key: "errors.notFound" });
  });
});

describe("Phase 3C: current accounts", () => {
  it("books movements through its own control account and records confirmations with differences", async () => {
    const s = await setup();
    const dir = await createCurrentAccount(s.access, { administrationId: s.adminId, kind: "DIRECTOR", counterpartyName: "R. Ramdin", currency: "SRD", interestRatePct: undefined, agreement: undefined });
    const ledger = await systemDb.account.findUniqueOrThrow({ where: { id: dir.ledgerAccountId } });
    expect(ledger).toMatchObject({ number: "1351", controlType: "CURRENT_ACCOUNT", category: "ASSET" });
    await recordMovement(s.access, { currentAccountId: dir.id, date: "2026-02-03", direction: "INCREASE", amount: "5000", counterAccountId: s.acc("1010"), description: "Opname kas", exchangeRate: undefined });
    await recordMovement(s.access, { currentAccountId: dir.id, date: "2026-02-20", direction: "DECREASE", amount: "2000", counterAccountId: s.acc("1010"), description: "Terugstorting", exchangeRate: undefined });
    expect(await s.balanceOf("1351")).toBe("3000.00");
    expect(await s.balanceOf("1010")).toBe("-3000.00");
    const ok = await confirmBalance(s.access, { currentAccountId: dir.id, date: "2026-02-28", confirmedBalance: "3000" });
    expect(ok.difference.toFixed(2)).toBe("0.00");
    const off = await confirmBalance(s.access, { currentAccountId: dir.id, date: "2026-02-28", confirmedBalance: "2500" });
    expect(off.difference.toFixed(2)).toBe("-500.00");
    await expect(systemDb.currentAccountConfirmation.update({ where: { id: off.id }, data: { notes: "x" } })).rejects.toThrow(/append-only|immutable/i);
    // The control account is closed to manual entries.
    await expect(withTenant(s.access, async (tx) => engine.createEntry(tx, s.access, { administrationId: s.adminId, journalId: (await tx.journal.findFirstOrThrow({ where: { administrationId: s.adminId, code: "MEM" } })).id, entryDate: "2026-02-05", description: "Handmatig", lines: [{ accountId: dir.ledgerAccountId, debit: "1" }, { accountId: s.acc("1910"), credit: "1" }] }))).rejects.toMatchObject({ key: "ledger.controlAccount" });
    await expect(recordMovement(s.access, { currentAccountId: dir.id, date: "2026-02-03", direction: "INCREASE", amount: "1", counterAccountId: s.acc("1310"), description: "Debiteuren", exchangeRate: undefined })).rejects.toMatchObject({ key: "currentAccounts.invalidCounterAccount" });

    const sh = await createCurrentAccount(s.access, { administrationId: s.adminId, kind: "SHAREHOLDER", counterpartyName: "Holding NV", currency: "SRD", interestRatePct: "4", agreement: "Achtergestelde lening" });
    expect(await systemDb.account.findUniqueOrThrow({ where: { id: sh.ledgerAccountId } })).toMatchObject({ number: "1651", category: "LIABILITY", normalBalance: "CREDIT" });
    expect((await s.tb()).balanced).toBe(true);
  });
});
