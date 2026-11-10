import Decimal from "decimal.js";
import type { Tx } from "@/core/db/client";

/**
 * Ledger read models. Only POSTED entries count (ACCOUNTING_RULES B1/R1). Amounts are base currency.
 * Opening = posted movements in periods before `fromPeriod` (period 0 holds the opening balances).
 */

export interface TrialBalanceRow {
  accountId: string;
  number: string;
  name: string;
  category: string;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceFilter {
  administrationId: string;
  fiscalYearId: string;
  fromPeriod: number;
  toPeriod: number;
  accountFrom?: string;
  accountTo?: string;
  journalId?: string;
  hideZero?: boolean;
}

const side = (net: Decimal): [Decimal, Decimal] => (net.gte(0) ? [net, new Decimal(0)] : [new Decimal(0), net.negated()]);
const s = (d: Decimal) => d.toFixed(2);

export async function trialBalance(tx: Tx, f: TrialBalanceFilter) {
  const rows = await tx.$queryRaw<
    { id: string; number: string; name: string; category: string; od: string; oc: string; pd: string; pc: string }[]
  >`
    SELECT a.id, a.number, a.name, a.category::text AS category,
           COALESCE(SUM(m.d) FILTER (WHERE m.pn <  ${f.fromPeriod}), 0)::text AS od,
           COALESCE(SUM(m.c) FILTER (WHERE m.pn <  ${f.fromPeriod}), 0)::text AS oc,
           COALESCE(SUM(m.d) FILTER (WHERE m.pn >= ${f.fromPeriod}), 0)::text AS pd,
           COALESCE(SUM(m.c) FILTER (WHERE m.pn >= ${f.fromPeriod}), 0)::text AS pc
      FROM "Account" a
      LEFT JOIN (
        SELECT l."accountId", ap.number AS pn, l."debitBase" AS d, l."creditBase" AS c
          FROM "JournalLine" l
          JOIN "JournalEntry" e ON e.id = l."entryId"
          JOIN "AccountingPeriod" ap ON ap.id = e."periodId"
         WHERE l."administrationId" = ${f.administrationId} AND e.status = 'POSTED' AND e."fiscalYearId" = ${f.fiscalYearId}
           AND ap.number <= ${f.toPeriod}
           AND (${f.journalId ?? null}::text IS NULL OR e."journalId" = ${f.journalId ?? null})
      ) m ON m."accountId" = a.id
     WHERE a."administrationId" = ${f.administrationId}
       AND a.type = 'DETAIL'
       AND (${f.accountFrom ?? null}::text IS NULL OR a.number >= ${f.accountFrom ?? null})
       AND (${f.accountTo ?? null}::text IS NULL OR a.number <= ${f.accountTo ?? null})
     GROUP BY a.id
     ORDER BY a.number`;

  const out: TrialBalanceRow[] = [];
  const total = { od: new Decimal(0), oc: new Decimal(0), pd: new Decimal(0), pc: new Decimal(0), cd: new Decimal(0), cc: new Decimal(0) };
  for (const r of rows) {
    const [od, oc] = side(new Decimal(r.od).minus(r.oc));
    const pd = new Decimal(r.pd);
    const pc = new Decimal(r.pc);
    const [cd, cc] = side(new Decimal(r.od).minus(r.oc).plus(pd).minus(pc));
    if (f.hideZero && od.isZero() && oc.isZero() && pd.isZero() && pc.isZero()) continue;
    total.od = total.od.plus(od); total.oc = total.oc.plus(oc);
    total.pd = total.pd.plus(pd); total.pc = total.pc.plus(pc);
    total.cd = total.cd.plus(cd); total.cc = total.cc.plus(cc);
    out.push({ accountId: r.id, number: r.number, name: r.name, category: r.category, openingDebit: s(od), openingCredit: s(oc), periodDebit: s(pd), periodCredit: s(pc), closingDebit: s(cd), closingCredit: s(cc) });
  }
  return {
    rows: out,
    totals: { openingDebit: s(total.od), openingCredit: s(total.oc), periodDebit: s(total.pd), periodCredit: s(total.pc), closingDebit: s(total.cd), closingCredit: s(total.cc) },
    balanced: total.pd.equals(total.pc) && total.cd.equals(total.cc),
  };
}

export interface LedgerLine {
  lineId: string;
  entryId: string;
  entryNumber: number | null;
  journalCode: string;
  entryDate: string;
  period: number;
  description: string;
  reference: string | null;
  debit: string;
  credit: string;
  balance: string;
  txCurrency: string;
  txAmount: string;
}

/** Account card with running balance (debit − credit) within one fiscal year. */
export async function generalLedger(tx: Tx, f: { administrationId: string; fiscalYearId: string; accountId: string; fromPeriod: number; toPeriod: number }) {
  const [opening] = await tx.$queryRaw<{ net: string }[]>`
    SELECT COALESCE(SUM(l."debitBase" - l."creditBase"), 0)::text AS net
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "AccountingPeriod" ap ON ap.id = e."periodId"
     WHERE l."accountId" = ${f.accountId} AND l."administrationId" = ${f.administrationId} AND e.status = 'POSTED'
       AND e."fiscalYearId" = ${f.fiscalYearId} AND ap.number < ${f.fromPeriod}`;
  const rows = await tx.$queryRaw<
    { lineId: string; entryId: string; entryNumber: number | null; journalCode: string; entryDate: Date; period: number; description: string; reference: string | null; debit: string; credit: string; txCurrency: string; txAmount: string; lineDescription: string | null }[]
  >`
    SELECT l.id AS "lineId", e.id AS "entryId", e."entryNumber", j.code AS "journalCode", e."entryDate", ap.number AS period,
           e.description, e.reference, l.description AS "lineDescription", l."debitBase"::text AS debit, l."creditBase"::text AS credit,
           l."txCurrency", l."txAmount"::text AS "txAmount"
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Journal" j ON j.id = e."journalId"
      JOIN "AccountingPeriod" ap ON ap.id = e."periodId"
     WHERE l."accountId" = ${f.accountId} AND l."administrationId" = ${f.administrationId} AND e.status = 'POSTED'
       AND e."fiscalYearId" = ${f.fiscalYearId} AND ap.number BETWEEN ${f.fromPeriod} AND ${f.toPeriod}
     ORDER BY ap.number, e."entryDate", j.code, e."entryNumber", l."lineNo"`;
  let running = new Decimal(opening?.net ?? 0);
  const lines: LedgerLine[] = rows.map((r) => {
    running = running.plus(r.debit).minus(r.credit);
    return {
      lineId: r.lineId, entryId: r.entryId, entryNumber: r.entryNumber, journalCode: r.journalCode, entryDate: r.entryDate.toISOString().slice(0, 10),
      period: r.period, description: r.lineDescription || r.description, reference: r.reference,
      debit: s(new Decimal(r.debit)), credit: s(new Decimal(r.credit)), balance: s(running), txCurrency: r.txCurrency, txAmount: new Decimal(r.txAmount).toFixed(2),
    };
  });
  return { opening: s(new Decimal(opening?.net ?? 0)), closing: s(running), lines };
}
