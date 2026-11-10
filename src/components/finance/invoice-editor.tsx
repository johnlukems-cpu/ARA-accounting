"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import Decimal from "decimal.js";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/components/ui/cn";
import { formatAmount } from "@/lib/format";

export interface EditorParty { id: string; name: string; code: string; currency: string; paymentTermDays: number; defaultAccountId: string | null; defaultTaxCodeId: string | null }
export interface EditorTaxCode { id: string; code: string; name: string; rate: string; legalStatus: string }
export interface InvoiceLineState { description: string; quantity: string; unitPrice: string; discountPct: string; accountId: string; taxCodeId: string; costCenterId: string; projectId: string }
export interface InvoiceInitial {
  id?: string; kind: "INVOICE" | "CREDIT_NOTE"; partyId: string; externalNumber: string; invoiceDate: string; dueDate: string; currency: string; exchangeRate: string;
  description: string; notes: string; creditsInvoiceId?: string; lines: InvoiceLineState[];
}

const dec = (v: string) => {
  try {
    const d = new Decimal(v.trim().replace(",", ".") || "0");
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function Buttons({ canPost, postLabel }: { canPost: boolean; postLabel: string }) {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="intent" value="draft" disabled={pending} className={buttonClass("secondary")}>
        {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {t("ledger.saveDraft")}
      </button>
      {canPost && <button type="submit" name="intent" value="post" disabled={pending} className={buttonClass("primary")}>{postLabel}</button>}
    </div>
  );
}

export function InvoiceEditor({
  action, type, administrationId, baseCurrency, parties, accounts, taxCodes, initial, canPost, currencies,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  type: "SALES" | "PURCHASE";
  administrationId: string;
  baseCurrency: string;
  parties: EditorParty[];
  accounts: { id: string; number: string; name: string }[];
  taxCodes: EditorTaxCode[];
  initial: InvoiceInitial;
  canPost: boolean;
  currencies: string[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction] = useActionState(action, null);
  const [h, setH] = useState({ ...initial });
  const [lines, setLines] = useState<InvoiceLineState[]>(initial.lines);
  const party = parties.find((p) => p.id === h.partyId);
  const newLine = (): InvoiceLineState => ({ description: "", quantity: "1", unitPrice: "", discountPct: "", accountId: party?.defaultAccountId ?? "", taxCodeId: party?.defaultTaxCodeId ?? "", costCenterId: "", projectId: "" });

  const rateOf = (id: string) => dec(taxCodes.find((c) => c.id === id)?.rate ?? "0");
  const calc = lines.map((l) => {
    const net = r2(dec(l.quantity).times(dec(l.unitPrice)).times(new Decimal(100).minus(dec(l.discountPct))).dividedBy(100));
    return { net, tax: r2(net.times(rateOf(l.taxCodeId)).dividedBy(100)) };
  });
  const net = calc.reduce((s, c) => s.plus(c.net), new Decimal(0));
  const tax = calc.reduce((s, c) => s.plus(c.tax), new Decimal(0));
  const fmt = (d: Decimal) => formatAmount(d.toFixed(2), h.currency, locale);
  const update = (i: number, patch: Partial<InvoiceLineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = JSON.stringify({ ...h, id: h.id, administrationId, type, exchangeRate: h.currency === baseCurrency ? "" : h.exchangeRate, lines });
  const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
  const pending = taxCodes.some((c) => lines.some((l) => l.taxCodeId === c.id) && c.legalStatus !== "VERIFIED");

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="payload" value={payload} />
      {state?.message && !state.ok && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
          <span>{t(type === "SALES" ? "invoicing.customer" : "invoicing.supplier")}</span>
          <select className={input} value={h.partyId} aria-label={t(type === "SALES" ? "invoicing.customer" : "invoicing.supplier")}
            onChange={(e) => {
              const p = parties.find((x) => x.id === e.target.value);
              setH({ ...h, partyId: e.target.value, currency: p?.currency ?? h.currency, dueDate: addDays(h.invoiceDate, p?.paymentTermDays ?? 30) });
              if (p) setLines((ls) => ls.map((l) => ({ ...l, accountId: l.accountId || p.defaultAccountId || "", taxCodeId: l.taxCodeId || p.defaultTaxCodeId || "" })));
            }}>
            <option value="">—</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </label>
        {type === "PURCHASE" && (
          <label className="space-y-1.5 text-sm font-medium">
            <span>{t("invoicing.supplierInvoiceNumber")}</span>
            <input className={input} value={h.externalNumber} onChange={(e) => setH({ ...h, externalNumber: e.target.value })} aria-label={t("invoicing.supplierInvoiceNumber")} />
          </label>
        )}
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("invoicing.invoiceDate")}</span>
          <input type="date" className={input} value={h.invoiceDate} aria-label={t("invoicing.invoiceDate")} onChange={(e) => setH({ ...h, invoiceDate: e.target.value, dueDate: addDays(e.target.value, party?.paymentTermDays ?? 30) })} />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("invoicing.dueDate")}</span>
          <input type="date" className={input} value={h.dueDate} aria-label={t("invoicing.dueDate")} onChange={(e) => setH({ ...h, dueDate: e.target.value })} />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("ledger.currency")}</span>
          <select className={input} value={h.currency} aria-label={t("ledger.currency")} onChange={(e) => setH({ ...h, currency: e.target.value })}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {h.currency !== baseCurrency && (
          <label className="space-y-1.5 text-sm font-medium">
            <span>{t("invoicing.exchangeRate", { currency: h.currency, base: baseCurrency })}</span>
            <input className={input} inputMode="decimal" value={h.exchangeRate} aria-label={t("ledger.rate")} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} />
          </label>
        )}
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
          <span>{t("invoicing.reference")}</span>
          <input className={input} value={h.description} aria-label={t("invoicing.reference")} onChange={(e) => setH({ ...h, description: e.target.value })} />
        </label>
      </div>

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[62rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 pl-5 font-medium">{t("ledger.description")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("invoicing.quantity")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("invoicing.unitPrice")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("invoicing.discountPct")}</th>
              <th className="px-2 py-2 font-medium">{t("invoicing.taxCode")}</th>
              <th className="px-2 py-2 font-medium">{t("ledger.account")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("invoicing.net")}</th>
              <th className="px-2 py-2 pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-2 pl-5"><input className={cn(input, "min-w-56")} value={l.description} aria-label={`${t("ledger.description")} ${i + 1}`} onChange={(e) => update(i, { description: e.target.value })} /></td>
                <td className="px-2 py-2"><input className={cn(input, "amount w-20 text-right")} inputMode="decimal" value={l.quantity} aria-label={`${t("invoicing.quantity")} ${i + 1}`} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                <td className="px-2 py-2"><input className={cn(input, "amount w-28 text-right")} inputMode="decimal" value={l.unitPrice} aria-label={`${t("invoicing.unitPrice")} ${i + 1}`} onChange={(e) => update(i, { unitPrice: e.target.value })} /></td>
                <td className="px-2 py-2"><input className={cn(input, "amount w-16 text-right")} inputMode="decimal" value={l.discountPct} aria-label={`${t("invoicing.discountPct")} ${i + 1}`} onChange={(e) => update(i, { discountPct: e.target.value })} /></td>
                <td className="px-2 py-2">
                  <select className={cn(input, "w-40")} value={l.taxCodeId} aria-label={`${t("invoicing.taxCode")} ${i + 1}`} onChange={(e) => update(i, { taxCodeId: e.target.value })}>
                    <option value="">—</option>
                    {taxCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {new Decimal(c.rate).toString()}%</option>)}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select className={cn(input, "w-56")} value={l.accountId} aria-label={`${t("ledger.account")} ${i + 1}`} onChange={(e) => update(i, { accountId: e.target.value })}>
                    <option value="">—</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
                  </select>
                </td>
                <td className="amount whitespace-nowrap px-2 py-2 text-right">{formatAmount(calc[i]!.net.toFixed(2), "", locale).trim()}</td>
                <td className="px-2 py-2 pr-5">
                  <button type="button" className={buttonClass("ghost", "sm")} aria-label={t("ledger.removeLine")} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setLines((ls) => [...ls, newLine()])}>
          <Plus aria-hidden className="size-4" /> {t("ledger.addLine")}
        </button>
        <dl className="amount min-w-64 space-y-1 text-sm">
          <div className="flex justify-between gap-6"><dt>{t("invoicing.totalNet")}</dt><dd>{fmt(net)}</dd></div>
          <div className="flex justify-between gap-6"><dt>{t("invoicing.totalTax")}</dt><dd>{fmt(tax)}</dd></div>
          <div className="flex justify-between gap-6 border-t border-border pt-1 text-base font-semibold"><dt>{t("invoicing.totalGross")}</dt><dd>{fmt(net.plus(tax))}</dd></div>
        </dl>
      </div>
      {pending && <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs">{t("invoicing.taxPendingVerification")}</p>}
      <label className="block space-y-1.5 text-sm font-medium">
        <span>{t("invoicing.notes")}</span>
        <textarea className={cn(input, "h-20 py-2")} value={h.notes} aria-label={t("invoicing.notes")} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </label>
      <Buttons canPost={canPost} postLabel={t("invoicing.saveAndPost")} />
    </form>
  );
}
