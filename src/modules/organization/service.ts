import type { z } from "zod";
import { Prisma } from "@prisma/client";
import { systemDb, type Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { hashPassword, randomToken, sha256 } from "@/core/auth/crypto";
import { ADMIN_ROLES, rolesForKind, SYSTEM_ROLES, type RoleCode } from "@/core/auth/permissions";
import { UserError } from "@/core/errors";
import { fiscalYearCode, fiscalYearRange, planPeriods } from "./periods";
import { installStandardChart } from "@/modules/ledger/service";
import { installOperations } from "@/modules/invoicing/setup";
import type {
  administrationSchema, assignmentSchema, branchSchema, companySchema, inviteSchema, membershipUpdateSchema,
  organizationSchema, periodStatusSchema, registerSchema,
} from "./schemas";

const scopeOf = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });

async function systemRoleId(db: Tx | typeof systemDb, code: RoleCode): Promise<string> {
  const role = await db.role.findFirst({ where: { organizationId: null, code }, select: { id: true } });
  if (!role) throw new Error(`System role ${code} missing — run the seed`);
  return role.id;
}

async function notify(tx: Tx, organizationId: string, userIds: string[], type: string, params: Prisma.InputJsonValue, link?: string) {
  if (userIds.length === 0) return;
  await tx.notification.createMany({ data: userIds.map((userId) => ({ organizationId, userId, type, params, link })) });
}

function isUniqueViolation(err: unknown, target?: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    (!target || JSON.stringify(err.meta?.target ?? "").includes(target))
  );
}

// ───────────────────────── Registration ─────────────────────────

/** Creates a user, an organisation and the owner membership. Runs as system (no tenant exists yet). */
export async function registerOrganization(input: z.infer<typeof registerSchema>, ip?: string) {
  const passwordHash = await hashPassword(input.password);
  const ownerRole: RoleCode = input.kind === "ACCOUNTING_FIRM" ? "FIRM_ADMIN" : "ORGANIZATION_OWNER";
  try {
    return await systemDb.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, passwordChangedAt: new Date() } });
      const org = await tx.organization.create({ data: { name: input.organizationName, kind: input.kind, ownerUserId: user.id } });
      await tx.organizationMembership.create({
        data: { organizationId: org.id, userId: user.id, roleId: await systemRoleId(tx, ownerRole), status: "ACTIVE" },
      });
      await audit(tx, { organizationId: org.id, userId: user.id, action: "organization.registered", entity: "Organization", entityId: org.id, details: { kind: input.kind }, ip });
      return { userId: user.id, organizationId: org.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "email")) throw new UserError("errors.emailTaken");
    throw err;
  }
}

// ───────────────────────── Organisation ─────────────────────────

export async function updateOrganization(access: Access, input: z.infer<typeof organizationSchema>) {
  assertCan(access, "organization.edit");
  if (input.requireMfaForAdmins === false) assertCan(access, "organization.manageSettings");
  return withTenant(scopeOf(access), async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId } });
    const org = await tx.organization.update({ where: { id: access.organizationId }, data: input });
    await audit(tx, {
      organizationId: org.id, userId: access.userId, action: "organization.updated", entity: "Organization", entityId: org.id,
      details: { before: { name: before.name, requireMfaForAdmins: before.requireMfaForAdmins }, after: input },
    });
    return org;
  });
}

// ───────────────────────── Companies and branches ─────────────────────────

export async function createCompany(access: Access, input: z.infer<typeof companySchema>) {
  assertCan(access, "companies.create");
  try {
    return await withTenant(scopeOf(access), async (tx) => {
      const company = await tx.company.create({ data: { ...input, organizationId: access.organizationId } });
      if (!access.orgWide) {
        // The creator keeps access to the company they created.
        const role = await tx.role.findFirstOrThrow({ where: { organizationId: null, code: access.roleCode } });
        await tx.companyAssignment.create({ data: { organizationId: access.organizationId, companyId: company.id, userId: access.userId, roleId: role.id } });
      }
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "company.created", entity: "Company", entityId: company.id, details: { name: company.name, legalForm: company.legalForm } });
      return company;
    });
  } catch (err) {
    if (isUniqueViolation(err, "kkfNumber")) throw new UserError("errors.kkfTaken");
    throw err;
  }
}

