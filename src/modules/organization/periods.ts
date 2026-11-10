/**
 * Fiscal-year and period calendar (pure functions, UTC dates).
 * Period 0 = opening balances (first day), 1..n = calendar months, 13 = year-end adjustments (last day).
 */

export interface PeriodPlan {
  number: number;
  startDate: Date;
  endDate: Date;
}

function utc(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

export function addMonths(date: Date, months: number): Date {
  return utc(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());
}

/** Fiscal year of 12 months starting on the first day of `startMonth` (1–12) in `startYear`. */
export function fiscalYearRange(startYear: number, startMonth = 1): { startDate: Date; endDate: Date } {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error("startMonth must be 1–12");
  const startDate = utc(startYear, startMonth - 1, 1);
  const endDate = utc(startYear, startMonth - 1 + 12, 0);
  return { startDate, endDate };
}

/** Code shown to users: "2026" for a calendar year, "2026/2027" for a deviating (broken) fiscal year. */
export function fiscalYearCode(startDate: Date, endDate: Date): string {
  const a = startDate.getUTCFullYear();
  const b = endDate.getUTCFullYear();
  return a === b ? String(a) : `${a}/${b}`;
}

export function planPeriods(startDate: Date, endDate: Date): PeriodPlan[] {
  if (startDate.getUTCDate() !== 1) throw new Error("A fiscal year must start on the first day of a month");
  const periods: PeriodPlan[] = [{ number: 0, startDate, endDate: startDate }];
  let n = 1;
  let cursor = startDate;
  while (cursor <= endDate) {
    const monthEnd = utc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0);
    if (n > 12) throw new Error("A fiscal year has at most 12 monthly periods");
    periods.push({ number: n, startDate: cursor, endDate: monthEnd < endDate ? monthEnd : endDate });
    cursor = utc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    n++;
  }
  periods.push({ number: 13, startDate: endDate, endDate });
  return periods;
}

/** Finds the regular period (1..12) containing a date. */
export function periodForDate<T extends { number: number; startDate: Date; endDate: Date }>(periods: T[], date: Date): T | undefined {
  return periods.find((p) => p.number >= 1 && p.number <= 12 && p.startDate <= date && date <= p.endDate);
}

export function toDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
