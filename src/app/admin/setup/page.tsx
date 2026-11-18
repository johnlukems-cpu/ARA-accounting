import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/core/auth/context";
import { getHome } from "@/modules/admin/home";
import { LEGAL_FORMS } from "@/modules/organization/schemas";
import { bootstrapHomeAction } from "@/actions/admin";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/misc";

/** One-time setup of ARA's own organisation (platform administrators only). */
export default async function AdminSetupPage() {
  const t = await getTranslations();
  const ctx = await requireUser();
  if (!ctx.user.isPlatformAdmin) notFound();
  if (await getHome()) redirect("/admin");
  return (
    <>
      <PageHeader title={t("admin.setup.title")} description={t("admin.setup.intro")} />
      <Card>
        <ActionForm action={bootstrapHomeAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.setup.organizationName")} name="organizationName"><Input name="organizationName" defaultValue="ARA Intelligent Solutions" required /></Field>
            <Field label={t("admin.setup.companyName")} name="companyName"><Input name="companyName" defaultValue="ARA Intelligent Solutions" required /></Field>
            <Field label={t("company.legalForm")} name="legalForm"><Select name="legalForm" required defaultValue="">{[<option key="" value="">—</option>, ...LEGAL_FORMS.map((f) => <option key={f} value={f}>{t(`legalForms.${f}` as never)}</option>)]}</Select></Field>
            <Field label={t("administration.baseCurrency")} name="baseCurrency"><Input name="baseCurrency" defaultValue="SRD" required /></Field>
            <Field label={t("administration.startYear")} name="startYear"><Input type="number" name="startYear" defaultValue={new Date().getUTCFullYear()} required /></Field>
            <div className="flex items-end pb-2"><Checkbox name="isBtwRegistered" label={t("company.isBtwRegistered")} /></div>
          </div>
          <p className="text-xs text-muted-foreground">{t("admin.setup.note")}</p>
          <SubmitButton>{t("admin.setup.create")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
