import { systemDb } from "@/core/db/client";
import { ForbiddenError } from "@/core/errors";
import { isOrgScoped, type Permission, type RoleCode } from "./permissions";
import { filterPermissionsByPlan } from "@/modules/saas/service";

/**
 * Everything the server needs to authorise one user inside one organisation.
 * Resolved from the database on every request (never from the client).
 */
export interface Access {
  userId: string;
  organizationId: string;
  organizationKind: "BUSINESS" | "ACCOUNTING_FIRM";
  roleCode: RoleCode;
  orgWide: boolean;
  orgPermissions: ReadonlySet<string>;
  /** Company id → permissions for that company. Org-wide roles get every company of the organisation. */
  companyPermissions: ReadonlyMap<string, ReadonlySet<string>>;
}

export async function resolveAccess(userId: string, organizationId: string): Promise<Access | null> {
  const membership = await systemDb.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { role: { include: { permissions: true } }, organization: { select: { kind: true, status: true, planId: true } }, user: { select: { isActive: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || !membership.user.isActive) return null;
  if (membership.organization.status === "CANCELLED") return null;

  // Plan entitlements: optional modules not in the organisation's plan are removed from every role (effective
  // permissions = role grants ∩ plan modules). No plan (trial) or modules = null means every module.
  const plan = membership.organization.planId ? await systemDb.plan.findUnique({ where: { id: membership.organization.planId }, select: { modules: true } }) : null;
  const planModules = Array.isArray(plan?.modules) ? (plan.modules as string[]) : null;
  const rolePerms = filterPermissionsByPlan(new Set(membership.role.permissions.map((p) => p.permission)), planModules);
  const companyPermissions = new Map<string, Set<string>>();
  if (membership.role.orgWide) {
    const companies = await systemDb.company.findMany({ where: { organizationId }, select: { id: true } });
    for (const c of companies) companyPermissions.set(c.id, rolePerms);
  } else {
    const assignments = await systemDb.companyAssignment.findMany({
      where: { organizationId, userId },
      include: { role: { include: { permissions: true } } },
    });
    for (const a of assignments) companyPermissions.set(a.companyId, filterPermissionsByPlan(new Set(a.role.permissions.map((p) => p.permission)), planModules));
  }

  return {
    userId,
    organizationId,
    organizationKind: membership.organization.kind,
    roleCode: membership.role.code as RoleCode,
    orgWide: membership.role.orgWide,
    orgPermissions: rolePerms,
    companyPermissions,
  };
}

/** True when the user holds `permission` — organisation-scoped, or for the given company. */
export function can(access: Access, permission: Permission, companyId?: string | null): boolean {
  if (isOrgScoped(permission) || !companyId) {
    if (isOrgScoped(permission)) return access.orgPermissions.has(permission);
    // Company-scoped permission without a company: allowed if the user has it for at least one company.
    for (const perms of access.companyPermissions.values()) if (perms.has(permission)) return true;
    return false;
  }
  return access.companyPermissions.get(companyId)?.has(permission) ?? false;
}

export function assertCan(access: Access, permission: Permission, companyId?: string | null): void {
  if (!can(access, permission, companyId)) throw new ForbiddenError(permission);
}

/** Companies the user may see in this organisation. */
export function visibleCompanyIds(access: Access): string[] {
  return [...access.companyPermissions.entries()].filter(([, p]) => p.has("companies.view")).map(([id]) => id);
}
