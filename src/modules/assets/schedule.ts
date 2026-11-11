import Decimal from "decimal.js";
import { Money } from "@/core/money";

/**
 * Depreciation schedules (ACCOUNTING_RULES A1, A2), pure and deterministic.
 * Straight-line: (cost − residual) spread over the useful life without losing a cent.
 * Declining balance: rate% per year on the book value, monthly; never below the residual value; the last month of
 * the useful life writes the book value down to the residual value.
 */
export interface ScheduleInput {
  cost: string;
  residual: string;
  usefulLifeMonths: number;
  method: "STRAIGHT_LINE" | "DECLINING_BALANCE";
  decliningRatePct?: string | null;
  start: Date; // first day of the first depreciation month (UTC)
  currency?: string;
}

export interface ScheduleLine {
  year: number;
  month: number;
  amount: string;
  bookValueAfter: string;
}

export function depreciationSchedule(input: ScheduleInput): ScheduleLine[] {
  const cur = input.currency ?? "SRD";
  const cost = new Decimal(input.cost);
  const residual = new Decimal(input.residual);
  if (cost.lte(0) || residual.lt(0) || residual.gte(cost)) throw new Error("invalid cost/residual");
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths < 1) throw new Error("invalid useful life");
  const months = input.usefulLifeMonths;
  let amounts: Decimal[];
  if (input.method === "STRAIGHT_LINE") {
    amounts = Money.of(cost.minus(residual), cur).allocate(Array(months).fill(1)).map((m) => m.amount);
    // allocate() gives remainders to the first months; keep the pattern stable: first months may be 1 cent higher.
  } else {
    const rate = new Decimal(input.decliningRatePct ?? "0");
    if (rate.lte(0) || rate.gt(100)) throw new Error("invalid declining rate");
    amounts = [];
    let nbv = cost;
    for (let i = 0; i < months; i++) {
      let amt = i === months - 1 ? nbv.minus(residual) : nbv.times(rate).dividedBy(1200).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (nbv.minus(amt).lt(residual)) amt = nbv.minus(residual);
      amounts.push(amt);
      nbv = nbv.minus(amt);
    }
  }
  const out: ScheduleLine[] = [];
  let nbv = cost;
  let y = input.start.getUTCFullYear();
  let m = input.start.getUTCMonth() + 1;
  for (const a of amounts) {
    nbv = nbv.minus(a);
    if (a.gt(0)) out.push({ year: y, month: m, amount: a.toFixed(2), bookValueAfter: nbv.toFixed(2) });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** First day of the month after the acquisition date (default depreciation start). */
export function defaultDepreciationStart(acquisition: string): string {
  const d = new Date(`${acquisition}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
