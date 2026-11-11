import Decimal from "decimal.js";
import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { registerPaymentInTx } from "@/modules/invoicing/service";
import { fileHash, ImportError, matchScore, parseStatement, type ImportProfile } from "./csv-import";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MAX_FILE = 2 * 1024 * 1024;

export const importProfileSchema = z.object({
  delimiter: z.enum([",", ";", "\t"]),
  hasHeader: z.boolean(),
  dateColumn: z.coerce.number().int().min(0).max(50),
  dateFormat: z.enum(["DD-MM-YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY"]),
  amountColumn: z.coerce.number().int().min(0).max(50).optional(),
  debitColumn: z.coerce.number().int().min(0).max(50).optional(),
  creditColumn: z.coerce.number().int().min(0).max(50).optional(),
  decimalSeparator: z.enum([",", "."]),
  descriptionColumn: z.coerce.number().int().min(0).max(50),
  counterpartyColumn: z.coerce.number().int().min(0).max(50).optional(),
  counterpartyAccountColumn: z.coerce.number().int().min(0).max(50).optional(),
  referenceColumn: z.coerce.number().int().min(0).max(50).optional(),
}).refine((p) => p.amountColumn !== undefined || (p.debitColumn !== undefined && p.creditColumn !== undefined), { message: "banking.amountColumnsRequired", path: ["amountColumn"] });

async function account(tx: Tx, id: string) {
  const fa = await tx.financialAccount.findUnique({ where: { id } });
  if (!fa) throw new UserError("errors.notFound");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: fa.administrationId } });
  return { fa, admin };
}

export async function saveImportProfile(access: Access, financialAccountId: string, profile: ImportProfile) {
  return withTenant(scope(access), async (tx) => {
    const { fa, admin } = await account(tx, financialAccountId);
    assertCan(access, "banking.edit", admin.companyId);
    await tx.financialAccount.update({ where: { id: fa.id }, data: { importProfile: profile as object } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.profileSaved", entity: "FinancialAccount", entityId: fa.id, details: profile as object });
  });
}

/** Imports a statement file. The same file is refused; lines already imported (overlapping files) are skipped. */
export async function importStatement(access: Access, input: { financialAccountId: string; fileName: string; content: string; closingBalance?: string }) {
  if (input.content.length > MAX_FILE) throw new UserError("banking.fileTooLarge");
  return withTenant(scope(access), async (tx) => {
    const { fa, admin } = await account(tx, input.financialAccountId);
    assertCan(access, "banking.create", admin.companyId);
    if (!fa.importProfile) throw new UserError("banking.noProfile");
    const profile = importProfileSchema.parse(fa.importProfile);
    let lines;
    try {
      lines = parseStatement(input.content, profile);
    } catch (e) {
      if (e instanceof ImportError) throw new UserError(e.key, e.values);
      throw e;
    }
    const hash = fileHash(input.content);
    if (await tx.bankStatement.findUnique({ where: { financialAccountId_fileHash: { financialAccountId: fa.id, fileHash: hash } } })) throw new UserError("banking.fileAlreadyImported");
    const existing = new Set((await tx.bankTransaction.findMany({ where: { financialAccountId: fa.id, lineHash: { in: lines.map((l) => l.lineHash) } }, select: { lineHash: true } })).map((r) => r.lineHash));
    const fresh = lines.filter((l) => !existing.has(l.lineHash));
    const dates = lines.map((l) => l.bookingDate).sort();
    const statement = await tx.bankStatement.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, financialAccountId: fa.id, fileName: input.fileName.slice(0, 200), fileHash: hash,
        fromDate: toDate(dates[0]!), toDate: toDate(dates[dates.length - 1]!), closingBalance: input.closingBalance || null,
        lineCount: fresh.length, duplicateLines: lines.length - fresh.length, importedById: access.userId,
      },
    });
    if (fresh.length) {
      await tx.bankTransaction.createMany({
        data: fresh.map((l) => ({
          organizationId: access.organizationId, administrationId: admin.id, financialAccountId: fa.id, statementId: statement.id, bookingDate: toDate(l.bookingDate),
          amount: l.amount, currency: fa.currency, description: l.description.slice(0, 500), counterpartyName: l.counterpartyName, counterpartyAccount: l.counterpartyAccount,
          bankReference: l.bankReference, lineHash: l.lineHash,
        })),
      });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.statementImported", entity: "BankStatement", entityId: statement.id, details: { file: input.fileName, lines: fresh.length, duplicates: lines.length - fresh.length } });
    return statement;
  }, { timeout: 60_000 });
}

