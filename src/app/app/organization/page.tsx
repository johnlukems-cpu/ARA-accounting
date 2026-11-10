import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { updateOrganizationAction } from "@/actions/organization";
import { ActionForm, Checkbox, Field, Input, SubmitButton } from "@/components/ui/form";
import { Card, Dl, PageHeader } from "@/components/ui/misc";
import { DistrictSelect } from "@/components/finance/org-fields";

export default async function OrganizationPage() {
  const t = await getTranslations();
  const ctx = await requireApp("organization.view");
  const org = ctx.organization;
  const editable = can(ctx.access, "organization.edit");

  return (
    <>
      <PageHeader title={t("organization.title")} description={t(`organization.kind.${org.kind}`)} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title={t("organization.profile")}>
          {editable ? (
            <ActionForm action={updateOrganizationAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("organization.name")} name="name"><Input name="name" defaultValue={org.name} required /></Field>
                <Field label={t("company.kkfNumber")} name="kkfNumber"><Input name="kkfNumber" defaultValue={org.kkfNumber ?? ""} /></Field>
                <Field label={t("company.email")} name="email"><Input name="email" type="email" defaultValue={org.email ?? ""} /></Field>
                <Field label={t("company.phone")} name="phone"><Input name="phone" defaultValue={org.phone ?? ""} /></Field>
                <Field label={t("company.address")} name="address"><Input name="address" defaultValue={org.address ?? ""} /></Field>
                <Field label={t("company.district")} name="district"><DistrictSelect defaultValue={org.district} /></Field>
              </div>
              <Checkbox name="requireMfaForAdmins" label={t("organization.requireMfa")} defaultChecked={org.requireMfaForAdmins} />
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          ) : (
            <Dl items={[[t("organization.name"), org.name], [t("company.kkfNumber"), org.kkfNumber], [t("company.email"), org.email], [t("company.district"), org.district ? t(`districts.${org.district}`) : null]]} />
          )}
        </Card>
        <Card title={t("organization.subscription")}>
          <Dl items={[[t("organization.status"), t(`organization.statuses.${org.status}`)]]} />
          <p className="mt-3 text-xs text-muted-foreground">{t("organization.subscriptionNote")}</p>
        </Card>
      </div>
    </>
  );
}
