import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { Badge, Card, Dl, EmptyState, PageHeader, TextLink } from "@/components/ui/misc";
import { PeriodBadge } from "@/components/finance/period-badge";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp();
  const { denied } = await searchParams;

  const data = await withTenant(ctx.access, async (tx) => ({
    companies: await tx.company.count({ where: { status: "ACTIVE" } }),
    administrations: await tx.administration.count({ where: { status: { not: "ARCHIVED" } } }),
    members: await tx.organizationMembership.count({ where: { status: "ACTIVE" } }),
    periods: ctx.fiscalYear ? await tx.accountingPeriod.findMany({ where: { fiscalYearId: ctx.fiscalYear.id }, orderBy: { number: "asc" } }) : [],
  }));

  return (
    <>
      <PageHeader title={t("dashboard.title")} description={t("dashboard.welcome", { name: ctx.user.name })} />
      {denied && <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{t("errors.forbidden")}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["dashboard.companies", data.companies],
          ["dashboard.administrations", data.administrations],
          ["dashboard.members", data.members],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted-foreground">{t(label as string)}</p>
            <p className="amount mt-1 text-2xl font-semibold">{value as number}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title={t("dashboard.periodsTitle", { year: ctx.fiscalYear?.code ?? "—" })} description={ctx.administration ? `${ctx.administration.code} · ${ctx.administration.name}` : undefined}
          actions={ctx.administration && <TextLink href={`/app/administrations/${ctx.administration.id}`}>{t("dashboard.manage")}</TextLink>}>
          {data.periods.length === 0 ? (
            <EmptyState title={t("dashboard.noAdministration")} description={t("dashboard.noAdministrationHint")}
              action={can(ctx.access, "administrations.create", ctx.company?.id) ? <TextLink href="/onboarding">{t("dashboard.createAdministration")}</TextLink> : undefined} />
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.periods.map((p) => (
                <li key={p.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t(`periods.label${p.number === 0 ? "Opening" : p.number === 13 ? "YearEnd" : ""}`, { n: p.number })}</p>
                  <p className="text-sm font-medium">{p.number >= 1 && p.number <= 12 ? format.dateTime(p.startDate, { month: "long", timeZone: "UTC" }) : format.dateTime(p.startDate, { dateStyle: "medium", timeZone: "UTC" })}</p>
                  <div className="mt-1"><PeriodBadge status={p.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={t("dashboard.contextTitle")}>
            <Dl items={[
              [t("shell.organization"), ctx.organization.name],
              [t("shell.company"), ctx.company?.name],
              [t("shell.administration"), ctx.administration ? `${ctx.administration.name} (${ctx.administration.baseCurrency})` : null],
              [t("dashboard.role"), ctx.roleCode ? t(`roles.${ctx.roleCode}`) : null],
            ]} />
          </Card>
          <Card title={t("dashboard.nextTitle")}>
            <p className="text-sm text-muted-foreground">{t("dashboard.nextBody")}</p>
            <div className="mt-3"><Badge tone="info">{t("dashboard.phaseBadge")}</Badge></div>
          </Card>
        </div>
      </div>
    </>
  );
}
