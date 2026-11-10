import Decimal from "decimal.js";

/**
 * Money primitives for the ARA Accounting engine (docs/ACCOUNTING_RULES.md §1 L5, §5).
 *
 * - All arithmetic is decimal (decimal.js), never binary floating point.
 * - Amounts are rounded half away from zero to the currency's minor unit.
 * - Currencies are identified by ISO 4217 code only.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type DecimalValue = InstanceType<typeof D>;

/** Minor-unit decimals for the currencies seeded at launch. Others default to 2 until configured. */
const CURRENCY_DECIMALS: Record<string, number> = { SRD: 2, USD: 2, EUR: 2, GBP: 2, BRL: 2, GYD: 2, XCD: 2, TTD: 2, CNY: 2 };

export function currencyDecimals(code: string): number {
  assertCurrency(code);
  return CURRENCY_DECIMALS[code] ?? 2;
}

function assertCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) throw new MoneyError(`Invalid ISO 4217 currency code: ${code}`);
}

export class MoneyError extends Error {}

export class Money {
  private constructor(readonly amount: DecimalValue, readonly currency: string) {}

  /** Creates money from a decimal string or Decimal, rounded to the currency's minor unit. Numbers are refused. */
  static of(amount: string | DecimalValue, currency: string): Money {
    if (typeof amount === "number") throw new MoneyError("Use a decimal string, not a JS number");
    assertCurrency(currency);
    let value: DecimalValue;
    try {
      value = new D(amount);
    } catch {
      throw new MoneyError(`Invalid amount: ${String(amount)}`);
    }
    if (!value.isFinite()) throw new MoneyError(`Invalid amount: ${String(amount)}`);
    return new Money(value.toDecimalPlaces(currencyDecimals(currency), Decimal.ROUND_HALF_UP), currency);
  }

  static zero(currency: string): Money {
    return Money.of("0", currency);
  }

  private same(other: Money) {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.same(other);
    return Money.of(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.same(other);
    return Money.of(this.amount.minus(other.amount), this.currency);
  }

  /** Multiplies by a decimal factor (quantity, percentage as fraction) and rounds once. */
  multiply(factor: string | DecimalValue): Money {
    return Money.of(this.amount.times(new D(factor)), this.currency);
  }

  negate(): Money {
    return Money.of(this.amount.negated(), this.currency);
  }

  isZero() {
    return this.amount.isZero();
  }

  isNegative() {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  equals(other: Money) {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** Canonical decimal string with exactly the currency's decimals, e.g. "38000.00". */
  toString(): string {
    return this.amount.toFixed(currencyDecimals(this.currency));
  }

  /**
   * Converts to another currency. `rate` means 1 unit of this currency = `rate` units of `to`.
   * The result is rounded to the target currency's minor unit (half away from zero).
   */
  convert(to: string, rate: string): Money {
    const r = new D(rate);
    if (!r.isFinite() || r.lte(0)) throw new MoneyError(`Invalid exchange rate: ${rate}`);
    return Money.of(this.amount.times(r), to);
  }

  /**
   * Splits the amount over ratios without losing or creating a minor unit.
   * Remainders go to the largest shares first (ties: earlier index), so the parts always sum to the total.
   */
  allocate(ratios: Array<string | number>): Money[] {
    if (ratios.length === 0) throw new MoneyError("At least one ratio is required");
    const weights = ratios.map((r) => new D(r));
    if (weights.some((w) => w.isNegative())) throw new MoneyError("Ratios must not be negative");
    const total = weights.reduce((a, b) => a.plus(b), new D(0));
    if (total.isZero()) throw new MoneyError("Ratios must not all be zero");

    const decimals = currencyDecimals(this.currency);
    const unit = new D(1).dividedBy(new D(10).pow(decimals));
    const sign = this.amount.isNegative() ? -1 : 1;
    const abs = this.amount.abs();

    const raw = weights.map((w) => abs.times(w).dividedBy(total));
    const parts = raw.map((r) => r.toDecimalPlaces(decimals, Decimal.ROUND_DOWN));
    let remainder = abs.minus(parts.reduce((a, b) => a.plus(b), new D(0)));

    const order = raw
      .map((r, i) => ({ i, frac: r.minus(parts[i]!) }))
      .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
    for (let k = 0; remainder.gt(0); k = (k + 1) % order.length) {
      const idx = order[k]!.i;
      parts[idx] = parts[idx]!.plus(unit);
      remainder = remainder.minus(unit);
    }
    return parts.map((p) => Money.of(sign < 0 ? p.negated() : p, this.currency));
  }
}

/** Sums money of one currency. An empty list needs the currency explicitly. */
export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
}

/**
 * Parses user input such as "1.234,56", "1,234.56", "38000" or "-12,5" into a canonical decimal string.
 * When only one kind of separator is present and it could be either, `locale` decides
 * (nl: "." groups thousands and "," is the decimal mark; en: the reverse).
 */
export function parseAmount(input: string, locale: "nl" | "en" = "nl"): string {
  let s = input.trim().replace(/\s| /g, "").replace(/^(SRD|USD|EUR|GBP)/i, "");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) throw new MoneyError(`Invalid amount: ${input}`);

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalMark: "." | "," | null;
  if (lastDot >= 0 && lastComma >= 0) decimalMark = lastDot > lastComma ? "." : ",";
  else if (lastDot < 0 && lastComma < 0) decimalMark = null;
  else {
    const mark = lastDot >= 0 ? "." : ",";
    const occurrences = s.split(mark).length - 1;
    if (occurrences > 1) decimalMark = null; // repeated → thousands separator
    else decimalMark = mark === (locale === "nl" ? "," : ".") ? mark : null;
  }

  const group = decimalMark === "." ? "," : decimalMark === "," ? "." : /[.,]/g;
  let normalised = typeof group === "string" ? s.split(group).join("") : s.replace(group, "");
  if (decimalMark === ",") normalised = normalised.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalised)) throw new MoneyError(`Invalid amount: ${input}`);
  const value = new D(normalised);
  return (negative ? value.negated() : value).toString();
}

/** Formats as "SRD 38.000,00" (nl) or "SRD 38,000.00" (en). Always shows the ISO code, never "$". */
export function formatMoney(money: Money, locale: "nl" | "en" = "nl"): string {
  const [intPart = "0", frac] = money.amount.abs().toFixed(currencyDecimals(money.currency)).split(".");
  const groupSep = locale === "nl" ? "." : ",";
  const decimalSep = locale === "nl" ? "," : ".";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const sign = money.isNegative() ? "-" : "";
  return `${money.currency} ${sign}${grouped}${frac ? decimalSep + frac : ""}`;
}
