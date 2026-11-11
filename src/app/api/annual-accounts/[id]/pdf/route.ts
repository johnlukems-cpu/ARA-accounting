import { getLocale, getTranslations } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { reportTables } from "@/modules/reporting/export";
import { renderReportPdf, type ReportPdf } from "@/modules/reporting/pdf";
import type { buildReports } from "@/modules/reporting/service";
import type { assetMovements } from "@/modules/annual-accounts/service";
import { formatAmount } from "@/lib/format";
import { throttleResponse } from "@/core/ops/throttle";

type Snapshot = Awaited<ReturnType<typeof buildReports>> & { assets: Awaited<ReturnType<typeof assetMovements>> };

/** Annual accounts PDF: statements with comparatives from the stored snapshot, the asset schedule and the notes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const limited = await throttleResponse("export", ctx.user.id, ctx.access.organizationId);
  if (limited) return limited;
  const r = await withTenant(ctx.access, async (tx) => {
    const aa = await tx.annualAccount.findUnique({ where: { id }, include: { disclosures: { orderBy: { sortOrder: "asc" } } } });
    if (!aa) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: aa.administrationId }, include: { company: true } });
    if (!can(ctx.access!, "annualAccounts.export", admin.companyId)) return "forbidden" as const;
    await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "annual.exported", entity: "AnnualAccount", entityId: id, details: { status: aa.status, fingerprint: aa.fingerprint } });
    return { aa, admin };
  });
  if (!r) return new Response("Not found", { status: 404 });
  if (r === "forbidden") return new Response("Forbidden", { status: 403 });
  const t = await getTranslations();
  const locale = await getLocale();
  const { aa, admin } = r;
  const snap = aa.snapshot as unknown as Snapshot;
  const money = (v: string) => formatAmount(v, admin.baseCurrency, locale);
  const tt = (k: string, v?: Record<string, string | number>) => t(k as never, v as never);
  const statements = reportTables({ ...snap, kpis: [] } as never, "pack", tt, money);
  const foundation = aa.framework === "FOUNDATION";
  const sections: ReportPdf["sections"] = statements.sections.filter((s) => s.heading !== t("reports.kinds.kpis")).map((s) => (foundation && s.heading === t("reports.kinds.pl") ? { ...s, heading: t("annual.incomeAndExpenditure") } : s));
  if (aa.framework !== "SOLE_PROPRIETOR") {
    const eq = reportTables({ ...snap, kpis: [] } as never, "equity", tt, money);
    sections.push(...eq.sections.map((s) => (foundation ? { ...s, heading: t("annual.funds") } : s)));
  }
  if (snap.assets.length) {
    const pad = (v: string) => [v, ...Array(Math.max(0, statements.columns.length - 2)).fill("")];
    sections.push({
      heading: t("annual.assetSchedule"),
      rows: snap.assets.flatMap((a) => [
        { label: `${a.category} — ${t("annual.bookValue")}`, values: pad(money(a.bookValue)), bold: true },
        { label: `${t("annual.costOpening")} ${money(a.costOpening)} + ${t("annual.additions")} ${money(a.additions)} - ${t("annual.disposals")} ${money(a.disposals)} = ${money(a.costClosing)}`, values: [], indent: true },
        { label: `${t("annual.depOpening")} ${money(a.depOpening)} + ${t("annual.depreciation")} ${money(a.depreciation)} - ${t("annual.disposals")} ${money(a.depDisposals)} = ${money(a.depClosing)}`, values: [], indent: true },
      ]),
    });
  }
  for (const d of aa.disclosures) sections.push({ heading: d.title, rows: [], paragraphs: d.body.split(/\n{2,}/) });
  const bytes = await renderReportPdf({
    title: `${t(foundation ? "annual.titleFoundation" : aa.framework === "SOLE_PROPRIETOR" ? "annual.titleSole" : "annual.title")} ${snap.fiscalYear.code}`,
    subtitle: [`${admin.company.legalName || admin.company.name}${admin.company.kkfNumber ? ` · KKF ${admin.company.kkfNumber}` : ""}`, t(`annual.frameworks.${aa.framework}`), aa.status === "FINAL" ? t("annual.finalLabel") : t("annual.draftLabel")],
    columns: statements.columns, sections,
    footer: `${t(`annual.statuses.${aa.status}`)} · ${t("reports.fingerprint")}: ${aa.fingerprint.slice(0, 16)} · ${aa.entryCount} ${t("reports.entries")}`,
  });
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="jaarrekening-${admin.code}-${snap.fiscalYear.code}${aa.status === "FINAL" ? "" : "-concept"}.pdf"`, "Cache-Control": "no-store" } });
}
