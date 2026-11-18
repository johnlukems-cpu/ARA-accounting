import type { Permission } from "@/core/auth/permissions";

/** Admin portal navigation (ARA Intelligent Solutions staff). Items are shown only with the permission. */
export const ADMIN_NAV: { key: string; href: string; permission?: Permission; icon: string; section?: "sales" | "finance" | "organisation" }[] = [
  { key: "dashboard", href: "/admin", icon: "dashboard" },
  { key: "crm", href: "/admin/crm", permission: "crm.view", icon: "pipeline", section: "sales" },
  { key: "customers", href: "/admin/customers", permission: "crm.view", icon: "customers", section: "sales" },
  { key: "products", href: "/admin/products", permission: "catalog.view", icon: "products", section: "sales" },
  { key: "quotations", href: "/admin/quotations", permission: "quotes.view", icon: "quotes", section: "sales" },
  { key: "invoices", href: "/admin/invoices", permission: "sales.view", icon: "invoices", section: "sales" },
  { key: "subscriptions", href: "/admin/subscriptions", permission: "billing.view", icon: "subscriptions", section: "sales" },
  { key: "payments", href: "/admin/payments", permission: "payments.view", icon: "payments", section: "finance" },
  { key: "receivables", href: "/admin/receivables", permission: "sales.view", icon: "receivables", section: "finance" },
  { key: "purchases", href: "/admin/purchases", permission: "purchase.view", icon: "purchases", section: "finance" },
  { key: "expenses", href: "/admin/expenses", permission: "purchase.view", icon: "expenses", section: "finance" },
  { key: "banking", href: "/admin/banking", permission: "banking.view", icon: "banking", section: "finance" },
  { key: "finance", href: "/admin/finance", permission: "reports.view", icon: "finance", section: "finance" },
  { key: "reports", href: "/admin/reports", permission: "reports.view", icon: "reports", section: "finance" },
  { key: "employees", href: "/admin/employees", permission: "organization.view", icon: "employees", section: "organisation" },
  { key: "support", href: "/admin/support", permission: "support.view", icon: "support", section: "organisation" },
  { key: "settings", href: "/admin/settings", permission: "organization.view", icon: "settings", section: "organisation" },
];
