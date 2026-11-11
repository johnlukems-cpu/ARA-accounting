import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { budgetVsActual } from "@/modules/budgets/service";
import { csvResponse } from "@/lib/csv";

const clamp = (v: string | null, d: number) => Math.min(12, Math.max(1, Number(v) || d));

/** Budget versus actual as CSV (same figures as the report page). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx?.access || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const from = clamp(req.nextUrl.searchParams.get("from"), 1);
  const to = Math.max(from, clamp(req.nextUrl.searchParams.get("to"), 12));
  const result = await withTenant(ctx.access, async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id } });
    if (!budget) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: budget.administrationId } });
    if (!can(ctx.access!, "budgets.export", admin.companyId) && !can(ctx.access!, "reports.export", admin.companyId)) return "forbidden" as const;
    const r = await budgetVsActual(tx, { budgetId: id, versionId: req.nextUrl.searchParams.get("v") ?? undefined, fromPeriod: from, toPeriod: to });
    await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "export.budgetVsActual", entity: "Budget", entityId: id, details: { from, to, version: r.version?.version ?? null } });
    return { r, admin };
  });
  if (!result) return new Response("Not found", { status: 404 });
  if (result === "forbidden") return new Response("Forbidden", { status: 403 });
  const t = await getTranslations();
  const { r } = result;
  return csvResponse(`budget-${r.budget.name.replace(/[^\w-]+/g, "_")}-p${from}-${to}.csv`, [
    [t("ledger.number"), t("ledger.accountName"), t("budgets.budget"), t("budgets.actual"), t("ledger.difference"), "%", t("budgets.utilisation"), t("budgets.alert")],
    ...r.rows.map((x) => [x.number, x.name, x.budget, x.actual, x.variance, x.pct ?? "", x.utilisation ?? "", x.alert ? t("common.yes") : ""]),
    ["", t("budgets.result"), r.result.budget, r.result.actual, r.result.variance, r.result.pct ?? "", "", ""],
  ]);
}
