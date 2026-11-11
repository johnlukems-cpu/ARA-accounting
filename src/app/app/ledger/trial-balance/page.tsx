import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { trialBalance } from "@/modules/ledger/reports";
import { trialBalanceSchema } from "@/modules/ledger/schemas";
import { formatCell } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("ledger.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const sp = await searchParams;
  const f = trialBalanceSchema.parse({ ...sp, hideZero: sp.hideZero !== "0" });
  const fiscalYearId = ctx.fiscalYears.some((y) => y.id === f.fiscalYearId) ? f.fiscalYearId! : ctx.fiscalYear.id;
  const fy = ctx.fiscalYears.find((y) => y.id === fiscalYearId)!;
  const from = Math.min(f.fromPeriod, f.toPeriod);
  const to = Math.max(f.fromPeriod, f.toPeriod);

  const { tb, journals } = await withTenant(ctx.access, async (tx) => ({
    tb: await trialBalance(tx, { administrationId: admin.id, fiscalYearId, fromPeriod: from, toPeriod: to, accountFrom: f.accountFrom || undefined, accountTo: f.accountTo || undefined, journalId: f.journalId || undefined, hideZero: f.hideZero }),
    journals: await tx.journal.findMany({ where: { administrationId: admin.id }, orderBy: { code: "asc" } }),
  }));
  const query = new URLSearchParams({ fiscalYearId, fromPeriod: String(from), toPeriod: String(to), ...(f.accountFrom ? { accountFrom: f.accountFrom } : {}), ...(f.accountTo ? { accountTo: f.accountTo } : {}), ...(f.journalId ? { journalId: f.journalId } : {}), hideZero: f.hideZero ? "1" : "0" });
  const periods = Array.from({ length: 14 }, (_, n) => n);
  const cell = "amount whitespace-nowrap px-3 py-2 text-right";

  return (
    <>
      <PageHeader
        title={t("ledger.trialBalanceTitle")}
        description={`${admin.code} · ${admin.name} · ${t("shell.fiscalYear")} ${fy.code} · ${t("ledger.periodsRange", { from, to })} · ${admin.baseCurrency}`}
        actions={
          <div className="flex items-center gap-2">
            {tb.balanced ? <Badge tone="success">{t("ledger.tbBalanced")}</Badge> : <Badge tone="danger">{t("ledger.tbUnbalanced")}</Badge>}
            {(can(ctx.access, "ledger.export", admin.companyId) || can(ctx.access, "reports.export", admin.companyId)) && (
              <a className={buttonClass("secondary", "sm")} href={`/api/ledger/trial-balance?${query}`}>{t("common.exportCsv")}</a>
            )}
          </div>
        }
      />
      <Card>
        <form className="mb-4 flex flex-wrap items-center gap-2 [&>input]:w-28">
          <select name="fiscalYearId" defaultValue={fiscalYearId} aria-label={t("shell.fiscalYear")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {ctx.fiscalYears.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
          <select name="fromPeriod" defaultValue={from} aria-label={t("ledger.fromPeriod")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {periods.map((p) => <option key={p} value={p}>{t("ledger.fromPeriodShort", { p })}</option>)}
          </select>
          <select name="toPeriod" defaultValue={to} aria-label={t("ledger.toPeriod")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {periods.map((p) => <option key={p} value={p}>{t("ledger.toPeriodShort", { p })}</option>)}
          </select>
          <input name="accountFrom" defaultValue={f.accountFrom} placeholder={t("ledger.accountFrom")} aria-label={t("ledger.accountFrom")} className="h-9 rounded-lg border border-border px-2 text-sm" />
          <input name="accountTo" defaultValue={f.accountTo} placeholder={t("ledger.accountTo")} aria-label={t("ledger.accountTo")} className="h-9 rounded-lg border border-border px-2 text-sm" />
          <select name="journalId" defaultValue={f.journalId ?? ""} aria-label={t("ledger.journal")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.allJournals")}</option>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}
          </select>
          <select name="hideZero" defaultValue={f.hideZero ? "1" : "0"} aria-label={t("ledger.hideZero")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="1">{t("ledger.hideZero")}</option>
            <option value="0">{t("ledger.showAll")}</option>
          </select>
          <button className={buttonClass("secondary", "sm")}>{t("common.filter")}</button>
        </form>

        {tb.rows.length === 0 ? (
          <EmptyState title={t("ledger.tbEmpty")} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th rowSpan={2} className="px-3 py-2 pl-5 text-left font-medium">{t("ledger.number")}</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium">{t("ledger.accountName")}</th>
                  <th colSpan={2} className="border-l border-border px-3 py-1 text-center font-medium">{t("ledger.opening")}</th>
                  <th colSpan={2} className="border-l border-border px-3 py-1 text-center font-medium">{t("ledger.movement")}</th>
                  <th colSpan={2} className="border-l border-border px-3 py-1 text-center font-medium">{t("ledger.closing")}</th>
                </tr>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  {[0, 1, 2].flatMap((i) => [
                    <th key={`d${i}`} className="border-l border-border px-3 py-1 text-right font-medium">{t("ledger.debit")}</th>,
                    <th key={`c${i}`} className="px-3 py-1 text-right font-medium">{t("ledger.credit")}</th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tb.rows.map((r) => (
                  <tr key={r.accountId} className="hover:bg-muted/50">
                    <td className="amount px-3 py-2 pl-5">
                      <Link className="text-accent hover:underline" href={`/app/ledger/general-ledger?account=${r.accountId}&fiscalYearId=${fiscalYearId}&fromPeriod=${from}&toPeriod=${to}`}>{r.number}</Link>
                    </td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className={`${cell} border-l border-border`}>{formatCell(r.openingDebit, locale)}</td>
                    <td className={cell}>{formatCell(r.openingCredit, locale)}</td>
                    <td className={`${cell} border-l border-border`}>{formatCell(r.periodDebit, locale)}</td>
                    <td className={cell}>{formatCell(r.periodCredit, locale)}</td>
                    <td className={`${cell} border-l border-border`}>{formatCell(r.closingDebit, locale)}</td>
                    <td className={cell}>{formatCell(r.closingCredit, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-2 pl-5" colSpan={2}>{t("ledger.total")}</td>
                  {[tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.periodDebit, tb.totals.periodCredit, tb.totals.closingDebit, tb.totals.closingCredit].map((v, i) => (
                    <td key={i} className={`${cell} ${i % 2 === 0 ? "border-l border-border" : ""}`}>{formatCell(v, locale)}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
