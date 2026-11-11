import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { LIMIT_KEYS, accessState, usage, type Limits } from "@/modules/saas/service";
import { formatAmount } from "@/lib/format";
import { paymentInstructions } from "@/modules/readiness/service";
import { PlanCards } from "@/components/platform/plan-cards";
import { Badge, Card, Dl, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function SubscriptionPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("organization.view");
  const org = ctx.organization;
  const data = await withTenant(ctx.access, async (tx) => ({
    plan: org.planId ? await tx.plan.findUnique({ where: { id: org.planId } }) : null,
    usage: await usage(tx, org.id),
    invoices: await tx.subscriptionInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    plans: await tx.plan.findMany({ where: { status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  }));
  const instructions = await paymentInstructions();
  const state = accessState(org);
  const limits = (data.plan?.limits as Limits) ?? {};
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");

  return (
    <>
      <PageHeader title={t("saas.title")} description={t("saas.intro")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("saas.status")}>
          <Dl items={[
            [t("common.status"), <Badge key="s" tone={state.readOnly ? "warning" : "success"}>{t(`saas.statuses.${org.status}`)}</Badge>],
            [t("saas.plan"), data.plan?.name ?? t("saas.noPlan")],
            [t("saas.trialEnds"), date(org.trialEndsAt)],
            ...(org.statusReason ? [[t("saas.reason"), org.statusReason] as [string, string]] : []),
          ]} />
          {state.readOnly && <p className="mt-3 text-sm">{t(`saas.banner.${state.reason}` as never)}</p>}
        </Card>
        <Card title={t("saas.usage")}>
          <Table head={[t("saas.item"), t("saas.used"), t("saas.limit")]}>
            {LIMIT_KEYS.map((k) => <tr key={k}><Td>{t(`saas.limits.${k}`)}</Td><Td>{data.usage[k]}</Td><Td>{limits[k] ?? t("saas.unlimited")}</Td></tr>)}
          </Table>
        </Card>
      </div>
      <Card title={t("plans.availableTitle")} description={t("plans.availableIntro")} className="mt-6">
        <PlanCards plans={data.plans} currentPlanId={org.planId} />
      </Card>
      <Card title={t("saas.invoices")} description={t("saas.paymentInfo")} className="mt-6">
        <div className="mb-4 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">{t("plans.paymentTitle")}</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{instructions ?? t("plans.paymentPending")}</p>
        </div>
        {data.invoices.length === 0 ? <p className="text-sm text-muted-foreground">{t("saas.noInvoices")}</p> : (
          <Table head={[t("ledger.number"), t("tax.period"), t("common.amount"), t("common.status")]}>
            {data.invoices.map((i) => <tr key={i.id}><Td>{i.number}</Td><Td>{date(i.periodFrom)} – {date(i.periodTo)}</Td><Td className="amount text-right">{formatAmount(i.amount.toString(), i.currency, locale)}</Td><Td><Badge tone={i.status === "PAID" ? "success" : i.status === "OPEN" ? "warning" : "neutral"}>{t(`saas.invoiceStatuses.${i.status}`)}</Badge></Td></tr>)}
          </Table>
        )}
      </Card>
    </>
  );
}
