"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";

type Product = { id: string; name: string; price: string | null; taxCodeId: string | null };
type Line = { productId: string; description: string; quantity: string; unitPrice: string; discountPct: string; taxCodeId: string };

/** Quotation lines (client side). Totals are recalculated on the server, rounded per line exactly as invoices. */
export function QuoteLinesEditor({ products, taxCodes, initial }: { products: Product[]; taxCodes: { id: string; label: string }[]; initial: Line[] }) {
  const t = useTranslations("admin.quote");
  const [lines, setLines] = useState<Line[]>(initial.length ? initial : [{ productId: "", description: "", quantity: "1", unitPrice: "", discountPct: "", taxCodeId: "" }]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cell = "h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm";
  return (
    <div className="space-y-2">
      <input type="hidden" name="lineCount" value={lines.length} />
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-2 pl-5">{t("product")}</th><th className="px-2">{t("description")}</th><th className="w-20 px-2">{t("quantity")}</th><th className="w-28 px-2">{t("unitPrice")}</th><th className="w-20 px-2">{t("discount")}</th><th className="w-36 px-2">{t("tax")}</th><th className="w-10" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-1 pl-5">
                  <select name={`l${i}.productId`} aria-label={t("product")} className={cell} value={l.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); set(i, { productId: e.target.value, ...(p ? { description: l.description || p.name, unitPrice: l.unitPrice || (p.price ?? ""), taxCodeId: l.taxCodeId || (p.taxCodeId ?? "") } : {}) }); }}>
                    <option value="">{t("customLine")}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1"><input name={`l${i}.description`} aria-label={t("description")} className={cell} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td className="px-2 py-1"><input name={`l${i}.quantity`} aria-label={t("quantity")} inputMode="decimal" className={cell} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                <td className="px-2 py-1"><input name={`l${i}.unitPrice`} aria-label={t("unitPrice")} inputMode="decimal" className={cell} value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
                <td className="px-2 py-1"><input name={`l${i}.discountPct`} aria-label={t("discount")} inputMode="decimal" className={cell} value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} /></td>
                <td className="px-2 py-1"><select name={`l${i}.taxCodeId`} aria-label={t("tax")} className={cell} value={l.taxCodeId} onChange={(e) => set(i, { taxCodeId: e.target.value })}><option value="">—</option>{taxCodes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></td>
                <td className="px-2 py-1"><button type="button" aria-label={t("removeLine")} className="rounded p-1 text-muted-foreground hover:text-danger" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}><Trash2 aria-hidden className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setLines((ls) => [...ls, { productId: "", description: "", quantity: "1", unitPrice: "", discountPct: "", taxCodeId: "" }])}><Plus aria-hidden className="size-4" />{t("addLine")}</button>
    </div>
  );
}
