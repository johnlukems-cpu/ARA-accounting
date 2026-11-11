import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { adjustmentAction, approveReturnAction, fileReturnAction } from "@/actions/tax";
import { formatAmount } from "@/lib/format";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge, Card, Dl, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

type BtwCalc = { lines: { taxCodeId: string; code: string; name: string; reportBox: string | null; direction: string; base: string; tax: string }[]; output: string; input: string; payable: string; reconciliation: { ledgerOutput: string; ledgerInput: string; differenceOutput: string; differenceInput: string } };
type IbCalc = { commercialResult: string; adjustments: string; taxableProfit: string; loss: string; rate: string; tax: string; prepaid: string; payable: string };
type DivCalc = { gross: string; rate: string; tax: string; net: string };

export default async function TaxReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const data = await withTenant(ctx.access, async (tx) => {
    const ret = await tx.taxReturn.findUnique({ where: { id }, include: { adjustments: { orderBy: { createdAt: "asc" } } } });
    if (!ret) return null;
    return { ret, admin: await tx.administration.findUniqueOrThrow({ where: { id: ret.administrationId } }), rule: await tx.taxRuleVersion.findUniqueOrThrow({ where: { id: ret.ruleVersionId } }) };
  });
  if (!data || !can(ctx.access, "tax.view", data.admin.companyId)) notFound();
  const { ret, admin, rule } = data;
  const money = (v: string) => formatAmount(v, admin.baseCurrency, locale);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const companyId = admin.companyId;
  const draft = ret.status === "DRAFT";
  const unverified = rule.legalStatus !== "VERIFIED";
  const btw = ret.taxType === "BTW" ? (ret.calculation as BtwCalc) : null;
  const ib = ret.taxType === "IB_RECHTSPERSONEN" ? (ret.calculation as IbCalc) : null;
  const div = ret.taxType === "DIVIDENDBELASTING" ? (ret.calculation as DivCalc) : null;
  const hasDifference = !!btw && (btw.reconciliation.differenceOutput !== "0.00" || btw.reconciliation.differenceInput !== "0.00");

  return (
    <>
      <PageHeader title={`${t(`tax.types.${ret.taxType}`)} · ${date(ret.periodFrom)}${ret.periodFrom.getTime() !== ret.periodTo.getTime() ? ` – ${date(ret.periodTo)}` : ""}`}
        description={`${t("tax.rule")}: ${date(rule.effectiveFrom)} · ${rule.legalSource ?? ""}`}
        actions={<div className="flex gap-2"><Badge tone={unverified ? "warning" : "success"}>{t(`tax.legal.${rule.legalStatus}`)}</Badge><Badge tone={ret.status === "FILED" ? "success" : ret.status === "APPROVED" ? "info" : "warning"}>{t(`tax.statuses.${ret.status}`)}</Badge></div>} />
      {unverified && <div role="note" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{t("tax.unverifiedWarning")} {rule.notes}</div>}

      {btw && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={t("tax.btwLines")} className="lg:col-span-2">
            <Table head={[t("tax.direction"), t("invoicing.taxCode"), t("tax.box"), t("tax.base"), t("tax.amount")]}>
              {btw.lines.map((l) => <tr key={`${l.direction}${l.taxCodeId}`}><Td>{t(`tax.directions.${l.direction}`)}</Td><Td>{l.code} · {l.name}</Td><Td>{l.reportBox ?? "—"}</Td><Td className="amount text-right">{money(l.base)}</Td><Td className="amount text-right">{money(l.tax)}</Td></tr>)}
              <tr className="border-t-2 border-border font-semibold"><Td colSpan={4}>{t("tax.outputTotal")}</Td><Td className="amount text-right">{money(btw.output)}</Td></tr>
              <tr className="font-semibold"><Td colSpan={4}>{t("tax.inputTotal")}</Td><Td className="amount text-right">{money(btw.input)}</Td></tr>
              <tr className="font-semibold"><Td colSpan={4}>{Number(btw.payable) >= 0 ? t("tax.toPay") : t("tax.toReceive")}</Td><Td className="amount text-right">{money(btw.payable.replace("-", ""))}</Td></tr>
            </Table>
          </Card>
          <Card title={t("tax.reconciliation")}>
            <Dl items={[[t("tax.ledgerOutput"), money(btw.reconciliation.ledgerOutput)], [t("tax.differenceOutput"), money(btw.reconciliation.differenceOutput)], [t("tax.ledgerInput"), money(btw.reconciliation.ledgerInput)], [t("tax.differenceInput"), money(btw.reconciliation.differenceInput)]]} />
            <p className="mt-2">{hasDifference ? <Badge tone="warning">{t("tax.differenceFound")}</Badge> : <Badge tone="success">{t("tax.reconciled")}</Badge>}</p>
          </Card>
        </div>
      )}

      {ib && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t("tax.ibCalculation")}>
            <Dl items={[[t("tax.commercialResult"), money(ib.commercialResult)], [t("tax.fiscalAdjustments"), money(ib.adjustments)], [t("tax.taxableProfit"), money(ib.taxableProfit)], [t("tax.rate"), `${ib.rate}%`], [t("tax.taxDue"), money(ib.tax)], [t("tax.prepaid"), money(ib.prepaid)], [Number(ib.payable) >= 0 ? t("tax.toPay") : t("tax.toReceive"), money(ib.payable.replace("-", ""))], ...(ib.loss !== "0.00" ? [[t("tax.loss"), money(ib.loss)] as [string, string]] : [])]} />
          </Card>
          <Card title={t("tax.fiscalAdjustments")}>
            {ret.adjustments.length > 0 && <Table head={[t("tax.adjustmentKind"), t("ledger.description"), t("tax.amount")]}>{ret.adjustments.map((a) => <tr key={a.id}><Td>{t(`tax.adjustmentKinds.${a.kind}`)}</Td><Td>{a.description}</Td><Td className="amount text-right">{money(a.amount.toString())}</Td></tr>)}</Table>}
            {draft && can(ctx.access, "tax.edit", companyId) && (
              <ActionForm action={adjustmentAction} resetOnSuccess className="mt-4">
                <input type="hidden" name="returnId" value={ret.id} /><input type="hidden" name="locale" value={locale} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("tax.adjustmentKind")} name="kind"><Select name="kind" defaultValue="NON_DEDUCTIBLE">{["NON_DEDUCTIBLE", "EXEMPT_INCOME", "DEPRECIATION_DIFFERENCE", "LOSS_OFFSET", "OTHER"].map((k) => <option key={k} value={k}>{t(`tax.adjustmentKinds.${k}`)}</option>)}</Select></Field>
                  <Field label={t("ledger.description")} name="description"><Input name="description" required /></Field>
                  <Field label={t("tax.amount")} name="amount" hint={t("tax.adjustmentHint")}><Input name="amount" inputMode="decimal" required /></Field>
                </div>
                <SubmitButton variant="secondary">{t("tax.addAdjustment")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      )}

      {div && <Card title={t("tax.dividendCalculation")}><Dl items={[[t("tax.grossDividend"), money(div.gross)], [t("tax.rate"), `${div.rate}%`], [t("tax.withheld"), money(div.tax)], [t("tax.netDividend"), money(div.net)]]} /></Card>}

      <Card title={t("tax.workflow")} className="mt-6">
        <div className="space-y-1 text-sm">
          {ret.entryId && <p><TextLink href={`/app/ledger/entries/${ret.entryId}`}>{t("tax.settlementEntry")}</TextLink></p>}
          {ret.explanation && <p>{t("tax.explanation")}: {ret.explanation}</p>}
          {ret.evidenceDocumentId && <p><a className="text-accent underline" href={`/api/documents/${ret.evidenceDocumentId}/file`} target="_blank" rel="noopener">{t("tax.evidence")}</a>{ret.filingReference ? ` · ${ret.filingReference}` : ""}</p>}
        </div>
        {draft && can(ctx.access, "tax.approve", companyId) && ret.createdById !== ctx.user.id && (
          <ActionForm action={approveReturnAction} className="mt-4">
            <input type="hidden" name="returnId" value={ret.id} />
            {unverified && <Checkbox name="acknowledge" label={t("tax.acknowledge")} />}
            {hasDifference && <Field label={t("tax.explanation")} name="explanation" hint={t("tax.explanationHint")}><Textarea name="explanation" rows={2} /></Field>}
            <SubmitButton>{t("tax.approve")}</SubmitButton>
          </ActionForm>
        )}
        {draft && ret.createdById === ctx.user.id && <p className="mt-3 text-xs text-muted-foreground">{t("tax.otherApprover")}</p>}
        {ret.status === "APPROVED" && can(ctx.access, "tax.edit", companyId) && (
          <ActionForm action={fileReturnAction} className="mt-4">
            <input type="hidden" name="returnId" value={ret.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("tax.evidenceFile")} name="file" hint={t("tax.evidenceHint")}><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required /></Field>
              <Field label={t("tax.reference")} name="reference"><Input name="reference" /></Field>
            </div>
            <Checkbox name="confirm" label={t("tax.confirm")} />
            <SubmitButton>{t("tax.markFiled")}</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