/** Up to 5 open items that may be what this transaction pays, best first. */
export async function suggestions(tx: Tx, transactionId: string) {
  const t = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  const side = new Decimal(t.amount.toString()).gt(0) ? "RECEIVABLE" : "PAYABLE";
  const items = await tx.openItem.findMany({ where: { administrationId: t.administrationId, side, status: "OPEN", currency: t.currency, remainingAmount: side === "RECEIVABLE" ? { gt: 0 } : { gt: 0 } }, include: { party: { select: { name: true } } }, take: 500 });
  return items
    .map((i) => ({ item: i, score: matchScore({ amount: t.amount.toString(), description: t.description, counterpartyName: t.counterpartyName }, { remaining: i.remainingAmount.toString(), documentNumber: i.documentNumber, partyName: i.party?.name ?? null }) }))
    .filter((s) => s.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function loadTx(tx: Tx, id: string) {
  const t = await tx.bankTransaction.findUnique({ where: { id } });
  if (!t) throw new UserError("errors.notFound");
  const { fa, admin } = await account(tx, t.financialAccountId);
  if (t.status === "MATCHED" || t.status === "IGNORED") throw new UserError("banking.alreadyProcessed");
  return { t, fa, admin, open: new Decimal(t.amount.toString()).abs().minus(t.matchedAmount.toString()) };
}

async function addMatch(tx: Tx, access: Access, t: { id: string; amount: Decimal.Value | { toString(): string }; matchedAmount: { toString(): string } }, amount: Decimal, target: { paymentId?: string; entryId?: string }) {
  await tx.bankMatch.create({ data: { organizationId: access.organizationId, bankTransactionId: t.id, amount: amount.toFixed(2), createdById: access.userId, ...target } });
  const matched = new Decimal(t.matchedAmount.toString()).plus(amount);
  const total = new Decimal(t.amount.toString()).abs();
  await tx.bankTransaction.update({ where: { id: t.id }, data: { matchedAmount: matched.toFixed(2), status: matched.equals(total) ? "MATCHED" : "PARTIAL" } });
}

/** Matches (part of) a bank transaction to open items: registers the payment with allocations (and FX difference). */
export async function matchToOpenItems(access: Access, input: { transactionId: string; allocations: { openItemId: string; amount: string }[]; exchangeRate?: string }) {
  return withTenant(scope(access), async (tx) => {
    const { t, fa, admin, open } = await loadTx(tx, input.transactionId);
    assertCan(access, "banking.post", admin.companyId);
    const total = input.allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
    if (total.lte(0) || total.gt(open)) throw new UserError("banking.matchExceedsTransaction");
    const payment = await registerPaymentInTx(tx, access, {
      administrationId: admin.id, direction: new Decimal(t.amount.toString()).gt(0) ? "IN" : "OUT", financialAccountId: fa.id, date: iso(t.bookingDate),
      amount: total.toFixed(2), exchangeRate: input.exchangeRate, reference: t.bankReference ?? undefined, description: t.description, bankTransactionId: t.id,
      idempotencyKey: `bank:${t.id}:${t.matchedAmount.toString()}`, allocations: input.allocations,
    });
    await addMatch(tx, access, t, total, { paymentId: payment.id });
    return payment;
  }, { timeout: 30_000 });
}

/**
 * Books (part of) a bank transaction directly against a ledger account (bank charges, interest, wages paid …).
 * Receivable/payable control accounts must go through matching; transfers through `transferFunds`.
 */
export async function bookToAccount(access: Access, input: { transactionId: string; accountId: string; description?: string; amount?: string; exchangeRate?: string }) {
  return withTenant(scope(access), async (tx) => {
    const { t, fa, admin, open } = await loadTx(tx, input.transactionId);
    assertCan(access, "banking.post", admin.companyId);
    const amount = input.amount ? new Decimal(input.amount) : open;
    if (amount.lte(0) || amount.gt(open)) throw new UserError("banking.matchExceedsTransaction");
    const counter = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!counter || counter.administrationId !== admin.id) throw new UserError("ledger.unknownAccount", { line: 2 });
    if (["RECEIVABLE", "PAYABLE", "BANK", "CASH", "FIXED_ASSET"].includes(counter.controlType)) throw new UserError("banking.useDedicatedFlow");
    const inflow = new Decimal(t.amount.toString()).gt(0);
    const rate = fa.currency === admin.baseCurrency ? undefined : input.exchangeRate;
    if (fa.currency !== admin.baseCurrency && !rate) throw new UserError("invoicing.rateRequired", { currency: fa.currency });
    const fx = rate ? { currency: fa.currency, rate } : {};
    const lines: LineInput[] = [
      { accountId: fa.ledgerAccountId, description: t.description, ...(inflow ? { debit: amount.toFixed(2) } : { credit: amount.toFixed(2) }), ...fx },
      { accountId: counter.id, description: input.description || t.description, ...(inflow ? { credit: amount.toFixed(2) } : { debit: amount.toFixed(2) }), ...fx },
    ];
    const entry = await engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: fa.journalId, entryDate: iso(t.bookingDate), description: (input.description || t.description).slice(0, 500),
      reference: t.bankReference, lines, sourceType: "BANK", sourceId: t.id, idempotencyKey: `bankbook:${t.id}:${t.matchedAmount.toString()}`,
    });
    await addMatch(tx, access, t, amount, { entryId: entry.id });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.booked", entity: "BankTransaction", entityId: t.id, details: { account: counter.number, amount: amount.toFixed(2) } });
    return entry;
  });
}

