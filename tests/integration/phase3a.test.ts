import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess, type Access } from "@/core/auth/access";
import { trialBalance } from "@/modules/ledger/reports";
import {
  approveInvoice, createCreditNoteDraft, createFinancialAccount, offsetItems, postInvoice, registerPayment, saveInvoice, saveParty, submitInvoice,
} from "@/modules/invoicing/service";
import { aging, controlAccountCheck, partyStatement } from "@/modules/invoicing/reports";
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
  // A second user for approvals (segregation of duties).
  const inv = await inviteMember(access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(access, { companyId: company.id, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, access.organizationId))!;
  return { access, controller, companyId: company.id, adminId: administration.id, fyId: fiscalYear.id, acc, tax };
}

type Books = Awaited<ReturnType<typeof books>>;

const tb = (b: Books) => withTenant(b.access, (tx) => trialBalance(tx, { administrationId: b.adminId, fiscalYearId: b.fyId, fromPeriod: 0, toPeriod: 13, hideZero: true }));
const row = async (b: Books, n: string) => (await tb(b)).rows.find((r) => r.number === n);

async function customer(b: Books, currency = "SRD") {
  return (await saveParty(b.access, { administrationId: b.adminId, code: `K${uid().slice(0, 6)}`, name: `Klant ${uid()}`, isCustomer: true, isSupplier: false, currency, paymentTermDays: 30 }))!;
}
async function supplier(b: Books) {
  return (await saveParty(b.access, { administrationId: b.adminId, code: `L${uid().slice(0, 6)}`, name: `Leverancier ${uid()}`, isCustomer: false, isSupplier: true, currency: "SRD", paymentTermDays: 30 }))!;
}

