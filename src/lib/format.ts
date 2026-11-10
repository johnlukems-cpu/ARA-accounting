import Decimal from "decimal.js";

/** "SRD 38.000,00" (nl) / "SRD 38,000.00" (en) from a decimal string or Decimal. Never uses floats. */
export function formatAmount(value: Decimal.Value | { toString(): string } | null | undefined, currency: string, locale: string = "nl"): string {
  if (value == null || value === "") return "";
  const d = new Decimal(String(value));
  const [i = "0", f = "00"] = d.abs().toFixed(2).split(".");
  const nl = locale.startsWith("nl");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, nl ? "." : ",");
  return `${currency} ${d.isNegative() && !d.isZero() ? "-" : ""}${grouped}${nl ? "," : "."}${f}`;
}

/** Amount without currency, blank for zero (tables with debit/credit columns). */
export function formatCell(value: Decimal.Value | { toString(): string } | null | undefined, locale: string = "nl"): string {
  if (value == null) return "";
  const d = new Decimal(String(value));
  if (d.isZero()) return "";
  return formatAmount(d, "", locale).trim();
}
