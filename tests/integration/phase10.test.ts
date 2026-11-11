import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess } from "@/core/auth/access";
import * as engine from "@/core/ledger/engine";
import { CHECK_CODES } from "@/modules/quality/checks";
import { scanNow, updateIssue } from "@/modules/quality/service";
import { approveInvoice, createFinancialAccount, postInvoice, saveInvoice, saveParty } from "@/modules/invoicing/service";
import { cashEntry, importStatement, saveImportProfile } from "@/modules/banking/service";
import { registerAsset } from "@/modules/assets/service";
import { assignCompany, createAdministration, createCompany, inviteMember } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

async function books() {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const acc = (n: string) => accounts.find((a) => a.number === n)!.id;
  const journal = async (code: string) => (await systemDb.journal.findFirstOrThrow({ where: { administrationId: administration.id, code } })).id;
  return { access, companyId: company.id, adminId: administration.id, acc, journal };
}
type B = Awaited<ReturnType<typeof books>>;
const DEC15 = new Date("2026-12-15T00:00:00Z");
const codesOf = async (b: B) => (await systemDb.qualityIssue.findMany({ where: { administrationId: b.adminId } })).map((i) => i.checkCode);

async function makeDirty(b: B) {
  await systemDb.company.update({ where: { id: b.companyId }, data: { isBtwRegistered: true } });
  const inv = await inviteMember(b.access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
  const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
  await assignCompany(b.access, { companyId: b.companyId, userId: m.userId, roleCode: "FINANCIAL_CONTROLLER" });
  const controller = (await resolveAccess(m.userId, b.access.organizationId))!;
  const mem = await b.journal("MEM");
  const post = (date: string, lines: { accountId: string; debit?: string; credit?: string; currency?: string; rate?: string }[]) => withTenant(b.access, (tx) => engine.createAndPost(tx, b.access, { administrationId: b.adminId, journalId: mem, entryDate: date, description: "Boeking", lines }));
  await post("2026-03-01", [{ accountId: b.acc("1910"), debit: "100" }, { accountId: b.acc("8010"), credit: "100" }]); // SUSPENSE_BALANCE
  const opening = await withTenant(b.access, async (tx) => engine.createEntry(tx, b.access, { administrationId: b.adminId, journalId: await b.journal("OPN"), entryDate: "2026-01-01", description: "Opening", lines: [{ accountId: b.acc("1310"), debit: "500" }, { accountId: b.acc("0610"), credit: "500" }] }));
  await withTenant(controller, (tx) => engine.approveEntry(tx, controller, opening.id));
  await withTenant(b.access, (tx) => engine.postEntry(tx, b.access, opening.id)); // CONTROL_MISMATCH (no open item)
  const bank = (await createFinancialAccount(b.access, { administrationId: b.adminId, kind: "BANK", name: "DSB", bankCode: "DSB", accountNumber: uid().slice(0, 7), currency: "SRD" }))!;
  await saveImportProfile(b.access, bank.id, { delimiter: ";", hasHeader: false, dateColumn: 0, dateFormat: "YYYY-MM-DD", amountColumn: 2, decimalSeparator: ",", descriptionColumn: 1 });
  await importStatement(b.access, { financialAccountId: bank.id, fileName: "okt.csv", content: "2026-10-01;Onbekend;-25,00" }); // BANK_UNMATCHED
  const k = (await saveParty(b.access, { administrationId: b.adminId, code: `K${uid().slice(0, 5)}`, name: "Klant", isCustomer: true, isSupplier: false, currency: "SRD", paymentTermDays: 30 }))!;
  const s = await saveInvoice(b.access, { administrationId: b.adminId, type: "SALES", kind: "INVOICE", partyId: k.id, invoiceDate: "2026-06-01", dueDate: "2026-07-01", currency: "SRD", lines: [{ description: "Zonder BTW-code", quantity: "1", unitPrice: "800", accountId: b.acc("8010") }] });
  await postInvoice(b.access, s!.id); // OVERDUE_RECEIVABLE, MISSING_TAX_CODE, BTW_RETURN_MISSING
  const l = (await saveParty(b.access, { administrationId: b.adminId, code: `L${uid().slice(0, 5)}`, name: "Leverancier", isCustomer: false, isSupplier: true, currency: "SRD", paymentTermDays: 30 }))!;
  const p = await saveInvoice(b.access, { administrationId: b.adminId, type: "PURCHASE", kind: "INVOICE", partyId: l.id, externalNumber: `P-${uid()}`, invoiceDate: "2026-09-01", dueDate: "2026-10-01", currency: "SRD", lines: [{ description: "Inkoop", quantity: "1", unitPrice: "300", accountId: b.acc("4200") }] });
  await approveInvoice(controller, p!.id);
  await postInvoice(b.access, p!.id); // OVERDUE_PAYABLE
  await withTenant(b.access, async (tx) => engine.createEntry(tx, b.access, { administrationId: b.adminId, journalId: mem, entryDate: "2026-10-10", description: "Vergeten concept", lines: [{ accountId: b.acc("4200"), debit: "1" }, { accountId: b.acc("1910"), credit: "1" }] })); // OLD_DRAFTS
  const kas = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: b.adminId, kind: "CASH" } });
  await cashEntry(b.access, { financialAccountId: kas.id, date: "2026-11-01", direction: "OUT", amount: "50", accountId: b.acc("4200"), description: "Kas tekort" }); // NEGATIVE_CASH
  const cat = await systemDb.assetCategory.findFirstOrThrow({ where: { administrationId: b.adminId, code: "COMP" } });
  await registerAsset(b.access, { administrationId: b.adminId, categoryId: cat.id, number: "C1", name: "Laptop", acquisitionDate: "2026-01-15", acquisitionCost: "3600", residualValue: undefined, usefulLifeMonths: 36, method: "STRAIGHT_LINE", decliningRatePct: undefined, depreciationStart: undefined, location: undefined, costCenterId: undefined, counterAccountId: b.acc("0090") }); // MISSING_DEPRECIATION
  await post("2026-05-01", [{ accountId: b.acc("1340"), currency: "USD", rate: "38", debit: "10" }, { accountId: b.acc("0610"), credit: "380" }]); // STALE_FX_RATE
  // PERIOD_NOT_CLOSED: periods Jan–Oct 2026 ended more than 45 days before 15 December.
}

