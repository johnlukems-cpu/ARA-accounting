import type { z } from "zod";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { nextSequence } from "@/core/numbering";
import * as engine from "@/core/ledger/engine";
import type { LineInput } from "@/core/ledger/domain";
import { calculateLines, invoiceLedgerLines, type TaxCodeInfo } from "./domain";
import type { financialAccountSchema, invoiceSchema, offsetSchema, partySchema, paymentSchema } from "./schemas";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

async function adminFor(tx: Tx, administrationId: string) {
  const admin = await tx.administration.findUnique({ where: { id: administrationId } });
  if (!admin) throw new UserError("errors.notFound");
  return admin;
}

function uniqueError(err: unknown, key = "errors.codeTaken"): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserError(key);
  if (err instanceof Prisma.PrismaClientUnknownRequestError && /invoice_purchase_external_unique/.test(err.message)) throw new UserError("invoicing.duplicateSupplierInvoice");
  throw err;
}

// ───────────── Parties ─────────────

export async function saveParty(access: Access, input: z.infer<typeof partySchema>, id?: string) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, input.isCustomer ? "sales.create" : "purchase.create", admin.companyId);
    try {
      if (id) {
        const existing = await tx.party.findUnique({ where: { id } });
        if (!existing || existing.administrationId !== admin.id) throw new UserError("errors.notFound");
        const party = await tx.party.update({ where: { id }, data: { ...input, administrationId: undefined } });
        await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "party.updated", entity: "Party", entityId: id, details: { name: input.name } });
        return party;
      }
      const party = await tx.party.create({ data: { ...input, organizationId: access.organizationId, code: input.code.toUpperCase() } });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "party.created", entity: "Party", entityId: party.id, details: { code: party.code, name: party.name } });
      return party;
    } catch (err) {
      if (err instanceof UserError) throw err;
      uniqueError(err);
    }
  });
}

// ───────────── Bank and cash accounts ─────────────

export async function createFinancialAccount(access: Access, input: z.infer<typeof financialAccountSchema>) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "administrations.edit", admin.companyId);
    const headerNumber = input.kind === "BANK" ? "1100" : "1000";
    const header = await tx.account.findFirst({ where: { administrationId: admin.id, number: headerNumber, type: "HEADER" } });
    // Next free account number under the header (1101…, 1040…).
    const prefix = input.kind === "BANK" ? 1101 : 1040;
    const used = new Set((await tx.account.findMany({ where: { administrationId: admin.id }, select: { number: true } })).map((a) => a.number));
    let n = prefix;
    while (used.has(String(n))) n++;
    const label = input.kind === "BANK" ? `${input.name}${input.accountNumber ? ` ${input.accountNumber}` : ""} (${input.currency})` : `${input.name} (${input.currency})`;
    const account = await tx.account.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, number: String(n), name: label, category: "ASSET", type: "DETAIL",
        parentId: header?.id ?? null, normalBalance: "DEBIT", controlType: input.kind === "BANK" ? "BANK" : "CASH", currency: input.currency,
      },
    });
    // The standard BNK/KAS journal is used for the first account of its kind; further accounts get their own journal.
    const standardCode = input.kind === "BANK" ? "BNK" : "KAS";
    const standard = await tx.journal.findFirst({ where: { administrationId: admin.id, code: standardCode } });
    const standardUsed = standard ? await tx.financialAccount.count({ where: { journalId: standard.id } }) : 1;
    let journalId = standard?.id;
    if (!standard || standardUsed > 0) {
      let code = `${input.kind === "BANK" ? "B" : "K"}${String(n).slice(-2)}`;
      while (await tx.journal.findFirst({ where: { administrationId: admin.id, code } })) code = `${code}X`;
      journalId = (await tx.journal.create({ data: { organizationId: access.organizationId, administrationId: admin.id, code, name: label, type: input.kind === "BANK" ? "BANK" : "CASH" } })).id;
    }
    try {
      const fa = await tx.financialAccount.create({
        data: { organizationId: access.organizationId, administrationId: admin.id, kind: input.kind, name: input.name, bankCode: input.bankCode ?? null, accountNumber: input.accountNumber ?? null, currency: input.currency, ledgerAccountId: account.id, journalId: journalId! },
      });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "financialAccount.created", entity: "FinancialAccount", entityId: fa.id, details: { name: label, ledger: account.number } });
      return fa;
    } catch (err) {
      uniqueError(err);
    }
  });
}

