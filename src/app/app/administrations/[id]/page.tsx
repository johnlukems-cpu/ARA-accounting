import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createNextFiscalYearAction, setPeriodStatusAction } from "@/actions/organization";
import { ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, Dl, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";
import { PeriodBadge } from "@/components/finance/period-badge";

export default async function AdministrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp();

  const admin = await withTenant(ctx.access, (tx) =>
    tx.administration.findUnique({
      where: { id },
      include: { company: true, fiscalYears: { orderBy: { startDate: "desc" }, include: { periods: { orderBy: { number: "asc" } } } } },
    }),
  );
  if (!admin || !can(ctx.access, "administrations.view", admin.companyId)) notFound();
  const mayClose = can(ctx.access, "periods.close", admin.companyId);
  const mayEdit = can(ctx.access, "administrations.edit", admin.companyId);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={`${admin.code} · ${admin.name}`}
        description={<TextLink href={`/app/companies/${admin.companyId}`}>{admin.company.name}</TextLink>}
        actions={
          mayEdit && (
            <form action={createNextFiscalYearAction}>
              <input type="hidden" name="administrationId" value={admin.id} />
              <button className={buttonClass("secondary", "sm")}>{t("fiscalYear.addNext")}</button>
            </form>
          )
        }
      />
      <Card title={t("administration.details")} className="mb-6">
        <Dl items={[
          [t("administration.baseCurrency"), admin.baseCurrency],
          [t("common.status"), t(`administration.statuses.${admin.status}`)],
          [t("administration.chartOfAccounts"), t("administration.chartOfAccountsPending")],
        ]} />
      </Card>

      <div className="space-y-6">
        {admin.fiscalYears.map((fy) => (
          <Card key={fy.id} title={`${t("shell.fiscalYear")} ${fy.code}`} description={`${date(fy.startDate)} – ${date(fy.endDate)}`}
            actions={<Badge tone={fy.status === "OPEN" ? "success" : "neutral"}>{t(`fiscalYear.statuses.${fy.status}`)}</Badge>}>
            <Table head={[t("periods.period"), t("periods.from"), t("periods.to"), t("common.status"), mayClose ? t("periods.change") : ""]}>
              {fy.periods.map((p) => (
                <tr key={p.id}>
                  <Td>{t(`periods.label${p.number === 0 ? "Opening" : p.number === 13 ? "YearEnd" : ""}`, { n: p.number })}</Td>
                  <Td>{date(p.startDate)}</Td>
                  <Td>{date(p.endDate)}</Td>
                  <Td><PeriodBadge status={p.status} /></Td>
                  <Td>
                    {mayClose && fy.status !== "CLOSED" && (
                      <ActionForm action={setPeriodStatusAction} className="flex flex-wrap items-center gap-2 space-y-0">
                        <input type="hidden" name="periodId" value={p.id} />
                        <Select name="status" defaultValue={p.status} className="h-8 w-36 text-xs" aria-label={t("common.status")}>
                          {["OPEN", "SOFT_CLOSED", "CLOSED"].map((s) => <option key={s} value={s}>{t(`periods.status.${s}`)}</option>)}
                        </Select>
                        <Input name="reason" placeholder={t("periods.reasonPlaceholder")} className="h-8 w-44 text-xs" aria-label={t("periods.reason")} />
                        <SubmitButton variant="secondary" className="h-8 px-3 text-xs">{t("common.apply")}</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}
