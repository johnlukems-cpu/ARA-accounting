import { PrismaClient } from "@prisma/client";

/**
 * System database client. Connects as the database owner, so row-level security does NOT apply.
 * Only trusted core modules (auth, tenancy bootstrap, seeds, platform jobs) may use it directly.
 * All tenant data access goes through `withTenant` (src/core/tenancy).
 */
const globalForPrisma = globalThis as unknown as { araPrisma?: PrismaClient };

export const systemDb: PrismaClient =
  globalForPrisma.araPrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.araPrisma = systemDb;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
