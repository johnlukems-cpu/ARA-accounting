import { randomUUID } from "node:crypto";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { assertCan } from "@/core/auth/access";
import type { Permission } from "@/core/auth/permissions";
import { nextSequence } from "@/core/numbering";
import type { AdminContext } from "./home";

/** Runs `fn` in ARA's own tenant with a permission check (company-scoped to ARA's company). */
export function inHome<T>(ctx: AdminContext, permission: Permission, fn: (tx: Tx) => Promise<T>, timeout = 30_000) {
  assertCan(ctx.access, permission, ctx.home.companyId);
  return withTenant({ organizationId: ctx.access.organizationId, userId: ctx.access.userId }, fn, { timeout });
}

/** Document number per series, e.g. CUS-00001, OFF-2026-00001 (gapless per series and year, serialised by row lock). */
export async function nextNumber(tx: Tx, ctx: AdminContext, series: "CUS" | "OFF" | "ABO" | "BET" | "TIC", year?: number) {
  const n = await nextSequence(tx, ctx.home.organizationId, `ADMIN_${series}`, ctx.home.organizationId, year ? String(year) : "ALL");
  return year ? `${series}-${year}-${String(n).padStart(5, "0")}` : `${series}-${String(n).padStart(5, "0")}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const newId = () => randomUUID();
