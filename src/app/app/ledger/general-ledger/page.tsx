import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { formatEntryNumber } from "@/core/ledger/engine";
import { generalLedger } from "@/modules/ledger/reports";
import { formatAmount, formatCell } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("ledger.view", { needCompany: true });
  if (!ctx.administration || !ctx.fiscalYear) redirect("/onboarding");
  const admin = ctx.administration;
  const sp = await searchParams;
  const fiscalYearId = ctx.fiscalYears.some((y) => y.id === sp.fiscalYearId) ? sp.fiscalYearId! : ctx.fiscalYear.id;
  const fy = ctx.fiscalYears.find((y) => y.id === fiscalYearId)!;
  const clamp = (v: string | undefined, d: number) => Math.min(13, Math.max(0, Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d));
  const from = clamp(sp.fromPeriod, 0);
  const to = clamp(sp.toPeriod, 13);

  const { accounts, account, gl } = await withTenant(ctx.access, async (tx) => {
    const accounts = await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL" }, select: { id: true, number: true, name: true, normalBalance: true }, orderBy: { number: "asc" } });
    const account = accounts.find((a) => a.id === sp.account) ?? null;
    const gl = account ? await generalLedger(tx, { administrationId: admin.id, fiscalYearId, accountId: account.id, fromPeriod: Math.min(from, to), toPeriod: Math.max(from, to) }) : null;
    return { accounts, account, gl };
  });
  const query = account ? new URLSearchParams({ account: account.id, fiscalYearId, fromPeriod: String(from), toPeriod: String(to) }) : null;
  const balance = (v: string) => `${formatCell(v, locale) || "0,00"} ${v.startsWith("-") ? t("ledger.cr") : t("ledger.dr")}`.replace("-", "");

  return (
    <>
      <PageHeader
        title={t("ledger.generalLedgerTitle")}
        description={account ? `${account.number} · ${account.name} · ${t("shell.fiscalYear")} ${fy.code}` : t("ledger.chooseAccount")}
        actions={query && (can(ctx.access, "ledger.export", admin.companyId) || can(ctx.access, "reports.export", admin.companyId)) && (
          <a className={buttonClass("secondary", "sm")} href={`/api/ledger/general-ledger?${query}`}>{t("common.exportCsv")}</a>
        )}
      />
      <Card>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_8rem_7rem_7rem_auto]">
          <select name="account" defaultValue={account?.id ?? ""} aria-label={t("ledger.account")} className="h-9 rounded-lg border border-border px-2 text-sm">
            <option value="">{t("ledger.chooseAccount")}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
          </select>
          <select name="fiscalYearId" defaultValue={fiscalYearId} aria-label={t("shell.fiscalYear")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {ctx.fiscalYears.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
          <select name="fromPeriod" defaultValue={from} aria-label={t("ledger.fromPeriod")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {Array.from({ length: 14 }, (_, p) => <option key={p} value={p}>{t("ledger.fromPeriodShort", { p })}</option>)}
          </select>
          <select name="toPeriod" defaultValue={to} aria-label={t("ledger.toPeriod")} className="h-9 rounded-lg border border-border px-2 text-sm">
            {Array.from({ length: 14 }, (_, p) => <option key={p} value={p}>{t("ledger.toPeriodShort", { p })}</option>)}
          </select>
          <button className={buttonClass("secondary", "sm")}>{t("common.show")}</button>
        </form>
        {!gl ? (
          <EmptyState title={t("ledger.chooseAccount")} />
        ) : (
          <Table head={[t("ledger.entryDate"), t("ledger.number"), t("ledger.description"), t("ledger.debit"), t("ledger.credit"), t("ledger.balance")]}>
            <tr className="bg-muted/50 text-sm">
              <Td colSpan={5}>{t("ledger.openingBalance")}</Td>
              <Td className="amount whitespace-nowrap text-right">{balance(gl.opening)}</Td>
            </tr>
            {gl.lines.map((l) => (
              <tr key={l.lineId}>
                <Td className="whitespace-nowrap">{format.dateTime(new Date(`${l.entryDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</Td>
                <Td className="whitespace-nowrap"><Link className="text-accent hover:underline" href={`/app/ledger/entries/${l.entryId}`}>{formatEntryNumber(l.journalCode, fy.code, l.entryNumber)}</Link></Td>
                <Td>
                  {l.description}
                  {l.txCurrency !== admin.baseCurrency && <span className="block text-xs text-muted-foreground">{formatAmount(l.txAmount, l.txCurrency, locale)}</span>}
                </Td>
                <Td className="amount whitespace-nowrap text-right">{formatCell(l.debit, locale)}</Td>
                <Td className="amount whitespace-nowrap text-right">{formatCell(l.credit, locale)}</Td>
                <Td className="amount whitespace-nowrap text-right">{balance(l.balance)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td colSpan={5}>{t("ledger.closingBalance")}</Td>
              <Td className="amount whitespace-nowrap text-right">{balance(gl.closing)}</Td>
            </tr>
          </Table>
        )}
      </Card>
    </>
  );
}
