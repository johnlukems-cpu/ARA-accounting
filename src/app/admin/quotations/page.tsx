import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { expireQuotes } from "@/modules/admin/quotes";
import { formatAmount } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const STATUSES = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("quotes.view");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const list = await withTenant(a.access, async (tx) => {
    await expireQuotes(tx);
    return tx.quotation.findMany({ where: { ...(status ? { status } : {}), ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { customer: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 300, include: { customer: { select: { name: true } } } });
  });
  return (
    <>
      <PageHeader title={t("admin.nav.quotations")} description={t("admin.quote.intro")} actions={adminCan(a, "quotes.create") ? <TextLink href="/admin/quotations/new">{t("admin.quote.new")}</TextLink> : undefined} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder={t("admin.quote.search")} aria-label={t("admin.quote.search")} className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"><option value="">{t("admin.quote.allStatuses")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`admin.quoteStatuses.${s}`)}</option>)}</select>
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
      </form>
      <Card>
        {list.length === 0 ? <EmptyState title={t("admin.quote.none")} /> : (
          <Table head={[t("admin.quote.number"), t("admin.quote.customer"), t("admin.quote.date"), t("quotes.validUntil"), t("common.status"), t("common.total")]}>
            {list.map((q) => (
              <tr key={q.id}>
                <Td><Link href={`/admin/quotations/${q.id}`} className="font-medium hover:underline">{q.number}</Link>{q.revision > 1 && <span className="ml-1 text-xs text-muted-foreground">rev. {q.revision}</span>}</Td>
                <Td>{q.customer.name}</Td><Td>{format.dateTime(q.quoteDate, { dateStyle: "short" })}</Td><Td>{format.dateTime(q.validUntil, { dateStyle: "short" })}</Td>
                <Td><Badge tone={q.status === "ACCEPTED" || q.status === "CONVERTED" ? "success" : q.status === "REJECTED" || q.status === "EXPIRED" ? "neutral" : "info"}>{t(`admin.quoteStatuses.${q.status}`)}</Badge></Td>
                <Td className="amount text-right">{formatAmount(q.grossAmount.toString(), q.currency, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
