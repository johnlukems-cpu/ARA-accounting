import type { Permission } from "@/core/auth/permissions";

/**
 * Sidebar entries. Only modules that are actually built are listed; later phases add their entries here.
 * `permission` is checked server-side before rendering (pages enforce it again).
 */
export interface NavItem {
  key: string;
  href: string | ((ids: { administrationId?: string }) => string | null);
  permission?: Permission;
  icon: "dashboard" | "building" | "briefcase" | "book" | "users" | "shield" | "user" | "list" | "scale" | "library" | "notebook" | "receipt" | "cart" | "contact" | "wallet" | "landmark" | "percent" | "transfer" | "factory" | "template" | "coins";
  /** Section heading shown above the item in the sidebar. */
  section?: "operations" | "accounting" | "settings";
}

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/app", icon: "dashboard" },
  { key: "sales", href: "/app/sales", permission: "sales.view", icon: "receipt", section: "operations" },
  { key: "purchase", href: "/app/purchase", permission: "purchase.view", icon: "cart", section: "operations" },
  { key: "relations", href: "/app/relations", permission: "sales.view", icon: "contact", section: "operations" },
  { key: "receivables", href: "/app/receivables", permission: "sales.view", icon: "wallet", section: "operations" },
  { key: "payables", href: "/app/payables", permission: "purchase.view", icon: "wallet", section: "operations" },
  { key: "banking", href: "/app/banking", permission: "banking.view", icon: "landmark", section: "operations" },
  { key: "currentAccounts", href: "/app/current-accounts", permission: "currentAccounts.view", icon: "transfer", section: "operations" },
  { key: "assets", href: "/app/assets", permission: "assets.view", icon: "factory", section: "operations" },
  { key: "currency", href: "/app/currency", permission: "currency.view", icon: "coins", section: "accounting" },
  { key: "entries", href: "/app/ledger/entries", permission: "ledger.view", icon: "list", section: "accounting" },
  { key: "trialBalance", href: "/app/ledger/trial-balance", permission: "ledger.view", icon: "scale", section: "accounting" },
  { key: "generalLedger", href: "/app/ledger/general-ledger", permission: "ledger.view", icon: "notebook", section: "accounting" },
  { key: "accounts", href: "/app/ledger/accounts", permission: "ledger.view", icon: "library", section: "accounting" },
  { key: "journals", href: "/app/ledger/journals", permission: "ledger.view", icon: "book", section: "accounting" },
  { key: "taxCodes", href: "/app/ledger/tax-codes", permission: "tax.view", icon: "percent", section: "accounting" },
  { key: "administration", href: ({ administrationId }) => (administrationId ? `/app/administrations/${administrationId}` : null), permission: "administrations.view", icon: "book", section: "settings" },
  { key: "templates", href: "/app/templates", permission: "industry.view", icon: "template", section: "settings" },
  { key: "companies", href: "/app/companies", permission: "companies.view", icon: "briefcase", section: "settings" },
  { key: "organization", href: "/app/organization", permission: "organization.view", icon: "building", section: "settings" },
  { key: "users", href: "/app/users", permission: "organization.manageUsers", icon: "users", section: "settings" },
  { key: "audit", href: "/app/audit", permission: "audit.view", icon: "shield", section: "settings" },
  { key: "account", href: "/app/account", icon: "user", section: "settings" },
];
