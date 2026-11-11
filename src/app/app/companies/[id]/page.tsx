import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { templateChoices } from "@/modules/industry/queries";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { rolesForKind, SYSTEM_ROLES } from "@/core/auth/permissions";
import {
  assignCompanyAction, createAdministrationAction, createBranchAction, removeAssignmentAction, setCompanyStatusAction, updateCompanyAction,
} from "@/actions/organization";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";
import { AdministrationFields, CompanyFields, DistrictSelect } from "@/components/finance/org-fields";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const ctx = await requireApp();
  if (!can(ctx.access, "companies.view", id)) notFound();

  const data = await withTenant(ctx.access, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id },
      include: {
        branches: { orderBy: { code: "asc" } },
        administrations: { orderBy: { code: "asc" }, include: { fiscalYears: { orderBy: { startDate: "desc" }, take: 1 } } },
        assignments: { include: { user: { select: { name: true, email: true } }, role: { select: { code: true } } } },
      },
    });
    const members = await tx.organizationMembership.findMany({ where: { status: "ACTIVE" }, include: { user: { select: { id: true, name: true } }, role: { select: { orgWide: true } } } });
    return { company, members };
  });
  const company = data.company;
  if (!company) notFound();

  const mayEdit = can(ctx.access, "companies.edit", id);
  const mayCreateAdmin = can(ctx.access, "administrations.create", id) && company.status === "ACTIVE";
  const templates = mayCreateAdmin ? await templateChoices(ctx.access, await getLocale()) : [];
  const mayAssign = can(ctx.access, "organization.manageUsers") || can(ctx.access, "companies.manageUsers", id);
  const assignable = rolesForKind(ctx.access.organizationKind).filter((r) => !SYSTEM_ROLES[r].orgWide);

  return (
    <>
      <PageHeader
        title={company.name}
        description={`${t(`legalForms.${company.legalForm}`)}${company.kkfNumber ? ` · KKF ${company.kkfNumber}` : ""}`}
        actions={
          mayEdit && (
            <form action={setCompanyStatusAction}>
              <input type="hidden" name="id" value={company.id} />
              <input type="hidden" name="status" value={company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"} />
              <button className={buttonClass("secondary", "sm")}>{t(company.status === "ACTIVE" ? "company.archive" : "company.restore")}</button>
            </form>
          )
        }
      />

      <div className="space-y-6">
        <Card title={t("company.administrations")}>
          {company.administrations.length === 0 ? (
            <EmptyState title={t("administration.none")} />
          ) : (
            <Table head={[t("administration.code"), t("administration.name"), t("administration.baseCurrency"), t("administration.latestYear"), t("common.status")]}>
              {company.administrations.map((a) => (
                <tr key={a.id}>
                  <Td>{a.code}</Td>
                  <Td><TextLink href={`/app/administrations/${a.id}`}>{a.name}</TextLink></Td>
                  <Td>{a.baseCurrency}</Td>
                  <Td>{a.fiscalYears[0]?.code ?? "—"}</Td>
                  <Td><Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{t(`administration.statuses.${a.status}`)}</Badge></Td>
                </tr>
              ))}
            </Table>
          )}
          {mayCreateAdmin && (
            <details className="mt-5 rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">{t("administration.createTitle")}</summary>
              <ActionForm action={createAdministrationAction} className="mt-4">
                <AdministrationFields companyId={company.id} templates={templates} />
                <SubmitButton>{t("administration.create")}</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card title={t("company.access")} description={t("company.accessIntro")}>
          {company.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("company.noAssignments")}</p>
          ) : (
            <Table head={[t("users.name"), t("users.role"), ""]}>
              {company.assignments.map((a) => (
                <tr key={a.id}>
                  <Td>{a.user.name}<span className="block text-xs text-muted-foreground">{a.user.email}</span></Td>
                  <Td>{t(`roles.${a.role.code}`)}</Td>
                  <Td className="text-right">
                    {mayAssign && (
                      <form action={removeAssignmentAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className={buttonClass("ghost", "sm")}>{t("common.remove")}</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {mayAssign && (
            <ActionForm action={assignCompanyAction} className="mt-5 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="companyId" value={company.id} />
              <Field label={t("users.member")} name="userId">
                <Select name="userId" required>
                  {data.members.filter((m) => !m.role.orgWide).map((m) => (
                    <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("users.role")} name="roleCode">
                <Select name="roleCode">
                  {assignable.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </Select>
              </Field>
              <SubmitButton>{t("company.assign")}</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title={t("company.branches")}>
          {company.branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("company.noBranches")}</p>
          ) : (
            <Table head={[t("administration.code"), t("company.name"), t("company.district")]}>
              {company.branches.map((b) => (
                <tr key={b.id}>
                  <Td>{b.code}</Td>
                  <Td>{b.name}</Td>
                  <Td>{b.district ? t(`districts.${b.district}`) : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {mayEdit && (
            <ActionForm action={createBranchAction} resetOnSuccess className="mt-5 grid items-end gap-3 sm:grid-cols-[8rem_1fr_1fr_auto]">
              <input type="hidden" name="companyId" value={company.id} />
              <Field label={t("administration.code")} name="code"><Input name="code" required /></Field>
              <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
              <Field label={t("company.district")} name="district"><DistrictSelect /></Field>
              <SubmitButton>{t("company.addBranch")}</SubmitButton>
            </ActionForm>
          )}
        </Card>

        {mayEdit && (
          <Card title={t("company.details")}>
            <ActionForm action={updateCompanyAction}>
              <input type="hidden" name="id" value={company.id} />
              <CompanyFields defaults={company} />
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
