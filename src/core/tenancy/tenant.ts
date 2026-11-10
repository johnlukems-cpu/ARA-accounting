import { systemDb, type Tx } from "@/core/db/client";

export interface TenantScope {
  organizationId: string;
  userId: string;
}

export interface TenantOptions {
  /** Transaction timeout in ms (default 15 s). */
  timeout?: number;
  isolationLevel?: "ReadCommitted" | "RepeatableRead" | "Serializable";
}

/**
 * Runs `fn` in one database transaction as role `ara_app` with the tenant's organisation and user set.
 * Row-level security therefore applies to every query inside, whatever the code does.
 */
export async function withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>, options: TenantOptions = {}): Promise<T> {
  if (!scope.organizationId || !scope.userId) throw new Error("Tenant scope requires organizationId and userId");
  return systemDb.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ara_app");
      await tx.$executeRaw`SELECT set_config('app.org_id', ${scope.organizationId}, true), set_config('app.user_id', ${scope.userId}, true)`;
      return fn(tx);
    },
    { timeout: options.timeout ?? 15_000, maxWait: 10_000, isolationLevel: options.isolationLevel },
  );
}

/** Tenant role with only a user set (no active organisation): sees the user's own memberships. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE ara_app");
    await tx.$executeRaw`SELECT set_config('app.org_id', '', true), set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
