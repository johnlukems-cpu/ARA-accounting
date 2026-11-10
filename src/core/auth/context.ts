import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { ForbiddenError, UnauthenticatedError } from "@/core/errors";
import { assertCan, can, resolveAccess, visibleCompanyIds, type Access } from "./access";
import { ADMIN_ROLES, type Permission } from "./permissions";
import { readSession } from "./session";

export const MFA_GRACE_DAYS = 7;

/**
 * Resolves who is signed in and which organisation, company, administration and fiscal year are active.
 * Everything is re-validated against the database on every request; the session only stores preferences.
 */
export const getContext = cache(async () => {
  const session = await readSession();
  if (!session) return null;
  const user = session.user;

  const memberships = await systemDb.organizationMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", organization: { status: { not: "CANCELLED" } } },
    include: { organization: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const membership = memberships.find((m) => m.organizationId === session.activeOrganizationId) ?? memberships[0] ?? null;
  const access = membership ? await resolveAccess(user.id, membership.organizationId) : null;

  const mfaRequired = !!membership && membership.organization.requireMfaForAdmins && ADMIN_ROLES.includes(membership.role.code as never);
  // Grace period: an administrator may work for MFA_GRACE_DAYS after joining before MFA is enforced (banner meanwhile).
  const mfaGraceUntil = membership ? new Date(membership.createdAt.getTime() + MFA_GRACE_DAYS * 86_400_000) : null;
  const mfaInGrace = mfaRequired && !user.mfaEnabled && !!mfaGraceUntil && mfaGraceUntil > new Date();
  const mfaSatisfied = user.mfaEnabled ? !!session.mfaVerifiedAt : !mfaRequired || mfaInGrace;
  const mfaReminder = mfaRequired && !user.mfaEnabled;

  let company = null;
  let administration = null;
  let fiscalYear = null;
  let companies: { id: string; name: string }[] = [];
  let administrations: { id: string; name: string; code: string; baseCurrency: string }[] = [];
  let fiscalYears: { id: string; code: string; status: string }[] = [];

  if (access && membership) {
    const visible = visibleCompanyIds(access);
    const scope = { organizationId: access.organizationId, userId: user.id };
    ({ company, administration, fiscalYear, companies, administrations, fiscalYears } = await withTenant(scope, async (tx) => {
      const companies = await tx.company.findMany({ where: { id: { in: visible }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const companyId = companies.find((c) => c.id === session.activeCompanyId)?.id ?? companies[0]?.id ?? null;
      const company = companyId ? await tx.company.findUnique({ where: { id: companyId } }) : null;
      const administrations = companyId
        ? await tx.administration.findMany({ where: { companyId, status: { not: "ARCHIVED" } }, select: { id: true, name: true, code: true, baseCurrency: true }, orderBy: { code: "asc" } })
        : [];
      const adminId = administrations.find((a) => a.id === session.activeAdministrationId)?.id ?? administrations[0]?.id ?? null;
      const administration = adminId ? await tx.administration.findUnique({ where: { id: adminId } }) : null;
      const fiscalYears = adminId
        ? await tx.fiscalYear.findMany({ where: { administrationId: adminId }, select: { id: true, code: true, status: true, startDate: true, endDate: true }, orderBy: { startDate: "desc" } })
        : [];
      const today = new Date();
      const fyId =
        fiscalYears.find((f) => f.id === session.activeFiscalYearId)?.id ??
        fiscalYears.find((f) => f.startDate <= today && today <= f.endDate)?.id ??
        fiscalYears[0]?.id ??
        null;
      const fiscalYear = fyId ? await tx.fiscalYear.findUnique({ where: { id: fyId } }) : null;
      return { company, administration, fiscalYear, companies, administrations, fiscalYears };
    }));
  }

  return {
    session,
    user,
    memberships,
    organization: membership?.organization ?? null,
    roleCode: membership?.role.code ?? null,
    access,
    mfaRequired,
    mfaSatisfied,
    mfaReminder,
    mfaGraceUntil,
    company,
    administration,
    fiscalYear,
    companies,
    administrations,
    fiscalYears,
  };
});

export type AppContext = NonNullable<Awaited<ReturnType<typeof getContext>>>;
export type ReadyContext = AppContext & { access: Access; organization: NonNullable<AppContext["organization"]> };

/** Pages: requires a signed-in user. */
export async function requireUser(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt) redirect("/login/mfa");
  return ctx;
}

/** Pages inside the application: signed in, member of an organisation, MFA satisfied, permission held. */
export async function requireApp(permission?: Permission, opts: { needCompany?: boolean } = {}): Promise<ReadyContext> {
  const ctx = await requireUser();
  if (!ctx.access || !ctx.organization) redirect("/onboarding");
  if (!ctx.mfaSatisfied) redirect("/app/account?mfa=required");
  if (opts.needCompany && !ctx.company) redirect("/onboarding");
  if (permission && !can(ctx.access, permission, ctx.company?.id)) redirect("/app?denied=1");
  return ctx as ReadyContext;
}

/** Server actions: throws instead of redirecting. */
export async function requireActionContext(permission?: Permission, companyId?: string | null): Promise<ReadyContext> {
  const ctx = await getContext();
  if (!ctx || (ctx.user.mfaEnabled && !ctx.session.mfaVerifiedAt)) throw new UnauthenticatedError();
  if (!ctx.access || !ctx.organization) throw new ForbiddenError();
  if (!ctx.mfaSatisfied) throw new ForbiddenError("mfa");
  if (permission) assertCan(ctx.access, permission, companyId === undefined ? ctx.company?.id : companyId);
  return ctx as ReadyContext;
}
