import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { accountBalance, importProfileSchema, suggestions } from "@/modules/banking/service";
import {
  approveReconciliationAction, bookAction, cashEntryAction, ignoreAction, importStatementAction, matchAction, reconcileAction, saveProfileAction, transferAction,
} from "@/actions/banking";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui/misc";

const PAGE = 25;

export default async function FinancialAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const showAll = sp.status === "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await withTenant(ctx.access, async (tx) => {
    const fa = await tx.financialAccount.findUnique({ where: { id } });
    if (!fa) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: fa.administrationId } });
    const where = { financialAccountId: fa.id, ...(showAll ? {} : { status: { in: ["UNMATCHED", "PARTIAL"] as ("UNMATCHED" | "PARTIAL")[] } }) };
    const txs = await tx.bankTransaction.findMany({ where, orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }], skip: (page - 1) * PAGE, take: PAGE });
    const sugg = new Map<string, Awaited<ReturnType<typeof suggestions>>>();
    for (const b of txs) if (b.status === "UNMATCHED" || b.status === "PARTIAL") sugg.set(b.id, await suggestions(tx, b.id));
    return {
      fa, admin, txs, sugg,
      total: await tx.bankTransaction.count({ where }),
      open: await tx.bankTransaction.count({ where: { financialAccountId: fa.id, status: { in: ["UNMATCHED", "PARTIAL"] } } }),
      balance: await accountBalance(tx, fa.ledgerAccountId, new Date("9999-12-31")),
      statements: await tx.bankStatement.findMany({ where: { financialAccountId: fa.id }, orderBy: { importedAt: "desc" }, take: 8 }),
      reconciliations: await tx.bankReconciliation.findMany({ where: { financialAccountId: fa.id }, orderBy: { periodEnd: "desc" }, take: 6 }),
      accounts: await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", controlType: { in: ["NONE", "TAX", "SUSPENSE", "ROUNDING", "FX_RESULT", "CURRENT_ACCOUNT"] } }, select: { id: true, number: true, name: true }, orderBy: { number: "asc" } }),
      others: await tx.financialAccount.findMany({ where: { administrationId: admin.id, status: "ACTIVE", id: { not: fa.id } }, orderBy: { name: "asc" } }),
      taxCodes: await tx.taxCode.findMany({ where: { administrationId: admin.id, status: "ACTIVE" }, orderBy: { code: "asc" } }),
    };
  });
  if (!data || !can(ctx.access, "banking.view", data.admin.companyId)) notFound();
  const { fa, admin, txs, sugg, total, open, balance, statements, reconciliations, accounts, others, taxCodes } = data;
  const companyId = admin.companyId;
  const mayPost = can(ctx.access, "banking.post", companyId);
  const foreign = fa.currency !== admin.baseCurrency;
  const parsedProfile = importProfileSchema.safeParse(fa.importProfile);
  const profile = parsedProfile.success ? parsedProfile.data : null;
  const col = (v: number | undefined) => (v === undefined ? "" : String(v + 1));
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const money = (v: { toString(): string }) => formatAmount(v.toString(), fa.currency, locale);
  const today = new Date().toISOString().slice(0, 10);
  const statusTone = { UNMATCHED: "warning", PARTIAL: "info", MATCHED: "success", IGNORED: "neutral" } as const;

  return (
    <>
      <PageHeader title={fa.name} description={`${fa.bankCode ? t(`banks.${fa.bankCode}`) : t(`banking.kinds.${fa.kind}`)}${fa.accountNumber ? ` · ${fa.accountNumber}` : ""} · ${fa.currency}`}
        actions={<div className="text-right"><p className="amount text-xl font-semibold">{money(balance.tx)}</p>{foreign && <p className="amount text-xs text-muted-foreground">{formatAmount(balance.base, admin.baseCurrency, locale)}</p>}</div>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title={t("banking.transactions")} description={t("banking.openCount", { count: open })}
            actions={<div className="flex gap-2 text-sm"><Link className={showAll ? "text-muted-foreground" : "font-semibold"} href="?">{t("banking.toProcess")}</Link><Link className={showAll ? "font-semibold" : "text-muted-foreground"} href="?status=all">{t("banking.allLines")}</Link></div>}>
            {txs.length === 0 ? <EmptyState title={t(showAll ? "banking.noTransactions" : "banking.allProcessed")} /> : (
              <ul className="divide-y divide-border">
                {txs.map((b) => {
                  const remaining = b.amount.abs().minus(b.matchedAmount);
                  const options = sugg.get(b.id) ?? [];
                  const processable = (b.status === "UNMATCHED" || b.status === "PARTIAL") && mayPost;
                  return (
                    <li key={b.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{b.description}</p>
                          <p className="text-xs text-muted-foreground">{date(b.bookingDate)}{b.counterpartyName ? ` · ${b.counterpartyName}` : ""}{b.bankReference ? ` · ${b.bankReference}` : ""}</p>
                        </div>
                        <div className="text-right">
                          <p className={`amount text-sm font-semibold ${b.amount.lt(0) ? "text-danger" : "text-accent"}`}>{money(b.amount)}</p>
                          <Badge tone={statusTone[b.status]}>{t(`banking.status.${b.status}`)}</Badge>
                        </div>
                      </div>
                      {processable && (
                        <details className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
                          <summary className="cursor-pointer text-sm font-medium text-accent">{t("banking.process", { amount: money(remaining) })}</summary>
                          <div className="mt-3 space-y-4">
                            {options.length > 0 && (
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("banking.suggestions")}</p>
                                <ul className="space-y-2">
                                  {options.map(({ item, score }) => (
                                    <li key={item.id}>
                                      <ActionForm action={matchAction} className="flex flex-wrap items-center gap-2 space-y-0 text-sm">
                                        <input type="hidden" name="financialAccountId" value={fa.id} />
                                        <input type="hidden" name="transactionId" value={b.id} />
                                        <input type="hidden" name="openItemId" value={item.id} />
                                        <span className="min-w-0 flex-1">{item.documentNumber} · {item.party?.name} · {t("invoicing.open")} {formatAmount(item.remainingAmount, item.currency, locale)} <Badge tone={score >= 90 ? "success" : score >= 50 ? "info" : "neutral"}>{score}%</Badge></span>
                                        <Input name="amount" defaultValue={(remaining.lt(item.remainingAmount.abs()) ? remaining : item.remainingAmount.abs()).toFixed(2)} className="h-8 w-28 text-right text-xs" aria-label={t("ledger.amount")} />
                                        {foreign && <Input name="exchangeRate" placeholder={t("ledger.rate")} className="h-8 w-20 text-xs" aria-label={t("ledger.rate")} />}
                                        <SubmitButton className="h-8 px-3 text-xs">{t("banking.match")}</SubmitButton>
                                      </ActionForm>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <ActionForm action={bookAction} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
                              <input type="hidden" name="financialAccountId" value={fa.id} />
                              <input type="hidden" name="transactionId" value={b.id} />
                              <Field label={t("banking.bookTo")} name="accountId">
                                <Select name="accountId" defaultValue="" className="h-8 text-xs"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</Select>
                              </Field>
                              <Field label={t("ledger.description")} name="description"><Input name="description" defaultValue={b.description} className="h-8 text-xs" /></Field>
                              {foreign ? <Field label={t("ledger.rate")} name="exchangeRate"><Input name="exchangeRate" className="h-8 text-xs" /></Field> : <span />}
                              <SubmitButton variant="secondary" className="h-8 px-3 text-xs">{t("banking.book")}</SubmitButton>
                            </ActionForm>
                            {b.status === "UNMATCHED" && can(ctx.access, "banking.approve", companyId) && (
                              <ActionForm action={ignoreAction} className="flex flex-wrap items-end gap-2 space-y-0">
                                <input type="hidden" name="financialAccountId" value={fa.id} />
                                <input type="hidden" name="transactionId" value={b.id} />
                                <Input name="reason" placeholder={t("banking.ignoreReason")} className="h-8 flex-1 text-xs" aria-label={t("banking.ignoreReason")} />
                                <SubmitButton variant="ghost" className="h-8 px-3 text-xs">{t("banking.ignore")}</SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                        </details>
                      )}
                      {b.status === "IGNORED" && b.ignoreReason && <p className="mt-1 text-xs text-muted-foreground">{t("banking.ignoredBecause", { reason: b.ignoreReason })}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {total > PAGE && (
              <div className="mt-4 flex justify-end gap-2">
                {page > 1 && <Link className={buttonClass("secondary", "sm")} href={`?${showAll ? "status=all&" : ""}page=${page - 1}`}>{t("common.previous")}</Link>}
                {page * PAGE < total && <Link className={buttonClass("secondary", "sm")} href={`?${showAll ? "status=all&" : ""}page=${page + 1}`}>{t("common.next")}</Link>}
              </div>
            )}
          </Card>

          {fa.kind === "CASH" && mayPost && (
            <Card title={t("banking.cashTitle")} description={t("banking.cashIntro")}>
              <ActionForm action={cashEntryAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="financialAccountId" value={fa.id} />
                <Field label={t("banking.direction")} name="direction"><Select name="direction" defaultValue="OUT"><option value="OUT">{t("banking.cashOut")}</option><option value="IN">{t("banking.cashIn")}</option></Select></Field>
                <Field label={t("ledger.entryDate")} name="date"><Input name="date" type="date" defaultValue={today} required /></Field>
                <Field label={t("banking.amountInclBtw")} name="amount"><Input name="amount" inputMode="decimal" required /></Field>
                <Field label={t("ledger.account")} name="accountId"><Select name="accountId" defaultValue=""><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</Select></Field>
                <Field label={t("invoicing.taxCode")} name="taxCodeId"><Select name="taxCodeId" defaultValue=""><option value="">—</option>{taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.rate.toString()}%</option>)}</Select></Field>
                <Field label={t("ledger.description")} name="description"><Input name="description" required /></Field>
                {foreign && <Field label={t("ledger.rate")} name="exchangeRate"><Input name="exchangeRate" inputMode="decimal" required /></Field>}
                <div className="sm:col-span-3"><SubmitButton>{t("banking.bookCash")}</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {can(ctx.access, "banking.create", companyId) && (
            <Card title={t("banking.importTitle")}>
              {!profile ? <p className="mb-3 text-sm text-warning">{t("banking.setProfileFirst")}</p> : (
                <ActionForm action={importStatementAction} resetOnSuccess dataLabels={{ summary: t("banking.importSummary") }}>
                  <input type="hidden" name="financialAccountId" value={fa.id} />
                  <Field label={t("banking.file")} name="file"><Input name="file" type="file" accept=".csv,.txt,text/csv" required /></Field>
                  <Field label={t("banking.closingBalance")} name="closingBalance"><Input name="closingBalance" inputMode="decimal" /></Field>
                  <SubmitButton>{t("banking.import")}</SubmitButton>
                </ActionForm>
              )}
              {statements.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  {statements.map((s) => <li key={s.id}>{s.fileName} · {date(s.fromDate)}–{date(s.toDate)} · {t("banking.linesImported", { n: s.lineCount, d: s.duplicateLines })}</li>)}
                </ul>
              )}
              <details className="mt-4 border-t border-border pt-3" open={!profile}>
                <summary className="cursor-pointer text-sm font-medium">{t("banking.profileTitle")}</summary>
                <p className="my-2 text-xs text-muted-foreground">{t("banking.profileIntro")}</p>
                <ActionForm action={saveProfileAction} className="grid grid-cols-2 gap-3">
                  <input type="hidden" name="financialAccountId" value={fa.id} />
                  <Field label={t("banking.delimiter")} name="delimiter"><Select name="delimiter" defaultValue={profile?.delimiter === "\t" ? "tab" : profile?.delimiter ?? ";"}><option value=";">;</option><option value=",">,</option><option value="tab">Tab</option></Select></Field>
                  <Field label={t("banking.decimalSeparator")} name="decimalSeparator"><Select name="decimalSeparator" defaultValue={profile?.decimalSeparator ?? ","}><option value=",">1.234,56</option><option value=".">1,234.56</option></Select></Field>
                  <Field label={t("banking.dateFormat")} name="dateFormat"><Select name="dateFormat" defaultValue={profile?.dateFormat ?? "DD-MM-YYYY"}>{["DD-MM-YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "MM/DD/YYYY"].map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
                  <div className="flex items-end"><Checkbox name="hasHeader" label={t("banking.hasHeader")} defaultChecked={profile?.hasHeader ?? true} /></div>
                  <Field label={t("banking.colDate")} name="dateColumn"><Input name="dateColumn" type="number" min={1} defaultValue={col(profile?.dateColumn) || "1"} /></Field>
                  <Field label={t("banking.colDescription")} name="descriptionColumn"><Input name="descriptionColumn" type="number" min={1} defaultValue={col(profile?.descriptionColumn) || "2"} /></Field>
                  <Field label={t("banking.colAmount")} name="amountColumn" hint={t("banking.colAmountHint")}><Input name="amountColumn" type="number" min={1} defaultValue={profile ? col(profile.amountColumn) : "3"} /></Field>
                  <Field label={t("banking.colReference")} name="referenceColumn"><Input name="referenceColumn" type="number" min={1} defaultValue={col(profile?.referenceColumn)} /></Field>
                  <Field label={t("banking.colDebit")} name="debitColumn"><Input name="debitColumn" type="number" min={1} defaultValue={col(profile?.debitColumn)} /></Field>
                  <Field label={t("banking.colCredit")} name="creditColumn"><Input name="creditColumn" type="number" min={1} defaultValue={col(profile?.creditColumn)} /></Field>
                  <Field label={t("banking.colCounterparty")} name="counterpartyColumn"><Input name="counterpartyColumn" type="number" min={1} defaultValue={col(profile?.counterpartyColumn)} /></Field>
                  <Field label={t("banking.colCounterpartyAccount")} name="counterpartyAccountColumn"><Input name="counterpartyAccountColumn" type="number" min={1} defaultValue={col(profile?.counterpartyAccountColumn)} /></Field>
                  <div className="col-span-2"><SubmitButton variant="secondary">{t("banking.saveProfile")}</SubmitButton></div>
                </ActionForm>
              </details>
            </Card>
          )}

          {mayPost && others.length > 0 && (
            <Card title={t("banking.transferTitle")} description={t("banking.transferIntro")}>
              <ActionForm action={transferAction} resetOnSuccess>
                <input type="hidden" name="fromId" value={fa.id} />
                <Field label={t("banking.to")} name="toId"><Select name="toId" defaultValue="">{[<option key="" value="">—</option>, ...others.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.currency})</option>)]}</Select></Field>
                <Field label={t("ledger.entryDate")} name="date"><Input name="date" type="date" defaultValue={today} required /></Field>
                <Field label={t("banking.amountFrom", { currency: fa.currency })} name="amountFrom"><Input name="amountFrom" inputMode="decimal" required /></Field>
                <Field label={t("banking.amountTo")} name="amountTo" hint={t("banking.amountToHint")}><Input name="amountTo" inputMode="decimal" /></Field>
                {foreign && <Field label={t("banking.rateFrom", { currency: fa.currency })} name="rateFrom"><Input name="rateFrom" inputMode="decimal" /></Field>}
                <Field label={t("banking.rateTo")} name="rateTo" hint={t("banking.rateToHint")}><Input name="rateTo" inputMode="decimal" /></Field>
                <Field label={t("ledger.description")} name="description"><Input name="description" /></Field>
                <SubmitButton variant="secondary">{t("banking.transfer")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title={t("banking.reconciliationTitle")}>
            {reconciliations.length > 0 && (
              <Table head={[t("banking.periodEnd"), t("banking.difference"), t("common.status")]}>
                {reconciliations.map((r) => (
                  <tr key={r.id}>
                    <Td>{date(r.periodEnd)}</Td>
                    <Td className={`amount ${r.difference.isZero() ? "" : "text-danger"}`}>{money(r.difference)}{r.unmatchedCount > 0 && <span className="block text-xs text-warning">{t("banking.unmatchedLines", { n: r.unmatchedCount })}</span>}</Td>
                    <Td>
                      {r.status === "APPROVED" ? <Badge tone="success">{t("banking.approved")}</Badge> : can(ctx.access, "banking.approve", companyId) ? (
                        <ActionForm action={approveReconciliationAction} className="space-y-0">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="financialAccountId" value={fa.id} />
                          <SubmitButton variant="secondary" className="h-8 px-3 text-xs">{t("ledger.approve")}</SubmitButton>
                        </ActionForm>
                      ) : <Badge>{t("ledger.status.DRAFT")}</Badge>}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {can(ctx.access, "banking.edit", companyId) && (
              <ActionForm action={reconcileAction} className="mt-4">
                <input type="hidden" name="financialAccountId" value={fa.id} />
                <Field label={t("banking.periodEnd")} name="periodEnd"><Input name="periodEnd" type="date" defaultValue={today} required /></Field>
                <Field label={t("banking.statementBalance", { currency: fa.currency })} name="statementBalance"><Input name="statementBalance" inputMode="decimal" required /></Field>
                <SubmitButton variant="secondary">{t("banking.reconcile")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
