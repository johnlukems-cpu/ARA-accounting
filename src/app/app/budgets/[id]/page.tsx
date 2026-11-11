import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { budgetVsActual, budgetableAccounts, reportVersion, rollingForecast } from "@/modules/budgets/service";
import { budgetWorkflowAction, distributeAction, importBudgetAction, saveCellsAction } from "@/actions/budgets";
import { formatAmount } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

type View = "edit" | "report" | "forecast";
const clamp = (v: string | undefined, d: number) => Math.min(12, Math.max(1, Number(v) || d));

export default async function BudgetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; v?: string; from?: string; to?: string; asOf?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp();
  const thisMonth = new Date().getUTCMonth() + 1;
  const from = clamp(sp.from, 1);
  const to = Math.max(from, clamp(sp.to, thisMonth));
  const asOf = clamp(sp.asOf, Math.max(1, thisMonth - 1));

  const data = await withTenant(ctx.access, async (tx) => {
    const budget = await tx.budget.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!budget) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: budget.administrationId } });
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: budget.fiscalYearId } });
    const version = budget.versions.find((v) => v.id === sp.v) ?? budget.versions[0]!;
    const view: View = sp.view === "report" || sp.view === "forecast" ? sp.view : version.status === "DRAFT" ? "edit" : "report";
    return {
      budget, admin, fy, version, view,
      accounts: await budgetableAccounts(tx, admin.id),
      lines: await tx.budgetLine.findMany({ where: { versionId: version.id } }),
      report: view === "report" ? await budgetVsActual(tx, { budgetId: budget.id, versionId: sp.v, fromPeriod: from, toPeriod: to }) : null,
      forecast: view === "forecast" ? await rollingForecast(tx, { budgetId: budget.id, versionId: sp.v, asOfPeriod: asOf }) : null,
      reportVersion: await reportVersion(tx, budget.id, sp.v),
    };
  });
  if (!data || !can(ctx.access, "budgets.view", data.admin.companyId)) notFound();
  const { budget, admin, fy, version, view, accounts, lines, report, forecast } = data;
  const companyId = admin.companyId;
  const money = (v: Decimal.Value) => formatAmount(String(v), admin.baseCurrency, locale);
  const cellValue = (accountId: string, p: number) => {
    const l = lines.find((x) => x.accountId === accountId && x.period === p && x.dimensionId === "");
    if (!l) return "";
    const s = new Decimal(l.amount.toString()).toFixed(2);
    return locale === "en" ? s : s.replace(".", ",");
  };
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthShort = (p: number) => t(`months.m${p}`).slice(0, 3);
  const editing = version.status === "DRAFT" && can(ctx.access, "budgets.edit", companyId);
  const tone = { DRAFT: "warning", SUBMITTED: "info", APPROVED: "success", SUPERSEDED: "neutral" } as const;
  const href = (extra: Record<string, string | number>) => `/app/budgets/${budget.id}?${new URLSearchParams(Object.entries({ v: sp.v ?? "", ...extra }).filter(([, x]) => x !== "").map(([k, x]) => [k, String(x)])).toString()}`;
  const glLink = (accountId: string, f: number, tt: number) => `/app/ledger/general-ledger?account=${accountId}&fiscalYearId=${fy.id}&fromPeriod=${f}&toPeriod=${tt}`;
  const pctText = (v: string | null) => (v === null ? t("budgets.na") : `${locale === "en" ? v : v.replace(".", ",")}%`);
  const signBadge = (fav: boolean | null) => (fav === null ? null : <Badge tone={fav ? "success" : "warning"}>{t(fav ? "budgets.favourable" : "budgets.unfavourable")}</Badge>);
  const hidden = <><input type="hidden" name="budgetId" value={budget.id} /><input type="hidden" name="versionId" value={version.id} /><input type="hidden" name="locale" value={locale} /></>;

  return (
    <>
      <PageHeader title={`${budget.name} · ${fy.code}`} description={`${t(`budgets.scenarios.${budget.scenario}`)} · ${t("budgets.threshold")}: ${budget.alertThresholdPct.toString()}%`}
        actions={<div className="flex items-center gap-2">
          <span className="text-sm">v{version.version}</span><Badge tone={tone[version.status]}>{t(`budgets.statuses.${version.status}`)}</Badge>
        </div>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {(["edit", "report", "forecast"] as const).map((v) => (
          <Link key={v} href={href({ view: v })} className={cn(buttonClass(view === v ? "primary" : "secondary", "sm"))}>{t(`budgets.views.${v}`)}</Link>
        ))}
        <span className="ml-auto text-muted-foreground">{t("budgets.versions")}:</span>
        {budget.versions.map((v) => <Link key={v.id} href={`/app/budgets/${budget.id}?v=${v.id}&view=${view}`} className={cn("rounded px-2 py-1", v.id === version.id ? "bg-muted font-medium" : "hover:underline")}>v{v.version} · {t(`budgets.statuses.${v.status}`)}</Link>)}
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          {version.status === "DRAFT" && can(ctx.access, "budgets.edit", companyId) && <ActionForm action={budgetWorkflowAction} className="space-y-0">{hidden}<input type="hidden" name="step" value="submit" /><SubmitButton variant="secondary">{t("budgets.submit")}</SubmitButton></ActionForm>}
          {version.status === "SUBMITTED" && can(ctx.access, "budgets.approve", companyId) && version.submittedById !== ctx.user.id && (
            <>
              <ActionForm action={budgetWorkflowAction} className="space-y-0">{hidden}<input type="hidden" name="step" value="approve" /><SubmitButton>{t("budgets.approve")}</SubmitButton></ActionForm>
              <ActionForm action={budgetWorkflowAction} className="flex gap-2 space-y-0">{hidden}<input type="hidden" name="step" value="return" /><Input name="reason" placeholder={t("periods.reasonPlaceholder")} aria-label={t("periods.reason")} className="h-9 w-56" /><SubmitButton variant="ghost">{t("budgets.return")}</SubmitButton></ActionForm>
            </>
          )}
          {(version.status === "APPROVED" || version.status === "SUPERSEDED") && !budget.versions.some((v) => v.status === "DRAFT" || v.status === "SUBMITTED") && can(ctx.access, "budgets.edit", companyId) && (
            <ActionForm action={budgetWorkflowAction} className="flex gap-2 space-y-0">{hidden}<input type="hidden" name="step" value="newVersion" /><Input name="notes" placeholder={t("budgets.newVersionNotes")} aria-label={t("budgets.newVersionNotes")} className="h-9 w-56" /><SubmitButton variant="secondary">{t("budgets.newVersion")}</SubmitButton></ActionForm>
          )}
          <p className="self-center text-xs text-muted-foreground">{t(`budgets.statusHelp.${version.status}`)}</p>
        </div>
      </Card>

      {view === "edit" && (
        <>
          <Card title={t("budgets.gridTitle")} description={editing ? t("budgets.gridIntro") : t("budgets.gridReadOnly")}>
            <ActionForm action={saveCellsAction}>
              {hidden}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[72rem] text-xs">
                  <thead><tr className="text-left text-muted-foreground"><th className="sticky left-0 bg-card p-1">{t("ledger.account")}</th>{months.map((p) => <th key={p} className="p-1 text-right">{monthShort(p)}</th>)}<th className="p-1 text-right">{t("common.total")}</th></tr></thead>
                  <tbody>
                    {accounts.map((a) => {
                      const total = lines.filter((l) => l.accountId === a.id).reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
                      return (
                        <tr key={a.id} className="border-t border-border">
                          <td className="sticky left-0 whitespace-nowrap bg-card p-1">{a.number} {a.name}</td>
                          {months.map((p) => (
                            <td key={p} className="p-0.5">
                              {editing
                                ? <input name={`c:${a.id}:${p}`} defaultValue={cellValue(a.id, p)} inputMode="decimal" aria-label={`${a.number} ${monthShort(p)}`} className="h-7 w-20 rounded border border-border bg-background px-1 text-right" />
                                : <span className="block text-right">{cellValue(a.id, p)}</span>}
                            </td>
                          ))}
                          <td className="amount p-1 text-right font-medium">{total.isZero() ? "" : money(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editing && <SubmitButton>{t("common.save")}</SubmitButton>}
            </ActionForm>
          </Card>
          {editing && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card title={t("budgets.distributeTitle")} description={t("budgets.distributeIntro")}>
                <ActionForm action={distributeAction} resetOnSuccess>
                  {hidden}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("ledger.account")} name="accountId" className="sm:col-span-3"><Select name="accountId" defaultValue="">{[<option key="" value="">—</option>, ...accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select></Field>
                    <Field label={t("budgets.yearAmount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
                    <Field label={t("budgets.method")} name="method" className="sm:col-span-2"><Select name="method" defaultValue="EVEN"><option value="EVEN">{t("budgets.methods.EVEN")}</option><option value="PRIOR_YEAR">{t("budgets.methods.PRIOR_YEAR")}</option></Select></Field>
                  </div>
                  <SubmitButton variant="secondary">{t("budgets.distribute")}</SubmitButton>
                </ActionForm>
              </Card>
              <Card title={t("budgets.importTitle")} description={t("budgets.importIntro")}>
                <ActionForm action={importBudgetAction} resetOnSuccess dataLabels={{ summary: t("budgets.importSummary") }}>
                  {hidden}
                  <Field label={t("industry.file")} name="file"><Input type="file" name="file" accept=".csv,.txt,text/csv" required /></Field>
                  <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">rekening;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec{"\n"}4100;2.000;2.000;…{"\n"}{t("budgets.importOr")}{"\n"}rekening;periode;bedrag{"\n"}8010;3;12.500,00</pre>
                  <SubmitButton variant="secondary">{t("industry.import")}</SubmitButton>
                </ActionForm>
              </Card>
            </div>
          )}
        </>
      )}

      {view === "report" && report && (
        <Card title={t("budgets.reportTitle")} description={report.version ? t("budgets.reportVersion", { version: report.version.version, status: t(`budgets.statuses.${report.version.status}`) }) : undefined}
          actions={
            <form className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="view" value="report" />{sp.v && <input type="hidden" name="v" value={sp.v} />}
              <select name="from" defaultValue={from} aria-label={t("periods.from")} className="h-8 rounded-md border border-border bg-background px-2">{months.map((p) => <option key={p} value={p}>{t(`months.m${p}`)}</option>)}</select>
              <span>–</span>
              <select name="to" defaultValue={to} aria-label={t("periods.to")} className="h-8 rounded-md border border-border bg-background px-2">{months.map((p) => <option key={p} value={p}>{t(`months.m${p}`)}</option>)}</select>
              <button className="h-8 rounded-md border border-border px-3">{t("common.show")}</button>
              <a className={buttonClass("ghost", "sm")} href={`/api/budgets/${budget.id}/report?from=${from}&to=${to}${sp.v ? `&v=${sp.v}` : ""}`}>{t("common.exportCsv")}</a>
            </form>
          }>
          {report.alerts.length > 0 && (
            <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-medium">{t("budgets.alertsTitle", { count: report.alerts.length, pct: budget.alertThresholdPct.toString() })}</p>
              <ul className="mt-1 list-disc pl-5">{report.alerts.map((a) => <li key={a.accountId}>{a.number} {a.name}: {money(a.variance)}{a.pct ? ` (${pctText(a.pct)})` : ""}</li>)}</ul>
            </div>
          )}
          <Table head={[t("ledger.account"), t("budgets.budget"), t("budgets.actual"), t("ledger.difference"), "%", t("budgets.utilisation"), ""]}>
            {report.rows.map((r) => (
              <tr key={r.accountId} className={r.alert ? "bg-amber-50/60 dark:bg-amber-950/40" : undefined}>
                <Td><TextLink href={glLink(r.accountId, from, to)}>{r.number} {r.name}</TextLink></Td>
                <Td className="amount text-right">{money(r.budget)}</Td>
                <Td className="amount text-right">{money(r.actual)}</Td>
                <Td className="amount text-right">{money(r.variance)}</Td>
                <Td className="text-right">{pctText(r.pct)}</Td>
                <Td className="text-right">{pctText(r.utilisation)}</Td>
                <Td>{signBadge(r.favourable)}</Td>
              </tr>
            ))}
            {report.categories.map((c) => (
              <tr key={c.category} className="border-t border-border text-muted-foreground"><Td>{t(`ledger.categories.${c.category}`)}</Td><Td className="amount text-right">{money(c.budget)}</Td><Td className="amount text-right">{money(c.actual)}</Td><Td colSpan={4} /></tr>
            ))}
            <tr className="border-t-2 border-border font-medium">
              <Td>{t("budgets.result")}</Td><Td className="amount text-right">{money(report.result.budget)}</Td><Td className="amount text-right">{money(report.result.actual)}</Td>
              <Td className="amount text-right">{money(report.result.variance)}</Td><Td className="text-right">{pctText(report.result.pct)}</Td><Td /><Td>{signBadge(report.result.favourable)}</Td>
            </tr>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">{t("budgets.reportNote")}</p>
        </Card>
      )}

      {view === "forecast" && forecast && (
        <Card title={t("budgets.forecastTitle")} description={t("budgets.forecastIntro")}
          actions={
            <form className="flex items-center gap-2 text-sm">
              <input type="hidden" name="view" value="forecast" />{sp.v && <input type="hidden" name="v" value={sp.v} />}
              <label htmlFor="asOf">{t("budgets.actualsThrough")}</label>
              <select id="asOf" name="asOf" defaultValue={asOf} className="h-8 rounded-md border border-border bg-background px-2">{months.map((p) => <option key={p} value={p}>{t(`months.m${p}`)}</option>)}</select>
              <button className="h-8 rounded-md border border-border px-3">{t("common.show")}</button>
            </form>
          }>
          <Table head={[t("ledger.account"), t("budgets.actualToDate"), t("budgets.remainingBudget"), t("budgets.forecast"), t("budgets.yearBudget"), t("ledger.difference"), ""]}>
            {forecast.rows.map((r) => (
              <tr key={r.accountId}>
                <Td><TextLink href={glLink(r.accountId, 1, asOf)}>{r.number} {r.name}</TextLink></Td>
                <Td className="amount text-right">{money(r.actualToDate)}</Td>
                <Td className="amount text-right">{money(r.remainingBudget)}</Td>
                <Td className="amount text-right font-medium">{money(r.forecast)}</Td>
                <Td className="amount text-right">{money(r.yearBudget)}</Td>
                <Td className="amount text-right">{money(r.variance)}</Td>
                <Td>{signBadge(r.favourable)}</Td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-medium"><Td>{t("budgets.result")}</Td><Td colSpan={2} /><Td className="amount text-right">{money(forecast.result.forecast)}</Td><Td className="amount text-right">{money(forecast.result.yearBudget)}</Td><Td colSpan={2} /></tr>
          </Table>
        </Card>
      )}
    </>
  );
}
