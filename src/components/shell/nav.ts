import type { Permission } from "@/core/auth/permissions";

/**
 * Sidebar entries. Only modules that are actually built are listed; later phases add their entries here.
 * `permission` is checked server-side before rendering (pages enforce it again).
 */
export interface NavItem {
  key: string;
  href: string | ((ids: { administrationId?: string }) => string | null);
  permission?: Permission;
  icon: "dashboard" | "building" | "briefcase" | "book" | "users" | "shield" | "user" | "list" | "scale" | "library" | "notebook";
  /** Section heading shown above the item in the sidebar. */
  section?: "accounting" | "settings";
}

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/app", icon: "dashboard" },
  { key: "entries", href: "/app/ledger/entries", permission: "ledger.view", icon: "list", section: "accounting" },
  { key: "trialBalance", href: "/app/ledger/trial-balance", permission: "ledger.view", icon: "scale", section: "accounting" },
  { key: "generalLedger", href: "/app/ledger/general-ledger", permission: "ledger.view", icon: "notebook", section: "accounting" },
  { key: "accounts", href: "/app/ledger/accounts", permission: "ledger.view", icon: "library", section: "accounting" },
  { key: "journals", href: "/app/ledger/journals", permission: "ledger.view", icon: "book", section: "accounting" },
  { key: "administration", href: ({ administrationId }) => (administrationId ? `/app/administrations/${administrationId}` : null), permission: "administrations.view", icon: "book", section: "settings" },
  { key: "companies", href: "/app/companies", permission: "companies.view", icon: "briefcase", section: "settings" },
  { key: "organization", href: "/app/organization", permission: "organization.view", icon: "building", section: "settings" },
  { key: "users", href: "/app/users", permission: "organization.manageUsers", icon: "users", section: "settings" },
  { key: "audit", href: "/app/audit", permission: "audit.view", icon: "shield", section: "settings" },
  { key: "account", href: "/app/account", icon: "user", section: "settings" },
];
