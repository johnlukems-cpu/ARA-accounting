import { getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { ADMIN_REPORTS, adminReport, type AdminReportKind } from "@/modules/admin/reports";
import { Card, PageHeader, Table, Td } from "@/components/ui/misc";

/** Management reporting centre: the same tables are exported to PDF and CSV (Excel-compatible). */
export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ kind?: string; year?: string }> }) {
  const t = await getTranslations();
  const a = await requireAdmin("reports.view");
  const sp = await searchParams;
  const kind = (ADMIN_REPORTS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as AdminReportKind) : "revenueMonthly";
  const year = Number(sp.year) || new Date().getUTCFullYear();
  const r = await withTenant(a.access, (tx) => adminReport(tx, a.home, kind, year));
  const q = `kind=${kind}&year=${year}`;
  return (
    <>
      <PageHeader title={t("admin.nav.reports")} description={t("admin.reports.intro")} />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="kind" defaultValue={kind} aria-label={t("admin.reports.kind")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm">{ADMIN_REPORTS.map((k) => <option key={k} value={k}>{t(`admin.reports.kinds.${k}`)}</option>)}</select>
        <input type="number" name="year" defaultValue={year} aria-label={t("admin.reports.year")} className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-sm" />
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.show")}</button>
        <a href={`/api/admin/reports?${q}&format=pdf`} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm">PDF</a>
        <a href={`/api/admin/reports?${q}&format=csv`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm">{t("admin.reports.excel")}</a>
      </form>
      <Card title={`${t(`admin.reports.kinds.${kind}`)} — ${year}`}>
        <Table head={r.columns}>{r.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <Td key={j} className={j > 0 && /^-?[\d.]+$/.test(String(v)) ? "amount text-right" : ""}>{String(v)}</Td>)}</tr>)}</Table>
        {r.rows.length === 0 && <p className="text-sm text-muted-foreground">{t("admin.reports.empty")}</p>}
        {r.notes?.map((n) => <p key={n} className="mt-2 text-xs text-muted-foreground">{n}</p>)}
      </Card>
    </>
  );
}