describe("Phase 10: quality monitor", () => {
  it("each of the 12 checks finds its positive fixture; a clean administration has no findings", async () => {
    const dirty = await books();
    await makeDirty(dirty);
    const r = await scanNow(dirty.access, dirty.adminId, DEC15);
    expect(new Set(await codesOf(dirty))).toEqual(new Set(CHECK_CODES));
    expect(r.score).toBeLessThan(60);

    const clean = await books();
    const rc = await scanNow(clean.access, clean.adminId, new Date("2026-01-20T00:00:00Z"));
    expect(rc).toMatchObject({ findings: 0, newIssues: 0, score: 100 });
    const scan = await systemDb.qualityScan.findFirstOrThrow({ where: { administrationId: clean.adminId } });
    expect(Object.values(scan.results as Record<string, number>).every((v) => v === 0)).toBe(true);
  });

  it("rescans never duplicate; issues never resolve themselves; closing needs a note; a resolved issue that reappears reopens; new errors notify", async () => {
    const b = await books();
    const mem = await b.journal("MEM");
    const entry = await withTenant(b.access, (tx) => engine.createAndPost(tx, b.access, { administrationId: b.adminId, journalId: mem, entryDate: "2026-03-01", description: "Vraagpost", lines: [{ accountId: b.acc("1910"), debit: "100" }, { accountId: b.acc("8010"), credit: "100" }] }));
    const today = new Date("2026-03-20T00:00:00Z");
    await scanNow(b.access, b.adminId, today);
    await scanNow(b.access, b.adminId, today);
    const issues = await systemDb.qualityIssue.findMany({ where: { administrationId: b.adminId, checkCode: "SUSPENSE_BALANCE" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.timesSeen).toBe(2);

    // Fix the cause: the issue stays open until someone closes it.
    await withTenant(b.access, (tx) => engine.reverseEntry(tx, b.access, entry.id, { entryDate: "2026-03-21", reason: "Vraagpost opgelost" }));
    await scanNow(b.access, b.adminId, new Date("2026-03-22T00:00:00Z"));
    const still = await systemDb.qualityIssue.findUniqueOrThrow({ where: { id: issues[0]!.id } });
    expect(still).toMatchObject({ status: "OPEN", timesSeen: 2 });
    await expect(updateIssue(b.access, { issueId: still.id, status: "RESOLVED", note: "" })).rejects.toMatchObject({ key: "quality.noteRequired" });
    await updateIssue(b.access, { issueId: still.id, status: "RESOLVED", note: "Tegengeboekt op 21 maart" });
    await expect(systemDb.qualityIssue.delete({ where: { id: still.id } })).rejects.toThrow(/append-only|immutable/i);

    // The same condition again → the resolved issue is reopened, not duplicated.
    await withTenant(b.access, (tx) => engine.createAndPost(tx, b.access, { administrationId: b.adminId, journalId: mem, entryDate: "2026-03-25", description: "Nieuwe vraagpost", lines: [{ accountId: b.acc("1910"), debit: "40" }, { accountId: b.acc("8010"), credit: "40" }] }));
    await scanNow(b.access, b.adminId, new Date("2026-03-26T00:00:00Z"));
    const again = await systemDb.qualityIssue.findMany({ where: { administrationId: b.adminId, checkCode: "SUSPENSE_BALANCE" } });
    expect(again.map((i) => i.status)).toEqual(["OPEN"]);

    // Errors notify the people who may see quality issues.
    const kas = await systemDb.financialAccount.findFirstOrThrow({ where: { administrationId: b.adminId, kind: "CASH" } });
    await cashEntry(b.access, { financialAccountId: kas.id, date: "2026-03-26", direction: "OUT", amount: "10", accountId: b.acc("4200"), description: "Tekort" });
    await scanNow(b.access, b.adminId, new Date("2026-03-27T00:00:00Z"));
    expect(await systemDb.notification.count({ where: { userId: b.access.userId, type: "qualityErrors" } })).toBe(1);
  });
});
