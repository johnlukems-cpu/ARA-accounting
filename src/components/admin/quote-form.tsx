import { getTranslations } from "next-intl/server";
import type { Quotation, QuotationLine } from "@prisma/client";
import { withTenant } from "@/core/tenancy/tenant";
import type { AdminContext } from "@/modules/admin/home";
import { saveQuoteAction } from "@/actions/admin";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { QuoteLinesEditor } from "./quote-editor";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function QuoteForm({ a, quote, customerId }: { a: AdminContext; quote?: Quotation & { lines: QuotationLine[] }; customerId?: string }) {
  const t = await getTranslations();
  const { customers, products, taxCodes } = await withTenant(a.access, async (tx) => ({
    customers: await tx.crmCustomer.findMany({ where: { status: "ACTIVE", stage: { not: "INACTIVE" } }, orderBy: { name: "asc" }, include: { contacts: true } }),
    products: await tx.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    taxCodes: await tx.taxCode.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE", direction: { in: ["SALES", "BOTH"] } }, orderBy: { code: "asc" } }),
  }));
  const today = new Date();
  const valid = new Date(today.getTime() + 30 * 86_400_000);
  const selected = quote?.customerId ?? customerId ?? "";
  return (
    <ActionForm action={saveQuoteAction}>
      {quote && <input type="hidden" name="id" value={quote.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("admin.quote.customer")} name="customerId" className="lg:col-span-2"><Select name="customerId" defaultValue={selected} required>{[<option key="" value="">—</option>, ...customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.number})</option>)]}</Select></Field>
        <Field label={t("admin.quote.contact")} name="contactId"><Select name="contactId" defaultValue={quote?.contactId ?? ""}>{[<option key="" value="">—</option>, ...customers.flatMap((c) => c.contacts.map((p) => <option key={p.id} value={p.id}>{p.name} — {c.name}</option>))]}</Select></Field>
        <Field label={t("admin.quote.currency")} name="currency"><Input name="currency" defaultValue={quote?.currency ?? customers.find((c) => c.id === selected)?.preferredCurrency ?? "SRD"} maxLength={3} required /></Field>
        <Field label={t("admin.quote.date")} name="quoteDate"><Input type="date" name="quoteDate" defaultValue={quote ? iso(quote.quoteDate) : iso(today)} required /></Field>
        <Field label={t("quotes.validUntil")} name="validUntil"><Input type="date" name="validUntil" defaultValue={quote ? iso(quote.validUntil) : iso(valid)} required /></Field>
        <Field label={t("admin.quote.paymentTerm")} name="paymentTermDays"><Input type="number" min={0} name="paymentTermDays" defaultValue={quote?.paymentTermDays ?? 14} /></Field>
      </div>
      <QuoteLinesEditor products={products.map((p) => ({ id: p.id, name: p.name, price: p.defaultPrice?.toString() ?? null, taxCodeId: p.taxCodeId }))} taxCodes={taxCodes.map((c) => ({ id: c.id, label: `${c.code} (${c.rate.toString()}%)` }))}
        initial={(quote?.lines ?? []).map((l) => ({ productId: l.productId ?? "", description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.isZero() ? "" : l.discountPct.toString(), taxCodeId: l.taxCodeId ?? "" }))} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Field label={t("admin.quote.introduction")} name="introduction"><Textarea name="introduction" rows={3} defaultValue={quote?.introduction ?? ""} /></Field>
        <Field label={t("admin.quote.terms")} name="terms"><Textarea name="terms" rows={3} defaultValue={quote?.terms ?? ""} /></Field>
        <Field label={t("common.notes")} name="notes"><Textarea name="notes" rows={3} defaultValue={quote?.notes ?? ""} /></Field>
      </div>
      <SubmitButton>{quote ? t("common.save") : t("admin.quote.create")}</SubmitButton>
    </ActionForm>
  );
}
