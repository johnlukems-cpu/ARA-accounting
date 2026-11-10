import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { invoiceTransitionAction, registerPaymentAction, saveInvoiceAction, sendInvoiceAction } from "@/actions/invoicing";
import { purchaseApprovalRequired } from "@/modules/invoicing/service";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, Dl, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";
import { InvoiceEditor, type InvoiceInitial } from "./invoice-editor";

type T = "SALES" | "PURCHASE";
const base = (type: T) => (type === "SALES" ? "/app/sales" : "/app/purchase");
const mod = (type: T) => (type === "SALES" ? "sales" : "purchase") as "sales" | "purchase";
const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"] as const;
const PAGE = 50;

export async function InvoiceStatusBadge({ status }: { status: string }) {
  const t = await getTranslations();
  const tone = status === "PAID" ? "success" : status === "PARTIALLY_PAID" || status === "POSTED" ? "info" : status === "APPROVED" ? "info" : status === "REVIEW" ? "warning" : "neutral";
  return <Badge tone={tone}>{t(`invoicing.status.${status}`)}</Badge>;
}

export async function InvoiceList({ type, sp }: { type: T; sp: Record<string, string | undefined> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp(`${mod(type)}.view`, { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const where: Prisma.InvoiceWhereInput = {
    administrationId: admin.id, type,
    ...(STATUSES.includes(sp.status as never) ? { status: sp.status as (typeof STATUSES)[number] } : {}),
    ...(sp.overdue === "1" ? { status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { externalNumber: { contains: q, mode: "insensitive" } }, { party: { name: { contains: q, mode: "insensitive" } } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const sort = sp.sort === "amount" ? { grossBase: "desc" as const } : sp.sort === "due" ? { dueDate: "asc" as const } : { invoiceDate: "desc" as const };
  const [rows, total] = await withTenant(ctx.access, async (tx) => [
    await tx.invoice.findMany({ where, include: { party: { select: { name: true } } }, orderBy: [sort, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
    await tx.invoice.count({ where }),
  ] as const);
  const qs = (patch: Record<string, string | number | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();

  return (
    <>
      <PageHeader title={t(type === "SALES" ? "invoicing.salesTitle" : "invoicing.purchaseTitle")} description={`${admin.code} · ${admin.name}`}
        actions={can(ctx.access, `${mod(type)}.create`, admin.companyId) && <Link href={`${base(type)}/new`} className={buttonClass("primary", "sm")}>{t(type === "SALES" ? "invoicing.newSalesInvoice" : "invoicing.newPurchaseInvoice")}</Link>} />
      <Card>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_11rem_10rem_9rem_auto]" role="search">
          <input name="q" defaultValue={q} placeholder={t("invoicing.search")} aria-label={t("invoicing.search")} className="h-9 rounded-lg border border-border px-3 text-sm" />
          <select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.allStatuses")}</option>
            {STATUSES.filter((s) => type === "PURCHASE" || (s !== "REVIEW" && s !== "APPROVED")).map((s) => <option key={s} value={s}>{t(`invoicing.status.${s}`)}</option>)}
          </select>
          <select name="sort" defaultValue={sp.sort ?? ""} aria-label={t("common.sort")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("invoicing.sortDate")}</option>
            <option value="due">{t("invoicing.sortDue")}</option>
            <option value="amount">{t("invoicing.sortAmount")}</option>
          </select>
          <select name="overdue" defaultValue={sp.overdue ?? ""} aria-label={t("invoicing.overdue")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("invoicing.allInvoices")}</option>
            <option value="1">{t("invoicing.overdueOnly")}</option>
          </select>
          <button className={buttonClass("secondary", "sm")}>{t("common.filter")}</button>
        </form>
        {rows.length === 0 ? <EmptyState title={t("invoicing.none")} /> : (
          <Table head={[t("ledger.number"), type === "SALES" ? t("invoicing.customer") : t("invoicing.supplier"), t("invoicing.invoiceDate"), t("invoicing.dueDate"), t("invoicing.totalGross"), t("common.status")]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">
                  <TextLink href={`${base(type)}/${r.id}`}>{r.number ?? t("invoicing.draftNumber")}</TextLink>
                  {r.kind === "CREDIT_NOTE" && <span className="ml-1"><Badge>{t("invoicing.creditNote")}</Badge></span>}
                  {r.externalNumber && <span className="block text-xs text-muted-foreground">{r.externalNumber}</span>}
                </Td>
                <Td>{r.party.name}</Td>
                <Td className="whitespace-nowrap">{format.dateTime(r.invoiceDate, { dateStyle: "medium", timeZone: "UTC" })}</Td>
                <Td className={`whitespace-nowrap ${["POSTED", "PARTIALLY_PAID"].includes(r.status) && r.dueDate < new Date() ? "font-medium text-danger" : ""}`}>{format.dateTime(r.dueDate, { dateStyle: "medium", timeZone: "UTC" })}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatAmount(r.grossAmount, r.currency, locale)}</Td>
                <Td><InvoiceStatusBadge status={r.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
        {total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("common.pageOf", { page, pages: Math.ceil(total / PAGE) })}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonClass("secondary", "sm")} href={qs({ page: page - 1 })}>{t("common.previous")}</Link>}
              {page * PAGE < total && <Link className={buttonClass("secondary", "sm")} href={qs({ page: page + 1 })}>{t("common.next")}</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

export async function InvoiceForm({ type, id }: { type: T; id?: string }) {
  const t = await getTranslations();
  const ctx = await requireApp(`${mod(type)}.create`, { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const data = await withTenant(ctx.access, async (tx) => ({
    parties: await tx.party.findMany({ where: { administrationId: admin.id, status: "ACTIVE", ...(type === "SALES" ? { isCustomer: true } : { isSupplier: true }) }, orderBy: { name: "asc" } }),
    accounts: await tx.account.findMany({
      where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: { in: ["NONE", "TAX", "SUSPENSE"] }, category: { in: type === "SALES" ? ["REVENUE", "FINANCIAL_INCOME", "LIABILITY", "SUSPENSE"] : ["OPERATING_EXPENSE", "COST_OF_SALES", "ASSET", "FINANCIAL_EXPENSE", "SUSPENSE", "TAX"] } },
      select: { id: true, number: true, name: true }, orderBy: { number: "asc" },
    }),
    taxCodes: await tx.taxCode.findMany({ where: { administrationId: admin.id, status: "ACTIVE", direction: { in: ["BOTH", type] } }, orderBy: { code: "asc" } }),
    invoice: id ? await tx.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } }) : null,
  }));
  if (id && (!data.invoice || data.invoice.administrationId !== admin.id || data.invoice.type !== type)) notFound();
  if (data.invoice && !["DRAFT", "REVIEW", "APPROVED"].includes(data.invoice.status)) redirect(`${base(type)}/${data.invoice.id}`);
  const today = new Date().toISOString().slice(0, 10);
  const inv = data.invoice;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const initial: InvoiceInitial = inv
    ? {
        id: inv.id, kind: inv.kind, partyId: inv.partyId, externalNumber: inv.externalNumber ?? "", invoiceDate: iso(inv.invoiceDate), dueDate: iso(inv.dueDate), currency: inv.currency,
        exchangeRate: inv.currency === admin.baseCurrency ? "" : inv.exchangeRate.toString(), description: inv.description ?? "", notes: inv.notes ?? "", creditsInvoiceId: inv.creditsInvoiceId ?? undefined,
        lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.isZero() ? "" : l.discountPct.toString(), accountId: l.accountId, taxCodeId: l.taxCodeId ?? "", costCenterId: l.costCenterId ?? "", projectId: l.projectId ?? "" })),
      }
    : { kind: "INVOICE", partyId: "", externalNumber: "", invoiceDate: today, dueDate: today, currency: admin.baseCurrency, exchangeRate: "", description: "", notes: "", lines: [{ description: "", quantity: "1", unitPrice: "", discountPct: "", accountId: "", taxCodeId: "", costCenterId: "", projectId: "" }] };
  const canPost = can(ctx.access, `${mod(type)}.post`, admin.companyId) && (type === "SALES" || !purchaseApprovalRequired(admin.settings));

  return (
    <>
      <PageHeader title={t(inv ? (inv.kind === "CREDIT_NOTE" ? "invoicing.editCreditNote" : "invoicing.editInvoice") : type === "SALES" ? "invoicing.newSalesInvoice" : "invoicing.newPurchaseInvoice")} description={`${admin.code} · ${admin.name}`} />
      {data.parties.length === 0 ? (
        <EmptyState title={t("invoicing.noParties")} action={<TextLink href="/app/relations/new">{t("invoicing.addRelation")}</TextLink>} />
      ) : (
        <Card>
          <InvoiceEditor
            action={saveInvoiceAction} type={type} administrationId={admin.id} baseCurrency={admin.baseCurrency} canPost={canPost}
            currencies={[...new Set([admin.baseCurrency, "SRD", "USD", "EUR", "GBP"])]}
            parties={data.parties.map((p) => ({ id: p.id, name: p.name, code: p.code, currency: p.currency, paymentTermDays: p.paymentTermDays, defaultAccountId: type === "SALES" ? p.defaultRevenueAccountId : p.defaultExpenseAccountId, defaultTaxCodeId: p.defaultTaxCodeId }))}
            accounts={data.accounts}
            taxCodes={data.taxCodes.map((c) => ({ id: c.id, code: c.code, name: c.name, rate: c.rate.toString(), legalStatus: c.legalStatus }))}
            initial={initial}
          />
        </Card>
      )}
    </>
  );
}

function Transition({ id, type, intent, label, variant = "secondary" }: { id: string; type: T; intent: string; label: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={invoiceTransitionAction} className="space-y-0">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitButton variant={variant} className="h-9 px-3">{label}</SubmitButton>
    </ActionForm>
  );
}

export async function InvoiceDetail({ type, id }: { type: T; id: string }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const data = await withTenant(ctx.access, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id }, include: { party: true, lines: { orderBy: { lineNo: "asc" } } } });
    if (!inv || inv.type !== type) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: inv.administrationId } });
    const [accounts, codes, item, financial, credits, creditNotes] = await Promise.all([
      tx.account.findMany({ where: { id: { in: inv.lines.map((l) => l.accountId) } }, select: { id: true, number: true, name: true } }),
      tx.taxCode.findMany({ where: { administrationId: admin.id } }),
      tx.openItem.findFirst({ where: { sourceType: "INVOICE", sourceId: inv.id }, include: { allocations: { include: { payment: true } } } }),
      tx.financialAccount.findMany({ where: { administrationId: admin.id, status: "ACTIVE", currency: inv.currency } }),
      inv.creditsInvoiceId ? tx.invoice.findUnique({ where: { id: inv.creditsInvoiceId }, select: { id: true, number: true } }) : null,
      tx.invoice.findMany({ where: { creditsInvoiceId: inv.id }, select: { id: true, number: true, status: true } }),
    ]);
    return { inv, admin, accounts: new Map(accounts.map((a) => [a.id, a])), codes: new Map(codes.map((c) => [c.id, c])), item, financial, credits, creditNotes };
  });
  if (!data || !can(ctx.access, `${mod(type)}.view`, data.admin.companyId)) notFound();
  const { inv, admin, accounts, codes, item, financial, credits, creditNotes } = data;
  const companyId = admin.companyId;
  const editable = ["DRAFT", "REVIEW", "APPROVED"].includes(inv.status);
  const posted = !editable;
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const money = (v: Decimal.Value | { toString(): string }) => formatAmount(v.toString(), inv.currency, locale);
  const approval = type === "PURCHASE" && purchaseApprovalRequired(admin.settings);
  const pendingCodes = inv.lines.some((l) => l.taxCodeId && codes.get(l.taxCodeId)?.legalStatus !== "VERIFIED");

  return (
    <>
      <PageHeader
        title={`${inv.kind === "CREDIT_NOTE" ? t("invoicing.creditNote") : t("invoicing.invoice")} ${inv.number ?? t("invoicing.draftNumber")}`}
        description={<>{inv.party.name}{inv.externalNumber ? ` · ${inv.externalNumber}` : ""}</>}
        actions={<InvoiceStatusBadge status={inv.status} />}
      />
      <div className="mb-6 flex flex-wrap items-start gap-2">
        {editable && can(ctx.access, `${mod(type)}.edit`, companyId) && <Link href={`${base(type)}/${inv.id}/edit`} className={buttonClass("secondary")}>{t("common.edit")}</Link>}
        {approval && inv.status === "DRAFT" && can(ctx.access, "purchase.create", companyId) && <Transition id={inv.id} type={type} intent="submit" label={t("ledger.submit")} />}
        {approval && (inv.status === "REVIEW" || inv.status === "DRAFT") && can(ctx.access, "purchase.approve", companyId) && <Transition id={inv.id} type={type} intent="approve" label={t("ledger.approve")} />}
        {editable && can(ctx.access, `${mod(type)}.post`, companyId) && (!approval || inv.status === "APPROVED") && <Transition id={inv.id} type={type} intent="post" label={t("ledger.post")} variant="primary" />}
        {editable && can(ctx.access, `${mod(type)}.edit`, companyId) && <Transition id={inv.id} type={type} intent="delete" label={t("ledger.deleteDraft")} variant="danger" />}
        {posted && type === "SALES" && <a href={`/api/invoices/${inv.id}/pdf`} className={buttonClass("secondary")}>{t("invoicing.downloadPdf")}</a>}
        {posted && inv.kind === "INVOICE" && can(ctx.access, `${mod(type)}.create`, companyId) && <Transition id={inv.id} type={type} intent="credit" label={t("invoicing.makeCreditNote")} />}
        {!posted && type === "SALES" && <a href={`/api/invoices/${inv.id}/pdf`} className={buttonClass("ghost")}>{t("invoicing.previewPdf")}</a>}
      </div>
      {pendingCodes && <p className="mb-6 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">{t("invoicing.taxPendingVerification")}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title={t("ledger.lines")}>
          <Table head={[t("ledger.description"), t("invoicing.quantity"), t("invoicing.unitPrice"), t("invoicing.taxCode"), t("ledger.account"), t("invoicing.net")]}>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.description}</Td>
                <Td className="amount text-right">{l.quantity.toString()}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatAmount(l.unitPrice, "", locale).trim()}{!l.discountPct.isZero() && <span className="block text-xs text-muted-foreground">−{l.discountPct.toString()}%</span>}</Td>
                <Td className="text-xs">{l.taxCodeId ? `${codes.get(l.taxCodeId)?.code} (${l.taxRate.toString()}%)` : "—"}</Td>
                <Td className="text-xs">{accounts.get(l.accountId)?.number} {accounts.get(l.accountId)?.name}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatAmount(l.netAmount, "", locale).trim()}</Td>
              </tr>
            ))}
          </Table>
          <dl className="amount ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("invoicing.totalNet")}</dt><dd>{money(inv.netAmount)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.totalTax")}</dt><dd>{money(inv.taxAmount)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>{t("invoicing.totalGross")}</dt><dd>{money(inv.grossAmount)}</dd></div>
            {inv.currency !== admin.baseCurrency && <div className="flex justify-between text-xs text-muted-foreground"><dt>{t("invoicing.inBase", { rate: inv.exchangeRate.toString() })}</dt><dd>{formatAmount(inv.grossBase, admin.baseCurrency, locale)}</dd></div>}
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title={t("ledger.details")}>
            <Dl items={[
              [t(type === "SALES" ? "invoicing.customer" : "invoicing.supplier"), <TextLink key="p" href={`/app/relations/${inv.partyId}`}>{inv.party.name}</TextLink>],
              [t("invoicing.invoiceDate"), date(inv.invoiceDate)],
              [t("invoicing.dueDate"), date(inv.dueDate)],
              [t("ledger.currency"), inv.currency],
              [t("invoicing.reference"), inv.description],
              ...(credits ? [[t("invoicing.creditsInvoice"), <TextLink key="c" href={`${base(type)}/${credits.id}`}>{credits.number}</TextLink>] as [string, React.ReactNode]] : []),
              ...(inv.entryId ? [[t("invoicing.journalEntry"), <TextLink key="e" href={`/app/ledger/entries/${inv.entryId}`}>{t("invoicing.viewEntry")}</TextLink>] as [string, React.ReactNode]] : []),
              ...(inv.sentAt ? [[t("invoicing.sentTo"), `${inv.sentTo} · ${format.dateTime(inv.sentAt, { dateStyle: "short", timeStyle: "short" })}`] as [string, string]] : []),
            ]} />
            {creditNotes.length > 0 && <p className="mt-3 text-sm">{t("invoicing.creditedBy")} {creditNotes.map((c) => <TextLink key={c.id} href={`${base(type)}/${c.id}`}>{c.number ?? t("invoicing.draftNumber")}</TextLink>)}</p>}
          </Card>

          {item && (
            <Card title={t("invoicing.payments")} description={t("invoicing.remaining", { amount: money(item.remainingAmount) })}>
              {item.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t("invoicing.noPayments")}</p> : (
                <ul className="space-y-1 text-sm">
                  {item.allocations.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span>{a.payment ? date(a.payment.date) : t("invoicing.offset")}</span>
                      <span className="amount">{money(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.status === "OPEN" && !item.remainingAmount.lt(0) && can(ctx.access, "banking.post", companyId) && (
                financial.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">{t("invoicing.noFinancialAccount", { currency: inv.currency })} <TextLink href="/app/banking">{t("nav.banking")}</TextLink></p>
                ) : (
                  <ActionForm action={registerPaymentAction} resetOnSuccess className="mt-4 space-y-3 border-t border-border pt-4">
                    <input type="hidden" name="administrationId" value={admin.id} />
                    <input type="hidden" name="direction" value={type === "SALES" ? "IN" : "OUT"} />
                    <input type="hidden" name="openItemId" value={item.id} />
                    <input type="hidden" name="partyId" value={inv.partyId} />
                    <Field label={t("invoicing.financialAccount")} name="financialAccountId">
                      <Select name="financialAccountId">{financial.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.currency})</option>)}</Select>
                    </Field>
                    <Field label={t("invoicing.paymentDate")} name="date"><Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
                    <Field label={t("ledger.amount")} name="amount"><Input name="amount" inputMode="decimal" defaultValue={item.remainingAmount.toFixed(2)} required /></Field>
                    {inv.currency !== admin.baseCurrency && <Field label={t("invoicing.paymentRate", { currency: inv.currency, base: admin.baseCurrency })} name="exchangeRate"><Input name="exchangeRate" inputMode="decimal" required /></Field>}
                    <Field label={t("ledger.reference")} name="reference"><Input name="reference" /></Field>
                    <SubmitButton>{t("invoicing.registerPayment")}</SubmitButton>
                  </ActionForm>
                )
              )}
            </Card>
          )}

          {posted && type === "SALES" && can(ctx.access, "sales.post", companyId) && (
            <Card title={t("invoicing.sendTitle")}>
              <ActionForm action={sendInvoiceAction}>
                <input type="hidden" name="id" value={inv.id} />
                <Field label={t("auth.email")} name="to"><Input name="to" type="email" defaultValue={inv.party.email ?? ""} required /></Field>
                <SubmitButton variant="secondary">{t("invoicing.send")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
