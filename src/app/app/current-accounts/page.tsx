import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createCurrentAccountAction } from "@/actions/assets";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const KINDS = ["DIRECTOR", "SHAREHOLDER", "RELATED_PARTY", "INTERCOMPANY"] as const;

export default async function CurrentAccountsPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("currentAccounts.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const list = await withTenant(ctx.access, async (tx) => {
    const accounts = await tx.currentAccount.findMany({ where: { administrationId: admin.id }, orderBy: { counterpartyName: "asc" } });
    const ledger = await tx.account.findMany({ where: { id: { in: accounts.map((a) => a.ledgerAccountId) } }, select: { id: true, number: true } });
    const balances = await tx.$queryRaw<{ accountId: string; tx: string; base: string }[]>`
      SELECT l."accountId", SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
       WHERE l."administrationId" = ${admin.id} AND e.status = 'POSTED' GROUP BY l."accountId"`;
    const bal = new Map(balances.map((b) => [b.accountId, b]));
    const num = new Map(ledger.map((l) => [l.id, l.number]));
    return accounts.map((a) => ({ ...a, number: num.get(a.ledgerAccountId), balance: bal.get(a.ledgerAccountId) }));
  });

  return (
    <>
      <PageHeader title={t("currentAccounts.title")} description={t("currentAccounts.intro")} />
      <Card>
        {list.length === 0 ? <EmptyState title={t("currentAccounts.none")} /> : (
          <Table head={[t("currentAccounts.counterparty"), t("currentAccounts.kind"), t("ledger.account"), t("ledger.currency"), t("currentAccounts.balance")]}>
            {list.map((a) => {
              const v = a.currency === admin.baseCurrency ? a.balance?.base : a.balance?.tx;
              return (
                <tr key={a.id}>
                  <Td><TextLink href={`/app/current-accounts/${a.id}`}>{a.counterpartyName}</TextLink></Td>
                  <Td>{t(`currentAccounts.kinds.${a.kind}`)}</Td>
                  <Td>{a.number}</Td>
                  <Td>{a.currency}</Td>
                  <Td className="amount text-right">{formatAmount(v ?? "0", a.currency, locale)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("currentAccounts.signHint")}</p>
      </Card>
      {can(ctx.access, "currentAccounts.create", admin.companyId) && (
        <Card title={t("currentAccounts.addTitle")} className="mt-6">
          <ActionForm action={createCurrentAccountAction} resetOnSuccess>
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("currentAccounts.counterparty")} name="counterpartyName"><Input name="counterpartyName" required /></Field>
              <Field label={t("currentAccounts.kind")} name="kind">
                <Select name="kind" defaultValue="DIRECTOR">{KINDS.map((k) => <option key={k} value={k}>{t(`currentAccounts.kinds.${k}`)}</option>)}</Select>
              </Field>
              <Field label={t("ledger.currency")} name="currency">
                <Select name="currency" defaultValue={admin.baseCurrency}>{["SRD", "USD", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              </Field>
              <Field label={t("currentAccounts.interest")} name="interestRatePct" hint={t("currentAccounts.interestHint")}><Input name="interestRatePct" inputMode="decimal" /></Field>
              <Field label={t("currentAccounts.agreement")} name="agreement" className="sm:col-span-2"><Textarea name="agreement" rows={2} /></Field>
            </div>
            <SubmitButton>{t("currentAccounts.add")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
