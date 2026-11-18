import { z } from "zod";
import Decimal from "decimal.js";
import type { AraSubscription, BillingInterval, Prisma } from "@prisma/client";
import { systemDb, type Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { saveInvoiceInTx } from "@/modules/invoicing/service";
import { asDate, inHome, iso, nextNumber, today } from "./common";
import { convertCustomerInTx, logActivity } from "./crm";
import type { AdminContext } from "./home";

/** Monthly-equivalent factor of a billing interval (MRR = Σ price × quantity / months). */
export const MONTHS: Record<BillingInterval, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/** Adds whole months to a date (end of month is kept: 31 Jan + 1 month = 28/29 Feb). Pure, UTC. */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

export function billingPeriod(start: Date, interval: BillingInterval) {
  const next = addMonths(start, MONTHS[interval]);
  return { periodStart: start, periodEnd: new Date(next.getTime() - 86_400_000), next };
}

export const monthlyValue = (s: Pick<AraSubscription, "unitPrice" | "quantity" | "interval">) => new Decimal(s.unitPrice.toString()).times(s.quantity.toString()).dividedBy(MONTHS[s.interval]);

const price = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "validation.amount"));

export const subscriptionSchema = z.object({
  customerId: z.string().min(1, "validation.required"),
  productId: z.string().min(1, "validation.required"),
  interval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
  unitPrice: price.optional().transform((v) => v || undefined),
  quantity: z.coerce.number().positive().max(100000).default(1),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
  planId: z.string().optional().transform((v) => v || null),
});

async function event(tx: Tx, ctx: AdminContext, s: { id: string }, type: string, details?: Record<string, unknown>) {
  await tx.subscriptionEvent.create({ data: { organizationId: ctx.home.organizationId, subscriptionId: s.id, type, details: (details ?? null) as Prisma.InputJsonValue, userId: ctx.access.userId } });
}

/**
 * Keeps the customer's ARA Accounting organisation in line with an entitlement-bearing subscription (one with a plan):
 * plan and status. Payment state never changes it — suspension is always an explicit, audited staff decision.
 */
async function syncEntitlement(ctx: AdminContext, s: AraSubscription) {
  if (!s.linkedOrganizationId || !s.planId) return;
  const status = s.status === "CANCELLED" ? "CANCELLED" : s.status === "SUSPENDED" ? "SUSPENDED" : s.status === "TRIAL" ? "TRIAL" : "ACTIVE";
  await systemDb.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: s.linkedOrganizationId! } });
    if (!org) return;
    await tx.organization.update({ where: { id: org.id }, data: { planId: s.planId, status, statusReason: s.status === "SUSPENDED" || s.status === "CANCELLED" ? (s.cancelReason ?? "ARA") : null, ...(s.status === "TRIAL" && s.trialEndsAt ? { trialEndsAt: s.trialEndsAt } : {}) } });
    await audit(tx, { organizationId: org.id, userId: ctx.access.userId, action: "platform.subscriptionChanged", entity: "Organization", entityId: org.id, details: { from: { status: org.status, planId: org.planId }, to: { status, planId: s.planId }, via: s.number } });
  });
}

export async function createSubscription(ctx: AdminContext, raw: z.input<typeof subscriptionSchema>) {
  const input = subscriptionSchema.parse(raw);
  const s = await inHome(ctx, "billing.create", async (tx) => {
    const customer = await tx.crmCustomer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new UserError("errors.notFound");
    const product = await tx.product.findFirst({ where: { id: input.productId, status: "ACTIVE" } });
    if (!product || product.billingType !== "RECURRING") throw new UserError("admin.productNotRecurring");
    const unitPrice = input.unitPrice ?? product.defaultPrice?.toString();
    if (unitPrice === undefined) throw new UserError("admin.priceRequired");
    const planId = input.planId ?? product.planId;
    if (planId && !(await systemDb.plan.findFirst({ where: { id: planId, status: "ACTIVE" } }))) throw new UserError("errors.notFound");
    const start = asDate(input.startDate);
    const trialEndsAt = input.trialDays ? new Date(start.getTime() + input.trialDays * 86_400_000) : null;
    const number = await nextNumber(tx, ctx, "ABO");
    const sub = await tx.araSubscription.create({
      data: {
        organizationId: ctx.home.organizationId, number, customerId: customer.id, productId: product.id, planId, linkedOrganizationId: customer.linkedOrganizationId,
        interval: input.interval, quantity: input.quantity, unitPrice, currency: input.currency ?? product.currency, status: trialEndsAt ? "TRIAL" : "ACTIVE",
        startDate: start, trialEndsAt, nextBillingDate: trialEndsAt ?? start, createdById: ctx.access.userId,
      },
    });
    await event(tx, ctx, sub, "CREATED", { product: product.code, price: unitPrice, interval: input.interval, trialDays: input.trialDays });
    await logActivity(tx, ctx, customer.id, "SUBSCRIPTION", `Abonnement ${number} (${product.name}) aangemaakt`, { entity: "AraSubscription", entityId: sub.id });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "subscription.created", entity: "AraSubscription", entityId: sub.id, details: { number, product: product.code, price: unitPrice, currency: sub.currency, interval: input.interval } });
    return sub;
  });
  await syncEntitlement(ctx, s);
  return s;
}

