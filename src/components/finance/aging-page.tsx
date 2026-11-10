import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { aging, controlAccountCheck } from "@/modules/invoicing/reports";
import { formatCell } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, EmptyState, PageHeader, TextLink } from "@/components/ui/misc";

/** Aging analysis for receivables or payables with configurable bucket boundaries (?buckets=30,60,90). */
export async function AgingPage({ side, sp }: { side: "RECEIVABLE" | "PAYABLE"; sp: Record<string, string | undefined> }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp(side === "RECEIVABLE" ? "sales.view" : "purchase.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf ?? "") ? sp.asOf! : new Date().toISOString().slice(0, 10);
  const parsed = (sp.buckets ?? "30,60,90").split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 3650);
  const bounds = [0, ...[...new Set(parsed)].sort((a, b) => a - b).slice(0, 6)];
  const { result, check } = await withTenant(ctx.access, async (tx) => ({
    result: await aging(tx, { administrationId: admin.id, side, asOf: new Date(`${asOf}T00:00:00Z`), boundaries: bounds }),
    check: can(ctx.access, "ledger.view", admin.companyId) ? await controlAccountCheck(tx, admin.id) : [],
  }));
  const heads = [t("invoicing.agingCurrent"), ...bounds.slice(1).map((b, i) => t("invoicing.agingRange", { from: bounds[i]! + 1, to: b })), t("invoicing.agingOver", { days: bounds[bounds.length - 1]! })];
  const diff = check.filter((c) => c.difference !== "0.00");
  const cell = "amount whitespace-nowrap px-3 py-2 text-right";

  return (
    <>
      <PageHeader title={t(side === "RECEIVABLE" ? "invoicing.receivablesTitle" : "invoicing.payablesTitle")} description={t("invoicing.agingAsOf", { date: asOf })}
        actions={check.length > 0 && (diff.length === 0 ? <Badge tone="success">{t("invoicing.subledgerOk")}</Badge> : <Badge tone="danger">{t("invoicing.subledgerDiff")}</Badge>)} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <input type="date" name="asOf" defaultValue={asOf} aria-label={t("invoicing.asOf")} className="h-9 rounded-lg border border-border px-2 text-sm" />
          <input name="buckets" defaultValue={bounds.slice(1).join(",")} aria-label={t("invoicing.bucketBoundaries")} title={t("invoicing.bucketBoundaries")} className="h-9 w-40 rounded-lg border border-border px-2 text-sm" />
          <button className={buttonClass("secondary", "sm")}>{t("common.show")}</button>
        </form>
        {result.rows.length === 0 ? <EmptyState title={t("invoicing.noOpenItems")} /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 pl-5 text-left font-medium">{t("invoicing.relation")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("ledger.currency")}</th>
                  {heads.map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
                  <th className="px-3 py-2 text-right font-medium">{t("ledger.total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((r) => (
                  <tr key={`${r.partyId}${r.currency}`}>
                    <td className="px-3 py-2 pl-5"><TextLink href={`/app/relations/${r.partyId}`}>{r.name}</TextLink></td>
                    <td className="px-3 py-2">{r.currency}</td>
                    {r.buckets.map((b, i) => <td key={i} className={`${cell} ${i >= 3 && !b.isZero() ? "text-danger" : ""}`}>{formatCell(b, locale)}</td>)}
                    <td className={`${cell} font-semibold`}>{formatCell(r.total, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {[...result.totals.entries()].map(([cur, tot]) => (
                  <tr key={cur} className="border-t-2 border-border font-semibold">
                    <td className="px-3 py-2 pl-5">{t("ledger.total")}</td><td className="px-3 py-2">{cur}</td>
                    {tot.map((v, i) => <td key={i} className={cell}>{formatCell(v, locale)}</td>)}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
        {diff.length > 0 && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {diff.map((d) => t("invoicing.subledgerDiffDetail", { account: `${d.number} ${d.name}`, ledger: d.ledger, subledger: d.subledger })).join(" · ")}
          </p>
        )}
      </Card>
    </>
  );
}
