import type { ControlType, EntryKind, JournalEntry, SourceType } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { nextSequence } from "@/core/numbering";
import { assertCan, can, type Access } from "@/core/auth/access";
import type { Permission } from "@/core/auth/permissions";
import { UserError } from "@/core/errors";
import { buildLines, LedgerError, reverseLines, totals, type LineInput } from "./domain";

/**
 * THE accounting engine. Only this module creates, posts or reverses journal entries (lint-enforced).
 * Every function runs inside the caller's tenant transaction, so sub-ledgers (sales, purchase, bank …)
 * post in the same transaction as their own changes (ACCOUNTING_RULES P3).
 */

export interface EntryInput {
  administrationId: string;
  journalId: string;
  entryDate: string; // YYYY-MM-DD
  documentDate?: string | null;
  description: string;
  reference?: string | null;
  lines: LineInput[];
  kind?: EntryKind;
  sourceType?: SourceType;
  sourceId?: string | null;
  idempotencyKey?: string | null;
}

/**
 * Permissions per source: manual entries need ledger.*, module postings need that module's permission
 * (so a bookkeeper may post a sales invoice without being allowed free-form memorial entries).
 */
const SOURCE_PERMISSIONS: Record<SourceType, { create: Permission; post: Permission; reverse: Permission }> = {
  MANUAL: { create: "ledger.create", post: "ledger.post", reverse: "ledger.reverse" },
  OPENING: { create: "ledger.create", post: "ledger.post", reverse: "ledger.reverse" },
  IMPORT: { create: "ledger.create", post: "ledger.post", reverse: "ledger.reverse" },
  SALES_INVOICE: { create: "sales.create", post: "sales.post", reverse: "sales.post" },
  PURCHASE_INVOICE: { create: "purchase.create", post: "purchase.post", reverse: "purchase.post" },
  PAYMENT: { create: "banking.create", post: "banking.post", reverse: "banking.post" },
  BANK: { create: "banking.create", post: "banking.post", reverse: "banking.post" },
  CURRENT_ACCOUNT: { create: "currentAccounts.create", post: "currentAccounts.post", reverse: "currentAccounts.post" },
  ASSET: { create: "assets.create", post: "assets.post", reverse: "assets.post" },
  DEPRECIATION: { create: "assets.create", post: "assets.post", reverse: "assets.post" },
  FX_REVALUATION: { create: "currency.create", post: "currency.post", reverse: "currency.post" },
  YEAR_END: { create: "yearEnd.edit", post: "yearEnd.post", reverse: "yearEnd.post" },
  TAX: { create: "tax.edit", post: "ledger.post", reverse: "ledger.reverse" },
  SCAN: { create: "scan.create", post: "scan.post", reverse: "purchase.post" },
};
export const permissionsFor = (source: SourceType) => SOURCE_PERMISSIONS[source];

/** Control accounts that only their owning module may post to (L4). Opening entries are the exception. */
const MODULE_ONLY: ControlType[] = ["RECEIVABLE", "PAYABLE", "BANK", "CASH", "CURRENT_ACCOUNT", "FIXED_ASSET"];

const toDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError("validation.date");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new UserError("validation.date");
  return d;
};

function ledgerToUser(err: unknown): never {
  if (err instanceof LedgerError) throw new UserError(err.key, err.values);
  throw err;
}

export function formatEntryNumber(journalCode: string, fiscalYearCode: string, n: number | null): string {
  return n == null ? "—" : `${journalCode}-${fiscalYearCode.replace("/", "")}-${String(n).padStart(5, "0")}`;
}

async function loadAdministration(tx: Tx, administrationId: string) {
  const admin = await tx.administration.findUnique({ where: { id: administrationId } });
  if (!admin) throw new UserError("errors.notFound");
  if (admin.status === "ARCHIVED") throw new UserError("ledger.administrationArchived");
  return admin;
}

