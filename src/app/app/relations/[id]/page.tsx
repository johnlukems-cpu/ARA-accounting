import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { offsetItemsAction, savePartyAction } from "@/actions/invoicing";
import { partyFormData } from "@/modules/invoicing/queries";
import { partyStatement } from "@/modules/invoicing/reports";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";
import { PartyFields } from "@/components/finance/party-fields";

export default async function RelationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const year = new Date().getUTCFullYear();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${year}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : `${year}-12-31`;

  const data = await withTenant(ctx.access, async (tx) => {
    const party = await tx.party.findUnique({ where: { id } });
    if (!party) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: party.administrationId } });
    return {
      party, admin, form: await partyFormData(tx, admin.id),
      statement: await partyStatement(tx, { partyId: id, from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T00:00:00Z`) }),
    };
  });
  if (!data || !(can(ctx.access, "sales.view", data.admin.companyId) || can(ctx.access, "purchase.view", data.admin.companyId))) notFound();
  const { party, admin, form, statement } = data;
  const mayEdit = can(ctx.access, party.isCustomer ? "sales.edit" : "purchase.edit", admin.companyId);
  const negatives = statement.open.filter((i) => i.remainingAmount.lt(0));
  const positives = statement.open.filter((i) => i.remainingAmount.gt(0));
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <PageHeader title={party.name} description={`${party.code}${party.kkfNumber ? ` · KKF ${party.kkfNumber}` : ""}`}
        actions={<div className="text-right text-sm">{[...statement.balances.entries()].map(([cur, v]) => <p key={cur} className="amount font-semibold">{t("invoicing.balance")}: {formatAmount(v, cur, locale)}</p>)}</div>} />
      <div className="space-y-6">
        <Card title={t("invoicing.openItems")}>
          {statement.open.length === 0 ? <EmptyState title={t("invoicing.noOpenItems")} /> : (
            <Table head={[t("invoicing.document"), t("invoicing.invoiceDate"), t("invoicing.dueDate"), t("invoicing.original"), t("invoicing.open")]}>
              {statement.open.map((i) => (
                <tr key={i.id}>
                  <Td>{i.documentNumber}<span className="block text-xs text-muted-foreground">{t(`invoicing.sides.${i.side}`)}</span></Td>
                  <Td>{date(i.date)}</Td>
                  <Td className={i.dueDate < new Date() ? "text-danger" : ""}>{date(i.dueDate)}</Td>
                  <Td className="amount text-right">{formatAmount(i.originalAmount, i.currency, locale)}</Td>
                  <Td className="amount text-right font-medium">{formatAmount(i.remainingAmount, i.currency, locale)}</Td>
                </tr>
              ))}
            </Table>
          )}
          {negatives.length > 0 && positives.length > 0 && can(ctx.access, "banking.post", admin.companyId) && (
            <ActionForm action={offsetItemsAction} className="mt-5 grid items-end gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_9rem_auto]">
              <Field label={t("invoicing.offsetItem")} name="openItemId">
                <Select name="openItemId">{positives.map((i) => <option key={i.id} value={i.id}>{i.documentNumber} ({formatAmount(i.remainingAmount, i.currency, locale)})</option>)}</Select>
              </Field>
              <Field label={t("invoicing.offsetWith")} name="counterOpenItemId">
                <Select name="counterOpenItemId">{negatives.map((i) => <option key={i.id} value={i.id}>{i.documentNumber} ({formatAmount(i.remainingAmount, i.currency, locale)})</option>)}</Select>
              </Field>
              <Field label={t("ledger.amount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
              <SubmitButton variant="secondary">{t("invoicing.offset")}</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title={t("invoicing.statement")} actions={
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" name="from" defaultValue={from} aria-label={t("periods.from")} className="h-8 rounded border border-border px-2" />
            <input type="date" name="to" defaultValue={to} aria-label={t("periods.to")} className="h-8 rounded border border-border px-2" />
            <button className="h-8 rounded border border-border px-3">{t("common.show")}</button>
          </form>
        }>
          {statement.movements.length === 0 ? <p className="text-sm text-muted-foreground">{t("invoicing.noMovements")}</p> : (
            <Table head={[t("ledger.entryDate"), t("invoicing.document"), t("ledger.description"), t("ledger.amount")]}>
              {statement.movements.map((m, i) => (
                <tr key={i}>
                  <Td>{date(m.date)}</Td><Td>{m.document}</Td><Td>{m.description}</Td>
                  <Td className="amount text-right">{formatAmount(m.amount, m.currency, locale)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {mayEdit && (
          <Card title={t("invoicing.relationDetails")}>
            <ActionForm action={savePartyAction}>
              <input type="hidden" name="administrationId" value={admin.id} />
              <input type="hidden" name="id" value={party.id} />
              <PartyFields party={party} revenue={form.revenue} expense={form.expense} taxCodes={form.taxCodes} />
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
