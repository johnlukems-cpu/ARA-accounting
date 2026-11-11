import Decimal from "decimal.js";
import { z } from "zod";

export const RATE_TYPES = ["CBVS_BUY", "CBVS_SELL", "CBVS_MONTH_AVG", "CLOSING", "BANK", "CAMBIO", "MANUAL"] as const;
export type RateTypeCode = (typeof RATE_TYPES)[number];

/**
 * Exchange-rate policy per administration (ACCOUNTING_RULES C2), stored in Administration.settings.fxPolicy.
 * Defaults follow docs/SURINAME_MARKET.md §3 and must be agreed with the accountant. Bank and cambio movements always
 * use the actual rate of the statement or receipt, so they have no policy rate.
 */
export const fxPolicySchema = z.object({
  sales: z.enum(RATE_TYPES).default("CBVS_BUY"),
  purchase: z.enum(RATE_TYPES).default("CBVS_SELL"),
  revaluation: z.enum(RATE_TYPES).default("CLOSING"),
  /** A rate may be at most this many days older than the transaction date (weekends, holidays). */
  maxAgeDays: z.coerce.number().int().min(0).max(31).default(7),
  /** Only approved rates are used. */
  requireApproved: z.boolean().default(false),
  /** AUTO_REVERSE: revaluation is reversed on day 1 of the next period. CUMULATIVE: it stays and the next one adds to it. */
  revaluationMode: z.enum(["AUTO_REVERSE", "CUMULATIVE"]).default("AUTO_REVERSE"),
  /** Extra monetary accounts to revalue besides bank, cash, debtors, creditors and current accounts (e.g. a USD loan). */
  monetaryAccounts: z.array(z.string().regex(/^\d{4}$/)).max(50).default([]),
});
export type FxPolicy = z.infer<typeof fxPolicySchema>;

export function fxPolicyOf(settings: unknown): FxPolicy {
  const raw = (settings as { fxPolicy?: unknown } | null)?.fxPolicy ?? {};
  const parsed = fxPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : fxPolicySchema.parse({});
}

export type CbvsRow = { date: string; currency: string; buy: string; sell: string };
export type ParseError = { line: number; key: string };

const num = (v: string | undefined) => {
  if (!v) return null;
  const s = v.trim().replace(/\s/g, "");
  // 38,5000 or 38.5000 or 1.038,50
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d+)?$/.test(normal) && new Decimal(normal).gt(0) ? new Decimal(normal).toString() : null;
};
const isoDate = (v: string | undefined) => {
  const s = (v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const d = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d ? null : d;
  }
  return null;
};

/**
 * ARA layout for CBvS rates (the CBvS publishes buying and selling rates; there is no confirmed machine-readable feed):
 * `datum;valuta;aankoop;verkoop` — one row per date and currency, semicolon or comma separated, header optional.
 */
export function parseCbvsCsv(content: string): { rows: CbvsRow[]; errors: ParseError[] } {
  const rows: CbvsRow[] = [];
  const errors: ParseError[] = [];
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && !isoDate(cells[0])) return; // header
    const date = isoDate(cells[0]);
    const currency = (cells[1] ?? "").toUpperCase();
    const buy = num(cells[2]);
    const sell = num(cells[3]);
    if (!date) return errors.push({ line: i + 1, key: "currency.csvDate" });
    if (!/^[A-Z]{3}$/.test(currency)) return errors.push({ line: i + 1, key: "currency.csvCurrency" });
    if (!buy || !sell) return errors.push({ line: i + 1, key: "currency.csvRate" });
    if (new Decimal(buy).gt(sell)) return errors.push({ line: i + 1, key: "currency.csvBuyAboveSell" });
    rows.push({ date, currency, buy, sell });
  });
  return { rows, errors };
}

export type BalanceGroup = { accountId: string; number: string; name: string; currency: string; tx: string; base: string };
export type RevaluationLine = BalanceGroup & { rate: string; revalued: string; difference: string };

/** C5: closing-rate base value − carrying base value, per account and currency. Lines without difference are dropped. */
export function revaluationLines(groups: BalanceGroup[], rates: Record<string, string>): { lines: RevaluationLine[]; missing: string[]; total: string } {
  const lines: RevaluationLine[] = [];
  const missing = new Set<string>();
  let total = new Decimal(0);
  for (const g of groups) {
    const rate = rates[g.currency];
    if (!rate) {
      if (!new Decimal(g.tx).isZero() || !new Decimal(g.base).isZero()) missing.add(g.currency);
      continue;
    }
    const revalued = new Decimal(g.tx).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const diff = revalued.minus(g.base);
    if (diff.isZero()) continue;
    total = total.plus(diff);
    lines.push({ ...g, rate, revalued: revalued.toFixed(2), difference: diff.toFixed(2) });
  }
  return { lines, missing: [...missing].sort(), total: total.toFixed(2) };
}
