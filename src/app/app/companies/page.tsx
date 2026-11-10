import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can, visibleCompanyIds } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createCompanyAction } from "@/actions/organization";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";
import { CompanyFields } from "@/components/finance/org-fields";

export default async function CompaniesPage() {
  const t = await getTranslations();
  const ctx = await requireApp("companies.view");
  const companies = await withTenant(ctx.access, (tx) =>
    tx.company.findMany({
      where: { id: { in: visibleCompanyIds(ctx.access) } },
      include: { _count: { select: { administrations: true, branches: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  );

  return (
    <>
      <PageHeader title={t("company.listTitle")} description={t("company.listIntro")} />
      <Card>
        {companies.length === 0 ? (
          <EmptyState title={t("company.none")} />
        ) : (
          <Table head={[t("company.name"), t("company.legalForm"), t("company.kkfNumber"), t("company.administrations"), t("common.status")]}>
            {companies.map((c) => (
              <tr key={c.id}>
                <Td><TextLink href={`/app/companies/${c.id}`}>{c.name}</TextLink></Td>
                <Td>{t(`legalForms.${c.legalForm}`)}</Td>
                <Td>{c.kkfNumber ?? "—"}</Td>
                <Td className="amount">{c._count.administrations}</Td>
                <Td><Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{t(`common.statuses.${c.status}`)}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {can(ctx.access, "companies.create") && (
        <Card title={t("company.createTitle")} className="mt-6">
          <ActionForm action={createCompanyAction}>
            <CompanyFields />
            <SubmitButton>{t("company.create")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