export const changeSchema = z.object({
  subscriptionId: z.string().min(1),
  productId: z.string().optional().transform((v) => v || undefined),
  planId: z.string().optional().transform((v) => v || undefined),
  interval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).optional().or(z.literal("").transform(() => undefined)),
  unitPrice: price.optional().transform((v) => v || undefined),
  quantity: z.coerce.number().positive().max(100000).optional(),
  reason: z.string().trim().min(3, "errors.reasonRequired").max(300),
});

/** Upgrade or downgrade. Takes effect from the next billing period (no pro-rating; the owner may invoice a difference manually). */
export async function changeSubscription(ctx: AdminContext, raw: z.input<typeof changeSchema>) {
  const input = changeSchema.parse(raw);
  const s = await inHome(ctx, "billing.edit", async (tx) => {
    const before = await tx.araSubscription.findUnique({ where: { id: input.subscriptionId } });
    if (!before || before.status === "CANCELLED") throw new UserError("ledger.wrongStatus");
    if (input.productId) {
      const p = await tx.product.findFirst({ where: { id: input.productId, status: "ACTIVE", billingType: "RECURRING" } });
      if (!p) throw new UserError("admin.productNotRecurring");
    }
    if (input.planId && !(await systemDb.plan.findFirst({ where: { id: input.planId, status: "ACTIVE" } }))) throw new UserError("errors.notFound");
    const after = await tx.araSubscription.update({ where: { id: before.id }, data: { productId: input.productId ?? before.productId, planId: input.planId ?? before.planId, interval: input.interval ?? before.interval, unitPrice: input.unitPrice ?? before.unitPrice, quantity: input.quantity ?? before.quantity } });
    const type = monthlyValue(after).gt(monthlyValue(before)) ? "UPGRADED" : monthlyValue(after).lt(monthlyValue(before)) ? "DOWNGRADED" : "CHANGED";
    await event(tx, ctx, after, type, { reason: input.reason, from: { product: before.productId, plan: before.planId, price: before.unitPrice.toString(), interval: before.interval, quantity: before.quantity.toString() }, to: { product: after.productId, plan: after.planId, price: after.unitPrice.toString(), interval: after.interval, quantity: after.quantity.toString() } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "subscription.changed", entity: "AraSubscription", entityId: after.id, details: { type, reason: input.reason } });
    return after;
  });
  await syncEntitlement(ctx, s);
  return s;
}

/**
 * Status changes are explicit staff decisions with a reason. Suspension is never triggered automatically by a missing,
 * pending or unverified payment.
 */
export async function setSubscriptionStatus(ctx: AdminContext, id: string, action: "ACTIVATE" | "SUSPEND" | "REACTIVATE" | "CANCEL", reason: string) {
  if (!reason?.trim()) throw new UserError("errors.reasonRequired");
  const s = await inHome(ctx, "billing.approve", async (tx) => {
    const sub = await tx.araSubscription.findUnique({ where: { id } });
    if (!sub) throw new UserError("errors.notFound");
    const allowed: Record<typeof action, string[]> = { ACTIVATE: ["TRIAL"], SUSPEND: ["ACTIVE", "TRIAL"], REACTIVATE: ["SUSPENDED"], CANCEL: ["TRIAL", "ACTIVE", "SUSPENDED"] };
    if (!allowed[action].includes(sub.status)) throw new UserError("ledger.wrongStatus");
    const status = action === "SUSPEND" ? "SUSPENDED" : action === "CANCEL" ? "CANCELLED" : "ACTIVE";
    // Activating a trial starts billing today (or at the trial end if that is later).
    const nextBillingDate = action === "ACTIVATE" ? new Date(Math.max(asDate(today()).getTime(), sub.nextBillingDate.getTime())) : sub.nextBillingDate;
    const updated = await tx.araSubscription.update({ where: { id }, data: { status, nextBillingDate, ...(action === "CANCEL" ? { cancelledAt: new Date(), cancelReason: reason.trim() } : {}), ...(action === "SUSPEND" ? { cancelReason: reason.trim() } : {}) } });
    await event(tx, ctx, updated, action === "ACTIVATE" ? "ACTIVATED" : action === "SUSPEND" ? "SUSPENDED" : action === "REACTIVATE" ? "REACTIVATED" : "CANCELLED", { reason: reason.trim() });
    await logActivity(tx, ctx, sub.customerId, "SUBSCRIPTION", `Abonnement ${sub.number}: ${status}`, { entity: "AraSubscription", entityId: id, body: reason.trim() });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "subscription.status", entity: "AraSubscription", entityId: id, details: { from: sub.status, to: status, reason: reason.trim() } });
    return updated;
  });
  await syncEntitlement(ctx, s);
  return s;
}

