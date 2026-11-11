import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";
import { BS_ASSETS, BS_LIABILITIES, CURRENT_ASSETS, CURRENT_LIABILITIES, bsLine, isPL, plLine, type AccountMeta, type LineCode } from "./mapping";

/** Per account: opening (periods < from), movement (from..to) and closing, as debit − credit in base currency. */
export type Balance = AccountMeta & { opening: Decimal; movement: Decimal; closing: Decimal; depreciationMovement: Decimal };

export async function loadBalances(tx: Tx, q: { administrationId: string; fiscalYearId: string; fromPeriod: number; toPeriod: number }): Promise<Balance[]> {
  const rows = await tx.$queryRaw<(Omit<AccountMeta, "parentNumber"> & { parentNumber: string | null; opening: string; movement: string; dep: string })[]>`
    SELECT a.id, a.number, a.name, a.category, a."controlType", a."normalBalance", p.number AS "parentNumber",
           COALESCE(SUM(l."debitBase" - l."creditBase") FILTER (WHERE ap.number < ${q.fromPeriod}), 0)::text AS opening,
           COALESCE(SUM(l."debitBase" - l."creditBase") FILTER (WHERE ap.number >= ${q.fromPeriod}), 0)::text AS movement,
           COALESCE(SUM(l."creditBase" - l."debitBase") FILTER (WHERE ap.number >= ${q.fromPeriod} AND e."sourceType" = 'DEPRECIATION'), 0)::text AS dep
      FROM "Account" a
      LEFT JOIN "Account" p ON p.id = a."parentId"
      LEFT JOIN "JournalLine" l ON l."accountId" = a.id
      -- Closing-journal entries (year-end transfer of the result, and their reversals) are left out: statements show the
      -- result of the year, and retained earnings without this year's transfer.
      LEFT JOIN "JournalEntry" e ON e.id = l."entryId" AND e.status = 'POSTED' AND e."fiscalYearId" = ${q.fiscalYearId}
        AND NOT EXISTS (SELECT 1 FROM "Journal" j WHERE j.id = e."journalId" AND j.type = 'CLOSING')
      LEFT JOIN "AccountingPeriod" ap ON ap.id = e."periodId" AND ap.number <= ${q.toPeriod}
     WHERE a."administrationId" = ${q.administrationId} AND a.type = 'DETAIL'
     GROUP BY a.id, p.number
     ORDER BY a.number`;
  return rows.map((r) => {
    const opening = new Decimal(r.opening);
    const movement = new Decimal(r.movement);
    return { ...r, opening, movement, closing: opening.plus(movement), depreciationMovement: new Decimal(r.dep) };
  });
}

export type LineRow = { code: LineCode; amount: string; accounts: { id: string; number: string; name: string; amount: string }[] };

function group(items: { code: LineCode; acc: Balance; amount: Decimal }[], order: LineCode[]): LineRow[] {
  return order.map((code) => {
    const own = items.filter((i) => i.code === code && !i.amount.isZero());
    return { code, amount: own.reduce((s, i) => s.plus(i.amount), new Decimal(0)).toFixed(2), accounts: own.map((i) => ({ id: i.acc.id, number: i.acc.number, name: i.acc.name, amount: i.amount.toFixed(2) })) };
  });
}

const sum = (rows: LineRow[], codes: LineCode[]) => rows.filter((r) => codes.includes(r.code)).reduce((s, r) => s.plus(r.amount), new Decimal(0));

/** Profit and loss for the movement in the period range. Revenue and income positive, costs positive (natural presentation). */
export function profitAndLoss(balances: Balance[], use: "movement" | "closing" = "movement") {
  const order: LineCode[] = ["REVENUE", "OTHER_INCOME", "COST_OF_SALES", "PERSONNEL", "DEPRECIATION", "OTHER_OPEX", "FINANCIAL", "INCOME_TAX"];
  const income: LineCode[] = ["REVENUE", "OTHER_INCOME"];
  const items = balances.filter((b) => isPL(b.category)).map((acc) => {
    const code = plLine(acc);
    const v = acc[use];
    // income lines show credit as positive; cost lines debit as positive; FINANCIAL shows the net income (credit positive)
    const amount = income.includes(code) || code === "FINANCIAL" ? v.negated() : v;
    return { code, acc, amount };
  });
  const lines = group(items, order);
  const revenue = sum(lines, ["REVENUE", "OTHER_INCOME"]);
  const gross = revenue.minus(sum(lines, ["COST_OF_SALES"]));
  const operating = gross.minus(sum(lines, ["PERSONNEL", "DEPRECIATION", "OTHER_OPEX"]));
  const beforeTax = operating.plus(sum(lines, ["FINANCIAL"]));
  const net = beforeTax.minus(sum(lines, ["INCOME_TAX"]));
  return { lines, totals: { revenue: revenue.toFixed(2), grossMargin: gross.toFixed(2), operatingResult: operating.toFixed(2), resultBeforeTax: beforeTax.toFixed(2), netResult: net.toFixed(2) } };
}

