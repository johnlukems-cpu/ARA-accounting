import { z } from "zod";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { inHome } from "./common";
import type { AdminContext } from "./home";

const money = z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "validation.amount")).optional().transform((v) => v || null);

export const productSchema = z.object({
  id: z.string().optional().transform((v) => v || undefined),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "validation.code"),
  name: z.string().trim().min(2, "validation.required").max(120),
  nameEn: z.string().trim().max(120).optional().transform((v) => v || null),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  category: z.enum(["SOFTWARE", "SUBSCRIPTION", "IMPLEMENTATION", "ONBOARDING", "SUPPORT", "CONSULTANCY", "OTHER"]),
  billingType: z.enum(["ONE_TIME", "RECURRING"]),
  billingInterval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).optional().or(z.literal("").transform(() => undefined)),
  defaultPrice: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").default("SRD"),
  taxCodeId: z.string().optional().transform((v) => v || null),
  revenueAccountId: z.string().optional().transform((v) => v || null),
  planId: z.string().optional().transform((v) => v || null),
  status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
}).refine((p) => (p.billingType === "RECURRING") === Boolean(p.billingInterval), { message: "admin.intervalRequired", path: ["billingInterval"] });

/** Creates or updates a catalogue item. Tax code and revenue account must belong to ARA's administration. */
export async function saveProduct(ctx: AdminContext, raw: z.input<typeof productSchema>) {
  const p = productSchema.parse(raw);
  return inHome(ctx, "catalog.edit", async (tx) => {
    if (p.taxCodeId && !(await tx.taxCode.findFirst({ where: { id: p.taxCodeId, administrationId: ctx.home.administrationId, status: "ACTIVE" } }))) throw new UserError("invoicing.invalidTaxCode");
    if (p.revenueAccountId && !(await tx.account.findFirst({ where: { id: p.revenueAccountId, administrationId: ctx.home.administrationId, type: "DETAIL", status: "ACTIVE", category: { in: ["REVENUE", "FINANCIAL_INCOME"] } } }))) throw new UserError("errors.notFound");
    if (await tx.product.findFirst({ where: { code: p.code, ...(p.id ? { id: { not: p.id } } : {}) } })) throw new UserError("errors.codeTaken");
    const { id, ...data } = p;
    const product = id
      ? await tx.product.update({ where: { id }, data: { ...data, billingInterval: data.billingInterval ?? null } })
      : await tx.product.create({ data: { ...data, billingInterval: data.billingInterval ?? null, organizationId: ctx.home.organizationId } });
    await audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: id ? "catalog.productUpdated" : "catalog.productCreated", entity: "Product", entityId: product.id, details: { code: p.code, price: p.defaultPrice, currency: p.currency, status: p.status } });
    return product;
  });
}
