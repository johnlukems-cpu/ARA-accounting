import Decimal from "decimal.js";
import { Money, MoneyError, currencyDecimals } from "@/core/money";

/**
 * Pure posting logic (no I/O): turns user/module lines into balanced base-currency journal lines.
 * Rules: docs/ACCOUNTING_RULES.md L1, L2, L5, C1.
 */

export interface LineInput {
  accountId: string;
  description?: string | null;
  /** Amount in the transaction currency, as a decimal string. Exactly one of debit/credit must be > 0. */
  debit?: string | null;
  credit?: string | null;
  /** Transaction currency; defaults to the base currency. */
  currency?: string | null;
  /** 1 unit of `currency` = `rate` units of base currency. Required when currency ≠ base. */
  rate?: string | null;
  rateDate?: string | null;
  rateSource?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
  departmentId?: string | null;
  partyId?: string | null;
  taxCodeId?: string | null;
}

export interface BuiltLine {
  lineNo: number;
  accountId: string;
  description: string | null;
  debitBase: string;
  creditBase: string;
  txCurrency: string;
  txAmount: string;
  exchangeRate: string;
  rateDate: string | null;
  rateSource: string;
  costCenterId: string | null;
  projectId: string | null;
  departmentId: string | null;
  partyId: string | null;
  taxCodeId: string | null;
  isRounding: boolean;
}

export class LedgerError extends Error {
  constructor(public readonly key: string, public readonly values: Record<string, string | number> = {}) {
    super(key);
    this.name = "LedgerError";
  }
}

function positive(value: string | null | undefined, currency: string): Money | null {
  if (value == null || String(value).trim() === "") return null;
  let m: Money;
  try {
    m = Money.of(String(value).trim(), currency);
  } catch (e) {
    if (e instanceof MoneyError) throw new LedgerError("ledger.invalidAmount", { value: String(value) });
    throw e;
  }
  if (m.isNegative()) throw new LedgerError("ledger.negativeAmount");
  return m.isZero() ? null : m;
}

/**
 * Builds base-currency lines. When foreign-currency conversion leaves a residual of at most one minor unit
 * per converted line, a labelled rounding line is added on `roundingAccountId` (L5). Anything else that
 * does not balance is rejected.
 */
export function buildLines(inputs: LineInput[], baseCurrency: string, roundingAccountId?: string | null): BuiltLine[] {
  if (inputs.length < 2) throw new LedgerError("ledger.minTwoLines");
  const lines: BuiltLine[] = [];
  let debit = Money.zero(baseCurrency);
  let credit = Money.zero(baseCurrency);
  let converted = 0;

  inputs.forEach((input, i) => {
    const currency = (input.currency || baseCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new LedgerError("ledger.invalidCurrency", { line: i + 1 });
    const d = positive(input.debit, currency);
    const c = positive(input.credit, currency);
    if ((d && c) || (!d && !c)) throw new LedgerError("ledger.oneSidePerLine", { line: i + 1 });
    const tx = (d ?? c)!;

    let rate = "1";
    let base: Money;
    let rateSource = "IDENTITY";
    if (currency === baseCurrency) {
      base = tx;
    } else {
      if (!input.rate) throw new LedgerError("ledger.rateRequired", { line: i + 1, currency });
      const r = new Decimal(input.rate);
      if (!r.isFinite() || r.lte(0)) throw new LedgerError("ledger.invalidRate", { line: i + 1 });
      rate = r.toString();
      base = tx.convert(baseCurrency, rate);
      rateSource = input.rateSource || "MANUAL";
      converted++;
    }
    if (base.isZero()) throw new LedgerError("ledger.zeroAfterConversion", { line: i + 1 });
    if (d) debit = debit.add(base);
    else credit = credit.add(base);

    lines.push({
      lineNo: i + 1,
      accountId: input.accountId,
      description: input.description?.trim() || null,
      debitBase: d ? base.toString() : "0",
      creditBase: c ? base.toString() : "0",
      txCurrency: currency,
      txAmount: d ? tx.toString() : tx.negate().toString(),
      exchangeRate: rate,
      rateDate: currency === baseCurrency ? null : input.rateDate ?? null,
      rateSource,
      costCenterId: input.costCenterId || null,
      projectId: input.projectId || null,
      departmentId: input.departmentId || null,
      partyId: input.partyId || null,
      taxCodeId: input.taxCodeId || null,
      isRounding: false,
    });
  });

  const diff = debit.subtract(credit);
  if (!diff.isZero()) {
    const unit = new Decimal(1).dividedBy(new Decimal(10).pow(currencyDecimals(baseCurrency)));
    const tolerance = unit.times(converted);
    if (converted === 0 || diff.amount.abs().gt(tolerance)) {
      throw new LedgerError("ledger.unbalanced", { debit: debit.toString(), credit: credit.toString(), difference: diff.toString() });
    }
    if (!roundingAccountId) throw new LedgerError("ledger.noRoundingAccount");
    const amount = diff.amount.abs().toFixed(currencyDecimals(baseCurrency));
    const debitSide = diff.isNegative();
    lines.push({
      lineNo: lines.length + 1,
      accountId: roundingAccountId,
      description: "Afrondingsverschil valutaomrekening",
      debitBase: debitSide ? amount : "0",
      creditBase: debitSide ? "0" : amount,
      txCurrency: baseCurrency,
      txAmount: debitSide ? amount : `-${amount}`,
      exchangeRate: "1",
      rateDate: null,
      rateSource: "IDENTITY",
      costCenterId: null,
      projectId: null,
      departmentId: null,
      partyId: null,
      taxCodeId: null,
      isRounding: true,
    });
  }
  return lines;
}

export function totals(lines: Pick<BuiltLine, "debitBase" | "creditBase">[], baseCurrency: string) {
  let d = Money.zero(baseCurrency);
  let c = Money.zero(baseCurrency);
  for (const l of lines) {
    d = d.add(Money.of(String(l.debitBase), baseCurrency));
    c = c.add(Money.of(String(l.creditBase), baseCurrency));
  }
  return { debit: d, credit: c };
}

/** Mirror lines for a reversal: debit ↔ credit, same tx amounts, rates and dimensions. */
export function reverseLines<T extends { debitBase: unknown; creditBase: unknown; txAmount: unknown }>(lines: T[]): T[] {
  return lines.map((l) => ({
    ...l,
    debitBase: l.creditBase,
    creditBase: l.debitBase,
    txAmount: new Decimal(String(l.txAmount)).negated().toString(),
  }));
}

/** Signed balance on the account's normal side. */
export function normalSigned(debit: Decimal.Value, credit: Decimal.Value, normal: "DEBIT" | "CREDIT"): Decimal {
  const d = new Decimal(debit);
  const c = new Decimal(credit);
  return normal === "DEBIT" ? d.minus(c) : c.minus(d);
}
