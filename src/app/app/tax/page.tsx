import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { prepareReturnAction } from "@/actions/tax";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default async function TaxPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("tax.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const data = await withTenant(ctx.access, async (tx) => ({
    rules: await tx.taxRuleVersion.findMany({ orderBy: [{ taxType: "asc" }, { effectiveFrom: "desc" }] }),
    returns: await tx.taxReturn.findMany({ where: { administrationId: admin.id }, orderBy: [{ periodFrom: "desc" }], take: 60 }),
  }));
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const tone = { DRAFT: "warning", APPROVED: "info", FILED: "success" } as const;
  const ruleTone = { VERIFIED: "success", SOURCE_FOUND: "info", PENDING_VERIFICATION: "warning" } as const;
  const mayPrepare = can(ctx.access, "tax.edit", admin.companyId);

  return (
    <>
      <PageHeader title={t("tax.title")} description={t("tax.intro")} />
      <div role="note" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{t("tax.verificationNotice")}</div>

      <Card title={t("tax.returns")}>
        {data.returns.length === 0 ? <EmptyState title={t("tax.none")} /> : (
          <Table head={[t("tax.type"), t("tax.period"), t("common.status"), t("tax.amount")]}>
            {data.returns.map((r) => (
              <tr key={r.id}>
                <Td><TextLink href={`/app/tax/${r.id}`}>{t(`tax.types.${r.taxType}`)}</TextLink></Td>
                <Td>{r.periodFrom.getTime() === r.periodTo.getTime() ? date(r.periodFrom) : `${date(r.periodFrom)} – ${date(r.periodTo)}`}</Td>
                <Td><Badge tone={tone[r.status]}>{t(`tax.statuses.${r.status}`)}</Badge></Td>
                <Td className="amount text-right">{formatAmount(String((r.calculation as { payable?: string }).payable ?? "0"), admin.baseCurrency, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {mayPrepare && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card title={t("tax.types.BTW")} description={t("tax.btwIntro")}>
            <ActionForm action={prepareReturnAction}>
              <input type="hidden" name="administrationId" value={admin.id} /><input type="hidden" name="taxType" value="BTW" />
              <Field label={t("assets.month")} name="month"><Input type="month" name="month" defaultValue={thisMonth()} required /></Field>
              <SubmitButton>{t("tax.prepareBtw")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("tax.types.IB_RECHTSPERSONEN")} description={t("tax.ibIntro", { year: ctx.fiscalYear.code })}>
            <ActionForm action={prepareReturnAction}>
              <input type="hidden" name="administrationId" value={admin.id} /><input type="hidden" name="taxType" value="IB_RECHTSPERSONEN" /><input type="hidden" name="fiscalYearId" value={ctx.fiscalYear.id} />
              <SubmitButton>{t("tax.prepareIb")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("tax.types.DIVIDENDBELASTING")} description={t("tax.dividendIntro")}>
            <ActionForm action={prepareReturnAction}>
              <input type="hidden" name="administrationId" value={admin.id} /><input type="hidden" name="taxType" value="DIVIDENDBELASTING" /><input type="hidden" name="locale" value={locale} />
              <Field label={t("common.date")} name="date"><Input type="date" name="date" required /></Field>
              <Field label={t("tax.grossDividend")} name="gross"><Input name="gross" inputMode="decimal" required /></Field>
              <SubmitButton>{t("tax.prepareDividend")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title={t("tax.rules")} description={t("tax.rulesIntro")} className="mt-6">
        <Table head={[t("tax.type"), t("tax.effectiveFrom"), t("tax.parameters"), t("tax.legalStatus"), t("tax.source")]}>
          {data.rules.map((r) => (
            <tr key={r.id}>
              <Td>{t(`tax.types.${r.taxType}`)}</Td>
              <Td>{date(r.effectiveFrom)}</Td>
              <Td className="font-mono text-xs">{JSON.stringify(r.parameters)}</Td>
              <Td><Badge tone={ruleTone[r.legalStatus]}>{t(`tax.legal.${r.legalStatus}`)}</Badge></Td>
              <Td className="text-xs">{r.legalSource}{r.notes && <span className="block text-muted-foreground">{r.notes}</span>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
