import Decimal from "decimal.js";
import type { AccountCategory } from "@prisma/client";
import { Money, MoneyError, parseAmount } from "@/core/money";

/** Accounts that can be budgeted: the result accounts (P&L). */
export const BUDGET_CATEGORIES: AccountCategory[] = ["REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE"];
const INCOME: AccountCategory[] = ["REVENUE", "FINANCIAL_INCOME"];

export const isIncome = (c: AccountCategory) => INCOME.includes(c);

/** Natural amount of a posted balance: revenue positive when credited, costs positive when debited. */
export function natural(debitMinusCredit: Decimal.Value, category: AccountCategory): Decimal {
  const v = new Decimal(debitMinusCredit);
  return isIncome(category) ? v.negated() : v;
}

/**
 * B2: variance = actual − budget; % = variance / |budget| (null when budget = 0); utilisation = actual / budget (null when 0).
 * Favourable: more revenue than budgeted, or less cost.
 */
export function variance(budget: Decimal.Value, actual: Decimal.Value, category: AccountCategory) {
  const b = new Decimal(budget);
  const a = new Decimal(actual);
  const v = a.minus(b);
  return {
    variance: v.toFixed(2),
    pct: b.isZero() ? null : v.dividedBy(b.abs()).times(100).toDecimalPlaces(1).toFixed(1),
    utilisation: b.isZero() ? null : a.dividedBy(b).times(100).toDecimalPlaces(1).toFixed(1),
    favourable: v.isZero() ? null : isIncome(category) ? v.gt(0) : v.lt(0),
  };
}

/** Over budget beyond the threshold, in the unfavourable direction. */
export function isAlert(budget: Decimal.Value, actual: Decimal.Value, category: AccountCategory, thresholdPct: Decimal.Value) {
  const r = variance(budget, actual, category);
  if (r.favourable !== false) return false;
  if (r.pct === null) return !new Decimal(actual).isZero() && !isIncome(category); // unbudgeted cost
  return new Decimal(r.pct).abs().gte(thresholdPct);
}

/** Spreads a yearly amount over 12 months, evenly or by weights (e.g. last year's pattern), without losing a cent. */
export function distribute(amount: string, weights?: Decimal.Value[]): string[] {
  const usable = weights && weights.length === 12 && weights.some((w) => !new Decimal(w).isZero()) && weights.every((w) => !new Decimal(w).isNegative());
  return Money.of(amount, "SRD").allocate(usable ? weights!.map((w) => new Decimal(w).toString()) : Array(12).fill(1)).map((m) => m.toString());
}

export type ImportedLine = { account: string; period: number; amount: string };
export type ImportError = { line: number; key: string };

/**
 * Budget import (CSV, semicolon/comma/tab):
 * - wide: `rekening;jan;feb;…;dec` (13 columns), or
 * - long: `rekening;periode;bedrag` (3 columns, periode 1–12).
 * Amounts use the Dutch notation (1.234,56) unless they are unambiguous. A header row is skipped.
 */
export function parseBudgetCsv(content: string): { lines: ImportedLine[]; errors: ImportError[] } {
  const lines: ImportedLine[] = [];
  const errors: ImportError[] = [];
  content.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const row = raw.trim();
    if (!row) return;
    const sep = row.includes(";") ? ";" : row.includes("\t") ? "\t" : ",";
    const cells = row.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const account = cells[0] ?? "";
    if (!/^\d{4}$/.test(account)) {
      if (i === 0) return; // header
      errors.push({ line: i + 1, key: "budgets.csvAccount" });
      return;
    }
    const amount = (v: string | undefined) => {
      if (v === undefined || v === "") return "0";
      try {
        return parseAmount(v, "nl");
      } catch (e) {
        if (e instanceof MoneyError) return null;
        throw e;
      }
    };
    if (cells.length === 3) {
      const period = Number(cells[1]);
      const a = amount(cells[2]);
      if (!Number.isInteger(period) || period < 1 || period > 12) return void errors.push({ line: i + 1, key: "budgets.csvPeriod" });
      if (a === null) return void errors.push({ line: i + 1, key: "budgets.csvAmount" });
      lines.push({ account, period, amount: a });
    } else if (cells.length === 13) {
      for (let p = 1; p <= 12; p++) {
        const a = amount(cells[p]);
        if (a === null) return void errors.push({ line: i + 1, key: "budgets.csvAmount" });
        lines.push({ account, period: p, amount: a });
      }
    } else {
      errors.push({ line: i + 1, key: "budgets.csvColumns" });
    }
  });
  return { lines, errors };
}
