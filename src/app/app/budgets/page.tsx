import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createBudgetAction } from "@/actions/budgets";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function BudgetsPage() {
  const t = await getTranslations();
  const ctx = await requireApp("budgets.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const data = await withTenant(ctx.access, async (tx) => ({
    budgets: await tx.budget.findMany({ where: { administrationId: admin.id }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: [{ createdAt: "desc" }] }),
    years: await tx.fiscalYear.findMany({ where: { administrationId: admin.id }, orderBy: { startDate: "desc" } }),
  }));
  const yearCode = new Map(data.years.map((y) => [y.id, y.code]));
  const tone = { DRAFT: "warning", SUBMITTED: "info", APPROVED: "success", SUPERSEDED: "neutral" } as const;

  return (
    <>
      <PageHeader title={t("budgets.title")} description={t("budgets.intro")} />
      <Card>
        {data.budgets.length === 0 ? <EmptyState title={t("budgets.none")} /> : (
          <Table head={[t("company.name"), t("shell.fiscalYear"), t("budgets.scenario"), t("budgets.version"), t("common.status")]}>
            {data.budgets.map((b) => {
              const v = b.versions[0];
              return (
                <tr key={b.id}>
                  <Td><TextLink href={`/app/budgets/${b.id}`}>{b.name}</TextLink></Td>
                  <Td>{yearCode.get(b.fiscalYearId)}</Td>
                  <Td>{t(`budgets.scenarios.${b.scenario}`)}</Td>
                  <Td>{v ? `v${v.version}` : "—"}</Td>
                  <Td>{v && <Badge tone={tone[v.status]}>{t(`budgets.statuses.${v.status}`)}</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {can(ctx.access, "budgets.create", admin.companyId) && (
        <Card title={t("budgets.createTitle")} description={t("budgets.createIntro")} className="mt-6">
          <ActionForm action={createBudgetAction}>
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("company.name")} name="name"><Input name="name" required defaultValue={t("budgets.defaultName")} /></Field>
              <Field label={t("shell.fiscalYear")} name="fiscalYearId"><Select name="fiscalYearId" defaultValue={ctx.fiscalYear?.id ?? data.years[0]?.id}>{data.years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}</Select></Field>
              <Field label={t("budgets.scenario")} name="scenario"><Select name="scenario" defaultValue="BASE">{["BASE", "BEST", "WORST"].map((s) => <option key={s} value={s}>{t(`budgets.scenarios.${s}`)}</option>)}</Select></Field>
              <Field label={t("budgets.basis")} name="basis"><Select name="basis" defaultValue="MANUAL">{["MANUAL", "PRIOR_ACTUALS", "PRIOR_BUDGET"].map((s) => <option key={s} value={s}>{t(`budgets.bases.${s}`)}</option>)}</Select></Field>
              <Field label={t("budgets.adjustment")} name="adjustmentPct" hint={t("budgets.adjustmentHint")}><Input name="adjustmentPct" inputMode="decimal" defaultValue="0" /></Field>
              <Field label={t("budgets.threshold")} name="alertThresholdPct" hint={t("budgets.thresholdHint")}><Input name="alertThresholdPct" inputMode="decimal" defaultValue="10" /></Field>
            </div>
            <SubmitButton>{t("budgets.create")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