// ───────────── Invoices ─────────────

type InvoiceInput = z.infer<typeof invoiceSchema>;

async function taxCodeMap(tx: Tx, administrationId: string) {
  const codes = await tx.taxCode.findMany({ where: { administrationId } });
  return new Map<string, TaxCodeInfo & { status: string; direction: string }>(codes.map((c) => [c.id, { id: c.id, rate: c.rate.toString(), deductiblePct: c.deductiblePct.toString(), outputAccountId: c.outputAccountId, inputAccountId: c.inputAccountId, status: c.status, direction: c.direction }]));
}

/** Validates and saves a draft invoice (create or replace). Posted invoices are immutable. */
export async function saveInvoice(access: Access, input: InvoiceInput) {
  return withTenant(scope(access), async (tx) => {
    const admin = await adminFor(tx, input.administrationId);
    const area = input.type === "SALES" ? "sales" : "purchase";
    assertCan(access, `${area}.${input.id ? "edit" : "create"}` as "sales.create", admin.companyId);
    const party = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!party || party.administrationId !== admin.id || party.status !== "ACTIVE") throw new UserError("invoicing.invalidParty");
    if (input.type === "SALES" ? !party.isCustomer : !party.isSupplier) throw new UserError("invoicing.invalidParty");
    if (input.dueDate < input.invoiceDate) throw new UserError("invoicing.dueBeforeDate");
    if (input.type === "PURCHASE" && !input.externalNumber) throw new UserError("invoicing.externalNumberRequired");

    const rate = input.currency === admin.baseCurrency ? "1" : input.exchangeRate;
    if (!rate || !(Number(rate) > 0)) throw new UserError("invoicing.rateRequired", { currency: input.currency });

    const codes = await taxCodeMap(tx, admin.id);
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, administrationId: admin.id, type: "DETAIL", status: "ACTIVE" } });
    if (accounts.length !== accountIds.length) throw new UserError("ledger.accountNotPostable", { line: "", account: "" });
    for (const l of input.lines) {
      if (l.taxCodeId) {
        const c = codes.get(l.taxCodeId);
        if (!c || c.status !== "ACTIVE" || (c.direction !== "BOTH" && c.direction !== input.type)) throw new UserError("invoicing.invalidTaxCode");
      }
    }
    const calc = calculateLines(input.lines, codes);
    const sign = new Decimal(calc.gross);
    if (!sign.gt(0)) throw new UserError("invoicing.totalMustBePositive");

    let credits: string | null = null;
    if (input.kind === "CREDIT_NOTE" && input.creditsInvoiceId) {
      const orig = await tx.invoice.findUnique({ where: { id: input.creditsInvoiceId } });
      if (!orig || orig.administrationId !== admin.id || orig.partyId !== party.id || orig.type !== input.type || orig.kind !== "INVOICE") throw new UserError("invoicing.invalidCreditedInvoice");
      credits = orig.id;
    }
    const data = {
      partyId: party.id, kind: input.kind, externalNumber: input.externalNumber ?? null, invoiceDate: toDate(input.invoiceDate), dueDate: toDate(input.dueDate),
      currency: input.currency, exchangeRate: rate, rateSource: input.currency === admin.baseCurrency ? "IDENTITY" : "MANUAL",
      description: input.description ?? null, notes: input.notes ?? null, creditsInvoiceId: credits,
      netAmount: calc.net, taxAmount: calc.tax, grossAmount: calc.gross, grossBase: new Decimal(calc.gross).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    };
    const lineRows = (invoiceId: string) => calc.lines.map((l) => ({
      organizationId: access.organizationId, invoiceId, lineNo: l.lineNo, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
      discountPct: l.discountPct || "0", netAmount: l.netAmount, taxCodeId: l.taxCodeId || null, taxRate: l.taxRate, taxAmount: l.taxAmount,
      accountId: l.accountId, costCenterId: l.costCenterId || null, projectId: l.projectId || null,
    }));
    try {
      if (input.id) {
        const existing = await tx.invoice.findUnique({ where: { id: input.id } });
        if (!existing || existing.administrationId !== admin.id || existing.type !== input.type) throw new UserError("errors.notFound");
        if (!["DRAFT", "REVIEW", "APPROVED"].includes(existing.status)) throw new UserError("invoicing.postedImmutable");
        await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
        const inv = await tx.invoice.update({ where: { id: existing.id }, data: { ...data, status: "DRAFT", approvedById: null, approvedAt: null } });
        await tx.invoiceLine.createMany({ data: lineRows(inv.id) });
        await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.updated", entity: "Invoice", entityId: inv.id, details: { gross: calc.gross, currency: input.currency } });
        return inv;
      }
      const inv = await tx.invoice.create({ data: { ...data, organizationId: access.organizationId, administrationId: admin.id, type: input.type, createdById: access.userId } });
      await tx.invoiceLine.createMany({ data: lineRows(inv.id) });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.created", entity: "Invoice", entityId: inv.id, details: { type: input.type, kind: input.kind, gross: calc.gross, currency: input.currency } });
      return inv;
    } catch (err) {
      if (err instanceof UserError) throw err;
      uniqueError(err, "invoicing.duplicateSupplierInvoice");
    }
  });
}