/** Balance sheet at the end of the range; the unclosed result of the year is shown in equity. */
export function balanceSheet(balances: Balance[]) {
  const result = profitAndLoss(balances, "closing").totals.netResult;
  const items = balances.filter((b) => !isPL(b.category)).map((acc) => {
    const code = bsLine(acc, acc.closing.gte(0));
    return { code, acc, amount: BS_ASSETS.includes(code) ? acc.closing : acc.closing.negated() };
  });
  const assets = group(items, BS_ASSETS);
  const liabilities = group(items, BS_LIABILITIES);
  const totalAssets = sum(assets, BS_ASSETS);
  const totalLiabilities = sum(liabilities, BS_LIABILITIES).plus(result);
  return {
    assets, liabilities, result,
    totals: { assets: totalAssets.toFixed(2), liabilitiesAndEquity: totalLiabilities.toFixed(2), equity: sum(liabilities, ["EQUITY"]).plus(result).toFixed(2) },
    balanced: totalAssets.eq(totalLiabilities),
  };
}

/**
 * Cash flow, indirect method: net result + depreciation − increase in working capital (operating), capital expenditure
 * (investing), changes in long-term liabilities and equity (financing). Reconciles to the change in cash.
 */
export function cashFlow(balances: Balance[]) {
  const pl = profitAndLoss(balances);
  const bs = balances.filter((b) => !isPL(b.category));
  const by = (codes: LineCode[]) => bs.filter((b) => codes.includes(bsLine(b, b.closing.gte(0))));
  const delta = (list: Balance[]) => list.reduce((s, b) => s.plus(b.movement), new Decimal(0)); // debit − credit movement
  const depreciation = bs.reduce((s, b) => s.plus(b.depreciationMovement), new Decimal(0));
  const workingCapital = by(["INVENTORY", "RECEIVABLES", "TAX_ASSETS", "OTHER_CURRENT_ASSETS", "CURRENT_LIABILITIES", "TAX_LIABILITIES"]);
  const wcChange = delta(workingCapital).negated(); // increase in assets (debit) uses cash
  const operating = new Decimal(pl.totals.netResult).plus(depreciation).plus(wcChange);
  const investing = delta(by(["FIXED_ASSETS"])).plus(depreciation).negated();
  const financing = delta(by(["LONG_TERM_LIABILITIES", "EQUITY"])).negated();
  const cashChange = delta(by(["CASH"]));
  const opening = by(["CASH"]).reduce((s, b) => s.plus(b.opening), new Decimal(0));
  return {
    netResult: pl.totals.netResult, depreciation: depreciation.toFixed(2), workingCapitalChange: wcChange.toFixed(2),
    operating: operating.toFixed(2), investing: investing.toFixed(2), financing: financing.toFixed(2),
    total: operating.plus(investing).plus(financing).toFixed(2), cashChange: cashChange.toFixed(2),
    openingCash: opening.toFixed(2), closingCash: opening.plus(cashChange).toFixed(2),
    reconciles: operating.plus(investing).plus(financing).eq(cashChange),
  };
}

/** Statement of changes in equity per equity account plus the result of the year. */
export function equityStatement(balances: Balance[]) {
  const eq = balances.filter((b) => b.category === "EQUITY");
  const result = profitAndLoss(balances).totals.netResult;
  const rows = eq.filter((b) => !b.opening.isZero() || !b.movement.isZero()).map((b) => ({ id: b.id, number: b.number, name: b.name, opening: b.opening.negated().toFixed(2), movement: b.movement.negated().toFixed(2), closing: b.closing.negated().toFixed(2) }));
  const tot = (k: "opening" | "movement" | "closing") => rows.reduce((s, r) => s.plus(r[k]), new Decimal(0));
  return { rows, result, totals: { opening: tot("opening").toFixed(2), movement: tot("movement").toFixed(2), closing: tot("closing").plus(result).toFixed(2) } };
}

// ───────────── KPIs (R2) ─────────────

