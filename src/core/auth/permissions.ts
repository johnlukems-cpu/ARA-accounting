/**
 * Permission matrix — the single source of truth for system roles (synced to the Role/RolePermission
 * tables by the seed). Permission codes are "<module>.<action>".
 *
 * Scope:
 * - ORGANIZATION-scoped permissions (module "organization" and "companies.create") come from the
 *   organisation membership role.
 * - COMPANY-scoped permissions come from an org-wide role (Owner, Firm Administrator) or from the
 *   user's CompanyAssignment for that company.
 */

export const ACTIONS = ["view", "create", "edit", "approve", "post", "reverse", "export", "close", "manageUsers", "manageSettings"] as const;
export type Action = (typeof ACTIONS)[number];

export const MODULE_ACTIONS = {
  organization: ["view", "edit", "manageUsers", "manageSettings"],
  companies: ["view", "create", "edit", "manageUsers"],
  administrations: ["view", "create", "edit", "manageSettings"],
  periods: ["view", "close"],
  ledger: ["view", "create", "edit", "approve", "post", "reverse", "export"],
  purchase: ["view", "create", "edit", "approve", "post", "export"],
  sales: ["view", "create", "edit", "approve", "post", "export"],
  banking: ["view", "create", "edit", "approve", "post", "export"],
  currentAccounts: ["view", "create", "edit", "post", "export"],
  assets: ["view", "create", "edit", "approve", "post", "export"],
  industry: ["view", "create", "edit", "manageSettings"],
  currency: ["view", "create", "edit", "approve", "post"],
  budgets: ["view", "create", "edit", "approve", "export"],
  scan: ["view", "create", "edit", "approve", "post"],
  reports: ["view", "export"],
  yearEnd: ["view", "edit", "approve", "post", "close"],
  annualAccounts: ["view", "edit", "approve", "export"],
  tax: ["view", "edit", "approve", "export"],
  quality: ["view", "edit"],
  automation: ["view", "edit", "manageSettings"],
  practice: ["view", "edit"],
  audit: ["view", "export"],
} as const satisfies Record<string, readonly Action[]>;

export type Module = keyof typeof MODULE_ACTIONS;
export type Permission = { [M in Module]: `${M}.${(typeof MODULE_ACTIONS)[M][number]}` }[Module];

export const ALL_PERMISSIONS: Permission[] = (Object.keys(MODULE_ACTIONS) as Module[]).flatMap((m) =>
  MODULE_ACTIONS[m].map((a) => `${m}.${a}` as Permission),
);

const ORG_SCOPED = new Set<string>([
  "organization.view", "organization.edit", "organization.manageUsers", "organization.manageSettings", "companies.create",
  // Industry templates belong to the organisation (Phase 4), not to one company.
  "industry.view", "industry.create", "industry.edit", "industry.manageSettings",
]);
export function isOrgScoped(p: Permission): boolean {
  return ORG_SCOPED.has(p);
}

