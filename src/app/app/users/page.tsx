import { getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { rolesForKind } from "@/core/auth/permissions";
import { inviteMemberAction, memberResetLinkAction, updateMembershipAction } from "@/actions/organization";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function UsersPage() {
  const t = await getTranslations();
  const ctx = await requireApp("organization.manageUsers");
  const members = await withTenant(ctx.access, (tx) =>
    tx.organizationMembership.findMany({ include: { user: { select: { name: true, email: true, mfaEnabled: true, lastLoginAt: true } }, role: true }, orderBy: { createdAt: "asc" } }),
  );
  const roles = rolesForKind(ctx.access.organizationKind);
  const statusTone = { ACTIVE: "success", INVITED: "warning", DISABLED: "neutral" } as const;

  return (
    <>
      <PageHeader title={t("users.title")} description={t("users.intro")} />
      <Card>
        <Table head={[t("users.name"), t("users.role"), t("common.status"), t("users.mfa"), t("users.actions")]}>
          {members.map((m) => {
            const locked = m.userId === ctx.organization.ownerUserId || m.userId === ctx.user.id;
            return (
              <tr key={m.id}>
                <Td>{m.user.name}<span className="block text-xs text-muted-foreground">{m.user.email}</span></Td>
                <Td>{t(`roles.${m.role.code}`)}</Td>
                <Td><Badge tone={statusTone[m.status]}>{t(`users.statuses.${m.status}`)}</Badge></Td>
                <Td>{m.user.mfaEnabled ? <Badge tone="success">{t("common.yes")}</Badge> : <Badge>{t("common.no")}</Badge>}</Td>
                <Td>
                  {locked ? (
                    <span className="text-xs text-muted-foreground">{m.userId === ctx.organization.ownerUserId ? t("users.owner") : t("users.you")}</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={updateMembershipAction} className="flex items-center gap-2 space-y-0">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <Select name="roleCode" defaultValue={m.role.code} className="h-8 w-44 text-xs" aria-label={t("users.role")}>
                          {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                        </Select>
                        <Select name="status" defaultValue={m.status === "DISABLED" ? "DISABLED" : "ACTIVE"} className="h-8 w-32 text-xs" aria-label={t("common.status")}>
                          <option value="ACTIVE">{t("users.statuses.ACTIVE")}</option>
                          <option value="DISABLED">{t("users.statuses.DISABLED")}</option>
                        </Select>
                        <SubmitButton variant="secondary" className="h-8 px-3 text-xs">{t("common.apply")}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={memberResetLinkAction} className="space-y-0" dataLabels={{ link: t("users.resetLink") }}>
                        <input type="hidden" name="membershipId" value={m.id} />
                        <SubmitButton variant="secondary" className="h-8 px-3 text-xs">{t("users.createResetLink")}</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={t("users.inviteTitle")} description={t("users.inviteIntro")} className="mt-6">
        <ActionForm action={inviteMemberAction} resetOnSuccess dataLabels={{ link: t("users.invitationLink") }}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("users.name")} name="name"><Input name="name" required /></Field>
            <Field label={t("auth.email")} name="email"><Input name="email" type="email" required /></Field>
            <Field label={t("users.role")} name="roleCode">
              <Select name="roleCode" defaultValue={roles.includes("ACCOUNTANT") ? "ACCOUNTANT" : roles[0]}>
                {roles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </Select>
            </Field>
          </div>
          <SubmitButton>{t("users.invite")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
