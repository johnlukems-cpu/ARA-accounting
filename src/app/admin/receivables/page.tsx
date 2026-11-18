import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { aging } from "@/modules/invoicing/reports";
import { formatAmount } from "@/lib/format";
import { OpenBooks } from "@/components/admin/open-books";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/** Accounts receivable of ARA (aging per customer and currency, straight from the open items). */
export default async function ReceivablesPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const a = await requireAdmin("sales.view");
  const { r, customers } = await withTenant(a.access, async (tx) => ({ r: await aging(tx, { administrationId: a.home.administrationId, side: "RECEIVABLE", asOf: new Date() }), customers: await tx.crmCustomer.findMany({ where: { partyId: { not: null } }, select: { id: true, partyId: true } }) }));
  return (
    <>
      <PageHeader title={t("admin.nav.receivables")} description={t("admin.receivables.intro")} actions={<OpenBooks to="/app/receivables" label={t("admin.receivables.statements")} />} />
      <Card>
        {r.rows.length === 0 ? <EmptyState title={t("admin.receivables.none")} /> : (
          <Table head={[t("admin.quote.customer"), t("ledger.currency"), t("admin.receivables.current"), "1–30", "31–60", "61–90", "> 90", t("common.total")]}>
            {r.rows.map((x) => {
              const c = customers.find((y) => y.partyId === x.partyId);
              return <tr key={`${x.partyId}-${x.currency}`}><Td>{c ? <Link href={`/admin/customers/${c.id}`} className="hover:underline">{x.name}</Link> : x.name}</Td><Td>{x.currency}</Td>{x.buckets.map((b, i) => <Td key={i} className={`amount text-right ${i > 0 && b.gt(0) ? "text-danger" : ""}`}>{b.isZero() ? "—" : formatAmount(b.toFixed(2), x.currency, locale)}</Td>)}<Td className="amount text-right font-medium">{formatAmount(x.total.toFixed(2), x.currency, locale)}</Td></tr>;
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
