import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { confirmCurrentAccountAction, currentAccountMovementAction } from "@/actions/assets";
import { formatAmount } from "@/lib/format";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, Dl, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

export default async function CurrentAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const data = await withTenant(ctx.access, async (tx) => {
    const ca = await tx.currentAccount.findUnique({ where: { id }, include: { confirmations: { orderBy: { date: "desc" }, take: 10 } } });
    if (!ca) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: ca.administrationId } });
    const ledger = await tx.account.findUniqueOrThrow({ where: { id: ca.ledgerAccountId } });
    const lines = await tx.journalLine.findMany({
      where: { accountId: ca.ledgerAccountId, entry: { status: "POSTED" } },
      include: { entry: { select: { id: true, entryDate: true, description: true } } },
      orderBy: [{ entry: { entryDate: "asc" } }, { entry: { postedAt: "asc" } }],
    });
    const counters = await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", id: { not: ca.ledgerAccountId }, controlType: { in: ["NONE", "BANK", "CASH", "CURRENT_ACCOUNT", "SUSPENSE"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } });
    return { ca, admin, ledger, lines, counters };
  });
  if (!data || !can(ctx.access, "currentAccounts.view", data.admin.companyId)) notFound();
  const { ca, admin, ledger, lines, counters } = data;
  const foreign = ca.currency !== admin.baseCurrency;
  const money = (v: { toString(): string }) => formatAmount(v.toString(), ca.currency, locale);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const today = new Date().toISOString().slice(0, 10);
  const rows = lines.reduce<{ l: (typeof lines)[number]; amt: Decimal; running: Decimal }[]>((acc, l) => {
    const amt = foreign ? new Decimal(l.txAmount.toString()) : new Decimal(l.debitBase.toString()).minus(l.creditBase.toString());
    return [...acc, { l, amt, running: (acc.at(-1)?.running ?? new Decimal(0)).plus(amt) }];
  }, []);
  const running = rows.at(-1)?.running ?? new Decimal(0);

  return (
    <>
      <PageHeader title={ca.counterpartyName} description={`${t(`currentAccounts.kinds.${ca.kind}`)} · ${ledger.number} ${ledger.name}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("currentAccounts.details")}>
          <Dl items={[
            [t("currentAccounts.balance"), <span key="b" className="amount font-medium">{money(running)}</span>],
            [t("ledger.currency"), ca.currency],
            [t("currentAccounts.interest"), ca.interestRatePct ? `${ca.interestRatePct.toString()}%` : "—"],
            [t("currentAccounts.agreement"), ca.agreement ?? "—"],
          ]} />
          <p className="mt-3 text-xs text-muted-foreground">{t("currentAccounts.signHint")}</p>
        </Card>
        {can(ctx.access, "currentAccounts.post", admin.companyId) && (
          <Card title={t("currentAccounts.movementTitle")} className="lg:col-span-2">
            <ActionForm action={currentAccountMovementAction} resetOnSuccess>
              <input type="hidden" name="currentAccountId" value={ca.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={today} required /></Field>
                <Field label={t("currentAccounts.direction")} name="direction">
                  <Select name="direction" defaultValue="INCREASE"><option value="INCREASE">{t("currentAccounts.directions.INCREASE")}</option><option value="DECREASE">{t("currentAccounts.directions.DECREASE")}</option></Select>
                </Field>
                <Field label={t("common.amount")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
                <Field label={t("currentAccounts.counterAccount")} name="counterAccountId" className="sm:col-span-2">
                  <Select name="counterAccountId" defaultValue="">{[<option key="" value="">—</option>, ...counters.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select>
                </Field>
                {foreign && <Field label={t("invoicing.exchangeRate")} name="exchangeRate"><Input name="exchangeRate" inputMode="decimal" required /></Field>}
                <Field label={t("ledger.description")} name="description" className="sm:col-span-3"><Input name="description" required /></Field>
              </div>
              <SubmitButton>{t("currentAccounts.book")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <Card title={t("currentAccounts.statement")} className="mt-6">
        {rows.length === 0 ? <EmptyState title={t("currentAccounts.noMovements")} /> : (
          <Table head={[t("common.date"), t("ledger.description"), t("currentAccounts.increase"), t("currentAccounts.decrease"), t("currentAccounts.balance")]}>
            {rows.map(({ l, amt, running: r }) => (
              <tr key={l.id}>
                <Td>{date(l.entry.entryDate)}</Td>
                <Td><TextLink href={`/app/ledger/entries/${l.entry.id}`}>{l.description ?? l.entry.description}</TextLink></Td>
                <Td className="amount text-right">{amt.gt(0) ? money(amt) : ""}</Td>
                <Td className="amount text-right">{amt.lt(0) ? money(amt.abs()) : ""}</Td>
                <Td className="amount text-right">{money(r)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t("currentAccounts.confirmTitle")} description={t("currentAccounts.confirmIntro")} className="mt-6">
        {ca.confirmations.length > 0 && (
          <Table head={[t("common.date"), t("currentAccounts.confirmed"), t("currentAccounts.ledgerBalance"), t("currentAccounts.difference")]}>
            {ca.confirmations.map((c) => (
              <tr key={c.id}>
                <Td>{date(c.date)}</Td>
                <Td className="amount text-right">{money(c.confirmedBalance)}</Td>
                <Td className="amount text-right">{money(c.ledgerBalance)}</Td>
                <Td className="text-right">{new Decimal(c.difference.toString()).isZero() ? <Badge tone="success">{t("currentAccounts.agrees")}</Badge> : <Badge tone="warning">{money(c.difference)}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
        {can(ctx.access, "currentAccounts.edit", admin.companyId) && (
          <ActionForm action={confirmCurrentAccountAction} resetOnSuccess className="mt-4">
            <input type="hidden" name="currentAccountId" value={ca.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("common.date")} name="date"><Input type="date" name="date" defaultValue={today} required /></Field>
              <Field label={t("currentAccounts.confirmed")} name="confirmedBalance" hint={t("currentAccounts.confirmedHint")}><Input name="confirmedBalance" inputMode="decimal" required /></Field>
              <Field label={t("common.notes")} name="notes"><Input name="notes" /></Field>
            </div>
            <SubmitButton variant="secondary">{t("currentAccounts.confirm")}</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
