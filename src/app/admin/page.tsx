import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { dashboard } from "@/modules/admin/metrics";
import { completeTaskAction } from "@/actions/admin";
import { formatAmount } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { BarChart, Kpi } from "@/components/admin/charts";

/** Executive dashboard of ARA Intelligent Solutions — every figure from database records. */
export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin();
  const sp = await searchParams;
  const d = await withTenant(a.access, (tx) => dashboard(tx, a.home));
  const m = (v: string) => formatAmount(v, d.baseCurrency, locale);
  const n = (v: number) => format.number(v);

  return (
    <>
      <PageHeader title={t("admin.dashboard.title")} description={t("admin.dashboard.intro", { name: a.user.name })} />
      {sp.denied && <p role="alert" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t("admin.denied")}</p>}
      {a.mfaReminder && <p role="alert" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t("account.mfaRequiredBanner")} <Link href="/app/account" className="underline">{t("account.setUpMfa")}</Link></p>}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.customersTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("admin.kpi.customers")} value={n(d.customers.total)} hint={t("admin.kpi.leads", { n: d.customers.leads })} />
        <Kpi label={t("admin.kpi.activeCustomers")} value={n(d.customers.active)} hint={t("admin.kpi.activeHint")} />
        <Kpi label={t("admin.kpi.newCustomers")} value={n(d.customers.newThisMonth)} hint={t("admin.kpi.thisMonth")} />
        <Kpi label={t("admin.kpi.subscriptions")} value={n(d.subscriptions.total)} hint={t("admin.kpi.subsBreakdown", { active: d.subscriptions.active, trial: d.subscriptions.trial, cancelled: d.subscriptions.cancelled })} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.recurringTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.subscriptions.mrr.length === 0 ? <Kpi label={t("admin.kpi.mrr")} value="—" hint={t("admin.kpi.noActiveSubs")} /> : d.subscriptions.mrr.map((r) => (
          <Kpi key={r.currency} label={`${t("admin.kpi.mrr")} (${r.currency})`} value={formatAmount(r.mrr, r.currency, locale)} hint={`${t("admin.kpi.arr")}: ${formatAmount(r.arr, r.currency, locale)}`} />
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.dashboard.moneyTitle", { year: new Date().getUTCFullYear(), currency: d.baseCurrency })}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("admin.kpi.invoiced")} value={m(d.money.invoicedYear)} hint={t("admin.kpi.invoicedHint")} />
        <Kpi label={t("admin.kpi.collected")} value={m(d.money.collectedYear)} hint={t("admin.kpi.collectedHint")} />
        <Kpi label={t("admin.kpi.outstanding")} value={m(d.money.outstanding)} hint={t("admin.kpi.outstandingHint")} />
        <Kpi label={t("admin.kpi.overdue")} value={m(d.money.overdue)} hint={t("admin.kpi.overdueHint", { n: d.money.overdueCount })} tone={d.money.overdueCount ? "danger" : undefined} />
        <Kpi label={t("admin.kpi.accountingRevenue")} value={m(d.money.accountingRevenue)} hint={t("admin.kpi.accountingHint", { year: d.money.fiscalYear ?? "—" })} />
        <Kpi label={t("admin.kpi.expenses")} value={m(d.money.expensesYear)} hint={t("admin.kpi.accountingHint", { year: d.money.fiscalYear ?? "—" })} />
        <Kpi label={t("admin.kpi.operatingResult")} value={m(d.money.operatingResult)} tone={Number(d.money.operatingResult) < 0 ? "danger" : "success"} hint={t("admin.kpi.accountingHint", { year: d.money.fiscalYear ?? "—" })} />
        <Kpi label={t("admin.kpi.cash")} value={m(d.money.cash)} hint={t("admin.kpi.cashHint")} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title={t("admin.charts.revenue")} description={t("admin.charts.revenueIntro")}>
          <BarChart data={d.series} label={t("admin.charts.revenue")} format={(v) => formatAmount(v.toFixed(2), d.baseCurrency, locale)} series={[{ key: "invoiced", label: t("admin.kpi.invoiced"), className: "fill-primary" }, { key: "collected", label: t("admin.kpi.collected"), className: "fill-accent" }]} />
        </Card>
        <Card title={t("admin.charts.expenses")} description={t("admin.charts.expensesIntro")}>
          <BarChart data={d.series} label={t("admin.charts.expenses")} format={(v) => formatAmount(v.toFixed(2), d.baseCurrency, locale)} series={[{ key: "expenses", label: t("admin.kpi.expenses"), className: "fill-warning" }]} />
        </Card>
        <Card title={t("admin.charts.subscriptions")}>
          <BarChart data={d.series} label={t("admin.charts.subscriptions")} format={(v) => String(v)} series={[{ key: "activeSubscriptions", label: t("admin.charts.activeSubs"), className: "fill-primary" }, { key: "newSubscriptions", label: t("admin.charts.newSubs"), className: "fill-accent" }]} />
        </Card>
        <Card title={t("admin.charts.customers")}>
          <BarChart data={d.customerGrowth} label={t("admin.charts.customers")} format={(v) => String(v)} series={[{ key: "customers", label: t("admin.kpi.customers"), className: "fill-primary" }]} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title={t("admin.dashboard.attention")}>
          <ul className="space-y-2 text-sm">
            <li><Link href="/admin/payments?status=PENDING" className="hover:underline">{t("admin.dashboard.pendingPayments", { n: d.work.pendingPayments })}</Link></li>
            <li><Link href="/admin/invoices?status=draft" className="hover:underline">{t("admin.dashboard.draftInvoices", { n: d.work.draftInvoices })}</Link></li>
            <li><Link href="/admin/support" className="hover:underline">{t("admin.dashboard.openTickets", { n: d.work.openTickets })}</Link></li>
            <li><Link href="/admin/subscriptions?status=TRIAL" className="hover:underline">{t("admin.dashboard.expiredTrials", { n: d.work.expiredTrials })}</Link></li>
          </ul>
        </Card>
        <Card title={t("admin.dashboard.tasks")}>
          {d.work.tasks.length === 0 ? <EmptyState title={t("admin.dashboard.noTasks")} /> : (
            <ul className="space-y-2 text-sm">
              {d.work.tasks.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-2">
                  <span><Link href={`/admin/customers/${x.customer.id}`} className="font-medium hover:underline">{x.subject}</Link><span className="block text-xs text-muted-foreground">{x.customer.name}{x.dueDate ? ` · ${format.dateTime(x.dueDate, { dateStyle: "short" })}` : ""}</span></span>
                  <ActionForm action={completeTaskAction} className="space-y-0"><input type="hidden" name="activityId" value={x.id} /><input type="hidden" name="customerId" value={x.customer.id} /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{t("practice.done")}</SubmitButton></ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("admin.dashboard.recent")}>
          <ul className="space-y-2 text-sm">
            {d.work.recent.map((x) => (
              <li key={x.id}><Badge>{t(`admin.activityTypes.${x.type}`)}</Badge> <Link href={`/admin/customers/${x.customer.id}`} className="hover:underline">{x.subject}</Link><span className="block text-xs text-muted-foreground">{x.customer.name} · {format.dateTime(x.createdAt, { dateStyle: "short", timeStyle: "short" })}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
