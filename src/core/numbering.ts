import { randomUUID } from "node:crypto";
import type { Tx } from "@/core/db/client";

/**
 * Gapless number sequences (ACCOUNTING_RULES P5). The row is locked FOR UPDATE inside the caller's transaction,
 * so concurrent postings wait; a rolled-back transaction also rolls back the increment.
 */
export async function nextSequence(tx: Tx, organizationId: string, scope: string, scopeId: string, fiscalYearId: string): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "NumberSequence" (id, "organizationId", scope, "scopeId", "fiscalYearId", "nextValue")
    VALUES (${randomUUID()}, ${organizationId}, ${scope}, ${scopeId}, ${fiscalYearId}, 1)
    ON CONFLICT (scope, "scopeId", "fiscalYearId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; nextValue: number }[]>`
    SELECT id, "nextValue" FROM "NumberSequence"
     WHERE scope = ${scope} AND "scopeId" = ${scopeId} AND "fiscalYearId" = ${fiscalYearId} FOR UPDATE`;
  const row = rows[0]!;
  await tx.$executeRaw`UPDATE "NumberSequence" SET "nextValue" = ${row.nextValue + 1} WHERE id = ${row.id}`;
  return row.nextValue;
}
