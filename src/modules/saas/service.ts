import Decimal from "decimal.js";
import type { Organization, Prisma } from "@prisma/client";
import { z } from "zod";
import { systemDb, type Tx } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";

/**
 * Subscriptions and entitlements. Plans, prices, limits and the trial length are business decisions of the platform
 * owner: they are data (Plan) and configuration (TRIAL_DAYS), never hard-coded amounts.
 */
export const LIMIT_KEYS = ["companies", "administrations", "users", "documentsPerMonth"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Partial<Record<LimitKey, number>>;

export const trialDays = () => {
  const n = Number(process.env.TRIAL_DAYS ?? 30);
  return Number.isInteger(n) && n > 0 && n <= 365 ? n : 30;
};

/** Read-only when suspended or cancelled, or when the trial has ended without a plan. */
export function accessState(org: Pick<Organization, "status" | "trialEndsAt" | "planId">, now = new Date()) {
  if (org.status === "SUSPENDED" || org.status === "CANCELLED") return { readOnly: true, reason: org.status };
  if (org.status === "TRIAL" && org.trialEndsAt && org.trialEndsAt < now && !org.planId) return { readOnly: true, reason: "TRIAL_ENDED" };
  return { readOnly: false, reason: null };
}

export function assertWritable(org: Pick<Organization, "status" | "trialEndsAt" | "planId">) {
  const s = accessState(org);
  if (s.readOnly) throw new UserError("saas.readOnly", { reason: s.reason! });
}

export async function usage(tx: Tx | typeof systemDb, organizationId: string) {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [companies, administrations, users, documentsPerMonth] = await Promise.all([
    tx.company.count({ where: { organizationId, status: "ACTIVE" } }),
    tx.administration.count({ where: { organizationId, status: { not: "ARCHIVED" } } }),
    tx.organizationMembership.count({ where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } } }),
    tx.document.count({ where: { organizationId, kind: "PURCHASE", createdAt: { gte: monthStart } } }),
  ]);
  return { companies, administrations, users, documentsPerMonth } satisfies Record<LimitKey, number>;
}

async function limitsOf(tx: Tx, organizationId: string): Promise<Limits> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!org.planId) return {};
  const plan = await tx.plan.findUnique({ where: { id: org.planId } });
  return (plan?.limits as Limits) ?? {};
}

/** Entitlement check before creating something that counts against the plan. */
export async function assertLimit(tx: Tx, organizationId: string, key: LimitKey, adding = 1) {
  const limit = (await limitsOf(tx, organizationId))[key];
  if (limit === undefined || limit === null) return;
  const used = (await usage(tx, organizationId))[key];
  if (used + adding > limit) throw new UserError("saas.limitReached", { what: key, limit });
}

// ───────────── Platform administration (platform admins only; trusted system code) ─────────────

async function platformAdmin(userId: string) {
  const user = await systemDb.user.findUnique({ where: { id: userId } });
  if (!user?.isPlatformAdmin || !user.isActive) throw new UserError("errors.forbidden");
  return user;
}

const limitNumber = z.union([z.literal("").transform(() => undefined), z.coerce.number().int().min(0).max(100000)]).optional();
export const planSchema = z.object({
  id: z.string().optional().transform((v) => v || undefined),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(80),
  description: z.string().trim().max(500).optional(),
  companies: limitNumber, administrations: limitNumber, users: limitNumber, documentsPerMonth: limitNumber,
  priceMonthlySrd: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "validation.amount")).optional().transform((v) => v || null),
  priceMonthlyUsd: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "validation.amount")).optional().transform((v) => v || null),
  status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
});

export async function savePlan(userId: string, raw: z.input<typeof planSchema>) {
  await platformAdmin(userId);
  const p = planSchema.parse(raw);
  const limits: Limits = Object.fromEntries(LIMIT_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]!]));
  const data = { code: p.code, name: p.name, description: p.description || null, limits: limits as Prisma.InputJsonValue, priceMonthlySrd: p.priceMonthlySrd, priceMonthlyUsd: p.priceMonthlyUsd, status: p.status };
  return systemDb.$transaction(async (tx) => {
    if (await tx.plan.findFirst({ where: { code: p.code, ...(p.id ? { id: { not: p.id } } : {}) } })) throw new UserError("errors.codeTaken");
    const plan = p.id ? await tx.plan.update({ where: { id: p.id }, data }) : await tx.plan.create({ data });
    await audit(tx, { organizationId: null, userId, action: p.id ? "platform.planUpdated" : "platform.planCreated", entity: "Plan", entityId: plan.id, details: { code: plan.code, limits, priceMonthlySrd: p.priceMonthlySrd, priceMonthlyUsd: p.priceMonthlyUsd } });
    return plan;
  });
}

export const subscriptionSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().optional().transform((v) => v || null),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]),
  trialEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  reason: z.string().trim().max(300).optional(),
});

