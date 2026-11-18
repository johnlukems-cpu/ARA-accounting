import { z } from "zod";
import Decimal from "decimal.js";
import { audit } from "@/core/audit/audit";
import { assertCan } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { registerPaymentInTx, refundOnAccountInTx } from "@/modules/invoicing/service";
import { asDate, inHome, iso, nextNumber } from "./common";
import { logActivity } from "./crm";
import type { AdminContext } from "./home";

const amount = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "validation.amount")).refine((v) => Number(v) > 0, "validation.positive");

export const paymentSchema = z.object({
  customerId: z.string().optional().transform((v) => v || null),
  method: z.enum(["BANK_TRANSFER", "CASH", "OTHER"]),
  reference: z.string().trim().max(120).optional().transform((v) => v || null),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  amount,
  financialAccountId: z.string().min(1, "validation.required"),
  exchangeRate: z.string().trim().transform((v) => v.replace(",", ".")).optional().transform((v) => v || null),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
  allocations: z.array(z.object({ invoiceId: z.string().min(1), amount })).max(50).default([]),
  source: z.enum(["STAFF", "CUSTOMER_PORTAL"]).default("STAFF"),
});

/**
 * Records a payment as PENDING: nothing is posted and no invoice changes until a finance user has verified it
 * (bank statement or counted cash) and confirms it. The payment currency is the bank/cash account's currency.
 */
export async function registerPending(ctx: AdminContext, raw: z.input<typeof paymentSchema>) {
  const input = paymentSchema.parse(raw);
  return inHome(ctx, "payments.create", async (tx) => {
    const fa = await tx.financialAccount.findUnique({ where: { id: input.financialAccountId } });
    if (!fa || fa.administrationId !== ctx.home.administrationId || fa.status !== "ACTIVE") throw new UserError("invoicing.invalidFinancialAccount");
    if ((input.method === "CASH") !== (fa.kind === "CASH")) throw new UserError("admin.methodAccountMismatch");
    const customer = input.customerId ? await tx.crmCustomer.findUnique({ where: { id: input.customerId } }) : null;
    if (input.customerId && !customer) throw new UserError("errors.notFound");
    let allocated = new Decimal(0);
    for (const a of input.allocations) {
      const inv = await tx.invoice.findUnique({ where: { id: a.invoiceId } });
      if (!inv || inv.type !== "SALES" || inv.administrationId !== ctx.home.administrationId || !["POSTED", "PARTIALLY_PAID"].includes(inv.status) || inv.partyId !== customer?.partyId || inv.currency !== fa.currency) throw new UserError("admin.invalidAllocation");
      allocated = allocated.plus(a.amount);
    }
    if (allocated.gt(input.amount)) throw new UserError("invoicing.allocationExceedsPayment");
    const number = await nextNumber(tx, ctx, "BET", Number(input.paymentDate.slice(0, 4)));
    const p = await tx.araPayment.create({
      data: {
        organizationId: ctx.home.organizationId, number, customerId: customer?.id ?? null, method: input.method, reference: input.reference, paymentDate: asDate(input.paymentDate),
        currency: fa.currency, amount: input.amount, financialAccountId: fa.id, exchangeRate: input.exchangeRate, notes: input.notes, source: input.source, createdById: ctx.access.userId,
        allocations: { create: input.allocations.map((a) => ({ organizationId: ctx.home.organizationId, invoiceId: a.invoiceId, amount: a.amount })) },
      },
    });
    if (customer) await logActivity(tx, ctx, customer.id, "PAYMENT", `Betaling ${number} geregistreerd (in afwachting van bevestiging)`, { entity: "AraPayment", entityId: p.id });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "araPayment.registered", entity: "AraPayment", entityId: p.id, details: { number, amount: input.amount, currency: fa.currency, method: input.method, allocations: input.allocations.length } });
    return p;
  });
}

/**
 * Confirms a verified payment: posts it through the accounting engine (Dr bank/cash, Cr receivable per invoice, the
 * remainder as a payment on account) and applies the allocations. Idempotent per payment.
 */
export async function confirmPayment(ctx: AdminContext, id: string, verification: string) {
  if (!verification?.trim()) throw new UserError("admin.verificationRequired");
  assertCan(ctx.access, "banking.post", ctx.home.companyId);
  return inHome(ctx, "payments.approve", async (tx) => {
    const p = await tx.araPayment.findUnique({ where: { id }, include: { allocations: true } });
    if (!p) throw new UserError("errors.notFound");
    if (p.status !== "PENDING") throw new UserError("ledger.wrongStatus");
    const customer = p.customerId ? await tx.crmCustomer.findUnique({ where: { id: p.customerId } }) : null;
    const allocations = [];
    for (const a of p.allocations) {
      const item = await tx.openItem.findFirst({ where: { sourceType: "INVOICE", sourceId: a.invoiceId, status: "OPEN" } });
      if (!item) throw new UserError("admin.invoiceNoLongerOpen");
      allocations.push({ openItemId: item.id, amount: a.amount.toFixed(2) });
    }
    const ledger = await registerPaymentInTx(tx, ctx.access, {
      administrationId: ctx.home.administrationId, direction: "IN", financialAccountId: p.financialAccountId, partyId: customer?.partyId ?? undefined,
      date: iso(p.paymentDate), amount: p.amount.toFixed(2), exchangeRate: p.exchangeRate ?? undefined, reference: p.reference ?? p.number, description: `${p.number} — ${verification.trim()}`,
      idempotencyKey: `ara-payment:${p.id}`, allocations,
    });
    await tx.araPaymentAllocation.updateMany({ where: { paymentId: p.id }, data: { applied: true } });
    const confirmed = await tx.araPayment.update({ where: { id }, data: { status: "CONFIRMED", ledgerPaymentId: ledger.id, confirmedById: ctx.access.userId, confirmedAt: new Date(), notes: [p.notes, `Verificatie: ${verification.trim()}`].filter(Boolean).join("\n") } });
    if (p.customerId) await logActivity(tx, ctx, p.customerId, "PAYMENT", `Betaling ${p.number} bevestigd`, { entity: "AraPayment", entityId: id, body: verification.trim() });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "araPayment.confirmed", entity: "AraPayment", entityId: id, details: { number: p.number, amount: p.amount.toFixed(2), currency: p.currency, ledgerPaymentId: ledger.id, verification: verification.trim() } });
    return confirmed;
  });
}

