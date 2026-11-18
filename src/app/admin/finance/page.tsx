import { getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { dashboard } from "@/modules/admin/metrics";
import { adminReport } from "@/modules/admin/reports";
import { aging } from "@/modules/invoicing/reports";
import { formatAmount } from "@/lib/format";
import { OpenBooks } from "@/components/admin/open-books";
import { BarChart, Kpi } from "@/components/admin/charts";
import { Card, PageHeader, Table, Td } from "@/components/ui/misc";

/**
 * Internal finance of ARA Intelligent Solutions — its own administration in the accounting engine (not a second
 * bookkeeping). Income and costs come from the ledger; receivables and payables from the open items.
 */
export default async function FinancePage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const a = await requireAdmin("reports.view");
  const year = new Date().getUTCFullYear();
  const data = await withTenant(a.access, async (tx) => {
    const d = await dashboard(tx, a.home);
    const pl = await adminReport(tx, a.home, "profitLoss", year);
    const cf = await adminReport(tx, a.home, "cashflow", year);
    const payables = await aging(tx, { administrationId: a.home.administrationId, side: "PAYABLE", asOf: new Date() });
    return { d, pl, cf, payables };
  });
  const m = (v: string) => formatAmount(v, data.d.baseCurrency, locale);
  const payable = [...data.payables.totals.entries()].map(([cur, v]) => formatAmount(v.at(-1)!.toFixed(2), cur, locale)).join(" · ") || "—";
  const margin = Number(data.d.money.accountingRevenue) ? ((Number(data.d.money.operatingResult) / Number(data.d.money.accountingRevenue)) * 100).toFixed(1) + "%" : "—";
  return (
    <>
      <PageHeader title={t("admin.nav.finance")} description={t("admin.finance.intro")} actions={<div className="flex gap-4"><OpenBooks to="/app/reports" label={t("admin.finance.statements")} /><OpenBooks to="/app/ledger/trial-balance" label={t("nav.trialBalance")} /></div>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("admin.finance.income")} value={m(data.d.money.accountingRevenue)} hint={t("admin.kpi.accountingHint", { year: data.d.money.fiscalYear ?? "—" })} />
        <Kpi label={t("admin.finance.costs")} value={m(data.d.money.expensesYear)} />
        <Kpi label={t("admin.kpi.operatingResult")} value={m(data.d.money.operatingResult)} tone={Number(data.d.money.operatingResult) < 0 ? "danger" : "success"} hint={`${t("admin.finance.margin")}: ${margin}`} />
        <Kpi label={t("admin.kpi.cash")} value={m(data.d.money.cash)} />
        <Kpi label={t("admin.kpi.outstanding")} value={m(data.d.money.outstanding)} />
        <Kpi label={t("admin.finance.payables")} value={payable} />
        <Kpi label={t("admin.kpi.invoiced")} value={m(data.d.money.invoicedYear)} hint={t("admin.kpi.invoicedHint")} />
        <Kpi label={t("admin.kpi.collected")} value={m(data.d.money.collectedYear)} hint={t("admin.kpi.collectedHint")} />
      </div>
      <Card title={t("admin.finance.cashflow")} className="mt-6">
        <BarChart data={data.cf.rows.map((r) => ({ month: String(r[0]), in: r[1]!, out: r[2]! }))} label={t("admin.finance.cashflow")} format={(v) => formatAmount(v.toFixed(2), data.d.baseCurrency, locale)} series={[{ key: "in", label: t("admin.finance.in"), className: "fill-accent" }, { key: "out", label: t("admin.finance.out"), className: "fill-warning" }]} />
      </Card>
      <Card title={t("admin.finance.pl", { year })} className="mt-6">
        <Table head={data.pl.columns}>{data.pl.rows.map((r, i) => <tr key={i}><Td>{t.has(`reports.lines.${r[0]}`) ? t(`reports.lines.${r[0]}` as never) : String(r[0])}</Td><Td className="amount text-right">{m(String(r[1]))}</Td></tr>)}</Table>
        {data.pl.notes?.map((n) => <p key={n} className="mt-2 text-xs text-muted-foreground">{n}</p>)}
      </Card>
    </>
  );
}
