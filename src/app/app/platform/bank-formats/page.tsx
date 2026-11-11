import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { BankFormat } from "@prisma/client";
import { requireApp } from "@/core/auth/context";
import { systemDb } from "@/core/db/client";
import { CANDIDATE_BANKS, type SampleSummary } from "@/modules/banking/formats";
import type { ImportProfile } from "@/modules/banking/csv-import";
import { retireBankFormatAction, saveBankFormatAction, validateBankFormatAction } from "@/actions/platform";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";
import { PlatformTabs } from "@/components/platform/tabs";

/**
 * Bank statement format library. A format is "validated" only after a real export from that bank matched the bank's own
 * statement (line count and totals). Until then no compatibility is claimed.
 */
export default async function BankFormatsPage() {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp();
  if (!ctx.user.isPlatformAdmin) notFound();
  const formats = await systemDb.bankFormat.findMany({ orderBy: [{ bankName: "asc" }, { formatName: "asc" }] });
  const tone = (s: BankFormat["status"]) => (s === "VALIDATED" ? "success" : s === "DRAFT" ? "warning" : "neutral") as "success" | "warning" | "neutral";
  const col = (name: keyof ImportProfile, label: string, v?: number) => <Field label={label} name={name}><Input type="number" min={0} max={50} name={name} defaultValue={v ?? ""} /></Field>;

  const formatForm = (f?: BankFormat) => {
    const p = (f?.profile ?? {}) as Partial<ImportProfile>;
    return (
      <ActionForm action={saveBankFormatAction} resetOnSuccess={!f}>
        {f && <input type="hidden" name="id" value={f.id} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("bankFormats.bank")} name="bankName"><Input name="bankName" list="candidate-banks" defaultValue={f?.bankName} required /></Field>
          <Field label={t("bankFormats.formatName")} name="formatName" hint={t("bankFormats.formatNameHint")}><Input name="formatName" defaultValue={f?.formatName} required /></Field>
          <Field label={t("bankFormats.delimiter")} name="delimiter"><Select name="delimiter" defaultValue={p.delimiter === "\t" ? "tab" : (p.delimiter ?? ";")}><option value=";">;</option><option value=",">,</option><option value="tab">Tab</option></Select></Field>
          <Field label={t("bankFormats.dateFormat")} name="dateFormat"><Select name="dateFormat" defaultValue={p.dateFormat ?? "DD-MM-YYYY"}>{["DD-MM-YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "MM/DD/YYYY"].map((d) => <option key={d}>{d}</option>)}</Select></Field>
          <Field label={t("bankFormats.decimalSeparator")} name="decimalSeparator"><Select name="decimalSeparator" defaultValue={p.decimalSeparator ?? ","}><option value=",">, (1.234,56)</option><option value=".">. (1,234.56)</option></Select></Field>
          <div className="flex items-end pb-2"><Checkbox name="hasHeader" label={t("bankFormats.hasHeader")} defaultChecked={p.hasHeader ?? true} /></div>
          {col("dateColumn", t("bankFormats.cols.date"), p.dateColumn)}
          {col("descriptionColumn", t("bankFormats.cols.description"), p.descriptionColumn)}
          {col("amountColumn", t("bankFormats.cols.amount"), p.amountColumn)}
          {col("debitColumn", t("bankFormats.cols.debit"), p.debitColumn)}
          {col("creditColumn", t("bankFormats.cols.credit"), p.creditColumn)}
          {col("counterpartyColumn", t("bankFormats.cols.counterparty"), p.counterpartyColumn)}
          {col("counterpartyAccountColumn", t("bankFormats.cols.counterpartyAccount"), p.counterpartyAccountColumn)}
          {col("referenceColumn", t("bankFormats.cols.reference"), p.referenceColumn)}
          <Field label={t("common.notes")} name="notes" className="sm:col-span-3"><Textarea name="notes" rows={2} defaultValue={f?.notes ?? ""} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("bankFormats.columnsHint")}</p>
        <SubmitButton>{f ? t("common.save") : t("bankFormats.add")}</SubmitButton>
      </ActionForm>
    );
  };

  return (
    <>
      <PageHeader title={t("platform.title")} description={t("bankFormats.intro")} />
      <PlatformTabs active="bankFormats" />
      <datalist id="candidate-banks">{CANDIDATE_BANKS.map((b) => <option key={b} value={b} />)}</datalist>
      <div role="note" className="mb-6 rounded-lg border border-border bg-surface p-4 text-sm">{t("bankFormats.policy")}</div>

      <Card title={t("bankFormats.coverageTitle")} description={t("bankFormats.coverageIntro")}>
        <Table head={[t("bankFormats.bank"), t("common.status")]}>
          {CANDIDATE_BANKS.map((b) => {
            const own = formats.filter((f) => f.bankName === b);
            const best = own.find((f) => f.status === "VALIDATED") ?? own.find((f) => f.status === "DRAFT");
            return <tr key={b}><Td>{b}</Td><Td>{best ? <Badge tone={tone(best.status)}>{t(`bankFormats.statuses.${best.status}`)}</Badge> : <Badge tone="neutral">{t("bankFormats.noSample")}</Badge>}</Td></tr>;
          })}
        </Table>
      </Card>

      <Card title={t("bankFormats.libraryTitle")} className="mt-6">
        {formats.length > 0 && (
          <Table head={[t("bankFormats.bank"), t("bankFormats.formatName"), t("common.status"), t("bankFormats.evidence"), ""]}>
            {formats.map((f) => {
              const s = f.sampleSummary as SampleSummary | null;
              return (
                <tr key={f.id}>
                  <Td>{f.bankName}</Td><Td>{f.formatName}</Td>
                  <Td><Badge tone={tone(f.status)}>{t(`bankFormats.statuses.${f.status}`)}</Badge></Td>
                  <Td className="text-xs">{s && f.validatedAt ? <>{t("bankFormats.evidenceLine", { count: s.lineCount, from: s.dateFrom, to: s.dateTo })} · {format.dateTime(f.validatedAt, { dateStyle: "short" })}<span className="block font-mono">{f.sampleSha256?.slice(0, 16)}…</span></> : "—"}</Td>
                  <Td>
                    {f.status !== "RETIRED" && (
                      <details>
                        <summary className="cursor-pointer text-sm text-accent">{t("bankFormats.manage")}</summary>
                        <div className="mt-3 min-w-[30rem] space-y-6">
                          <section>
                            <h3 className="text-sm font-semibold">{t("bankFormats.validateTitle")}</h3>
                            <p className="text-xs text-muted-foreground">{t("bankFormats.validateIntro")}</p>
                            <ActionForm action={validateBankFormatAction}>
                              <input type="hidden" name="formatId" value={f.id} />
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Field label={t("bankFormats.sampleFile")} name="file" className="sm:col-span-3"><Input type="file" name="file" accept=".csv,.txt,text/csv" required /></Field>
                                <Field label={t("bankFormats.expectedLineCount")} name="expectedLineCount"><Input type="number" min={1} name="expectedLineCount" required /></Field>
                                <Field label={t("bankFormats.expectedTotalIn")} name="expectedTotalIn"><Input name="expectedTotalIn" inputMode="decimal" required /></Field>
                                <Field label={t("bankFormats.expectedTotalOut")} name="expectedTotalOut"><Input name="expectedTotalOut" inputMode="decimal" required /></Field>
                              </div>
                              <Checkbox name="confirmRealSample" label={t("bankFormats.confirmRealSample")} />
                              <SubmitButton>{t("bankFormats.validate")}</SubmitButton>
                            </ActionForm>
                          </section>
                          <section><h3 className="text-sm font-semibold">{t("bankFormats.editTitle")}</h3>{formatForm(f)}</section>
                          <ActionForm action={retireBankFormatAction}><input type="hidden" name="formatId" value={f.id} /><SubmitButton variant="ghost">{t("bankFormats.retire")}</SubmitButton></ActionForm>
                        </div>
                      </details>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        <details className="mt-4" open={formats.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-accent">{t("bankFormats.add")}</summary>
          <div className="mt-3">{formatForm()}</div>
        </details>
      </Card>
    </>
  );
}