export async function failPayment(ctx: AdminContext, id: string, reason: string) {
  if (!reason?.trim()) throw new UserError("errors.reasonRequired");
  return inHome(ctx, "payments.approve", async (tx) => {
    const p = await tx.araPayment.findUnique({ where: { id } });
    if (!p || p.status !== "PENDING") throw new UserError("ledger.wrongStatus");
    const updated = await tx.araPayment.update({ where: { id }, data: { status: "FAILED", failureReason: reason.trim() } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "araPayment.failed", entity: "AraPayment", entityId: id, details: { number: p.number, reason: reason.trim() } });
    return updated;
  });
}

/** Unallocated part of a confirmed payment (its payment-on-account item in the ledger). */
export async function unallocated(tx: Parameters<Parameters<typeof inHome>[2]>[0], ledgerPaymentId: string | null) {
  if (!ledgerPaymentId) return { item: null, amount: new Decimal(0) };
  const item = await tx.openItem.findFirst({ where: { sourceType: "PAYMENT", sourceId: ledgerPaymentId } });
  return { item, amount: item && item.status === "OPEN" ? new Decimal(item.remainingAmount.toString()).abs() : new Decimal(0) };
}

/** Allocates (part of) the unallocated remainder of a confirmed payment to an open invoice of the same customer. */
export async function allocateRemainder(ctx: AdminContext, id: string, invoiceId: string, amountRaw: string) {
  const amt = amount.parse(amountRaw);
  assertCan(ctx.access, "banking.post", ctx.home.companyId);
  return inHome(ctx, "payments.approve", async (tx) => {
    const p = await tx.araPayment.findUnique({ where: { id } });
    if (!p || p.status !== "CONFIRMED") throw new UserError("ledger.wrongStatus");
    const { item } = await unallocated(tx, p.ledgerPaymentId);
    const invItem = await tx.openItem.findFirst({ where: { sourceType: "INVOICE", sourceId: invoiceId, status: "OPEN" } });
    if (!item || !invItem || item.partyId !== invItem.partyId) throw new UserError("admin.invalidAllocation");
    const { offsetItemsInTx } = await import("@/modules/invoicing/service");
    await offsetItemsInTx(tx, ctx.access, { openItemId: invItem.id, counterOpenItemId: item.id, amount: amt });
    await tx.araPaymentAllocation.create({ data: { organizationId: ctx.home.organizationId, paymentId: p.id, invoiceId, amount: amt, applied: true } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "araPayment.allocated", entity: "AraPayment", entityId: id, details: { invoiceId, amount: amt } });
  });
}

/** Refunds the unallocated remainder (or part of it) to the customer from a bank/cash account. */
export async function refundPayment(ctx: AdminContext, id: string, input: { financialAccountId: string; date: string; amount: string; reason: string }) {
  if (!input.reason?.trim()) throw new UserError("errors.reasonRequired");
  const amt = amount.parse(input.amount);
  assertCan(ctx.access, "banking.post", ctx.home.companyId);
  return inHome(ctx, "payments.approve", async (tx) => {
    const p = await tx.araPayment.findUnique({ where: { id } });
    if (!p || p.status !== "CONFIRMED") throw new UserError("ledger.wrongStatus");
    const { item, amount: open } = await unallocated(tx, p.ledgerPaymentId);
    if (!item || open.lt(amt)) throw new UserError("admin.refundExceedsUnallocated");
    const refund = await refundOnAccountInTx(tx, ctx.access, { openItemId: item.id, financialAccountId: input.financialAccountId, date: input.date, amount: amt, reference: `${p.number} terugbetaling` });
    const full = new Decimal(amt).equals(p.amount.toString());
    await tx.araPayment.update({ where: { id }, data: { ...(full ? { status: "REFUNDED", refundedAt: new Date() } : {}), refundLedgerPaymentId: refund.id, refundReason: input.reason.trim() } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "araPayment.refunded", entity: "AraPayment", entityId: id, details: { amount: amt, reason: input.reason.trim(), ledgerPaymentId: refund.id } });
  });
}
