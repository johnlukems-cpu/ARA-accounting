import { describe, expect, it } from "vitest";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { verifyAuditChain } from "@/core/audit/audit";
import { can, resolveAccess } from "@/core/auth/access";
import { ForbiddenError, UserError } from "@/core/errors";
import {
  assignCompany, createAdministration, createBranch, createCompany, createNextFiscalYear, inviteMember,
  setPeriodStatus, updateMembership, updateOrganization,
} from "@/modules/organization/service";
import { companyInput, newOrganization, refresh, uid } from "./helpers";

describe("Phase 1 acceptance: organisations, companies, administrations", () => {
  it("a user can register an organisation and becomes its owner", async () => {
    const { access } = await newOrganization("BUSINESS");
    expect(access.roleCode).toBe("ORGANIZATION_OWNER");
    expect(access.orgWide).toBe(true);
    expect(can(access, "organization.manageUsers")).toBe(true);
  });

  it("an accounting firm registers with a Firm Administrator", async () => {
    const { access } = await newOrganization("ACCOUNTING_FIRM");
    expect(access.roleCode).toBe("FIRM_ADMIN");
  });

  it("refuses a second registration with the same e-mail address", async () => {
    const { email } = await newOrganization();
    await expect(newOrganizationWithEmail(email)).rejects.toMatchObject({ key: "errors.emailTaken" });
  });

  it("an organisation can create several companies, each with several administrations and fiscal years", async () => {
    const org = await newOrganization();
    const c1 = await createCompany(org.access, companyInput());
    const c2 = await createCompany(org.access, companyInput());
    const access = await refresh(org.access);
    const a1 = await createAdministration(access, { companyId: c1.id, code: "HOOFD", name: "Hoofdadministratie", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    const a2 = await createAdministration(access, { companyId: c1.id, code: "USD", name: "USD-administratie", baseCurrency: "USD", startYear: 2026, startMonth: 7 });
    await createAdministration(access, { companyId: c2.id, code: "HOOFD", name: "Hoofdadministratie", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });

    const periods = await systemDb.accountingPeriod.findMany({ where: { fiscalYearId: a1.fiscalYear.id }, orderBy: { number: "asc" } });
    expect(periods.map((p) => p.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(a2.fiscalYear.code).toBe("2026/2027");

    const next = await createNextFiscalYear(access, a1.administration.id);
    expect(next.code).toBe("2027");
    expect(next.startDate.toISOString().slice(0, 10)).toBe("2027-01-01");

    await expect(
      createAdministration(access, { companyId: c1.id, code: "HOOFD", name: "Dubbel", baseCurrency: "SRD", startYear: 2026, startMonth: 1 }),
    ).rejects.toMatchObject({ key: "errors.codeTaken" });

    const branch = await createBranch(access, { companyId: c1.id, code: "NICK", name: "Vestiging Nickerie", district: "NICKERIE" });
    expect(branch.code).toBe("NICK");
  });

  it("the database refuses overlapping fiscal years", async () => {
    const org = await newOrganization();
    const c = await createCompany(org.access, companyInput());
    const access = await refresh(org.access);
    const { administration } = await createAdministration(access, { companyId: c.id, code: "A", name: "Admin", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    await expect(
      withTenant(access, (tx) =>
        tx.fiscalYear.create({
          data: { organizationId: access.organizationId, administrationId: administration.id, code: "X", startDate: new Date("2026-06-01"), endDate: new Date("2027-05-31") },
        }),
      ),
    ).rejects.toThrow(/fiscal_year_no_overlap|exclusion/i);
  });

  it("periods can be soft-closed, closed and reopened only with a reason", async () => {
    const org = await newOrganization();
    const c = await createCompany(org.access, companyInput());
    const access = await refresh(org.access);
    const { fiscalYear } = await createAdministration(access, { companyId: c.id, code: "A", name: "Admin", baseCurrency: "SRD", startYear: 2026, startMonth: 1 });
    const jan = await systemDb.accountingPeriod.findFirstOrThrow({ where: { fiscalYearId: fiscalYear.id, number: 1 } });
    await setPeriodStatus(access, { periodId: jan.id, status: "CLOSED" });
    await expect(setPeriodStatus(access, { periodId: jan.id, status: "OPEN" })).rejects.toMatchObject({ key: "errors.reasonRequired" });
    const reopened = await setPeriodStatus(access, { periodId: jan.id, status: "OPEN", reason: "Correctie bankboeking" });
    expect(reopened.status).toBe("OPEN");
  });
});

describe("Phase 1 acceptance: users and permissions", () => {
  it("members get different permissions per company through assignments", async () => {
    const org = await newOrganization();
    const c1 = await createCompany(org.access, companyInput());
    const c2 = await createCompany(org.access, companyInput());
    const owner = await refresh(org.access);

    const invite = await inviteMember(owner, { email: `${uid("bk")}@example.test`, name: "Boekhouder", roleCode: "BOOKKEEPER" });
    expect(invite.invitationToken).toBeTruthy();
    const member = await systemDb.organizationMembership.findUniqueOrThrow({ where: { id: invite.membershipId } });
    await systemDb.organizationMembership.update({ where: { id: member.id }, data: { status: "ACTIVE" } }); // accepted

    await assignCompany(owner, { companyId: c1.id, userId: member.userId, roleCode: "BOOKKEEPER" });
    const bk = (await resolveAccess(member.userId, owner.organizationId))!;

    expect(can(bk, "ledger.create", c1.id)).toBe(true);
    expect(can(bk, "ledger.create", c2.id)).toBe(false);
    expect(can(bk, "periods.close", c1.id)).toBe(false);
    expect(can(bk, "organization.manageUsers")).toBe(false);

    await expect(createAdministration(bk, { companyId: c1.id, code: "B", name: "B", baseCurrency: "SRD", startYear: 2026, startMonth: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteMember(bk, { email: `${uid()}@example.test`, name: "X Y", roleCode: "READ_ONLY" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("disabled members lose all access; the owner cannot be changed", async () => {
    const org = await newOrganization();
    const owner = org.access;
    const invite = await inviteMember(owner, { email: `${uid("ro")}@example.test`, name: "Lezer", roleCode: "READ_ONLY" });
    const m = await systemDb.organizationMembership.findUniqueOrThrow({ where: { id: invite.membershipId } });
    await systemDb.organizationMembership.update({ where: { id: m.id }, data: { status: "ACTIVE" } });
    expect(await resolveAccess(m.userId, owner.organizationId)).not.toBeNull();
    await updateMembership(owner, { membershipId: m.id, status: "DISABLED" });
    expect(await resolveAccess(m.userId, owner.organizationId)).toBeNull();

    const ownerMembership = await systemDb.organizationMembership.findFirstOrThrow({ where: { organizationId: owner.organizationId, userId: owner.userId } });
    await expect(updateMembership(owner, { membershipId: ownerMembership.id, roleCode: "READ_ONLY" })).rejects.toBeInstanceOf(UserError);
  });

  it("a business cannot hand out accounting-firm roles", async () => {
    const org = await newOrganization("BUSINESS");
    await expect(inviteMember(org.access, { email: `${uid()}@example.test`, name: "Klant Beheerder", roleCode: "CLIENT_ADMIN" })).rejects.toMatchObject({ key: "errors.roleNotAllowed" });
  });
});

describe("Phase 1 acceptance: tenant isolation (row-level security)", () => {
  it("one organisation can never read or change another organisation's data", async () => {
    const a = await newOrganization();
    const b = await newOrganization();
    const companyB = await createCompany(b.access, companyInput("Geheim B"));

    await withTenant(a.access, async (tx) => {
      // Reads are filtered by the database, whatever the query asks for.
      expect(await tx.company.findMany({ where: { id: companyB.id } })).toHaveLength(0);
      expect(await tx.company.findUnique({ where: { id: companyB.id } })).toBeNull();
      expect(await tx.organization.findUnique({ where: { id: b.organizationId } })).toBeNull();
      expect(await tx.user.findUnique({ where: { id: b.userId } })).toBeNull();
      expect(await tx.auditLog.count({ where: { organizationId: b.organizationId } })).toBe(0);
      // Updates and deletes do not reach the other tenant.
      expect((await tx.company.updateMany({ where: { id: companyB.id }, data: { name: "gekaapt" } })).count).toBe(0);
      expect((await tx.company.deleteMany({ where: { id: companyB.id } })).count).toBe(0);
    });

    // Inserting a row for another organisation is rejected by the policy's WITH CHECK.
    await expect(
      withTenant(a.access, (tx) => tx.company.create({ data: { organizationId: b.organizationId, name: "Inbraak", legalForm: "NV" } })),
    ).rejects.toThrow(/row-level security/i);

    // Tenant role has no access to sessions or tokens at all.
    await expect(withTenant(a.access, (tx) => tx.session.findMany())).rejects.toThrow(/permission denied/i);

    const untouched = await systemDb.company.findUniqueOrThrow({ where: { id: companyB.id } });
    expect(untouched.name).toBe("Geheim B");
  });

  it("services refuse ids from another organisation", async () => {
    const a = await newOrganization();
    const b = await newOrganization();
    const companyB = await createCompany(b.access, companyInput());
    const accessA = await refresh(a.access);
    await expect(
      createAdministration(accessA, { companyId: companyB.id, code: "X", name: "X", baseCurrency: "SRD", startYear: 2026, startMonth: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Phase 1 acceptance: audit trail", () => {
  it("records actions in a verifiable hash chain that cannot be altered", async () => {
    const org = await newOrganization();
    await createCompany(org.access, companyInput());
    await updateOrganization(org.access, { name: `Hernoemd ${uid()}`, requireMfaForAdmins: true });

    const check = await withTenant(org.access, (tx) => verifyAuditChain(tx, org.organizationId));
    expect(check.ok).toBe(true);
    expect(check.checked).toBeGreaterThanOrEqual(3);

    // Not even the database owner can update or delete audit records.
    await expect(systemDb.auditLog.updateMany({ where: { organizationId: org.organizationId }, data: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(systemDb.auditLog.deleteMany({ where: { organizationId: org.organizationId } })).rejects.toThrow(/append-only/);
  });
});

async function newOrganizationWithEmail(email: string) {
  const { registerOrganization } = await import("@/modules/organization/service");
  return registerOrganization({ kind: "BUSINESS", organizationName: "Dubbel", name: "Dubbel", email, password: "a-long-test-password" });
}
