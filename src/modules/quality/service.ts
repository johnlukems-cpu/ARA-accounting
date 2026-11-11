import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";
import { CHECKS, CHECK_CODES, qualityScore, type Finding } from "./checks";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });
const fingerprintOf = (f: Finding) => createHash("sha256").update([f.checkCode, f.subjectType ?? "", f.subjectId ?? "", f.key ?? ""].join("|")).digest("hex");

/**
 * Runs all 12 checks for one administration. New findings become OPEN issues; known ones get lastSeenAt/timesSeen.
 * Nothing resolves automatically: an issue whose condition is gone stays until a person closes it (it is shown as
 * "not seen in the last scan"). A RESOLVED issue that reappears is reopened. New ERROR issues notify the people who
 * may view quality issues.
 */
export async function runScan(tx: Tx, q: { administrationId: string; today: Date; trigger: "MANUAL" | "SCHEDULED"; userId?: string }) {
  const start = Date.now();
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: q.administrationId } });
  const findings: Finding[] = [];
  const results: Record<string, number | string> = {};
  for (const code of CHECK_CODES) {
    try {
      const f = await CHECKS[code]({ tx, admin, today: q.today });
      findings.push(...f);
      results[code] = f.length;
    } catch (err) {
      results[code] = `error: ${(err as Error).message.slice(0, 200)}`;
    }
  }
  const now = new Date();
  const created: Finding[] = [];
  for (const f of findings) {
    const fingerprint = fingerprintOf(f);
    const existing = await tx.qualityIssue.findUnique({ where: { administrationId_fingerprint: { administrationId: admin.id, fingerprint } } });
    if (!existing) {
      await tx.qualityIssue.create({ data: { organizationId: admin.organizationId, administrationId: admin.id, checkCode: f.checkCode, severity: f.severity, subjectType: f.subjectType ?? null, subjectId: f.subjectId ?? null, params: f.params as Prisma.InputJsonValue, fingerprint, firstSeenAt: now, lastSeenAt: now } });
      created.push(f);
    } else {
      const reopen = existing.status === "RESOLVED";
      await tx.qualityIssue.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, timesSeen: { increment: 1 }, params: f.params as Prisma.InputJsonValue, ...(reopen ? { status: "OPEN", resolvedById: null, resolvedAt: null, resolutionNote: `${existing.resolutionNote ?? ""} [heropend: opnieuw gevonden]`.slice(0, 500) } : {}) },
      });
    }
  }
  const open = await tx.qualityIssue.findMany({ where: { administrationId: admin.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { severity: true } });
  const score = qualityScore(open);
  const scan = await tx.qualityScan.create({ data: { organizationId: admin.organizationId, administrationId: admin.id, trigger: q.trigger, durationMs: Date.now() - start, findings: findings.length, newIssues: created.length, score, results: results as Prisma.InputJsonValue, createdById: q.userId ?? null, startedAt: now } });
  const errors = created.filter((f) => f.severity === "ERROR");
  if (errors.length) {
    const members = await tx.organizationMembership.findMany({ where: { organizationId: admin.organizationId, status: "ACTIVE", role: { permissions: { some: { permission: "quality.view" } } } }, select: { userId: true } });
    if (members.length) await tx.notification.createMany({ data: members.map((m) => ({ organizationId: admin.organizationId, userId: m.userId, type: "qualityErrors", params: { count: errors.length, administration: `${admin.code} ${admin.name}` }, link: "/app/quality" })) });
  }
  return { scan, findings: findings.length, newIssues: created.length, score };
}

export async function scanNow(access: Access, administrationId: string, today = new Date()) {
  return withTenant(scope(access), async (tx) => {
    const admin = await tx.administration.findUnique({ where: { id: administrationId } });
    if (!admin) throw new UserError("errors.notFound");
    assertCan(access, "quality.view", admin.companyId);
    const r = await runScan(tx, { administrationId, today, trigger: "MANUAL", userId: access.userId });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "quality.scanned", entity: "Administration", entityId: administrationId, details: { findings: r.findings, newIssues: r.newIssues, score: r.score } });
    return r;
  });
}

/** Assign, start, or close an issue. Closing (resolved / accepted / false positive) needs a note and is audited. */
export async function updateIssue(access: Access, input: { issueId: string; status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED" | "FALSE_POSITIVE"; note?: string; assigneeId?: string | null }) {
  return withTenant(scope(access), async (tx) => {
    const issue = await tx.qualityIssue.findUnique({ where: { id: input.issueId } });
    if (!issue) throw new UserError("errors.notFound");
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: issue.administrationId } });
    assertCan(access, "quality.edit", admin.companyId);
    const closing = input.status && ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"].includes(input.status);
    if (closing && (input.note?.trim().length ?? 0) < 3) throw new UserError("quality.noteRequired");
    if (input.assigneeId) {
      const member = await tx.organizationMembership.findFirst({ where: { organizationId: access.organizationId, userId: input.assigneeId, status: "ACTIVE" } });
      if (!member) throw new UserError("errors.notFound");
    }
    const updated = await tx.qualityIssue.update({
      where: { id: issue.id },
      data: {
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(closing ? { resolvedById: access.userId, resolvedAt: new Date(), resolutionNote: input.note!.trim().slice(0, 500) } : input.status ? { resolvedById: null, resolvedAt: null } : {}),
      },
    });
    if (input.assigneeId && input.assigneeId !== access.userId) {
      await tx.notification.create({ data: { organizationId: access.organizationId, userId: input.assigneeId, type: "qualityAssigned", params: { check: issue.checkCode }, link: "/app/quality" } });
    }
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "quality.issueUpdated", entity: "QualityIssue", entityId: issue.id, details: { status: input.status ?? null, assignee: input.assigneeId ?? null, note: input.note ?? null } });
    return updated;
  });
}