export type KpiInput = { pl: ReturnType<typeof profitAndLoss>; bs: ReturnType<typeof balanceSheet>; days: number; priorRevenue?: string | null; fundBalance?: string };
export type Kpi = { code: string; value: string | null; unit: "%" | "x" | "days" | "SRD"; formula: string };

const ratio = (a: Decimal.Value, b: Decimal.Value) => (new Decimal(b).isZero() ? null : new Decimal(a).dividedBy(b));
const line = (rows: LineRow[], code: LineCode) => new Decimal(rows.find((r) => r.code === code)?.amount ?? 0);

/** KPI library: every KPI has a formula on report lines; division by zero gives null ("n.v.t."), never 0. */
export function computeKpis(k: KpiInput): Kpi[] {
  const { pl, bs } = k;
  const revenue = new Decimal(pl.totals.revenue);
  const cogs = line(pl.lines, "COST_OF_SALES");
  const currentAssets = CURRENT_ASSETS.reduce((s, c) => s.plus(line(bs.assets, c)), new Decimal(0));
  const currentLiabilities = CURRENT_LIABILITIES.reduce((s, c) => s.plus(line(bs.liabilities, c)), new Decimal(0));
  const inventory = line(bs.assets, "INVENTORY");
  const pct = (v: Decimal | null) => (v === null ? null : v.times(100).toDecimalPlaces(1).toFixed(1));
  const x = (v: Decimal | null, dp = 2) => (v === null ? null : v.toDecimalPlaces(dp).toFixed(dp));
  return [
    { code: "grossMargin", value: pct(ratio(revenue.minus(cogs), revenue)), unit: "%", formula: "(Omzet − Kostprijs omzet) / Omzet" },
    { code: "netMargin", value: pct(ratio(pl.totals.netResult, revenue)), unit: "%", formula: "Netto resultaat / Omzet" },
    { code: "currentRatio", value: x(ratio(currentAssets, currentLiabilities)), unit: "x", formula: "Vlottende activa / Kortlopende schulden" },
    { code: "quickRatio", value: x(ratio(currentAssets.minus(inventory), currentLiabilities)), unit: "x", formula: "(Vlottende activa − Voorraden) / Kortlopende schulden" },
    { code: "solvency", value: pct(ratio(bs.totals.equity, bs.totals.assets)), unit: "%", formula: "Eigen vermogen (incl. resultaat) / Totaal vermogen" },
    { code: "dso", value: x(ratio(line(bs.assets, "RECEIVABLES").times(k.days), revenue), 0), unit: "days", formula: "Vorderingen / Omzet × dagen in periode" },
    { code: "dpo", value: x(ratio(line(bs.liabilities, "CURRENT_LIABILITIES").times(k.days), cogs.plus(line(pl.lines, "OTHER_OPEX"))), 0), unit: "days", formula: "Kortlopende schulden / (Kostprijs omzet + Overige bedrijfskosten) × dagen" },
    { code: "inventoryTurnover", value: x(ratio(cogs, inventory)), unit: "x", formula: "Kostprijs omzet / Voorraden" },
    { code: "personnelCostRatio", value: pct(ratio(line(pl.lines, "PERSONNEL"), revenue)), unit: "%", formula: "Personeelskosten / Omzet" },
    { code: "revenueGrowth", value: k.priorRevenue == null ? null : pct(ratio(revenue.minus(k.priorRevenue), new Decimal(k.priorRevenue).abs())), unit: "%", formula: "(Omzet − Omzet vorig jaar) / |Omzet vorig jaar|" },
    { code: "fundBalance", value: k.fundBalance ?? null, unit: "SRD", formula: "Saldo bestemmingsfondsen en -reserves" },
  ];
}

// ───────────── Fingerprint (R1) ─────────────

/** Count and SHA-256 of the posted entries a report is built from (fiscal year, periods ≤ toPeriod), plus the parameters. */
export async function ledgerFingerprint(tx: Tx, q: { administrationId: string; fiscalYearId: string; toPeriod: number; params: Record<string, unknown> }) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM "JournalEntry" e JOIN "AccountingPeriod" p ON p.id = e."periodId"
     WHERE e."administrationId" = ${q.administrationId} AND e."fiscalYearId" = ${q.fiscalYearId} AND e.status = 'POSTED' AND p.number <= ${q.toPeriod}
     ORDER BY e.id`;
  const hash = createHash("sha256").update(JSON.stringify(q.params)).update("|").update(rows.map((r) => r.id).join(",")).digest("hex");
  return { entryCount: rows.length, fingerprint: hash };
}
