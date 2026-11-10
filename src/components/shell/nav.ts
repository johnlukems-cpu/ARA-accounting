import type { Permission } from "@/core/auth/permissions";

/**
 * Sidebar entries. Only modules that are actually built are listed; later phases add their entries here.
 * `permission` is checked server-side before rendering (pages enforce it again).
 */
export interface NavItem {
  key: string;
  href: string | ((ids: { administrationId?: string }) => string | null);
  permission?: Permission;
  icon: "dashboard" | "building" | "briefcase" | "book" | "users" | "shield" | "user";
}

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/app", icon: "dashboard" },
  { key: "administration", href: ({ administrationId }) => (administrationId ? `/app/administrations/${administrationId}` : null), permission: "administrations.view", icon: "book" },
  { key: "companies", href: "/app/companies", permission: "companies.view", icon: "briefcase" },
  { key: "organization", href: "/app/organization", permission: "organization.view", icon: "building" },
  { key: "users", href: "/app/users", permission: "organization.manageUsers", icon: "users" },
  { key: "audit", href: "/app/audit", permission: "audit.view", icon: "shield" },
  { key: "account", href: "/app/account", icon: "user" },
];
