import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { systemDb } from "@/core/db/client";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { addActivityAction, addContactAction, completeTaskAction, linkOrganizationAction, setStageAction, updateCustomerAction, uploadDocumentAction } from "@/actions/admin";
import { CustomerFields, staffOptions } from "@/components/admin/customer-form";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, Dl, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const STAGES = ["LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL", "CUSTOMER", "INACTIVE"] as const;

export default async function CustomerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("crm.view");
  const data = await withTenant(a.access, async (tx) => {
    const c = await tx.crmCustomer.findUnique({ where: { id }, include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] }, activities: { orderBy: { createdAt: "desc" }, take: 100 }, quotations: { orderBy: { quoteDate: "desc" } }, subscriptions: { orderBy: { createdAt: "desc" } } } });
    if (!c) return null;
    const [invoices, open, payments, documents, tickets, products] = await Promise.all([
      c.partyId ? tx.invoice.findMany({ where: { partyId: c.partyId, type: "SALES" }, orderBy: { invoiceDate: "desc" }, take: 50 }) : [],
      c.partyId ? tx.openItem.findMany({ where: { partyId: c.partyId, status: "OPEN" } }) : [],
      tx.araPayment.findMany({ where: { customerId: c.id }, orderBy: { paymentDate: "desc" }, take: 50 }),
      tx.adminDocument.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" } }),
      tx.supportTicket.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.product.findMany(),
    ]);
    return { c, invoices, open, payments, documents, tickets, products };
  });
  if (!data) notFound();
  const { c } = data;
  const staff = await staffOptions(a.home.organizationId);
  const org = c.linkedOrganizationId ? await systemDb.organization.findUnique({ where: { id: c.linkedOrganizationId }, select: { id: true, name: true, status: true } }) : null;
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");
  const edit = adminCan(a, "crm.edit");
  const balance = data.open.reduce((s, i) => s + Number(i.remainingAmount), 0);

  return (
    <>
      <PageHeader title={c.name} description={`${c.number} · ${t(`admin.stages.${c.stage}`)}${c.partyId ? ` · ${t("admin.customer.isDebtor")}` : ""}`}
        actions={<div className="flex flex-wrap gap-3">{adminCan(a, "quotes.create") && <TextLink href={`/admin/quotations/new?customer=${c.id}`}>{t("admin.quote.new")}</TextLink>}{adminCan(a, "billing.create") && <TextLink href={`/admin/subscriptions?customer=${c.id}`}>{t("admin.subscription.new")}</TextLink>}</div>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card title={t("admin.customer.details")}>
            <Dl items={[
              [t("admin.customer.email"), c.email ?? "—"], [t("admin.customer.phone"), c.phone ?? "—"], [t("admin.customer.address"), [c.address, c.district, c.country].filter(Boolean).join(", ") || "—"],
              [t("admin.customer.kkf"), c.kkfNumber ?? "—"], [t("admin.customer.taxNumber"), c.taxNumber ?? "—"], [t("admin.customer.manager"), staff.find((s) => s.id === c.accountManagerId)?.name ?? "—"],
              [t("admin.customer.openBalance"), c.partyId ? formatAmount(balance.toFixed(2), c.preferredCurrency, locale) : "—"], [t("admin.customer.converted"), date(c.convertedAt)],
            ]} />
            {edit && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">{t("common.edit")}</summary>
                <ActionForm action={updateCustomerAction} className="mt-3"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="stage" value={c.stage} /><CustomerFields c={c} staff={staff} /><SubmitButton>{t("common.save")}</SubmitButton></ActionForm>
              </details>
            )}
          </Card>

          <Card title={t("admin.customer.activities")}>
            {adminCan(a, "crm.create") && (
              <ActionForm action={addActivityAction} resetOnSuccess className="mb-4">
                <input type="hidden" name="customerId" value={c.id} />
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_9rem]">
                  <Field label={t("admin.activity.type")} name="type"><Select name="type" defaultValue="NOTE">{["NOTE", "CALL", "EMAIL", "MEETING", "TASK"].map((x) => <option key={x} value={x}>{t(`admin.activityTypes.${x}`)}</option>)}</Select></Field>
                  <Field label={t("admin.activity.subject")} name="subject"><Input name="subject" required /></Field>
                  <Field label={t("admin.activity.due")} name="dueDate"><Input type="date" name="dueDate" /></Field>
                  <Field label={t("admin.activity.body")} name="body" className="sm:col-span-3"><Textarea name="body" rows={2} /></Field>
                </div>
                <SubmitButton variant="secondary">{t("admin.activity.add")}</SubmitButton>
              </ActionForm>
            )}
            {c.activities.length === 0 ? <EmptyState title={t("admin.activity.none")} /> : (
              <ol className="space-y-3 border-l border-border pl-4">
                {c.activities.map((x) => (
                  <li key={x.id} className="text-sm">
                    <span className="flex flex-wrap items-center gap-2"><Badge>{t(`admin.activityTypes.${x.type}`)}</Badge><span className="font-medium">{x.subject}</span>{x.type === "TASK" && (x.doneAt ? <Badge tone="success">{t("practice.done")}</Badge> : edit && <ActionForm action={completeTaskAction} className="space-y-0"><input type="hidden" name="activityId" value={x.id} /><input type="hidden" name="customerId" value={c.id} /><SubmitButton variant="ghost" className="h-6 px-2 text-xs">{t("admin.activity.complete")}</SubmitButton></ActionForm>)}</span>
                    {x.body && <p className="mt-1 whitespace-pre-line text-muted-foreground">{x.body}</p>}
                    <span className="text-xs text-muted-foreground">{format.dateTime(x.createdAt, { dateStyle: "short", timeStyle: "short" })}{x.dueDate ? ` · ${t("admin.activity.due")}: ${date(x.dueDate)}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={t("admin.nav.quotations")}>
            {c.quotations.length === 0 ? <EmptyState title={t("admin.quote.none")} /> : (
              <Table head={[t("admin.quote.number"), t("common.date"), t("common.status"), t("common.total")]}>
                {c.quotations.map((q) => <tr key={q.id}><Td><Link href={`/admin/quotations/${q.id}`} className="hover:underline">{q.number}</Link></Td><Td>{date(q.quoteDate)}</Td><Td><Badge>{t(`admin.quoteStatuses.${q.status}`)}</Badge></Td><Td className="amount text-right">{formatAmount(q.grossAmount.toString(), q.currency, locale)}</Td></tr>)}
              </Table>
            )}
          </Card>

          <Card title={t("admin.nav.invoices")}>
            {data.invoices.length === 0 ? <EmptyState title={t("admin.invoice.none")} /> : (
              <Table head={[t("ledger.number"), t("common.date"), t("common.status"), t("common.total")]}>
                {data.invoices.map((i) => <tr key={i.id}><Td><Link href={`/admin/invoices/${i.id}`} className="hover:underline">{i.number ?? t("invoicing.draftNumber")}</Link></Td><Td>{date(i.invoiceDate)}</Td><Td><Badge>{t(`invoicing.status.${i.status}`)}</Badge></Td><Td className="amount text-right">{formatAmount(i.grossAmount.toString(), i.currency, locale)}</Td></tr>)}
              </Table>
            )}
          </Card>

          <Card title={t("admin.nav.subscriptions")}>
            {c.subscriptions.length === 0 ? <EmptyState title={t("admin.subscription.none")} /> : (
              <Table head={[t("admin.subscription.number"), t("admin.subscription.product"), t("admin.subscription.price"), t("common.status"), t("admin.subscription.nextBilling")]}>
                {c.subscriptions.map((s) => <tr key={s.id}><Td>{s.number}</Td><Td>{data.products.find((p) => p.id === s.productId)?.name}</Td><Td className="amount text-right">{formatAmount(s.unitPrice.toString(), s.currency, locale)} / {t(`admin.intervals.${s.interval}`)}</Td><Td><Badge>{t(`admin.subscriptionStatuses.${s.status}`)}</Badge></Td><Td>{date(s.nextBillingDate)}</Td></tr>)}
              </Table>
            )}
          </Card>

          <Card title={t("admin.nav.payments")}>
            {data.payments.length === 0 ? <EmptyState title={t("admin.payment.none")} /> : (
              <Table head={[t("admin.payment.number"), t("common.date"), t("common.amount"), t("common.status")]}>
                {data.payments.map((p) => <tr key={p.id}><Td>{p.number}</Td><Td>{date(p.paymentDate)}</Td><Td className="amount text-right">{formatAmount(p.amount.toString(), p.currency, locale)}</Td><Td><Badge tone={p.status === "CONFIRMED" ? "success" : p.status === "PENDING" ? "warning" : "neutral"}>{t(`admin.paymentStatuses.${p.status}`)}</Badge></Td></tr>)}
              </Table>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          {edit && (
            <Card title={t("admin.customer.stage")}>
              <ActionForm action={setStageAction}>
                <input type="hidden" name="id" value={c.id} />
                <Select name="stage" defaultValue={c.stage} aria-label={t("admin.customer.stage")}>{STAGES.map((s) => <option key={s} value={s}>{t(`admin.stages.${s}`)}</option>)}</Select>
                <Input name="note" placeholder={t("admin.customer.stageNote")} aria-label={t("admin.customer.stageNote")} />
                <p className="text-xs text-muted-foreground">{t("admin.customer.conversionHint")}</p>
                <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title={t("admin.customer.contacts")}>
            <ul className="space-y-2 text-sm">
              {c.contacts.map((p) => <li key={p.id}><span className="font-medium">{p.name}</span>{p.isPrimary && <Badge tone="info">{t("admin.contact.primary")}</Badge>}<span className="block text-xs text-muted-foreground">{[p.jobTitle, p.email, p.phone].filter(Boolean).join(" · ")}</span></li>)}
            </ul>
            {edit && (
              <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-accent">{t("admin.contact.add")}</summary>
                <ActionForm action={addContactAction} resetOnSuccess className="mt-2">
                  <input type="hidden" name="customerId" value={c.id} />
                  <Field label={t("admin.contact.name")} name="name"><Input name="name" required /></Field>
                  <Field label={t("admin.contact.jobTitle")} name="jobTitle"><Input name="jobTitle" /></Field>
                  <Field label={t("admin.customer.email")} name="email"><Input type="email" name="email" /></Field>
                  <Field label={t("admin.customer.phone")} name="phone"><Input name="phone" /></Field>
                  <Checkbox name="isPrimary" label={t("admin.contact.primary")} />
                  <SubmitButton variant="secondary">{t("admin.contact.add")}</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Card>
          <Card title={t("admin.customer.araAccount")} description={t("admin.customer.araAccountIntro")}>
            <p className="text-sm">{org ? `${org.name} (${t(`saas.statuses.${org.status}`)})` : t("admin.customer.notLinked")}</p>
            {edit && (
              <ActionForm action={linkOrganizationAction} className="mt-2">
                <input type="hidden" name="customerId" value={c.id} />
                <Field label={t("admin.customer.organizationId")} name="organizationId" hint={t("admin.customer.organizationIdHint")}><Input name="organizationId" defaultValue={c.linkedOrganizationId ?? ""} /></Field>
                <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title={t("admin.customer.documents")}>
            <ul className="space-y-1 text-sm">
              {data.documents.map((d) => <li key={d.id}><a href={`/api/admin/documents/${d.id}`} className="hover:underline">{d.fileName}</a><span className="block text-xs text-muted-foreground">{t(`admin.docCategories.${d.category}` as never)} · {date(d.createdAt)} · {d.storage === "SUPABASE" ? "Supabase Storage" : t("admin.storage.database")}</span></li>)}
            </ul>
            {edit && (
              <ActionForm action={uploadDocumentAction} resetOnSuccess className="mt-3">
                <input type="hidden" name="customerId" value={c.id} />
                <Field label={t("admin.document.category")} name="category"><Select name="category" defaultValue="CONTRACT">{["CONTRACT", "CUSTOMER", "QUOTATION", "INVOICE", "INTERNAL"].map((x) => <option key={x} value={x}>{t(`admin.docCategories.${x}` as never)}</option>)}</Select></Field>
                <Field label={t("admin.document.file")} name="file"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required /></Field>
                <SubmitButton variant="secondary">{t("admin.document.upload")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title={t("admin.nav.support")}>
            <ul className="space-y-1 text-sm">{data.tickets.map((x) => <li key={x.id}><Link href={`/admin/support/${x.id}`} className="hover:underline">{x.number} — {x.subject}</Link> <Badge>{t(`admin.ticketStatuses.${x.status}`)}</Badge></li>)}</ul>
            {data.tickets.length === 0 && <p className="text-sm text-muted-foreground">{t("admin.support.none")}</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}
