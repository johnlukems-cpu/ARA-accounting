import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin, adminCan } from "@/modules/admin/guard";
import { unallocated } from "@/modules/admin/payments";
import { paymentStepAction, registerPaymentAction, uploadDocumentAction } from "@/actions/admin";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

const STATUSES = ["PENDING", "CONFIRMED", "FAILED", "REFUNDED"] as const;

/**
 * Payments received by ARA. A payment is PENDING until a finance user has verified it (bank statement or counted
 * cash); only confirmed payments are posted and reduce receivables. No card details are ever stored.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const a = await requireAdmin("payments.view");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const data = await withTenant(a.access, async (tx) => {
    const payments = await tx.araPayment.findMany({ where: status ? { status } : {}, orderBy: [{ status: "asc" }, { paymentDate: "desc" }], take: 300, include: { allocations: true } });
    const rows = [];
    for (const p of payments) rows.push({ p, open: (await unallocated(tx, p.ledgerPaymentId)).amount.toFixed(2) });
    const customers = await tx.crmCustomer.findMany({ where: { status: "ACTIVE", partyId: { not: null } }, orderBy: { name: "asc" } });
    const accounts = await tx.financialAccount.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE" }, orderBy: { name: "asc" } });
    const openInvoices = await tx.invoice.findMany({ where: { administrationId: a.home.administrationId, type: "SALES", kind: "INVOICE", status: { in: ["POSTED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" }, include: { party: { select: { name: true } } } });
    const documents = await tx.adminDocument.findMany({ where: { category: "PAYMENT_EVIDENCE" } });
    return { rows, customers, accounts, openInvoices, documents };
  });
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "short" }) : "—");
  const approve = adminCan(a, "payments.approve") && adminCan(a, "banking.post");
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title={t("admin.nav.payments")} description={t("admin.payment.intro")} />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"><option value="">{t("admin.payment.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`admin.paymentStatuses.${s}`)}</option>)}</select>
        <button className="h-9 rounded-lg border border-border px-3 text-sm">{t("common.filter")}</button>
      </form>
      <Card>
        {data.rows.length === 0 ? <EmptyState title={t("admin.payment.none")} /> : (
          <Table head={[t("admin.payment.number"), t("common.date"), t("admin.quote.customer"), t("admin.payment.method"), t("common.amount"), t("common.status"), ""]}>
            {data.rows.map(({ p, open }) => {
              const customer = data.customers.find((c) => c.id === p.customerId);
              const partly = p.status === "CONFIRMED" && Number(open) > 0;
              return (
                <tr key={p.id}>
                  <Td className="font-mono text-xs">{p.number}{p.reference && <span className="block font-sans text-muted-foreground">{p.reference}</span>}</Td>
                  <Td>{date(p.paymentDate)}</Td>
                  <Td>{customer ? <Link href={`/admin/customers/${customer.id}`} className="hover:underline">{customer.name}</Link> : "—"}</Td>
                  <Td className="text-xs">{t(`admin.paymentMethods.${p.method}`)}{p.source === "CUSTOMER_PORTAL" && ` · ${t("admin.payment.fromPortal")}`}</Td>
                  <Td className="amount text-right">{formatAmount(p.amount.toString(), p.currency, locale)}{partly && <span className="block text-xs text-warning">{t("admin.payment.unallocated")}: {formatAmount(open, p.currency, locale)}</span>}</Td>
                  <Td><Badge tone={p.status === "CONFIRMED" ? "success" : p.status === "PENDING" ? "warning" : "neutral"}>{partly ? t("admin.paymentStatuses.PARTIALLY_ALLOCATED") : t(`admin.paymentStatuses.${p.status}`)}</Badge></Td>
                  <Td>
                    {approve && (p.status === "PENDING" || partly) && (
                      <details>
                        <summary className="cursor-pointer text-sm text-accent">{t("admin.payment.process")}</summary>
                        <div className="mt-3 min-w-[22rem] space-y-4">
                          {p.status === "PENDING" && (
                            <>
                              <ActionForm action={paymentStepAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="step" value="confirm" /><Field label={t("admin.payment.verification")} name="verification" hint={t("admin.payment.verificationHint")}><Input name="verification" required /></Field><SubmitButton>{t("admin.payment.confirm")}</SubmitButton></ActionForm>
                              <ActionForm action={paymentStepAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="step" value="fail" /><Field label={t("admin.payment.failReason")} name="reason"><Input name="reason" required /></Field><SubmitButton variant="secondary">{t("admin.payment.fail")}</SubmitButton></ActionForm>
                              <ActionForm action={uploadDocumentAction} resetOnSuccess><input type="hidden" name="category" value="PAYMENT_EVIDENCE" /><input type="hidden" name="entity" value="AraPayment" /><input type="hidden" name="entityId" value={p.id} /><input type="hidden" name="customerId" value={p.customerId ?? ""} /><Field label={t("admin.payment.evidence")} name="file"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required /></Field><SubmitButton variant="secondary">{t("admin.document.upload")}</SubmitButton></ActionForm>
                            </>
                          )}
                          {partly && (
                            <>
                              <ActionForm action={paymentStepAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="step" value="allocate" />
                                <Field label={t("admin.payment.invoice")} name="invoiceId"><Select name="invoiceId" required defaultValue="">{[<option key="" value="">—</option>, ...data.openInvoices.filter((i) => i.partyId === customer?.partyId).map((i) => <option key={i.id} value={i.id}>{i.number} · {formatAmount(i.grossAmount.toString(), i.currency, locale)}</option>)]}</Select></Field>
                                <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" defaultValue={open} required /></Field>
                                <SubmitButton variant="secondary">{t("admin.payment.allocate")}</SubmitButton>
                              </ActionForm>
                              <ActionForm action={paymentStepAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="step" value="refund" />
                                <div className="grid grid-cols-2 gap-2">
                                  <Field label={t("admin.payment.account")} name="financialAccountId"><Select name="financialAccountId" defaultValue={p.financialAccountId}>{data.accounts.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.currency})</option>)}</Select></Field>
                                  <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={todayIso} /></Field>
                                  <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" defaultValue={open} /></Field>
                                  <Field label={t("admin.subscription.reason")} name="reason"><Input name="reason" required /></Field>
                                </div>
                                <SubmitButton variant="secondary">{t("admin.payment.refund")}</SubmitButton>
                              </ActionForm>
                            </>
                          )}
                          {data.documents.filter((d) => d.entityId === p.id).map((d) => <a key={d.id} href={`/api/admin/documents/${d.id}`} className="block text-xs text-accent hover:underline">{d.fileName}</a>)}
                        </div>
                      </details>
                    )}
                    {p.status === "FAILED" && <span className="text-xs text-muted-foreground">{p.failureReason}</span>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {adminCan(a, "payments.create") && (
        <Card title={t("admin.payment.register")} description={t("admin.payment.registerIntro")} className="mt-6">
          {data.accounts.length === 0 ? <p className="text-sm text-muted-foreground">{t("admin.payment.noAccounts")}</p> : (
            <ActionForm action={registerPaymentAction} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("admin.quote.customer")} name="customerId"><Select name="customerId" defaultValue="">{[<option key="" value="">—</option>, ...data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
                <Field label={t("admin.payment.method")} name="method"><Select name="method" defaultValue="BANK_TRANSFER">{["BANK_TRANSFER", "CASH", "OTHER"].map((m) => <option key={m} value={m}>{t(`admin.paymentMethods.${m}`)}</option>)}</Select></Field>
                <Field label={t("admin.payment.account")} name="financialAccountId"><Select name="financialAccountId" required defaultValue="">{[<option key="" value="">—</option>, ...data.accounts.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.currency})</option>)]}</Select></Field>
                <Field label={t("common.date")} name="paymentDate"><Input type="date" name="paymentDate" defaultValue={todayIso} required /></Field>
                <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
                <Field label={t("admin.payment.reference")} name="reference"><Input name="reference" /></Field>
                <Field label={t("admin.payment.rate")} name="exchangeRate" hint={t("admin.payment.rateHint")}><Input name="exchangeRate" inputMode="decimal" /></Field>
                <Field label={t("common.notes")} name="notes"><Input name="notes" /></Field>
              </div>
              <fieldset className="mt-2">
                <legend className="text-sm font-medium">{t("admin.payment.allocations")}</legend>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <Select name="allocInvoice" defaultValue="" aria-label={t("admin.payment.invoice")}>{[<option key="" value="">—</option>, ...data.openInvoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.number} · {inv.party.name} · {formatAmount(inv.grossAmount.toString(), inv.currency, locale)}</option>)]}</Select>
                    <Input name="allocAmount" inputMode="decimal" aria-label={t("common.amount")} />
                  </div>
                ))}
              </fieldset>
              <SubmitButton>{t("admin.payment.registerButton")}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
