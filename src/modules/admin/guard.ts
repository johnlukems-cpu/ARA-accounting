import "server-only";
import { notFound, redirect } from "next/navigation";
import { systemDb } from "@/core/db/client";
import { getContext } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { ADMIN_ROLES, type Permission, type RoleCode } from "@/core/auth/permissions";
import { MFA_GRACE_DAYS } from "@/core/auth/context";
import { ForbiddenError, UnauthenticatedError } from "@/core/errors";
import { adminAccess, getHome, type AdminContext } from "./home";

/**
 * Admin portal guards. Access follows the user's membership of ARA's OWN organisation (not the organisation that
 * happens to be open in the accounting app). MFA: required for administrator and finance roles of that membership
 * (same 7-day grace period as the app); a user who has MFA enabled must have verified it in this session.
 */
async function resolve() {
  const ctx = await getContext();
  if (!ctx) return { ctx: null, admin: null, mfaOk: false };
  const home = await getHome();
  if (!home) return { ctx, admin: null, mfaOk: false };
  const membership = await systemDb.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: home.organizationId, userId: ctx.user.id } }, include: { role: true, organization: true } });
  if (!membership || membership.status !== "ACTIVE") return { ctx, admin: null, mfaOk: false };
  const required = membership.organization.requireMfaForAdmins && ADMIN_ROLES.includes(membership.role.code as RoleCode);
  const graceUntil = new Date(membership.createdAt.getTime() + MFA_GRACE_DAYS * 86_400_000);
  const mfaOk = ctx.user.mfaEnabled ? !!ctx.session.mfaVerifiedAt : !required || graceUntil > new Date();
  const admin = await adminAccess(ctx.user.id).catch(() => null);
  return { ctx, admin, mfaOk, roleCode: membership.role.code, mfaReminder: required && !ctx.user.mfaEnabled, graceUntil };
}

/** Pages. Without ARA's organisation, platform admins are sent to the setup page; everyone else gets a 404. */
export async function requireAdmin(permission?: Permission) {
  const r = await resolve();
  if (!r.ctx) redirect("/login");
  if (r.ctx.user.mfaEnabled && !r.ctx.session.mfaVerifiedAt) redirect("/login/mfa");
  if (!r.admin) {
    if (r.ctx.user.isPlatformAdmin && !(await getHome())) redirect("/admin/setup");
    notFound();
  }
  if (!r.mfaOk) redirect("/app/account?mfa=required");
  if (permission && !can(r.admin.access, permission, r.admin.home.companyId)) redirect("/admin?denied=1");
  return { ...r.admin, user: r.ctx.user, roleCode: r.roleCode as string, mfaReminder: !!r.mfaReminder, graceUntil: r.graceUntil! };
}

/** Server actions: throw instead of redirecting. */
export async function adminActionContext(permission?: Permission): Promise<AdminContext & { userName: string }> {
  const r = await resolve();
  if (!r.ctx || (r.ctx.user.mfaEnabled && !r.ctx.session.mfaVerifiedAt)) throw new UnauthenticatedError();
  if (!r.admin) throw new ForbiddenError();
  if (!r.mfaOk) throw new ForbiddenError("mfa");
  if (permission && !can(r.admin.access, permission, r.admin.home.companyId)) throw new ForbiddenError(permission);
  return { ...r.admin, userName: r.ctx.user.name };
}

export function adminCan(a: AdminContext, p: Permission) {
  return can(a.access, p, a.home.companyId);
}
