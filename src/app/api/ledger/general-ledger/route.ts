import type { NextRequest } from "next/server";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { formatEntryNumber } from "@/core/ledger/engine";
import { generalLedger } from "@/modules/ledger/reports";
import { csvResponse } from "@/lib/csv";
import { getTranslations } from "next-intl/server";
import { throttleResponse } from "@/core/ops/throttle";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx?.access || !ctx.administration || !ctx.mfaSatisfied) return new Response("Unauthorized", { status: 401 });
  const limited = await throttleResponse("export", ctx.user.id, ctx.access.organizationId);
  if (limited) return limited;
  const admin = ctx.administration;
  if (!can(ctx.access, "ledger.export", admin.companyId) && !can(ctx.access, "reports.export", admin.companyId)) return new Response("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const fy = ctx.fiscalYears.find((y) => y.id === sp.get("fiscalYearId")) ?? ctx.fiscalYear;
  const period = (k: string, d: number) => Math.min(13, Math.max(0, Number(sp.get(k) ?? d) || 0));
  const result = await withTenant(ctx.access, async (tx) => {
    const account = await tx.account.findFirst({ where: { id: sp.get("account") ?? "", administrationId: admin.id } });
    if (!account || !fy) return null;
    const gl = await generalLedger(tx, { administrationId: admin.id, fiscalYearId: fy.id, accountId: account.id, fromPeriod: period("fromPeriod", 0), toPeriod: period("toPeriod", 13) });
    await audit(tx, { organizationId: ctx.access!.organizationId, userId: ctx.user.id, action: "export.generalLedger", entity: "Account", entityId: account.id, details: { fiscalYear: fy.code } });
    return { account, gl };
  });
  if (!result || !fy) return new Response("Not found", { status: 404 });
  const { account, gl } = result;
  const t = await getTranslations();
  return csvResponse(`grootboek-${admin.code}-${account.number}-${fy.code}.csv`, [
    [t("ledger.entryDate"), t("ledger.number"), t("periods.period"), t("ledger.description"), t("ledger.currency"), t("ledger.original"), t("ledger.debit"), t("ledger.credit"), t("ledger.balance")],
    ["", "", "", t("ledger.openingBalance"), "", "", "", "", gl.opening],
    ...gl.lines.map((l) => [l.entryDate, formatEntryNumber(l.journalCode, fy.code, l.entryNumber), l.period, l.description, l.txCurrency, l.txAmount, l.debit, l.credit, l.balance]),
    ["", "", "", t("ledger.closingBalance"), "", "", "", "", gl.closing],
  ]);
}
