import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { expireQuotes } from "@/modules/admin/quotes";
import { getEmailSender } from "@/integrations/email";
import { quoteStepAction } from "@/actions/admin";
import { QuoteForm } from "@/components/admin/quote-form";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, SubmitButton } from "@/components/ui/form";
import { Badge, Card, Dl, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("quotes.view");
  const q = await withTenant(a.access, async (tx) => {
    await expireQuotes(tx);
    return tx.quotation.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } }, customer: { include: { contacts: true } }, revisions: { orderBy: { revision: "desc" } } } });
  });
  if (!q) notFound();
  const money = (v: { toString(): string }) => formatAmount(v.toString(), q.currency, locale);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");
  const canEdit = adminCan(a, "quotes.edit");
  const email = q.customer.contacts.find((c) => c.id === q.contactId)?.email ?? q.customer.email ?? "";
  const smtp = !!getEmailSender();

  return (
    <>
      <PageHeader title={`${t("admin.quote.title")} ${q.number}${q.revision > 1 ? ` (rev. ${q.revision})` : ""}`} description={`${q.customer.name} · ${t(`admin.quoteStatuses.${q.status}`)}`}
        actions={<a href={`/api/admin/quotations/${q.id}/pdf`} className="text-sm font-medium text-accent hover:underline">{t("admin.quote.pdf")}</a>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <div className="space-y-6">
          {q.status === "DRAFT" && canEdit ? <Card title={t("admin.quote.edit")}><QuoteForm a={a} quote={q} /></Card> : (
            <Card>
              <Table head={[t("admin.quote.description"), t("admin.quote.quantity"), t("admin.quote.unitPrice"), t("admin.quote.discount"), t("admin.quote.tax"), t("common.amount")]}>
                {q.lines.map((l) => <tr key={l.id}><Td>{l.description}</Td><Td className="amount text-right">{l.quantity.toString()}</Td><Td className="amount text-right">{money(l.unitPrice)}</Td><Td className="amount text-right">{l.discountPct.isZero() ? "—" : `${l.discountPct.toString()}%`}</Td><Td className="amount text-right">{l.taxRate.toString()}%</Td><Td className="amount text-right">{money(l.netAmount)}</Td></tr>)}
              </Table>
            </Card>
          )}
          <Card title={t("admin.quote.totals")}>
            <Dl items={[[t("admin.quote.discountTotal"), money(q.discountAmount)], [t("invoicePdf.totalNet"), money(q.netAmount)], [t("invoicePdf.totalBtw"), money(q.taxAmount)], [t("quotes.pdfTotal"), money(q.grossAmount)]]} />
          </Card>
          {q.revisions.length > 0 && (
            <Card title={t("admin.quote.revisions")}>
              <ul className="space-y-1 text-sm">{q.revisions.map((r) => <li key={r.id}>rev. {r.revision} · {date(r.createdAt)} — {r.reason}</li>)}</ul>
            </Card>
          )}
        </div>
        <aside className="space-y-6">
          <Card title={t("admin.quote.status")}>
            <Dl items={[[t("admin.quote.date"), date(q.quoteDate)], [t("quotes.validUntil"), date(q.validUntil)], [t("admin.quote.sent"), q.sentAt ? `${date(q.sentAt)}${q.sentTo ? ` → ${q.sentTo}` : ` (${t("admin.quote.manual")})`}` : "—"], [t("admin.quote.viewed"), date(q.viewedAt)], [t("admin.quote.decision"), q.decidedAt ? `${t(`admin.quoteStatuses.${q.status === "CONVERTED" ? "ACCEPTED" : q.status}`)} · ${q.decidedBy}` : "—"]]} />
            {q.invoiceId && <p className="mt-3 text-sm"><Link href={`/admin/invoices/${q.invoiceId}`} className="text-accent hover:underline">{t("admin.quote.toInvoice")}</Link></p>}
          </Card>
          {canEdit && (q.status === "DRAFT" || q.status === "SENT") && (
            <Card title={t("admin.quote.sendTitle")}>
              {smtp ? (
                <ActionForm action={quoteStepAction}>
                  <input type="hidden" name="id" value={q.id} /><input type="hidden" name="step" value="send" />
                  <Field label={t("admin.customer.email")} name="to"><Input type="email" name="to" defaultValue={email} required /></Field>
                  <SubmitButton>{t("admin.quote.sendEmail")}</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-muted-foreground">{t("admin.quote.noSmtp")}</p>}
              <ActionForm action={quoteStepAction} className="mt-3">
                <input type="hidden" name="id" value={q.id} /><input type="hidden" name="step" value="manual" />
                <SubmitButton variant="secondary">{t("admin.quote.markManual")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {canEdit && (q.status === "SENT" || q.status === "VIEWED") && (
            <Card title={t("admin.quote.decisionTitle")}>
              <ActionForm action={quoteStepAction}>
                <input type="hidden" name="id" value={q.id} />
                <Field label={t("admin.quote.decidedBy")} name="by"><Input name="by" required /></Field>
                <Field label={t("common.notes")} name="note"><Input name="note" /></Field>
                <div className="flex gap-2"><button name="step" value="accept" className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground">{t("admin.quote.accept")}</button><button name="step" value="reject" className="h-9 rounded-lg border border-border px-3 text-sm">{t("admin.quote.reject")}</button></div>
              </ActionForm>
            </Card>
          )}
          {q.status === "ACCEPTED" && adminCan(a, "quotes.approve") && adminCan(a, "sales.create") && (
            <Card title={t("admin.quote.convertTitle")} description={t("admin.quote.convertIntro")}>
              <ActionForm action={quoteStepAction}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="step" value="convert" /><SubmitButton>{t("admin.quote.convert")}</SubmitButton></ActionForm>
            </Card>
          )}
          {canEdit && ["SENT", "VIEWED", "REJECTED", "EXPIRED", "ACCEPTED"].includes(q.status) && (
            <Card title={t("admin.quote.reviseTitle")} description={t("admin.quote.reviseIntro")}>
              <ActionForm action={quoteStepAction}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="step" value="revise" /><Field label={t("admin.quote.reason")} name="reason"><Input name="reason" required /></Field><SubmitButton variant="secondary">{t("admin.quote.revise")}</SubmitButton></ActionForm>
            </Card>
          )}
          <Card><Badge tone="info">{t(`admin.quoteStatuses.${q.status}`)}</Badge></Card>
        </aside>
      </div>
    </>
  );
}
