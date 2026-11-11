import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can, visibleCompanyIds } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { portfolio } from "@/modules/practice/service";
import { createTaskAction, taskStatusAction } from "@/actions/saas";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function PracticePage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp("practice.view");
  const data = await withTenant(ctx.access, async (tx) => ({
    rows: await portfolio(tx, ctx.access),
    tasks: await tx.practiceTask.findMany({ where: { OR: [{ companyId: null }, { companyId: { in: visibleCompanyIds(ctx.access) } }] }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 100 }),
    companies: await tx.company.findMany({ where: { id: { in: visibleCompanyIds(ctx.access) } }, orderBy: { name: "asc" } }),
    members: await tx.organizationMembership.findMany({ where: { organizationId: ctx.access.organizationId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } }),
  }));
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" }) : "—");
  const name = (id: string | null) => data.members.find((m) => m.userId === id)?.user.name ?? "—";
  const company = (id: string | null) => data.companies.find((c) => c.id === id)?.name ?? "—";
  const mayEdit = can(ctx.access, "practice.edit");

  return (
    <>
      <PageHeader title={t("practice.title")} description={t("practice.intro")} />
      <Card title={t("practice.portfolio")}>
        {data.rows.length === 0 ? <EmptyState title={t("practice.noClients")} /> : (
          <Table head={[t("practice.client"), t("quality.score"), t("practice.issues"), t("practice.drafts"), t("practice.lastPosting"), t("practice.btw"), t("practice.yearEnd"), t("practice.tasks")]}>
            {data.rows.map((r) => (
              <tr key={r.administration.id}>
                <Td>{r.company.name}<span className="block text-xs text-muted-foreground">{r.administration.code} · {r.administration.name}</span></Td>
                <Td>{r.score ?? "—"}</Td>
                <Td>{r.errors > 0 && <Badge tone="warning">{r.errors} {t("quality.severities.ERROR")}</Badge>} {r.warnings > 0 && <Badge tone="info">{r.warnings}</Badge>}{r.errors + r.warnings === 0 && "—"}</Td>
                <Td>{r.drafts}</Td>
                <Td>{date(r.lastPostedAt)}</Td>
                <Td>{r.btw ? <>{r.btw.done ? <Badge tone="success">{r.btw.month}</Badge> : <Badge tone="warning">{r.btw.month}</Badge>}{r.btw.deadline && <span className="block text-xs text-muted-foreground">{t("practice.deadline", { date: date(r.btw.deadline) })}{r.btw.deadlineIsPlaceholder ? ` (${t("practice.placeholder")})` : ""}</span>}</> : "—"}</Td>
                <Td>{r.yearEndStatus ? t(`yearEnd.statuses.${r.yearEndStatus}`) : "—"}</Td>
                <Td>{r.openTasks}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t("practice.tasks")} className="mt-6">
        {data.tasks.length > 0 && (
          <Table head={[t("practice.task"), t("practice.client"), t("practice.due"), t("quality.assignee"), ""]}>
            {data.tasks.map((task) => (
              <tr key={task.id} className={task.status === "DONE" ? "text-muted-foreground line-through" : undefined}>
                <Td>{task.title}</Td><Td>{company(task.companyId)}</Td><Td>{date(task.dueDate)}</Td><Td>{name(task.assigneeId)}</Td>
                <Td>{mayEdit && <ActionForm action={taskStatusAction} className="space-y-0"><input type="hidden" name="taskId" value={task.id} /><input type="hidden" name="status" value={task.status === "DONE" ? "OPEN" : "DONE"} /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{task.status === "DONE" ? t("practice.reopen") : t("practice.done")}</SubmitButton></ActionForm>}</Td>
              </tr>
            ))}
          </Table>
        )}
        {mayEdit && (
          <ActionForm action={createTaskAction} resetOnSuccess className="mt-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={t("practice.task")} name="title" className="sm:col-span-2"><Input name="title" required /></Field>
              <Field label={t("practice.client")} name="companyId"><Select name="companyId" defaultValue="">{[<option key="" value="">—</option>, ...data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
              <Field label={t("practice.due")} name="dueDate"><Input type="date" name="dueDate" /></Field>
              <Field label={t("quality.assignee")} name="assigneeId"><Select name="assigneeId" defaultValue="">{[<option key="" value="">—</option>, ...data.members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)]}</Select></Field>
            </div>
            <SubmitButton>{t("practice.addTask")}</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