async function loadInvoice(tx: Tx, id: string) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, party: true } });
  if (!inv) throw new UserError("errors.notFound");
  const admin = await adminFor(tx, inv.administrationId);
  return { inv, admin };
}

/** Purchase invoices: DRAFT → REVIEW (submitted for approval). */
export async function submitInvoice(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { inv, admin } = await loadInvoice(tx, id);
    assertCan(access, inv.type === "SALES" ? "sales.create" : "purchase.create", admin.companyId);
    if (inv.status !== "DRAFT") throw new UserError("ledger.wrongStatus");
    await tx.invoice.update({ where: { id }, data: { status: "REVIEW" } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.submitted", entity: "Invoice", entityId: id });
  });
}

/** Approval with segregation of duties (the creator cannot approve). */
export async function approveInvoice(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { inv, admin } = await loadInvoice(tx, id);
    assertCan(access, inv.type === "SALES" ? "sales.approve" : "purchase.approve", admin.companyId);
    if (inv.status !== "REVIEW" && inv.status !== "DRAFT") throw new UserError("ledger.wrongStatus");
    const segregation = (admin.settings as { segregationOfDuties?: boolean })?.segregationOfDuties !== false;
    if (segregation && inv.createdById === access.userId) throw new UserError("ledger.segregation");
    await tx.invoice.update({ where: { id }, data: { status: "APPROVED", approvedById: access.userId, approvedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.approved", entity: "Invoice", entityId: id });
  });
}

export function purchaseApprovalRequired(settings: unknown): boolean {
  return (settings as { purchaseApproval?: boolean })?.purchaseApproval !== false;
}

/**
 * Posts an invoice: number (sales: gapless per fiscal year), journal entry via the engine, open item — one transaction.
 * Purchase invoices must be APPROVED first unless the administration turned purchase approval off.
 */
export async function postInvoice(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { inv, admin } = await loadInvoice(tx, id);
    const sales = inv.type === "SALES";
    assertCan(access, sales ? "sales.post" : "purchase.post", admin.companyId);
    if (!["DRAFT", "REVIEW", "APPROVED"].includes(inv.status)) throw new UserError("ledger.alreadyPosted");
    if (!sales && purchaseApprovalRequired(admin.settings) && inv.status !== "APPROVED") throw new UserError("invoicing.approvalRequired");

    const control = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: sales ? "RECEIVABLE" : "PAYABLE", type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" } });
    if (!control) throw new UserError("invoicing.noControlAccount");
    const journal = await tx.journal.findFirst({ where: { administrationId: admin.id, type: sales ? "SALES" : "PURCHASE", status: "ACTIVE" }, orderBy: { code: "asc" } });
    if (!journal) throw new UserError("ledger.invalidJournal");
    const fy = await tx.fiscalYear.findFirst({ where: { administrationId: admin.id, startDate: { lte: inv.invoiceDate }, endDate: { gte: inv.invoiceDate } } });
    if (!fy) throw new UserError("ledger.noFiscalYear");

    const scopeName = `${inv.type}_${inv.kind}`;
    const seq = await nextSequence(tx, access.organizationId, scopeName, admin.id, fy.id);
    const prefix = sales ? (inv.kind === "INVOICE" ? "VF" : "VC") : inv.kind === "INVOICE" ? "IF" : "IC";
    const number = `${prefix}${fy.code.replace("/", "")}-${String(seq).padStart(5, "0")}`;

    const codes = await taxCodeMap(tx, admin.id);
    const calc = calculateLines(
      inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId, costCenterId: l.costCenterId, projectId: l.projectId })),
      // Use the rate snapshotted on each line (rates may change later; the invoice keeps its own).
      new Map(inv.lines.filter((l) => l.taxCodeId).map((l) => [l.taxCodeId!, { ...codes.get(l.taxCodeId!)!, rate: l.taxRate.toString() }])),
    );
    const description = `${number} ${inv.party.name}${inv.externalNumber ? ` (${inv.externalNumber})` : ""}`;
    const lines = invoiceLedgerLines({
      type: inv.type, kind: inv.kind, currency: inv.currency === admin.baseCurrency ? admin.baseCurrency : inv.currency, rate: inv.exchangeRate.toString(),
      controlAccountId: control.id, partyId: inv.partyId, description, lines: calc.lines, taxCodes: codes,
    });
    const entry = await engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: journal.id, entryDate: iso(inv.invoiceDate), documentDate: iso(inv.invoiceDate),
      description, reference: inv.externalNumber ?? number, lines, sourceType: sales ? "SALES_INVOICE" : "PURCHASE_INVOICE", sourceId: inv.id, idempotencyKey: `invoice:${inv.id}`,
    });

    // Open item: positive amount = claim (sales invoice) or debt (purchase invoice); credit notes negative.
    const amount = new Decimal(inv.grossAmount.toString()).times(inv.kind === "CREDIT_NOTE" ? -1 : 1).toFixed(2);
    await tx.openItem.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, partyId: inv.partyId, side: sales ? "RECEIVABLE" : "PAYABLE",
        sourceType: "INVOICE", sourceId: inv.id, documentNumber: inv.externalNumber && !sales ? `${number} / ${inv.externalNumber}` : number,
        description: inv.description, date: inv.invoiceDate, dueDate: inv.dueDate, currency: inv.currency, originalAmount: amount, remainingAmount: amount,
        originalRate: inv.exchangeRate, ledgerAccountId: control.id,
      },
    });
    const posted = await tx.invoice.update({ where: { id }, data: { status: "POSTED", number, entryId: entry.id, postedById: access.userId, postedAt: new Date() } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.posted", entity: "Invoice", entityId: id, details: { number, entryId: entry.id, gross: inv.grossAmount.toString(), currency: inv.currency } });
    return posted;
  }, { timeout: 30_000 });
}

