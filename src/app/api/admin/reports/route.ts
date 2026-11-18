import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { throttleResponse } from "@/core/ops/throttle";
import { adminAccess } from "@/modules/admin/home";
import { can } from "@/core/auth/access";
import { ADMIN_REPORTS, adminReport, type AdminReportKind } from "@/modules/admin/reports";
import { renderReportPdf } from "@/modules/reporting/pdf";
import { csvResponse } from "@/lib/csv";

/** Export of a management report (PDF or CSV). Same table as the page. Staff of ARA only; every export is audited. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx || (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt)) return new Response("Unauthorized", { status: 401 });
  const a = await adminAccess(ctx.user.id).catch(() => null);
  if (!a || !can(a.access, "reports.export", a.home.companyId)) return new Response("Forbidden", { status: 403 });
  const limited = await throttleResponse("export", ctx.user.id, a.home.organizationId);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") as AdminReportKind;
  if (!(ADMIN_REPORTS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const year = Number(sp.get("year")) || new Date().getUTCFullYear();
  const r = await withTenant(a.access, async (tx) => {
    const table = await adminReport(tx, a.home, kind, year);
    await audit(tx, { organizationId: a.home.organizationId, userId: ctx.user.id, action: "admin.reportExported", entity: "Report", entityId: kind, details: { year, format: sp.get("format") } });
    return table;
  });
  const t = await getTranslations();
  const title = `${t(`admin.reports.kinds.${kind}`)} ${year}`;
  if (sp.get("format") === "csv") return csvResponse(`ara-${kind}-${year}.csv`, [r.columns, ...r.rows]);
  const pdf = await renderReportPdf({ title, subtitle: ["ARA Intelligent Solutions", ...(r.notes ?? [])], columns: r.columns.slice(1), sections: [{ heading: title, rows: r.rows.map((row) => ({ label: String(row[0]), values: row.slice(1).map(String) })) }], footer: "ARA Intelligent Solutions — ARA Admin" });
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ara-${kind}-${year}.pdf"`, "Cache-Control": "no-store" } });
}
