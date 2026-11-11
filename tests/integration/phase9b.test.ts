import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { PDFDocument } from "pdf-lib";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { approveInvoice, postInvoice, saveInvoice, saveParty } from "@/modules/invoicing/service";
import { addAdjustment, approveReturn, fileReturn, prepareBtwReturn, prepareDividend, prepareIbReturn } from "@/modules/tax/service";
import { assignCompany, createAdministration, createCompany, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const codes = await systemDb.taxCode.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const tax = (c: string) => codes.find((x) => x.code === c)!.id;
  const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, access.organizationId))!;
  const mem = (await systemDb.journal.findFirstOrThrow({ where: { administrationId: administration.id, code: "MEM" } })).id;
  const post = (date: string, d: string, c: string, amount: string) =>
    withTenant(access, (tx) => engine.createAndPost(tx, access, { administrationId: administration.id, journalId: mem, entryDate: date, description: "Boeking", lines: [{ accountId: acc(d), debit: amount }, { accountId: acc(c), credit: amount }] }));
  return { access, controller, adminId: administration.id, fy: fiscalYear, acc, tax, post };
}
type B = Awaited<ReturnType<typeof books>>;
const balance = async (b: B, n: string) => {
  const r = await systemDb.$queryRaw<{ v: string | null }[]>`SELECT SUM(l."debitBase" - l."creditBase")::text AS v FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE l."accountId" = ${b.acc(n)} AND e.status = 'POSTED'`;
  return new Decimal(r[0]?.v ?? 0).toFixed(2);
};
const pdf = async () => PDFDocument.create().then(async (d) => { d.addPage(); return d.save(); });

async function invoices(b: B) {
  const k = (await saveParty(b.access, { administrationId: b.adminId, code: `K${uid().slice(0, 5)}`, name: "Klant", isCustomer: true, isSupplier: false, currency: "SRD", paymentTermDays: 30 }))!;
  const l = (await saveParty(b.access, { administrationId: b.adminId, code: `L${uid().slice(0, 5)}`, name: "Leverancier", isCustomer: false, isSupplier: true, currency: "SRD", paymentTermDays: 30 }))!;
  const s = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-05", dueDate: "2026-04-04", currency: "SRD", lines: [{ description: "Advies", quantity: "1", unitPrice: "1000", accountId: b.acc("8010"), taxCodeId: b.tax("BTW10") }, { description: "Luxe", quantity: "1", unitPrice: "200", accountId: b.acc("8020"), taxCodeId: b.tax("BTW25") }] });
  await postInvoice(b.access, s!.id);
  const p = await saveInvoice(b.access, { administrationId: b.adminId, type: "PURCHASE", kind: "INVOICE", partyId: l.id, externalNumber: `F-${uid()}`, invoiceDate: "2026-03-08", dueDate: "2026-04-07", currency: "SRD", lines: [{ description: "Kantoor", quantity: "1", unitPrice: "500", accountId: b.acc("4200"), taxCodeId: b.tax("BTW10") }] });
  await approveInvoice(b.controller, p!.id);
  await postInvoice(b.access, p!.id);
}

describe("Phase 9B: BTW return (workflow 8, T1/T2/T4/T5)", () => {
  it("calculates output and input BTW per code, reconciles to the ledger, needs acknowledgement and another approver, posts the settlement and files with evidence", async () => {
    const b = await books();
    await invoices(b);
    const ret = await prepareBtwReturn(b.access, { administrationId: b.adminId, month: "2026-03" });
    const calc = ret.calculation as { lines: { code: string; direction: string; base: string; tax: string }[]; output: string; input: string; payable: string; reconciliation: Record<string, string> };
    expect(calc.lines.map((l) => [l.direction, l.code, l.base, l.tax])).toEqual([["INPUT", "BTW10", "500.00", "50.00"], ["OUTPUT", "BTW10", "1000.00", "100.00"], ["OUTPUT", "BTW25", "200.00", "50.00"]]);
    expect([calc.output, calc.input, calc.payable]).toEqual(["150.00", "50.00", "100.00"]);
    expect(calc.reconciliation).toMatchObject({ differenceOutput: "0.00", differenceInput: "0.00" });
    const rule = await systemDb.taxRuleVersion.findUniqueOrThrow({ where: { id: ret.ruleVersionId } });
    expect(rule).toMatchObject({ taxType: "BTW", legalStatus: "SOURCE_FOUND" }); // T1: from data, not code

    await expect(approveReturn(b.access, { returnId: ret.id, acknowledgeUnverified: true })).rejects.toMatchObject({ key: "ledger.segregation" });
    await expect(approveReturn(b.controller, { returnId: ret.id, acknowledgeUnverified: false })).rejects.toMatchObject({ key: "tax.acknowledgeRequired" });
    const approved = await approveReturn(b.controller, { returnId: ret.id, acknowledgeUnverified: true });
    expect(approved).toMatchObject({ status: "APPROVED", acknowledgedById: b.controller.userId });
    expect([await balance(b, "1420"), await balance(b, "1410"), await balance(b, "1430")]).toEqual(["0.00", "0.00", "-100.00"]);
    await expect(systemDb.taxReturn.update({ where: { id: ret.id }, data: { calculation: {} } })).rejects.toThrow(/can only be filed/);
    await expect(systemDb.taxReturn.update({ where: { id: ret.id }, data: { status: "FILED" } })).rejects.toThrow(/tax_return_filed/);

    // T4: evidence and confirmation.
    await expect(fileReturn(b.access, { returnId: ret.id, fileName: "ontvangst.pdf", bytes: await pdf(), confirmed: false })).rejects.toMatchObject({ key: "tax.confirmFiling" });
    const filed = await fileReturn(b.access, { returnId: ret.id, fileName: "ontvangst.pdf", bytes: await pdf(), reference: "BD-2026-03-001", confirmed: true });
    expect(filed).toMatchObject({ status: "FILED", filingReference: "BD-2026-03-001" });
    expect((await systemDb.document.findUniqueOrThrow({ where: { id: filed.evidenceDocumentId! } })).kind).toBe("EVIDENCE");
    await expect(systemDb.taxReturn.update({ where: { id: ret.id }, data: { filingReference: "x" } })).rejects.toThrow(/immutable/);
    await expect(prepareBtwReturn(b.access, { administrationId: b.adminId, month: "2026-03" })).rejects.toMatchObject({ key: "tax.alreadyApproved" });
  });

  it("a difference with the BTW ledger accounts needs an explanation before approval", async () => {
    const b = await books();
    await b.post("2026-04-10", "1910", "1420", "30"); // BTW booked by hand, outside an invoice
    const ret = await prepareBtwReturn(b.access, { administrationId: b.adminId, month: "2026-04" });
    expect((ret.calculation as { reconciliation: Record<string, string> }).reconciliation.differenceOutput).toBe("30.00");
    await expect(approveReturn(b.controller, { returnId: ret.id, acknowledgeUnverified: true })).rejects.toMatchObject({ key: "tax.explanationRequired" });
    const ok = await approveReturn(b.controller, { returnId: ret.id, acknowledgeUnverified: true, explanation: "Handmatige correctie, opgenomen in de volgende aangifte" });
    expect(ok.explanation).toMatch(/Handmatige/);
  });
});

