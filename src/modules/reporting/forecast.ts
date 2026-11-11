import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";

/**
 * Cash-flow forecast (R3: forecast figures are labelled and kept apart from actuals).
 * Start = posted cash and bank balance today. Inflows/outflows = open receivables and payables by due date, plus the
 * approved budget's monthly result (excluding depreciation) for months after the current one.
 * Scenario assumptions are explicit and shown on screen.
 */
export const SCENARIOS = {
  BASE: { collectionDelayDays: 0, collectedPct: 100, paymentDelayDays: 0, budget: "BASE" },
  BEST: { collectionDelayDays: 0, collectedPct: 100, paymentDelayDays: 15, budget: "BEST" },
  WORST: { collectionDelayDays: 30, collectedPct: 90, paymentDelayDays: 0, budget: "WORST" },
} as const;
export type Scenario = keyof typeof SCENARIOS;

export type ForecastItem = { due: Date; amount: Decimal };
export type ForecastBucket = { index: number; from: string; to: string; receipts: string; payments: string; budget: string; net: string; closing: string };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pure: spreads items over 30-day buckets from `today`; anything already overdue falls in the first bucket. */
export function forecastBuckets(input: { today: Date; horizonDays: number; openingCash: Decimal.Value; receivables: ForecastItem[]; payables: ForecastItem[]; budgetByMonth: Map<string, Decimal>; scenario: Scenario }): ForecastBucket[] {
  const s = SCENARIOS[input.scenario];
  const count = Math.max(1, Math.round(input.horizonDays / 30));
  const start = new Date(Date.UTC(input.today.getUTCFullYear(), input.today.getUTCMonth(), input.today.getUTCDate()));
  const idx = (d: Date) => Math.max(0, Math.floor((d.getTime() - start.getTime()) / (30 * DAY)));
  const receipts = Array.from({ length: count }, () => new Decimal(0));
  const payments = Array.from({ length: count }, () => new Decimal(0));
  const budget = Array.from({ length: count }, () => new Decimal(0));
  for (const r of input.receivables) {
    const i = idx(new Date(r.due.getTime() + s.collectionDelayDays * DAY));
    if (i < count) receipts[i] = receipts[i]!.plus(r.amount.times(s.collectedPct).dividedBy(100));
  }
  for (const p of input.payables) {
    const i = idx(new Date(p.due.getTime() + s.paymentDelayDays * DAY));
    if (i < count) payments[i] = payments[i]!.plus(p.amount);
  }
  // Budget months after the current month, assigned to the bucket containing the 15th of that month.
  for (const [month, amount] of input.budgetByMonth) {
    const mid = new Date(`${month}-15T00:00:00Z`);
    if (mid.getUTCFullYear() * 12 + mid.getUTCMonth() <= start.getUTCFullYear() * 12 + start.getUTCMonth()) continue;
    const i = idx(mid);
    if (i < count) budget[i] = budget[i]!.plus(amount);
  }
  let cash = new Decimal(input.openingCash);
  return Array.from({ length: count }, (_, i) => {
    const net = receipts[i]!.minus(payments[i]!).plus(budget[i]!);
    cash = cash.plus(net);
    return { index: i, from: iso(new Date(start.getTime() + i * 30 * DAY)), to: iso(new Date(start.getTime() + ((i + 1) * 30 - 1) * DAY)), receipts: receipts[i]!.toFixed(2), payments: payments[i]!.toFixed(2), budget: budget[i]!.toFixed(2), net: net.toFixed(2), closing: cash.toFixed(2) };
  });
}

export async function cashForecast(tx: Tx, q: { administrationId: string; today: Date; horizonDays: number; scenario: Scenario }) {
  const cash = await tx.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(l."debitBase" - l."creditBase")::text AS total FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
     WHERE e."administrationId" = ${q.administrationId} AND e.status = 'POSTED' AND a."controlType" IN ('BANK', 'CASH') AND e."entryDate" <= ${q.today}`;
  const items = await tx.openItem.findMany({ where: { administrationId: q.administrationId, status: "OPEN" } });
  const toItem = (o: (typeof items)[number]) => ({ due: o.dueDate, amount: new Decimal(o.remainingAmount.toString()).times(o.originalRate.toString()).toDecimalPlaces(2) });
  // Budget: approved version of the scenario (or BASE) for the fiscal year(s) covering the horizon; result excl. depreciation.
  const budgetByMonth = new Map<string, Decimal>();
  const scenario = SCENARIOS[q.scenario].budget;
  const years = await tx.fiscalYear.findMany({ where: { administrationId: q.administrationId, endDate: { gte: q.today } }, include: { periods: true } });
  for (const fy of years) {
    const budget = (await tx.budget.findFirst({ where: { fiscalYearId: fy.id, scenario, status: "ACTIVE", versions: { some: { status: "APPROVED" } } } }))
      ?? (await tx.budget.findFirst({ where: { fiscalYearId: fy.id, scenario: "BASE", status: "ACTIVE", versions: { some: { status: "APPROVED" } } } }));
    if (!budget) continue;
    const version = await tx.budgetVersion.findFirstOrThrow({ where: { budgetId: budget.id, status: "APPROVED" } });
    const lines = await tx.budgetLine.findMany({ where: { versionId: version.id } });
    const accounts = new Map((await tx.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } })).map((a) => [a.id, a]));
    for (const l of lines) {
      const a = accounts.get(l.accountId);
      if (!a || (a.number >= "4800" && a.number <= "4819")) continue; // depreciation is not a cash flow
      const period = fy.periods.find((p) => p.number === l.period);
      if (!period) continue;
      const month = period.startDate.toISOString().slice(0, 7);
      const signed = ["REVENUE", "FINANCIAL_INCOME"].includes(a.category) ? new Decimal(l.amount.toString()) : new Decimal(l.amount.toString()).negated();
      budgetByMonth.set(month, (budgetByMonth.get(month) ?? new Decimal(0)).plus(signed));
    }
  }
  const openingCash = new Decimal(cash[0]?.total ?? 0);
  return {
    openingCash: openingCash.toFixed(2),
    assumptions: SCENARIOS[q.scenario],
    buckets: forecastBuckets({ today: q.today, horizonDays: q.horizonDays, openingCash, receivables: items.filter((o) => o.side === "RECEIVABLE").map(toItem), payables: items.filter((o) => o.side === "PAYABLE").map(toItem), budgetByMonth, scenario: q.scenario }),
  };
}