export async function updateCompany(access: Access, companyId: string, input: z.infer<typeof companySchema>) {
  assertCan(access, "companies.edit", companyId);
  try {
    return await withTenant(scopeOf(access), async (tx) => {
      const company = await tx.company.update({ where: { id: companyId }, data: input });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "company.updated", entity: "Company", entityId: companyId, details: input });
      return company;
    });
  } catch (err) {
    if (isUniqueViolation(err, "kkfNumber")) throw new UserError("errors.kkfTaken");
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw new UserError("errors.notFound");
    throw err;
  }
}

export async function setCompanyStatus(access: Access, companyId: string, status: "ACTIVE" | "ARCHIVED") {
  assertCan(access, "companies.edit", companyId);
  return withTenant(scopeOf(access), async (tx) => {
    const company = await tx.company.update({ where: { id: companyId }, data: { status } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: `company.${status === "ARCHIVED" ? "archived" : "restored"}`, entity: "Company", entityId: companyId });
    return company;
  });
}

export async function createBranch(access: Access, input: z.infer<typeof branchSchema>) {
  assertCan(access, "companies.edit", input.companyId);
  try {
    return await withTenant(scopeOf(access), async (tx) => {
      const branch = await tx.branch.create({ data: { ...input, organizationId: access.organizationId } });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "branch.created", entity: "Branch", entityId: branch.id, details: { code: branch.code, name: branch.name } });
      return branch;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError("errors.codeTaken");
    throw err;
  }
}

// ───────────────────────── Administrations, fiscal years, periods ─────────────────────────

async function insertFiscalYear(tx: Tx, organizationId: string, administrationId: string, startDate: Date, endDate: Date) {
  const fy = await tx.fiscalYear.create({
    data: { organizationId, administrationId, code: fiscalYearCode(startDate, endDate), startDate, endDate },
  });
  await tx.accountingPeriod.createMany({
    data: planPeriods(startDate, endDate).map((p) => ({ organizationId, fiscalYearId: fy.id, ...p })),
  });
  return fy;
}

export async function createAdministration(access: Access, input: Omit<z.infer<typeof administrationSchema>, "chart"> & { chart?: "STANDARD" | "EMPTY" }) {
  assertCan(access, "administrations.create", input.companyId);
  const { startDate, endDate } = fiscalYearRange(input.startYear, input.startMonth);
  try {
    return await withTenant(scopeOf(access), async (tx) => {
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company || company.status !== "ACTIVE") throw new UserError("errors.notFound");
      const admin = await tx.administration.create({
        data: {
          organizationId: access.organizationId, companyId: input.companyId, code: input.code, name: input.name,
          baseCurrency: input.baseCurrency, status: "ACTIVE",
        },
      });
      const fy = await insertFiscalYear(tx, access.organizationId, admin.id, startDate, endDate);
      if (input.chart !== "EMPTY") {
        await installStandardChart(tx, access.organizationId, admin.id);
        await installOperations(tx, access.organizationId, admin.id);
      }
      await audit(tx, {
        organizationId: access.organizationId, userId: access.userId, action: "administration.created", entity: "Administration", entityId: admin.id,
        details: { code: admin.code, baseCurrency: admin.baseCurrency, firstFiscalYear: fy.code, chart: input.chart ?? "STANDARD" },
      });
      return { administration: admin, fiscalYear: fy };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError("errors.codeTaken");
    throw err;
  }
}

/** Adds the next fiscal year directly after the latest one (12 months). */
export async function createNextFiscalYear(access: Access, administrationId: string) {
  return withTenant(scopeOf(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "administrations.edit", admin.companyId);
    const last = await tx.fiscalYear.findFirst({ where: { administrationId }, orderBy: { startDate: "desc" } });
    if (!last) throw new UserError("errors.notFound");
    const startDate = new Date(Date.UTC(last.endDate.getUTCFullYear(), last.endDate.getUTCMonth(), last.endDate.getUTCDate() + 1));
    const { endDate } = fiscalYearRange(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1);
    const fy = await insertFiscalYear(tx, access.organizationId, administrationId, startDate, endDate);
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "fiscalYear.created", entity: "FiscalYear", entityId: fy.id, details: { code: fy.code } });
    return fy;
  });
}