export async function deleteDraftInvoice(access: Access, id: string) {
  return withTenant(scope(access), async (tx) => {
    const { inv, admin } = await loadInvoice(tx, id);
    assertCan(access, inv.type === "SALES" ? "sales.edit" : "purchase.edit", admin.companyId);
    if (!["DRAFT", "REVIEW", "APPROVED"].includes(inv.status)) throw new UserError("invoicing.postedImmutable");
    await tx.invoice.delete({ where: { id } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.deleted", entity: "Invoice", entityId: id, details: { gross: inv.grossAmount.toString() } });
  });
}

/** Creates a draft credit note with the same lines as a posted invoice. */
export async function createCreditNoteDraft(access: Access, id: string) {
  const { inv } = await withTenant(scope(access), (tx) => loadInvoice(tx, id));
  if (inv.kind !== "INVOICE" || !["POSTED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) throw new UserError("invoicing.creditOnlyPosted");
  const today = iso(new Date());
  return saveInvoice(access, {
    administrationId: inv.administrationId, type: inv.type, kind: "CREDIT_NOTE", partyId: inv.partyId, externalNumber: inv.type === "PURCHASE" ? `CN-${inv.externalNumber ?? inv.number}` : undefined,
    invoiceDate: today, dueDate: today, currency: inv.currency, exchangeRate: inv.exchangeRate.toString(), description: `Creditnota voor ${inv.number}`, creditsInvoiceId: inv.id,
    lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId ?? undefined, costCenterId: l.costCenterId ?? undefined, projectId: l.projectId ?? undefined })),
  });
}

export async function markInvoiceSent(access: Access, id: string, to: string) {
  return withTenant(scope(access), async (tx) => {
    const { inv, admin } = await loadInvoice(tx, id);
    assertCan(access, "sales.post", admin.companyId);
    await tx.invoice.update({ where: { id }, data: { sentAt: new Date(), sentTo: to } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "invoice.sent", entity: "Invoice", entityId: inv.id, details: { to } });
  });
}

// ───────────── Payments and allocation ─────────────

async function refreshInvoiceStatus(tx: Tx, openItemId: string) {
  const item = await tx.openItem.findUniqueOrThrow({ where: { id: openItemId } });
  if (item.sourceType !== "INVOICE") return;
  const status = item.remainingAmount.isZero() ? "PAID" : item.remainingAmount.equals(item.originalAmount) ? "POSTED" : "PARTIALLY_PAID";
  await tx.invoice.update({ where: { id: item.sourceId }, data: { status } });
}

async function settle(tx: Tx, itemId: string, amount: Decimal) {
  const item = await tx.openItem.findUniqueOrThrow({ where: { id: itemId } });
  const remaining = new Decimal(item.remainingAmount.toString());
  const sign = remaining.lt(0) ? -1 : 1;
  const next = remaining.minus(amount.times(sign));
  if (next.times(sign).lt(0)) throw new UserError("invoicing.overAllocation", { document: item.documentNumber });
  await tx.openItem.update({ where: { id: itemId }, data: { remainingAmount: next.toFixed(2), status: next.isZero() ? "SETTLED" : "OPEN" } });
  await refreshInvoiceStatus(tx, itemId);
}

/**
 * Registers a payment received (IN) or made (OUT) on a bank/cash account and allocates it to open items.
 * Journal: IN = Dr bank / Cr receivable(s); OUT = Dr payable(s) / Cr bank. Items are cleared at their original
 * rate; a difference with the payment rate is a realised exchange difference (ACCOUNTING_RULES C4).
 * An unallocated remainder stays open as a payment on account, so the control account always matches the sub-ledger.
 */
export async function registerPayment(access: Access, input: z.infer<typeof paymentSchema>) {
  return withTenant(scope(access), (tx) => registerPaymentInTx(tx, access, input), { timeout: 30_000 });
}

/** Same as registerPayment, inside an existing tenant transaction (used by bank matching). */
export async function registerPaymentInTx(tx: Tx, access: Access, input: z.infer<typeof paymentSchema>) {
  {
    const admin = await adminFor(tx, input.administrationId);
    assertCan(access, "banking.post", admin.companyId);
    if (input.idempotencyKey) {
      const existing = await tx.payment.findUnique({ where: { administrationId_idempotencyKey: { administrationId: admin.id, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
    }
    const fa = await tx.financialAccount.findUnique({ where: { id: input.financialAccountId } });
    if (!fa || fa.administrationId !== admin.id || fa.status !== "ACTIVE") throw new UserError("invoicing.invalidFinancialAccount");
    const rate = fa.currency === admin.baseCurrency ? "1" : input.exchangeRate;
    if (!rate || !(Number(rate) > 0)) throw new UserError("invoicing.rateRequired", { currency: fa.currency });
    const side = input.direction === "IN" ? "RECEIVABLE" : "PAYABLE";

    const amount = new Decimal(input.amount);
    const items = await tx.openItem.findMany({ where: { id: { in: input.allocations.map((a) => a.openItemId) } } });
    let allocated = new Decimal(0);
    let partyId = input.partyId ?? null;
    for (const a of input.allocations) {
      const item = items.find((i) => i.id === a.openItemId);
      if (!item || item.administrationId !== admin.id || item.side !== side || item.status !== "OPEN") throw new UserError("invoicing.invalidOpenItem");
      if (item.currency !== fa.currency) throw new UserError("invoicing.currencyMismatch", { item: item.currency, account: fa.currency });
      if (new Decimal(item.remainingAmount.toString()).lt(0)) throw new UserError("invoicing.invalidOpenItem");
      partyId ??= item.partyId;
      if (item.partyId !== partyId) throw new UserError("invoicing.partyMismatch");
      allocated = allocated.plus(a.amount);
    }
    if (allocated.gt(amount)) throw new UserError("invoicing.allocationExceedsPayment");
    const party = partyId ? await tx.party.findUnique({ where: { id: partyId } }) : null;
    if (partyId && (!party || party.administrationId !== admin.id)) throw new UserError("invoicing.invalidParty");
    const unallocated = amount.minus(allocated);
    if (!unallocated.isZero() && !party) throw new UserError("invoicing.unallocatedNeedsParty");

    const control = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: side, type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" } });
    const fxAccount = await tx.account.findFirst({ where: { administrationId: admin.id, controlType: "FX_RESULT", type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" } });
    if (!control) throw new UserError("invoicing.noControlAccount");
    const inflow = input.direction === "IN";
    const fx = (cur: string, r: string) => (cur === admin.baseCurrency ? {} : { currency: cur, rate: r });
    const lines: LineInput[] = [];
    // Bank/cash line at the payment rate.
    lines.push({ accountId: fa.ledgerAccountId, description: input.description ?? input.reference ?? null, ...(inflow ? { debit: amount.toFixed(2) } : { credit: amount.toFixed(2) }), ...fx(fa.currency, rate) });
    let fxDiffBase = new Decimal(0);
    for (const a of input.allocations) {
      const item = items.find((i) => i.id === a.openItemId)!;
      const amt = new Decimal(a.amount);
      lines.push({ accountId: item.ledgerAccountId, description: item.documentNumber, ...(inflow ? { credit: amt.toFixed(2) } : { debit: amt.toFixed(2) }), ...fx(item.currency, item.originalRate.toString()), partyId: item.partyId });
      if (item.currency !== admin.baseCurrency) {
        const atPayment = amt.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const atItem = amt.times(item.originalRate.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        fxDiffBase = fxDiffBase.plus(atPayment.minus(atItem));
      }
    }
    if (!unallocated.isZero()) {
      lines.push({ accountId: control.id, description: `Vooruitbetaling / niet toegewezen`, ...(inflow ? { credit: unallocated.toFixed(2) } : { debit: unallocated.toFixed(2) }), ...fx(fa.currency, rate), partyId });
    }
    if (!fxDiffBase.isZero()) {
      if (!fxAccount) throw new UserError("invoicing.noFxAccount");
      // IN: bank received more SRD than the receivable carried → gain (credit). OUT: paid more SRD → loss (debit).
      const gain = inflow ? fxDiffBase.gt(0) : fxDiffBase.lt(0);
      lines.push({ accountId: fxAccount.id, description: "Gerealiseerd koersverschil", ...(gain ? { credit: fxDiffBase.abs().toFixed(2) } : { debit: fxDiffBase.abs().toFixed(2) }) });
    }

    const payment = await tx.payment.create({
      data: {
        organizationId: access.organizationId, administrationId: admin.id, direction: input.direction, partyId, financialAccountId: fa.id, date: toDate(input.date),
        currency: fa.currency, amount: amount.toFixed(2), exchangeRate: rate, reference: input.reference ?? null, description: input.description ?? null,
        bankTransactionId: input.bankTransactionId ?? null, idempotencyKey: input.idempotencyKey ?? null, createdById: access.userId,
      },
    });
    const entry = await engine.createAndPost(tx, access, {
      administrationId: admin.id, journalId: fa.journalId, entryDate: input.date, description: `${inflow ? "Ontvangst" : "Betaling"}${party ? ` ${party.name}` : ""}${input.reference ? ` — ${input.reference}` : ""}`,
      reference: input.reference ?? null, lines, sourceType: "PAYMENT", sourceId: payment.id, idempotencyKey: `payment:${payment.id}`,
    });
    await tx.payment.update({ where: { id: payment.id }, data: { entryId: entry.id } });
    for (const a of input.allocations) {
      await tx.allocation.create({ data: { organizationId: access.organizationId, openItemId: a.openItemId, paymentId: payment.id, amount: a.amount, createdById: access.userId } });
      await settle(tx, a.openItemId, new Decimal(a.amount));
    }
    if (!unallocated.isZero()) {
      // Payment on account: a negative item on the party's side (credit balance for a customer).
      const neg = unallocated.negated().toFixed(2);
      await tx.openItem.create({
        data: {
          organizationId: access.organizationId, administrationId: admin.id, partyId, side, sourceType: "PAYMENT", sourceId: payment.id,
          documentNumber: input.reference ?? `${inflow ? "Ontvangst" : "Betaling"} ${input.date}`, description: "Niet toegewezen betaling", date: toDate(input.date), dueDate: toDate(input.date),
          currency: fa.currency, originalAmount: neg, remainingAmount: neg, originalRate: rate, ledgerAccountId: control.id,
        },
      });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "payment.registered", entity: "Payment", entityId: payment.id, details: { direction: input.direction, amount: amount.toFixed(2), currency: fa.currency, allocations: input.allocations.length } });
    return payment;
  }
}

/** Offsets two open items of the same party, side and currency (e.g. a credit note against an invoice). No journal entry needed. */
export async function offsetItems(access: Access, input: z.infer<typeof offsetSchema>) {
  return withTenant(scope(access), async (tx) => {
    const [a, b] = await Promise.all([tx.openItem.findUnique({ where: { id: input.openItemId } }), tx.openItem.findUnique({ where: { id: input.counterOpenItemId } })]);
    if (!a || !b || a.administrationId !== b.administrationId || a.partyId !== b.partyId || a.side !== b.side || a.currency !== b.currency || a.status !== "OPEN" || b.status !== "OPEN") throw new UserError("invoicing.invalidOffset");
    const admin = await adminFor(tx, a.administrationId);
    assertCan(access, "banking.post", admin.companyId);
    if (new Decimal(a.remainingAmount.toString()).lt(0) === new Decimal(b.remainingAmount.toString()).lt(0)) throw new UserError("invoicing.invalidOffset");
    if (!a.originalRate.equals(b.originalRate)) throw new UserError("invoicing.offsetRateMismatch");
    const amt = new Decimal(input.amount);
    await tx.allocation.create({ data: { organizationId: access.organizationId, openItemId: a.id, counterOpenItemId: b.id, amount: amt.toFixed(2), createdById: access.userId } });
    await tx.allocation.create({ data: { organizationId: access.organizationId, openItemId: b.id, counterOpenItemId: a.id, amount: amt.toFixed(2), createdById: access.userId } });
    await settle(tx, a.id, amt);
    await settle(tx, b.id, amt);
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "openItem.offset", entity: "OpenItem", entityId: a.id, details: { counter: b.id, amount: amt.toFixed(2) } });
  });
}
