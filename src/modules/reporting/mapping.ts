import type { AccountCategory, ControlType } from "@prisma/client";

/**
 * Report template "ARA Standaard Suriname" (R1): rules that map accounts to report lines. First matching rule wins.
 * Rules use the account category, the parent header and number ranges of the standard chart; industry templates
 * add accounts under the same headers, so they map without extra configuration.
 */
export type LineCode =
  | "FIXED_ASSETS" | "INVENTORY" | "RECEIVABLES" | "TAX_ASSETS" | "OTHER_CURRENT_ASSETS" | "CASH"
  | "EQUITY" | "LONG_TERM_LIABILITIES" | "CURRENT_LIABILITIES" | "TAX_LIABILITIES"
  | "REVENUE" | "OTHER_INCOME" | "COST_OF_SALES" | "PERSONNEL" | "DEPRECIATION" | "OTHER_OPEX" | "FINANCIAL" | "INCOME_TAX";

export type AccountMeta = { id: string; number: string; name: string; category: AccountCategory; controlType: ControlType; parentNumber: string | null; normalBalance: "DEBIT" | "CREDIT" };

type Rule = { line: LineCode; categories?: AccountCategory[]; parents?: string[]; from?: string; to?: string; controls?: ControlType[] };

const n = (from: string, to: string) => ({ from, to });
export const PL_RULES: Rule[] = [
  { line: "INCOME_TAX", categories: ["OPERATING_EXPENSE"], ...n("4950", "4959") },
  { line: "DEPRECIATION", categories: ["OPERATING_EXPENSE"], ...n("4800", "4819") },
  { line: "PERSONNEL", categories: ["OPERATING_EXPENSE"], ...n("4000", "4099") },
  { line: "OTHER_OPEX", categories: ["OPERATING_EXPENSE"] },
  { line: "OTHER_INCOME", categories: ["REVENUE"], ...n("8090", "8099") },
  { line: "REVENUE", categories: ["REVENUE"] },
  { line: "COST_OF_SALES", categories: ["COST_OF_SALES"] },
  { line: "FINANCIAL", categories: ["FINANCIAL_INCOME", "FINANCIAL_EXPENSE"] },
];

/** Balance sheet rules; TAX and SUSPENSE accounts go to the asset or liability side by the sign of their balance. */
export const BS_RULES: Rule[] = [
  { line: "CASH", controls: ["BANK", "CASH"] },
  { line: "CASH", parents: ["1000", "1100"] },
  { line: "FIXED_ASSETS", parents: ["0000"] },
  { line: "INVENTORY", parents: ["3000"] },
  { line: "RECEIVABLES", parents: ["1300"], categories: ["ASSET"] },
  { line: "EQUITY", categories: ["EQUITY"] },
  { line: "LONG_TERM_LIABILITIES", parents: ["0700"] },
  { line: "CURRENT_LIABILITIES", categories: ["LIABILITY"] },
  { line: "TAX_ASSETS", categories: ["TAX"] },
  { line: "OTHER_CURRENT_ASSETS", categories: ["ASSET", "SUSPENSE"] },
];

const matches = (r: Rule, a: AccountMeta) =>
  (!r.categories || r.categories.includes(a.category)) &&
  (!r.parents || (a.parentNumber !== null && r.parents.includes(a.parentNumber))) &&
  (!r.controls || r.controls.includes(a.controlType)) &&
  (!r.from || a.number >= r.from) && (!r.to || a.number <= r.to);

export const isPL = (c: AccountCategory) => ["REVENUE", "COST_OF_SALES", "OPERATING_EXPENSE", "FINANCIAL_INCOME", "FINANCIAL_EXPENSE"].includes(c);

export function plLine(a: AccountMeta): LineCode {
  return PL_RULES.find((r) => matches(r, a))?.line ?? "OTHER_OPEX";
}

/** Balance-sheet line for an account; `debitBalance` decides the side of tax and suspense accounts. */
export function bsLine(a: AccountMeta, debitBalance: boolean): LineCode {
  const line = BS_RULES.find((r) => matches(r, a))?.line ?? (a.category === "LIABILITY" ? "CURRENT_LIABILITIES" : "OTHER_CURRENT_ASSETS");
  if (line === "TAX_ASSETS") return debitBalance ? "TAX_ASSETS" : "TAX_LIABILITIES";
  if (line === "OTHER_CURRENT_ASSETS" && a.category === "SUSPENSE" && !debitBalance) return "CURRENT_LIABILITIES";
  return line;
}

export const BS_ASSETS: LineCode[] = ["FIXED_ASSETS", "INVENTORY", "RECEIVABLES", "TAX_ASSETS", "OTHER_CURRENT_ASSETS", "CASH"];
export const BS_LIABILITIES: LineCode[] = ["EQUITY", "LONG_TERM_LIABILITIES", "CURRENT_LIABILITIES", "TAX_LIABILITIES"];
export const CURRENT_ASSETS: LineCode[] = ["INVENTORY", "RECEIVABLES", "TAX_ASSETS", "OTHER_CURRENT_ASSETS", "CASH"];
export const CURRENT_LIABILITIES: LineCode[] = ["CURRENT_LIABILITIES", "TAX_LIABILITIES"];
