import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { InvoiceStatus } from "@prisma/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { formatAmount } from "@/lib/format";
import { OpenBooks } from "@/components/admin/open-books";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/** Sales invoices of ARA Intelligent Solutions (ARA's own administration in the accounting engine). */
export default async function AdminInvoices({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("sales.view");
  const sp = await searchParams;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const statusFilter: InvoiceStatus[] | undefined = sp.status === "draft" ? ["DRAFT", "REVIEW", "APPROVED"] : sp.status === "open" ? ["POSTED", "PARTIALLY_PAID"] : sp.status === "paid" ? ["PAID"] : undefined;
  const list = await withTenant(a.access, (tx) => tx.invoice.findMany({
    where: { administrationId: a.home.administrationId, type: "SALES", ...(statusFilter ? { status: { in: statusFilter } } : {}), ...(sp.status === "overdue" ? { status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { lt: today } } : {}), ...(sp.q ? { OR: [{ number: { contains: sp.q } }, { party: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}) },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }], take: 300, include: { party: { select: { name: true } } },
  }));
  const label = (i: (typeof list)[number]) => (["POSTED", "PARTIALLY_PAID"].includes(i.status) && i.dueDate < today ? "OVERDUE" : i.kind === "CREDIT_NOTE" ? "CREDIT" : i.sentAt && i.status === "POSTED" ? "SENT" : i.status);
  return (
    <>
      <PageHeader title={t("admin.nav.invoices")} description={t("admin.invoice.intro")} actions={<OpenBooks to="/app/sales/new" label={t("admin.invoice.newInBooks")} />} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder={t("admin.invoice.search")} aria-label={t("admin.invoice.search")} className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm">
          <option value="">{t("admin.invoice.all")}</option>{["draft", "open", "overdue", "paid"].map((s) => <option key={s} value={s}>{t(`admin.invoice.filter.${s}`)}</option>)}
        </select>
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
      </form>
      <Card>
        {list.length === 0 ? <EmptyState title={t("admin.invoice.none")} /> : (
          <Table head={[t("ledger.number"), t("admin.quote.customer"), t("invoicing.invoiceDate"), t("invoicing.dueDate"), t("common.status"), t("common.total")]}>
            {list.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/admin/invoices/${i.id}`} className="font-medium hover:underline">{i.number ?? t("invoicing.draftNumber")}</Link>{i.kind === "CREDIT_NOTE" && <span className="block text-xs text-muted-foreground">{t("invoicing.creditNote")}</span>}</Td>
                <Td>{i.party.name}</Td><Td>{format.dateTime(i.invoiceDate, { dateStyle: "short" })}</Td><Td>{format.dateTime(i.dueDate, { dateStyle: "short" })}</Td>
                <Td><Badge tone={label(i) === "OVERDUE" ? "danger" : i.status === "PAID" ? "success" : i.status === "DRAFT" ? "neutral" : "info"}>{t(`admin.invoiceStatuses.${label(i)}`)}</Badge></Td>
                <Td className="amount text-right">{formatAmount(i.grossAmount.toString(), i.currency, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