const PERIOD_ORDER = { OPEN: 0, SOFT_CLOSED: 1, CLOSED: 2 } as const;

export async function setPeriodStatus(access: Access, input: z.infer<typeof periodStatusSchema>) {
  return withTenant(scopeOf(access), async (tx) => {
    const period = await tx.accountingPeriod.findUnique({ where: { id: input.periodId }, include: { fiscalYear: { include: { administration: true } } } });
    if (!period) throw new UserError("errors.notFound");
    assertCan(access, "periods.close", period.fiscalYear.administration.companyId);
    if (period.fiscalYear.status === "CLOSED") throw new UserError("errors.fiscalYearClosed");
    if (period.status === input.status) return period;
    const reopening = PERIOD_ORDER[input.status] < PERIOD_ORDER[period.status];
    if (reopening && !input.reason) throw new UserError("errors.reasonRequired");
    // F3: a period can only be (soft-)closed when no unposted entries are dated in it.
    if (!reopening) {
      const unposted = await tx.journalEntry.count({ where: { periodId: period.id, status: { not: "POSTED" } } });
      if (unposted > 0) throw new UserError("errors.periodHasUnposted", { count: unposted });
    }
    const updated = await tx.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: input.status,
        closedById: input.status === "OPEN" ? null : access.userId,
        closedAt: input.status === "OPEN" ? null : new Date(),
      },
    });
    await audit(tx, {
      organizationId: access.organizationId, userId: access.userId, action: reopening ? "period.reopened" : "period.closed", entity: "AccountingPeriod", entityId: period.id,
      details: { fiscalYear: period.fiscalYear.code, number: period.number, from: period.status, to: input.status, reason: input.reason ?? null },
    });
    return updated;
  });
}

// ───────────────────────── Members and assignments ─────────────────────────

export interface InviteResult {
  membershipId: string;
  /** Raw invitation token; present only for a new user. Shown once to the inviter when no e-mail is configured. */
  invitationToken: string | null;
}

