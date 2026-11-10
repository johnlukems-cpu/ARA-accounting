import type { Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";

export interface AuditEntry {
  organizationId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Appends an audit record inside the caller's transaction, so the record and the change commit together.
 * The database computes the hash chain and blocks updates and deletes (see the phase-1 security migration).
 */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      details: entry.details,
      ip: entry.ip ?? null,
    },
  });
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  firstBrokenSeq: string | null;
}

/** Recomputes the hash chain of one organisation (visible rows only) and reports the first break. */
export async function verifyAuditChain(tx: Tx, organizationId: string): Promise<ChainCheck> {
  const rows = await tx.$queryRaw<{ seq: bigint; ok: boolean; linked: boolean }[]>`
    SELECT seq,
           hash = audit_log_hash("prevHash", seq, "organizationId", "userId", action, entity, "entityId", details, "createdAt") AS ok,
           "prevHash" = COALESCE(LAG(hash) OVER (ORDER BY seq), '') AS linked
      FROM "AuditLog" WHERE "organizationId" = ${organizationId} ORDER BY seq`;
  const broken = rows.find((r) => !r.ok || !r.linked);
  return { ok: !broken, checked: rows.length, firstBrokenSeq: broken ? broken.seq.toString() : null };
}
