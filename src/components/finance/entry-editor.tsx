"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { formatAmount } from "@/lib/format";
import Decimal from "decimal.js";
import { Plus, Trash2, AlertCircle, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/components/ui/cn";

export interface EditorAccount { id: string; number: string; name: string; currency: string | null }
export interface EditorJournal { id: string; code: string; name: string; type: string; requiresApproval: boolean }
export interface EditorDimension { id: string; code: string; name: string; type: "COST_CENTER" | "PROJECT" | "DEPARTMENT" }
export interface EditorLine { accountId: string; description: string; debit: string; credit: string; currency: string; rate: string; costCenterId: string; projectId: string; departmentId: string }
export interface EditorInitial { entryId?: string; journalId: string; entryDate: string; documentDate: string; description: string; reference: string; lines: EditorLine[] }

const emptyLine = (currency: string): EditorLine => ({ accountId: "", description: "", debit: "", credit: "", currency, rate: "", costCenterId: "", projectId: "", departmentId: "" });

function dec(v: string): Decimal {
  const s = v.trim().replace(",", ".");
  if (!s) return new Decimal(0);
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function SaveButtons({ canPost }: { canPost: boolean }) {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="intent" value="draft" disabled={pending} className={buttonClass("secondary")}>
        {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {t("ledger.saveDraft")}
      </button>
      {canPost && (
        <button type="submit" name="intent" value="post" disabled={pending} className={buttonClass("primary")}>
          {t("ledger.saveAndPost")}
        </button>
      )}
    </div>
  );
}

export function EntryEditor({
  action, administrationId, baseCurrency, journals, accounts, dimensions, initial, canPost, currencies,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  administrationId: string;
  baseCurrency: string;
  journals: EditorJournal[];
  accounts: EditorAccount[];
  dimensions: EditorDimension[];
  initial: EditorInitial;
  canPost: boolean;
  currencies: string[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction] = useActionState(action, null);
  const [header, setHeader] = useState({ journalId: initial.journalId, entryDate: initial.entryDate, documentDate: initial.documentDate, description: initial.description, reference: initial.reference });
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [emptyLine(baseCurrency), emptyLine(baseCurrency)]);
  const [idempotencyKey] = useState(() => (initial.entryId ? undefined : crypto.randomUUID()));

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const dimsOf = (type: EditorDimension["type"]) => dimensions.filter((d) => d.type === type);
  const journal = journals.find((j) => j.id === header.journalId);

  const base = (l: EditorLine) => {
    const amt = dec(l.debit).plus(dec(l.credit));
    if (l.currency === baseCurrency) return amt;
    return amt.times(dec(l.rate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  };
  const totalDebit = lines.reduce((s, l) => (dec(l.debit).gt(0) ? s.plus(base(l)) : s), new Decimal(0));
  const totalCredit = lines.reduce((s, l) => (dec(l.credit).gt(0) ? s.plus(base(l)) : s), new Decimal(0));
  const diff = totalDebit.minus(totalCredit);
  const fmt = (d: Decimal) => formatAmount(d.toFixed(2), "", locale).trim();

  const update = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = JSON.stringify({
    entryId: initial.entryId, administrationId, ...header, idempotencyKey,
    lines: lines.filter((l) => l.accountId || l.debit || l.credit).map((l) => ({ ...l, currency: l.currency === baseCurrency ? "" : l.currency })),
  });
  const err = (field: string) => state?.errors?.[field]?.[0];
  const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

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
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("ledger.journal")}</span>
          <select className={input} value={header.journalId} onChange={(e) => setHeader({ ...header, journalId: e.target.value })} aria-label={t("ledger.journal")}>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.name}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("ledger.entryDate")}</span>
          <input type="date" className={input} value={header.entryDate} onChange={(e) => setHeader({ ...header, entryDate: e.target.value })} aria-label={t("ledger.entryDate")} />
          {err("entryDate") && <span className="block text-xs text-danger">{err("entryDate")}</span>}
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("ledger.documentDate")}</span>
          <input type="date" className={input} value={header.documentDate} onChange={(e) => setHeader({ ...header, documentDate: e.target.value })} aria-label={t("ledger.documentDate")} />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("ledger.reference")}</span>
          <input className={input} value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.target.value })} aria-label={t("ledger.reference")} />
        </label>
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2 lg:col-span-4">
          <span>{t("ledger.description")}</span>
          <input className={input} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} aria-label={t("ledger.description")} />
          {err("description") && <span className="block text-xs text-danger">{err("description")}</span>}
        </label>
      </div>
      {journal?.requiresApproval && <p className="text-xs text-muted-foreground">{t("ledger.journalNeedsApproval")}</p>}

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 pl-5 font-medium">{t("ledger.account")}</th>
              <th className="px-2 py-2 font-medium">{t("ledger.lineDescription")}</th>
              <th className="px-2 py-2 font-medium">{t("ledger.currency")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("ledger.debit")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("ledger.credit")}</th>
              {dimensions.length > 0 && <th className="px-2 py-2 font-medium">{t("ledger.dimensions")}</th>}
              <th className="px-2 py-2 pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l, i) => {
              const acc = accountById.get(l.accountId);
              return (
                <tr key={i} className="align-top">
                  <td className="px-2 py-2 pl-5">
                    <select className={cn(input, "min-w-56")} value={l.accountId} aria-label={`${t("ledger.account")} ${i + 1}`}
                      onChange={(e) => {
                        const a = accountById.get(e.target.value);
                        update(i, { accountId: e.target.value, currency: a?.currency ?? (l.currency || baseCurrency) });
                      }}>
                      <option value="">—</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2"><input className={input} value={l.description} onChange={(e) => update(i, { description: e.target.value })} aria-label={`${t("ledger.lineDescription")} ${i + 1}`} /></td>
                  <td className="px-2 py-2">
                    <select className={cn(input, "w-24 min-w-24")} value={l.currency} disabled={!!acc?.currency} aria-label={`${t("ledger.currency")} ${i + 1}`} onChange={(e) => update(i, { currency: e.target.value })}>
                      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {l.currency !== baseCurrency && (
                      <input className={cn(input, "mt-1 w-24 text-right")} placeholder={t("ledger.rate")} value={l.rate} inputMode="decimal" aria-label={`${t("ledger.rate")} ${i + 1}`} onChange={(e) => update(i, { rate: e.target.value })} />
                    )}
                  </td>
                  <td className="px-2 py-2"><input className={cn(input, "amount w-32 text-right")} inputMode="decimal" value={l.debit} aria-label={`${t("ledger.debit")} ${i + 1}`} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                  <td className="px-2 py-2"><input className={cn(input, "amount w-32 text-right")} inputMode="decimal" value={l.credit} aria-label={`${t("ledger.credit")} ${i + 1}`} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                  {dimensions.length > 0 && (
                    <td className="space-y-1 px-2 py-2">
                      {(["COST_CENTER", "PROJECT", "DEPARTMENT"] as const).map((type) => {
                        const opts = dimsOf(type);
                        if (!opts.length) return null;
                        const key = type === "COST_CENTER" ? "costCenterId" : type === "PROJECT" ? "projectId" : "departmentId";
                        return (
                          <select key={type} className={cn(input, "w-40")} value={l[key]} aria-label={t(`ledger.dimensionTypes.${type}`)} onChange={(e) => update(i, { [key]: e.target.value })}>
                            <option value="">{t(`ledger.dimensionTypes.${type}`)}</option>
                            {opts.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
                          </select>
                        );
                      })}
                    </td>
                  )}
                  <td className="px-2 py-2 pr-5">
                    <button type="button" className={buttonClass("ghost", "sm")} aria-label={t("ledger.removeLine")} disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-medium">
              <td className="px-2 py-2 pl-5" colSpan={3}>
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setLines((ls) => [...ls, emptyLine(baseCurrency)])}>
                  <Plus aria-hidden className="size-4" /> {t("ledger.addLine")}
                </button>
              </td>
              <td className="amount px-2 py-2 text-right">{baseCurrency} {fmt(totalDebit)}</td>
              <td className="amount px-2 py-2 text-right">{baseCurrency} {fmt(totalCredit)}</td>
              <td colSpan={dimensions.length > 0 ? 2 : 1} />
            </tr>
            <tr>
              <td className="px-2 pb-2 pl-5 text-sm" colSpan={6}>
                {diff.isZero() && totalDebit.gt(0) ? (
                  <span className="text-accent">{t("ledger.balancedOk")}</span>
                ) : (
                  <span className="text-danger">{t("ledger.difference", { amount: `${baseCurrency} ${fmt(diff.abs())}` })}</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <SaveButtons canPost={canPost && !journal?.requiresApproval} />
    </form>
  );
}