export const ROLE_CODES = [
  "ORGANIZATION_OWNER",
  "FIRM_ADMIN",
  "SENIOR_ACCOUNTANT",
  "ACCOUNTANT",
  "BOOKKEEPER",
  "FINANCIAL_CONTROLLER",
  "CLIENT_ADMIN",
  "APPROVAL_MANAGER",
  "READ_ONLY",
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const OPERATIONAL: Module[] = ["ledger", "purchase", "sales", "banking", "currentAccounts", "assets", "currency", "scan"];
const ALL_MODULES = Object.keys(MODULE_ACTIONS) as Module[];

function pick(modules: Module[], actions: Action[]): Permission[] {
  return modules.flatMap((m) =>
    (MODULE_ACTIONS[m] as readonly Action[]).filter((a) => actions.includes(a)).map((a) => `${m}.${a}` as Permission),
  );
}
function without(list: Permission[], remove: Permission[]): Permission[] {
  const r = new Set(remove);
  return list.filter((p) => !r.has(p));
}

const viewAll = pick(ALL_MODULES, ["view"]);

export const SYSTEM_ROLES: Record<RoleCode, { name: string; nameEn: string; orgWide: boolean; permissions: Permission[] }> = {
  ORGANIZATION_OWNER: { name: "Eigenaar organisatie", nameEn: "Organisation owner", orgWide: true, permissions: ALL_PERMISSIONS },
  FIRM_ADMIN: { name: "Beheerder accountantskantoor", nameEn: "Accounting firm administrator", orgWide: true, permissions: ALL_PERMISSIONS },
  SENIOR_ACCOUNTANT: {
    name: "Senior accountant",
    nameEn: "Senior accountant",
    orgWide: false,
    permissions: without(ALL_PERMISSIONS, [
      "organization.edit", "organization.manageUsers", "organization.manageSettings", "companies.create", "companies.manageUsers",
      "administrations.manageSettings", "automation.manageSettings", "industry.manageSettings",
    ]),
  },
  ACCOUNTANT: {
    name: "Accountant",
    nameEn: "Accountant",
    orgWide: false,
    permissions: [
      ...viewAll.filter((p) => p !== "audit.view"),
      ...pick([...OPERATIONAL, "budgets", "yearEnd", "annualAccounts", "tax", "quality", "industry"], ["create", "edit", "post", "export"]),
      "ledger.reverse", "reports.export", "administrations.edit",
    ],
  },
  BOOKKEEPER: {
    name: "Boekhouder",
    nameEn: "Bookkeeper",
    orgWide: false,
    permissions: [
      ...pick(["companies", "administrations", "periods", ...OPERATIONAL, "reports", "quality"], ["view"]),
      ...pick(OPERATIONAL, ["create", "edit"]),
      ...pick(["purchase", "sales", "banking", "scan"], ["post"]),
    ],
  },
  FINANCIAL_CONTROLLER: {
    name: "Financial controller",
    nameEn: "Financial controller",
    orgWide: false,
    permissions: [
      ...viewAll,
      ...pick(ALL_MODULES.filter((m) => m !== "organization" && m !== "companies"), ["approve", "post", "reverse", "export", "close"]),
      ...pick(["budgets"], ["create", "edit"]),
    ],
  },
  CLIENT_ADMIN: {
    name: "Beheerder klant",
    nameEn: "Client administrator",
    orgWide: false,
    permissions: [
      ...pick(["companies", "administrations", "periods", ...OPERATIONAL, "budgets", "reports", "annualAccounts", "tax"], ["view"]),
      ...pick(["purchase", "sales", "scan"], ["create", "edit"]),
      "purchase.approve", "reports.export", "companies.edit", "companies.manageUsers",
    ],
  },
  APPROVAL_MANAGER: {
    name: "Goedkeurder",
    nameEn: "Approval manager",
    orgWide: false,
    permissions: [
      ...pick(["companies", "administrations", "periods", ...OPERATIONAL, "budgets", "reports", "yearEnd", "tax"], ["view"]),
      ...pick(["ledger", "purchase", "sales", "banking", "assets", "budgets", "yearEnd", "tax", "scan", "currency"], ["approve"]),
    ],
  },
  READ_ONLY: { name: "Alleen lezen", nameEn: "Read-only user", orgWide: false, permissions: viewAll.filter((p) => p !== "audit.view") },
};

/** Roles that may be granted at organisation level for each organisation kind. */
export function rolesForKind(kind: "BUSINESS" | "ACCOUNTING_FIRM"): RoleCode[] {
  return kind === "ACCOUNTING_FIRM"
    ? ["FIRM_ADMIN", "SENIOR_ACCOUNTANT", "ACCOUNTANT", "BOOKKEEPER", "FINANCIAL_CONTROLLER", "APPROVAL_MANAGER", "CLIENT_ADMIN", "READ_ONLY"]
    : ["ORGANIZATION_OWNER", "FINANCIAL_CONTROLLER", "ACCOUNTANT", "BOOKKEEPER", "APPROVAL_MANAGER", "READ_ONLY"];
}

/** Roles that require MFA when the organisation enforces MFA for administrators. */
export const ADMIN_ROLES: RoleCode[] = ["ORGANIZATION_OWNER", "FIRM_ADMIN"];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}
