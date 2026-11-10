"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { systemDb } from "@/core/db/client";
import { getContext, requireActionContext } from "@/core/auth/context";
import { randomToken, sha256 } from "@/core/auth/crypto";
import { updateSession } from "@/core/auth/session";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { UserError } from "@/core/errors";
import {
  assignCompany, createAdministration, createBranch, createCompany, createNextFiscalYear, inviteMember, removeAssignment,
  setCompanyStatus, setPeriodStatus, updateCompany, updateMembership, updateOrganization,
} from "@/modules/organization/service";
import {
  administrationSchema, assignmentSchema, branchSchema, companySchema, inviteSchema, membershipUpdateSchema,
  organizationSchema, periodStatusSchema,
} from "@/modules/organization/schemas";
import { appUrl, getEmailSender } from "@/integrations/email";
import { bool, formObject, okState, toActionState, type ActionState } from "@/lib/action";

async function ctx() {
  const c = await requireActionContext();
  return c;
}

// ───────────── Context switching (validated against the user's access on the next request) ─────────────

export async function switchContextAction(fd: FormData) {
  const c = await getContext();
  if (!c) redirect("/login");
  const field = String(fd.get("field"));
  const value = String(fd.get("value") ?? "");
  if (field === "organization") {
    if (!c.memberships.some((m) => m.organizationId === value)) return;
    await updateSession(c.session.id, { activeOrganizationId: value, activeCompanyId: null, activeAdministrationId: null, activeFiscalYearId: null });
  } else if (field === "company") {
    if (!c.access || !c.access.companyPermissions.get(value)?.has("companies.view")) return;
    await updateSession(c.session.id, { activeCompanyId: value, activeAdministrationId: null, activeFiscalYearId: null });
  } else if (field === "administration") {
    if (!c.administrations.some((a) => a.id === value)) return;
    await updateSession(c.session.id, { activeAdministrationId: value, activeFiscalYearId: null });
  } else if (field === "fiscalYear") {
    if (!c.fiscalYears.some((f) => f.id === value)) return;
    await updateSession(c.session.id, { activeFiscalYearId: value });
  }
  revalidatePath("/app", "layout");
}

// ───────────── Organisation ─────────────

export async function updateOrganizationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    await updateOrganization(c.access, organizationSchema.parse({ ...formObject(fd), requireMfaForAdmins: bool(fd, "requireMfaForAdmins") }));
    revalidatePath("/app", "layout");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

// ───────────── Companies, branches ─────────────

export async function createCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const c = await ctx();
    const company = await createCompany(c.access, companySchema.parse({ ...formObject(fd), isBtwRegistered: bool(fd, "isBtwRegistered") }));
    await updateSession(c.session.id, { activeCompanyId: company.id, activeAdministrationId: null, activeFiscalYearId: null });
    id = company.id;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/app", "layout");
  redirect(fd.get("redirectTo") === "onboarding" ? "/onboarding" : `/app/companies/${id}`);
}

export async function updateCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const id = z.string().min(1).parse(fd.get("id"));
    await updateCompany(c.access, id, companySchema.parse({ ...formObject(fd), isBtwRegistered: bool(fd, "isBtwRegistered") }));
    revalidatePath("/app", "layout");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function setCompanyStatusAction(fd: FormData) {
  const c = await ctx();
  await setCompanyStatus(c.access, String(fd.get("id")), fd.get("status") === "ARCHIVED" ? "ARCHIVED" : "ACTIVE");
  revalidatePath("/app", "layout");
}

export async function createBranchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    await createBranch(c.access, branchSchema.parse(formObject(fd)));
    revalidatePath("/app/companies");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

// ───────────── Administrations, fiscal years, periods ─────────────

export async function createAdministrationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let adminId: string;
  try {
    const c = await ctx();
    const { administration, fiscalYear } = await createAdministration(c.access, administrationSchema.parse(formObject(fd)));
    await updateSession(c.session.id, { activeCompanyId: administration.companyId, activeAdministrationId: administration.id, activeFiscalYearId: fiscalYear.id });
    adminId = administration.id;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath("/app", "layout");
  redirect(fd.get("redirectTo") === "dashboard" ? "/app" : `/app/administrations/${adminId}`);
}

export async function createNextFiscalYearAction(fd: FormData) {
  const c = await ctx();
  await createNextFiscalYear(c.access, String(fd.get("administrationId")));
  revalidatePath("/app", "layout");
}

export async function setPeriodStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    await setPeriodStatus(c.access, periodStatusSchema.parse(formObject(fd)));
    revalidatePath("/app", "layout");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

// ───────────── Members ─────────────

export async function inviteMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const input = inviteSchema.parse(formObject(fd));
    const result = await inviteMember(c.access, input);
    revalidatePath("/app/users");
    if (!result.invitationToken) return okState("users.addedExisting");
    const link = appUrl(`/invite?token=${result.invitationToken}`);
    const sender = getEmailSender();
    if (sender) {
      await sender.send({
        to: input.email,
        subject: `Uitnodiging voor ${c.organization.name} — ARA Accounting`,
        text: `U bent uitgenodigd voor ${c.organization.name} in ARA Accounting.\nActiveer uw account via deze link (7 dagen geldig):\n${link}`,
      });
      return okState("users.invitationSent");
    }
    return okState("users.invitationLinkCreated", { link });
  } catch (err) {
    return toActionState(err);
  }
}

export async function updateMembershipAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    const raw = formObject(fd);
    await updateMembership(c.access, membershipUpdateSchema.parse({ membershipId: raw.membershipId, roleCode: raw.roleCode || undefined, status: raw.status || undefined }));
    revalidatePath("/app/users");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

/** Creates a one-time password-reset link for a member (for organisations without e-mail delivery). */
export async function memberResetLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await requireActionContext("organization.manageUsers");
    const membershipId = z.string().min(1).parse(fd.get("membershipId"));
    const membership = await withTenant(c.access, (tx) => tx.organizationMembership.findUnique({ where: { id: membershipId } }));
    if (!membership) throw new UserError("errors.notFound");
    if (membership.userId === c.user.id) throw new UserError("errors.cannotChangeSelf");
    // A member of several organisations could be taken over by one of them: only allow for single-organisation users.
    const orgCount = await systemDb.organizationMembership.count({ where: { userId: membership.userId } });
    if (orgCount > 1) throw new UserError("users.resetMultiOrg");
    const token = randomToken();
    await systemDb.userToken.create({ data: { tokenHash: sha256(token), kind: "PASSWORD_RESET", userId: membership.userId, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await withTenant(c.access, (tx) => audit(tx, { organizationId: c.access.organizationId, userId: c.user.id, action: "member.resetLinkCreated", entity: "User", entityId: membership.userId }));
    return okState("users.resetLinkCreated", { link: appUrl(`/reset-password?token=${token}`) });
  } catch (err) {
    return toActionState(err);
  }
}

export async function assignCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const c = await ctx();
    await assignCompany(c.access, assignmentSchema.parse(formObject(fd)));
    revalidatePath("/app", "layout");
    return okState("common.saved");
  } catch (err) {
    return toActionState(err);
  }
}

export async function removeAssignmentAction(fd: FormData) {
  const c = await ctx();
  await removeAssignment(c.access, String(fd.get("id")));
  revalidatePath("/app", "layout");
}

export async function markNotificationsReadAction() {
  const c = await ctx();
  await withTenant(c.access, (tx) => tx.notification.updateMany({ where: { userId: c.user.id, readAt: null }, data: { readAt: new Date() } }));
  revalidatePath("/app", "layout");
}
