import { z } from "zod";
import Decimal from "decimal.js";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import { postInvoice, registerPayment, saveInvoice } from "@/modules/invoicing/service";
import { withTenant } from "@/core/tenancy/tenant";
import { EXPENSE_CATEGORIES, type AdminContext } from "./home";
import { iso, asDate } from "./common";

export const expenseSchema = z.object({
  supplierId: z.string().min(1, "validation.required"),
  category: z.enum(Object.keys(EXPENSE_CATEGORIES) as [keyof typeof EXPENSE_CATEGORIES, ...(keyof typeof EXPENSE_CATEGORIES)[]]),
  externalNumber: z.string().trim().min(1, "validation.required").max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date"),
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  description: z.string().trim().min(2, "validation.required").max(300),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency"),
  netAmount: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "validation.amount")),
  taxCodeId: z.string().optional().transform((v) => v || undefined),
  exchangeRate: z.string().optional().transform((v) => v || undefined),
  paidFromAccountId: z.string().optional().transform((v) => v || undefined),
});

/**
 * Company expense of ARA itself = a purchase invoice in ARA's administration (category → cost account), posted through
 * the normal engine (approval rules apply). Optionally paid at once from a bank/cash account.
 */
export async function recordExpense(ctx: AdminContext, raw: z.input<typeof expenseSchema>) {
  const input = expenseSchema.parse(raw);
  const account = await withTenant(ctx.access, (tx) => tx.account.findFirst({ where: { administrationId: ctx.home.administrationId, number: EXPENSE_CATEGORIES[input.category], type: "DETAIL", status: "ACTIVE" } }));
  if (!account) throw new UserError("admin.noExpenseAccount", { number: EXPENSE_CATEGORIES[input.category] });
  const inv = await saveInvoice(ctx.access, {
    administrationId: ctx.home.administrationId, type: "PURCHASE", kind: "INVOICE", partyId: input.supplierId, externalNumber: input.externalNumber,
    invoiceDate: input.date, dueDate: iso(new Date(asDate(input.date).getTime() + input.dueDays * 86_400_000)), currency: input.currency, exchangeRate: input.exchangeRate,
    description: input.description, lines: [{ description: input.description, quantity: "1", unitPrice: input.netAmount, accountId: account.id, taxCodeId: input.taxCodeId }],
  });
  const admin = await withTenant(ctx.access, (tx) => tx.administration.findUniqueOrThrow({ where: { id: ctx.home.administrationId } }));
  const { purchaseApprovalRequired } = await import("@/modules/invoicing/service");
  // When ARA requires purchase approval, the expense waits in Inkoop for a second person (segregation of duties).
  if (purchaseApprovalRequired(admin.settings)) return { invoice: inv, posted: false };
  const posted = await postInvoice(ctx.access, inv.id);
  if (input.paidFromAccountId) {
    const item = await withTenant(ctx.access, (tx) => tx.openItem.findFirstOrThrow({ where: { sourceType: "INVOICE", sourceId: inv.id } }));
    await registerPayment(ctx.access, { administrationId: ctx.home.administrationId, direction: "OUT", financialAccountId: input.paidFromAccountId, partyId: input.supplierId, date: input.date, amount: new Decimal(item.remainingAmount.toString()).abs().toFixed(2), reference: input.externalNumber, exchangeRate: input.exchangeRate, allocations: [{ openItemId: item.id, amount: new Decimal(item.remainingAmount.toString()).abs().toFixed(2) }] });
  }
  await withTenant(ctx.access, (tx) => audit(tx, { organizationId: ctx.home.organizationId, userId: ctx.access.userId, action: "admin.expenseRecorded", entity: "Invoice", entityId: inv.id, details: { category: input.category, net: input.netAmount, currency: input.currency, paid: !!input.paidFromAccountId } }));
  return { invoice: posted ?? inv, posted: true };
}
