import { z } from "zod";
import type { Tx } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { audit } from "@/core/audit/audit";
import { assertCan, can, visibleCompanyIds, type Access } from "@/core/auth/access";
import { UserError } from "@/core/errors";

const scope = (a: Access) => ({ organizationId: a.organizationId, userId: a.userId });

/**
 * Practice dashboard: one row per administration of the companies the user may see, with quality, workload and
 * deadline indicators. The BTW deadline uses the filing day from the BTW rule version (a placeholder until verified).
 */
export async function portfolio(tx: Tx, access: Access, today = new Date()) {
  const companyIds = visibleCompanyIds(access);
  const admins = await tx.administration.findMany({ where: { companyId: { in: companyIds }, status: { not: "ARCHIVED" } }, include: { company: true }, orderBy: [{ company: { name: "asc" } }, { code: "asc" }] });
  const btwRule = await tx.taxRuleVersion.findFirst({ where: { taxType: "BTW", effectiveFrom: { lte: today } }, orderBy: { effectiveFrom: "desc" } });
  const filingDay = Number((btwRule?.parameters as { filingDayOfFollowingMonth?: number } | undefined)?.filingDayOfFollowingMonth ?? NaN);
  const rows = [];
  for (const a of admins) {
    const [lastScan, issues, drafts, lastEntry, fy, openTasks] = await Promise.all([
      tx.qualityScan.findFirst({ where: { administrationId: a.id }, orderBy: { startedAt: "desc" } }),
      tx.qualityIssue.groupBy({ by: ["severity"], where: { administrationId: a.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } }),
      tx.journalEntry.count({ where: { administrationId: a.id, status: { not: "POSTED" } } }),
      tx.journalEntry.findFirst({ where: { administrationId: a.id, status: "POSTED" }, orderBy: { postedAt: "desc" }, select: { postedAt: true } }),
      tx.fiscalYear.findFirst({ where: { administrationId: a.id, startDate: { lte: today }, endDate: { gte: today } } }),
      tx.practiceTask.count({ where: { companyId: a.companyId, status: "OPEN" } }),
    ]);
    const yearEnd = fy ? await tx.yearEndClosing.findUnique({ where: { fiscalYearId: fy.id } }) : null;
    // Last completed month and whether its BTW return is approved.
    const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const btwDone = a.company.isBtwRegistered ? await tx.taxReturn.count({ where: { administrationId: a.id, taxType: "BTW", periodFrom: lastMonth, status: { in: ["APPROVED", "FILED"] } } }) : null;
    const deadline = a.company.isBtwRegistered && Number.isFinite(filingDay) ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), filingDay)) : null;
    const count = (sev: string) => issues.find((i) => i.severity === sev)?._count._all ?? 0;
    rows.push({
      administration: { id: a.id, code: a.code, name: a.name }, company: { id: a.company.id, name: a.company.name },
      score: lastScan?.score ?? null, lastScanAt: lastScan?.startedAt ?? null, errors: count("ERROR"), warnings: count("WARNING"),
      drafts, lastPostedAt: lastEntry?.postedAt ?? null, fiscalYear: fy?.code ?? null, yearEndStatus: yearEnd?.status ?? null,
      btw: btwDone === null ? null : { month: lastMonth.toISOString().slice(0, 7), done: btwDone > 0, deadline, deadlineIsPlaceholder: btwRule?.legalStatus !== "VERIFIED" },
      openTasks,
    });
  }
  return rows;
}

export const taskSchema = z.object({
  title: z.string().trim().min(2, "validation.required").max(200),
  description: z.string().trim().max(2000).optional(),
  companyId: z.string().optional().transform((v) => v || undefined),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date").optional().or(z.literal("").transform(() => undefined)),
  assigneeId: z.string().optional().transform((v) => v || undefined),
});

export async function createTask(access: Access, raw: z.input<typeof taskSchema>) {
  const input = taskSchema.parse(raw);
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "practice.edit");
    if (input.companyId && !can(access, "companies.view", input.companyId)) throw new UserError("errors.notFound");
    if (input.assigneeId && !(await tx.organizationMembership.findFirst({ where: { organizationId: access.organizationId, userId: input.assigneeId, status: "ACTIVE" } }))) throw new UserError("errors.notFound");
    const task = await tx.practiceTask.create({ data: { organizationId: access.organizationId, title: input.title, description: input.description || null, companyId: input.companyId ?? null, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null, assigneeId: input.assigneeId ?? null, createdById: access.userId } });
    if (input.assigneeId && input.assigneeId !== access.userId) await tx.notification.create({ data: { organizationId: access.organizationId, userId: input.assigneeId, type: "taskAssigned", params: { title: input.title }, link: "/app/practice" } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "practice.taskCreated", entity: "PracticeTask", entityId: task.id, details: { title: input.title } });
    return task;
  });
}

export async function setTaskStatus(access: Access, taskId: string, status: "OPEN" | "DONE") {
  return withTenant(scope(access), async (tx) => {
    assertCan(access, "practice.edit");
    const task = await tx.practiceTask.findUnique({ where: { id: taskId } });
    if (!task) throw new UserError("errors.notFound");
    await tx.practiceTask.update({ where: { id: taskId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    await audit(tx, { organizationId: access.organizationId, userId: access.userId, action: "practice.taskStatus", entity: "PracticeTask", entityId: taskId, details: { status } });
  });
}