export async function setSubscription(userId: string, raw: z.input<typeof subscriptionSchema>) {
  await platformAdmin(userId);
  const input = subscriptionSchema.parse(raw);
  if ((input.status === "SUSPENDED" || input.status === "CANCELLED") && !input.reason?.trim()) throw new UserError("errors.reasonRequired");
  return systemDb.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (!org) throw new UserError("errors.notFound");
    if (input.planId && !(await tx.plan.findFirst({ where: { id: input.planId, status: "ACTIVE" } }))) throw new UserError("errors.notFound");
    const updated = await tx.organization.update({ where: { id: org.id }, data: { planId: input.planId, status: input.status, trialEndsAt: input.trialEndsAt ? new Date(`${input.trialEndsAt}T23:59:59Z`) : org.trialEndsAt, statusReason: input.reason?.trim() || null } });
    await audit(tx, { organizationId: org.id, userId, action: "platform.subscriptionChanged", entity: "Organization", entityId: org.id, details: { from: { status: org.status, planId: org.planId }, to: { status: updated.status, planId: updated.planId }, trialEndsAt: updated.trialEndsAt?.toISOString() ?? null, reason: input.reason ?? null } });
    return updated;
  });
}

export const subscriptionInvoiceSchema = z.object({
  organizationId: z.string().min(1),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  currency: z.enum(["SRD", "USD"]),
  amount: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "validation.amount")),
});

export async function createSubscriptionInvoice(userId: string, raw: z.input<typeof subscriptionInvoiceSchema>) {
  await platformAdmin(userId);
  const input = subscriptionInvoiceSchema.parse(raw);
  if (!new Decimal(input.amount).gt(0) || input.periodTo < input.periodFrom) throw new UserError("validation.invalid");
  return systemDb.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (!org) throw new UserError("errors.notFound");
    // Gapless platform numbering per year, serialised by an advisory lock.
    const year = input.periodFrom.slice(0, 4);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription-invoice-${year}`}))`;
    const count = await tx.subscriptionInvoice.count({ where: { number: { startsWith: `SUB-${year}-` } } });
    const inv = await tx.subscriptionInvoice.create({ data: { organizationId: org.id, planId: org.planId, number: `SUB-${year}-${String(count + 1).padStart(5, "0")}`, periodFrom: new Date(`${input.periodFrom}T00:00:00Z`), periodTo: new Date(`${input.periodTo}T00:00:00Z`), currency: input.currency, amount: input.amount, createdById: userId } });
    await audit(tx, { organizationId: org.id, userId, action: "platform.invoiceCreated", entity: "SubscriptionInvoice", entityId: inv.id, details: { number: inv.number, amount: input.amount, currency: input.currency } });
    return inv;
  });
}

/** Manual payment confirmation (bank transfer in SRD or USD). Optionally reactivates a suspended organisation. */
export async function confirmPayment(userId: string, input: { invoiceId: string; reference: string; reactivate: boolean }) {
  await platformAdmin(userId);
  if (!input.reference?.trim()) throw new UserError("saas.referenceRequired");
  return systemDb.$transaction(async (tx) => {
    const inv = await tx.subscriptionInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!inv) throw new UserError("errors.notFound");
    if (inv.status !== "OPEN") throw new UserError("ledger.wrongStatus");
    const paid = await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date(), paymentReference: input.reference.trim(), confirmedById: userId } });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: inv.organizationId } });
    if (input.reactivate && (org.status === "SUSPENDED" || org.status === "TRIAL")) await tx.organization.update({ where: { id: org.id }, data: { status: "ACTIVE", statusReason: null } });
    await audit(tx, { organizationId: inv.organizationId, userId, action: "platform.paymentConfirmed", entity: "SubscriptionInvoice", entityId: inv.id, details: { reference: input.reference.trim(), reactivated: input.reactivate } });
    return paid;
  });
}

export async function voidSubscriptionInvoice(userId: string, invoiceId: string, reason: string) {
  await platformAdmin(userId);
  if (!reason?.trim()) throw new UserError("errors.reasonRequired");
  return systemDb.$transaction(async (tx) => {
    const inv = await tx.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.status !== "OPEN") throw new UserError("ledger.wrongStatus");
    await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "VOID" } });
    await audit(tx, { organizationId: inv.organizationId, userId, action: "platform.invoiceVoided", entity: "SubscriptionInvoice", entityId: inv.id, details: { reason } });
  });
}

/** Platform overview: every organisation with status, plan and usage. */
export async function platformOverview(userId: string) {
  await platformAdmin(userId);
  const orgs = await systemDb.organization.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const plans = await systemDb.plan.findMany({ orderBy: { code: "asc" } });
  const rows = [];
  for (const o of orgs) rows.push({ org: o, usage: await usage(systemDb, o.id), openInvoices: await systemDb.subscriptionInvoice.count({ where: { organizationId: o.id, status: "OPEN" } }), state: accessState(o) });
  const invoices = await systemDb.subscriptionInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return { rows, plans, invoices };
}
