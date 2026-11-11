import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { REPORT_KINDS, buildReports, recordRun, type ReportKind } from "@/modules/reporting/service";
import { reportTables, tablesToCsv } from "@/modules/reporting/export";
import { renderReportPdf } from "@/modules/reporting/pdf";
import { formatAmount } from "@/lib/format";
import { csvResponse } from "@/lib/csv";

/** PDF or CSV export of a report for the active administration and fiscal year; archived with its fingerprint (R1). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const ctx = await getContext();
  if (!ctx?.access || !ctx.administration || !ctx.fiscalYear || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const admin = ctx.administration;
  if (!can(ctx.access, "reports.export", admin.companyId)) return new Response("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "csv" ? "CSV" : "PDF";
  const fy = ctx.fiscalYears.find((y) => y.id === sp.get("fiscalYearId")) ?? ctx.fiscalYear;
  const from = Number(sp.get("from") ?? 1);
  const to = Number(sp.get("to") ?? 12);
  const r = await withTenant(ctx.access, async (tx) => {
    const report = await buildReports(tx, { administrationId: admin.id, fiscalYearId: fy.id, fromPeriod: Number.isFinite(from) ? from : 1, toPeriod: Number.isFinite(to) ? to : 12 });
    await recordRun(tx, ctx.access!, { administrationId: admin.id, kind, format, params: { fiscalYear: fy.code, fromPeriod: report.fromPeriod, toPeriod: report.toPeriod }, fingerprint: report.fingerprint, entryCount: report.entryCount });
    return report;
  });
  const t = await getTranslations();
  const locale = await getLocale();
  // CSV keeps plain decimals for spreadsheets; the PDF shows formatted amounts.
  const money = (v: string) => (format === "CSV" ? v : formatAmount(v, admin.baseCurrency, locale));
  const tables = reportTables(r, kind as ReportKind, (k, v) => t(k as never, v as never), money);
  const name = `${kind}-${admin.code}-${r.fiscalYear.code}-p${r.fromPeriod}-${r.toPeriod}`;
  if (format === "CSV") return csvResponse(`${name}.csv`, tablesToCsv(tables));
  const company = await withTenant(ctx.access, (tx) => tx.company.findUniqueOrThrow({ where: { id: admin.companyId } }));
  const bytes = await renderReportPdf({
    title: t(`reports.kinds.${kind}` as never),
    subtitle: [`${company.name} · ${admin.code} ${admin.name}`, t("reports.periodRange", { year: r.fiscalYear.code, from: r.fromPeriod, to: r.toPeriod }), t("reports.basis")],
    ...tables,
    footer: `${t("reports.fingerprint")}: ${r.fingerprint.slice(0, 16)} · ${r.entryCount} ${t("reports.entries")} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  });
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" } });
}