async function fallbackRevenue(tx: Tx, administrationId: string) {
  const a = await tx.account.findFirst({ where: { administrationId, number: { in: ["8110", "8090"] }, type: "DETAIL", status: "ACTIVE" }, orderBy: { number: "asc" } });
  if (!a) throw new UserError("admin.noRevenueAccount");
  return a.id;
}

export interface BillingRunResult {
  invoiced: { subscription: string; invoiceId: string; period: string }[];
  skipped: { subscription: string; reason: string }[];
  trialsEnded: string[];
}

/**
 * Generates the DRAFT invoices that are due (ACTIVE subscriptions whose next billing date ≤ asOf), one per period.
 * Idempotent: the period is claimed by a unique (subscription, periodStart) row in the same transaction as the invoice,
 * so a repeated or concurrent run never invoices a period twice. Trials are never billed; an ended trial is reported
 * (and recorded once) for a staff decision — it is not converted to a paid subscription automatically.
 * A run catches up at most 12 periods per subscription.
 */
export async function runBilling(ctx: AdminContext, asOf = today()): Promise<BillingRunResult> {
  const result: BillingRunResult = { invoiced: [], skipped: [], trialsEnded: [] };
  const due = await inHome(ctx, "billing.create", (tx) => tx.araSubscription.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] }, nextBillingDate: { lte: asDate(asOf) } }, orderBy: { number: "asc" } }));
  for (const sub of due) {
    if (sub.status === "TRIAL") {
      await inHome(ctx, "billing.create", async (tx) => {
        if (await tx.subscriptionEvent.findFirst({ where: { subscriptionId: sub.id, type: "TRIAL_ENDED" } })) return;
        await event(tx, ctx, sub, "TRIAL_ENDED", { trialEndsAt: sub.trialEndsAt ? iso(sub.trialEndsAt) : null });
        result.trialsEnded.push(sub.number);
      });
      continue;
    }
    for (let i = 0; i < 12; i++) {
      const done = await inHome(ctx, "billing.create", async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription-billing-${sub.id}`}))`;
        const s = await tx.araSubscription.findUniqueOrThrow({ where: { id: sub.id } });
        if (s.status !== "ACTIVE" || s.nextBillingDate > asDate(asOf)) return false;
        const { periodStart, periodEnd, next } = billingPeriod(s.nextBillingDate, s.interval);
        if (await tx.subscriptionBilling.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: s.id, periodStart } } })) {
          await tx.araSubscription.update({ where: { id: s.id }, data: { nextBillingDate: next } }); // already billed: move on
          return true;
        }
        const product = await tx.product.findUniqueOrThrow({ where: { id: s.productId } });
        const customer = await tx.crmCustomer.findUniqueOrThrow({ where: { id: s.customerId } });
        const party = customer.partyId ? customer : await convertCustomerInTx(tx, ctx, customer.id);
        const invoiceDate = iso(periodStart > asDate(asOf) ? asDate(asOf) : periodStart);
        const invoice = await saveInvoiceInTx(tx, ctx.access, {
          administrationId: ctx.home.administrationId, type: "SALES", kind: "INVOICE", partyId: party.partyId!, invoiceDate,
          dueDate: iso(new Date(asDate(invoiceDate).getTime() + customer.paymentTermDays * 86_400_000)), currency: s.currency,
          description: `${s.number} ${iso(periodStart)} – ${iso(periodEnd)}`,
          lines: [{ description: `${product.name} (${iso(periodStart)} – ${iso(periodEnd)})`, quantity: s.quantity.toString(), unitPrice: s.unitPrice.toString(), accountId: product.revenueAccountId ?? (await fallbackRevenue(tx, ctx.home.administrationId)), taxCodeId: product.taxCodeId ?? undefined }],
        });
        await tx.subscriptionBilling.create({ data: { organizationId: ctx.home.organizationId, subscriptionId: s.id, periodStart, periodEnd, invoiceId: invoice.id } });
        await tx.araSubscription.update({ where: { id: s.id }, data: { nextBillingDate: next } });
        await event(tx, ctx, s, "INVOICED", { invoiceId: invoice.id, periodStart: iso(periodStart), periodEnd: iso(periodEnd) });
        await logActivity(tx, ctx, s.customerId, "INVOICE", `Abonnementsfactuur ${s.number} ${iso(periodStart)} – ${iso(periodEnd)} (concept)`, { entity: "Invoice", entityId: invoice.id });
        await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "subscription.invoiced", entity: "AraSubscription", entityId: s.id, details: { invoiceId: invoice.id, period: `${iso(periodStart)}/${iso(periodEnd)}` } });
        result.invoiced.push({ subscription: s.number, invoiceId: invoice.id, period: `${iso(periodStart)} – ${iso(periodEnd)}` });
        return true;
      }).catch((err) => {
        result.skipped.push({ subscription: sub.number, reason: err instanceof UserError ? err.key : "error" });
        return false;
      });
      if (!done) break;
    }
  }
  return result;
}
