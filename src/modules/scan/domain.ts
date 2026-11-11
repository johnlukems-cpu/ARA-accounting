import Decimal from "decimal.js";
import { MoneyError, parseAmount } from "@/core/money";

/** Allowed uploads, recognised by their first bytes (never by file name or browser-reported type). */
export function sniffMime(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

export const FIELD_KEYS = ["supplierName", "supplierTaxNumber", "invoiceNumber", "invoiceDate", "dueDate", "currency", "netAmount", "taxAmount", "grossAmount", "description"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type Field = { value: string | null; confidence: number };
export type Fields = Record<FieldKey, Field>;

export const emptyFields = (): Fields => Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, confidence: 0 }])) as Fields;

const amount = (raw: string): string | null => {
  try {
    const v = parseAmount(raw.replace(/^(SRD|USD|EUR|\$|€)\s*/i, ""), "nl");
    return new Decimal(v).gt(0) ? new Decimal(v).toFixed(2) : null;
  } catch (e) {
    if (e instanceof MoneyError) return null;
    throw e;
  }
};
const date = (raw: string): string | null => {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw.trim()) ?? null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const s = m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : iso ? raw.trim() : null;
  return s && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
};
const AMOUNT = "((?:SRD|USD|EUR|\\$|€)?\\s*-?[\\d.,]+\\d)";

/**
 * Heuristic extraction from a PDF text layer (no AI): labels used on Surinamese/Dutch invoices.
 * Confidence is modest on purpose; values that are consistent with each other (net + BTW = total) score higher.
 */
export function extractFromText(text: string): Fields {
  const f = emptyFields();
  const t = text.replace(/ /g, " ");
  const find = (re: RegExp) => re.exec(t)?.[1]?.trim() ?? null;

  const inv = find(/(?:factuur\s*(?:nummer|nr\.?|no\.?)|invoice\s*(?:number|no\.?|#))\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-.]{1,30})/i);
  if (inv) f.invoiceNumber = { value: inv, confidence: 0.8 };
  const d = find(/(?:factuurdatum|invoice\s*date|datum)\s*[:]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (d && date(d)) f.invoiceDate = { value: date(d), confidence: 0.75 };
  const due = find(/(?:vervaldatum|uiterste\s*betaaldatum|due\s*date)\s*[:]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (due && date(due)) f.dueDate = { value: date(due), confidence: 0.75 };
  // Last "total" on the page (subtotals come first); "subtotaal" itself is excluded by the look-behind.
  const grossAll = [...t.matchAll(new RegExp(`(?<![a-z])(?:totaal\\s*(?:incl\\.?\\s*btw)?|te\\s*betalen|total\\s*(?:due|amount)?)\\s*[:]?\\s*${AMOUNT}`, "gi"))];
  const gross = grossAll.at(-1)?.[1]?.trim() ?? null;
  if (gross && amount(gross)) f.grossAmount = { value: amount(gross), confidence: 0.65 };
  const tax = find(new RegExp(`(?:btw|vat)\\s*(?:\\d{1,2}\\s*%)?\\s*(?:bedrag)?\\s*[:]?\\s*${AMOUNT}`, "i"));
  if (tax && amount(tax)) f.taxAmount = { value: amount(tax), confidence: 0.6 };
  const net = find(new RegExp(`(?:subtotaal|totaal\\s*excl\\.?\\s*btw|netto|subtotal)\\s*[:]?\\s*${AMOUNT}`, "i"));
  if (net && amount(net)) f.netAmount = { value: amount(net), confidence: 0.6 };
  if (f.netAmount.value && f.taxAmount.value && f.grossAmount.value && new Decimal(f.netAmount.value).plus(f.taxAmount.value).eq(f.grossAmount.value)) {
    for (const k of ["netAmount", "taxAmount", "grossAmount"] as const) f[k].confidence = 0.9;
  }
  const cur = /\b(USD|EUR|SRD)\b/.exec(t)?.[1] ?? (/€/.test(t) ? "EUR" : null);
  if (cur) f.currency = { value: cur, confidence: 0.6 };
  const taxNo = find(/(?:btw[\s-]*(?:nummer|nr\.?|registratienummer)|fiscaal\s*nummer|f\.?i\.?b\.?\s*nr\.?)\s*[:]?\s*([A-Z0-9][A-Z0-9.\-/]{3,25})/i);
  if (taxNo) f.supplierTaxNumber = { value: taxNo, confidence: 0.7 };
  const firstLine = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length >= 3 && !/factuur|invoice/i.test(l));
  if (firstLine) f.supplierName = { value: firstLine.slice(0, 120), confidence: 0.4 };
  return f;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(n\.?v\.?|b\.?v\.?|ltd|inc|vof|n\.v)\b/g, "").replace(/[^a-z0-9]/g, "");

/** Supplier suggestion: tax number or KKF match (high), otherwise name similarity (bigram Dice). */
export function matchSupplier<P extends { id: string; name: string; taxNumber?: string | null; kkfNumber?: string | null; btwNumber?: string | null }>(fields: Fields, parties: P[]): { party: P; confidence: number } | null {
  const taxNo = fields.supplierTaxNumber.value ? norm(fields.supplierTaxNumber.value) : null;
  if (taxNo) {
    const p = parties.find((x) => [x.taxNumber, x.kkfNumber, x.btwNumber].some((n) => n && norm(n) === taxNo));
    if (p) return { party: p, confidence: 0.98 };
  }
  const name = fields.supplierName.value ? norm(fields.supplierName.value) : "";
  if (name.length < 3) return null;
  const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const a = grams(name);
  let best: { party: P; confidence: number } | null = null;
  for (const p of parties) {
    const b = grams(norm(p.name));
    if (!a.size || !b.size) continue;
    let common = 0;
    for (const g of a) if (b.has(g)) common++;
    const dice = (2 * common) / (a.size + b.size);
    const score = Math.min(0.95, dice * (fields.supplierName.confidence > 0 ? Math.max(0.8, fields.supplierName.confidence + 0.4) : 1));
    if (dice >= 0.6 && (!best || score > best.confidence)) best = { party: p, confidence: Number(score.toFixed(2)) };
  }
  return best;
}

export type DuplicateReason = "SAME_FILE" | "SAME_INVOICE_NUMBER" | "SAME_DATE_AMOUNT";
