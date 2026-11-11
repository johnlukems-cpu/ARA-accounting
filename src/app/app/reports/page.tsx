import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { buildReports } from "@/modules/reporting/service";
import { cashForecast, SCENARIOS, type Scenario } from "@/modules/reporting/forecast";
import type { LineRow } from "@/modules/reporting/statements";
import { formatAmount } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const VIEWS = ["pl", "balance", "cashflow", "equity", "kpis", "forecast"] as const;
type View = (typeof VIEWS)[number];
const clamp = (v: string | undefined, d: number, min = 0) => Math.min(13, Math.max(min, Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d));
const today = () => new Date();

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; from?: string; to?: string; horizon?: string; scenario?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("reports.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const fy = ctx.fiscalYear;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "pl";
  const from = clamp(sp.from, 1);
  const to = Math.max(from, clamp(sp.to, 12));
  const horizon = [30, 90, 180, 365].includes(Number(sp.horizon)) ? Number(sp.horizon) : 90;
  const scenario: Scenario = sp.scenario === "BEST" || sp.scenario === "WORST" ? sp.scenario : "BASE";
  const data = await withTenant(ctx.access, async (tx) => ({
    r: view === "forecast" ? null : await buildReports(tx, { administrationId: admin.id, fiscalYearId: fy.id, fromPeriod: view === "balance" ? 0 : from, toPeriod: to }),
    f: view === "forecast" ? await cashForecast(tx, { administrationId: admin.id, today: today(), horizonDays: horizon, scenario }) : null,
  }));
  const money = (v: string) => formatAmount(v, admin.baseCurrency, locale);
  const qs = (extra: Record<string, string | number>) => `/app/reports?${new URLSearchParams(Object.entries({ view, from, to, ...extra }).map(([k, v]) => [k, String(v)])).toString()}`;
  const gl = (accountId: string) => `/app/ledger/general-ledger?account=${accountId}&fiscalYearId=${fy.id}&fromPeriod=${view === "balance" ? 0 : from}&toPeriod=${to}`;
  const r = data.r;
  const hasPrior = !!r?.priorYear;
  const head = [t("reports.item"), fy.code, ...(hasPrior ? [r!.priorYear!.code] : [])];
  const priorOf = (rows: LineRow[] | undefined, code: string) => rows?.find((x) => x.code === code)?.amount ?? "0.00";

  const lines = (rows: LineRow[], prior?: LineRow[]) => rows.filter((l) => l.amount !== "0.00" || priorOf(prior, l.code) !== "0.00").map((l) => (
    <tbody key={l.code}>
      <tr className="border-t border-border font-medium"><Td>{t(`reports.lines.${l.code}`)}</Td><Td className="amount text-right">{money(l.amount)}</Td>{hasPrior && <Td className="amount text-right text-muted-foreground">{money(priorOf(prior, l.code))}</Td>}</tr>
      {l.accounts.map((a) => <tr key={a.id} className="text-xs"><Td className="pl-6"><TextLink href={gl(a.id)}>{a.number} {a.name}</TextLink></Td><Td className="amount text-right">{money(a.amount)}</Td>{hasPrior && <Td />}</tr>)}
    </tbody>
  ));
  const totalRow = (label: string, cur: string, prior?: string) => (
    <tbody><tr className="border-t-2 border-border font-semibold"><Td>{label}</Td><Td className="amount text-right">{money(cur)}</Td>{hasPrior && <Td className="amount text-right text-muted-foreground">{money(prior ?? "0.00")}</Td>}</tr></tbody>
  );
  const table = (children: React.ReactNode) => (
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground">{head.map((h, i) => <th key={i} className={cn("px-3 py-2", i > 0 && "text-right")}>{h}</th>)}</tr></thead>{children}</table></div>
  );

  return (
    <>
      <PageHeader title={t("reports.title")} description={`${admin.code} · ${admin.name} · ${t("shell.fiscalYear")} ${fy.code}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => <Link key={v} href={qs({ view: v })} className={buttonClass(view === v ? "primary" : "secondary", "sm")}>{t(`reports.kinds.${v}`)}</Link>)}
      </div>

      {view !== "forecast" && r && (
        <Card actions={
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="view" value={view} />
            {view !== "balance" && <select name="from" defaultValue={from} aria-label={t("periods.from")} className="h-8 rounded-md border border-border bg-background px-2">{Array.from({ length: 14 }, (_, p) => <option key={p} value={p}>{t("reports.periodN", { n: p })}</option>)}</select>}
            <select name="to" defaultValue={to} aria-label={t("periods.to")} className="h-8 rounded-md border border-border bg-background px-2">{Array.from({ length: 14 }, (_, p) => <option key={p} value={p}>{t("reports.periodN", { n: p })}</option>)}</select>
            <button className="h-8 rounded-md border border-border px-3">{t("common.show")}</button>
            {can(ctx.access, "reports.export", admin.companyId) && <>
              <a className={buttonClass("ghost", "sm")} href={`/api/reports/${view}?format=pdf&from=${view === "balance" ? 0 : from}&to=${to}`}>PDF</a>
              <a className={buttonClass("ghost", "sm")} href={`/api/reports/${view}?format=csv&from=${view === "balance" ? 0 : from}&to=${to}`}>CSV</a>
              <a className={buttonClass("ghost", "sm")} href={`/api/reports/pack?format=pdf&from=${from}&to=${to}`}>{t("reports.pack")}</a>
            </>}
          </form>
        } title={t(`reports.kinds.${view}`)} description={view === "balance" ? t("reports.asOfPeriod", { n: to }) : t("reports.periodRange", { year: fy.code, from, to })}>
          {view === "pl" && table(<>
            {lines(r.pl.lines, r.priorPl?.lines)}
            {totalRow(t("reports.totals.grossMargin"), r.pl.totals.grossMargin, r.priorPl?.totals.grossMargin)}
            {totalRow(t("reports.totals.operatingResult"), r.pl.totals.operatingResult, r.priorPl?.totals.operatingResult)}
            {totalRow(t("reports.totals.resultBeforeTax"), r.pl.totals.resultBeforeTax, r.priorPl?.totals.resultBeforeTax)}
            {totalRow(t("reports.totals.netResult"), r.pl.totals.netResult, r.priorPl?.totals.netResult)}
          </>)}
          {view === "balance" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-2 font-semibold">{t("reports.assets")}</h3>{table(<>{lines(r.bs.assets, r.priorBs?.assets)}{totalRow(t("reports.totals.assets"), r.bs.totals.assets, r.priorBs?.totals.assets)}</>)}</div>
              <div><h3 className="mb-2 font-semibold">{t("reports.liabilities")}</h3>{table(<>
                {lines(r.bs.liabilities, r.priorBs?.liabilities)}
                <tbody><tr className="border-t border-border font-medium"><Td>{t("reports.resultYear")}</Td><Td className="amount text-right">{money(r.bs.result)}</Td>{hasPrior && <Td className="amount text-right text-muted-foreground">{money(r.priorBs?.result ?? "0.00")}</Td>}</tr></tbody>
                {totalRow(t("reports.totals.liabilitiesAndEquity"), r.bs.totals.liabilitiesAndEquity, r.priorBs?.totals.liabilitiesAndEquity)}
              </>)}</div>
              <p className="text-sm lg:col-span-2">{r.bs.balanced ? <Badge tone="success">{t("reports.balanced")}</Badge> : <Badge tone="warning">{t("reports.notBalanced")}</Badge>}</p>
            </div>
          )}
          {view === "cashflow" && (
            <Table head={[t("reports.item"), fy.code]}>
              {(["netResult", "depreciation", "workingCapital", "operating", "investing", "financing", "total", "openingCash", "closingCash"] as const).map((k) => {
                const v = { netResult: r.cashflow.netResult, depreciation: r.cashflow.depreciation, workingCapital: r.cashflow.workingCapitalChange, operating: r.cashflow.operating, investing: r.cashflow.investing, financing: r.cashflow.financing, total: r.cashflow.total, openingCash: r.cashflow.openingCash, closingCash: r.cashflow.closingCash }[k];
                const strong = ["operating", "investing", "financing", "total", "closingCash"].includes(k);
                return <tr key={k} className={strong ? "font-semibold" : undefined}><Td>{t(`reports.cf.${k}`)}</Td><Td className="amount text-right">{money(v)}</Td></tr>;
              })}
            </Table>
          )}
          {view === "cashflow" && <p className="mt-3 text-sm">{r.cashflow.reconciles ? <Badge tone="success">{t("reports.cfReconciles")}</Badge> : <Badge tone="warning">{t("reports.cfNotReconciled")}</Badge>} <span className="text-xs text-muted-foreground">{t("reports.cfNote")}</span></p>}
          {view === "equity" && (
            <Table head={[t("ledger.account"), t("reports.opening"), t("reports.movement"), t("reports.closing")]}>
              {r.equity.rows.map((e) => <tr key={e.id}><Td><TextLink href={gl(e.id)}>{e.number} {e.name}</TextLink></Td><Td className="amount text-right">{money(e.opening)}</Td><Td className="amount text-right">{money(e.movement)}</Td><Td className="amount text-right">{money(e.closing)}</Td></tr>)}
              <tr><Td>{t("reports.resultYear")}</Td><Td /><Td className="amount text-right">{money(r.equity.result)}</Td><Td className="amount text-right">{money(r.equity.result)}</Td></tr>
              <tr className="border-t-2 border-border font-semibold"><Td>{t("reports.totals.equity")}</Td><Td className="amount text-right">{money(r.equity.totals.opening)}</Td><Td /><Td className="amount text-right">{money(r.equity.totals.closing)}</Td></tr>
            </Table>
          )}
          {view === "kpis" && (
            <Table head={[t("reports.kpi"), t("reports.value"), t("reports.formula")]}>
              {r.kpis.map((k) => <tr key={k.code}><Td className="font-medium">{t(`industry.kpiNames.${k.code}` as never)}</Td><Td className="text-right">{k.value === null ? t("budgets.na") : `${locale === "en" ? k.value : k.value.replace(".", ",")}${k.unit === "%" ? "%" : k.unit === "x" ? "×" : k.unit === "days" ? ` ${t("reports.days")}` : ""}`}</Td><Td className="text-xs text-muted-foreground">{k.formula} · {t("reports.periodRange", { year: fy.code, from, to })}</Td></tr>)}
            </Table>
          )}
          <p className="mt-4 text-xs text-muted-foreground">{t("reports.basis")} · {t("reports.fingerprint")}: <code>{r.fingerprint.slice(0, 16)}</code> ({r.entryCount} {t("reports.entries")})</p>
        </Card>
      )}

      {view === "forecast" && data.f && (
        <Card title={t("reports.kinds.forecast")} description={t("reports.forecastIntro")} actions={
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="view" value="forecast" />
            <select name="horizon" defaultValue={horizon} aria-label={t("reports.horizon")} className="h-8 rounded-md border border-border bg-background px-2">{[30, 90, 180, 365].map((d) => <option key={d} value={d}>{t("reports.horizonDays", { n: d })}</option>)}</select>
            <select name="scenario" defaultValue={scenario} aria-label={t("budgets.scenario")} className="h-8 rounded-md border border-border bg-background px-2">{Object.keys(SCENARIOS).map((s) => <option key={s} value={s}>{t(`budgets.scenarios.${s}`)}</option>)}</select>
            <button className="h-8 rounded-md border border-border px-3">{t("common.show")}</button>
          </form>
        }>
          <p className="mb-3 text-sm"><Badge tone="info">{t("reports.forecastLabel")}</Badge> {t("reports.openingCashToday")}: <strong>{money(data.f.openingCash)}</strong></p>
          <Table head={[t("reports.bucket"), t("reports.receipts"), t("reports.payments"), t("reports.budgetNet"), t("reports.net"), t("reports.expectedCash")]}>
            {data.f.buckets.map((b) => (
              <tr key={b.index}><Td>{b.from} – {b.to}</Td><Td className="amount text-right">{money(b.receipts)}</Td><Td className="amount text-right">{money(b.payments)}</Td><Td className="amount text-right">{money(b.budget)}</Td><Td className="amount text-right">{money(b.net)}</Td><Td className={cn("amount text-right font-medium", b.closing.startsWith("-") && "text-red-700 dark:text-red-400")}>{money(b.closing)}</Td></tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">{t("reports.assumptions", { delay: data.f.assumptions.collectionDelayDays, pct: data.f.assumptions.collectedPct, payDelay: data.f.assumptions.paymentDelayDays })}</p>
        </Card>
      )}
    </>
  );
}