export async function ignoreTransaction(access: Access, transactionId: string, reason: string) {
  if (!reason.trim()) throw new UserError("errors.reasonRequired");
  return withTenant(scope(access), async (tx) => {
    const { t, admin } = await loadTx(tx, transactionId);
    assertCan(access, "banking.approve", admin.companyId);
    if (!t.matchedAmount.isZero()) throw new UserError("banking.cannotIgnorePartial");
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "IGNORED", ignoreReason: reason.trim().slice(0, 300) } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.ignored", entity: "BankTransaction", entityId: t.id, details: { reason } });
  });
}

/**
 * Transfer between two bank/cash accounts, including a cambio exchange (different currencies).
 * Each side is converted at its own rate; the base-currency difference is a realised exchange difference.
 */
export async function transferFunds(access: Access, input: { fromId: string; toId: string; date: string; amountFrom: string; amountTo?: string; rateFrom?: string; rateTo?: string; description?: string }) {
  return withTenant(scope(access), async (tx) => {
    const from = await account(tx, input.fromId);
    const to = await account(tx, input.toId);
    const admin = from.admin;
    if (from.fa.id === to.fa.id || to.admin.id !== admin.id) throw new UserError("banking.invalidTransfer");
    assertCan(access, "banking.post", admin.companyId);
    const base = admin.baseCurrency;
    const amountFrom = new Decimal(input.amountFrom);
    const amountTo = new Decimal(from.fa.currency === to.fa.currency ? input.amountFrom : input.amountTo ?? "0");
    if (amountFrom.lte(0) || amountTo.lte(0)) throw new UserError("validation.positive");
    const rateFrom = from.fa.currency === base ? "1" : input.rateFrom;
    const rateTo = to.fa.currency === base ? "1" : input.rateTo;
    if (!rateFrom || !rateTo) throw new UserError("invoicing.rateRequired", { currency: !rateFrom ? from.fa.currency : to.fa.currency });
    const baseFrom = amountFrom.times(rateFrom).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const baseTo = amountTo.times(rateTo).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const fx = (cur: string, r: string) => (cur === base ? {} : { currency: cur, rate: r });
    const desc = input.description || `Overboeking ${from.fa.name} → ${to.fa.name}`;
    const lines: LineInput[] = [
      { accountId: to.fa.ledgerAccountId, description: desc, debit: amountTo.toFixed(2), ...fx(to.fa.currency, rateTo) },
      { accountId: from.fa.ledgerAccountId, description: desc, credit: amountFrom.toFixed(2), ...fx(from.fa.currency, rateFrom) },
    ];
    const diff = baseTo.minus(baseFrom);
    if (!diff.isZero()) {
      const fxAcc = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: "FX_RESULT", type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" } });
      if (!fxAcc) throw new UserError("invoicing.noFxAccount");
      lines.push({ accountId: fxAcc.id, description: "Koersverschil overboeking/cambio", ...(diff.gt(0) ? { credit: diff.toFixed(2) } : { debit: diff.abs().toFixed(2) }) });
    }
    const entry = await engine.createAndPost(tx, access, { administrationId: admin.id, journalId: from.fa.journalId, entryDate: input.date, description: desc, lines, sourceType: "BANK" });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.transfer", entity: "JournalEntry", entityId: entry.id, details: { from: from.fa.name, to: to.fa.name, amountFrom: amountFrom.toFixed(2), amountTo: amountTo.toFixed(2) } });
    return entry;
  });
}

