import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { portalOverview } from "@/modules/admin/portal";
import { portalQuoteAction, portalReplyAction, portalTicketAction } from "@/actions/portal";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/**
 * "Mijn ARA-account": the customer's subscriptions, invoices, payment status and quotations with ARA Intelligent
 * Solutions, and support requests. Only the records of the customer linked to this organisation are shown.
 */
export default async function AraAccountPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("organization.view");
  const o = await portalOverview(ctx.access);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");
  const admin = can(ctx.access, "organization.edit");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return (
    <>
      <PageHeader title={t("portal.title")} description={o.customer ? t("portal.intro", { name: o.customer.name, number: o.customer.number }) : t("portal.notLinked")} />
      {o.customer && (
        <div className="space-y-6">
          <Card title={t("portal.subscriptions")}>
            {o.subscriptions.length === 0 ? <EmptyState title={t("portal.noSubscriptions")} /> : (
              <Table head={[t("admin.subscription.number"), t("admin.subscription.product"), t("admin.subscription.price"), t("common.status"), t("admin.subscription.nextBilling")]}>
                {o.subscriptions.map((s) => <tr key={s.id}><Td>{s.number}</Td><Td>{s.productName}</Td><Td className="amount text-right">{formatAmount(s.unitPrice.toString(), s.currency, locale)} / {t(`admin.intervals.${s.interval}`)}</Td><Td><Badge>{t(`admin.subscriptionStatuses.${s.status}`)}</Badge>{s.status === "TRIAL" && s.trialEndsAt && <span className="block text-xs">{t("admin.subscription.trialUntil", { date: date(s.trialEndsAt) })}</span>}</Td><Td>{s.status === "ACTIVE" ? date(s.nextBillingDate) : "—"}</Td></tr>)}
              </Table>
            )}
          </Card>
          <Card title={t("portal.invoices")} description={t("portal.invoicesIntro")}>
            {o.invoices.length === 0 ? <EmptyState title={t("portal.noInvoices")} /> : (
              <Table head={[t("ledger.number"), t("invoicing.invoiceDate"), t("invoicing.dueDate"), t("common.total"), t("portal.paymentStatus"), ""]}>
                {o.invoices.map((i) => {
                  const overdue = i.status !== "PAID" && i.dueDate < today;
                  return <tr key={i.id}><Td>{i.number}{i.kind === "CREDIT_NOTE" && <span className="block text-xs text-muted-foreground">{t("invoicing.creditNote")}</span>}</Td><Td>{date(i.invoiceDate)}</Td><Td>{date(i.dueDate)}</Td><Td className="amount text-right">{formatAmount(i.grossAmount.toString(), i.currency, locale)}</Td><Td><Badge tone={i.status === "PAID" ? "success" : overdue ? "danger" : "warning"}>{i.status === "PAID" ? t("portal.paid") : overdue ? t("portal.overdue") : i.status === "PARTIALLY_PAID" ? t("portal.partlyPaid") : t("portal.open")}</Badge></Td><Td><a href={`/api/portal/invoices/${i.id}/pdf`} className="text-sm text-accent hover:underline">PDF</a></Td></tr>;
                })}
              </Table>
            )}
            {o.openItems.length > 0 && <p className="mt-3 text-sm font-medium">{t("portal.balance")}: {[...new Set(o.openItems.map((x) => x.currency))].map((cur) => formatAmount(o.openItems.filter((x) => x.currency === cur).reduce((s, x) => s + Number(x.remainingAmount), 0).toFixed(2), cur, locale)).join(" · ")}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{t("portal.paymentNote")}</p>
          </Card>
          <Card title={t("portal.quotations")}>
            {o.quotations.length === 0 ? <EmptyState title={t("portal.noQuotations")} /> : (
              <Table head={[t("admin.quote.number"), t("admin.quote.date"), t("quotes.validUntil"), t("common.total"), t("common.status"), ""]}>
                {o.quotations.map((q) => (
                  <tr key={q.id}>
                    <Td>{q.number}</Td><Td>{date(q.quoteDate)}</Td><Td>{date(q.validUntil)}</Td><Td className="amount text-right">{formatAmount(q.grossAmount.toString(), q.currency, locale)}</Td>
                    <Td><Badge>{t(`admin.quoteStatuses.${q.status}`)}</Badge></Td>
                    <Td>
                      <a href={`/api/portal/quotations/${q.id}/pdf`} className="text-sm text-accent hover:underline">PDF</a>
                      {admin && (q.status === "SENT" || q.status === "VIEWED") && q.validUntil >= today && (
                        <ActionForm action={portalQuoteAction} className="mt-2 flex flex-wrap items-center gap-1 space-y-0">
                          <input type="hidden" name="id" value={q.id} />
                          <Input name="note" placeholder={t("portal.note")} aria-label={t("portal.note")} className="h-8 w-40 text-xs" />
                          <button name="decision" value="ACCEPTED" className="h-8 rounded-md bg-primary px-2 text-xs text-primary-foreground">{t("portal.accept")}</button>
                          <button name="decision" value="REJECTED" className="h-8 rounded-md border border-border px-2 text-xs">{t("portal.reject")}</button>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {!admin && <p className="mt-2 text-xs text-muted-foreground">{t("portal.acceptRights")}</p>}
          </Card>
        </div>
      )}
      <Card title={t("portal.support")} className="mt-6">
        {o.tickets.map((x) => (
          <details key={x.id} className="mb-3 rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm"><span className="font-medium">{x.number} — {x.subject}</span> <Badge>{t(`admin.ticketStatuses.${x.status}`)}</Badge></summary>
            <ol className="mt-2 space-y-2 text-sm">{x.messages.map((m) => <li key={m.id} className={m.authorKind === "STAFF" ? "rounded bg-muted/50 p-2" : "p-2"}><span className="text-xs text-muted-foreground">{m.authorKind === "STAFF" ? "ARA" : t("portal.you")} · {format.dateTime(m.createdAt, { dateStyle: "short", timeStyle: "short" })}</span><p className="whitespace-pre-line">{m.body}</p></li>)}</ol>
            {x.status !== "CLOSED" && (
              <ActionForm action={portalReplyAction} resetOnSuccess className="mt-2"><input type="hidden" name="ticketId" value={x.id} /><Field label={t("admin.support.reply")} name="body"><Textarea name="body" rows={2} required /></Field><SubmitButton variant="secondary">{t("admin.support.send")}</SubmitButton></ActionForm>
            )}
          </details>
        ))}
        <ActionForm action={portalTicketAction} resetOnSuccess className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("admin.support.subject")} name="subject" className="sm:col-span-2"><Input name="subject" required /></Field>
            <Field label={t("admin.support.priority")} name="priority"><Select name="priority" defaultValue="NORMAL">{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{t(`admin.priorities.${p}`)}</option>)}</Select></Field>
            <Field label={t("admin.support.message")} name="body" className="sm:col-span-3"><Textarea name="body" rows={3} required /></Field>
          </div>
          <SubmitButton>{t("portal.newTicket")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
