import { createHash } from "node:crypto";
import Decimal from "decimal.js";

/**
 * Bank statement CSV import (pure). Surinamese banks deliver CSV/Excel exports in their own layouts, so the
 * column mapping is configured per bank account (docs/SURINAME_MARKET.md §4). CAMT.053/MT940 are not used.
 */
export interface ImportProfile {
  delimiter: "," | ";" | "\t";
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: "DD-MM-YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "DD.MM.YYYY";
  /** Either one signed amount column, or separate debit (money out) and credit (money in) columns. */
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
  decimalSeparator: "," | ".";
  descriptionColumn: number;
  counterpartyColumn?: number;
  counterpartyAccountColumn?: number;
  referenceColumn?: number;
}

export interface ParsedLine {
  bookingDate: string;
  amount: string; // signed: + money in, − money out
  description: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  bankReference: string | null;
  lineHash: string;
}

export class ImportError extends Error {
  constructor(public readonly key: string, public readonly values: Record<string, string | number> = {}) {
    super(key);
  }
}

/** RFC 4180-style CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function parseDate(value: string, format: ImportProfile["dateFormat"]): string {
  const v = value.trim();
  const parts = v.split(/[-/.]/);
  let y: string, m: string, d: string;
  if (format === "YYYY-MM-DD") [y, m, d] = parts as [string, string, string];
  else if (format === "MM/DD/YYYY") [m, d, y] = parts as [string, string, string];
  else [d, m, y] = parts as [string, string, string];
  if (!y || !m || !d) throw new ImportError("banking.invalidDate", { value: v });
  if (y.length === 2) y = `20${y}`;
  const iso = `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) throw new ImportError("banking.invalidDate", { value: v });
  return iso;
}

export function parseAmount(value: string, decimalSeparator: "," | "."): Decimal {
  let v = value.trim().replace(/\s| /g, "").replace(/^(SRD|USD|EUR)/i, "");
  if (v === "" || v === "-") return new Decimal(0);
  let negative = false;
  if (v.startsWith("(") && v.endsWith(")")) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (v.endsWith("-")) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  const group = decimalSeparator === "," ? "." : ",";
  v = v.split(group).join("");
  if (decimalSeparator === ",") v = v.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(v)) throw new ImportError("banking.invalidAmount", { value });
  const d = new Decimal(v);
  return negative ? d.negated() : d;
}

const col = (row: string[], i: number | undefined) => (i === undefined || i < 0 ? "" : (row[i] ?? "").trim());

/** Parses a statement file into signed lines with a stable hash per line (identical lines in one file get an occurrence index). */
export function parseStatement(text: string, profile: ImportProfile): ParsedLine[] {
  const rows = parseCsv(text, profile.delimiter);
  const data = profile.hasHeader ? rows.slice(1) : rows;
  if (data.length === 0) throw new ImportError("banking.emptyFile");
  const seen = new Map<string, number>();
  return data.map((row, idx) => {
    const lineNo = idx + (profile.hasHeader ? 2 : 1);
    let amount: Decimal;
    try {
      if (profile.amountColumn !== undefined) amount = parseAmount(col(row, profile.amountColumn), profile.decimalSeparator);
      else amount = parseAmount(col(row, profile.creditColumn), profile.decimalSeparator).abs().minus(parseAmount(col(row, profile.debitColumn), profile.decimalSeparator).abs());
    } catch (e) {
      if (e instanceof ImportError) throw new ImportError(e.key, { ...e.values, line: lineNo });
      throw e;
    }
    let bookingDate: string;
    try {
      bookingDate = parseDate(col(row, profile.dateColumn), profile.dateFormat);
    } catch (e) {
      if (e instanceof ImportError) throw new ImportError(e.key, { ...e.values, line: lineNo });
      throw e;
    }
    if (amount.isZero()) throw new ImportError("banking.zeroAmount", { line: lineNo });
    const description = col(row, profile.descriptionColumn);
    const counterpartyName = col(row, profile.counterpartyColumn) || null;
    const counterpartyAccount = col(row, profile.counterpartyAccountColumn) || null;
    const bankReference = col(row, profile.referenceColumn) || null;
    const key = [bookingDate, amount.toFixed(2), description, counterpartyName ?? "", counterpartyAccount ?? "", bankReference ?? ""].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { bookingDate, amount: amount.toFixed(2), description, counterpartyName, counterpartyAccount, bankReference, lineHash: createHash("sha256").update(`${key}|#${n}`).digest("hex") };
  });
}

export function fileHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex");
}

/**
 * Match score of an open item for a bank transaction (0–100). Exact remaining amount, document number in the
 * description and the relation's name in the counterparty/description raise the score.
 */
export function matchScore(tx: { amount: string; description: string; counterpartyName: string | null }, item: { remaining: string; documentNumber: string; partyName: string | null }): number {
  let score = 0;
  const amt = new Decimal(tx.amount).abs();
  const rem = new Decimal(item.remaining).abs();
  if (amt.equals(rem)) score += 50;
  else if (amt.lt(rem)) score += 15; // could be a partial payment
  const text = `${tx.description} ${tx.counterpartyName ?? ""}`.toLowerCase().replace(/\s+/g, " ");
  const doc = item.documentNumber.toLowerCase().split(" / ");
  if (doc.some((d) => d && text.replace(/[^a-z0-9]/g, "").includes(d.replace(/[^a-z0-9]/g, "")))) score += 40;
  if (item.partyName) {
    const words = item.partyName.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !["n.v.", "nv", "bv", "n.v"].includes(w));
    if (words.length && words.some((w) => text.includes(w))) score += 20;
  }
  return Math.min(100, score);
}