/** Resolves fiscal year and period for an entry date (period 0 for opening, 13 for year-end entries). */
async function resolvePeriod(tx: Tx, access: Access, companyId: string, administrationId: string, date: Date, kind: EntryKind) {
  const fy = await tx.fiscalYear.findFirst({ where: { administrationId, startDate: { lte: date }, endDate: { gte: date } } });
  if (!fy) throw new UserError("ledger.noFiscalYear");
  if (fy.status === "CLOSED") throw new UserError("errors.fiscalYearClosed");
  let number: number;
  if (kind === "OPENING") {
    if (date.getTime() !== fy.startDate.getTime()) throw new UserError("ledger.openingDate");
    number = 0;
  } else if (kind === "CLOSING" || kind === "ADJUSTMENT") {
    if (date.getTime() !== fy.endDate.getTime()) throw new UserError("ledger.yearEndDate");
    number = 13;
  } else {
    const p = await tx.accountingPeriod.findFirst({ where: { fiscalYearId: fy.id, number: { gte: 1, lte: 12 }, startDate: { lte: date }, endDate: { gte: date } } });
    if (!p) throw new UserError("ledger.noPeriod");
    number = p.number;
  }
  const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { fiscalYearId_number: { fiscalYearId: fy.id, number } } });
  if (period.status === "CLOSED") throw new UserError("ledger.periodClosed", { period: number });
  if (period.status === "SOFT_CLOSED" && !can(access, "periods.close", companyId)) throw new UserError("ledger.periodSoftClosed", { period: number });
  return { fiscalYear: fy, period };
}

async function prepare(tx: Tx, access: Access, input: EntryInput) {
  const admin = await loadAdministration(tx, input.administrationId);
  const journal = await tx.journal.findUnique({ where: { id: input.journalId } });
  if (!journal || journal.administrationId !== admin.id || journal.status !== "ACTIVE") throw new UserError("ledger.invalidJournal");
  const kind: EntryKind = input.kind ?? (journal.type === "OPENING" ? "OPENING" : journal.type === "CLOSING" ? "CLOSING" : "NORMAL");
  if (journal.type === "OPENING" && kind !== "OPENING") throw new UserError("ledger.invalidJournal");
  const date = toDate(input.entryDate);
  const { fiscalYear, period } = await resolvePeriod(tx, access, admin.companyId, admin.id, date, kind);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, administrationId: admin.id } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sourceType = input.sourceType ?? "MANUAL";
  input.lines.forEach((l, i) => {
    const a = byId.get(l.accountId);
    if (!a) throw new UserError("ledger.unknownAccount", { line: i + 1 });
    if (a.type !== "DETAIL" || a.status !== "ACTIVE") throw new UserError("ledger.accountNotPostable", { line: i + 1, account: a.number });
    if (sourceType === "MANUAL" && kind !== "OPENING" && MODULE_ONLY.includes(a.controlType)) {
      throw new UserError("ledger.controlAccount", { line: i + 1, account: a.number });
    }
    const cur = (l.currency || admin.baseCurrency).toUpperCase();
    if (a.currency && a.currency !== cur) throw new UserError("ledger.accountCurrency", { line: i + 1, account: a.number, currency: a.currency });
  });

  const dimIds = [...new Set(input.lines.flatMap((l) => [l.costCenterId, l.projectId, l.departmentId]).filter(Boolean))] as string[];
  if (dimIds.length) {
    const found = await tx.dimensionValue.count({ where: { id: { in: dimIds }, administrationId: admin.id, status: "ACTIVE" } });
    if (found !== dimIds.length) throw new UserError("ledger.invalidDimension");
  }

  const rounding = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: "ROUNDING", type: "DETAIL", status: "ACTIVE" } });
  let lines;
  try {
    lines = buildLines(input.lines, admin.baseCurrency, rounding?.id);
  } catch (err) {
    ledgerToUser(err);
  }
  const sums = totals(lines, admin.baseCurrency);
  return { admin, journal, kind, date, fiscalYear, period, lines, sums, sourceType };
}

