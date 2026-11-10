import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { savePartyAction } from "@/actions/invoicing";
import { partyFormData } from "@/modules/invoicing/queries";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/misc";
import { PartyFields } from "@/components/finance/party-fields";

export default async function NewRelationPage() {
  const t = await getTranslations();
  const ctx = await requireApp(undefined, { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  if (!can(ctx.access, "sales.create", admin.companyId) && !can(ctx.access, "purchase.create", admin.companyId)) redirect("/app?denied=1");
  const data = await withTenant(ctx.access, (tx) => partyFormData(tx, admin.id));
  return (
    <>
      <PageHeader title={t("invoicing.addRelation")} description={`${admin.code} · ${admin.name}`} />
      <Card>
        <ActionForm action={savePartyAction}>
          <input type="hidden" name="administrationId" value={admin.id} />
          <PartyFields revenue={data.revenue} expense={data.expense} taxCodes={data.taxCodes} />
          <SubmitButton>{t("invoicing.saveRelation")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
