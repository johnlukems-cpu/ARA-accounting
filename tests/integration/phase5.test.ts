import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess, type Access } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { trialBalance } from "@/modules/ledger/reports";
import { approveInvoice, createFinancialAccount, postInvoice, registerPayment, saveInvoice, saveParty } from "@/modules/invoicing/service";
import { controlAccountCheck } from "@/modules/invoicing/reports";
import {
  createRate, decideRate, findRate, importCbvsRates, postRevaluation, proposeRevaluation, reverseRevaluation, revaluationPreview, setPolicy, completeReversal,
} from "@/modules/currency/service";
import { assignCompany, createAdministration, createCompany, createNextFiscalYear, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const codes = await systemDb.taxCode.findMany({ where: { administrationId: administration.id } });
  const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, access.organizationId))!;
  const periods = await systemDb.accountingPeriod.findMany({ where: { fiscalYearId: fiscalYear.id }, orderBy: { number: "asc" } });
  return {
    access, controller, companyId: company.id, adminId: administration.id, fyId: fiscalYear.id,
    acc: (n: string) => accounts.find((a) => a.number === n)!.id,
    tax: (c: string) => codes.find((x) => x.code === c)!.id,
    period: (n: number) => periods.find((p) => p.number === n)!,
  };
}
type Books = Awaited<ReturnType<typeof books>>;

const balance = async (b: Books, number: string, toPeriod = 13) => {
  const r = (await withTenant(b.access, (tx) => trialBalance(tx, { administrationId: b.adminId, fiscalYearId: b.fyId, fromPeriod: 0, toPeriod, hideZero: true }))).rows.find((x) => x.number === number);
  return r ? new Decimal(r.closingDebit).minus(r.closingCredit).toFixed(2) : "0.00";
};
const approvedRate = async (b: Books, currency: string, rateType: Parameters<typeof createRate>[1]["rateType"], rate: string, effectiveDate: string) => {
  const r = await createRate(b.access, { baseCurrency: "SRD", currency, rateType, rate, effectiveDate });
  return decideRate(b.controller, r.id, "APPROVED");
};
const usdParty = async (b: Books, supplier = false) =>
  (await saveParty(b.access, { administrationId: b.adminId, code: `P${uid().slice(0, 6)}`, name: `Relatie ${uid()}`, isCustomer: !supplier, isSupplier: supplier, currency: "USD", paymentTermDays: 30 }))!;

describe("Phase 5: exchange rates", () => {
  it("rates are entered, approved by someone else, immutable once decided, and found within the policy window", async () => {
    const b = await books();
    const r = await createRate(b.access, { baseCurrency: "SRD", currency: "USD", rateType: "CBVS_SELL", rate: "38,15", effectiveDate: "2026-03-06" });
    expect(r.rate.toString()).toBe("38.15");
    await expect(createRate(b.access, { baseCurrency: "SRD", currency: "USD", rateType: "CBVS_SELL", rate: "38.2", effectiveDate: "2026-03-06" })).rejects.toMatchObject({ key: "currency.rateExists" });
    await expect(decideRate(b.access, r.id, "APPROVED")).rejects.toMatchObject({ key: "ledger.segregation" });
    const find = (date: string, requireApproved = false) => withTenant(b.access, (tx) => findRate(tx, { baseCurrency: "SRD", currency: "USD", rateType: "CBVS_SELL", date, maxAgeDays: 7, requireApproved }));
    expect((await find("2026-03-10"))?.id).toBe(r.id); // weekend/holiday gap
    expect(await find("2026-03-14")).toBeNull(); // older than 7 days
    expect(await find("2026-03-05")).toBeNull(); // no rate before
    expect(await find("2026-03-10", true)).toBeNull(); // pending
    await decideRate(b.controller, r.id, "APPROVED");
    expect((await find("2026-03-10", true))?.id).toBe(r.id);
    await expect(systemDb.exchangeRate.update({ where: { id: r.id }, data: { rate: "40" } })).rejects.toThrow(/immutable/);
    await expect(systemDb.exchangeRate.delete({ where: { id: r.id } })).rejects.toThrow(/immutable/);
  });

  it("imports CBvS buying and selling rates once and rejects a malformed file", async () => {
    const b = await books();
    const csv = "datum;valuta;aankoop;verkoop\n02-03-2026;USD;37,85;38,15\n02-03-2026;EUR;40,10;41,20\n";
    expect(await importCbvsRates(b.access, { baseCurrency: "SRD", content: csv, fileName: "cbvs-maart.csv" })).toEqual({ created: 4, skipped: 0 });
    expect(await importCbvsRates(b.access, { baseCurrency: "SRD", content: csv, fileName: "cbvs-maart.csv" })).toEqual({ created: 0, skipped: 4 });
    await expect(importCbvsRates(b.access, { baseCurrency: "SRD", content: "02-03-2026;USD;x;38", fileName: "fout.csv" })).rejects.toMatchObject({ key: "currency.csvErrors" });
    expect(await systemDb.exchangeRate.count({ where: { organizationId: b.access.organizationId, source: "CBVS_IMPORT", status: "PENDING" } })).toBe(4);
  });
});

