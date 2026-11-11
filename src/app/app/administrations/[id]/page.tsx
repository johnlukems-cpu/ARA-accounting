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
import { upgradeProposal } from "@/modules/industry/service";
import { applyUpgradeAction } from "@/actions/industry";

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
  const proposal = await withTenant(ctx.access, (tx) => upgradeProposal(tx, admin.id));
  const maySettings = can(ctx.access, "administrations.manageSettings", admin.companyId);
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
          [t("industry.wizardLabel"), proposal ? <TextLink key="tpl" href={`/app/templates/${proposal.current.templateId}`}>{`${proposal.current.template.name} · v${proposal.current.version}`}</TextLink> : "—"],
        ]} />
      </Card>

      {proposal?.latest && proposal.diff && (
        <Card title={t("industry.upgradeTitle", { version: proposal.latest.version })} description={t("industry.upgradeIntro")} className="mb-6">
          <ActionForm action={applyUpgradeAction}>
            <input type="hidden" name="administrationId" value={admin.id} />
            <input type="hidden" name="targetVersionId" value={proposal.latest.id} />
            {proposal.latest.changelog && <p className="text-sm">{proposal.latest.changelog}</p>}
            <div className="space-y-1 text-sm">
              {proposal.diff.newAccounts.map((a) => (
                <label key={a.ref} className="flex items-center gap-2">
                  <input type="checkbox" name="accounts" value={a.ref} defaultChecked={!proposal.conflicts.includes(a.number)} disabled={proposal.conflicts.includes(a.number)} />
                  <span>{t("industry.upgradeNewAccount", { number: a.number, name: a.name })}{proposal.conflicts.includes(a.number) && ` — ${t("industry.upgradeConflict")}`}</span>
                </label>
              ))}
              {proposal.diff.newJournals.map((j) => <label key={j.code} className="flex items-center gap-2"><input type="checkbox" name="journals" value={j.code} defaultChecked /><span>{t("industry.upgradeNewJournal", { code: j.code, name: j.name })}</span></label>)}
              {proposal.diff.newAssetCategories.map((c) => <label key={c.code} className="flex items-center gap-2"><input type="checkbox" name="assetCategories" value={c.code} defaultChecked /><span>{t("industry.upgradeNewCategory", { code: c.code, name: c.name })}</span></label>)}
              {proposal.diff.newDimensions.map((d) => <label key={`${d.type}:${d.code}`} className="flex items-center gap-2"><input type="checkbox" name="dimensions" value={`${d.type}:${d.code}`} defaultChecked /><span>{t("industry.upgradeNewDimension", { code: d.code, name: d.name })}</span></label>)}
            </div>
            {(proposal.diff.changedAccounts.length > 0 || proposal.diff.removedAccounts.length > 0) && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-medium">{t("industry.upgradeInfoOnly")}</p>
                {proposal.diff.changedAccounts.map((c) => <div key={c.to.ref}>{t("industry.upgradeChanged", { number: c.to.number, from: c.from.name, to: c.to.name })}</div>)}
                {proposal.diff.removedAccounts.map((a) => <div key={a.ref}>{t("industry.upgradeRemoved", { number: a.number, name: a.name })}</div>)}
              </div>
            )}
            {maySettings && <SubmitButton>{t("industry.upgradeApply")}</SubmitButton>}
          </ActionForm>
        </Card>
      )}

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
