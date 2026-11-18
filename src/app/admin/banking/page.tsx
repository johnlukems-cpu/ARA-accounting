import { getLocale, getTranslations } from "next-intl/server";
import { withTenant } from "@/core/tenancy/tenant";
import { requireAdmin } from "@/modules/admin/guard";
import { accountBalance } from "@/modules/banking/service";
import { formatAmount } from "@/lib/format";
import { OpenBooks } from "@/components/admin/open-books";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

/** ARA's bank and cash accounts. Import, matching and reconciliation run in the accounting app (same engine). */
export default async function BankingPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const a = await requireAdmin("banking.view");
  const base = (await withTenant(a.access, (tx) => tx.administration.findUniqueOrThrow({ where: { id: a.home.administrationId } }))).baseCurrency;
  const rows = await withTenant(a.access, async (tx) => {
    const accounts = await tx.financialAccount.findMany({ where: { administrationId: a.home.administrationId, status: "ACTIVE" }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
    const out = [];
    for (const f of accounts) {
      const bal = await accountBalance(tx, f.ledgerAccountId, new Date());
      const unmatched = await tx.bankTransaction.count({ where: { financialAccountId: f.id, status: { in: ["UNMATCHED", "PARTIAL"] } } });
      const last = await tx.bankStatement.findFirst({ where: { financialAccountId: f.id }, orderBy: { importedAt: "desc" } });
      out.push({ f, bal, unmatched, last });
    }
    return out;
  });
  return (
    <>
      <PageHeader title={t("admin.nav.banking")} description={t("admin.banking.intro")} actions={<OpenBooks to="/app/banking" label={t("admin.banking.open")} />} />
      <Card>
        {rows.length === 0 ? <EmptyState title={t("admin.banking.none")} /> : (
          <Table head={[t("banking.bank"), t("banking.kind"), t("banking.balance"), t("admin.banking.unmatched"), t("admin.banking.lastImport"), ""]}>
            {rows.map(({ f, bal, unmatched, last }) => (
              <tr key={f.id}>
                <Td>{f.name}{f.accountNumber && <span className="block text-xs text-muted-foreground">{f.accountNumber}</span>}</Td>
                <Td>{t(`banking.kinds.${f.kind}`)}</Td>
                <Td className="amount text-right">{formatAmount((f.currency === base ? bal.base : bal.tx).toFixed(2), f.currency, locale)}</Td>
                <Td className={unmatched ? "text-warning" : ""}>{unmatched}</Td>
                <Td className="text-xs">{last ? `${last.fileName} (${last.lineCount})` : "—"}</Td>
                <Td><OpenBooks to={`/app/banking/${f.id}`} label={t("admin.banking.process")} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