describe("Phase 5: workflow 4 — USD purchase invoice paid at another rate", () => {
  it("takes the CBvS selling rate from the policy, audits an override, and books the realised difference on payment", async () => {
    const b = await books();
    await approvedRate(b, "USD", "CBVS_SELL", "38.0000", "2026-03-02");
    const supplier = await usdParty(b, true);
    const invoice = (n: string, exchangeRate?: string) => saveInvoice(b.access, {
      administrationId: b.adminId, type: "PURCHASE", kind: "INVOICE", partyId: supplier.id, externalNumber: n, invoiceDate: "2026-03-02", dueDate: "2026-04-01", currency: "USD", exchangeRate,
      lines: [{ description: "Onderdelen", quantity: "1", unitPrice: "1000", accountId: b.acc("4500"), taxCodeId: b.tax("BTW0") }],
    });
    const inv = (await invoice(`INV-${uid()}`))!;
    expect(inv.exchangeRate.toString()).toBe("38");
    expect(inv.rateSource).toMatch(/^CBVS_SELL:/);

    // Override: without currency.edit refused; with it allowed and audited.
    const noEdit: Access = { ...b.access, companyPermissions: new Map([...b.access.companyPermissions].map(([k, v]) => [k, new Set([...v].filter((p) => p !== "currency.edit"))])) };
    await expect(saveInvoice(noEdit, { administrationId: b.adminId, type: "PURCHASE", kind: "INVOICE", partyId: supplier.id, externalNumber: `X-${uid()}`, invoiceDate: "2026-03-02", dueDate: "2026-04-01", currency: "USD", exchangeRate: "39", lines: [{ description: "x", quantity: "1", unitPrice: "1", accountId: b.acc("4500"), taxCodeId: b.tax("BTW0") }] })).rejects.toMatchObject({ key: "currency.overrideNotAllowed" });
    const overridden = (await invoice(`INV-${uid()}`, "39"))!;
    expect(overridden.rateSource).toBe("MANUAL_OVERRIDE");
    expect(await systemDb.auditLog.count({ where: { organizationId: b.access.organizationId, action: "fx.rateOverride" } })).toBe(1);

    // No rate on file for EUR → the user must type one.
    const eur = await saveParty(b.access, { administrationId: b.adminId, code: `E${uid().slice(0, 6)}`, name: "EUR leverancier", isCustomer: false, isSupplier: true, currency: "EUR", paymentTermDays: 30 });
    await expect(saveInvoice(b.access, { administrationId: b.adminId, type: "PURCHASE", kind: "INVOICE", partyId: eur!.id, externalNumber: `E-${uid()}`, invoiceDate: "2026-03-02", dueDate: "2026-04-01", currency: "EUR", lines: [{ description: "x", quantity: "1", unitPrice: "1", accountId: b.acc("4500"), taxCodeId: b.tax("BTW0") }] })).rejects.toMatchObject({ key: "currency.noPolicyRate" });

    await approveInvoice(b.controller, inv.id);
    const posted = await postInvoice(b.access, inv.id);
    expect(await balance(b, "4500")).toBe("38000.00");
    const item = await systemDb.openItem.findFirstOrThrow({ where: { sourceId: posted!.id } });
    const usdBank = (await createFinancialAccount(b.access, { administrationId: b.adminId, kind: "BANK", name: "DSB USD", bankCode: "DSB", accountNumber: `30${uid().slice(0, 5)}`, currency: "USD" }))!;
    // Bank and cambio movements use the actual rate of the statement (no policy default).
    await registerPayment(b.access, { administrationId: b.adminId, direction: "OUT", financialAccountId: usdBank.id, date: "2026-03-20", amount: "1000", exchangeRate: "38.5", allocations: [{ openItemId: item.id, amount: "1000" }] });
    expect(await balance(b, "1610")).toBe("0.00");
    expect(await balance(b, "9030")).toBe("500.00"); // realised loss (C4)
  });
});

