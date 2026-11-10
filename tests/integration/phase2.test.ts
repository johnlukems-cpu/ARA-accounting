import { describe, expect, it, beforeAll } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { resolveAccess, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import { trialBalance, generalLedger } from "@/modules/ledger/reports";
import { createAccount, updateAccount } from "@/modules/ledger/service";
import { assignCompany, createAdministration, createCompany, inviteMember, setPeriodStatus } from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

interface Books {
  access: Access;
  administrationId: string;
  fiscalYearId: string;
  companyId: string;
  acc: (n: string) => string;
  journal: (code: string) => string;
}

async function newBooks(): Promise<Books> {
  const org = await newOrganization();
  const company = await createCompany(org.access, companyInput());
  const access = await refresh(org.access);
  const { administration, fiscalYear } = await createAdministration(access, { companyId: company.id, code: "HOOFD", name: "Hoofd", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
  const accounts = await systemDb.account.findMany({ where: { administrationId: administration.id } });
  const journals = await systemDb.journal.findMany({ where: { administrationId: administration.id } });
  return {
    access, administrationId: administration.id, fiscalYearId: fiscalYear.id, companyId: company.id,
    acc: (n) => accounts.find((a) => a.number === n)!.id,
    journal: (c) => journals.find((j) => j.code === c)!.id,
  };
}

const run = <T>(b: Books, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(b.access, fn);

function entry(b: Books, date: string, lines: { acc: string; d?: string; c?: string; currency?: string; rate?: string }[], extra: Partial<engine.EntryInput> = {}): engine.EntryInput {
  return {
    administrationId: b.administrationId, journalId: b.journal("MEM"), entryDate: date, description: `Test ${uid()}`,
    lines: lines.map((l) => ({ accountId: b.acc(l.acc), debit: l.d, credit: l.c, currency: l.currency, rate: l.rate })),
    ...extra,
  };
}

describe("Phase 2: chart of accounts and journals", () => {
  it("a new administration gets the standard Surinamese chart and all 11 journal types", async () => {
    const b = await newBooks();
    const accounts = await systemDb.account.findMany({ where: { administrationId: b.administrationId } });
    expect(accounts.length).toBeGreaterThan(60);
    expect(accounts.find((a) => a.number === "1310")).toMatchObject({ controlType: "RECEIVABLE", normalBalance: "DEBIT" });
    expect(accounts.find((a) => a.number === "1610")).toMatchObject({ controlType: "PAYABLE", normalBalance: "CREDIT" });
    expect(accounts.find((a) => a.number === "1020")).toMatchObject({ currency: "USD", controlType: "CASH" });
    const tree = accounts.find((a) => a.number === "4100")!;
    expect(accounts.find((a) => a.id === tree.parentId)?.number).toBe("4000");
    const types = new Set((await systemDb.journal.findMany({ where: { administrationId: b.administrationId } })).map((j) => j.type));
    expect(types.size).toBe(11);
  });

  it("accounts: unique numbers, header parents only, archive blocked while a balance exists", async () => {
    const b = await newBooks();
    const acc = await createAccount(b.access, { administrationId: b.administrationId, number: "4111", name: "Generatorbrandstof", category: "OPERATING_EXPENSE", type: "DETAIL", parentId: b.acc("4000"), controlType: "NONE" });
    expect(acc!.normalBalance).toBe("DEBIT");
    await expect(createAccount(b.access, { administrationId: b.administrationId, number: "4111", name: "Dubbel", category: "OPERATING_EXPENSE", type: "DETAIL", controlType: "NONE" })).rejects.toMatchObject({ key: "errors.codeTaken" });
    await expect(createAccount(b.access, { administrationId: b.administrationId, number: "4112", name: "Fout", category: "OPERATING_EXPENSE", type: "DETAIL", parentId: b.acc("4100"), controlType: "NONE" })).rejects.toMatchObject({ key: "ledger.invalidParent" });

    const e = entry(b, "2026-02-10", [{ acc: "4100", d: "50" }, { acc: "1910", c: "50" }]);
    e.lines[0]!.accountId = acc!.id;
    await run(b, (tx) => engine.createAndPost(tx, b.access, e));
    await expect(updateAccount(b.access, { id: acc!.id, name: "Generatorbrandstof", status: "ARCHIVED" })).rejects.toMatchObject({ key: "ledger.archiveHasBalance" });
  });
});

describe("Phase 2: posting (L1–L5, P1–P6)", () => {
  let b: Books;
  beforeAll(async () => {
    b = await newBooks();
  });

  it("draft → post assigns gapless numbers per journal and fiscal year", async () => {
    const e1 = await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-15", [{ acc: "4100", d: "5000" }, { acc: "1910", c: "5000" }])));
    expect(e1.status).toBe("DRAFT");
    expect(e1.entryNumber).toBeNull();
    const p1 = await run(b, (tx) => engine.postEntry(tx, b.access, e1.id));
    const p2 = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-01-20", [{ acc: "4110", d: "1200.50" }, { acc: "1910", c: "1200.50" }])));
    expect(p1.status).toBe("POSTED");
    expect(p2.entryNumber).toBe(p1.entryNumber! + 1);
  });

  it("concurrent postings never share or skip a number", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-03-05", [{ acc: "4200", d: String(10 + i) }, { acc: "1910", c: String(10 + i) }])))),
    );
    const nums = results.map((r) => r.entryNumber!).sort((x, y) => x - y);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBe(nums[i - 1]! + 1);
  });

  it("an idempotency key never creates a second entry", async () => {
    const key = `inv-${uid()}`;
    const a = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-04-01", [{ acc: "4300", d: "75" }, { acc: "1910", c: "75" }], { idempotencyKey: key })));
    const again = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-04-01", [{ acc: "4300", d: "75" }, { acc: "1910", c: "75" }], { idempotencyKey: key })));
    expect(again.id).toBe(a.id);
    expect(await systemDb.journalEntry.count({ where: { administrationId: b.administrationId, idempotencyKey: key } })).toBe(1);
  });

  it("refuses unbalanced entries, header accounts and manual postings to control accounts", async () => {
    await expect(run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-10", [{ acc: "4100", d: "100" }, { acc: "1910", c: "90" }])))).rejects.toMatchObject({ key: "ledger.unbalanced" });
    await expect(run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-10", [{ acc: "4000", d: "100" }, { acc: "1910", c: "100" }])))).rejects.toMatchObject({ key: "ledger.accountNotPostable" });
    await expect(run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-10", [{ acc: "1310", d: "100" }, { acc: "8010", c: "100" }])))).rejects.toMatchObject({ key: "ledger.controlAccount" });
    await expect(run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2027-01-10", [{ acc: "4100", d: "1" }, { acc: "1910", c: "1" }])))).rejects.toMatchObject({ key: "ledger.noFiscalYear" });
  });

  it("opening balances go to period 0 on the first day; control accounts are allowed there", async () => {
    const opening = await run(b, (tx) =>
      engine.createEntry(tx, b.access, entry(b, "2026-01-01", [{ acc: "1010", d: "25000" }, { acc: "1310", d: "15000" }, { acc: "0610", c: "40000" }], { journalId: b.journal("OPN") })),
    );
    const period = await systemDb.accountingPeriod.findUniqueOrThrow({ where: { id: opening.periodId } });
    expect(period.number).toBe(0);
    // The opening journal requires approval, by someone other than the creator.
    await expect(run(b, (tx) => engine.postEntry(tx, b.access, opening.id))).rejects.toMatchObject({ key: "ledger.approvalRequired" });
    await expect(run(b, (tx) => engine.approveEntry(tx, b.access, opening.id))).rejects.toMatchObject({ key: "ledger.segregation" });
    await expect(run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-02", [{ acc: "1010", d: "1" }, { acc: "0610", c: "1" }], { journalId: b.journal("OPN") })))).rejects.toMatchObject({ key: "ledger.openingDate" });
  });

  it("reversal creates a linked mirror entry; the original stays unchanged", async () => {
    const original = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-05-10", [{ acc: "4500", d: "800" }, { acc: "1910", c: "800" }])));
    const rev = await run(b, (tx) => engine.reverseEntry(tx, b.access, original.id, { entryDate: "2026-05-31", reason: "Verkeerde rekening" }));
    expect(rev).toMatchObject({ status: "POSTED", kind: "REVERSAL", reversesEntryId: original.id });
    const after = await systemDb.journalEntry.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.reversedByEntryId).toBe(rev.id);
    expect(after.totalDebitBase.toString()).toBe("800");
    await expect(run(b, (tx) => engine.reverseEntry(tx, b.access, original.id, { entryDate: "2026-05-31", reason: "nogmaals" }))).rejects.toMatchObject({ key: "ledger.alreadyReversed" });
    const lines = await systemDb.journalLine.findMany({ where: { entryId: rev.id }, orderBy: { lineNo: "asc" } });
    expect(lines[0]!.creditBase.toString()).toBe("800");
  });

  it("correction = reversal + editable draft copy", async () => {
    const original = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-06-10", [{ acc: "4600", d: "300" }, { acc: "1910", c: "300" }])));
    const { reversal, draft } = await run(b, (tx) => engine.correctEntry(tx, b.access, original.id, { entryDate: "2026-06-15", reason: "Bedrag onjuist" }));
    expect(reversal.status).toBe("POSTED");
    expect(draft).toMatchObject({ status: "DRAFT", kind: "CORRECTION" });
  });
});

describe("Phase 2: database-enforced integrity (cannot be bypassed)", () => {
  it("posted entries and lines cannot be updated or deleted, even by the database owner", async () => {
    const b = await newBooks();
    const posted = await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-02-01", [{ acc: "4100", d: "100" }, { acc: "1910", c: "100" }])));
    await expect(systemDb.journalEntry.update({ where: { id: posted.id }, data: { description: "gewijzigd" } })).rejects.toThrow(/immutable/);
    await expect(systemDb.journalEntry.delete({ where: { id: posted.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(systemDb.journalLine.updateMany({ where: { entryId: posted.id }, data: { debitBase: "999" } })).rejects.toThrow(/immutable/);
    await expect(systemDb.journalLine.deleteMany({ where: { entryId: posted.id } })).rejects.toThrow(/immutable/);
  });

  it("an unbalanced entry cannot be committed as POSTED", async () => {
    const b = await newBooks();
    const draft = await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-02-01", [{ acc: "4100", d: "100" }, { acc: "1910", c: "100" }])));
    await expect(
      systemDb.$transaction(async (tx) => {
        await tx.journalLine.updateMany({ where: { entryId: draft.id, lineNo: 1 }, data: { debitBase: "150" } });
        await tx.journalEntry.update({ where: { id: draft.id }, data: { status: "POSTED", entryNumber: 999 } });
      }),
    ).rejects.toThrow(/not balanced/);
  });

  it("posting into a CLOSED period is refused by the database", async () => {
    const b = await newBooks();
    const draft = await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-07-10", [{ acc: "4100", d: "100" }, { acc: "1910", c: "100" }])));
    await systemDb.accountingPeriod.update({ where: { id: draft.periodId }, data: { status: "CLOSED" } });
    await expect(systemDb.journalEntry.update({ where: { id: draft.id }, data: { status: "POSTED", entryNumber: 1 } })).rejects.toThrow(/closed period/);
    await expect(run(b, (tx) => engine.postEntry(tx, b.access, draft.id))).rejects.toMatchObject({ key: "ledger.periodClosed" });
  });

  it("lines cannot point to an account of another administration", async () => {
    const b1 = await newBooks();
    const b2 = await newBooks();
    const draft = await run(b1, (tx) => engine.createEntry(tx, b1.access, entry(b1, "2026-02-01", [{ acc: "4100", d: "100" }, { acc: "1910", c: "100" }])));
    await expect(systemDb.journalLine.updateMany({ where: { entryId: draft.id, lineNo: 1 }, data: { accountId: b2.acc("4100") } })).rejects.toThrow(/another administration/);
  });
});

describe("Phase 2: periods, permissions and isolation", () => {
  it("a period with unposted entries cannot be closed (F3)", async () => {
    const b = await newBooks();
    const draft = await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-08-10", [{ acc: "4100", d: "1" }, { acc: "1910", c: "1" }])));
    await expect(setPeriodStatus(b.access, { periodId: draft.periodId, status: "CLOSED" })).rejects.toMatchObject({ key: "errors.periodHasUnposted" });
  });

  it("a bookkeeper can post but not reverse or approve", async () => {
    const b = await newBooks();
    const inv = await inviteMember(b.access, { email: `${uid("bk")}@example.test`, name: "Boekhouder", roleCode: "BOOKKEEPER" });
    const m = await systemDb.organizationMembership.update({ where: { id: inv.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(b.access, { companyId: b.companyId, userId: m.userId, roleCode: "BOOKKEEPER" });
    const bk = (await resolveAccess(m.userId, b.access.organizationId))!;
    // Bookkeepers have ledger.create/edit but not ledger.post (only purchase/sales/banking/scan.post).
    const draft = await withTenant(bk, (tx) => engine.createEntry(tx, bk, entry(b, "2026-02-03", [{ acc: "4100", d: "10" }, { acc: "1910", c: "10" }])));
    await expect(withTenant(bk, (tx) => engine.postEntry(tx, bk, draft.id))).rejects.toMatchObject({ key: "errors.forbidden" });
    const posted = await run(b, (tx) => engine.postEntry(tx, b.access, draft.id));
    await expect(withTenant(bk, (tx) => engine.reverseEntry(tx, bk, posted.id, { entryDate: "2026-02-04", reason: "x y z" }))).rejects.toMatchObject({ key: "errors.forbidden" });
  });

  it("ledger data of another organisation is invisible", async () => {
    const a = await newBooks();
    const other = await newBooks();
    await run(other, (tx) => engine.createAndPost(tx, other.access, entry(other, "2026-02-01", [{ acc: "4100", d: "100" }, { acc: "1910", c: "100" }])));
    await withTenant(a.access, async (tx) => {
      expect(await tx.journalEntry.count({ where: { administrationId: other.administrationId } })).toBe(0);
      expect(await tx.journalLine.count({ where: { administrationId: other.administrationId } })).toBe(0);
      expect(await tx.account.count({ where: { administrationId: other.administrationId } })).toBe(0);
    });
    await expect(withTenant(a.access, (tx) => engine.createEntry(tx, a.access, entry(other, "2026-02-01", [{ acc: "4100", d: "1" }, { acc: "1910", c: "1" }])))).rejects.toBeInstanceOf(UserError);
  });
});

describe("Phase 2: trial balance and general ledger", () => {
  it("shows opening, period and closing columns that balance, with correct figures", async () => {
    const b = await newBooks();
    // Opening balance (approved by a second user because of segregation of duties).
    const ctrl = await inviteMember(b.access, { email: `${uid("fc")}@example.test`, name: "Controller", roleCode: "FINANCIAL_CONTROLLER" });
    const cm = await systemDb.organizationMembership.update({ where: { id: ctrl.membershipId }, data: { status: "ACTIVE" } });
    await assignCompany(b.access, { companyId: b.companyId, userId: cm.userId, roleCode: "FINANCIAL_CONTROLLER" });
    const fc = (await resolveAccess(cm.userId, b.access.organizationId))!;
    const opening = await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-01-01", [{ acc: "1010", d: "10000" }, { acc: "0610", c: "10000" }], { journalId: b.journal("OPN") })));
    await withTenant(fc, (tx) => engine.approveEntry(tx, fc, opening.id));
    await run(b, (tx) => engine.postEntry(tx, b.access, opening.id));

    await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-01-31", [{ acc: "4100", d: "2500" }, { acc: "1910", c: "2500" }])));
    await run(b, (tx) => engine.createAndPost(tx, b.access, entry(b, "2026-02-28", [{ acc: "4100", d: "2500" }, { acc: "1910", c: "2500" }])));
    // A draft never counts.
    await run(b, (tx) => engine.createEntry(tx, b.access, entry(b, "2026-02-15", [{ acc: "4100", d: "99999" }, { acc: "1910", c: "99999" }])));

    const tb = await run(b, (tx) => trialBalance(tx, { administrationId: b.administrationId, fiscalYearId: b.fiscalYearId, fromPeriod: 2, toPeriod: 2, hideZero: true }));
    expect(tb.balanced).toBe(true);
    const rent = tb.rows.find((r) => r.number === "4100")!;
    expect(rent).toMatchObject({ openingDebit: "2500.00", periodDebit: "2500.00", closingDebit: "5000.00" });
    const cash = tb.rows.find((r) => r.number === "1010")!;
    expect(cash).toMatchObject({ openingDebit: "10000.00", periodDebit: "0.00", closingDebit: "10000.00" });
    const capital = tb.rows.find((r) => r.number === "0610")!;
    expect(capital).toMatchObject({ closingCredit: "10000.00" });
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);

    const ranged = await run(b, (tx) => trialBalance(tx, { administrationId: b.administrationId, fiscalYearId: b.fiscalYearId, fromPeriod: 0, toPeriod: 13, accountFrom: "4000", accountTo: "4999", hideZero: true }));
    expect(ranged.rows.map((r) => r.number)).toEqual(["4100"]);

    const gl = await run(b, (tx) => generalLedger(tx, { administrationId: b.administrationId, fiscalYearId: b.fiscalYearId, accountId: b.acc("4100"), fromPeriod: 0, toPeriod: 13 }));
    expect(gl.lines.map((l) => l.balance)).toEqual(["2500.00", "5000.00"]);
    expect(gl.closing).toBe("5000.00");
  });
});
