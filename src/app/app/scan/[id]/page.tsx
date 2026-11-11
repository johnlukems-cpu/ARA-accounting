import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Decimal from "decimal.js";
import { requireApp } from "@/core/auth/context";
import { can } from "@/core/auth/access";
import { withTenant } from "@/core/tenancy/tenant";
import { FIELD_KEYS, type Fields } from "@/modules/scan/domain";
import { suggestionsFor } from "@/modules/scan/service";
import { confirmDocumentAction, rejectDocumentAction } from "@/actions/scan";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { Badge, Card, PageHeader, Table, Td, TextLink } from "@/components/ui/misc";

const conf = (c: number) => (c >= 0.9 ? "success" : c >= 0.7 ? "info" : "warning") as "success" | "info" | "warning";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const ctx = await requireApp();
  const data = await withTenant(ctx.access, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) return null;
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: doc.administrationId } });
    return {
      admin,
      s: await suggestionsFor(tx, id),
      extractions: await tx.documentExtraction.findMany({ where: { documentId: id }, orderBy: { createdAt: "asc" } }),
      runs: await tx.automationExecution.findMany({ where: { documentId: id }, orderBy: { createdAt: "desc" } }),
      suppliers: await tx.party.findMany({ where: { administrationId: admin.id, isSupplier: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
      accounts: await tx.account.findMany({ where: { administrationId: admin.id, type: "DETAIL", status: "ACTIVE", category: { in: ["OPERATING_EXPENSE", "COST_OF_SALES", "ASSET", "FINANCIAL_EXPENSE"] }, controlType: { in: ["NONE"] } }, orderBy: { number: "asc" } }),
      taxCodes: await tx.taxCode.findMany({ where: { administrationId: admin.id, status: "ACTIVE", direction: { in: ["BOTH", "PURCHASE"] } }, orderBy: { code: "asc" } }),
    };
  });
  if (!data || !can(ctx.access, "scan.view", data.admin.companyId)) notFound();
  const { admin, s, extractions, runs, suppliers, accounts, taxCodes } = data;
  const doc = s.doc;
  const f = s.fields;
  const fileUrl = `/api/documents/${doc.id}/file`;
  const open = doc.status === "REVIEW_REQUIRED" && can(ctx.access, "scan.edit", admin.companyId);
  const taxRate = taxCodes.find((c) => c.id === s.taxCode?.taxCodeId)?.rate.toString() ?? "0";
  const net = f.netAmount.value ?? (f.grossAmount.value ? new Decimal(f.grossAmount.value).dividedBy(new Decimal(taxRate).dividedBy(100).plus(1)).toFixed(2) : "");
  const local = (v: string) => (locale === "en" ? v : v.replace(".", ","));
  const today = new Date().toISOString().slice(0, 10);
  const due = f.dueDate.value ?? (f.invoiceDate.value && s.supplier ? new Date(new Date(`${f.invoiceDate.value}T00:00:00Z`).getTime() + s.supplier.party.paymentTermDays * 86_400_000).toISOString().slice(0, 10) : today);
  const pct = (c: number) => `${Math.round(c * 100)}%`;

  return (
    <>
      <PageHeader title={doc.fileName} description={`${format.dateTime(doc.createdAt, { dateStyle: "medium", timeStyle: "short" })} · ${(doc.sizeBytes / 1024).toFixed(0)} kB`}
        actions={<Badge tone={doc.status === "PROCESSED" ? "success" : doc.status === "REJECTED" ? "neutral" : "warning"}>{t(`scan.statuses.${doc.status}`)}</Badge>} />

      {s.duplicate && (
        <div role="alert" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t(`scan.duplicate.${s.duplicate.reason}`)}{" "}
          {s.duplicate.documentId && <TextLink href={`/app/scan/${s.duplicate.documentId}`}>{t("scan.openOriginal")}</TextLink>}
          {s.duplicate.invoiceId && <TextLink href={`/app/purchase/${s.duplicate.invoiceId}`}>{t("scan.openInvoice")}</TextLink>}
        </div>
      )}
      {doc.invoiceId && <p className="mb-6 text-sm"><TextLink href={`/app/purchase/${doc.invoiceId}`}>{t("scan.openInvoice")}</TextLink></p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("scan.document")}>
          {doc.mimeType === "application/pdf"
            ? <p className="text-sm"><a className="text-accent underline" href={fileUrl} target="_blank" rel="noopener">{t("scan.openPdf")}</a>{doc.pageCount ? ` · ${doc.pageCount} p.` : ""}{!doc.textContent && <span className="block text-xs text-muted-foreground">{t("scan.noTextLayer")}</span>}</p>
            // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin file, not an optimisable asset
            : <img src={fileUrl} alt={doc.fileName} className="max-h-[36rem] w-full rounded border border-border object-contain" />}
          <h3 className="mb-2 mt-4 text-sm font-semibold">{t("scan.suggestions")}</h3>
          <Table head={[t("scan.field"), t("scan.value"), t("scan.confidence")]}>
            {FIELD_KEYS.map((k) => (
              <tr key={k}>
                <Td>{t(`scan.fields.${k}`)}</Td>
                <Td>{f[k].value ?? "—"}</Td>
                <Td>{f[k].value ? <Badge tone={conf(f[k].confidence)}>{pct(f[k].confidence)}</Badge> : null}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">{t("scan.sources")}: {extractions.map((e) => `${e.provider}${e.model ? ` (${e.model})` : ""}${e.error ? ` – ${t("scan.failed")}` : ""}`).join(", ") || "—"}</p>
          {runs[0] && <p className="mt-1 text-xs text-muted-foreground">{t("scan.automation")}: {t(`scan.outcomes.${runs[0].outcome}`)} {(runs[0].reasons as string[]).length ? `(${(runs[0].reasons as string[]).map((r) => t(`scan.reasons.${r.split(":")[0]}` as never)).join(", ")})` : ""}</p>}
        </Card>

        {open && (
          <Card title={t("scan.reviewTitle")} description={t("scan.reviewIntro")}>
            <ActionForm action={confirmDocumentAction}>
              <input type="hidden" name="documentId" value={doc.id} />
              <input type="hidden" name="locale" value={locale} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("invoicing.supplier")} name="partyId" className="sm:col-span-2" hint={s.supplier ? t("scan.suggestedWith", { pct: pct(s.supplier.confidence) }) : t("scan.noSupplierMatch")}>
                  <Select name="partyId" defaultValue={s.supplier?.party.id ?? ""}>{[<option key="" value="">—</option>, ...suppliers.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)]}</Select>
                </Field>
                <Field label={t("invoicing.supplierInvoiceNumber")} name="invoiceNumber"><Input name="invoiceNumber" defaultValue={f.invoiceNumber.value ?? ""} required /></Field>
                <Field label={t("ledger.currency")} name="currency"><Select name="currency" defaultValue={f.currency.value ?? s.supplier?.party.currency ?? admin.baseCurrency}>{["SRD", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label={t("invoicing.invoiceDate")} name="invoiceDate"><Input type="date" name="invoiceDate" defaultValue={f.invoiceDate.value ?? today} required /></Field>
                <Field label={t("invoicing.dueDate")} name="dueDate"><Input type="date" name="dueDate" defaultValue={due} required /></Field>
                <Field label={t("ledger.account")} name="accountId" className="sm:col-span-2" hint={s.account ? t(`scan.accountSource.${s.account.source}`, { pct: pct(s.account.confidence) }) : undefined}>
                  <Select name="accountId" defaultValue={s.account?.accountId ?? ""}>{[<option key="" value="">—</option>, ...accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)]}</Select>
                </Field>
                <Field label={t("invoicing.taxCode")} name="taxCodeId"><Select name="taxCodeId" defaultValue={s.taxCode?.taxCodeId ?? ""}>{[<option key="" value="">—</option>, ...taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)]}</Select></Field>
                <Field label={t("scan.netAmount")} name="netAmount" hint={f.grossAmount.value ? t("scan.grossOnDocument", { amount: local(f.grossAmount.value) }) : undefined}><Input name="netAmount" inputMode="decimal" defaultValue={net ? local(net) : ""} required /></Field>
                <Field label={t("invoicing.exchangeRate", { currency: "", base: admin.baseCurrency })} name="exchangeRate" hint={t("invoicing.rateHint")}><Input name="exchangeRate" inputMode="decimal" /></Field>
                <Field label={t("ledger.description")} name="description"><Input name="description" defaultValue={f.description.value ?? ""} /></Field>
                {s.duplicate && <div className="sm:col-span-2"><Checkbox name="acceptDuplicate" label={t("scan.acceptDuplicate")} /></div>}
              </div>
              <SubmitButton>{t("scan.createInvoice")}</SubmitButton>
            </ActionForm>
            <ActionForm action={rejectDocumentAction} className="mt-6 flex flex-wrap items-end gap-2 space-y-0 border-t border-border pt-4">
              <input type="hidden" name="documentId" value={doc.id} />
              <Field label={t("scan.rejectReason")} name="reason"><Input name="reason" /></Field>
              <SubmitButton variant="ghost">{t("scan.reject")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
        {doc.status === "REJECTED" && <Card title={t("scan.statuses.REJECTED")}><p className="text-sm">{doc.rejectReason}</p></Card>}
        {doc.confirmed && <Card title={t("scan.confirmedValues")}><pre className="overflow-x-auto text-xs">{JSON.stringify((doc.confirmed as { values?: unknown; fields?: Fields }).values ?? doc.confirmed, null, 2)}</pre></Card>}
      </div>
    </>
  );
}
