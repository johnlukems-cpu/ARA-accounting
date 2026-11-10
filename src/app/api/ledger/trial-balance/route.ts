import type { NextRequest } from "next/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { trialBalance } from "@/modules/ledger/reports";
import { trialBalanceSchema } from "@/modules/ledger/schemas";
import { csvResponse } from "@/lib/csv";
import { getTranslations } from "next-intl/server";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx?.access || !ctx.administration || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const admin = ctx.administration;
  if (!can(ctx.access, "ledger.export", admin.companyId) && !can(ctx.access, "reports.export", admin.companyId)) return new Response("Forbidden", { status: 403 });
  const f = trialBalanceSchema.parse({ ...Object.fromEntries(req.nextUrl.searchParams), hideZero: req.nextUrl.searchParams.get("hideZero") !== "0" });
  const fy = ctx.fiscalYears.find((y) => y.id === f.fiscalYearId) ?? ctx.fiscalYear;
  if (!fy) return new Response("Not found", { status: 404 });
  const tb = await withTenant(ctx.access, async (tx) => {
    const result = await trialBalance(tx, { administrationId: admin.id, fiscalYearId: fy.id, fromPeriod: f.fromPeriod, toPeriod: f.toPeriod, accountFrom: f.accountFrom, accountTo: f.accountTo, journalId: f.journalId, hideZero: f.hideZero });
    await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "export.trialBalance", entity: "Administration", entityId: admin.id, details: { fiscalYear: fy.code, from: f.fromPeriod, to: f.toPeriod } });
    return result;
  });
  const t = await getTranslations();
  return csvResponse(`proefbalans-${admin.code}-${fy.code}-p${f.fromPeriod}-${f.toPeriod}.csv`, [
    [t("ledger.number"), t("ledger.accountName"), t("ledger.csv.openingDebit"), t("ledger.csv.openingCredit"), t("ledger.csv.periodDebit"), t("ledger.csv.periodCredit"), t("ledger.csv.closingDebit"), t("ledger.csv.closingCredit")],
    ...tb.rows.map((r) => [r.number, r.name, r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit]),
    ["", t("ledger.total"), tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.periodDebit, tb.totals.periodCredit, tb.totals.closingDebit, tb.totals.closingCredit],
  ]);
}