function lineRows(organizationId: string, administrationId: string, entryId: string, lines: ReturnType<typeof buildLines>) {
  return lines.map((l) => ({
    ...l,
    organizationId,
    administrationId,
    entryId,
    rateDate: l.rateDate ? new Date(`${l.rateDate}T00:00:00Z`) : null,
  }));
}

/** Creates a DRAFT entry (or returns the existing one for a repeated idempotency key). */
export async function createEntry(tx: Tx, access: Access, input: EntryInput): Promise<JournalEntry> {
  const admin = await loadAdministration(tx, input.administrationId);
  assertCan(access, permissionsFor(input.sourceType ?? "MANUAL").create, admin.companyId);
  if (input.idempotencyKey) {
    const existing = await tx.journalEntry.findUnique({ where: { administrationId_idempotencyKey: { administrationId: admin.id, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;
  }
  const p = await prepare(tx, access, input);
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: access.organizationId,
      administrationId: p.admin.id,
      journalId: p.journal.id,
      fiscalYearId: p.fiscalYear.id,
      periodId: p.period.id,
      entryDate: p.date,
      documentDate: input.documentDate ? toDate(input.documentDate) : null,
      description: input.description.trim(),
      reference: input.reference?.trim() || null,
      currency: p.admin.baseCurrency,
      kind: p.kind,
      sourceType: p.sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      totalDebitBase: p.sums.debit.toString(),
      totalCreditBase: p.sums.credit.toString(),
      createdById: access.userId,
    },
  });
  await tx.journalLine.createMany({ data: lineRows(access.organizationId, p.admin.id, entry.id, p.lines) });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.created", entity: "JournalEntry", entityId: entry.id, details: { journal: p.journal.code, date: input.entryDate, debit: p.sums.debit.toString() } });
  return entry;
}

async function loadEntry(tx: Tx, entryId: string) {
  const entry = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { journal: true, fiscalYear: true } });
  if (!entry) throw new UserError("errors.notFound");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: entry.administrationId } });
  return { entry, admin };
}

/** Replaces header and lines of a DRAFT entry (submitted/approved entries go back to DRAFT when edited). */
export async function updateDraft(tx: Tx, access: Access, entryId: string, input: EntryInput) {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, "ledger.edit", admin.companyId);
  if (entry.status === "POSTED") throw new UserError("ledger.postedImmutable");
  if (input.administrationId !== entry.administrationId) throw new UserError("errors.notFound");
  const p = await prepare(tx, access, { ...input, kind: entry.kind === "CORRECTION" ? "CORRECTION" : input.kind });
  await tx.journalLine.deleteMany({ where: { entryId } });
  const updated = await tx.journalEntry.update({
    where: { id: entryId },
    data: {
      journalId: p.journal.id, fiscalYearId: p.fiscalYear.id, periodId: p.period.id, entryDate: p.date,
      documentDate: input.documentDate ? toDate(input.documentDate) : null,
      description: input.description.trim(), reference: input.reference?.trim() || null,
      totalDebitBase: p.sums.debit.toString(), totalCreditBase: p.sums.credit.toString(),
      status: "DRAFT", submittedById: null, approvedById: null, approvedAt: null,
    },
  });
  await tx.journalLine.createMany({ data: lineRows(access.organizationId, admin.id, entryId, p.lines) });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.updated", entity: "JournalEntry", entityId: entryId, details: { previousStatus: entry.status } });
  return updated;
}

export async function deleteDraft(tx: Tx, access: Access, entryId: string) {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, "ledger.edit", admin.companyId);
  if (entry.status === "POSTED") throw new UserError("ledger.postedImmutable");
  if (entry.sourceType !== "MANUAL") throw new UserError("ledger.deleteViaSource");
  await tx.journalEntry.delete({ where: { id: entryId } });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.deleted", entity: "JournalEntry", entityId: entryId, details: { description: entry.description, status: entry.status } });
}

