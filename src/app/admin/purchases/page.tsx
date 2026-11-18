import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { formatAmount } from "@/lib/format";
import { OpenBooks } from "@/components/admin/open-books";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/** ARA's purchase invoices and suppliers (managed in ARA's own administration). */
export default async function PurchasesPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("purchase.view");
  const list = await withTenant(a.access, (tx) => tx.invoice.findMany({ where: { administrationId: a.home.administrationId, type: "PURCHASE" }, orderBy: { invoiceDate: "desc" }, take: 200, include: { party: { select: { name: true } } } }));
  return (
    <>
      <PageHeader title={t("admin.nav.purchases")} description={t("admin.purchases.intro")} actions={<div className="flex gap-4"><OpenBooks to="/app/purchase/new" label={t("admin.purchases.new")} /><OpenBooks to="/app/relations" label={t("admin.purchases.suppliers")} /><OpenBooks to="/app/scan" label="ARA Scan" /></div>} />
      <Card>
        {list.length === 0 ? <EmptyState title={t("admin.purchases.none")} /> : (
          <Table head={[t("invoicing.supplier"), t("invoicing.supplierInvoiceNumber"), t("invoicing.invoiceDate"), t("common.status"), t("common.total")]}>
            {list.map((i) => <tr key={i.id}><Td>{i.party.name}</Td><Td>{i.externalNumber}</Td><Td>{format.dateTime(i.invoiceDate, { dateStyle: "short" })}</Td><Td><Badge>{t(`invoicing.status.${i.status}`)}</Badge></Td><Td className="amount text-right">{formatAmount(i.grossAmount.toString(), i.currency, locale)}</Td></tr>)}
          </Table>
        )}
      </Card>
    </>
  );
}
