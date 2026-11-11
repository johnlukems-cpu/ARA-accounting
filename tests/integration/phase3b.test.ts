import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import { trialBalance } from "@/modules/ledger/reports";
import { createFinancialAccount, postInvoice, saveInvoice, saveParty } from "@/modules/invoicing/service";
import {
  accountBalance, approveReconciliation, bookToAccount, cashEntry, ignoreTransaction, importStatement, matchToOpenItems, reconcile,
  saveImportProfile, suggestions, transferFunds,
} from "@/modules/banking/service";
import type { ImportProfile } from "@/modules/banking/csv-import";
import { assignCompany, createAdministration, createCompany, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

const PROFILE: ImportProfile = { delimiter: ";", hasHeader: true, dateColumn: 0, dateFormat: "DD-MM-YYYY", amountColumn: 2, decimalSeparator: ",", descriptionColumn: 1, counterpartyColumn: 3, referenceColumn: 4 };

async function setup() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const bank = (await createFinancialAccount(access, { administrationId: administration.id, kind: "BANK", name: "DSB", bankCode: "DSB", accountNumber: `${uid().slice(0, 7)}`, currency: "SRD" }))!;
  await saveImportProfile(access, bank.id, PROFILE);
  const k = (await saveParty(access, { administrationId: administration.id, code: `K${uid().slice(0, 5)}`, name: "Klant Wanica NV", isCustomer: true, isSupplier: false, currency: "SRD", paymentTermDays: 30 }))!;
  const inv = await saveInvoice(access, { administrationId: administration.id, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-03-01", dueDate: "2026-03-31", currency: "SRD", lines: [{ description: "Levering", quantity: "1", unitPrice: "6000", accountId: acc("8010") }] });
  const posted = await postInvoice(access, inv!.id);
  const tb = () => withTenant(access, (tx) => trialBalance(tx, { administrationId: administration.id, fiscalYearId: fiscalYear.id, fromPeriod: 0, toPeriod: 13, hideZero: true }));
  return { access, companyId: company.id, adminId: administration.id, acc, bank, invoice: posted, tb };
}

const CSV = (rows: string[]) => ["Datum;Omschrijving;Bedrag;Tegenpartij;Referentie", ...rows].join("\n");

describe("Phase 3B: bank statement import", () => {
  it("imports a statement, refuses the same file and skips lines already imported from an overlapping file", async () => {
    const s = await setup();
    const first = CSV(["10-03-2026;Betaling VF2026-00001;6.000,00;KLANT WANICA;R1", "11-03-2026;Bankkosten maart;-35,00;;R2"]);
    const st = await importStatement(s.access, { financialAccountId: s.bank.id, fileName: "maart.csv", content: first });
    expect(st.lineCount).toBe(2);
    await expect(importStatement(s.access, { financialAccountId: s.bank.id, fileName: "maart-kopie.csv", content: first })).rejects.toMatchObject({ key: "banking.fileAlreadyImported" });
    const overlap = CSV(["11-03-2026;Bankkosten maart;-35,00;;R2", "12-03-2026;Rente;4,10;;R3"]);
    const st2 = await importStatement(s.access, { financialAccountId: s.bank.id, fileName: "overlap.csv", content: overlap });
    expect([st2.lineCount, st2.duplicateLines]).toEqual([1, 1]);
    expect(await systemDb.bankTransaction.count({ where: { financialAccountId: s.bank.id } })).toBe(3);
    // Imported lines are evidence: their content cannot change.
    const line = await systemDb.bankTransaction.findFirstOrThrow({ where: { financialAccountId: s.bank.id } });
    await expect(systemDb.bankTransaction.update({ where: { id: line.id }, data: { amount: "1" } })).rejects.toThrow(/immutable/);
  });

  it("suggests the invoice, matches it, books the charges, ignores a line, and reconciles to zero", async () => {
    const s = await setup();
    await importStatement(s.access, { financialAccountId: s.bank.id, fileName: "a.csv", content: CSV(["10-03-2026;Betaling VF2026-00001;6.000,00;KLANT WANICA;R1", "11-03-2026;Bankkosten;-35,00;;R2", "12-03-2026;Dubbel geïmporteerd;-1,00;;R9"]) });
    const [pay, fee, dup] = await systemDb.bankTransaction.findMany({ where: { financialAccountId: s.bank.id }, orderBy: { bookingDate: "asc" } });
    const sugg = await withTenant(s.access, (tx) => suggestions(tx, pay!.id));
    expect(sugg[0]!.score).toBe(100);
    const item = sugg[0]!.item;
    // Partial match first, then the rest.
    await matchToOpenItems(s.access, { transactionId: pay!.id, allocations: [{ openItemId: item.id, amount: "4000" }] });
    expect((await systemDb.bankTransaction.findUniqueOrThrow({ where: { id: pay!.id } })).status).toBe("PARTIAL");
    await expect(matchToOpenItems(s.access, { transactionId: pay!.id, allocations: [{ openItemId: item.id, amount: "3000" }] })).rejects.toMatchObject({ key: "banking.matchExceedsTransaction" });
    await matchToOpenItems(s.access, { transactionId: pay!.id, allocations: [{ openItemId: item.id, amount: "2000" }] });
    expect((await systemDb.bankTransaction.findUniqueOrThrow({ where: { id: pay!.id } })).status).toBe("MATCHED");
    expect((await systemDb.invoice.findUniqueOrThrow({ where: { id: s.invoice.id } })).status).toBe("PAID");

    await expect(bookToAccount(s.access, { transactionId: fee!.id, accountId: s.acc("1310") })).rejects.toMatchObject({ key: "banking.useDedicatedFlow" });
    await bookToAccount(s.access, { transactionId: fee!.id, accountId: s.acc("9020"), description: "Bankkosten maart" });
    await ignoreTransaction(s.access, dup!.id, "Al handmatig geboekt");

    const rows = (await s.tb()).rows;
    expect(rows.find((r) => r.number === "9020")?.closingDebit).toBe("35.00");
    expect(rows.find((r) => r.name.startsWith("DSB"))?.closingDebit).toBe("5965.00");

    const rec = await reconcile(s.access, { financialAccountId: s.bank.id, periodEnd: "2026-03-31", statementBalance: "5965.00" });
    expect([rec.difference.toString(), rec.unmatchedCount]).toEqual(["0", 0]);
    await expect(approveReconciliation(s.access, rec.id)).rejects.toMatchObject({ key: "ledger.segregation" });
    const inv = await inviteMember(s.access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(s.access, { companyId: s.companyId, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
    await approveReconciliation((await resolveAccess(m.userId, s.access.organizationId))!, rec.id);
    expect((await systemDb.bankReconciliation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("APPROVED");
  });

  it("a reconciliation with a difference or unmatched lines cannot be approved", async () => {
    const s = await setup();
    await importStatement(s.access, { financialAccountId: s.bank.id, fileName: "b.csv", content: CSV(["05-03-2026;Onbekend;100,00;;X"]) });
    const rec = await reconcile(s.access, { financialAccountId: s.bank.id, periodEnd: "2026-03-31", statementBalance: "100.00" });
    expect([rec.difference.toString(), rec.unmatchedCount]).toEqual(["100", 1]);
    const inv = await inviteMember(s.access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(s.access, { companyId: s.companyId, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
    await expect(approveReconciliation((await resolveAccess(m.userId, s.access.organizationId))!, rec.id)).rejects.toMatchObject({ key: "banking.reconciliationNotClean" });
  });
});

describe("Phase 3B: cash book and transfers (cambio)", () => {
  it("cash expense including BTW splits net and input BTW", async () => {
    const s = await setup();
    const kas = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: s.adminId, kind: "CASH" } });
    const btw10 = await systemDb.taxCode.findFirstOrThrow({ where: { administrationId: s.adminId, code: "BTW10" } });
    await cashEntry(s.access, { financialAccountId: kas.id, date: "2026-03-05", direction: "IN", amount: "10000", accountId: s.acc("8090"), description: "Kasstorting" });
    await cashEntry(s.access, { financialAccountId: kas.id, date: "2026-03-06", direction: "OUT", amount: "110", accountId: s.acc("4200"), taxCodeId: btw10.id, description: "Pennen en papier" });
    const rows = (await s.tb()).rows;
    expect(rows.find((r) => r.number === "4200")?.closingDebit).toBe("100.00");
    expect(rows.find((r) => r.number === "1410")?.closingDebit).toBe("10.00");
    expect(rows.find((r) => r.number === "1010")?.closingDebit).toBe("9890.00");
  });

  it("cambio: USD cash sold for SRD at a different rate posts the exchange difference", async () => {
    const s = await setup();
    const usdCash = (await createFinancialAccount(s.access, { administrationId: s.adminId, kind: "CASH", name: "Kas USD", currency: "USD" }))!;
    const kas = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: s.adminId, kind: "CASH", currency: "SRD" } });
    await cashEntry(s.access, { financialAccountId: usdCash.id, date: "2026-03-01", direction: "IN", amount: "500", accountId: s.acc("8090"), description: "Ontvangst USD", exchangeRate: "37" });
    // Sell USD 500 at the cambio for SRD 19,000 (rate 38); the USD carried at 37 → gain SRD 500.
    await transferFunds(s.access, { fromId: usdCash.id, toId: kas.id, date: "2026-03-10", amountFrom: "500", amountTo: "19000", rateFrom: "37", description: "Cambio verkoop USD" });
    const rows = (await s.tb()).rows;
    expect(rows.find((r) => r.number === "9030")?.closingCredit).toBe("500.00");
    expect(rows.find((r) => r.number === "1010")?.closingDebit).toBe("19000.00");
    const usd = await withTenant(s.access, (tx) => accountBalance(tx, usdCash.ledgerAccountId, new Date("2026-12-31")));
    expect([usd.tx.toFixed(2), usd.base.toFixed(2)]).toEqual(["0.00", "0.00"]);
  });
});