describe("Phase 5: period-end revaluation (C5–C7)", () => {
  async function withUsdReceivable() {
    const b = await books();
    await approvedRate(b, "USD", "CBVS_BUY", "38", "2026-03-05");
    const k = await usdParty(b);
    const inv = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-05", dueDate: "2026-04-04", currency: "USD", lines: [{ description: "Export", quantity: "1", unitPrice: "1000", accountId: b.acc("8030"), taxCodeId: b.tax("BTW0") }] });
    await postInvoice(b.access, inv!.id);
    // A USD prepayment is non-monetary (C7) and must not be revalued.
    const mem = await systemDb.journal.findFirstOrThrow({ where: { administrationId: b.adminId, code: "MEM" } });
    await withTenant(b.access, (tx) => engine.createAndPost(tx, b.access, { administrationId: b.adminId, journalId: mem.id, entryDate: "2026-03-10", description: "Vooruitbetaalde huur USD", lines: [{ accountId: b.acc("1320"), currency: "USD", rate: "38", debit: "100" }, { accountId: b.acc("1910"), credit: "3800" }] }));
    return b;
  }

  it("revalues the USD receivable at the closing rate, needs approval, auto-reverses on day 1 of the next period", async () => {
    const b = await withUsdReceivable();
    const march = b.period(3);
    await expect(proposeRevaluation(b.access, { administrationId: b.adminId, periodId: march.id })).rejects.toMatchObject({ key: "currency.missingRates" });
    await approvedRate(b, "USD", "CLOSING", "39", "2026-03-31");
    const preview = await withTenant(b.access, async (tx) => revaluationPreview(tx, await tx.administration.findUniqueOrThrow({ where: { id: b.adminId } }), march.id));
    expect(preview.lines.map((l) => [l.number, l.tx, l.base, l.difference])).toEqual([["1310", "1000.0000", "38000.0000", "1000.00"]]);

    const { revaluation, entry } = await proposeRevaluation(b.access, { administrationId: b.adminId, periodId: march.id });
    await expect(proposeRevaluation(b.access, { administrationId: b.adminId, periodId: march.id })).rejects.toMatchObject({ key: "currency.revaluationExists" });
    await expect(postRevaluation(b.access, revaluation.id)).rejects.toMatchObject({ key: "ledger.approvalRequired" });
    await withTenant(b.controller, (tx) => engine.approveEntry(tx, b.controller, entry.id));
    const { reversal } = await postRevaluation(b.access, revaluation.id);
    expect(reversal?.entryDate.toISOString().slice(0, 10)).toBe("2026-04-01");

    expect(await balance(b, "1310", 3)).toBe("39000.00");
    expect(await balance(b, "9040", 3)).toBe("-1000.00"); // unrealised gain
    expect(await balance(b, "1310")).toBe("38000.00"); // reversed in April
    expect(await balance(b, "1320")).toBe("3800.00"); // non-monetary untouched
    const lines = await systemDb.journalLine.findMany({ where: { entryId: entry.id, txCurrency: "USD" } });
    expect(lines.map((l) => [l.txAmount.toString(), l.debitBase.toString(), l.exchangeRate.toString()])).toEqual([["0", "1000", "39"]]); // C1: original amounts untouched
    expect((await withTenant(b.access, (tx) => controlAccountCheck(tx, b.adminId))).every((r) => r.difference === "0.00")).toBe(true);
    await expect(reverseRevaluation(b.access, revaluation.id, "herberekening")).rejects.toMatchObject({ key: "currency.alreadyAutoReversed" });
    // Base-only lines are reserved for the currency module.
    const mem = await systemDb.journal.findFirstOrThrow({ where: { administrationId: b.adminId, code: "MEM" } });
    await expect(withTenant(b.access, (tx) => engine.createEntry(tx, b.access, { administrationId: b.adminId, journalId: mem.id, entryDate: "2026-03-31", description: "Handmatig", lines: [{ accountId: b.acc("1320"), currency: "USD", rate: "39", debit: "10", fxAdjustment: true }, { accountId: b.acc("1910"), credit: "10" }] }))).rejects.toMatchObject({ key: "ledger.fxAdjustmentSource" });
  });

  it("cumulative mode: no reversal; a recalculation first reverses the posted revaluation (C6); December waits for the next year", async () => {
    const b = await withUsdReceivable();
    await setPolicy(b.access, b.adminId, { revaluationMode: "CUMULATIVE" });
    await approvedRate(b, "USD", "CLOSING", "38.5", "2026-03-31");
    const first = await proposeRevaluation(b.access, { administrationId: b.adminId, periodId: b.period(3).id });
    await withTenant(b.controller, (tx) => engine.approveEntry(tx, b.controller, first.entry.id));
    expect((await postRevaluation(b.access, first.revaluation.id)).reversal).toBeNull();
    expect(await balance(b, "1310")).toBe("38500.00");
    await reverseRevaluation(b.access, first.revaluation.id, "Verkeerde koers gebruikt");
    expect(await balance(b, "1310")).toBe("38000.00");
    const again = await proposeRevaluation(b.access, { administrationId: b.adminId, periodId: b.period(3).id });
    expect(again.total).toBe("500.00");

    // December with AUTO_REVERSE: the reversal waits until the next fiscal year exists.
    const c = await withUsdReceivable();
    await approvedRate(c, "USD", "CLOSING", "40", "2026-12-31");
    const dec = await proposeRevaluation(c.access, { administrationId: c.adminId, periodId: c.period(12).id });
    await withTenant(c.controller, (tx) => engine.approveEntry(tx, c.controller, dec.entry.id));
    expect((await postRevaluation(c.access, dec.revaluation.id)).reversal).toBeNull();
    await expect(completeReversal(c.access, dec.revaluation.id)).rejects.toMatchObject({ key: "currency.nextPeriodMissing" });
    await createNextFiscalYear(c.access, c.adminId);
    expect((await completeReversal(c.access, dec.revaluation.id)).entryDate.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});
