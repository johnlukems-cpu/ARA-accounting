import { z } from "zod";
import { systemDb, type Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { resolveAccess, can, type Access } from "@/core/auth/access";
import { STAFF_ROLES, type Permission } from "@/core/auth/permissions";
import { UserError, ForbiddenError } from "@/core/errors";
import { createAdministration, createCompany } from "@/modules/organization/service";
import { createAccount } from "@/modules/ledger/service";
import { LEGAL_FORMS } from "@/modules/organization/schemas";

/**
 * "ARA home": ARA Intelligent Solutions' OWN organisation, company and administration in the accounting engine.
 * The admin portal (CRM, quotations, subscriptions, payments, internal finance) works inside this tenant only, so ARA's
 * books are isolated by RLS from every customer's books — and customer bookkeeping never mixes with ARA's.
 */
export interface Home {
  organizationId: string;
  companyId: string;
  administrationId: string;
}

export async function getHome(db: Pick<Tx, "platformSetting"> = systemDb): Promise<Home | null> {
  const row = await db.platformSetting.findUnique({ where: { key: "araHome" } });
  const v = row?.value as Partial<Home> | undefined;
  return v?.organizationId && v.companyId && v.administrationId ? (v as Home) : null;
}

export const isHomeOrganization = async (organizationId: string) => (await getHome())?.organizationId === organizationId;

/** ARA chart additions (account numbers are editable later in Rekeningschema). Revenue under 8000, costs under 4000. */
export const ARA_ACCOUNTS = [
  { number: "8110", name: "Opbrengst software-abonnementen", nameEn: "Software subscription revenue", category: "REVENUE", parent: "8000" },
  { number: "8120", name: "Opbrengst implementatie en onboarding", nameEn: "Implementation and onboarding revenue", category: "REVENUE", parent: "8000" },
  { number: "8130", name: "Opbrengst support en dienstverlening", nameEn: "Support and service revenue", category: "REVENUE", parent: "8000" },
  { number: "8140", name: "Opbrengst consultancy", nameEn: "Consultancy revenue", category: "REVENUE", parent: "8000" },
  { number: "4130", name: "Software-abonnementen", nameEn: "Software subscriptions", category: "OPERATING_EXPENSE", parent: "4000" },
  { number: "4140", name: "Hosting en infrastructuur", nameEn: "Hosting and infrastructure", category: "OPERATING_EXPENSE", parent: "4000" },
] as const;

/** Expense categories of the internal finance module → account number in ARA's administration. */
export const EXPENSE_CATEGORIES = {
  SOFTWARE: "4130", HOSTING: "4140", INFRASTRUCTURE: "4140", MARKETING: "4400", SALARIES: "4010",
  PROFESSIONAL: "4700", OFFICE: "4200", BANK_CHARGES: "9020", OTHER: "4900",
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

/** Initial catalogue: names and billing nature only. Prices, BTW codes and plans are set by the owner. */
export const INITIAL_PRODUCTS = [
  { code: "ARA-ACC", name: "ARA Accounting", category: "SUBSCRIPTION", billingType: "RECURRING", billingInterval: "MONTHLY", revenue: "8110" },
  { code: "ARA-PAY", name: "ARA Payroll", category: "SUBSCRIPTION", billingType: "RECURRING", billingInterval: "MONTHLY", revenue: "8110" },
  { code: "ARA-TAX", name: "ARA Belastingaangifte", category: "SOFTWARE", billingType: "RECURRING", billingInterval: "ANNUAL", revenue: "8110" },
  { code: "ARA-IMPL", name: "ARA implementatie", category: "IMPLEMENTATION", billingType: "ONE_TIME", billingInterval: null, revenue: "8120" },
  { code: "ARA-ONB", name: "ARA onboarding", category: "ONBOARDING", billingType: "ONE_TIME", billingInterval: null, revenue: "8120" },
  { code: "ARA-SUP", name: "ARA support", category: "SUPPORT", billingType: "RECURRING", billingInterval: "MONTHLY", revenue: "8130" },
  { code: "ARA-CONS", name: "Consultancy op maat", category: "CONSULTANCY", billingType: "ONE_TIME", billingInterval: null, revenue: "8140" },
] as const;

export const bootstrapSchema = z.object({
  organizationName: z.string().trim().min(2, "validation.required").max(120),
  companyName: z.string().trim().min(2, "validation.required").max(120),
  legalForm: z.enum(LEGAL_FORMS),
  isBtwRegistered: z.boolean(),
  baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currency").default("SRD"),
  startYear: z.coerce.number().int().min(2000).max(2100),
});

/**
 * Creates ARA's own organisation (once), with the calling platform administrator as ARA Super Administrator, a company,
 * an administration with the standard chart plus ARA's revenue and cost accounts, and the initial product catalogue.
 */
export async function bootstrapHome(userId: string, raw: z.input<typeof bootstrapSchema>): Promise<Home> {
  const user = await systemDb.user.findUnique({ where: { id: userId } });
  if (!user?.isPlatformAdmin || !user.isActive) throw new UserError("errors.forbidden");
  if (await getHome()) throw new UserError("admin.homeExists");
  const input = bootstrapSchema.parse(raw);
  const orgId = await systemDb.$transaction(async (tx) => {
    const role = await tx.role.findFirstOrThrow({ where: { code: "ARA_SUPER_ADMIN", organizationId: null } });
    const org = await tx.organization.create({ data: { name: input.organizationName, kind: "BUSINESS", ownerUserId: userId, status: "ACTIVE", requireMfaForAdmins: true } });
    await tx.organizationMembership.create({ data: { organizationId: org.id, userId, roleId: role.id, status: "ACTIVE" } });
    await audit(tx, { organizationId: org.id, userId, action: "admin.homeCreated", entity: "Organization", entityId: org.id, details: { name: input.organizationName } });
    return org.id;
  });
  let access = (await resolveAccess(userId, orgId))!;
  const company = await createCompany(access, { name: input.companyName, legalForm: input.legalForm, isBtwRegistered: input.isBtwRegistered });
  access = (await resolveAccess(userId, orgId))!;
  const { administration } = await createAdministration(access, { companyId: company.id, code: "ARA", name: input.companyName, baseCurrency: input.baseCurrency, startYear: input.startYear, startMonth: 1 });
  const home: Home = { organizationId: orgId, companyId: company.id, administrationId: administration.id };
  await installHomeData(access, home);
  await systemDb.$transaction(async (tx) => {
    await tx.platformSetting.create({ data: { key: "araHome", value: home as unknown as object, updatedById: userId } });
    await audit(tx, { organizationId: null, userId, action: "platform.araHomeSet", entity: "PlatformSetting", entityId: "araHome", details: home as unknown as object });
  });
  return home;
}

/** ARA accounts and the initial catalogue (idempotent). */
async function installHomeData(access: Access, home: Home) {
  const parents = await withTenant(access, (tx) => tx.account.findMany({ where: { administrationId: home.administrationId, number: { in: ["8000", "4000"] } } }));
  for (const a of ARA_ACCOUNTS) {
    const exists = await withTenant(access, (tx) => tx.account.findFirst({ where: { administrationId: home.administrationId, number: a.number } }));
    if (!exists) await createAccount(access, { administrationId: home.administrationId, number: a.number, name: a.name, nameEn: a.nameEn, category: a.category, type: "DETAIL", parentId: parents.find((p) => p.number === a.parent)?.id, controlType: "NONE" });
  }
  await withTenant(access, async (tx) => {
    const accounts = await tx.account.findMany({ where: { administrationId: home.administrationId, number: { in: INITIAL_PRODUCTS.map((p) => p.revenue) } } });
    for (const p of INITIAL_PRODUCTS) {
      await tx.product.upsert({
        where: { organizationId_code: { organizationId: home.organizationId, code: p.code } },
        update: {},
        create: { organizationId: home.organizationId, code: p.code, name: p.name, category: p.category, billingType: p.billingType, billingInterval: p.billingInterval, currency: "SRD", revenueAccountId: accounts.find((a) => a.number === p.revenue)?.id ?? null },
      });
    }
  });
}

export interface AdminContext {
  access: Access;
  home: Home;
}

/**
 * Access to the admin portal: the user must be an ACTIVE member of ARA's own organisation. Permissions are resolved
 * for that organisation, independent of which organisation the user currently has open in the accounting app.
 */
export async function adminAccess(userId: string, permission?: Permission): Promise<AdminContext> {
  const home = await getHome();
  if (!home) throw new UserError("admin.noHome");
  const access = await resolveAccess(userId, home.organizationId);
  if (!access) throw new ForbiddenError(permission ?? "crm.view");
  if (permission && !can(access, permission, home.companyId)) throw new ForbiddenError(permission);
  return { access, home };
}

export const isStaffRole = (code: string) => (STAFF_ROLES as string[]).includes(code);
