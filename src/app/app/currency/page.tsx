import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { RATE_TYPES } from "@/modules/currency/domain";
import { policyOf, revaluationPreview } from "@/modules/currency/service";
import {
  createRateAction, decideRateAction, importCbvsAction, proposeRevaluationAction, revaluationStepAction, savePolicyAction,
} from "@/actions/currency";
import { formatAmount, formatRate } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const PAGE = 50;

export default async function CurrencyPage({ searchParams }: { searchParams: Promise<{ currency?: string; type?: string; page?: string; period?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp("currency.view", { needCompany: true });
  if (!ctx.administration) redirect("/onboarding");
  const admin = ctx.administration;
  const page = Math.max(1, Number(sp.page) || 1);
  const type = (RATE_TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as (typeof RATE_TYPES)[number]) : undefined;
  const currency = /^[A-Z]{3}$/.test(sp.currency ?? "") ? sp.currency : undefined;

  const data = await withTenant(ctx.access, async (tx) => {
    const where = { baseCurrency: admin.baseCurrency, ...(currency ? { currency } : {}), ...(type ? { rateType: type } : {}) };
    const fy = ctx.fiscalYear ?? (await tx.fiscalYear.findFirst({ where: { administrationId: admin.id }, orderBy: { startDate: "desc" } }));
    const periods = fy ? await tx.accountingPeriod.findMany({ where: { fiscalYearId: fy.id, number: { gte: 1, lte: 12 } }, orderBy: { number: "asc" } }) : [];
    const fresh = await tx.administration.findUniqueOrThrow({ where: { id: admin.id } });
    const selected = periods.find((p) => p.id === sp.period);
    return {
      rates: await tx.exchangeRate.findMany({ where, orderBy: [{ effectiveDate: "desc" }, { currency: "asc" }, { rateType: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
      total: await tx.exchangeRate.count({ where }),
      periods,
      policy: policyOf(fresh),
      preview: selected ? await revaluationPreview(tx, fresh, selected.id) : null,
      revaluations: await tx.currencyRevaluation.findMany({ where: { administrationId: admin.id }, orderBy: { createdAt: "desc" }, take: 12 }),
    };
  });
  const companyId = admin.companyId;
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const base = (v: { toString(): string }) => formatAmount(v.toString(), admin.baseCurrency, locale);
  const today = new Date().toISOString().slice(0, 10);
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ currency, type, period: sp.period, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/app/currency?${p.toString()}`;
  };
  const statusTone = { PENDING: "warning", APPROVED: "success", REJECTED: "neutral" } as const;
  const revTone = { PROPOSED: "warning", POSTED: "success", REVERSED: "neutral", CANCELLED: "neutral" } as const;
  const mayApprove = can(ctx.access, "currency.approve", companyId);

  return (
    <>
      <PageHeader title={t("currency.title")} description={t("currency.intro", { base: admin.baseCurrency })} />

      <Card title={t("currency.rates")} actions={
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <select name="currency" defaultValue={currency ?? ""} aria-label={t("ledger.currency")} className="h-8 rounded-md border border-border bg-background px-2"><option value="">{t("currency.allCurrencies")}</option>{["USD", "EUR", "GBP", "CNY", "BRL"].map((c) => <option key={c}>{c}</option>)}</select>
          <select name="type" defaultValue={type ?? ""} aria-label={t("currency.rateType")} className="h-8 rounded-md border border-border bg-background px-2"><option value="">{t("currency.allTypes")}</option>{RATE_TYPES.map((r) => <option key={r} value={r}>{t(`currency.types.${r}`)}</option>)}</select>
          <button className="h-8 rounded-md border border-border px-3">{t("common.filter")}</button>
        </form>
      }>
        {data.rates.length === 0 ? <EmptyState title={t("currency.noRates")} description={t("currency.noRatesHint")} /> : (
          <Table head={[t("common.date"), t("currency.pair"), t("currency.rateType"), t("currency.rate"), t("currency.source"), t("common.status"), ""]}>
            {data.rates.map((r) => (
              <tr key={r.id}>
                <Td>{date(r.effectiveDate)}</Td>
                <Td>{r.currency}/{r.baseCurrency}</Td>
                <Td>{t(`currency.types.${r.rateType}`)}</Td>
                <Td className="amount text-right">{formatRate(r.rate, locale)}</Td>
                <Td className="text-xs">{t(`currency.sources.${r.source}`)}{r.reference ? ` · ${r.reference}` : ""}</Td>
                <Td><Badge tone={statusTone[r.status]}>{t(`currency.statuses.${r.status}`)}</Badge></Td>
                <Td>{mayApprove && r.status === "PENDING" && r.createdById !== ctx.user.id && (
                  <div className="flex gap-1">
                    <ActionForm action={decideRateAction} className="space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="APPROVED" /><SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("currency.approve")}</SubmitButton></ActionForm>
                    <ActionForm action={decideRateAction} className="space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="REJECTED" /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{t("currency.reject")}</SubmitButton></ActionForm>
                  </div>
                )}</Td>
              </tr>
            ))}
          </Table>
        )}
        {pages > 1 && <p className="mt-3 flex gap-3 text-sm">{page > 1 && <TextLink href={qs({ page: String(page - 1) })}>{t("common.previous")}</TextLink>}<span>{t("common.pageOf", { page, pages })}</span>{page < pages && <TextLink href={qs({ page: String(page + 1) })}>{t("common.next")}</TextLink>}</p>}
      </Card>

      {can(ctx.access, "currency.create", companyId) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t("currency.addTitle")}>
            <ActionForm action={createRateAction} resetOnSuccess>
              <input type="hidden" name="baseCurrency" value={admin.baseCurrency} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("common.date")} name="effectiveDate"><Input type="date" name="effectiveDate" defaultValue={today} required /></Field>
                <Field label={t("ledger.currency")} name="currency"><Select name="currency" defaultValue="USD">{["USD", "EUR", "GBP", "CNY", "BRL"].filter((c) => c !== admin.baseCurrency).map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label={t("currency.rateType")} name="rateType"><Select name="rateType" defaultValue="CBVS_SELL">{RATE_TYPES.map((r) => <option key={r} value={r}>{t(`currency.types.${r}`)}</option>)}</Select></Field>
                <Field label={t("currency.rateIn", { base: admin.baseCurrency })} name="rate"><Input name="rate" inputMode="decimal" required /></Field>
                <Field label={t("currency.reference")} name="reference" className="sm:col-span-2"><Input name="reference" placeholder={t("currency.referencePlaceholder")} /></Field>
              </div>
              <SubmitButton>{t("currency.add")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("currency.importTitle")} description={t("currency.importIntro")}>
            <ActionForm action={importCbvsAction} resetOnSuccess dataLabels={{ summary: t("currency.importSummary") }}>
              <input type="hidden" name="baseCurrency" value={admin.baseCurrency} />
              <Field label={t("industry.file")} name="file"><Input type="file" name="file" accept=".csv,.txt,text/csv" required /></Field>
              <pre className="rounded bg-muted p-2 text-xs">datum;valuta;aankoop;verkoop{"\n"}03-11-2026;USD;37,8500;38,1500</pre>
              <SubmitButton variant="secondary">{t("industry.import")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title={t("currency.policyTitle")} description={t("currency.policyIntro")} className="mt-6">
        <ActionForm action={savePolicyAction}>
          <input type="hidden" name="administrationId" value={admin.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            {(["sales", "purchase", "revaluation"] as const).map((k) => (
              <Field key={k} label={t(`currency.policy.${k}`)} name={k}>
                <Select name={k} defaultValue={data.policy[k]}>{RATE_TYPES.map((r) => <option key={r} value={r}>{t(`currency.types.${r}`)}</option>)}</Select>
              </Field>
            ))}
            <Field label={t("currency.policy.maxAgeDays")} name="maxAgeDays"><Input type="number" name="maxAgeDays" min={0} max={31} defaultValue={data.policy.maxAgeDays} /></Field>
            <Field label={t("currency.policy.revaluationMode")} name="revaluationMode">
              <Select name="revaluationMode" defaultValue={data.policy.revaluationMode}><option value="AUTO_REVERSE">{t("currency.modes.AUTO_REVERSE")}</option><option value="CUMULATIVE">{t("currency.modes.CUMULATIVE")}</option></Select>
            </Field>
            <Field label={t("currency.policy.monetaryAccounts")} name="monetaryAccounts" hint={t("currency.policy.monetaryAccountsHint")}><Input name="monetaryAccounts" defaultValue={data.policy.monetaryAccounts.join(", ")} /></Field>
            <div className="sm:col-span-3"><Checkbox name="requireApproved" label={t("currency.policy.requireApproved")} defaultChecked={data.policy.requireApproved} /></div>
          </div>
          {can(ctx.access, "administrations.manageSettings", companyId) && <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>}
        </ActionForm>
      </Card>

      <Card title={t("currency.revaluationTitle")} description={t("currency.revaluationIntro")} className="mt-6">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1"><span className="block text-muted-foreground">{t("periods.period")}</span>
            <select name="period" defaultValue={sp.period ?? ""} className="h-9 rounded-md border border-border bg-background px-2"><option value="">—</option>{data.periods.map((p) => <option key={p.id} value={p.id}>{p.number} · {date(p.endDate)}</option>)}</select>
          </label>
          <button className="h-9 rounded-md border border-border px-3">{t("currency.preview")}</button>
        </form>
        {data.preview && (
          <div className="mt-4 space-y-3">
            {data.preview.missing.length > 0 && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t("currency.missingRates", { currencies: data.preview.missing.join(", "), type: t(`currency.types.${data.preview.policy.revaluation}`), date: data.preview.date })}</p>}
            {data.preview.lines.length === 0 ? <p className="text-sm text-muted-foreground">{t("currency.nothingToRevalue")}</p> : (
              <Table head={[t("ledger.account"), t("ledger.currency"), t("currency.balanceTx"), t("currency.carrying"), t("currency.rate"), t("currency.revalued"), t("ledger.difference")]}>
                {data.preview.lines.map((l) => (
                  <tr key={`${l.accountId}${l.currency}`}>
                    <Td>{l.number} · {l.name}</Td>
                    <Td>{l.currency}</Td>
                    <Td className="amount text-right">{formatAmount(l.tx, l.currency, locale)}</Td>
                    <Td className="amount text-right">{base(l.base)}</Td>
                    <Td className="amount text-right">{formatRate(l.rate, locale)}</Td>
                    <Td className="amount text-right">{base(l.revalued)}</Td>
                    <Td className="amount text-right font-medium">{base(l.difference)}</Td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-medium"><Td colSpan={6}>{t("common.total")}</Td><Td className="amount text-right">{base(data.preview.total)}</Td></tr>
              </Table>
            )}
            {can(ctx.access, "currency.create", companyId) && data.preview.lines.length > 0 && data.preview.missing.length === 0 && (
              <ActionForm action={proposeRevaluationAction}>
                <input type="hidden" name="administrationId" value={admin.id} />
                <input type="hidden" name="periodId" value={data.preview.period.id} />
                <SubmitButton>{t("currency.propose")}</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
        {data.revaluations.length > 0 && (
          <div className="mt-6">
            <Table head={[t("common.date"), t("common.amount"), t("common.status"), t("currency.entries"), ""]}>
              {data.revaluations.map((r) => {
                const lines = r.lines as { difference: string }[];
                const total = lines.reduce((s, l) => s.plus(l.difference), new Decimal(0));
                return (
                  <tr key={r.id}>
                    <Td>{date(r.revaluationDate)}</Td>
                    <Td className="amount text-right">{base(total)}</Td>
                    <Td><Badge tone={revTone[r.status]}>{t(`currency.revStatuses.${r.status}`)}</Badge></Td>
                    <Td className="space-x-2 text-sm">
                      {r.entryId && <TextLink href={`/app/ledger/entries/${r.entryId}`}>{t("currency.entry")}</TextLink>}
                      {r.reversalEntryId && <TextLink href={`/app/ledger/entries/${r.reversalEntryId}`}>{t("currency.reversal")}</TextLink>}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.status === "PROPOSED" && <ActionForm action={revaluationStepAction} className="space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="post" /><SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("currency.post")}</SubmitButton></ActionForm>}
                        {r.status === "PROPOSED" && <ActionForm action={revaluationStepAction} className="space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="cancel" /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{t("assets.cancelProposal")}</SubmitButton></ActionForm>}
                        {r.status === "POSTED" && !r.reversalEntryId && data.policy.revaluationMode === "AUTO_REVERSE" && <ActionForm action={revaluationStepAction} className="space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="completeReversal" /><SubmitButton variant="secondary" className="h-7 px-2 text-xs">{t("currency.completeReversal")}</SubmitButton></ActionForm>}
                        {r.status === "POSTED" && !r.reversalEntryId && <ActionForm action={revaluationStepAction} className="flex gap-1 space-y-0"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="step" value="reverse" /><Input name="reason" placeholder={t("periods.reasonPlaceholder")} className="h-7 w-32 text-xs" aria-label={t("periods.reason")} /><SubmitButton variant="ghost" className="h-7 px-2 text-xs">{t("currency.recalculate")}</SubmitButton></ActionForm>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