export async function submitEntry(tx: Tx, access: Access, entryId: string) {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, "ledger.create", admin.companyId);
  if (entry.status !== "DRAFT") throw new UserError("ledger.wrongStatus");
  const updated = await tx.journalEntry.update({ where: { id: entryId }, data: { status: "SUBMITTED", submittedById: access.userId } });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.submitted", entity: "JournalEntry", entityId: entryId });
  return updated;
}

export async function approveEntry(tx: Tx, access: Access, entryId: string) {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, "ledger.approve", admin.companyId);
  if (entry.status !== "SUBMITTED" && entry.status !== "DRAFT") throw new UserError("ledger.wrongStatus");
  const segregation = (admin.settings as { segregationOfDuties?: boolean })?.segregationOfDuties !== false;
  if (segregation && entry.createdById === access.userId) throw new UserError("ledger.segregation");
  const updated = await tx.journalEntry.update({ where: { id: entryId }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.approved", entity: "JournalEntry", entityId: entryId });
  return updated;
}

const nextNumber = (tx: Tx, organizationId: string, journalId: string, fiscalYearId: string) =>
  nextSequence(tx, organizationId, "JOURNAL", journalId, fiscalYearId);

/** Posts an entry: re-validates against current accounts/periods, assigns the gapless number, locks it. */
export async function postEntry(tx: Tx, access: Access, entryId: string): Promise<JournalEntry> {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, permissionsFor(entry.sourceType).post, admin.companyId);
  if (entry.status === "POSTED") throw new UserError("ledger.alreadyPosted");
  if (entry.journal.requiresApproval && entry.status !== "APPROVED") throw new UserError("ledger.approvalRequired");
  const lines = await tx.journalLine.findMany({ where: { entryId }, orderBy: { lineNo: "asc" } });
  // Re-validate with today's account and period state (accounts may have been archived, periods closed).
  await prepare(tx, access, {
    administrationId: entry.administrationId, journalId: entry.journalId, entryDate: entry.entryDate.toISOString().slice(0, 10),
    description: entry.description, kind: entry.kind, sourceType: entry.sourceType,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debitBase.gt(0) ? (l.txAmount.abs().toString()) : null,
      credit: l.creditBase.gt(0) ? (l.txAmount.abs().toString()) : null,
      currency: l.txCurrency, rate: l.exchangeRate.toString(), rateSource: l.rateSource,
      costCenterId: l.costCenterId, projectId: l.projectId, departmentId: l.departmentId,
    })).filter((_, i) => !lines[i]!.isRounding),
  });
  const entryNumber = await nextNumber(tx, access.organizationId, entry.journalId, entry.fiscalYearId);
  const posted = await tx.journalEntry.update({
    where: { id: entryId },
    data: { status: "POSTED", entryNumber, postedById: access.userId, postedAt: new Date() },
  });
  await audit(tx, {
    organizationId: access.organizationId, userId: access.userId, action: "entry.posted", entity: "JournalEntry", entityId: entryId,
    details: { number: formatEntryNumber(entry.journal.code, entry.fiscalYear.code, entryNumber), debit: entry.totalDebitBase.toString() },
  });
  return posted;
}

