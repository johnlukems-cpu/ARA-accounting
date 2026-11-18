import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { createTicketAction } from "@/actions/admin";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const a = await requireAdmin("support.view");
  const sp = await searchParams;
  const open = sp.status !== "closed";
  const { tickets, customers } = await withTenant(a.access, async (tx) => ({
    tickets: await tx.supportTicket.findMany({ where: { status: open ? { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } : { in: ["RESOLVED", "CLOSED"] } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 300 }),
    customers: await tx.crmCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  }));
  return (
    <>
      <PageHeader title={t("admin.nav.support")} description={t("admin.support.intro")} />
      <div className="mb-4 flex gap-3 text-sm"><Link href="/admin/support" className={open ? "font-semibold" : "text-accent"}>{t("admin.support.open")}</Link><Link href="/admin/support?status=closed" className={!open ? "font-semibold" : "text-accent"}>{t("admin.support.closed")}</Link></div>
      <Card>
        {tickets.length === 0 ? <EmptyState title={t("admin.support.none")} /> : (
          <Table head={[t("admin.support.number"), t("admin.support.subject"), t("admin.quote.customer"), t("admin.support.priority"), t("common.status"), t("common.date")]}>
            {tickets.map((x) => <tr key={x.id}><Td className="font-mono text-xs">{x.number}</Td><Td><Link href={`/admin/support/${x.id}`} className="font-medium hover:underline">{x.subject}</Link>{x.requesterOrganizationId && <span className="block text-xs text-muted-foreground">{t("admin.support.viaPortal")}</span>}</Td><Td>{customers.find((c) => c.id === x.customerId)?.name ?? "—"}</Td><Td><Badge tone={x.priority === "URGENT" || x.priority === "HIGH" ? "danger" : "neutral"}>{t(`admin.priorities.${x.priority}`)}</Badge></Td><Td><Badge>{t(`admin.ticketStatuses.${x.status}`)}</Badge></Td><Td>{format.dateTime(x.createdAt, { dateStyle: "short" })}</Td></tr>)}
          </Table>
        )}
      </Card>
      {adminCan(a, "support.create") && (
        <Card title={t("admin.support.new")} className="mt-6">
          <ActionForm action={createTicketAction} resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("admin.support.subject")} name="subject" className="sm:col-span-2"><Input name="subject" required /></Field>
              <Field label={t("admin.support.priority")} name="priority"><Select name="priority" defaultValue="NORMAL">{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{t(`admin.priorities.${p}`)}</option>)}</Select></Field>
              <Field label={t("admin.quote.customer")} name="customerId"><Select name="customerId" defaultValue="">{[<option key="" value="">—</option>, ...customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
              <Field label={t("admin.support.category")} name="category"><Input name="category" /></Field>
              <Field label={t("admin.support.message")} name="body" className="sm:col-span-3"><Textarea name="body" rows={4} required /></Field>
            </div>
            <SubmitButton>{t("admin.support.create")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