export async function inviteMember(access: Access, input: z.infer<typeof inviteSchema>): Promise<InviteResult> {
  assertCan(access, "organization.manageUsers");
  if (!rolesForKind(access.organizationKind).includes(input.roleCode)) throw new UserError("errors.roleNotAllowed");
  if (SYSTEM_ROLES[input.roleCode].orgWide && !access.orgWide) throw new UserError("errors.forbidden");

  // Users are global: finding or creating one is a system operation; the membership is tenant data.
  let user = await systemDb.user.findUnique({ where: { email: input.email } });
  let invitationToken: string | null = null;
  if (!user) {
    user = await systemDb.user.create({
      data: { email: input.email, name: input.name, passwordHash: "!invited", isActive: true },
    });
    invitationToken = randomToken();
    await systemDb.userToken.create({
      data: { tokenHash: sha256(invitationToken), kind: "INVITATION", userId: user.id, organizationId: access.organizationId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
  }
  const roleId = await systemRoleId(systemDb, input.roleCode);
  const userId = user.id;
  try {
    return await withTenant(scopeOf(access), async (tx) => {
      const membership = await tx.organizationMembership.create({
        data: { organizationId: access.organizationId, userId, roleId, status: invitationToken ? "INVITED" : "ACTIVE" },
      });
      await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "member.invited", entity: "OrganizationMembership", entityId: membership.id, details: { email: input.email, role: input.roleCode } });
      if (!invitationToken) await notify(tx, access.organizationId, [userId], "memberAdded", { role: input.roleCode });
      return { membershipId: membership.id, invitationToken };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError("errors.alreadyMember");
    throw err;
  }
}

export async function updateMembership(access: Access, input: z.infer<typeof membershipUpdateSchema>) {
  assertCan(access, "organization.manageUsers");
  return withTenant(scopeOf(access), async (tx) => {
    const m = await tx.organizationMembership.findUnique({ where: { id: input.membershipId }, include: { role: true } });
    if (!m) throw new UserError("errors.notFound");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId } });
    if (m.userId === org.ownerUserId) throw new UserError("errors.cannotChangeOwner");
    if (m.userId === access.userId) throw new UserError("errors.cannotChangeSelf");
    const data: Prisma.OrganizationMembershipUncheckedUpdateInput = {};
    if (input.roleCode) {
      if (!rolesForKind(access.organizationKind).includes(input.roleCode)) throw new UserError("errors.roleNotAllowed");
      if ((SYSTEM_ROLES[input.roleCode].orgWide || m.role.orgWide) && !access.orgWide) throw new UserError("errors.forbidden");
      data.roleId = await systemRoleId(tx, input.roleCode);
    }
    if (input.status) data.status = input.status;
    const updated = await tx.organizationMembership.update({ where: { id: m.id }, data });
    await audit(tx, {
      organizationId: access.organizationId, userId: access.userId, action: "member.updated", entity: "OrganizationMembership", entityId: m.id,
      details: { from: { role: m.role.code, status: m.status }, to: { role: input.roleCode ?? m.role.code, status: input.status ?? m.status } },
    });
    return updated;
  });
}

export async function assignCompany(access: Access, input: z.infer<typeof assignmentSchema>) {
  if (!(access.orgPermissions.has("organization.manageUsers") || access.companyPermissions.get(input.companyId)?.has("companies.manageUsers"))) {
    assertCan(access, "organization.manageUsers");
  }
  if (SYSTEM_ROLES[input.roleCode].orgWide) throw new UserError("errors.roleNotAllowed");
  return withTenant(scopeOf(access), async (tx) => {
    const member = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: access.organizationId, userId: input.userId } } });
    const company = await tx.company.findUnique({ where: { id: input.companyId } });
    if (!member || !company) throw new UserError("errors.notFound");
    const roleId = await systemRoleId(tx, input.roleCode);
    const assignment = await tx.companyAssignment.upsert({
      where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
      create: { organizationId: access.organizationId, companyId: input.companyId, userId: input.userId, roleId },
      update: { roleId },
    });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "assignment.saved", entity: "CompanyAssignment", entityId: assignment.id, details: { companyId: input.companyId, userId: input.userId, role: input.roleCode } });
    await notify(tx, access.organizationId, [input.userId], "companyAssigned", { company: company.name, role: input.roleCode });
    return assignment;
  });
}

export async function removeAssignment(access: Access, assignmentId: string) {
  return withTenant(scopeOf(access), async (tx) => {
    const a = await tx.companyAssignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw new UserError("errors.notFound");
    if (!(access.orgPermissions.has("organization.manageUsers") || access.companyPermissions.get(a.companyId)?.has("companies.manageUsers"))) {
      assertCan(access, "organization.manageUsers");
    }
    await tx.companyAssignment.delete({ where: { id: a.id } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "assignment.removed", entity: "CompanyAssignment", entityId: a.id, details: { companyId: a.companyId, userId: a.userId } });
  });
}

export function requiresMfa(roleCode: RoleCode, orgRequiresMfa: boolean): boolean {
  return orgRequiresMfa && ADMIN_ROLES.includes(roleCode);
}