/** Creates and posts in one step (used by sub-ledgers). Idempotent on `idempotencyKey`. */
export async function createAndPost(tx: Tx, access: Access, input: EntryInput): Promise<JournalEntry> {
  if (input.idempotencyKey) {
    const existing = await tx.journalEntry.findUnique({ where: { administrationId_idempotencyKey: { administrationId: input.administrationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;
  }
  const entry = await createEntry(tx, access, input);
  return postEntry(tx, access, entry.id);
}

/** Reversal: a posted mirror entry in an open period, linked both ways. The original stays untouched. */
export async function reverseEntry(tx: Tx, access: Access, entryId: string, opts: { entryDate: string; reason: string; viaSource?: boolean }) {
  const { entry, admin } = await loadEntry(tx, entryId);
  assertCan(access, opts.viaSource ? permissionsFor(entry.sourceType).reverse : "ledger.reverse", admin.companyId);
  if (!opts.viaSource && entry.sourceType !== "MANUAL" && entry.sourceType !== "OPENING" && entry.sourceType !== "IMPORT") throw new UserError("ledger.reverseViaSource");
  if (entry.status !== "POSTED") throw new UserError("ledger.onlyPostedReversible");
  if (entry.reversedByEntryId) throw new UserError("ledger.alreadyReversed");
  if (entry.kind === "REVERSAL") throw new UserError("ledger.cannotReverseReversal");
  if (!opts.reason?.trim()) throw new UserError("errors.reasonRequired");
  const date = toDate(opts.entryDate);
  const kind: EntryKind = entry.kind === "OPENING" || entry.kind === "CLOSING" || entry.kind === "ADJUSTMENT" ? entry.kind : "REVERSAL";
  const { fiscalYear, period } = await resolvePeriod(tx, access, admin.companyId, admin.id, date, kind === "REVERSAL" ? "NORMAL" : kind);
  const lines = await tx.journalLine.findMany({ where: { entryId }, orderBy: { lineNo: "asc" } });

  const reversal = await tx.journalEntry.create({
    data: {
      organizationId: access.organizationId, administrationId: admin.id, journalId: entry.journalId,
      fiscalYearId: fiscalYear.id, periodId: period.id, entryDate: date, documentDate: entry.documentDate,
      description: `Tegenboeking: ${entry.description}`.slice(0, 500), reference: entry.reference, currency: entry.currency,
      kind: "REVERSAL", sourceType: entry.sourceType, sourceId: entry.sourceId, reversesEntryId: entry.id, reason: opts.reason.trim(),
      totalDebitBase: entry.totalCreditBase, totalCreditBase: entry.totalDebitBase, createdById: access.userId,
    },
  });
  await tx.journalLine.createMany({
    data: reverseLines(lines).map(({ id: _id, entryId: _e, ...l }) => ({ ...l, entryId: reversal.id })),
  });
  const number = await nextNumber(tx, access.organizationId, entry.journalId, fiscalYear.id);
  const posted = await tx.journalEntry.update({ where: { id: reversal.id }, data: { status: "POSTED", entryNumber: number, postedById: access.userId, postedAt: new Date() } });
  await tx.journalEntry.update({ where: { id: entry.id }, data: { reversedByEntryId: reversal.id } });
  await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "entry.reversed", entity: "JournalEntry", entityId: entry.id, details: { reversalId: reversal.id, reason: opts.reason.trim(), date: opts.entryDate } });
  return posted;
}

/** Correction: reverses the entry and creates an editable draft copy (kind CORRECTION) on the given date. */
export async function correctEntry(tx: Tx, access: Access, entryId: string, opts: { entryDate: string; reason: string }) {
  const { entry } = await loadEntry(tx, entryId);
  if (entry.kind !== "NORMAL" && entry.kind !== "CORRECTION") throw new UserError("ledger.correctOnlyNormal");
  const reversal = await reverseEntry(tx, access, entryId, opts);
  const lines = await tx.journalLine.findMany({ where: { entryId, isRounding: false }, orderBy: { lineNo: "asc" } });
  const draft = await createEntry(tx, access, {
    administrationId: entry.administrationId, journalId: entry.journalId, entryDate: opts.entryDate,
    description: entry.description, reference: entry.reference, kind: "CORRECTION",
    lines: lines.map((l) => ({
      accountId: l.accountId, description: l.description,
      debit: l.debitBase.gt(0) ? l.txAmount.abs().toString() : null, credit: l.creditBase.gt(0) ? l.txAmount.abs().toString() : null,
      currency: l.txCurrency, rate: l.exchangeRate.toString(), rateSource: l.rateSource,
      costCenterId: l.costCenterId, projectId: l.projectId, departmentId: l.departmentId,
    })),
  });
  return { reversal, draft };
}
