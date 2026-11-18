import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { invoiceStepAction } from "@/actions/admin";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { Badge, Card, Dl, PageHeader, Table, Td } from "@/components/ui/misc";
import { OpenBooks } from "@/components/admin/open-books";

/** An invoice of ARA's own administration: approval, posting, sending, credit note, payment status. */
export default async function AdminInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("sales.view");
  const data = await withTenant(a.access, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, party: true } });
    if (!inv || inv.administrationId !== a.home.administrationId) return null;
    const item = await tx.openItem.findFirst({ where: { sourceType: "INVOICE", sourceId: id } });
    const allocations = item ? await tx.allocation.findMany({ where: { openItemId: item.id }, include: { payment: true } }) : [];
    const customer = await tx.crmCustomer.findFirst({ where: { partyId: inv.partyId } });
    return { inv, item, allocations, customer };
  });
  if (!data) notFound();
  const { inv } = data;
  const money = (v: { toString(): string }) => formatAmount(v.toString(), inv.currency, locale);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");
  const draft = ["DRAFT", "REVIEW", "APPROVED"].includes(inv.status);
  const step = (s: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <ActionForm action={invoiceStepAction} className="space-y-0"><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="step" value={s} /><SubmitButton variant={variant}>{label}</SubmitButton></ActionForm>
  );
  return (
    <>
      <PageHeader title={`${inv.kind === "CREDIT_NOTE" ? t("invoicing.creditNote") : t("invoicing.invoice")} ${inv.number ?? t("invoicing.draftNumber")}`} description={`${inv.party.name} · ${t(`invoicing.status.${inv.status}`)}`}
        actions={<a href={`/api/admin/invoices/${inv.id}/pdf`} className="text-sm font-medium text-accent hover:underline">PDF</a>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <Table head={[t("invoicing.reference"), t("invoicing.quantity"), t("invoicing.unitPrice"), t("invoicing.taxCode"), t("invoicing.net")]}>
              {inv.lines.map((l) => <tr key={l.id}><Td>{l.description}</Td><Td className="amount text-right">{l.quantity.toString()}</Td><Td className="amount text-right">{money(l.unitPrice)}</Td><Td className="amount text-right">{l.taxRate.toString()}%</Td><Td className="amount text-right">{money(l.netAmount)}</Td></tr>)}
            </Table>
            <Dl items={[[t("invoicing.totalNet"), money(inv.netAmount)], [t("invoicePdf.totalBtw"), money(inv.taxAmount)], [t("invoicePdf.totalGross"), money(inv.grossAmount)]]} />
          </Card>
          <Card title={t("admin.invoice.payments")}>
            {data.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.invoice.noPayments")}</p> : (
              <ul className="space-y-1 text-sm">{data.allocations.map((x) => <li key={x.id}>{x.payment ? `${date(x.payment.date)} · ${x.payment.reference ?? ""}` : t("admin.invoice.offset")} — {money(x.amount)}</li>)}</ul>
            )}
            {data.item && <p className="mt-2 text-sm font-medium">{t("admin.invoice.remaining")}: {money(data.item.remainingAmount)}</p>}
          </Card>
        </div>
        <aside className="space-y-6">
          <Card title={t("admin.invoice.details")}>
            <Dl items={[[t("invoicing.invoiceDate"), date(inv.invoiceDate)], [t("invoicing.dueDate"), date(inv.dueDate)], [t("admin.invoice.sent"), inv.sentAt ? `${date(inv.sentAt)} → ${inv.sentTo}` : "—"], [t("admin.quote.customer"), data.customer ? <Link key="c" href={`/admin/customers/${data.customer.id}`} className="hover:underline">{data.customer.name}</Link> : inv.party.name], [t("common.notes"), inv.description ?? "—"]]} />
          </Card>
          <Card title={t("admin.invoice.actions")}>
            <div className="flex flex-col gap-2">
              {inv.status === "DRAFT" && adminCan(a, "sales.edit") && step("submit", t("admin.invoice.submit"))}
              {(inv.status === "REVIEW" || inv.status === "DRAFT") && adminCan(a, "sales.approve") && step("approve", t("admin.invoice.approve"))}
              {draft && adminCan(a, "sales.post") && step("post", t("admin.invoice.post"), "primary")}
              {!draft && inv.kind === "INVOICE" && adminCan(a, "sales.create") && step("credit", t("admin.invoice.credit"))}
              {!draft && adminCan(a, "sales.post") && (
                <ActionForm action={invoiceStepAction}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="step" value="markSent" /><Field label={t("admin.invoice.sentTo")} name="to"><Input name="to" defaultValue={data.customer?.email ?? ""} /></Field><SubmitButton variant="secondary">{t("admin.invoice.markSent")}</SubmitButton></ActionForm>
              )}
              {draft && <OpenBooks to={`/app/sales/${inv.id}`} label={t("admin.invoice.editInBooks")} />}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("admin.invoice.immutableNote")}</p>
          </Card>
          <Card><Badge>{t(`invoicing.status.${inv.status}`)}</Badge></Card>
        </aside>
      </div>
    </>
  );
}