/** Cash book entry (receipt or payment) against a revenue/expense account, optionally with BTW included in the amount. */
export async function cashEntry(access: Access, input: { financialAccountId: string; date: string; direction: "IN" | "OUT"; amount: string; accountId: string; taxCodeId?: string; description: string; exchangeRate?: string }) {
  return withTenant(scope(access), async (tx) => {
    const { fa, admin } = await account(tx, input.financialAccountId);
    assertCan(access, "banking.post", admin.companyId);
    const counter = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!counter || counter.administrationId !== admin.id || ["RECEIVABLE", "PAYABLE", "BANK", "CASH", "FIXED_ASSET"].includes(counter.controlType)) throw new UserError("banking.useDedicatedFlow");
    const gross = new Decimal(input.amount);
    if (gross.lte(0)) throw new UserError("validation.positive");
    const rate = fa.currency === admin.baseCurrency ? undefined : input.exchangeRate;
    if (fa.currency !== admin.baseCurrency && !rate) throw new UserError("invoicing.rateRequired", { currency: fa.currency });
    const fx = rate ? { currency: fa.currency, rate } : {};
    const inflow = input.direction === "IN";
    const lines: LineInput[] = [{ accountId: fa.ledgerAccountId, description: input.description, ...(inflow ? { debit: gross.toFixed(2) } : { credit: gross.toFixed(2) }), ...fx }];
    let net = gross;
    if (input.taxCodeId) {
      const code = await tx.taxCode.findUnique({ where: { id: input.taxCodeId } });
      if (!code || code.administrationId !== admin.id) throw new UserError("invoicing.invalidTaxCode");
      const rateTax = new Decimal(code.rate.toString());
      net = gross.times(100).dividedBy(new Decimal(100).plus(rateTax)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const taxAmt = gross.minus(net);
      const taxAccount = inflow ? code.outputAccountId : code.inputAccountId;
      if (!taxAmt.isZero()) {
        if (!taxAccount) throw new UserError("invoicing.invalidTaxCode");
        lines.push({ accountId: taxAccount, description: `BTW ${code.code}`, ...(inflow ? { credit: taxAmt.toFixed(2) } : { debit: taxAmt.toFixed(2) }), ...fx, taxCodeId: code.id });
      }
    }
    lines.push({ accountId: counter.id, description: input.description, ...(inflow ? { credit: net.toFixed(2) } : { debit: net.toFixed(2) }), ...fx, taxCodeId: input.taxCodeId ?? null });
    return engine.createAndPost(tx, access, { administrationId: admin.id, journalId: fa.journalId, entryDate: input.date, description: input.description, lines, sourceType: "BANK" });
  });
}

/** Balance of a bank/cash account in its own currency (posted entries up to a date). */
export async function accountBalance(tx: Tx, ledgerAccountId: string, upTo: Date) {
  const [r] = await tx.$queryRaw<{ tx: string | null; base: string | null }[]>`
    SELECT SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
     WHERE l."accountId" = ${ledgerAccountId} AND e.status = 'POSTED' AND e."entryDate" <= ${upTo}`;
  return { tx: new Decimal(r?.tx ?? 0), base: new Decimal(r?.base ?? 0) };
}

/** Bank reconciliation at a date: statement balance vs ledger balance (account currency) and unmatched lines. */
export async function reconcile(access: Access, input: { financialAccountId: string; periodEnd: string; statementBalance: string; notes?: string }) {
  return withTenant(scope(access), async (tx) => {
    const { fa, admin } = await account(tx, input.financialAccountId);
    assertCan(access, "banking.edit", admin.companyId);
    const end = toDate(input.periodEnd);
    const ledger = await accountBalance(tx, fa.ledgerAccountId, end);
    const unmatched = await tx.bankTransaction.count({ where: { financialAccountId: fa.id, bookingDate: { lte: end }, status: { in: ["UNMATCHED", "PARTIAL"] } } });
    const statement = new Decimal(input.statementBalance);
    const data = { statementBalance: statement.toFixed(2), ledgerBalance: ledger.tx.toFixed(2), difference: statement.minus(ledger.tx).toFixed(2), unmatchedCount: unmatched, notes: input.notes ?? null };
    const existing = await tx.bankReconciliation.findUnique({ where: { financialAccountId_periodEnd: { financialAccountId: fa.id, periodEnd: end } } });
    if (existing?.status === "APPROVED") throw new UserError("banking.reconciliationApproved");
    const rec = existing
      ? await tx.bankReconciliation.update({ where: { id: existing.id }, data })
      : await tx.bankReconciliation.create({ data: { organizationId: access.organizationId, administrationId: admin.id, financialAccountId: fa.id, periodEnd: end, createdById: access.userId, ...data } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.reconciled", entity: "BankReconciliation", entityId: rec.id, details: data });
    return rec;
  });
}

export async function approveReconciliation(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const rec = await tx.bankReconciliation.findUnique({ where: { id } });
    if (!rec) throw new UserError("errors.notFound");
    const { admin } = await account(tx, rec.financialAccountId);
    assertCan(access, "banking.approve", admin.companyId);
    if (!rec.difference.isZero() || rec.unmatchedCount > 0) throw new UserError("banking.reconciliationNotClean");
    const segregation = (admin.settings as { segregationOfDuties?: boolean })?.segregationOfDuties !== false;
    if (segregation && rec.createdById === access.userId) throw new UserError("ledger.segregation");
    await tx.bankReconciliation.update({ where: { id }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "bank.reconciliationApproved", entity: "BankReconciliation", entityId: id });
  });
}