describe("Phase 3A: sales invoice → posting → payment (workflow 3)", () => {
  it("posts the invoice with BTW, numbers it gaplessly, creates the open item and settles it by payment", async () => {
    const b = await books();
    const k = await customer(b);
    const draft = await saveInvoice(b.access, {
      administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-10", dueDate: "2026-04-09", currency: "SRD",
      lines: [{ description: "Adviesuren", quantity: "10", unitPrice: "500", accountId: b.acc("8010"), taxCodeId: b.tax("BTW10") }],
    });
    expect(draft!).toMatchObject({ status: "DRAFT", number: null });
    expect(draft!.grossAmount.toString()).toBe("5500");
    const posted = await postInvoice(b.access, draft!.id);
    expect(posted.number).toBe("VF2026-00001");
    expect((await row(b, "1310"))?.closingDebit).toBe("5500.00");
    expect((await row(b, "8010"))?.closingCredit).toBe("5000.00");
    expect((await row(b, "1420"))?.closingCredit).toBe("500.00");

    const second = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-11", dueDate: "2026-04-10", currency: "SRD", lines: [{ description: "X", quantity: "1", unitPrice: "100", accountId: b.acc("8010") }] });
    expect((await postInvoice(b.access, second!.id)).number).toBe("VF2026-00002");

    // Posted invoices are immutable in the database.
    await expect(systemDb.invoice.update({ where: { id: draft!.id }, data: { grossAmount: "1" } })).rejects.toThrow(/immutable/);

    const bank = (await createFinancialAccount(b.access, { administrationId: b.adminId, kind: "BANK", name: "DSB", bankCode: "DSB", accountNumber: `12${uid().slice(0, 5)}`, currency: "SRD" }))!;
    const item = await systemDb.openItem.findFirstOrThrow({ where: { sourceId: draft!.id } });
    // Partial payment
    await registerPayment(b.access, { administrationId: b.adminId, direction: "IN", financialAccountId: bank.id, date: "2026-03-20", amount: "2000", allocations: [{ openItemId: item.id, amount: "2000" }] });
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("PARTIALLY_PAID");
    await expect(registerPayment(b.access, { administrationId: b.adminId, direction: "IN", financialAccountId: bank.id, date: "2026-03-21", amount: "4000", allocations: [{ openItemId: item.id, amount: "4000" }] })).rejects.toMatchObject({ key: "invoicing.overAllocation" });
    await registerPayment(b.access, { administrationId: b.adminId, direction: "IN", financialAccountId: bank.id, date: "2026-03-25", amount: "3500", allocations: [{ openItemId: item.id, amount: "3500" }] });
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe("PAID");

    const bankRow = (await tb(b)).rows.find((r) => r.name.startsWith("DSB"))!;
    expect(bankRow.closingDebit).toBe("5500.00");
    // Sub-ledger = control account (S2)
    const check = await withTenant(b.access, (tx) => controlAccountCheck(tx, b.adminId));
    expect(check.every((c) => c.difference === "0.00")).toBe(true);
    const stmt = await withTenant(b.access, (tx) => partyStatement(tx, { partyId: k.id, from: new Date("2026-01-01"), to: new Date("2026-12-31") }));
    expect(stmt.balances.get("SRD")?.toFixed(2)).toBe("100.00"); // second invoice still open
  });

  it("credit note against an invoice is offset without touching the bank", async () => {
    const b = await books();
    const k = await customer(b);
    const inv = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-02-01", dueDate: "2026-03-03", currency: "SRD", lines: [{ description: "Levering", quantity: "1", unitPrice: "1000", accountId: b.acc("8010"), taxCodeId: b.tax("BTW10") }] });
    await postInvoice(b.access, inv!.id);
    const cnDraft = await createCreditNoteDraft(b.access, inv!.id);
    const cn = await postInvoice(b.access, cnDraft!.id);
    expect(cn.number).toBe("VC2026-00001");
    const [a, c] = await Promise.all([systemDb.openItem.findFirstOrThrow({ where: { sourceId: inv!.id } }), systemDb.openItem.findFirstOrThrow({ where: { sourceId: cn.id } })]);
    expect(c.originalAmount.toString()).toBe("-1100");
    await offsetItems(b.access, { openItemId: a.id, counterOpenItemId: c.id, amount: "1100" });
    expect((await systemDb.openItem.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SETTLED");
    const debtors = await row(b, "1310");
    expect([debtors?.closingDebit, debtors?.closingCredit]).toEqual(["0.00", "0.00"]); // invoice and credit note cancel out
  });
});

describe("Phase 3A: purchase invoice with approval (workflow 2, manual entry)", () => {
  it("requires review and approval by another user, refuses duplicates, posts input BTW and the payable", async () => {
    const b = await books();
    const l = await supplier(b);
    const input = {
      administrationId: b.adminId, type: "PURCHASE" as const, kind: "INVOICE" as const, partyId: l.id, externalNumber: "F-2026-118",
      invoiceDate: "2026-04-02", dueDate: "2026-05-02", currency: "SRD",
      lines: [{ description: "Kantoorbenodigdheden", quantity: "1", unitPrice: "2000", accountId: b.acc("4200"), taxCodeId: b.tax("BTW10") }],
    };
    const inv = await saveInvoice(b.access, input);
    await expect(saveInvoice(b.access, { ...input, externalNumber: "f-2026-118" })).rejects.toMatchObject({ key: "invoicing.duplicateSupplierInvoice" });
    await expect(postInvoice(b.access, inv!.id)).rejects.toMatchObject({ key: "invoicing.approvalRequired" });
    await submitInvoice(b.access, inv!.id);
    await expect(approveInvoice(b.access, inv!.id)).rejects.toMatchObject({ key: "ledger.segregation" });
    await approveInvoice(b.controller, inv!.id);
    const posted = await postInvoice(b.access, inv!.id);
    expect(posted.number).toBe("IF2026-00001");
    expect((await row(b, "4200"))?.closingDebit).toBe("2000.00");
    expect((await row(b, "1410"))?.closingDebit).toBe("200.00");
    expect((await row(b, "1610"))?.closingCredit).toBe("2200.00");

    const ag = await withTenant(b.access, (tx) => aging(tx, { administrationId: b.adminId, side: "PAYABLE", asOf: new Date("2026-06-15") }));
    const r = ag.rows.find((x) => x.partyId === l.id)!;
    expect(r.buckets.map((x) => x.toFixed(2))).toEqual(["0.00", "0.00", "2200.00", "0.00", "0.00"]); // 44 days overdue → 31–60
  });
});

describe("Phase 3A: foreign currency invoice paid at a different rate (workflow 4 preview, C4)", () => {
  it("USD 1,000 at 38 paid at 38.5 → bank SRD 38,500, receivable cleared at SRD 38,000, gain SRD 500", async () => {
    const b = await books();
    const k = await customer(b, "USD");
    const inv = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-05-01", dueDate: "2026-05-31", currency: "USD", exchangeRate: "38", lines: [{ description: "Consultancy", quantity: "1", unitPrice: "1000", accountId: b.acc("8030"), taxCodeId: b.tax("BTW0") }] });
    await postInvoice(b.access, inv!.id);
    expect((await row(b, "1310"))?.closingDebit).toBe("38000.00");
    const usdBank = (await createFinancialAccount(b.access, { administrationId: b.adminId, kind: "BANK", name: "Hakrinbank USD", bankCode: "HAKRIN", accountNumber: `20${uid().slice(0, 5)}`, currency: "USD" }))!;
    await expect(registerPayment(b.access, { administrationId: b.adminId, direction: "IN", financialAccountId: usdBank.id, date: "2026-05-20", amount: "1000", allocations: [] })).rejects.toMatchObject({ key: "invoicing.rateRequired" });
    const item = await systemDb.openItem.findFirstOrThrow({ where: { sourceId: inv!.id } });
    await registerPayment(b.access, { administrationId: b.adminId, direction: "IN", financialAccountId: usdBank.id, date: "2026-05-20", amount: "1000", exchangeRate: "38.5", allocations: [{ openItemId: item.id, amount: "1000" }] });
    const rows = (await tb(b)).rows;
    expect(rows.find((r) => r.name.startsWith("Hakrinbank"))?.closingDebit).toBe("38500.00");
    expect(rows.find((r) => r.number === "1310")?.closingDebit ?? "0.00").toBe("0.00");
    expect(rows.find((r) => r.number === "9030")?.closingCredit).toBe("500.00");
    const lines = await systemDb.journalLine.findMany({ where: { administrationId: b.adminId, txCurrency: "USD" } });
    expect(lines.every((l) => l.txAmount.abs().toString() === "1000")).toBe(true); // original amounts preserved (C1)
  });
});

describe("Phase 3A: permissions and isolation", () => {
  it("a bookkeeper may post sales invoices (sales.post) and payments are refused without banking.post", async () => {
    const b = await books();
    const inv = await inviteMember(b.access, { email: `${uid("bk")}@example.test`, name: "Boekhouder", roleCode: "BOOKKEEPER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(b.access, { companyId: b.companyId, userId: m.userId, roleCode: "BOOKKEEPER" });
    const bk: Access = (await resolveAccess(m.userId, b.access.organizationId))!;
    const k = await customer(b);
    const draft = await saveInvoice(bk, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-10", dueDate: "2026-04-09", currency: "SRD", lines: [{ description: "X", quantity: "1", unitPrice: "100", accountId: b.acc("8010") }] });
    const posted = await postInvoice(bk, draft!.id);
    expect(posted.status).toBe("POSTED");
    const ro = await inviteMember(b.access, { email: `${uid("ro")}@example.test`, name: "Lezer", roleCode: "READ_ONLY" });
    const rm = await systemDb.organizationMembership.update({ where: { id: ro.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(b.access, { companyId: b.companyId, userId: rm.userId, roleCode: "READ_ONLY" });
    const reader = (await resolveAccess(rm.userId, b.access.organizationId))!;
    const kas = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: b.adminId } });
    await expect(registerPayment(reader, { administrationId: b.adminId, direction: "IN", financialAccountId: kas.id, date: "2026-03-20", amount: "100", allocations: [] })).rejects.toMatchObject({ key: "errors.forbidden" });
  });

  it("invoices and open items of another organisation are invisible", async () => {
    const a = await books();
    const other = await books();
    const k = await customer(other);
    const inv = await saveInvoice(other.access, { administrationId: other.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-10", dueDate: "2026-04-09", currency: "SRD", lines: [{ description: "X", quantity: "1", unitPrice: "100", accountId: other.acc("8010") }] });
    await postInvoice(other.access, inv!.id);
    await withTenant(a.access, async (tx) => {
      expect(await tx.invoice.count({ where: { administrationId: other.adminId } })).toBe(0);
      expect(await tx.openItem.count({ where: { administrationId: other.adminId } })).toBe(0);
      expect(await tx.party.count({ where: { id: k.id } })).toBe(0);
    });
    await expect(postInvoice(a.access, inv!.id)).rejects.toMatchObject({ key: "errors.notFound" });
  });
});
