import { getFormatter, getTranslations } from "next-intl/server";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { STAFF_ROLES } from "@/core/auth/permissions";
import { inviteStaffAction, saveEmployeeAction, staffRoleAction } from "@/actions/admin";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

/** Staff of ARA Intelligent Solutions: system access (membership + role) and the staff directory. */
export default async function EmployeesPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const a = await requireAdmin("organization.view");
  const members = await systemDb.organizationMembership.findMany({ where: { organizationId: a.home.organizationId }, include: { user: { select: { name: true, email: true, mfaEnabled: true } }, role: true }, orderBy: { createdAt: "asc" } });
  const employees = await withTenant(a.access, (tx) => tx.employee.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }));
  const manage = adminCan(a, "organization.manageUsers");
  return (
    <>
      <PageHeader title={t("admin.nav.employees")} description={t("admin.staff.intro")} />
      <Card title={t("admin.staff.access")}>
        <Table head={[t("users.name"), t("admin.customer.email"), t("admin.staff.role"), "MFA", t("common.status"), ""]}>
          {members.map((m) => (
            <tr key={m.id}>
              <Td>{m.user.name}</Td><Td className="text-sm">{m.user.email}</Td><Td>{t(`roles.${m.role.code}` as never)}</Td>
              <Td>{m.user.mfaEnabled ? <Badge tone="success">{t("account.mfaOn")}</Badge> : <Badge tone="warning">{t("account.mfaOff")}</Badge>}</Td>
              <Td><Badge>{m.status}</Badge></Td>
              <Td>{manage && m.userId !== a.access.userId && (
                <ActionForm action={staffRoleAction} className="flex gap-1 space-y-0"><input type="hidden" name="membershipId" value={m.id} />
                  <Select name="roleCode" defaultValue={STAFF_ROLES.includes(m.role.code as never) ? m.role.code : ""} aria-label={t("admin.staff.role")} className="h-8 text-xs">{[<option key="" value="">—</option>, ...STAFF_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}` as never)}</option>)]}</Select>
                  <Select name="status" defaultValue={m.status === "DISABLED" ? "DISABLED" : "ACTIVE"} aria-label={t("common.status")} className="h-8 text-xs"><option value="ACTIVE">{t("admin.staff.active")}</option><option value="DISABLED">{t("admin.staff.disabled")}</option></Select>
                  <SubmitButton variant="secondary" className="h-8 px-2 text-xs">{t("common.save")}</SubmitButton>
                </ActionForm>
              )}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {manage && (
        <Card title={t("admin.staff.invite")} description={t("admin.staff.inviteIntro")} className="mt-6">
          <ActionForm action={inviteStaffAction} resetOnSuccess dataLabels={{ link: t("users.invitationLink") }}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label={t("users.name")} name="name"><Input name="name" required /></Field>
              <Field label={t("admin.customer.email")} name="email"><Input type="email" name="email" required /></Field>
              <Field label={t("admin.staff.role")} name="roleCode"><Select name="roleCode" defaultValue="READONLY_EMPLOYEE">{STAFF_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}` as never)}</option>)}</Select></Field>
              <Field label={t("admin.staff.jobTitle")} name="jobTitle"><Input name="jobTitle" /></Field>
              <Field label={t("admin.staff.department")} name="department"><Input name="department" /></Field>
            </div>
            <SubmitButton>{t("admin.staff.inviteButton")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card title={t("admin.staff.directory")} className="mt-6">
        <Table head={[t("users.name"), t("admin.staff.jobTitle"), t("admin.staff.department"), t("admin.staff.start"), t("common.status")]}>
          {employees.map((e) => <tr key={e.id}><Td>{e.name}</Td><Td>{e.jobTitle ?? "—"}</Td><Td>{e.department ?? "—"}</Td><Td>{e.startDate ? format.dateTime(e.startDate, { dateStyle: "short" }) : "—"}</Td><Td><Badge>{e.status === "ACTIVE" ? t("admin.staff.active") : t("admin.staff.left")}</Badge></Td></tr>)}
        </Table>
        {manage && (
          <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-accent">{t("admin.staff.addEmployee")}</summary>
            <ActionForm action={saveEmployeeAction} resetOnSuccess className="mt-3">
              <div className="grid gap-3 sm:grid-cols-3"><Field label={t("users.name")} name="name"><Input name="name" required /></Field><Field label={t("admin.staff.jobTitle")} name="jobTitle"><Input name="jobTitle" /></Field><Field label={t("admin.staff.department")} name="department"><Input name="department" /></Field><Field label={t("admin.customer.email")} name="email"><Input type="email" name="email" /></Field><Field label={t("admin.staff.start")} name="startDate"><Input type="date" name="startDate" /></Field></div>
              <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Card>
    </>
  );
}
