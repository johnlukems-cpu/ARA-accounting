import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { createFinancialAccountAction } from "@/actions/invoicing";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const BANKS = ["DSB", "HAKRIN", "FINA", "REPUBLIC", "SCB", "GODO", "VCB", "SPSB", "AMANAH", "OTHER"] as const;

export default async function BankingPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const ctx = await requireApp("banking.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const accounts = await withTenant(ctx.access, async (tx) => {
    const list = await tx.financialAccount.findMany({ where: { administrationId: admin.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
    const balances = await tx.$queryRaw<{ accountId: string; tx: string; base: string }[]>`
      SELECT l."accountId", SUM(l."txAmount")::text AS tx, SUM(l."debitBase" - l."creditBase")::text AS base
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
       WHERE l."administrationId" = ${admin.id} AND e.status = 'POSTED' GROUP BY l."accountId"`;
    const byAcc = new Map(balances.map((b) => [b.accountId, b]));
    return list.map((a) => ({ ...a, balance: byAcc.get(a.ledgerAccountId) }));
  });

  return (
    <>
      <PageHeader title={t("banking.title")} description={`${admin.code} · ${admin.name}`} />
      <Card>
        {accounts.length === 0 ? <EmptyState title={t("banking.none")} /> : (
          <Table head={[t("company.name"), t("banking.bank"), t("banking.accountNumber"), t("ledger.currency"), t("banking.balance"), t("banking.balanceBase", { base: admin.baseCurrency })]}>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td><TextLink href={`/app/ledger/general-ledger?account=${a.ledgerAccountId}`}>{a.name}</TextLink><span className="block text-xs text-muted-foreground">{t(`banking.kinds.${a.kind}`)}</span></Td>
                <Td>{a.bankCode ? t(`banks.${a.bankCode}`) : "—"}</Td>
                <Td>{a.accountNumber ?? "—"}</Td>
                <Td>{a.currency}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatAmount(a.balance?.tx ?? "0", a.currency, locale)}</Td>
                <Td className="amount whitespace-nowrap text-right text-muted-foreground">{formatAmount(a.balance?.base ?? "0", admin.baseCurrency, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {can(ctx.access, "administrations.edit", admin.companyId) && (
        <Card title={t("banking.addTitle")} description={t("banking.addIntro")} className="mt-6">
          <ActionForm action={createFinancialAccountAction} resetOnSuccess>
            <input type="hidden" name="administrationId" value={admin.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("banking.kind")} name="kind">
                <Select name="kind" defaultValue="BANK"><option value="BANK">{t("banking.kinds.BANK")}</option><option value="CASH">{t("banking.kinds.CASH")}</option></Select>
              </Field>
              <Field label={t("company.name")} name="name"><Input name="name" required /></Field>
              <Field label={t("banking.bank")} name="bankCode">
                <Select name="bankCode" defaultValue=""><option value="">—</option>{BANKS.map((b) => <option key={b} value={b}>{t(`banks.${b}`)}</option>)}</Select>
              </Field>
              <Field label={t("banking.accountNumber")} name="accountNumber" hint={t("banking.accountNumberHint")}><Input name="accountNumber" /></Field>
              <Field label={t("ledger.currency")} name="currency">
                <Select name="currency" defaultValue="SRD">{["SRD", "USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              </Field>
            </div>
            <SubmitButton>{t("banking.add")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