describe("Phase 9B: inkomstenbelasting rechtspersonen and dividend (T6)", () => {
  it("commercial result + fiscal adjustments × rate − voorlopige aanslag; posted in period 13", async () => {
    const b = await books();
    await b.post("2026-05-10", "1340", "8010", "10000");
    await b.post("2026-06-10", "4100", "1620", "4000");
    await b.post("2026-07-10", "1450", "1910", "1000"); // voorlopige aanslag paid
    const ret = await prepareIbReturn(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id });
    await addAdjustment(b.access, { returnId: ret.id, kind: "NON_DEDUCTIBLE", description: "Boetes", amount: "500" });
    await addAdjustment(b.access, { returnId: ret.id, kind: "EXEMPT_INCOME", description: "Vrijgestelde opbrengst", amount: "100" });
    const fresh = await systemDb.taxReturn.findUniqueOrThrow({ where: { id: ret.id } });
    expect(fresh.calculation).toMatchObject({ commercialResult: "6000.00", adjustments: "400.00", taxableProfit: "6400.00", rate: "36", tax: "2304.00", prepaid: "1000.00", payable: "1304.00" });
    const approved = await approveReturn(b.controller, { returnId: ret.id, acknowledgeUnverified: true });
    const entry = await systemDb.journalEntry.findUniqueOrThrow({ where: { id: approved.entryId! }, include: { period: true } });
    expect([entry.kind, entry.period.number]).toEqual(["ADJUSTMENT", 13]);
    expect([await balance(b, "4950"), await balance(b, "1450"), await balance(b, "1440")]).toEqual(["2304.00", "0.00", "-1304.00"]);
    await expect(addAdjustment(b.access, { returnId: ret.id, kind: "OTHER", description: "Te laat", amount: "1" })).rejects.toMatchObject({ key: "tax.alreadyApproved" });
  });

  it("a fiscal loss gives no tax; a dividend declaration withholds 25% and is posted on approval", async () => {
    const b = await books();
    await b.post("2026-05-10", "4100", "1620", "3000");
    const ret = await prepareIbReturn(b.access, { administrationId: b.adminId, fiscalYearId: b.fy.id });
    expect(ret.calculation).toMatchObject({ taxableProfit: "-3000.00", loss: "3000.00", tax: "0.00", payable: "0.00" });

    const div = await prepareDividend(b.access, { administrationId: b.adminId, date: "2026-06-30", gross: "1000" });
    expect(div.calculation).toEqual({ gross: "1000.00", rate: "25", tax: "250.00", net: "750.00", payable: "250.00" });
    await approveReturn(b.controller, { returnId: div.id, acknowledgeUnverified: true });
    expect([await balance(b, "0630"), await balance(b, "1660"), await balance(b, "1470")]).toEqual(["1000.00", "-750.00", "-250.00"]);
    // Tax rules are platform data: readable, not writable by tenants.
    await withTenant(b.access, async (tx) => {
      expect(await tx.taxRuleVersion.count()).toBeGreaterThanOrEqual(3);
      await expect(tx.taxRuleVersion.updateMany({ data: { notes: "x" } })).rejects.toThrow();
    });
  });
});
