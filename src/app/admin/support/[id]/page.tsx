import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { ticketStepAction } from "@/actions/admin";
import { ActionForm, Checkbox, Field, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader } from "@/components/ui/misc";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const a = await requireAdmin("support.view");
  const ticket = await withTenant(a.access, (tx) => tx.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } }));
  if (!ticket) notFound();
  const users = await systemDb.user.findMany({ where: { id: { in: [...new Set(ticket.messages.map((m) => m.authorUserId))] } }, select: { id: true, name: true } });
  const staff = await systemDb.organizationMembership.findMany({ where: { organizationId: a.home.organizationId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } });
  return (
    <>
      <PageHeader title={`${ticket.number} — ${ticket.subject}`} description={`${t(`admin.ticketStatuses.${ticket.status}`)} · ${t(`admin.priorities.${ticket.priority}`)}`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <Card>
          <ol className="space-y-4">
            {ticket.messages.map((m) => (
              <li key={m.id} className={`rounded-lg border p-3 text-sm ${m.internal ? "border-warning/40 bg-warning/5" : m.authorKind === "CUSTOMER" ? "border-border bg-muted/40" : "border-border"}`}>
                <p className="text-xs text-muted-foreground">{users.find((u) => u.id === m.authorUserId)?.name ?? "—"} · {m.authorKind === "CUSTOMER" ? t("admin.support.customer") : t("admin.support.staff")}{m.internal ? ` · ${t("admin.support.internal")}` : ""} · {format.dateTime(m.createdAt, { dateStyle: "short", timeStyle: "short" })}</p>
                <p className="mt-1 whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>
          {adminCan(a, "support.edit") && (
            <ActionForm action={ticketStepAction} resetOnSuccess className="mt-4">
              <input type="hidden" name="id" value={ticket.id} /><input type="hidden" name="step" value="reply" />
              <Field label={t("admin.support.reply")} name="body"><Textarea name="body" rows={4} required /></Field>
              <Checkbox name="internal" label={t("admin.support.internalNote")} />
              <SubmitButton>{t("admin.support.send")}</SubmitButton>
            </ActionForm>
          )}
        </Card>
        {adminCan(a, "support.edit") && (
          <Card title={t("admin.support.manage")}>
            <ActionForm action={ticketStepAction}>
              <input type="hidden" name="id" value={ticket.id} />
              <Field label={t("common.status")} name="status"><Select name="status" defaultValue={ticket.status}>{["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{t(`admin.ticketStatuses.${s}`)}</option>)}</Select></Field>
              <Field label={t("admin.support.priority")} name="priority"><Select name="priority" defaultValue={ticket.priority}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{t(`admin.priorities.${p}`)}</option>)}</Select></Field>
              <Field label={t("admin.support.assignee")} name="assigneeId"><Select name="assigneeId" defaultValue={ticket.assigneeId ?? ""}>{[<option key="" value="">—</option>, ...staff.map((s) => <option key={s.user.id} value={s.user.id}>{s.user.name}</option>)]}</Select></Field>
              <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
            </ActionForm>
            <p className="mt-3"><Badge>{t(`admin.ticketStatuses.${ticket.status}`)}</Badge></p>
          </Card>
        )}
      </div>
    </>
  );
}
