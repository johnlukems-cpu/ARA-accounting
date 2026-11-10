import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createDimensionAction, saveJournalAction } from "@/actions/ledger";
import { JOURNAL_TYPES } from "@/modules/ledger/schemas";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/** Journals and analysis dimensions (cost centres, projects, departments) of the active administration. */
export default async function JournalsPage() {
  const t = await getTranslations();
  const ctx = await requireApp("ledger.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const { journals, dimensions } = await withTenant(ctx.access, async (tx) => ({
    journals: await tx.journal.findMany({ where: { administrationId: admin.id }, include: { _count: { select: { entries: true } } }, orderBy: { code: "asc" } }),
    dimensions: await tx.dimensionValue.findMany({ where: { administrationId: admin.id }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
  }));
  const mayEdit = can(ctx.access, "administrations.edit", admin.companyId);

  return (
    <>
      <PageHeader title={t("ledger.journalsTitle")} description={`${admin.code} · ${admin.name}`} />
      <Card>
        <Table head={[t("administration.code"), t("company.name"), t("ledger.journalType"), t("ledger.approval"), t("ledger.entriesCount"), ""]}>
          {journals.map((j) => (
            <tr key={j.id}>
              <Td className="font-medium">{j.code}</Td>
              <Td>{j.name}</Td>
              <Td className="text-xs">{t(`ledger.journalTypes.${j.type}`)}</Td>
              <Td>{j.requiresApproval ? <Badge tone="warning">{t("ledger.approvalRequiredShort")}</Badge> : ""}</Td>
              <Td className="amount">{j._count.entries}</Td>
              <Td>
                {mayEdit && (
                  <details>
                    <summary className="cursor-pointer text-xs text-accent">{t("common.edit")}</summary>
                    <ActionForm action={saveJournalAction} className="mt-2 w-72 space-y-2">
                      <input type="hidden" name="id" value={j.id} />
                      <input type="hidden" name="administrationId" value={admin.id} />
                      <input type="hidden" name="code" value={j.code} />
                      <Field label={t("company.name")} name="name"><Input name="name" defaultValue={j.name} required /></Field>
                      <Field label={t("ledger.journalType")} name="type">
                        <Select name="type" defaultValue={j.type}>{JOURNAL_TYPES.map((x) => <option key={x} value={x}>{t(`ledger.journalTypes.${x}`)}</option>)}</Select>
                      </Field>
                      <Checkbox name="requiresApproval" label={t("ledger.requiresApproval")} defaultChecked={j.requiresApproval} />
                      <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {mayEdit && (
          <ActionForm action={saveJournalAction} resetOnSuccess className="mt-5 grid items-end gap-3 sm:grid-cols-[7rem_1fr_12rem_auto_auto]">
            <input type="hidden" name="administrationId" value={admin.id} />
            <Field label={t("administration.code")} name="code"><Input name="code" required /></Field>
            <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
            <Field label={t("ledger.journalType")} name="type">
              <Select name="type" defaultValue="GENERAL">{JOURNAL_TYPES.map((x) => <option key={x} value={x}>{t(`ledger.journalTypes.${x}`)}</option>)}</Select>
            </Field>
            <Checkbox name="requiresApproval" label={t("ledger.requiresApproval")} />
            <SubmitButton>{t("ledger.addJournal")}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card title={t("ledger.dimensions")} description={t("ledger.dimensionsIntro")} className="mt-6">
        {dimensions.length === 0 ? (
          <EmptyState title={t("ledger.noDimensions")} />
        ) : (
          <Table head={[t("ledger.dimensionType"), t("administration.code"), t("company.name")]}>
            {dimensions.map((d) => (
              <tr key={d.id}><Td className="text-xs">{t(`ledger.dimensionTypes.${d.type}`)}</Td><Td className="font-medium">{d.code}</Td><Td>{d.name}</Td></tr>
            ))}
          </Table>
        )}
        {mayEdit && (
          <ActionForm action={createDimensionAction} resetOnSuccess className="mt-5 grid items-end gap-3 sm:grid-cols-[12rem_8rem_1fr_auto]">
            <input type="hidden" name="administrationId" value={admin.id} />
            <Field label={t("ledger.dimensionType")} name="type">
              <Select name="type" defaultValue="COST_CENTER">{(["COST_CENTER", "PROJECT", "DEPARTMENT"] as const).map((x) => <option key={x} value={x}>{t(`ledger.dimensionTypes.${x}`)}</option>)}</Select>
            </Field>
            <Field label={t("administration.code")} name="code"><Input name="code" required /></Field>
            <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
            <SubmitButton>{t("ledger.addDimension")}</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
